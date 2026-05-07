const path = require('node:path');
const { join } = path;
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const { writeFileSync } = fs;
const state = require('./lib/state');
const wf = require('./lib/workflow-folder');
const branch = require('./lib/branch');
const { createLock } = require('./lib/smoketest-lock');
const { createRunner } = require('./lib/runner');
const rhythm = require('./lib/rhythm');
const summaryMod = require('./lib/summary');
const { createPrModule } = require('./lib/pr');
const resume = require('./lib/resume');
const { createLogger } = require('./lib/logger');

function runGh(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`gh ${args.join(' ')} failed: ${stderr || err.message}`));
      else resolve(stdout);
    });
  });
}

const stages = {
  planning: require('./lib/stages/planning'),
  issues: require('./lib/stages/issues'),
  pipeline: require('./lib/stages/pipeline'),
  smoketest: require('./lib/stages/smoketest'),
};

module.exports = {
  init(api) {
    const root = join(api.pluginDir, 'workflows');
    require('node:fs').mkdirSync(root, { recursive: true });

    const ctx = {
      api,
      root,
      smoketestLock: createLock(),
      workflows: new Map(),     // id → { dir, runner }
      inFlightBranches: new Map(), // projectId → Set<branch>
    };
    api._workflowCtx = ctx; // for tests
    api.log('Workflow plugin initialized');

    // Per-workflow-per-session log streams for file capture.
    // Key: `${wfId}:${sid}` → stream object from openSessionStream.
    const relayStreams = new Map();

    // Per-workflow fs.FSWatcher on state.json. Key: workflow id → FSWatcher.
    const stateWatchers = new Map();
    function watchStateFile(id, dir) {
      if (stateWatchers.has(id)) return;
      try {
        let timer = null;
        const watcher = fs.watch(path.join(dir, 'state.json'), { persistent: false }, () => {
          if (timer) return;
          timer = setTimeout(() => {
            timer = null;
            try {
              api.sendToFrontend('list', { workflows: listAll() });
            } catch (_) { /* ENOENT during deletion etc. */ }
          }, 200);
        });
        watcher.on('error', () => { /* swallow ENOENT during deletion */ });
        stateWatchers.set(id, watcher);
      } catch (_) {
        // state.json may not exist yet; safe to ignore
      }
    }

    function performDeleteRm(dir) {
      let lastErr = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 }); }
        catch (e) { lastErr = e; }
        if (!fs.existsSync(dir)) return null;
        const until = Date.now() + 100;
        while (Date.now() < until) { /* spin */ }
      }
      return lastErr || new Error('directory still exists after retries');
    }

    // Relay output from each workflow's active stage session to the panel so
    // questions/decisions surface in the panel chat box, not only in the
    // terminal. Strip ANSI to keep the panel readable.
    const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[=>]|[\x00-\x08\x0b\x0c\x0e-\x1f]/g;
    function stripAnsi(s) { return String(s).replace(ANSI_RE, ''); }
    api.onSessionOutput((sid, data) => {
      for (const [wfId, entry] of ctx.workflows) {
        if (entry.activeSession !== sid) continue;
        const text = stripAnsi(data);
        if (!text) return;
        api.sendToFrontend('agent-output', { id: wfId, text });

        // Per-chunk file capture — lazily open a stream on the first chunk for
        // this sid, then append every chunk. Must never throw out of the relay.
        try {
          const streamKey = `${wfId}:${sid}`;
          let stream = relayStreams.get(streamKey);
          if (!stream) {
            const wfState = state.read(entry.dir);
            const currentStage = wfState.currentStage || 'unknown';
            const stageLogger = createLogger({ dir: entry.dir, stage: currentStage });
            stream = stageLogger.openSessionStream(sid, currentStage);
            relayStreams.set(streamKey, stream);
          }
          stream.onData(data);
        } catch (_) {
          // Intentionally swallowed — logging must never disrupt the relay.
        }

        return;
      }
    });

    // Watch state.json for any workflow already on disk, so the UI updates
    // when a stage agent writes progress even before resume/create runs.
    try {
      for (const wfId of wf.listWorkflows(root)) {
        watchStateFile(wfId, join(root, wfId));
      }
    } catch (_) { /* swallow */ }

    ctx.rhythmAvailable = false;
    rhythm.probe(api).then((ok) => {
      ctx.rhythmAvailable = ok;
      if (!ok) api.sendToFrontend('banner', { kind: 'warn', message: 'Rhythm MCP unavailable — manual setup will not auto-create tasks.' });
    });

    const resumables = resume.findResumable(root);
    if (resumables.length) {
      api.sendToFrontend('resume-prompt', {
        workflows: resumables.map((s) => ({ id: s.id, title: s.title, currentStage: s.currentStage })),
      });
    }

    api.onFrontendMessage('resume', ({ id }) => {
      const dir = join(root, id);
      if (!state.exists(dir)) return;
      const s = state.read(dir);
      // re-register inFlight branch
      const set = ctx.inFlightBranches.get(s.projectId) || new Set();
      if (s.branch) set.add(s.branch);
      ctx.inFlightBranches.set(s.projectId, set);
      const trackedApi = {
        ...api,
        createSession: (opts) => {
          const sid = api.createSession(opts);
          const entry = ctx.workflows.get(id);
          if (entry) entry.activeSession = sid;
          return sid;
        },
        closeSession: (sid) => {
          const entry = ctx.workflows.get(id);
          if (entry?.activeSession === sid) entry.activeSession = null;
          // Close the relay stream for this session, if one was opened.
          try {
            const streamKey = `${id}:${sid}`;
            const stream = relayStreams.get(streamKey);
            if (stream) { stream.close({}); relayStreams.delete(streamKey); }
          } catch (_) {}
          return api.closeSession(sid);
        },
      };
      const runner = createRunner({
        dir, api: trackedApi, stages,
        onAdvance: (u) => {
          api.sendToFrontend('list', { workflows: listAll() });
          finalize(u, dir).catch((e) => api.log(`finalize error: ${e.message}`));
        },
        lockFor: (stageName, wfId) => stageName === 'smoketest' ? ctx.smoketestLock.acquire(wfId) : null,
        maxFixAttempts: api.getSetting('maxFixAttempts') ?? 2,
      });
      ctx.workflows.set(id, { dir, runner });
      watchStateFile(id, dir);
      runner.start();
      api.log(`Resumed workflow ${id} at stage ${s.currentStage}`);
    });

    function listAll() {
      return wf.listWorkflows(root).map((id) => state.read(join(root, id)));
    }

    api.onFrontendMessage('list', () => api.sendToFrontend('list', { workflows: listAll() }));

    async function finalize(s, workflowDir) {
      if (s.currentStage !== 'done' && s.currentStage !== 'failed') return;
      const md = summaryMod.render(s);
      writeFileSync(join(workflowDir, 'summary.md'), md);
      if (s.githubRepo && s.pr?.number) {
        const pr = createPrModule({ runGh: (args) => runGh(args) });
        try {
          await pr.updatePrBody({ repo: s.githubRepo, number: s.pr.number, body: md });
          if (s.currentStage === 'done' && s.smoketestResult?.status === 'passed') {
            await pr.markReady({ repo: s.githubRepo, number: s.pr.number });
          }
        } catch (e) {
          api.log(`finalize: gh call failed for workflow ${s.id}: ${e.message}`);
        }
      }
    }

    api.onFrontendMessage('create', (msg) => {
      const { description, title, branch: branchInput, projectId } = msg;
      if (!description || !projectId) {
        api.sendToFrontend('warn', { message: 'Description and project are required.' });
        return;
      }
      const inFlight = ctx.inFlightBranches.get(projectId) || new Set();
      const finalTitle = (title && title.trim()) || description.split('\n')[0].slice(0, 80);
      let finalBranch = branchInput && branchInput !== 'auto' ? branchInput : branch.slugFromTitle(finalTitle);
      if (branch.isCollision(finalBranch, inFlight)) {
        api.sendToFrontend('warn', {
          message: `Branch "${finalBranch}" is already in use by another in-flight workflow on this project. Pick a different name.`,
        });
        return;
      }
      const id = wf.newWorkflowId(finalTitle);
      const dir = wf.initFolder(root, id);
      const s = state.createState({
        id,
        title: finalTitle,
        description,
        projectId,
        branch: finalBranch,
        branchSource: branchInput && branchInput !== 'auto' ? 'user' : 'auto',
      });
      state.write(dir, s);
      inFlight.add(finalBranch);
      ctx.inFlightBranches.set(projectId, inFlight);
      const trackedApi = {
        ...api,
        createSession: (opts) => {
          const sid = api.createSession(opts);
          const entry = ctx.workflows.get(id);
          if (entry) entry.activeSession = sid;
          return sid;
        },
        closeSession: (sid) => {
          const entry = ctx.workflows.get(id);
          if (entry?.activeSession === sid) entry.activeSession = null;
          // Close the relay stream for this session, if one was opened.
          try {
            const streamKey = `${id}:${sid}`;
            const stream = relayStreams.get(streamKey);
            if (stream) { stream.close({}); relayStreams.delete(streamKey); }
          } catch (_) {}
          return api.closeSession(sid);
        },
      };
      const runner = createRunner({
        dir,
        api: trackedApi,
        stages,
        onAdvance: (s) => {
          api.sendToFrontend('list', { workflows: listAll() });
          finalize(s, dir).catch((e) => api.log(`finalize error: ${e.message}`));
        },
        lockFor: (stageName, wfId) => stageName === 'smoketest' ? ctx.smoketestLock.acquire(wfId) : null,
        maxFixAttempts: api.getSetting('maxFixAttempts') ?? 2,
      });
      ctx.workflows.set(id, { dir, runner });
      watchStateFile(id, dir);
      api.sendToFrontend('created', { id });
      api.log(`Created workflow ${id} on branch ${finalBranch}`);
      runner.start();
    });

    api.onFrontendMessage('validate-branch', ({ projectId, branch: branchVal }) => {
      const set = ctx.inFlightBranches.get(projectId) || new Set();
      api.sendToFrontend('branch-validation', {
        branch: branchVal,
        inUse: !!(branchVal && set.has(branchVal)),
      });
    });

    api.onFrontendMessage('chat', ({ id, text }) => {
      const sess = ctx.workflows.get(id)?.activeSession;
      if (sess) api.inputToSession(sess, text + '\r');
    });

    api.onFrontendMessage('openSession', ({ id }) => {
      const sess = ctx.workflows.get(id)?.activeSession;
      if (sess) api.sendToFrontend('focusSession', { sessionId: sess });
    });

    api.onFrontendMessage('delete', ({ id }) => {
      if (!id) {
        try { api.sendToFrontend('delete-result', { id: null, success: false, error: 'missing workflow id' }); } catch (_) {}
        return;
      }
      const dir = join(root, id);
      const known = ctx.workflows.has(id) || fs.existsSync(dir);
      if (!known) {
        try { api.sendToFrontend('delete-result', { id, success: false, error: `unknown workflow ${id}` }); } catch (_) {}
        return;
      }
      const entry = ctx.workflows.get(id);
      const teardownErrors = [];

      // (2) Close active session.
      try {
        if (entry && entry.activeSession) api.closeSession(entry.activeSession);
      } catch (e) { teardownErrors.push(e); }

      // (3) Stop runner.
      try {
        if (entry && entry.runner && typeof entry.runner.stop === 'function') entry.runner.stop();
      } catch (e) { teardownErrors.push(e); }

      // (4) Remove branch from inFlightBranches.
      try {
        const s = state.read(dir);
        if (s.projectId && s.branch) {
          const set = ctx.inFlightBranches.get(s.projectId);
          if (set) {
            set.delete(s.branch);
            if (set.size === 0) ctx.inFlightBranches.delete(s.projectId);
          }
        }
      } catch (e) { teardownErrors.push(e); }

      // (5) Close+remove relay streams for this workflow.
      try {
        const prefix = `${id}:`;
        for (const [key, stream] of relayStreams) {
          if (key.startsWith(prefix)) {
            try { stream.close({}); } catch (_) {}
            relayStreams.delete(key);
          }
        }
      } catch (e) { teardownErrors.push(e); }

      // (6) Close+remove the state-watcher.
      try {
        const watcher = stateWatchers.get(id);
        if (watcher) { try { watcher.close(); } catch (_) {} stateWatchers.delete(id); }
      } catch (e) { teardownErrors.push(e); }

      // (7) Drop ctx.workflows entry.
      try { ctx.workflows.delete(id); } catch (e) { teardownErrors.push(e); }

      if (teardownErrors.length) {
        try { api.log('Teardown errors during delete of ' + id + ': ' + teardownErrors.map(e => e.message).join('; ')); } catch (_) {}
      }

      // (8) Schedule rm with grace period for any lingering fs handles.
      setTimeout(() => {
        const lastErr = performDeleteRm(dir);
        const success = !fs.existsSync(dir);
        if (success) { try { api.sendToFrontend('list', { workflows: listAll() }); } catch (_) {} }
        try {
          api.sendToFrontend('delete-result', {
            id,
            success,
            error: success ? null : ((lastErr && lastErr.message) || 'directory still exists after rmSync'),
          });
        } catch (_) {}
        try {
          api.log(success ? `Deleted workflow ${id}` : `Failed to delete workflow ${id}: ${(lastErr && lastErr.message) || 'unknown error'}`);
        } catch (_) {}
      }, 250);
    });

    api.onShutdown(() => api.log('Workflow plugin shutting down'));
  },
};
