const { join } = require('node:path');

function build(s, dir) {
  return `You are the issue-creation agent for CliDeck Workflow ${s.id}.

CONTEXT FILE: ${join(dir, 'state.json')}
Read it. You will use the \`plan\` field — its structured atomic steps are your source.

STEP 1 — Detect repository.
Run: \`gh repo view --json nameWithOwner\` (or \`git remote get-url origin\`). If a GitHub repo is detected, set state.json.githubRepo to "<owner>/<name>". Otherwise leave it null and proceed in local-TODO mode.

STEP 2 — Create issues (or local TODOs).
GitHub mode:
- Create one milestone for this workflow titled "${s.title || 'Workflow'} (${s.id})".
- For each atomic step in plan.steps, create a GitHub issue under that milestone. Title = step title. Body = step body verbatim, including file paths, function names, expected behavior, dependencies, coherence-rule references.
- Use \`gh issue create --milestone …\`. Capture the issue numbers.

Local mode:
- Build an array of synthetic IDs (T1, T2, …). Body identical to GitHub issue body.

STEP 3 — Suggest implementation order.
Based on dependencies between atomic steps, produce an ordered array. Steps with no deps come first; downstream steps follow. Record dependency edges so Stage 3 can verify.

STEP 4 — Write back to state.json.issues.
Schema:
[
  { "number": 34 | "T1", "title": "...", "order": 1, "dependencies": [], "body": "..." },
  ...
]

STEP 5 — Signal completion.
Print: WORKFLOW_STAGE_DONE: issues
Create marker: touch ${join(dir, 'done', 'issues.done')}
`;
}

module.exports = { preset: 'claude-code', build };
