const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const state = require('../lib/state');
const { initFolder } = require('../lib/workflow-folder');
const { createRunner } = require('../lib/runner');

function tick(ms = 50) { return new Promise((r) => setTimeout(r, ms)); }

test('runner advances state when a marker file appears', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wfrt-'));
  try {
    const id = 'wf-1';
    const dir = initFolder(root, id);
    state.write(dir, state.createState({ id, title: 't', description: 'd', projectId: 'p', branch: 'feat/x' }));

    const advances = [];
    const fakeApi = { createSession: () => 'sess-1', closeSession: () => {}, log: () => {} };
    const runner = createRunner({ dir, api: fakeApi, stages: {
      planning: { build: () => 'PLAN_PROMPT' },
      issues: { build: () => 'ISSUES_PROMPT' },
    }, onAdvance: (s) => advances.push(s.currentStage) });

    runner.start();
    await tick();
    writeFileSync(join(dir, 'done', 'planning.done'), '');
    await tick(150);
    runner.stop();
    assert.ok(advances.includes('issues'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('runner ignores stale marker (one for a stage already past)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wfst-'));
  try {
    const id = 'wf-stale';
    const dir = initFolder(root, id);
    const s = state.createState({ id, title: 't', description: 'd', projectId: 'p', branch: 'feat/x' });
    s.currentStage = 'pipeline'; // already past planning
    state.write(dir, s);

    const advances = [];
    const spawns = [];
    const fakeApi = {
      createSession: () => { spawns.push(1); return 'sess'; },
      closeSession: () => {},
      log: () => {},
    };
    const runner = createRunner({
      dir, api: fakeApi,
      stages: { pipeline: { build: () => 'P' } },
      onAdvance: (s2) => advances.push(s2.currentStage),
    });
    runner.start();
    await tick();
    // Drop a STALE marker for planning (already past)
    writeFileSync(join(dir, 'done', 'planning.done'), '');
    await tick(150);
    runner.stop();
    assert.equal(advances.length, 0, 'no advances on stale marker');
    assert.equal(spawns.length, 1, 'only the initial spawn');
    assert.equal(state.read(dir).currentStage, 'pipeline');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
