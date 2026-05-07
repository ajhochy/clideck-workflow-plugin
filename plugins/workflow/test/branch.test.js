const test = require('node:test');
const assert = require('node:assert/strict');
const branch = require('../lib/branch');

test('slugFromTitle generates feat/<kebab>', () => {
  assert.equal(branch.slugFromTitle('Add Login Throttling'), 'feat/add-login-throttling');
  assert.equal(branch.slugFromTitle('Fix: bug in checkout!'), 'feat/fix-bug-in-checkout');
});

test('slugFromTitle truncates and falls back', () => {
  assert.equal(branch.slugFromTitle(''), 'feat/workflow');
  assert.match(branch.slugFromTitle('a'.repeat(200)), /^feat\/a{1,60}$/);
});

test('isCollision returns true when branch is in inFlight set', () => {
  assert.equal(branch.isCollision('feat/x', new Set(['feat/x'])), true);
  assert.equal(branch.isCollision('feat/y', new Set(['feat/x'])), false);
});
