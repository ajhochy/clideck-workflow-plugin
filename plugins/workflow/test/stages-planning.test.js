const test = require('node:test');
const assert = require('node:assert/strict');
const planning = require('../lib/stages/planning');

test('planning prompt includes state path, description, and instructs codebase exploration before Q&A', () => {
  const s = { id: 'wf-1', description: 'Add login throttling', projectId: 'p', branch: 'feat/x' };
  const out = planning.build(s, '/tmp/wf-1');
  assert.match(out, /\/tmp\/wf-1\/state\.json/);
  assert.match(out, /Add login throttling/);
  assert.match(out, /Haiku/i);
  assert.match(out, /explore the codebase/i);
  assert.match(out, /clarifying questions/i);
  assert.match(out, /atomic step/i);
  assert.match(out, /WORKFLOW_STAGE_DONE/);
  assert.match(out, /done\/planning\.done/);
});

test('planning preset is opus claude-code', () => {
  assert.match(planning.preset, /opus/i);
});
