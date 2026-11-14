// Runs one compiled Go program (js/wasm) as a process of the simulated kernel.
// Go's syscall package calls the global "fs" object; here every call becomes a message
// to the page, where the kernel lives. The answer comes back later: until then the
// goroutine that made the call is blocked, like a thread in a real system call.
let nextId = 1, lastOpen = -1, cwd = '/', started = false;
const pending = new Map();
function call(name, args, cb, map) {
  const id = nextId++; pending.set(id, [cb, map]);
  postMessage({ t: 'sys', id, name, args });
}
const MODE = { dir: 0o040000, file: 0o100000, chr: 0o020000, sock: 0o140000, fifo: 0o010000 };
const statObj = (s) => ({ dev: 1, ino: s.ino, mode: MODE[s.type] | s.mode, nlink: s.nlink, uid: 1000, gid: 1000, rdev: 0, size: s.size, blksize: 4096, blocks: Math.ceil(s.size / 512),
  atimeMs: s.mtime, mtimeMs: s.mtime, ctimeMs: s.mtime, isDirectory: () => s.type === 'dir' });
const nosys = (cb) => { const e = new Error('ENOSYS'); e.code = 'ENOSYS'; cb(e); };
const direct = (name, n) => (...a) => call(name, a.slice(0, n), a[a.length - 1]);

globalThis.fs = {
  constants: { O_WRONLY: 1, O_RDWR: 2, O_CREAT: 0o100, O_EXCL: 0o200, O_TRUNC: 0o1000, O_APPEND: 0o2000, O_DIRECTORY: 0o200000 },
  open(path, flags, mode, cb) { call('openat', [path, flags, mode], (e, fd) => { if (!e) lastOpen = fd; cb(e, fd); }); },
  // Go looks at every file it has just opened to learn if it is a directory: that extra look is not shown in traces
  fstat(fd, cb) { const quiet = fd === lastOpen; lastOpen = -1; call(quiet ? '_fstat' : 'fstat', [fd], cb, statObj); },
  stat(path, cb) { call('newfstatat', [path], cb, statObj); },
  lstat(path, cb) { call('newfstatat', [path], cb, statObj); },
  readdir(path, cb) { call('_readdir', [path], cb); },
  read(fd, buf, off, len, pos, cb) {
    call(pos == null ? 'read' : 'pread64', pos == null ? [fd, len] : [fd, len, pos], cb, (data) => { buf.set(data, off); return data.length; });
  },
  write(fd, buf, off, len, pos, cb) {
    const data = buf.slice(off, off + len);
    call(pos == null ? 'write' : 'pwrite64', pos == null ? [fd, data] : [fd, data, pos], cb);
  },
  writeSync(fd, buf) { call('write', [fd, buf.slice()], () => {}); return buf.length; },   // the runtime's own messages (panics)
  close: direct('close', 1), mkdir: direct('mkdir', 2), unlink: direct('unlink', 1), rmdir: direct('rmdir', 1), rename: direct('rename', 2),
  ftruncate: direct('ftruncate', 2), fsync: direct('fsync', 1),
  chmod(p, m, cb) { cb(null); }, fchmod(fd, m, cb) { cb(null); }, chown(p, u, g, cb) { cb(null); }, fchown(fd, u, g, cb) { cb(null); }, lchown(p, u, g, cb) { cb(null); }, utimes(p, a, m, cb) { cb(null); },
  truncate(p, n, cb) { nosys(cb); }, readlink(p, cb) { nosys(cb); }, link(a, b, cb) { nosys(cb); }, symlink(a, b, cb) { nosys(cb); },
  // sockets (gosrc/syscall/net_js.go)
  socket: direct('socket', 3), bind: direct('bind', 3), listen: direct('listen', 2), accept: direct('accept', 1), connect: direct('connect', 3),
  getsockname: direct('getsockname', 1), getpeername: direct('getpeername', 1), getsockopt: direct('getsockopt', 3), setsockopt: direct('setsockopt', 4),
  shutdown: direct('shutdown', 2), sendfile: direct('sendfile', 3),
};
const norm = (p) => { const out = []; for (const s of ((p.startsWith('/') ? '' : cwd + '/') + p).split('/')) { if (!s || s === '.') continue; if (s === '..') out.pop(); else out.push(s); } return '/' + out.join('/'); };
globalThis.path = { resolve: (...parts) => norm(parts.join('/')) };
let ids = { pid: 1, ppid: 0 };
globalThis.process = {
  getuid: () => 1000, getgid: () => 1000, geteuid: () => 1000, getegid: () => 1000, getgroups: () => [1000],
  get pid() { return ids.pid; }, get ppid() { return ids.ppid; }, umask: () => 0o22,
  cwd: () => cwd, chdir(d) { cwd = norm(d); call('chdir', [cwd], () => {}); },
};
importScripts('wasm_exec.js');

onmessage = (e) => {
  const d = e.data;
  if (d.t === 'ret') {
    const [cb, map] = pending.get(d.id); pending.delete(d.id);
    if (d.err) { const er = new Error(d.err); er.code = d.err; cb(er); } else cb(null, map ? map(d.ret) : d.ret);
  } else if (d.t === 'start' && !started) {
    started = true; cwd = d.cwd; ids = { pid: d.pid, ppid: d.ppid };
    const go = new Go(); go.argv = d.argv; go.env = d.env;
    go.exit = (code) => postMessage({ t: 'exit', code });
    WebAssembly.instantiate(d.module, go.importObject).then((inst) => go.run(inst)).catch((err) => postMessage({ t: 'crash', msg: String(err && err.stack || err) }));
  }
};
