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
const setCode = (src) => page.evaluate((src) => { window.gosock.editor.replace(src); }, src);
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
// ── IDE features, driven with the keyboard as a student would ──
const ideDoc = async (src) => {                                  // '@@' marks where the cursor goes
  await open('#/p/go'); await page.locator('.tab[data-tab="code"]').click();
  await page.waitForFunction(() => window.gosock.toolchain.loaded, null, { timeout: 60000 });
  await page.evaluate((src) => { const e = window.gosock.editor, at = src.indexOf('@@'); e.replace(src.replace('@@', '')); e.view.dispatch({ selection: { anchor: at < 0 ? src.length : at } }); e.focus(); }, src);
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);          // close a popup left by the previous test
};
const BASE = 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("x")\n\t@@\n}\n';
const docText = () => page.evaluate(() => window.gosock.editor.value);
test('IDE: live compiler errors and warnings, with the message on hover', async () => {
  await ideDoc(BASE.replace('@@', 'y := nope(1)@@'));
  await page.waitForSelector('.cm-lintRange-error', { timeout: 10000 });
  await page.waitForFunction(() => /^1 error/.test(document.querySelector('#edProblems')?.getAttribute('aria-label')));
  await page.locator('.cm-lintRange-error').first().hover(); await page.waitForSelector('.cm-tooltip-lint');
  assert.match(await page.locator('.cm-tooltip-lint').innerText(), /undefined: nope/);
  await shot('ide-diagnostic');
  await ideDoc(BASE.replace('@@', 'y := 1@@'));                  // an unused variable is only a warning
  await page.waitForSelector('.cm-lintRange-warning', { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('#edProblems')?.getAttribute('aria-label') === '0 errors, 1 warning');
  await ideDoc(BASE); await page.waitForFunction(() => document.querySelector('#edProblems')?.getAttribute('aria-label') === '0 errors, 0 warnings' && !/checking/.test(document.querySelector('#edStatus').textContent), null, { timeout: 10000 });
});
test('IDE: completion after a package name, and the import is added', async () => {
  await ideDoc(BASE.replace('@@', 'ln, err := net.@@'));
  await page.keyboard.press('Control+Space'); await page.waitForSelector('.cm-tooltip-autocomplete');
  const list = await page.locator('.cm-tooltip-autocomplete').innerText(); assert.match(list, /Listen/); assert.match(list, /Dial/);
  await page.keyboard.type('Lis'); await page.waitForTimeout(150); await shot('ide-complete');
  assert.match(await page.locator('.cm-tooltip-autocomplete [aria-selected]').innerText(), /^Listen/);
  await page.keyboard.press('Enter');
  const t = await docText(); assert.match(t, /import \(\n\t"fmt"\n\t"net"\n\)/); assert.match(t, /ln, err := net\.Listen\n/);
});
test('IDE: completion knows what a variable is (Accept, Close on a Listener; Write on a File)', async () => {
  await ideDoc(BASE.replace('@@', 'ln, err := net.Listen("tcp", ":9")\n\tln.@@'));
  await page.keyboard.press('Control+Space'); await page.waitForSelector('.cm-tooltip-autocomplete'); const l1 = await page.locator('.cm-tooltip-autocomplete').innerText();
  assert.match(l1, /Accept/); assert.match(l1, /Close/); assert.doesNotMatch(l1, /Println/);
  await ideDoc(BASE.replace('@@', 'f, err := os.Create("x")\n\tf.@@'));
  await page.keyboard.press('Control+Space'); await page.waitForSelector('.cm-tooltip-autocomplete'); const l2 = await page.locator('.cm-tooltip-autocomplete').innerText(); assert.match(l2, /WriteString/); assert.match(l2, /Close/);
  await ideDoc(BASE.replace('@@', 'err.@@')); await page.keyboard.press('Control+Space'); await page.waitForSelector('.cm-tooltip-autocomplete'); assert.match(await page.locator('.cm-tooltip-autocomplete').innerText(), /Error/);
});
test('IDE: snippets and plain-word completion', async () => {
  await ideDoc(BASE.replace('@@', 'iferr@@'));
  await page.keyboard.press('Control+Space'); await page.waitForFunction(() => /check an error/.test(document.querySelector('.cm-tooltip-autocomplete')?.innerText || '')); await page.waitForTimeout(200); await page.keyboard.press('Enter');   // CodeMirror ignores Enter in the first 75 ms of a popup
  assert.match(await docText(), /\tif err != nil \{\n\t\treturn err\n\t\}/);
});
const hoverAt = async (word, nth = 0) => {
  const box = await page.evaluate(([w, n]) => { const v = window.gosock.editor.view; const at = [...v.state.doc.toString().matchAll(new RegExp('\\b' + w + '\\b', 'g'))][n].index + 1; const r = v.coordsAtPos(at); return { x: r.left, y: r.top + 5 }; }, [word, nth]);
  await page.mouse.move(0, 0); await page.waitForSelector('.cm-tooltip-hover', { state: 'detached', timeout: 3000 }).catch(() => {});
  await page.mouse.move(box.x, box.y); await page.waitForSelector('.cm-tooltip-hover', { timeout: 5000 });
  return page.locator('.cm-tooltip-hover').innerText();
};
test('IDE: hover shows the signature as gopls writes it and the whole documentation', async () => {
  await ideDoc('package main\n\nimport (\n\t"io"\n\t"net"\n\t"os"\n)\n\n// copyAll copies.\n//\n// It is ours.\nfunc copyAll(dst, src string) error {\n\tln, err := net.Listen("tcp", ":9000")\n\tf, _ := os.Open("x")\n\tio.Copy(f, f)\n\tf.Close()\n\tln.Close()\n\treturn err\n}\n\nfunc main() {\n\tcopyAll("a", "b")\n\t_ = len("x")\n}\n');
  let h = await hoverAt('Listen');
  assert.match(h, /^func net\.Listen\(network string, address string\) \(net\.Listener, error\)\n/);
  assert.match(h, /The network must be "tcp", "tcp4", "tcp6", "unix" or "unixpacket"\./);            // not only the first sentence
  assert.match(h, /See func Dial for a description/); assert.match(h, /pkg\.go\.dev\/net#Listen/);
  await shot('ide-hover');
  await page.locator('.cm-tooltip-hover a', { hasText: /^Dial$/ }).click();                          // a [Dial] link opens Dial in place
  await page.waitForFunction(() => /func net\.Dial\(network string/.test(document.querySelector('.cm-tooltip-hover')?.innerText));
  await page.locator('.cm-tooltip-hover .cm-doc-back').click();
  await page.waitForFunction(() => /func net\.Listen\(/.test(document.querySelector('.cm-tooltip-hover')?.innerText));
  assert.match(await hoverAt('Copy'), /^func io\.Copy\(dst io\.Writer, src io\.Reader\) \(written int64, err error\)\n[\s\S]*If src implements WriterTo/);
  assert.match(await hoverAt('Close'), /^func \(f \*os\.File\) Close\(\) error/);
  assert.match(await hoverAt('Close', 1), /^func \(net\.Listener\) Close\(\) error/);
  assert.match(await hoverAt('f', 0), /^var f os\.File\n[\s\S]*File represents an open file descriptor/);
  assert.match(await hoverAt('len'), /^func len\(v Type\) int\n[\s\S]*The len built-in function/);
  assert.match(await hoverAt('copyAll', 1), /^func copyAll\(dst string, src string\) error\n+copyAll copies\.\n+It is ours\./);
  assert.match(await hoverAt('net', 1), /^package net \("net"\)\n+Package net provides a portable interface/);
});
test('IDE: signature help while typing the arguments of a call', async () => {
  await ideDoc('package main\n\nimport (\n\t"fmt"\n\t"net"\n\t"os"\n)\n\nfunc send(addr, path string, n int) error { return nil }\n\nfunc main() {\n\t@@\n\tfmt.Println(net.Listen, os.Stdout)\n}\n');
  const sig = () => page.waitForSelector('.cm-sighelp', { timeout: 5000 }).then(() => page.evaluate(() => ({ text: document.querySelector('.cm-sighelp pre').textContent, active: document.querySelector('.cm-sig-active')?.textContent })));
  await page.keyboard.type('ln, err := net.Listen(');
  let s = await sig(); assert.equal(s.text, 'Listen(network string, address string) (net.Listener, error)'); assert.equal(s.active, 'network string');
  assert.match(await page.locator('.cm-sighelp').innerText(), /Listen announces on the local network address\./);
  await page.keyboard.type('"tcp", ');
  s = await sig(); assert.equal(s.active, 'address string');
  await shot('ide-sighelp');
  await page.keyboard.type('fmt.Sprint(1, ');                                                      // a call inside the call: its own signature
  s = await sig(); assert.match(s.text, /^Sprint\(a \.\.\.any\) string$/); assert.equal(s.active, 'a ...any');
  await page.keyboard.type('2)');                                                                   // out of it: back to Listen, still the 2nd parameter
  s = await sig(); assert.match(s.text, /^Listen\(/); assert.equal(s.active, 'address string');
  await page.keyboard.press('Escape'); await page.waitForSelector('.cm-sighelp', { state: 'detached' });
  await page.keyboard.type(')'); await page.keyboard.press('Enter');
  await page.keyboard.type('send("a", "b", ');                                                      // the program's own function
  s = await sig(); assert.equal(s.text, 'send(addr string, path string, n int) error'); assert.equal(s.active, 'n int');
  await page.keyboard.type('3)'); await page.waitForSelector('.cm-sighelp', { state: 'detached' });
  await page.keyboard.press('Enter'); await page.keyboard.type('ln.Accept(');
  s = await sig(); assert.equal(s.text, 'Accept() (net.Conn, error)');
});
test('IDE: the breadcrumbs and the status bar follow the cursor', async () => {
  await ideDoc('package main\n\nfunc recv() {\n\t@@\n}\n\nfunc main() {}\n');
  await page.waitForFunction(() => /recv$/.test(document.querySelector('#edCrumbs').textContent));
  assert.match(await page.locator('#edStatus').innerText(), /Ln 4, Col 2/);
  await page.evaluate(() => window.gosock.editor.view.dispatch({ selection: { anchor: 0 } }));
  await page.waitForFunction(() => /main\.go$/.test(document.querySelector('#edCrumbs').textContent));
});
test('IDE: gofmt keeps the cursor line, refuses code that does not parse', async () => {
  await ideDoc('package main\nimport "fmt"\nfunc   main( ) {\nfmt.Println( "x" )@@\n}\n');
  await page.locator('#format').click(); await page.waitForFunction(() => /^package main\n\nimport "fmt"\n\nfunc main\(\) \{\n\tfmt\.Println\("x"\)\n\}\n$/.test(window.gosock.editor.value), null, { timeout: 15000 });
  await ideDoc('package main\nfunc main( {\n}\n'); await page.locator('#format').click();
  await page.waitForFunction(() => /does not parse/.test(document.querySelector('.toasts').textContent), null, { timeout: 15000 });
});
test('IDE: search, several cursors, comment toggle, bracket closing, undo', async () => {
  await ideDoc('package main\n\nfunc main() {\n\tfoo := 1\n\tfoo++\n\t@@\n}\n');
  await page.keyboard.press('Control+f'); await page.waitForSelector('.cm-search'); await shot('ide-search'); await page.keyboard.press('Escape');
  await page.evaluate(() => { const e = window.gosock.editor, at = e.value.indexOf('foo'); e.view.dispatch({ selection: { anchor: at, head: at + 3 } }); e.focus(); });
  await page.keyboard.press('Control+d'); await page.keyboard.type('bar');
  assert.match(await docText(), /bar := 1\n\tbar\+\+/);
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
  await ideDoc('package main\n\nfunc main() {\n\t@@\n}\n'); await page.keyboard.type('x := []int{1, 2'); assert.match(await docText(), /x := \[\]int\{1, 2\}\n/);
  await page.keyboard.press('Control+/'); assert.match(await docText(), /\/\/ x := /);
});
test('reboot gives fresh machines and keeps built programs', async () => {
  await page.locator('.tab[data-tab="machines"]').click();
  await page.locator('#reset').click();
  assert.doesNotMatch(await sh('B', 'ls'), /big.copy/);
  assert.match(await sh('A', 'gosock'), /usage: gosock/);
});

let failed = 0;
for (const [name, fn] of tests.filter(([n]) => !process.env.ONLY || n.includes(process.env.ONLY))) {
  const t0 = Date.now(); errors.length = 0;
  try { await fn(); assert.deepEqual(errors, [], 'browser errors'); console.log(`ok    ${name} (${Date.now() - t0} ms)`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n`, e.message.slice(0, 1500)); await page.screenshot({ path: `${SHOTS || '/tmp'}/fail-${failed}.png` }).catch(() => {}); }
}
await browser.close(); process.exit(failed ? 1 : 0);
