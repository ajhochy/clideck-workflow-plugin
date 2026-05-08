const test = require('node:test');
const assert = require('node:assert');
const telemetry = require('../telemetry-receiver');

function attr(key, value) {
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { key, value: { intValue: value } }
      : { key, value: { doubleValue: value } };
  }
  return { key, value: { stringValue: String(value) } };
}

function makeBody({ sessionId, records }) {
  return {
    resourceLogs: [{
      resource: { attributes: [
        attr('clideck.session_id', sessionId),
        attr('service.name', 'claude-code'),
      ] },
      scopeLogs: [{
        logRecords: records.map((r) => ({
          attributes: Object.entries(r).map(([k, v]) => attr(k, v)),
        })),
      }],
    }],
  };
}

function fakeRes() {
  return { writeHead: () => ({ end: () => {} }) };
}

function setup() {
  const broadcasts = [];
  telemetry.init((msg) => broadcasts.push(msg), () => new Map());
  return { broadcasts };
}

test('extracts input/output/cache token counts from OTLP attrs and accumulates totals', () => {
  const { broadcasts } = setup();
  const sid = 'sess-tok-1';
  telemetry.clear(sid);

  telemetry.handleLogs({ body: makeBody({ sessionId: sid, records: [{
    'event.name': 'claude_code.api_request',
    'gen_ai.usage.input_tokens': 1200,
    'gen_ai.usage.output_tokens': 300,
    'gen_ai.usage.cache_read_input_tokens': 800,
    'gen_ai.usage.cache_creation_input_tokens': 50,
  }] }) }, fakeRes());

  telemetry.handleLogs({ body: makeBody({ sessionId: sid, records: [{
    'event.name': 'claude_code.api_request',
    'gen_ai.usage.input_tokens': 100,
    'gen_ai.usage.output_tokens': 50,
  }] }) }, fakeRes());

  const stats = telemetry.getTokenStats(sid);
  assert.deepStrictEqual(stats.totals, {
    input: 1300, output: 350, cache_read: 800, cache_creation: 50,
  });

  const tokenEvents = broadcasts.filter((m) => m.type === 'session.tokens');
  assert.strictEqual(tokenEvents.length, 2);
  assert.deepStrictEqual(tokenEvents[0].delta, { input: 1200, output: 300, cache_read: 800, cache_creation: 50 });
  assert.deepStrictEqual(tokenEvents[1].totals, { input: 1300, output: 350, cache_read: 800, cache_creation: 50 });

  telemetry.clear(sid);
});

test('correlates tokens by call_id when present', () => {
  setup();
  const sid = 'sess-tok-2';
  telemetry.clear(sid);

  telemetry.handleLogs({ body: makeBody({ sessionId: sid, records: [
    { 'event.name': 'claude_code.api_request', 'call_id': 'call-A', 'gen_ai.usage.input_tokens': 500, 'gen_ai.usage.output_tokens': 100 },
    { 'event.name': 'claude_code.api_request', 'call_id': 'call-A', 'gen_ai.usage.input_tokens': 200, 'gen_ai.usage.output_tokens': 60 },
    { 'event.name': 'claude_code.api_request', 'call_id': 'call-B', 'gen_ai.usage.input_tokens': 75,  'gen_ai.usage.output_tokens': 25 },
    { 'event.name': 'something.else',          'gen_ai.usage.input_tokens': 10,  'gen_ai.usage.output_tokens': 5 },
  ] }) }, fakeRes());

  const stats = telemetry.getTokenStats(sid);
  assert.deepStrictEqual(stats.byCallId['call-A'], { input: 700, output: 160, cache_read: 0, cache_creation: 0 });
  assert.deepStrictEqual(stats.byCallId['call-B'], { input: 75,  output: 25,  cache_read: 0, cache_creation: 0 });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(stats.byCallId, 'undefined'), false);
  assert.strictEqual(stats.totals.input, 785);
  assert.strictEqual(stats.totals.output, 190);

  telemetry.clear(sid);
});

test('records with no usage attrs do not create a bucket or broadcast', () => {
  const { broadcasts } = setup();
  const sid = 'sess-tok-3';
  telemetry.clear(sid);

  telemetry.handleLogs({ body: makeBody({ sessionId: sid, records: [
    { 'event.name': 'codex.user_prompt' },
    { 'event.name': 'codex.sse_event', 'event.kind': 'response.completed' },
  ] }) }, fakeRes());

  assert.strictEqual(telemetry.getTokenStats(sid), null);
  assert.strictEqual(broadcasts.filter((m) => m.type === 'session.tokens').length, 0);

  telemetry.clear(sid);
});

test('clear() drops accumulated stats for a session', () => {
  setup();
  const sid = 'sess-tok-4';
  telemetry.clear(sid);

  telemetry.handleLogs({ body: makeBody({ sessionId: sid, records: [
    { 'event.name': 'claude_code.api_request', 'gen_ai.usage.input_tokens': 42 },
  ] }) }, fakeRes());
  assert.strictEqual(telemetry.getTokenStats(sid).totals.input, 42);

  telemetry.clear(sid);
  assert.strictEqual(telemetry.getTokenStats(sid), null);
});

test('falls back to alternate attribute names (llm.usage.*, plain *_tokens)', () => {
  setup();
  const sid = 'sess-tok-5';
  telemetry.clear(sid);

  telemetry.handleLogs({ body: makeBody({ sessionId: sid, records: [
    { 'event.name': 'x', 'llm.usage.input_tokens': 11, 'llm.usage.output_tokens': 22, 'llm.usage.cache_read_input_tokens': 33 },
    { 'event.name': 'y', 'input_tokens': 5, 'output_tokens': 6 },
  ] }) }, fakeRes());

  const stats = telemetry.getTokenStats(sid);
  assert.deepStrictEqual(stats.totals, { input: 16, output: 28, cache_read: 33, cache_creation: 0 });

  telemetry.clear(sid);
});
