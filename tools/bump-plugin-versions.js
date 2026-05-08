#!/usr/bin/env node
// Pre-commit helper: when staged changes modify files under plugins/<id>/ but
// don't touch plugins/<id>/clideck-plugin.json's `version` field, auto-bump the
// patch version and re-stage the manifest. Prevents the "stale installed plugin"
// trap where the loader skips re-copy because manifest versions match.

const { execSync } = require('node:child_process');
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const REPO_ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const PLUGINS_DIR = 'plugins';

function staged() {
  return execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf8', cwd: REPO_ROOT })
    .split('\n').filter(Boolean);
}

function readManifestAt(ref, relPath) {
  try { return JSON.parse(execSync(`git show ${ref}:${relPath}`, { encoding: 'utf8', cwd: REPO_ROOT })); }
  catch { return null; }
}

function readManifestWorkingCopy(absPath) {
  if (!existsSync(absPath)) return null;
  try { return JSON.parse(readFileSync(absPath, 'utf8')); } catch { return null; }
}

// In-place patch the version field so the rest of the file's formatting
// (compact arrays, indent style, trailing newline) is preserved.
function patchVersionInPlace(absPath, nextVersion) {
  const src = readFileSync(absPath, 'utf8');
  const re = /("version"\s*:\s*)"[^"]*"/;
  if (!re.test(src)) return false;
  writeFileSync(absPath, src.replace(re, `$1"${nextVersion}"`));
  return true;
}

function bumpPatch(version) {
  const m = String(version || '').match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (!m) return null;
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}${m[4]}`;
}

function pluginIdFromPath(relPath) {
  const parts = relPath.split('/');
  if (parts[0] !== PLUGINS_DIR || parts.length < 2) return null;
  if (parts.includes('node_modules')) return null;
  return parts[1];
}

function main() {
  const stagedFiles = staged();
  const touched = new Map(); // pluginId → { hasNonManifestChange, manifestStaged }
  for (const f of stagedFiles) {
    const id = pluginIdFromPath(f);
    if (!id) continue;
    const entry = touched.get(id) || { hasNonManifestChange: false, manifestStaged: false };
    if (f === `${PLUGINS_DIR}/${id}/clideck-plugin.json`) entry.manifestStaged = true;
    else entry.hasNonManifestChange = true;
    touched.set(id, entry);
  }

  const bumped = [];
  for (const [id, entry] of touched) {
    if (!entry.hasNonManifestChange) continue;
    const relPath = `${PLUGINS_DIR}/${id}/clideck-plugin.json`;
    const absPath = join(REPO_ROOT, relPath);
    const headManifest = readManifestAt('HEAD', relPath);
    const workingManifest = readManifestWorkingCopy(absPath);
    if (!workingManifest) continue; // new plugin without manifest; skip
    if (!headManifest) continue;    // brand-new plugin being added; skip
    if (workingManifest.version !== headManifest.version) continue; // already bumped
    const next = bumpPatch(headManifest.version);
    if (!next) {
      console.error(`[bump-plugin-versions] cannot parse version "${headManifest.version}" for ${id}`);
      process.exitCode = 1;
      continue;
    }
    if (!patchVersionInPlace(absPath, next)) {
      console.error(`[bump-plugin-versions] could not locate "version" field in ${relPath}`);
      process.exitCode = 1;
      continue;
    }
    execSync(`git add -- ${relPath}`, { cwd: REPO_ROOT });
    bumped.push({ id, from: headManifest.version, to: next });
  }

  if (bumped.length) {
    console.log('[bump-plugin-versions] auto-bumped manifest versions so the plugin-loader will refresh installed copies:');
    for (const b of bumped) console.log(`  - ${b.id}: ${b.from} → ${b.to}`);
  }
}

main();
