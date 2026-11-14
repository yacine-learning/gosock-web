// The shell and the command-line programs of the simulated machines. Every program is an
// async function(ctx) that only talks to the kernel through ctx.sys(...), so strace sees
// what it does, exactly like a compiled program.
import { Errno, KILLED, O, bytes, text, fmtCall, fmtRet, prngBytes } from './kernel.js';

const P = {};          // name -> program
export const PROGRAMS = P;
const usage = async (c, s) => { await c.err(s + '\n'); return 2; };
async function readAll(c, fd) { const parts = []; let n = 0; for (;;) { const b = await c.sys('read', fd, 131072); if (!b.length) break; parts.push(b); n += b.length; } const out = new Uint8Array(n); let o = 0; for (const b of parts) { out.set(b, o); o += b.length; } return out; }
async function open(c, path, flags = 0) { try { return await c.sys('openat', path, flags, 0o644); } catch (e) { if (!(e instanceof Errno)) throw e; await c.err(`${c.argv[0]}: ${path}: ${e.text}\n`); return -1; } }
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
// split argv into flags (-abc, -n VALUE for names in `withValue`) and positional arguments
function opts(argv, withValue = '') {
  const f = {}, pos = [];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { pos.push(...argv.slice(i + 1)); break; }
    if (a[0] === '-' && a.length > 1 && !/^-\d/.test(a)) {
      for (let j = 1; j < a.length; j++) {
        if (withValue.includes(a[j])) { f[a[j]] = a.slice(j + 1) || argv[++i]; break; }
        f[a[j]] = true;
      }
    } else pos.push(a);
  }
  return [f, pos];
}

P.echo = async (c) => { await c.out(c.argv.slice(1).join(' ') + '\n'); };
P.true = async () => 0; P.false = async () => 1;
P.hostname = async (c) => { await c.out(c.m.host + '\n'); };
P.pwd = async (c) => { await c.out(c.p.cwd + '\n'); };
P.env = async (c) => { await c.out(Object.entries(c.env).map(([k, v]) => `${k}=${v}\n`).join('')); };
P.sleep = async (c) => { await c.sys('nanosleep', parseFloat(c.argv[1] || '0')); };
P.cat = async (c) => {
  const files = c.argv.slice(1).filter((a) => a !== '-'); let rc = 0;
  for (const f of files.length ? files : [null]) {
    const fd = f ? await open(c, f) : 0; if (fd < 0) { rc = 1; continue; }
    for (;;) { const b = await c.sys('read', fd, 131072); if (!b.length) break; await c.sys('write', 1, b); }
    if (f) await c.sys('close', fd);
  }
  return rc;
};
P.head = async (c) => {
  const [f, pos] = opts(c.argv, 'cn'); const fd = pos[0] ? await open(c, pos[0]) : 0; if (fd < 0) return 1;
  if (f.c) { let left = parseSize(f.c); while (left > 0) { const b = await c.sys('read', fd, Math.min(left, 65536)); if (!b.length) break; left -= b.length; await c.sys('write', 1, b); } return 0; }
  const lines = text(await readAll(c, fd)).split('\n'); await c.out(lines.slice(0, +(f.n || 10)).join('\n') + '\n');
};
P.wc = async (c) => {
  const [f, pos] = opts(c.argv); let rc = 0;
  for (const name of pos.length ? pos : [null]) {
    const fd = name ? await open(c, name) : 0; if (fd < 0) { rc = 1; continue; }
    const b = await readAll(c, fd); const t = text(b);
    const cols = f.c ? [b.length] : f.l ? [t.split('\n').length - 1] : [t.split('\n').length - 1, t.split(/\s+/).filter(Boolean).length, b.length];
    await c.out(cols.join(' ') + (name ? ' ' + name : '') + '\n');
  }
  return rc;
};
P.sha256sum = async (c) => {
  let rc = 0; const files = c.argv.slice(1);
  for (const name of files.length ? files : [null]) {
    const fd = name ? await open(c, name) : 0; if (fd < 0) { rc = 1; continue; }
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', await readAll(c, fd)));
    await c.out(`${hex(d)}  ${name || '-'}\n`);
  }
  return rc;
};
P.cmp = async (c) => {
  const [a, b] = c.argv.slice(1); if (!b) return usage(c, 'usage: cmp FILE1 FILE2');
  const fa = await open(c, a), fb = await open(c, b); if (fa < 0 || fb < 0) return 2;
  const x = await readAll(c, fa), y = await readAll(c, fb);
  const n = Math.min(x.length, y.length); let line = 1;
  for (let i = 0; i < n; i++) { if (x[i] !== y[i]) { await c.out(`${a} ${b} differ: byte ${i + 1}, line ${line}\n`); return 1; } if (x[i] === 10) line++; }
  if (x.length !== y.length) { await c.err(`cmp: EOF on ${x.length < y.length ? a : b} after byte ${n}\n`); return 1; }
  return 0;
};
const perm = (st) => (st.type === 'dir' ? 'd' : st.type === 'chr' ? 'c' : '-') + [6, 3, 0].map((s) => { const v = (st.mode >> s) & 7; return (v & 4 ? 'r' : '-') + (v & 2 ? 'w' : '-') + (v & 1 ? 'x' : '-'); }).join('');
const lsDate = (ms) => { const d = new Date(ms); return `${d.toLocaleString('en', { month: 'short' })} ${String(d.getDate()).padStart(2)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
P.ls = async (c) => {
  const [f, pos] = opts(c.argv); let rc = 0; const targets = pos.length ? pos : ['.'];
  for (const t of targets) {
    let st; try { st = await c.sys('newfstatat', t); } catch (e) { if (!(e instanceof Errno)) throw e; await c.err(`ls: cannot access '${t}': ${e.text}\n`); rc = 2; continue; }
    let names = [t];
    if (st.type === 'dir') { const fd = await c.sys('openat', t, O.RDONLY | O.DIRECTORY); names = await c.sys('getdents64', fd); await c.sys('close', fd); if (!f.a) names = names.filter((n) => n[0] !== '.'); }
    if (targets.length > 1 && st.type === 'dir') await c.out(t + ':\n');
    if (!f.l) { if (names.length) await c.out(names.join('  ') + '\n'); continue; }
    const rows = [];
    for (const n of names) { const s = await c.sys('_stat', st.type === 'dir' ? t + '/' + n : n); rows.push([perm(s), String(s.nlink), 'student', 'student', f.h ? human(s.size) : String(s.size), lsDate(s.mtime), n]); }
    const w = Math.max(1, ...rows.map((r) => r[4].length));
    await c.out(rows.map((r) => `${r[0]} ${r[1]} ${r[2]} ${r[3]} ${r[4].padStart(w)} ${r[5]} ${r[6]}\n`).join(''));
  }
  return rc;
};
const human = (n) => (n >= 1 << 20 ? (n / (1 << 20)).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1024 ? (n / 1024).toFixed(1).replace(/\.0$/, '') + 'K' : String(n));
const parseSize = (s) => { const m = /^(\d+)([kKmM]?)/.exec(String(s)); return m ? +m[1] * (m[2] ? (m[2].toLowerCase() === 'k' ? 1024 : 1 << 20) : 1) : 0; };
P.rm = async (c) => { const [f, pos] = opts(c.argv); let rc = 0; for (const t of pos) { try { await c.sys('unlink', t); } catch (e) { if (!(e instanceof Errno)) throw e; if (!f.f) { await c.err(`rm: cannot remove '${t}': ${e.text}\n`); rc = 1; } } } return rc; };
P.mkdir = async (c) => { const [, pos] = opts(c.argv); for (const t of pos) { try { await c.sys('mkdir', t); } catch (e) { if (!(e instanceof Errno)) throw e; await c.err(`mkdir: cannot create directory '${t}': ${e.text}\n`); return 1; } } };
P.cp = async (c) => {
  const [, pos] = opts(c.argv); if (pos.length !== 2) return usage(c, 'usage: cp SOURCE DEST');
  const src = await open(c, pos[0]); if (src < 0) return 1;
  const dst = await open(c, pos[1], O.WRONLY | O.CREAT | O.TRUNC); if (dst < 0) return 1;
  for (;;) { const b = await c.sys('read', src, 131072); if (!b.length) break; await c.sys('write', dst, b); }
};
P.dd = async (c) => {
  const a = Object.fromEntries(c.argv.slice(1).map((s) => s.split('=')));
  const bs = parseSize(a.bs || '512'), count = a.count ? +a.count : Infinity;
  const src = a.if ? await open(c, a.if) : 0; if (src < 0) return 1;
  const dst = a.of ? await open(c, a.of, O.WRONLY | O.CREAT | O.TRUNC) : 1; if (dst < 0) return 1;
  let n = 0, total = 0; const t0 = c.m.world.now();
  for (; n < count; n++) { const b = await c.sys('read', src, bs); if (!b.length) break; await c.sys('write', dst, b); total += b.length; }
  const dt = Math.max(c.m.world.now() - t0, 0.0001);
  await c.err(`${n}+0 records in\n${n}+0 records out\n${total} bytes (${human(total)}B) copied, ${dt.toFixed(4)} s, ${human(total / dt)}B/s\n`);
};
P.ps = async (c) => {
  await c.out('    PID TTY          TIME CMD\n' + [...c.m.procs.values()].map((p) => `${String(p.pid).padStart(7)} pts/${p.fds.get(0)?.tty?.n ?? '?'}    00:00:00 ${p.argv.join(' ')}\n`).join(''));
};
P.kill = async (c) => { for (const a of c.argv.slice(1)) { if (a[0] === '-') continue; const p = c.m.procs.get(+a); if (!p) { await c.err(`kill: (${a}): No such process\n`); return 1; } c.m.kill(p, 15); } };
P.pkill = async (c) => { const [, pos] = opts(c.argv); let n = 0; for (const p of [...c.m.procs.values()]) if (p.comm === pos[0] && p !== c.p) { c.m.kill(p, 15); n++; } return n ? 0 : 1; };
P.ip = async (c) => {
  await c.out(`1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536\n    inet 127.0.0.1/8 scope host lo\n2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500\n    inet ${c.m.ip}/24 brd 10.0.0.255 scope global eth0\n`);
};
P.ping = async (c) => {
  const [f, pos] = opts(c.argv, 'c'); const host = resolveHost(c.m, pos[0] || ''); const n = +(f.c || 3);
  if (!host) { await c.err(`ping: ${pos[0]}: Name or service not known\n`); return 2; }
  const up = host.startsWith('127.') || c.m.world.byIp.has(host);
  await c.out(`PING ${pos[0]} (${host}) 56(84) bytes of data.\n`);
  for (let i = 1; i <= n; i++) { if (up) await c.out(`64 bytes from ${host}: icmp_seq=${i} ttl=64 time=0.${300 + (i * 37) % 200} ms\n`); if (i < n) await c.sys('nanosleep', 0.4); }
  await c.out(`\n--- ${pos[0]} ping statistics ---\n${n} packets transmitted, ${up ? n : 0} received, ${up ? 0 : 100}% packet loss\n`);
  return up ? 0 : 1;
};
export function resolveHost(m, h) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return h;
  if (h === 'localhost') return '127.0.0.1';
  const hosts = text(m.readFile('/etc/hosts') || new Uint8Array(0));
  for (const line of hosts.split('\n')) { const [ip, ...names] = line.trim().split(/\s+/); if (names.includes(h)) return ip; }
  return null;
}

// ── nc: the OpenBSD netcat of Ubuntu, the parts the course uses ──
P.nc = async (c) => {
  const [f, pos] = opts(c.argv, 'pqw'); let s;
  const die = async (msg) => { await c.err(`nc: ${msg}\n`); return 1; };
  if (f.l) {
    const port = +(f.p || pos[pos.length - 1]); if (!port) return usage(c, 'usage: nc -l PORT');
    const l = await c.sys('socket', 2, 1, 6);
    await c.sys('setsockopt', l, 1, 2, 1); await c.sys('setsockopt', l, 1, 15, 1);
    try { await c.sys('bind', l, pos.length > 1 ? pos[0] : '0.0.0.0', port); } catch (e) { if (e instanceof Errno) return die(e.text); throw e; }
    await c.sys('listen', l, 1);
    s = (await c.sys('accept', l)).fd; await c.sys('close', l);
  } else {
    if (pos.length < 2) return usage(c, 'usage: nc [-N] HOST PORT');
    const ip = resolveHost(c.m, pos[0]); if (!ip) return die(`getaddrinfo for host "${pos[0]}" port ${pos[1]}: Name or service not known`);
    s = await c.sys('socket', 2, 1, 6);
    try { await c.sys('connect', s, ip, +pos[1]); } catch (e) { if (e instanceof Errno) return die(`connect to ${pos[0]} port ${pos[1]} (tcp) failed: ${e.text}`); throw e; }
  }
  // two directions at once: terminal/file -> socket, socket -> terminal/file
  const up = (async () => {
    for (;;) {
      const b = await c.sys('read', 0, 16384);
      if (!b.length) { if (f.N) await c.sys('shutdown', s, 1); return; }
      await c.sys('write', s, b);
    }
  })().catch((e) => { if (e !== KILLED && !(e instanceof Errno)) throw e; });
  for (;;) {
    let b; try { b = await c.sys('read', s, 16384); } catch (e) { if (e instanceof Errno) return die(`read: ${e.text}`); throw e; }
    if (!b.length) break;
    await c.sys('write', 1, b);
  }
  void up; return 0;      // the peer closed: nc exits, even if its own input is still open
};

// ── ss ──
const ST = { LISTEN: 'LISTEN', ESTABLISHED: 'ESTAB', SYN_SENT: 'SYN-SENT', SYN_RECV: 'SYN-RECV', FIN_WAIT_1: 'FIN-WAIT-1', FIN_WAIT_2: 'FIN-WAIT-2', TIME_WAIT: 'TIME-WAIT', CLOSE_WAIT: 'CLOSE-WAIT', LAST_ACK: 'LAST-ACK', CLOSING: 'CLOSING', CLOSED: 'UNCONN' };
export function sockOwners(m, s) { const out = []; for (const p of m.procs.values()) for (const [fd, o] of p.fds) if (o.sock === s) out.push({ p, fd }); return out; }
P.ss = async (c) => {
  const [f] = opts(c.argv);
  const rows = [['State', 'Recv-Q', 'Send-Q', 'Local Address:Port', 'Peer Address:Port', f.p ? 'Process' : '']];
  for (const s of c.m.socks) {
    if (!s.local || s.state === 'CLOSED') continue;
    const lis = s.state === 'LISTEN';
    if (f.l ? !lis : !f.a && (lis || s.state !== 'ESTABLISHED')) continue;
    const users = f.p ? sockOwners(c.m, s).map(({ p, fd }) => `("${p.comm}",pid=${p.pid},fd=${fd})`).join(',') : '';
    rows.push([ST[s.state], String(lis ? s.acceptQ.length : s.rcvq.len), String(lis ? s.backlog : s.sndq.len), `${s.local.ip}:${s.local.port}`, s.remote ? `${s.remote.ip}:${s.remote.port}` : '0.0.0.0:*', users ? `users:(${users})` : '']);
  }
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  await c.out(rows.map((r) => r.map((x, i) => x.padEnd(w[i])).join('  ').trimEnd() + '\n').join(''));
};

// ── wrappers that run another program ──
P.timeout = async (c) => {
  const secs = parseFloat(c.argv[1]); const child = c.run(c.argv.slice(2)); if (!child) return 127;
  let timed = false; const t = c.m.world.timer(() => { timed = true; c.m.kill(child, 15); }, secs * 1000);
  const code = await c.sys('wait4', child); clearTimeout(t); return timed ? 124 : code;
};
P.time = async (c) => {
  const t0 = c.m.world.now(); const child = c.run(c.argv.slice(1)); if (!child) return 127;
  const code = await c.sys('wait4', child); const dt = c.m.world.now() - t0;
  await c.err(`\nreal\t0m${dt.toFixed(3)}s\n`); return code;
};
const SIG = { 2: 'SIGINT', 9: 'SIGKILL', 15: 'SIGTERM' };
P.strace = async (c) => {
  const a = c.argv.slice(1); let only = null, outPath = null, attach = null;
  while (a.length && a[0][0] === '-') {
    const o = a.shift();
    if (o === '-e') { const v = a.shift().replace(/^trace=/, ''); only = new Set(v.split(',').map((n) => ({ accept4: 'accept', open: 'openat', stat: 'newfstatat' }[n] || n))); if (only.has('network')) ['socket', 'bind', 'listen', 'accept', 'connect', 'getsockname', 'getpeername', 'setsockopt', 'getsockopt', 'shutdown', 'sendfile'].forEach((n) => only.add(n)); }
    else if (o === '-o') outPath = a.shift();
    else if (o === '-p') attach = +a.shift();
    else if (/^-[sP]$/.test(o)) a.shift();
  }
  let fd = 2;
  if (outPath) { fd = await open(c, outPath, O.WRONLY | O.CREAT | O.TRUNC); if (fd < 0) return 1; }
  let child;
  if (attach) { child = c.m.procs.get(attach); if (!child) { await c.err(`strace: attach: ptrace(PTRACE_SEIZE, ${attach}): No such process\n`); return 1; } await c.err(`strace: Process ${attach} attached\n`); }
  else { if (!a.length) return usage(c, 'usage: strace [-f] [-e trace=CALLS] [-o FILE] COMMAND...  |  strace -p PID'); child = c.run(a, { hold: true }); if (!child) return 127; }
  // Like the real strace: a call that is still waiting in the kernel is printed up to the point
  // where its results would go, and the line is completed when the call returns. If another
  // call has to be printed meanwhile, the first is marked <unfinished ...> and resumed later.
  let chain = Promise.resolve(), cur = null; const pending = new Map();
  // written straight to the open file, so a trace line never arrives after later output of the program
  const put = (s) => { const o = c.p.fds.get(fd); if (o) chain = c.m.writeOfd(c.p, o, bytes(s), null).catch(() => {}); };
  const say = (s) => { if (cur) { put(' <unfinished ...>\n'); cur.cut = true; cur = null; } put(s + '\n'); };
  const head = (r) => { const f = fmtCall(r); return /^(read|pread64|accept|getsockname|getpeername|getsockopt|fstat|newfstatat|pipe2|wait4)$/.test(r.name) ? /^\w+\((\d+, )?/.exec(f)[0] : f; };
  const want = (r) => r.pid === child.pid && (!only || only.has(r.name));
  const off = c.m.world.on((type, r) => {
    if (type === 'sys-enter' && want(r)) {
      pending.set(r.id, c.m.world.timer(() => { if (r.done) return; if (cur) { put(' <unfinished ...>\n'); cur.cut = true; } r.head = head(r); put(r.head); cur = r; }, 60));
    } else if (type === 'sys' && want(r)) {
      clearTimeout(pending.get(r.id)); pending.delete(r.id);
      const full = r.name === 'exit_group' ? `exit_group(${r.args[0]})` : fmtCall(r), ret = r.name === 'exit_group' ? '?' : fmtRet(r);
      const rest = r.head !== undefined && full.startsWith(r.head) ? full.slice(r.head.length) : full;
      if (cur === r) { put(`${rest} = ${ret}\n`); cur = null; }
      else if (r.cut) say(`<... ${r.name} resumed>${rest} = ${ret}`);
      else say(`${full} = ${ret}`);
    } else if (type === 'signal' && r.p === child) say(`+++ killed by ${SIG[r.sig] || 'SIG' + r.sig} +++`);
  });
  if (!attach) child.start();
  const code = await c.sys('_wait', child).finally(off);
  for (const t of pending.values()) clearTimeout(t);
  if (code < 128) say(`+++ exited with ${code} +++`);
  await chain; return attach ? 0 : code;
};

P.grep = async (c) => {
  const [f, pos] = opts(c.argv, 'me'); const pat = f.e || pos.shift(); if (pat === undefined) return usage(c, 'usage: grep [-c] [-v] [-i] [-n] [-m N] PATTERN [FILE...]');
  let re; try { re = new RegExp(pat.replace(/\\\|/g, '|'), f.i ? 'i' : ''); } catch (e) { re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), f.i ? 'i' : ''); }
  let any = false;
  for (const name of pos.length ? pos : [null]) {
    const fd = name ? await open(c, name) : 0; if (fd < 0) continue;
    const lines = text(await readAll(c, fd)).split('\n'); if (lines[lines.length - 1] === '') lines.pop();
    let n = 0, out = ''; const pre = pos.length > 1 ? name + ':' : '';
    for (let i = 0; i < lines.length; i++) { if (re.test(lines[i]) === !f.v) { n++; any = true; if (!f.c) out += pre + (f.n ? i + 1 + ':' : '') + lines[i] + '\n'; if (f.m && n >= +f.m) break; } }
    await c.out(f.c ? pre + n + '\n' : out);
  }
  return any ? 0 : 1;
};
P.which = async (c) => { const n = c.argv[1]; if (findProgram(c.m, n)) await c.out(`/usr/bin/${n}\n`); else return 1; };
P.help = async (c) => { await c.out('Commands on this machine:\n  ' + [...new Set([...Object.keys(P), ...c.m.world.programs.keys(), 'cd', 'export', 'clear'])].sort().join(' ') + '\nKeys: Ctrl+C stops the running command, Ctrl+D ends input, Up/Down recall commands, Tab completes.\n'); };

export function findProgram(m, name) { const base = name.replace(/^(\.\/|\/usr\/(local\/)?bin\/)/, ''); return m.world.programs.get(base) || P[base] || null; }

// ── the shell ──
function tokenize(line, env) {
  const toks = []; let cur = '', has = false, i = 0;
  const push = () => { if (has) toks.push({ w: cur }); cur = ''; has = false; };
  const expand = () => {
    let m = /^\$\{(\w+)\}/.exec(line.slice(i)) || /^\$(\w+|\?)/.exec(line.slice(i));
    if (!m) { cur += '$'; i++; return; }
    cur += m[1] === '?' ? '\u0001' : env[m[1]] ?? ''; i += m[0].length; has = true;
  };
  while (i < line.length) {
    const ch = line[i];
    if (ch === ' ' || ch === '\t') { push(); i++; }
    else if (ch === '#' && !has) break;
    else if (ch === "'") { const j = line.indexOf("'", i + 1); cur += line.slice(i + 1, j < 0 ? line.length : j); has = true; i = j < 0 ? line.length : j + 1; }
    else if (ch === '"') { i++; has = true; while (i < line.length && line[i] !== '"') { if (line[i] === '$') expand(); else cur += line[i++]; } i++; }
    else if (ch === '$') expand();
    else if (ch === '~' && !has && (i + 1 >= line.length || ' /'.includes(line[i + 1]))) { cur += env.HOME; has = true; i++; }
    else if (ch === '\\' && i + 1 < line.length) { cur += line[i + 1]; has = true; i += 2; }
    else {
      const m = /^(2>&1|&&|\|\||>>|2>>|2>|[|&;<>])/.exec(line.slice(i));
      if (m) { push(); toks.push({ op: m[1] }); i += m[1].length; } else { cur += ch; has = true; i++; }
    }
  }
  push(); return toks;
}

let TTY = 0;
export class Shell {
  // term: { write(Uint8Array), clear(), busy(bool) }
  constructor(m, term) {
    this.m = m; this.term = term; this.env = { ...m.env, '?': '0' }; this.cwd = '/home/student';
    this.tty = { n: TTY++, write: (b) => term.write(b) }; this.ttyOfd = m.mktty(this.tty); this.ttyOfd.refs++;
    this.fg = new Set(); this.jobs = 0; this.running = false;
    this.proc = m.spawn({ argv: ['bash'], stdio: [this.ttyOfd, this.ttyOfd, this.ttyOfd], main: () => new Promise(() => {}) });
  }
  prompt() { return `student@${this.m.host}:${this.cwd === this.env.HOME ? '~' : this.cwd}$ `; }
  print(s) { this.term.write(bytes(s)); }
  // a line typed in the terminal: input for the running program, or a command
  input(line) {
    if (this.running) { this.tty.inq.push(bytes(line + '\n')); this.tty.rq.wake(); return Promise.resolve(); }
    return this.run(line);
  }
  eof() { if (this.running) { this.tty.inq.push(new Uint8Array(0)); this.tty.rq.wake(); } }
  interrupt() { for (const p of [...this.fg]) this.killTree(p, 2); }
  killTree(p, sig) { for (const c of [...this.m.procs.values()]) if (c.ppid === p.pid) this.killTree(c, sig); this.m.kill(p, sig); }
  async run(line) {
    this.running = true; this.term.busy(true);
    try {
      const toks = tokenize(line, this.env);
      let seg = [], skip = false;
      const flush = async (op) => {
        const part = seg; seg = [];
        if (!part.length) return;
        if (!skip) { const code = await this.pipeline(part, op === '&'); this.env['?'] = String(code); }
        skip = op === '&&' ? this.env['?'] !== '0' : op === '||' ? this.env['?'] === '0' : false;
      };
      for (const t of toks) { if (t.op && [';', '&&', '||', '&'].includes(t.op)) await flush(t.op); else seg.push(t); }
      await flush(';');
    } catch (e) { if (e !== KILLED) { this.print(`bash: ${e instanceof Errno ? e.text : e.message}\n`); if (!(e instanceof Errno)) console.error(e); } }
    this.running = false; this.tty.inq.length = 0; this.term.busy(false);
  }
  async pipeline(toks, bg) {
    const cmds = [[]]; for (const t of toks) { if (t.op === '|') cmds.push([]); else cmds[cmds.length - 1].push(t); }
    const procs = []; let prevRead = null, code = 0;
    for (let i = 0; i < cmds.length; i++) {
      const argv = [], stdio = [prevRead || this.ttyOfd, this.ttyOfd, this.ttyOfd]; const c = cmds[i];
      try {
        for (let j = 0; j < c.length; j++) {
          const t = c[j];
          if (t.w !== undefined) { argv.push(t.w.replaceAll('\u0001', this.env['?'])); continue; }
          if (t.op === '2>&1') { stdio[2] = stdio[1]; continue; }
          const file = c[++j]?.w; if (file === undefined) throw new Error('syntax error near unexpected token `newline\'');
          if (t.op === '<') stdio[0] = this.m.openOfd(this.cwd, file, O.RDONLY);
          else stdio[t.op[0] === '2' ? 2 : 1] = this.m.openOfd(this.cwd, file, O.WRONLY | O.CREAT | (t.op.endsWith('>>') ? O.APPEND : O.TRUNC));
        }
      } catch (e) { if (!(e instanceof Errno)) throw e; this.print(`bash: ${c.find((t, k) => c[k - 1]?.op)?.w ?? ''}: ${e.text}\n`); return 1; }
      prevRead = null;
      if (i < cmds.length - 1) { const [r, w] = this.m.mkpipe(); if (stdio[1] === this.ttyOfd) stdio[1] = w; else w.pipe.writers = 0; prevRead = r; }
      if (!argv.length) continue;
      // builtins change the shell itself
      if (argv[0] === 'cd') { const to = this.m.norm(argv[1] || this.env.HOME, this.cwd); const ino = this.m.lookup(to); if (!ino || ino.type !== 'dir') { this.print(`bash: cd: ${argv[1]}: No such file or directory\n`); code = 1; } else this.cwd = to; continue; }
      if (argv[0] === 'export' || (/^\w+=/.test(argv[0]) && argv.length === 1)) { for (const a of argv.slice(argv[0] === 'export' ? 1 : 0)) { const k = a.indexOf('='); if (k > 0) this.env[a.slice(0, k)] = a.slice(k + 1); } continue; }
      if (argv[0] === 'clear') { this.term.clear(); continue; }
      if (argv[0] === 'exit') { this.print('This terminal stays open: there is nowhere to exit to.\n'); continue; }
      const p = this.spawn(argv, stdio, this.proc.pid, bg);
      if (!p) { this.print(`${argv[0]}: command not found\n`); code = 127; if (prevRead) prevRead.pipe.writers = 0; continue; }
      procs.push(p);
    }
    for (const p of procs) p.start();
    if (bg) { if (procs.length) this.print(`[${++this.jobs}] ${procs[procs.length - 1].pid}\n`); return 0; }
    for (const p of procs) { this.fg.add(p); }
    for (const p of procs) { code = await p.done; this.fg.delete(p); }
    if (code === 130) this.print('^C\n'); else if (code === 143) this.print('Terminated\n');
    return code;
  }
  spawn(argv, stdio, ppid, bg) {
    const main = findProgram(this.m, argv[0]); if (!main) return null;
    const m = this.m, self = this;
    const p = m.spawn({ argv, stdio, cwd: this.cwd, env: this.env, ppid, exe: m.world.programs.has(argv[0].replace(/^\.\//, '')) ? '/usr/local/bin/' + argv[0].replace(/^\.\//, '') : undefined,
      main: (ctx) => {
        // a program may run another one with the same terminal and files (strace, timeout, time)
        ctx.run = (av, o = {}) => { const ch = self.spawn(av, [0, 1, 2].map((i) => p.fds.get(i)), p.pid, bg); if (!ch) { ctx.err(`${argv[0]}: ${av[0]}: command not found\n`); return null; } if (!o.hold) ch.start(); return ch; };
        return main(ctx);
      } });
    p.bg = bg;
    return p;
  }
  // names for Tab completion
  complete(word, first) {
    if (first && !word.includes('/')) return [...new Set([...Object.keys(P), ...this.m.world.programs.keys(), 'cd', 'export', 'clear'])].filter((n) => n.startsWith(word)).sort();
    const i = word.lastIndexOf('/'); const dir = i < 0 ? '.' : word.slice(0, i) || '/'; const base = word.slice(i + 1);
    const ino = this.m.lookup(this.m.norm(dir.replace(/^~/, this.env.HOME), this.cwd)); if (!ino || ino.type !== 'dir') return [];
    return [...ino.children.entries()].filter(([n]) => n.startsWith(base)).map(([n, c]) => (i < 0 ? '' : word.slice(0, i + 1)) + n + (c.type === 'dir' ? '/' : '')).sort();
  }
}

// a fresh world for the course: machines A and B on one link, with a file to send on A
export function setupMachines(world) {
  const a = world.addMachine('A', '10.0.0.1'), b = world.addMachine('B', '10.0.0.2');
  for (const m of [a, b]) {
    m.writeFile('/etc/hosts', '127.0.0.1 localhost\n10.0.0.1 a\n10.0.0.2 b\n');
    m.env.A_IP = '10.0.0.1'; m.env.B_IP = '10.0.0.2';
  }
  a.writeFile('/tmp/big.bin', prngBytes(2 << 20, 42));
  a.writeFile('/tmp/hello.txt', 'hello from machine A\n');
  return { a, b };
}
