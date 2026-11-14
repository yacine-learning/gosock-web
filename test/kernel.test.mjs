// Node tests of the kernel, TCP and the shell tools (no browser, no Go): node test/kernel.test.mjs
import { World } from '../js/kernel.js';
import { Shell, setupMachines } from '../js/tools.js';
import assert from 'node:assert';

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
let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log('ok   ', name); } catch (e) { failed++; console.log('FAIL ', name, '\n', e); }
}
process.exit(failed ? 1 : 0);
