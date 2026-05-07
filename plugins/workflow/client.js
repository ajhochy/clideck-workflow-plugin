// Workflow plugin — toolbar button + panel UI
// API provided by CliDeck frontend loader (app.js):
//   api.send(event, data)          → sends to backend onFrontendMessage handler
//   api.onMessage(event, fn)       → receives from backend sendToFrontend
//   api.addToolbarButton(opts)     → returns DOM button element
//   api.getActiveSessionId()       → active session id (string | null)
//   api.toast(message, opts)       → show a toast notification

let _api = null;
let panelEl = null;
let visible = false;
let pendingResumables = null;
let expandedId = null;

const STAGE_ORDER = ['planning', 'issues', 'pipeline', 'smoketest'];
const STAGE_LABELS = { planning: 'Planning', issues: 'Issues', pipeline: 'Pipeline', smoketest: 'Smoke test' };

// ---------------------------------------------------------------------------
// Panel DOM bootstrap
// ---------------------------------------------------------------------------

function ensurePanel() {
  if (panelEl) return panelEl;
  panelEl = document.createElement('div');
  panelEl.className = 'workflow-panel';
  panelEl.style.cssText = [
    'position:absolute',
    'top:48px',
    'right:12px',
    'width:380px',
    'max-height:80vh',
    'overflow:auto',
    'background:#1f2937',
    'color:#e5e7eb',
    'border:1px solid #374151',
    'border-radius:8px',
    'padding:12px',
    'display:none',
    'z-index:1000',
    'font-family:ui-sans-serif,system-ui,sans-serif',
    'font-size:14px',
    'box-sizing:border-box',
  ].join(';');
  document.body.appendChild(panelEl);
  return panelEl;
}

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

function render(list) {
  const p = ensurePanel();
  p.innerHTML = '';

  // Header row
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';

  const title = document.createElement('strong');
  title.textContent = 'Workflows';
  header.appendChild(title);

  const newBtn = document.createElement('button');
  newBtn.textContent = '+ New';
  newBtn.style.cssText = 'background:#374151;border:none;color:#e5e7eb;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:13px;';
  newBtn.onmouseenter = () => { newBtn.style.background = '#4b5563'; };
  newBtn.onmouseleave = () => { newBtn.style.background = '#374151'; };
  newBtn.onclick = () => renderForm();
  header.appendChild(newBtn);

  p.appendChild(header);

  // Resumables banner
  if (pendingResumables && pendingResumables.length) {
    const banner = document.createElement('div');
    banner.style.cssText = 'background:#1f3a5f;border:1px solid #3b82f6;padding:8px;margin-bottom:8px;border-radius:6px;';
    banner.innerHTML = '<strong>In-flight workflows</strong><div style="font-size:12px;opacity:0.8;margin-bottom:6px;">From a previous session.</div>';
    for (const w of pendingResumables) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-top:4px;';
      row.innerHTML = `<span>${w.title} <span style="opacity:0.7;font-size:11px">(stage: ${w.currentStage})</span></span>`;
      const btn = document.createElement('button');
      btn.textContent = 'Resume';
      btn.onclick = () => { _api.send('resume', { id: w.id }); pendingResumables = pendingResumables.filter((x) => x.id !== w.id); _api.send('list'); };
      row.appendChild(btn);
      banner.appendChild(row);
    }
    p.appendChild(banner);
  }

  // Empty state
  if (!list || !list.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'opacity:0.7;padding:16px 0;text-align:center;';
    empty.textContent = 'No workflows yet.';
    p.appendChild(empty);
    return;
  }

  // Workflow rows
  for (const w of list) {
    const isExpanded = w.id === expandedId;
    const row = document.createElement('div');
    row.style.cssText = 'border:1px solid #374151;border-radius:6px;padding:8px;margin-bottom:6px;cursor:pointer;';
    row.onclick = (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'TEXTAREA') return;
      expandedId = isExpanded ? null : w.id;
      _api.send('list');
    };

    const titleDiv = document.createElement('div');
    titleDiv.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
    const strong = document.createElement('strong');
    strong.textContent = w.title || w.id || '(untitled)';
    titleDiv.appendChild(strong);
    const chevron = document.createElement('span');
    chevron.textContent = isExpanded ? '▲' : '▼';
    chevron.style.cssText = 'font-size:10px;opacity:0.6;';
    titleDiv.appendChild(chevron);
    row.appendChild(titleDiv);

    const metaDiv = document.createElement('div');
    metaDiv.style.cssText = 'font-size:12px;opacity:0.8;margin-top:2px;';
    metaDiv.textContent = `${w.projectId || '—'} · ${w.branch || '(no branch)'}`;
    row.appendChild(metaDiv);

    const stageDiv = document.createElement('div');
    stageDiv.style.cssText = 'font-size:12px;margin-top:4px;';
    stageDiv.textContent = `Stage: ${w.currentStage || 'unknown'}`;
    row.appendChild(stageDiv);

    if (isExpanded) {
      const detail = document.createElement('div');
      detail.style.cssText = 'margin-top:8px;border-top:1px solid #374151;padding-top:8px;';

      // Stage checklist
      const stageList = document.createElement('div');
      stageList.style.cssText = 'margin-bottom:8px;';
      const currentIdx = STAGE_ORDER.indexOf(w.currentStage);
      for (let i = 0; i < STAGE_ORDER.length; i++) {
        const sName = STAGE_ORDER[i];
        const sLine = document.createElement('div');
        sLine.style.cssText = 'font-size:12px;margin-bottom:2px;';
        const isPast = currentIdx > i || w.currentStage === 'done';
        const isCurrent = currentIdx === i && w.currentStage !== 'done' && w.currentStage !== 'failed';
        const dot = isPast ? '●' : '○';
        const label = STAGE_LABELS[sName] || sName;
        sLine.innerHTML = `<span style="opacity:${isPast ? '1' : '0.4'}">${dot}</span> `;
        const labelSpan = document.createElement('span');
        labelSpan.textContent = label;
        if (isCurrent) labelSpan.style.fontWeight = 'bold';
        sLine.appendChild(labelSpan);
        stageList.appendChild(sLine);
      }
      detail.appendChild(stageList);

      // Open session button
      const openBtn = document.createElement('button');
      openBtn.textContent = 'Open active session';
      openBtn.style.cssText = 'background:#374151;border:none;color:#e5e7eb;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:12px;margin-bottom:6px;';
      openBtn.onclick = (e) => { e.stopPropagation(); _api.send('openSession', { id: w.id }); };
      detail.appendChild(openBtn);

      // Planning chat box
      if (w.currentStage === 'planning') {
        const chatWrap = document.createElement('div');
        chatWrap.style.cssText = 'margin-top:6px;';
        const chatLabel = document.createElement('div');
        chatLabel.style.cssText = 'font-size:11px;opacity:0.7;margin-bottom:4px;';
        chatLabel.textContent = 'Send message to planning agent:';
        chatWrap.appendChild(chatLabel);
        const textarea = document.createElement('textarea');
        textarea.style.cssText = 'width:100%;background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:4px;padding:5px;font-size:12px;box-sizing:border-box;resize:vertical;height:56px;font-family:inherit;';
        textarea.placeholder = 'Type a message…';
        textarea.onclick = (e) => e.stopPropagation();
        chatWrap.appendChild(textarea);
        const sendBtn = document.createElement('button');
        sendBtn.textContent = 'Send';
        sendBtn.style.cssText = 'background:#4f46e5;border:none;color:#fff;padding:3px 10px;border-radius:4px;cursor:pointer;font-size:12px;margin-top:4px;';
        sendBtn.onclick = (e) => {
          e.stopPropagation();
          const text = textarea.value.trim();
          if (!text) return;
          _api.send('chat', { id: w.id, text });
          textarea.value = '';
        };
        chatWrap.appendChild(sendBtn);
        detail.appendChild(chatWrap);
      }

      // Failure: error context + retry button
      if (w.currentStage === 'failed') {
        const failWrap = document.createElement('div');
        failWrap.style.cssText = 'margin-top:6px;';
        if (w.stageFailures && Object.keys(w.stageFailures).length) {
          const errPre = document.createElement('pre');
          errPre.style.cssText = 'font-size:11px;color:#f87171;background:#1f0a0a;padding:6px;border-radius:4px;overflow:auto;max-height:80px;white-space:pre-wrap;';
          const failEntries = Object.entries(w.stageFailures);
          const lastFail = failEntries[failEntries.length - 1];
          errPre.textContent = `${lastFail[0]}: ${JSON.stringify(lastFail[1]).slice(0, 200)}`;
          failWrap.appendChild(errPre);
        }
        const retryBtn = document.createElement('button');
        retryBtn.textContent = 'Retry (open session)';
        retryBtn.style.cssText = 'background:#7f1d1d;border:none;color:#fca5a5;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:12px;margin-top:4px;';
        retryBtn.onclick = (e) => { e.stopPropagation(); _api.send('openSession', { id: w.id }); };
        failWrap.appendChild(retryBtn);
        detail.appendChild(failWrap);
      }

      row.appendChild(detail);
    }

    p.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// Form view
// ---------------------------------------------------------------------------

function renderForm() {
  const p = ensurePanel();
  p.innerHTML = '';

  // Header
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;';
  const title = document.createElement('strong');
  title.textContent = 'New Workflow';
  header.appendChild(title);

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'background:#374151;border:none;color:#e5e7eb;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:13px;';
  cancelBtn.onmouseenter = () => { cancelBtn.style.background = '#4b5563'; };
  cancelBtn.onmouseleave = () => { cancelBtn.style.background = '#374151'; };
  cancelBtn.onclick = () => {
    requestList();
  };
  header.appendChild(cancelBtn);
  p.appendChild(header);

  const inputStyle = 'width:100%;background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:4px;padding:6px;font-size:13px;box-sizing:border-box;margin-bottom:8px;font-family:inherit;';
  const labelStyle = 'display:block;margin-bottom:4px;font-size:12px;opacity:0.8;';

  // Description field
  const descLabel = document.createElement('label');
  descLabel.style.cssText = labelStyle;
  descLabel.textContent = 'Description';
  p.appendChild(descLabel);

  const descArea = document.createElement('textarea');
  descArea.id = 'wf-desc';
  descArea.style.cssText = inputStyle + 'height:120px;resize:vertical;';
  p.appendChild(descArea);

  // Title field (optional)
  const titleLabel = document.createElement('label');
  titleLabel.style.cssText = labelStyle;
  titleLabel.textContent = 'Title (optional)';
  p.appendChild(titleLabel);

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.id = 'wf-title';
  titleInput.style.cssText = inputStyle;
  p.appendChild(titleInput);

  // Branch field
  const branchLabel = document.createElement('label');
  branchLabel.style.cssText = labelStyle;
  branchLabel.textContent = 'Branch';
  p.appendChild(branchLabel);

  const branchInput = document.createElement('input');
  branchInput.type = 'text';
  branchInput.id = 'wf-branch';
  branchInput.placeholder = 'auto';
  branchInput.style.cssText = inputStyle;
  p.appendChild(branchInput);

  // Warning text
  const warnEl = document.createElement('div');
  warnEl.id = 'wf-warn';
  warnEl.style.cssText = 'color:#fbbf24;font-size:12px;margin-bottom:8px;min-height:16px;';
  p.appendChild(warnEl);

  // Start button
  const startBtn = document.createElement('button');
  startBtn.textContent = 'Start';
  startBtn.style.cssText = 'background:#4f46e5;border:none;color:#fff;padding:6px 16px;border-radius:4px;cursor:pointer;font-size:13px;width:100%;';
  startBtn.onmouseenter = () => { startBtn.style.background = '#4338ca'; };
  startBtn.onmouseleave = () => { startBtn.style.background = '#4f46e5'; };
  startBtn.onclick = () => {
    const description = descArea.value.trim();
    const wfTitle = titleInput.value.trim();
    const branch = branchInput.value.trim();
    warnEl.textContent = '';

    if (!description) {
      warnEl.textContent = 'Description is required.';
      return;
    }

    // TODO: CliDeck frontend API (app.js) exposes no getActiveProjectId().
    // Only getActiveSessionId() is available. Replace 'unknown' with a real
    // projectId lookup if the API is extended in the future.
    const projectId = 'unknown';

    _api.send('create', { description, title: wfTitle, branch, projectId });
    startBtn.disabled = true;
    startBtn.style.opacity = '0.6';
    startBtn.textContent = 'Starting…';
  };
  p.appendChild(startBtn);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requestList() {
  _api.send('list');
}

function toggle() {
  visible = !visible;
  ensurePanel().style.display = visible ? 'block' : 'none';
  if (visible) requestList();
}

// ---------------------------------------------------------------------------
// Init (called by CliDeck frontend loader)
// ---------------------------------------------------------------------------

export function init(api) {
  _api = api;

  // Receive workflow list from backend
  api.onMessage('list', (msg) => {
    const workflows = Array.isArray(msg?.workflows) ? msg.workflows : [];
    render(workflows);
  });

  // Workflow created successfully — go back to list
  api.onMessage('created', () => {
    requestList();
  });

  // Resume prompt from backend — show in-flight workflows banner
  api.onMessage('resume-prompt', ({ workflows }) => {
    if (!workflows || !workflows.length) return;
    // Open the panel and insert a banner section at the top
    visible = true;
    ensurePanel().style.display = 'block';
    // After the next render, insert the banner. Simplest: maintain a pendingResumables variable and have render() pick it up.
    pendingResumables = workflows;
    _api.send('list'); // trigger a re-render
  });

  // Focus a session when the backend asks
  api.onMessage('focusSession', ({ sessionId }) => {
    if (sessionId && typeof api.focusSession === 'function') api.focusSession(sessionId);
  });

  // Warning from backend (e.g. branch conflict, validation)
  api.onMessage('warn', (msg) => {
    const warnEl = document.getElementById('wf-warn');
    const text = msg.message || msg.warn || String(msg);
    if (warnEl) {
      warnEl.textContent = text;
      // Re-enable start button if it was disabled
      const startBtn = document.querySelector('#wf-start, button[disabled]');
      if (startBtn) {
        startBtn.disabled = false;
        startBtn.style.opacity = '';
        startBtn.textContent = 'Start';
      }
    } else {
      api.toast(text, { type: 'warn' });
    }
  });

  // Toolbar button
  api.addToolbarButton({
    title: 'Workflows',
    icon: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M3 12h18M3 18h18"/><circle cx="7" cy="6" r="1" fill="currentColor"/><circle cx="7" cy="12" r="1" fill="currentColor"/><circle cx="7" cy="18" r="1" fill="currentColor"/></svg>',
    onClick: toggle,
  });
}
