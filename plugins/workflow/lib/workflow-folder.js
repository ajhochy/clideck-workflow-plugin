const { mkdirSync, readdirSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const state = require('./state');

function newWorkflowId() {
  const d = new Date();
  const date = d.toISOString().slice(0, 10);
  const rand = Math.random().toString(36).slice(2, 8);
  return `wf-${date}-${rand}`;
}

function initFolder(root, id) {
  const dir = join(root, id);
  mkdirSync(join(dir, 'done'), { recursive: true });
  mkdirSync(join(dir, 'logs'), { recursive: true });
  return dir;
}

function listMarkers(dir) {
  const doneDir = join(dir, 'done');
  if (!existsSync(doneDir)) return [];
  return readdirSync(doneDir)
    .filter((f) => f.endsWith('.done'))
    .map((f) => f.slice(0, -'.done'.length));
}

function listWorkflows(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((id) => state.exists(join(root, id)));
}

module.exports = { newWorkflowId, initFolder, listMarkers, listWorkflows };
