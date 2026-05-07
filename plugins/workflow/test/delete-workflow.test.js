const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const state = require('../lib/state');
const { initFolder } = require('../lib/workflow-folder');
const plugin = require('../index');

function makeApi(pluginDir) {
  const handlers = new Map();
  const sent = [];
  const logs = [];
  const closedSessions = [];
  return {
    pluginDir,
    handlers,
    sent,
    logs,
    closedSessions,
    log: (m) => logs.push(m),
    sendToFrontend: (event, data) => sent.push({ event, data }),
    onFrontendMessage: (event, fn) => handlers.set(event, fn),
    onSessionOutput: () => {},
    onShutdown: () => {},
    closeSession: (sid) => { closedSessions.push(sid); },
    createSession: () => 'sid',
    inputToSession: () => {},
    getSetting: () => undefined,
  };
}

test('delete handler removes workflow folder, drops ctx entry, and broadcasts list', () => {
  const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfdel-plugin-'));
  const root = path.join(pluginDir, 'workflows');
  fs.mkdirSync(root, { recursive: true });

  const id = 'wf-del-test';
  const dir = initFolder(root, id);
  const s = state.createState({ id, title: 't', description: 'd', projectId: 'p1', branch: 'feat/x' });
  state.write(dir, s);

  const api = makeApi(pluginDir);
  plugin.init(api);

  // Seed inFlightBranches so we can assert removal.
  const ctx = api._workflowCtx;
  ctx.inFlightBranches.set('p1', new Set(['feat/x']));
  ctx.workflows.set(id, { dir, runner: { stop: () => {} }, activeSession: 'sid-1' });

  const handler = api.handlers.get('delete');
  assert.ok(handler, 'delete handler must be registered');

  handler({ id });

  assert.equal(ctx.workflows.has(id), false, 'ctx.workflows entry removed');
  assert.equal(fs.existsSync(dir), false, 'workflow folder removed');
  assert.equal(ctx.inFlightBranches.has('p1'), false, 'projectId entry removed when set empties');
  assert.deepEqual(api.closedSessions, ['sid-1'], 'active session was closed');
  const listMsg = api.sent.find((m) => m.event === 'list');
  assert.ok(listMsg, 'list broadcast sent after delete');
  assert.ok(api.logs.some((l) => /Deleted workflow/.test(l)), 'log entry recorded');

  fs.rmSync(pluginDir, { recursive: true, force: true });
});

test('delete handler tolerates missing workflow folder', () => {
  const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfdel-plugin-'));
  fs.mkdirSync(path.join(pluginDir, 'workflows'), { recursive: true });
  const api = makeApi(pluginDir);
  plugin.init(api);
  const handler = api.handlers.get('delete');
  // Unknown id: should warn, not throw.
  assert.doesNotThrow(() => handler({ id: 'does-not-exist' }));
  const warn = api.sent.find((m) => m.event === 'warn');
  assert.ok(warn, 'warn message sent for unknown id');
  fs.rmSync(pluginDir, { recursive: true, force: true });
});
