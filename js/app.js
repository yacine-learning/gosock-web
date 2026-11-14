// The page: course navigation on the left, the bench (two machines, code editor) on the right.
import { S } from './state.js';
import { World, bytes } from './kernel.js';
import { Shell, setupMachines } from './tools.js';
import { Term } from './term.js';
import { Editor } from './editor.js';
import { KView } from './kview.js';
import { toolchain } from './toolchain.js';
import { goProgram } from './gorun.js';
import { LABS, runLab } from './checks.js';
import { ICON, esc } from './ui.js';
import './components.js';

const $ = (s) => document.querySelector(s);
const view = $('#view'), built = new Map();       // built: command name -> compiled WebAssembly module
const terms = { A: new Term($('#termA'), 'A'), B: new Term($('#termB'), 'B') };
const kview = new KView($('#kview'));
let editor, project = null, activeLab = null, sources = {};

// ── toasts ──
S.toast = (msg) => { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; $('#toasts').append(t); setTimeout(() => t.remove(), 3600); };

// ── the two machines ──
function boot() {
  if (S.sim) for (const m of [S.sim.a, S.sim.b]) for (const p of [...m.procs.values()]) m.kill(p, 9);
  const world = new World(); const { a, b } = setupMachines(world);
  world.speed = +($('#speed .on')?.dataset.s || 0);
  for (const [name, p] of Object.entries(S.index.projects)) {
    world.programs.set(p.bin, built.has(p.bin) ? goProgram(built.get(p.bin)) : async (c) => { await c.err(`${p.bin}: this program is not built yet. Open the Code tab and press Build.\n`); return 127; });
    void name;
  }
  S.sim = { world, a, b, shells: { A: new Shell(a, terms.A), B: new Shell(b, terms.B) } };
  terms.A.attach(S.sim.shells.A); terms.B.attach(S.sim.shells.B); kview.attach(S.sim);
}
S.run = (m, cmd) => {
  tab('machines');
  if (!terms[m].run(cmd)) S.toast(`Terminal ${m} is busy: press Ctrl+C in it first, or wait for the program to end.`);
};

// ── bench tabs, wire speed, split ──
function tab(name) {
  if ($('#app').classList.contains('focus-page') && S.page) S.focus?.(null);      // asked for the bench: show it
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('on', p.id === 'pane-' + name));
  $('#machineTools').style.visibility = name === 'machines' ? '' : 'hidden';
  if (name === 'code') { editor.paint(); loadToolchain(); }
}
document.querySelector('.tabs').addEventListener('click', (e) => { const t = e.target.closest('.tab'); if (t) tab(t.dataset.tab); });
$('#speed').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; $('#speed .on').classList.remove('on'); b.classList.add('on'); S.sim.world.speed = +b.dataset.s; });
$('#reset').addEventListener('click', () => { boot(); S.toast('Both machines rebooted: fresh files, no running program.'); });
{
  const sp = $('#split'), app = $('#app');
  try { const v = localStorage.getItem('gosock-web:split'); if (v) app.style.setProperty('--split', v); } catch (e) { /* default width */ }
  sp.addEventListener('pointerdown', (e) => {
    sp.setPointerCapture(e.pointerId); sp.classList.add('drag');
    const move = (ev) => { const pct = Math.max(24, Math.min(64, (ev.clientX / innerWidth) * 100)).toFixed(1) + '%'; app.style.setProperty('--split', pct); };
    const up = () => { sp.classList.remove('drag'); sp.removeEventListener('pointermove', move); try { localStorage.setItem('gosock-web:split', app.style.getPropertyValue('--split')); } catch (e) { /* not kept */ } };
    sp.addEventListener('pointermove', move); sp.addEventListener('pointerup', up, { once: true });
  });
}

// the compiler is fetched when the student first opens the Code tab, so Build and the live error checks are ready
let tcLoading = null;
function loadToolchain() {
  if (toolchain.loaded || tcLoading) return;
  edStatus();
  tcLoading = toolchain.load().then(() => { tcLoading = null; editor.toolchainReady(); edStatus(); });
}
const SVG = {
  err: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" stroke="currentColor" stroke-width="1.5"/></svg>',
  warn: '<svg viewBox="0 0 16 16"><path d="M8 2.2L14.3 13.5H1.7z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 6.5v3.4M8 11.2v1" stroke="currentColor" stroke-width="1.5"/></svg>',
  fn: '<svg viewBox="0 0 16 16"><path d="M8 1.8l5.5 3v6.4L8 14.2l-5.5-3V4.8z M2.5 4.8L8 7.9l5.5-3.1M8 7.9v6.3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
};
function edStatus(st = editor?.status) {
  if (!st) return;
  const el = $('#edStatus'); if (!el) return;
  const live = !toolchain.loaded ? '<span class="ed-dim">loading the Go compiler for live checks…</span>' : st.checking ? '<span class="ed-dim">checking…</span>' : '';
  const counts = `${st.errors || 0} error${st.errors === 1 ? '' : 's'}, ${st.warnings || 0} warning${st.warnings === 1 ? '' : 's'}`;
  el.innerHTML = `<button id="edProblems" aria-label="${counts}" title="${counts} from the Go compiler (F8: go to the next one)"><span class="${st.errors ? 'ed-bad' : ''}">${SVG.err}</span>${st.errors || 0}<span class="${st.warnings ? 'ed-warn' : ''}">${SVG.warn}</span>${st.warnings || 0}</button>${live}<span class="sp"></span>`
    + `<span>Ln ${st.line}, Col ${st.col}${st.sel ? ` (${st.sel} cursors)` : ''}</span><span>Tab Size: 4</span><span>UTF-8</span><span>LF</span><span>{ } Go</span><span>${esc(S.index.go)}</span>`;
  const p = S.index.projects[project];
  $('#edCrumbs').innerHTML = p ? `${esc(p.bin)}<span class="c-sep">›</span>main.go${st.func ? `<span class="c-sep">›</span><span class="c-fn">${SVG.fn}${esc(st.func)}</span>` : ''}` : '';
}

// ── code: one project (a main.go that builds one command) at a time ──
async function source(file) { return (sources[file] ??= await (await fetch('course/' + file)).text()); }
S.openCode = async (name, labId) => {
  const p = S.index.projects[name]; project = name; activeLab = labId || (LABS[activeLab]?.project === name ? activeLab : null);
  S.store.project = name; S.save();
  editor.value = S.store.code[name] ?? await source(p.file);
  $('#codeName').textContent = `main.go → ${p.bin}`; $('#codeBin').textContent = '→ ' + p.bin; edStatus(); $('#runChecks').hidden = !activeLab; $('#problems').hidden = true;
  status(built.has(p.bin) ? `Built. The command ${p.bin} is ready on A and B.` : 'Not built yet', built.has(p.bin) ? 'ok' : '');
  tab('code');
};
function status(msg, cls = '') { const el = $('#buildStatus'); el.textContent = msg; el.className = 'build-status ' + cls; }
let building = null;
async function build() {
  if (building) return building;
  const p = S.index.projects[project]; $('#build').disabled = true; $('#problems').hidden = true;
  status('Building…');
  toolchain.progress((what) => status(what === 'preparing' ? 'Starting the Go compiler…' : `Loading the Go ${what} (18 MB in all, the first time only)…`));
  building = toolchain.build({ 'main.go': editor.value });
  const r = await building; building = null; $('#build').disabled = false;
  if (!r.ok) {
    status('The compiler refused the program', 'bad');
    const lines = r.errors.split('\n').filter(Boolean), probs = [];
    $('#problems').hidden = false;
    $('#problems').innerHTML = '<div class="p-h"><span>Problems</span> · go build</div>' + lines.map((l) => { const m = /^main\.go:(\d+):(\d+)?:?\s*(.*)/.exec(l); if (m) probs.push({ line: +m[1], col: +(m[2] || 1), msg: m[3] }); return `<a ${m ? `data-l="${m[1]}" data-c="${m[2] || 1}"` : ''}>${esc(l)}</a>`; }).join('');
    editor.setProblems(probs); return null;
  }
  editor.setProblems([]); built.set(p.bin, r.module);
  S.sim.world.programs.set(p.bin, goProgram(r.module));
  status(`Built in ${(r.ms / 1000).toFixed(1)} s. The command ${p.bin} is ready on A and B.`, 'ok');
  return r.module;
}
S.runChecks = async (labId) => {
  const lab = LABS[labId];
  if (project !== lab.project || activeLab !== labId) await S.openCode(lab.project, labId);
  const st = (S.store.labs[labId] ??= { res: {}, hints: 0, passed: false, sol: false }); st.res = {};
  const card = document.querySelector(`g-lab#${labId}`); card?.redraw();
  const module = await build();
  if (!module) { S.toast('The program does not compile yet: the compiler messages are under the code.'); return; }
  tab('code'); status('Running the checks…');
  $('#runChecks').disabled = true;
  const ok = await runLab(labId, module, (id, state, msg) => { st.res[id] = { state, msg }; card?.redraw(); });
  $('#runChecks').disabled = false; st.passed = ok; S.save(); card?.redraw();
  const n = Object.values(st.res).filter((r) => r.state === 'pass').length;
  status(ok ? `All ${lab.tests.length} checks pass.` : `${n} of ${lab.tests.length} checks pass: the page says what each failing one saw.`, ok ? 'ok' : 'bad');
  if (ok) { S.markDone(labItem(labId)); S.toast('All checks pass.'); }
  card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
};
S.solution = async (labId) => {
  const lab = LABS[labId], lines = (await source(S.index.projects[lab.project].solution)).split('\n');
  let i = lines.findIndex((l) => l.startsWith(lab.solution[0])), j = lines.indexOf('}', i);
  while (i > 0 && lines[i - 1].startsWith('//')) i--;         // keep the comment above the function
  return lines.slice(i, j + 1).join('\n');
};
const labItem = (labId) => items().find((it) => it.lab === labId)?.id;

// ── course navigation ──
const items = () => S.index.modules.flatMap((m) => m.items.map((it) => ({ ...it, mod: m })));
S.markDone = (id) => { if (!id) return; S.store.done[id] = true; S.save(); side(); const f = document.querySelector('.page-foot'); if (f && S.page === id) foot(f, id); };
function side() {
  $('#side').innerHTML = `<h1>gosock</h1><p class="sub">What Linux does when a file crosses the network</p>
    <a class="item ${S.page === 'home' ? 'on' : ''}" href="#/"><span class="dot"></span>Overview</a>` +
    S.index.modules.map((m, i) => `<div class="mod">${String(i + 1).padStart(2, '0')} · ${esc(m.title)}</div>` + m.items.map((it) =>
      `<a class="item ${S.store.done[it.id] ? 'done' : ''} ${S.page === it.id ? 'on' : ''}" href="#/p/${it.id}"><span class="dot">${S.store.done[it.id] ? '✓' : ''}</span>${esc(it.title)}<span class="min">${it.minutes} min</span></a>`).join('')).join('') +
    `<div class="mod">Reference</div><a class="item ${S.page === 'glossary' ? 'on' : ''}" href="#/glossary"><span class="dot"></span>Glossary</a>
     <div class="foot">Progress and code are saved in this browser only.<br>Go ${esc(S.index.go)} compiler, running in your browser.</div>`;
}
const drawer = (open) => { $('#side').classList.toggle('open', open); $('#scrim').classList.toggle('open', open); };
$('#menu').addEventListener('click', () => drawer(true)); $('#scrim').addEventListener('click', () => drawer(false));
$('#side').addEventListener('click', (e) => { if (e.target.closest('a')) drawer(false); });
function foot(el, id) {
  const all = items(), i = all.findIndex((x) => x.id === id), prev = all[i - 1], next = all[i + 1], it = all[i];
  const arrow = (flip) => ICON.arrow.replace('<svg', `<svg width="16" height="16"${flip ? ' style="transform:scaleX(-1)"' : ''}`);
  const done = S.store.done[id] ? '<span class="done-pill">✓ Done</span>' : it.lab ? '<span class="meta">Done when the checks pass.</span>' : it.quiz ? '<span class="meta">Done when you finish the questions.</span>' : '<button class="btn" data-a="done">Mark as done</button>';
  el.innerHTML = (prev ? `<a class="btn ghost" href="#/p/${prev.id}" title="${esc(prev.title)}">${arrow(true)} Previous</a>` : '<a class="btn ghost" href="#/">' + arrow(true) + ' Overview</a>') +
    `<span class="sp"></span>${done}` + (next ? `<a class="btn primary" href="#/p/${next.id}">Next: ${esc(next.title)} ${arrow()}</a>` : '<span class="meta">End of what is written so far.</span>');
  el.querySelector('[data-a="done"]')?.addEventListener('click', () => S.markDone(id));
}
async function route() {
  const h = location.hash.replace(/^#\/?/, ''), all = items();
  let html, crumbs;
  if (h.startsWith('p/')) {
    const it = all.find((x) => x.id === h.slice(2)); if (!it) { location.hash = '#/'; return; }
    S.page = it.id; S.store.last = it.id; S.save();
    const body = await (await fetch(`course/${it.mod.dir}/${it.file}.html`)).text();
    const mi = S.index.modules.indexOf(it.mod) + 1;
    crumbs = `${String(mi).padStart(2, '0')} · ${esc(it.mod.title)} / <b>${esc(it.title)}</b>`;
    html = `<div class="kicker">${it.lab ? 'Code lab' : it.kind === 'lab' ? 'Lab' : 'Lesson'} · module ${mi}</div><h1>${esc(it.title)}</h1><div class="meta">about ${it.minutes} minutes</div>${body}<div class="page-foot"></div>`;
  } else if (h === 'glossary') {
    S.page = 'glossary'; crumbs = '<b>Glossary</b>';
    html = '<h1>Glossary</h1><p class="lede">The words of the course. Underlined words in a page show the same definitions when you point at them.</p><dl class="gl">' +
      [...S.glossary].sort((a, b) => a.term.localeCompare(b.term)).map((g) => `<dt>${esc(g.term)}</dt><dd>${g.short}</dd>`).join('') + '</dl>';
  } else {
    S.page = 'home'; crumbs = '<b>Overview</b>';
    const next = all.find((x) => !S.store.done[x.id]) || all[0], started = all.some((x) => S.store.done[x.id]);
    html = `<div class="kicker">A course you run in this page</div><h1>What Linux does when a file crosses the network</h1>
      <p class="lede">You write a file-transfer tool in real Go, run it on two simulated Linux machines, and watch their kernels work: descriptors, sockets, buffers, packets.</p>
      <p><a class="btn primary" href="#/p/${next.id}">${started ? 'Continue' : 'Start'}: ${esc(next.title)}</a></p>` +
      S.index.modules.map((m, i) => { const n = m.items.filter((x) => S.store.done[x.id]).length; return `<div class="home-mod"><div class="kicker">Module ${i + 1}</div><h2>${esc(m.title)}</h2><p>${esc(m.blurb)}</p><div class="prog"><i style="width:${(n / m.items.length) * 100}%"></i></div><span class="meta">${n} of ${m.items.length} pages done</span></div>`; }).join('') +
      `<details class="fold"><summary>What is real here, and what is simulated</summary><p><b>Real:</b> the Go compiler and linker (the official ones, running in your browser), your program, its goroutines and its standard library.</p><p><b>Simulated:</b> the two machines and their kernels. They are a model written for this course: files, descriptors, sockets and TCP behave like Linux in the ways the lessons use, and nothing more. Timings are those of your browser, not of a network.</p></details>`;
  }
  view.innerHTML = html; view.style.animation = 'none'; void view.offsetWidth; view.style.animation = '';
  $('#crumbs').innerHTML = crumbs; $('#scroll').scrollTop = 0; side();
  const f = view.querySelector('.page-foot'); if (f) foot(f, S.page);
  const lab = view.querySelector('g-lab'); if (lab) { activeLab = lab.id; if (project === LABS[lab.id].project) $('#runChecks').hidden = false; }
}

// ── editor shortcuts ──
function shortcuts() {
  const rows = [['Ctrl+Space', 'completion (it also opens while you type; after <code>net.</code> it lists the package)'], ['hover', 'the whole documentation of a function, type, variable or package; its blue names open their own documentation'], ['type <code>(</code> after a function', 'its parameters, the one you are typing in bold (Esc hides them)'], ['Ctrl+Enter or Ctrl+S', 'build'], ['Shift+Alt+F', 'format with gofmt'],
    ['Ctrl+F', 'find and replace'], ['Ctrl+D', 'select the next occurrence (several cursors)'], ['Alt+click', 'add a cursor'], ['Ctrl+Alt+G', 'go to line'], ['Ctrl+/', 'comment or uncomment'], ['Tab, Shift+Tab', 'indent, unindent'], ['Ctrl+Z, Ctrl+Shift+Z', 'undo, redo'], ['F8', 'next error or warning (or click the counts in the status bar)'], ['type <code>iferr</code>, <code>forr</code>, <code>openf</code>…', 'snippets']];
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="box"><h3>Editor shortcuts</h3><p class="meta">On a Mac, Ctrl is Cmd. Red underlines come from the real Go compiler, a moment after you stop typing; unused imports and variables show as warnings until you build.</p><table>${rows.map(([k, d]) => `<tr><td>${k.replace(/^([^<]*)$/, (x) => x.split(' or ').map((y) => `<kbd>${y}</kbd>`).join(' or '))}</td><td>${d}</td></tr>`).join('')}</table><div class="row"><button class="btn sm" data-a="close">Close</button></div></div>`;
  document.body.append(m); m.addEventListener('click', (e) => { if (e.target === m || e.target.dataset.a === 'close') m.remove(); });
}

// ── notes for the author ──
$('#noteBtn').addEventListener('click', () => {
  const quote = String(getSelection()).trim().slice(0, 400), title = items().find((x) => x.id === S.page)?.title || S.page;
  const m = document.createElement('div'); m.className = 'modal';
  const old = S.store.notes.map((n) => `<div><small>${esc(n.when)} · ${esc(n.title)}</small>${n.quote ? '“' + esc(n.quote) + '”\n' : ''}${esc(n.text)}</div>`).join('');
  m.innerHTML = `<div class="box"><h3>A note about “${esc(title)}”</h3>${quote ? `<p class="meta">About: “${esc(quote)}”</p>` : '<p class="meta">Tip: select some text on the page first to quote it.</p>'}
    <textarea placeholder="What was unclear, wrong, or good?"></textarea>
    <div class="row"><button class="btn sm ghost" data-a="copy">Copy all my notes</button><button class="btn sm" data-a="close">Close</button><button class="btn primary sm" data-a="save">Save the note</button></div>
    <p class="meta">Notes stay in this browser. “Copy all my notes” puts them on the clipboard so you can paste them to the author.</p>
    ${old ? `<div class="old"><b>Saved notes</b>${old}</div>` : ''}</div>`;
  document.body.append(m); m.querySelector('textarea').focus();
  m.addEventListener('click', async (e) => {
    const a = e.target.dataset.a;
    if (e.target === m || a === 'close') m.remove();
    else if (a === 'save') { const text = m.querySelector('textarea').value.trim(); if (text) { S.store.notes.push({ when: new Date().toISOString().slice(0, 16).replace('T', ' '), page: S.page, title, quote, text }); S.save(); S.toast('Note saved.'); } m.remove(); }
    else if (a === 'copy') { const md = S.store.notes.map((n) => `## ${n.when} · ${n.title}\n\n${n.quote ? '> ' + n.quote + '\n\n' : ''}${n.text}\n`).join('\n'); try { await navigator.clipboard.writeText(md); S.toast(`${S.store.notes.length} notes copied.`); } catch (err) { S.toast('The browser refused the clipboard.'); } }
  });
});

// ── focus: the course alone, or the bench alone ──
{
  const app = $('#app');
  const setFocus = (f) => {
    app.classList.toggle('focus-page', f === 'page'); app.classList.toggle('focus-bench', f === 'bench');
    $('#focusPage').innerHTML = f === 'page' ? ICON.shrink : ICON.expand; $('#focusPage').title = f === 'page' ? 'Show the machines and the code again' : 'Course only (full width)';
    $('#focusBench').innerHTML = f === 'bench' ? ICON.shrink : ICON.expand; $('#focusBench').title = f === 'bench' ? 'Show the course again' : 'Machines and code only (full width)';
    editor?.paint(); dispatchEvent(new Event('resize'));
  };
  $('#focusPage').addEventListener('click', () => setFocus(app.classList.contains('focus-page') ? null : 'page'));
  $('#focusBench').addEventListener('click', () => setFocus(app.classList.contains('focus-bench') ? null : 'bench'));
  S.focus = setFocus; setFocus(null);
  // a command run from the course needs the machines on screen
  const run = S.run; S.run = (m, cmd) => { if (app.classList.contains('focus-page')) setFocus(null); return run(m, cmd); };
}

// ── theme ──
{
  const btn = $('#theme'), root = document.documentElement;
  const paint = () => { btn.innerHTML = root.dataset.theme === 'dark' ? ICON.sun : ICON.moon; };
  btn.addEventListener('click', () => { root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('gosock-web:theme', root.dataset.theme); } catch (e) { /* not kept */ } paint(); });
  paint();
}

// ── start ──
(async () => {
  let api;
  [S.index, S.glossary, api] = await Promise.all([fetch('course/index.json').then((r) => r.json()), fetch('course/glossary.json').then((r) => r.json()), fetch('js/goapi.json').then((r) => r.json())]);
  editor = new Editor($('#editor'), { api, toolchain, toast: S.toast, onBuild: build, onStatus: edStatus,
    onChange: (v) => { if ($('#buildStatus').classList.contains('ok')) status('Edited since the last build', ''); if (project) { S.store.code[project] = v; clearTimeout(editor.t); editor.t = setTimeout(S.save, 400); } } });
  edStatus();
  $('#format').addEventListener('click', () => editor.format());
  $('#keys').addEventListener('click', shortcuts);
  $('#build').addEventListener('click', build);
  $('#runChecks').addEventListener('click', () => activeLab && S.runChecks(activeLab));
  $('#resetCode').addEventListener('click', async () => { if (!confirm('Replace your code with the starting code of this program?')) return; delete S.store.code[project]; S.save(); editor.value = await source(S.index.projects[project].file); });
  $('#edStatus').addEventListener('click', (e) => { if (e.target.closest('#edProblems')) editor.nextProblem(); });
  $('#problems').addEventListener('click', (e) => { const a = e.target.closest('a[data-l]'); if (a) editor.goto(+a.dataset.l, +a.dataset.c); });
  boot();
  const p = S.index.projects[S.store.project] ? S.store.project : 'gosock';
  await S.openCode(p); tab('machines');
  addEventListener('hashchange', route);
  if (!location.hash && S.store.last) location.hash = '#/p/' + S.store.last; else route();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  window.gosock = { S, terms, build, toolchain, bytes, editor };       // for tests and for the curious
})();
