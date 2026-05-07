const test = require('node:test');
const assert = require('node:assert/strict');
const summary = require('../lib/summary');

test('summary uses plain language and covers ask, built, manual, verified, broken', () => {
  const s = {
    title: 'Login throttling', description: 'Limit login attempts to 5/min/IP.',
    issues: [{ number: 1, title: 'Add rate limiter' }],
    manualSetup: [{ title: 'Set REDIS_URL', steps: ['Get URL from infra', 'Add to .env'] }],
    rhythmTask: { url: 'https://rhythm.app/t/abc' },
    smoketestResult: { status: 'passed', failures: [] },
  };
  const md = summary.render(s);
  assert.match(md, /What you asked for/i);
  assert.match(md, /What was built/i);
  assert.match(md, /Manual setup/i);
  assert.match(md, /What we verified/i);
  assert.match(md, /Login throttling/);
  assert.match(md, /rhythm\.app/);
});

test('summary surfaces failures clearly when smoketest failed', () => {
  const s = { title: 't', description: 'd', issues: [], manualSetup: [], smoketestResult: { status: 'failed', failures: [{ item: 'Email arrives', actual: 'No email received', suggestedFix: 'Check SMTP creds' }] } };
  const md = summary.render(s);
  assert.match(md, /Still broken/i);
  assert.match(md, /Email arrives/);
  assert.match(md, /Check SMTP creds/);
});
