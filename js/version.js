// The version of the site. Bump it with every change that is pushed to main (newest first):
// the top bar shows it, so you can tell whether the latest deployment has reached the browser.
export const CHANGELOG = [
  { v: '1.1.0', date: '2026-11-23', notes: ['The version is shown in the top bar, with this list of changes.'] },
  { v: '1.0.2', date: '2026-11-23', notes: ['Animations: the caption box is as tall as the longest caption, so the page no longer shifts between steps.'] },
  { v: '1.0.1', date: '2026-11-23', notes: ['Animations really move again: arrows and boxes change with each step (since the fold button was added they never had).', 'Arrows are blue, bolder, and flow in the direction of the data.'] },
  { v: '1.0.0', date: '2026-11-15', notes: ['Modules 1 to 4, the editor with completion, hover docs and live errors, the simulated machines.'] },
];
export const VERSION = CHANGELOG[0].v;
