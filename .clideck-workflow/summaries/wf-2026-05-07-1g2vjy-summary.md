# UI progress update

Workflow `wf-2026-05-07-1g2vjy` — orchestrated implementation of [#2](https://github.com/ajhochy/clideck-workflow-plugin/issues/2): always-visible progress bars on workflow cards plus a delete-with-confirmation control.

## Description

Two cross-cutting UI features for the workflow plugin:

1. **Always-visible progress bar.** Each running workflow gets a per-stage progress bar on its card, fed by a new `state.stageProgress` field that stage agents write to via a frozen-contract CLI helper. The frontend renders a determinate bar when progress is reported and an indeterminate striped bar otherwise. The bar disappears once the workflow reaches `done` or `failed`.
2. **Delete workflow control.** A red `✕` button in the title row of each card prompts the user with `window.confirm`, then asks the backend to stop the active session, drop the runner, clear the in-flight branch, close relay streams and the state-watcher, and `rm -rf` the workflow folder. All cleanup steps tolerate partial state.

## Issues completed

- #3 — Extend state schema with `stageProgress` field
- #4 — Create progress reporting CLI helper (`bin/report-progress.js`)
- #5 — Instrument planning stage prompt with progress reporting (7 phases)
- #6 — Instrument issues stage prompt with progress reporting (5 phases)
- #7 — Instrument pipeline stage prompt with per-issue progress
- #8 — Instrument smoketest stage prompt with checklist progress
- #9 — Watch `state.json` for changes and rebroadcast `list`
- #10 — Add `delete` backend handler
- #11 — Render always-visible progress bar on workflow cards
- #12 — Render delete button on workflow cards with confirmation
- #13 — Tests for `stageProgress` and the delete handler (7 new, 50/50 pass)
- #14 — Manual verification (deferred to the workflow plugin's own smoketest stage)

## Manual setup needed

None. No new environment variables, secrets, third-party webhooks, DNS, or API keys are introduced. After merging, reload the CliDeck panel (or restart the dev server on `0.0.0.0:4000`) to pick up the new client.js.

## Verification

- `node --test plugins/workflow/test/*.test.js` — 50/50 pass (43 baseline + 7 new in `state-progress.test.js` and `delete-workflow.test.js`).
- `node --check plugins/workflow/client.js` — syntax OK after each frontend edit.
- `node -e "require('./plugins/workflow/index.js')"` — module loads cleanly after each backend edit.

## Coherence rules honored

- **C1** — `stageProgress` shape `{ [stage]: { current, total, label, updatedAt } }` is what the CLI writes and what `client.js` reads.
- **C2** — `report-progress.js <stateDir> <stage> <current> <total> <label>` is used verbatim by all four stage prompts with `path.resolve(__dirname, '..', '..')` as `pluginRoot`.
- **C3** — Phase totals: planning=7, issues=5, pipeline=`s.issues.length`, smoketest=count of `- [ ]` lines (min 1).
- **C4** — Every create/resume registers the workflow in `ctx.workflows`, `ctx.inFlightBranches`, `relayStreams` (per session), and `stateWatchers`. Delete unregisters all four.
- **C5** — Frontend confirms before sending `delete`; backend wraps each cleanup step in try/catch.
- **C6** — All new UI uses inline CSS with the existing palette (bg `#1f2937`, border `#374151`, text `#e5e7eb`, accent `#4f46e5`, danger `#f87171`).
