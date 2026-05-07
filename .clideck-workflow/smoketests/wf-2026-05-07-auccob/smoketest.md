# Smoketest Checklist

Workflow: `wf-2026-05-07-auccob`
Branch: `feat/cli-deck-3`
PR: https://github.com/ajhochy/clideck-workflow-plugin/pull/1

## Items

- [x] Dedicated GitHub repo and PR target are correct.
  - What to do: From `/Users/ajhochhalter/Documents/clideck-workflow-plugin`, run `git remote -v`, `git ls-remote plugin`, `gh repo view ajhochy/clideck-workflow-plugin --json nameWithOwner,defaultBranchRef,url`, and `gh pr view 1 --repo ajhochy/clideck-workflow-plugin --json baseRefName,headRefName,url`.
  - What to verify: The `plugin` remote points to `https://github.com/ajhochy/clideck-workflow-plugin.git`, remote refs are returned, the repo default branch is `main`, and PR #1 uses `feat/cli-deck-3` into `main`.
  - Where to verify it: CLI output and GitHub PR URL.
  - ✅ Evidence: `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-auccob/evidence/01-repo-pr.txt`; shows `plugin https://github.com/ajhochy/clideck-workflow-plugin.git`, default branch `main`, and PR #1 `feat/cli-deck-3` -> `main`.

- [x] Logger unit behavior is covered and passing.
  - What to do: Run `node --test plugins/workflow/test/logger.test.js`.
  - What to verify: Logger tests pass, including JSONL events, prompt sections, error logs, session stream logs, append ordering, and creating missing `logs/` directories.
  - Where to verify it: CLI output.
  - ✅ Evidence: `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-auccob/evidence/02-logger-test.txt`; `# pass 5`, `# fail 0`.

- [x] Logger writes the expected files in a real workflow-shaped directory.
  - What to do: Run a Node smoke script that imports `plugins/workflow/lib/logger.js`, creates a logger with `{ dir: <workflowDir>, stage: 'manual-smoke' }`, calls `event`, `prompt`, `error`, `openSessionStream().onData()`, and `close()`, then lists `<workflowDir>/logs`.
  - What to verify: `events.log`, `manual-smoke.log`, `manual-smoke.prompt.log`, `errors.log`, and `manual-smoke-session-manual-session.log` exist and include the expected event, prompt text, error stack/message, raw chunk, and close footer.
  - Where to verify it: `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-auccob/logs`.
  - ✅ Evidence: `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-auccob/evidence/03-logger-smoke.txt`; log files were created and include `smoke_event`, `full prompt body for smoke`, `manual smoke error`, `chunk-one`, `chunk-two`, and a close footer.

- [x] Summary versioning preserves historical files and tolerates gaps.
  - What to do: Run `node --test plugins/workflow/test/summary.test.js`, then run a Node smoke script in a temporary directory that calls `writeSummary` three times, deletes `summary.run2.md`, and checks `nextSummaryFilename`.
  - What to verify: Tests pass; first write creates `summary.md`, second creates `summary.run2.md`, third creates `summary.run3.md`, and after deleting run2 the next name is `summary.run4.md` without overwriting earlier content.
  - Where to verify it: CLI output and temporary directory listing.
  - ✅ Evidence: `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-auccob/evidence/04-summary.txt`; `# pass 6`, and the smoke script reports `nextAfterGap: "summary.run4.md"` with `summaryText: "first\n"`.

- [x] Stage prompt tests verify planning writes and smoketest consumes the canonical checklist.
  - What to do: Run `node --test plugins/workflow/test/stages-planning.test.js plugins/workflow/test/stages-smoketest.test.js`.
  - What to verify: Planning prompt includes the absolute workflow `smoketest.md` path and an authoring phase before marker creation; smoketest prompt says `Load existing smoketest.md` and does not contain the old generation instructions.
  - Where to verify it: CLI output.
  - ✅ Evidence: `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-auccob/evidence/05-planning-smoketest-tests.txt`; `# pass 7`, `# fail 0`.

- [x] Pipeline prompt uses namespaced summary files for PR bodies.
  - What to do: Run `node --test plugins/workflow/test/stages-pipeline.test.js` and inspect the relevant prompt text from `plugins/workflow/lib/stages/pipeline.js`.
  - What to verify: The pipeline prompt instructs writing `.clideck-workflow/summaries/<workflowId>-summary.md`, uses that file for `gh pr edit --body-file`, and also writes the workflow-folder summary through the helper.
  - Where to verify it: CLI output and source snippet.
  - ✅ Evidence: `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-auccob/evidence/06-pipeline.txt`; `# pass 1`, source lines show `.clideck-workflow/summaries/${s.id}-summary.md`, `writeSummary`, and `gh pr edit <num> --body-file`.

- [x] Runner and plugin entry lifecycle logging tests/inspection pass.
  - What to do: Inspect `plugins/workflow/lib/runner.js` and `plugins/workflow/index.js` for `createLogger`, stage lifecycle event calls, prompt logging, session stream open/close handling, and session-output relay logging. Run the full workflow plugin test command afterward.
  - What to verify: Logger calls are best-effort, runner control flow is unchanged, and session output is mirrored to `{workflowDir}/logs/{stage}-session-{sid}.log` without duplicating writes.
  - Where to verify it: Source snippets and full test output.
  - ✅ Evidence: `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-auccob/evidence/07-runner-index-inspection.txt`; source matches show lifecycle events, best-effort `try` calls, stream open/close, and relay `stream.onData(data)`.

- [x] Full workflow plugin test suite passes.
  - What to do: From `/Users/ajhochhalter/Documents/clideck-workflow-plugin`, run `node --test plugins/workflow/test/*.test.js`.
  - What to verify: All existing and new workflow plugin tests pass.
  - Where to verify it: CLI output.
  - ✅ Evidence: `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-auccob/evidence/08-full-tests.txt`; `# tests 43`, `# pass 43`, `# fail 0`.

- [x] Documentation covers the new behavior.
  - What to do: Inspect `README.md`, `plugins/workflow/README.md` if present, and `plugins/workflow/docs/logging.md`.
  - What to verify: Docs mention the dedicated repo, logger files under `{workflowDir}/logs/`, summary versioning (`summary.md`, `summary.run2.md`, ...), namespaced project summaries, and the planning-to-smoketest handoff.
  - Where to verify it: Repository Markdown files.
  - ✅ Evidence: `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-auccob/evidence/09-docs.txt`; grep output shows dedicated repo, `events.log`, `summary.run2.md`, `.clideck-workflow/summaries/{workflowId}-summary.md`, and `smoketest.md` handoff documentation.
