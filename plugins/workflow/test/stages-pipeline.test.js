const test = require('node:test');
const assert = require('node:assert/strict');
const pipeline = require('../lib/stages/pipeline');

test('pipeline prompt covers worktree-per-issue, CI watch, draft PR after first commit, manual setup + Rhythm task', () => {
  const s = { id: 'wf-test-123', description: 'x', projectId: 'p', branch: 'feat/x', githubRepo: 'o/r', issues: [{ number: 1, order: 1, body: 'b' }] };
  const out = pipeline.build(s, '/tmp/wf-test-123');
  assert.match(out, /worktree/i);
  assert.match(out, /draft pr/i);
  assert.match(out, /first commit/i);
  assert.match(out, /CI/i);
  assert.match(out, /manualSetup/);
  assert.match(out, /rhythm/i);
  assert.match(out, /done\/pipeline\.done/);
  assert.ok(out.includes('.clideck-workflow/summaries/'), 'prompt must reference .clideck-workflow/summaries/ directory');
  assert.ok(out.includes('wf-test-123-summary.md'), 'prompt must reference the namespaced summary file wf-test-123-summary.md');
});
