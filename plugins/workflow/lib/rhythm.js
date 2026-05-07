// Rhythm App MCP client wrapper.
//
// ASSUMPTION: This module calls `api.callMcp(server, tool, args)` — a bridge
// method that lets a plugin invoke MCP servers configured in CliDeck.
//
// INVESTIGATION RESULT (Task 16): As of the current codebase, `buildApi` in
// plugin-loader.js does NOT expose a `callMcp` method. The API object only
// includes session, config, frontend, pill, and settings helpers.
//
// TODO (plugin-loader.js / buildApi): Add a thin `callMcp(server, tool, args)`
// pass-through to whatever module manages MCP connections in CliDeck so that
// plugins can invoke configured MCP servers. Until this is wired up, `probe`
// will catch the TypeError via try/catch and return false, allowing Stage 3 to
// complete without Rhythm integration.

async function probe(api) {
  try {
    const res = await api.callMcp('rhythm', 'list-tools', {});
    return Array.isArray(res?.tools);
  } catch { return false; }
}

async function createSetupTask(api, { title, items }) {
  const body = items.map((it, i) => `- [ ] **${i + 1}. ${it.title}**\n${it.steps.map((s) => `   - ${s}`).join('\n')}`).join('\n\n');
  return api.callMcp('rhythm', 'create-task', { title, body });
}

module.exports = { probe, createSetupTask };
