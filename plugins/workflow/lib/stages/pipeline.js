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
    ? `\nCI FAILED on the previous push. Failed: ${JSON.stringify(issue.lastCiFailure.failed?.map((f) => f.name) || [])}. Read failure logs (\`gh run view <run-id> --log-failed --repo ${s.githubRepo}\` or the link in state.issues[*].lastCiFailure), fix the cause, re-verify, then commit + push the fix.\n`
    : '';

  return `Per-step pipeline worker for CliDeck Workflow ${s.title || s.id}.
Execute EXACTLY ONE plan step then exit. The runner spawns you again for the next step — do not loop.

CONTEXT FILE: ${join(dir, 'state.json')}
THIS STEP: state.issues entry with order=${issue.order}, number=${issue.number}, title="${issue.title || ''}". Read its \`body\` — implement exactly what it specifies.
${retryContext}${ciFailureCtx}
A — Worktree. \`git worktree add ../wt-${s.id}-${issue.number} ${s.branch}\` if not already present (or use existing checkout). cd in.

B — Implement per the issue body.

C — Verify locally (HARD GATE — no unverified commits).
- npm/pnpm/yarn → \`npm test\`, plus \`npm run lint\` / \`tsc --noEmit\` / \`npm run typecheck\` / \`npm run build\` if defined.
- python → pytest / mypy / ruff as available.
- go → \`go test ./...\` && \`go vet ./...\`.
- rust → \`cargo test\` && \`cargo clippy\`.
- static web → \`python3 -m http.server\` + headless Chrome via DevTools Protocol; capture console errors + failed requests + screenshot under \`pipeline-evidence/issue-${issue.number}/\`.
- otherwise → eyeball and record what you checked.
A failure here BLOCKS the commit — fix and re-run.

D — Commit + push.
Subject: \`feat(${issue.number}): ${(issue.title || '').replace(/`/g, "'")}\`
Body MUST include a one-paragraph "Verified by:" line with the exact commands from step C.
\`git push plugin ${s.branch}\`

E — If no PR yet (state.pr unset), open draft:
\`gh pr create --repo ${s.githubRepo} --draft --title "${(s.title || s.id).replace(/"/g, '\\"')}" --body "Workflow ${s.title || s.id} — in progress"\`
Save \`{number, url}\` to state.pr via node one-liner.

F — Mark done & exit. DO NOT WATCH CI (runner polls in Node).
- state.issues[this].status = 'pushed'; append commit sha to state.issues[this].commits.
- \`node ${pluginRoot}/bin/report-progress.js ${dir} pipeline ${(s.issues || []).filter((i) => i.status === 'done').length} ${(s.issues || []).length} "issue ${issue.number} pushed, awaiting CI"\` (count \`done\`, not \`pushed\`).
- \`touch ${join(dir, 'done', 'step.done')}\` and EXIT.

ON FAILURE: write brief failure to ${join(dir, 'done', 'step.failed')} instead of step.done.
`;
}

function buildFinalizePrompt({ s, dir, retryContext, summaryJsPath }) {
  return `Pipeline finalizer for CliDeck Workflow ${s.title || s.id}. All ${(s.issues || []).length} steps are CI-green.
CONTEXT FILE: ${join(dir, 'state.json')}
${retryContext}
1 — Gather manual setup. Scan the diff (${s.branch} vs origin default) + issue bodies for human-required setup (API keys, env vars, Actions secrets, webhooks, DNS, etc.). Preserve any existing \`confirmedAt\` values when re-writing. Write state.manualSetup:
[ { "title": "Generate Stripe API key", "steps": ["...", "..."] }, ... ]

2 — Rhythm task. If state.rhythmAvailable, call Rhythm MCP \`create-task\` with title "Manual setup for Workflow ${s.id}: ${s.title || ''}" and a checklist body from state.manualSetup; save \`{id, url}\` to state.rhythmTask. Else leave state.rhythmTask null.

3 — Summary.
- \`mkdir -p .clideck-workflow/summaries\`
- Write \`.clideck-workflow/summaries/${s.id}-summary.md\` (Description, Issues with PR commit shas, Manual setup needed).
- Mirror: \`node -e "const {writeSummary}=require('${summaryJsPath}'); const fs=require('fs'); writeSummary('${dir}', fs.readFileSync('.clideck-workflow/summaries/${s.id}-summary.md','utf8'))"\`
- \`gh pr edit <state.pr.number> --repo ${s.githubRepo} --body-file .clideck-workflow/summaries/${s.id}-summary.md\`

4 — Print \`WORKFLOW_STAGE_DONE: pipeline\`, then \`touch ${join(dir, 'done', 'pipeline.done')}\`.

ON FAILURE: write brief failure to ${join(dir, 'done', 'pipeline.failed')} instead.
`;
}

module.exports = { preset: 'claude-code', build, pickNextIssue };
