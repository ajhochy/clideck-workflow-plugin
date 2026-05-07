const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const state = require('../lib/state');

const CLI = path.resolve(__dirname, '..', 'bin', 'report-progress.js');

function makeStateDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-progress-'));
  const s = state.createState({ id: 'wf-test', title: 't', description: 'd', projectId: 'p' });
  state.write(dir, s);
  return dir;
}

test('createState includes stageProgress: {}', () => {
  const s = state.createState({ id: 'x', title: 't', description: 'd', projectId: 'p' });
  assert.ok(Object.prototype.hasOwnProperty.call(s, 'stageProgress'));
  assert.deepEqual(s.stageProgress, {});
});

test('report-progress.js with valid args mutates state.json[stage]', () => {
  const dir = makeStateDir();
  const r = spawnSync('node', [CLI, dir, 'planning', '3', '7', 'design phase'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const s = state.read(dir);
  assert.equal(s.stageProgress.planning.current, 3);
  assert.equal(s.stageProgress.planning.total, 7);
  assert.equal(s.stageProgress.planning.label, 'design phase');
  assert.match(s.stageProgress.planning.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('report-progress.js with invalid stage exits 2', () => {
  const dir = makeStateDir();
  const r = spawnSync('node', [CLI, dir, 'bogus', '1', '5', 'x'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /invalid stage/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('report-progress.js with current > total exits 2', () => {
  const dir = makeStateDir();
  const r = spawnSync('node', [CLI, dir, 'planning', '99', '7', 'x'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('report-progress.js with total < 1 exits 2', () => {
  const dir = makeStateDir();
  const r = spawnSync('node', [CLI, dir, 'planning', '0', '0', 'x'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});
