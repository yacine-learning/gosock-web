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
function bench(module) {
  const world = new World(); const { a, b } = setupMachines(world); world.programs.set('gosock', goProgram(module));
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
export async function runLab(labId, module, onUpdate) {
  const lab = LABS[labId]; let passed = 0;
  for (const [id, , fn] of lab.tests) {
    onUpdate(id, 'run');
    const h = bench(module);
    try { await fn(h); passed++; onUpdate(id, 'pass'); }
    catch (e) { if (e instanceof Fail) onUpdate(id, 'fail', e.message); else { console.error(e); onUpdate(id, 'fail', e === KILLED ? 'the check was interrupted' : 'the check itself failed: ' + (e instanceof Errno ? e.text : e.message)); } }
    h.stop(); await sleep(10);
  }
  return passed === lab.tests.length;
}
