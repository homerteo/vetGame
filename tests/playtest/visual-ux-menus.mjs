// Visual/UX: capturas de pantallas de menú a tres tamaños.
// Uso: PORT=5324 node tests/playtest/visual-ux-menus.mjs
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const PORT = process.env.PORT ?? '5324';
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = 'screenshots/polish/visual-ux';
fs.mkdirSync(OUT, { recursive: true });
const VIEWPORTS = (process.env.VPS ?? '1280x720,1920x1080,700x1000').split(',').map((s) => s.split('x').map(Number));

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [w, h] of VIEWPORTS) {
  const tag = `${w}x${h}`;
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', (e) => console.log(`[${tag} pageerror] ${e.message}`));
  // Partida con progreso para que Boutique/cases tengan contenido.
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('dra-emiliana-save-v1');
    } catch {}
  });
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const overflow = async (name) => {
    const r = await page.evaluate(() => {
      const out = [];
      const vw = innerWidth, vh = innerHeight;
      for (const el of document.querySelectorAll('#ui-root *')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        if (!el.textContent?.trim() && el.tagName !== 'BUTTON') continue;
        if (b.right > vw + 1 || b.left < -1 || b.bottom > vh + 1 || b.top < -1) {
          // solo hojas con texto o botones
          if (el.children.length === 0 || el.tagName === 'BUTTON')
            out.push(`${el.tagName}.${el.className} "${el.textContent.trim().slice(0, 30)}" [${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.right)},${Math.round(b.bottom)}]`);
        }
        // texto recortado
        if ((cs.overflow === 'hidden' || cs.textOverflow === 'ellipsis') && el.children.length === 0 && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2))
          out.push(`CLIP ${el.tagName}.${el.className} "${el.textContent.trim().slice(0, 40)}" sw=${el.scrollWidth} cw=${el.clientWidth} sh=${el.scrollHeight} ch=${el.clientHeight}`);
      }
      const se = document.scrollingElement;
      return { out: out.slice(0, 25), docScroll: [se.scrollWidth, se.scrollHeight] };
    });
    console.log(`== ${tag} ${name} docScroll=${r.docScroll}`);
    for (const l of r.out) console.log('   ', l);
  };
  const shot = async (name) => {
    await page.screenshot({ path: `${OUT}/${name}-${tag}.png` });
    await overflow(name);
  };
  await shot('title');
  await page.getByRole('button', { name: 'Ajustes' }).first().click();
  await page.waitForTimeout(600);
  await shot('settings');
  await page.screenshot({ path: `${OUT}/settings-full-${tag}.png`, fullPage: true });
  await page.keyboard.press('Escape');
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Boutique' }).first().click();
  await page.waitForTimeout(600);
  await shot('boutique');
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Jugar' }).first().click();
  await page.waitForTimeout(900);
  await shot('cases');
  await page.goto(`${BASE}/?case=0`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await shot('briefing0');
  await page.goto(`${BASE}/?case=6`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await shot('briefing6');
  await page.close();
}
await browser.close();
