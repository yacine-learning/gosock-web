// Page side of the Go toolchain worker.
let worker = null, nextId = 1; const waiting = new Map(); let onProgress = () => {};
function w() {
  if (!worker) {
    worker = new Worker(new URL('./toolchain-worker.js', import.meta.url));
    worker.onmessage = (e) => { const d = e.data; if (d.t === 'progress') onProgress(d.what); else if (d.t === 'done') { waiting.get(d.id)(d); waiting.delete(d.id); } };
  }
  return worker;
}
const ask = (msg) => new Promise((res) => { const id = nextId++; waiting.set(id, res); w().postMessage({ ...msg, id }); });
let loadedFlag = false;
export const toolchain = {
  progress(fn) { onProgress = fn; },
  load: () => ask({ t: 'load' }).then((r) => { loadedFlag = true; return r; }),
  // sources: { 'main.go': '...' }  ->  { ok, module, ms } | { ok: false, errors }
  build: (sources) => ask({ t: 'build', sources }),
  // compile only, reporting every error: for the editor's live diagnostics
  check: (sources) => ask({ t: 'check', sources }),
  format: (source) => ask({ t: 'format', source }),
  get loaded() { return loadedFlag; },
};
