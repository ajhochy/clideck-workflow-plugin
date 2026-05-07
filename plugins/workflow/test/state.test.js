const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const state = require('../lib/state');

test('createState produces a default object with required fields', () => {
  const s = state.createState({ id: 'wf-1', title: 'Test', description: 'do thing', projectId: 'p1' });
  assert.equal(s.id, 'wf-1');
  assert.equal(s.currentStage, 'planning');
  assert.equal(s.fixAttempts.length, 0);
  assert.ok(s.createdAt);
  assert.equal(s.smoketestResult, null);
});

test('write then read round-trips state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wf-'));
  try {
    const s = state.createState({ id: 'wf-2', title: 't', description: 'd', projectId: 'p' });
    state.write(dir, s);
    const got = state.read(dir);
    assert.deepEqual(got, s);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('update mutates and bumps updatedAt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wf-'));
  try {
    const s = state.createState({ id: 'wf-3', title: 't', description: 'd', projectId: 'p' });
    state.write(dir, s);
    const before = state.read(dir).updatedAt;
    // ensure clock moves
    const after = state.update(dir, (cur) => { cur.currentStage = 'issues'; });
    assert.equal(after.currentStage, 'issues');
    assert.notEqual(after.updatedAt, before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
