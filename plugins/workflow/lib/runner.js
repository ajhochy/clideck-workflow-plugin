const { watch, unlinkSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const state = require('./state');
const fixmod = require('./fix-subworkflow');
const { createLogger } = require('./logger');
const { pollPrChecks } = require('./ci-poller');

const SEQUENCE = ['planning', 'issues', 'pipeline', 'smoketest'];
const MAX_CI_RETRIES_PER_ISSUE = 3;

function nextStage(current) {
  const i = SEQUENCE.indexOf(current);
  if (i < 0 || i === SEQUENCE.length - 1) return 'done';
  return SEQUENCE[i + 1];
}

function createRunner({ dir, api, stages, onAdvance = () => {}, lockFor = null, maxFixAttempts = 2 }) {
  let watcher = null;
  let currentSession = null;
  let currentLock = null;

  const wfLog = createLogger({ dir, stage: 'runner' });
  const sessionStreams = new Map();

  async function spawnCurrentStage() {
    const s = state.read(dir);
    if (s.currentStage === 'done' || s.currentStage === 'failed') return;
    const stage = stages[s.currentStage];
    if (!stage) return;

    try { wfLog.event('stage_spawn_attempt', { stage: s.currentStage, fixAttempts: s.fixAttempts?.length || 0 }); } catch {}

    if (lockFor) {
      const lockPromise = lockFor(s.currentStage, s.id);
      if (lockPromise) currentLock = await lockPromise;
    }
    const prompt = stage.build(s, dir);
    const sid = api.createSession({
      name: `Workflow ${s.title || s.id} · ${s.currentStage}`,
      presetId: stage.preset || 'claude-code',
      projectId: s.projectId,
      extraArgs: stage.extraArgs || [],
      autoFocus: false,
    });
    currentSession = sid;

    try { wfLog.prompt(`stage:${s.currentStage}`, prompt); } catch {}
    try { wfLog.event('stage_session_created', { stage: s.currentStage, sessionId: sid, presetId: stage.preset || 'claude-code' }); } catch {}

    try {
      const stageLog = createLogger({ dir, stage: s.currentStage });
      const stream = stageLog.openSessionStream(sid, s.currentStage);
      sessionStreams.set(sid, stream);
      // TODO: wire api session output → stream.onData when api exposes a hook
    } catch {}

    if (sid && prompt) {
      // Agents need a few seconds to boot before they accept input.
      setTimeout(() => { try { api.inputToSession(sid, prompt); } catch {} }, 4000);
      setTimeout(() => { try { api.inputToSession(sid, '\r'); } catch {} }, 4250);
    }
  }

  async function handleStepDone() {
    // Clear marker first so we don't re-trigger on the next watch event.
    try { unlinkSync(join(dir, 'done', 'step.done')); } catch {}

    // Close the per-step agent session — its work is done. The next pipeline invocation gets a fresh session.
    const sid = currentSession;
    if (currentSession) { try { api.closeSession(currentSession); } catch {} }
    try { sessionStreams.get(sid)?.close({ stage: 'pipeline-step' }); sessionStreams.delete(sid); } catch {}
    currentSession = null;
    if (currentLock) { currentLock.release(); currentLock = null; }

    const s0 = state.read(dir);
    const pushed = (s0.issues || []).find((i) => i.status === 'pushed');
    if (!pushed) {
      // Nothing pushed → nothing to verify. Re-spawn pipeline; build() will branch to finalize if all done.
      spawnCurrentStage();
      return;
    }

    const repo = s0.githubRepo;
    const prNum = s0.pr?.number;
    if (!repo || !prNum) {
      // No PR yet (very first commit may have just landed without one) or no repo — mark step done optimistically.
      state.update(dir, (c) => {
        const i = c.issues.find((x) => x.number === pushed.number);
        if (i) { i.status = 'done'; }
      });
      spawnCurrentStage();
      return;
    }

    try { wfLog.event('ci_poll_start', { issue: pushed.number, pr: prNum, repo }); } catch {}
    const result = await pollPrChecks({
      prNumber: prNum,
      repo,
      onPoll: (snap) => { try { wfLog.event('ci_poll', { issue: pushed.number, snap }); } catch {} },
    });
    try { wfLog.event('ci_poll_done', { issue: pushed.number, result: result.state }); } catch {}

    if (result.state === 'passed' || result.state === 'no-checks') {
      state.update(dir, (c) => {
        const i = c.issues.find((x) => x.number === pushed.number);
        if (i) {
          i.status = 'done';
          delete i.lastCiFailure;
        }
      });
      spawnCurrentStage();
      return;
    }

    if (result.state === 'failed') {
      const updated = state.update(dir, (c) => {
        const i = c.issues.find((x) => x.number === pushed.number);
        if (!i) return;
        i.ciAttempts = (i.ciAttempts || 0) + 1;
        if (i.ciAttempts >= MAX_CI_RETRIES_PER_ISSUE) {
          i.status = 'failed';
        } else {
          i.status = 'fix-needed';
          i.lastCiFailure = { failed: result.failed?.map((f) => ({ name: f.name, link: f.link })) || [], at: new Date().toISOString() };
        }
      });
      const issue = updated.issues.find((x) => x.number === pushed.number);
      if (issue?.status === 'failed') {
        require('node:fs').writeFileSync(join(dir, 'done', 'pipeline.failed'), `Issue ${issue.number} (${issue.title || ''}) exceeded CI retry budget (${MAX_CI_RETRIES_PER_ISSUE}).`);
        return;
      }
      spawnCurrentStage();
      return;
    }

    // Timeout — treat as failure.
    require('node:fs').writeFileSync(join(dir, 'done', 'pipeline.failed'), `CI poll timed out for PR ${prNum} on issue ${pushed.number}.`);
  }

  function handleMarker(filename) {
    if (!filename) return;
    // Ignore deletion events — only act when the file actually exists.
    if (!existsSync(join(dir, 'done', filename))) return;

    if (filename.endsWith('.failed')) {
      const stage = filename.slice(0, -'.failed'.length);
      // Per-step agent self-reported failure → treat as pipeline failure.
      if (stage === 'step') {
        const failureFile = join(dir, 'done', filename);
        let failureText = '';
        try { failureText = require('node:fs').readFileSync(failureFile, 'utf8'); } catch {}
        try { unlinkSync(failureFile); } catch {}
        require('node:fs').writeFileSync(join(dir, 'done', 'pipeline.failed'), failureText || 'per-step agent reported failure');
        return;
      }
      if (stage === 'smoketest') return; // smoketest uses fix loop-back
      const failureFile = join(dir, 'done', filename);
      let failureText = '';
      try { failureText = require('node:fs').readFileSync(failureFile, 'utf8'); } catch {}
      const cur = state.read(dir);
      const prev = cur.stageFailures?.[stage] || [];
      if (prev.length >= 1) {
        try { wfLog.event('stage_failed', { stage, failureText, retryDecision: 'give-up' }); } catch {}
        try { wfLog.error(new Error(failureText)); } catch {}
        const sid = currentSession;
        const failed = state.update(dir, (c) => { c.currentStage = 'failed'; });
        try { sessionStreams.get(sid)?.close({ stage }); sessionStreams.delete(sid); } catch {}
        onAdvance(failed);
        return;
      }
      try { wfLog.event('stage_failed', { stage, failureText, retryDecision: 'retry' }); } catch {}
      try { wfLog.error(new Error(failureText)); } catch {}
      state.update(dir, (c) => {
        c.stageFailures = c.stageFailures || {};
        c.stageFailures[stage] = [...(c.stageFailures[stage] || []), failureText];
      });
      try { unlinkSync(failureFile); } catch {}
      const sid = currentSession;
      if (currentSession) api.closeSession(currentSession);
      try { sessionStreams.get(sid)?.close({ stage }); sessionStreams.delete(sid); } catch {}
      currentSession = null;
      if (currentLock) { currentLock.release(); currentLock = null; }
      spawnCurrentStage();
      return;
    }

    if (!filename.endsWith('.done')) return;
    const stageDone = filename.slice(0, -'.done'.length);

    // Per-step pipeline marker — agent did one issue and exited; runner now polls CI.
    if (stageDone === 'step') {
      handleStepDone();
      return;
    }

    // Smoketest is special — branch on result.
    if (stageDone === 'smoketest') {
      const s = state.read(dir);
      const sid = currentSession;
      if (currentSession) api.closeSession(currentSession);
      currentSession = null;
      if (currentLock) { currentLock.release(); currentLock = null; }

      if (s.smoketestResult?.status === 'failed') {
        const willRetry = fixmod.shouldRetry(s, maxFixAttempts);
        try { wfLog.event('smoketest_failed', { willRetry }); } catch {}
        if (willRetry) {
          try { sessionStreams.get(sid)?.close({ stage: stageDone }); sessionStreams.delete(sid); } catch {}
          // Clear all markers
          for (const m of ['planning', 'issues', 'pipeline', 'smoketest']) {
            try { unlinkSync(join(dir, 'done', `${m}.done`)); } catch {}
          }
          fixmod.startFixAttempt(dir, state);
          const updated = state.read(dir);
          onAdvance(updated);
          spawnCurrentStage();
          return;
        }
        try { sessionStreams.get(sid)?.close({ stage: stageDone }); sessionStreams.delete(sid); } catch {}
        const failed = state.update(dir, (cur) => { cur.currentStage = 'failed'; });
        onAdvance(failed);
        return;
      }
      try { sessionStreams.get(sid)?.close({ stage: stageDone }); sessionStreams.delete(sid); } catch {}
      const done = state.update(dir, (cur) => { cur.currentStage = 'done'; });
      try { wfLog.event('stage_done', { from: stageDone, to: done.currentStage }); } catch {}
      onAdvance(done);
      return;
    }

    // Default flow for non-smoketest stages.
    const before = state.read(dir).currentStage;
    const updated = state.update(dir, (cur) => {
      if (cur.currentStage !== stageDone) return;
      cur.currentStage = nextStage(cur.currentStage);
    });
    if (updated.currentStage === before) return;
    const sid = currentSession;
    if (currentSession) api.closeSession(currentSession);
    currentSession = null;
    if (currentLock) { currentLock.release(); currentLock = null; }
    try { sessionStreams.get(sid)?.close({ stage: stageDone }); sessionStreams.delete(sid); } catch {}
    try { wfLog.event('stage_done', { from: stageDone, to: updated.currentStage }); } catch {}
    onAdvance(updated);
    if (updated.currentStage !== 'done' && updated.currentStage !== 'failed') {
      spawnCurrentStage();
    }
  }

  function start() {
    watcher = watch(join(dir, 'done'), { persistent: false }, (_evt, fn) => handleMarker(fn));
    spawnCurrentStage();
  }

  function stop() {
    if (watcher) watcher.close();
    watcher = null;
    if (currentLock) { currentLock.release(); currentLock = null; }
  }

  return { start, stop };
}

module.exports = { createRunner, nextStage, SEQUENCE };
