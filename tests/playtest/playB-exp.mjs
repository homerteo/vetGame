// playtest-B: experimentos dirigidos (sierra/acordes con ratón real, calor, rotación, tornillos, fresa/médula, caos).
// Uso: PORT=5322 node tests/playtest/playB-exp.mjs <saw5|burr4|chaos3>
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const PORT = process.env.PORT ?? '5322';
const OUT = 'screenshots/polish/playtest-B';
const which = process.argv[2] ?? 'saw5';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, baseURL: `http://127.0.0.1:${PORT}` });
await ctx.addInitScript(() => {
  try {
    localStorage.removeItem('dra-emiliana-save-v1');
  } catch {}
});
await ctx.addInitScript({ path: 'tests/playtest/playB-driver.js' });
const page = await ctx.newPage();
page.setDefaultTimeout(240000);
const errors = [];
page.on('pageerror', (e) => errors.push(`${e.message}\n${e.stack ?? ''}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
const lines = [];
const say = (...a) => {
  const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  lines.push(s);
  console.log(`[${which}] ${s}`);
};
const ev = (fn, arg) => page.evaluate(fn, arg);
const shot = async (name) => {
  await ev(() => window.__pump(2));
  await page.screenshot({ path: `${OUT}/exp-${which}-${name}.png`, timeout: 240000 });
  say(`captura exp-${which}-${name}.png`);
};
/** Juega con el piloto hasta el paso indicado. */
async function playTo(caseIdx, stopAt, stopAtStep, extra = {}) {
  await page.goto(`/?case=${caseIdx}&skip=clinic&seed=7`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(() => window.__game?.mode === 'surgery', null, { timeout: 240000 });
  await ev(
    (o) => {
      window.__game.advance(5.7);
      window.__pt.opts = o;
      window.__pt.chaosPolicy = o.chaos ?? 'respond';
      window.__pt.play(40).catch((e) => (window.__pt.result = { error: String(e) }));
    },
    { stopAt, stopAtStep, ...extra },
  );
  let seen = 0;
  for (;;) {
    const r = await ev((seen) => ({ logs: window.__pt.logs.slice(seen), shot: window.__pt.shotReq, result: window.__pt.result }), seen);
    seen += r.logs.length;
    for (const l of r.logs) say(l);
    if (r.shot) {
      await ev(() => window.__pump(2));
      await page.screenshot({ path: `${OUT}/exp-${which}-${r.shot}.png`, timeout: 240000 });
      await ev(() => (window.__pt.shotReq = null));
    }
    if (r.result) return r.result;
    await page.waitForTimeout(700);
  }
}
const faults = () => ev(() => window.__game.surgery().ctx().log.faults());
const st = () => ev(() => window.__game.surgery().state());
const T = (code) => ev(code);

try {
  if (which === 'saw5') {
    const r = await playTo(5, 'saw', null, { chaos: 'respond' });
    say('stop', r);
    const arc = await ev(() => window.__pt.densify(window.__game.surgery().stepParams().path, 1));
    const px = await ev((pts) => pts.map((p) => window.__game.surgery().project(p)), arc);
    const cut = () => ev(() => document.querySelector('.prog-check')?.textContent.trim());
    say('arco (mm→px) de', arc[0], px[0], 'a', arc[arc.length - 1], px[px.length - 1]);
    // A1: RATÓN REAL — primero botón derecho (irrigar), luego izquierdo (sierra), recorrer 10 puntos.
    await page.mouse.move(px[0].x, px[0].y);
    await page.mouse.down({ button: 'right' });
    await ev(() => window.__game.advance(0.05));
    await page.mouse.down({ button: 'left' });
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(px[i].x, px[i].y);
      await ev(() => window.__game.advance(0.1));
    }
    say('A1 derecho→izquierdo (ratón real), tras 10 mm:', await cut(), 'medidores', await ev(() => window.__pt.gauges()));
    await page.mouse.up({ button: 'left' });
    await page.mouse.up({ button: 'right' });
    await ev(() => window.__game.advance(0.3));
    // A2: RATÓN REAL — izquierdo primero y luego derecho.
    await page.mouse.move(px[0].x, px[0].y);
    await page.mouse.down({ button: 'left' });
    await ev(() => window.__game.advance(0.05));
    await page.mouse.down({ button: 'right' });
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(px[i].x, px[i].y);
      await ev(() => window.__game.advance(0.1));
    }
    say('A2 izquierdo→derecho (ratón real), tras 10 mm:', await cut(), 'medidores', await ev(() => window.__pt.gauges()));
    await page.mouse.up({ button: 'right' });
    await page.mouse.up({ button: 'left' });
    await ev(() => window.__game.advance(3));
    // A3: sierra SIN irrigar, sin pausas, a 8 mm/s por el resto del arco (piloto en página).
    const f0 = await faults();
    const dry = (from, to) =>
      ev(
        ([from, to]) => {
          const T = window.__pt;
          const path = T.densify(window.__game.surgery().stepParams().path, 0.5);
          const trace = [];
          T.move(path[from]);
          T.down(path[from]);
          for (let i = from + 1; i < Math.min(to, path.length) && T.st().stepType === 'saw'; i++) {
            T.move(path[i]);
            T.adv(0.0625);
            if (i % 6 === 0) trace.push([+T.st().t.toFixed(1), T.gauges()['Temperatura'], T.hint()]);
          }
          if (T.buttons) T.up(null);
          return trace;
        },
        [from, to],
      );
    say('A3 sin irrigar (1ª mitad): [t, °C, pista]', await dry(0, 30));
    await shot('saw-dry-hot');
    say('A3 sin irrigar (resto)', await dry(30, 999));
    say('A3 faltas nuevas', (await faults()).slice(f0.length));
    await ev(() => window.__game.advance(2.5));
    say('estado', await st());
    // ── Rotación: Q/E y sobrerrotación ──
    for (let i = 0; i < 20 && (await st()).stepType !== 'rotate'; i++) await ev(() => window.__game.advance(0.5));
    const rot = await ev(() => {
      const T = window.__pt;
      const out = [];
      const f0 = T.ctx().log.faults().length;
      T.keyDown('KeyE');
      for (let i = 0; i < 8; i++) {
        T.adv(0.2);
        out.push(['E', i, T.gauges()['Ángulo de meseta tibial']]);
      }
      T.keyUp('KeyE');
      T.adv(0.05);
      out.push(['soltar E', T.gauges()['Ángulo de meseta tibial'], T.hud().pops, T.hint()]);
      out.push(['faltas', T.ctx().log.faults().slice(f0)]);
      return out;
    });
    say('rotación con E 1,6 s', rot);
    await shot('rotate-overshoot');
    const rot2 = await ev(() => {
      const T = window.__pt;
      const out = [];
      T.keyDown('KeyQ');
      for (let i = 0; i < 200; i++) {
        T.adv(0.02);
        const v = T.gauges()['Ángulo de meseta tibial'];
        if (v >= 5) {
          out.push(['Q hasta', v]);
          break;
        }
      }
      T.keyUp('KeyQ');
      T.adv(0.05);
      out.push(['soltar Q', T.gauges(), T.hud().pops, T.hint(), T.st().stepType]);
      return out;
    });
    say('rotación vuelta con Q', rot2);
    await shot('rotate-locked');
    say('aguja', await ev(() => {
      const T = window.__pt;
      T.click(T.prm().pinSpot);
      T.adv(2.5);
      return [T.hud().pops, T.st().stepType];
    }));
    // placa con el piloto y parar en tornillos
    await ev(() => {
      window.__pt.result = null;
      window.__pt.opts.stopAt = 'screws';
      window.__pt.play(10);
    });
    let r3;
    for (;;) {
      r3 = await ev(() => window.__pt.result);
      if (r3) break;
      await page.waitForTimeout(700);
    }
    say('stop tornillos', r3);
    // B1: sin tocar nada, ¿cuánto tarda el tornillo en caer?
    const catchT = await ev(() => {
      const T = window.__pt;
      const t0 = T.st().t;
      const out = [];
      for (let i = 0; i < 100; i++) {
        const r = document.querySelector('.sc-root .sc-ring');
        const m = r?.style.transform.match(/scale\(([\d.]+)\)/);
        out.push([+(T.st().t - t0).toFixed(2), m ? +Number(m[1]).toFixed(2) : null]);
        if (/Se cayó/.test(T.hint())) return { droppedAfter: +(T.st().t - t0).toFixed(2), trace: out.filter((_, i) => i % 3 === 0) };
        T.adv(0.05);
      }
      return { droppedAfter: null, trace: out };
    });
    say('B1 tornillo sin pulsar: cae tras', catchT);
    // esperar repuesto
    await ev(() => {
      const T = window.__pt;
      T.key('Space');
      T.adv(5.3);
    });
    await shot('screw-catch');
    // atrapar a tiempo
    say('atrapar', await ev(() => {
      const T = window.__pt;
      for (let i = 0; i < 300; i++) {
        const r = document.querySelector('.sc-root:not(.sc-perfect):not(.sc-good):not(.sc-miss) .sc-ring');
        const m = r?.style.transform.match(/scale\(([\d.]+)\)/);
        if (m && Number(m[1]) <= 1.04) {
          T.key('Space');
          break;
        }
        T.adv(0.02);
      }
      T.adv(0.8);
      return T.hint();
    }));
    // B2: piloto con el clic mantenido sin soltar (jugador ingenuo), presión 3
    const f1 = await faults();
    const pilot = await ev(() => {
      const T = window.__pt;
      const hole = T.ctx().bone.plateHolesWorld()[0];
      const out = [];
      T.move(hole);
      T.down(hole);
      for (let i = 0; i < 400; i++) {
        T.adv(0.05);
        const h = T.hint();
        if (i % 10 === 0) out.push([+(i * 0.05).toFixed(1), T.gauges()['Temperatura'], T.gauges()['Profundidad'], h.slice(0, 50)]);
        if (/Salida/.test(h)) {
          out.push(['SALIDA', +(i * 0.05).toFixed(1), T.gauges()['Temperatura']]);
          break;
        }
      }
      T.up(hole);
      T.adv(0.2);
      out.push(['fin', T.hint(), T.hud().pops]);
      return out;
    });
    say('B2 piloto sin soltar', pilot);
    say('B2 faltas nuevas', (await faults()).slice(f1.length));
  }
  if (which === 'burr4') {
    say('stop', await playTo(4, 'burr', null, { chaos: 'respond' }));
    const prm = await ev(() => window.__game.surgery().stepParams());
    const cordMaxY = Math.max(...prm.forbidden.map((p) => p.y));
    say('médula: y máx', cordMaxY, 'área', prm.area, 'brush', prm.brushMm);
    // C1: fresar pegado a la médula (y = borde + 1,5 mm), irrigando
    const f0 = await faults();
    const near = await ev((y) => {
      const T = window.__pt;
      const out = [];
      T.keyDown('KeyI');
      const line = T.densify([{ x: 67, y }, { x: 80, y }], 0.6);
      T.move(line[0]);
      T.down(line[0]);
      for (let i = 1; i < line.length; i++) {
        T.move(line[i]);
        T.adv(0.04);
      }
      out.push([T.hud(), T.hint(), T.ctx().emiliana.snapshot().concentration]);
      return out;
    }, cordMaxY + 1.5);
    say('C1 junto a la médula (botón aún pulsado)', near);
    await shot('burr-cord');
    await ev(() => {
      const T = window.__pt;
      T.up(null);
      T.keyUp('KeyI');
      T.adv(0.5);
    });
    say('C1 faltas nuevas', (await faults()).slice(f0.length));
    // C2: fresado continuo irrigando (I) sin pausas, zigzag lento dentro del área, 16 s
    const f1 = await faults();
    const cont = await ev((minY) => {
      const T = window.__pt;
      const out = [];
      T.keyDown('KeyI');
      const pts = [];
      for (let k = 0; k < 12; k++) {
        const y = Math.max(minY, 54 + (k % 4) * 1.8);
        pts.push(...T.densify(k % 2 ? [{ x: 89, y }, { x: 67, y }] : [{ x: 67, y }, { x: 89, y }], 0.4));
      }
      T.move(pts[0]);
      T.down(pts[0]);
      let t = 0;
      for (let i = 1; i < pts.length && t < 16; i++) {
        T.move(pts[i]);
        T.adv(0.04);
        t += 0.04;
        if (i % 25 === 0) out.push([+t.toFixed(1), T.gauges()['Temperatura'], T.gauges()['Retirado'], T.hint()]);
        if (T.st().stepType !== 'burr') {
          out.push(['paso terminado a', +t.toFixed(1)]);
          break;
        }
      }
      if (T.buttons) T.up(null);
      T.keyUp('KeyI');
      return out;
    }, cordMaxY + prm.brushMm + 0.4);
    say('C2 fresa continua irrigando', cont);
    say('C2 faltas nuevas', (await faults()).slice(f1.length));
    // seguir hasta la extracción de disco
    await ev(() => {
      window.__pt.result = null;
      window.__pt.opts.stopAt = 'pick';
      window.__pt.play(10);
    });
    let r3;
    for (;;) {
      r3 = await ev(() => window.__pt.result);
      if (r3) break;
      await page.waitForTimeout(700);
    }
    say('stop pick', r3);
    const f2 = await faults();
    say('C3 pinzas sobre el borde de la médula', await ev((y) => {
      const T = window.__pt;
      T.click({ x: 79, y }, 0.3);
      T.adv(0.1);
      return [T.hud(), T.gauges()];
    }, cordMaxY + 0.5));
    say('C3 faltas nuevas', (await faults()).slice(f2.length));
  }
  if (which === 'real') {
    // ¿Llegan los eventos del ratón REAL (page.mouse) al canvas? ¿Qué elemento hay bajo cada punto de la herida?
    await page.goto(`/?case=3&skip=clinic&seed=7`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await page.waitForFunction(() => window.__game?.mode === 'surgery', null, { timeout: 240000 });
    await ev(() => {
      window.__game.advance(5.7);
      window.__evlog = [];
      for (const t of ['pointerdown', 'pointermove', 'pointerup'])
        window.addEventListener(t, (e) => window.__evlog.push([t, e.button, e.buttons, e.target?.id || e.target?.className || e.target?.tagName, e.isTrusted]), true);
    });
    const grid = await ev(() => {
      const out = [];
      for (const [x, y] of [[30, 50], [60, 50], [80, 50], [100, 50], [130, 50], [41, 39], [41, 61], [80, 36], [80, 64]]) {
        const p = window.__game.surgery().project({ x, y });
        const el = document.elementFromPoint(p.x, p.y);
        out.push([x, y, Math.round(p.x), Math.round(p.y), el?.id || el?.className || el?.tagName]);
      }
      return out;
    });
    say('elementFromPoint en la herida', grid);
    const path = await ev(() => window.__pt.densify(window.__game.surgery().stepParams().path, 3));
    const px = await ev((pts) => pts.map((p) => window.__game.surgery().project(p)), path);
    await page.mouse.wheel(0, -100); // presión 4
    await ev(() => window.__game.advance(0.05));
    await page.mouse.move(px[0].x, px[0].y);
    await page.mouse.down();
    for (let i = 1; i < px.length; i++) {
      await page.mouse.move(px[i].x, px[i].y);
      await ev(() => window.__game.advance(0.06));
    }
    await page.mouse.up();
    await ev(() => window.__game.advance(0.1));
    say('tras un trazo con ratón real:', await ev(() => [window.__pt.check(), window.__pt.hint(), window.__game.surgery().state().progress, window.__pt.gauges()]));
    say('eventos vistos (primeros 6, últimos 3)', await ev(() => [window.__evlog.length, window.__evlog.slice(0, 6), window.__evlog.slice(-3)]));
    // acorde real izq→der: ¿qué llega?
    await ev(() => (window.__evlog = []));
    await page.mouse.move(px[2].x, px[2].y);
    await page.mouse.down({ button: 'left' });
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(px[3].x, px[3].y);
    await page.mouse.up({ button: 'right' });
    await page.mouse.up({ button: 'left' });
    await page.mouse.down({ button: 'right' });
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(px[4].x, px[4].y);
    await page.mouse.up({ button: 'left' });
    await page.mouse.up({ button: 'right' });
    say('acordes reales: eventos', await ev(() => window.__evlog));
  }
  if (which === 'saw5b') {
    say('stop', await playTo(5, 'saw', null, { chaos: 'ignore' }));
    await ev(() => window.__game.advance(2)); // fin del intersticial de fase (1,6 s)
    const arc = await ev(() => window.__pt.densify(window.__game.surgery().stepParams().path, 1));
    const px = await ev((pts) => pts.map((p) => window.__game.surgery().project(p)), arc);
    const cut = () => ev(() => document.querySelector('.prog-check')?.textContent.trim());
    const realPass = async (first, second, from, to) => {
      await page.mouse.move(px[from].x, px[from].y);
      await page.mouse.down({ button: first });
      await ev(() => window.__game.advance(0.05));
      await page.mouse.down({ button: second });
      for (let i = from + 1; i <= to; i++) {
        await page.mouse.move(px[i].x, px[i].y);
        await ev(() => window.__game.advance(0.1));
      }
      const r = [await cut(), await ev(() => window.__pt.gauges())];
      await page.mouse.up({ button: second });
      await page.mouse.up({ button: first });
      await ev(() => window.__game.advance(0.3));
      return r;
    };
    say('A1 ratón real: derecho (irrigar) y luego izquierdo (sierra), 8 mm:', await realPass('right', 'left', 0, 8));
    say('A2 ratón real: izquierdo y luego derecho, 8 mm:', await realPass('left', 'right', 0, 8));
    say('A1b de nuevo derecho→izquierdo por un tramo nuevo (8→16):', await realPass('right', 'left', 8, 16));
    // terminar la sierra con el piloto (I), rotación, aguja; parar en la placa
    await ev(() => {
      window.__pt.result = null;
      window.__pt.opts.stopAt = 'plate';
      window.__pt.play(10);
    });
    let r3;
    for (;;) {
      r3 = await ev(() => window.__pt.result);
      if (r3) break;
      await page.waitForTimeout(700);
    }
    say('stop placa', r3);
    // placa con el piloto; medir desde que la placa se asienta hasta que cae el tornillo sin pulsar nada
    const drop = await ev(async () => {
      const T = window.__pt;
      T.adv(2);
      await T.P.plate(T.prm());
      const t0 = T.st().t;
      const tr = [];
      for (let i = 0; i < 80; i++) {
        const r = document.querySelector('.sc-root .sc-ring');
        const m = r?.style.transform.match(/scale\(([\d.]+)\)/);
        tr.push([+(T.st().t - t0).toFixed(2), m ? +Number(m[1]).toFixed(2) : null]);
        if (/Se cayó/.test(T.hint())) return { stepNow: T.st().stepType, droppedAfterSec: +(T.st().t - t0).toFixed(2), ring: tr };
        T.adv(0.05);
      }
      return { droppedAfterSec: null, ring: tr };
    });
    say('B1 tras asentar la placa, sin pulsar: el tornillo cae a los', drop);
    await ev(() => {
      const T = window.__pt;
      T.key('Space');
      T.adv(4.9);
    });
    const c2 = await ev(() => {
      const T = window.__pt;
      const tr = [];
      for (let i = 0; i < 300; i++) {
        const r = document.querySelector('.sc-root:not(.sc-perfect):not(.sc-good):not(.sc-miss) .sc-ring');
        const m = r?.style.transform.match(/scale\(([\d.]+)\)/);
        if (m) tr.push(+Number(m[1]).toFixed(2));
        if (m && Number(m[1]) <= 1.04) {
          T.key('Space');
          T.adv(0.8);
          return { pressedAtScale: +m[1], afterMs: tr.length * 20, hint: T.hint(), pops: T.hud().pops };
        }
        T.adv(0.02);
      }
      return { tr, hint: T.hint() };
    });
    say('B1b repuesto atrapado', c2);
    // B2: piloto con el clic mantenido (jugador ingenuo), presión 3
    const f1 = await faults();
    const pilot = await ev(() => {
      const T = window.__pt;
      const m = T.check().match(/Tornillos \((\d+)\//);
      const hole = T.ctx().bone.plateHolesWorld()[m ? Number(m[1]) : 0];
      const out = [];
      T.move(hole);
      T.down(hole);
      for (let i = 0; i < 600; i++) {
        T.adv(0.05);
        const h = T.hint();
        if (i % 10 === 0) out.push([+(i * 0.05).toFixed(1), T.gauges()['Temperatura'], T.gauges()['Profundidad'], h.slice(0, 40)]);
        if (/Salida/.test(h)) {
          out.push(['SALIDA', +(i * 0.05).toFixed(1), T.gauges()['Temperatura']]);
          break;
        }
      }
      T.up(hole);
      T.adv(0.2);
      out.push(['fin', T.hint(), T.hud().pops]);
      return out;
    });
    say('B2 piloto sin soltar (presión 3)', pilot);
    say('B2 faltas nuevas', (await faults()).slice(f1.length));
    await shot('pilot-hot');
    // medir y apretar; luego medir cuánto tarda en caer el siguiente
    const next = await ev(() => {
      const T = window.__pt;
      const prm = T.prm();
      const hm = T.hint().match(/Mide ([\d,]+) mm/);
      const depth = hm ? Number(hm[1].replace(',', '.')) : 25;
      const sorted = [...prm.lengthOptionsMm].sort((a, b) => a - b);
      const ideal = sorted.find((o) => o >= depth) ?? sorted[sorted.length - 1];
      T.key(`Digit${prm.lengthOptionsMm.indexOf(ideal) + 1}`);
      const m = T.check().match(/Tornillos \((\d+)\//);
      const hole = T.ctx().bone.plateHolesWorld()[m ? Number(m[1]) : 0];
      T.move(hole);
      T.down(hole);
      for (let i = 0; i < 40; i++) {
        T.adv(0.05);
        if ((T.gauges()['Torque'] ?? 0) >= 0.8) break;
      }
      T.up(hole);
      const t0 = T.st().t;
      for (let i = 0; i < 80; i++) {
        T.adv(0.05);
        if (/Se cayó/.test(T.hint())) return { droppedAfterSec: +(T.st().t - t0).toFixed(2) };
      }
      return { droppedAfterSec: null, hint: T.hint() };
    });
    say('B3 tras apretar un tornillo, sin pulsar: el siguiente cae a los', next);
  }
  if (which === 'sawdbg') {
    say('stop', await playTo(5, 'saw', null, { chaos: 'ignore' }));
    await ev(() => window.__game.advance(2));
    await ev(() => {
      window.__evlog = [];
      for (const t of ['pointerdown', 'pointermove', 'pointerup'])
        window.addEventListener(t, (e) => window.__evlog.push([t, e.button, e.buttons, e.target?.id || e.target?.tagName, e.isTrusted]), true);
    });
    const arc = await ev(() => window.__pt.densify(window.__game.surgery().stepParams().path, 1));
    const px = await ev((pts) => pts.map((p) => window.__game.surgery().project(p)), arc);
    // (1) real, solo botón izquierdo
    await page.mouse.move(px[0].x, px[0].y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(px[i].x, px[i].y);
      await ev(() => window.__game.advance(0.1));
    }
    say('real solo izq:', await ev(() => [window.__pt.check(), window.__pt.gauges(), window.__game.surgery().state().instrument, window.__evlog.slice(0, 4), window.__evlog.length]));
    await page.mouse.up();
    await ev(() => window.__game.advance(0.2));
    // (2) sintético solo izquierdo
    say('sintético solo izq:', await ev((arc) => {
      const T = window.__pt;
      T.drag(arc.slice(6, 14), 0.1);
      return [T.check(), T.gauges()];
    }, arc));
    // (3) sintético acorde izq→der
    say('sintético izq→der:', await ev((arc) => {
      const T = window.__pt;
      T.move(arc[14]);
      T.down(arc[14], 0);
      T.adv(0.05);
      T.down(arc[14], 2);
      for (let i = 15; i < 22; i++) {
        T.move(arc[i]);
        T.adv(0.1);
      }
      const r = [T.check(), T.gauges()];
      T.up(null, 2);
      T.up(null, 0);
      return r;
    }, arc));
    // (4) sintético acorde der→izq
    say('sintético der→izq:', await ev((arc) => {
      const T = window.__pt;
      T.move(arc[22]);
      T.down(arc[22], 2);
      T.adv(0.05);
      T.down(arc[22], 0);
      for (let i = 23; i < 30; i++) {
        T.move(arc[i]);
        T.adv(0.1);
      }
      const r = [T.check(), T.gauges()];
      T.up(null, 0);
      T.up(null, 2);
      return r;
    }, arc));
  }
  if (which === 'screws5') {
    say('stop', await playTo(5, 'plate', null, { chaos: 'ignore' }));
    const r = await ev(async () => {
      const T = window.__pt;
      const out = {};
      T.adv(2);
      await T.P.plate(T.prm());
      // (1) atrapar el primero en cuanto el anillo se cierra
      for (let i = 0; i < 300; i++) {
        const el = document.querySelector('.sc-root:not(.sc-perfect):not(.sc-good):not(.sc-miss) .sc-ring');
        const m = el?.style.transform.match(/scale\(([\d.]+)\)/);
        if (m && Number(m[1]) <= 1.04) {
          out.catchAfter = +(i * 0.02).toFixed(2);
          T.key('Space');
          break;
        }
        T.adv(0.02);
      }
      T.adv(0.8);
      out.afterCatch = T.hint();
      // (2) piloto manteniendo el clic sin soltar (presión 3 por defecto)
      const f0 = T.ctx().log.faults().length;
      const hole = T.ctx().bone.plateHolesWorld()[0];
      const tr = [];
      T.move(hole);
      T.down(hole);
      for (let i = 0; i < 600; i++) {
        T.adv(0.05);
        const h = T.hint();
        if (i % 10 === 0) tr.push([+(i * 0.05).toFixed(1), T.gauges()['Temperatura'], +(T.gauges()['Profundidad'] ?? 0).toFixed(1), h.slice(0, 45)]);
        if (/Salida/.test(h)) {
          tr.push(['SALIDA', +(i * 0.05).toFixed(1), T.gauges()['Temperatura']]);
          break;
        }
      }
      T.up(hole);
      T.adv(0.2);
      out.pilotNaive = tr;
      out.pilotFaults = T.ctx().log.faults().slice(f0);
      out.pilotPops = T.hud().pops;
      out.afterPilot = T.hint();
      return out;
    });
    say('tornillo 1', r);
    await shot('screws-after-naive-pilot');
    const r2 = await ev(() => {
      const T = window.__pt;
      const out = {};
      const prm = T.prm();
      const hm = T.hint().match(/Mide ([\d,]+) mm/);
      const depth = hm ? Number(hm[1].replace(',', '.')) : 25;
      const sorted = [...prm.lengthOptionsMm].sort((a, b) => a - b);
      const ideal = sorted.find((o) => o >= depth) ?? sorted[sorted.length - 1];
      T.key(`Digit${prm.lengthOptionsMm.indexOf(ideal) + 1}`);
      const hole = T.ctx().bone.plateHolesWorld()[0];
      T.move(hole);
      T.down(hole);
      for (let i = 0; i < 40; i++) {
        T.adv(0.05);
        if ((T.gauges()['Torque'] ?? 0) >= 0.8) break;
      }
      T.up(hole);
      const t0 = T.st().t;
      for (let i = 0; i < 80; i++) {
        T.adv(0.05);
        if (/Se cayó/.test(T.hint())) {
          out.nextDropsAfter = +(T.st().t - t0).toFixed(2);
          break;
        }
      }
      // (3) pulsar Espacio enseguida (durante la pausa de 0,7 s) y ver si pide el repuesto
      T.key('Space');
      T.adv(1.0);
      out.afterEarlySpace = T.hint();
      out.panelVisible = !!document.querySelector('.sb-drop');
      T.key('Space');
      T.adv(0.2);
      out.afterSecondSpace = T.hint();
      return out;
    });
    say('tornillo 2', r2);
  }
  if (which === 'curtain') {
    // ¿La cortina del intersticial entre fases sigue tapando el canvas después de terminar?
    await page.goto(`/?case=3&skip=clinic&seed=7`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await page.waitForFunction(() => window.__game?.mode === 'surgery', null, { timeout: 240000 });
    await ev(() => window.__game.advance(5.7));
    const probe = () =>
      ev(() => {
        const p = window.__game.surgery().project({ x: 80, y: 50 });
        const el = document.elementFromPoint(p.x, p.y);
        const host = document.querySelector('.scr')?.parentElement;
        const scr = document.querySelector('.scr');
        return {
          t: +window.__game.surgery().state().t.toFixed(1),
          step: window.__game.surgery().state().stepType,
          top: el ? `${el.tagName}.${el.className}` : null,
          scr: scr ? { cls: scr.className, opacity: getComputedStyle(scr).opacity, pe: getComputedStyle(scr).pointerEvents } : null,
          host: host ? { id: host.id, cls: host.className, display: getComputedStyle(host).display, pe: getComputedStyle(host).pointerEvents } : null,
        };
      });
    say('antes (fase 1)', await probe());
    // incisión con el piloto (eventos sobre el canvas) hasta pasar a la hemostasia
    await ev(async () => {
      const T = window.__pt;
      await T.P.incision(T.prm());
    });
    say('justo al cambiar de fase', await probe());
    // tiempo REAL para que terminen los temporizadores del intersticial (1,6 s) y su fundido
    await page.waitForTimeout(4000);
    await ev(() => window.__game.advance(2));
    say('4 s reales después', await probe());
    // clic REAL con el cauterio sobre el primer sangrado activo, mantenido 1,4 s
    const b = await ev(() => window.__game.surgery().ctx().bleeding.active().map((x) => x.pos)[0]);
    const p = await ev((m) => window.__game.surgery().project(m), b);
    await ev(() => {
      window.__evlog = [];
      for (const t of ['pointerdown', 'pointerup'])
        window.addEventListener(t, (e) => window.__evlog.push([t, e.target?.tagName + '.' + e.target?.className]), true);
    });
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await ev(() => window.__game.advance(1.4));
    await page.mouse.up();
    await ev(() => window.__game.advance(0.1));
    say('clic real con cauterio', b, await ev(() => [window.__evlog, window.__pt.check(), window.__pt.hud().pops, window.__game.surgery().ctx().bleeding.active().length]));
    await page.mouse.wheel(0, -100);
    say('rueda real tras el intersticial: presión', await ev(() => window.__pt.gauges()));
    await shot('after-interstitial');
  }
  if (which === 'pick4') {
    say('stop', await playTo(4, 'pick', null, { chaos: 'ignore' }));
    await ev(() => window.__game.advance(2));
    const cordMaxY = await ev(() => Math.max(...window.__game.surgery().stepParams().forbidden.map((p) => p.y)));
    const f0 = await faults();
    say('D1 pinzas a 0,5 mm de la médula', await ev((y) => {
      const T = window.__pt;
      T.click({ x: 79, y }, 0.3);
      T.adv(0.1);
      return [T.hud(), T.gauges(), T.hint(), T.ctx().emiliana.snapshot().concentration];
    }, cordMaxY + 0.5));
    say('D1 faltas nuevas', (await faults()).slice(f0.length));
    const f1 = await faults();
    say('D2 agarrar disco y arrastrarlo hacia la médula', await ev((y) => {
      const T = window.__pt;
      const it = T.prm().items[0];
      T.drag([it.pos, { x: it.pos.x, y: y + 2 }, { x: it.pos.x, y: y + 0.3 }], 0.1);
      T.adv(0.1);
      return [T.hud(), T.gauges(), T.check()];
    }, cordMaxY));
    say('D2 faltas nuevas', (await faults()).slice(f1.length));
  }
  if (which === 'chaos3') {
    say('stop', await playTo(3, 'saw', null, { chaos: 'respond', gigiDomina: true, shots: ['chaos-'] }));
    say('chaosLog', await ev(() => window.__pt.chaosLog));
  }
} catch (e) {
  say('EXCEPTION', String(e), e.stack);
}
say('errors', errors);
fs.writeFileSync(`${OUT}/exp-${which}-log.txt`, lines.join('\n'));
await browser.close();
