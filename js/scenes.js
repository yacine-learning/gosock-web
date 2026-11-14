// Step-by-step SVG animations. A scene is a set of elements (data-id) plus steps;
// each step sets cumulative properties (x, y, o, cls, t). CSS transitions do the motion,
// and going back is just re-applying the state of an earlier step.
import { ICON, esc } from './ui.js';

// ── SVG helpers ──
const T = (id, x, y, s, o = {}) => `<text data-id="${id}" x="${x}" y="${y}" font-size="${o.size || 13}" ${o.mono ? 'class="mono"' : ''} ${o.anchor ? `text-anchor="${o.anchor}"` : ''} ${o.strong ? 'class="t-strong"' : ''} ${o.mute ? 'class="t-mute"' : ''} ${o.fill ? `style="fill:${o.fill}"` : ''}>${s}</text>`;
const label = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.size || 13}" ${o.mono ? 'class="mono' + (o.cls ? ' ' + o.cls : '') + '"' : (o.cls ? `class="${o.cls}"` : '')} ${o.anchor ? `text-anchor="${o.anchor}"` : ''} ${o.w ? `font-weight="${o.w}"` : ''} ${o.ls ? `letter-spacing="${o.ls}"` : ''}>${s}</text>`;
// box with title + up to 2 sub lines; elements addressable as id, id-t, id-s, id-u
function B(id, x, y, w, h, o = {}) {
  const cx = x + w / 2;
  const lines = [];
  let ty = y + 28;
  if (o.title !== undefined) { lines.push(`<text data-id="${id}-t" x="${cx}" y="${ty}" text-anchor="middle" font-size="${o.tsize || 14}" class="t-strong">${o.title}</text>`); ty += 24; }
  if (o.sub !== undefined) { lines.push(`<text data-id="${id}-s" x="${cx}" y="${ty}" text-anchor="middle" font-size="${o.ssize || 12}" class="mono${o.subcls ? ' ' + o.subcls : ''}">${o.sub}</text>`); ty += 20; }
  if (o.sub2 !== undefined) { lines.push(`<text data-id="${id}-u" x="${cx}" y="${ty}" text-anchor="middle" font-size="${o.ssize || 12}" class="mono t-mute">${o.sub2}</text>`); }
  return `<g class="m ${o.cls || ''}" data-id="${id}"><rect class="box fillbox ${o.edge || ''}" x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.r || 14}"/>${lines.join('')}</g>`;
}
// packet pill positioned by its base (x,y); moved with translate deltas
function P(id, x, y, txt, color = '', w = 0) {
  const width = w || Math.max(46, txt.length * 8 + 22);
  return `<g class="m pk ${color}" data-id="${id}"><rect x="${x}" y="${y}" width="${width}" height="26" rx="8"/><text data-id="${id}-t" x="${x + width / 2}" y="${y + 17}" text-anchor="middle" font-size="12">${txt}</text></g>`;
}
const L = (id, x1, y1, x2, y2, cls = 'arrow') => `<path class="m ${cls}" data-id="${id}" d="M${x1} ${y1} L${x2} ${y2}" marker-end="url(#ah)"/>`;
const DEFS = `<defs><marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1.5L8.5 5L1 8.5z" fill="var(--muted)"/></marker></defs>`;
const mv = (base, X, Y) => ({ x: X - base[0], y: Y - base[1] });

export const SCENES = {};

// ═════════ 1. life of a syscall ═════════
{
  const pb = [70, 160];                     // packet base
  const at = (X, Y) => mv(pb, X, Y);
  SCENES['syscall-life'] = {
    title: 'Life of a system call', tag: 'write(1, "hi", 2)', w: 960, h: 540,
    svg: `${DEFS}
      <rect class="zone-user" x="20" y="18" width="920" height="214" rx="20" stroke-width="1.3"/>
      ${label(44, 48, 'USER SPACE', { w: 700, ls: '.14em', size: 12, cls: 't-mute' })}
      ${label(158, 48, 'your program: it can only touch its own memory', { size: 12, cls: 't-mute' })}
      <rect class="zone-kernel" x="20" y="300" width="920" height="226" rx="20" stroke-width="1.3"/>
      ${label(44, 330, 'KERNEL SPACE', { w: 700, ls: '.14em', size: 12, cls: 't-mute' })}
      ${label(176, 330, 'the kernel can do anything: hardware, every process, the network', { size: 12, cls: 't-mute' })}
      <line x1="20" y1="266" x2="940" y2="266" class="wire"/>
      ${B('prog', 44, 70, 250, 140, { edge: 'user', title: 'Your Go program', sub: 'syscall.Write(1, buf)', sub2: 'buf = "hi"' })}
      ${B('regs', 340, 70, 290, 140, { edge: 'user', title: 'CPU registers', sub: 'rax=?  rdi=?  rsi=?  rdx=?', sub2: 'syscall number, then 3 arguments' })}
      ${B('ret', 676, 70, 240, 140, { edge: 'user', title: 'Return value', sub: 'rax = ?', sub2: 'negative = -errno' })}
      <g class="m hot" data-id="mode"><rect class="box fillbox" x="372" y="246" width="216" height="40" rx="20"/><text data-id="mode-t" x="480" y="271" text-anchor="middle" font-size="13" class="mono t-strong">CPU mode: USER</text></g>
      ${B('entry', 44, 360, 200, 140, { edge: 'kernel', title: 'Entry point', sub: 'save registers', sub2: 'switch to kernel stack' })}
      ${B('table', 264, 360, 210, 140, { edge: 'kernel', title: 'Syscall table', sub: '[1] → sys_write', sub2: 'number came from rax' })}
      ${B('vfs', 494, 360, 210, 140, { edge: 'kernel', title: 'VFS', sub: 'fd 1 → struct file', sub2: 'file → tty driver' })}
      ${B('dev', 724, 360, 192, 140, { edge: 'kernel', title: 'Terminal', sub: '', sub2: 'your screen' })}
      ${P('req', 70, 160, 'write(1,"hi",2)', 'amber', 150)}`,
    init: { req: { o: 0 }, mode: { cls: '' } },
    steps: [
      { cap: 'Your program calls <code>syscall.Write(1, buf)</code>. In user space it cannot touch the screen, the disk or the network: it can only <b>ask the kernel</b>.', set: { req: { o: 1, ...at(70, 160) }, prog: { cls: 'on' } } },
      { cap: 'Go puts the <b>syscall number</b> and the <b>arguments</b> into CPU registers: number 1 (<code>write</code> on x86-64; 64 on arm64), fd = 1, a pointer to the bytes, length = 2.', set: { req: { ...at(360, 160) }, prog: { cls: '' }, regs: { cls: 'on' }, 'regs-s': { t: 'rax=1  rdi=1  rsi=&buf  rdx=2' } } },
      { cap: 'It executes one special instruction (<code>syscall</code> on x86-64; <code>svc #0</code> on arm64). The CPU <b>switches to kernel mode</b> and jumps to the kernel entry point. This is the only door.', set: { req: { ...at(70, 396) }, regs: { cls: '' }, mode: { cls: 'hot' }, 'mode-t': { t: 'CPU mode: KERNEL' }, entry: { cls: 'hot' } } },
      { cap: 'The kernel saves your registers, switches to its own stack, and uses the number in <code>rax</code> to <b>look up the handler</b> in the syscall table: <code>sys_write</code>.', set: { req: { ...at(292, 396) }, entry: { cls: '' }, table: { cls: 'hot' } } },
      { cap: '<code>sys_write</code> takes fd <b>1</b>, finds it in <b>your process\'s fd table</b>, follows it to an open <i>struct file</i>, and calls the driver behind it.', set: { req: { ...at(522, 396) }, table: { cls: '' }, vfs: { cls: 'hot' } } },
      { cap: 'The terminal driver gets the two bytes and draws them. The work is done: <b>2 bytes written</b>.', set: { req: { ...at(740, 396) }, vfs: { cls: '' }, dev: { cls: 'good' }, 'dev-s': { t: '"hi"' } } },
      { cap: 'The kernel puts the result in <code>rax</code> (on failure: a negative <b>errno</b>), restores your registers, and <b>returns to user mode</b>.', set: { req: { ...at(700, 100) }, 'req-t': { t: 'rax = 2' }, dev: { cls: '' }, mode: { cls: '' }, 'mode-t': { t: 'CPU mode: USER' }, ret: { cls: 'good' }, 'ret-s': { t: 'rax = 2' } } },
      { cap: 'Back in Go: <code>n, err := syscall.Write(...)</code> gives <code>n = 2, err = nil</code>. A negative result would become a Go <code>error</code> holding a <code>syscall.Errno</code>. <b>Everything we study is a trip like this one.</b>', set: { req: { o: 0 }, ret: { cls: '' }, prog: { cls: 'good' } } },
    ],
  };
}

// ═════════ 2. socket lifecycle ═════════
{
  const pb = [330, 462];
  const at = (X, Y) => mv(pb, X, Y);
  SCENES['socket-lifecycle'] = {
    title: 'Life of a TCP connection', tag: 'server and client', w: 960, h: 590,
    svg: `${DEFS}
      <rect x="24" y="20" width="400" height="520" rx="20" class="box fillbox a" style="fill:color-mix(in srgb,var(--a) 5%,transparent)"/>
      <rect x="536" y="20" width="400" height="520" rx="20" class="box fillbox b" style="fill:color-mix(in srgb,var(--b) 5%,transparent)"/>
      ${label(48, 52, 'SERVER · machine A', { w: 700, ls: '.1em', size: 12, cls: 't-mute' })}
      ${label(560, 52, 'CLIENT · machine B', { w: 700, ls: '.1em', size: 12, cls: 't-mute' })}
      <line x1="44" y1="186" x2="404" y2="186" class="wire"/><line x1="556" y1="186" x2="916" y2="186" class="wire"/>
      ${label(48, 176, 'user space', { size: 11, cls: 't-mute' })}${label(560, 176, 'user space', { size: 11, cls: 't-mute' })}
      ${label(48, 208, 'kernel', { size: 11, cls: 't-mute' })}${label(560, 208, 'kernel', { size: 11, cls: 't-mute' })}
      ${B('sprog', 48, 72, 352, 90, { edge: 'a', title: 'server program', sub: '', ssize: 13 })}
      ${B('cprog', 560, 72, 352, 90, { edge: 'b', title: 'client program', sub: '', ssize: 13 })}
      ${B('s3', 48, 224, 352, 64, { edge: 'a', sub: 'fd 3', ssize: 13 })}
      ${B('s4', 48, 308, 352, 64, { edge: 'a', sub: 'fd 4', ssize: 13 })}
      ${B('c3', 560, 224, 352, 64, { edge: 'b', sub: 'fd 3', ssize: 13 })}
      ${label(480, 440, 'the network', { anchor: 'middle', size: 11, cls: 't-mute' })}
      <path class="wire" d="M404 475 H556"/>
      ${P('syn', 330, 462, 'SYN', '', 70)}
      ${P('synack', 330, 462, 'SYN-ACK', 'green', 90)}
      ${P('ack', 330, 462, 'ACK', 'violet', 70)}
      ${P('data', 330, 462, 'DATA "hello"', 'amber', 128)}
      ${P('fin', 330, 462, 'FIN', 'red', 70)}`,
    init: { sprog: {}, s3: { o: 0 }, s4: { o: 0 }, c3: { o: 0 }, syn: { o: 0 }, synack: { o: 0 }, ack: { o: 0 }, data: { o: 0 }, fin: { o: 0 } },
    steps: [
      { cap: 'The server calls <code>socket(AF_INET, SOCK_STREAM)</code>. The kernel creates a socket object and returns a <b>file descriptor</b>: <code>3</code>.', set: { 'sprog-s': { t: 'fd = socket(AF_INET, SOCK_STREAM)' }, sprog: { cls: 'on' }, s3: { o: 1, cls: 'on' }, 's3-s': { t: 'fd 3 · created, no address yet' } } },
      { cap: '<code>bind(3, 0.0.0.0:9000)</code> attaches the socket to <b>port 9000</b>. If another socket owns that port the call fails with <code>EADDRINUSE</code>.', set: { 'sprog-s': { t: 'bind(3, 0.0.0.0:9000)' }, 's3-s': { t: 'fd 3 · bound to 0.0.0.0:9000' } } },
      { cap: '<code>listen(3, backlog)</code> turns it into a <b>listening socket</b>. From now on the <i>kernel</i> answers handshakes for it, even before the program asks for anyone.', set: { 'sprog-s': { t: 'listen(3, 128)' }, s3: { cls: 'hot' }, 's3-s': { t: 'fd 3 · LISTEN :9000' } } },
      { cap: '<code>accept(3)</code> blocks: the program <b>sleeps</b> in the kernel until a connection is ready. No CPU used while waiting.', set: { 'sprog-s': { t: 'accept(3)  … sleeping' }, sprog: { cls: '' } } },
      { cap: 'On machine B the client creates its own socket (<code>fd 3</code>) and calls <code>connect(3, A:9000)</code>. The <i>client kernel</i> picks an ephemeral source port and sends a <b>SYN</b>.', set: { 'cprog-s': { t: 'connect(3, 10.0.0.1:9000)' }, cprog: { cls: 'on' }, c3: { o: 1, cls: 'on' }, 'c3-s': { t: 'fd 3 · SYN_SENT (port 47230)' }, syn: { o: 1, ...at(330, 462) } } },
      { cap: 'The SYN crosses the network. The <b>server kernel</b> (not the program!) answers with <b>SYN-ACK</b>. The server program is still asleep in <code>accept</code>.', set: { syn: { o: 1, ...at(460, 462) }, synack: { o: 1, ...at(460, 462) } } },
      { cap: 'The client kernel replies <b>ACK</b>. The client socket becomes <b>ESTABLISHED</b>, and <code>connect()</code> returns in the client program.', set: { syn: { o: 0 }, synack: { o: 1, ...at(330, 462) }, ack: { o: 1, ...at(330, 462) }, c3: { cls: 'good' }, 'c3-s': { t: 'fd 3 · ESTABLISHED' }, 'cprog-s': { t: 'connect() returned 0' } } },
      { cap: 'The ACK reaches the server: the connection is complete and waits in the <b>accept queue</b>. <code>accept()</code> wakes up and returns a <b>new fd (4)</b>, a separate socket for this client. <b>fd 3 keeps listening.</b>', set: { ack: { o: 1, ...at(460, 462) }, synack: { o: 0 }, s4: { o: 1, cls: 'good' }, 's4-s': { t: 'fd 4 · ESTABLISHED  (B:47230)' }, 'sprog-s': { t: 'fd = accept(3)  →  4' }, sprog: { cls: 'good' } } },
      { cap: 'Data flows both ways. The client calls <code>write(3, "hello")</code>; the server\'s <code>read(4)</code> gets the bytes from the <b>kernel receive buffer</b>.', set: { ack: { o: 0 }, data: { o: 1, ...at(330, 462) }, 'cprog-s': { t: 'write(3, "hello")' } } },
      { cap: '', set: { data: { o: 1, ...at(450, 462) }, 'sprog-s': { t: 'read(4) → "hello"' } } },
      { cap: 'The client calls <code>close(3)</code>. Its kernel sends a <b>FIN</b>: "I have no more data". The server will see <code>read</code> return <b>0</b> (end of stream).', set: { data: { o: 0 }, fin: { o: 1, ...at(330, 462) }, 'cprog-s': { t: 'close(3)' }, c3: { cls: 'bad' }, 'c3-s': { t: 'fd 3 · FIN_WAIT_1' } } },
      { cap: '', set: { fin: { o: 1, ...at(460, 462) }, s4: { cls: 'bad' }, 's4-s': { t: 'fd 4 · CLOSE_WAIT' }, 'sprog-s': { t: 'read(4) → 0 (EOF)' } } },
    ],
  };
  // repeat the previous caption for follow-up frames
  const st = SCENES['socket-lifecycle'].steps;
  st[9].cap = 'The server <code>read(4)</code> returns <code>"hello"</code>: bytes copied from the kernel receive buffer into your Go slice.';
  st[11].cap = 'The FIN arrives: the server socket is now <b>CLOSE_WAIT</b>, waiting for the program to <code>close(4)</code> too. Remember: <b>listening socket ≠ connected socket</b>.';
}

// ═════════ 3. file descriptors ═════════
{
  SCENES['fd-tables'] = {
    title: 'File descriptors, open files, inodes', tag: 'module 3', w: 960, h: 600,
    svg: `${DEFS}
      ${label(40, 36, 'PROCESS FD TABLE', { w: 700, ls: '.1em', size: 11, cls: 't-mute' })}
      ${label(390, 36, 'OPEN FILE DESCRIPTIONS', { w: 700, ls: '.1em', size: 11, cls: 't-mute' })}
      ${label(730, 36, 'INODES', { w: 700, ls: '.1em', size: 11, cls: 't-mute' })}
      ${label(40, 55, 'per process, small integers', { size: 11, cls: 't-mute' })}
      ${label(390, 55, 'kernel: offset + flags', { size: 11, cls: 't-mute' })}
      ${label(730, 55, 'the file itself', { size: 11, cls: 't-mute' })}
      ${B('fd0', 40, 70, 200, 42, { edge: 'user', sub: 'fd 0  stdin', ssize: 13 })}
      ${B('fd1', 40, 120, 200, 42, { edge: 'user', sub: 'fd 1  stdout', ssize: 13 })}
      ${B('fd2', 40, 170, 200, 42, { edge: 'user', sub: 'fd 2  stderr', ssize: 13 })}
      ${B('fd3', 40, 240, 200, 42, { edge: 'user', sub: 'fd 3', ssize: 13 })}
      ${B('fd4', 40, 290, 200, 42, { edge: 'user', sub: 'fd 4', ssize: 13 })}
      ${B('fd5', 40, 340, 200, 42, { edge: 'user', sub: 'fd 5', ssize: 13 })}
      ${B('ofdT', 390, 100, 250, 76, { edge: 'kernel', title: 'terminal', sub: 'O_RDWR', ssize: 12 })}
      ${B('ofdA', 390, 232, 250, 86, { edge: 'kernel', title: 'open file #1', sub: 'offset 0 · O_RDONLY', ssize: 12 })}
      ${B('ofdB', 390, 352, 250, 86, { edge: 'kernel', title: 'open file #2', sub: 'offset 0 · O_RDONLY', ssize: 12 })}
      ${B('inT', 730, 100, 200, 76, { edge: 'net', title: 'tty', sub: 'character device', ssize: 11 })}
      ${B('inA', 730, 290, 200, 96, { edge: 'net', title: 'a.txt', sub: 'inode 4821', sub2: 'size 26 bytes', ssize: 12 })}
      ${L('l0', 240, 91, 390, 130)}${L('l1', 240, 141, 390, 138)}${L('l2', 240, 191, 390, 146)}
      ${L('lT', 640, 138, 730, 138)}
      ${L('l3', 240, 261, 390, 268)}${L('l4', 240, 311, 390, 392)}${L('l5', 240, 361, 390, 290)}
      ${L('lA', 640, 275, 730, 318)}${L('lB', 640, 395, 730, 358)}
      ${label(40, 472, 'CHILD PROCESS after fork()', { w: 700, ls: '.1em', size: 11, cls: 't-mute', }).replace('<text', '<text data-id="chtitle"')}
      <g data-id="cgrp" class="m">
      ${B('cfd3', 40, 490, 200, 42, { edge: 'a', sub: 'fd 3 (copy)', ssize: 13 })}
      ${B('cfd4', 40, 540, 200, 42, { edge: 'a', sub: 'fd 4 (copy)', ssize: 13 })}
      ${L('lc3', 240, 511, 390, 300)}${L('lc4', 240, 561, 390, 420)}</g>`,
    init: { fd3: { o: 0 }, fd4: { o: 0 }, fd5: { o: 0 }, ofdA: { o: 0 }, ofdB: { o: 0 }, inA: { o: 0 }, l3: { o: 0 }, l4: { o: 0 }, l5: { o: 0 }, lA: { o: 0 }, lB: { o: 0 }, cgrp: { o: 0 }, chtitle: { o: 0 } },
    steps: [
      { cap: 'Every process starts with <b>three descriptors</b>: 0, 1, 2. Each is just an index into a <b>per-process table</b> that points to a kernel "open file". Here they all point to the terminal.', set: { fd0: { cls: 'on' }, fd1: { cls: 'on' }, fd2: { cls: 'on' }, ofdT: { cls: 'on' } } },
      { cap: '<code>fd = open("a.txt", O_RDONLY)</code> → the kernel picks the <b>lowest free number</b> (3 here; a Go program has a few more open already), creates an <b>open file description</b> (offset 0, flags) and links it to the file\'s <b>inode</b>.', set: { fd0: { cls: '' }, fd1: { cls: '' }, fd2: { cls: '' }, ofdT: { cls: '' }, fd3: { o: 1, cls: 'hot' }, ofdA: { o: 1, cls: 'hot' }, inA: { o: 1, cls: 'hot' }, l3: { o: 1 }, lA: { o: 1 } } },
      { cap: '<code>read(3, buf, 5)</code> returns the first 5 bytes. The <b>offset lives in the open file description</b>, not in the fd and not in the file: it is now 5.', set: { fd3: { cls: 'on' }, ofdA: { cls: 'good' }, 'ofdA-s': { t: 'offset 5 · O_RDONLY' }, inA: { cls: '' } } },
      { cap: 'Opening the <b>same file again</b> gives fd 4 and a <b>separate</b> open file description with its own offset (0). Same inode, independent cursors.', set: { fd3: { cls: '' }, ofdA: { cls: '' }, fd4: { o: 1, cls: 'hot' }, ofdB: { o: 1, cls: 'hot' }, l4: { o: 1 }, lB: { o: 1 } } },
      { cap: '<code>dup(3)</code> creates fd 5 pointing to the <b>same</b> open file description as fd 3. They <b>share one offset</b>: reading 3 bytes through fd 5 moves the offset seen by fd 3 as well.', set: { fd4: { cls: '' }, ofdB: { cls: '' }, fd5: { o: 1, cls: 'good' }, l5: { o: 1 }, ofdA: { cls: 'good' }, 'ofdA-s': { t: 'offset 8 · O_RDONLY' } } },
      { cap: '<code>fork()</code> copies the fd table into the child. The child\'s fds point to the <b>same open file descriptions</b>: parent and child share offsets. This is why a forked server must close what it doesn\'t need.', set: { fd5: { cls: '' }, ofdA: { cls: '' }, cgrp: { o: 1 }, chtitle: { o: 1 }, cfd3: { cls: 'on' }, cfd4: { cls: 'on' } } },
      { cap: 'Remember the chain: <b>fd (per process) → open file description (offset, flags) → inode (the file)</b>. Sockets work the same way: a socket fd points to an open "file" whose inode is a socket. That is why <code>read</code>, <code>write</code> and <code>close</code> work on both.', set: { cfd3: { cls: '' }, cfd4: { cls: '' }, fd3: { cls: 'on' }, fd4: { cls: 'on' }, fd5: { cls: 'on' } } },
    ],
  };
}

// ═════════ 4. TCP states over time ═════════
{
  const X1 = 160, X2 = 800;                       // client / server lifelines
  // [id, label, color, width, y, fromClient]
  const PK = [
    ['p1', 'SYN  seq=x', '', 130, 80, true],
    ['p2', 'SYN-ACK  seq=y ack=x+1', 'green', 190, 130, false],
    ['p3', 'ACK  ack=y+1', 'violet', 130, 180, true],
    ['p4', 'DATA  "hello"', 'amber', 130, 250, true],
    ['p5', 'ACK', 'violet', 70, 300, false],
    ['p6', 'FIN', 'red', 70, 370, true],
    ['p7', 'ACK', 'violet', 70, 420, false],
    ['p8', 'FIN', 'red', 70, 470, false],
    ['p9', 'ACK', 'violet', 70, 520, true],
  ];
  const SL = 34;                                  // vertical drop of a slanted arrow
  const pkSvg = PK.map(([id, t, c, w, y, fc]) => P(id, (fc ? X1 : X2) - w / 2, y, t, c, w)).join('');
  const arSvg = PK.map(([id, , , , y, fc]) => `<path class="m arrow" data-id="a${id}" d="M${fc ? X1 : X2} ${y + 13} L${fc ? X2 : X1} ${y + 13 + SL}" marker-end="url(#ah)"/>`).join('');
  const go = id => { const [, , , , , fc] = PK.find(p => p[0] === id); return { [id]: { o: 1, x: fc ? X2 - X1 : X1 - X2, y: SL }, ['a' + id]: { o: 1 } }; };
  const chip = (id, x, y, txt) => `<g class="m" data-id="${id}"><rect class="box fillbox" x="${x - 100}" y="${y}" width="200" height="34" rx="10"/><text data-id="${id}-t" x="${x}" y="${y + 22}" text-anchor="middle" font-size="13" class="mono t-strong">${txt}</text></g>`;
  const init = { tw: { o: 0 } };
  PK.forEach(([id]) => { init[id] = { o: 0 }; init['a' + id] = { o: 0 }; });
  SCENES['tcp-states'] = {
    title: 'TCP handshake, data and teardown', tag: 'states on both sides', w: 960, h: 640,
    svg: `${DEFS}
      ${label(X1, 28, 'CLIENT', { anchor: 'middle', w: 700, ls: '.12em', size: 12, cls: 't-mute' })}
      ${label(X2, 28, 'SERVER', { anchor: 'middle', w: 700, ls: '.12em', size: 12, cls: 't-mute' })}
      <line x1="${X1}" y1="76" x2="${X1}" y2="612" class="wire"/><line x1="${X2}" y1="76" x2="${X2}" y2="612" class="wire"/>
      ${chip('cs', X1, 36, 'CLOSED')}${chip('ss', X2, 36, 'CLOSED')}
      ${arSvg}${pkSvg}
      <g data-id="tw" class="m"><text x="${X1 + 120}" y="596" font-size="12" class="mono" style="fill:var(--kernel)">⏱ TIME_WAIT: the client waits 2·MSL (60 s on Linux)</text></g>`,
    init,
    steps: [
      { cap: 'Both sides start <b>CLOSED</b>. The server calls <code>socket</code>, <code>bind</code>, <code>listen</code>: its socket becomes <b>LISTEN</b>.', set: { ss: { cls: 'hot' }, 'ss-t': { t: 'LISTEN' } } },
      { cap: 'The client calls <code>connect()</code>: it sends a <b>SYN</b> with an initial sequence number <code>x</code> and enters <b>SYN_SENT</b>.', set: { cs: { cls: 'on' }, 'cs-t': { t: 'SYN_SENT' }, ...go('p1') } },
      { cap: 'The server kernel receives the SYN, creates a half-open connection (<b>SYN_RCVD</b>) and answers with <b>SYN-ACK</b>: its own number <code>y</code> and "I expect <code>x+1</code>".', set: { ss: { cls: 'on' }, 'ss-t': { t: 'SYN_RCVD' }, ...go('p2') } },
      { cap: 'The client sends the final <b>ACK</b>. It is <b>ESTABLISHED</b> (<code>connect()</code> returns) and so is the server once the ACK arrives. Three segments: <b>the 3-way handshake</b>.', set: { cs: { cls: 'good' }, 'cs-t': { t: 'ESTABLISHED' }, ...go('p3'), ss: { cls: 'good' }, 'ss-t': { t: 'ESTABLISHED' } } },
      { cap: 'Data: the client writes "hello", the server kernel <b>ACKs</b> it (acknowledging bytes, not packets). Sequence numbers count <b>bytes</b>.', set: { ...go('p4'), ...go('p5') } },
      { cap: 'The client calls <code>close()</code>: it sends <b>FIN</b> and enters <b>FIN_WAIT_1</b>. The server ACKs: client → <b>FIN_WAIT_2</b>, server → <b>CLOSE_WAIT</b> (waiting for its own program to close).', set: { cs: { cls: 'hot' }, 'cs-t': { t: 'FIN_WAIT_1 → FIN_WAIT_2' }, ss: { cls: 'hot' }, 'ss-t': { t: 'CLOSE_WAIT' }, ...go('p6'), ...go('p7') } },
      { cap: 'The server program calls <code>close()</code> too: it sends its <b>FIN</b> and goes to <b>LAST_ACK</b>. The client ACKs and enters <b>TIME_WAIT</b>; the server socket disappears (<b>CLOSED</b>).', set: { 'ss-t': { t: 'LAST_ACK → CLOSED' }, ss: { cls: '' }, ...go('p8'), ...go('p9'), cs: { cls: 'bad' }, 'cs-t': { t: 'TIME_WAIT' }, tw: { o: 1 } } },
      { cap: 'The side that <b>closes first</b> keeps the socket in TIME_WAIT for 60 s, so late packets of the old connection cannot confuse a new one with the same ports. Then: CLOSED.', set: { 'cs-t': { t: 'CLOSED (after 60 s)' }, cs: { cls: '' } } },
    ],
  };
}

// ═════════ 5. SYN queue / accept queue ═════════
{
  const pb = [150, 100];
  SCENES['accept-queue'] = {
    title: 'The two queues behind listen()', tag: 'backlog', w: 960, h: 560,
    svg: `${DEFS}
      <rect x="360" y="30" width="330" height="500" rx="20" class="zone-kernel" stroke-width="1.3"/>
      ${label(380, 60, 'KERNEL · listening socket :9000', { w: 700, ls: '.08em', size: 12, cls: 't-mute' })}
      ${label(60, 60, 'CLIENTS', { w: 700, ls: '.1em', size: 12, cls: 't-mute' })}
      ${B('synq', 384, 90, 282, 150, { edge: 'kernel', title: 'SYN queue', sub: 'half-open: SYN_RECV', sub2: 'waiting for the final ACK' })}
      ${B('accq', 384, 280, 282, 160, { edge: 'kernel', title: 'Accept queue', sub: 'ESTABLISHED, not accepted', sub2: 'capacity = backlog (3)' })}
      ${B('app', 750, 280, 170, 160, { edge: 'a', title: 'your server', sub: 'accept()', sub2: '' })}
      <g class="m" data-id="ssbox"><rect class="box" x="384" y="452" width="282" height="64" rx="12"/>
        <text x="400" y="477" font-size="12" class="mono t-mute">$ ss -tln 'sport = :9000'</text>
        <text data-id="ss" x="400" y="501" font-size="13" class="mono">LISTEN  Recv-Q 0   Send-Q 3</text></g>
      ${[0, 1, 2, 3].map(i => `<g class="m" data-id="c${i}"><circle cx="90" cy="${130 + i * 90}" r="26" class="box fillbox"/><text x="90" y="${135 + i * 90}" text-anchor="middle" font-size="13" class="mono t-strong">C${i + 1}</text></g>`).join('')}
      ${[0, 1, 2, 3].map(i => P('k' + i, 130, 117 + i * 90, 'SYN', '', 52)).join('')}
      ${[0, 1, 2, 3].map(i => `<g class="m" data-id="q${i}"><rect x="404" y="188" width="70" height="30" rx="9" fill="var(--accent)"/><text x="439" y="208" text-anchor="middle" font-size="12" class="mono" style="fill:#04121c;font-weight:700">C${i + 1}</text></g>`).join('')}
      ${[0, 1, 2, 3].map(i => `<g class="m" data-id="a${i}"><rect x="404" y="384" width="70" height="30" rx="9" fill="var(--net)"/><text x="439" y="404" text-anchor="middle" font-size="12" class="mono" style="fill:#04121c;font-weight:700">C${i + 1}</text></g>`).join('')}`,
    init: { k0: { o: 0 }, k1: { o: 0 }, k2: { o: 0 }, k3: { o: 0 }, q0: { o: 0 }, q1: { o: 0 }, q2: { o: 0 }, q3: { o: 0 }, a0: { o: 0 }, a1: { o: 0 }, a2: { o: 0 }, a3: { o: 0 } },
    steps: [
      { cap: '<code>listen(fd, 3)</code> makes the kernel keep <b>two queues</b> for this socket. The program is <b>not</b> in the loop yet: it never calls <code>accept()</code> in this story, so we can see what piles up.', set: { synq: { cls: 'on' }, accq: { cls: 'on' } } },
      { cap: 'Client C1 sends a SYN. The kernel replies SYN-ACK and stores C1 in the <b>SYN queue</b> as <b>SYN_RECV</b>, waiting for the final ACK.', set: { c0: { cls: 'on' }, k0: { o: 1, x: 0, y: 0 }, q0: { o: 1, x: 0, y: 0 }, synq: { cls: 'hot' } } },
      { cap: 'C1\'s ACK arrives: the handshake is complete. C1 moves to the <b>accept queue</b> as ESTABLISHED, <b>even though no accept() was called</b>. Data it sends will already be buffered by the kernel.', set: { c0: { cls: 'good' }, k0: { o: 0 }, q0: { o: 0 }, a0: { o: 1, x: 0, y: 0 }, accq: { cls: 'hot' }, synq: { cls: 'on' }, ss: { t: 'LISTEN  Recv-Q 1   Send-Q 3' } } },
      { cap: 'C2 and C3 do the same. The accept queue now holds <b>3 of 3</b>: <code>ss -tln</code> shows <b>Recv-Q = 3</b> (current length) and <b>Send-Q = 3</b> (the backlog).', set: { c1: { cls: 'good' }, c2: { cls: 'good' }, a1: { o: 1, x: 80, y: 0 }, a2: { o: 1, x: 160, y: 0 }, ss: { t: 'LISTEN  Recv-Q 3   Send-Q 3' }, accq: { cls: 'bad' } } },
      { cap: 'C4 arrives but the accept queue is <b>full</b>. Linux silently <b>drops</b> the packet (by default): C4 stays in SYN_SENT and <b>retransmits</b> after 1 s, 2 s, 4 s… From the client side the connection just <i>hangs</i>.', set: { c3: { cls: 'bad' }, k3: { o: 1, x: 0, y: 0, cls: 'red' } } },
      { cap: 'Now the program finally calls <code>accept()</code>. The kernel <b>pops C1</b> off the queue and gives your program a new fd. The queue has room: <code>Recv-Q</code> falls to 2.', set: { a0: { o: 1, x: 350, y: 0 }, app: { cls: 'good' }, 'app-u': { t: 'got C1 → fd 4' }, accq: { cls: 'on' }, ss: { t: 'LISTEN  Recv-Q 2   Send-Q 3' } } },
      { cap: 'C4\'s next SYN retransmission is accepted. <b>Takeaway:</b> if your server is slow to <code>accept()</code>, clients wait or time out, and you can <i>see it</i> in <code>ss -tln</code>. In Module 4 you will reproduce this yourself.', set: { c3: { cls: 'on' }, k3: { o: 0 }, a3: { o: 1, x: 0, y: 0 }, ss: { t: 'LISTEN  Recv-Q 3   Send-Q 3' } } },
    ],
  };
}

// ═════════ 6. page cache ═════════
{
  SCENES['page-cache'] = {
    title: 'read() and write() through the page cache', tag: 'module 3', w: 960, h: 520,
    svg: `${DEFS}
      ${B('buf', 40, 140, 250, 190, { edge: 'user', title: 'Your buffer', sub: 'make([]byte, 4096)', sub2: 'user-space memory' })}
      ${B('pc', 355, 140, 250, 190, { edge: 'kernel', title: 'Page cache', sub: 'file pages kept in RAM', sub2: 'kernel memory' })}
      ${B('disk', 670, 140, 250, 190, { edge: 'net', title: 'Disk', sub: 'a.txt', sub2: 'slow: ~100 µs (SSD)' })}
      ${label(165, 112, 'USER SPACE', { anchor: 'middle', w: 700, ls: '.1em', size: 11, cls: 't-mute' })}
      ${label(480, 112, 'KERNEL · RAM', { anchor: 'middle', w: 700, ls: '.1em', size: 11, cls: 't-mute' })}
      ${label(795, 112, 'STORAGE', { anchor: 'middle', w: 700, ls: '.1em', size: 11, cls: 't-mute' })}
      <g class="m" data-id="pgc"><rect x="385" y="270" width="190" height="34" rx="9" fill="var(--kernel)"/><text data-id="pgc-t" x="480" y="292" text-anchor="middle" font-size="12" class="mono" style="fill:#04121c;font-weight:700">page 0</text></g>
      <g class="m" data-id="dat"><rect x="700" y="270" width="190" height="34" rx="9" fill="var(--net)"/><text x="795" y="292" text-anchor="middle" font-size="12" class="mono" style="fill:#04121c;font-weight:700">page 0 (on disk)</text></g>
      <g class="m" data-id="ub"><rect x="70" y="270" width="190" height="34" rx="9" fill="var(--accent)"/><text x="165" y="292" text-anchor="middle" font-size="12" class="mono" style="fill:#04121c;font-weight:700">"hello…"</text></g>
      ${L('d2c', 668, 215, 608, 215)}${L('c2u', 353, 215, 293, 215)}${L('u2c', 293, 255, 353, 255)}${L('c2d', 608, 255, 668, 255)}
      <text data-id="note" x="480" y="480" text-anchor="middle" font-size="13" class="mono t-mute"></text>
      <text data-id="lat" x="480" y="60" text-anchor="middle" font-size="22" class="t-strong"></text>`,
    init: { pgc: { o: 0 }, ub: { o: 0 }, dat: { o: 1 }, d2c: { o: 0 }, c2u: { o: 0 }, u2c: { o: 0 }, c2d: { o: 0 }, note: { o: 0 }, lat: { o: 0 } },
    steps: [
      { cap: 'Your program wants the first 4 KiB of a file. Files are cached in RAM by the kernel in the <b>page cache</b>, in units of pages. Nothing is cached yet.', set: { buf: { cls: 'on' } } },
      { cap: '<code>read(fd, buf, 4096)</code> — first call: a <b>cache miss</b>. The kernel asks the disk driver and the page is loaded <b>into the page cache</b>. Your program sleeps meanwhile.', set: { buf: { cls: '' }, disk: { cls: 'hot' }, d2c: { o: 1 }, pgc: { o: 1 }, lat: { o: 1, t: 'slow: waits for the disk' } } },
      { cap: 'Then the kernel <b>copies</b> the bytes from the page cache into <b>your buffer</b>. <code>read</code> returns 4096. One copy from kernel memory to user memory.', set: { disk: { cls: '' }, d2c: { o: 0 }, pc: { cls: 'hot' }, c2u: { o: 1 }, ub: { o: 1 }, lat: { o: 1, t: 'first read done' } } },
      { cap: 'Read the same bytes again (or another process does): a <b>cache hit</b>. No disk access at all, just the copy cache → buffer. Microseconds, not hundreds of them.', set: { pc: { cls: 'good' }, 'pgc-t': { t: 'page 0 (HIT)' }, lat: { o: 1, t: 'fast: served from RAM' }, ub: { o: 0 } } },
      { cap: '<code>write(fd, buf, 4096)</code> copies <b>into the page cache</b> and marks the page <b>dirty</b>. <code>write</code> returns <i>immediately</i>: your data is in RAM, not yet on disk!', set: { c2u: { o: 0 }, ub: { o: 1 }, u2c: { o: 1 }, pc: { cls: 'hot' }, 'pgc-t': { t: 'page 0 (DIRTY)' }, lat: { o: 1, t: 'write returns before the disk' } } },
      { cap: 'Later (a timer, memory pressure, or <code>fsync(fd)</code>) the kernel <b>writes the dirty page back</b> to disk. Only <code>fsync</code> tells you the data is durable.', set: { u2c: { o: 0 }, ub: { o: 0 }, c2d: { o: 1 }, disk: { cls: 'good' }, pc: { cls: '' }, 'pgc-t': { t: 'page 0 (clean again)' }, lat: { o: 1, t: 'writeback to disk' } } },
      { cap: 'This is why <code>cat</code> is fast the second time, and why the kernel has "free" memory that is actually full of cached files. <b>sendfile</b>, which you met in module 1, skips the copy to user space entirely.', set: { c2d: { o: 0 }, disk: { cls: '' }, pc: { cls: 'on' } } },
    ],
  };
}

// ═════════ 7. the journey of a file (Module 1) ═════════
{
  const BX = { disk: 24, cache: 132, snd: 240, nicA: 348, nicB: 516, rcv: 624, cacheB: 732, diskB: 840 };
  const BW = 96, BY = 236, BH = 104;
  const bx = (id, x, t, sub, edge) => B(id, x, BY, BW, BH, { edge, title: t, tsize: 12, sub, ssize: 11 });
  const base = [BX.disk + 8, 310];
  const at = X => mv(base, X + 8, 310);
  SCENES['journey'] = {
    title: 'The journey of a file', tag: 'the whole trip', w: 960, h: 440,
    svg: `${DEFS}
      <rect class="zone-kernel" x="10" y="10" width="450" height="420" rx="20" stroke-width="1.3" style="fill:none"/>
      <rect class="zone-kernel" x="500" y="10" width="450" height="420" rx="20" stroke-width="1.3" style="fill:none"/>
      ${label(30, 36, 'MACHINE A · SENDER', { w: 700, ls: '.1em', size: 12, cls: 't-mute' })}
      ${label(520, 36, 'MACHINE B · RECEIVER', { w: 700, ls: '.1em', size: 12, cls: 't-mute' })}
      ${B('progA', 30, 52, 410, 78, { edge: 'user', title: 'gosock send', sub: 'io.Copy(conn, file)', ssize: 12 })}
      ${B('progB', 520, 52, 410, 78, { edge: 'user', title: 'gosock recv', sub: 'io.Copy(file, conn)', ssize: 12 })}
      ${label(30, 156, 'USER SPACE ↑', { size: 11, cls: 't-mute' })}
      <text data-id="sysA" x="235" y="154" text-anchor="middle" font-size="13" class="mono t-strong"></text>
      <text data-id="sysB" x="725" y="154" text-anchor="middle" font-size="13" class="mono t-strong"></text>
      <line x1="20" y1="184" x2="450" y2="184" class="wire"/><line x1="510" y1="184" x2="940" y2="184" class="wire"/>
      ${label(30, 208, 'KERNEL ↓', { size: 11, cls: 't-mute' })}
      ${bx('disk', BX.disk, 'disk', 'big.bin', 'net')}${bx('cache', BX.cache, 'page cache', 'RAM', 'kernel')}${bx('snd', BX.snd, 'send buffer', 'socket', 'kernel')}${bx('nicA', BX.nicA, 'NIC', 'packets', 'net')}
      ${bx('nicB', BX.nicB, 'NIC', 'packets', 'net')}${bx('rcv', BX.rcv, 'recv buffer', 'socket', 'kernel')}${bx('cacheB', BX.cacheB, 'page cache', 'RAM', 'kernel')}${bx('diskB', BX.diskB, 'disk', 'in.bin', 'net')}
      <path class="m wire" data-id="wire" d="M444 288 L516 288"/>
      ${label(480, 276, 'wire', { anchor: 'middle', size: 11, cls: 't-mute' })}
      <text data-id="noteA" x="235" y="400" text-anchor="middle" font-size="12.5" class="t-mute"></text>
      <text data-id="noteB" x="725" y="400" text-anchor="middle" font-size="12.5" class="t-mute"></text>
      ${P('data', base[0], base[1], 'the file', 'amber', 80)}`,
    init: { data: { o: 0 }, sysA: { t: '' }, sysB: { t: '' }, noteA: { t: '' }, noteB: { t: '' } },
    steps: [
      { cap: 'A file sits on machine A\'s <b>disk</b>. Two programs are running: <b>gosock send</b> on A and <b>gosock recv</b> on B. Programs live in <b>user space</b> (top). Everything below the line is the <b>kernel</b>. Press play and follow the bytes.', set: { disk: { cls: 'on' }, data: { o: 1, x: 0, y: 0 } } },
      { cap: 'The program asks the kernel to <b>open</b> the file and to create a <b>socket</b>. It gets back two small numbers, <b>file descriptors</b>: 3 for the file, 4 for the socket. This is all the program will ever hold.', set: { disk: { cls: '' }, progA: { cls: 'on' }, sysA: { t: 'openat() = 3     socket() = 4' }, noteA: { t: 'the program holds two numbers, not the data' } } },
      { cap: 'One call does the rest: <code>sendfile(4, 3)</code>. The kernel reads the file from the disk into the <b>page cache</b>, its copy of file contents in RAM.', set: { progA: { cls: '' }, sysA: { t: 'sendfile(4, 3, …)' }, disk: { cls: 'hot' }, cache: { cls: 'hot' }, data: { o: 1, ...at(BX.cache) } } },
      { cap: 'From the page cache the kernel copies the bytes into the socket\'s <b>send buffer</b>. The bytes never entered the program\'s memory: that is why this path is called <b>zero-copy</b> (for the program).', set: { disk: { cls: '' }, cache: { cls: '' }, snd: { cls: 'hot' }, data: { o: 1, ...at(BX.snd) }, noteA: { t: 'no copy into the program: the data stays in the kernel' } } },
      { cap: 'TCP takes bytes from the send buffer, cuts them into <b>packets</b> and numbers them. The <b>network card</b> puts them on the wire.', set: { snd: { cls: '' }, nicA: { cls: 'hot' }, data: { o: 1, ...at(BX.nicA) }, 'data-t': { t: 'packets' }, noteA: { t: '' } } },
      { cap: 'The packets cross the wire between the two machines.', set: { nicA: { cls: '' }, wire: { cls: 'pulse' }, data: { o: 1, ...at(BX.nicB) } } },
      { cap: 'B\'s network card hands them to B\'s kernel. TCP checks the numbers, <b>acknowledges</b> them, and queues the bytes in the socket\'s <b>receive buffer</b>. <b>gosock recv</b>, asleep in a read, wakes up.', set: { wire: { cls: '' }, nicB: { cls: 'hot' }, rcv: { cls: 'hot' }, data: { o: 1, ...at(BX.rcv) }, 'data-t': { t: 'bytes' }, progB: { cls: 'on' }, sysB: { t: 'read(socket)' } } },
      { cap: 'Receiving mirrors sending: <b>gosock recv</b> reads the bytes from the socket and writes them to the file. A write does not reach the disk yet: it lands in the file\'s <b>page cache</b> on B.', set: { nicB: { cls: '' }, rcv: { cls: '' }, cacheB: { cls: 'hot' }, data: { o: 1, ...at(BX.cacheB) }, sysB: { t: 'write(file)' }, noteB: { t: 'here the bytes pass through the program' } } },
      { cap: 'Done? Not quite: the bytes are in B\'s <b>RAM</b>, marked "dirty". The kernel writes them to the <b>disk</b> a little later, on its own schedule. Only an explicit <code>fsync</code> waits for it.', set: { cacheB: { cls: '' }, diskB: { cls: 'good' }, data: { o: 1, ...at(BX.diskB) }, 'data-t': { t: 'later…' }, progB: { cls: '' }, noteB: { t: 'the kernel writes to disk later' } } },
      { cap: 'That is the whole trip: eight boxes, two numbers in the program, and the kernel doing the work. By the end of the course you will be able to <b>prove</b> each step with a command.', set: { diskB: { cls: 'good' }, disk: { cls: 'on' }, cache: { cls: 'on' }, snd: { cls: 'on' }, nicA: { cls: 'on' }, nicB: { cls: 'on' }, rcv: { cls: 'on' }, cacheB: { cls: 'on' }, sysA: { t: '' }, sysB: { t: '' }, noteA: { t: '' }, noteB: { t: '' } } },
    ],
  };
}

// ═════════ 8. why nc never finished (lab 1.2) ═════════
{
  SCENES['eof'] = {
    title: 'How does the receiver know the file ended?', tag: 'nc and -N', w: 960, h: 360,
    svg: `${DEFS}
      ${B('a', 40, 60, 300, 170, { edge: 'a', title: 'machine A', sub: 'nc -N B 9000 < big.bin', sub2: '' })}
      ${B('b', 620, 60, 300, 170, { edge: 'b', title: 'machine B', sub: 'nc -l 9000 > in.bin', sub2: '' })}
      <path class="wire" d="M340 145 L620 145"/>
      <text data-id="stA" x="190" y="196" text-anchor="middle" font-size="12.5" class="mono t-mute"></text>
      <text data-id="stB" x="770" y="196" text-anchor="middle" font-size="12.5" class="mono t-mute"></text>
      ${P('bytes', 346, 100, 'bytes of the file', 'amber', 150)}
      ${P('fin', 346, 100, 'FIN: no more', 'red', 120)}
      <text data-id="verdict" x="480" y="300" text-anchor="middle" font-size="15" class="t-strong"></text>`,
    init: { bytes: { o: 0 }, fin: { o: 0 }, stA: { t: '' }, stB: { t: '' }, verdict: { t: '' }, 'a-t': { t: 'machine A (no -N)' }, 'a-s': { t: 'nc B 9000 < big.bin' } },
    steps: [
      { cap: 'A sends the file through the connection. Without <code>-N</code> this is plain <code>nc</code>: it copies its input to the connection.', set: { a: { cls: 'on' }, bytes: { o: 1, x: 0, y: 0 }, stA: { t: 'stdin: reading the file…' }, stB: { t: 'read() → bytes → in.bin' } } },
      { cap: 'Every byte arrives. B\'s file is <b>complete</b>: its hash would match.', set: { bytes: { o: 1, x: 400, y: 0 }, b: { cls: 'good' }, stB: { t: 'in.bin: complete ✓' } } },
      { cap: 'A\'s input reaches its end. Plain <code>nc</code> does <b>nothing</b> about it: the connection stays open, no signal is sent.', set: { a: { cls: 'hot' }, stA: { t: 'stdin ended; connection open' }, bytes: { o: 0 } } },
      { cap: 'B is stuck in <code>read()</code>. From B\'s point of view, "the sender is done" and "the sender is slow" look exactly the same. It waits forever. <b>TCP has no built-in notion of "end of file".</b>', set: { b: { cls: 'hot' }, stB: { t: 'read() … still waiting …' }, verdict: { t: 'nothing ever tells B the file is finished' } } },
      { cap: 'With <code>-N</code>, <code>nc</code> calls <code>shutdown(fd, SHUT_WR)</code> when its input ends: the kernel sends a <b>FIN</b>, which means "I will send no more".', set: { a: { cls: 'on' }, 'a-t': { t: 'machine A (with -N)' }, 'a-s': { t: 'nc -N B 9000 < big.bin' }, stA: { t: 'stdin ended → shutdown()' }, fin: { o: 1, x: 0, y: 0 }, verdict: { t: '' } } },
      { cap: 'B\'s <code>read()</code> returns <b>0</b>: end of stream. <code>nc</code> exits. This "read returns 0" is the end-of-file signal you will meet in every program of this course.', set: { fin: { o: 1, x: 400, y: 0 }, b: { cls: 'good' }, stB: { t: 'read() = 0  →  done' }, verdict: { t: 'the sender closed its side: that is the signal' } } },
    ],
  };
}

// ═════════ 9. file descriptors: following a number (lesson 1d) ═════════
{
  const S0 = (id, y, sub) => B(id, 30, y, 210, 40, { edge: 'user', sub, ssize: 13 });
  SCENES['fd-read'] = {
    title: 'What a file descriptor points to', tag: 'descriptors', w: 960, h: 490,
    svg: `${DEFS}
      ${label(30, 36, 'THE PROCESS: ITS FD TABLE', { w: 700, ls: '.1em', size: 11, cls: 't-mute' })}
      ${label(340, 36, 'THE KERNEL: OPEN FILE DESCRIPTIONS', { w: 700, ls: '.1em', size: 11, cls: 't-mute' })}
      ${label(690, 36, 'THE OBJECT ITSELF', { w: 700, ls: '.1em', size: 11, cls: 't-mute' })}
      ${S0('f0', 56, '0   standard input')}${S0('f1', 102, '1   standard output')}${S0('f2', 148, '2   standard error')}
      ${S0('f5', 194, '3   ← next free')}${S0('f6', 240, '4   ← then this')}
      ${B('ofdF', 340, 268, 270, 86, { edge: 'kernel', title: 'open file', sub: 'offset 0 · read-only', ssize: 12 })}
      ${B('ofdS', 340, 370, 270, 80, { edge: 'kernel', title: 'open socket', sub: 'TCP · connected', ssize: 12 })}
      ${B('objF', 690, 268, 240, 86, { edge: 'net', title: 'big.bin', sub: 'a file on disk', ssize: 12 })}
      ${B('objS', 690, 370, 240, 80, { edge: 'net', title: 'the connection', sub: 'buffers, ports', ssize: 12 })}
      ${L('aF', 240, 214, 340, 300)}${L('aF2', 610, 311, 690, 311)}${L('aS', 240, 260, 340, 400)}${L('aS2', 610, 410, 690, 410)}
      <text data-id="call" x="480" y="478" text-anchor="middle" font-size="13.5" class="mono t-strong"></text>`,
    init: { f5: { o: 0 }, f6: { o: 0 }, ofdF: { o: 0 }, ofdS: { o: 0 }, objF: { o: 0 }, objS: { o: 0 }, aF: { o: 0 }, aF2: { o: 0 }, aS: { o: 0 }, aS2: { o: 0 }, call: { t: '' } },
    steps: [
      { cap: 'Every process has a <b>table of numbers</b>. It starts with 0, 1 and 2: standard input, output and error, here the terminal. The next number the kernel hands out is always the <b>lowest free one</b>: here, 3.', set: { f0: { cls: 'on' }, f1: { cls: 'on' }, f2: { cls: 'on' }, f3: { cls: 'on' }, f4: { cls: 'on' }, f5: { o: 1, cls: 'hot' } } },
      { cap: '<code>openat("big.bin")</code> returns <b>3</b>. The kernel built an <b>open file description</b> (it remembers the offset and the mode) and put a pointer to it in slot 3. Slot 3 points to the file.', set: { f0: { cls: '' }, f1: { cls: '' }, f2: { cls: '' }, f3: { cls: '' }, f4: { cls: '' }, f5: { cls: 'on' }, ofdF: { o: 1, cls: 'hot' }, objF: { o: 1 }, aF: { o: 1 }, aF2: { o: 1 }, call: { t: 'openat("big.bin") = 3' } } },
      { cap: '<code>read(3, buf, 4096)</code>: the kernel looks up slot 3, follows the pointer, reads, and <b>moves the offset</b> in the open file description. The offset lives there: not in the number, not in the file.', set: { ofdF: { cls: 'good' }, 'ofdF-s': { t: 'offset 4096 · read-only' }, call: { t: 'read(3, buf, 4096) = 4096' } } },
      { cap: '<code>socket()</code> returns <b>4</b>, and <code>connect()</code> links it to the other machine. A socket is reached the same way as a file: a number, a pointer, an object.', set: { ofdF: { cls: '' }, f5: { cls: '' }, f6: { o: 1, cls: 'on' }, ofdS: { o: 1, cls: 'hot' }, objS: { o: 1 }, aS: { o: 1 }, aS2: { o: 1 }, call: { t: 'socket() = 4' } } },
      { cap: '<code>sendfile(4, 3, …)</code> passes <b>two numbers</b>: into 4, from 3. The kernel follows both pointers and copies from the file straight to the socket. The program never touches the data.', set: { f5: { cls: 'good' }, f6: { cls: 'good' }, ofdF: { cls: 'good' }, ofdS: { cls: 'good' }, call: { t: 'sendfile(4, 3, …)' } } },
      { cap: '<code>close(3)</code> frees slot 3. The next <code>open</code> will return 3 again. Forget to close and the slots run out: <code>EMFILE</code>, "too many open files".', set: { f5: { o: 0 }, ofdF: { o: 0 }, objF: { o: 0 }, aF: { o: 0 }, aF2: { o: 0 }, f6: { cls: 'on' }, ofdS: { cls: '' }, call: { t: 'close(3) = 0' } } },
    ],
  };
}

// ═════════ 10. reading strace (lesson 1c) ═════════
{
  const LN = [
    ['l0', 'openat(…, "a.txt", O_RDONLY) = 3'],
    ['l1', 'read(3, "hello\\n", 4096) = 6'],
    ['l2', 'write(1, "hello\\n", 6) = 6'],
    ['l3', 'read(3, "", 4096) = 0'],
    ['l4', 'openat(…, "nope", O_RDONLY) = -1 ENOENT'],
    ['l5', 'close(3) = 0'],
  ];
  SCENES['strace-trace'] = {
    title: 'What strace shows', tag: 'strace', w: 960, h: 400,
    svg: `${DEFS}
      ${B('prog', 30, 50, 240, 120, { edge: 'user', title: 'your program', sub: '', ssize: 13 })}
      ${B('kern', 30, 220, 240, 120, { edge: 'kernel', title: 'the kernel', sub: 'does the work', ssize: 12 })}
      ${L('up', 150, 170, 150, 220)}
      <rect class="box" x="330" y="40" width="600" height="330" rx="14"/>
      ${label(350, 66, '$ strace ./prog', { mono: true, size: 12, cls: 't-mute' })}
      ${LN.map(([id, t], i) => `<g class="m" data-id="${id}"><rect class="box fillbox" x="344" y="${82 + i * 46}" width="572" height="36" rx="8"/><text x="360" y="${105 + i * 46}" font-size="14" class="mono">${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></g>`).join('')}`,
    init: Object.fromEntries([['prog-s', { t: '' }], ...LN.map(([id]) => [id, { o: 0 }])]),
    steps: [
      { cap: 'Your program wants to read a file. Each time it asks the kernel for something, <b>strace</b> writes one line: the <b>name</b> of the call, its <b>arguments</b>, and after the <code>=</code> its <b>result</b>.', set: { prog: { cls: 'on' }, 'prog-s': { t: 'open("a.txt")' }, l0: { o: 1, cls: 'on' } } },
      { cap: 'The result of <code>openat</code> is the new <b>file descriptor</b>: <b>3</b>. Every later line about this file starts with <code>3</code>. Following that number is the main skill of reading a trace.', set: { l0: { cls: 'good' } } },
      { cap: '<code>read(3, …, 4096) = 6</code>: it offered a buffer of 4096 bytes and got <b>6</b>. The number after <code>=</code> is how many bytes really came back, and strace shows them in quotes.', set: { 'prog-s': { t: 'read(file)' }, l0: { cls: '' }, l1: { o: 1, cls: 'on' } } },
      { cap: '<code>write(1, …, 6)</code> sends those bytes to descriptor <b>1</b>, the terminal. Descriptors 0, 1, 2 are always input, output and error.', set: { 'prog-s': { t: 'write(1, …)' }, l1: { cls: '' }, l2: { o: 1, cls: 'on' } } },
      { cap: 'Read again: the result is <b>0</b>. Zero bytes means <b>end of file</b>. You will see this line in every trace of a program that copies something.', set: { 'prog-s': { t: 'read(file) again' }, l2: { cls: '' }, l3: { o: 1, cls: 'good' } } },
      { cap: 'A failing call shows <code>= -1</code> followed by an <b>error name</b>: here <code>ENOENT</code>, "no such file". Some errors are not failures: <code>EAGAIN</code> only means "not now".', set: { 'prog-s': { t: 'open("nope")' }, l3: { cls: '' }, l4: { o: 1, cls: 'bad' } } },
      { cap: 'And <code>close(3)</code> gives the number back. That is how to read any trace: one call per line, the result after the <code>=</code>, descriptors as the thread to follow.', set: { 'prog-s': { t: 'close(file)' }, l4: { cls: '' }, l5: { o: 1, cls: 'on' } } },
    ],
  };
}

// ═════════ 11. two ways to copy a file into a socket (lab 1.6) ═════════
{
  const Y1 = 60, Y2 = 290, H = 96, W = 150;
  const X = [30, 230, 430, 630, 800];
  const b1 = (id, i, t, s, e) => B(id, X[i], Y1, i === 4 ? 130 : W, H, { edge: e, title: t, tsize: 13, sub: s, ssize: 11 });
  const b2 = (id, i, t, s, e) => B(id, X[i], Y2, i === 4 ? 130 : W, H, { edge: e, title: t, tsize: 13, sub: s, ssize: 11 });
  const pb1 = [X[0] + 35, Y1 + 64], pb2 = [X[0] + 35, Y2 + 64];
  const m1 = i => mv(pb1, X[i] + 35, Y1 + 64), m2 = i => mv(pb2, X[i] + 35, Y2 + 64);
  SCENES['copy-paths'] = {
    title: 'Two ways to copy a file into a socket', tag: 'two paths', w: 960, h: 470,
    svg: `${DEFS}
      ${label(30, 36, 'A. A LOOP OF read + write  (what you might have written)', { w: 700, ls: '.04em', size: 12, cls: 't-strong' })}
      ${b1('d1', 0, 'disk', 'the file', 'net')}${b1('c1', 1, 'page cache', 'kernel · RAM', 'kernel')}${b1('u1', 2, 'your buffer', 'user space', 'user')}${b1('s1', 3, 'socket buffer', 'kernel', 'kernel')}${b1('n1', 4, 'network', '', 'net')}
      ${label(30, 266, 'B. sendfile  (what Go actually did)', { w: 700, ls: '.04em', size: 12, cls: 't-strong' })}
      ${b2('d2', 0, 'disk', 'the file', 'net')}${b2('c2', 1, 'page cache', 'kernel · RAM', 'kernel')}${b2('u2', 2, 'your buffer', 'not used', 'user')}${b2('s2', 3, 'socket buffer', 'kernel', 'kernel')}${b2('n2', 4, 'network', '', 'net')}
      ${P('p1', pb1[0], pb1[1], 'chunk', 'amber', 80)}${P('p2', pb2[0], pb2[1], 'chunk', 'amber', 80)}
      <text data-id="t1" x="480" y="186" text-anchor="middle" font-size="13.5" class="mono t-strong"></text>
      <text data-id="t2" x="480" y="416" text-anchor="middle" font-size="13.5" class="mono t-strong"></text>
      <text data-id="sum" x="480" y="455" text-anchor="middle" font-size="14" class="t-strong"></text>`,
    init: { p1: { o: 0 }, p2: { o: 0 }, t1: { t: '' }, t2: { t: '' }, sum: { t: '' }, u2: { o: .35 } },
    steps: [
      { cap: 'Two ways to send a file over TCP. <b>A</b> is the obvious one: read a chunk into your own buffer, then write it to the socket, again and again. <b>B</b> is what your <code>strace</code> showed: <code>sendfile</code>.', set: { d1: { cls: 'on' }, d2: { cls: 'on' }, p1: { o: 1, x: 0, y: 0 }, p2: { o: 1, x: 0, y: 0 } } },
      { cap: 'A, <code>read(file, buf)</code>: the kernel loads the chunk into the <b>page cache</b>, then <b>copies it into your buffer</b>. That is copy number one.', set: { d1: { cls: '' }, c1: { cls: 'hot' }, u1: { cls: 'hot' }, p1: { o: 1, ...m1(2) }, t1: { t: 'read(file, buf): copy 1' } } },
      { cap: 'A, <code>write(sock, buf)</code>: <b>copy number two</b>, from your buffer into the socket buffer. Two syscalls and two copies for every chunk.', set: { c1: { cls: '' }, u1: { cls: '' }, s1: { cls: 'hot' }, p1: { o: 1, ...m1(3) }, t1: { t: 'write(sock, buf): copy 2' } } },
      { cap: 'B, <code>sendfile(sock, file)</code>: the kernel moves the chunk from the page cache straight into the socket buffer. <b>One syscall, one copy</b>, and your program\'s buffer is not involved.', set: { s1: { cls: '' }, d2: { cls: '' }, c2: { cls: 'hot' }, s2: { cls: 'hot' }, p2: { o: 1, ...m2(3) }, t2: { t: 'sendfile(sock, file): one copy' } } },
      { cap: 'Both end the same way: the chunk reaches the network. B did less work for the same result.', set: { c2: { cls: '' }, s2: { cls: '' }, p1: { o: 1, ...m1(4) }, p2: { o: 1, ...m2(4) }, sum: { t: 'A: 2 syscalls + 2 copies per chunk   ·   B: 1 syscall + 1 copy' } } },
    ],
  };
}

// ═════════ 12. Go and the kernel: layers (module 2) ═════════
{
  SCENES['go-layers'] = {
    title: 'From your Go code to the kernel', tag: 'module 2', w: 960, h: 470,
    svg: `${DEFS}
      <rect class="zone-user" x="20" y="14" width="920" height="300" rx="20" stroke-width="1.3"/>
      ${label(40, 40, 'USER SPACE · your program', { w: 700, ls: '.12em', size: 12, cls: 't-mute' })}
      <rect class="zone-kernel" x="20" y="344" width="920" height="112" rx="20" stroke-width="1.3"/>
      ${label(40, 370, 'KERNEL', { w: 700, ls: '.12em', size: 12, cls: 't-mute' })}
      ${label(190, 66, 'the usual way', { size: 12, cls: 't-strong', anchor: 'middle' })}
      ${label(740, 66, 'the raw way (this module)', { size: 12, cls: 't-strong', anchor: 'middle' })}
      ${B('c1', 60, 80, 260, 50, { edge: 'user', sub: 'fmt.Println("hi")', ssize: 14 })}
      ${B('c2', 60, 142, 260, 50, { edge: 'user', sub: 'formats, adds "\\n"', ssize: 13 })}
      ${B('c3', 60, 204, 260, 50, { edge: 'user', sub: 'os.Stdout.Write(…)', ssize: 13 })}
      ${B('c4', 60, 266, 260, 40, { edge: 'user', sub: 'syscall: write', ssize: 13 })}
      ${B('r1', 610, 80, 260, 50, { edge: 'a', sub: 'syscall.Write(1, []byte("hi\\n"))', ssize: 13 })}
      ${B('r4', 610, 266, 260, 40, { edge: 'a', sub: 'syscall: write', ssize: 13 })}
      ${L('d1', 190, 130, 190, 142)}${L('d2', 190, 192, 190, 204)}${L('d3', 190, 254, 190, 266)}
      ${L('e1', 740, 130, 740, 266)}
      ${L('k1', 190, 306, 190, 392)}${L('k2', 740, 306, 740, 392)}
      <g class="m" data-id="kbox"><rect class="box fillbox kernel" x="60" y="380" width="810" height="60" rx="12"/>
        <text data-id="kline" x="465" y="416" text-anchor="middle" font-size="15" class="mono t-strong"></text></g>`,
    init: { c1: { o: 0 }, c2: { o: 0 }, c3: { o: 0 }, c4: { o: 0 }, r1: { o: 0 }, r4: { o: 0 }, d1: { o: 0 }, d2: { o: 0 }, d3: { o: 0 }, e1: { o: 0 }, k1: { o: 0 }, k2: { o: 0 }, kbox: { o: 0 }, kline: { t: '' } },
    steps: [
      { cap: 'You have been writing <code>fmt.Println("hi")</code> since your first Go program. Between that line and the kernel there are <b>layers</b>.', set: { c1: { o: 1, cls: 'on' } } },
      { cap: '<code>fmt</code> formats the text and adds the newline, in memory. No kernel yet.', set: { c1: { cls: '' }, c2: { o: 1, cls: 'on' }, d1: { o: 1 } } },
      { cap: '<code>os.Stdout</code> is a <b>file</b> for Go: writing to it calls the file\'s <code>Write</code> method.', set: { c2: { cls: '' }, c3: { o: 1, cls: 'on' }, d2: { o: 1 } } },
      { cap: 'Finally Go makes the actual <b>system call</b>, <code>write</code>. Only here does the program cross into the kernel.', set: { c3: { cls: '' }, c4: { o: 1, cls: 'hot' }, d3: { o: 1 }, k1: { o: 1 }, kbox: { o: 1, cls: 'hot' }, kline: { t: 'write(1, "hi\\n", 3) = 3' } } },
      { cap: 'Go\'s <code>syscall</code> package lets you <b>skip the layers</b>: <code>syscall.Write</code> is the system call itself. You pick the descriptor, you pass the bytes.', set: { c4: { cls: '' }, r1: { o: 1, cls: 'on' }, e1: { o: 1 }, r4: { o: 1, cls: 'hot' }, k2: { o: 1 } } },
      { cap: 'The kernel sees <b>exactly the same call</b>. Both ways end in one <code>write</code>. In this module you use the raw way, so that nothing is hidden: you decide how big each read is, what happens on an error, and what to do when a write is not complete.', set: { kbox: { cls: 'good' }, r1: { cls: '' }, r4: { cls: '' } } },
    ],
  };
}

// ═════════ 13. an error travelling up (module 2) ═════════
{
  const X = [30, 270, 510, 750], W = 180, Y = 170, H = 110;
  const bx = (id, i, t, s, e, s2) => B(id, X[i], Y, W, H, { edge: e, title: t, tsize: 13, sub: s, ssize: 12, sub2: s2 });
  const base = [X[0] + 40, Y + 80];
  const at = i => mv(base, X[i] + 40, Y + 80);
  SCENES['errno-path'] = {
    title: 'How a failure reaches your code', tag: 'module 2', w: 960, h: 360,
    svg: `${DEFS}
      ${label(30, 40, 'syscall.Open("/nope", O_RDONLY, 0)', { mono: true, size: 14, cls: 't-strong' })}
      ${bx('k', 0, 'the kernel', 'no such file', 'kernel', 'returns −2')}
      ${bx('w', 1, 'the wrapper', 'sees a negative', 'user', 'result')}
      ${bx('g', 2, 'your Go code', 'gets two values', 'a', '(fd, err)')}
      ${bx('i', 3, 'your if', 'err != nil', 'a', '')}
      ${L('a1', 210, 225, 270, 225)}${L('a2', 450, 225, 510, 225)}${L('a3', 690, 225, 750, 225)}
      ${P('r', base[0], base[1], '−2', 'red', 100)}
      <text data-id="note" x="480" y="330" text-anchor="middle" font-size="14" class="mono t-strong"></text>`,
    init: { r: { o: 0 }, a1: { o: 0 }, a2: { o: 0 }, a3: { o: 0 }, note: { t: '' } },
    steps: [
      { cap: 'Your program asks to open a file that does not exist. The <b>kernel</b> looks for it, and cannot find it.', set: { k: { cls: 'hot' } } },
      { cap: 'The kernel answers with a <b>negative number</b>: minus the error code. <code>−2</code> means <code>ENOENT</code>, "no such file or directory". (Raw syscalls return one number: failure is a negative one.)', set: { r: { o: 1, x: 0, y: 0 }, note: { t: 'return value −2  =  ENOENT' } } },
      { cap: 'Go\'s <code>syscall</code> package turns that into what Go likes: the result <code>−1</code> and an <b>error value</b>, <code>syscall.Errno(2)</code>.', set: { k: { cls: '' }, w: { cls: 'hot' }, a1: { o: 1 }, r: { o: 1, ...at(1) }, 'r-t': { t: 'Errno 2' }, note: { t: 'err = unix.Errno(2)' } } },
      { cap: 'You receive <code>fd, err</code>. <b>fd is not usable</b> when err is not nil, so always look at <code>err</code> first.', set: { w: { cls: '' }, g: { cls: 'hot' }, a2: { o: 1 }, r: { o: 1, ...at(2) }, 'r-t': { t: 'err' } } },
      { cap: '<code>if err != nil</code> is true. <code>err.Error()</code> gives the text, <code>"no such file or directory"</code>, and comparing with <code>syscall.ENOENT</code> lets you react to <b>this</b> failure and no other.', set: { g: { cls: '' }, i: { cls: 'bad' }, a3: { o: 1 }, r: { o: 1, ...at(3) }, 'r-t': { t: 'ENOENT' }, note: { t: 'err == unix.ENOENT  →  "no such file or directory"' } } },
    ],
  };
}

// ═════════ 14. a write can be partial (module 2) ═════════
{
  const CX = i => 100 + i * 52, CY = 70, KY = 250;
  const cells = Array.from({ length: 10 }, (_, i) => `<g class="m" data-id="c${i}"><rect x="${CX(i)}" y="${CY}" width="44" height="36" rx="7" fill="var(--accent)"/><text x="${CX(i) + 22}" y="${CY + 23}" text-anchor="middle" font-size="13" class="mono" style="fill:#04121c;font-weight:700">${i}</text></g>`).join('');
  const slots = Array.from({ length: 6 }, (_, i) => `<rect class="box" x="${CX(i)}" y="${KY}" width="44" height="36" rx="7" style="stroke-dasharray:4 4"/>`).join('');
  SCENES['partial-write'] = {
    title: 'A write can be partial', tag: 'module 2', w: 960, h: 420,
    svg: `${DEFS}
      ${label(40, 44, 'your buffer: 10 bytes to send', { size: 12, cls: 't-mute' })}
      ${label(40, 222, 'the socket\'s send buffer: room for 6 more bytes', { size: 12, cls: 't-mute' })}
      ${slots}
      ${cells}
      <text data-id="call" x="640" y="130" font-size="15" class="mono t-strong"></text>
      <text data-id="ret" x="640" y="160" font-size="15" class="mono t-strong"></text>
      <text data-id="note" x="480" y="350" text-anchor="middle" font-size="14" class="t-strong"></text>
      <text data-id="code" x="480" y="392" text-anchor="middle" font-size="13" class="mono t-mute"></text>`,
    init: { call: { t: '' }, ret: { t: '' }, note: { t: '' }, code: { t: '' } },
    steps: [
      { cap: 'You want to send 10 bytes. The socket\'s send buffer has room for <b>only 6</b>, because the other side is slow and the buffer is nearly full.', set: { call: { t: 'write(fd, buf, 10)' } } },
      { cap: 'The kernel does <b>not</b> wait and does not fail: it accepts what fits, the first <b>6</b> bytes, and returns <b>6</b>.', set: { c0: { y: KY - CY }, c1: { y: KY - CY }, c2: { y: KY - CY }, c3: { y: KY - CY }, c4: { y: KY - CY }, c5: { y: KY - CY }, ret: { t: '= 6   (not 10!)' }, note: { t: 'a short write: 4 bytes are still yours to send' } } },
      { cap: 'If your code assumed "no error means everything was written", <b>4 bytes are silently lost</b>. This is one of the most common bugs in network code.', set: { c6: { cls: '' }, note: { t: 'no error was reported. The bytes are simply not sent.' } } },
      { cap: 'The network drains the buffer. There is room again.', set: { c0: { o: 0 }, c1: { o: 0 }, c2: { o: 0 }, c3: { o: 0 }, c4: { o: 0 }, c5: { o: 0 }, note: { t: '' }, call: { t: '' }, ret: { t: '' } } },
      { cap: 'The fix is a <b>loop</b>: keep calling write with what is left, <code>buf[6:]</code>, until nothing is left.', set: { call: { t: 'write(fd, buf[6:], 4)' }, c6: { x: -312, y: KY - CY }, c7: { x: -312, y: KY - CY }, c8: { x: -312, y: KY - CY }, c9: { x: -312, y: KY - CY }, ret: { t: '= 4' }, code: { t: 'for len(p) > 0 { n, err := unix.Write(fd, p); …; p = p[n:] }' } } },
      { cap: 'This <code>writeAll</code> loop belongs in every program that writes to a socket, a pipe or a file.', set: { note: { t: 'every byte is sent, whatever the kernel accepts each time' } } },
    ],
  };
}

// ═════════ 15. mmap and page faults (module 3) ═════════
{
  const Y = [90, 200];
  const pg = (pre, x, w, t, e) => Y.map((y, i) => B(`${pre}${i}`, x, y, w, 80, { edge: e, title: `${t} ${i}`, tsize: 13, sub: '', ssize: 11 })).join('');
  SCENES['mmap-fault'] = {
    title: 'A file as memory: mmap', tag: 'module 3', w: 960, h: 420,
    svg: `${DEFS}
      ${label(40, 40, 'YOUR PROCESS: MEMORY', { w: 700, ls: '.1em', size: 11, cls: 't-mute' })}
      ${label(390, 40, 'KERNEL: PAGE CACHE', { w: 700, ls: '.1em', size: 11, cls: 't-mute' })}
      ${label(740, 40, 'DISK', { w: 700, ls: '.1em', size: 11, cls: 't-mute' })}
      ${pg('m', 40, 230, 'memory page', 'user')}${pg('p', 390, 230, 'cached page', 'kernel')}${pg('d', 740, 180, 'file block', 'net')}
      ${L('a0', 270, 130, 390, 130)}${L('a1', 270, 240, 390, 240)}${L('b0', 620, 130, 740, 130)}${L('b1', 620, 240, 740, 240)}
      <text data-id="call" x="480" y="330" text-anchor="middle" font-size="15" class="mono t-strong"></text>
      <text data-id="cnt" x="480" y="372" text-anchor="middle" font-size="13" class="mono t-mute"></text>`,
    init: { p0: { o: .25 }, p1: { o: .25 }, a0: { o: 0 }, a1: { o: 0 }, b0: { o: 0 }, b1: { o: 0 }, m0: { o: .55 }, m1: { o: .55 }, call: { t: '' }, cnt: { t: '' } },
    steps: [
      { cap: 'The file is on disk. Your process has its own <b>memory</b>, made of pages. Nothing is connected yet.', set: { d0: { cls: 'on' }, d1: { cls: 'on' } } },
      { cap: '<code>mmap(file)</code> is a promise, not a copy: "when I touch these addresses, show me the file". It returns an address at once. <b>No data has been read.</b>', set: { call: { t: 'addr = mmap(file, size)' }, cnt: { t: 'syscalls: 1   page faults: 0' }, m0: { o: 1, cls: 'on' }, m1: { o: 1, cls: 'on' } } },
      { cap: 'Your code reads the <b>first byte</b>. That page is not backed by anything yet: the CPU raises a <b>page fault</b> and the kernel takes over.', set: { call: { t: 'x := data[0]      → page fault' }, m0: { cls: 'hot' }, cnt: { t: 'syscalls: 1   page faults: 1' } } },
      { cap: 'The kernel loads the block from <b>disk</b> into the <b>page cache</b> (if it is not already there) ...', set: { b0: { o: 1 }, p0: { o: 1, cls: 'hot' }, d0: { cls: 'hot' } } },
      { cap: '... and <b>maps that very page</b> into your memory. No copy: your address and the page cache page are the same RAM. The faulting instruction runs again and succeeds.', set: { a0: { o: 1 }, m0: { cls: 'good' }, p0: { cls: 'good' }, d0: { cls: '' }, b0: { o: 0 }, call: { t: 'x := data[0]      → 0x68, from RAM' } } },
      { cap: 'Reading the <b>same page again</b> is plain memory access: <b>no syscall, no fault</b>. A <code>read()</code> would have cost a syscall and a copy every time.', set: { call: { t: 'y := data[1]      → no syscall' }, cnt: { t: 'syscalls: 1   page faults: 1   (reads: 5000)' } } },
      { cap: 'Touching page 1 faults once more, and so on. <b>mmap trades syscalls for page faults</b>, and avoids the copy to a user buffer. Whether that wins depends on how you read: you will see it in a lab.', set: { m1: { cls: 'hot' }, p1: { o: 1, cls: 'good' }, a1: { o: 1 }, b1: { o: 1 }, d1: { cls: 'hot' }, cnt: { t: 'syscalls: 1   page faults: 2' } } },
    ],
  };
}

// ═════════ 16. how many calls (lab 2.4) ═════════
{
  const blocks = Array.from({ length: 31 }, (_, i) => `<g class="m" data-id="b${i}"><rect x="${40 + i * 28}" y="76" width="22" height="40" rx="4" fill="var(--kernel)"/></g>`).join('');
  const reveal = (from, to) => Object.fromEntries(Array.from({ length: to - from }, (_, k) => ['b' + (from + k), { o: 1 }]));
  SCENES['call-count'] = {
    title: 'The same file, very different work', tag: 'lab 2.4', w: 960, h: 320,
    svg: `${DEFS}
      ${label(40, 50, 'your mycat: a loop of read + write (one block = 100 syscalls)', { size: 13, cls: 't-strong' })}
      ${blocks}
      <text data-id="n1" x="40" y="148" font-size="22" class="mono t-strong"></text>
      ${label(40, 214, 'cat, when the output is a file: copy_file_range', { size: 13, cls: 't-strong' })}
      <g class="m" data-id="thin"><rect x="40" y="236" width="3" height="40" rx="1" fill="var(--net)"/></g>
      <text data-id="n2" x="62" y="266" font-size="22" class="mono t-strong"></text>`,
    init: { ...Object.fromEntries(Array.from({ length: 31 }, (_, i) => ['b' + i, { o: 0 }])), thin: { o: 0 }, n1: { t: '' }, n2: { t: '' } },
    steps: [
      { cap: 'Same job, same 50 MB file, same result. Two programs: the loop you wrote, and the standard <code>cat</code>. Count the system calls each one makes.', set: {} },
      { cap: 'Your loop reads 32 KiB, writes 32 KiB, and repeats. Each round is <b>two syscalls</b>.', set: { ...reveal(0, 10), n1: { t: '1 000 calls …' } } },
      { cap: '50 MB is about 1 500 chunks, so it keeps going …', set: { ...reveal(10, 22), n1: { t: '2 200 calls …' } } },
      { cap: '… and ends at about <b>3 000 syscalls</b>: roughly 1 530 reads and 1 530 writes.', set: { ...reveal(22, 31), n1: { t: '3 058 calls' } } },
      { cap: '<code>cat</code> noticed that both ends are <b>files</b>. It asks the kernel to copy from one to the other with <code>copy_file_range</code>, and the kernel moves the whole file by itself: <b>2 calls</b>.', set: { thin: { o: 1 }, n2: { t: '2 calls' } } },
      { cap: 'The lesson of module 1 again: when the kernel knows both ends, it can do the copy without your program in the middle. The file is identical either way. What changes is how often you cross into the kernel.', set: {} },
    ],
  };
}

// ───────── player ─────────
// <g-anim scene="name">: the player. It starts folded or open as the student last chose (one choice
// for every animation), can fill the whole window, and stops at its last step.
const OPEN_KEY = 'gosock-web:anim-open';
const openPref = () => { try { return localStorage.getItem(OPEN_KEY) === '1'; } catch (e) { return false; } };
customElements.define('g-anim', class extends HTMLElement {
  connectedCallback() {
    if (this.dataset.ready) return; this.dataset.ready = 1;
    const def = SCENES[this.getAttribute('scene')];
    if (!def) { this.textContent = 'Unknown scene'; return; }
    const N = def.steps.length;
    this.innerHTML = `
      <div class="an-h"><button class="an-fold" data-a="fold" aria-expanded="false">${ICON.chev}<span class="ttl">${esc(this.getAttribute('title') || def.title)}</span><span class="an-n">animation · ${N} steps</span></button>
        <button class="an-icon" data-a="full" title="Full window (Esc to leave)" aria-label="Full window">${ICON.expand}</button></div>
      <div class="an-body">
      <div class="an-stage"><svg class="sc noanim" viewBox="0 0 ${def.w} ${def.h}" role="img" aria-label="${esc(def.title)}">${def.svg}</svg></div>
      <div class="an-cap"><span class="no"></span><span class="tx"></span></div>
      <div class="an-ctl">
        <button data-a="prev" aria-label="Previous step">${ICON.prev}</button>
        <button class="play" data-a="play">${ICON.play}<span>Play</span></button>
        <button data-a="next" aria-label="Next step">${ICON.next}</button>
        <button data-a="replay" aria-label="Restart">${ICON.replay}</button>
        <div class="an-dots"></div>
      </div></div>`;
    const svg = this.querySelector('svg'), cap = this.querySelector('.tx'), no = this.querySelector('.no'), dots = this.querySelector('.an-dots');
    const playBtn = this.querySelector('.play'), prevBtn = this.querySelector('[data-a="prev"]'), nextBtn = this.querySelector('[data-a="next"]');
    let cur = -1, timer = null;
    svg.querySelectorAll('[data-id]').forEach(el => { el.dataset.base = el.getAttribute('class') || ''; });
    dots.innerHTML = def.steps.map((_, i) => `<i data-i="${i}" title="Step ${i + 1}"></i>`).join('');
    const state = n => {
      const s = {};
      for (const [id, v] of Object.entries(def.init || {})) s[id] = { ...v };
      for (let i = 0; i <= n; i++) for (const [id, v] of Object.entries(def.steps[i].set || {})) s[id] = { ...(s[id] || {}), ...v };
      return s;
    };
    const apply = n => {
      for (const [id, v] of Object.entries(state(n))) {
        svg.querySelectorAll(`[data-id="${CSS.escape(id)}"]`).forEach(el => {
          if ('x' in v || 'y' in v) el.style.transform = `translate(${v.x || 0}px, ${v.y || 0}px)`;
          if ('o' in v) el.style.opacity = v.o;
          if ('t' in v) el.textContent = v.t;
          if ('cls' in v) el.setAttribute('class', (el.dataset.base + ' ' + v.cls).trim());
        });
      }
    };
    const show = (n, animate = true) => {
      n = Math.max(0, Math.min(N - 1, n));
      if (n === cur) return;                       // already there: nothing moves, the caption is not replayed
      cur = n;
      if (!animate) svg.classList.add('noanim');
      apply(cur);
      if (!animate) requestAnimationFrame(() => requestAnimationFrame(() => svg.classList.remove('noanim')));
      else svg.classList.remove('noanim');
      cap.innerHTML = def.steps[cur].cap; cap.style.animation = 'none'; void cap.offsetWidth; cap.style.animation = '';
      no.textContent = `${cur + 1}/${N}`;
      prevBtn.disabled = cur === 0; nextBtn.disabled = cur === N - 1;
      dots.querySelectorAll('i').forEach((d, i) => d.className = i < cur ? 'past' : i === cur ? 'now' : '');
    };
    const stop = () => { clearInterval(timer); timer = null; playBtn.innerHTML = ICON.play + '<span>Play</span>'; };
    const play = () => {
      if (cur >= N - 1) show(0, false);
      playBtn.innerHTML = ICON.pause + '<span>Pause</span>';
      const tick = () => { if (cur >= N - 1) { stop(); return; } show(cur + 1); if (cur >= N - 1) stop(); };
      setTimeout(tick, 350);
      timer = setInterval(tick, 4200);
    };
    const fold = (open) => { this.classList.toggle('open', open); this.querySelector('.an-fold').setAttribute('aria-expanded', open); if (!open) { stop(); full(false); } };
    const full = (on) => {
      this.classList.toggle('full', on); document.body.classList.toggle('an-full-on', on);
      this.querySelector('[data-a="full"]').innerHTML = on ? ICON.shrink : ICON.expand;
      if (on) fold(true);
    };
    this.addEventListener('click', e => {
      const b = e.target.closest('button'), d = e.target.closest('i[data-i]');
      if (d) { stop(); show(+d.dataset.i); return; }
      if (!b) return;
      const a = b.dataset.a;
      if (a === 'fold') {
        const open = !this.classList.contains('open');
        try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch (err) { /* only this page */ }
        document.querySelectorAll('g-anim').forEach((g) => g.setOpen?.(open));
      } else if (a === 'full') full(!this.classList.contains('full'));
      else if (a === 'play') timer ? stop() : play();
      else if (a === 'next') { stop(); show(cur + 1); }
      else if (a === 'prev') { stop(); show(cur - 1); }
      else if (a === 'replay') { stop(); cur = -1; show(0, false); play(); }
    });
    this.addEventListener('keydown', e => { if (e.key === 'Escape' && this.classList.contains('full')) full(false); });
    this.setOpen = fold;
    this.disconnectedCallback = () => { stop(); if (this.classList.contains('full')) document.body.classList.remove('an-full-on'); };
    def.steps.forEach((s, i) => { if (!s.cap && i) s.cap = def.steps[i - 1].cap; });
    show(0, false); fold(openPref());
  }
});
