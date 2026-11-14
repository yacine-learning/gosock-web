// Code labs: what each one asks for, its hints, and the checks. A check runs the student's
// compiled program on two fresh machines of its own (never the ones on the page) and judges
// what the program does: bytes in files, exit status, what it prints.
import { World, Errno, KILLED, text } from './kernel.js';
import { setupMachines, findProgram } from './tools.js';
import { goProgram } from './gorun.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const status = (r) => (r.timedOut ? 'it is still running' : 'exit status ' + r.code);
const show = (s) => (s.trim() ? JSON.stringify(s.length > 300 ? s.slice(0, 300) + '…' : s) : 'nothing');
class Fail extends Error {}
const fail = (msg) => { throw new Fail(msg); };
const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const pattern = (n) => { const d = new Uint8Array(n); for (let i = 0; i < n; i++) d[i] = (i * 7 + (i >> 8)) & 255; return d; };

// two fresh machines with the student's program installed on both
function bench(module, bin = 'gosock') {
  const world = new World(); const { a, b } = setupMachines(world); world.programs.set(bin, goProgram(module));
  const cap = (m) => { const t = { buf: '', write(x) { this.buf += text(x); } }; t.ofd = m.mktty(t); return t; };
  const h = {
    world, a, b,
    // start a program; returns a handle with what it printed and wait(ms)
    start(m, ...argv) {
      const out = cap(m), er = cap(m);
      const p = m.spawn({ argv, cwd: '/tmp', stdio: [m.openOfd('/', '/dev/null', 0), out.ofd, er.ofd], main: findProgram(m, argv[0]), exe: '/usr/local/bin/' + argv[0] }); p.start();
      return { p, get stdout() { return out.buf; }, get stderr() { return er.buf; }, get all() { return out.buf + er.buf; },
        wait: (ms) => Promise.race([p.done.then((code) => ({ code, timedOut: false })), sleep(ms).then(() => ({ code: null, timedOut: true }))]) };
    },
    async run(m, ms, ...argv) { const pr = h.start(m, ...argv); const r = await pr.wait(ms); return { ...r, stdout: pr.stdout, stderr: pr.stderr, all: pr.all }; },
    // wait until something listens on the port, without connecting to it
    async listening(m, port, ms, pr) { const end = Date.now() + ms; while (Date.now() < end) { if (m.listeners.has(port)) return true; if (pr && pr.p.dead) return false; await sleep(15); } return false; },
    // a small helper process: main(sys) runs with the kernel's system calls
    helper(m, main) { const p = m.spawn({ argv: ['check'], stdio: [0, 1, 2].map(() => m.openOfd('/', '/dev/null', 2)), main: (c) => main(c.sys) }); const res = p.done; p.start(); return { p, res }; },
    // connect, send data, close
    client(m, ip, port, data) {
      let ok = false;
      const { res } = h.helper(m, async (sys) => { const s = await sys('socket', 2, 1, 6); await sys('connect', s, ip, port); if (data.length) await sys('write', s, data); await sys('close', s); ok = true; });
      return res.then(() => ok);
    },
    // listen on a port, accept one connection, keep everything it sends
    sink(m, port) {
      const st = { connected: false, done: false, parts: [] };
      h.helper(m, async (sys) => {
        const l = await sys('socket', 2, 1, 6); await sys('setsockopt', l, 1, 2, 1); await sys('bind', l, '0.0.0.0', port); await sys('listen', l, 8);
        const { fd } = await sys('accept', l); st.connected = true;
        for (;;) { const b = await sys('read', fd, 65536); if (!b.length) break; st.parts.push(b); }
        st.done = true;
      });
      return { st, async got(ms = 3000) { const end = Date.now() + ms; while (!st.done && Date.now() < end) await sleep(15); if (!st.connected) return null; const n = st.parts.reduce((x, y) => x + y.length, 0); const out = new Uint8Array(n); let o = 0; for (const b of st.parts) { out.set(b, o); o += b.length; } return out; } };
    },
    stop() { for (const m of [a, b]) for (const p of [...m.procs.values()]) m.kill(p, 9); },
  };
  return h;
}

// lab: recv
async function recvTransfer(h, data, dest = '/tmp/received.bin') {
  const pr = h.start(h.b, 'gosock', 'recv', ':9100', dest);
  if (!await h.listening(h.b, 9100, 3000, pr)) fail(`nothing listens on port 9100 three seconds after start: the program is not listening there. It printed ${show(pr.all)}`);
  await h.client(h.a, '10.0.0.2', 9100, data);
  const r = await pr.wait(3000);
  return { ...r, pr };
}
const RECV = [
  ['A', 'listens on the address it is given', async (h) => {
    const pr = h.start(h.b, 'gosock', 'recv', ':9100', '/tmp/received.bin');
    if (!await h.listening(h.b, 9100, 3000, pr)) fail(`nothing listens on port 9100 three seconds after start. The program printed ${show(pr.all)}`);
  }],
  ['B', 'stores every byte that arrives', async (h) => {
    const data = pattern((1 << 20) + 13);      // not a round number on purpose
    const r = await recvTransfer(h, data);
    if (r.timedOut) fail('the program did not finish after the sender closed the connection (does it read until the end of the stream?)');
    const got = h.b.readFile('/tmp/received.bin');
    if (!got) fail(`the file /tmp/received.bin was not created. The program printed ${show(r.pr.all)}`);
    if (!equal(got, data)) fail(`the file differs from what was sent: sent ${data.length} bytes, the file has ${got.length}`);
  }],
  ['C', 'prints how many bytes it received', async (h) => {
    const r = await recvTransfer(h, new Uint8Array(4321));
    if (!r.pr.stdout.includes('received 4321 bytes')) fail(`expected the line "received 4321 bytes" on standard output, got ${show(r.pr.stdout)}`);
  }],
  ['D', 'exits with status 0 after one transfer', async (h) => {
    const r = await recvTransfer(h, new TextEncoder().encode('hello'));
    if (r.timedOut) fail('the program is still running 3 s after the transfer ended: it must return after ONE connection');
    if (r.code !== 0) fail(`exit status ${r.code}, expected 0 (it printed ${show(r.pr.stderr)})`);
  }],
  ['E', 'accepts an empty transfer', async (h) => {
    const r = await recvTransfer(h, new Uint8Array(0));
    if (r.timedOut || r.code !== 0) fail(`an empty transfer should succeed (exit status ${r.code}, still running: ${r.timedOut}, it printed ${show(r.pr.stderr)})`);
    const got = h.b.readFile('/tmp/received.bin');
    if (!got || got.length !== 0) fail('expected an empty file at /tmp/received.bin');
  }],
  ['F', 'fails cleanly when the address is taken', async (h) => {
    const s = h.sink(h.b, 9100); await h.listening(h.b, 9100, 1000); void s;
    const r = await h.run(h.b, 3000, 'gosock', 'recv', ':9100', '/tmp/x');
    if (r.timedOut) fail("the program kept running although the address is taken: Listen's error must be returned");
    if (r.code === 0 || !r.stderr.includes('address already in use')) fail(`expected a non-zero exit status and "address already in use" on standard error, got exit status ${r.code} and ${show(r.stderr)}`);
  }],
  ['G', 'fails cleanly when the file cannot be created', async (h) => {
    const pr = h.start(h.b, 'gosock', 'recv', ':9100', '/tmp/no-such-dir/out');
    if (await h.listening(h.b, 9100, 2000, pr)) await h.client(h.a, '10.0.0.2', 9100, new TextEncoder().encode('some data'));
    const r = await pr.wait(3000);
    if (r.timedOut) fail('the program did not exit although the destination file cannot be created');
    if (r.code === 0 || !pr.stderr.includes('no such file or directory')) fail(`expected a non-zero exit status and "no such file or directory" on standard error, got exit status ${r.code} and ${show(pr.stderr)}`);
  }],
];

// lab: rawcopy (module 2)
const RAWCOPY = [
  ['A', 'copies every byte and says how many', async (h) => {
    const data = pattern((1 << 20) + 13); h.a.writeFile('/tmp/in.bin', data);
    const r = await h.run(h.a, 6000, 'rawcopy', '/tmp/in.bin', '/tmp/out.bin');
    if (r.timedOut) fail('the program did not finish: does the loop stop when Read returns 0?');
    const got = h.a.readFile('/tmp/out.bin');
    if (!got) fail(`/tmp/out.bin was not created. The program printed ${show(r.all)}`);
    if (!equal(got, data)) fail(`the copy has ${got.length} bytes, the source ${data.length}${got.length === data.length ? ', and they differ' : ''}`);
    if (!r.stdout.includes(`copied ${data.length} bytes`)) fail(`expected "copied ${data.length} bytes" on standard output, got ${show(r.stdout)}`);
    if (r.code !== 0) fail(`exit status ${r.code}, expected 0`);
  }],
  ['B', 'empties a destination that already exists', async (h) => {
    h.a.writeFile('/tmp/in.bin', pattern(100)); h.a.writeFile('/tmp/out.bin', pattern(5000));
    const r = await h.run(h.a, 4000, 'rawcopy', '/tmp/in.bin', '/tmp/out.bin');
    const got = h.a.readFile('/tmp/out.bin');
    if (!got || got.length !== 100) fail(`the destination should hold the 100 bytes of the source, it holds ${got ? got.length : 0} (did you open it with O_TRUNC?). The program printed ${show(r.all)}`);
  }],
  ['C', 'uses system calls only', async (h, src) => {
    const bad = [['os.Open', /\bos\.(Open|OpenFile|Create|ReadFile|WriteFile)\b/], ['io.Copy', /\bio\.(Copy|ReadAll)\b/]].find(([, re]) => re.test(src));
    if (bad) fail(`the code calls ${bad[0]}: here every file operation must be a syscall.X call`);
    h.a.writeFile('/tmp/in.bin', pattern(200000)); const calls = [];
    h.world.on((t, r) => { if (t === 'sys' && r.comm === 'rawcopy') calls.push(r); });
    await h.run(h.a, 4000, 'rawcopy', '/tmp/in.bin', '/tmp/out.bin');
    const reads = calls.filter((r) => r.name === 'read' && r.args[0] > 2);
    if (reads.length < 3) fail(`the 200000-byte file was read in ${reads.length} read call(s): read it in chunks (a 64 KB buffer gives 4 reads)`);
  }],
  ['D', 'a missing source: an error, and no destination created', async (h) => {
    const r = await h.run(h.a, 4000, 'rawcopy', '/tmp/missing.bin', '/tmp/out.bin');
    if (r.timedOut) fail('the program did not exit');
    if (r.code !== 1 || !r.stderr.includes('no such file or directory')) fail(`expected exit status 1 and "no such file or directory" on standard error, got ${status(r)} and ${show(r.stderr)}`);
    if (h.a.readFile('/tmp/out.bin')) fail('/tmp/out.bin was created although the source does not exist: open the source first');
  }],
  ['E', 'a full disk: an error, not a success', async (h) => {
    const data = pattern(2 << 20); h.a.writeFile('/tmp/in.bin', data);
    const r = await h.run(h.a, 6000, 'rawcopy', '/tmp/in.bin', '/mnt/small/out.bin');
    if (r.timedOut) fail('the program did not exit when the disk filled up: is Write\'s error returned?');
    if (r.stdout.includes('copied')) fail(`it printed ${show(r.stdout)} although the 1 MB disk cannot hold 2 MB: check the error Write returns`);
    if (r.code !== 1 || !r.stderr.includes('no space left on device')) fail(`expected exit status 1 and "no space left on device" on standard error, got ${status(r)} and ${show(r.stderr)}`);
  }],
  ['F', 'after a short write, writes the rest', async (h) => {
    // on the nearly full disk one write takes fewer bytes than given: the next write must carry what is left
    h.a.writeFile('/tmp/in.bin', pattern(2 << 20));
    const calls = []; h.world.on((t, r) => { if (t === 'sys' && r.comm === 'rawcopy' && r.name === 'write' && r.args[0] > 2) calls.push(r); });
    await h.run(h.a, 6000, 'rawcopy', '/tmp/in.bin', '/mnt/small/out.bin');
    const i = calls.findIndex((r) => !r.err && r.ret < r.args[1].len);
    if (i < 0) fail('no short write happened: was the copy made with syscall.Write in 64 KB chunks? (check E must pass first)');
    const short = calls[i], next = calls[i + 1], left = short.args[1].len - short.ret;
    if (!next) fail(`Write took ${short.ret} of ${short.args[1].len} bytes, and the program never wrote the other ${left}: loop in writeAll until every byte is taken`);
    if (next.args[1].len !== left) fail(`Write took ${short.ret} of ${short.args[1].len} bytes; the next write should carry the ${left} bytes left, it carried ${next.args[1].len} (new data, so ${left} bytes were dropped)`);
  }],
];

// lab: rawrecv (module 3)
async function rawrecvTransfer(h, data, dest = '/tmp/received.bin') {
  const pr = h.start(h.b, 'rawrecv', '9100', dest);
  if (!await h.listening(h.b, 9100, 3000, pr)) fail(`nothing listens on port 9100 three seconds after start. The program printed ${show(pr.all)}`);
  await h.client(h.a, '10.0.0.2', 9100, data);
  return { ...(await pr.wait(3000)), pr };
}
const RAWRECV = [
  ['A', 'listens on the port it is given', async (h) => {
    const pr = h.start(h.b, 'rawrecv', '9100', '/tmp/received.bin');
    if (!await h.listening(h.b, 9100, 3000, pr)) fail(`nothing listens on port 9100 three seconds after start. The program printed ${show(pr.all)}`);
  }],
  ['B', 'stores every byte that arrives', async (h) => {
    const data = pattern((1 << 20) + 13); const r = await rawrecvTransfer(h, data);
    if (r.timedOut) fail('the program did not finish after the sender closed: does the loop stop when Read returns 0?');
    const got = h.b.readFile('/tmp/received.bin');
    if (!got) fail(`/tmp/received.bin was not created. The program printed ${show(r.pr.all)}`);
    if (!equal(got, data)) fail(`the file has ${got.length} bytes, ${data.length} were sent${got.length === data.length ? ', and they differ' : ''}`);
  }],
  ['C', 'prints how many bytes, and exits with status 0', async (h) => {
    const r = await rawrecvTransfer(h, new Uint8Array(4321));
    if (!r.pr.stdout.includes('received 4321 bytes')) fail(`expected "received 4321 bytes" on standard output, got ${show(r.pr.stdout)}`);
    if (r.code !== 0) fail(`${status(r)}, expected 0 (standard error: ${show(r.pr.stderr)})`);
  }],
  ['D', 'uses socket system calls, not package net', async (h, src) => {
    if (/"net"/.test(src)) fail('the code imports package net: here the socket must be made with syscall.Socket, Bind, Listen and Accept');
    if (/\bos\.(Open|OpenFile|Create)\b|\bio\.Copy\b/.test(src)) fail('the code uses os.Open, os.Create or io.Copy: the file side must be syscall calls too, as in rawcopy');
    const names = []; h.world.on((t, r) => { if (t === 'sys' && r.comm === 'rawrecv') names.push(r.name); });
    await rawrecvTransfer(h, new Uint8Array(100));
    for (const n of ['socket', 'bind', 'listen', 'accept']) if (!names.includes(n)) fail(`no ${n} call in the trace`);
  }],
  ['E', 'starts while an old connection on the port is in TIME_WAIT', async (h) => {
    // B closes a connection on port 9100 first, so B keeps it in TIME_WAIT
    const { res: srv } = h.helper(h.b, async (sys) => { const l = await sys('socket', 2, 1, 6); await sys('setsockopt', l, 1, 2, 1); await sys('bind', l, '0.0.0.0', 9100); await sys('listen', l, 8); const { fd } = await sys('accept', l); await sys('close', fd); await sys('close', l); });
    await h.listening(h.b, 9100, 1000);
    await h.helper(h.a, async (sys) => { const s = await sys('socket', 2, 1, 6); await sys('connect', s, '10.0.0.2', 9100); while ((await sys('read', s, 4096)).length); await sys('close', s); }).res; await srv; await sleep(50);
    if (![...h.b.socks].some((s) => s.state === 'TIME_WAIT' && s.local.port === 9100)) fail('the check could not set up a TIME_WAIT connection (not your fault: run the checks again)');
    const pr = h.start(h.b, 'rawrecv', '9100', '/tmp/received.bin');
    if (!await h.listening(h.b, 9100, 3000, pr)) fail(`with an old connection in TIME_WAIT on port 9100, the program could not listen: ${show(pr.all)}. Set SO_REUSEADDR before Bind`);
  }],
  ['F', 'fails cleanly when another program listens on the port', async (h) => {
    h.sink(h.b, 9100); await h.listening(h.b, 9100, 1000);
    const r = await h.run(h.b, 3000, 'rawrecv', '9100', '/tmp/x');
    if (r.timedOut) fail("the program kept running although the port is taken: Bind's error must be returned");
    if (r.code !== 1 || !r.stderr.includes('address already in use')) fail(`expected exit status 1 and "address already in use" on standard error, got ${status(r)} and ${show(r.stderr)}`);
  }],
  ['G', 'an empty transfer: an empty file, and status 0', async (h) => {
    const r = await rawrecvTransfer(h, new Uint8Array(0));
    if (r.timedOut || r.code !== 0) fail(`an empty transfer should succeed (${status(r)}, it printed ${show(r.pr.all)})`);
    const got = h.b.readFile('/tmp/received.bin'); if (!got || got.length) fail('expected an empty /tmp/received.bin');
    if (!r.pr.stdout.includes('received 0 bytes')) fail(`expected "received 0 bytes", got ${show(r.pr.stdout)}`);
  }],
];

// lab: send
const SEND = [
  ['A', 'sends every byte of the file', async (h) => {
    const data = pattern((1 << 20) + 13); h.a.writeFile('/tmp/in.bin', data);
    const s = h.sink(h.b, 9100); await h.listening(h.b, 9100, 1000);
    const r = await h.run(h.a, 4000, 'gosock', 'send', '10.0.0.2:9100', '/tmp/in.bin');
    if (r.timedOut) fail('the program did not finish: does it close the connection and return after the copy?');
    const got = await s.got();
    if (!got) fail(`nobody connected to the receiver. The program printed ${show(r.all)}`);
    if (!equal(got, data)) fail(`the receiver got ${got.length} bytes, the file has ${data.length}. Standard error: ${show(r.stderr)}`);
  }],
  ['B', 'sends an empty file without error', async (h) => {
    h.a.writeFile('/tmp/empty.bin', new Uint8Array(0));
    const s = h.sink(h.b, 9100); await h.listening(h.b, 9100, 1000);
    const r = await h.run(h.a, 4000, 'gosock', 'send', '10.0.0.2:9100', '/tmp/empty.bin');
    if (r.code !== 0) fail(`${status(r)} for an empty file, expected exit status 0 (standard error: ${show(r.stderr)})`);
    const got = await s.got();
    if (!got) fail('an empty file must still open a connection, then close it');
    if (got.length) fail(`the receiver got ${got.length} bytes from an empty file`);
  }],
  ['C', 'prints how many bytes it sent', async (h) => {
    h.a.writeFile('/tmp/in.bin', pattern(4321));
    const s = h.sink(h.b, 9100); await h.listening(h.b, 9100, 1000);
    const r = await h.run(h.a, 4000, 'gosock', 'send', '10.0.0.2:9100', '/tmp/in.bin'); await s.got(500);
    if (!r.stdout.includes('sent 4321 bytes')) fail(`expected the line "sent 4321 bytes" on standard output, got ${show(r.stdout)}`);
  }],
  ['D', 'exits with status 0 when all went well', async (h) => {
    h.a.writeFile('/tmp/in.bin', pattern(1000));
    const s = h.sink(h.b, 9100); await h.listening(h.b, 9100, 1000);
    const r = await h.run(h.a, 4000, 'gosock', 'send', '10.0.0.2:9100', '/tmp/in.bin'); await s.got(500);
    if (r.code !== 0) fail(`${status(r)}, expected exit status 0 (standard error: ${show(r.stderr)})`);
  }],
  ['E', 'fails cleanly when nobody listens', async (h) => {
    h.a.writeFile('/tmp/in.bin', pattern(1000));
    const r = await h.run(h.a, 4000, 'gosock', 'send', '10.0.0.2:9100', '/tmp/in.bin');
    if (r.timedOut) fail('the program hangs when nobody listens: the error from Dial must be returned');
    if (r.code === 0 || !r.stderr.includes('connection refused')) fail(`expected a non-zero exit status and "connection refused" on standard error, got exit status ${r.code} and ${show(r.stderr)}`);
  }],
  ['F', 'fails cleanly when the file does not exist', async (h) => {
    const s = h.sink(h.b, 9100); await h.listening(h.b, 9100, 1000);
    const r = await h.run(h.a, 4000, 'gosock', 'send', '10.0.0.2:9100', '/tmp/missing.bin');
    if (r.code === 0 || !r.stderr.includes('no such file or directory')) fail(`expected a non-zero exit status and "no such file or directory" on standard error, got exit status ${r.code} and ${show(r.stderr)}`);
    await sleep(150);
    if (s.st.connected) fail('the program connected although the file does not exist: open the file first');
  }],
  ['G', 'your send and your recv work together', async (h) => {
    const data = pattern(3 << 20); h.a.writeFile('/tmp/in.bin', data);
    const rp = h.start(h.b, 'gosock', 'recv', ':9100', '/tmp/copy.bin');
    if (!await h.listening(h.b, 9100, 3000, rp)) fail('recv does not listen (the checks of the recv lab must pass first)');
    const so = await h.run(h.a, 6000, 'gosock', 'send', '10.0.0.2:9100', '/tmp/in.bin');
    const ro = await rp.wait(3000);
    if (so.code !== 0 || ro.code !== 0) fail(`send: ${status(so)} (it printed ${show(so.stderr)}); recv: ${status(ro)} (it printed ${show(rp.stderr)})`);
    const got = h.b.readFile('/tmp/copy.bin');
    if (!got || !equal(got, data)) fail(`the copy differs from the original: ${got ? got.length : 0} bytes received, ${data.length} sent`);
  }],
];

export const LABS = {
  recv: {
    title: 'gosock recv', project: 'gosock', tests: RECV,
    hints: [
      'Four small steps, each one a package function plus the usual error check. Look at the Go lesson: <code>x, err := f(...)</code>, then <code>if err != nil { return err }</code>, then <code>defer x.Close()</code> where something must be closed.',
      'The functions are: <code>net.Listen("tcp", addr)</code> gives a listener; <code>ln.Accept()</code> gives a connection; <code>os.Create(dest)</code> gives a file; <code>io.Copy(dst, src)</code> returns <code>(n int64, err error)</code>. Remember to add <code>"io"</code> and <code>"net"</code> to the <code>import</code> block, and delete the <code>return fmt.Errorf("... not implemented yet")</code> line.',
      'Order: Listen, Accept, Create, Copy. Print with <code>fmt.Printf("received %d bytes\\n", n)</code> and finish with <code>return nil</code>. The destination of <code>io.Copy</code> is the file, the source is the connection.',
    ],
    explain: '<p>Four calls, each followed by the same <code>if err != nil { return err }</code>. Every resource that needs closing (listener, connection, file) is closed by a <code>defer</code> on the line after it was opened, so every way out of <code>recv</code> cleans up. <code>io.Copy(f, conn)</code> is the whole transfer: it reads from the connection and writes to the file until the sender closes.</p>',
    solution: ['func recv(', '\n}\n'],
  },
  rawcopy: {
    title: 'rawcopy', project: 'rawcopy', bin: 'rawcopy', tests: RAWCOPY,
    hints: [
      'Two <code>syscall.Open</code> calls, each followed by <code>if err != nil { return 0, fmt.Errorf("open %s: %w", src, err) }</code> and <code>defer syscall.Close(fd)</code>. Then <code>buf := make([]byte, 64*1024)</code> and a <code>for { … }</code> loop.',
      'In the loop: <code>n, err := syscall.Read(in, buf)</code>; on error return it; if <code>n == 0</code> return the total; otherwise <code>writeAll(out, buf[:n])</code> and add <code>n</code> to the total. In <code>writeAll</code>: <code>for len(b) &gt; 0 { n, err := syscall.Write(fd, b); if err != nil { return err }; b = b[n:] }</code>.',
      'Wrap the write error too, for example <code>fmt.Errorf("write %s: %w", dst, err)</code>, and delete both <code>not implemented yet</code> lines. Check F fails when <code>writeAll</code> writes once and ignores <code>n</code>.',
    ],
    explain: '<p>The copy is two loops. The outer one reads until <code>Read</code> says 0 (the end). The inner one, <code>writeAll</code>, keeps writing until the kernel has taken every byte: <code>Write</code> returns how many it took, and on a nearly full disk that is fewer than given. Every error carries what was being done and the kernel\'s words, so <code>rawcopy: write /mnt/small/out.bin: no space left on device</code> tells the whole story.</p>',
    solution: ['func rawcopy(', '\n}\n'], solution2: ['func writeAll(', '\n}\n'],
  },
  rawrecv: {
    title: 'rawrecv', project: 'rawrecv', bin: 'rawrecv', tests: RAWRECV,
    hints: [
      'The first lines: <code>ls, err := syscall.Socket(syscall.AF_INET, syscall.SOCK_STREAM, 0)</code>, the usual error check (<code>return 0, fmt.Errorf("socket: %w", err)</code>), <code>defer syscall.Close(ls)</code>. Each next call has the same shape.',
      'Then <code>syscall.SetsockoptInt(ls, syscall.SOL_SOCKET, syscall.SO_REUSEADDR, 1)</code>, <code>syscall.Bind(ls, &amp;syscall.SockaddrInet4{Port: port})</code>, <code>syscall.Listen(ls, 8)</code>, and <code>fd, _, err := syscall.Accept(ls)</code> (the <code>_</code> is the client\'s address). Wrap the bind error as <code>fmt.Errorf("bind: %w", err)</code>: its text is "address already in use" when the port is taken.',
      'The rest is rawcopy with <code>fd</code> as the source: open <code>dest</code> with <code>syscall.Open</code>, loop on <code>syscall.Read(fd, buf)</code> until 0, <code>writeAll</code> each chunk, count. Copy <code>writeAll</code> from your rawcopy, and delete both <code>not implemented yet</code> lines.',
    ],
    explain: '<p>Five calls make the server: <code>socket</code>, <code>setsockopt</code>, <code>bind</code>, <code>listen</code>, <code>accept</code>. Everything after <code>accept</code> is the file copy of rawcopy: a connected socket is read like any descriptor. <code>SO_REUSEADDR</code> is the line <code>net.Listen</code> adds for you, so that a restart never waits for old connections to leave TIME_WAIT.</p>',
    solution: ['func rawrecv(', '\n}\n'], solution2: ['func writeAll(', '\n}\n'],
  },
  send: {
    title: 'gosock send', project: 'gosock', tests: SEND,
    hints: [
      'It mirrors <code>recv</code>: <code>os.Open(path)</code> (read-only) gives a file, <code>net.Dial("tcp", addr)</code> gives a connection, <code>io.Copy(conn, f)</code> moves the bytes. Same shape: call, check the error, <code>defer Close()</code>.',
      'Note the argument order of <code>io.Copy</code>: <b>destination first</b>, then source. Here the destination is the connection and the source is the file. Print <code>fmt.Printf("sent %d bytes\\n", n)</code> and <code>return nil</code>.',
      'Open the file first, then Dial. Delete the <code>return fmt.Errorf("send: not implemented yet")</code> line. Even a 0-byte file must open a connection and exit with status 0.',
    ],
    explain: '<p>The same pattern as <code>recv</code>, reversed: the file is the source and the connection is the destination. When <code>send</code> returns, the deferred closes run: connection first, then file (last deferred, first run). Closing the connection is also what lets the receiver\'s <code>io.Copy</code> see the end of the stream; this is the job <code>nc</code> only did with <code>-N</code>.</p>',
    solution: ['func send(', '\n}\n'],
  },
};

// run every check of a lab; onUpdate(id, state, message) is called as they progress
export async function runLab(labId, module, onUpdate, src = '') {
  const lab = LABS[labId]; let passed = 0;
  for (const [id, , fn] of lab.tests) {
    onUpdate(id, 'run');
    const h = bench(module, lab.bin);
    try { await fn(h, src); passed++; onUpdate(id, 'pass'); }
    catch (e) { if (e instanceof Fail) onUpdate(id, 'fail', e.message); else { console.error(e); onUpdate(id, 'fail', e === KILLED ? 'the check was interrupted' : 'the check itself failed: ' + (e instanceof Errno ? e.text : e.message)); } }
    h.stop(); await sleep(10);
  }
  return passed === lab.tests.length;
}
