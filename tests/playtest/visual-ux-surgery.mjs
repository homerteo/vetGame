// Visual/UX: HUD de cirugía, overview (Tab), respiración (B), RCP, pausa, auditoría.
// Uso: PORT=5324 CASES=0,4,6 VPS=1280x720,1920x1080,700x1000 node tests/playtest/visual-ux-surgery.mjs
// Mide el solapamiento de paneles del HUD con la ventana profunda de la herida (anatomy.window proyectada).
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const PORT = process.env.PORT ?? '5324';
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = 'screenshots/polish/visual-ux';
fs.mkdirSync(OUT, { recursive: true });
const VIEWPORTS = (process.env.VPS ?? '1280x720,1920x1080,700x1000').split(',').map((s) => s.split('x').map(Number));
const CASES = (process.env.CASES ?? '0,4,6').split(',').map(Number);
const EXTRAS = process.env.EXTRAS !== '0';

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function overlapReport(page, label) {
  const r = await page.evaluate(() => {
    const d = window.__game.surgery();
    if (!d) return null;
    const ctx = d.ctx();
    const win = ctx.caseDef?.anatomy?.window ?? ctx.anatomy?.window ?? null;
    const pts = (win ?? [{ x: 0, y: 0 }, { x: 160, y: 0 }, { x: 160, y: 100 }, { x: 0, y: 100 }]).map((p) => d.project(p));
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const wr = { l: Math.min(...xs), t: Math.min(...ys), r: Math.max(...xs), b: Math.max(...ys) };
    const full = [{ x: 0, y: 0 }, { x: 160, y: 100 }].map((p) => d.project(p));
    const hits = [];
    for (const el of document.querySelectorAll('.hud-anchor > *, .hud-anchor')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) continue;
      const b = el.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) continue;
      const ix = Math.max(0, Math.min(b.right, wr.r) - Math.max(b.left, wr.l));
      const iy = Math.max(0, Math.min(b.bottom, wr.b) - Math.max(b.top, wr.t));
      if (ix * iy > 0 && el.parentElement?.classList.contains('hud-anchor'))
        hits.push(`${el.className.split(' ')[0]} ${Math.round(ix)}x${Math.round(iy)}px [${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.right)},${Math.round(b.bottom)}]`);
    }
    const off = [];
    for (const el of document.querySelectorAll('.emi-hud *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const b = el.getBoundingClientRect();
      if (b.width < 2 || el.children.length) continue;
      if (b.right > innerWidth + 1 || b.left < -1 || b.bottom > innerHeight + 1 || b.top < -1) off.push(`${el.className} "${el.textContent.trim().slice(0, 25)}" [${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.right)},${Math.round(b.bottom)}]`);
    }
    return { hasWin: !!win, win: [wr.l, wr.t, wr.r, wr.b].map(Math.round), full: full.map((p) => [Math.round(p.x), Math.round(p.y)]), hits, off: off.slice(0, 12), st: d.state() };
  });
  if (!r) return console.log(`${label}: no surgery`);
  console.log(`== ${label} step=${r.st.step} (${r.st.stepType}) instr=${r.st.instrument} winPx=${r.win} (anatomyWin=${r.hasWin}) wound0..160x100=${JSON.stringify(r.full)}`);
  for (const h of r.hits) console.log('   OVERLAP', h);
  for (const o of r.off) console.log('   OFFSCREEN', o);
}

for (const [w, h] of VIEWPORTS) {
  const tag = `${w}x${h}`;
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.setDefaultTimeout(90000);
  page.on('pageerror', (e) => console.log(`[${tag} pageerror] ${e.message}`));
  for (const ci of CASES) {
    await page.goto(`${BASE}/?case=${ci}&skip=clinic&seed=7`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    for (let i = 0; i < 60; i++) { if (await page.evaluate(() => !!window.__game?.surgery?.())) break; await page.waitForTimeout(2000); }
    await page.evaluate(() => window.__game.advance(4));
    await page.waitForTimeout(1200);
    const n = `c${ci}`;
    await page.screenshot({ path: `${OUT}/surg-${n}-start-${tag}.png` });
    await overlapReport(page, `${tag} ${n} start`);
    // Avanzar hasta un paso con hueso visible (tras separar). forceCompleteStep NO abre la herida,
    // así que se abre a mano con la API de la herida para que la captura muestre el estado real tras separar.
    await page.evaluate(() => {
      const d = window.__game.surgery();
      const sp = d.stepParams();
      const w = d.ctx().wound;
      if (sp && sp.type === 'incision') {
        for (const L of ['skin', 'subcut', 'fascia', 'muscle'])
          for (let i = 1; i < sp.path.length; i++) w.cut(L, sp.path[i - 1], sp.path[i], 1.6);
      }
    });
    for (let k = 0; k < 3; k++) {
      await page.evaluate(() => { window.__game.surgery().forceCompleteStep(); window.__game.advance(2.5); });
    }
    await page.evaluate(() => { const w = window.__game.surgery().ctx().wound; w.setRetraction(1); window.__game.advance(0.5); });
    await page.waitForTimeout(1200);
    // mover el ratón al centro de la ventana para ver el instrumento en el punto de trabajo
    const c = await page.evaluate(() => { const d = window.__game.surgery(); return d.project({ x: 80, y: 50 }); });
    await page.mouse.move(c.x, c.y, { steps: 4 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/surg-${n}-deep-${tag}.png` });
    await overlapReport(page, `${tag} ${n} deep`);
    if (!EXTRAS) continue;
    await page.keyboard.press('Tab');
    await page.evaluate(() => window.__game.advance(1.5));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/surg-${n}-overview-${tag}.png` });
    await page.keyboard.press('Tab');
    await page.evaluate(() => window.__game.advance(1.5));
    if (ci >= 2) {
      await page.evaluate(() => window.__game.surgery().setExito(80));
      await page.keyboard.press('KeyB');
      await page.evaluate(() => window.__game.advance(1));
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${OUT}/surg-${n}-breathing-${tag}.png` });
      for (let i = 0; i < 20; i++) await page.keyboard.press('Space');
      await page.evaluate(() => window.__game.advance(20));
    }
    // Pausa con Escape (el jugador real): ¿aparece el menú y se congela el tiempo?
    const t0 = await page.evaluate(() => window.__game.surgery().state().t);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
    const t1 = await page.evaluate(() => window.__game.surgery().state().t);
    const pauseVisible = await page.evaluate(() => [...document.querySelectorAll('#ui-root *')].some((e) => /Reanudar|Continuar/.test(e.textContent ?? '') && e.tagName === 'BUTTON' && e.getBoundingClientRect().width > 0));
    console.log(`${tag} ${n} ESC pause: menuVisible=${pauseVisible} t ${t0.toFixed(2)} -> ${t1.toFixed(2)}`);
    await page.screenshot({ path: `${OUT}/surg-${n}-pause-${tag}.png` });
    if (pauseVisible) await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    // RCP: setExito(0) no basta (el Éxito se recupera +0,1/s antes de comprobar); se fuerza el paro.
    await page.evaluate(() => { window.__game.surgery().ctx().vitals.triggerArrest(); window.__game.advance(0.6); });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/surg-${n}-cpr-${tag}.png` });
    await overlapReport(page, `${tag} ${n} cpr`);
  }
  // Auditoría: completar todo el caso 0
  await page.goto(`${BASE}/?case=${CASES[0]}&skip=clinic&seed=7`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  for (let i = 0; i < 60; i++) { if (await page.evaluate(() => !!window.__game?.surgery?.())) break; await page.waitForTimeout(2000); }
  await page.evaluate(() => {
    for (let i = 0; i < 80 && window.__game.mode === 'surgery'; i++) {
      const d = window.__game.surgery();
      if (!d) break;
      d.setExito(85);
      d.forceCompleteStep();
      window.__game.advance(1.5);
    }
    window.__game.advance(10);
  });
  await page.waitForTimeout(2500);
  console.log(`${tag} mode after finish: ${await page.evaluate(() => window.__game.mode)}`);
  await page.screenshot({ path: `${OUT}/audit-${tag}.png` });
  await page.close();
}
await browser.close();
