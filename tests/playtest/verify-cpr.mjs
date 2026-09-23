// Verificación: RCP con Espacio a ~110/min de reloj real, carga con D y descarga al despejar.
// Mide si el ritmo medido (reloj real) queda en 100–120 aun con la máquina cargada.
// Uso: PORT=5340 node tests/playtest/verify-cpr.mjs
import { chromium } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT ?? '5340'}`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}/?case=0&skip=clinic&seed=7`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__game?.surgery?.(), null, { timeout: 180000, polling: 500 });
await page.evaluate(() => window.__game.advance(4));
await page.evaluate(() => { window.__game.surgery().setExito(0); window.__game.advance(0.5); });
console.log('arrest', JSON.stringify(await page.evaluate(() => window.__game.surgery().state().arrest)));
// Pulsaciones dentro de la página, espaciadas 545 ms de reloj real con espera activa (Playwright bajo carga
// no consigue un ritmo estable: sus idas y vueltas tardan 1–2 s). El tiempo de juego avanza entre pulsaciones.
const r = await page.evaluate(() => {
  const g = window.__game;
  const key = (code, type) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code === 'Space' ? ' ' : 'd', bubbles: true }));
  const txt = () => (document.querySelector('.emi-cpr')?.textContent ?? '').replace(/\s+/g, ' ');
  const wait = (ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) {} };
  let n = 0;
  for (; n < 40; n++) {
    const t0 = performance.now();
    key('Space', 'keydown');
    key('Space', 'keyup');
    g.advance(0.3);
    if (n >= 8 && /Fibrilaci/.test(txt())) break;
    wait(545 - (performance.now() - t0));
  }
  const before = txt();
  key('KeyD', 'keydown');
  g.advance(2.3);
  for (let i = 0; i < 60 && !/apart/.test(txt()); i++) g.advance(0.1);
  g.advance(0.2);
  key('KeyD', 'keyup');
  g.advance(0.5);
  return { n, before: before.slice(0, 200), after: txt().slice(0, 300) };
});
console.log(JSON.stringify(r, null, 1));
console.log('page errors', JSON.stringify(errors));
await browser.close();
