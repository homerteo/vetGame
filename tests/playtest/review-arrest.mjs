// Paro sin RCP → fracaso → Valerio toma el control → auditoría F.
// Uso: PORT=5325 node tests/playtest/review-arrest.mjs
import { chromium } from '@playwright/test';
const BASE = `http://127.0.0.1:${process.env.PORT ?? '5325'}`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.addInitScript(() => { try { localStorage.removeItem('dra-emiliana-save-v1'); } catch {} });
await page.goto(`${BASE}/?case=1&skip=clinic&seed=7`, { waitUntil: 'domcontentloaded', timeout: 240000 });
await page.waitForFunction(() => !!window.__game, null, { timeout: 240000, polling: 1000 });
const E = (f, a) => page.evaluate(f, a);
await E(() => window.__game.advance(3));
const st = () => E(() => { const d = window.__game.surgery(); if (!d) return { mode: window.__game.mode }; const s = d.state(); return { t: +s.t.toFixed(1), step: s.step, arrest: s.arrest, finished: s.finished, exito: +s.exito.toFixed(1), cpr: !!document.querySelector('.emi-cpr') }; });
await E(() => window.__game.surgery().ctx().vitals.triggerArrest());
await E(() => window.__game.advance(0.2));
console.log('after exito=0', JSON.stringify(await st()));
await page.screenshot({ path: 'screenshots/polish/code-review/arrest-cpr.png', timeout: 120000 }).catch(() => {});
for (let i = 0; i < 14; i++) {
  await E(() => window.__game.advance(5));
  const s = await st();
  console.log(`+${(i + 1) * 5}s`, JSON.stringify(s));
  if (s.mode === 'menu') break;
}
await page.waitForTimeout(1500);
console.log('save', JSON.stringify(await E(() => ({ completed: window.__game.save.completed, unlockedWeek: window.__game.save.unlockedWeek, coins: window.__game.save.coins }))));
await page.screenshot({ path: 'screenshots/polish/code-review/arrest-audit.png', timeout: 120000 }).catch(() => {});
await browser.close();
