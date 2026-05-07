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

module.exports = { render };
