// Small shared helpers: escaping, icons, Go syntax colouring.
export function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const ICON = {
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 5.5v16M8 7h8"/></svg>',
  flask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6M10 3v6.2L4.6 18.4A2 2 0 0 0 6.3 21.5h11.4a2 2 0 0 0 1.7-3.1L14 9.2V3"/><path d="M7.5 15h9"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  sun: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  replay: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
};

// ---- Go syntax highlighting (small, good enough for our listings) ----
const KW = new Set('break default func interface select case defer go map struct chan else goto package switch const fallthrough if range type continue for import return var'.split(' '));
const TY = new Set('bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr any'.split(' '));
const LIT = new Set(['true', 'false', 'nil', 'iota']);
const RE = /(\/\/[^\n]*)|(\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|`[^`]*`|'(?:\\.|[^'\\\n])+')|(\b0[xX][0-9a-fA-F_]+\b|\b\d[\d_]*(?:\.\d+)?\b)|([A-Za-z_]\w*)|([\s\S])/g;

export function hlLine(line) {
  let out = '';
  RE.lastIndex = 0;
  let m;
  while ((m = RE.exec(line))) {
    const [t, com, com2, str, num, id] = m;
    if (com || com2) out += '<span class="tk-c">' + esc(t).replace(/TODO\([^)]*\)/g, x => `<span class="tk-todo">${x}</span>`) + '</span>';
    else if (str) out += '<span class="tk-s">' + esc(t) + '</span>';
    else if (num) out += '<span class="tk-n">' + esc(t) + '</span>';
    else if (id) {
      if (KW.has(t)) out += '<span class="tk-k">' + t + '</span>';
      else if (TY.has(t)) out += '<span class="tk-t">' + t + '</span>';
      else if (LIT.has(t)) out += '<span class="tk-n">' + t + '</span>';
      else if (line[RE.lastIndex] === '(') out += '<span class="tk-f">' + t + '</span>';
      else out += t;
    } else out += esc(t);
  }
  return out;
}
