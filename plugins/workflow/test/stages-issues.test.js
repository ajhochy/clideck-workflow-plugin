const test = require('node:test');
const assert = require('node:assert/strict');
const issues = require('../lib/stages/issues');

test('issues prompt requires gh repo detection and falls back to local TODO list', () => {
  const s = { id: 'wf-1', description: 'x', projectId: 'p', branch: 'feat/x', plan: { steps: [{ title: 'A' }] } };
  const out = issues.build(s, '/tmp/wf-1');
  assert.match(out, /\/tmp\/wf-1\/state\.json/);
  assert.match(out, /gh repo/i);
  assert.match(out, /local TODO/i);
  assert.match(out, /milestone/i);
  assert.match(out, /implementation order/i);
  assert.match(out, /done\/issues\.done/);
});
