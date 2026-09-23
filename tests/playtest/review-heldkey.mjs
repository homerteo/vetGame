// Tecla mantenida cuyo keyup cae en un estado bloqueado (manos fuera por leer mensaje).
// Uso: PORT=5325 node tests/playtest/review-heldkey.mjs [case=1]
import { chromium } from '@playwright/test';
const BASE = `http://127.0.0.1:${process.env.PORT ?? '5325'}`;
const CASE = process.argv[2] ?? '1';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(`${BASE}/?case=${CASE}&skip=clinic&seed=7`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => window.__game?.mode === 'surgery', null, { timeout: 90000 });
const E = (f, a) => page.evaluate(f, a);
await E(() => window.__game.advance(3));
for (let i = 0; i < 30; i++) {
  const st = await E(() => window.__game.surgery().state().stepType);
  if (st === 'reduction') break;
  await E(() => { window.__game.surgery().forceCompleteStep(); window.__game.advance(2); });
}
const info = () => E(() => {
  const d = window.__game.surgery();
  const p = d.stepParams();
  const id = p.fragmentIds[0];
  return { step: d.state().stepType, t: +d.state().t.toFixed(2), angle: +d.ctx().bone.fragment(id).pose.angleDeg.toFixed(2) };
});
console.log('start', JSON.stringify(await info()));
await page.keyboard.down('KeyQ');
await E(() => window.__game.advance(0.3));
console.log('Q held 0.3s', JSON.stringify(await info()));
await E(() => window.__game.surgery().ctx().emiliana.offerMessage());
await page.keyboard.press('KeyF');
await page.keyboard.up('KeyQ'); // soltada durante las manos fuera (2 s)
const a = await info();
await E(() => window.__game.advance(3));
const b = await info();
await E(() => window.__game.advance(3));
const c = await info();
console.log('Q released during hands-off:', JSON.stringify(a), '-> +3s', JSON.stringify(b), '-> +6s', JSON.stringify(c));
await browser.close();
