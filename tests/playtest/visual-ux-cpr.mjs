// Visual/UX: overlay de RCP y de respiración con las animaciones de entrada terminadas (en headless el
// timeline CSS a veces no avanza y el velo se queda en opacidad 0). Uso: PORT=5324 VP=1280x720 node tests/playtest/visual-ux-cpr.mjs
import { chromium } from '@playwright/test';
const PORT = process.env.PORT ?? '5324';
const [W, H] = (process.env.VP ?? '1280x720').split('x').map(Number);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: W, height: H } });
p.setDefaultTimeout(120000);
const go = async (ci) => {
  await p.goto(`http://127.0.0.1:${PORT}/?case=${ci}&skip=clinic&seed=7`, { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 60; i++) { if (await p.evaluate(() => !!window.__game?.surgery?.())) break; await p.waitForTimeout(2000); }
  await p.evaluate(() => window.__game.advance(4));
};
const finishAnims = () => p.evaluate(() => document.getAnimations().forEach((a) => { try { if (a.effect?.getTiming().iterations !== Infinity) a.finish(); } catch {} }));
await go(4);
await p.evaluate(() => { window.__game.surgery().ctx().vitals.triggerArrest(); window.__game.advance(0.6); });
await p.waitForTimeout(1500);
await finishAnims();
await p.waitForTimeout(500);
await p.screenshot({ path: `screenshots/polish/visual-ux/cpr-${W}x${H}.png` });
// respiración
await go(4);
await p.evaluate(() => window.__game.surgery().setExito(80));
await p.keyboard.press('KeyB');
await p.evaluate(() => window.__game.advance(0.5));
await p.waitForTimeout(1500);
await finishAnims();
await p.waitForTimeout(500);
await p.screenshot({ path: `screenshots/polish/visual-ux/breathing-${W}x${H}.png` });
await b.close();
