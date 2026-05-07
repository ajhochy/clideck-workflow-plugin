const { join } = require('node:path');
const path = require('node:path');

function pickNextIssue(issues) {
  if (!Array.isArray(issues)) return null;
  const ordered = [...issues].sort((a, b) => (a.order || 0) - (b.order || 0));
  return ordered.find((i) => i.status !== 'done') || null;
}

function build(s, dir) {
  const summaryJsPath = path.resolve(__dirname, '..', 'summary.js');
  const pluginRoot = path.resolve(__dirname, '..', '..');
  const stageName = 'pipeline';
  const retryContext = (s.stageFailures?.[stageName]?.length)
    ? `\nPRIOR ATTEMPT FAILED — address these failures before continuing:\n${s.stageFailures[stageName].join('\n---\n')}\n`
    : '';
  const next = pickNextIssue(s.issues);
  if (next) return buildStepPrompt({ s, dir, issue: next, retryContext, pluginRoot });
  return buildFinalizePrompt({ s, dir, retryContext, summaryJsPath });
}

function buildStepPrompt({ s, dir, issue, retryContext, pluginRoot }) {
  const ciFailureCtx = (issue.status === 'fix-needed' && issue.lastCiFailure)
    ? `\nCI FAILED on the previous push for this step. Failed checks: ${JSON.stringify(issue.lastCiFailure.failed?.map((f) => f.name) || [])}. Read the failure logs (\`gh run view <run-id> --log-failed --repo ${s.githubRepo}\` or follow the link in state.issues[*].lastCiFailure), fix the cause, re-verify, then commit + push the fix.\n`
    : '';

  return `You are the per-step pipeline worker for CliDeck Workflow ${s.title || s.id}.
You execute EXACTLY ONE plan step, then exit. The runner will spawn you again for the next step. Do not loop.

CONTEXT FILE: ${join(dir, 'state.json')}
THIS STEP: state.issues entry with order=${issue.order}, number=${issue.number}, title="${issue.title || ''}".
${retryContext}${ciFailureCtx}

STEP A — Set up the working tree.
- If you do not already have a worktree for this branch, ensure it exists: \`git worktree add ../wt-${s.id}-${issue.number} ${s.branch}\` (or work in the existing checkout if the branch is already checked out elsewhere).
- cd into that worktree.

STEP B — Implement the change.
The atomic step body is in state.issues entries — read \`body\` for this issue. Implement exactly what it specifies (file paths, function names, expected behavior, dependencies, coherence rules).

STEP C — Verify locally before committing. This is a hard gate — do not commit unverified work.
Choose verification based on project type:
- npm/pnpm/yarn project → \`npm test\` (or pnpm/yarn equivalent), \`npm run lint\` / \`tsc --noEmit\` / \`npm run typecheck\` if defined, \`npm run build\` if defined.
- python → pytest / mypy / ruff as available.
- go → \`go test ./...\` and \`go vet ./...\`.
- rust → \`cargo test\` and \`cargo clippy\`.
- static web assets only → \`python3 -m http.server\` on a free port + headless Chrome via DevTools Protocol; capture console errors and failed network requests; screenshot. Save evidence under \`pipeline-evidence/issue-${issue.number}/\`.
- otherwise → eyeball the change and record what you checked.
A failure here BLOCKS the commit. Fix and re-run before proceeding.

STEP D — Commit + push.
Subject: \`feat(${issue.number}): ${(issue.title || '').replace(/`/g, "'")}\`
Body MUST include a one-paragraph "Verified by:" note listing the exact commands you ran in step C and that they passed.
Push to ${s.branch} on the \`plugin\` remote: \`git push plugin ${s.branch}\`.

STEP E — If this is the FIRST commit on this branch (no PR yet on state.pr), open the draft PR.
\`gh pr create --repo ${s.githubRepo} --draft --title "${(s.title || s.id).replace(/"/g, '\\"')}" --body "Workflow ${s.title || s.id} — in progress"\`
Save \`{number, url}\` to state.pr (use a node one-liner; do not hand-edit the JSON).

STEP F — Mark this issue as pushed and signal step done. DO NOT WATCH CI. The runner polls CI in Node, no LLM context needed.
- Update state.issues[this].status = 'pushed' and append the new commit sha to state.issues[this].commits.
- Bump progress: \`node ${pluginRoot}/bin/report-progress.js ${dir} pipeline ${(s.issues || []).filter((i) => i.status === 'done').length} ${(s.issues || []).length} "issue ${issue.number} pushed, awaiting CI"\` (use the count of \`done\` issues, not pushed — pushed is in-flight).
- Write the marker: \`touch ${join(dir, 'done', 'step.done')}\` and EXIT.

ON FAILURE (could not implement, verification failed permanently, push rejected, etc.): write a brief failure description to ${join(dir, 'done', 'step.failed')} INSTEAD of step.done. Then stop.
`;
}

function buildFinalizePrompt({ s, dir, retryContext, summaryJsPath }) {
  return `You are the pipeline finalizer for CliDeck Workflow ${s.title || s.id}.
All ${(s.issues || []).length} steps are CI-green. Wrap up the pipeline stage.

CONTEXT FILE: ${join(dir, 'state.json')}
${retryContext}

STEP 1 — Gather manual setup.
Scan the diff (${s.branch} vs origin default branch) and the issue bodies for setup that requires a human (API keys, env vars, GitHub Actions secrets, third-party webhooks, DNS, etc.). Write the list to state.manualSetup as:
[ { "title": "Generate Stripe API key", "steps": ["...", "..."] }, ... ]

STEP 2 — Create Rhythm task (if available).
If state.rhythmAvailable is true, use the Rhythm MCP \`create-task\` tool with title "Manual setup for Workflow ${s.id}: ${s.title || ''}" and a checklist body built from state.manualSetup. Save \`{id, url}\` to state.rhythmTask. If unavailable, leave state.rhythmTask null.

STEP 3 — Write the summary.
- \`mkdir -p .clideck-workflow/summaries\`
- Write the summary to \`.clideck-workflow/summaries/${s.id}-summary.md\` (Description, Issues completed with PR commit shas, Manual setup needed).
- Mirror to the workflow folder:
  \`\`\`
  node -e "const {writeSummary}=require('${summaryJsPath}'); const fs=require('fs'); writeSummary('${dir}', fs.readFileSync('.clideck-workflow/summaries/${s.id}-summary.md','utf8'))"
  \`\`\`
- Update PR body: \`gh pr edit <state.pr.number> --repo ${s.githubRepo} --body-file .clideck-workflow/summaries/${s.id}-summary.md\`

STEP 4 — Signal completion.
Print: WORKFLOW_STAGE_DONE: pipeline
Create marker: \`touch ${join(dir, 'done', 'pipeline.done')}\`

ON FAILURE: write a brief failure description to ${join(dir, 'done', 'pipeline.failed')} instead.
`;
}

module.exports = { preset: 'claude-code', build, pickNextIssue };
