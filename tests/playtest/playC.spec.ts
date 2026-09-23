// playtest-C: casos 6 (Copito) y 7 (Rayo) con entradas reales, y flujo meta completo.
// Uso: PORT=5323 npx playwright test -c tests/playtest/playwright.playtest.config.ts playC [-g "caso 6"]
// Reglas: en los casos 6/7 NUNCA se usa forceCompleteStep; solo lectura (state/ctx/project/stepParams)
// y __game.advance para mover el tiempo de juego (el navegador headless renderiza a ~4 fps).
import { expect, test, type Page } from '@playwright/test';

const OUT = 'screenshots/polish/playtest-C';

type V = { x: number; y: number };

function helpers(page: Page, tag: string) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${e.message}\n${e.stack ?? ''}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  const H = {
    errors,
    log(...a: unknown[]) {
      console.log(`[${tag}]`, ...a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))));
    },
    adv: (sec: number) => page.evaluate((s) => (window as any).__game.advance(s), sec),
    state: () => page.evaluate(() => (window as any).__game.surgery()?.state() ?? null),
    params: () => page.evaluate(() => (window as any).__game.surgery()?.stepParams() ?? null),
    proj: (mm: V) => page.evaluate((m) => (window as any).__game.surgery().project(m) as V, mm),
    projMany: (pts: V[]) => page.evaluate((ps) => ps.map((m) => (window as any).__game.surgery().project(m) as V), pts),
    async hud() {
      return page.evaluate(() => {
        const q = (sel: string) => [...document.querySelectorAll(sel)].map((e) => (e.textContent ?? '').trim()).filter(Boolean);
        return {
          hint: q('.prog-hint').join(' | '),
          check: q('.prog-check').join(' | '),
          alerts: q('.hud-alerts > *'),
          toasts: q('.hud-toasts > *'),
          pops: q('.hud-pops > *'),
          gauges: q('.hud-gauges .gauge'),
        };
      });
    },
    async vitals() {
      return page.evaluate(() => {
        const c = (window as any).__game.surgery().ctx();
        const v = c.vitals.snapshot();
        const e = c.emiliana.snapshot();
        return { exito: +v.exito.toFixed(1), temp: +v.tempC.toFixed(2), hr: Math.round(v.hr), lost: +v.bloodLostPct.toFixed(1), conc: Math.round(e.concentration), tremor: +c.emiliana.tremorMm().toFixed(2), faults: c.log.faults() };
      });
    },
    async shot(name: string) {
      await page.waitForTimeout(1200); // deja pintar un fotograma (rAF limitado)
      await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 120_000 });
    },
    /** Botón izquierdo mantenido a lo largo de una lista de puntos mm, con dt de juego entre puntos. */
    async dragMm(pts: V[], dt = 0.05, opts: { keepDown?: boolean; during?: (i: number) => Promise<void> } = {}) {
      const px = await H.projMany(pts);
      await page.mouse.move(px[0].x, px[0].y);
      await page.mouse.down();
      await H.adv(dt);
      for (let i = 1; i < px.length; i++) {
        await page.mouse.move(px[i].x, px[i].y);
        await H.adv(dt);
        if (opts.during) await opts.during(i);
      }
      if (!opts.keepDown) await page.mouse.up();
    },
    async clickMm(mm: V, holdSec = 0.05) {
      const p = await H.proj(mm);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await H.adv(holdSec);
      await page.mouse.up();
      return p;
    },
    async key(code: string, holdSec = 0.05) {
      await page.keyboard.down(code);
      await H.adv(holdSec);
      await page.keyboard.up(code);
    },
    /** Mantiene el ratón sobre mm y taladra: avanza en pasos hasta que `until` sea true o se agote el tiempo. */
    async waitStep(type: string | null, maxSec = 10) {
      for (let i = 0; i < maxSec / 0.25; i++) {
        const s: any = await H.state();
        if (!s || s.stepType === type || s.finished) return s;
        await H.adv(0.25);
      }
      return H.state();
    },
  };
  return H;
}

type Hx = ReturnType<typeof helpers>;

/**
 * Aligera el render headless (swiftshader con la máquina cargada): los callbacks de rAF solo se
 * ejecutan cada `window.__rafMs` ms. El tiempo de juego se mueve con __game.advance, así que la
 * lógica no cambia; solo se pintan menos fotogramas. `window.__rafMs = 0` restaura el ritmo normal.
 */
export async function throttleRaf(page: Page, ms = 350) {
  await page.addInitScript((m) => {
    (window as any).__rafMs = m;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      const at = performance.now();
      const tick = (ts: number) => {
        if (ts - at < ((window as any).__rafMs ?? 0)) return void raf(tick);
        cb(ts);
      };
      return raf(tick);
    };
  }, ms);
}

async function openSurgery(page: Page, index: number, seed = 7) {
  await throttleRaf(page);
  await page.goto(`/?case=${index}&skip=clinic&seed=${seed}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__game?.mode === 'surgery', null, { timeout: 120_000 });
  // Deja terminar la intro y la transición de cámara.
  await page.evaluate(() => (window as any).__game.advance(4.5));
  await page.waitForTimeout(1500);
}

/** Taladra un orificio: mantener clic, soltar al "¡Salida!" (breakthrough) o para enfriar. */
async function drillHole(page: Page, H: Hx, spot: V, stepType = 'drillPins') {
  const p = await H.proj(spot);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  let peak = 0;
  let res: any = null;
  for (let round = 0; round < 12; round++) {
    // Bucle dentro de la página: avanza 50 ms de juego y lee el HUD como lo haría el jugador.
    res = await page.evaluate((stepType) => {
      let peak = 0;
      for (let i = 0; i < 400; i++) {
        (window as any).__game.advance(0.05);
        const g = [...document.querySelectorAll('.hud-gauges .gauge')].map((e) => (e.textContent ?? '').trim());
        const hint = (document.querySelector('.prog-hint')?.textContent ?? '').trim();
        const heatTxt = g.find((x) => /Temperatura/.test(x)) ?? '';
        const heat = Number((heatTxt.match(/([\d,]+)\s*°C/)?.[1] ?? '0').replace(',', '.'));
        const depth = g.find((x) => /Profundidad/.test(x)) ?? '';
        peak = Math.max(peak, heat);
        if (/Salida/.test(hint)) return { why: 'salida', peak, depth, i };
        if (heat >= 45) return { why: 'calor', peak, depth, i };
        const st = (window as any).__game.surgery()?.state();
        if (!st || st.stepType !== stepType) return { why: 'paso', peak, depth, i };
        if (stepType === 'screws' && !/Piloto|Salida|taladro en la marca|Broca caliente/.test(hint)) return { why: 'fase', peak, depth, i };
      }
      return { why: 'tiempo', peak, depth: '', i: 400 };
    }, stepType);
    peak = Math.max(peak, res.peak);
    if (res.why === 'calor') {
      await page.mouse.up();
      await H.adv(1.5);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      continue;
    }
    break;
  }
  await H.adv(0.15); // tiempo de reacción humano tras "¡Salida!"
  await page.mouse.up();
  await H.adv(0.1);
  return { ...res, peak };
}

/**
 * SOLO PARA SEGUIR JUGANDO tras el bloqueo del intersticial: la cortina de "Fase N" nunca se
 * desmonta y tapa el lienzo (ver informe playtest-C). Si sigue ahí tras su duración, se oculta.
 */
async function clearStuckInterstitial(page: Page, H: Hx) {
  await page.waitForTimeout(1800);
  const stuck = await page.evaluate(() => {
    const e = document.elementFromPoint(640, 360) as HTMLElement | null;
    const inter = document.querySelector('.scr-inter');
    if (inter && e && inter.contains(e)) {
      (document.querySelector('.emi-screens') as HTMLElement).style.display = 'none';
      return true;
    }
    return false;
  });
  if (stuck) H.log('WORKAROUND: intersticial atascado tapando el lienzo; ocultado a mano');
  return stuck;
}

// ─────────────────────────────── Caso 6: Copito ───────────────────────────────
test('caso 6 Copito: reducción cerrada, agujas frágiles, fijador y vendaje con entradas reales', async ({ page }) => {
  const H = helpers(page, 'c6');
  await openSurgery(page, 6);
  H.log('inicio', await H.state(), await H.vitals());
  await H.shot('c6-01-inicio-micro');

  // ── Fase 1: reducción cerrada ──
  const frag0: any = await page.evaluate(() => {
    const f = (window as any).__game.surgery().ctx().bone.fragment('distalTibia');
    return { pos: f.pose.pos, ang: f.pose.angleDeg, target: f.def.target };
  });
  H.log('fragmento', frag0);
  // Primer disparo de rayos X para ver el hueso.
  await page.keyboard.press('KeyR');
  await H.adv(0.2);
  await H.shot('c6-02-rayosx');
  // Girar con Q hasta ~0°.
  const rotSec = frag0.ang / 60;
  await page.keyboard.down('KeyQ');
  await H.adv(Math.round(rotSec / 0.05) * 0.05);
  await page.keyboard.up('KeyQ');
  // Arrastre lento (≈ 30 mm/s) del fragmento hacia su silueta.
  const from = frag0.pos;
  const to = frag0.target.pos;
  const n = 12;
  const pts: V[] = [];
  for (let i = 0; i <= n; i++) pts.push({ x: from.x + ((to.x - from.x) * i) / n, y: from.y + ((to.y - from.y) * i) / n });
  await H.dragMm(pts, 0.05);
  await H.adv(0.2);
  let s: any = await H.state();
  let err: any = await page.evaluate(() => (window as any).__game.surgery().ctx().bone.alignmentError('distalTibia'));
  H.log('tras reducir', s.stepType, err, await H.hud());
  await H.shot('c6-03-tras-reduccion');
  if (s.stepType === 'reduction') {
    // Segundo intento: otro disparo y corrección fina.
    await page.keyboard.press('KeyR');
    await H.adv(0.2);
    const f: any = await page.evaluate(() => {
      const f = (window as any).__game.surgery().ctx().bone.fragment('distalTibia');
      return { pos: f.pose.pos, ang: f.pose.angleDeg, target: f.def.target };
    });
    H.log('corrección', f);
    await H.dragMm([f.pos, { x: (f.pos.x + f.target.pos.x) / 2, y: (f.pos.y + f.target.pos.y) / 2 }, f.target.pos], 0.1);
    await H.adv(0.2);
    s = await H.state();
  }
  expect(s.stepType, 'la reducción cerrada debe completarse con entradas reales').toBe('drillPins');
  H.log('vitales tras F1', await H.vitals());

  // Espera a que acabe el intersticial.
  await H.adv(2);
  await H.shot('c6-04-agujas');
  await clearStuckInterstitial(page, H);

  // ── Fase 2: agujas en hueso frágil (presión por defecto 3, sin tocar la rueda) ──
  const pins = ((await H.params()) as any).spots as V[];
  const pinPx = await H.projMany(pins);
  H.log('agujas mm→px', pins, pinPx);
  for (let i = 0; i < pins.length; i++) {
    const r = await drillHole(page, H, pins[i]);
    const hud = await H.hud();
    H.log(`aguja ${i + 1}`, r, hud.pops.slice(-3), (await H.vitals()).faults);
    await H.adv(0.3);
    if (i === 1) await H.shot('c6-05-agujas-mitad');
  }
  s = await H.state();
  H.log('tras agujas', s.stepType, await H.vitals());
  expect(s.stepType, 'las 4 agujas deben poder colocarse').toBe('clickTargets');
  await H.adv(2);
  await clearStuckInterstitial(page, H);

  // Hipotermia: pedir la manta a Gigi (toque corto C).
  H.log('temperatura antes de la manta', (await H.vitals()).temp);
  await H.key('KeyC', 0.1);
  await H.adv(0.5);
  H.log('toasts tras C', (await H.hud()).toasts);

  // ── Fase 3: abrazaderas con la mano ──
  await H.shot('c6-06-fijador');
  const cp: any = await H.params();
  for (const t of cp.targets) {
    await H.clickMm(t.pos);
    await H.adv(0.2);
  }
  s = await H.state();
  H.log('tras abrazaderas', s.stepType, (await H.hud()).pops.slice(-3));
  expect(s.stepType).toBe('bandage');
  await H.adv(2);
  await clearStuckInterstitial(page, H);
  await H.shot('c6-07-vendaje');

  // ── Fase 4: vendaje, círculos a ~0,8 vueltas/s alrededor del centro ──
  const bp: any = await H.params();
  const R = bp.radiusMm * 0.9;
  const ring: V[] = [];
  const perTurn = 25; // 25 muestras × 50 ms = 1,25 s por vuelta (0,8 v/s)
  for (let i = 0; i <= perTurn * (bp.turns + 0.3); i++) {
    const a = (i / perTurn) * Math.PI * 2;
    ring.push({ x: bp.center.x + Math.cos(a) * R, y: bp.center.y + Math.sin(a) * R });
  }
  const ringPx = await H.projMany(ring);
  H.log('anillo px (min/max y)', Math.min(...ringPx.map((p) => p.y)), Math.max(...ringPx.map((p) => p.y)));
  await H.dragMm(ring, 0.05, {
    during: async (i) => {
      if (i === perTurn) await H.shot('c6-08-vendaje-girando');
    },
  });
  await H.adv(0.5);
  s = await H.state();
  H.log('tras vendaje', s, await H.vitals());
  await H.adv(6);
  await page.waitForFunction(() => (window as any).__game?.mode === 'menu', null, { timeout: 30_000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/c6-09-auditoria.png` });
  const audit = await page.evaluate(() => (document.querySelector('#ui-root')?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 900));
  H.log('auditoría', audit);
  expect(H.errors).toEqual([]);
});

// ─────────────────────────────── Caso 7: Rayo ───────────────────────────────

/** Responde al caos como un jugador: Z (Rodrigo), C (Gigi), X (Panchito). */
async function handleChaos(page: Page, H: Hx) {
  const s: any = await H.state();
  if (!s) return;
  const keys: string[] = [];
  if (s.chaos.includes('rodrigoSolo') || s.field > 55) keys.push('KeyZ');
  if (s.chaos.includes('gigiSelfie')) keys.push('KeyC');
  if (s.chaos.includes('panchitoIntrusion')) keys.push('KeyX');
  for (const k of keys) {
    await H.key(k, 0.05);
    await H.adv(0.35); // espera la resolución del toque amable
  }
  if (keys.length) H.log('caos atendido', s.chaos, keys);
}

async function setPressure(page: Page, H: Hx, target: number) {
  // La presión solo se lee en el HUD ("Presión"); la rueda la cambia de 1 en 1.
  const c = await H.proj({ x: 80, y: 50 });
  await page.mouse.move(c.x, c.y);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 120); // baja a 1
  for (let i = 1; i < target; i++) await page.mouse.wheel(0, -120);
  await H.adv(0.05);
}

function polyLen(path: V[]) {
  let L = 0;
  for (let i = 1; i < path.length; i++) L += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  return L;
}
function pointAt(path: V[], s: number): V {
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + l >= s) {
      const k = (s - acc) / l;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
    acc += l;
  }
  return path[path.length - 1];
}
function resample(path: V[], stepMm: number): V[] {
  const L = polyLen(path);
  const out: V[] = [];
  for (let s = 0; s <= L; s += stepMm) out.push(pointAt(path, s));
  out.push(path[path.length - 1]);
  return out;
}

async function gaugeVal(page: Page, label: RegExp): Promise<number | null> {
  return page.evaluate((src) => {
    const re = new RegExp(src);
    const g = [...document.querySelectorAll('.hud-gauges .gauge')].map((e) => (e.textContent ?? '').trim());
    const t = g.find((x) => re.test(x));
    if (!t) return null;
    const m = t.match(/(-?[\d.]+(?:,\d+)?)\s*[^\d]*$/);
    return m ? Number(m[1].replace('.', '').replace(',', '.')) : null;
  }, label.source);
}

test('caso 7 Rayo: artrodesis completa con entradas reales', async ({ page }) => {
  const H = helpers(page, 'c7');
  await openSurgery(page, 7);
  H.log('inicio', await H.state(), await H.vitals());
  await H.shot('c7-01-inicio');
  let s: any;

  // ── Incisión por capas ──
  const inc: any = await H.params();
  const pressures = inc.layers.map((l: any) => l.targetPressure);
  const path = resample(inc.path, 2);
  for (let layer = 0; layer < pressures.length; layer++) {
    await setPressure(page, H, pressures[layer]);
    for (let pass = 0; pass < 4; pass++) {
      const before = (await H.hud()).check;
      await H.dragMm(path, 0.03);
      await H.adv(0.1);
      const after = await H.hud();
      s = await H.state();
      H.log(`incisión capa ${layer + 1} pasada ${pass + 1}`, after.check, after.pops.slice(-2));
      if (s.stepType !== 'incision' || after.check !== before) break;
    }
    await handleChaos(page, H);
  }
  await H.shot('c7-02-incision');
  s = await H.state();
  H.log('tras incisión', s.stepType, await H.vitals());
  expect(s.stepType).toBe('hemostasis');
  await clearStuckInterstitial(page, H);

  // ── Hemostasia con el cauterio ──
  const hemo: any = await H.params();
  await H.adv(hemo.bleeders.length * 1.5 + 0.2);
  await H.shot('c7-03-sangrados');
  for (let round = 0; round < 3; round++) {
    const active: V[] = await page.evaluate(() =>
      (window as any).__game.surgery().ctx().bleeding.list().filter((b: any) => b.active).map((b: any) => b.pos),
    );
    if (!active.length) break;
    // Arterial primero.
    for (const pos of active) {
      await H.clickMm(pos, 1.4);
      await H.adv(0.2);
    }
  }
  for (let i = 0; i < 40; i++) {
    s = await H.state();
    if (s.stepType !== 'hemostasis') break;
    await handleChaos(page, H);
    await H.adv(0.5);
  }
  H.log('tras hemostasia', s.stepType, s.field, (await H.hud()).check, await H.vitals());
  await H.shot('c7-04-separador');
  expect(s.stepType).toBe('retract');
  const ret: any = await H.params();
  for (const pr of ret.pairs) {
    await H.clickMm(pr.a);
    await H.adv(0.2);
    await H.clickMm(pr.b);
    await H.adv(0.2);
    for (let c = 0; c < ret.idealClicks; c++) {
      await H.clickMm({ x: (pr.a.x + pr.b.x) / 2, y: (pr.a.y + pr.b.y) / 2 });
      await H.adv(0.2);
    }
  }
  s = await H.state();
  H.log('tras separador', s.stepType, (await H.hud()).pops.slice(-2));
  expect(s.stepType).toBe('burr');
  await H.adv(2);
  await clearStuckInterstitial(page, H);
  await H.shot('c7-05-fresa');

  // ── Fresa de cartílago: barrido por las tres bandas del peine con irrigación (I) ──
  const burr: any = await H.params();
  const bands = [
    [55.7, 60.7],
    [67.4, 72.4],
    [76.8, 81.8],
  ];
  const strokes: V[][] = [];
  for (const [x0, x1] of bands) {
    for (let x = x0 + 0.8; x <= x1 - 0.6; x += 1.6) {
      const col: V[] = [];
      for (let y = 42.9; y <= 57.8; y += 1) col.push({ x, y });
      strokes.push(strokes.length % 2 ? col.reverse() : col);
    }
  }
  const topBar: V[] = [];
  for (let x = 56; x <= 81.5; x += 1) topBar.push({ x, y: 43.4 });
  strokes.push(topBar);
  await page.keyboard.down('KeyI');
  let pass = 0;
  for (let rep = 0; rep < 3; rep++) {
    for (const st of strokes) {
      const heat = (await gaugeVal(page, /Temperatura/)) ?? 37;
      if (heat > 43) {
        await H.adv(2); // enfriar irrigando sin fresar
      }
      await H.dragMm(st, 0.05);
      pass++;
      s = await H.state();
      if (s.stepType !== 'burr') break;
    }
    const removed = await gaugeVal(page, /Retirado/);
    H.log(`fresa ronda ${rep + 1}`, { removed, pass, step: s.stepType, faults: (await H.vitals()).faults });
    if (s.stepType !== 'burr') break;
    await handleChaos(page, H);
  }
  await page.keyboard.up('KeyI');
  await H.shot('c7-06-tras-fresa');
  expect(s.stepType, 'el fresado de cartílago debe completarse').toBe('reduction');
  await H.adv(2);
  await clearStuckInterstitial(page, H);

  // ── Injerto: colocar las tres piezas (arrastrar + E para girar) ──
  await H.shot('c7-07-injerto');
  const grafts: any[] = await page.evaluate(() => {
    const c = (window as any).__game.surgery().ctx();
    return ['graft1', 'graft2', 'graft3'].map((id) => {
      const f = c.bone.fragment(id);
      return { id, pos: f.pose.pos, ang: f.pose.angleDeg, target: f.def.target };
    });
  });
  for (const g of grafts) {
    const p0 = await H.proj(g.pos);
    await page.mouse.move(p0.x, p0.y);
    await page.mouse.down();
    await H.adv(0.05);
    // Girar mientras se sostiene.
    const dAng = g.target.angleDeg - g.ang;
    const key = dAng > 0 ? 'KeyE' : 'KeyQ';
    await page.keyboard.down(key);
    await H.adv(Math.round(Math.abs(dAng) / 60 / 0.05) * 0.05);
    await page.keyboard.up(key);
    const n = 10;
    for (let i = 1; i <= n; i++) {
      const q = await H.proj({ x: g.pos.x + ((g.target.pos.x - g.pos.x) * i) / n, y: g.pos.y + ((g.target.pos.y - g.pos.y) * i) / n });
      await page.mouse.move(q.x, q.y);
      await H.adv(0.05);
    }
    await page.mouse.up();
    await H.adv(0.2);
    const err = await page.evaluate((id) => (window as any).__game.surgery().ctx().bone.alignmentError(id), g.id);
    H.log('injerto', g.id, err, (await H.hud()).pops.slice(-1));
  }
  s = await H.state();
  expect(s.stepType, 'los injertos deben colocarse').toBe('plate');
  await H.adv(2);
  await clearStuckInterstitial(page, H);
  await H.shot('c7-08-placa-elegir');

  // ── Placa híbrida: elegir (1), contornear (Espacio en zona verde), posicionar (Q/E + clic) ──
  await page.keyboard.press('Digit1');
  await H.adv(0.6);
  await H.shot('c7-09-placa-contorno');
  for (let b = 0; b < 12; b++) {
    const r = await page.evaluate(() => {
      for (let i = 0; i < 200; i++) {
        (window as any).__game.advance(0.05);
        const n = document.querySelector('.sb-needle') as HTMLElement | null;
        const z = document.querySelector('.sb-zone') as HTMLElement | null;
        if (!n || !z) return { gone: true };
        const x = parseFloat(n.style.left) / 100;
        const l = parseFloat(z.style.left) / 100;
        const w = parseFloat(z.style.width) / 100;
        if (x > l + w * 0.25 && x < l + w * 0.75) return { gone: false, x, l, w };
      }
      return { gone: false, timeout: true };
    });
    if ((r as any).gone) break;
    await page.keyboard.press('Space');
    await H.adv(0.2);
  }
  s = await H.state();
  const plate: any = await H.params();
  const target = plate.target.pos;
  const tp = await H.proj(target);
  await page.mouse.move(tp.x, tp.y);
  await H.adv(0.1);
  await H.shot('c7-10-placa-posicion');
  let ang = await gaugeVal(page, /[ÁA]ngulo/);
  H.log('placa: ángulo inicial', ang, await H.hud());
  // Prueba de sentido: E 0,2 s.
  await H.key('KeyE', 0.2);
  const ang2 = await gaugeVal(page, /[ÁA]ngulo/);
  const k = ang2 !== null && ang !== null && ang2 < ang ? 'KeyE' : 'KeyQ';
  const cur = ang2 ?? 25;
  await H.key(k, Math.max(0.05, Math.round(cur / 45 / 0.05) * 0.05));
  H.log('placa: ángulo final', await gaugeVal(page, /[ÁA]ngulo/));
  await H.clickMm(target);
  await H.adv(0.3);
  s = await H.state();
  H.log('tras placa', s.stepType, (await H.hud()).pops.slice(-2));
  expect(s.stepType, 'la placa debe asentarse').toBe('screws');
  await clearStuckInterstitial(page, H);

  // ── Tornillos: piloto, medir (1..3), atrapar (Espacio), apretar hasta el clic (orden guiado por la pista) ──
  // Máquina de estados guiada por la pista del HUD, como la leería un jugador.
  const sp: any = await H.params();
  const opts: number[] = sp.lengthOptionsMm;
  const hint = async () => (await H.hud()).hint;
  for (let guard = 0; guard < 120; guard++) {
    s = await H.state();
    if (s.stepType !== 'screws') break;
    const hn = await hint();
    const m = hn.match(/Tornillo (\d+)\//);
    const check = (await H.hud()).check;
    const idx = Number((check.match(/Tornillos \((\d+)\//) ?? [])[1] ?? 0);
    const hole: V = sp.holes[Math.min(idx, sp.holes.length - 1)];
    if (/anillo toque el tornillo/.test(hn)) {
      const cr = await page.evaluate(() => {
        for (let i = 0; i < 200; i++) {
          const root = document.querySelector('.sc-root');
          const ring = document.querySelector('.sc-ring') as HTMLElement | null;
          if (root && ring && !/sc-(perfect|good|miss)/.test(root.className)) {
            const mm = ring.style.transform.match(/scale\(([\d.]+)\)/);
            const sc = mm ? Number(mm[1]) : 9;
            if (sc < 1.1) return { sc, i };
          }
          (window as any).__game.advance(0.05);
        }
        return { sc: -1, i: 200 };
      });
      await page.keyboard.press('Space');
      await H.adv(0.9);
      H.log(`tornillo ${idx + 1}: atrapar`, cr, (await H.hud()).pops.slice(-2));
      if (idx === 0) await H.shot('c7-11-tornillo-atrapado');
    } else if (/Se cayó/.test(hn)) {
      H.log(`tornillo ${idx + 1}: ¡se cayó! esperando repuesto`);
      await page.keyboard.press('Space');
      await H.adv(5.5);
    } else if (/Esperando repuesto/.test(hn)) {
      await H.adv(1);
    } else if (/Piloto|Salida|taladro en la marca|Broca caliente/.test(hn)) {
      const dr = await drillHole(page, H, hole, 'screws');
      H.log(`tornillo ${idx + 1}: piloto`, dr, (await H.hud()).pops.slice(-2));
      if (idx === 0) await H.shot('c7-12-tornillo-medir');
    } else if (/Mide/.test(hn)) {
      const depth = sp.depthsMm[idx];
      const ideal = [...opts].sort((a, b) => a - b).find((o) => o >= depth) ?? Math.max(...opts);
      await page.keyboard.press(`Digit${opts.indexOf(ideal) + 1}`);
      await H.adv(0.2);
    } else if (/atornillar/.test(hn)) {
      await H.clickMm(hole, 1.15);
      await H.adv(0.3);
      H.log(`tornillo ${idx + 1}: apretado`, (await H.hud()).pops.slice(-2));
      await handleChaos(page, H);
    } else {
      H.log('tornillos: pista desconocida', hn);
      await H.adv(0.5);
    }
  }
  s = await H.state();
  expect(s.stepType, 'los 6 tornillos deben poder colocarse').toBe('suture');
  await H.adv(2);
  await clearStuckInterstitial(page, H);
  await H.shot('c7-13-sutura');

  // ── Sutura por capas: trazos que cruzan la incisión en el punto marcado ──
  const su: any = await H.params();
  const L = polyLen(su.path);
  const per = Math.max(3, Math.floor(L / su.spacingMm));
  for (let layer = 0; layer < su.layers.length; layer++) {
    for (let i = 0; i < per; i++) {
      const c = pointAt(su.path, (L * (i + 0.5)) / per);
      const pts: V[] = [];
      for (let k = 0; k <= 6; k++) pts.push({ x: c.x + (k - 3) * 0.3, y: c.y - 5 + (10 * k) / 6 });
      await H.dragMm(pts, 0.1);
      await H.adv(0.25);
    }
    H.log(`sutura capa ${layer + 1}`, (await H.hud()).check);
    await handleChaos(page, H);
  }
  s = await H.state();
  H.log('tras sutura', s.stepType);
  expect(s.stepType).toBe('bandage');
  await H.adv(1);

  // ── Vendaje ──
  const bp: any = await H.params();
  const R = bp.radiusMm * 0.9;
  const ring: V[] = [];
  const perTurn = 25; // 25 muestras × 50 ms = 1,25 s por vuelta (0,8 v/s)
  for (let i = 0; i <= perTurn * (bp.turns + 0.3); i++) {
    const a = (i / perTurn) * Math.PI * 2;
    ring.push({ x: bp.center.x + Math.cos(a) * R, y: bp.center.y + Math.sin(a) * R });
  }
  await H.dragMm(ring, 0.05);
  await H.adv(0.5);
  s = await H.state();
  H.log('tras vendaje', s, await H.vitals());
  await H.adv(8);
  await page.waitForFunction(() => (window as any).__game?.mode === 'menu', null, { timeout: 30_000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/c7-14-auditoria.png`, timeout: 120_000 });
  const audit = await page.evaluate(() => (document.querySelector('#ui-root')?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 1200));
  H.log('auditoría', audit);
  expect(H.errors).toEqual([]);
});

// ─────────────────────────────── Flujo meta de un jugador nuevo ───────────────────────────────

/** Lee la posición de Emiliana y del objetivo en el minimapa de la clínica (lo que ve el jugador). */
async function installMinimapHook(page: Page) {
  await page.evaluate(() => {
    const cv = document.querySelector('.cl-map canvas') as HTMLCanvasElement | null;
    if (!cv) return false;
    const g = cv.getContext('2d') as any;
    if (g.__hooked) return true;
    g.__hooked = true;
    const MW = cv.width;
    const MH = cv.height;
    const om = g.moveTo.bind(g);
    const ob = g.bezierCurveTo.bind(g);
    const oa = g.arc.bind(g);
    let flag = false;
    g.moveTo = (x: number, y: number) => {
      flag = true;
      return om(x, y);
    };
    // El corazón de Emiliana: moveTo(px, pz+8) + bezierCurveTo(px-13, pz-2, …).
    g.bezierCurveTo = (a: number, b: number, c: number, d: number, e: number, f: number) => {
      if (flag) (window as any).__pl = { x: ((a + 13) / MW) * 26.8 - 13.4, z: ((b + 2) / MH) * 16.8 - 8.4 };
      flag = false;
      return ob(a, b, c, d, e, f);
    };
    g.arc = (x: number, y: number, r: number, s: number, e: number, ccw?: boolean) => {
      flag = false;
      if (r > 7.5 && r < 15 && g.strokeStyle === '#ff2e93') (window as any).__tg = { x: (x / MW) * 26.8 - 13.4, z: (y / MH) * 16.8 - 8.4 };
      return oa(x, y, r, s, e, ccw);
    };
    return true;
  });
}

function clinicHelpers(page: Page, H: Hx) {
  const cl = () =>
    page.evaluate(() => {
      const q = (s: string) => (document.querySelector(s)?.textContent ?? '').replace(/\s+/g, ' ').trim();
      return { pl: (window as any).__pl as { x: number; z: number }, tg: (window as any).__tg as { x: number; z: number }, prompt: q('.cl-prompt'), obj: q('.cl-objective'), clock: q('.cl-clock') };
    });
  async function walkTo(x: number, z: number, tol = 0.35) {
    let prev: { x: number; z: number } | null = null;
    let stuck = 0;
    for (let i = 0; i < 60; i++) {
      const st: any = await cl();
      if (!st.pl) {
        await H.adv(0.1);
        continue;
      }
      const dx = x - st.pl.x;
      const dz = z - st.pl.z;
      const d = Math.hypot(dx, dz);
      if (d < tol) break;
      if (prev && Math.hypot(st.pl.x - prev.x, st.pl.z - prev.z) < 0.05) stuck++;
      else stuck = 0;
      prev = { x: st.pl.x, z: st.pl.z };
      if (stuck >= 2) {
        // Atascada contra un mueble o un NPC: rodeo lateral como haría un jugador.
        const side = Math.abs(dx) > Math.abs(dz) ? (dz >= 0 ? 'KeyS' : 'KeyW') : dx >= 0 ? 'KeyD' : 'KeyA';
        await page.keyboard.down(side);
        await H.adv(0.45);
        await page.keyboard.up(side);
        stuck = 0;
        continue;
      }
      const keys: string[] = [];
      if (Math.abs(dx) > tol * 0.6) keys.push(dx > 0 ? 'KeyD' : 'KeyA');
      if (Math.abs(dz) > tol * 0.6) keys.push(dz > 0 ? 'KeyS' : 'KeyW');
      for (const k of keys) await page.keyboard.down(k);
      await H.adv(Math.min(0.6, Math.max(0.1, (d / 3.4) * 0.7)));
      for (const k of keys) await page.keyboard.up(k);
      await H.adv(0.15);
    }
    return cl();
  }
  const path = async (pts: Array<[number, number]>) => {
    let r: any;
    for (const [x, z] of pts) r = await walkTo(x, z);
    return r;
  };
  const E = async (hold = 0.05) => {
    await page.keyboard.down('KeyE');
    await H.adv(hold);
    await page.keyboard.up('KeyE');
    await H.adv(0.2);
    return cl();
  };
  return { cl, walkTo, path, E };
}

test('flujo meta: título → clínica del tutorial → quirófano → auditoría → progreso → Boutique → ajustes → pausa → RCP', async ({ page }) => {
  const H = helpers(page, 'meta');
  await throttleRaf(page, 250);
  await page.addInitScript(() => {
    // Partida nueva solo en la primera carga de la pestaña (las recargas conservan la partida).
    try {
      if (!sessionStorage.getItem('playC-started')) {
        sessionStorage.setItem('playC-started', '1');
        localStorage.removeItem('dra-emiliana-save-v1');
      }
    } catch {}
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__game?.mode === 'menu', null, { timeout: 120_000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/m01-titulo.png`, timeout: 120_000 });
  await page.getByRole('button', { name: /Jugar/ }).click();
  await page.waitForTimeout(1500);
  await page.locator('.case-card').first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/m03-briefing.png`, timeout: 120_000 });
  await page.getByRole('button', { name: /Empezar/ }).click();
  await page.waitForFunction(() => (window as any).__game?.mode === 'clinic', null, { timeout: 120_000 });
  await page.waitForTimeout(2500);
  await installMinimapHook(page);
  await H.adv(0.5);
  const C = clinicHelpers(page, H);

  // La clínica se juega siguiendo el objetivo del HUD (como un jugador nuevo con la flecha rosa).
  const ROOM_DOOR: Record<string, { out: [number, number]; in: [number, number] } | null> = {
    exam: { out: [-9, -1.0], in: [-9, -3.0] },
    prep: { out: [-0.5, -1.0], in: [-0.5, -3.0] },
    or: { out: [8.5, -0.6], in: [8.5, -3.0] },
    autoclave: { out: [3.9, 4.5], in: [6.1, 4.5] },
    waiting: null,
  };
  const roomOf = (x: number, z: number) =>
    z < -2 ? (x < -4.5 ? 'exam' : x < 3.5 ? 'prep' : 'or') : x > 5 && z > 1 ? 'autoclave' : x > 5 ? 'or' : 'waiting';
  async function goTo(x: number, z: number) {
    const st: any = await C.cl();
    const from = st.pl ? roomOf(st.pl.x, st.pl.z) : 'waiting';
    const to = roomOf(x, z);
    if (from !== to) {
      const a = ROOM_DOOR[from];
      if (a) await C.path([a.in, a.out]);
      if (from === 'or' || to === 'or') await C.walkTo(5.8, -0.6);
      const b = ROOM_DOOR[to];
      if (b) await C.path([b.out, b.in]);
    }
    return C.walkTo(x, z);
  }
  async function crepitus() {
    const rect = await page.evaluate(() => {
      const c = document.querySelector('.cl-mg canvas') as HTMLCanvasElement;
      const r = c.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, W: c.width, H: c.height };
    });
    const cx = rect.x + (306 / rect.W) * rect.w;
    const cy = rect.y + (182 / rect.H) * rect.h;
    await page.mouse.move(cx + 20, cy);
    await page.mouse.down();
    for (let k = 0; k < 4; k++)
      for (let i = 1; i <= 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        await page.mouse.move(cx + Math.cos(a) * 20, cy + Math.sin(a) * 20);
        await H.adv(0.03);
      }
    await page.mouse.up();
    await H.adv(2);
  }
  let shotN = 0;
  for (let guard = 0; guard < 40; guard++) {
    const st: any = await C.cl();
    const obj: string = st.obj;
    H.log('objetivo', obj, st.pl, st.clock);
    if (guard % 4 === 0) await page.screenshot({ path: `${OUT}/meta-clinica-${String(shotN++).padStart(2, '0')}.png`, timeout: 120_000 });
    if (/puerta del quirófano/.test(obj)) break;
    if (/Habla con|Explica el diagn|Dale la tila/.test(obj)) {
      await goTo(st.tg.x, st.tg.z + 1.1);
      await C.E();
      if (/Explica/.test(obj)) {
        // Las opciones de diagnóstico se barajan en cada clínica: la tecla correcta la da el gancho de depuración.
        const dxKey = await page.evaluate(() => (window as any).__game.clinic?.()?.state().correctDxKey ?? 1);
        H.log('diagnóstico: tecla correcta', dxKey);
        await page.keyboard.press(`Digit${dxKey}`);
        await H.adv(0.3);
        await page.keyboard.press(`Digit${dxKey}`);
        await H.adv(0.5);
      }
      await H.adv(1);
    } else if (/Explora a/.test(obj)) {
      await goTo(-9, -4.1);
      await C.E();
      const btns = await page.evaluate(() => [...document.querySelectorAll('.cl-modal button')].map((b) => (b.textContent ?? '').replace(/\s+/g, ' ')));
      H.log('camilla', btns);
      for (let i = 1; i < btns.length; i++) {
        if (/Hecha|Tomada|✓/.test(btns[i])) continue;
        await page.keyboard.press(`Digit${i}`);
        await H.adv(0.4);
        if (await page.locator('.cl-mg canvas').count()) await crepitus();
      }
      await page.keyboard.press('KeyE');
      await H.adv(0.4);
    } else if (/Lee la placa/.test(obj)) {
      await goTo(-6.2, -6.3);
      await C.E();
      const r2 = await page.evaluate(() => {
        const c = document.querySelector('.cl-mg canvas') as HTMLCanvasElement | null;
        if (!c) return null;
        const r = c.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      if (r2) await page.mouse.click(r2.x + 0.575 * r2.w, r2.y + 0.5 * r2.h);
      await H.adv(2.3);
    } else if (/Atiende a/.test(obj)) {
      const side = st.tg.x < -12 ? [1.1, 0] : [0, 1.1];
      await goTo(st.tg.x + side[0], st.tg.z + side[1]);
      await C.E(3.5);
    } else if (/Fritz|autoclave/.test(obj)) {
      await goTo(10.6, 4.4);
      if (/aluminio/.test(obj)) await C.E(1.5);
      else {
        await C.E();
        await page.keyboard.press('Digit1');
        await H.adv(0.5);
      }
    } else if (/Rodrigo/.test(obj)) {
      await goTo(-0.5, -4.3);
      await C.E();
      await page.keyboard.press('Digit1');
      await H.adv(0.5);
    } else if (/Gigi/.test(obj)) {
      await goTo(1.2, 3.9);
      await C.E();
      await page.keyboard.press('Digit1');
      await H.adv(0.5);
    } else if (/aluminio del negatoscopio/.test(obj)) {
      await goTo(-6.2, -6.3);
      await C.E(1.5);
    } else if (/tila/.test(obj)) {
      await goTo(-2.7, 6.6);
      await C.E(1.1);
    } else {
      await H.adv(1);
    }
  }
  const stOr: any = await C.cl();
  H.log('clínica terminada', stOr.obj, stOr.clock);
  expect(stOr.obj).toMatch(/quirófano/);
  await goTo(8.5, -6.1);
  await C.E();
  await page.keyboard.press('Digit1');
  for (let i = 0; i < 40; i++) {
    if ((await page.evaluate(() => (window as any).__game.mode)) === 'surgery') break;
    await H.adv(0.5);
  }
  expect(await page.evaluate(() => (window as any).__game.mode)).toBe('surgery');
  await H.adv(4);

  // Pausa con Esc en el quirófano: la pantalla de pausa debe quedarse.
  await page.evaluate(() => {
    (window as any).__muts = [];
    new MutationObserver((ms) => {
      for (const m of ms) {
        for (const n of m.addedNodes) (window as any).__muts.push('+' + ((n as HTMLElement).className || n.nodeName));
        for (const n of m.removedNodes) (window as any).__muts.push('-' + ((n as HTMLElement).className || n.nodeName));
      }
    }).observe(document.querySelector('.emi-screens')!, { childList: true });
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  const muts = await page.evaluate(() => (window as any).__muts);
  H.log('Esc en quirófano → mutaciones de pantallas', muts);
  expect.soft(await page.locator('.scr-pause').count(), 'Esc debe pausar el quirófano').toBe(1);
  if (await page.locator('.scr-pause').count()) await page.keyboard.press('Escape');

  // setExito(0) con constantes estables NO provoca el paro (ver informe); se provoca desde las constantes.
  await page.evaluate(() => (window as any).__game.surgery().setExito(0));
  await H.adv(0.5);
  H.log('tras setExito(0)', (await H.state()).exito, 'paro:', (await H.state()).arrest);
  expect.soft((await H.state()).arrest, 'Éxito 0 debe provocar el paro').toBe(true);
  if (!(await H.state()).arrest) {
    await page.evaluate(() => (window as any).__game.surgery().ctx().vitals.triggerArrest());
    await H.adv(0.1);
  }
  // RCP: Espacio a ~110/min (reloj real), luego D mantenida para cargar y soltar al despejar.
  // Las pulsaciones se hacen dentro de la página con espera activa: bajo carga, las idas y vueltas de
  // Playwright tardan 1–2 s y el ritmo medido (reloj real) caía a 26/min (fallo del arnés, no del juego).
  const txt = () => page.evaluate(() => (document.querySelector('.emi-cpr')?.textContent ?? '').replace(/\s+/g, ' '));
  await page.evaluate(() => {
    const g = (window as any).__game;
    const key = (code: string, type: string) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code === 'Space' ? ' ' : 'd', bubbles: true }));
    const t = () => (document.querySelector('.emi-cpr')?.textContent ?? '').replace(/\s+/g, ' ');
    const wait = (ms: number) => { const t0 = performance.now(); while (performance.now() - t0 < ms) {} };
    for (let n = 0; n < 40; n++) {
      const t0 = performance.now();
      key('Space', 'keydown');
      key('Space', 'keyup');
      g.advance(0.3);
      if (n >= 8 && /Fibrilaci/.test(t())) break;
      wait(545 - (performance.now() - t0));
    }
    key('KeyD', 'keydown');
    g.advance(2.3);
    for (let i = 0; i < 20 && !/apart/.test(t()); i++) g.advance(0.2);
    key('KeyD', 'keyup');
  });
  await H.adv(0.3);
  H.log('RCP', await txt());
  expect(await txt()).toMatch(/PULSO/);
  await H.adv(3);

  // Resto de la cirugía con pasos forzados (permitido en el flujo meta).
  for (let i = 0; i < 40; i++) {
    const done = await page.evaluate(() => {
      const d = (window as any).__game.surgery();
      if (!d) return true;
      const s = d.state();
      if (s.finished || s.step === null) return true;
      d.forceCompleteStep();
      (window as any).__game.advance(2);
      return false;
    });
    if (done) break;
  }
  await H.adv(6);
  await page.waitForFunction(() => (window as any).__game?.mode === 'menu', null, { timeout: 60_000 });
  await page.evaluate(() => ((window as any).__rafMs = 0));
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `${OUT}/m25-auditoria.png`, timeout: 120_000 });
  const auditTxt = await page.evaluate(() => document.querySelector('#ui-root')!.textContent!.replace(/\s+/g, ' '));
  expect.soft(auditTxt, 'sin reto no debe decir "Reto no cumplido"').not.toMatch(/Reto no cumplido/);
  await page.getByRole('button', { name: /Continuar/ }).click();
  await page.waitForTimeout(1500);
  const unlocked = await page.evaluate(() => [...document.querySelectorAll('.case-card')].slice(0, 2).map((c) => !c.classList.contains('locked')));
  expect(unlocked).toEqual([true, true]);
  const save0: any = await page.evaluate(() => (window as any).__game.save);
  expect(save0.coins).toBeGreaterThan(0);

  // Boutique: comprar la gargantilla (150) y comprobar equipado.
  await page.getByRole('button', { name: /Boutique/ }).click();
  await page.waitForTimeout(1500);
  if (save0.coins >= 150) {
    await page.locator('.shop-card').filter({ hasText: 'Gargantilla' }).locator('.shop-btn').click();
    await page.waitForTimeout(800);
    const s1: any = await page.evaluate(() => (window as any).__game.save);
    expect(s1.owned).toContain('gargantilla-estrella');
    expect(s1.equipped).toContain('gargantilla-estrella');
  }
  await page.screenshot({ path: `${OUT}/m28-boutique-equipado.png`, timeout: 120_000 });
  await page.getByRole('button', { name: /Volver/ }).click();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /Volver/ }).click();
  await page.waitForTimeout(1000);

  // Ajustes: Residente, gore 30, pareja "Lu"/ella; persisten tras recargar.
  await page.getByRole('button', { name: /Ajustes/ }).click();
  await page.waitForTimeout(1200);
  await page.locator('.scr-settings button', { hasText: 'Residente' }).click();
  await page.locator('.scr-settings input[type=range]').nth(1).fill('30');
  await page.locator('.scr-settings input[type=text]').fill('Lu');
  await page.locator('.scr-settings input[type=text]').press('Tab');
  await page.locator('.scr-settings select').last().selectOption('ella');
  await page.locator('.scr-settings button', { hasText: 'Listo' }).click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__game?.mode === 'menu', null, { timeout: 120_000 });
  const s2: any = await page.evaluate(() => (window as any).__game.save);
  expect(s2.settings.difficulty).toBe('residente');
  expect(s2.settings.goreLevel).toBe(30);
  expect(s2.partner).toEqual({ name: 'Lu', pronoun: 'ella' });
  expect(s2.completed.panchito).toBeTruthy();

  // Pausa en la clínica (Esc) y reanudar con el botón.
  await page.goto('/?case=1&go=clinic&seed=3', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__game?.mode === 'clinic', null, { timeout: 120_000 });
  await page.waitForTimeout(2000);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  expect(await page.locator('.scr-pause').count()).toBe(1);
  await page.getByRole('button', { name: /Reanudar/ }).click();
  await page.waitForTimeout(500);
  expect(await page.locator('.scr-pause').count()).toBe(0);
  expect(H.errors).toEqual([]);
});
