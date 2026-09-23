// Identifica framebuffers/texturas WebGL que sobreviven al cambiar de cirugía.
// Uso: PORT=5325 node tests/playtest/review-leak-fb.mjs
import { chromium } from '@playwright/test';
const BASE = `http://127.0.0.1:${process.env.PORT ?? '5325'}`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.addInitScript(() => {
  const live = (window.__live = new Map());
  let gen = 0;
  window.__gen = (g) => (gen = g);
  for (const P of [WebGL2RenderingContext.prototype]) {
    for (const [c, d] of [['createFramebuffer', 'deleteFramebuffer'], ['createTexture', 'deleteTexture']]) {
      const oc = P[c], od = P[d];
      P[c] = function (...a) { const o = oc.apply(this, a); live.set(o, { kind: c, gen, stack: new Error().stack.split('\n').slice(2, 9).map((s) => s.trim().replace(/https?:\/\/[^/]+\//, '')).join(' < ') }); return o; };
      P[d] = function (x) { live.delete(x); return od.call(this, x); };
    }
  }
});
await page.goto(`${BASE}/?case=1&skip=clinic&seed=7`, { waitUntil: 'domcontentloaded', timeout: 240000 });
await page.waitForFunction(() => !!window.__game, null, { timeout: 240000, polling: 500 });
await page.evaluate(() => window.__game.advance(0.05));
console.log('mode', await page.evaluate(() => window.__game.mode));
await page.evaluate(() => window.__game.advance(0.2));
await page.waitForTimeout(9000);
await page.evaluate(() => { window.__gen(1); window.__game.startCase(1, true); });
await page.waitForTimeout(9000);
await page.evaluate(() => { window.__gen(2); window.__game.startCase(1, true); });
await page.waitForTimeout(9000);
const r = await page.evaluate(() => [...window.__live.values()].filter((v) => v.gen === 1).map((v) => `${v.kind}: ${v.stack}`));
console.log('created during surgery #1 and still alive after surgery #2 started:\n' + r.join('\n'));
await browser.close();
