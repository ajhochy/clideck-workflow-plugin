const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize } = require('../lib/ci-poller');

test('summarize: empty checks → no-checks', () => {
  assert.deepEqual(summarize([]), { state: 'no-checks' });
});

test('summarize: any pending check → pending', () => {
  const checks = [
    { state: 'IN_PROGRESS', name: 'a' },
    { state: 'COMPLETED', conclusion: 'SUCCESS', name: 'b' },
  ];
  assert.equal(summarize(checks).state, 'pending');
});

test('summarize: all success → passed', () => {
  const checks = [
    { state: 'COMPLETED', conclusion: 'SUCCESS', name: 'a' },
    { state: 'COMPLETED', conclusion: 'SKIPPED', name: 'b' },
  ];
  assert.equal(summarize(checks).state, 'passed');
});

test('summarize: any failure → failed with the failed checks', () => {
  const checks = [
    { state: 'COMPLETED', conclusion: 'SUCCESS', name: 'a' },
    { state: 'COMPLETED', conclusion: 'FAILURE', name: 'b', link: 'http://x' },
  ];
  const r = summarize(checks);
  assert.equal(r.state, 'failed');
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].name, 'b');
});
