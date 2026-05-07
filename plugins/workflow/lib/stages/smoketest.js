const { join } = require('node:path');

function build(s, dir) {
  return `You are the smoketest agent for CliDeck Workflow ${s.id}. You are Codex with computer-use capability.

CONTEXT FILE: ${join(dir, 'state.json')}
Read it. You will use \`description\`, \`plan\`, \`issues\`, \`manualSetup\`, and the diff vs the base branch.

STEP 1 — Generate smoketest.md (do NOT commit yet).
Write a Markdown checklist to ${join(dir, 'smoketest.md')}. Do not git-add, commit, or push at this step.
Each checklist item must include:
- What to do (precise steps)
- What to verify (expected outcome)
- Where to verify it (browser URL, native app name, email inbox, log file, etc.)
Include cross-app checks where the change implies them — e.g., if the feature sends an email, the checklist must verify the email arrived in the user's mail client.

STEP 2 — Execute the checklist via clickthrough.
For each item, drive the appropriate surface:
- Web app: open browser, navigate, click, fill forms
- Native desktop app: open and interact via accessibility
- Email/messaging client: verify message arrival
- CLI/HTTP: run the command or curl, inspect output
Capture evidence per item (screenshot file path, log snippet, command output). Annotate smoketest.md inline with ✅ / ❌ + evidence under each item.
COMMIT CADENCE: Do NOT commit between items. Run all items first, accumulate evidence in smoketest.md and any evidence directory, then make exactly ONE commit at the end of step 2 covering smoketest.md + evidence. Use a single commit message: \`test: record smoketest results\`. Push once. Repeated per-item commits pollute PR history and are forbidden. If the run fails partway, still commit once with whatever partial state you have.

STEP 3 — Write the overall result.
Write state.smoketestResult = {
  status: "passed" | "failed",
  failures: [
    { item: "...", expected: "...", actual: "...", evidence: "...", suggestedFix: "..." }
  ]
}

STEP 4 — Signal completion.
Print: WORKFLOW_STAGE_DONE: smoketest
Create marker: touch ${join(dir, 'done', 'smoketest.done')}
`;
}

module.exports = {
  preset: 'codex',
  // Codex prompts for approval on every shell exec / file write by default,
  // which stalls the unattended smoketest. Bypass approvals + sandbox for
  // this session only.
  extraArgs: ['--dangerously-bypass-approvals-and-sandbox'],
  build,
};
