const test = require('node:test');
const assert = require('node:assert/strict');
const pipeline = require('../lib/stages/pipeline');

test('pickNextIssue returns first non-done issue by order', () => {
  const issues = [
    { number: 2, order: 2, status: 'done' },
    { number: 3, order: 3, status: 'pending' },
    { number: 1, order: 1, status: 'done' },
  ];
  assert.equal(pipeline.pickNextIssue(issues).number, 3);
  assert.equal(pipeline.pickNextIssue([{ number: 1, order: 1, status: 'done' }]), null);
});

test('build() returns per-step prompt when an issue is pending; agent does ONE step then exits, no CI watch', () => {
  const s = {
    id: 'wf-test-123', title: 'Demo', description: 'x', projectId: 'p',
    branch: 'feat/x', githubRepo: 'o/r',
    issues: [
      { number: 1, order: 1, title: 'first', body: 'do it', status: 'done' },
      { number: 2, order: 2, title: 'second', body: 'next', status: 'pending' },
    ],
    pr: { number: 42, url: 'https://github.com/o/r/pull/42' },
  };
  const out = pipeline.build(s, '/tmp/wf-test-123');
  assert.match(out, /per-step pipeline worker/i);
  assert.match(out, /EXACTLY ONE plan step/);
  assert.match(out, /order=2/);
  assert.match(out, /worktree/i);
  assert.match(out, /git push plugin feat\/x/);
  assert.match(out, /done\/step\.done/);
  // Runner handles CI — agent must not watch.
  assert.doesNotMatch(out, /gh pr checks .*--watch/);
  // Finalize-only steps must not appear in step prompt.
  assert.doesNotMatch(out, /manualSetup/);
  assert.doesNotMatch(out, /rhythmTask/);
});

test('build() returns finalize prompt when all issues are done', () => {
  const s = {
    id: 'wf-test-123', title: 'Demo', description: 'x', projectId: 'p',
    branch: 'feat/x', githubRepo: 'o/r',
    issues: [
      { number: 1, order: 1, title: 'a', body: 'b', status: 'done' },
      { number: 2, order: 2, title: 'c', body: 'd', status: 'done' },
    ],
    pr: { number: 42 },
  };
  const out = pipeline.build(s, '/tmp/wf-test-123');
  assert.match(out, /pipeline finalizer/i);
  assert.match(out, /manualSetup/);
  assert.match(out, /rhythm/i);
  assert.match(out, /done\/pipeline\.done/);
  assert.ok(out.includes('.clideck-workflow/summaries/'), 'finalize references summaries dir');
  assert.ok(out.includes('wf-test-123-summary.md'), 'finalize references namespaced summary file');
  assert.ok(out.includes(`gh pr edit `), 'finalize updates PR body');
  assert.match(out, /--repo o\/r/);
});

test('fix-needed status injects CI failure context into the step prompt', () => {
  const s = {
    id: 'wf-x', title: 't', branch: 'feat/x', githubRepo: 'o/r',
    issues: [{ number: 5, order: 1, title: 'fix me', body: 'b', status: 'fix-needed', lastCiFailure: { failed: [{ name: 'unit-tests', link: 'https://gh/run/1' }] } }],
  };
  const out = pipeline.build(s, '/tmp/wf-x');
  assert.match(out, /CI FAILED/);
  assert.match(out, /unit-tests/);
});
