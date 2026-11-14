// The live kernel view: for each machine, the processes with their descriptor tables (user
// space) and the sockets with their queues (kernel), plus what is on the wire between them.
// It is redrawn from the simulation's real state, at most once per animation frame.
import { fmtCall } from './kernel.js';
import { sockOwners } from './tools.js';
import { esc } from './ui.js';

const size = (n) => (n >= 1 << 20 ? (n / (1 << 20)).toFixed(n % (1 << 20) ? 1 : 0) + ' MB' : n >= 1024 ? (n / 1024).toFixed(n % 1024 ? 1 : 0) + ' KB' : n + ' B');
const TCPF = { S: 'S', SA: 'S.', A: '.', PA: 'P.', FA: 'F.', R: 'R', RA: 'R.' };

export class KView {
  constructor(el) { this.el = el; this.dirty = false; this.cur = new Map(); this.off = null; this.resetWire(); }
  resetWire() { this.wire = { ab: 0, ba: 0, bytes: 0, flying: 0, last: [], t: 0 }; }
  attach(sim) {
    if (this.off) this.off();
    this.sim = sim; this.cur.clear(); this.resetWire();
    this.off = sim.world.on((type, d) => {
      if (type === 'sys-enter') this.cur.set(d.m.name + d.pid, d);
      else if (type === 'sys') this.cur.delete(d.m.name + d.pid);
      else if (type === 'exit') this.cur.delete(d.m.name + d.pid);
      else if (type === 'packet' && d.dev === 'eth0') {
        const w = this.wire, ab = d.from === sim.a;
        if (d.dropped) { w.lost = (w.lost || 0) + 1; w.last.push(`<span class="lost">${ab ? 'A→B' : 'B→A'} [${TCPF[d.seg.flags] || d.seg.flags}]${d.seg.len ? ' ' + d.seg.len : ''} lost</span>`); if (w.last.length > 5) w.last.shift(); w.t = performance.now(); this.touch(); return; }
        if (performance.now() - w.t > 2500) { w.ab = w.ba = w.bytes = w.lost = 0; w.last = []; }
        ab ? w.ab++ : w.ba++; w.bytes += d.seg.len; w.flying++; w.t = performance.now();
        w.last.push(`<span class="${ab ? 'ab' : 'ba'}">${ab ? 'A→B' : 'B→A'} [${TCPF[d.seg.flags] || d.seg.flags}]${d.seg.len ? ' ' + d.seg.len : ''}</span>`); if (w.last.length > 5) w.last.shift();
      } else if (type === 'deliver' && d.dev === 'eth0') this.wire.flying = Math.max(0, this.wire.flying - 1);
      this.touch();
    });
    this.touch();
  }
  touch() { if (this.dirty) return; this.dirty = true; requestAnimationFrame(() => { this.dirty = false; this.render(); }); }
  fdTarget(o) {
    switch (o.kind) {
      case 'tty': return ['tty', 'terminal'];
      case 'file': return ['file', `${o.path}  offset ${size(o.pos)} of ${size(o.ino.size)}`];
      case 'dir': return ['dir', o.path];
      case 'chr': return ['chr', o.path];
      case 'pipe': return ['pipe', o.end === 'r' ? 'pipe, reading end' : 'pipe, writing end'];
      case 'sock': { const s = o.sock; return ['sock', s.state === 'LISTEN' ? `socket listening on port ${s.local.port}` : s.remote ? `socket ${s.local.port} ⇄ ${s.remote.ip}:${s.remote.port}` : 'socket, not connected']; }
    }
    return ['chr', '?'];
  }
  machine(m) {
    const procs = [...m.procs.values()].filter((p) => p.comm !== 'bash');
    let user = '';
    for (const p of procs) {
      const r = this.cur.get(m.name + p.pid);
      const fds = [...p.fds.entries()].sort((x, y) => x[0] - y[0]); let rows = '';
      const std = fds.filter(([n]) => n < 3); const same = std.length === 3 && std.every(([, o]) => o === std[0][1]);
      const list = same ? [['0 1 2', std[0][1]], ...fds.filter(([n]) => n >= 3)] : fds;
      for (const [n, o] of list) { const [k, t] = this.fdTarget(o); rows += `<div class="kv-fd"><span class="n">${n}</span><span class="k ${k}">${k === 'tty' ? 'terminal' : k === 'sock' ? 'socket' : k}</span><span class="to">${k === 'tty' ? '' : esc(t)}</span></div>`; }
      user += `<div class="kv-p"><div class="kv-ph"><span class="cmd">${esc(p.argv.join(' '))}</span><span class="pid">pid ${p.pid}</span></div>
        <div class="kv-now ${r ? 'in' : ''}">${r ? esc(/^(read|pread64|accept)$/.test(r.name) ? `${r.name}(${r.args[0]}, …)` : fmtCall(r)) : 'running its own code'}</div>${rows}</div>`;
    }
    let kern = '';
    const order = (s) => (s.state === 'TIME_WAIT' ? 2 : s.state === 'LISTEN' ? 0 : 1);
    for (const s of [...m.socks].sort((x, y) => order(x) - order(y))) {
      if (!s.local || (s.state === 'CLOSED' && s.orphan)) continue;
      if (s.state === 'TIME_WAIT' && s.orphan) { kern += `<div class="kv-s slim"><div class="kv-sh"><span class="kv-st TIME_WAIT">TIME WAIT</span><span>${s.local.port} → ${s.remote.ip}:${s.remote.port}</span><span class="kv-own">closed, kept for a minute</span></div></div>`; continue; }
      const own = sockOwners(m, s).map(({ p, fd }) => `fd ${fd} of ${p.comm}`).join(', ') || (s.inQueue ? 'waiting to be accepted' : 'no process holds it');
      const bar = (label, v, cap, cls) => `<div class="kv-bar"><span>${label}</span><span class="track"><span class="fill ${cls}${v >= cap ? ' full' : ''}" style="width:${Math.min(100, (v / cap) * 100).toFixed(1)}%"></span></span><span class="v">${size(v)} / ${size(cap)}</span></div>`;
      const addr = s.state === 'LISTEN' ? `${s.local.ip}:${s.local.port}` : `${s.local.ip}:${s.local.port} → ${s.remote ? s.remote.ip + ':' + s.remote.port : '?'}`;
      kern += `<div class="kv-s"><div class="kv-sh"><span class="kv-st ${s.state}">${s.state.replace(/_/g, ' ')}</span><span>${addr}</span><span class="kv-own">${esc(own)}</span></div>
        ${s.state === 'LISTEN' ? `<div class="kv-bar"><span>accept queue</span><span class="track"><span class="fill" style="width:${Math.min(100, (s.acceptQ.length / (s.backlog + 1)) * 100)}%"></span></span><span class="v">${s.acceptQ.length} waiting</span></div>`
        : bar('send buffer', s.sndq.len, s.sndCap, 'snd') + bar('receive buffer', s.rcvq.len, s.rcvCap, '')}</div>`;
    }
    return `<div class="kv-m"><div class="kv-mh"><span class="chip ${m.name}">${m.name}</span>Machine ${m.name}<span class="ip">${m.ip}</span></div>
      <div class="kv-zone user"><div class="kv-zl">User space · processes</div>${user || '<div class="kv-empty">No program is running. Start one in the terminal below.</div>'}</div>
      <div class="kv-zone kern"><div class="kv-zl">Kernel · sockets</div>${kern || '<div class="kv-empty">No socket.</div>'}${this.cacheLine(m)}</div></div>`;
  }
  // the page cache and the link's netem settings, when there is something to say
  cacheLine(m) {
    const { cached, dirty } = m.cacheBytes(), n = m.netem, bits = [];
    if (cached) bits.push(`page cache <b>${size(cached)}</b>${dirty ? `, <span class="dirty">${size(dirty)} dirty</span>` : ''}`);
    if (n.loss || n.delay) bits.push(`eth0 netem:${n.loss ? ` loss ${+(n.loss * 100).toFixed(1)}%` : ''}${n.delay ? ` delay ${n.delay} ms` : ''}`);
    return bits.length ? `<div class="kv-cache">${bits.join(' · ')}</div>` : '';
  }
  render() {
    if (!this.sim) return;
    const w = this.wire, live = w.flying > 0 || performance.now() - w.t < 250;
    if (live) setTimeout(() => this.touch(), 260);
    this.el.innerHTML = this.machine(this.sim.a) +
      `<div class="kv-wire ${live ? 'live' : ''}"><span>the wire</span><div class="cable"></div><span class="n">${w.ab} → · ← ${w.ba}</span><span>segments</span><span class="n">${size(w.bytes)}</span>${w.lost ? `<span class="n lost">${w.lost} lost</span>` : ''}<div class="kv-pk">${w.last.join('<br>')}</div></div>` +
      this.machine(this.sim.b);
  }
}
