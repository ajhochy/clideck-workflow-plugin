const { join } = require('node:path');
const state = require('./lib/state');
const wf = require('./lib/workflow-folder');
const branch = require('./lib/branch');
const { createLock } = require('./lib/smoketest-lock');
const { createRunner } = require('./lib/runner');
const rhythm = require('./lib/rhythm');
const stages = {
  planning: require('./lib/stages/planning'),
  issues: require('./lib/stages/issues'),
  pipeline: require('./lib/stages/pipeline'),
  smoketest: require('./lib/stages/smoketest'),
};

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

    ctx.rhythmAvailable = false;
    rhythm.probe(api).then((ok) => {
      ctx.rhythmAvailable = ok;
      if (!ok) api.sendToFrontend('banner', { kind: 'warn', message: 'Rhythm MCP unavailable — manual setup will not auto-create tasks.' });
    });

    function listAll() {
      return wf.listWorkflows(root).map((id) => state.read(join(root, id)));
    }

    api.onFrontendMessage('list', () => api.sendToFrontend('list', { workflows: listAll() }));

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
      const runner = createRunner({
        dir,
        api,
        stages,
        onAdvance: () => api.sendToFrontend('list', { workflows: listAll() }),
        lockFor: (stageName, wfId) => stageName === 'smoketest' ? ctx.smoketestLock.acquire(wfId) : null,
      });
      ctx.workflows.set(id, { dir, runner });
      api.sendToFrontend('created', { id });
      api.log(`Created workflow ${id} on branch ${finalBranch}`);
      runner.start();
    });

    api.onShutdown(() => api.log('Workflow plugin shutting down'));
  },
};
