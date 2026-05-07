export function binName(command) {
  const m = command.match(/^(['"])(.*?)\1/);
  const exec = m ? m[2] : command;
  return exec.split(/[\\/]/).pop().split(/\s/)[0].replace(/\.(exe|cmd)$/i, '');
}

export function esc(s) {
  return s.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

export function miniMarkdown(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-slate-200 font-semibold">$1</strong>')
    .replace(/`(.+?)`/g, '<code class="px-1 py-0.5 rounded bg-slate-700/60 text-slate-300 text-[11px]">$1</code>')
    .replace(/^[-•]\s+(.+)$/gm, '<li class="ml-3">$1</li>')
    .replace(/(<li.*<\/li>\n?)+/g, '<ul class="list-disc pl-2 space-y-0.5">$&</ul>')
    .replace(/\n/g, '<br>');
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// crypto.randomUUID is gated to secure contexts (HTTPS or localhost). When the
// app is served over plain HTTP to a remote browser, it's undefined and calling
// it throws — silently breaking handlers. crypto.getRandomValues works in any
// context, so build a v4 UUID from it as a fallback.
export function randomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, x => x.toString(16).padStart(2, '0'));
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
}

const TERMINAL_SVG = `<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`;

const ICON_VARIANTS = {
  '/img/claude-code.png': { all: '/img/claude-all.png' },
  '/img/codex.png': { dark: '/img/codex-dark.png', light: '/img/codex-light.png' },
  '/img/gemini.png': { all: '/img/gemini-all.png' },
  '/img/opencode.png': { all: '/img/opencode-all.png' },
  '/img/clideck-agent.svg': { dark: '/img/clideck-agent-dark.svg', light: '/img/clideck-agent-light.svg' },
};

export function resolveIconPath(icon) {
  if (!icon || !icon.startsWith('/')) return icon;
  const canonical = icon.replace(/-(light|dark|all)(?=\.[a-z]+$)/, '');
  const variants = ICON_VARIANTS[canonical];
  if (!variants) return icon;
  const isLight = document.documentElement.classList.contains('light');
  return (isLight ? variants.light : variants.dark) || variants.all || icon;
}

export function agentIcon(icon, px = 32) {
  const s = `width:${px}px;height:${px}px`;
  if (icon && icon.startsWith('/')) {
    return `<img src="${esc(resolveIconPath(icon))}" style="${s}" class="rounded object-cover flex-shrink-0" alt="">`;
  }
  if (icon === 'terminal') {
    return `<div style="${s}" class="rounded bg-slate-700 flex items-center justify-center text-slate-400 flex-shrink-0">${TERMINAL_SVG}</div>`;
  }
  return `<div style="${s}" class="rounded bg-slate-700 flex items-center justify-center text-lg flex-shrink-0">${icon || '?'}</div>`;
}
