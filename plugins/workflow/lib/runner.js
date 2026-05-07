const { watch, unlinkSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const state = require('./state');
const fixmod = require('./fix-subworkflow');

const SEQUENCE = ['planning', 'issues', 'pipeline', 'smoketest'];

function nextStage(current) {
  const i = SEQUENCE.indexOf(current);
  if (i < 0 || i === SEQUENCE.length - 1) return 'done';
  return SEQUENCE[i + 1];
}

function createRunner({ dir, api, stages, onAdvance = () => {}, lockFor = null, maxFixAttempts = 2 }) {
  let watcher = null;
  let currentSession = null;
  let currentLock = null;

  async function spawnCurrentStage() {
    const s = state.read(dir);
    if (s.currentStage === 'done' || s.currentStage === 'failed') return;
    const stage = stages[s.currentStage];
    if (!stage) return;
    if (lockFor) {
      const lockPromise = lockFor(s.currentStage, s.id);
      if (lockPromise) currentLock = await lockPromise;
    }
    const prompt = stage.build(s, dir);
    const sid = api.createSession({
      name: `Workflow ${s.id} · ${s.currentStage}`,
      presetId: stage.preset || 'claude-code',
      projectId: s.projectId,
      extraArgs: stage.extraArgs || [],
    });
    currentSession = sid;
    if (sid && prompt) {
      // Agents need a few seconds to boot before they accept input.
      setTimeout(() => { try { api.inputToSession(sid, prompt); } catch {} }, 4000);
      setTimeout(() => { try { api.inputToSession(sid, '\r'); } catch {} }, 4250);
    }
  }

  function handleMarker(filename) {
    if (!filename) return;
    // Ignore deletion events — only act when the file actually exists.
    if (!existsSync(join(dir, 'done', filename))) return;

    if (filename.endsWith('.failed')) {
      const stage = filename.slice(0, -'.failed'.length);
      if (stage === 'smoketest') return; // smoketest uses fix loop-back
      const failureFile = join(dir, 'done', filename);
      let failureText = '';
      try { failureText = require('node:fs').readFileSync(failureFile, 'utf8'); } catch {}
      const cur = state.read(dir);
      const prev = cur.stageFailures?.[stage] || [];
      if (prev.length >= 1) {
        const failed = state.update(dir, (c) => { c.currentStage = 'failed'; });
        onAdvance(failed);
        return;
      }
      state.update(dir, (c) => {
        c.stageFailures = c.stageFailures || {};
        c.stageFailures[stage] = [...(c.stageFailures[stage] || []), failureText];
      });
      try { unlinkSync(failureFile); } catch {}
      if (currentSession) api.closeSession(currentSession);
      currentSession = null;
      if (currentLock) { currentLock.release(); currentLock = null; }
      spawnCurrentStage();
      return;
    }

    if (!filename.endsWith('.done')) return;
    const stageDone = filename.slice(0, -'.done'.length);

    // Smoketest is special — branch on result.
    if (stageDone === 'smoketest') {
      const s = state.read(dir);
      if (currentSession) api.closeSession(currentSession);
      currentSession = null;
      if (currentLock) { currentLock.release(); currentLock = null; }

      if (s.smoketestResult?.status === 'failed') {
        if (fixmod.shouldRetry(s, maxFixAttempts)) {
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
        const failed = state.update(dir, (cur) => { cur.currentStage = 'failed'; });
        onAdvance(failed);
        return;
      }
      const done = state.update(dir, (cur) => { cur.currentStage = 'done'; });
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
    if (currentSession) api.closeSession(currentSession);
    currentSession = null;
    if (currentLock) { currentLock.release(); currentLock = null; }
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
