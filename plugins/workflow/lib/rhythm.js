// Rhythm App MCP client wrapper. Uses api.callMcp (plugin-loader.js) which
// merges MCP server config from ~/.claude.json and ~/.claude/settings.json.

async function probe(api) {
  try {
    const res = await api.callMcp('rhythm', 'list-tools', {});
    return Array.isArray(res?.tools);
  } catch { return false; }
}

async function createSetupTask(api, { title, items }) {
  const notes = items.map((it, i) => `- [ ] **${i + 1}. ${it.title}**\n${it.steps.map((s) => `   - ${s}`).join('\n')}`).join('\n\n');
  return api.callMcp('rhythm', 'rhythm_create_task', { title, notes });
}

module.exports = { probe, createSetupTask };
