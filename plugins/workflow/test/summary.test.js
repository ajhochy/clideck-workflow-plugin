const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
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

test('writeSummary creates summary.md on first call', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'summary-test-'));
  try {
    const result = summary.writeSummary(dir, 'first content');
    assert.equal(result, path.join(dir, 'summary.md'));
    assert.equal(fs.readFileSync(result, 'utf8'), 'first content');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeSummary second call creates summary.run2.md; summary.md is untouched', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'summary-test-'));
  try {
    summary.writeSummary(dir, 'first content');
    const result2 = summary.writeSummary(dir, 'second content');
    assert.equal(result2, path.join(dir, 'summary.run2.md'));
    assert.equal(fs.readFileSync(path.join(dir, 'summary.md'), 'utf8'), 'first content');
    assert.equal(fs.readFileSync(result2, 'utf8'), 'second content');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeSummary third call creates summary.run3.md', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'summary-test-'));
  try {
    summary.writeSummary(dir, 'first content');
    summary.writeSummary(dir, 'second content');
    const result3 = summary.writeSummary(dir, 'third content');
    assert.equal(result3, path.join(dir, 'summary.run3.md'));
    assert.equal(fs.readFileSync(result3, 'utf8'), 'third content');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('nextSummaryFilename returns run4 when run2 is deleted but run3 exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'summary-test-'));
  try {
    summary.writeSummary(dir, 'first content');
    summary.writeSummary(dir, 'second content');
    summary.writeSummary(dir, 'third content');
    fs.unlinkSync(path.join(dir, 'summary.run2.md'));
    const next = summary.nextSummaryFilename(dir);
    assert.equal(next, 'summary.run4.md');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
