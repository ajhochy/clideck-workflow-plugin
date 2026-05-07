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

test('delete handler removes workflow folder, drops ctx entry, and broadcasts list', async () => {
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

  await new Promise((r) => setTimeout(r, 350));

  assert.equal(ctx.workflows.has(id), false, 'ctx.workflows entry removed');
  assert.equal(fs.existsSync(dir), false, 'workflow folder removed');
  assert.equal(ctx.inFlightBranches.has('p1'), false, 'projectId entry removed when set empties');
  assert.deepEqual(api.closedSessions, ['sid-1'], 'active session was closed');
  const listMsg = api.sent.find((m) => m.event === 'list');
  assert.ok(listMsg, 'list broadcast sent after delete');
  assert.ok(api.logs.some((l) => /Deleted workflow/.test(l)), 'log entry recorded');
  assert.ok(
    api.sent.find((m) => m.event === 'delete-result' && m.data.success === true && m.data.id === id),
    'delete-result success emitted'
  );

  fs.rmSync(pluginDir, { recursive: true, force: true });
});

test('delete handler tolerates missing workflow folder', () => {
  const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfdel-plugin-'));
  fs.mkdirSync(path.join(pluginDir, 'workflows'), { recursive: true });
  const api = makeApi(pluginDir);
  plugin.init(api);
  const handler = api.handlers.get('delete');
  // Unknown id: synchronous delete-result with success:false and unknown-workflow error.
  assert.doesNotThrow(() => handler({ id: 'does-not-exist' }));
  const result = api.sent.find((m) => m.event === 'delete-result');
  assert.ok(result, 'delete-result message emitted synchronously');
  assert.equal(result.data.success, false);
  assert.equal(result.data.id, 'does-not-exist');
  assert.match(result.data.error, /unknown workflow/i);
  fs.rmSync(pluginDir, { recursive: true, force: true });
});

test('delete handler emits delete-result with error when rmSync repeatedly fails', async () => {
  const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfdel-plugin-'));
  const root = path.join(pluginDir, 'workflows');
  fs.mkdirSync(root, { recursive: true });

  const id = 'wf-del-rmfail';
  const dir = initFolder(root, id);
  const s = state.createState({ id, title: 't', description: 'd', projectId: 'p2', branch: 'feat/y' });
  state.write(dir, s);

  const api = makeApi(pluginDir);
  plugin.init(api);
  const ctx = api._workflowCtx;
  ctx.workflows.set(id, { dir, runner: { stop: () => {} }, activeSession: 'sid-2' });

  const realFs = require('node:fs');
  const origRmSync = realFs.rmSync;
  realFs.rmSync = () => { throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); };

  try {
    const handler = api.handlers.get('delete');
    handler({ id });
    await new Promise((r) => setTimeout(r, 350));

    const result = api.sent.find(
      (m) => m.event === 'delete-result' && m.data.id === id && m.data.success === false
    );
    assert.ok(result, 'delete-result with success:false emitted');
    assert.match(result.data.error, /EBUSY|still exists/i);
  } finally {
    realFs.rmSync = origRmSync;
    try { realFs.rmSync(pluginDir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('delete handler does not broadcast list when rm fails', async () => {
  const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfdel-plugin-'));
  const root = path.join(pluginDir, 'workflows');
  fs.mkdirSync(root, { recursive: true });

  const id = 'wf-del-nolist';
  const dir = initFolder(root, id);
  const s = state.createState({ id, title: 't', description: 'd', projectId: 'p3', branch: 'feat/z' });
  state.write(dir, s);

  const api = makeApi(pluginDir);
  plugin.init(api);
  const ctx = api._workflowCtx;
  ctx.workflows.set(id, { dir, runner: { stop: () => {} }, activeSession: 'sid-3' });

  const realFs = require('node:fs');
  const origRmSync = realFs.rmSync;
  realFs.rmSync = () => { throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); };

  try {
    const handler = api.handlers.get('delete');
    handler({ id });
    const snapshotLen = api.sent.length;
    await new Promise((r) => setTimeout(r, 350));

    const post = api.sent.slice(snapshotLen);
    const listAfter = post.find((m) => m.event === 'list');
    assert.equal(listAfter, undefined, 'no list broadcast after rm failure');
  } finally {
    realFs.rmSync = origRmSync;
    try { realFs.rmSync(pluginDir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('delete handler closes session, runner, and watchers even when rm fails', async () => {
  const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfdel-plugin-'));
  const root = path.join(pluginDir, 'workflows');
  fs.mkdirSync(root, { recursive: true });

  const id = 'wf-del-teardown';
  const dir = initFolder(root, id);
  const s = state.createState({ id, title: 't', description: 'd', projectId: 'p4', branch: 'feat/q' });
  state.write(dir, s);

  const api = makeApi(pluginDir);
  plugin.init(api);
  const ctx = api._workflowCtx;

  let runnerStopped = 0;
  ctx.workflows.set(id, {
    dir,
    runner: { stop: () => { runnerStopped++; } },
    activeSession: 'sid-teardown',
  });

  const realFs = require('node:fs');
  const origRmSync = realFs.rmSync;
  realFs.rmSync = () => { throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); };

  try {
    const handler = api.handlers.get('delete');
    handler({ id });

    // Teardown is sync — assert before the await.
    assert.deepEqual(api.closedSessions, ['sid-teardown'], 'active session was closed');
    assert.equal(runnerStopped, 1, 'runner.stop was invoked');
    assert.equal(ctx.workflows.has(id), false, 'ctx.workflows entry removed (watcher map likewise cleared)');

    await new Promise((r) => setTimeout(r, 350));

    // After rm failure, teardown side-effects remain intact.
    assert.deepEqual(api.closedSessions, ['sid-teardown']);
    assert.equal(runnerStopped, 1);
    assert.equal(ctx.workflows.has(id), false);
  } finally {
    realFs.rmSync = origRmSync;
    try { realFs.rmSync(pluginDir, { recursive: true, force: true }); } catch (_) {}
  }
});
