const { join } = require('node:path');
const state = require('./lib/state');
const wf = require('./lib/workflow-folder');
const branch = require('./lib/branch');
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

    api.onFrontendMessage('list', () => {
      const ids = wf.listWorkflows(root);
      const list = ids.map((id) => state.read(join(root, id)));
      api.sendToFrontend('list', { workflows: list });
    });

    api.onFrontendMessage('create', (msg) => {
      const { description, title, branch: branchInput, projectId } = msg;
      if (!description || !projectId) {
        api.sendToFrontend('warn', { message: 'Description and project are required.' });
        return;
      }
      const inFlight = ctx.inFlightBranches.get(projectId) || new Set();
      const finalTitle = (title && title.trim()) || description.split('\n')[0].slice(0, 80);
      let finalBranch = branchInput && branchInput !== 'auto' ? branchInput : branch.slugFromTitle(finalTitle);
      if (branch.isCollision(finalBranch, inFlight)) {
        api.sendToFrontend('warn', {
          message: `Branch "${finalBranch}" is already in use by another in-flight workflow on this project. Pick a different name.`,
        });
        return;
      }
      const id = wf.newWorkflowId();
      const dir = wf.initFolder(root, id);
      const s = state.createState({
        id,
        title: finalTitle,
        description,
        projectId,
        branch: finalBranch,
        branchSource: branchInput && branchInput !== 'auto' ? 'user' : 'auto',
      });
      state.write(dir, s);
      inFlight.add(finalBranch);
      ctx.inFlightBranches.set(projectId, inFlight);
      ctx.workflows.set(id, { dir });
      api.sendToFrontend('created', { id });
      api.log(`Created workflow ${id} on branch ${finalBranch}`);
    });

    api.onShutdown(() => api.log('Workflow plugin shutting down'));
  },
};
