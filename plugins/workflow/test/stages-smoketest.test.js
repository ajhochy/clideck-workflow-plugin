const test = require('node:test');
const assert = require('node:assert/strict');
const smoketest = require('../lib/stages/smoketest');

test('smoketest prompt instructs codex to generate smoketest.md, execute checklist with cross-app checks, and write result', () => {
  const s = { id: 'wf-1', description: 'send email on signup', branch: 'feat/x' };
  const out = smoketest.build(s, '/tmp/wf-1');
  assert.match(out, /smoketest\.md/);
  assert.match(out, /clickthrough/i);
  assert.match(out, /cross-app/i);
  assert.match(out, /screenshot|evidence/i);
  assert.match(out, /smoketestResult/);
  assert.match(out, /done\/smoketest\.done/);
});

test('preset is codex', () => {
  assert.match(smoketest.preset, /codex/i);
});
