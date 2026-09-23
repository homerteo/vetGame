// Fase sin errores → mensaje de la pareja: ¿cuántas veces se anuncia? + ranuras reales del cauterio.
// Uso: PORT=5325 node tests/playtest/review-message.mjs
import { chromium } from '@playwright/test';
const BASE = `http://127.0.0.1:${process.env.PORT ?? '5325'}`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${BASE}/?case=1&skip=clinic&seed=7`, { waitUntil: 'domcontentloaded', timeout: 240000 });
await page.waitForFunction(() => !!window.__game, null, { timeout: 240000, polling: 1000 });
const E = (f, a) => page.evaluate(f, a);
await E(() => window.__game.advance(3));
await E(() => {
  window.__toasts = [];
  const mo = new MutationObserver((recs) => { for (const r of recs) r.addedNodes.forEach((n) => { const t = n.textContent ?? ''; if (/reloj vibra/.test(t) && n.nodeType === 1 && n.children.length <= 3) window.__toasts.push(t.trim()); }); });
  mo.observe(document.body, { childList: true, subtree: true });
  const d = window.__game.surgery();
  const bus = d.ctx().bus;
  window.__ticks = 0;
  const audio = d.ctx().audio; const op = audio.play.bind(audio);
  audio.play = (n, o) => { if (n === 'tick') window.__ticks++; return op(n, o); };
});
// Completa la primera fase entera sin faltas.
const ph0 = await E(() => window.__game.surgery().state().phase);
for (let i = 0; i < 10; i++) {
  const ph = await E(() => window.__game.surgery().state().phase);
  if (ph !== ph0) break;
  await E(() => { window.__game.surgery().forceCompleteStep(); window.__game.advance(0.1); });
}
await E(() => window.__game.advance(2));
console.log('phase', ph0, '->', await E(() => window.__game.surgery().state().phase));
console.log('pending msg', await E(() => window.__game.surgery().ctx().emiliana.snapshot().message.pending));
console.log('"tick" sounds:', await E(() => window.__ticks), 'toast nodes:', JSON.stringify(await E(() => window.__toasts)));
// Ranuras de instrumental visibles y texto de la alerta arterial
const slots = await E(() => [...document.querySelectorAll('[class*="slot"]')].map((e) => e.textContent.trim()).filter(Boolean).slice(0, 10));
console.log('step', await E(() => window.__game.surgery().state().step), 'HUD slots:', JSON.stringify(slots));
await page.screenshot({ path: 'screenshots/polish/code-review/message-slots.png', timeout: 120000 }).catch(() => {});
await browser.close();
