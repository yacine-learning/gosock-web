// Shared state: what is saved in the browser, and hooks the page components call into.
const KEY = 'gosock-web:v1';
const blank = { done: {}, code: {}, labs: {}, predict: {}, quiz: {}, notes: [], last: '', project: 'gosock' };
function load() { try { return { ...blank, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (e) { return { ...blank }; } }
export const S = {
  store: load(),
  save() { try { localStorage.setItem(KEY, JSON.stringify(S.store)); } catch (e) { /* private mode: nothing is kept */ } },
  index: null, glossary: [], sim: null,
  // set by app.js
  run: null, openCode: null, runChecks: null, toast: null, markDone: null,
};
