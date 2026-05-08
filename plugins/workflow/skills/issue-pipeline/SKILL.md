---
name: issue-pipeline
description: Runs a sequential pipeline of agents, one per GitHub issue, all committing to a single shared branch — with smoke tests between each issue and a final manual-setup report. Use this skill whenever the user provides a list of GitHub issue numbers and wants agents to implement them in order on a branch, without creating a new PR or branch per issue. Trigger on phrases like "work through these issues", "run the issue pipeline", "have agents tackle issues X Y Z on branch X", "knock out these issues", "continue work on these issues", or any time the user hands you an ordered list of issues and wants sequential agent implementation. This is the go-to skill for structured multi-issue implementation without branch sprawl.
---

# Issue Pipeline Skill

This skill orchestrates a sequential pipeline of Claude code agents, one per GitHub issue, all working on a single shared branch. Each agent implements its issue, commits, closes it with a summary comment, then passes the baton to the next. Smoke tests gate progress between issues. The pipeline pauses and notifies the user on any failure or when an agent needs clarification.

You (Dispatch) are the orchestrator. This skill tells you exactly how to run that orchestration.

---

## Tool environment

This skill was originally written for Cowork, where it dispatches via `start_code_task`, polls with `read_transcript`, and renders forms via `mcp__cowork__create_artifact`. Outside Cowork those tools are not available.

**If running in plain Claude Code (no Cowork tools):**
- Replace `mcp__cowork__create_artifact` with a plain text prompt to the user listing the fields and asking for confirmation.
- Replace `start_code_task` + `read_transcript` polling with the `Agent` tool (`general-purpose` subagent). The Agent tool is synchronous — when it returns, the agent is done. No polling needed.
- Replace `SendUserMessage` with normal text output.
- Replace `list_sessions` / `send_message` with — they are not needed; Agent calls are blocking and self-contained.
- Worktree cleanup language in step 4c becomes optional: the Agent tool can be called with `isolation: "worktree"` for an auto-cleaned worktree, or the agent can be pointed at the user's main checkout when it is already on the shared branch (often the simpler path — see step 3).

The rest of the skill (ordering, validation, smoke tests, manual-setup collection, final report) applies identically in both environments.

---

## Step 1: Show the pipeline form

Present the user with an interactive form using `mcp__cowork__create_artifact`. The form collects:

| Field | Required | Notes |
|-------|----------|-------|
| Workspace path | Yes | Local repo path — use `list_code_workspaces` to pre-populate a dropdown |
| Branch name | Yes | Existing branch to add work to, or name for a new branch |
| Existing PR number | No | If a PR is already open for this branch, enter its number |
| PR title | Only if new branch | Used when opening the final PR at the end |
| Issues | Yes | Ordered list of GitHub issue numbers (e.g. `19, 20, 21, 22`) |

Wait for the user to confirm the values before proceeding.

**Form artifact HTML example** — build a clean form with labeled inputs, a multi-line issues field, and a "Start Pipeline" button that calls `sendPrompt()` with the confirmed values serialized clearly.

---

## Step 1b: Analyze and propose implementation order

Before validating or touching any code, read all the issues and propose a smart execution order for the user to confirm. This takes a minute but prevents the much worse scenario of an agent hitting a mid-issue blocker because a dependency wasn't implemented yet.

Use `start_code_task` with a short-lived analysis agent:

```
You are analyzing a set of GitHub issues to determine the best implementation order.

Issues to analyze: #[N1], #[N2], #[N3], ...
Repo: [workspace path]

For each issue, run `gh issue view [N]` to read the full description. Then produce a recommended implementation order based on:

1. **Explicit dependencies** — any issue that mentions "requires", "depends on", "blocked by", or references another issue number by # should come after that issue.
2. **Structural dependencies** — infer logical order from the nature of the work:
   - Infrastructure and scaffolding before features that build on it
   - Data models and database layers before API routes that use them
   - Backend API endpoints before frontend screens that call them
   - Authentication/auth middleware before protected routes or screens
   - Shared utilities and components before things that import them
3. **Risk order** — foundational, high-risk issues earlier so problems surface before more work piles on top

Output your recommendation as a numbered list:
1. #[N] — [issue title] — [one sentence explaining why it goes here]
2. #[N] — ...

Then add a "## Dependency notes" section flagging any issues that have hard dependencies on others not in this list (i.e., things that may need to exist in the codebase already).
```

Present the proposed order to the user clearly via `SendUserMessage`. Ask them to confirm or adjust before proceeding. The user's confirmed order is what the pipeline runs — don't assume the original form order is correct.

---

## Step 2: Validate setup

Before dispatching any agents, check:
- The workspace path is a valid local git repo
- The branch exists on origin (if using an existing branch)
- The PR is open and targets the correct branch (if a PR number was given)
- The issue numbers are valid on GitHub (`gh issue view N`)

If anything is wrong, tell the user what to fix. Don't start the pipeline until validation passes.

---

## Step 3: Initialize branch (if needed)

If no existing branch was provided, use `start_code_task` (or `Agent` outside Cowork) to spin up a one-shot setup agent:

```
Create a new branch called `[branch-name]` off the default branch (usually main).
Push it to origin. Do not open a PR yet.
```

Wait for it to finish before continuing.

**Where issue agents should work:** check whether the user's main checkout is already on the target shared branch (run `git -C [workspace] branch --show-current`). If it is, point each issue agent at the main checkout directly — that avoids spawning a worktree per issue and is much simpler. Otherwise, dispatch with `isolation: "worktree"` so each agent runs in its own auto-cleaned worktree, and have the agent push to the shared branch (not its worktree branch) before exiting.

---

## Step 4: Run each issue in sequence

For each issue number in the ordered list, run steps 4a–4e before moving to the next.

### 4a. Dispatch the issue agent

Use `start_code_task` pointed at the workspace, or the `Agent` tool outside Cowork.

**Model: always use Sonnet for implementation agents.** In plain Claude Code, pass `model: "sonnet"` to the `Agent` tool. In Cowork, configure `start_code_task` to launch a Sonnet session. Sonnet is the right cost/quality tradeoff for issue implementation — Opus is overkill for the prescribed work in a well-scoped issue, and Haiku tends to skip steps in long prompts.

The prompt should be:

```
You are implementing GitHub issue #[N] on branch `[branch-name]`.
[If PR exists]: This branch has open PR #[PR]. Your commits will appear there automatically — do not open a new PR.

Steps:
1. cd to [workspace path]. Run `git fetch origin && git checkout [branch-name] && git pull --ff-only origin [branch-name]` to make sure you are on the correct shared branch with the latest commits — do NOT commit to your worktree branch.
2. Confirm `git branch --show-current` prints `[branch-name]` before any edits.
3. Run `gh issue view [N]` to read the full issue description and acceptance criteria.
4. Implement everything the issue describes. Ask nothing — the issue is your spec. If you hit a genuine blocker that requires user input, stop and say so clearly at the top of your response.
5. **Stage only the files you changed.** Do NOT use `git add -A` or `git add .` — the user's repo often has unrelated untracked files (logs, scratch notes, tool-specific state directories) that must be left alone. Use `git add <path>` per file.
6. **Run project-appropriate pre-commit checks before committing.** Examples: `dart format .` + `flutter analyze --no-fatal-infos` for Flutter; `ruff check .` + `pytest -q` for Python; `npm run lint` + `npm test` for Node. Look at the project's CLAUDE.md / README / package.json to discover the right commands. Confirm exit 0 before committing.
7. Commit and push with `git push origin [branch-name]`. Confirm with `git branch --show-current` that you are still on `[branch-name]` before pushing.
8. Close the issue with `gh issue close [N] --comment "..."`. The comment must include:
   - A 2–4 sentence summary of what was implemented
   - The commit SHA(s) (run `git log --oneline -3` to find them)
9. At the very end, output a section titled "## Manual Setup Required" that lists ONLY things that cannot be automated: API keys, environment variables, .env values, external service configuration, server-side steps, deployment actions, manual test steps requiring human interaction. If nothing manual is needed, write "None."

Do not open a new PR. Do not create a new branch.
```

### 4b. Monitor the agent

**Cowork:** Poll with `read_transcript` using `max_wait_seconds: 30` in a loop. **Do not call `start_code_task` again while an agent is running** — the dispatch tool sometimes times out even when the agent started successfully. A timeout from `start_code_task` does NOT mean the agent failed to launch. Always check `read_transcript` before retrying, to avoid duplicate agents working on the same issue.

**Plain Claude Code:** `Agent` is synchronous — when the call returns you have the agent's full final message. No polling, no retries, no duplicate-launch concern.

- **Finishes successfully** → proceed to 4c
- **Agent says it's blocked or needs clarification** → pause the pipeline immediately, notify the user with the agent's question, and wait for their reply before continuing
- **Agent errors or fails** → pause the pipeline, give the user a clear summary of what failed, and stop until they give direction
- **`start_code_task` times out (Cowork only)** → immediately call `read_transcript` on the session ID returned (if any) before deciding whether to retry. If no session ID was returned, wait 10 seconds and call `list_sessions` to check whether the agent actually started.

### 4c. Delete the worktree

After the agent completes, delete its worktree and any stale remote branches immediately. The work is on the shared branch — the worktree is disposable.

**Skip this entire step** if the agent ran in the user's main checkout (because the main checkout was already on the shared branch — see step 3). There's nothing to clean up in that case.

**Cowork** (worktree per agent): include this cleanup instruction in every issue agent prompt:
```
After pushing, clean up:
1. Delete your worktree: `git worktree remove --force <your-worktree-path>`
2. Delete any remote branch starting with `claude/`: `git push origin --delete <branch-name>`
Keep only the shared branch (e.g. `follow-up-fixes`, `csv-import`, etc.)
```
If the agent didn't self-clean, send it a `send_message` with the cleanup command immediately after it finishes.

**Plain Claude Code** with `isolation: "worktree"`: the harness auto-cleans the worktree if no changes were made; otherwise the worktree path is returned in the result and you can prompt the user to clean it (or run `git worktree remove --force <path>` yourself once the work is verified merged).

### 4d. Run the smoke test agent

Dispatch a second `start_code_task` for a smoke test. Prompt:

```
Smoke test for issue #[N] on branch `[branch-name]`.

Check out the branch and run the following, reporting PASS or FAIL for each:

1. **Backend lint** (if `backend/` exists): `cd backend && ruff check .`
2. **Backend tests** (if `backend/` exists): `cd backend && pytest -q`
3. **Backend health** (if `backend/` exists): start the dev server in the background, hit the health endpoint, then stop it
4. **Flutter build** (ONLY if this issue touched any file under `lib/` or `macos/`): run `flutter build macos --debug` and confirm it exits 0

For each check: state what you ran, whether it passed, and if it failed, paste the relevant error output.
Do not fix anything — just report.
```

If any smoke test fails:
- Pause the pipeline
- Notify the user with exactly which check failed and the error output
- Wait for direction before continuing to the next issue

### 4e. Collect manual setup items

After each agent finishes, extract the contents of its "## Manual Setup Required" section and add it to a running list, tagged with the issue number (e.g. `Issue #21: Set GOOGLE_CLIENT_SECRET in .env`).

---

## Step 5: Open the PR (new branch only)

If this pipeline created a new branch (no PR existed at the start), after all issues complete, dispatch a final `start_code_task` (or `Agent`):

```
Open a pull request for branch `[branch-name]` with:
- Title: [PR title from form]
- Body: a summary listing all issues implemented, each with a link to the closed issue and the relevant commit

Use `gh pr create`. Do not merge.
```

If the resulting PR is left in **draft** state and the user later asks you to merge, mark it ready first with `gh pr ready <number>` before calling `gh pr merge`. Per the project's CLAUDE.md, never merge without explicit user confirmation — the user must testing-sign-off first.

---

## Step 5b: Create the Rhythm follow-up task

After the PR is open (or the existing PR has all commits pushed), create **one** task on the user's Rhythm app via the rhythm MCP server to capture the consolidated manual setup checklist. This is the user's actionable checklist of things only a human can do — env vars to set, secrets to configure, manual test steps to run, deployment actions, etc.

Call `mcp__rhythm__rhythm_create_task` with:

| Field | Value |
|-------|-------|
| `title` | The PR title (matches what the user sees in GitHub) |
| `notes` | Markdown body with a `## Manual Setup Required` section, then one subsection per issue (e.g. `### Issue #N — <title>`) listing that issue's manual steps. End with a `## Links` section containing the PR URL and links to each closed issue. |

If every issue's manual-setup section was "None", create the task anyway with notes "All work was fully automated — no manual setup required." plus the PR/issue links. The task gives the user a single Rhythm entry to track that this batch of work needs (or doesn't need) follow-up.

If the rhythm MCP server is not available in the current environment, skip this step silently and note it in the final report so the user knows to create the task themselves.

---

## Step 6: Final report

Once the pipeline is complete (or paused on failure), send the user a `SendUserMessage` with:

**✅ Completed issues** — issue number, title, link to closed issue, commit SHA

**❌ Failed / skipped issues** — issue number and reason

**🔧 Manual Setup Required** — consolidated list of all flagged items, organized by category:
- Environment variables / .env
- API keys & secrets
- External service setup
- Server / deployment steps
- Other

**🔗 PR link** — if a new PR was opened, or the existing PR if commits were added to one

**📝 Rhythm task** — link or confirmation that the follow-up task was created (or a note that the rhythm MCP server was unavailable and the user should create it manually)

---

## Principles to keep in mind

**One branch, no sprawl.** Every agent works on the same branch. Worktrees are deleted immediately after each agent pushes. When the pipeline ends, there are zero leftover branches or worktrees.

**Smoke tests are a hard gate.** A failed smoke test stops the pipeline just like a failed agent. The next issue doesn't start until the current one is verified working.

**Pause on uncertainty.** If an agent is blocked, or a smoke test fails, stop and ask. Never skip issues silently or guess at the user's intent.

**Manual items bubble up.** Anything an agent couldn't automate gets collected into one clean list at the end. The user sees exactly what still needs human attention, without having to dig through agent transcripts.

**Project-agnostic.** Workspace path, branch, PR, and issues are all provided at runtime. Nothing in this skill is hardcoded to a specific repo or tech stack.
