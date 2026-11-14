// A terminal on the page, attached to one Shell of a simulated machine.
import { esc } from './ui.js';

const MAX = 120000;   // characters of scrollback kept
export class Term {
  constructor(el, name) {
    this.el = el; this.name = name; this.hist = []; this.hi = 0; this.isBusy = false; this.dec = new TextDecoder();
    el.innerHTML = `<div class="term-h"><span class="chip ${name}">${name}</span><span class="ttl"></span><span class="state"></span></div>
      <div class="term-b"><pre></pre><div class="term-line"><span class="ps"></span><input spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Terminal ${name}"></div></div>`;
    this.out = el.querySelector('pre'); this.body = el.querySelector('.term-b'); this.ps = el.querySelector('.ps'); this.inp = el.querySelector('input');
    this.stateEl = el.querySelector('.state'); this.ttl = el.querySelector('.ttl');
    this.body.addEventListener('mouseup', () => { if (!String(getSelection())) this.inp.focus(); });
    this.inp.addEventListener('focus', () => el.classList.add('focus')); this.inp.addEventListener('blur', () => el.classList.remove('focus'));
    this.inp.addEventListener('keydown', (e) => this.key(e));
  }
  attach(shell) { this.shell = shell; this.out.textContent = ''; this.dec = new TextDecoder(); this.ttl.textContent = `machine ${this.name} · ${shell.m.ip}`; this.busy(false); }
  // called by the shell
  write(buf) { this.append(this.dec.decode(buf, { stream: true })); }
  clear() { this.out.textContent = ''; }
  busy(b) { this.isBusy = b; this.ps.textContent = b ? '' : this.shell.prompt(); this.stateEl.textContent = b ? 'running · Ctrl+C stops it' : ''; this.stateEl.className = 'state' + (b ? ' busy' : ''); this.scroll(); }
  append(s) {
    if (!s) return;
    let t = this.out.textContent + s.replace(/\r/g, '');
    if (t.length > MAX) t = t.slice(t.indexOf('\n', t.length - MAX) + 1);
    this.out.textContent = t; this.scroll();
  }
  scroll() { this.body.scrollTop = this.body.scrollHeight; }
  // type a command as if the student had, and run it
  run(cmd) {
    if (this.isBusy) return false;
    this.inp.value = ''; this.submit(cmd); this.inp.focus(); return true;
  }
  submit(line) {
    if (this.isBusy) { this.append(line + '\n'); this.shell.input(line); return; }
    this.append(this.shell.prompt() + line + '\n');
    if (line.trim()) { if (this.hist[this.hist.length - 1] !== line) this.hist.push(line); }
    this.hi = this.hist.length;
    this.shell.input(line);
  }
  key(e) {
    const k = e.key;
    if (k === 'Enter') { const v = this.inp.value; this.inp.value = ''; this.submit(v); e.preventDefault(); }
    else if (e.ctrlKey && k.toLowerCase() === 'c') { if (this.isBusy) { this.append('^C\n'); this.shell.interrupt(); } else { this.append(this.shell.prompt() + this.inp.value + '^C\n'); this.inp.value = ''; } e.preventDefault(); }
    else if (e.ctrlKey && k.toLowerCase() === 'd') { if (this.isBusy) this.shell.eof(); e.preventDefault(); }
    else if (e.ctrlKey && k.toLowerCase() === 'l') { this.clear(); e.preventDefault(); }
    else if (k === 'ArrowUp') { if (this.hi > 0) this.inp.value = this.hist[--this.hi]; e.preventDefault(); }
    else if (k === 'ArrowDown') { this.hi = Math.min(this.hist.length, this.hi + 1); this.inp.value = this.hist[this.hi] || ''; e.preventDefault(); }
    else if (k === 'Tab') {
      e.preventDefault(); if (this.isBusy) return;
      const v = this.inp.value.slice(0, this.inp.selectionStart), m = /(\S*)$/.exec(v), word = m[1];
      const before = v.slice(0, v.length - word.length), first = before.trim() === '' || /[|;&]\s*$/.test(before);
      const c = this.shell.complete(word, first);
      if (c.length === 1) this.inp.value = v.slice(0, v.length - word.length) + c[0] + (c[0].endsWith('/') ? '' : ' ') + this.inp.value.slice(this.inp.selectionStart);
      else if (c.length > 1) {
        let p = c[0]; for (const x of c) while (!x.startsWith(p)) p = p.slice(0, -1);
        if (p.length > word.length) this.inp.value = v.slice(0, v.length - word.length) + p; else this.append(this.shell.prompt() + v + '\n' + c.join('  ') + '\n');
      }
    }
  }
}
export { esc };
