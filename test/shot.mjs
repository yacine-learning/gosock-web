// node test/shot.mjs '#/p/start' out.png [width height]  : screenshot of the app (EVAL=js to run first, WAIT=ms after it)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const [hash, out, w = 1500, h = 900] = process.argv.slice(2);
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text())); page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:8765/index.html' + hash); await page.waitForFunction('window.gosock'); await page.waitForTimeout(600);
if (process.env.EVAL) { await page.evaluate(process.env.EVAL); await page.waitForTimeout(+(process.env.WAIT || 800)); }
await page.screenshot({ path: out }); await browser.close();
