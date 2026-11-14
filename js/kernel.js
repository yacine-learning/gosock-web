// The simulated kernel: machines, files, processes, descriptors, sockets and a small TCP.
// Everything a program does goes through Machine.sys(process, name, ...args), which is also
// where tracing (strace) and the live kernel view hook in. No DOM here: it runs in Node too.

export const ERR = {
  EPERM: [1, 'Operation not permitted'], ENOENT: [2, 'No such file or directory'], EINTR: [4, 'Interrupted system call'],
  EBADF: [9, 'Bad file descriptor'], EAGAIN: [11, 'Resource temporarily unavailable'], EACCES: [13, 'Permission denied'],
  EEXIST: [17, 'File exists'], ENOTDIR: [20, 'Not a directory'], EISDIR: [21, 'Is a directory'], EINVAL: [22, 'Invalid argument'],
  ESPIPE: [29, 'Illegal seek'], EPIPE: [32, 'Broken pipe'], ENOSYS: [38, 'Function not implemented'], ENOTEMPTY: [39, 'Directory not empty'],
  ENOTSOCK: [88, 'Socket operation on non-socket'], EDESTADDRREQ: [89, 'Destination address required'],
  ENOPROTOOPT: [92, 'Protocol not available'], EOPNOTSUPP: [95, 'Operation not supported'], EAFNOSUPPORT: [97, 'Address family not supported by protocol'],
  EADDRINUSE: [98, 'Address already in use'], EADDRNOTAVAIL: [99, 'Cannot assign requested address'], ENETUNREACH: [101, 'Network is unreachable'],
  ECONNRESET: [104, 'Connection reset by peer'], EISCONN: [106, 'Transport endpoint is already connected'],
  ENOTCONN: [107, 'Transport endpoint is not connected'], ETIMEDOUT: [110, 'Connection timed out'], ECONNREFUSED: [111, 'Connection refused'],
  EHOSTUNREACH: [113, 'No route to host'], EINPROGRESS: [115, 'Operation now in progress'],
};
export class Errno extends Error {
  constructor(code) { super(ERR[code] ? ERR[code][1] : code); this.code = code; }
  get text() { return ERR[this.code][1]; }
}
export const KILLED = { killed: true };   // thrown through a program when its process dies
const err = (c) => { throw new Errno(c); };

export const O = { RDONLY: 0, WRONLY: 1, RDWR: 2, CREAT: 0o100, EXCL: 0o200, TRUNC: 0o1000, APPEND: 0o2000, NONBLOCK: 0o4000, DIRECTORY: 0o200000, CLOEXEC: 0o2000000 };
export const MSS = 1460;
const te = new TextEncoder(), td = new TextDecoder();
export const bytes = (s) => (typeof s === 'string' ? te.encode(s) : s);
export const text = (b) => td.decode(b);

// ── small building blocks ──
class ByteQ {
  constructor() { this.c = []; this.len = 0; this.off = 0; }
  push(u8) { if (u8.length) { this.c.push(u8); this.len += u8.length; } }
  peek(start, n) {
    const out = new Uint8Array(n); let o = 0, skip = start + this.off;
    for (const h of this.c) {
      if (skip >= h.length) { skip -= h.length; continue; }
      const take = Math.min(n - o, h.length - skip);
      out.set(h.subarray(skip, skip + take), o); o += take; skip = 0;
      if (o === n) break;
    }
    return out;
  }
  drop(n) {
    this.len -= n;
    while (n > 0) {
      const h = this.c[0], take = Math.min(n, h.length - this.off);
      this.off += take; n -= take;
      if (this.off === h.length) { this.c.shift(); this.off = 0; }
    }
  }
  shift(n) { n = Math.min(n, this.len); const out = this.peek(0, n); this.drop(n); return out; }
}

class WaitQ {
  constructor() { this.w = new Set(); }
  wake() { const w = [...this.w]; this.w.clear(); for (const f of w) f(); }
  wait(p) {
    return new Promise((res, rej) => {
      const done = () => { p && p.killW.delete(kill); res(); };
      const kill = () => { this.w.delete(done); rej(KILLED); };
      this.w.add(done); p && p.killW.add(kill);
    });
  }
}

// deterministic bytes, so a generated file has the same checksum for everyone
export function prngBytes(n, seed = 1) {
  const out = new Uint8Array(n); let x = (seed * 2654435761) >>> 0 || 1;
  for (let i = 0; i < n; i++) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; out[i] = x & 255; }
  return out;
}

// ── the world: machines, the wire between them, the clock, the event feed ──
export class World {
  constructor() {
    this.machines = []; this.byIp = new Map(); this.t0 = performance.now();
    this.subs = new Set(); this.queue = []; this.pumping = false;
    this.speed = 0;          // ms of real time per packet on the wire (0 = as fast as possible)
    this.seq = 0; this.programs = new Map();   // name -> async function(ctx) (tools and built Go programs)
    this.walltime0 = Date.now();
  }
  now() { return (performance.now() - this.t0) / 1000; }             // seconds since boot
  on(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
  emit(type, data) { for (const f of this.subs) f(type, data); }
  addMachine(name, ip) { const m = new Machine(this, name, ip); this.machines.push(m); this.byIp.set(ip, m); return m; }
  // run fn "later": packets and timers go through here so the page can slow them down
  sched(fn) { this.queue.push(fn); if (!this.pumping) { this.pumping = true; this._tick(); } }
  _tick() {
    const run = () => {
      const end = performance.now() + 6;
      while (this.queue.length) {
        this.queue.shift()();
        if (this.speed > 0 || performance.now() > end) break;
      }
      if (this.queue.length) this._defer(run, this.speed); else this.pumping = false;
    };
    this._defer(run, this.speed);
  }
  _defer(fn, ms) {
    if (ms > 0 || typeof MessageChannel === 'undefined') return setTimeout(fn, ms);
    const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); fn(); }; ch.port2.postMessage(0);
  }
  timer(fn, ms) { return setTimeout(fn, ms); }
  // the wire: deliver a TCP segment to the machine that owns the destination address
  tx(from, seg) {
    const local = seg.dst.startsWith('127.') || seg.dst === from.ip;
    const to = local ? from : this.byIp.get(seg.dst);
    const pk = { id: ++this.seq, t: this.now(), seg, from, to, dev: local ? 'lo' : 'eth0' };
    this.emit('packet', pk);
    if (to) this.sched(() => { this.emit('deliver', pk); to.tcpInput(seg); this.emit('change'); });
  }
}

// ── files ──
let INO = 100;
class Inode {
  constructor(type, mode) { this.ino = ++INO; this.type = type; this.mode = mode; this.size = 0; this.data = new Uint8Array(0); this.children = type === 'dir' ? new Map() : null; this.mtime = Date.now(); this.nlink = 1; }
  write(pos, buf) {
    const end = pos + buf.length;
    if (end > this.data.length) { const d = new Uint8Array(Math.max(end, this.data.length * 2, 4096)); d.set(this.data.subarray(0, this.size)); this.data = d; }
    this.data.set(buf, pos); if (end > this.size) this.size = end; this.mtime = Date.now();
    return buf.length;
  }
  read(pos, n) { return this.data.slice(Math.min(pos, this.size), Math.min(pos + n, this.size)); }
  truncate(n) { if (n < this.size) this.data.fill(0, n, this.size); else if (n > this.data.length) { const d = new Uint8Array(n); d.set(this.data.subarray(0, this.size)); this.data = d; } this.size = n; }
}

let OFD = 0, SOCK = 0;
const mkofd = (kind, o) => ({ id: ++OFD, kind, pos: 0, flags: 0, refs: 0, ...o });

// ── a machine: one kernel ──
export class Machine {
  constructor(world, name, ip) {
    this.world = world; this.name = name; this.ip = ip; this.host = name.toLowerCase();
    this.root = new Inode('dir', 0o755); this.procs = new Map(); this.nextPid = 1200 + world.machines.length * 1000;
    this.socks = new Set(); this.conns = new Map(); this.listeners = new Map(); this.bound = new Map();
    this.eph = 41952 + world.machines.length * 4217; this.issSeed = 1000 + world.machines.length * 77777;
    this.env = { HOME: '/home/student', PATH: '/usr/local/bin:/usr/bin', USER: 'student', HOSTNAME: this.host };
    for (const d of ['/tmp', '/etc', '/dev', '/proc', '/usr', '/usr/bin', '/usr/local', '/usr/local/bin', '/home', '/home/student']) this.mkdirp(d);
    for (const n of ['null', 'zero', 'urandom']) { const i = new Inode('chr', 0o666); i.dev = n; this.root.children.get('dev').children.set(n, i); }
    this.writeFile('/etc/hostname', this.host + '\n');
  }
  // path helpers
  norm(path, cwd = '/') {
    const parts = [];
    for (const s of ((path.startsWith('/') ? '' : cwd + '/') + path).split('/')) { if (s === '' || s === '.') continue; if (s === '..') parts.pop(); else parts.push(s); }
    return '/' + parts.join('/');
  }
  lookup(abs) { let n = this.root; for (const s of abs.split('/')) { if (!s) continue; if (n.type !== 'dir') err('ENOTDIR'); n = n.children.get(s); if (!n) return null; } return n; }
  parent(abs) { const i = abs.lastIndexOf('/'); const dir = this.lookup(abs.slice(0, i) || '/'); if (!dir) err('ENOENT'); if (dir.type !== 'dir') err('ENOTDIR'); return [dir, abs.slice(i + 1)]; }
  mkdirp(abs) { let n = this.root; for (const s of abs.split('/')) { if (!s) continue; if (!n.children.has(s)) n.children.set(s, new Inode('dir', 0o755)); n = n.children.get(s); } return n; }
  writeFile(abs, data, mode = 0o644) { const [dir, name] = this.parent(abs); const i = new Inode('file', mode); i.write(0, bytes(data)); dir.children.set(name, i); return i; }
  readFile(abs) { const i = this.lookup(abs); return i && i.type === 'file' ? i.data.slice(0, i.size) : null; }

  // ── processes ──
  // spawn runs `main(ctx)` as a process. stdio = three open file descriptions (shared, like fork does).
  spawn({ argv, main, stdio, cwd = '/home/student', env = {}, ppid = 1, exe }) {
    const p = { pid: this.nextPid++, ppid, comm: argv[0].split('/').pop(), argv, cwd, env: { ...this.env, ...env }, fds: new Map(), killW: new Set(), dead: false, code: null, m: this, traced: null, hooks: [] };
    stdio.forEach((ofd, i) => { ofd.refs++; p.fds.set(i, ofd); });
    p.done = new Promise((res) => { p._done = res; });
    this.procs.set(p.pid, p);
    const ctx = { p, m: this, argv, env: p.env, sys: (name, ...a) => this.sys(p, name, ...a) };
    ctx.out = (s) => ctx.sys('write', 1, bytes(s)); ctx.err = (s) => ctx.sys('write', 2, bytes(s));
    p.start = () => {
      this.trace(p, 'execve', [exe || '/usr/bin/' + p.comm, argv], 0);
      Promise.resolve().then(() => main(ctx)).then((code) => this.exit(p, code | 0, true), (e) => {
        if (e === KILLED) return;
        if (e instanceof Errno) return ctx.err(`${p.comm}: ${e.text}\n`).catch(() => {}).then(() => this.exit(p, 1, true));
        console.error(e); this.exit(p, 70);
      });
    };
    this.world.emit('change');
    return p;
  }
  exit(p, code, traced) {
    if (p.dead) return;
    if (traced) this.trace(p, 'exit_group', [code], '?');
    p.dead = true; p.code = code;
    for (const fd of [...p.fds.keys()]) this.closeFd(p, fd);
    for (const k of [...p.killW]) k();
    p.killW.clear(); this.procs.delete(p.pid);
    for (const h of p.hooks) h(code);
    p._done(code); this.world.emit('exit', p); this.world.emit('change');
  }
  kill(p, sig = 15) { if (!p.dead) { this.world.emit('signal', { p, sig }); this.exit(p, 128 + sig); } }

  // ── the system call gate ──
  trace(p, name, args, ret, e) {
    const r = { id: ++this.world.seq, m: this, pid: p.pid, comm: p.comm, name, args, ret, err: e, t: this.world.now(), t1: this.world.now(), done: true };
    this.world.emit('sys', r); return r;
  }
  async sys(p, name, ...args) {
    if (p.dead) throw KILLED;
    const fn = this['sys_' + name]; if (!fn) err('ENOSYS');
    const quiet = name[0] === '_';
    const r = { id: ++this.world.seq, m: this, pid: p.pid, comm: p.comm, name, args: args.map(preview), t: this.world.now(), done: false };
    if (!quiet) this.world.emit('sys-enter', r);
    if (this.world.gate && !quiet) await this.world.gate(r, p);
    try {
      const ret = await fn.call(this, p, ...args);
      if (p.dead && name !== 'exit_group') throw KILLED;
      r.ret = preview(ret);
      return ret;
    } catch (e) {
      if (e instanceof Errno) r.err = e.code;
      throw e;
    } finally {
      r.t1 = this.world.now(); r.done = true;
      if (!quiet && (r.err || r.ret !== undefined)) { this.world.emit('sys', r); this.world.emit('change'); }
    }
  }
  ofd(p, fd) { const o = p.fds.get(fd); if (!o) err('EBADF'); return o; }
  install(p, ofd, min = 0) { let fd = min; while (p.fds.has(fd)) fd++; ofd.refs++; p.fds.set(fd, ofd); return fd; }
  closeFd(p, fd) {
    const o = p.fds.get(fd); if (!o) err('EBADF');
    p.fds.delete(fd);
    if (--o.refs > 0) return;
    if (o.kind === 'sock') this.sockClose(o.sock);
    else if (o.kind === 'pipe') { const pi = o.pipe; if (o.end === 'r') { pi.readers--; pi.wq.wake(); } else { pi.writers--; pi.rq.wake(); } }
  }

  // files
  sys_openat(p, path, flags = 0, mode = 0o644) { return this.install(p, this.openOfd(p.cwd, path, flags, mode)); }
  openOfd(cwd, path, flags = 0, mode = 0o644) {
    const abs = this.norm(path, cwd); let ino = this.lookup(abs);
    if (!ino) { if (!(flags & O.CREAT)) err('ENOENT'); const [dir, name] = this.parent(abs); ino = new Inode('file', mode & 0o777); dir.children.set(name, ino); }
    else if ((flags & O.CREAT) && (flags & O.EXCL)) err('EEXIST');
    const acc = flags & 3;
    if (ino.type === 'dir' && acc !== O.RDONLY) err('EISDIR');
    if ((flags & O.DIRECTORY) && ino.type !== 'dir') err('ENOTDIR');
    if ((flags & O.TRUNC) && ino.type === 'file' && acc !== O.RDONLY) ino.truncate(0);
    const o = mkofd(ino.type === 'dir' ? 'dir' : ino.type === 'chr' ? 'chr' : 'file', { ino, flags, path: abs });
    if (ino.gen) o.snap = bytes(ino.gen(this));
    return o;
  }
  sys_close(p, fd) { this.closeFd(p, fd); return 0; }
  async sys_read(p, fd, n) { return this.readOfd(p, this.ofd(p, fd), n, null); }
  async sys_pread64(p, fd, n, pos) { const o = this.ofd(p, fd); if (o.kind !== 'file') err('ESPIPE'); return this.readOfd(p, o, n, pos); }
  async readOfd(p, o, n, pos) {
    if ((o.flags & 3) === O.WRONLY && o.kind !== 'sock' && o.kind !== 'tty') err('EBADF');
    switch (o.kind) {
      case 'file': {
        const at = pos ?? o.pos;
        const b = o.snap ? o.snap.slice(at, at + n) : o.ino.read(at, n);
        if (pos == null) o.pos += b.length; return b;
      }
      case 'chr': return o.ino.dev === 'null' ? new Uint8Array(0) : o.ino.dev === 'zero' ? new Uint8Array(n) : prngBytes(n, 7 + (o.pos += n));
      case 'dir': err('EISDIR');
      case 'tty': {
        while (!o.tty.inq.length) await o.tty.rq.wait(p);
        const item = o.tty.inq[0];
        if (item.length <= n) { o.tty.inq.shift(); return item; }
        o.tty.inq[0] = item.subarray(n); return item.slice(0, n);
      }
      case 'pipe': {
        if (o.end !== 'r') err('EBADF');
        const pi = o.pipe;
        while (!pi.q.len) { if (!pi.writers) return new Uint8Array(0); await pi.rq.wait(p); }
        const b = pi.q.shift(n); pi.wq.wake(); return b;
      }
      case 'sock': return this.sockRead(p, o.sock, n);
    }
    err('EINVAL');
  }
  async sys_write(p, fd, buf) { return this.writeOfd(p, this.ofd(p, fd), buf, null); }
  async sys_pwrite64(p, fd, buf, pos) { const o = this.ofd(p, fd); if (o.kind !== 'file') err('ESPIPE'); return this.writeOfd(p, o, buf, pos); }
  async writeOfd(p, o, buf, pos) {
    if ((o.flags & 3) === O.RDONLY && (o.kind === 'file' || o.kind === 'dir')) err('EBADF');
    switch (o.kind) {
      case 'file': {
        if (o.snap) err('EACCES');
        const at = (o.flags & O.APPEND) ? o.ino.size : (pos ?? o.pos);
        o.ino.write(at, buf); if (pos == null) o.pos = at + buf.length; return buf.length;
      }
      case 'chr': return buf.length;
      case 'tty': o.tty.write(buf); return buf.length;
      case 'pipe': {
        if (o.end !== 'w') err('EBADF');
        const pi = o.pipe; let done = 0;
        while (done < buf.length) {
          if (!pi.readers) err('EPIPE');
          const room = pi.cap - pi.q.len;
          if (room <= 0) { await pi.wq.wait(p); continue; }
          const take = Math.min(room, buf.length - done);
          pi.q.push(buf.slice(done, done + take)); done += take; pi.rq.wake();
        }
        return done;
      }
      case 'sock': return this.sockWrite(p, o.sock, buf);
    }
    err('EINVAL');
  }
  sys_lseek(p, fd, off, whence) {
    const o = this.ofd(p, fd); if (o.kind !== 'file') err('ESPIPE');
    const base = whence === 0 ? 0 : whence === 1 ? o.pos : o.ino.size;
    if (base + off < 0) err('EINVAL');
    return (o.pos = base + off);
  }
  statOf(ino) { return { ino: ino.ino, type: ino.type, mode: ino.mode, size: ino.type === 'file' ? ino.size : ino.type === 'dir' ? 4096 : 0, nlink: ino.nlink, mtime: ino.mtime }; }
  sys_fstat(p, fd) {
    const o = this.ofd(p, fd);
    if (o.ino) return this.statOf(o.ino);
    return { ino: o.id, type: o.kind === 'sock' ? 'sock' : o.kind === 'pipe' ? 'fifo' : 'chr', mode: o.kind === 'sock' ? 0o777 : 0o620, size: 0, nlink: 1, mtime: Date.now() };
  }
  sys__fstat(p, fd) { return this.sys_fstat(p, fd); }
  sys_newfstatat(p, path) { const i = this.lookup(this.norm(path, p.cwd)); if (!i) err('ENOENT'); return this.statOf(i); }
  sys__stat(p, path) { return this.sys_newfstatat(p, path); }
  async sys__wait(p, child) { return this.sys_wait4(p, child); }
  sys__readdir(p, path) { const i = this.lookup(this.norm(path, p.cwd)); if (!i) err('ENOENT'); if (i.type !== 'dir') err('ENOTDIR'); return [...i.children.keys()].sort(); }
  sys_getdents64(p, fd) { const o = this.ofd(p, fd); if (o.kind !== 'dir') err('ENOTDIR'); if (o.pos) return []; o.pos = 1; return [...o.ino.children.keys()].sort(); }
  sys_unlink(p, path) { const abs = this.norm(path, p.cwd); const [dir, name] = this.parent(abs); const i = dir.children.get(name); if (!i) err('ENOENT'); if (i.type === 'dir') err('EISDIR'); dir.children.delete(name); return 0; }
  sys_rmdir(p, path) { const abs = this.norm(path, p.cwd); const [dir, name] = this.parent(abs); const i = dir.children.get(name); if (!i) err('ENOENT'); if (i.type !== 'dir') err('ENOTDIR'); if (i.children.size) err('ENOTEMPTY'); dir.children.delete(name); return 0; }
  sys_mkdir(p, path, mode = 0o755) { const abs = this.norm(path, p.cwd); const [dir, name] = this.parent(abs); if (dir.children.has(name)) err('EEXIST'); dir.children.set(name, new Inode('dir', mode)); return 0; }
  sys_rename(p, from, to) {
    const [d1, n1] = this.parent(this.norm(from, p.cwd)), [d2, n2] = this.parent(this.norm(to, p.cwd));
    const i = d1.children.get(n1); if (!i) err('ENOENT'); d1.children.delete(n1); d2.children.set(n2, i); return 0;
  }
  sys_ftruncate(p, fd, n) { const o = this.ofd(p, fd); if (o.kind !== 'file') err('EINVAL'); o.ino.truncate(n); return 0; }
  sys_fsync(p, fd) { this.ofd(p, fd); return 0; }
  sys_chdir(p, path) { const abs = this.norm(path, p.cwd); const i = this.lookup(abs); if (!i) err('ENOENT'); if (i.type !== 'dir') err('ENOTDIR'); p.cwd = abs; return 0; }
  sys_dup(p, fd) { return this.install(p, this.ofd(p, fd)); }
  sys_dup2(p, fd, nfd) { const o = this.ofd(p, fd); if (fd === nfd) return nfd; if (p.fds.has(nfd)) this.closeFd(p, nfd); o.refs++; p.fds.set(nfd, o); return nfd; }
  sys_pipe2(p) { const [r, w] = this.mkpipe(); return [this.install(p, r), this.install(p, w)]; }
  mkpipe() { const pipe = { q: new ByteQ(), cap: 65536, readers: 1, writers: 1, rq: new WaitQ(), wq: new WaitQ() }; return [mkofd('pipe', { pipe, end: 'r' }), mkofd('pipe', { pipe, end: 'w', flags: O.WRONLY })]; }
  mktty(tty) { tty.inq = []; tty.rq = new WaitQ(); return mkofd('tty', { tty, flags: O.RDWR, path: '/dev/pts/' + tty.n }); }
  sys_exit_group(p, code) { this.exit(p, code, true); throw KILLED; }
  async sys_nanosleep(p, sec) { const q = new WaitQ(); this.world.timer(() => q.wake(), sec * 1000); await q.wait(p); return 0; }
  async sys_wait4(p, child) { const q = new WaitQ(); if (child.dead) return child.code; child.hooks.push(() => q.wake()); await q.wait(p); return child.code; }
  async sys_sendfile(p, outFd, inFd, count) {
    const out = this.ofd(p, outFd), inp = this.ofd(p, inFd);
    if (inp.kind !== 'file') err('EINVAL');
    let total = 0;
    while (total < count) {
      const chunk = inp.ino.read(inp.pos, Math.min(65536, count - total));
      if (!chunk.length) break;
      await this.writeOfd(p, out, chunk, null);
      inp.pos += chunk.length; total += chunk.length;
    }
    return total;
  }

  // ── sockets ──
  sock(p, fd) { const o = this.ofd(p, fd); if (o.kind !== 'sock') err('ENOTSOCK'); return o.sock; }
  sys_socket(p, domain, type, proto) {
    if (domain !== 2) err('EAFNOSUPPORT'); if ((type & 15) !== 1) err('EOPNOTSUPP');
    const s = this.mksock();
    return this.install(p, mkofd('sock', { sock: s, flags: O.RDWR }));
  }
  mksock() {
    const s = { id: ++SOCK, m: this, state: 'CLOSED', local: null, remote: null, sndq: new ByteQ(), sndSent: 0, sndCap: 87040, rcvq: new ByteQ(), rcvCap: 131072,
      sndUna: 0, sndNxt: 0, rcvNxt: 0, peerWin: 65535, advWin: 131072, finQueued: false, finSent: false, finAcked: false, finRcvd: false,
      backlog: 0, acceptQ: null, opts: {}, err: null, rq: new WaitQ(), wq: new WaitQ(), cq: new WaitQ(), orphan: false, born: this.world.now(), bytesIn: 0, bytesOut: 0 };
    this.socks.add(s); return s;
  }
  portBusy(port, s) {
    const set = this.bound.get(port); if (!set || !set.size) return false;
    for (const o of set) if (o.state === 'LISTEN' || !s.opts.reuseaddr || !o.opts.reuseaddr) return true;
    return false;
  }
  bindSock(s, ip, port) {
    if (port === 0) { do { port = this.eph; this.eph = this.eph >= 60999 ? 32768 : this.eph + 1 + (this.eph * 7) % 13; } while (this.bound.get(port)?.size); }
    else if (this.portBusy(port, s)) err('EADDRINUSE');
    if (ip !== '0.0.0.0' && ip !== this.ip && !ip.startsWith('127.')) err('EADDRNOTAVAIL');
    s.local = { ip, port }; this.addBound(s);
  }
  addBound(s) { if (!this.bound.has(s.local.port)) this.bound.set(s.local.port, new Set()); this.bound.get(s.local.port).add(s); }
  sys_bind(p, fd, ip, port) { const s = this.sock(p, fd); if (s.local) err('EINVAL'); this.bindSock(s, ip, port); return 0; }
  sys_listen(p, fd, backlog) {
    const s = this.sock(p, fd); if (s.state !== 'CLOSED' && s.state !== 'LISTEN') err('EINVAL');
    if (!s.local) this.bindSock(s, '0.0.0.0', 0);
    if (this.listeners.has(s.local.port) && this.listeners.get(s.local.port) !== s) err('EADDRINUSE');
    s.state = 'LISTEN'; s.backlog = Math.min(backlog, 4096); s.acceptQ = s.acceptQ || []; this.listeners.set(s.local.port, s); return 0;
  }
  async sys_accept(p, fd) {
    const l = this.sock(p, fd); if (l.state !== 'LISTEN') err('EINVAL');
    while (!l.acceptQ.length) { await l.rq.wait(p); if (l.state !== 'LISTEN') err('EBADF'); }
    const s = l.acceptQ.shift(); s.inQueue = false;
    return { fd: this.install(p, mkofd('sock', { sock: s, flags: O.RDWR })), ip: s.remote.ip, port: s.remote.port };
  }
  async sys_connect(p, fd, ip, port) {
    const s = this.sock(p, fd);
    if (s.state === 'LISTEN') err('EOPNOTSUPP'); if (s.state !== 'CLOSED' || s.remote) err('EISCONN');
    const local = ip.startsWith('127.'), self = ip === this.ip;
    if (!local && !self && !this.world.byIp.has(ip)) err('ENETUNREACH');
    if (!s.local) this.bindSock(s, '0.0.0.0', 0);
    s.local.ip = local ? '127.0.0.1' : this.ip;
    s.remote = { ip, port }; s.state = 'SYN_SENT'; s.iss = this.iss(); s.sndUna = s.iss; s.sndNxt = s.iss + 1;
    this.conns.set(key(s.local.port, ip, port), s);
    let tries = 0;
    const syn = () => {
      if (s.state !== 'SYN_SENT') return;
      if (tries === 4) { s.err = 'ETIMEDOUT'; s.state = 'CLOSED'; s.cq.wake(); return; }
      this.segOut(s, 'S', s.iss); this.world.timer(syn, 1000 << tries++);
    };
    syn();
    while (s.state === 'SYN_SENT') await s.cq.wait(p);
    if (s.err) { const e = s.err; s.err = null; this.sockDestroy(s); s.remote = null; err(e); }
    return 0;
  }
  sys_getsockname(p, fd) { const s = this.sock(p, fd); return s.local ? { ...s.local } : { ip: '0.0.0.0', port: 0 }; }
  sys_getpeername(p, fd) { const s = this.sock(p, fd); if (!s.remote || s.state === 'CLOSED') err('ENOTCONN'); return { ...s.remote }; }
  sys_setsockopt(p, fd, level, opt, val) {
    const s = this.sock(p, fd), n = optName(level, opt); if (!n) err('ENOPROTOOPT');
    if (n === 'SO_RCVBUF') { s.rcvCap = Math.max(2304, val * 2); s.opts.rcvbuf = true; }
    else if (n === 'SO_SNDBUF') { s.sndCap = Math.max(4608, val * 2); s.opts.sndbuf = true; }
    else s.opts[n.replace(/^(SO|TCP)_/, '').toLowerCase()] = val;
    return 0;
  }
  sys_getsockopt(p, fd, level, opt) {
    const s = this.sock(p, fd), n = optName(level, opt); if (!n) err('ENOPROTOOPT');
    if (n === 'SO_ERROR') { const e = s.err; s.err = null; return e ? ERR[e][0] : 0; }
    if (n === 'SO_RCVBUF') return s.rcvCap; if (n === 'SO_SNDBUF') return s.sndCap;
    if (n === 'SO_TYPE') return 1; if (n === 'SO_ACCEPTCONN') return s.state === 'LISTEN' ? 1 : 0;
    return s.opts[n.replace(/^(SO|TCP)_/, '').toLowerCase()] | 0;
  }
  sys_shutdown(p, fd, how) {
    const s = this.sock(p, fd);
    if (!['ESTABLISHED', 'CLOSE_WAIT', 'FIN_WAIT_1', 'FIN_WAIT_2'].includes(s.state)) err('ENOTCONN');
    if (how === 0 || how === 2) { s.rdShut = true; s.rq.wake(); }
    if (how === 1 || how === 2) this.sendFin(s);
    return 0;
  }
  iss() { this.issSeed = (this.issSeed * 1103515245 + 12345) >>> 0; return this.issSeed; }

  async sockRead(p, s, n) {
    if (s.state === 'LISTEN' || (s.state === 'CLOSED' && !s.remote)) err('ENOTCONN');
    for (;;) {
      if (s.rcvq.len) break;
      if (s.err) { const e = s.err; s.err = null; err(e); }
      if (s.finRcvd || s.rdShut || s.state === 'CLOSED') return new Uint8Array(0);
      await s.rq.wait(p);
    }
    const b = s.rcvq.shift(n);
    // tell the sender when the window has reopened by a useful amount
    const win = s.rcvCap - s.rcvq.len;
    if (!s.finRcvd && s.state !== 'CLOSED' && win - s.advWin >= Math.min(s.rcvCap / 2, 2 * MSS)) this.segOut(s, 'A', s.sndNxt);
    return b;
  }
  async sockWrite(p, s, buf) {
    let done = 0;
    while (done < buf.length) {
      if (s.err) { const e = s.err; s.err = null; err(e); }
      if (s.state === 'LISTEN' || (s.state === 'CLOSED' && !s.remote)) err('ENOTCONN');
      if (s.finQueued || s.state === 'CLOSED') err('EPIPE');
      const room = s.sndCap - s.sndq.len;
      if (room <= 0) { await s.wq.wait(p); continue; }
      const take = Math.min(room, buf.length - done);
      s.sndq.push(buf.slice(done, done + take)); done += take; s.bytesOut += take;
      this.tcpOutput(s);
    }
    return done;
  }
  sendFin(s) {
    if (s.finQueued) return;
    s.finQueued = true;
    if (s.state === 'ESTABLISHED') s.state = 'FIN_WAIT_1'; else if (s.state === 'CLOSE_WAIT') s.state = 'LAST_ACK';
    this.tcpOutput(s);
  }
  sockClose(s) {
    s.orphan = true; s.rq.wake(); s.wq.wake(); s.cq.wake();
    if (s.state === 'LISTEN') {
      this.listeners.delete(s.local.port);
      for (const c of s.acceptQ) { this.segOut(c, 'R', c.sndNxt); c.orphan = true; this.sockDestroy(c); }
      for (const c of this.conns.values()) if (c.listener === s && c.state === 'SYN_RECV') this.sockDestroy(c);
      s.state = 'CLOSED'; return this.sockDestroy(s);
    }
    if (['CLOSED', 'SYN_SENT'].includes(s.state)) return this.sockDestroy(s);
    if (s.rcvq.len) { this.segOut(s, 'R', s.sndNxt); return this.sockDestroy(s); }   // unread data: reset, as Linux does
    if (s.state === 'ESTABLISHED' || s.state === 'CLOSE_WAIT') this.sendFin(s);
  }
  sockDestroy(s) {
    s.state = 'CLOSED';
    if (s.remote && s.local && this.conns.get(key(s.local.port, s.remote.ip, s.remote.port)) === s) this.conns.delete(key(s.local.port, s.remote.ip, s.remote.port));
    if (s.local) this.bound.get(s.local.port)?.delete(s);
    if (s.orphan) this.socks.delete(s);
    s.rq.wake(); s.wq.wake(); s.cq.wake();
  }
  // send one segment for socket s
  segOut(s, flags, seq, data) {
    const win = Math.max(0, s.rcvCap - s.rcvq.len); s.advWin = win;
    const ack = flags === 'S' ? 0 : s.rcvNxt;
    this.world.tx(this, { src: s.local.ip === '0.0.0.0' ? this.ip : s.local.ip, dst: s.remote.ip, sport: s.local.port, dport: s.remote.port, seq, ack, flags, win, len: data ? data.length : 0, data, iss: s.iss, irs: s.irs });
  }
  tcpOutput(s) {
    if (!['ESTABLISHED', 'CLOSE_WAIT', 'FIN_WAIT_1', 'LAST_ACK'].includes(s.state)) return;
    while (s.sndq.len - s.sndSent > 0) {
      const room = s.peerWin - s.sndSent; if (room <= 0) break;
      const len = Math.min(MSS, s.sndq.len - s.sndSent, room);
      const last = s.sndSent + len === s.sndq.len;
      this.segOut(s, last ? 'PA' : 'A', s.sndUna + s.sndSent, s.sndq.peek(s.sndSent, len));
      s.sndSent += len; s.sndNxt = s.sndUna + s.sndSent;
    }
    if (s.finQueued && !s.finSent && s.sndq.len === s.sndSent) {
      s.finSeq = s.sndUna + s.sndSent; s.finSent = true; s.sndNxt = s.finSeq + 1;
      this.segOut(s, 'FA', s.finSeq);
    }
  }
  tcpInput(g) {
    const F = (c) => g.flags.includes(c);
    let s = this.conns.get(key(g.dport, g.src, g.sport));
    if (!s) {
      const l = this.listeners.get(g.dport);
      if (l && (l.local.ip === '0.0.0.0' || l.local.ip === g.dst) && F('S') && !F('A')) {
        if (l.acceptQ.length > l.backlog) return;                 // accept queue full: the SYN is dropped
        const c = this.mksock();
        Object.assign(c, { state: 'SYN_RECV', local: { ip: g.dst, port: g.dport }, remote: { ip: g.src, port: g.sport }, listener: l, irs: g.seq, rcvNxt: g.seq + 1, peerWin: g.win, opts: { ...l.opts }, orphan: true, inQueue: true });
        c.rcvCap = l.rcvCap; c.sndCap = l.sndCap; c.iss = this.iss(); c.sndUna = c.iss; c.sndNxt = c.iss + 1;
        this.conns.set(key(g.dport, g.src, g.sport), c); this.addBound(c);
        return this.segOut(c, 'SA', c.iss);
      }
      if (!F('R')) this.world.tx(this, { src: g.dst, dst: g.src, sport: g.dport, dport: g.sport, seq: F('A') ? g.ack : 0, ack: g.seq + g.len + (F('S') || F('F') ? 1 : 0), flags: 'RA', win: 0, len: 0 });
      return;
    }
    if (F('R')) {
      if (s.state === 'SYN_SENT') { s.err = 'ECONNREFUSED'; s.state = 'CLOSED'; s.cq.wake(); return; }
      s.err = 'ECONNRESET'; s.sndq = new ByteQ(); s.sndSent = 0;
      return this.sockDestroy(s);
    }
    if (s.state === 'SYN_SENT') {
      if (!(F('S') && F('A')) || g.ack !== s.iss + 1) return;
      s.irs = g.seq; s.rcvNxt = g.seq + 1; s.sndUna = g.ack; s.peerWin = g.win; s.state = 'ESTABLISHED';
      this.segOut(s, 'A', s.sndNxt); s.cq.wake(); return;
    }
    if (s.state === 'SYN_RECV') {
      if (F('S')) return this.segOut(s, 'SA', s.iss);              // retransmitted SYN
      if (!F('A') || g.ack !== s.iss + 1) return;
      s.sndUna = g.ack; s.state = 'ESTABLISHED'; s.peerWin = g.win;
      const l = s.listener;
      if (l.state === 'LISTEN') { l.acceptQ.push(s); s.orphan = false; l.rq.wake(); } else { this.segOut(s, 'R', s.sndNxt); return this.sockDestroy(s); }
    }
    if (F('A') && g.ack > s.sndUna && g.ack <= s.sndNxt) {
      let acked = g.ack - s.sndUna;
      if (s.finSent && g.ack === s.finSeq + 1) { s.finAcked = true; acked--; }
      s.sndq.drop(acked); s.sndSent -= acked; s.sndUna = g.ack; s.wq.wake();
    }
    if (F('A')) s.peerWin = g.win;
    let ackNow = false;
    if (g.len && g.seq === s.rcvNxt) {
      if (s.orphan && !s.inQueue || s.rdShut) { this.segOut(s, 'R', s.sndNxt); if (!s.orphan) s.err = 'ECONNRESET'; return this.sockDestroy(s); }
      s.rcvq.push(g.data); s.rcvNxt += g.len; s.bytesIn += g.len; s.rq.wake(); ackNow = true;
    }
    if (F('F') && g.seq + g.len === s.rcvNxt && !s.finRcvd) {
      s.finRcvd = true; s.rcvNxt++; ackNow = true; s.rq.wake();
      if (s.state === 'ESTABLISHED') s.state = 'CLOSE_WAIT';
      else if (s.state === 'FIN_WAIT_1') s.state = s.finAcked ? 'TIME_WAIT' : 'CLOSING';
      else if (s.state === 'FIN_WAIT_2') s.state = 'TIME_WAIT';
    }
    if (s.finAcked) {
      if (s.state === 'FIN_WAIT_1') s.state = 'FIN_WAIT_2';
      else if (s.state === 'CLOSING') s.state = 'TIME_WAIT';
      else if (s.state === 'LAST_ACK') { if (ackNow) this.segOut(s, 'A', s.sndNxt); return this.sockDestroy(s); }
    }
    if (ackNow) this.segOut(s, 'A', s.sndNxt);
    if (s.state === 'TIME_WAIT' && !s.twTimer) s.twTimer = this.world.timer(() => { s.orphan = true; this.sockDestroy(s); this.world.emit('change'); }, 60000);
    this.tcpOutput(s);
  }
}
const key = (lport, rip, rport) => lport + '|' + rip + '|' + rport;
const SOPT = { 2: 'SO_REUSEADDR', 3: 'SO_TYPE', 4: 'SO_ERROR', 7: 'SO_SNDBUF', 8: 'SO_RCVBUF', 9: 'SO_KEEPALIVE', 13: 'SO_LINGER', 15: 'SO_REUSEPORT', 30: 'SO_ACCEPTCONN' };
const TOPT = { 1: 'TCP_NODELAY', 2: 'TCP_MAXSEG', 3: 'TCP_CORK', 4: 'TCP_KEEPIDLE', 5: 'TCP_KEEPINTVL', 6: 'TCP_KEEPCNT' };
export const optName = (level, opt) => (level === 1 ? SOPT[opt] : level === 6 ? TOPT[opt] : null);

// keep only what a trace line needs from an argument (never megabytes of data)
function preview(v) {
  if (v instanceof Uint8Array) return { buf: v.slice(0, 32), len: v.length };
  return v;
}

// ── strace-style formatting of one finished call ──
const q = (s) => '"' + s + '"';
export function cstr(b, max = 32) {
  let s = '';
  for (const c of b.subarray(0, max)) s += c === 10 ? '\\n' : c === 9 ? '\\t' : c === 13 ? '\\r' : c === 34 ? '\\"' : c === 92 ? '\\\\' : c >= 32 && c < 127 ? String.fromCharCode(c) : '\\' + c.toString(8);
  return s;
}
const fbuf = (v) => q(cstr(v.buf)) + (v.len > 32 ? '...' : '');
const faddr = (a) => `{sa_family=AF_INET, sin_port=htons(${a.port}), sin_addr=inet_addr("${a.ip}")}`;
const fflags = (f) => { const out = [['O_RDONLY', 'O_WRONLY', 'O_RDWR'][f & 3]]; for (const [n, v] of Object.entries(O)) if (v > 2 && (f & v)) out.push('O_' + n); return out.join('|'); };
const fstat = (s) => `{st_mode=${{ file: 'S_IFREG', dir: 'S_IFDIR', chr: 'S_IFCHR', sock: 'S_IFSOCK', fifo: 'S_IFIFO' }[s.type]}|0${s.mode.toString(8)}, st_size=${s.size}, ...}`;
export function fmtCall(r) {
  const a = r.args, R = r.ret;
  switch (r.name) {
    case 'execve': return `execve(${q(a[0])}, [${a[1].map(q).join(', ')}], 0x7ffd3c0e8a10 /* ${12} vars */)`;
    case 'openat': return `openat(AT_FDCWD, ${q(a[0])}, ${fflags((a[1] || 0) | O.CLOEXEC)}${(a[1] & O.CREAT) ? ', 0' + (a[2] ?? 0o644).toString(8) : ''})`;
    case 'read': return `read(${a[0]}, ${R && R.buf ? fbuf(R) : '""'}, ${a[1]})`;
    case 'pread64': return `pread64(${a[0]}, ${R && R.buf ? fbuf(R) : '""'}, ${a[1]}, ${a[2]})`;
    case 'write': return `write(${a[0]}, ${fbuf(a[1])}, ${a[1].len})`;
    case 'pwrite64': return `pwrite64(${a[0]}, ${fbuf(a[1])}, ${a[1].len}, ${a[2]})`;
    case 'fstat': return `fstat(${a[0]}, ${R ? fstat(R) : '0x7ffd3c0e8650'})`;
    case 'newfstatat': return `newfstatat(AT_FDCWD, ${q(a[0])}, ${R ? fstat(R) : '0x7ffd3c0e8650'}, 0)`;
    case 'lseek': return `lseek(${a[0]}, ${a[1]}, ${['SEEK_SET', 'SEEK_CUR', 'SEEK_END'][a[2]]})`;
    case 'socket': return `socket(AF_INET, SOCK_STREAM, IPPROTO_TCP)`;
    case 'bind': case 'connect': return `${r.name}(${a[0]}, ${faddr({ ip: a[1], port: a[2] })}, 16)`;
    case 'accept': return `accept(${a[0]}, ${R ? faddr(R) + ', [16]' : ''})`;
    case 'getsockname': case 'getpeername': return `${r.name}(${a[0]}, ${R ? faddr(R) : '0x7ffd3c0e8650'}, [16])`;
    case 'setsockopt': return `setsockopt(${a[0]}, ${a[1] === 1 ? 'SOL_SOCKET' : 'SOL_TCP'}, ${optName(a[1], a[2]) || a[2]}, [${a[3]}], 4)`;
    case 'getsockopt': return `getsockopt(${a[0]}, ${a[1] === 1 ? 'SOL_SOCKET' : 'SOL_TCP'}, ${optName(a[1], a[2]) || a[2]}, [${R ?? ''}], [4])`;
    case 'shutdown': return `shutdown(${a[0]}, ${['SHUT_RD', 'SHUT_WR', 'SHUT_RDWR'][a[1]]})`;
    case 'sendfile': return `sendfile(${a[0]}, ${a[1]}, NULL, ${a[2]})`;
    case 'getdents64': return `getdents64(${a[0]}, 0x55d0c8a2f4b0 /* ${R ? R.length : 0} entries */, 32768)`;
    case 'pipe2': return `pipe2([${R ? R.join(', ') : ''}], O_CLOEXEC)`;
    case 'nanosleep': return `nanosleep({tv_sec=${Math.floor(a[0])}, tv_nsec=${Math.round((a[0] % 1) * 1e9)}}, NULL)`;
    case 'wait4': return `wait4(${a[0].pid}, [{WIFEXITED(s) && WEXITSTATUS(s) == ${R ?? 0}}], 0, NULL)`;
    case 'unlink': case 'rmdir': case 'chdir': return `${r.name}(${q(a[0])})`;
    case 'mkdir': return `mkdir(${q(a[0])}, 0755)`;
    case 'rename': return `rename(${q(a[0])}, ${q(a[1])})`;
    default: return `${r.name}(${a.filter((x) => typeof x !== 'object').join(', ')})`;
  }
}
export function fmtRet(r) {
  if (r.err) return `-1 ${r.err} (${ERR[r.err][1]})`;
  const R = r.ret;
  switch (r.name) {
    case 'read': case 'pread64': return String(R.len);
    case 'accept': return String(R.fd);
    case 'getdents64': return String(R.length ? R.length * 24 : 0);
    case 'wait4': return String(r.args[0].pid);
    case 'fstat': case 'newfstatat': case 'getsockname': case 'getpeername': case 'getsockopt': case 'pipe2': return '0';
    default: return String(R);
  }
}
export const fmtSys = (r) => `${fmtCall(r)} = ${fmtRet(r)}`;
