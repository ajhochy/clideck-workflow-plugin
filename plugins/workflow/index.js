const { join } = require('node:path');
const { execFile } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const state = require('./lib/state');
const wf = require('./lib/workflow-folder');
const branch = require('./lib/branch');
const { createLock } = require('./lib/smoketest-lock');
const { createRunner } = require('./lib/runner');
const rhythm = require('./lib/rhythm');
const summaryMod = require('./lib/summary');
const { createPrModule } = require('./lib/pr');
const resume = require('./lib/resume');

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
      const runner = createRunner({
        dir, api, stages,
        onAdvance: (u) => {
          api.sendToFrontend('list', { workflows: listAll() });
          finalize(u, dir).catch((e) => api.log(`finalize error: ${e.message}`));
        },
        lockFor: (stageName, wfId) => stageName === 'smoketest' ? ctx.smoketestLock.acquire(wfId) : null,
        maxFixAttempts: api.getSetting('maxFixAttempts') ?? 2,
      });
      ctx.workflows.set(id, { dir, runner });
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
      const id = wf.newWorkflowId();
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
      const runner = createRunner({
        dir,
        api,
        stages,
        onAdvance: (s) => {
          api.sendToFrontend('list', { workflows: listAll() });
          finalize(s, dir).catch((e) => api.log(`finalize error: ${e.message}`));
        },
        lockFor: (stageName, wfId) => stageName === 'smoketest' ? ctx.smoketestLock.acquire(wfId) : null,
        maxFixAttempts: api.getSetting('maxFixAttempts') ?? 2,
      });
      ctx.workflows.set(id, { dir, runner });
      api.sendToFrontend('created', { id });
      api.log(`Created workflow ${id} on branch ${finalBranch}`);
      runner.start();
    });

    api.onShutdown(() => api.log('Workflow plugin shutting down'));
  },
};
