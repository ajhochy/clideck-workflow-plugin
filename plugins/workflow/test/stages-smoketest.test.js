const test = require('node:test');
const assert = require('node:assert/strict');
const smoketest = require('../lib/stages/smoketest');

test('smoketest prompt instructs codex to load existing smoketest.md, execute checklist with cross-app checks, and write result', () => {
  const s = { id: 'wf-1', description: 'send email on signup', branch: 'feat/x' };
  const out = smoketest.build(s, '/tmp/wf-1');
  assert.match(out, /smoketest\.md/);
  assert.match(out, /Load existing smoketest\.md/);
  assert.doesNotMatch(out, /Generate smoketest\.md/);
  assert.doesNotMatch(out, /Write a Markdown checklist to/);
  assert.match(out, /clickthrough/i);
  assert.match(out, /cross-app/i);
  assert.match(out, /screenshot|evidence/i);
  assert.match(out, /smoketestResult/);
  assert.match(out, /done\/smoketest\.done/);
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
