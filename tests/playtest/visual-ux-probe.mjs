// Visual/UX: sondas puntuales. Uso: PORT=5324 VP=1280x720 WHAT=pause,micro,cpr,audit node tests/playtest/visual-ux-probe.mjs
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const PORT = process.env.PORT ?? '5324';
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = 'screenshots/polish/visual-ux';
fs.mkdirSync(OUT, { recursive: true });
const [W, H] = (process.env.VP ?? '1280x720').split('x').map(Number);
const tag = `${W}x${H}`;
const WHAT = new Set((process.env.WHAT ?? 'pause,micro,cpr,audit').split(','));

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
const go = async (ci) => {
  await page.goto(`${BASE}/?case=${ci}&skip=clinic&seed=7`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  for (let i = 0; i < 60; i++) { if (await page.evaluate(() => !!window.__game?.surgery?.())) break; await page.waitForTimeout(2000); }
  await page.evaluate(() => window.__game.advance(4));
};

if (WHAT.has('pause')) {
  await go(0);
  await page.evaluate(() => {
    window.__pauseLog = [];
    new MutationObserver((ms) => {
      for (const m of ms) {
        for (const n of m.addedNodes) if (n.nodeType === 1 && (n.className + n.innerHTML).includes('pause-card')) window.__pauseLog.push('added');
        for (const n of m.removedNodes) if (n.nodeType === 1 && (n.className + n.innerHTML).includes('pause-card')) window.__pauseLog.push('removed');
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
  const r = await page.evaluate(() => ({ log: window.__pauseLog, visible: !!document.querySelector('.pause-card') }));
  console.log(`PAUSE via Escape in surgery: mutations=${JSON.stringify(r.log)} visibleNow=${r.visible}`);
  await page.screenshot({ path: `${OUT}/probe-pause-esc-${tag}.png` });
}

if (WHAT.has('micro')) {
  await go(6);
  const r = await page.evaluate(() => {
    const d = window.__game.surgery();
    const ctx = d.ctx();
    const sp = d.stepParams();
    const pr = (p) => { const q = d.project(p); return [Math.round(q.x), Math.round(q.y)]; };
    const frags = ctx.bone.fragments().map((f) => ({ id: f.id, world: ctx.bone.worldPolygon(f.id).map(pr), target: (ctx.bone.targetPolygon(f.id) ?? []).map(pr) }));
    return { step: d.state().step, sp, frags, win: ctx.caseDef.anatomy.window.map(pr), vw: innerWidth, vh: innerHeight };
  });
  console.log('MICRO c6', JSON.stringify(r).slice(0, 3000));
  // Pasos de agujas: mostrar objetivos
  await page.evaluate(() => { window.__game.surgery().forceCompleteStep(); window.__game.advance(3); });
  const r2 = await page.evaluate(() => {
    const d = window.__game.surgery();
    const pr = (p) => { const q = d.project(p); return [Math.round(q.x), Math.round(q.y)]; };
    const sp = d.stepParams();
    const pts = JSON.stringify(sp, (k, v) => (v && typeof v === 'object' && 'x' in v && 'y' in v && typeof v.x === 'number' ? pr(v) : v));
    return { step: d.state().step, sp: pts };
  });
  console.log('MICRO c6 step2', JSON.stringify(r2).slice(0, 3000));
  const c = await page.evaluate(() => window.__game.surgery().project({ x: 80, y: 50 }));
  await page.mouse.move(c.x, c.y, { steps: 3 });
  await page.evaluate(() => window.__game.advance(0.3));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/probe-micro-pins-${tag}.png` });
}

if (WHAT.has('cpr')) {
  await go(4);
  await page.evaluate(() => { window.__game.surgery().ctx().vitals.triggerArrest(); window.__game.advance(0.6); });
  await page.waitForTimeout(2500);
  console.log('CPR state', JSON.stringify(await page.evaluate(() => window.__game.surgery().state())));
  await page.screenshot({ path: `${OUT}/probe-cpr-${tag}.png` });
}

if (WHAT.has('audit')) {
  await go(0);
  await page.evaluate(() => {
    for (let i = 0; i < 80 && window.__game.mode === 'surgery'; i++) {
      const d = window.__game.surgery();
      if (!d) break;
      d.setExito(85);
      d.forceCompleteStep();
      window.__game.advance(1.8);
    }
    window.__game.advance(10);
  });
  await page.waitForTimeout(4000);
  console.log(`mode after finish: ${await page.evaluate(() => window.__game.mode)}`);
  await page.screenshot({ path: `${OUT}/probe-audit-${tag}.png` });
}
await browser.close();
