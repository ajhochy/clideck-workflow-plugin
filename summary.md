## Summary

Fixes the workflow-card Delete button: clicking ✕ + confirming the dialog now reliably removes the card in both idle and active states. The previous implementation swallowed `rmSync` errors and broadcast `list` before confirming removal, so a failed rm produced a silent UI no-op.

## What changed

**Backend (`plugins/workflow/index.js`)**
- New file-local helper `performDeleteRm(dir)` retries `fs.rmSync` up to 3× with a brief backoff between attempts (returns the last `Error` or `null`).
- Refactored `api.onFrontendMessage('delete', …)`:
  - Validates `id`; emits `delete-result {success:false, error:'missing workflow id'}` for missing IDs and `unknown workflow ${id}` for unknown ones (synchronously).
  - Synchronous teardown (session close, runner stop, branch unlock, relayStreams + stateWatchers cleanup, `ctx.workflows.delete`) — each step in its own try/catch; errors collected and logged rather than silently dropped.
  - Defers `rmSync` 250 ms via `setTimeout` to let the just-closed PTY release file handles, then emits `delete-result {id, success, error}` and (on success only) the refreshed `'list'` broadcast.

**Frontend (`plugins/workflow/client.js`)**
- New module-level `pendingDeletes` Map tracks in-flight deletes.
- Delete-button click optimistically greys the row and shows `…`, arms a 5 s safety timeout that surfaces a "Restart CliDeck" toast if the backend never responds, then sends the existing `delete` message.
- New `api.onMessage('delete-result', …)` handler clears the pending state, shows a "Workflow deleted." success toast (the accompanying `'list'` broadcast repaints without the card) or a "Delete failed: …" error toast that restores the row.

**Tests (`plugins/workflow/test/delete-workflow.test.js`)**
- Existing two tests updated to the new `delete-result` contract.
- Three new tests cover: rmSync repeatedly fails → `delete-result {success:false}`; no `'list'` broadcast when rm fails; teardown (session/runner) still runs even when rm fails.
- All 5 tests pass under `node --test`.

## Issues completed

- **T1b** — Add `performDeleteRm` helper inside index.js init scope (commit `157f013`)
- **T1**  — Refactor backend delete handler with retry + result event (commit `fb8c78f`)
- **T2**  — Add frontend delete-result handler + optimistic UI + safety timeout (commit `2c754d1`)
- **T3**  — Update existing tests + add three new test cases (commit `5965098`)
- **T4**  — Sync installed plugin copy + restart (manual; see below)

## Manual setup needed

Plugin code is loaded once at CliDeck server startup. After this PR merges, the user must do both of the following or the fix will appear to do nothing in the running app:

1. **Sync source → installed plugin.** Copy the three modified files from the source repo into the installed plugin directory:
   - `cp plugins/workflow/index.js                  /Users/ajhochhalter/.clideck/plugins/workflow/index.js`
   - `cp plugins/workflow/client.js                 /Users/ajhochhalter/.clideck/plugins/workflow/client.js`
   - `cp plugins/workflow/test/delete-workflow.test.js /Users/ajhochhalter/.clideck/plugins/workflow/test/delete-workflow.test.js`
2. **Restart CliDeck.** Kill the running `node server.js --host 0.0.0.0 --port 4000` process and relaunch it on the same host/port. (Without a restart, the new handler will not be loaded.)
3. **Smoketest.** Create a throwaway workflow, click ✕, confirm the dialog → the card should grey out and disappear within ~300 ms with a "Workflow deleted." toast. Repeat on an active workflow (one with a running stage). Try deleting one of the leftover workflows in `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/` to confirm cleanup works on real on-disk state.

If the team wants this automated, an `npm run sync-plugin` rsync script is the natural follow-up — out of scope for this fix.

## Coherence rules preserved

- Event name is exactly `'delete-result'` on both ends (the loader prefixes it).
- Payload shape is `{ id, success, error }` everywhere.
- Frontend never removes the card directly; removal flows from the backend `'list'` broadcast.
- Handler stays synchronous; deferred work uses `setTimeout`.
- Existing `'delete'` message name and `{ id }` payload are unchanged.
