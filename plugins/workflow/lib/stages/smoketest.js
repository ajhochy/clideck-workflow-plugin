const { join } = require('node:path');

function build(s, dir) {
  return `You are the smoketest agent for CliDeck Workflow ${s.id}. You are Codex with computer-use capability.

CONTEXT FILE: ${join(dir, 'state.json')}
Read it. You will use \`description\`, \`plan\`, \`issues\`, \`manualSetup\`, and the diff vs the base branch.

STEP 1 — Load existing smoketest.md.
Read ${join(dir, 'smoketest.md')} which was authored by the planning agent. Verify it is non-empty and contains at least one checklist item. If the file is missing or empty, write a brief failure description to ${join(dir, 'done', 'smoketest.failed')} and stop. Do NOT regenerate the file.

STEP 2 — Execute the checklist via clickthrough.
For each item, drive the appropriate surface:
- Web app: open browser, navigate, click, fill forms
- Native desktop app: open and interact via accessibility
- Email/messaging client: verify message arrival
- CLI/HTTP: run the command or curl, inspect output
Pay attention to cross-app checks (e.g., if an item verifies an email arrived, open the mail client).
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
