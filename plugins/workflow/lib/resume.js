const { join } = require('node:path');
const state = require('./state');
const wf = require('./workflow-folder');

function findResumable(root) {
  return wf.listWorkflows(root)
    .map((id) => state.read(join(root, id)))
    .filter((s) => s.currentStage !== 'done' && s.currentStage !== 'failed');
}

module.exports = { findResumable };
