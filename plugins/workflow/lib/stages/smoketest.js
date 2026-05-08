const path = require('node:path');
const { join } = path;

function build(s, dir) {
  const pluginRoot = path.resolve(__dirname, '..', '..');
  return `Smoketest agent for CliDeck Workflow ${s.title || s.id} (Codex with computer-use).
CONTEXT FILE: ${join(dir, 'state.json')} — use \`description\`, \`plan\`, \`issues\`, \`manualSetup\`, and the diff vs base.

PROGRESS REPORTING
After STEP 1, count checklist items in smoketest.md matching \`^\\s*-\\s*\\[ \\]\` → TOTAL (if 0, treat as 1). Initialize:
\`node ${pluginRoot}/bin/report-progress.js ${dir} smoketest 0 <TOTAL> "loading checklist"\`
In STEP 2, after each item is annotated ✅/❌, bump:
\`node ${pluginRoot}/bin/report-progress.js ${dir} smoketest <itemsDone> <TOTAL> "<short item title>"\`
In STEPs 3–4, keep current at TOTAL and only update the label (e.g. "writing result", "signal completion"). Do not skip bumps.

STEP 1 — Load existing smoketest.md at ${join(dir, 'smoketest.md')} (authored by planning). Verify non-empty with ≥1 checklist item. If missing or empty, write a brief failure to ${join(dir, 'done', 'smoketest.failed')} and stop. Do NOT regenerate.

STEP 2 — Execute the checklist via clickthrough. Drive the right surface per item: web (browser navigate/click/fill), native desktop (accessibility), email/messaging (verify arrival), CLI/HTTP (run command, inspect output). Watch for cross-app checks (e.g. "email arrived" → open mail client). Capture evidence per item (screenshot path, log snippet, command output) and annotate smoketest.md inline with ✅/❌ + evidence.
COMMIT CADENCE: do NOT commit between items. Run all items, accumulate evidence, then ONE commit at the end of step 2 — message \`test: record smoketest results\` — and push once. Per-item commits are forbidden. If the run fails partway, still commit once with whatever partial state you have.

STEP 3 — Write state.smoketestResult = {
  status: "passed" | "failed",
  failures: [ { item, expected, actual, evidence, suggestedFix } ]
}

STEP 4 — Print \`WORKFLOW_STAGE_DONE: smoketest\`, then \`touch ${join(dir, 'done', 'smoketest.done')}\`.
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
