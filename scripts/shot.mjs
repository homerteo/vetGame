// Captura de pantalla headless de una página del servidor de desarrollo.
// Uso: node scripts/shot.mjs <url> <salida.png> [esperaMs=2500] [acciones.json]
// acciones.json (opcional): [{"type":"click","x":640,"y":360},{"type":"key","key":"Space"},{"type":"wait","ms":500},
//   {"type":"mouse","action":"down|up|move","x":..,"y":..},{"type":"eval","js":"window.__debug"},{"type":"shot","path":"a.png"}]
// Imprime errores de consola y de página. Código de salida 2 si hubo errores de página.
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const [url, out = 'screenshots/shot.png', waitMs = '2500', actionsFile] = process.argv.slice(2);
if (!url) {
  console.error('Uso: node scripts/shot.mjs <url> <salida.png> [esperaMs] [acciones.json]');
  process.exit(1);
}
fs.mkdirSync(out.split('/').slice(0, -1).join('/') || '.', { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
let pageErrors = 0;
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[console.${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => {
  pageErrors++;
  console.log(`[pageerror] ${e.message}\n${e.stack ?? ''}`);
});
await page.goto(url, { waitUntil: 'load', timeout: 180_000 });
await page.waitForTimeout(Number(waitMs));
if (actionsFile) {
  const actions = JSON.parse(fs.readFileSync(actionsFile, 'utf8'));
  for (const a of actions) {
    if (a.type === 'click') await page.mouse.click(a.x, a.y, { button: a.button ?? 'left' });
    else if (a.type === 'key') await page.keyboard.press(a.key);
    else if (a.type === 'keydown') await page.keyboard.down(a.key);
    else if (a.type === 'keyup') await page.keyboard.up(a.key);
    else if (a.type === 'wait') await page.waitForTimeout(a.ms);
    else if (a.type === 'mouse') {
      if (a.action === 'move') await page.mouse.move(a.x, a.y, { steps: a.steps ?? 8 });
      else if (a.action === 'down') { await page.mouse.move(a.x, a.y); await page.mouse.down({ button: a.button ?? 'left' }); }
      else if (a.action === 'up') await page.mouse.up({ button: a.button ?? 'left' });
    } else if (a.type === 'eval') console.log('[eval]', JSON.stringify(await page.evaluate(a.js)));
    else if (a.type === 'shot') await page.screenshot({ path: a.path, timeout: 180_000 });
  }
}
await page.screenshot({ path: out, timeout: 180_000 });
console.log(`screenshot: ${out}`);
await browser.close();
process.exit(pageErrors ? 2 : 0);
