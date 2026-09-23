// Esc en quirófano: ¿se abre y se queda la pausa? Uso: PORT=5325 node tests/playtest/review-esc.mjs
import { chromium } from '@playwright/test';
const BASE = `http://127.0.0.1:${process.env.PORT ?? '5325'}`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
async function probe(url, modeWanted) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction((m) => window.__game?.mode === m, modeWanted, { timeout: 90000 });
  await page.waitForTimeout(1500);
  return page.evaluate(() => {
    const added = [];
    const removed = [];
    const txt = (n) => (n.textContent ?? '').replace(/\s+/g, ' ').slice(0, 50);
    const mo = new MutationObserver((recs) => {
      for (const r of recs) {
        r.addedNodes.forEach((n) => /Reanudar|Pausa|Continuar/i.test(n.textContent ?? '') && added.push(txt(n)));
        r.removedNodes.forEach((n) => /Reanudar|Pausa|Continuar/i.test(n.textContent ?? '') && removed.push(txt(n)));
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape', key: 'Escape' }));
    return new Promise((r) => setTimeout(() => { mo.disconnect(); r({ added, removed, visibleNow: /Reanudar/i.test(document.body.innerText) }); }, 500));
  });
}
console.log('surgery Esc ->', JSON.stringify(await probe('/?case=1&skip=clinic&seed=7', 'surgery')));
await page.screenshot({ path: 'screenshots/polish/code-review/esc-surgery.png' });
console.log('clinic  Esc ->', JSON.stringify(await probe('/?case=1&go=clinic&seed=7', 'clinic')));
await page.screenshot({ path: 'screenshots/polish/code-review/esc-clinic.png' });
await browser.close();
