// End-to-end test in Chromium: node test/e2e.mjs   (needs a static server on :8765, see README)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert';
const { chromium } = createRequire(import.meta.url)('playwright');
const SHOTS = process.env.SHOTS;
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = []; page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
const open = async (hash) => { await page.goto('http://localhost:8765/index.html' + hash); await page.waitForFunction('window.gosock'); await page.waitForTimeout(300); };
const sh = (m, cmd, ms = 15000) => page.evaluate(async ([m, cmd, ms]) => {
  const t = window.gosock.terms[m]; const before = t.out.textContent.length;
  if (!t.run(cmd)) throw new Error('terminal busy: ' + cmd);
  const end = Date.now() + ms; while (t.isBusy && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  const txt = t.out.textContent.slice(before); return txt.slice(txt.indexOf('\n') + 1);   // without the echoed command line
}, [m, cmd, ms]);
const start = (m, cmd) => page.evaluate(([m, cmd]) => { window.gosock.terms[m].run(cmd); }, [m, cmd]);
const idle = (m, ms = 15000) => page.waitForFunction((m) => !window.gosock.terms[m].isBusy, m, { timeout: ms });
const out = (m) => page.evaluate((m) => window.gosock.terms[m].out.textContent, m);
const setCode = (src) => page.evaluate((src) => { const ta = document.querySelector('.ed-ta'); ta.value = src; ta.dispatchEvent(new Event('input')); }, src);
const checks = async (lab) => { await page.evaluate((lab) => window.gosock.S.runChecks(lab), lab); return page.evaluate((lab) => window.gosock.S.store.labs[lab], lab); };
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const tests = []; const test = (n, f) => tests.push([n, f]);
const solution = fs.readFileSync('course/01/gosock.solution.go', 'utf8'), skeleton = fs.readFileSync('course/01/gosock.go', 'utf8');
const SHA = '58eb21554f6c6580104cfbeb17548534eb071a51dfe701c1763498699c050d14';

test('every page loads without errors and its run buttons exist', async () => {
  const index = JSON.parse(fs.readFileSync('course/index.json', 'utf8'));
  for (const it of index.modules.flatMap((m) => m.items)) {
    await open('#/p/' + it.id);
    assert.equal(await page.locator('.view h1').innerText(), it.title);
    assert.equal(await page.locator('.view :not(:defined)').count(), 0, 'unknown custom element on ' + it.id);
    await shot('page-' + it.id);
  }
  await open('#/glossary'); await open('#/'); await shot('home');
});
test('page "nc": the commands of the page, clicked in order', async () => {
  await open('#/p/nc');
  const click = async (n) => { await page.locator('.cmd-run').nth(n).click(); };
  await click(0); await idle('A'); assert.match(await out('A'), new RegExp(SHA));
  await click(1); await page.waitForTimeout(150);                    // B: nc -l
  assert.match(await page.locator('#kview').innerText(), /LISTEN/);
  await shot('nc-listening');
  await click(2); await idle('A'); assert.match(await out('A'), /exit 124/);
  await idle('B'); await click(3); await idle('B'); assert.match(await out('B'), new RegExp(SHA + '  in.bin'));
  await click(4); await page.waitForTimeout(150); await click(5); await idle('A'); await idle('B');
  assert.match(await out('A'), /exit 0/);
  await click(6); await idle('B'); assert.match(await out('B'), new RegExp(SHA + '  in2.bin'));
});
test('a program that is not built says so', async () => {
  await open('#/p/go');
  assert.match(await sh('A', 'copy /etc/hostname'), /not built yet/);
});
test('page "go": build the example, run it from a pipe and a file; compiler errors are shown', async () => {
  await page.getByText('Open it in the Code tab').click();
  await page.locator('#build').click(); await page.waitForFunction(() => /ready on A and B/.test(document.querySelector('#buildStatus').textContent), null, { timeout: 60000 });
  assert.match(await sh('A', 'echo "from a pipe" | copy'), /from a pipe\ncopied 12 bytes/);
  assert.match(await sh('A', 'copy /etc/hostname'), /^a\ncopied 2 bytes/m);
  await setCode('package main\n\nimport "os"\n\nfunc main() {\n\tx := 1\n}\n');
  await page.locator('#build').click(); await page.waitForSelector('#problems:not([hidden])');
  const p = await page.locator('#problems').innerText();
  assert.match(p, /main\.go:3:8: "os" imported and not used/); assert.match(p, /main\.go:6:2: declared and not used: x/);
  await shot('compile-error');
});
test('lab recv: the starting code fails every check with a useful message', async () => {
  await open('#/p/recv'); await page.evaluate(() => { localStorage.clear(); }); await open('#/p/recv');
  const r = await checks('recv');
  assert.equal(r.passed, false);
  assert.match(r.res.A.msg, /nothing listens on port 9100.*recv: not implemented yet/s);
  for (const k of 'ABCDEFG') assert.equal(r.res[k].state, 'fail', 'check ' + k);
  await shot('recv-fail');
});
test('labs: the reference solution passes recv and send, and the pages are marked done', async () => {
  await setCode(solution);
  let r = await checks('recv'); assert.deepEqual(Object.entries(r.res).filter(([, v]) => v.state !== 'pass'), []); assert.ok(r.passed);
  await shot('recv-pass');
  await open('#/p/send'); r = await checks('send'); assert.deepEqual(Object.entries(r.res).filter(([, v]) => v.state !== 'pass'), []);
  assert.deepEqual(await page.evaluate(() => Object.keys(window.gosock.S.store.done).sort()), ['recv', 'send']);
});
const mutate = (from, to) => { assert.ok(solution.includes(from), 'mutation anchor: ' + from); return solution.replace(from, to); };
const MUT = [
  ['recv', 'recv never closes: reads only one chunk', mutate('n, err := io.Copy(f, conn)', 'buf := make([]byte, 100)\n\tk, err := conn.Read(buf)\n\tf.Write(buf[:k])\n\tn := k'), /B/],
  ['recv', 'recv prints the wrong text', mutate('"received %d bytes\\n"', '"got %d\\n"'), /C/],
  ['recv', 'recv ignores the Listen error', mutate('ln, err := net.Listen("tcp", addr)\n\tif err != nil {\n\t\treturn err\n\t}', 'ln, err := net.Listen("tcp", addr)\n\tif err != nil {\n\t\tselect {}\n\t}'), /F/],
  ['recv', 'recv loops forever accepting', mutate('fmt.Printf("received %d bytes\\n", n)\n\treturn nil', 'fmt.Printf("received %d bytes\\n", n)\n\tln.Accept()\n\treturn nil'), /D/],
  ['send', 'send truncates the file', mutate('n, err := io.Copy(conn, f)', 'n, err := io.CopyN(conn, f, 1000)\n\tif err == io.EOF {\n\t\terr = nil\n\t}'), /A/],
  ['send', 'send dials before opening the file', mutate('f, err := os.Open(path)\n\tif err != nil {\n\t\treturn err\n\t}\n\tdefer f.Close()\n\n\tconn, err := net.Dial("tcp", addr)\n\tif err != nil {\n\t\treturn err\n\t}\n\tdefer conn.Close()', 'conn, err := net.Dial("tcp", addr)\n\tif err != nil {\n\t\treturn err\n\t}\n\tdefer conn.Close()\n\tf, err := os.Open(path)\n\tif err != nil {\n\t\treturn err\n\t}\n\tdefer f.Close()'), /F/],
  ['send', 'send never returns', mutate('fmt.Printf("sent %d bytes\\n", n)\n\treturn nil', 'fmt.Printf("sent %d bytes\\n", n)\n\tselect {}'), /A/],
];
for (const [lab, name, src, expect] of MUT) test(`mutation caught: ${name}`, async () => {
  await open('#/p/' + lab); await setCode(src);
  const r = await checks(lab); assert.equal(r.passed, false);
  const failed = Object.entries(r.res).filter(([, v]) => v.state === 'fail').map(([k, v]) => k + ': ' + v.msg);
  assert.match(failed.map((f) => f[0]).join(''), expect, failed.join('\n')); console.log('      ' + failed[0].slice(0, 150));
});
test('pages "send", "fd", "box": real transfer, live kernel view, strace counts', async () => {
  await open('#/p/send'); await setCode(solution);
  await page.locator('#build').click(); await page.waitForFunction(() => /ready on A and B/.test(document.querySelector('#buildStatus').textContent), null, { timeout: 60000 });
  await page.locator('.tab[data-tab="machines"]').click();
  await page.locator('#speed [data-s="4"]').click();
  await start('B', 'gosock recv :9000 big.copy'); await page.waitForTimeout(400);
  let kv = await page.locator('#kview').innerText(); assert.match(kv, /gosock recv :9000 big.copy/); assert.match(kv, /accept\(3/); assert.match(kv, /LISTEN/);
  await shot('kview-listen');
  await start('A', 'gosock send $B_IP:9000 /tmp/big.bin'); await page.waitForTimeout(1500);
  kv = await page.locator('#kview').innerText(); assert.match(kv, /sendfile\(4, 3/); assert.match(kv, /ESTABLISHED/); assert.match(kv, /big\.copy\s+offset/);
  await shot('kview-transfer');
  await page.locator('#speed [data-s="0"]').click(); await idle('A'); await idle('B');
  assert.match(await out('A'), /sent 2097152 bytes/); assert.match(await out('B'), /received 2097152 bytes/);
  assert.match(await sh('B', 'sha256sum big.copy'), new RegExp(SHA));
  await start('B', 'strace -o recv.trace gosock recv :9000 in.bin'); await page.waitForTimeout(400);
  await sh('A', 'strace -o send.trace gosock send $B_IP:9000 /tmp/big.bin'); await idle('B');
  assert.equal((await sh('A', "grep -c 'read(' send.trace")).trim(), '0');
  assert.equal((await sh('A', "grep -c 'write(' send.trace")).trim(), '1');
  assert.match(await sh('A', 'grep sendfile send.trace'), /sendfile\(4, 3, NULL, 2147483647\) = 2097152/);
  const reads = +(await sh('B', "grep -c 'read(' recv.trace")).trim(); assert.ok(reads > 20, 'reads on B: ' + reads);
  console.log('      B made', reads, 'read calls;', (await sh('A', 'cat send.trace')).split('\n').length, 'lines in send.trace');
  assert.match(await sh('A', 'strace cat /tmp/hello.txt'), /openat\(AT_FDCWD, "\/tmp\/hello.txt", O_RDONLY\|O_CLOEXEC\) = 3\nread\(3, "hello from machine A\\n", 131072\) = 21\nhello from machine A\nwrite\(1, "hello from machine A\\n", 21\) = 21\nread\(3, "", 131072\) = 0\nclose\(3\) = 0/);
});
test('reboot gives fresh machines and keeps built programs', async () => {
  await page.locator('#reset').click();
  assert.doesNotMatch(await sh('B', 'ls'), /big.copy/);
  assert.match(await sh('A', 'gosock'), /usage: gosock/);
});

let failed = 0;
for (const [name, fn] of tests) {
  const t0 = Date.now(); errors.length = 0;
  try { await fn(); assert.deepEqual(errors, [], 'browser errors'); console.log(`ok    ${name} (${Date.now() - t0} ms)`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n`, e.message.slice(0, 1500)); await page.screenshot({ path: `${SHOTS || '/tmp'}/fail-${failed}.png` }).catch(() => {}); }
}
await browser.close(); process.exit(failed ? 1 : 0);
