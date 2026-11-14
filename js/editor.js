// A small code editor: a transparent textarea over a syntax-coloured copy of the text.
import { hlLine } from './ui.js';

export class Editor {
  constructor(el, { onChange, onBuild } = {}) {
    el.innerHTML = '<div class="ed-gut"></div><div class="ed-main"><pre class="ed-hl"></pre><textarea class="ed-ta" spellcheck="false" autocomplete="off" autocapitalize="off" wrap="off" aria-label="Go source code"></textarea></div>';
    this.gut = el.querySelector('.ed-gut'); this.hl = el.querySelector('.ed-hl'); this.ta = el.querySelector('.ed-ta'); this.errs = new Set();
    this.ta.addEventListener('input', () => { this.paint(); onChange && onChange(this.ta.value); });
    this.ta.addEventListener('scroll', () => { this.hl.scrollTop = this.ta.scrollTop; this.hl.scrollLeft = this.ta.scrollLeft; this.gut.scrollTop = this.ta.scrollTop; });
    this.ta.addEventListener('keydown', (e) => {
      const t = this.ta, s = t.selectionStart, v = t.value;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'Enter' || e.key.toLowerCase() === 's')) { e.preventDefault(); onBuild && onBuild(); }
      else if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); this.insert('\t'); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const line = v.slice(v.lastIndexOf('\n', s - 1) + 1, s); let ind = /^[\t ]*/.exec(line)[0];
        if (/[{(]\s*$/.test(line)) ind += '\t';
        this.insert('\n' + ind);
      } else if (e.key === '}' && /\n\t+$/.test(v.slice(0, s)) && s === t.selectionEnd) {
        e.preventDefault(); t.setSelectionRange(s - 1, s); this.insert('}');
      }
    });
  }
  insert(str) {
    // execCommand keeps the browser's undo history; fall back to setRangeText
    this.ta.focus();
    if (!document.execCommand || !document.execCommand('insertText', false, str)) { this.ta.setRangeText(str, this.ta.selectionStart, this.ta.selectionEnd, 'end'); this.ta.dispatchEvent(new Event('input')); }
  }
  get value() { return this.ta.value; }
  set value(v) { this.ta.value = v; this.errs = new Set(); this.paint(); }
  paint() {
    const lines = this.ta.value.split('\n');
    this.hl.innerHTML = lines.map((l) => hlLine(l) || ' ').join('\n') + '\n ';
    this.gut.innerHTML = lines.map((_, i) => (this.errs.has(i + 1) ? `<span class="err">${i + 1}</span>` : String(i + 1))).join('\n');
  }
  setErrors(lines) { this.errs = new Set(lines); this.paint(); }
  goto(line, col = 1) {
    const lines = this.ta.value.split('\n'); let pos = 0;
    for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
    this.ta.focus(); this.ta.setSelectionRange(pos + col - 1, pos + (lines[line - 1] || '').length);
    this.ta.scrollTop = Math.max(0, (line - 6) * parseFloat(getComputedStyle(this.ta).lineHeight));
  }
}
