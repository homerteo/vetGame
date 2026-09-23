// Sonda: caso 1 en dificultad Jefe, avanza hasta la sutura y captura los marcadores.
import { chromium } from '@playwright/test';
const port = process.argv[2] ?? '5391';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.addInitScript(() => {
  const s = JSON.parse(localStorage.getItem('dra-emiliana-save-v1') || 'null');
  if (!s) localStorage.setItem('dra-emiliana-save-v1', JSON.stringify({ version: 1, settings: { difficulty: 'jefe' } }));
});
await page.goto(`http://127.0.0.1:${port}/?case=1&skip=clinic&seed=7`, { timeout: 300000 });
await page.waitForFunction(() => window.__game?.mode === 'surgery', null, { timeout: 300000 });
const st = await page.evaluate(() => {
  window.__game.advance(3.5);
  const d = window.__game.surgery();
  for (let i = 0; i < 30 && d.state().stepType !== 'suture' && d.state().step; i++) { d.forceCompleteStep(); window.__game.advance(2.2); }
  return { s: d.state(), guide: d.ctx().guideLevel, diff: window.__game.save.settings.difficulty };
});
console.log(JSON.stringify(st));
await page.mouse.move(420, 560, { steps: 3 });
await page.evaluate(() => window.__game.advance(0.3));
await page.waitForTimeout(1500);
await page.screenshot({ path: 'screenshots/e2e/suture-jefe.png', timeout: 300000 });
await browser.close();
