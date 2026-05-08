const path = require('node:path');
const { join } = path;

function build(s, dir) {
  const pluginRoot = path.resolve(__dirname, '..', '..');
  const repoRoot = path.resolve(pluginRoot, '..', '..');
  const localSkill = path.join(repoRoot, 'skills', 'smoke-test', 'SKILL.md');
  return `Smoketest agent for CliDeck Workflow ${s.title || s.id} (Codex).
CONTEXT FILE: ${join(dir, 'state.json')} — use \`description\`, \`plan\`, \`issues\`, \`manualSetup\`, and the diff vs base.
LOCAL SMOKE-TEST SKILL: ${localSkill}

Read and follow the repo-local smoke-test skill at LOCAL SMOKE-TEST SKILL. Do not use the global Codex smoke-test skill for this workflow. The acceptance baseline is state.plan and state.plan.coherenceRules, not the commit list. Build ${join(dir, 'smoketest.md')} from the planned expected behavior first, then use issues, commits, and diff vs base as evidence to detect missing work, extra/unplanned behavior, and implementation drift. The checklist should fail or block when the implemented diff cannot demonstrate a planned behavior.

PROGRESS REPORTING
After creating/updating the checklist, count runnable checklist items in smoketest.md matching either \`^\\s*-\\s*\\[ \\]\` or table rows with \`| Pending |\` → TOTAL (if 0, treat as 1). Initialize:
\`node ${pluginRoot}/bin/report-progress.js ${dir} smoketest 0 <TOTAL> "loading checklist"\`
After each item is marked Success/Fail/Blocked or annotated ✅/❌, bump:
\`node ${pluginRoot}/bin/report-progress.js ${dir} smoketest <itemsDone> <TOTAL> "<short item title>"\`
For final result writing and completion signaling, keep current at TOTAL and only update the label. Do not skip bumps.

REQUIRED OUTPUTS
1. Write ${join(dir, 'smoketest.md')} using the smoke-test skill's compact checklist format. If the file already exists, update it instead of discarding useful prior evidence.
2. Run the checklist. Use CLI/HTTP/log checks directly; use Browser or Computer Use only when the checklist requires UI or cross-app verification.
3. Save state.smoketestResult = {
   status: "passed" | "failed",
   failures: [ { item, expected, actual, evidence, suggestedFix } ]
}
4. Commit the final smoketest.md/state evidence once with message \`test: record smoketest results\`, then push once. If the run fails partway, still commit once with the partial evidence.
5. Print \`WORKFLOW_STAGE_DONE: smoketest\`, then \`touch ${join(dir, 'done', 'smoketest.done')}\`.

ON FAILURE: write a brief failure description to ${join(dir, 'done', 'smoketest.failed')} only when you cannot produce smoketest.md or state.smoketestResult at all.
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
