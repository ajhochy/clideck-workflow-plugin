const { join } = require('node:path');

function build(s, dir) {
  return `You are the pipeline orchestrator for CliDeck Workflow ${s.id}.

CONTEXT FILE: ${join(dir, 'state.json')}
Read it. You will use \`issues\`, \`branch\`, \`githubRepo\`.

STEP 1 — Confirm issue order.
Read \`issues\`. Verify topological order against \`dependencies\`. Re-order if needed and write back.

STEP 2 — Branch.
If state.branch does not exist locally, create it from the project's default branch (origin/main or origin/master).
\`git checkout -b ${s.branch || '<state.branch>'} origin/<default-branch>\`
Push the branch.

STEP 3 — Draft PR after first commit.
You will open the Draft PR after the FIRST issue's first commit lands. Do not open it earlier (an empty PR is noise). Title = "${s.title || s.id}". Body = the current contents of summary.md (will be created in Step 6) — for now, a placeholder "Workflow ${s.id} — in progress".
Use \`gh pr create --draft\`. Save number+url to state.pr.

STEP 4 — For each issue, in order:
  a. Create a worktree: \`git worktree add ../wt-${s.id}-<issue-number> <branch>\`
  b. Dispatch a Sonnet sub-agent into that worktree with the atomic step's full context.
  c. Sub-agent implements, commits with message "feat(<issue-number>): <title>", pushes.
  d. After push, watch CI: \`gh pr checks <pr-number> --watch\`. If CI fails, instruct sub-agent to read the failure logs, fix, commit, push. Bound to 3 retries; if still red, mark issue blocked and stop the pipeline (signals self-heal at the plugin level).
  e. On green: \`gh issue close <issue-number> --comment "Completed in #<pr-number>"\`.
  f. Remove the worktree: \`git worktree remove ../wt-${s.id}-<issue-number>\`.

STEP 5 — Gather manual setup.
After all issues land, scan the diff and the issue bodies for setup that requires a human (API keys, env vars, GitHub Actions secrets, third-party webhooks, DNS, etc.). Write a list to state.manualSetup as:
[ { "title": "Generate Stripe API key", "steps": ["Log into Stripe", "...", "Add to .env as STRIPE_KEY"] }, ... ]

STEP 6 — Create Rhythm task (if available).
The plugin sets state.rhythmAvailable = true|false at init. If available, use the Rhythm MCP tool \`create-task\` with title "Manual setup for Workflow ${s.id}: ${s.title || ''}" and a checklist body built from manualSetup. Save id+url to state.rhythmTask. If unavailable, leave state.rhythmTask null — the plugin shows a banner.

STEP 7 — Update PR body.
Regenerate summary.md (basic version: Description, Issues completed, Manual setup needed). Push it on the branch. Update PR body to the file contents via \`gh pr edit <num> --body-file summary.md\`.

STEP 8 — Signal completion.
Print: WORKFLOW_STAGE_DONE: pipeline
Create marker: touch ${join(dir, 'done', 'pipeline.done')}
`;
}

module.exports = { preset: 'claude-code', build };
