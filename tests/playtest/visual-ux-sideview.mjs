// Visual/UX: vista lateral de la mesa de quirófano (cámara movida a mano) para comprobar si el paciente flota.
// Uso: PORT=5324 node tests/playtest/visual-ux-sideview.mjs
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const PORT = process.env.PORT ?? '5324';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.setDefaultTimeout(120000);
await p.goto(`http://127.0.0.1:${PORT}/?case=${process.env.CASE ?? 0}&skip=clinic&seed=7`, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 60; i++) { if (await p.evaluate(() => !!window.__game?.surgery?.())) break; await p.waitForTimeout(2000); }
await p.evaluate(() => window.__game.advance(4));
const views = { side: [0, 1.0, 1.6], front: [-2.0, 1.3, 0.2], top: [0.0, 2.6, 0.01] };
for (const [name, pos] of Object.entries(views)) {
  const url = await p.evaluate(([x, y, z]) => {
    const s = window.__game.surgery().ctx().scene;
    const cam = s.camera;
    cam.position.set(x, y, z);
    cam.fov = 45;
    cam.updateProjectionMatrix();
    cam.lookAt(-0.3, 0.8, 0);
    cam.updateMatrixWorld(true);
    s.render();
    return document.querySelector('canvas').toDataURL('image/png');
  }, pos);
  fs.writeFileSync(`screenshots/polish/visual-ux/sideview-${name}-c${process.env.CASE ?? 0}.png`, Buffer.from(url.split(',')[1], 'base64'));
}
await b.close();
