const test = require('node:test');
const assert = require('node:assert/strict');
const { createPrModule } = require('../lib/pr');

test('openDraftPr uses --draft and parses pr number from URL', async () => {
  const calls = [];
  const runGh = async (args) => { calls.push(args); return 'https://github.com/o/r/pull/12\n'; };
  const pr = createPrModule({ runGh });
  const r = await pr.openDraftPr({ repo: 'o/r', branch: 'feat/x', base: 'main', title: 't', body: 'b' });
  assert.equal(r.number, 12);
  assert.equal(r.draft, true);
  assert.deepEqual(calls[0], ['pr', 'create', '--repo', 'o/r', '--head', 'feat/x', '--base', 'main', '--draft', '--title', 't', '--body', 'b']);
});

test('markReady invokes pr ready', async () => {
  const calls = [];
  const runGh = async (args) => { calls.push(args); return ''; };
  const pr = createPrModule({ runGh });
  await pr.markReady({ repo: 'o/r', number: 12 });
  assert.deepEqual(calls[0], ['pr', 'ready', '12', '--repo', 'o/r']);
});
