const { join } = require('node:path');

function shouldRetry(s, max) { return (s.fixAttempts?.length || 0) < max; }

function buildFixPrompt(s, dir) {
  const failures = JSON.stringify(s.smoketestResult?.failures || [], null, 2);
  return `You are the fix planner for CliDeck Workflow ${s.title || s.id} (fix attempt ${(s.fixAttempts?.length || 0) + 1}).

CONTEXT FILE: ${join(dir, 'state.json')}
SMOKETEST FAILURES TO ADDRESS:
${failures}

This is an abbreviated Stage 1: skip the full architecture pass. Read the failure list, identify root causes (use Haiku exploration if and only if needed for a specific file), and write atomic fix steps to state.plan (replace it). Then drop the fix marker so the runner can re-enter the issues stage.

Print: WORKFLOW_STAGE_DONE: planning
Create marker: touch ${join(dir, 'done', 'planning.done')}
`;
}

function startFixAttempt(dir, state) {
  return state.update(dir, (cur) => {
    cur.fixAttempts.push({ startedAt: new Date().toISOString(), failures: cur.smoketestResult?.failures || [] });
    cur.currentStage = 'planning'; // re-enter
    cur.smoketestResult = null;
    cur.plan = null; // will be rewritten by abbreviated stage 1
    cur.issues = [];
    // markers cleared by caller
  });
}

module.exports = { shouldRetry, buildFixPrompt, startFixAttempt };
