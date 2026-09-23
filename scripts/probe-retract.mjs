// Sonda: en el paso del separador (caso 1), mueve el ratón a la punta 'a' y hace clic.
import { chromium } from '@playwright/test';
const port = process.argv[2] ?? '5391';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/?case=1&skip=clinic&seed=7`, { timeout: 300000 });
await page.waitForFunction(() => window.__game?.mode === 'surgery', null, { timeout: 300000 });
await page.evaluate(() => {
  window.__game.advance(3.5);
  const d = window.__game.surgery();
  d.forceCompleteStep(); window.__game.advance(2.5);
  d.forceCompleteStep(); window.__game.advance(2.5);
  window.__log = [];
  const a = d.ctx().audio; const orig = a.play.bind(a);
  a.play = (n, p) => { window.__log.push(n); return orig(n, p); };
});
const info = await page.evaluate(() => {
  const d = window.__game.surgery();
  const p = d.stepParams();
  return { step: d.state().step, sa: d.project(p.pairs[0].a), sb: d.project(p.pairs[0].b) };
});
console.log(JSON.stringify(info));
await page.mouse.move(info.sa.x, info.sa.y, { steps: 4 });
await page.evaluate(() => window.__game.advance(0.2));
await page.waitForTimeout(1500);
await page.screenshot({ path: 'screenshots/e2e/retract-hover.png', timeout: 300000 });
await page.mouse.down(); await page.evaluate(() => window.__game.advance(0.1)); await page.mouse.up();
await page.evaluate(() => window.__game.advance(0.3));
console.log('a log:', JSON.stringify(await page.evaluate(() => window.__log.splice(0))));
await browser.close();
