# Smoketest: UI Progress Update

Workflow: `wf-2026-05-07-1g2vjy`
Repository: `/Users/ajhochhalter/Documents/clideck-workflow-plugin`
Evidence directory: `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-1g2vjy/evidence`

- [x] State progress CLI writes and validates `stageProgress`.
  - What to do:
    1. Run the workflow plugin state-progress test: `node --test plugins/workflow/test/state-progress.test.js`.
    2. Create a temporary workflow state directory.
    3. Run `node plugins/workflow/bin/report-progress.js <temp-state-dir> planning 3 7 "design phase"`.
    4. Inspect `<temp-state-dir>/state.json`.
    5. Run the CLI with an invalid stage and confirm it exits with status `2`.
  - What to verify:
    - `createState()` includes `stageProgress: {}`.
    - The valid CLI invocation writes `stageProgress.planning.current = 3`, `total = 7`, `label = "design phase"`, and an ISO-like `updatedAt`.
    - Invalid stage validation fails with exit status `2` and a useful stderr message.
  - Where to verify it:
    - Terminal command output.
    - Temporary `state.json` printed in the terminal.
    - Evidence log: `evidence/state-progress-cli.log`.
  - ✅ Result:
    - `node --test plugins/workflow/test/state-progress.test.js` passed all 5 tests.
    - Manual valid CLI run wrote `stageProgress.planning.current = 3`, `total = 7`, `label = "design phase"`, and an ISO timestamp.
    - Manual invalid stage run exited with `status=2` and stderr `report-progress: invalid stage "bogus" ...`.
    - Evidence: `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-1g2vjy/evidence/state-progress-cli.log`.

- [x] Stage prompts include the frozen progress-reporting commands.
  - What to do:
    1. Run the stage prompt tests: `node --test plugins/workflow/test/stages-planning.test.js plugins/workflow/test/stages-issues.test.js plugins/workflow/test/stages-pipeline.test.js plugins/workflow/test/stages-smoketest.test.js`.
    2. Programmatically render each stage prompt from `plugins/workflow/lib/stages/*.js`.
    3. Search the rendered prompts for `report-progress.js`, the exact stage names, and the required totals or checklist counting instructions.
  - What to verify:
    - Planning prompt reports `planning <currentPhaseNumber> 7`.
    - Issues prompt reports `issues <currentStepNumber> 5`.
    - Pipeline prompt initializes and bumps per issue count.
    - Smoketest prompt counts `- [ ]` checklist lines and initializes `smoketest 0 <TOTAL>`.
  - Where to verify it:
    - Terminal command output.
    - Evidence log: `evidence/stage-prompts.log`.
  - ✅ Result:
    - Stage prompt tests passed all 9 tests.
    - Rendered prompt checks passed for planning `7`, issues `5`, pipeline fixed issue total, per-issue bump, and smoketest checklist counting/initialization.
    - Evidence: `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-1g2vjy/evidence/stage-prompts.log`.

- [x] Backend watches state changes and deletes workflows safely.
  - What to do:
    1. Run the delete workflow test: `node --test plugins/workflow/test/delete-workflow.test.js`.
    2. Run the broader workflow test suite with `node --test plugins/workflow/test/*.test.js`.
    3. Inspect the test output for state watcher and delete-handler regressions.
  - What to verify:
    - The delete handler closes the active session, stops the runner, removes the workflow folder, removes the branch from `ctx.inFlightBranches`, drops `ctx.workflows`, and broadcasts an updated `list`.
    - Unknown or partially missing workflow folders are tolerated with a warning rather than a throw.
    - Existing workflow behavior still passes.
  - Where to verify it:
    - Terminal command output.
    - Evidence log: `evidence/backend-tests.log`.
  - ✅ Result:
    - Targeted delete workflow test passed both tests.
    - Full workflow plugin suite passed all 50 tests.
    - Evidence confirms the delete handler removes the workflow folder, drops context, removes in-flight branch state, closes the active session, broadcasts `list`, and warns for unknown IDs.
    - Evidence: `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-1g2vjy/evidence/backend-tests.log`.

- [x] Workflow panel shows progress bars and delete confirmation in the browser.
  - What to do:
    1. Start CliDeck locally with the workflow plugin available on `http://127.0.0.1:4000`.
    2. Seed a temporary workflow under `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/smoketest-progress-ui` with `currentStage: "planning"` and `stageProgress.planning = { current: 3, total: 7, label: "design", updatedAt: "<now>" }`.
    3. Open `http://127.0.0.1:4000` in the browser and open the workflow panel.
    4. Verify the seeded workflow card shows `Stage: planning`, a `3/7 · design` label, an indigo progress bar, a red `✕` delete button, and a chevron.
    5. Click the workflow card to expand it; verify the same progress bar remains visible above the expanded details.
    6. Click the red `✕`, cancel the browser confirmation, and verify the card/folder remain.
    7. Click the red `✕` again, accept the browser confirmation, and verify the card disappears and `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/smoketest-progress-ui` is removed.
  - What to verify:
    - Progress is visible in both collapsed and expanded card states.
    - The displayed progress matches `stageProgress[currentStage]`.
    - Delete uses a browser confirmation and cancel is non-destructive.
    - Confirmed delete removes the UI card and workflow folder.
  - Where to verify it:
    - Browser URL: `http://127.0.0.1:4000`.
    - Filesystem path: `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/smoketest-progress-ui`.
    - Screenshot evidence: `evidence/workflow-panel-progress.png`, `evidence/workflow-panel-expanded.png`, `evidence/workflow-panel-delete-confirm.png`, `evidence/workflow-panel-after-delete.png`.
  - ✅ Result:
    - Synced the branch workflow plugin files into the local CliDeck plugin install for this runtime check, then ran a controlled CliDeck server on `http://127.0.0.1:4000`.
    - Seeded `smoketest-progress-ui`; the panel showed `Smoketest Progress UI`, `Stage: planning`, `3/7 · design`, a visible progress bar, chevron, and red `✕` delete button.
    - Expanded the card; the progress label remained visible above expanded details and `Open active session` appeared.
    - Cancelled delete confirmation; card and folder remained.
    - Accepted delete confirmation; card disappeared and `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/smoketest-progress-ui` no longer existed.
    - Evidence: `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-1g2vjy/evidence/workflow-panel-cdp.log`.
    - Screenshots:
      - `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-1g2vjy/evidence/workflow-panel-progress.png`
      - `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-1g2vjy/evidence/workflow-panel-expanded.png`
      - `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-1g2vjy/evidence/workflow-panel-delete-confirm.png`
      - `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-1g2vjy/evidence/workflow-panel-after-delete.png`
