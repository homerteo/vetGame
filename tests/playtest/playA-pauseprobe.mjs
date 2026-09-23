// Sonda: Esc en el quirófano. ¿Se monta la pantalla de pausa y se queda?
// node tests/playtest/playA-pauseprobe.mjs [port]
import { chromium } from '@playwright/test';
const port = process.argv[2] ?? '5321';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://127.0.0.1:${port}/?case=0&skip=clinic&seed=7`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => window.__game?.mode === 'surgery', null, { timeout: 180000 });
await page.evaluate(() => window.__game.advance(5));
await page.evaluate(() => {
  window.__pauseLog = [];
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) if (n.classList?.contains('scr-pause')) window.__pauseLog.push(['montada', performance.now()]);
      for (const n of m.removedNodes) if (n.classList?.contains('scr-pause')) window.__pauseLog.push(['quitada', performance.now()]);
    }
  }).observe(document.body, { childList: true, subtree: true });
});
await page.keyboard.press('Escape');
await page.waitForTimeout(1500);
const res = await page.evaluate(() => ({
  log: window.__pauseLog.map(([k, t], i, a) => `${k} +${(t - a[0][1]).toFixed(1)}ms`),
  pauseVisible: !!document.querySelector('.scr-pause'),
  screensDisplay: getComputedStyle(document.querySelector('.emi-screens')).display,
}));
console.log(JSON.stringify(res));
await browser.close();
