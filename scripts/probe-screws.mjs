// Sonda: caso 1, paso de tornillos; taladra el primer agujero con el ratón y captura lo que sigue.
import { chromium } from '@playwright/test';
const port = process.argv[2] ?? '5391';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/?case=1&skip=clinic&seed=7`, { timeout: 300000 });
await page.waitForFunction(() => window.__game?.mode === 'surgery', null, { timeout: 300000 });
const st = await page.evaluate(() => {
  window.__game.advance(3.5);
  const d = window.__game.surgery();
  for (let i = 0; i < 30 && d.state().stepType !== 'screws' && d.state().step; i++) { d.forceCompleteStep(); window.__game.advance(2.2); }
  const p = d.stepParams();
  const holes = p.holes === 'plate' ? d.ctx().bone.plateHolesWorld() : p.holes;
  return { s: d.state(), hole: d.project(holes[0]), hint: document.querySelector('.surgery-root')?.innerText.slice(0, 0) };
});
console.log(JSON.stringify(st.s), JSON.stringify(st.hole));
await page.mouse.move(st.hole.x, st.hole.y, { steps: 3 });
await page.mouse.down();
for (let i = 0; i < 80; i++) {
  const r = await page.evaluate(() => { window.__game.advance(0.1); const d = window.__game.surgery(); return { st: d.state().instrument, hint: [...document.querySelectorAll('*')].find((e) => e.textContent?.startsWith('¡Salida!') && e.children.length === 0)?.textContent ?? '' }; });
  if (r.hint) break;
}
await page.mouse.up();
await page.evaluate(() => window.__game.advance(0.4));
await page.waitForTimeout(1500);
await page.screenshot({ path: 'screenshots/e2e/screws-after-drill.png', timeout: 300000 });
console.log(JSON.stringify(await page.evaluate(() => window.__game.surgery().state())));
await browser.close();
