#!/usr/bin/env node
const path = require('node:path');
const state = require(path.resolve(__dirname, '..', 'lib', 'state'));

const VALID_STAGES = ['planning', 'issues', 'pipeline', 'smoketest'];

function fail(msg) {
  process.stderr.write(`report-progress: ${msg}\n`);
  process.exit(2);
}

const [, , stateDir, stage, currentRaw, totalRaw, ...labelParts] = process.argv;

if (!stateDir || !stage || currentRaw === undefined || totalRaw === undefined || labelParts.length === 0) {
  fail('usage: report-progress.js <stateDir> <stage> <current> <total> <label>');
}
if (!VALID_STAGES.includes(stage)) {
  fail(`invalid stage "${stage}" (must be one of ${VALID_STAGES.join(', ')})`);
}
const current = Number(currentRaw);
const total = Number(totalRaw);
if (!Number.isFinite(current) || !Number.isFinite(total)) {
  fail('current and total must be numbers');
}
if (total < 1) fail('total must be >= 1');
if (current < 0 || current > total) fail(`current (${current}) must satisfy 0 <= current <= total (${total})`);

const label = labelParts.join(' ');

try {
  state.update(stateDir, (s) => {
    if (!s.stageProgress || typeof s.stageProgress !== 'object') s.stageProgress = {};
    s.stageProgress[stage] = {
      current,
      total,
      label: String(label),
      updatedAt: new Date().toISOString(),
    };
  });
} catch (e) {
  fail(`failed to update state: ${e.message}`);
}

process.exit(0);
