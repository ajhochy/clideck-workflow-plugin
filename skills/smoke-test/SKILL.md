---
name: smoke-test
description: Create and run lightweight smoke tests for CliDeck workflow plans. Use when validating workflow output, building a smoke-test checklist, or checking whether implemented work satisfies a planning agent's expected behavior. The plan is the acceptance baseline; commits and diffs are evidence.
---

# Smoke Test

## Overview

Create a focused smoke test from the planned expected behavior, then run it and mark each item pass, fail, or blocked with short reasoning. Prefer fast, high-signal checks over broad regression testing.

For CliDeck workflows, the plan is the source of truth. Commits, changed files, issues, and diffs help determine what was actually implemented, but they must not define the acceptance criteria.

## Workflow

1. Scope the acceptance baseline.
   - If `state.json.plan` exists, use `plan.steps` and `plan.coherenceRules` as the primary baseline.
   - Include the original user request from `state.json.description`.
   - Include manual setup requirements from `state.json.manualSetup` when they affect verification.
   - Record the exact scope in the smoke test file.

2. Inspect implementation evidence.
   - Review issues, commits, changed files, and diff vs base to understand what actually changed.
   - Compare the implementation evidence against the plan.
   - Treat missing planned behavior, extra unplanned behavior, or implementation drift as smoke-test risks.
   - Do not create checks only because a commit touched a file; every check should map back to planned or requested behavior unless it guards obvious regression risk.

3. Build `smoketest.md`.
   - Create the file at the user-provided path, or in the repo root as `smoketest.md` if no path is specified.
   - Include only checks that are realistic to run in the current environment.
   - Group checks by `Setup`, `Backend`, `Frontend`, `Cross-app`, and `Known gaps` as applicable.
   - Each runnable check must have a concrete command, UI action, endpoint, or observation target.
   - Use this compact format:

```markdown
# Smoke Test

Scope: <plan/branch/commit range/PR/issues/features>
Date: <date>

## Findings

- <planned behavior and what evidence suggests was implemented>
- <missing work, extra behavior, or drift risk if any>

## Checks

| Area | Check | How to run | Result | Reasoning |
| --- | --- | --- | --- | --- |
| Backend | <planned expected behavior> | `<command>` or `<endpoint>` | Pending | |
| Frontend | <planned expected behavior> | <Browser or Computer Use action path> | Pending | |

## Known Gaps

- <anything not runnable and why>
```

4. Run setup and backend checks first.
   - Install dependencies only when the repo's standard workflow requires it and the environment permits it.
   - Prefer existing commands from package scripts, Makefiles, task files, CI config, README files, or recent commits.
   - Use targeted health endpoints, CLI commands, unit smoke paths, migrations, queues, and logs when they directly support planned behavior.
   - Mark each item `Success`, `Fail`, or `Blocked`, with the key output or reason.

5. Use UI automation only when needed.
   - Use Browser for local web targets when available.
   - Use Computer Use when the check requires operating a local GUI or native app.
   - Start the app through the repo's normal dev command if needed.
   - Do not perform destructive or externally visible actions without confirmation.
   - For checks that can be verified more directly through text output, logs, DOM text, or accessible UI state, record those observations instead.

6. Check cross-app behavior when relevant.
   - If a planned behavior is meant to trigger another app, service, email, mobile workflow, desktop workflow, notification, or background process, verify the receiving side when locally accessible and safe.
   - Use the best available app-specific connector or skill first.
   - If the receiving app or account is unavailable, mark the item `Blocked` and explain what evidence was available.

7. Finish with the updated file and a short summary.
   - Leave `smoketest.md` updated with final results and reasoning.
   - Summarize failures, blocked checks, and likely follow-up bugs.
   - Mention commands run and any servers left running or stopped.

## Quality Bar

- Keep the checklist tight: usually 5-12 checks unless the plan surface is large.
- Prefer end-to-end checks for planned behavior over generic "app loads" checks.
- Include both happy-path and one obvious failure or edge path when the plan or bug fix implies one.
- Do not claim a pass from code inspection alone. Use `Blocked` when execution was not possible.
- Fail or block planned behavior that the diff cannot demonstrate.
- Do not replace the project's real test suite; run existing tests only when they are fast enough to support the smoke test.
