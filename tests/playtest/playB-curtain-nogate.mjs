// Diagnóstico sin compuerta de rAF: ¿la cortina del intersticial sigue sobre el canvas?
// (usa forceCompleteStep SOLO para disparar el intersticial; el diagnóstico es de la capa DOM).
import { chromium } from '@playwright/test';
const PORT = process.env.PORT ?? '5322';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(240000);
await page.goto(`http://127.0.0.1:${PORT}/?case=3&skip=clinic&seed=7`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__game?.mode === 'surgery');
await page.evaluate(() => window.__game.advance(5.7));
await page.evaluate(() => { window.__game.surgery().forceCompleteStep(); window.__game.advance(0.1); });
await page.waitForTimeout(6000);
await page.evaluate(() => window.__game.advance(2));
console.log(await page.evaluate(() => {
  const p = window.__game.surgery().project({ x: 80, y: 50 });
  const el = document.elementFromPoint(p.x, p.y);
  const scr = document.querySelector('.scr');
  return { top: el && `${el.tagName}.${el.className}`, scr: scr && scr.className, opacity: scr && getComputedStyle(scr).opacity, pe: scr && getComputedStyle(scr).pointerEvents };
}));
await page.screenshot({ path: 'screenshots/polish/playtest-B/curtain-nogate.png' });
await browser.close();
