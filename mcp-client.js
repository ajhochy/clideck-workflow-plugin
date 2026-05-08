// Minimal MCP client used by plugin api.callMcp.
//
// Reads MCP server configuration from ~/.claude.json (the Claude Code config),
// then speaks JSON-RPC 2.0 to the named server. Supports stdio servers
// (spawn command/args/env) and http servers (POST to url).
//
// Tool name convention used by plugin code:
//   - 'list-tools' is translated to MCP method 'tools/list'
//   - any other tool name is translated to 'tools/call' with { name, arguments }

const { spawn } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { homedir } = require('node:os');
const { join } = require('node:path');

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function loadServers() {
  const home = homedir();
  const merged = {};
  // ~/.claude.json — top-level mcpServers, plus any per-project mcpServers blocks.
  const root = readJson(join(home, '.claude.json'));
  if (root) {
    Object.assign(merged, root.mcpServers || {});
    for (const proj of Object.values(root.projects || {})) {
      if (proj && proj.mcpServers) Object.assign(merged, proj.mcpServers);
    }
  }
  // ~/.claude/settings.json — wins on conflict (Claude Code's canonical location).
  const settings = readJson(join(home, '.claude', 'settings.json'));
  if (settings && settings.mcpServers) Object.assign(merged, settings.mcpServers);
  return merged;
}

function methodAndParams(toolName, args) {
  if (toolName === 'list-tools' || toolName === 'tools/list') {
    return { method: 'tools/list', params: {} };
  }
  return { method: 'tools/call', params: { name: toolName, arguments: args || {} } };
}

async function callHttp(server, toolName, args) {
  const { method, params } = methodAndParams(toolName, args);
  const body = { jsonrpc: '2.0', id: 1, method, params };
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (server.headers) Object.assign(headers, server.headers);
  const res = await fetch(server.url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`mcp http ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'mcp error');
  return json.result;
}

function callStdio(server, toolName, args) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...(server.env || {}) };
    const child = spawn(server.command, server.args || [], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    let settled = false;
    let initialized = false;
    let nextId = 1;
    const pending = new Map();
    const timeout = setTimeout(() => done(new Error('mcp stdio timeout')), 15000);

    function done(err, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { child.kill(); } catch {}
      err ? reject(err) : resolve(result);
    }

    function send(method, params) {
      const id = nextId++;
      const msg = { jsonrpc: '2.0', id, method, params };
      child.stdin.write(JSON.stringify(msg) + '\n');
      return new Promise((res, rej) => pending.set(id, { res, rej }));
    }

    function notify(method, params) {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
    }

    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id != null && pending.has(msg.id)) {
          const { res, rej } = pending.get(msg.id);
          pending.delete(msg.id);
          msg.error ? rej(new Error(msg.error.message || 'mcp error')) : res(msg.result);
        }
      }
    });

    child.on('error', (e) => done(e));
    child.on('exit', (code) => { if (!settled) done(new Error(`mcp stdio exited ${code}`)); });

    (async () => {
      try {
        await send('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'clideck', version: '1' },
        });
        notify('notifications/initialized', {});
        initialized = true;
        const { method, params } = methodAndParams(toolName, args);
        const result = await send(method, params);
        done(null, result);
      } catch (e) { done(e); }
    })();
  });
}

async function callMcp(serverName, toolName, args) {
  const servers = loadServers();
  const server = servers[serverName];
  if (!server) throw new Error(`MCP server not configured: ${serverName}`);
  if (server.type === 'http' || server.url) return callHttp(server, toolName, args);
  if (server.command) return callStdio(server, toolName, args);
  throw new Error(`MCP server has no command or url: ${serverName}`);
}

module.exports = { callMcp };
