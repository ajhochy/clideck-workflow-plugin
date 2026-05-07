const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const state = require('../lib/state');
const { initFolder } = require('../lib/workflow-folder');
const resume = require('../lib/resume');

test('findResumable returns workflows whose currentStage is not done/failed', () => {
  const root = mkdtempSync(join(tmpdir(), 'wfre-'));
  try {
    const a = initFolder(root, 'a');
    state.write(a, { ...state.createState({ id: 'a', title: 't', description: 'd', projectId: 'p' }), currentStage: 'pipeline' });
    const b = initFolder(root, 'b');
    state.write(b, { ...state.createState({ id: 'b', title: 't', description: 'd', projectId: 'p' }), currentStage: 'done' });
    const ids = resume.findResumable(root).map((s) => s.id);
    assert.deepEqual(ids, ['a']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
