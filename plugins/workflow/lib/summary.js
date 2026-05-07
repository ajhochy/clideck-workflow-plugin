function render(s) {
  const lines = [];
  lines.push(`# ${s.title}`);
  lines.push('');
  lines.push('## What you asked for');
  lines.push(s.description.trim());
  lines.push('');
  lines.push('## What was built');
  if (s.issues && s.issues.length) {
    for (const i of s.issues) lines.push(`- ${i.title}`);
  } else {
    lines.push('_(nothing yet — workflow stopped early)_');
  }
  lines.push('');
  lines.push('## Manual setup needed');
  if (s.manualSetup && s.manualSetup.length) {
    for (const m of s.manualSetup) {
      lines.push(`- **${m.title}**`);
      for (const step of m.steps || []) lines.push(`  - ${step}`);
    }
    if (s.rhythmTask?.url) lines.push(`\nTracked in Rhythm: ${s.rhythmTask.url}`);
  } else {
    lines.push('_None._');
  }
  lines.push('');
  lines.push('## What we verified');
  if (s.smoketestResult) {
    lines.push(s.smoketestResult.status === 'passed' ? 'All smoketest items passed.' : 'Some smoketest items failed (see below).');
  } else {
    lines.push('_Smoketest did not run._');
  }
  if (s.smoketestResult?.status === 'failed') {
    lines.push('');
    lines.push('## Still broken');
    for (const f of s.smoketestResult.failures || []) {
      lines.push(`- **${f.item}**`);
      if (f.actual) lines.push(`  - What happened: ${f.actual}`);
      if (f.suggestedFix) lines.push(`  - Suggested fix: ${f.suggestedFix}`);
    }
  }
  return lines.join('\n') + '\n';
}

const fs = require('fs');
const path = require('path');

function nextSummaryFilename(dir) {
  const base = path.join(dir, 'summary.md');
  if (!fs.existsSync(base)) return 'summary.md';
  const entries = fs.readdirSync(dir);
  const rx = /^summary\.run(\d+)\.md$/;
  let max = 1;
  for (const entry of entries) {
    const m = rx.exec(entry);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return `summary.run${max + 1}.md`;
}

function writeSummary(dir, content) {
  const name = nextSummaryFilename(dir);
  const fullPath = path.join(dir, name);
  if (fs.existsSync(fullPath)) {
    throw new Error(`writeSummary: file already exists: ${fullPath}`);
  }
  fs.writeFileSync(fullPath, content);
  return fullPath;
}

module.exports = { render, nextSummaryFilename, writeSummary };
