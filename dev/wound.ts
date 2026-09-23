/**
 * Página de desarrollo de la herida 2D.
 *  - Por defecto: galería de estados (incisión, separación, sangrados, charco, fragmentos, implantes, RX, pastel...).
 *  - ?mode=live: herida animada a tamaño grande con controles.
 */
import { createWoundSurface } from '../src/surgery/WoundSurface';
import {
  SAMPLE_INCISION,
  createFakeBleeding,
  createFakeBloodPool,
  createFakeBone,
  fakeSettings,
  sampleAnatomy,
  sampleClosedAnatomy,
  sampleSpineAnatomy,
} from '../src/surgery/scene/fakes';
import type { AnatomyDef, Settings, Vec2, WoundOverlay } from '../src/core/contracts';
import { samplePolyline } from '../src/core/math';

function makeWound(anatomy: AnatomyDef, settings: Settings, incision = SAMPLE_INCISION) {
  const bone = createFakeBone(anatomy);
  const bleeding = createFakeBleeding();
  const blood = createFakeBloodPool({ window: anatomy.window });
  const wound = createWoundSurface({ anatomy, incisionPath: incision, bone, bleeding, blood, settings });
  return { wound, bone, bleeding, blood, anatomy, settings };
}
type Kit = ReturnType<typeof makeWound>;

/** Corta una capa a lo largo de la incisión con pequeños trazos (como haría el bisturí). */
function cutAlong(k: Kit, layer: 'skin' | 'subcut' | 'fascia' | 'muscle', width: number, from = 0, to = 1) {
  const pts = samplePolyline(SAMPLE_INCISION, 60);
  const a = Math.floor(from * (pts.length - 1));
  const b = Math.floor(to * (pts.length - 1));
  for (let i = a; i < b; i++) {
    const j = (i * 0.37) % 1;
    k.wound.cut(layer, { x: pts[i].x, y: pts[i].y + (j - 0.5) * 0.3 }, pts[i + 1], width);
  }
}

function fullOpen(k: Kit) {
  cutAlong(k, 'skin', 1.2);
  cutAlong(k, 'subcut', 1.4);
  cutAlong(k, 'fascia', 1.2);
  cutAlong(k, 'muscle', 1.4);
  k.wound.setRetraction(1);
}

function plateAndScrews(k: Kit) {
  k.bone.setPose('distal', { pos: { x: 106.5, y: 49.4 }, angleDeg: 0 });
  const holes: Vec2[] = [-24, -15, -6, 6, 15, 24].map((x) => ({ x, y: 0 }));
  k.bone.implants.plate = {
    optionId: 'p6',
    pose: { pos: { x: 84, y: 49 }, angleDeg: -1 },
    holesLocal: holes,
    lengthMm: 58,
    widthMm: 7,
    bend: 1,
  };
  const world = k.bone.plateHolesWorld();
  world.forEach((p, i) => {
    if (i === 2) return; // un agujero libre para ver el bisel
    k.bone.implants.screws.push({ pos: p, lengthMm: 12, contaminated: false, stripped: i === 5 });
  });
}

/** Overlay de ejemplo (como los de los pasos): anillo de calor de la broca. */
const heatRing: WoundOverlay = {
  id: 'demo-heat',
  z: 50,
  draw(g, px, s, t) {
    const c = px({ x: 70, y: 49 });
    g.lineWidth = 0.8 * s;
    g.strokeStyle = '#9ff0d0';
    g.beginPath();
    g.arc(c.x, c.y, 5 * s, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (0.6 + 0.1 * Math.sin(t)));
    g.stroke();
  },
};

const BIG = Number(new URLSearchParams(location.search).get('big') ?? 0);
let shotIndex = 0;

/** Fuerza el rasterizado real del lienzo (los canvas acelerados difieren el trabajo). */
function flush(k: Kit) {
  k.wound.canvas.getContext('2d')!.getImageData(0, 0, 1, 1);
}

function snapshot(grid: HTMLElement, k: Kit, caption: string, t: number, frames = 1) {
  for (let i = 0; i < frames; i++) {
    k.blood.step(1 / 60);
    k.wound.update(1 / 60, t + i / 60);
  }
  const fig = document.createElement('figure');
  const c = document.createElement('canvas');
  shotIndex++;
  const big = BIG === shotIndex;
  c.width = big ? 1024 : 512;
  c.height = big ? 640 : 320;
  c.getContext('2d')!.drawImage(k.wound.canvas, 0, 0, c.width, c.height);
  if (BIG && !big) return;
  if (big) {
    grid.style.display = 'block';
    c.style.width = '1024px';
  }
  const cap = document.createElement('figcaption');
  cap.textContent = caption;
  fig.append(c, cap);
  grid.append(fig);
}

function gallery() {
  const grid = document.getElementById('grid')!;
  const settings = fakeSettings({ goreLevel: 80 });
  const k = makeWound(sampleAnatomy(), settings);
  const t0 = performance.now();
  k.wound.setGuide(SAMPLE_INCISION, 'full');
  snapshot(grid, k, '1 · Piel rasurada + guía completa', 0.3);
  cutAlong(k, 'skin', 1.2, 0, 0.7);
  k.wound.setGuide(SAMPLE_INCISION, 'endpoints');
  snapshot(grid, k, '2 · Incisión de piel (guía: extremos)', 0.6);
  cutAlong(k, 'skin', 1.2, 0.7, 1);
  cutAlong(k, 'subcut', 1.4);
  cutAlong(k, 'fascia', 1.2);
  k.wound.setRetraction(0.4);
  k.wound.setGuide(null, 'none');
  snapshot(grid, k, '3 · Subcutáneo y fascia, separación 40%', 1);
  cutAlong(k, 'muscle', 1.4);
  k.wound.setRetraction(1);
  snapshot(grid, k, '4 · Separación 100%: ventana y hueso', 1.2);
  k.bleeding.spawn({ x: 60, y: 43 }, 'arterial', 0);
  k.bleeding.spawn({ x: 96, y: 58 }, 'venous', 0);
  k.bleeding.spawn({ x: 118, y: 45 }, 'capillary', 0);
  const sealed = k.bleeding.spawn({ x: 45, y: 55 }, 'venous', 0);
  k.bleeding.seal(sealed.id, 0.5);
  const burnt = k.bleeding.spawn({ x: 76, y: 60 }, 'capillary', 0);
  k.bleeding.seal(burnt.id, 0.5, true);
  k.wound.addDecal('char', { x: 76, y: 60 });
  snapshot(grid, k, '5 · Sangrados: arterial, venoso, capilar, sellados', 2.05);
  k.blood.fillTo(50);
  snapshot(grid, k, '6 · Charco al 50%', 2.3);
  k.blood.fillTo(80);
  snapshot(grid, k, '7 · Charco al 80%: ¡inundación!', 2.6);
  k.blood.clear();
  for (const b of k.bleeding.active()) k.bleeding.seal(b.id, 3);
  k.bone.setHighlight('distal', true);
  k.wound.setGhosts(true);
  k.wound.addOverlay(heatRing);
  snapshot(grid, k, '8 · Fragmento resaltado + silueta fantasma', 3);
  k.bone.setHighlight('distal', false);
  k.wound.setGhosts(false);
  k.wound.removeOverlay('demo-heat');
  plateAndScrews(k);
  k.wound.addDecal('fissure', { x: 92, y: 53 }, { angleDeg: 30, sizeMm: 8 });
  k.wound.addDecal('necrosis', { x: 40, y: 51 }, { sizeMm: 3 });
  k.bone.implants.pins.push({ pos: { x: 118, y: 54 }, kind: 'kwire' });
  k.bone.implants.wires.push({ a: { x: 30, y: 47 }, b: { x: 42, y: 53 } });
  snapshot(grid, k, '9 · Placa, tornillos, aguja y banda de tensión', 3.4);
  k.wound.setXray(true);
  snapshot(grid, k, '10 · Rayos X (arco en C)', 3.6);
  k.wound.setXray(false);
  k.wound.setClosure(0.93);
  const stitches = samplePolyline(SAMPLE_INCISION, 14);
  for (let i = 1; i < stitches.length - 1; i++) {
    k.wound.addDecal('stitch', stitches[i], { angleDeg: 90, sizeMm: 8 });
  }
  k.wound.addDecal('knot', stitches[1], { angleDeg: 90 });
  snapshot(grid, k, '11 · Sutura (cierre 93%)', 4);

  // Modo Pastel en otra herida abierta.
  const kp = makeWound(sampleAnatomy(), fakeSettings({ pastelMode: true, goreLevel: 80 }));
  fullOpen(kp);
  kp.bleeding.spawn({ x: 64, y: 44 }, 'arterial', 0);
  kp.bleeding.spawn({ x: 104, y: 57 }, 'capillary', 0);
  kp.blood.fillTo(45);
  snapshot(grid, kp, '12 · Modo Pastel (jarabe de fresa)', 2.08);

  // Gore 0 y poca luz (selfie de Gigi).
  kp.settings.pastelMode = false;
  kp.settings.goreLevel = 0;
  kp.wound.setLight(0.15);
  snapshot(grid, kp, '13 · Gore 0 + luz al 15% (selfie)', 2.3);

  // Columna: fresado y médula.
  const ks = makeWound(sampleSpineAnatomy(), fakeSettings());
  fullOpen(ks);
  for (let x = 66; x <= 96; x += 1.5) for (let y = 49; y <= 53; y += 1.5) ks.wound.erase('bone', { x, y }, 2.2);
  snapshot(grid, ks, '14 · Hemilaminectomía: fresado + médula', 1);

  // Conejo: reducción cerrada con fijador externo.
  const kr = makeWound(sampleClosedAnatomy(), fakeSettings());
  kr.bone.setPose('distal', { pos: { x: 104, y: 49.6 }, angleDeg: 0 });
  for (const x of [34, 56, 94, 118]) kr.wound.addDecal('pin', { x, y: 50 });
  kr.wound.addDecal('bar', { x: 34, y: 38 }, { to: { x: 118, y: 38 } });
  for (const x of [34, 56, 94, 118]) kr.wound.addDecal('clamp', { x, y: 38 });
  snapshot(grid, kr, '15 · Conejo (cerrada): agujas + barra', 1);
  console.log(`[wound] galería construida en ${(performance.now() - t0).toFixed(0)} ms`);

  if (!BIG && new URLSearchParams(location.search).get('bench') !== '0') bench();
}

/** Banco de pruebas: coste del update con todo activo. */
function bench() {
  const kb = makeWound(sampleAnatomy(), fakeSettings());
  fullOpen(kb);
  plateAndScrews(kb);
  kb.bleeding.spawn({ x: 60, y: 43 }, 'arterial', 0);
  kb.bleeding.spawn({ x: 96, y: 58 }, 'venous', 0);
  kb.bleeding.spawn({ x: 118, y: 45 }, 'capillary', 0);
  kb.blood.fillTo(40);
  kb.wound.setGuide(SAMPLE_INCISION, 'full');
  kb.wound.update(0.016, 0);
  let sum = 0;
  let worst = 0;
  const N = 120;
  for (let i = 0; i < N; i++) {
    kb.blood.step(1 / 60);
    const a = performance.now();
    kb.wound.update(1 / 60, i / 60);
    flush(kb);
    const d = performance.now() - a;
    sum += d;
    worst = Math.max(worst, d);
  }
  const measure = (label: string) => {
    let sm = 0;
    for (let i = 0; i < 40; i++) {
      kb.blood.step(1 / 60);
      const a = performance.now();
      kb.wound.update(1 / 60, 5 + i / 60);
      flush(kb);
      sm += performance.now() - a;
    }
    console.log(`[wound] ${label}: ${(sm / 40).toFixed(2)} ms`);
  };
  measure('todo activo');
  kb.blood.clear();
  measure('sin charco');
  kb.bleeding.active().forEach((b) => kb.bleeding.seal(b.id, 5));
  measure('sin charco ni sangrados activos');
  kb.wound.setGuide(null, 'none');
  measure('además sin guía');
  const st = kb.wound.stats();
  const msg = `[wound] update medio ${(sum / N).toFixed(2)} ms, peor ${worst.toFixed(2)} ms · reconstrucción de pila ${st.stackMs.toFixed(1)} ms`;
  console.log(msg);
  (window as unknown as { __woundBench: string }).__woundBench = msg;
  // Coste de reconstruir la pila al cambiar la retracción (paso de separadores).
  let rs = 0;
  for (let i = 0; i < 10; i++) {
    kb.wound.setRetraction(0.6 + i * 0.04);
    const a = performance.now();
    kb.wound.update(1 / 60, 3 + i / 60);
    flush(kb);
    rs += performance.now() - a;
  }
  console.log(`[wound] update con retracción cambiando: ${(rs / 10).toFixed(2)} ms`);
  // Coste de un trazo de bisturí incremental (rectángulo sucio).
  const kc = makeWound(sampleAnatomy(), fakeSettings());
  kc.wound.update(0.016, 0);
  flush(kc);
  const pts = samplePolyline(SAMPLE_INCISION, 60);
  let cs = 0;
  for (let i = 0; i < 30; i++) {
    const a = performance.now();
    kc.wound.cut('skin', pts[i], pts[i + 1], 1.2);
    kc.wound.update(1 / 60, i / 60);
    flush(kc);
    cs += performance.now() - a;
  }
  console.log(`[wound] update mientras se corta: ${(cs / 30).toFixed(2)} ms`);
}

function live() {
  document.getElementById('grid')!.style.display = 'none';
  document.getElementById('title')!.textContent = 'Herida · en vivo';
  const liveEl = document.getElementById('live')!;
  liveEl.style.display = 'flex';
  const out = document.getElementById('liveCanvas') as HTMLCanvasElement;
  out.width = 1024;
  out.height = 640;
  const og = out.getContext('2d')!;
  const settings = fakeSettings({ goreLevel: 80 });
  const k = makeWound(sampleAnatomy(), settings);
  k.wound.setGuide(SAMPLE_INCISION, 'full');
  const panel = document.getElementById('panel')!;
  const stats = document.createElement('div');
  stats.id = 'stats';
  const slider = (label: string, init: number, fn: (v: number) => void) => {
    const l = document.createElement('label');
    l.textContent = label + ' ';
    const i = document.createElement('input');
    i.type = 'range';
    i.min = '0';
    i.max = '1';
    i.step = '0.01';
    i.value = String(init);
    i.oninput = () => fn(Number(i.value));
    l.append(i);
    panel.append(l);
  };
  const button = (label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = fn;
    panel.append(b);
  };
  let t = 0;
  let layerIdx = 0;
  const LAYERS = ['skin', 'subcut', 'fascia', 'muscle'] as const;
  button('Cortar siguiente capa', () => {
    if (layerIdx < 4) cutAlong(k, LAYERS[layerIdx++], 1.3);
  });
  slider('Separación', 0, (v) => k.wound.setRetraction(v));
  slider('Cierre', 0, (v) => k.wound.setClosure(v));
  slider('Luz', 1, (v) => k.wound.setLight(v));
  slider('Gore', 0.8, (v) => (settings.goreLevel = v * 100));
  button('Sangrado arterial', () => k.bleeding.spawn({ x: 50 + Math.random() * 60, y: 44 + Math.random() * 12 }, 'arterial', t));
  button('Sangrado venoso', () => k.bleeding.spawn({ x: 50 + Math.random() * 60, y: 44 + Math.random() * 12 }, 'venous', t));
  button('Sellar todo', () => k.bleeding.active().forEach((b) => k.bleeding.seal(b.id, t)));
  button('Charco 50% / 80% / 0%', () => {
    const l = k.blood.levelPct();
    k.blood.fillTo(l < 30 ? 50 : l < 65 ? 80 : 0);
  });
  button('Placa y tornillos', () => plateAndScrews(k));
  button('Fantasmas on/off', () => {
    ghostsOn = !ghostsOn;
    k.wound.setGhosts(ghostsOn);
  });
  button('Rayos X on/off', () => {
    xr = !xr;
    k.wound.setXray(xr);
  });
  button('Modo Pastel on/off', () => (settings.pastelMode = !settings.pastelMode));
  button('Destello', () => k.wound.flash('#ffffff', 400));
  panel.append(stats);
  let ghostsOn = false;
  let xr = false;
  out.addEventListener('mousemove', (e) => {
    const r = out.getBoundingClientRect();
    const mm = { x: ((e.clientX - r.left) / r.width) * 160, y: ((e.clientY - r.top) / r.height) * 100 };
    stats.dataset.pick = `(${mm.x.toFixed(1)}, ${mm.y.toFixed(1)}) mm · capa: ${k.wound.topLayerAt(mm)}`;
  });
  let acc = 0;
  let frames = 0;
  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    t += dt;
    for (const e of k.bleeding.emit(dt, t, 110)) k.blood.add(e.bleeder.pos, e.amount);
    k.blood.step(dt);
    k.wound.update(dt, t);
    og.drawImage(k.wound.canvas, 0, 0);
    acc += k.wound.stats().updateMs;
    frames++;
    if (frames % 30 === 0) {
      stats.textContent = `update ${(acc / 30).toFixed(2)} ms · campo ${k.blood.levelPct().toFixed(0)}% ${stats.dataset.pick ?? ''}`;
      acc = 0;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

if (new URLSearchParams(location.search).get('mode') === 'live') live();
else setTimeout(gallery, 30); // tras el evento load (capturas headless)
