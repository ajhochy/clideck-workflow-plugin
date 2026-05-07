# CliDeck Workflow Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CliDeck plugin that turns a plain-language description into a smoketested PR — running Plan (Opus + Haiku), Issues (Sonnet), Pipeline (Sonnet workers in worktrees), and Smoketest (Codex) end-to-end, with bounded fix loop-back and a non-developer summary.

**Architecture:** One CliDeck session per stage, spawned in sequence under the user's project. Inter-stage handoff via a per-workflow `state.json` file plus marker files in a `done/` folder watched by `fs.watch`. A toolbar-anchored panel provides the workflow list, new-workflow form, and per-row stage detail. Codex Stage 4 is gated by a global in-process mutex.

**Tech Stack:** Node.js (CommonJS), CliDeck plugin API (`/Users/ajhochhalter/Documents/clideck/plugin-loader.js`), `node:test` for unit tests, vanilla JS frontend (no framework), `gh` CLI for GitHub, Rhythm App MCP for setup-task creation.

**Reference spec:** `docs/superpowers/specs/2026-05-06-clideck-workflow-plugin-design.md`

---

## File Structure

```
plugins/workflow/
  clideck-plugin.json                 # Manifest
  package.json                        # No deps initially
  index.js                            # Plugin entry — wires modules to api
  client.js                           # Frontend (toolbar button + panel)
  lib/
    state.js                          # state.json read/write/migrate
    workflow-folder.js                # Per-workflow folder utilities
    branch.js                         # Branch resolution + slug generation
    smoketest-lock.js                 # Global mutex for Stage 4
    rhythm.js                         # Rhythm App MCP client
    pr.js                             # GitHub PR open/update via gh CLI
    summary.js                        # summary.md generator
    runner.js                         # Stage runner (watch, spawn, advance)
    stages/
      planning.js                     # Stage 1 starter-prompt builder
      issues.js                       # Stage 2 starter-prompt builder
      pipeline.js                     # Stage 3 starter-prompt builder
      smoketest.js                    # Stage 4 starter-prompt builder
    fix-subworkflow.js                # Failure loop-back
    resume.js                         # Restart-time recovery scan
  test/
    state.test.js
    branch.test.js
    smoketest-lock.test.js
    workflow-folder.test.js
    runner.test.js
    summary.test.js
    fix-subworkflow.test.js
    resume.test.js
```

Each file has a single responsibility. Stage starter-prompt builders are pure functions that take `state.json` and return a string — easy to unit-test. The runner is the only module touching `api.createSession`.

---

## Phase 1 — Plugin scaffold and state model

### Task 1: Create the plugin manifest

**Files:**
- Create: `plugins/workflow/clideck-plugin.json`

- [ ] **Step 1: Write the manifest**

```json
{
  "id": "workflow",
  "name": "Workflow",
  "version": "0.1.0",
  "author": "CliDeck",
  "description": "Turn a plain-language description into a smoketested PR via planning, issue creation, sequential implementation, and Codex smoketesting.",
  "install": "npm",
  "icon": "<svg class=\"w-4 h-4\" fill=\"none\" viewBox=\"0 0 24 24\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z\"/><path d=\"M10 7h4M7 10v4M17 10v4M10 17h4\"/></svg>",
  "settings": [
    { "key": "maxFixAttempts", "label": "Max fix attempts after smoketest failure", "type": "number", "default": 2, "min": 0, "max": 5 },
    { "key": "rhythmEnabled", "label": "Create Rhythm setup tasks", "type": "toggle", "default": true },
    { "key": "defaultBranchStrategy", "label": "Default branch strategy", "type": "select", "default": "auto", "options": [{"value":"auto","label":"Auto-generate from scope"},{"value":"prompt","label":"Always prompt"}] }
  ]
}
```

- [ ] **Step 2: Create empty package.json**

`plugins/workflow/package.json`:
```json
{ "name": "clideck-plugin-workflow", "version": "0.1.0", "private": true }
```

- [ ] **Step 3: Commit**

```bash
git add plugins/workflow/clideck-plugin.json plugins/workflow/package.json
git commit -m "feat(workflow): add plugin manifest scaffold"
```

### Task 2: State module — schema + read/write

**Files:**
- Create: `plugins/workflow/lib/state.js`
- Test: `plugins/workflow/test/state.test.js`

- [ ] **Step 1: Write failing test for default state**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const state = require('../lib/state');

test('createState produces a default object with required fields', () => {
  const s = state.createState({ id: 'wf-1', title: 'Test', description: 'do thing', projectId: 'p1' });
  assert.equal(s.id, 'wf-1');
  assert.equal(s.currentStage, 'planning');
  assert.equal(s.fixAttempts.length, 0);
  assert.ok(s.createdAt);
  assert.equal(s.smoketestResult, null);
});

test('write then read round-trips state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wf-'));
  try {
    const s = state.createState({ id: 'wf-2', title: 't', description: 'd', projectId: 'p' });
    state.write(dir, s);
    const got = state.read(dir);
    assert.deepEqual(got, s);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('update mutates and bumps updatedAt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wf-'));
  try {
    const s = state.createState({ id: 'wf-3', title: 't', description: 'd', projectId: 'p' });
    state.write(dir, s);
    const before = state.read(dir).updatedAt;
    // ensure clock moves
    const after = state.update(dir, (cur) => { cur.currentStage = 'issues'; });
    assert.equal(after.currentStage, 'issues');
    assert.notEqual(after.updatedAt, before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/workflow/test/state.test.js`
Expected: FAIL — `Cannot find module '../lib/state'`

- [ ] **Step 3: Implement `lib/state.js`**

```js
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const STAGES = ['planning', 'issues', 'pipeline', 'smoketest', 'fix', 'done', 'failed'];

function createState({ id, title, description, projectId, githubRepo = null, branch = null, branchSource = 'auto' }) {
  const now = new Date().toISOString();
  return {
    id, title, description, projectId, githubRepo, branch, branchSource,
    currentStage: 'planning',
    plan: null,
    issues: [],
    manualSetup: [],
    rhythmTask: null,
    pr: null,
    smoketestResult: null,
    fixAttempts: [],
    createdAt: now,
    updatedAt: now,
  };
}

function statePath(dir) { return join(dir, 'state.json'); }

function read(dir) {
  return JSON.parse(readFileSync(statePath(dir), 'utf8'));
}

function write(dir, s) {
  writeFileSync(statePath(dir), JSON.stringify(s, null, 2));
}

function update(dir, mutator) {
  const s = read(dir);
  mutator(s);
  s.updatedAt = new Date(Date.now() + 1).toISOString();
  write(dir, s);
  return s;
}

function exists(dir) { return existsSync(statePath(dir)); }

module.exports = { STAGES, createState, read, write, update, exists };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test plugins/workflow/test/state.test.js`
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add plugins/workflow/lib/state.js plugins/workflow/test/state.test.js
git commit -m "feat(workflow): add state.json read/write module"
```

### Task 3: Workflow folder utilities

**Files:**
- Create: `plugins/workflow/lib/workflow-folder.js`
- Test: `plugins/workflow/test/workflow-folder.test.js`

- [ ] **Step 1: Write failing tests**

```js
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
    wf.initFolder(root, 'wf-1');
    wf.initFolder(root, 'wf-2');
    // a stray dir that shouldn't count
    require('node:fs').mkdirSync(join(root, 'not-a-workflow'));
    const ids = wf.listWorkflows(root);
    assert.deepEqual(ids.sort(), ['wf-1', 'wf-2']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/workflow/test/workflow-folder.test.js`
Expected: FAIL

- [ ] **Step 3: Implement `lib/workflow-folder.js`**

```js
const { mkdirSync, writeFileSync, readdirSync, existsSync } = require('node:fs');
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
```

- [ ] **Step 4: Run tests**

Run: `node --test plugins/workflow/test/workflow-folder.test.js`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add plugins/workflow/lib/workflow-folder.js plugins/workflow/test/workflow-folder.test.js
git commit -m "feat(workflow): add workflow folder utilities"
```

### Task 4: Branch resolver

**Files:**
- Create: `plugins/workflow/lib/branch.js`
- Test: `plugins/workflow/test/branch.test.js`

- [ ] **Step 1: Write failing tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const branch = require('../lib/branch');

test('slugFromTitle generates feat/<kebab>', () => {
  assert.equal(branch.slugFromTitle('Add Login Throttling'), 'feat/add-login-throttling');
  assert.equal(branch.slugFromTitle('Fix: bug in checkout!'), 'feat/fix-bug-in-checkout');
});

test('slugFromTitle truncates and falls back', () => {
  assert.equal(branch.slugFromTitle(''), 'feat/workflow');
  assert.match(branch.slugFromTitle('a'.repeat(200)), /^feat\/a{1,60}$/);
});

test('isCollision returns true when branch is in inFlight set', () => {
  assert.equal(branch.isCollision('feat/x', new Set(['feat/x'])), true);
  assert.equal(branch.isCollision('feat/y', new Set(['feat/x'])), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/workflow/test/branch.test.js`
Expected: FAIL

- [ ] **Step 3: Implement `lib/branch.js`**

```js
function slugFromTitle(title) {
  const cleaned = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  if (!cleaned) return 'feat/workflow';
  return `feat/${cleaned}`;
}

function isCollision(name, inFlight) {
  return inFlight.has(name);
}

module.exports = { slugFromTitle, isCollision };
```

- [ ] **Step 4: Run tests**

Run: `node --test plugins/workflow/test/branch.test.js`
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add plugins/workflow/lib/branch.js plugins/workflow/test/branch.test.js
git commit -m "feat(workflow): add branch slug + collision helpers"
```

### Task 5: Smoketest lock (global mutex with FIFO queue)

**Files:**
- Create: `plugins/workflow/lib/smoketest-lock.js`
- Test: `plugins/workflow/test/smoketest-lock.test.js`

- [ ] **Step 1: Write failing tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLock } = require('../lib/smoketest-lock');

test('first acquire resolves immediately, second waits, release lets next through', async () => {
  const lock = createLock();
  const seen = [];
  const r1 = await lock.acquire('wf-1');
  seen.push('1');
  const p2 = lock.acquire('wf-2').then(() => seen.push('2'));
  const p3 = lock.acquire('wf-3').then(() => seen.push('3'));
  // Both p2 and p3 are queued
  assert.deepEqual(seen, ['1']);
  assert.deepEqual(lock.queue(), ['wf-2', 'wf-3']);
  r1.release();
  await p2;
  assert.deepEqual(seen, ['1', '2']);
  // wf-3 still queued until wf-2 releases
  // (acquire returns release fn — but in this test we don't have it; recreate)
});

test('cancel removes a waiter from the queue', async () => {
  const lock = createLock();
  const r1 = await lock.acquire('a');
  const p2 = lock.acquire('b');
  lock.cancel('b');
  await assert.rejects(p2, /cancell?ed/i);
  assert.deepEqual(lock.queue(), []);
  r1.release();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/workflow/test/smoketest-lock.test.js`
Expected: FAIL

- [ ] **Step 3: Implement `lib/smoketest-lock.js`**

```js
function createLock() {
  let held = null; // { id }
  const waiters = []; // { id, resolve, reject }

  function makeRelease(id) {
    return {
      release() {
        if (!held || held.id !== id) return;
        held = null;
        const next = waiters.shift();
        if (next) {
          held = { id: next.id };
          next.resolve(makeRelease(next.id));
        }
      },
    };
  }

  function acquire(id) {
    return new Promise((resolve, reject) => {
      if (!held) {
        held = { id };
        resolve(makeRelease(id));
        return;
      }
      waiters.push({ id, resolve, reject });
    });
  }

  function cancel(id) {
    const idx = waiters.findIndex((w) => w.id === id);
    if (idx >= 0) {
      const [w] = waiters.splice(idx, 1);
      w.reject(new Error('cancelled'));
    }
  }

  function queue() { return waiters.map((w) => w.id); }
  function holder() { return held ? held.id : null; }

  return { acquire, cancel, queue, holder };
}

module.exports = { createLock };
```

- [ ] **Step 4: Run tests**

Run: `node --test plugins/workflow/test/smoketest-lock.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/workflow/lib/smoketest-lock.js plugins/workflow/test/smoketest-lock.test.js
git commit -m "feat(workflow): add global smoketest lock with FIFO queue"
```

### Task 6: Plugin entry point — load modules, register noop hooks

**Files:**
- Create: `plugins/workflow/index.js`

- [ ] **Step 1: Write the entry point**

```js
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
```

- [ ] **Step 2: Restart CliDeck (manual)**

Run: `node server.js` and verify console shows `[plugin:workflow] Workflow plugin initialized` with no errors.

- [ ] **Step 3: Commit**

```bash
git add plugins/workflow/index.js
git commit -m "feat(workflow): add plugin entry point and context bootstrap"
```

---

## Phase 2 — Toolbar UI MVP

### Task 7: Frontend toolbar button + empty panel container

**Files:**
- Create: `plugins/workflow/client.js`

- [ ] **Step 1: Write the client**

```js
(function (api) {
  let panelEl = null;
  let visible = false;

  function ensurePanel() {
    if (panelEl) return panelEl;
    panelEl = document.createElement('div');
    panelEl.className = 'workflow-panel';
    panelEl.style.cssText = 'position:absolute;top:48px;right:12px;width:380px;max-height:80vh;overflow:auto;background:#1f2937;color:#e5e7eb;border:1px solid #374151;border-radius:8px;padding:12px;display:none;z-index:1000;font-family:ui-sans-serif,system-ui;';
    document.body.appendChild(panelEl);
    return panelEl;
  }

  function render(list) {
    const p = ensurePanel();
    p.innerHTML = '';
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
    header.innerHTML = '<strong>Workflows</strong>';
    const newBtn = document.createElement('button');
    newBtn.textContent = '+ New';
    newBtn.onclick = () => renderForm();
    header.appendChild(newBtn);
    p.appendChild(header);

    if (!list || !list.length) {
      const empty = document.createElement('div');
      empty.style.opacity = '0.7';
      empty.textContent = 'No workflows yet.';
      p.appendChild(empty);
      return;
    }
    for (const w of list) {
      const row = document.createElement('div');
      row.style.cssText = 'border:1px solid #374151;border-radius:6px;padding:8px;margin-bottom:6px;';
      row.innerHTML = `<div><strong>${w.title}</strong></div>
        <div style="font-size:12px;opacity:0.8">${w.projectId} · ${w.branch || '(no branch)'}</div>
        <div style="font-size:12px;margin-top:4px">Stage: ${w.currentStage}</div>`;
      p.appendChild(row);
    }
  }

  function renderForm() {
    const p = ensurePanel();
    p.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <strong>New Workflow</strong>
        <button id="wf-cancel">Cancel</button>
      </div>
      <label>Description</label>
      <textarea id="wf-desc" style="width:100%;height:120px;background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:4px;padding:6px;"></textarea>
      <label>Title (optional)</label>
      <input id="wf-title" style="width:100%;background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:4px;padding:6px;" />
      <label>Branch</label>
      <input id="wf-branch" placeholder="auto" style="width:100%;background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:4px;padding:6px;" />
      <div id="wf-warn" style="color:#fbbf24;font-size:12px;margin-top:4px"></div>
      <button id="wf-start" style="margin-top:8px">Start</button>
    `;
    document.getElementById('wf-cancel').onclick = () => api.send('list');
    document.getElementById('wf-start').onclick = () => {
      api.send('create', {
        description: document.getElementById('wf-desc').value,
        title: document.getElementById('wf-title').value,
        branch: document.getElementById('wf-branch').value || 'auto',
        projectId: api.currentProjectId(),
      });
    };
  }

  function toggle() {
    visible = !visible;
    ensurePanel().style.display = visible ? 'block' : 'none';
    if (visible) api.send('list');
  }

  api.addToolbarButton({
    title: 'Workflow',
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="6" height="6"/><rect x="15" y="3" width="6" height="6"/><rect x="3" y="15" width="6" height="6"/><rect x="15" y="15" width="6" height="6"/></svg>',
    onClick: toggle,
  });

  api.on('list', render);
  api.on('created', () => api.send('list'));
  api.on('warn', ({ message }) => {
    const el = document.getElementById('wf-warn');
    if (el) el.textContent = message;
  });
})(window.clideckPlugin('workflow'));
```

> NOTE: `window.clideckPlugin('workflow')` is the standard CliDeck client-side bridge factory. If the actual API differs in this codebase, mirror the pattern used by `plugins/trim-clip/client.js` and `plugins/voice-input/client.js`.

- [ ] **Step 2: Reload CliDeck and verify toolbar button appears**

Manual: Open the dashboard, click the new toolbar button, see an empty panel with "+ New" and "Workflows" header.

- [ ] **Step 3: Commit**

```bash
git add plugins/workflow/client.js
git commit -m "feat(workflow): add toolbar panel skeleton with list/form views"
```

### Task 8: Backend `create` handler

**Files:**
- Modify: `plugins/workflow/index.js`

- [ ] **Step 1: Add `onFrontendMessage('create', …)` handler**

In `index.js` after the `'list'` handler, add:

```js
const branch = require('./lib/branch');

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
```

- [ ] **Step 2: Manual smoke test**

In the panel: click + New, type a description, leave branch as "auto", click Start. The panel should refresh to the list view and show the new workflow row with stage "planning". Verify `~/.clideck/plugins/workflow/workflows/wf-…/state.json` exists.

- [ ] **Step 3: Commit**

```bash
git add plugins/workflow/index.js
git commit -m "feat(workflow): wire create handler with branch validation"
```

---

## Phase 3 — Stage runner

### Task 9: Marker watcher + stage advance loop

**Files:**
- Create: `plugins/workflow/lib/runner.js`
- Test: `plugins/workflow/test/runner.test.js`

- [ ] **Step 1: Write failing tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const state = require('../lib/state');
const { initFolder } = require('../lib/workflow-folder');
const { createRunner } = require('../lib/runner');

function tick(ms = 50) { return new Promise((r) => setTimeout(r, ms)); }

test('runner advances state when a marker file appears', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wfrt-'));
  try {
    const id = 'wf-1';
    const dir = initFolder(root, id);
    state.write(dir, state.createState({ id, title: 't', description: 'd', projectId: 'p', branch: 'feat/x' }));

    const advances = [];
    const fakeApi = { createSession: () => 'sess-1', closeSession: () => {}, log: () => {} };
    const runner = createRunner({ dir, api: fakeApi, stages: {
      planning: { build: () => 'PLAN_PROMPT' },
      issues: { build: () => 'ISSUES_PROMPT' },
    }, onAdvance: (s) => advances.push(s.currentStage) });

    runner.start();
    await tick();
    writeFileSync(join(dir, 'done', 'planning.done'), '');
    await tick(150);
    runner.stop();
    assert.ok(advances.includes('issues'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `node --test plugins/workflow/test/runner.test.js`
Expected: FAIL

- [ ] **Step 3: Implement `lib/runner.js`**

```js
const { watch } = require('node:fs');
const { join } = require('node:path');
const state = require('./state');

const SEQUENCE = ['planning', 'issues', 'pipeline', 'smoketest'];

function nextStage(current) {
  const i = SEQUENCE.indexOf(current);
  if (i < 0 || i === SEQUENCE.length - 1) return 'done';
  return SEQUENCE[i + 1];
}

function createRunner({ dir, api, stages, onAdvance = () => {} }) {
  let watcher = null;
  let currentSession = null;

  function spawnCurrentStage() {
    const s = state.read(dir);
    if (s.currentStage === 'done' || s.currentStage === 'failed') return;
    const stage = stages[s.currentStage];
    if (!stage) return;
    const prompt = stage.build(s, dir);
    currentSession = api.createSession({
      name: `Workflow ${s.id} · ${s.currentStage}`,
      preset: stage.preset || 'claude-code',
      projectId: s.projectId,
      starterPrompt: prompt,
    });
  }

  function handleMarker(filename) {
    if (!filename || !filename.endsWith('.done')) return;
    const stageDone = filename.slice(0, -'.done'.length);
    const updated = state.update(dir, (cur) => {
      if (cur.currentStage !== stageDone) return; // ignore stale markers
      cur.currentStage = nextStage(cur.currentStage);
    });
    if (currentSession) api.closeSession(currentSession);
    currentSession = null;
    onAdvance(updated);
    if (updated.currentStage !== 'done' && updated.currentStage !== 'failed') {
      spawnCurrentStage();
    }
  }

  function start() {
    watcher = watch(join(dir, 'done'), { persistent: false }, (_evt, fn) => handleMarker(fn));
    spawnCurrentStage();
  }

  function stop() {
    if (watcher) watcher.close();
    watcher = null;
  }

  return { start, stop };
}

module.exports = { createRunner, nextStage, SEQUENCE };
```

- [ ] **Step 4: Run tests**

Run: `node --test plugins/workflow/test/runner.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/workflow/lib/runner.js plugins/workflow/test/runner.test.js
git commit -m "feat(workflow): add stage runner with marker-watch advance"
```

### Task 10: Wire runner into create handler

**Files:**
- Modify: `plugins/workflow/index.js`

- [ ] **Step 1: Add stage registration + runner start**

After the create handler builds `state.json`, instantiate stage modules (stub for now) and start a runner. Replace the end of the `'create'` handler with:

```js
const stages = {
  planning: require('./lib/stages/planning'),
  issues: require('./lib/stages/issues'),
  pipeline: require('./lib/stages/pipeline'),
  smoketest: require('./lib/stages/smoketest'),
};
const { createRunner } = require('./lib/runner');
const runner = createRunner({
  dir,
  api,
  stages,
  onAdvance: (cur) => api.sendToFrontend('list', listAll()),
});
ctx.workflows.set(id, { dir, runner });
runner.start();
api.sendToFrontend('created', { id });
```

Add a `listAll()` helper at the top of `init`:

```js
function listAll() {
  return wf.listWorkflows(root).map((id) => state.read(join(root, id)));
}
```

Replace the `'list'` handler with:

```js
api.onFrontendMessage('list', () => api.sendToFrontend('list', listAll()));
```

Stage modules will be created in Phase 4–7 (placeholder files for now):

```bash
mkdir -p plugins/workflow/lib/stages
for s in planning issues pipeline smoketest; do
  echo "module.exports = { preset: 'claude-code', build: (s) => 'TODO: $s starter prompt for ' + s.id };" > plugins/workflow/lib/stages/$s.js
done
```

- [ ] **Step 2: Manual smoke test**

Restart CliDeck. Create a workflow. Verify (in another terminal) that `state.json` exists and a `Workflow … · planning` session was spawned. Drop a fake marker: `touch ~/.clideck/plugins/workflow/workflows/<id>/done/planning.done` — confirm the panel updates the row's stage to "issues" and a new session spawns.

- [ ] **Step 3: Commit**

```bash
git add plugins/workflow/index.js plugins/workflow/lib/stages
git commit -m "feat(workflow): wire runner to create handler with stage stubs"
```

---

## Phase 4 — Stage 1: Plan (Opus + Haiku)

### Task 11: Planning starter-prompt builder

**Files:**
- Modify: `plugins/workflow/lib/stages/planning.js`
- Test: `plugins/workflow/test/stages-planning.test.js`

- [ ] **Step 1: Write failing test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const planning = require('../lib/stages/planning');

test('planning prompt includes state path, description, and instructs codebase exploration before Q&A', () => {
  const s = { id: 'wf-1', description: 'Add login throttling', projectId: 'p', branch: 'feat/x' };
  const out = planning.build(s, '/tmp/wf-1');
  assert.match(out, /\/tmp\/wf-1\/state\.json/);
  assert.match(out, /Add login throttling/);
  assert.match(out, /Haiku/i);
  assert.match(out, /explore the codebase/i);
  assert.match(out, /clarifying questions/i);
  assert.match(out, /atomic step/i);
  assert.match(out, /WORKFLOW_STAGE_DONE/);
  assert.match(out, /done\/planning\.done/);
});

test('planning preset is opus claude-code', () => {
  assert.match(planning.preset, /opus/i);
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `node --test plugins/workflow/test/stages-planning.test.js`
Expected: FAIL

- [ ] **Step 3: Replace `lib/stages/planning.js`**

```js
const { join } = require('node:path');

function build(s, dir) {
  return `You are the planning lead for CliDeck Workflow ${s.id}.

Your job has 6 phases — execute them in order. Do NOT skip phases.

CONTEXT FILE: ${join(dir, 'state.json')}
Read it first. The user's description is the \`description\` field. Project root is whatever directory the session is running in.

PHASE 1 — Explore the codebase.
Dispatch Haiku subagents (use the Explore subagent or feature-dev:code-explorer skill) to thoroughly map:
- Architecture, conventions, file structure
- The specific files/modules relevant to "${s.description.slice(0, 200)}"
- Existing patterns the work must conform to
Wait for all subagents to return before continuing.

PHASE 2 — Ask the user clarifying questions.
Now that you understand the codebase, ask clarifying questions about scope and desired outcome. Ask one or two at a time. Continue until you are confident you understand what success looks like. The user may answer in this terminal or via the workflow panel; both pipe in here.

PHASE 3 — Design the architecture.
Without further user feedback, design the architecture that aligns most closely with the existing codebase. Do not ask the user about architecture choices.

PHASE 4 — Write the plan.
Produce a detailed plan as atomic steps. Each step MUST contain:
- File paths to create or modify (with line ranges where relevant)
- Function/symbol names involved
- Expected behavior
- Dependencies on prior steps
- Coherence rules across steps (so multiple agents stay consistent)
Each step must be self-contained: an implementing agent should NOT need to re-read the codebase to execute it.

PHASE 5 — Write back to state.json.
Append your plan to \`state.json.plan\` (a structured object: { steps: [...], coherenceRules: [...] }). Use a node script or jq, do not hand-edit blindly.

PHASE 6 — Signal completion.
Print this line to the terminal: WORKFLOW_STAGE_DONE: planning
Then create the marker file: \`touch ${join(dir, 'done', 'planning.done')}\`
Stop.

The original user description:
---
${s.description}
---
`;
}

module.exports = { preset: 'claude-code-opus', build };
```

> NOTE on `preset`: the actual CliDeck preset name for Opus may differ. Verify with `agent-presets.json` in the repo root and adjust. If only one Claude preset exists, set `preset: 'claude-code'` and put the model selection in the prompt.

- [ ] **Step 4: Run tests**

Run: `node --test plugins/workflow/test/stages-planning.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/workflow/lib/stages/planning.js plugins/workflow/test/stages-planning.test.js
git commit -m "feat(workflow): implement planning stage prompt builder"
```

### Task 12: End-to-end manual test of Stage 1

- [ ] **Step 1: Verify exploration skill is callable from a Claude session**

Open a fresh Claude Code session in any project. Run `/feature-dev:code-explorer` (or `Explore`) on a small request. Confirm it works.

- [ ] **Step 2: Run a real Stage 1 workflow**

Restart CliDeck. Create a workflow with a small concrete description (e.g., "Add a `--verbose` flag to `bin/clideck.js` that prints session start/stop events"). Watch the spawned planning session work through the 6 phases. Answer clarifying questions when asked. Verify:
- state.json.plan is populated with structured atomic steps
- `done/planning.done` appears
- The runner advances the panel to "issues"

- [ ] **Step 3: Commit any prompt tweaks**

```bash
git add plugins/workflow/lib/stages/planning.js
git commit -m "fix(workflow): refine planning prompt based on dry run"
```

---

## Phase 5 — Stage 2: Issues (Sonnet)

### Task 13: Issues starter-prompt builder

**Files:**
- Modify: `plugins/workflow/lib/stages/issues.js`
- Test: `plugins/workflow/test/stages-issues.test.js`

- [ ] **Step 1: Write failing test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const issues = require('../lib/stages/issues');

test('issues prompt requires gh repo detection and falls back to local TODO list', () => {
  const s = { id: 'wf-1', description: 'x', projectId: 'p', branch: 'feat/x', plan: { steps: [{ title: 'A' }] } };
  const out = issues.build(s, '/tmp/wf-1');
  assert.match(out, /\/tmp\/wf-1\/state\.json/);
  assert.match(out, /gh repo/i);
  assert.match(out, /local TODO/i);
  assert.match(out, /milestone/i);
  assert.match(out, /implementation order/i);
  assert.match(out, /done\/issues\.done/);
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `node --test plugins/workflow/test/stages-issues.test.js`
Expected: FAIL

- [ ] **Step 3: Replace `lib/stages/issues.js`**

```js
const { join } = require('node:path');

function build(s, dir) {
  return `You are the issue-creation agent for CliDeck Workflow ${s.id}.

CONTEXT FILE: ${join(dir, 'state.json')}
Read it. You will use the \`plan\` field — its structured atomic steps are your source.

STEP 1 — Detect repository.
Run: \`gh repo view --json nameWithOwner\` (or \`git remote get-url origin\`). If a GitHub repo is detected, set state.json.githubRepo to "<owner>/<name>". Otherwise leave it null and proceed in local-TODO mode.

STEP 2 — Create issues (or local TODOs).
GitHub mode:
- Create one milestone for this workflow titled "${s.title || 'Workflow'} (${s.id})".
- For each atomic step in plan.steps, create a GitHub issue under that milestone. Title = step title. Body = step body verbatim, including file paths, function names, expected behavior, dependencies, coherence-rule references.
- Use \`gh issue create --milestone …\`. Capture the issue numbers.

Local mode:
- Build an array of synthetic IDs (T1, T2, …). Body identical to GitHub issue body.

STEP 3 — Suggest implementation order.
Based on dependencies between atomic steps, produce an ordered array. Steps with no deps come first; downstream steps follow. Record dependency edges so Stage 3 can verify.

STEP 4 — Write back to state.json.issues.
Schema:
[
  { "number": 34 | "T1", "title": "...", "order": 1, "dependencies": [], "body": "..." },
  ...
]

STEP 5 — Signal completion.
Print: WORKFLOW_STAGE_DONE: issues
Create marker: touch ${join(dir, 'done', 'issues.done')}
`;
}

module.exports = { preset: 'claude-code', build };
```

- [ ] **Step 4: Run tests**

Run: `node --test plugins/workflow/test/stages-issues.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/workflow/lib/stages/issues.js plugins/workflow/test/stages-issues.test.js
git commit -m "feat(workflow): implement issues stage prompt builder"
```

### Task 14: Manual end-to-end of Stages 1+2

- [ ] **Step 1: Run a workflow on a GitHub-backed repo**

Use a test GitHub repo. Run a workflow. Verify `gh issue list` shows the issues created with the right milestone, that `state.json.issues` is populated with numbers + order, and `issues.done` marker appears.

- [ ] **Step 2: Run a workflow on a non-GitHub folder**

Use a local-only folder. Verify `state.json.githubRepo` is null and `state.json.issues` has synthetic IDs.

---

## Phase 6 — Stage 3: Pipeline (orchestrator + workers + Draft PR + manual setup + Rhythm MCP)

### Task 15: PR module — open Draft PR via gh

**Files:**
- Create: `plugins/workflow/lib/pr.js`
- Test: `plugins/workflow/test/pr.test.js` (mock-based)

- [ ] **Step 1: Write the module with an injected `runGh` for testability**

```js
function createPrModule({ runGh }) {
  async function openDraftPr({ repo, branch, base, title, body }) {
    const args = ['pr', 'create', '--repo', repo, '--head', branch, '--base', base, '--draft', '--title', title, '--body', body];
    const out = await runGh(args);
    const m = out.match(/\/pull\/(\d+)/);
    return { number: m ? Number(m[1]) : null, url: out.trim(), draft: true };
  }
  async function updatePrBody({ repo, number, body }) {
    await runGh(['pr', 'edit', String(number), '--repo', repo, '--body', body]);
  }
  async function markReady({ repo, number }) {
    await runGh(['pr', 'ready', String(number), '--repo', repo]);
  }
  return { openDraftPr, updatePrBody, markReady };
}

module.exports = { createPrModule };
```

- [ ] **Step 2: Test with a mock runGh**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPrModule } = require('../lib/pr');

test('openDraftPr uses --draft and parses pr number from URL', async () => {
  const calls = [];
  const runGh = async (args) => { calls.push(args); return 'https://github.com/o/r/pull/12\n'; };
  const pr = createPrModule({ runGh });
  const r = await pr.openDraftPr({ repo: 'o/r', branch: 'feat/x', base: 'main', title: 't', body: 'b' });
  assert.equal(r.number, 12);
  assert.equal(r.draft, true);
  assert.deepEqual(calls[0], ['pr', 'create', '--repo', 'o/r', '--head', 'feat/x', '--base', 'main', '--draft', '--title', 't', '--body', 'b']);
});

test('markReady invokes pr ready', async () => {
  const calls = [];
  const runGh = async (args) => { calls.push(args); return ''; };
  const pr = createPrModule({ runGh });
  await pr.markReady({ repo: 'o/r', number: 12 });
  assert.deepEqual(calls[0], ['pr', 'ready', '12', '--repo', 'o/r']);
});
```

- [ ] **Step 3: Run tests**

Run: `node --test plugins/workflow/test/pr.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add plugins/workflow/lib/pr.js plugins/workflow/test/pr.test.js
git commit -m "feat(workflow): add PR helper for draft open/update/ready"
```

### Task 16: Rhythm MCP client (with availability probe)

**Files:**
- Create: `plugins/workflow/lib/rhythm.js`

- [ ] **Step 1: Write the module**

```js
async function probe(api) {
  try {
    const res = await api.callMcp('rhythm', 'list-tools', {});
    return Array.isArray(res?.tools);
  } catch { return false; }
}

async function createSetupTask(api, { title, items }) {
  const body = items.map((it, i) => `- [ ] **${i + 1}. ${it.title}**\n${it.steps.map((s) => `   - ${s}`).join('\n')}`).join('\n\n');
  return api.callMcp('rhythm', 'create-task', { title, body });
}

module.exports = { probe, createSetupTask };
```

> NOTE: `api.callMcp` is the assumed bridge; the plugin loader must expose a method that lets a plugin call MCP servers configured in CliDeck. **If this API does not exist yet, surface a TODO in `index.js` to add it (a thin pass-through to whatever module manages MCP connections in CliDeck) and skip the Rhythm call when unavailable** — Stage 3 still completes.

- [ ] **Step 2: Probe at plugin init**

In `index.js`, inside `init`:

```js
const rhythm = require('./lib/rhythm');
ctx.rhythmAvailable = false;
rhythm.probe(api).then((ok) => {
  ctx.rhythmAvailable = ok;
  if (!ok) api.sendToFrontend('banner', { kind: 'warn', message: 'Rhythm MCP unavailable — manual setup will not auto-create tasks.' });
});
```

- [ ] **Step 3: Commit**

```bash
git add plugins/workflow/lib/rhythm.js plugins/workflow/index.js
git commit -m "feat(workflow): add Rhythm MCP client with init-time probe"
```

### Task 17: Pipeline starter-prompt builder

**Files:**
- Modify: `plugins/workflow/lib/stages/pipeline.js`
- Test: `plugins/workflow/test/stages-pipeline.test.js`

- [ ] **Step 1: Write failing test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const pipeline = require('../lib/stages/pipeline');

test('pipeline prompt covers worktree-per-issue, CI watch, draft PR after first commit, manual setup + Rhythm task', () => {
  const s = { id: 'wf-1', description: 'x', projectId: 'p', branch: 'feat/x', githubRepo: 'o/r', issues: [{ number: 1, order: 1, body: 'b' }] };
  const out = pipeline.build(s, '/tmp/wf-1');
  assert.match(out, /worktree/i);
  assert.match(out, /draft pr/i);
  assert.match(out, /first commit/i);
  assert.match(out, /CI/i);
  assert.match(out, /manualSetup/);
  assert.match(out, /rhythm/i);
  assert.match(out, /done\/pipeline\.done/);
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `node --test plugins/workflow/test/stages-pipeline.test.js`
Expected: FAIL

- [ ] **Step 3: Replace `lib/stages/pipeline.js`**

```js
const { join } = require('node:path');

function build(s, dir) {
  return `You are the pipeline orchestrator for CliDeck Workflow ${s.id}.

CONTEXT FILE: ${join(dir, 'state.json')}
Read it. You will use \`issues\`, \`branch\`, \`githubRepo\`.

STEP 1 — Confirm issue order.
Read \`issues\`. Verify topological order against \`dependencies\`. Re-order if needed and write back.

STEP 2 — Branch.
If state.branch does not exist locally, create it from the project's default branch (origin/main or origin/master).
\`git checkout -b ${s.branch || '<state.branch>'} origin/<default-branch>\`
Push the branch.

STEP 3 — Draft PR after first commit.
You will open the Draft PR after the FIRST issue's first commit lands. Do not open it earlier (an empty PR is noise). Title = "${s.title || s.id}". Body = the current contents of summary.md (will be created in Step 6) — for now, a placeholder "Workflow ${s.id} — in progress".
Use \`gh pr create --draft\`. Save number+url to state.pr.

STEP 4 — For each issue, in order:
  a. Create a worktree: \`git worktree add ../wt-${s.id}-<issue-number> <branch>\`
  b. Dispatch a Sonnet sub-agent into that worktree with the issue body as its sole context (atomic step is self-contained per Stage 1's design).
  c. Sub-agent implements, commits with message "feat(<issue-number>): <title>", pushes.
  d. After push, watch CI: \`gh pr checks <pr-number> --watch\`. If CI fails, instruct sub-agent to read the failure logs, fix, commit, push. Bound to 3 retries; if still red, mark issue blocked and stop the pipeline (signals self-heal at the plugin level).
  e. On green: \`gh issue close <issue-number> --comment "Completed in #<pr-number>"\`.
  f. Remove the worktree: \`git worktree remove ../wt-${s.id}-<issue-number>\`.

STEP 5 — Gather manual setup.
After all issues land, scan the diff and the issue bodies for setup that requires a human (API keys, env vars, GitHub Actions secrets, third-party webhooks, DNS, etc.). Write a list to state.manualSetup as:
[ { "title": "Generate Stripe API key", "steps": ["Log into Stripe", "...", "Add to .env as STRIPE_KEY"] }, ... ]

STEP 6 — Create Rhythm task (if available).
The plugin sets state.rhythmAvailable = true|false at init. If available, use the Rhythm MCP tool \`create-task\` with title "Manual setup for Workflow ${s.id}: ${s.title || ''}" and a checklist body built from manualSetup. Save id+url to state.rhythmTask. If unavailable, leave state.rhythmTask null — the plugin shows a banner.

STEP 7 — Update PR body.
Regenerate summary.md (basic version: Description, Issues completed, Manual setup needed). Push it on the branch. Update PR body to the file contents via \`gh pr edit <num> --body-file summary.md\`.

STEP 8 — Signal completion.
Print: WORKFLOW_STAGE_DONE: pipeline
Create marker: touch ${join(dir, 'done', 'pipeline.done')}
`;
}

module.exports = { preset: 'claude-code', build };
```

- [ ] **Step 4: Run tests**

Run: `node --test plugins/workflow/test/stages-pipeline.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/workflow/lib/stages/pipeline.js plugins/workflow/test/stages-pipeline.test.js
git commit -m "feat(workflow): implement pipeline stage prompt builder"
```

### Task 18: End-to-end manual test of Stages 1–3

- [ ] **Step 1: Run on a GitHub-backed test repo with passing CI**

Pick a small change. Verify: branch created, draft PR appears after first commit, each issue lands as its own commit, CI runs and goes green, issues close, manual-setup list appears in state.json, Rhythm task is created (or banner appears if MCP not wired).

- [ ] **Step 2: Run with intentionally broken CI**

Inject a failing test in one issue's atomic step. Verify the sub-agent retries, fails after 3 attempts, the orchestrator stops, the panel shows the failure with suggested next steps, and the workflow does NOT advance to smoketest.

---

## Phase 7 — Stage 4: Smoketest (Codex) + global lock

### Task 19: Smoketest starter-prompt builder

**Files:**
- Modify: `plugins/workflow/lib/stages/smoketest.js`
- Test: `plugins/workflow/test/stages-smoketest.test.js`

- [ ] **Step 1: Write failing test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const smoketest = require('../lib/stages/smoketest');

test('smoketest prompt instructs codex to generate smoketest.md, execute checklist with cross-app checks, and write result', () => {
  const s = { id: 'wf-1', description: 'send email on signup', branch: 'feat/x' };
  const out = smoketest.build(s, '/tmp/wf-1');
  assert.match(out, /smoketest\.md/);
  assert.match(out, /clickthrough/i);
  assert.match(out, /cross-app/i);
  assert.match(out, /screenshot|evidence/i);
  assert.match(out, /smoketestResult/);
  assert.match(out, /done\/smoketest\.done/);
});

test('preset is codex', () => {
  assert.match(smoketest.preset, /codex/i);
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `node --test plugins/workflow/test/stages-smoketest.test.js`
Expected: FAIL

- [ ] **Step 3: Replace `lib/stages/smoketest.js`**

```js
const { join } = require('node:path');

function build(s, dir) {
  return `You are the smoketest agent for CliDeck Workflow ${s.id}. You are Codex with computer-use capability.

CONTEXT FILE: ${join(dir, 'state.json')}
Read it. You will use \`description\`, \`plan\`, \`issues\`, \`manualSetup\`, and the diff vs the base branch.

STEP 1 — Generate smoketest.md.
Write a Markdown checklist to ${join(dir, 'smoketest.md')} AND commit it to the branch (\`git add smoketest.md && git commit -m "test: add smoketest checklist" && git push\`).
Each checklist item must include:
- What to do (precise steps)
- What to verify (expected outcome)
- Where to verify it (browser URL, native app name, email inbox, log file, etc.)
Include cross-app checks where the change implies them — e.g., if the feature sends an email, the checklist must verify the email arrived in the user's mail client.

STEP 2 — Execute the checklist via clickthrough.
For each item, drive the appropriate surface:
- Web app: open browser, navigate, click, fill forms
- Native desktop app: open and interact via accessibility
- Email/messaging client: verify message arrival
- CLI/HTTP: run the command or curl, inspect output
Capture evidence per item (screenshot file path, log snippet, command output). Annotate smoketest.md inline with ✅ / ❌ + evidence under each item. Re-commit smoketest.md after each item lands.

STEP 3 — Write the overall result.
Write state.smoketestResult = {
  status: "passed" | "failed",
  failures: [
    { item: "...", expected: "...", actual: "...", evidence: "...", suggestedFix: "..." }
  ]
}

STEP 4 — Signal completion.
Print: WORKFLOW_STAGE_DONE: smoketest
Create marker: touch ${join(dir, 'done', 'smoketest.done')}
`;
}

module.exports = { preset: 'codex', build };
```

- [ ] **Step 4: Run tests**

Run: `node --test plugins/workflow/test/stages-smoketest.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/workflow/lib/stages/smoketest.js plugins/workflow/test/stages-smoketest.test.js
git commit -m "feat(workflow): implement smoketest stage prompt builder"
```

### Task 20: Wire smoketest lock into runner

**Files:**
- Modify: `plugins/workflow/lib/runner.js`
- Modify: `plugins/workflow/index.js`

- [ ] **Step 1: Accept a `lockFor(stageName)` hook in the runner**

Modify `createRunner`:

```js
function createRunner({ dir, api, stages, onAdvance = () => {}, lockFor = null }) {
  // ... existing
  let currentLock = null;

  async function spawnCurrentStage() {
    const s = state.read(dir);
    if (s.currentStage === 'done' || s.currentStage === 'failed') return;
    const stage = stages[s.currentStage];
    if (!stage) return;
    if (lockFor) {
      const lock = lockFor(s.currentStage, s.id);
      if (lock) currentLock = await lock;
    }
    const prompt = stage.build(s, dir);
    currentSession = api.createSession({ /* … */ });
  }

  function handleMarker(filename) {
    /* ... existing ... */
    if (currentLock) { currentLock.release(); currentLock = null; }
    /* spawn next */
  }
}
```

- [ ] **Step 2: Wire lock in `index.js`'s create handler**

Pass to the runner:

```js
const runner = createRunner({
  dir, api, stages, onAdvance,
  lockFor: (stageName, id) => stageName === 'smoketest' ? ctx.smoketestLock.acquire(id) : null,
});
```

When the lock is queued, send a panel update so the row shows "Queued for smoketest":

```js
const queueStatus = ctx.smoketestLock.queue();
api.sendToFrontend('queue', { smoketest: queueStatus, holder: ctx.smoketestLock.holder() });
```

- [ ] **Step 3: Manual test**

Start two workflows on different projects, both reach Stage 4 quickly (use trivial smoketests). Verify only one Codex session runs at a time and the second row shows "Queued for smoketest".

- [ ] **Step 4: Commit**

```bash
git add plugins/workflow/lib/runner.js plugins/workflow/index.js
git commit -m "feat(workflow): serialize Stage 4 with global smoketest lock"
```

---

## Phase 8 — Summary doc + PR ready-for-review flip

### Task 21: Summary generator

**Files:**
- Create: `plugins/workflow/lib/summary.js`
- Test: `plugins/workflow/test/summary.test.js`

- [ ] **Step 1: Write failing test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const summary = require('../lib/summary');

test('summary uses plain language and covers ask, built, manual, verified, broken', () => {
  const s = {
    title: 'Login throttling', description: 'Limit login attempts to 5/min/IP.',
    issues: [{ number: 1, title: 'Add rate limiter' }],
    manualSetup: [{ title: 'Set REDIS_URL', steps: ['Get URL from infra', 'Add to .env'] }],
    rhythmTask: { url: 'https://rhythm.app/t/abc' },
    smoketestResult: { status: 'passed', failures: [] },
  };
  const md = summary.render(s);
  assert.match(md, /What you asked for/i);
  assert.match(md, /What was built/i);
  assert.match(md, /Manual setup/i);
  assert.match(md, /What we verified/i);
  assert.match(md, /Login throttling/);
  assert.match(md, /rhythm\.app/);
});

test('summary surfaces failures clearly when smoketest failed', () => {
  const s = { title: 't', description: 'd', issues: [], manualSetup: [], smoketestResult: { status: 'failed', failures: [{ item: 'Email arrives', actual: 'No email received', suggestedFix: 'Check SMTP creds' }] } };
  const md = summary.render(s);
  assert.match(md, /Still broken/i);
  assert.match(md, /Email arrives/);
  assert.match(md, /Check SMTP creds/);
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `node --test plugins/workflow/test/summary.test.js`
Expected: FAIL

- [ ] **Step 3: Implement `lib/summary.js`**

```js
function render(s) {
  const lines = [];
  lines.push(`# ${s.title}`);
  lines.push('');
  lines.push('## What you asked for');
  lines.push(s.description.trim());
  lines.push('');
  lines.push('## What was built');
  if (s.issues && s.issues.length) {
    for (const i of s.issues) lines.push(`- ${i.title}`);
  } else {
    lines.push('_(nothing yet — workflow stopped early)_');
  }
  lines.push('');
  lines.push('## Manual setup needed');
  if (s.manualSetup && s.manualSetup.length) {
    for (const m of s.manualSetup) {
      lines.push(`- **${m.title}**`);
      for (const step of m.steps || []) lines.push(`  - ${step}`);
    }
    if (s.rhythmTask?.url) lines.push(`\nTracked in Rhythm: ${s.rhythmTask.url}`);
  } else {
    lines.push('_None._');
  }
  lines.push('');
  lines.push('## What we verified');
  if (s.smoketestResult) {
    lines.push(s.smoketestResult.status === 'passed' ? 'All smoketest items passed.' : 'Some smoketest items failed (see below).');
  } else {
    lines.push('_Smoketest did not run._');
  }
  if (s.smoketestResult?.status === 'failed') {
    lines.push('');
    lines.push('## Still broken');
    for (const f of s.smoketestResult.failures || []) {
      lines.push(`- **${f.item}**`);
      if (f.actual) lines.push(`  - What happened: ${f.actual}`);
      if (f.suggestedFix) lines.push(`  - Suggested fix: ${f.suggestedFix}`);
    }
  }
  return lines.join('\n') + '\n';
}

module.exports = { render };
```

- [ ] **Step 4: Run tests**

Run: `node --test plugins/workflow/test/summary.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/workflow/lib/summary.js plugins/workflow/test/summary.test.js
git commit -m "feat(workflow): add plain-language summary generator"
```

### Task 22: Finalize — write summary, update PR body, flip to ready (or leave draft on failure)

**Files:**
- Modify: `plugins/workflow/index.js` (or new `lib/finalize.js`)

- [ ] **Step 1: Add a finalizer triggered when state advances to `done` or `failed`**

In `index.js` extend `onAdvance`:

```js
const summary = require('./lib/summary');
const { writeFileSync } = require('node:fs');
async function onAdvance(s) {
  api.sendToFrontend('list', listAll());
  if (s.currentStage === 'done' || s.currentStage === 'failed') {
    const md = summary.render(s);
    writeFileSync(join(ctx.workflows.get(s.id).dir, 'summary.md'), md);
    if (s.githubRepo && s.pr?.number) {
      const pr = require('./lib/pr').createPrModule({ runGh: api.runGh });
      await pr.updatePrBody({ repo: s.githubRepo, number: s.pr.number, body: md });
      if (s.currentStage === 'done' && s.smoketestResult?.status === 'passed') {
        await pr.markReady({ repo: s.githubRepo, number: s.pr.number });
      }
    }
  }
}
```

> NOTE: if `api.runGh` is not exposed by the CliDeck plugin API, add a small helper at the top of `index.js` using `child_process.execFile`.

- [ ] **Step 2: Manual end-to-end test**

Run a full passing workflow. Verify `summary.md` exists in the workflow folder, the PR body matches, and the PR has flipped from Draft to Ready.

- [ ] **Step 3: Commit**

```bash
git add plugins/workflow/index.js
git commit -m "feat(workflow): finalize workflow with summary doc + PR ready flip"
```

---

## Phase 9 — Failure loop-back (fix sub-workflow)

### Task 23: Fix sub-workflow module

**Files:**
- Create: `plugins/workflow/lib/fix-subworkflow.js`
- Test: `plugins/workflow/test/fix-subworkflow.test.js`

- [ ] **Step 1: Write failing test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fixmod = require('../lib/fix-subworkflow');

test('shouldRetry returns false after maxAttempts', () => {
  assert.equal(fixmod.shouldRetry({ fixAttempts: [] }, 2), true);
  assert.equal(fixmod.shouldRetry({ fixAttempts: [{}, {}] }, 2), false);
});

test('buildFixPrompt for Phase-1-abbreviated includes failure list and skips architecture pass', () => {
  const s = { id: 'wf-1', smoketestResult: { failures: [{ item: 'X', actual: 'Y' }] } };
  const out = fixmod.buildFixPrompt(s, '/tmp/wf-1');
  assert.match(out, /skip the full architecture pass/i);
  assert.match(out, /smoketest failures/i);
  assert.match(out, /X/);
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `node --test plugins/workflow/test/fix-subworkflow.test.js`
Expected: FAIL

- [ ] **Step 3: Implement `lib/fix-subworkflow.js`**

```js
const { join } = require('node:path');

function shouldRetry(s, max) { return (s.fixAttempts?.length || 0) < max; }

function buildFixPrompt(s, dir) {
  const failures = JSON.stringify(s.smoketestResult?.failures || [], null, 2);
  return `You are the fix planner for CliDeck Workflow ${s.id} (fix attempt ${(s.fixAttempts?.length || 0) + 1}).

CONTEXT FILE: ${join(dir, 'state.json')}
SMOKETEST FAILURES TO ADDRESS:
${failures}

This is an abbreviated Stage 1: skip the full architecture pass. Read the failure list, identify root causes (use Haiku exploration if and only if needed for a specific file), and write atomic fix steps to state.plan (replace it). Then drop the fix marker so the runner can re-enter the issues stage.

Print: WORKFLOW_STAGE_DONE: planning
Create marker: touch ${join(dir, 'done', 'planning.done')}
`;
}

function startFixAttempt(dir, state) {
  return state.update(dir, (cur) => {
    cur.fixAttempts.push({ startedAt: new Date().toISOString(), failures: cur.smoketestResult?.failures || [] });
    cur.currentStage = 'planning'; // re-enter
    cur.smoketestResult = null;
    cur.plan = null; // will be rewritten by abbreviated stage 1
    cur.issues = [];
    // markers cleared by caller
  });
}

module.exports = { shouldRetry, buildFixPrompt, startFixAttempt };
```

- [ ] **Step 4: Run tests**

Run: `node --test plugins/workflow/test/fix-subworkflow.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/workflow/lib/fix-subworkflow.js plugins/workflow/test/fix-subworkflow.test.js
git commit -m "feat(workflow): add fix sub-workflow planner module"
```

### Task 24: Wire loop-back into runner advance

**Files:**
- Modify: `plugins/workflow/lib/runner.js`
- Modify: `plugins/workflow/lib/stages/planning.js` (mode-aware)
- Modify: `plugins/workflow/index.js`

- [ ] **Step 1: Make planning prompt mode-aware**

Edit `lib/stages/planning.js` to switch prompt when `s.fixAttempts.length > 0`:

```js
const fixmod = require('../fix-subworkflow');
function build(s, dir) {
  if (s.fixAttempts && s.fixAttempts.length > 0) return fixmod.buildFixPrompt(s, dir);
  return /* original full prompt */;
}
```

- [ ] **Step 2: After smoketest marker, branch on result**

In `runner.js` `handleMarker`, after the marker for `smoketest`:

```js
if (stageDone === 'smoketest') {
  const s = state.read(dir);
  if (s.smoketestResult?.status === 'failed') {
    const max = options.maxFixAttempts ?? 2;
    if (fixmod.shouldRetry(s, max)) {
      // clear markers, restart at abbreviated planning
      for (const m of ['planning', 'issues', 'pipeline', 'smoketest']) {
        try { unlinkSync(join(dir, 'done', `${m}.done`)); } catch {}
      }
      fixmod.startFixAttempt(dir, state);
      onAdvance(state.read(dir));
      spawnCurrentStage();
      return;
    }
    state.update(dir, (cur) => { cur.currentStage = 'failed'; });
    onAdvance(state.read(dir));
    return;
  }
  state.update(dir, (cur) => { cur.currentStage = 'done'; });
  onAdvance(state.read(dir));
  return;
}
```

`maxFixAttempts` is read from settings in `index.js` and passed to the runner.

- [ ] **Step 3: Manual test**

Run a workflow whose smoketest will fail (e.g., the change does not actually do what the description claims). Verify:
- A `fixAttempts[0]` is recorded in state.json
- A new "planning" session spawns with the abbreviated prompt
- After fix lands, smoketest re-runs
- After 2 failed attempts the workflow stops with `currentStage: 'failed'`

- [ ] **Step 4: Commit**

```bash
git add plugins/workflow/lib/runner.js plugins/workflow/lib/stages/planning.js plugins/workflow/index.js
git commit -m "feat(workflow): loop back to abbreviated planning on smoketest failure"
```

### Task 24b: Per-stage self-heal (one re-spawn on non-smoketest failure)

The spec calls for: "If a non-smoketest stage fails, the plugin re-spawns that stage's session once with the failure context appended." This is separate from the smoketest fix loop-back.

**Files:**
- Modify: `plugins/workflow/lib/runner.js`
- Modify: `plugins/workflow/lib/state.js`
- Modify: each stage module (planning, issues, pipeline) to include "if state.stageFailures.<stage> is non-empty, address those failures first" in their prompts
- Test: `plugins/workflow/test/runner.test.js` (add cases)

- [ ] **Step 1: Add `stageFailures` field to default state**

In `lib/state.js` `createState`, add `stageFailures: {}` (object keyed by stage name → array of failure descriptions).

- [ ] **Step 2: Watch for `<stage>.failed` markers in addition to `<stage>.done`**

In `lib/runner.js`, extend `handleMarker`:

```js
function handleMarker(filename) {
  if (!filename) return;
  if (filename.endsWith('.failed')) {
    const stage = filename.slice(0, -'.failed'.length);
    if (stage === 'smoketest') return; // smoketest goes through fix loop-back, not self-heal
    const failureFile = join(dir, 'done', filename);
    let failureText = '';
    try { failureText = require('node:fs').readFileSync(failureFile, 'utf8'); } catch {}
    const s = state.read(dir);
    const prev = s.stageFailures?.[stage] || [];
    if (prev.length >= 1) {
      // Already retried once — give up and surface
      state.update(dir, (cur) => { cur.currentStage = 'failed'; });
      onAdvance(state.read(dir));
      return;
    }
    state.update(dir, (cur) => {
      cur.stageFailures = cur.stageFailures || {};
      cur.stageFailures[stage] = [...(cur.stageFailures[stage] || []), failureText];
    });
    // remove the failed marker so the same one doesn't refire
    try { require('node:fs').unlinkSync(failureFile); } catch {}
    if (currentSession) api.closeSession(currentSession);
    currentSession = null;
    spawnCurrentStage(); // re-enter same stage with failure context
    return;
  }
  if (!filename.endsWith('.done')) return;
  /* existing .done handling */
}
```

- [ ] **Step 3: Update each stage prompt builder to include retry context**

In `planning.js`, `issues.js`, `pipeline.js`, prepend (when present):

```js
const retryContext = (s.stageFailures?.[stageName]?.length)
  ? `\nPRIOR ATTEMPT FAILED — address these failures before continuing:\n${s.stageFailures[stageName].join('\n---\n')}\n`
  : '';
```

Insert `${retryContext}` right after `CONTEXT FILE:` line in each.

Also instruct each stage at the bottom: "If you cannot complete this stage successfully (e.g., uncoverable error), write a brief failure description to `done/<stage>.failed` instead of `<stage>.done`."

- [ ] **Step 4: Add runner test for self-heal**

```js
test('runner re-spawns stage once on .failed marker, then gives up on second failure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wfsh-'));
  try {
    const id = 'wf-h';
    const dir = initFolder(root, id);
    state.write(dir, state.createState({ id, title: 't', description: 'd', projectId: 'p', branch: 'feat/x' }));
    const spawns = [];
    const fakeApi = {
      createSession: () => { spawns.push(Date.now()); return 's'; },
      closeSession: () => {}, log: () => {},
    };
    const runner = createRunner({ dir, api: fakeApi, stages: {
      planning: { build: () => 'p' }, issues: { build: () => 'i' },
    }, onAdvance: () => {} });
    runner.start();
    await tick();
    writeFileSync(join(dir, 'done', 'planning.failed'), 'first failure');
    await tick(150);
    assert.equal(spawns.length, 2); // initial + 1 retry
    writeFileSync(join(dir, 'done', 'planning.failed'), 'second failure');
    await tick(150);
    runner.stop();
    assert.equal(state.read(dir).currentStage, 'failed');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 5: Run tests**

Run: `node --test plugins/workflow/test/runner.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plugins/workflow/lib/runner.js plugins/workflow/lib/state.js plugins/workflow/lib/stages/ plugins/workflow/test/runner.test.js
git commit -m "feat(workflow): per-stage self-heal with one re-spawn on failure"
```

---

## Phase 10 — Resume on restart

### Task 25: Resume scan + UI offer

**Files:**
- Create: `plugins/workflow/lib/resume.js`
- Test: `plugins/workflow/test/resume.test.js`
- Modify: `plugins/workflow/index.js`
- Modify: `plugins/workflow/client.js`

- [ ] **Step 1: Write failing test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const state = require('../lib/state');
const { initFolder } = require('../lib/workflow-folder');
const resume = require('../lib/resume');

test('findResumable returns workflows whose currentStage is not done/failed', () => {
  const root = mkdtempSync(join(tmpdir(), 'wfre-'));
  try {
    const a = initFolder(root, 'a');
    state.write(a, { ...state.createState({ id: 'a', title: 't', description: 'd', projectId: 'p' }), currentStage: 'pipeline' });
    const b = initFolder(root, 'b');
    state.write(b, { ...state.createState({ id: 'b', title: 't', description: 'd', projectId: 'p' }), currentStage: 'done' });
    const ids = resume.findResumable(root).map((s) => s.id);
    assert.deepEqual(ids, ['a']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `node --test plugins/workflow/test/resume.test.js`
Expected: FAIL

- [ ] **Step 3: Implement `lib/resume.js`**

```js
const { join } = require('node:path');
const state = require('./state');
const wf = require('./workflow-folder');

function findResumable(root) {
  return wf.listWorkflows(root)
    .map((id) => state.read(join(root, id)))
    .filter((s) => s.currentStage !== 'done' && s.currentStage !== 'failed');
}

module.exports = { findResumable };
```

- [ ] **Step 4: Hook resume scan into plugin init**

In `index.js`, after building `ctx`, scan and emit:

```js
const resume = require('./lib/resume');
const resumables = resume.findResumable(root);
if (resumables.length) {
  api.sendToFrontend('resume-prompt', { workflows: resumables.map((s) => ({ id: s.id, title: s.title, currentStage: s.currentStage })) });
}
api.onFrontendMessage('resume', ({ id }) => {
  const dir = join(root, id);
  const s = state.read(dir);
  // re-register inFlight branch
  const set = ctx.inFlightBranches.get(s.projectId) || new Set();
  if (s.branch) set.add(s.branch);
  ctx.inFlightBranches.set(s.projectId, set);
  const runner = createRunner({ /* same options */ });
  ctx.workflows.set(id, { dir, runner });
  runner.start();
});
```

- [ ] **Step 5: Add UI for resume prompt in `client.js`**

```js
api.on('resume-prompt', ({ workflows }) => {
  if (!workflows.length) return;
  ensurePanel().style.display = 'block';
  visible = true;
  const p = ensurePanel();
  p.innerHTML = '<strong>Resume in-flight workflows?</strong>';
  for (const w of workflows) {
    const row = document.createElement('div');
    row.innerHTML = `<div>${w.title} (stage: ${w.currentStage}) <button data-id="${w.id}">Resume</button></div>`;
    row.querySelector('button').onclick = () => api.send('resume', { id: w.id });
    p.appendChild(row);
  }
});
```

- [ ] **Step 6: Manual test**

Start a workflow, kill CliDeck during pipeline, restart. The resume prompt appears with that workflow listed. Click Resume; verify the runner picks up at the correct stage.

- [ ] **Step 7: Commit**

```bash
git add plugins/workflow/lib/resume.js plugins/workflow/test/resume.test.js plugins/workflow/index.js plugins/workflow/client.js
git commit -m "feat(workflow): scan and resume in-flight workflows on restart"
```

---

## Phase 11 — Polish + docs

### Task 26: Per-row expanded view (stages, sessions, planning chat box)

**Files:**
- Modify: `plugins/workflow/client.js`
- Modify: `plugins/workflow/index.js`

- [ ] **Step 1: Render expandable rows**

When a row is clicked, show:
- Four stages with timestamps (read from `done/<stage>.done` mtime)
- Buttons "Open <stage> session" that send `{ type: 'plugin.workflow.openSession', workflowId, stage }` (backend looks up the stored session id and emits a CliDeck focus event — see how autopilot does this in `plugins/autopilot/client.js`)
- During Planning: a chat input that posts to backend, which calls `api.inputToSession(currentStageSession, text + '\r')`
- During Failure: the last failure summary plus a Retry button

- [ ] **Step 2: Backend support**

In `index.js`, store the active session id when the runner spawns, and add:

```js
api.onFrontendMessage('chat', ({ id, text }) => {
  const sess = ctx.workflows.get(id)?.activeSession;
  if (sess) api.inputToSession(sess, text + '\r');
});
```

- [ ] **Step 3: Manual smoke test**

Click a workflow row, expand it, type a message into the planning chat box, verify it appears in the spawned Claude session terminal.

- [ ] **Step 4: Commit**

```bash
git add plugins/workflow/client.js plugins/workflow/index.js
git commit -m "feat(workflow): expand rows with stages, session links, planning chat box"
```

### Task 27: Same-branch collision prompt (live form validation)

**Files:**
- Modify: `plugins/workflow/index.js`
- Modify: `plugins/workflow/client.js`

- [ ] **Step 1: Validate-as-user-types**

Add a `validate-branch` handler in backend; client calls it on input to the branch field:

```js
api.onFrontendMessage('validate-branch', ({ projectId, branch }) => {
  const set = ctx.inFlightBranches.get(projectId) || new Set();
  api.sendToFrontend('branch-validation', {
    branch,
    inUse: branch && set.has(branch),
  });
});
```

Client subscribes and updates `#wf-warn` accordingly.

- [ ] **Step 2: Manual test**

Start one workflow on `feat/x`. Open new-workflow form on the same project, type `feat/x` — see warning. Type `feat/y` — warning clears.

- [ ] **Step 3: Commit**

```bash
git add plugins/workflow/index.js plugins/workflow/client.js
git commit -m "feat(workflow): live branch-collision validation in new workflow form"
```

### Task 28: Run full test suite

- [ ] **Step 1: Run every plugin test**

```bash
node --test plugins/workflow/test/
```
Expected: all green.

- [ ] **Step 2: Run repo-wide tests**

```bash
node --test test/
```
Expected: all green.

- [ ] **Step 3: Commit any fixes**

If anything is red, fix it. Then:

```bash
git add -p
git commit -m "fix(workflow): test fallout"
```

### Task 29: Bump plugin version + final smoke

**Files:**
- Modify: `plugins/workflow/clideck-plugin.json`

- [ ] **Step 1: Bump version to 1.0.0 in manifest**

- [ ] **Step 2: Full end-to-end test on a real GitHub repo**

Run a complete workflow on a representative repo with passing CI. Verify all expected artifacts: state.json, summary.md, smoketest.md, draft→ready PR, closed issues, Rhythm task (or banner).

- [ ] **Step 3: Commit**

```bash
git add plugins/workflow/clideck-plugin.json
git commit -m "chore(workflow): bump to 1.0.0 after end-to-end verification"
```

---

## Open Items to Resolve During Implementation

These are flagged in the spec; resolve them before or during the relevant phase:

1. **Rhythm App MCP bridge.** Confirm CliDeck exposes a way for plugins to call MCP servers. If `api.callMcp` does not exist, either (a) add a thin pass-through in `plugin-loader.js` (out-of-scope here, but a small change), or (b) skip the Rhythm call and surface manual setup only via banner. Decide in Task 16.
2. **CliDeck preset names** for Opus, Sonnet, Codex. Verify in `agent-presets.json`. Adjust each stage module's `preset` accordingly. If only a single Claude preset exists, encode model selection in the prompt instead.
3. **`api.runGh`** — if not provided by the plugin API, add a local `child_process.execFile` helper in `index.js`.
4. **`addToolbarButton`** — confirm exact API name from `plugins/voice-input/client.js` and `plugins/trim-clip/client.js`. The skeleton in Task 7 uses `api.addToolbarButton`; mirror what those plugins use.
5. **Frontend bridge factory** — `window.clideckPlugin('workflow')` in Task 7 may be different in this codebase. Mirror exactly what the bundled plugins use.
