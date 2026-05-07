'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createLogger } = require('../lib/logger');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wf-logger-'));
}

// ── (a) event() ──────────────────────────────────────────────────────────────

test('event() appends a parseable JSON line to {stage}.log and events.log', () => {
  const dir = mkTmpDir();
  try {
    const logger = createLogger({ dir, stage: 'planning' });
    logger.event('task_start', { taskId: 'T1' });

    for (const filename of ['planning.log', 'events.log']) {
      const filePath = path.join(dir, 'logs', filename);
      assert.ok(fs.existsSync(filePath), `${filename} should exist`);
      const raw = fs.readFileSync(filePath, 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      assert.ok(lines.length > 0, `${filename} should have at least one line`);
      const parsed = JSON.parse(lines[lines.length - 1]);
      assert.ok(parsed.ts, 'line must have ts');
      assert.equal(parsed.stage, 'planning', 'line must have stage');
      assert.equal(parsed.type, 'task_start', 'line must have type');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── (b) prompt() ─────────────────────────────────────────────────────────────

test('prompt() writes a plain-text section containing header and text body to {stage}.prompt.log', () => {
  const dir = mkTmpDir();
  try {
    const logger = createLogger({ dir, stage: 'issues' });
    const target = 'claude-opus-4';
    const text = 'Please fix the bug in main.js';
    logger.prompt(target, text);

    const promptFile = path.join(dir, 'logs', 'issues.prompt.log');
    assert.ok(fs.existsSync(promptFile), 'prompt.log should exist');
    const content = fs.readFileSync(promptFile, 'utf8');

    // Header must contain the target and an ISO timestamp
    assert.ok(content.includes(target), 'header must include target string');
    // ISO timestamp pattern: YYYY-MM-DDTHH:mm:ss
    assert.match(content, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, 'header must include ISO timestamp');
    // Full text body must be present
    assert.ok(content.includes(text), 'content must include the prompt text');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── (c) error() ──────────────────────────────────────────────────────────────

test('error() writes to errors.log with stack field and is parseable JSON', () => {
  const dir = mkTmpDir();
  try {
    const logger = createLogger({ dir, stage: 'smoketest' });
    const err = new Error('something broke');
    logger.error(err);

    const errFile = path.join(dir, 'logs', 'errors.log');
    assert.ok(fs.existsSync(errFile), 'errors.log should exist');
    const raw = fs.readFileSync(errFile, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    assert.ok(lines.length > 0, 'errors.log should have at least one line');
    const parsed = JSON.parse(lines[lines.length - 1]);
    assert.ok(parsed.ts, 'error line must have ts');
    assert.equal(parsed.type, 'error', 'error line must have type=error');
    assert.ok(parsed.stack, 'error line must include stack field');
    assert.ok(parsed.message, 'error line must include message field');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── (d) openSessionStream() ──────────────────────────────────────────────────

test('openSessionStream() onData appends string and Buffer chunks in order; close() writes footer; close() twice does not duplicate footer', () => {
  const dir = mkTmpDir();
  try {
    const logger = createLogger({ dir, stage: 'coding' });
    const { onData, close } = logger.openSessionStream('sid-42', 'test-session');

    onData('chunk-one\n');
    onData(Buffer.from('chunk-two\n'));
    onData('chunk-three\n');

    // Close once
    close({ code: 0 });
    // Close twice — must not duplicate footer
    close({ code: 0 });

    const sessionFile = path.join(dir, 'logs', 'coding-session-sid-42.log');
    assert.ok(fs.existsSync(sessionFile), 'session file should exist');
    const content = fs.readFileSync(sessionFile, 'utf8');

    // Chunks must be present and in order
    const posOne = content.indexOf('chunk-one');
    const posTwo = content.indexOf('chunk-two');
    const posThree = content.indexOf('chunk-three');
    assert.ok(posOne >= 0, 'chunk-one must be present');
    assert.ok(posTwo >= 0, 'chunk-two must be present');
    assert.ok(posThree >= 0, 'chunk-three must be present');
    assert.ok(posOne < posTwo, 'chunk-one must come before chunk-two');
    assert.ok(posTwo < posThree, 'chunk-two must come before chunk-three');

    // Footer appears exactly once
    const footerMatches = (content.match(/===== session sid-42 closed/g) || []).length;
    assert.equal(footerMatches, 1, 'footer must appear exactly once');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── (e) auto-creates logs/ directory ─────────────────────────────────────────

test('Logger creates {dir}/logs/ automatically when it does not exist', () => {
  const dir = mkTmpDir();
  // mkTmpDir gives us a fresh dir; logs/ does NOT exist yet
  const logsDir = path.join(dir, 'logs');
  assert.ok(!fs.existsSync(logsDir), 'logs/ must not exist before logger is created');

  try {
    const logger = createLogger({ dir, stage: 'planning' });
    logger.event('probe', {});
    assert.ok(fs.existsSync(logsDir), 'logs/ directory should be created automatically');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
