// The code editor: CodeMirror 6 (vendored in js/vendor) with what a Go IDE adds on top:
// completion from the real standard library API (js/goapi.json, written by tools/genapi),
// hover tips, live compiler errors from the real Go compiler, gofmt, automatic imports,
// snippets, search, folding, bracket matching, multiple cursors.
import * as CM from './vendor/codemirror.js';

const { EditorView, EditorState, keymap, tags: t } = CM;
const PATHS = { atomic: 'sync/atomic', binary: 'encoding/binary', crc32: 'hash/crc32', filepath: 'path/filepath', fs: 'io/fs', hex: 'encoding/hex', rand: 'math/rand', sha256: 'crypto/sha256', utf8: 'unicode/utf8' };
const pathOf = (name) => PATHS[name] || name;
const KEYWORDS = 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var'.split(' ');
const NOT_VARS = new Set([...KEYWORDS, 'new', 'make', 'len', 'cap', 'append', 'copy', 'delete', 'panic', 'recover', 'print', 'println', 'nil', 'true', 'false', 'iota', 'string', 'int', 'bool', 'byte', 'error']);
const BUILTINS = [['len', 'len(v) int'], ['cap', 'cap(v) int'], ['make', 'make(T, size) T'], ['new', 'new(T) *T'], ['append', 'append(s []T, x ...T) []T'], ['copy', 'copy(dst, src []T) int'], ['delete', 'delete(m, key)'], ['panic', 'panic(v any)'], ['recover', 'recover() any'], ['close', 'close(c)'], ['min', 'min(x, y) T'], ['max', 'max(x, y) T']];
const TYPES = ['string', 'int', 'int64', 'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'byte', 'bool', 'error', 'float64', 'rune', 'any', 'uintptr'];
const SNIPPETS = [
  ['iferr', 'if err != nil {\n\treturn ${}err\n}', 'check an error and return it'],
  ['forr', 'for ${i}, ${v} := range ${xs} {\n\t${}\n}', 'for … range'],
  ['for', 'for ${i} := 0; ${i} < ${n}; ${i}++ {\n\t${}\n}', 'counting loop'],
  ['func', 'func ${name}(${}) ${error} {\n\t\n}', 'function'],
  ['main', 'func main() {\n\t${}\n}', 'main function'],
  ['switch', 'switch ${x} {\ncase ${v}:\n\t${}\ndefault:\n}', 'switch'],
  ['openf', '${f}, err := os.Open(${path})\nif err != nil {\n\treturn err\n}\ndefer ${f}.Close()', 'open a file, check, defer Close'],
  ['defer', 'defer ${x}.Close()', 'defer Close'],
];

// ── reading the program text ──
function importedNames(text) {
  const names = new Set(), blocks = [...text.matchAll(/^import\s*\(([\s\S]*?)^\)/gm)].map((m) => m[1]).concat([...text.matchAll(/^import\s+(?:\w+\s+)?"[^"]+"/gm)].map((m) => m[0]));
  for (const b of blocks) for (const m of b.matchAll(/(?:(\w+)\s+)?"([\w/.-]+)"/g)) names.add(m[1] || m[2].split('/').pop());
  return names;
}
function matchClose(s, i) { let d = 0; for (; i < s.length; i++) { if (s[i] === '(') d++; else if (s[i] === ')' && --d === 0) return i; } return -1; }
// the result types of a signature: "func (l Listener) Accept() (Conn, error)" -> ["Conn", "error"]
function resultTypes(sig) {
  const start = sig.indexOf('(', sig.startsWith('func (') ? matchClose(sig, 5) + 1 : 0);   // the parameter list
  const pe = matchClose(sig, start); if (pe < 0) return [];
  const rest = sig.slice(pe + 1).trim(); if (!rest) return [];
  if (rest[0] !== '(') return [rest];
  // "(Conn, error)" or "(written int64, err error)": keep the type of each entry
  return rest.slice(1, matchClose(rest, 0)).split(',').map((x) => { x = x.trim(); const m = /^\w+ ((?:\*|\[\])*[\w.]+)$/.exec(x); return m ? m[1] : x; });
}
const parseType = (s, pkg) => {
  if (!s) return null; s = s.replace(/^(\*|\[\])+/, '');
  if (s === 'error') return { pkg: '', type: 'error' };
  let m = /^(\w+)\.(\w+)$/.exec(s); if (m) return { pkg: m[1], type: m[2] };
  if (/^[A-Z]\w*$/.test(s) && pkg) return { pkg, type: s };
  return null;
};
// which package/type each variable of the program has, as far as it can be told from the text
function inferVars(text, api) {
  const vars = new Map();
  for (const m of text.matchAll(/\b([a-z_]\w*)\s+\*?(\w+)\.([A-Z]\w*)/g)) if (!NOT_VARS.has(m[1]) && api[m[2]]?.[m[3]]?.k === 'type') vars.set(m[1], { pkg: m[2], type: m[3] });
  for (let pass = 0; pass < 3; pass++) {
    for (const m of text.matchAll(/^[ \t]*([\w, ]+?)\s*:?=\s*&?(\w+)\.(\w+)\(/gm)) {
      const [, lhs, recv, fn] = m; let item, pkg;
      if (api[recv]?.[fn]) { item = api[recv][fn]; pkg = recv; }
      else if (vars.has(recv)) { const v = vars.get(recv); item = api[v.pkg]?.[v.type + '.' + fn]; pkg = v.pkg; }
      if (!item) continue;
      const res = resultTypes(item.s);
      lhs.split(',').map((x) => x.trim()).forEach((n, i) => { const ty = parseType(res[i], pkg); if (ty && n !== '_' && /^\w+$/.test(n)) vars.set(n, ty); });
    }
  }
  if (!vars.has('err')) vars.set('err', { pkg: '', type: 'error' });
  return vars;
}
const ERROR_METHODS = { 'error.Error': { k: 'method', s: 'func (error) Error() string', d: 'Error returns the error message.', r: 'error' } };
const membersOf = (api, ty) => (ty.type === 'error' ? Object.entries(ERROR_METHODS) : Object.entries(api[ty.pkg] || {}).filter(([k]) => k.startsWith(ty.type + '.')));

function infoNode(item, title) {
  const d = document.createElement('div'); d.className = 'cm-doc';
  const sig = document.createElement('code'); sig.textContent = item.s && item.k !== 'const' && item.k !== 'var' ? item.s : title || item.s; d.append(sig);
  if (item.d) { const p = document.createElement('p'); p.textContent = item.d; d.append(p); }
  return d;
}
const detailOf = (name, item) => (item.k === 'func' || item.k === 'method' ? item.s.replace(/^func (\([^)]*\) )?\w+/, '') : item.k);
const kindOf = { func: 'function', method: 'method', type: 'type', const: 'constant', var: 'variable' };

// where an import line has to go
function importChange(doc, path) {
  const text = doc.toString(); if (importedNames(text).has(path.split('/').pop())) return null;
  const block = /^import\s*\(([^)]*)\n\)/m.exec(text);
  if (block) {
    const bodyStart = block.index + block[0].indexOf('(') + 1; const lines = block[1].split('\n'); let pos = bodyStart;
    for (const l of lines) { const m = /"([^"]+)"/.exec(l); if (m && m[1] > path) return { from: pos, insert: `\n\t"${path}"`.replace(/^\n/, '') + '\n' }; pos += l.length + 1; }
    return { from: block.index + block[0].length - 2, insert: `\n\t"${path}"` };
  }
  const single = /^import\s+("[^"]+")/m.exec(text);
  if (single) return { from: single.index, to: single.index + single[0].length, insert: `import (\n\t${single[1]}\n\t"${path}"\n)` };
  const pk = /^package\s+\w+.*$/m.exec(text);
  return pk ? { from: pk.index + pk[0].length, insert: `\n\nimport "${path}"` } : null;
}

export class Editor {
  // opts: onChange(text), onBuild(), api (goapi.json), toolchain (check/format/loaded), onStatus(info), toast(msg)
  constructor(el, opts = {}) {
    this.opts = opts; this.api = opts.api || {}; this.programmatic = CM.Annotation.define(); this.status = { errors: 0, warnings: 0, checking: false, line: 1, col: 1 };
    const self = this;
    const inString = (state, pos) => /String|Comment/.test(CM.syntaxTree(state).resolveInner(pos, -1).name);

    const complete = (ctx) => {
      if (inString(ctx.state, ctx.pos)) return null;
      const text = ctx.state.doc.toString(), api = self.api, imported = importedNames(text), vars = inferVars(text, api);
      const dot = /([A-Za-z_]\w*)\.(\w*)$/.exec(ctx.state.sliceDoc(Math.max(0, ctx.pos - 60), ctx.pos));
      if (dot) {
        const [, recv, prefix] = dot, from = ctx.pos - prefix.length; let options = [];
        if (api[recv] && !vars.has(recv)) {
          const importing = !imported.has(recv);
          options = Object.entries(api[recv]).filter(([k]) => !k.includes('.')).map(([k, it]) => ({
            label: k, type: kindOf[it.k], detail: detailOf(k, it), info: () => infoNode(it), boost: it.k === 'func' ? 1 : 0,
            apply: importing ? (view, c, f, to) => { const ch = importChange(view.state.doc, pathOf(recv)); view.dispatch({ changes: [{ from: f, to, insert: k }, ...(ch ? [ch] : [])], selection: { anchor: f + k.length }, userEvent: 'input.complete' }); } : undefined,
          }));
        } else if (vars.has(recv)) {
          options = membersOf(api, vars.get(recv)).map(([k, it]) => ({ label: k.split('.')[1], type: 'method', detail: detailOf(k, it), info: () => infoNode(it) }));
        } else {
          const seen = new Map();
          for (const [pn, items] of Object.entries(api)) if (imported.has(pn)) for (const [k, it] of Object.entries(items)) if (it.k === 'method') { const n = k.split('.')[1]; if (!seen.has(n)) seen.set(n, { label: n, type: 'method', detail: detailOf(k, it) + '  · ' + it.r, info: () => infoNode(it) }); }
          options = [...seen.values()];
        }
        return options.length ? { from, options, validFor: /^\w*$/ } : null;
      }
      const w = ctx.matchBefore(/[A-Za-z_]\w*/); if (!w && !ctx.explicit) return null;
      const from = w ? w.from : ctx.pos, options = [];
      for (const k of KEYWORDS) options.push({ label: k, type: 'keyword', boost: -2 });
      for (const k of TYPES) options.push({ label: k, type: 'type', boost: -2 });
      for (const [n, s] of BUILTINS) options.push({ label: n, type: 'function', detail: s.slice(n.length), boost: -1 });
      for (const [label, tpl, d] of SNIPPETS) options.push(CM.snippetCompletion(tpl, { label, detail: d, type: 'text', boost: 2 }));
      for (const pn of Object.keys(api)) {
        const isImp = imported.has(pn);
        options.push({ label: pn, type: 'namespace', detail: isImp ? 'package' : 'package (adds the import)', boost: isImp ? 1 : -3,
          apply: isImp ? undefined : (view, c, f, to) => { const ch = importChange(view.state.doc, pathOf(pn)); view.dispatch({ changes: [{ from: f, to, insert: pn }, ...(ch ? [ch] : [])], selection: { anchor: f + pn.length }, userEvent: 'input.complete' }); } });
      }
      const own = new Set(); const before = ctx.state.sliceDoc(0, from);
      for (const m of text.matchAll(/\b([A-Za-z_]\w{1,})\b/g)) { if (m.index >= from - 1 && m.index <= ctx.pos) continue; if (!NOT_VARS.has(m[1]) && !api[m[1]] && !own.has(m[1])) own.add(m[1]); }
      for (const n of own) options.push({ label: n, type: /\bfunc\s+n\b/.test(before) ? 'function' : 'variable', boost: 0 });
      return { from, options, validFor: /^\w*$/ };
    };

    const hover = CM.hoverTooltip((view, pos) => {
      const w = view.state.wordAt(pos); if (!w || inString(view.state, pos)) return null;
      const word = view.state.sliceDoc(w.from, w.to), text = view.state.doc.toString(), api = self.api;
      const dot = /(\w+)\.$/.exec(view.state.sliceDoc(Math.max(0, w.from - 40), w.from)); let item = null, title = null;
      const vars = inferVars(text, api);
      if (dot) {
        const recv = dot[1];
        if (api[recv]?.[word] && !vars.has(recv)) item = api[recv][word];
        else if (vars.has(recv)) { const ty = vars.get(recv); item = (ty.type === 'error' ? ERROR_METHODS : api[ty.pkg] || {})[ty.type === 'error' ? 'error.' + word : ty.type + '.' + word] || null; }
      } else if (api[word] && importedNames(text).has(word)) item = { k: 'package', s: 'package ' + word, d: `import "${pathOf(word)}"` };
      else if (vars.has(word) && word !== 'err') { const ty = vars.get(word); const it = api[ty.pkg]?.[ty.type]; item = { k: 'var', s: `${word}: ${ty.pkg ? ty.pkg + '.' : ''}${ty.type}`, d: it?.d || '' }; title = item.s; }
      else if (word === 'err' && vars.has('err')) { item = { k: 'var', s: 'err: error', d: 'The error returned by the last call that can fail. nil means it succeeded.' }; }
      else if (BUILTINS.some(([n]) => n === word)) { const b = BUILTINS.find(([n]) => n === word); item = { k: 'func', s: 'func ' + b[1], d: 'Built-in function.' }; }
      if (!item) return null;
      return { pos: w.from, end: w.to, above: true, create: () => ({ dom: infoNode(item, title) }) };
    });

    // live diagnostics: the real compiler, on a pause in typing
    const lint = CM.linter(async (view) => {
      const tc = opts.toolchain; if (!tc || !tc.loaded) return [];
      self.setStatus({ checking: true });
      const src = view.state.doc.toString(); const r = await tc.check({ 'main.go': src });
      if (view.state.doc.toString() !== src) return [];                 // typed on meanwhile: the next run will tell
      const out = [];
      if (!r.ok) for (const l of r.errors.split('\n')) {
        const m = /^main\.go:(\d+):(\d+):\s*(.*)$/.exec(l); if (!m) continue;
        const line = view.state.doc.line(Math.min(+m[1], view.state.doc.lines)); const from = Math.min(line.from + Math.max(0, +m[2] - 1), line.to);
        const word = view.state.wordAt(from); const to = word && word.from === from ? word.to : Math.min(line.to, from + 1);
        const soft = /imported and not used|declared and not used/.test(m[3]);
        out.push({ from, to: Math.max(to, from + 1) > line.to ? line.to : Math.max(to, from + 1), severity: soft ? 'warning' : 'error', message: m[3], source: 'go' });
      }
      self.setStatus({ checking: false, errors: out.filter((d) => d.severity === 'error').length, warnings: out.filter((d) => d.severity === 'warning').length });
      return out;
    }, { delay: 900 });

    const hi = CM.HighlightStyle.define([
      { tag: [t.keyword, t.operatorKeyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword], color: '#c4a5ff' },
      { tag: [t.string, t.special(t.string), t.character], color: '#8fe3b0' },
      { tag: [t.comment, t.lineComment, t.blockComment], color: '#6c7b96', fontStyle: 'italic' },
      { tag: [t.number, t.bool, t.null, t.atom, t.integer, t.float], color: '#ffcf8a' },
      { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], color: '#7cc7ff' },
      { tag: [t.typeName, t.standard(t.typeName), t.namespace], color: '#ffb454' },
      { tag: [t.propertyName, t.definition(t.propertyName)], color: '#dbe4f3' },
      { tag: [t.operator, t.punctuation], color: '#9fb0cc' },
    ]);
    const theme = EditorView.theme({
      '&': { height: '100%', backgroundColor: 'var(--code-bg)', color: 'var(--code-text)', fontSize: '13.5px' },
      '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.55' },
      '.cm-content': { caretColor: '#fff', padding: '10px 0' },
      '.cm-cursor': { borderLeftColor: '#fff' },
      '&.cm-focused': { outline: 'none' },
      '.cm-gutters': { backgroundColor: 'transparent', color: '#47556e', border: 'none' },
      '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,.04)' }, '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#8ea0bd' },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(76,201,240,.28) !important' },
      '.cm-matchingBracket': { backgroundColor: 'rgba(76,201,240,.25)', outline: '1px solid rgba(76,201,240,.5)' },
      '.cm-selectionMatch': { backgroundColor: 'rgba(255,207,138,.18)' },
      '.cm-tooltip': { border: '1px solid rgba(255,255,255,.14)', backgroundColor: '#131c2e', color: '#dbe4f3', borderRadius: '10px', overflow: 'hidden' },
      '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--mono)', fontSize: '12.5px', maxHeight: '16em' },
      '.cm-tooltip-autocomplete > ul > li': { padding: '2px 10px' },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent)', color: '#04121c' },
      '.cm-completionDetail': { color: '#8ea0bd', fontStyle: 'normal', marginLeft: '.8em' },
      'li[aria-selected] .cm-completionDetail': { color: '#04121c' },
      '.cm-completionInfo': { padding: '8px 12px', maxWidth: '420px', fontFamily: 'var(--sans)' },
      '.cm-doc code': { fontFamily: 'var(--mono)', fontSize: '12.5px', color: '#7cc7ff', background: 'none', border: 0, padding: 0, whiteSpace: 'pre-wrap', display: 'block' },
      '.cm-doc p': { margin: '6px 0 0', color: '#b4c1d8', fontSize: '13px', fontFamily: 'var(--sans)', lineHeight: 1.45 },
      '.cm-tooltip-hover': { padding: '8px 12px', maxWidth: '460px' },
      '.cm-diagnostic': { fontFamily: 'var(--sans)', fontSize: '13px', padding: '4px 10px' },
      '.cm-panels': { backgroundColor: '#131c2e', color: '#dbe4f3', borderColor: 'rgba(255,255,255,.1)' },
      '.cm-panel input, .cm-panel button, .cm-panel label': { fontFamily: 'var(--sans)', fontSize: '12.5px' },
      '.cm-panel input': { background: '#0a101b', color: '#dbe4f3', border: '1px solid rgba(255,255,255,.18)', borderRadius: '6px', padding: '2px 6px' },
      '.cm-panel button': { background: '#18233a', color: '#dbe4f3', border: '1px solid rgba(255,255,255,.14)', borderRadius: '6px', backgroundImage: 'none' },
      '.cm-searchMatch': { backgroundColor: 'rgba(255,207,138,.25)' },
      '.cm-foldPlaceholder': { backgroundColor: '#18233a', border: '1px solid rgba(255,255,255,.14)', color: '#8ea0bd' },
      '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy #ff6b86', textUnderlineOffset: '3px' },
      '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy #ffb454', textUnderlineOffset: '3px' },
    }, { dark: true });

    this.view = new EditorView({
      parent: el,
      state: EditorState.create({
        doc: '',
        extensions: [
          CM.lineNumbers(), CM.foldGutter(), CM.lintGutter(), CM.highlightActiveLine(), CM.highlightActiveLineGutter(), CM.drawSelection(), CM.rectangularSelection(), CM.crosshairCursor(),
          CM.history(), CM.indentOnInput(), CM.bracketMatching(), CM.closeBrackets(), CM.highlightSelectionMatches(), EditorState.allowMultipleSelections.of(true),
          CM.indentUnit.of('\t'), EditorState.tabSize.of(4), CM.go(), CM.syntaxHighlighting(hi), theme,
          CM.autocompletion({ override: [complete], icons: true, activateOnTyping: true, maxRenderedOptions: 60 }), hover, lint, CM.tooltips({ parent: document.body }),
          keymap.of([
            { key: 'Mod-Enter', run: () => { opts.onBuild?.(); return true; } }, { key: 'Mod-s', run: () => { opts.onBuild?.(); return true; }, preventDefault: true },
            { key: 'Shift-Alt-f', run: () => { self.format(); return true; }, preventDefault: true },
            { key: 'Mod-/', run: CM.toggleComment }, { key: 'Mod-Space', run: CM.startCompletion }, { key: 'Ctrl-Space', run: CM.startCompletion },
            ...CM.closeBracketsKeymap, ...CM.completionKeymap, ...CM.searchKeymap, ...CM.foldKeymap, ...CM.lintKeymap, ...CM.historyKeymap, CM.indentWithTab, ...CM.defaultKeymap,
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((tr) => tr.annotation(self.programmatic))) opts.onChange?.(u.state.doc.toString());
            if (u.docChanged || u.selectionSet) { const p = u.state.selection.main.head, l = u.state.doc.lineAt(p); self.setStatus({ line: l.number, col: p - l.from + 1, sel: u.state.selection.ranges.length > 1 ? u.state.selection.ranges.length : 0 }); }
          }),
        ],
      }),
    });
  }
  setStatus(p) { Object.assign(this.status, p); this.opts.onStatus?.(this.status); }
  get value() { return this.view.state.doc.toString(); }
  set value(v) { this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: v }, selection: { anchor: 0 }, annotations: this.programmatic.of(true), scrollIntoView: true }); }
  // replace the text as if the student had typed it (saves it, runs the live check)
  replace(v) { this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: v } }); }
  paint() { this.view.requestMeasure(); }
  focus() { this.view.focus(); }
  // compiler errors from a build: [{line, col, msg}]
  setProblems(list) {
    const doc = this.view.state.doc;
    this.view.dispatch(CM.setDiagnostics(this.view.state, list.map((p) => { const l = doc.line(Math.min(p.line, doc.lines)); const from = Math.min(l.from + Math.max(0, p.col - 1), l.to); const w = this.view.state.wordAt(from); return { from, to: w && w.from === from ? w.to : Math.min(l.to, from + 1) || from, severity: 'error', message: p.msg, source: 'go build' }; })));
  }
  toolchainReady() { CM.forceLinting(this.view); }
  goto(line, col = 1) {
    const doc = this.view.state.doc, l = doc.line(Math.max(1, Math.min(line, doc.lines))), from = Math.min(l.from + col - 1, l.to);
    this.view.dispatch({ selection: { anchor: from, head: l.to }, scrollIntoView: true, effects: EditorView.scrollIntoView(from, { y: 'center' }) }); this.view.focus();
  }
  // gofmt, changing only the lines that differ so the cursor and the undo history stay sane
  async format() {
    const tc = this.opts.toolchain; if (!tc) return false;
    this.opts.toast?.('Formatting…');
    const src = this.value, r = await tc.format(src);
    if (r.err) { this.opts.toast?.('gofmt cannot format code that does not parse: ' + r.err.replace(/^<standard input>:/, 'line ').slice(0, 160)); return false; }
    if (r.out === src) { this.opts.toast?.('Already formatted.'); return true; }
    let a = 0; while (a < src.length && a < r.out.length && src[a] === r.out[a]) a++;
    let b = 0; while (b < src.length - a && b < r.out.length - a && src[src.length - 1 - b] === r.out[r.out.length - 1 - b]) b++;
    this.view.dispatch({ changes: { from: a, to: src.length - b, insert: r.out.slice(a, r.out.length - b) } }); this.opts.toast?.('Formatted with gofmt.'); return true;
  }
}
