// Minimal OTLP HTTP/JSON log receiver.
// CLI agents export telemetry events here; we capture agent session IDs
// (for resume) and detect whether telemetry is configured (setup prompts).

const ioActivity = require('./activity');
const activity = new Map(); // sessionId → has received events
const lastEvent = new Map(); // sessionId → last OTEL event name (+ kind)
const pendingSetup = new Map(); // sessionId → timer (waiting for first event)
const codexMenuPoll = new Map(); // sessionId → interval (polling for menu after response.completed)
const codexPendingStop = new Map(); // sessionId → ts (notify hook arrived; wait for next response.completed)
const codexOutputDone = new Map(); // sessionId → ts (fallback if notify never fires)
const codexPendingIdle = new Map(); // sessionId → timer (tiny settle before committing idle)
const codexToolPhasePending = new Set(); // sessionId set once Codex has announced a tool-call phase, cleared when the phase resolves
const codexPendingTools = new Map(); // sessionId → Set(callId) for approved Codex tool calls still awaiting a result
// sessionId → { totals: {input, output, cache_read, cache_creation}, byCallId: Map<callId, {...}> }
const tokenStats = new Map();
let broadcastFn = null;
let sessionsFn = null;

const TOKEN_KEYS = {
  input: ['gen_ai.usage.input_tokens', 'llm.usage.input_tokens', 'input_tokens', 'gen_ai.usage.prompt_tokens'],
  output: ['gen_ai.usage.output_tokens', 'llm.usage.output_tokens', 'output_tokens', 'gen_ai.usage.completion_tokens'],
  cache_read: ['gen_ai.usage.cache_read_input_tokens', 'llm.usage.cache_read_input_tokens', 'cache_read_input_tokens'],
  cache_creation: ['gen_ai.usage.cache_creation_input_tokens', 'llm.usage.cache_creation_input_tokens', 'cache_creation_input_tokens'],
};
const CALL_ID_KEYS = ['call_id', 'call.id', 'tool_call_id', 'gen_ai.request.id', 'request.id'];

function pickFirstNumber(attrs, keys) {
  for (const k of keys) {
    const v = attrs[k];
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return 0;
}

function pickFirstString(attrs, keys) {
  for (const k of keys) {
    const v = attrs[k];
    if (typeof v === 'string' && v) return v;
    if (typeof v === 'number') return String(v);
  }
  return null;
}

function ensureTokenBucket(sessionId) {
  let bucket = tokenStats.get(sessionId);
  if (!bucket) {
    bucket = {
      totals: { input: 0, output: 0, cache_read: 0, cache_creation: 0 },
      byCallId: new Map(),
    };
    tokenStats.set(sessionId, bucket);
  }
  return bucket;
}

// Pulls token counts out of an OTLP log record's attributes. If the record
// carries usage numbers, accumulate into per-session totals and (when a
// correlation id is present) per-call totals, then broadcast a delta so
// listeners can attribute tokens to whichever stage/turn owns the call.
function recordTokenUsage(sessionId, attrs) {
  const input = pickFirstNumber(attrs, TOKEN_KEYS.input);
  const output = pickFirstNumber(attrs, TOKEN_KEYS.output);
  const cacheRead = pickFirstNumber(attrs, TOKEN_KEYS.cache_read);
  const cacheCreation = pickFirstNumber(attrs, TOKEN_KEYS.cache_creation);
  if (!(input || output || cacheRead || cacheCreation)) return null;

  const bucket = ensureTokenBucket(sessionId);
  bucket.totals.input += input;
  bucket.totals.output += output;
  bucket.totals.cache_read += cacheRead;
  bucket.totals.cache_creation += cacheCreation;

  const callId = pickFirstString(attrs, CALL_ID_KEYS);
  if (callId) {
    let perCall = bucket.byCallId.get(callId);
    if (!perCall) {
      perCall = { input: 0, output: 0, cache_read: 0, cache_creation: 0 };
      bucket.byCallId.set(callId, perCall);
    }
    perCall.input += input;
    perCall.output += output;
    perCall.cache_read += cacheRead;
    perCall.cache_creation += cacheCreation;
  }

  const delta = { input, output, cache_read: cacheRead, cache_creation: cacheCreation };
  broadcastFn?.({
    type: 'session.tokens',
    id: sessionId,
    callId: callId || null,
    delta,
    totals: { ...bucket.totals },
  });
  return delta;
}

function getPendingToolSet(id) {
  let set = codexPendingTools.get(id);
  if (!set) { set = new Set(); codexPendingTools.set(id, set); }
  return set;
}

function clearPendingTools(id) {
  codexPendingTools.delete(id);
}

function addPendingTool(id, callId) {
  if (!callId) return;
  getPendingToolSet(id).add(callId);
}

function resolvePendingTool(id, callId) {
  if (!callId) return;
  const set = codexPendingTools.get(id);
  if (!set) return;
  set.delete(callId);
  if (!set.size) codexPendingTools.delete(id);
}

function hasPendingTools(id) {
  return !!codexPendingTools.get(id)?.size;
}

function hasPendingToolState(id) {
  return codexToolPhasePending.has(id) || hasPendingTools(id);
}

function init(broadcast, getSessions) {
  broadcastFn = broadcast;
  sessionsFn = getSessions;
}

// Flatten OTLP attribute arrays into plain objects
function parseAttrs(attrs) {
  const out = {};
  if (!attrs) return out;
  for (const a of attrs) {
    const v = a.value;
    out[a.key] = v.stringValue ?? v.intValue ?? v.doubleValue ?? v.boolValue ?? '';
  }
  return out;
}

// Express-compatible handler for POST /v1/logs
function handleLogs(req, res) {
  const body = req.body;
  if (!body?.resourceLogs) return res.writeHead(200).end('{}');

  for (const rl of body.resourceLogs) {
    const resAttrs = parseAttrs(rl.resource?.attributes);
    const sessionId = resAttrs['clideck.session_id'];

    // service.name values: claude-code, codex_cli_rs, gemini-cli, clideck-agent
    const serviceName = resAttrs['service.name'] || 'unknown';
    let resolvedId = sessionId;

    // Fallback: if agent doesn't include clideck.session_id (e.g. Gemini ignores
    // OTEL_RESOURCE_ATTRIBUTES), match by finding a pending session for this agent
    if (!resolvedId) {
      for (const [id, pending] of pendingSetup) {
        const sess = sessionsFn?.()?.get(id);
        if (!sess) continue;
        // Match: no activity yet, and agent type matches
        if (!activity.has(id) && pending.bin && serviceName.includes(pending.bin)) { resolvedId = id; break; }
      }
      if (resolvedId) {
        console.log(`Telemetry: matched ${serviceName} to session ${resolvedId.slice(0, 8)} (no clideck.session_id — fallback match)`);
      } else {
        continue;
      }
    }

    // Any log record for this session means telemetry is working
    const firstEvent = !activity.has(resolvedId);
    cancelPendingSetup(resolvedId);
    activity.set(resolvedId, true);

    const sess = sessionsFn?.()?.get(resolvedId);
    const agent = resAttrs['service.name'] || sess?.name || resolvedId.slice(0, 8);

    if (firstEvent) console.log(`Telemetry: first event from ${agent} (${resolvedId.slice(0, 8)})`);

    // Process each log record — capture session ID for resume
    for (const sl of rl.scopeLogs || []) {
      for (const lr of sl.logRecords || []) {
        const attrs = parseAttrs(lr.attributes);
        const eventName = attrs['event.name'];

        // Debug telemetry logs — uncomment as needed, do not delete
        // if (serviceName === 'claude-code' && eventName) console.log(`[telemetry:claude] ${eventName}`);
        // if (serviceName === 'codex_cli_rs' && eventName) {
        //   const kind = attrs['event.kind'] ? ` kind=${attrs['event.kind']}` : '';
        //   console.log(`[telemetry:codex] ${eventName}${kind} session=${resolvedId.slice(0,8)}`);
        // }
        // if (serviceName === 'gemini-cli' && eventName) console.log(`[telemetry:gemini] ${eventName}`);

        // Track last event per session (used by menu detection validation)
        if (eventName) lastEvent.set(resolvedId, eventName + (attrs['event.kind'] ? ':' + attrs['event.kind'] : ''));

        // Per-step token attribution: any log record may carry LLM usage
        // numbers (Claude emits them on `claude_code.api_request`, Codex on
        // its model-response events, Gemini on `gen_ai.client.token.usage`).
        // recordTokenUsage is a no-op when no usage attrs are present, so
        // it's safe to call on every record.
        recordTokenUsage(resolvedId, attrs);

        // Codex can emit a brief completion between tool phases. Keep idle
        // pending for a tiny settle window and cancel it on any fresh Codex
        // activity before the idle is committed to UI/notifications.
        if (serviceName === 'codex_cli_rs' && eventName) {
          const isTrustedCompletion = eventName === 'codex.sse_event' && attrs['event.kind'] === 'response.completed';
          if (!isTrustedCompletion) cancelCodexPendingIdle(resolvedId);
        }

        // Status: Codex user_prompt → working. Claude and Gemini use hooks.
        if (eventName === 'codex.user_prompt') {
          codexPendingStop.delete(resolvedId);
          codexOutputDone.delete(resolvedId);
          codexToolPhasePending.delete(resolvedId);
          clearPendingTools(resolvedId);
          broadcastFn?.({ type: 'session.status', id: resolvedId, working: true, source: 'telemetry' });
        }

        if (serviceName === 'clideck-agent' && eventName === 'clideck.turn_start') {
          broadcastFn?.({ type: 'session.status', id: resolvedId, working: true, source: 'telemetry' });
        }
        if (serviceName === 'clideck-agent' && eventName === 'clideck.agent_idle') {
          broadcastFn?.({ type: 'session.status', id: resolvedId, working: false, source: 'telemetry' });
        }

        // Codex can announce a function-call phase before the later tool_decision
        // event carries a call_id. Block idle as soon as the tool phase is known,
        // then refine it to call-specific tracking when tool_decision arrives.
        if (eventName === 'codex.websocket_event' && attrs['event.kind'] === 'response.function_call_arguments.done') {
          codexToolPhasePending.add(resolvedId);
        }

        // Fallback: when notify does not fire, require an output item to finish
        // before treating the next response.completed as a real end-of-turn.
        if (eventName === 'codex.websocket_event' && attrs['event.kind'] === 'response.output_item.done') {
          codexOutputDone.set(resolvedId, Date.now());
        }

        // Codex: after notify hook arms a pending stop, the next response.completed commits idle.
        // Also poll briefly for a visible choice menu.
        if (eventName === 'codex.sse_event' && attrs['event.kind'] === 'response.completed') {
          const pendingStopAt = codexPendingStop.get(resolvedId);
          if (hasPendingToolState(resolvedId)) {
            // Tool execution is still in-flight; this completion only closed the
            // function-call phase, not the user's full turn.
          } else if (pendingStopAt && Date.now() - pendingStopAt <= 5000) {
            // console.log(`[codex] complete matched pending-stop session=${resolvedId.slice(0,8)} age=${Date.now() - pendingStopAt}ms`);
            codexPendingStop.delete(resolvedId);
            codexOutputDone.delete(resolvedId);
            scheduleCodexIdle(resolvedId, 'telemetry-stop');
          } else {
            const outputDoneAt = codexOutputDone.get(resolvedId);
            if (outputDoneAt && Date.now() - outputDoneAt <= 5000) {
              // console.log(`[codex] complete matched output-item.done fallback session=${resolvedId.slice(0,8)} age=${Date.now() - outputDoneAt}ms`);
              codexOutputDone.delete(resolvedId);
              scheduleCodexIdle(resolvedId, 'telemetry-fallback');
            } else {
              // console.log(`[codex] response.completed with no notify-stop and no output-item.done fallback session=${resolvedId.slice(0,8)} outputDone=${outputDoneAt ? Date.now() - outputDoneAt + 'ms' : 'none'}`);
            }
          }
          startCodexMenuPoll(resolvedId);
        }
        // Codex: tool_decision → user approved, cancel menu poll, back to working
        if (eventName === 'codex.tool_decision') {
          codexPendingStop.delete(resolvedId);
          codexOutputDone.delete(resolvedId);
          if ((attrs.decision || '').toLowerCase() !== 'denied') {
            addPendingTool(resolvedId, attrs.call_id || attrs['call.id']);
          } else {
            codexToolPhasePending.delete(resolvedId);
          }
          cancelCodexMenuPoll(resolvedId);
          broadcastFn?.({ type: 'session.status', id: resolvedId, working: true, source: 'telemetry' });
        }
        if (eventName === 'codex.tool_result') {
          codexToolPhasePending.delete(resolvedId);
          resolvePendingTool(resolvedId, attrs.call_id || attrs['call.id']);
        }
        // Codex: user_prompt or next sse_event cancels menu poll
        if ((eventName === 'codex.user_prompt' || (eventName === 'codex.sse_event' && attrs['event.kind'] !== 'response.completed'))) {
          codexOutputDone.delete(resolvedId);
          cancelCodexMenuPoll(resolvedId);
        }

        // Codex: use conversation.id (maps to thread-id in notify hook)
        const agentSessionId = serviceName === 'codex_cli_rs'
          ? attrs['conversation.id']
          : (attrs['session.id'] || attrs['conversation.id']);
        if (agentSessionId && sess) {
          // Prefer interactive session ID (Gemini sends non-interactive init events first)
          const dominated = sess.sessionToken && attrs['interactive'] === true;
          if (!sess.sessionToken || dominated) {
            sess.sessionToken = agentSessionId;
            console.log(`Telemetry: captured session ID ${agentSessionId} for ${agent} (${resolvedId.slice(0, 8)})`);
          }
        }
      }
    }

  }

  res.writeHead(200).end('{}');
}

// Watch a newly spawned session — if no telemetry arrives, notify frontend
function watchSession(sessionId, bin) {
  if (pendingSetup.has(sessionId)) return;
  const timer = setTimeout(() => {
    pendingSetup.delete(sessionId);
    // Don't fire if telemetry arrived between timer start and now
    if (!activity.has(sessionId)) {
      broadcastFn?.({ type: 'session.needsSetup', id: sessionId });
    }
  }, 10000);
  pendingSetup.set(sessionId, { timer, bin });
}

function cancelPendingSetup(sessionId) {
  const pending = pendingSetup.get(sessionId);
  if (pending) {
    clearTimeout(pending.timer);
    pendingSetup.delete(sessionId);
  }
}

// Codex: after response.completed, poll terminal capture every 500ms for up to 3s
function startCodexMenuPoll(id) {
  cancelCodexMenuPoll(id);
  const started = Date.now();
  const poll = setInterval(() => {
    if (Date.now() - started > 3000) { cancelCodexMenuPoll(id); return; }
    // console.log(`[terminal.capture] session=${id.slice(0,8)} source=codex-menu-poll`);
    broadcastFn?.({ type: 'terminal.capture', id });
  }, 500);
  codexMenuPoll.set(id, poll);
}

function cancelCodexMenuPoll(id) {
  const timer = codexMenuPoll.get(id);
  if (timer) { clearInterval(timer); codexMenuPoll.delete(id); }
}

function armCodexStop(id) {
  codexPendingStop.set(id, Date.now());
  codexOutputDone.delete(id);
  // console.log(`[codex] pending-stop armed session=${id.slice(0,8)}`);
}

function markCodexStart(id, source = 'hook') {
  codexPendingStop.delete(id);
  codexOutputDone.delete(id);
  codexToolPhasePending.delete(id);
  clearPendingTools(id);
  cancelCodexPendingIdle(id);
  broadcastFn?.({ type: 'session.status', id, working: true, source });
}

function markCodexIdle(id, source = 'hook') {
  codexPendingStop.delete(id);
  codexOutputDone.delete(id);
  codexToolPhasePending.delete(id);
  clearPendingTools(id);
  scheduleCodexIdle(id, source);
}

function scheduleCodexIdle(id, source) {
  cancelCodexPendingIdle(id);
  const timer = setTimeout(() => {
    codexPendingIdle.delete(id);
    broadcastFn?.({ type: 'session.status', id, working: false, source });
  }, 300);
  codexPendingIdle.set(id, timer);
}

function cancelCodexPendingIdle(id) {
  const timer = codexPendingIdle.get(id);
  if (timer) { clearTimeout(timer); codexPendingIdle.delete(id); }
}

function clear(id) {
  activity.delete(id);
  lastEvent.delete(id);
  cancelCodexMenuPoll(id);
  cancelCodexPendingIdle(id);
  codexPendingStop.delete(id);
  codexOutputDone.delete(id);
  codexToolPhasePending.delete(id);
  clearPendingTools(id);
  tokenStats.delete(id);
  const pending = pendingSetup.get(id);
  if (pending) { clearTimeout(pending.timer); pendingSetup.delete(id); }
}

// Snapshot of token usage for a session. Returns null if nothing recorded.
// byCallId is converted from Map → plain object for easy serialization.
function getTokenStats(id) {
  const bucket = tokenStats.get(id);
  if (!bucket) return null;
  const byCallId = {};
  for (const [k, v] of bucket.byCallId) byCallId[k] = { ...v };
  return { totals: { ...bucket.totals }, byCallId };
}

function getLastEvent(id) { return lastEvent.get(id) || ''; }

// Returns true if we've received telemetry events for this session
function hasEvents(id) {
  return activity.has(id);
}

module.exports = { init, handleLogs, clear, hasEvents, getLastEvent, cancelCodexMenuPoll, watchSession, armCodexStop, markCodexStart, markCodexIdle, getTokenStats };
