#!/usr/bin/env node
// Postinstall: point this clone's git at .githooks/. No-op outside a repo
// (e.g. when installed as a published npm package).

const { execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join } = require('node:path');

try {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (!root || !existsSync(join(root, '.githooks'))) process.exit(0);
  const current = (() => {
    try { return execFileSync('git', ['config', '--local', 'core.hooksPath'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { return ''; }
  })();
  if (current === '.githooks') process.exit(0);
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' });
  console.log('[clideck] configured git core.hooksPath = .githooks');
} catch {
  // not a git checkout (e.g. tarball install) — silent no-op
}
