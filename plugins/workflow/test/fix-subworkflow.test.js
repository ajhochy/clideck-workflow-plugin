const test = require('node:test');
const assert = require('node:assert/strict');
const fixmod = require('../lib/fix-subworkflow');

test('shouldRetry returns false after maxAttempts', () => {
  assert.equal(fixmod.shouldRetry({ fixAttempts: [] }, 2), true);
  assert.equal(fixmod.shouldRetry({ fixAttempts: [{}, {}] }, 2), false);
});

test('buildFixPrompt for Phase-1-abbreviated includes failure list and skips architecture pass', () => {
  const s = { id: 'wf-1', smoketestResult: { failures: [{ item: 'X', actual: 'Y' }] } };
  const out = fixmod.buildFixPrompt(s, '/tmp/wf-1');
  assert.match(out, /skip the full architecture pass/i);
  assert.match(out, /smoketest failures/i);
  assert.match(out, /X/);
});
