// playtest-B: juega una cirugía completa con eventos reales del DOM (ver playB-driver.js).
// Uso: PORT=5322 node tests/playtest/playB-run.mjs <caso> [seed] [opcionesJSON]
//   opciones: {"chaos":"respond"|"ignore","saw":{...},"burr":{...},"tag":"x","difficulty":"jefe"}
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const PORT = process.env.PORT ?? '5322';
const OUT = 'screenshots/polish/playtest-B';
const c = Number(process.argv[2] ?? 3);
const seed = Number(process.argv[3] ?? 7);
const opts = JSON.parse(process.argv[4] ?? '{}');
const tag = `c${c}${opts.tag ? '-' + opts.tag : ''}`;
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, baseURL: `http://127.0.0.1:${PORT}` });
await ctx.addInitScript((diff) => {
  try {
    localStorage.removeItem('dra-emiliana-save-v1');
    if (diff) {
      // partida guardada mínima con la dificultad pedida (se completa con valores por defecto al cargar)
      localStorage.setItem('dra-emiliana-save-v1', JSON.stringify({ settings: { difficulty: diff } }));
    }
  } catch {}
}, opts.difficulty ?? null);
await ctx.addInitScript({ path: 'tests/playtest/playB-driver.js' });
const page = await ctx.newPage();
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => errors.push(`${e.message}\n${e.stack ?? ''}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});
const out = [];
const say = (s) => {
  out.push(s);
  console.log(`[${tag}] ${s}`);
};
const t0 = Date.now();
try {
  await page.goto(`/?case=${c}&skip=clinic&seed=${seed}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => window.__game?.mode === 'surgery', null, { timeout: 180000 });
  await page.evaluate((o) => {
    window.__game.advance(5.7);
    window.__pt.opts = o;
    window.__pt.chaosPolicy = o.chaos ?? 'respond';
    window.__pt.play(o.maxSteps ?? 40).catch((e) => {
      window.__pt.log('EXCEPCIÓN ' + e.message + ' ' + e.stack);
      window.__pt.result = { error: String(e) };
    });
  }, opts);
  let seen = 0;
  for (;;) {
    const r = await page.evaluate((seen) => {
      const T = window.__pt;
      return { logs: T.logs.slice(seen), shot: T.shotReq, result: T.result };
    }, seen);
    seen += r.logs.length;
    for (const l of r.logs) say(l);
    if (r.shot) {
      await page.evaluate(() => window.__pump(2));
      await page.screenshot({ path: `${OUT}/${tag}-${r.shot}.png`, timeout: 180000 });
      await page.evaluate(() => (window.__pt.shotReq = null));
    }
    if (r.result) {
      say(`RESULT ${JSON.stringify(r.result)}`);
      break;
    }
    await page.waitForTimeout(700);
  }
  const res = await page.evaluate(() => window.__pt.result);
  if (res.finished) {
    await page.evaluate(() => window.__game.advance(6));
    if (opts.auditShot) {
      await page.evaluate(() => window.__pump(3));
      await page.screenshot({ path: `${OUT}/${tag}-audit.png` });
    }
    say(`mode ${await page.evaluate(() => window.__game.mode)}`);
    say(`AUDIT ${(await page.evaluate(() => document.querySelector('#ui-root')?.innerText ?? '')).replace(/\s+/g, ' ').slice(0, 1500)}`);
  }
  say(`CHAOS ${JSON.stringify(await page.evaluate(() => window.__pt.chaosLog))}`);
} catch (e) {
  say(`EXCEPTION ${e}`);
  try {
    await page.screenshot({ path: `${OUT}/${tag}-exception.png` });
  } catch {}
}
say(`errors ${JSON.stringify(errors)}`);
say(`wall ${((Date.now() - t0) / 1000).toFixed(0)} s`);
fs.writeFileSync(`${OUT}/${tag}-log.txt`, out.join('\n'));
await browser.close();
