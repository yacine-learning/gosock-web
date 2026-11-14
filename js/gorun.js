// Page side of a Go process: starts the worker and answers its system calls from the kernel.
import { Errno, KILLED, bytes } from './kernel.js';

const WORKER = new URL('./proc-worker.js', import.meta.url);
export function goProgram(module) {
  return (ctx) => new Promise((resolve) => {
    const w = new Worker(WORKER);
    ctx.p.hooks.push(() => w.terminate());
    w.onmessage = async (e) => {
      const d = e.data;
      if (d.t === 'sys') {
        try { w.postMessage({ t: 'ret', id: d.id, ret: await ctx.sys(d.name, ...d.args) }); }
        catch (err) {
          if (err instanceof Errno) w.postMessage({ t: 'ret', id: d.id, err: err.code });
          else if (err !== KILLED) console.error(err);
        }
      } else if (d.t === 'exit') resolve(d.code);
      else if (d.t === 'crash') { ctx.m.sys(ctx.p, 'write', 2, bytes('program crashed: ' + d.msg + '\n')).catch(() => {}).then(() => resolve(2)); }
    };
    const env = {}; for (const [k, v] of Object.entries(ctx.env)) if (k !== '?') env[k] = v;
    w.postMessage({ t: 'start', module, argv: ctx.argv, env, cwd: ctx.p.cwd, pid: ctx.p.pid, ppid: ctx.p.ppid });
  });
}
