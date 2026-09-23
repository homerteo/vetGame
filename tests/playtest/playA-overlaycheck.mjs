// Comprueba qué elemento recibe el clic sobre la herida antes y después del intersticial entre fases.
// node tests/playtest/playA-overlaycheck.mjs [port]
import { chromium } from '@playwright/test';
const port = process.argv[2] ?? '5321';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://127.0.0.1:${port}/?case=0&skip=clinic&seed=7`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__game?.mode === 'surgery', null, { timeout: 120000 });
await page.evaluate(() => window.__game.advance(5));
await page.waitForTimeout(1500);
const probe = () => page.evaluate(() => {
  const e = document.elementFromPoint(640, 400);
  const scr = document.querySelector('.emi-screens');
  return { at: e ? `${e.tagName}.${e.className}` : null, screens: scr ? { display: getComputedStyle(scr).display, pe: getComputedStyle(scr).pointerEvents, html: scr.innerHTML.length } : null };
});
console.log('antes', JSON.stringify(await probe()));
await page.evaluate(() => { window.__game.surgery().forceCompleteStep(); window.__game.advance(3); });
await page.waitForTimeout(5000);
console.log('después del intersticial', JSON.stringify(await probe()));
// Clic real sobre la herida: ¿llega al paso?
let downs = 0;
await page.evaluate(() => { window.__downs = 0; document.getElementById('gl').addEventListener('pointerdown', () => window.__downs++); });
await page.mouse.click(640, 400);
console.log('pointerdown recibidos por el canvas:', await page.evaluate(() => window.__downs));
await page.screenshot({ path: 'screenshots/polish/playtest-A/overlay-check.png' });
await browser.close();
