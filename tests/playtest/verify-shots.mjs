// Verificación final: capturas frescas (título a dos tamaños, herida del caso 0, micro del caso 6, auditoría).
// Uso: PORT=5340 node tests/playtest/verify-shots.mjs  → screenshots/polish/verify/
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const BASE = `http://127.0.0.1:${process.env.PORT ?? '5340'}`;
const OUT = 'screenshots/polish/verify';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];

async function newPage(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.setDefaultTimeout(180000);
  page.on('pageerror', (e) => errors.push(e.message));
  return page;
}
async function surgery(page, ci) {
  await page.goto(`${BASE}/?case=${ci}&skip=clinic&seed=7`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => !!window.__game?.surgery?.(), null, { timeout: 180000, polling: 500 });
  await page.evaluate(() => window.__game.advance(4));
}
const settle = async (page, ms = 2500) => page.waitForTimeout(ms);

// 1) Título a 1280x720 y 700x1000
for (const [w, h] of [[1280, 720], [700, 1000]]) {
  const page = await newPage(w, h);
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => window.__game?.mode === 'menu', null, { timeout: 180000, polling: 500 });
  await settle(page, 3000);
  await page.screenshot({ path: `${OUT}/title-${w}x${h}.png` });
  await page.close();
}

// 2) Caso 0: herida al empezar y con la piel abierta (tras incisión y hemostasia)
{
  const page = await newPage(1280, 720);
  await surgery(page, 0);
  await settle(page);
  await page.screenshot({ path: `${OUT}/c0-wound-start.png` });
  await page.evaluate(() => { const g = window.__game; const d = g.surgery(); for (let i = 0; i < 3; i++) { d.forceCompleteStep(); g.advance(2.5); } });
  const c = await page.evaluate(() => window.__game.surgery().project({ x: 80, y: 50 }));
  await page.mouse.move(c.x, c.y, { steps: 3 });
  await page.evaluate(() => window.__game.advance(0.3));
  await settle(page);
  console.log('c0 step', JSON.stringify(await page.evaluate(() => window.__game.surgery().state().stepType)));
  await page.screenshot({ path: `${OUT}/c0-wound-open.png` });
  await page.close();
}

// 3) Caso 6: vista micro (reducción y agujas)
{
  const page = await newPage(1280, 720);
  await surgery(page, 6);
  const steps = [];
  for (let k = 0; k < 4; k++) {
    const st = await page.evaluate(() => window.__game.surgery().state().stepType);
    steps.push(st);
    if (st === 'reduction' || st === 'drillPins') {
      await page.evaluate(() => window.__game.advance(1));
      await settle(page);
      await page.screenshot({ path: `${OUT}/c6-micro-${st}.png` });
    }
    await page.evaluate(() => { window.__game.surgery().forceCompleteStep(); window.__game.advance(2.5); });
  }
  console.log('c6 steps', steps.join(','));
  await page.close();
}

// 4) Auditoría (caso 0 completado con pasos forzados)
{
  const page = await newPage(1280, 720);
  await surgery(page, 0);
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
  await settle(page, 4000);
  console.log('mode after finish', await page.evaluate(() => window.__game.mode));
  await page.screenshot({ path: `${OUT}/audit.png` });
  await page.close();
}
console.log('page errors', JSON.stringify(errors));
await browser.close();
