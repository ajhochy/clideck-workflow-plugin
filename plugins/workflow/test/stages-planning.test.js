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

test('planning prompt includes smoketest.md authoring phase before signal completion', () => {
  const { join } = require('node:path');
  const dir = '/tmp/wf-smoketest';
  const s = { id: 'wf-smoketest', description: 'Test smoketest phase' };
  const out = planning.build(s, dir);
  // smoketest.md is mentioned in the prompt
  assert.match(out, /smoketest\.md/);
  // The phase header is present
  assert.match(out, /Author smoketest\.md/);
  // Instructions mention expected result
  assert.match(out, /expected result/);
  // The absolute path to the smoketest file is present
  assert.ok(out.includes(join(dir, 'smoketest.md')), `prompt should contain absolute path ${join(dir, 'smoketest.md')}`);
  // Marker creation (WORKFLOW_STAGE_DONE) appears AFTER the smoketest authoring section
  const smoketestIdx = out.indexOf('Author smoketest.md');
  const doneIdx = out.indexOf('WORKFLOW_STAGE_DONE');
  assert.ok(smoketestIdx !== -1, 'Author smoketest.md should be present');
  assert.ok(doneIdx !== -1, 'WORKFLOW_STAGE_DONE should be present');
  assert.ok(doneIdx > smoketestIdx, 'WORKFLOW_STAGE_DONE must appear after the smoketest authoring section');
});
