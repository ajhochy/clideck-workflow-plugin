const { join } = require('node:path');
const path = require('node:path');

function build(s, dir) {
  const summaryJsPath = path.resolve(__dirname, '..', 'summary.js');
  const stageName = 'pipeline';
  const retryContext = (s.stageFailures?.[stageName]?.length)
    ? `\nPRIOR ATTEMPT FAILED — address these failures before continuing:\n${s.stageFailures[stageName].join('\n---\n')}\n`
    : '';
  return `You are the pipeline orchestrator for CliDeck Workflow ${s.id}.

CONTEXT FILE: ${join(dir, 'state.json')}
Read it. You will use \`issues\`, \`branch\`, \`githubRepo\`.
${retryContext}

STEP 1 — Confirm issue order.
Read \`issues\`. Verify topological order against \`dependencies\`. Re-order if needed and write back.

STEP 2 — Branch.
If state.branch does not exist locally, create it from the project's default branch (origin/main or origin/master).
\`git checkout -b ${s.branch || '<state.branch>'} origin/<default-branch>\`
Push the branch.

STEP 3 — Draft PR after first commit.
You will open the Draft PR after the FIRST issue's first commit lands. Do not open it earlier (an empty PR is noise). Title = "${s.title || s.id}". Body = the current contents of .clideck-workflow/summaries/${s.id}-summary.md (will be created in Step 7) — for now, a placeholder "Workflow ${s.id} — in progress".
Use \`gh pr create --draft\`. Save number+url to state.pr.

STEP 4 — For each issue, in order:
  a. Create a worktree: \`git worktree add ../wt-${s.id}-<issue-number> <branch>\`.
     If \`git worktree add\` fails because the branch is already checked out elsewhere, work in place in the existing checkout instead of erroring.
  b. Dispatch a Sonnet sub-agent into that worktree with the atomic step's full context.
  c. Sub-agent implements the change. BEFORE committing, the sub-agent MUST verify the change locally — do not commit unverified work. Verification is a hard gate, not optional. The verification steps depend on the project type:
     - If the repo has a test command (npm test, pytest, go test, cargo test, etc. — detect from package.json / pyproject.toml / Cargo.toml / Makefile), run it. Failures block the commit.
     - If the repo has a lint/typecheck (npm run lint, npm run typecheck, ruff, mypy, tsc, golangci-lint, etc.), run it. Errors block the commit.
     - If the repo has a build step (npm run build, cargo build, etc.), run it. Failures block the commit.
     - If the change touches static web assets (HTML/CSS/JS/index.html), serve the repo with \`python3 -m http.server\` on a free port, drive headless Chrome at that URL via DevTools Protocol, capture console errors and any failed network requests, and screenshot the page. Any console error or failed request blocks the commit. Save evidence under \`pipeline-evidence/issue-<n>/\`.
     - If none of the above apply, run the change manually (open the file, eyeball, exec the script if it's a script) and record what was checked.
     The sub-agent writes a one-paragraph "Verified by:" note into the commit message body listing exactly what it ran and what passed.
  d. Sub-agent commits with subject "feat(<issue-number>): <title>" and the verification note in the body, then pushes.
  e. After push, watch CI: \`gh pr checks <pr-number> --watch\`. If CI fails, instruct sub-agent to read the failure logs, fix, re-verify (step c), commit, push. Bound to 3 retries; if still red, mark issue blocked and stop the pipeline (signals self-heal at the plugin level).
  f. On green: \`gh issue close <issue-number> --comment "Completed in #<pr-number>"\`.
  g. Remove the worktree: \`git worktree remove ../wt-${s.id}-<issue-number>\` (skip if you worked in place in step a).

STEP 5 — Gather manual setup.
After all issues land, scan the diff and the issue bodies for setup that requires a human (API keys, env vars, GitHub Actions secrets, third-party webhooks, DNS, etc.). Write a list to state.manualSetup as:
[ { "title": "Generate Stripe API key", "steps": ["Log into Stripe", "...", "Add to .env as STRIPE_KEY"] }, ... ]

STEP 6 — Create Rhythm task (if available).
The plugin sets state.rhythmAvailable = true|false at init. If available, use the Rhythm MCP tool \`create-task\` with title "Manual setup for Workflow ${s.id}: ${s.title || ''}" and a checklist body built from manualSetup. Save id+url to state.rhythmTask. If unavailable, leave state.rhythmTask null — the plugin shows a banner.

STEP 7 — Update PR body.
Regenerate the summary (basic version: Description, Issues completed, Manual setup needed).
a. Ensure the directory exists: \`mkdir -p .clideck-workflow/summaries\`
b. Write the summary to the project repo: \`.clideck-workflow/summaries/${s.id}-summary.md\`
c. Also write a workflow-folder copy via writeSummary from summary.js:
   \`\`\`
   node -e "const {writeSummary}=require('${summaryJsPath}'); const fs=require('fs'); writeSummary('${dir}', fs.readFileSync('.clideck-workflow/summaries/${s.id}-summary.md','utf8'))"
   \`\`\`
d. Update PR body: \`gh pr edit <num> --body-file .clideck-workflow/summaries/${s.id}-summary.md\`

STEP 8 — Signal completion.
Print: WORKFLOW_STAGE_DONE: pipeline
Create marker: touch ${join(dir, 'done', 'pipeline.done')}

ON FAILURE: If you cannot complete this stage successfully, write a brief failure description to ${join(dir, 'done', 'pipeline.failed')} INSTEAD of the .done marker. Then stop.
`;
}

module.exports = { preset: 'claude-code', build };
