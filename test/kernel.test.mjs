// Node tests of the kernel, TCP and the shell tools (no browser, no Go): node test/kernel.test.mjs
import { World } from '../js/kernel.js';
import { Shell, setupMachines } from '../js/tools.js';
import assert from 'node:assert';
import { fmtSys } from '../js/kernel.js';
import { createHash } from 'node:crypto';
const await_fmt = fmtSys;
const require_sha = (b) => createHash('sha256').update(b).digest('hex');

function boot() {
  const world = new World(); const { a, b } = setupMachines(world);
  const mk = (m) => { const t = { out: '', write(buf) { this.out += new TextDecoder().decode(buf); }, clear() {}, busy() {} }; const sh = new Shell(m, t); sh.t = t; return sh; };
  return { world, a, b, A: mk(a), B: mk(b) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('files and pipes', async () => {
  const { A } = boot();
  await A.run('echo hello > /tmp/x; cat /tmp/x | wc -c; ls /tmp; cat /nope; echo rc=$?');
  assert.match(A.t.out, /^6\nbig.bin  hello.txt  x\ncat: \/nope: No such file or directory\nrc=1\n$/);
});
test('nc transfer A to B, checksums match, -N lets both exit', async () => {
  const { A, B, b } = boot();
  const recv = B.run('nc -l 9000 > got.bin'); await sleep(20);
  await B.t; 
  await A.run('nc -N $B_IP 9000 < /tmp/big.bin; echo rc=$?');
  await recv;
  assert.match(A.t.out, /rc=0/);
  await A.run('sha256sum /tmp/big.bin'); await B.run('sha256sum got.bin; ls -l got.bin');
  assert.equal(A.t.out.match(/[0-9a-f]{64}/)[0], B.t.out.match(/[0-9a-f]{64}/)[0]);
  assert.match(B.t.out, /2097152/);
  assert.equal([...b.socks].filter((s) => s.state !== 'TIME_WAIT').length, 0);
});
test('nc without -N: file arrives but the sender does not exit', async () => {
  const { A, B, b } = boot();
  const recv = B.run('nc -l 9000 > got.bin'); await sleep(20);
  const t0 = Date.now();
  await A.run('timeout 1 nc $B_IP 9000 < /tmp/big.bin; echo rc=$?');
  assert.match(A.t.out, /rc=124/); assert.ok(Date.now() - t0 >= 900);
  await recv; assert.equal(b.readFile('/home/student/got.bin').length, 2 << 20);
});
test('connection refused', async () => {
  const { A } = boot();
  await A.run('nc $B_IP 9000 < /tmp/hello.txt; echo rc=$?');
  assert.match(A.t.out, /nc: connect to 10.0.0.2 port 9000 \(tcp\) failed: Connection refused\nrc=1/);
});
test('ss shows the listener, strace shows the calls', async () => {
  const { A, B } = boot();
  const recv = B.run('strace -e trace=network,read,write nc -l 9000 > /tmp/out.txt'); await sleep(150);
  const B2 = new Shell(B.m, { out: '', write(buf) { this.out += new TextDecoder().decode(buf); }, clear() {}, busy() {} });
  await B2.run('ss -tlnp'); 
  assert.match(B2.term.out, /LISTEN\s+0\s+1\s+0\.0\.0\.0:9000\s+0\.0\.0\.0:\*\s+users:\(\("nc",pid=\d+,fd=3\)\)/);
  await A.run('nc -N b 9000 < /tmp/hello.txt'); await recv;
  const o = B.t.out; console.log(o);
  assert.match(o, /socket\(AF_INET, SOCK_STREAM, IPPROTO_TCP\) = 3/);
  assert.match(o, /accept\(3, \{sa_family=AF_INET, sin_port=htons\(\d+\), sin_addr=inet_addr\("10\.0\.0\.1"\)\}, \[16\]\) = 4/);
  assert.match(o, /read\(4, "hello from machine A\\n", 16384\) = 21/);
  assert.match(o, /write\(1, "hello from machine A\\n", 21\) = 21/);
  assert.match(o, /\+\+\+ exited with 0 \+\+\+/);
});
test('ctrl-c kills the foreground program; port is free again', async () => {
  const { B } = boot();
  const r = B.run('nc -l 9000'); await sleep(20); B.interrupt(); await r;
  assert.match(B.t.out, /\^C/);
  const r2 = B.run('nc -l 9000'); await sleep(20); assert.equal(B.m.listeners.size, 1); B.interrupt(); await r2;
});
test('receiver killed mid-transfer resets the sender', async () => {
  const { A, B, world } = boot();
  world.speed = 1;                       // slow wire so the kill lands mid-transfer
  const recv = B.run('nc -l 9000 > /dev/null'); await sleep(30);
  const send = A.run('nc -N $B_IP 9000 < /tmp/big.bin; echo rc=$?'); await sleep(200);
  B.interrupt(); await recv; world.speed = 0; await send;
  console.log(A.t.out);
  assert.match(A.t.out, /rc=[01]/);
});
test('interactive nc chat through the tty', async () => {
  const { A, B } = boot();
  const r = B.run('nc -l 9000'); await sleep(20);
  const s = A.run('nc $B_IP 9000'); await sleep(20);
  A.input('ping'); await sleep(20); B.input('pong'); await sleep(20);
  assert.match(B.t.out, /ping\n/); assert.match(A.t.out, /pong\n/);
  A.interrupt(); await s; await r;
});

test('strace -o writes the trace to a file; grep counts lines', async () => {
  const { A } = boot();
  await A.run("strace -o t.trace cat /tmp/hello.txt; grep -c 'read(' t.trace; grep -n close t.trace");
  assert.match(A.t.out, /^hello from machine A\n2\n6:close\(3\) = 0\n$/);
});

// ── module 2-4 support ──
const run1 = (m, main) => new Promise((res, rej) => { const p = m.spawn({ argv: ['t'], stdio: [0, 1, 2].map(() => m.openOfd('/', '/dev/null', 2)), main: async (c) => { try { res(await main(c)); } catch (e) { rej(e); } return 0; } }); p.start(); });
test('EMFILE at 1024 descriptors; ENOSPC after a short write on the small disk', async () => {
  const { a } = boot();
  const n = await run1(a, async (c) => { let k = 0; try { for (;;) { await c.sys('openat', '/etc/hostname', 0); k++; } } catch (e) { assert.equal(e.code, 'EMFILE'); } return k; });
  assert.equal(n, 1021);                    // 0, 1, 2 are taken
  const r = await run1(a, async (c) => {
    const fd = await c.sys('openat', '/mnt/small/f', 0o101, 0o644), out = [];
    out.push(await c.sys('write', fd, new Uint8Array(700 << 10)));
    out.push(await c.sys('write', fd, new Uint8Array(700 << 10)));
    try { await c.sys('write', fd, new Uint8Array(10)); } catch (e) { out.push(e.code); }
    return out;
  });
  assert.deepEqual(r, [700 << 10, (1 << 20) - (20 << 10) - (700 << 10), 'ENOSPC']);
});
test('page cache: cold read is slow, warm is fast; fincore, free, dirty pages, sync, drop_caches needs root', async () => {
  const { A } = boot();
  await A.run('fincore /tmp/big.bin');
  assert.match(A.t.out, /RES PAGES SIZE FILE\n\s*0B\s+0\s+2M \/tmp\/big.bin/);
  let t0 = Date.now(); await A.run('cat /tmp/big.bin > /dev/null'); const cold = Date.now() - t0;
  t0 = Date.now(); await A.run('cat /tmp/big.bin > /dev/null'); const warm = Date.now() - t0;
  assert.ok(cold > 80 && warm < cold / 3, `cold ${cold} ms, warm ${warm} ms`);
  A.t.out = ''; await A.run('fincore /tmp/big.bin; grep -E "Cached|Dirty" /proc/meminfo');
  assert.match(A.t.out, /2M\s+512\s+2M \/tmp\/big.bin/); assert.match(A.t.out, /Cached:\s+2048 kB\nDirty:\s+0 kB/);
  A.t.out = ''; await A.run('cp /tmp/big.bin /tmp/c.bin; grep Dirty /proc/meminfo; sync; grep Dirty /proc/meminfo');
  assert.match(A.t.out, /Dirty:\s+2048 kB\nDirty:\s+0 kB/);
  A.t.out = ''; await A.run('echo 3 > /proc/sys/vm/drop_caches; echo 3 | sudo tee /proc/sys/vm/drop_caches; fincore /tmp/big.bin; free');
  assert.match(A.t.out, /bash: \/proc\/sys\/vm\/drop_caches: Permission denied\n3\n/); assert.match(A.t.out, /0B\s+0\s+2M \/tmp\/big.bin/);
  assert.match(A.t.out, /total\s+used\s+free\s+shared\s+buff\/cache\s+available\nMem:/);
  A.t.out = ''; await A.run('df -h');
  assert.match(A.t.out, /\/dev\/vdb\s+1M\s+20K\s+1004K\s+2% \/mnt\/small/); assert.match(A.t.out, /\/dev\/vda1\s+8G\s+1\.5G\s+6\.5G\s+19% \//);
});
test('non-blocking read gives EAGAIN; fcntl in strace; epoll reports a pending connection and data', async () => {
  const { a, b } = boot(); const lines = [];
  a.world.on((t, r) => { if (t === 'sys' && r.m === b) lines.push((await_fmt)(r)); });
  const r = await run1(b, async (c) => {
    const l = await c.sys('socket', 2, 1, 6); await c.sys('bind', l, '0.0.0.0', 9000); await c.sys('listen', l, 8);
    const fl = await c.sys('fcntl', l, 3, 0); await c.sys('fcntl', l, 4, fl | 0o4000);
    let e1; try { await c.sys('accept', l); } catch (e) { e1 = e.code; }
    const ep = await c.sys('epoll_create1', 0); await c.sys('epoll_ctl', ep, 1, l, 1, l);
    const sender = a.spawn({ argv: ['nc', '-N', '10.0.0.2', '9000'], stdio: [a.openOfd('/', '/tmp/hello.txt'), a.openOfd('/', '/dev/null', 1), a.openOfd('/', '/dev/null', 1)], main: (await import('../js/tools.js')).PROGRAMS.nc });
    sender.start();
    const ev = await c.sys('epoll_wait', ep, 4, 2000);
    const { fd } = await c.sys('accept', l);
    await c.sys('epoll_ctl', ep, 1, fd, 1, fd);
    const ev2 = await c.sys('epoll_wait', ep, 4, 2000);
    const data = await c.sys('read', fd, 100);
    return { e1, ev, ev2, data: new TextDecoder().decode(data) };
  });
  assert.equal(r.e1, 'EAGAIN'); assert.deepEqual(r.ev.map((e) => [e.events, e.data]), [[1, 3]]);
  assert.ok(r.ev2.some((e) => e.data === 5 && (e.events & 1))); assert.equal(r.data, 'hello from machine A\n');
  assert.ok(lines.some((l) => l === 'fcntl(3, F_GETFL) = 0x2 (flags O_RDWR)'), lines.join('\n'));
  assert.ok(lines.some((l) => l === 'fcntl(3, F_SETFL, O_RDWR|O_NONBLOCK) = 0'));
  assert.ok(lines.some((l) => l === 'accept(3, ) = -1 EAGAIN (Resource temporarily unavailable)'), lines.join('\n'));
  assert.ok(lines.some((l) => /^epoll_wait\(4, \[\{events=EPOLLIN, data=\{u32=3, u64=3\}\}\], 4, 2000\) = 1$/.test(l)));
});
test('Nagle: small writes are held while data is unacknowledged, unless TCP_NODELAY', async () => {
  const count = async (nodelay) => {
    const { a, b, world } = boot(); let segs = 0;
    world.on((t, pk) => { if (t === 'packet' && pk.from === a && pk.seg.len) segs++; });
    const srv = run1(b, async (c) => { const l = await c.sys('socket', 2, 1, 6); await c.sys('bind', l, '0.0.0.0', 9000); await c.sys('listen', l, 8); const { fd } = await c.sys('accept', l); let n = 0; for (;;) { const d = await c.sys('read', fd, 4096); if (!d.length) break; n += d.length; } return n; });
    await sleep(10);
    await run1(a, async (c) => { const s = await c.sys('socket', 2, 1, 6); await c.sys('setsockopt', s, 6, 1, nodelay); await c.sys('connect', s, '10.0.0.2', 9000); for (let i = 0; i < 200; i++) await c.sys('write', s, new Uint8Array([65])); await c.sys('close', s); });
    assert.equal(await srv, 200); return segs;
  };
  const off = await count(1), on = await count(0);
  assert.equal(off, 200); assert.ok(on < 50, `with Nagle: ${on} segments`);
});
test('tc netem loss: the transfer is still exact, ss -ti counts retransmissions, tcpdump prints segments', async () => {
  const { A, B, a, world } = boot();
  await A.run('tc qdisc add dev eth0 root netem loss 10%; echo rc=$?; sudo tc qdisc add dev eth0 root netem loss 10%; tc qdisc show dev eth0');
  assert.match(A.t.out, /RTNETLINK answers: Operation not permitted\nrc=2\nqdisc netem 8001: root refcnt 2 limit 1000 loss 10%/);
  const dump = B.run('tcpdump -n -c 3 port 9000');
  await sleep(10);
  const recv = new Shell(B.m, { out: '', write(b) { this.out += new TextDecoder().decode(b); }, clear() {}, busy() {} }).run('nc -l 9000 > got.bin');
  await sleep(10);
  A.t.out = ''; await A.run('nc -N $B_IP 9000 < /tmp/big.bin; ss -tani; echo sent');
  await recv; await dump;
  assert.ok(a.stats.dropped > 10, 'dropped ' + a.stats.dropped);
  assert.equal(require_sha(B.m.readFile('/home/student/got.bin')), require_sha(a.readFile('/tmp/big.bin')));
  assert.match(B.t.out, /IP 10\.0\.0\.1\.\d+ > 10\.0\.0\.2\.9000: Flags \[S\], seq \d+, win 131072, length 0\n.*IP 10\.0\.0\.2\.9000 > 10\.0\.0\.1\.\d+: Flags \[S\.\], seq \d+, ack \d+, win 131072, length 0\n.*IP 10\.0\.0\.1\.\d+ > 10\.0\.0\.2\.9000: Flags \[\.\], ack 1, win 131072, length 0\n/);
  assert.match(B.t.out, /3 packets captured/);
});

test('dirty pages are written back by themselves once old enough', async () => {
  const { A, a } = boot(); a.dirtyExpire = 300;
  await A.run('cp /tmp/hello.txt /tmp/h2; grep Dirty /proc/meminfo');
  assert.match(A.t.out, /Dirty:\s+4 kB/);
  await sleep(5600); A.t.out = ''; await A.run('grep Dirty /proc/meminfo');
  assert.match(A.t.out, /Dirty:\s+0 kB/);
});
let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log('ok   ', name); } catch (e) { failed++; console.log('FAIL ', name, '\n', e); }
}
process.exit(failed ? 1 : 0);
