// The custom elements lesson pages are written with.
import { S } from './state.js';
import { esc, hlLine } from './ui.js';
import { LABS } from './checks.js';
import './scenes.js';

const def = (name, render) => customElements.define(name, class extends HTMLElement {
  connectedCallback() { if (this.dataset.ready) return; this.dataset.ready = 1; render(this); }
});

// <g-cmd m="A"> lines starting with "$ " are commands (a button runs them in that terminal); other lines are sample output
def('g-cmd', (el) => {
  const m = el.getAttribute('m') || 'A', lines = el.textContent.replace(/^\n+|\s+$/g, '').split('\n');
  el.innerHTML = `<div class="cmd-h"><span class="chip ${m}">${m}</span>terminal ${m}</div>` + lines.map((l) => (l.startsWith('$ ')
    ? `<div class="cmd-row"><span class="txt">${esc(l.slice(2))}</span><button class="cmd-run" data-cmd="${esc(l.slice(2))}" title="Run this in terminal ${m}">run</button></div>`
    : `<div class="cmd-row out"><span class="txt">${esc(l)}</span></div>`)).join('');
  el.addEventListener('click', (e) => { const b = e.target.closest('.cmd-run'); if (b) S.run(m, b.dataset.cmd); });
});

def('g-callout', () => {});

def('g-go', (el) => {
  const code = el.textContent.replace(/^\n+|\s+$/g, '');
  el.innerHTML = `<div class="code">${el.getAttribute('file') ? `<div class="code-h">${esc(el.getAttribute('file'))}</div>` : ''}<pre>${code.split('\n').map((l) => hlLine(l)).join('\n')}</pre></div>`;
});

// <g-predict id correct="b"><g-q>…</g-q><g-o k="a">…</g-o>…<g-why>…</g-why></g-predict>
def('g-predict', (el) => {
  const id = S.page + ':' + (el.id || 'p'), correct = el.getAttribute('correct');
  const q = el.querySelector('g-q').innerHTML, why = el.querySelector('g-why').innerHTML;
  const opts = [...el.querySelectorAll('g-o')].map((o) => [o.getAttribute('k'), o.innerHTML]);
  const draw = () => {
    const pick = S.store.predict[id];
    el.innerHTML = `<div class="pr-k">Predict before you run it</div><p>${q}</p>` +
      opts.map(([k, h]) => `<button class="pr-opt ${pick === k ? 'pick' : ''} ${pick && k === correct ? 'right' : ''}" data-k="${k}" ${pick ? 'disabled' : ''}>${h}</button>`).join('') +
      (pick ? `<div class="pr-why"><b>${pick === correct ? 'That is what happens.' : 'Not this time, and that is the point of guessing first.'}</b>${why}</div>` : '');
  };
  el.addEventListener('click', (e) => { const b = e.target.closest('.pr-opt'); if (b && !S.store.predict[id]) { S.store.predict[id] = b.dataset.k; S.save(); draw(); } });
  draw();
});

// <g-quiz id pass="75"> of <g-qq correct="b"><g-q>…</g-q><g-o k="a">…</g-o>…<g-why>…</g-why></g-qq>:
// the questions one after the other, no answer shown until the end; then the grade, every
// correction, and a pass / no pass that is only a recommendation.
def('g-quiz', (el) => {
  const id = el.id, pass = +(el.getAttribute('pass') || 75), about = el.getAttribute('about') || 'the modules before this one';
  const qs = [...el.querySelectorAll('g-qq')].map((q) => ({ correct: q.getAttribute('correct'), q: q.querySelector('g-q').innerHTML, why: q.querySelector('g-why')?.innerHTML || '',
    opts: [...q.querySelectorAll('g-o')].map((o) => [o.getAttribute('k'), o.innerHTML]) }));
  const N = qs.length;
  let run = null;                                   // { i, answers } while answering
  const st = () => S.store.quiz?.[id];
  const draw = () => {
    const done = st();
    if (run) {
      const q = qs[run.i], pick = run.answers[run.i];
      el.innerHTML = `<div class="qz-top"><span class="pr-k">Question ${run.i + 1} of ${N}</span><span class="qz-bar"><i style="width:${(run.i / N) * 100}%"></i></span></div>
        <div class="qz-q">${q.q}</div>` + q.opts.map(([k, h]) => `<button class="pr-opt ${pick === k ? 'pick' : ''}" data-k="${k}">${h}</button>`).join('') +
        `<div class="qz-row"><span class="meta">No correction until the end.</span><button class="btn primary sm" data-a="next" ${pick ? '' : 'disabled'}>${run.i === N - 1 ? 'See my result' : 'Next question'}</button></div>`;
    } else if (done) {
      const ok = done.score * 100 >= pass * N;
      el.innerHTML = `<div class="qz-res ${ok ? 'pass' : 'fail'}"><div class="qz-score">${done.score} / ${N}</div><div><b>${ok ? 'Pass' : 'No pass'}</b><p>${ok
        ? 'The ideas you need for this module are in place. Go ahead.'
        : 'I recommend you go over ' + esc(about) + ' one more time before tackling this new one. The corrections below show what to look at again.'}</p></div></div>
        <h3 class="qz-h">The corrections</h3>` + qs.map((q, i) => {
        const a = done.answers[i], right = a === q.correct, txt = (k) => q.opts.find(([kk]) => kk === k)?.[1] || '';
        return `<div class="qz-c ${right ? 'right' : 'wrong'}"><div class="qz-cq"><span class="qz-mark">${right ? '✓' : '✗'}</span><span>${i + 1}. ${q.q}</span></div>
          <div class="qz-a">Your answer: ${txt(a)}</div>${right ? '' : `<div class="qz-a good">Correct answer: ${txt(q.correct)}</div>`}<div class="qz-why">${q.why}</div></div>`;
      }).join('') + `<div class="qz-row"><span class="meta">Pass mark: ${pass}%.</span><button class="btn sm" data-a="start">Take it again</button></div>`;
    } else {
      el.innerHTML = `<div class="pr-k">Before you start: ${N} questions</div><p>On ${esc(about)}. One question at a time, no correction until the end; then your grade and every correction. It only recommends: you can start the module whatever the result.</p>
        <div class="qz-row"><span></span><button class="btn primary sm" data-a="start">Start the questions</button></div>`;
    }
  };
  el.addEventListener('click', (e) => {
    const o = e.target.closest('.pr-opt'), a = e.target.closest('button')?.dataset.a;
    if (o && run) { run.answers[run.i] = o.dataset.k; draw(); }
    else if (a === 'start') { run = { i: 0, answers: [] }; draw(); }
    else if (a === 'next' && run && run.answers[run.i]) {
      if (run.i < N - 1) { run.i++; draw(); return; }
      const score = qs.filter((q, i) => run.answers[i] === q.correct).length;
      (S.store.quiz ??= {})[id] = { answers: run.answers, score, when: new Date().toISOString().slice(0, 16) };
      run = null; S.save(); S.markDone?.(S.page); draw(); el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  });
  draw();
});

// <g-example project="copy">text</g-example>: a ready-made program to open, build and run
def('g-example', (el) => {
  const p = el.getAttribute('project'), inner = el.innerHTML;
  el.innerHTML = `<div class="lab-h"><h3>Example program: <code>${esc(S.index.projects[p].bin)}</code></h3><button class="btn primary sm">Open it in the Code tab</button></div>${inner}`;
  el.querySelector('button').addEventListener('click', () => S.openCode(p));
});

// <g-lab id="recv">: tasks, checks, hints, reference solution
def('g-lab', (el) => {
  const id = el.id, lab = LABS[id];
  const st = () => (S.store.labs[id] ??= { res: {}, hints: 0, passed: false, sol: false });
  const draw = () => {
    const s = st();
    el.innerHTML = `<div class="lab-h"><h3>Code lab: <code>${esc(lab.title)}</code></h3>${s.passed ? '<span class="done-pill">all checks pass</span>' : ''}</div>
      <ul class="lab-tasks">${lab.tests.map(([k, title]) => { const r = s.res[k] || {}; return `<li class="${r.state || ''}"><span class="st">${r.state === 'pass' ? '✓' : r.state === 'fail' ? '✗' : k}</span><span>${esc(title)}${r.msg ? `<span class="msg">${esc(r.msg)}</span>` : ''}</span></li>`; }).join('')}</ul>
      <div class="lab-row"><button class="btn sm" data-a="open">Open the code</button><button class="btn primary sm" data-a="check">Run the checks</button>
      ${s.hints < lab.hints.length ? `<button class="btn sm ghost" data-a="hint">Hint ${s.hints + 1} of ${lab.hints.length}</button>` : ''}
      ${s.passed || s.hints >= lab.hints.length ? `<button class="btn sm ghost" data-a="sol">${s.sol ? 'Hide' : 'Show'} a reference solution</button>` : ''}</div>
      ${lab.hints.slice(0, s.hints).map((h, i) => `<div class="lab-hint"><b>Hint ${i + 1}.</b> ${h}</div>`).join('')}
      ${s.passed ? `<div class="lab-ok"><b>How it works</b>${lab.explain}</div>` : ''}
      ${s.sol ? '<div class="code" data-sol><pre>loading…</pre></div>' : ''}`;
    if (s.sol) S.solution(id).then((code) => { const pre = el.querySelector('[data-sol] pre'); if (pre) pre.innerHTML = code.split('\n').map((l) => hlLine(l)).join('\n'); });
  };
  el.addEventListener('click', (e) => {
    const a = e.target.closest('button')?.dataset.a, s = st();
    if (a === 'open') S.openCode(lab.project, id);
    else if (a === 'hint') { s.hints++; S.save(); draw(); }
    else if (a === 'sol') { s.sol = !s.sol; S.save(); draw(); }
    else if (a === 'check') S.runChecks(id);
  });
  el.redraw = draw; draw();
});

// <g-t k="fd">word</g-t>: a glossary term with its definition on hover
let tip = null;
def('g-t', (el) => {
  el.tabIndex = 0;
  const showTip = () => {
    const g = S.glossary.find((x) => x.k === el.getAttribute('k')); if (!g) return;
    tip = document.createElement('div'); tip.className = 'tip'; tip.innerHTML = `<b>${esc(g.term)}</b>${g.short}`; document.body.append(tip);
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left)) + 'px'; tip.style.top = (r.bottom + h + 12 > innerHeight ? r.top - h - 8 : r.bottom + 8) + 'px';
  };
  const hide = () => { tip?.remove(); tip = null; };
  el.addEventListener('mouseenter', showTip); el.addEventListener('mouseleave', hide); el.addEventListener('focus', showTip); el.addEventListener('blur', hide);
});
