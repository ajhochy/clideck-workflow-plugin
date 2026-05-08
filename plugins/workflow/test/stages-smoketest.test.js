const test = require('node:test');
const assert = require('node:assert/strict');
const smoketest = require('../lib/stages/smoketest');

test('smoketest prompt invokes smoke-test skill, creates checklist, executes it, and writes result', () => {
  const s = { id: 'wf-1', description: 'send email on signup', branch: 'feat/x' };
  const out = smoketest.build(s, '/tmp/wf-1');
  assert.match(out, /smoke-test/);
  assert.match(out, /smoketest\.md/);
  assert.match(out, /creat(e|ing)\/updat(e|ing)/i);
  assert.match(out, /cross-app/i);
  assert.match(out, /evidence/i);
  assert.match(out, /smoketestResult/);
  assert.match(out, /done\/smoketest\.done/);
});

test('smoketest prompt references repo-local skill instead of global codex skill', () => {
  const out = smoketest.build({ id: 'wf-local', description: 'x' }, '/tmp/wf-local');
  assert.match(out, /LOCAL SMOKE-TEST SKILL:/);
  assert.match(out, /skills\/smoke-test\/SKILL\.md/);
  assert.match(out, /repo-local smoke-test skill/);
  assert.match(out, /Do not use the global Codex smoke-test skill/);
});

test('smoketest prompt treats the plan as acceptance baseline and diff as evidence', () => {
  const out = smoketest.build({ id: 'wf-plan', description: 'x' }, '/tmp/wf-plan');
  assert.match(out, /acceptance baseline is state\.plan/);
  assert.match(out, /coherenceRules/);
  assert.match(out, /not the commit list/);
  assert.match(out, /diff vs base as evidence/);
  assert.match(out, /missing work|implementation drift/);
});

test('preset is codex', () => {
  assert.match(smoketest.preset, /codex/i);
});

test('extraArgs contains bypass flag', () => {
  assert.ok(
    smoketest.extraArgs.some(a => a.includes('dangerously-bypass-approvals-and-sandbox')),
    'extraArgs must include --dangerously-bypass-approvals-and-sandbox'
  );
});

test('smoketest prompt creates marker file as final step', () => {
  const s = { id: 'wf-2', description: 'test marker', branch: 'feat/y' };
  const out = smoketest.build(s, '/tmp/wf-2');
  // The marker creation line should appear after smoketestResult
  const resultIdx = out.indexOf('smoketestResult');
  const markerIdx = out.indexOf('smoketest.done');
  assert.ok(markerIdx > resultIdx, 'marker creation must come after smoketestResult');
});
