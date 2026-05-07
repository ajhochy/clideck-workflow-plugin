# E2E Smoke Findings — 2026-05-07

Workflow run: `wf-2026-05-07-ahknqv` against `ajhochy/Workflow-e2e-Test`,
branch `feat/4-snake-test`, PR #5. End-to-end success: planning → issues
→ pipeline → smoketest detected a missing favicon → fix sub-workflow
re-ran → smoketest passed → summary committed → PR flipped to Ready for
Review.

The flow works. The four observations below are quality issues, not
breakages, and are worth fixing before declaring the plugin "done."

---

## Finding 1 — Planning Q&A only landed in the active session

**Observed:** Planning agent's clarifying questions appeared only in the
spawned terminal session. They did not surface in the workflow panel
row's chat box.

**Designed:** The planning prompt body claims "The user may answer in
this terminal or via the workflow panel; both pipe in here." The panel
row already exposes a textarea and a `chat` frontend message
(`plugins/workflow/index.js` → `onFrontendMessage('chat', ...)`), but
the agent's *output* is never relayed *into* the panel — only user input
is relayed *out* to the agent. Bidirectional doesn't exist yet.

**Suggested fix:** Hook `api.onSessionOutput(activeSession, ...)` (or
`onTranscriptEntry`) inside the runner, filter for assistant turns
during the planning stage, and forward the rendered text to the
frontend via `api.sendToFrontend('planning-message', { id, text })`. The
client renders those into the row's chat box. Stop relaying once
`planning.done` drops.

---

## Finding 2 — Pipeline agent committed without visible test evidence

**Observed:** Pipeline (Stage 3, claude-code) committed each issue's
implementation but produced no evidence it had actually run/built/tested
the code before committing. Smoketest is what caught the favicon bug
that should have been caught earlier.

**Designed:** The pipeline prompt
(`plugins/workflow/lib/stages/pipeline.js`) does not require any
pre-commit verification step — only "implement the issue, commit,
update the PR." Smoketest is the only place verification happens.

**Suggested fix:** Strengthen the pipeline prompt to require a per-issue
build/lint/typecheck/test step *before* committing, with the specific
commands depending on what the project uses (lookup at planning time and
record into `state.json.verifyCommands` so the pipeline stage can read
them). For projects without tests (like this static HTML snake repo),
require at least: serve locally, open in headless browser, capture
console errors, fail if any are present. That alone would have caught
the favicon 404 in pipeline rather than smoketest.

---

## Finding 3 — Codex spawned without bypass-permissions

**Observed:** The smoketest stage's Codex session prompted for approval
on operations it should be allowed to perform unattended (bash exec,
file writes, network requests). Workflow is meant to be hands-off.

**Designed:** The runner spawns Codex via
`api.createSession({ presetId: 'codex', ... })`, which uses the user's
configured `codex` command verbatim — by default
`/opt/homebrew/bin/codex`, no flags. Compare to claude-code which the
user has configured as `claude --dangerously-skip-permissions`.

**Suggested fix:** Two options.
1. Have the smoketest stage pass an explicit bypass flag in `presetId`
   selection — but `createProgrammatic` doesn't accept extra command
   args, so this requires adding a second "codex (bypass)" command in
   the user's config and using its `commandId` instead of `presetId`.
2. The plugin documents a one-time config requirement: user must add
   `--dangerously-bypass-approvals-and-sandbox` (or whatever Codex's
   equivalent is) to their configured codex command. Less invasive but
   relies on user setup.

Recommend (2) for now, with the README documenting it. Long-term, (1)
via a per-session command override in `createProgrammatic`.

---

## Finding 4 — Codex committed each smoketest result individually

**Observed:** Codex pushed `smoketest.md` to GitHub on first write, then
made a separate commit for each test it ran, mutating only that one
file's checkbox/evidence section per commit. The branch ended with 7+
"test: record … smoketest" commits.

**Designed:** The smoketest prompt
(`plugins/workflow/lib/stages/smoketest.js`) does not say anything
about commit cadence. The agent inferred "commit each finding" as good
practice. Inefficient and noisy in PR history.

**Suggested fix:** Add explicit commit-cadence guidance to the
smoketest prompt: "Run all checklist items first, write all evidence to
`smoketest.md` and `smoketest-evidence/`, then make a single commit
`test: record smoketest results`. Do not commit between items." If the
run fails partway, write the partial state and still commit once. The
fix-loop cycle starts fresh anyway.

---

## Out-of-scope but adjacent

**Project cwd not respected.** Spawned sessions use CliDeck's default
path (`~/Documents`) rather than the project's path, because
`createProgrammatic` only honors `opts.cwd | cmd.defaultPath |
cfg.defaultPath`. The agents in this run worked anyway because they
clone-or-pull the target repo themselves at planning time. But if the
runner passed `cwd: project.path`, agents could skip that step and the
pipeline could execute `gh pr` and `git` commands without `cd`-ing.

**Bundled-vs-installed plugin sync.** During this run we hit a stale
`~/.clideck/plugins/workflow/` copy because the seeder only re-copies
on version mismatch. The fix was a manual `cp`. Future development
iterations need either a dev-mode symlink (`CLIDECK_DEV_PLUGINS=1` →
symlink instead of copy) or version bumps on every change. Worth a
small note in the plan.

---

Stopping per handoff guidance. Not making redesign decisions in code
without your sign-off.
