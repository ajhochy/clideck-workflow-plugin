const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);

const TERMINAL_FAIL = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const TERMINAL_PASS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const PENDING = new Set(['IN_PROGRESS', 'PENDING', 'QUEUED', 'WAITING', 'REQUESTED']);

async function fetchChecks(prNumber, repo) {
  const { stdout } = await exec('gh', [
    'pr', 'checks', String(prNumber),
    '--repo', repo,
    '--json', 'state,name,conclusion,link,workflow',
  ]);
  return JSON.parse(stdout);
}

function summarize(checks) {
  if (!Array.isArray(checks) || checks.length === 0) return { state: 'no-checks' };
  const norm = checks.map((c) => (c.conclusion || c.state || '').toUpperCase());
  if (norm.some((s) => PENDING.has(s) || s === '')) return { state: 'pending' };
  const failed = checks.filter((c, i) => TERMINAL_FAIL.has(norm[i]));
  if (failed.length) return { state: 'failed', failed };
  return { state: 'passed' };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function pollPrChecks({ prNumber, repo, intervalMs = 10000, timeoutMs = 30 * 60 * 1000, onPoll = () => {} }) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let summary;
    try {
      const checks = await fetchChecks(prNumber, repo);
      summary = summarize(checks);
    } catch (err) {
      summary = { state: 'no-checks', error: err.message };
    }
    onPoll(summary);
    if (summary.state === 'passed' || summary.state === 'failed') return summary;
    await sleep(intervalMs);
  }
  return { state: 'timeout' };
}

module.exports = { pollPrChecks, fetchChecks, summarize };
