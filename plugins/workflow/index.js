const { join } = require('node:path');
const state = require('./lib/state');
const wf = require('./lib/workflow-folder');
const { createLock } = require('./lib/smoketest-lock');

module.exports = {
  init(api) {
    const root = join(api.pluginDir, 'workflows');
    require('node:fs').mkdirSync(root, { recursive: true });

    const ctx = {
      api,
      root,
      smoketestLock: createLock(),
      workflows: new Map(),     // id → { dir, runner }
      inFlightBranches: new Map(), // projectId → Set<branch>
    };
    api._workflowCtx = ctx; // for tests
    api.log('Workflow plugin initialized');

    // Frontend handlers stubbed — wired in Phase 2
    api.onFrontendMessage('list', () => {
      const ids = wf.listWorkflows(root);
      const list = ids.map((id) => state.read(join(root, id)));
      api.sendToFrontend('list', list);
    });

    api.onShutdown(() => api.log('Workflow plugin shutting down'));
  },
};
