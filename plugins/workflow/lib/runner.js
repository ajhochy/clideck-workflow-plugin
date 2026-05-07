const { watch } = require('node:fs');
const { join } = require('node:path');
const state = require('./state');

const SEQUENCE = ['planning', 'issues', 'pipeline', 'smoketest'];

function nextStage(current) {
  const i = SEQUENCE.indexOf(current);
  if (i < 0 || i === SEQUENCE.length - 1) return 'done';
  return SEQUENCE[i + 1];
}

function createRunner({ dir, api, stages, onAdvance = () => {}, lockFor = null }) {
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
    currentSession = api.createSession({
      name: `Workflow ${s.id} · ${s.currentStage}`,
      preset: stage.preset || 'claude-code',
      projectId: s.projectId,
      starterPrompt: prompt,
    });
  }

  function handleMarker(filename) {
    if (!filename || !filename.endsWith('.done')) return;
    const stageDone = filename.slice(0, -'.done'.length);
    const before = state.read(dir).currentStage;
    const updated = state.update(dir, (cur) => {
      if (cur.currentStage !== stageDone) return;
      cur.currentStage = nextStage(cur.currentStage);
    });
    if (updated.currentStage === before) return; // stale marker — no-op
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
