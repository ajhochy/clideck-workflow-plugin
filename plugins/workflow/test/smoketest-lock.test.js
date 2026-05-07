const test = require('node:test');
const assert = require('node:assert/strict');
const { createLock } = require('../lib/smoketest-lock');

test('first acquire resolves immediately, second waits, release lets next through', async () => {
  const lock = createLock();
  const seen = [];
  const r1 = await lock.acquire('wf-1');
  seen.push('1');
  const p2 = lock.acquire('wf-2').then(() => seen.push('2'));
  const p3 = lock.acquire('wf-3').then(() => seen.push('3'));
  // Both p2 and p3 are queued
  assert.deepEqual(seen, ['1']);
  assert.deepEqual(lock.queue(), ['wf-2', 'wf-3']);
  r1.release();
  await p2;
  assert.deepEqual(seen, ['1', '2']);
});

test('cancel removes a waiter from the queue', async () => {
  const lock = createLock();
  const r1 = await lock.acquire('a');
  const p2 = lock.acquire('b');
  lock.cancel('b');
  await assert.rejects(p2, /cancell?ed/i);
  assert.deepEqual(lock.queue(), []);
  r1.release();
});
