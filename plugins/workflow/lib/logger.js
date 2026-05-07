'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * createLogger({ dir, stage })
 *
 * Returns { event, prompt, error, openSessionStream }.
 * All writes are appendFileSync wrapped in try/catch — never throws.
 */
function createLogger({ dir, stage }) {
  const logsDir = path.join(dir, 'logs');
  const wf = path.basename(dir);

  // Ensure logs directory exists (best-effort).
  try {
    fs.mkdirSync(logsDir, { recursive: true });
  } catch (_) {
    // If we can't create the dir, writes will silently fail below.
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  function logPath(filename) {
    return path.join(logsDir, filename);
  }

  function appendLine(filePath, line) {
    try {
      fs.appendFileSync(filePath, line + '\n');
    } catch (_) {
      // Intentionally swallowed — logging must never throw.
    }
  }

  function buildLine(type, payload) {
    return JSON.stringify(
      Object.assign({ ts: new Date().toISOString(), wf, stage, type }, payload)
    );
  }

  // ── public API ────────────────────────────────────────────────────────────

  /**
   * Append a JSON event line to {stage}.log AND events.log.
   */
  function event(type, data) {
    const line = buildLine(type, data || {});
    appendLine(logPath(`${stage}.log`), line);
    appendLine(logPath('events.log'), line);
  }

  /**
   * Append an event line (type='prompt') to events.log + {stage}.log,
   * and a plain-text section to {stage}.prompt.log.
   */
  function prompt(target, text) {
    const line = buildLine('prompt', { target });
    appendLine(logPath(`${stage}.log`), line);
    appendLine(logPath('events.log'), line);

    const iso = new Date().toISOString();
    const section = `----- ${iso} → ${target} -----\n${text}\n\n`;
    try {
      fs.appendFileSync(logPath(`${stage}.prompt.log`), section);
    } catch (_) {
      // Swallowed.
    }
  }

  /**
   * Append a JSON error line to errors.log, events.log, AND {stage}.log.
   */
  function error(err) {
    const line = buildLine('error', {
      message: err && err.message ? err.message : String(err),
      stack: err && err.stack ? err.stack : undefined,
    });
    appendLine(logPath(`${stage}.log`), line);
    appendLine(logPath('events.log'), line);
    appendLine(logPath('errors.log'), line);
  }

  /**
   * Open a streaming session log.
   * Returns { onData(chunk), close(exitInfo) }.
   */
  function openSessionStream(sessionId, label) {
    const sessionFile = logPath(`${stage}-session-${sessionId}.log`);
    const openedIso = new Date().toISOString();
    const header = `===== session ${sessionId} (${label}) opened ${openedIso} =====\n`;

    try {
      fs.appendFileSync(sessionFile, header);
    } catch (_) {
      // Swallowed.
    }

    let closed = false;

    function onData(chunk) {
      try {
        fs.appendFileSync(sessionFile, chunk);
      } catch (_) {
        // Swallowed.
      }
    }

    function close(exitInfo) {
      if (closed) return; // Idempotent.
      closed = true;
      const closedIso = new Date().toISOString();
      const footer = `===== session ${sessionId} closed ${closedIso} ${JSON.stringify(exitInfo || {})} =====\n`;
      try {
        fs.appendFileSync(sessionFile, footer);
      } catch (_) {
        // Swallowed.
      }
    }

    return { onData, close };
  }

  return { event, prompt, error, openSessionStream };
}

module.exports = { createLogger };
