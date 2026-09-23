// Visual/UX de la clínica (página dev/clinic.html, que expone window.__clinic).
// Uso: PORT=5324 VP=1280x720 CASE=0 node tests/playtest/visual-ux-clinic.mjs
// Recorre: sala de espera/HUD → dueño → camilla (panel de exploración + minijuego) → negatoscopio (rayos X) → diagnóstico.
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const PORT = process.env.PORT ?? '5324';
const [W, H] = (process.env.VP ?? '1280x720').split('x').map(Number);
const CASE = process.env.CASE ?? '0';
const OUT = 'screenshots/polish/visual-ux';
fs.mkdirSync(OUT, { recursive: true });
const tag = `c${CASE}-${W}x${H}`;
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: W, height: H } });
p.setDefaultTimeout(120000);
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(`http://127.0.0.1:${PORT}/dev/clinic.html?case=${CASE}`, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 60; i++) { if (await p.evaluate(() => !!window.__clinic)) break; await p.waitForTimeout(2000); }
const C = (js) => p.evaluate(js);
const state = () => C(() => { const s = window.__clinic.state(); return { obj: s.objective, it: s.interaction, tests: s.testsDone, plates: s.platesTaken, dx: s.diagnosis }; });
const buttons = () => C(() => [...document.querySelectorAll('button')].filter((x) => x.getBoundingClientRect().width > 0).map((x) => x.textContent.trim().replace(/\s+/g, ' ').slice(0, 50)));
const clip = () => C(() => {
  const out = [];
  for (const el of document.querySelectorAll('#ui-root *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || el.children.length) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || !el.textContent.trim()) continue;
    if (r.right > innerWidth + 1 || r.left < -1 || r.bottom > innerHeight + 1 || r.top < -1) out.push(`OFF ${el.className} "${el.textContent.trim().slice(0, 30)}" [${[r.left, r.top, r.right, r.bottom].map(Math.round)}]`);
    else if (el.scrollWidth > el.clientWidth + 2 && cs.overflow !== 'visible') out.push(`CLIP ${el.className} "${el.textContent.trim().slice(0, 30)}"`);
  }
  return out.slice(0, 15);
});
const shot = async (name) => {
  await p.waitForTimeout(900);
  await p.screenshot({ path: `${OUT}/clinic-${name}-${tag}.png` });
  console.log(`== ${name}`, JSON.stringify(await state()), '\n   buttons:', JSON.stringify(await buttons()));
  for (const l of await clip()) console.log('   ', l);
};
const clickText = async (re) => {
  const ok = await p.evaluate((src) => {
    const r = new RegExp(src, 'i');
    const btn = [...document.querySelectorAll('button')].find((x) => x.getBoundingClientRect().width > 0 && !x.disabled && r.test(x.textContent));
    if (!btn) return false;
    const bb = btn.getBoundingClientRect();
    return { x: bb.left + bb.width / 2, y: bb.top + bb.height / 2, t: btn.textContent.trim() };
  }, re.source);
  if (ok) { await p.mouse.click(ok.x, ok.y); console.log('   click', ok.t); }
  else console.log('   no button', re);
  return !!ok;
};

await C(() => window.__clinic.advance(3));
await shot('hud');
await C(() => { window.__clinic.teleportTo('owner'); window.__clinic.advance(0.3); window.__clinic.interact(); window.__clinic.advance(0.3); });
await shot('owner');
for (let i = 0; i < 6; i++) {
  const bs = await buttons();
  if (!bs.length) break;
  await p.mouse.click(5, 5); // por si es diálogo de avanzar con clic
  if (!(await clickText(/./))) break;
  await C(() => window.__clinic.advance(0.5));
}
await shot('after-owner');
await C(() => { window.__clinic.teleportTo('exam'); window.__clinic.advance(0.3); window.__clinic.interact(); window.__clinic.advance(0.3); });
await shot('exam-panel');
// primera prueba disponible
const bs = await buttons();
console.log('exam buttons', bs);
await clickText(/Radiograf|Rayos|Palpa|Explora|Ortop/);
await C(() => window.__clinic.advance(0.5));
await shot('minigame');
await C(() => window.__clinic.advance(6));
await shot('minigame-later');
await C(() => { window.__clinic.teleportTo('lightbox'); window.__clinic.advance(0.3); window.__clinic.interact(); window.__clinic.advance(0.3); });
await shot('lightbox');
await clickText(/Cancelar/);
await p.keyboard.press('KeyE');
await C(() => { window.__clinic.advance(0.5); window.__clinic.teleportTo('owner'); window.__clinic.advance(0.3); window.__clinic.interact(); window.__clinic.advance(0.3); });
await shot('diagnosis');
await b.close();
