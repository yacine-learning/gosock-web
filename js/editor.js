// The code editor: CodeMirror 6 (vendored in js/vendor) with what a Go IDE adds on top:
// completion from the real standard library API (js/goapi.json, written by tools/genapi),
// hover documentation and signature help as gopls shows them (js/godoc/<pkg>.json, fetched
// when first needed), live compiler errors from the real Go compiler, gofmt, automatic
// imports, snippets, search, folding, bracket matching, multiple cursors. It looks like
// VS Code with the One Dark Pro theme.
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
const detailOf = (name, item) => (item.k === 'func' || item.k === 'method' ? item.s.replace(/^func (\([^)]*\) )?\w+/, '') : item.k);
const kindOf = { func: 'function', method: 'method', type: 'type', const: 'constant', var: 'variable' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ── the whole documentation: js/godoc/<pkg>.json (tools/genapi), fetched the first time it is needed ──
const DOCS = {}, READY = {};
function docs(pkg) {
  return (DOCS[pkg] ??= fetch(new URL(`./godoc/${pkg}.json`, import.meta.url)).then((r) => (r.ok ? r.json() : {})).catch(() => ({})).then((d) => (READY[pkg] = d)));
}

// the program's own functions: name -> { s, a, res, h }, with the comment above as documentation
function splitTop(s) {
  const out = []; let d = 0, cur = '';
  for (const c of s) { if ('([{'.includes(c)) d++; else if (')]}'.includes(c)) d--; if (c === ',' && d === 0) { out.push(cur); cur = ''; } else cur += c; }
  if (cur.trim()) out.push(cur); return out.map((x) => x.trim()).filter(Boolean);
}
// "a, b int, c string" -> ["a int", "b int", "c string"]
function expandParams(p) {
  const parts = splitTop(p), out = []; let ty = null;
  for (let i = parts.length - 1; i >= 0; i--) {
    const m = /^(\w+)\s+(.+)$/.exec(parts[i]);
    if (m) { ty = m[2]; out.unshift(parts[i]); } else if (ty && /^\w+$/.test(parts[i])) out.unshift(parts[i] + ' ' + ty); else out.unshift(parts[i]);
  }
  return out;
}
function ownFuncs(text) {
  const out = new Map();
  for (const m of text.matchAll(/((?:^\/\/.*\n)*)^func\s+(\w+)\s*\(([^)]*)\)\s*([^{\n]*?)\s*\{/gm)) {
    const [, comment, name, params, res] = m, a = expandParams(params);
    const paras = comment.split('\n').map((l) => l.replace(/^\/\/ ?/, '')).join('\n').trim().split(/\n\s*\n/).filter(Boolean);
    out.set(name, { s: `func ${name}(${a.join(', ')})${res ? ' ' + res : ''}`, a, res, v: /\.\.\./.test(a[a.length - 1] || ''), h: paras.map((x) => '<p>' + esc(x)).join('\n') });
  }
  return out;
}

// One Dark Pro colours for a signature, without a parser: keywords, types, functions, parameters
const SIG_KW = new Set([...KEYWORDS, 'untyped']);
const SIG_TYPES = new Set('any bool byte comparable complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr'.split(' '));
function paintSig(code, el) {
  const re = /(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|`[^`]*`|'(?:[^'\\]|\\.)')|(\b\d[\w.]*)|([A-Za-z_]\w*)|(\s+|[^\sA-Za-z_\d"`'/]+|\/)/g;
  let m, lastWord = '';
  while ((m = re.exec(code))) {
    const [tok, com, str, num, id] = m; let cls = '';
    if (com) cls = 'c'; else if (str) cls = 's'; else if (num) cls = 'n';
    else if (id) {
      const next = /^\s*(\S?)/.exec(code.slice(re.lastIndex))[1], prev = code[m.index - 1], lineStart = /(^|\n)[ \t]*$/.test(code.slice(0, m.index));
      if (SIG_KW.has(id)) cls = 'k';
      else if (id === 'nil' || id === 'true' || id === 'false' || id === 'iota') cls = 'n';
      else if (next === '.' && prev !== '.') cls = 'p';
      else if (next === '(' && lastWord !== 'interface') cls = 'f';
      else if (lastWord === 'type' || SIG_TYPES.has(id) || prev === '.') cls = 't';
      else if (lineStart) cls = 'v';                                     // a struct field
      else cls = /^[A-Z]/.test(id) ? 't' : 'v';
      lastWord = id;
    }
    if (cls) { const sp = document.createElement('span'); sp.className = 'tk-' + cls; sp.textContent = tok; el.append(sp); } else el.append(tok);
  }
  return el;
}

// what a name in the program refers to: { pkg, key } in the documentation, { own }, or { v, ty }
function refAt(state, pos, api) {
  const w = state.wordAt(pos); if (!w) return null;
  const word = state.sliceDoc(w.from, w.to), text = state.doc.toString(), vars = inferVars(text, api);
  const dot = /(\w+)\.$/.exec(state.sliceDoc(Math.max(0, w.from - 40), w.from)); let ref = null;
  if (dot) {
    const recv = dot[1];
    if (api[recv]?.[word] && !vars.has(recv)) ref = { pkg: recv, key: word };
    else if (vars.has(recv)) {
      const ty = vars.get(recv);
      if (ty.type === 'error') ref = word === 'Error' ? { pkg: 'builtin', key: 'error.Error' } : null;
      else if (api[ty.pkg]?.[ty.type + '.' + word]) ref = { pkg: ty.pkg, key: ty.type + '.' + word };
    }
  } else if (api[word] && importedNames(text).has(word)) ref = { pkg: word, key: '' };
  else if (vars.has(word)) ref = { v: word, ty: vars.get(word) };
  else if (ownFuncs(text).has(word)) ref = { own: word, text };
  else if (READY.builtin?.[word] && !/\.\s*$/.test(state.sliceDoc(Math.max(0, w.from - 5), w.from))) ref = { pkg: 'builtin', key: word };
  return ref && { ...ref, from: w.from, to: w.to };
}
// -> { s: signature, h: documentation (HTML), url }
async function describe(ref, api) {
  if (ref.own) { const f = ownFuncs(ref.text).get(ref.own); return f && { s: f.s, h: f.h }; }
  if (ref.v) {
    const { ty } = ref, tyName = ty.pkg ? ty.pkg + '.' + ty.type : ty.type;
    const d = (await docs(ty.pkg || 'builtin'))[ty.type];
    return { s: `var ${ref.v} ${tyName}`, h: d?.h || '', url: ty.pkg ? `https://pkg.go.dev/${pathOf(ty.pkg)}#${ty.type}` : null };
  }
  const d = (await docs(ref.pkg))[ref.key], it = api[ref.pkg]?.[ref.key];
  if (!d && !it) return null;
  const url = ref.pkg === 'builtin' ? `https://pkg.go.dev/builtin${ref.key ? '#' + ref.key.split('.')[0] : ''}` : `https://pkg.go.dev/${pathOf(ref.pkg)}${ref.key ? '#' + ref.key : ''}`;
  return { s: d?.s || it.s, h: d ? d.h || '' : it.d ? '<p>' + esc(it.d) : '', url };
}
// a VS Code hover: the signature in colour, a rule, the documentation; [Name] links open in place
function docNode(ref, api) {
  const box = document.createElement('div'); box.className = 'cm-doc'; const back = [];
  const show = async (r) => {
    const d = await describe(r, api); box.replaceChildren();
    if (back.length) { const b = document.createElement('a'); b.className = 'cm-doc-back'; b.textContent = '← back'; b.href = '#'; b.onclick = (e) => { e.preventDefault(); show(back.pop()); }; box.append(b); }
    if (!d) { box.append('No documentation.'); return; }
    box.append(paintSig(d.s, Object.assign(document.createElement('pre'), { className: 'cm-doc-sig' })));
    if (d.h) { const body = document.createElement('div'); body.className = 'cm-doc-body'; body.innerHTML = d.h; box.append(body); }   // generated from Go's own sources
    if (d.url) { const f = document.createElement('div'); f.className = 'cm-doc-foot'; f.innerHTML = `<a href="${d.url}" target="_blank" rel="noopener">${esc(d.url.replace('https://', ''))}</a>`; box.append(f); }
    box.querySelectorAll('.cm-doc-body a[href^="#go:"]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault(); const [pkg, ...k] = a.getAttribute('href').slice(4).split('.'); back.push(r); show({ pkg, key: k.join('.') });
    }));
    box.querySelectorAll('.cm-doc-body a:not([href^="#go:"])').forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
  };
  return show(ref).then(() => box);
}

// ── signature help: inside the parentheses of a call, the parameters, the current one in bold ──
function callAt(state) {
  const sel = state.selection.main; if (!sel.empty) return null; const pos = sel.head;
  for (let n = CM.syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) {
    if (n.name !== 'Arguments') continue;
    const closed = state.sliceDoc(n.to - 1, n.to) === ')';
    if (pos <= n.from || (closed && pos >= n.to)) continue;
    if (n.parent?.name !== 'CallExpr') return null;
    let index = 0, last = n.from;
    for (let c = n.firstChild; c; c = c.nextSibling) if (c.name === ',' && c.to <= pos) { index++; last = c.to; }
    if (!closed && state.sliceDoc(last, pos).includes('\n')) return null;  // an unfinished call: only on its own line
    return { argsFrom: n.from, index, callee: state.sliceDoc(n.parent.from, n.from).trim() };
  }
  return null;
}
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
    this.opts = opts; this.api = opts.api || {}; docs('builtin'); this.programmatic = CM.Annotation.define(); this.status = { errors: 0, warnings: 0, checking: false, line: 1, col: 1 };
    const self = this;
    const inString = (state, pos) => /String|Comment/.test(CM.syntaxTree(state).resolveInner(pos, -1).name);

    // choosing a function inserts "name()" as gopls does: the cursor between the parentheses when it
    // takes arguments (signature help opens), after them when it takes none; nothing is added when a
    // "(" already follows. addImport(doc) may return one more change (the import line).
    const insert = (name, call, takesArgs, addImport) => (view, c, f, to) => {
      const paren = call && view.state.sliceDoc(to, to + 1) !== '(', ch = addImport?.(view.state.doc);
      const changes = view.state.changes([{ from: f, to, insert: name + (paren ? '()' : '') }, ...(ch ? [ch] : [])]);
      const at = changes.mapPos(f) + name.length + (paren ? (takesArgs ? 1 : 2) : 0);    // in the new text
      view.dispatch({ changes, selection: { anchor: at }, userEvent: 'input.complete' });
    };
    const takesArgs = (k, it) => !detailOf(k, it).startsWith('()');
    const complete = (ctx) => {
      if (inString(ctx.state, ctx.pos)) return null;
      const text = ctx.state.doc.toString(), api = self.api, imported = importedNames(text), vars = inferVars(text, api);
      const dot = /([A-Za-z_]\w*)\.(\w*)$/.exec(ctx.state.sliceDoc(Math.max(0, ctx.pos - 60), ctx.pos));
      if (dot) {
        const [, recv, prefix] = dot, from = ctx.pos - prefix.length; let options = [];
        if (api[recv] && !vars.has(recv)) {
          const importing = !imported.has(recv);
          options = Object.entries(api[recv]).filter(([k]) => !k.includes('.')).map(([k, it]) => ({
            label: k, type: kindOf[it.k], detail: detailOf(k, it), info: () => docNode({ pkg: recv, key: k }, api), boost: it.k === 'func' ? 1 : 0,
            apply: insert(k, it.k === 'func', takesArgs(k, it), importing ? (doc) => importChange(doc, pathOf(recv)) : null),
          }));
        } else if (vars.has(recv)) {
          const ty = vars.get(recv);
          options = membersOf(api, ty).map(([k, it]) => ({ label: k.split('.')[1], type: 'method', detail: detailOf(k, it), apply: insert(k.split('.')[1], true, takesArgs(k, it)), info: () => docNode(ty.type === 'error' ? { pkg: 'builtin', key: k } : { pkg: ty.pkg, key: k }, api) }));
        } else {
          const seen = new Map();
          for (const [pn, items] of Object.entries(api)) if (imported.has(pn)) for (const [k, it] of Object.entries(items)) if (it.k === 'method') { const n = k.split('.')[1]; if (!seen.has(n)) seen.set(n, { label: n, type: 'method', detail: detailOf(k, it) + '  · ' + it.r, apply: insert(n, true, takesArgs(k, it)), info: () => docNode({ pkg: pn, key: k }, api) }); }
          options = [...seen.values()];
        }
        return options.length ? { from, options, validFor: /^\w*$/ } : null;
      }
      const w = ctx.matchBefore(/[A-Za-z_]\w*/); if (!w && !ctx.explicit) return null;
      const from = w ? w.from : ctx.pos, options = [];
      for (const k of KEYWORDS) options.push({ label: k, type: 'keyword', boost: -2 });
      for (const k of TYPES) options.push({ label: k, type: 'type', boost: -2 });
      for (const [n, s] of BUILTINS) options.push({ label: n, type: 'function', detail: s.slice(n.length), boost: -1, apply: insert(n, true, !s.startsWith(n + '()')) });
      for (const [label, tpl, d] of SNIPPETS) options.push(CM.snippetCompletion(tpl, { label, detail: d, type: 'text', boost: 2 }));
      for (const pn of Object.keys(api)) {
        const isImp = imported.has(pn);
        options.push({ label: pn, type: 'namespace', detail: isImp ? 'package' : 'package (adds the import)', boost: isImp ? 1 : -3,
          apply: isImp ? undefined : insert(pn, false, false, (doc) => importChange(doc, pathOf(pn))) });
      }
      const own = new Set();
      for (const m of text.matchAll(/\b([A-Za-z_]\w{1,})\b/g)) { if (m.index >= from - 1 && m.index <= ctx.pos) continue; if (!NOT_VARS.has(m[1]) && !api[m[1]] && !own.has(m[1])) own.add(m[1]); }
      const fns = ownFuncs(text);
      for (const n of own) { const fn = fns.get(n); options.push(fn ? { label: n, type: 'function', detail: fn.s.slice(5 + n.length), boost: 0, apply: insert(n, true, fn.a.length > 0) } : { label: n, type: 'variable', boost: 0 }); }
      return { from, options, validFor: /^\w*$/ };
    };

    const hover = CM.hoverTooltip(async (view, pos) => {
      if (inString(view.state, pos)) return null;
      const ref = refAt(view.state, pos, self.api); if (!ref) return null;
      const dom = await docNode(ref, self.api);
      return { pos: ref.from, end: ref.to, above: true, create: () => ({ dom }) };
    }, { hoverTime: 350 });

    // signature help
    const sigEffect = CM.StateEffect.define();
    const sigInfo = (state, call) => {
      let m = /^(\w+)\.(\w+)$/.exec(call.callee), pkg, key;
      if (m) {
        const vars = inferVars(state.doc.toString(), self.api);
        if (self.api[m[1]] && !vars.has(m[1])) [pkg, key] = [m[1], m[2]];
        else if (vars.has(m[1])) { const ty = vars.get(m[1]); [pkg, key] = ty.type === 'error' ? ['builtin', 'error.' + m[2]] : [ty.pkg, ty.type + '.' + m[2]]; }
        else return null;
      } else if ((m = /^\w+$/.exec(call.callee))) {
        const own = ownFuncs(state.doc.toString()).get(call.callee); if (own) return { name: call.callee, ...own };
        [pkg, key] = ['builtin', call.callee];
      } else return null;
      if (!READY[pkg]) { docs(pkg).then(() => self.view?.dispatch({ effects: sigEffect.of({}) })); return null; }
      const d = READY[pkg][key]; if (!d || !d.s.startsWith('func')) return null;
      return { name: key.split('.').pop(), a: d.a || [], res: d.res || '', v: d.v, h: d.h || '' };
    };
    const sigNode = (info, index) => {
      const box = document.createElement('div'); box.className = 'cm-sighelp';
      const pre = document.createElement('pre'); paintSig(info.name, pre).querySelector('span')?.classList.add('tk-f'); pre.append('(');
      const active = info.v && index >= info.a.length - 1 ? info.a.length - 1 : index;
      info.a.forEach((p, i) => { if (i) pre.append(', '); const sp = paintSig(p, document.createElement('span')); if (i === active) sp.className = 'cm-sig-active'; pre.append(sp); });
      pre.append(')'); if (info.res) { pre.append(' '); paintSig(info.res, pre); }
      box.append(pre);
      const first = /<p>([\s\S]*?)(?=<p>|<pre>|<h\d|<ul|$)/.exec(info.h);
      if (first) { const d = document.createElement('div'); d.className = 'cm-sighelp-doc'; d.innerHTML = first[1]; d.querySelectorAll('a').forEach((a) => a.replaceWith(a.textContent)); box.append(d); }
      return box;
    };
    const sigHelp = CM.StateField.define({
      create: () => ({ tip: null, key: '', dismissed: -1 }),
      update(v, tr) {
        let dismissed = v.dismissed; const poke = tr.effects.some((e) => e.is(sigEffect));
        for (const e of tr.effects) if (e.is(sigEffect) && e.value.dismiss != null) dismissed = e.value.dismiss;
        if (!tr.docChanged && !tr.selection && !poke) return v;
        const call = callAt(tr.state);
        if (!call) return { tip: null, key: '', dismissed: -1 };
        if (call.argsFrom === dismissed) return { tip: null, key: '', dismissed };
        const info = sigInfo(tr.state, call); if (!info) return { tip: null, key: '', dismissed };
        const key = call.argsFrom + ':' + call.index + ':' + info.a.join(',');
        if (key === v.key && v.tip && !tr.docChanged) return v;
        return { key, dismissed, tip: { pos: call.argsFrom, above: true, create: () => ({ dom: sigNode(info, call.index) }) } };
      },
      provide: (f) => CM.showTooltip.compute([f], (s) => s.field(f).tip),
    });
    const sigEscape = (view) => { const v = view.state.field(sigHelp); if (!v.tip || CM.completionStatus(view.state) === 'active') return false;   // an open completion list closes first, as in VS Code
      view.dispatch({ effects: sigEffect.of({ dismiss: v.tip.pos }) }); return true; };

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

    // One Dark Pro (Binaryify's VS Code theme, after Atom's One Dark): its colours, VS Code's widgets
    const hi = CM.HighlightStyle.define([
      { tag: [t.keyword, t.operatorKeyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.modifier], color: '#c678dd' },
      { tag: [t.string, t.special(t.string), t.character, t.docString], color: '#98c379' },
      { tag: t.escape, color: '#56b6c2' },
      { tag: [t.comment, t.lineComment, t.blockComment], color: '#7f848e', fontStyle: 'italic' },
      { tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom, t.constant(t.variableName)], color: '#d19a66' },
      { tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName))], color: '#61afef' },
      { tag: [t.typeName, t.standard(t.typeName), t.definition(t.typeName), t.className, t.namespace], color: '#e5c07b' },
      { tag: [t.propertyName, t.definition(t.propertyName), t.definition(t.variableName), t.labelName], color: '#e06c75' },
      { tag: [t.standard(t.variableName), t.self], color: '#e5c07b' },
      { tag: [t.operator, t.derefOperator, t.arithmeticOperator, t.logicOperator, t.compareOperator, t.updateOperator], color: '#56b6c2' },
      { tag: [t.punctuation, t.separator, t.bracket, t.paren, t.brace, t.squareBracket, t.variableName], color: '#abb2bf' },
      { tag: t.invalid, color: '#ffffff' },
    ]);
    const theme = EditorView.theme({
      '&.cm-editor': { height: '100%', backgroundColor: '#282c34', color: '#abb2bf', fontSize: '14px' },   // not '&': the tooltip box in <body> carries the theme class too
      '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6' },
      '.cm-content': { caretColor: '#528bff', padding: '4px 0' },
      '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid #528bff' },
      '&.cm-focused': { outline: 'none' },
      '.cm-gutters': { backgroundColor: '#282c34', color: '#495162', border: 'none', paddingLeft: '8px' },
      '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 6px', minWidth: '32px' },
      '.cm-activeLine': { backgroundColor: '#2c313c' }, '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#abb2bf' },
      '.cm-selectionBackground': { backgroundColor: '#3e4451 !important' },
      '&.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: '#67769660 !important' },
      '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: '#515a6b', outline: '1px solid #515a6b', color: 'inherit' },
      '.cm-nonmatchingBracket': { color: '#e06c75' },
      '.cm-selectionMatch': { backgroundColor: '#3e445180' },
      '.cm-foldGutter .cm-gutterElement': { color: '#495162', padding: '0 4px' }, '.cm-foldGutter .cm-gutterElement:hover': { color: '#abb2bf' },
      '.cm-foldPlaceholder': { backgroundColor: '#3e4451', border: 'none', color: '#abb2bf', padding: '0 6px', borderRadius: '3px' },
      // widgets, as VS Code draws them
      '.cm-tooltip': { border: '1px solid #181a1f', backgroundColor: '#21252b', color: '#abb2bf', borderRadius: '4px', boxShadow: '0 4px 14px rgba(0,0,0,.45)' },
      '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--mono)', fontSize: '13px', maxHeight: '18em', minWidth: '320px' },
      '.cm-tooltip-autocomplete > ul > li': { padding: '1px 8px 1px 4px', lineHeight: '22px' },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: '#2c313a', color: '#d7dae0', outline: '1px solid #3e4452', outlineOffset: '-1px' },
      '.cm-completionMatchedText': { textDecoration: 'none', color: '#61afef', fontWeight: 700 },
      '.cm-completionDetail': { color: '#7f848e', fontStyle: 'normal', marginLeft: '1em', fontSize: '12px' },
      '.cm-completionIcon': { width: '18px', opacity: 1, paddingRight: '4px', textAlign: 'center' },
      '.cm-completionIcon-function, .cm-completionIcon-method': { color: '#b180d7' },
      '.cm-completionIcon-variable': { color: '#75beff' },
      '.cm-completionIcon-type, .cm-completionIcon-class': { color: '#ee9d28' },
      '.cm-completionIcon-constant': { color: '#d19a66' },
      '.cm-completionIcon-namespace, .cm-completionIcon-keyword, .cm-completionIcon-text': { color: '#9da5b4' },
      '.cm-tooltip.cm-completionInfo': { padding: '0', maxWidth: '520px', maxHeight: '22em', overflowY: 'auto' },
      '.cm-tooltip-hover': { maxWidth: '620px' },
      '.cm-doc': { fontFamily: 'var(--sans)', fontSize: '13px', maxHeight: '24em', overflowY: 'auto' },
      '.cm-doc-sig': { margin: 0, padding: '8px 12px', fontFamily: 'var(--mono)', fontSize: '13px', lineHeight: 1.5, whiteSpace: 'pre-wrap', color: '#abb2bf', background: 'none', border: 0, tabSize: 4 },
      '.cm-doc-body': { borderTop: '1px solid #3e4452', padding: '2px 12px 8px', color: '#abb2bf', lineHeight: 1.5 },
      '.cm-doc-body p': { margin: '6px 0' },
      '.cm-doc-body pre': { margin: '6px 0', padding: '6px 10px', background: '#282c34', borderRadius: '3px', fontFamily: 'var(--mono)', fontSize: '12.5px', whiteSpace: 'pre-wrap', color: '#98c379' },
      '.cm-doc-body h4': { margin: '10px 0 4px', fontSize: '13px', color: '#d7dae0' },
      '.cm-doc-body ul': { margin: '4px 0', paddingLeft: '20px' },
      '.cm-doc-body code': { fontFamily: 'var(--mono)', fontSize: '12.5px', background: 'none', border: 0, padding: 0 },
      '.cm-doc a': { color: '#61afef', textDecoration: 'none', cursor: 'pointer' }, '.cm-doc a:hover': { textDecoration: 'underline' },
      '.cm-doc-foot': { borderTop: '1px solid #3e4452', padding: '5px 12px', fontSize: '12px' },
      '.cm-doc-back': { display: 'block', padding: '5px 12px 0', fontSize: '12px' },
      '.cm-sighelp': { padding: '5px 10px', maxWidth: '620px', fontSize: '13px' },
      '.cm-sighelp pre': { margin: 0, fontFamily: 'var(--mono)', whiteSpace: 'pre-wrap', color: '#abb2bf', background: 'none', border: 0, padding: 0 },
      '.cm-sig-active': { fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: '3px', color: '#d7dae0' },
      '.cm-sighelp-doc': { borderTop: '1px solid #3e4452', marginTop: '5px', paddingTop: '4px', fontFamily: 'var(--sans)', lineHeight: 1.45 },
      '.tk-k': { color: '#c678dd' }, '.tk-s': { color: '#98c379' }, '.tk-n': { color: '#d19a66' }, '.tk-c': { color: '#7f848e', fontStyle: 'italic' },
      '.tk-f': { color: '#61afef' }, '.tk-t': { color: '#e5c07b' }, '.tk-v': { color: '#e06c75' }, '.tk-p': { color: '#abb2bf' },
      '.cm-diagnostic': { fontFamily: 'var(--sans)', fontSize: '13px', padding: '5px 10px', borderLeftWidth: '3px' },
      '.cm-diagnostic-error': { borderLeftColor: '#e05561' }, '.cm-diagnostic-warning': { borderLeftColor: '#d19a66' },
      '.cm-panels': { backgroundColor: '#21252b', color: '#abb2bf', borderColor: '#181a1f' },
      '.cm-panels.cm-panels-top': { borderBottom: '1px solid #181a1f' },
      '.cm-panel.cm-search': { padding: '6px 10px' },
      '.cm-panel input, .cm-panel button, .cm-panel label': { fontFamily: 'var(--sans)', fontSize: '12.5px' },
      '.cm-panel input[type=text], .cm-textfield': { background: '#1d1f23', color: '#d7dae0', border: '1px solid #3e4452', borderRadius: '2px', padding: '3px 6px' },
      '.cm-textfield:focus': { outline: '1px solid #528bff', borderColor: '#528bff' },
      '.cm-panel button, .cm-button': { background: '#404754', color: '#d7dae0', border: 'none', borderRadius: '2px', backgroundImage: 'none', padding: '3px 8px' },
      '.cm-searchMatch': { backgroundColor: '#42557b', outline: '1px solid #42557b' },
      '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#314365', outline: '1px solid #528bff' },
      '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy #e05561', textUnderlineOffset: '3px', textDecorationSkipInk: 'none' },
      '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy #d19a66', textUnderlineOffset: '3px', textDecorationSkipInk: 'none' },
      '.cm-lint-marker': { width: '0.8em', height: '0.8em' },
    }, { dark: true });

    this.view = new EditorView({
      parent: el,
      state: EditorState.create({
        doc: '',
        extensions: [
          CM.lineNumbers(), CM.foldGutter(), CM.lintGutter(), CM.highlightActiveLine(), CM.highlightActiveLineGutter(), CM.drawSelection(), CM.rectangularSelection(), CM.crosshairCursor(),
          CM.history(), CM.indentOnInput(), CM.bracketMatching(), CM.closeBrackets(), CM.highlightSelectionMatches(), EditorState.allowMultipleSelections.of(true),
          CM.indentUnit.of('\t'), EditorState.tabSize.of(4), CM.go(), CM.syntaxHighlighting(hi), theme,
          CM.Prec.highest(keymap.of([{ key: 'Escape', run: sigEscape }])), CM.autocompletion({ override: [complete], icons: true, activateOnTyping: true, maxRenderedOptions: 60 }), hover, lint, sigHelp, CM.tooltips({ parent: document.body }),
          keymap.of([
            { key: 'Mod-Enter', run: () => { opts.onBuild?.(); return true; } }, { key: 'Mod-s', run: () => { opts.onBuild?.(); return true; }, preventDefault: true },
            { key: 'Shift-Alt-f', run: () => { self.format(); return true; }, preventDefault: true },
            { key: 'Mod-/', run: CM.toggleComment }, { key: 'Mod-Space', run: CM.startCompletion }, { key: 'Ctrl-Space', run: CM.startCompletion },
            ...CM.closeBracketsKeymap, ...CM.completionKeymap, ...CM.searchKeymap, ...CM.foldKeymap, ...CM.lintKeymap, ...CM.historyKeymap, CM.indentWithTab, ...CM.defaultKeymap,
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((tr) => tr.annotation(self.programmatic))) opts.onChange?.(u.state.doc.toString());
            if (u.docChanged || u.selectionSet) {
              const p = u.state.selection.main.head, l = u.state.doc.lineAt(p), before = u.state.sliceDoc(0, l.to);
              const fn = [...before.matchAll(/^func\s+(?:\(([^)]*)\)\s*)?(\w+)/gm)].pop(), inFn = fn && !/^\}/m.test(before.slice(fn.index + fn[0].length, l.from));
              self.setStatus({ line: l.number, col: p - l.from + 1, sel: u.state.selection.ranges.length > 1 ? u.state.selection.ranges.length : 0, func: inFn ? (fn[1] ? `(${fn[1].trim().split(/\s+/).pop()}).` : '') + fn[2] : '' });
            }
            if (u.docChanged) { clearTimeout(self.pre); self.pre = setTimeout(() => { for (const n of importedNames(u.state.doc.toString())) if (self.api[n]) docs(n); }, 300); }
          }),
        ],
      }),
    });
  }
  setStatus(p) { Object.assign(this.status, p); this.opts.onStatus?.(this.status); }
  nextProblem() { CM.nextDiagnostic(this.view); this.view.focus(); }
  get value() { return this.view.state.doc.toString(); }
  set value(v) { this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: v }, selection: { anchor: 0 }, annotations: this.programmatic.of(true), scrollIntoView: true }); }
  // replace the text as if the student had typed it (saves it, runs the live check)
  replace(v) { this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: v } }); }
  paint() { this.view.requestMeasure(); }
  focus() { this.view.focus(); }
  // compiler errors from a build: [{line, col, msg}]
  setProblems(list) {
    const doc = this.view.state.doc; this.setStatus({ checking: false, errors: list.length, warnings: 0 });
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
