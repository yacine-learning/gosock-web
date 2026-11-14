// The Go toolchain in a worker: the real compiler and linker, built as WebAssembly, running
// against a small in-memory file system that holds the sources and the standard library.
const files = new Map();                      // path -> { data: Uint8Array, size }
const dirs = new Set(['/', '/src', '/out', '/pkg', '/tmp']);
const fds = new Map(); let nextFd = 10, output = '';
const enoent = () => { const e = new Error('ENOENT'); e.code = 'ENOENT'; return e; };
const dec = new TextDecoder();
const stat = (path) => {
  const f = files.get(path), isDir = dirs.has(path) || (!f && [...files.keys()].some((k) => k.startsWith(path + '/')));
  if (!f && !isDir) return null;
  return { dev: 1, ino: 1, mode: isDir ? 0o040755 : 0o100644, nlink: 1, uid: 0, gid: 0, rdev: 0, size: f ? f.size : 0, blksize: 4096, blocks: 0, atimeMs: 0, mtimeMs: 0, ctimeMs: 0, isDirectory: () => isDir };
};
globalThis.fs = {
  constants: { O_WRONLY: 1, O_RDWR: 2, O_CREAT: 0o100, O_EXCL: 0o200, O_TRUNC: 0o1000, O_APPEND: 0o2000, O_DIRECTORY: 0o200000 },
  open(path, flags, mode, cb) {
    let f = files.get(path);
    if (!f && !stat(path)) { if (!(flags & 0o100)) return cb(enoent()); f = { data: new Uint8Array(1 << 16), size: 0 }; files.set(path, f); }
    if (f && (flags & 0o1000)) f.size = 0;
    const fd = nextFd++; fds.set(fd, { f, path, pos: 0, append: !!(flags & 0o2000) }); cb(null, fd);
  },
  close(fd, cb) { fds.delete(fd); cb(null); },
  read(fd, buf, off, len, pos, cb) {
    const h = fds.get(fd); if (!h || !h.f) return cb(null, 0);
    const at = pos == null ? h.pos : pos, n = Math.max(0, Math.min(len, h.f.size - at));
    buf.set(h.f.data.subarray(at, at + n), off); if (pos == null) h.pos += n; cb(null, n);
  },
  write(fd, buf, off, len, pos, cb) {
    if (fd === 1 || fd === 2) { output += dec.decode(buf.subarray(off, off + len)); return cb(null, len); }
    const h = fds.get(fd), f = h.f, at = h.append ? f.size : pos == null ? h.pos : pos;
    if (at + len > f.data.length) { const d = new Uint8Array(Math.max(at + len, f.data.length * 2)); d.set(f.data.subarray(0, f.size)); f.data = d; }
    f.data.set(buf.subarray(off, off + len), at); f.size = Math.max(f.size, at + len); if (pos == null) h.pos = at + len; cb(null, len);
  },
  writeSync(fd, buf) { output += dec.decode(buf); return buf.length; },
  fstat(fd, cb) { const h = fds.get(fd); cb(null, stat(h.path)); },
  stat(path, cb) { const s = stat(path); s ? cb(null, s) : cb(enoent()); },
  lstat(path, cb) { const s = stat(path); s ? cb(null, s) : cb(enoent()); },
  readdir(path, cb) { cb(null, [...files.keys()].filter((k) => k.startsWith(path + '/')).map((k) => k.slice(path.length + 1).split('/')[0])); },
  mkdir(path, perm, cb) { dirs.add(path); cb(null); },
  unlink(path, cb) { files.delete(path) ? cb(null) : cb(enoent()); },
  rmdir(path, cb) { dirs.delete(path); cb(null); },
  rename(a, b, cb) { const f = files.get(a); if (!f) return cb(enoent()); files.delete(a); files.set(b, f); cb(null); },
  ftruncate(fd, n, cb) { const f = fds.get(fd).f; if (n > f.data.length) { const d = new Uint8Array(n); d.set(f.data.subarray(0, f.size)); f.data = d; } f.size = n; cb(null); },
  truncate(path, n, cb) { const f = files.get(path); if (f) f.size = Math.min(f.size, n); cb(null); },
  fsync(fd, cb) { cb(null); }, chmod(p, m, cb) { cb(null); }, fchmod(fd, m, cb) { cb(null); }, chown(p, u, g, cb) { cb(null); }, fchown(fd, u, g, cb) { cb(null); },
  lchown(p, u, g, cb) { cb(null); }, utimes(p, a, m, cb) { cb(null); },
  readlink(p, cb) { cb(enoent()); }, link(a, b, cb) { cb(enoent()); }, symlink(a, b, cb) { cb(enoent()); },
};
globalThis.process = { getuid: () => 0, getgid: () => 0, geteuid: () => 0, getegid: () => 0, getgroups: () => [], pid: 1, ppid: 0, umask: () => 0o22, cwd: () => '/src', chdir() {} };
globalThis.path = { resolve: (...p) => { const s = p.join('/'); return s.startsWith('/') ? s : '/src/' + s; } };
importScripts('wasm_exec.js');

// The three big files are kept in the browser's cache storage, keyed by toolchain/VERSION,
// so they are downloaded once and then work offline.
let cache = null, version = '';
async function fetchGz(name, what) {
  postMessage({ t: 'progress', what });
  const url = `../toolchain/${name}?v=${version}`;
  let res = cache && await cache.match(url);
  if (!res) {
    res = await fetch(url); if (!res.ok) throw new Error(`cannot load ${name}: HTTP ${res.status}`);
    if (cache) cache.put(url, res.clone()).catch(() => {});
  }
  const raw = new Uint8Array(await res.arrayBuffer());
  if (raw[0] !== 0x1f || raw[1] !== 0x8b) return raw;                      // the server already unpacked it
  return new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}
let ready = null, tools = {};
function load() {
  ready = ready || (async () => {
    try {
      version = (await (await fetch('../toolchain/VERSION', { cache: 'no-cache' })).text()).trim();
      if (self.caches) { cache = await caches.open('gosock-toolchain-' + version); for (const k of await caches.keys()) if (k.startsWith('gosock-toolchain-') && !k.endsWith(version)) caches.delete(k); }
    } catch (e) { cache = null; }      // offline with nothing cached, or cache storage refused: plain fetches
    if (!version && self.caches) for (const k of await caches.keys()) if (k.startsWith('gosock-toolchain-')) { version = k.slice(17); cache = await caches.open(k); }
    const [c, l, pack] = await Promise.all([fetchGz('compile.wasm.gz', 'compiler'), fetchGz('link.wasm.gz', 'linker'), fetchGz('std.pack.gz', 'standard library')]);
    postMessage({ t: 'progress', what: 'preparing' });
    tools.compile = await WebAssembly.compile(c); tools.link = await WebAssembly.compile(l);
    const n = new DataView(pack.buffer, pack.byteOffset).getUint32(0, true);
    const index = JSON.parse(dec.decode(pack.subarray(4, 4 + n))); let cfg = '';
    for (const [name, [off, len]] of Object.entries(index)) { files.set(`/pkg/${name}.a`, { data: pack.subarray(4 + n + off, 4 + n + off + len), size: len }); cfg += `packagefile ${name}=/pkg/${name}.a\n`; }
    const b = new TextEncoder().encode(cfg); files.set('/importcfg', { data: b, size: b.length });
  })();
  return ready;
}
async function tool(name, argv) {
  output = '';
  const go = new Go(); go.argv = [name, ...argv]; go.env = { TMPDIR: '/tmp', HOME: '/' };
  let code = 0; go.exit = (c) => { code = c; };
  const inst = await WebAssembly.instantiate(tools[name], go.importObject);
  await go.run(inst);
  return { code, output };
}
// build({ 'main.go': source, ... }) -> { ok, module } or { ok: false, errors }
async function build(sources, linkIt = true) {
  await load();
  for (const k of [...files.keys()]) if (k.startsWith('/src/') || k.startsWith('/out/')) files.delete(k);
  const names = [];
  for (const [name, src] of Object.entries(sources)) { const b = new TextEncoder().encode(src); files.set('/src/' + name, { data: b, size: b.length }); names.push('/src/' + name); }
  const clean = (s) => s.replaceAll('/src/', '').trim();
  let r = await tool('compile', ['-p', 'main', '-complete', '-pack', ...(linkIt ? [] : ['-e']), '-importcfg', '/importcfg', '-o', '/out/main.a', ...names]);
  if (r.code !== 0) return { ok: false, errors: clean(r.output) };
  if (!linkIt) return { ok: true };
  r = await tool('link', ['-importcfg', '/importcfg', '-buildmode=exe', '-s', '-w', '-o', '/out/main.wasm', '/out/main.a']);
  if (r.code !== 0) return { ok: false, errors: 'link: ' + clean(r.output) };
  const out = files.get('/out/main.wasm');
  return { ok: true, module: await WebAssembly.compile(out.data.slice(0, out.size)), size: out.size };
}
// gofmt: the real go/format, built to WebAssembly, loaded the first time it is needed
let fmtReady = null;
function loadFmt() {
  fmtReady = fmtReady || (async () => {
    await load();
    const bin = await fetchGz('gofmt.wasm.gz', 'formatter');
    const go = new Go(); const { instance } = await WebAssembly.instantiate(bin, go.importObject);
    go.run(instance);                       // never returns: it keeps gofmt() registered
    for (let i = 0; i < 200 && !globalThis.gofmt; i++) await new Promise((r) => setTimeout(r, 10));
  })();
  return fmtReady;
}
onmessage = async (e) => {
  const d = e.data;
  try {
    if (d.t === 'load') { await load(); postMessage({ t: 'done', id: d.id, ok: true }); }
    else if (d.t === 'check') { const r = await build(d.sources, false); postMessage({ t: 'done', id: d.id, ...r }); }
    else if (d.t === 'format') { await loadFmt(); postMessage({ t: 'done', id: d.id, ...globalThis.gofmt(d.source) }); }
    else if (d.t === 'build') { const t0 = performance.now(); const r = await build(d.sources); postMessage({ t: 'done', id: d.id, ...r, ms: Math.round(performance.now() - t0) }); }
  } catch (err) { postMessage({ t: 'done', id: d.id, ok: false, errors: 'toolchain failure: ' + (err && err.message || err) }); }
};
