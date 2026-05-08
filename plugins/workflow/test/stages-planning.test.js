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

test('planning uses claude-code preset and instructs Opus model in prompt body', () => {
  assert.equal(planning.preset, 'claude-code');
  const out = planning.build({ id: 'wf-1', description: 'x' }, '/tmp/wf-1');
  assert.match(out, /opus/i);
});

test('planning prompt delegates smoketest.md authoring to the smoketest stage', () => {
  const dir = '/tmp/wf-smoketest';
  const s = { id: 'wf-smoketest', description: 'Test smoketest phase' };
  const out = planning.build(s, dir);
  assert.doesNotMatch(out, /Author smoketest\.md/);
  assert.doesNotMatch(out, /smoketest\.md/);
  assert.match(out, /<phase> 6/);
  assert.match(out, /6=signal-completion/);
});
