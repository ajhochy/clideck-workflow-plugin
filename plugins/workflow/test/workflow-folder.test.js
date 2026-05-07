const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, existsSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const wf = require('../lib/workflow-folder');

test('newWorkflowId is unique and time-ordered', () => {
  const a = wf.newWorkflowId();
  const b = wf.newWorkflowId();
  assert.notEqual(a, b);
  assert.match(a, /^wf-\d{4}-\d{2}-\d{2}-/);
});

test('initFolder creates state.json, done/, logs/', () => {
  const root = mkdtempSync(join(tmpdir(), 'wfroot-'));
  try {
    const dir = wf.initFolder(root, 'wf-1');
    assert.ok(existsSync(join(dir, 'done')));
    assert.ok(existsSync(join(dir, 'logs')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('listMarkers returns all .done basenames', () => {
  const root = mkdtempSync(join(tmpdir(), 'wfroot-'));
  try {
    const dir = wf.initFolder(root, 'wf-1');
    writeFileSync(join(dir, 'done', 'planning.done'), '');
    writeFileSync(join(dir, 'done', 'issues.done'), '');
    const markers = wf.listMarkers(dir);
    assert.deepEqual(markers.sort(), ['issues', 'planning']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('listWorkflows returns all subfolders that contain state.json', () => {
  const root = mkdtempSync(join(tmpdir(), 'wfroot-'));
  try {
    const state = require('../lib/state');
    const a = wf.initFolder(root, 'wf-1');
    state.write(a, state.createState({ id: 'wf-1', title: 't', description: 'd', projectId: 'p' }));
    const b = wf.initFolder(root, 'wf-2');
    state.write(b, state.createState({ id: 'wf-2', title: 't', description: 'd', projectId: 'p' }));
    require('node:fs').mkdirSync(join(root, 'not-a-workflow'));
    const ids = wf.listWorkflows(root);
    assert.deepEqual(ids.sort(), ['wf-1', 'wf-2']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
