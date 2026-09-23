// Sonda: ¿cuánto tarda en llegar el primer anillo de ScrewCatch desde que empieza la fase de tornillos,
// comparado con el telón del intersticial (1,6 s)? node tests/playtest/playA-screwprobe.mjs [port] [case] [stepsToSkip]
// NOTA (verificación final): desde que Tornillos perfora el piloto y mide ANTES de pedir el tornillo, el anillo
// ya no aparece al empezar el paso y esta sonda sale con ring=null. La cubren playB (caso 5) y playC (caso 7).
import { chromium } from '@playwright/test';
const [port = '5321', caseIdx = '0', skip = '5'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://127.0.0.1:${port}/?case=${caseIdx}&skip=clinic&seed=7`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => window.__game?.mode === 'surgery', null, { timeout: 180000 });
const out = await page.evaluate((skip) => {
  const g = window.__game;
  g.advance(4);
  const d = g.surgery();
  for (let i = 0; i < skip - 1; i++) { d.forceCompleteStep(); g.advance(2); }
  // El último forzado dispara el cambio de fase (telón) y arranca el paso de tornillos.
  d.forceCompleteStep();
  const log = [];
  for (let f = 0; f < 80; f++) {
    const root = document.querySelector('.sc-root');
    const ring = root?.querySelector('.sc-ring');
    const m = ring?.style.transform.match(/scale\(([\d.]+)\)/);
    const curtain = document.querySelector('.inter-curtain');
    log.push({ wall: +(f * 0.05).toFixed(2), t: +d.state().t.toFixed(2), step: d.state().stepType, ring: m ? +m[1] : null, cls: root?.className ?? null, curtain: !!curtain });
    g.advance(0.05);
  }
  return log;
}, Number(skip));
const first = out.find((r) => r.ring !== null);
const arrive = out.find((r) => r.ring !== null && r.ring <= 1.001);
const miss = out.find((r) => r.cls && /sc-miss/.test(r.cls));
const thaw = out.find((r, i) => i > 0 && r.t > out[0].t);
console.log(JSON.stringify({ firstRingAtWall: first?.wall, worldThawsAtWall: thaw?.wall, ringArrivesAtWall: arrive?.wall, autoMissAtWall: miss?.wall }, null, 1));
console.log(out.filter((_, i) => i % 4 === 0).map((r) => `${r.wall}s t=${r.t} ring=${r.ring} ${r.cls ?? ''}`).join('\n'));
await browser.close();
