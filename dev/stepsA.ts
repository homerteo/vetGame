/*
 * Banco de pruebas 2D de los pasos A: renderizador mínimo de herida sobre el contexto falso.
 * Teclas: 1–7 paso, rueda presión, C cauterio, Z aspirar, G guías, T tutorial, R reiniciar.
 */
import type { GuideLevel, InstrumentId, StepController, Vec2, WoundPointer } from '../src/core/contracts';
import { clamp, polygonBounds } from '../src/core/math';
import { createCauteryTool, type CauteryToolAPI } from '../src/surgery/steps/CauteryTool';
import { STEPS_A } from '../src/surgery/steps/registryA';
import { CELL_MM, type FakeCtx, createFakeContext } from '../src/surgery/steps/testing/a/fakeContext';
import { INCISION_PATH, STEP_DEFS, anatomyFor } from '../src/surgery/steps/testing/a/scenarios';

type Key = keyof typeof STEP_DEFS;
const ORDER: Key[] = ['incision', 'hemostasis', 'retract', 'suture', 'bandage', 'clickTargets', 'pick'];
const TAB_LABEL: Record<Key, string> = {
  incision: 'Incisión',
  hemostasis: 'Hemostasia',
  retract: 'Separadores',
  suture: 'Sutura',
  bandage: 'Vendaje',
  clickTargets: 'Agujas',
  pick: 'Disco',
};
const INSTR_NAME: Partial<Record<InstrumentId, string>> = {
  scalpel10: 'Bisturí n.º 10',
  scalpel15: 'Bisturí n.º 15',
  cautery: 'Electrocauterio',
  gelpi: 'Separador Gelpi',
  weitlaner: 'Separador Weitlaner',
  needleHolder: 'Porta-agujas',
  bandage: 'Venda cohesiva',
  kwire: 'Aguja de Kirschner',
  forceps: 'Pinzas',
  kern: 'Pinzas Kern',
  hand: 'Mano',
};

const S = 5.6; // px por mm en pantalla
const canvas = document.getElementById('wound') as HTMLCanvasElement;
const stage = document.getElementById('stage') as HTMLDivElement;
const dpr = Math.min(2, window.devicePixelRatio || 1);
canvas.width = Math.round(896 * dpr);
canvas.height = Math.round(560 * dpr);
const g = canvas.getContext('2d')!;
const popsEl = document.getElementById('pops')!;
const sayEl = document.getElementById('say')!;
const bannerEl = document.getElementById('banner')!;
const $ = (id: string) => document.getElementById(id)!;

// ───────────────────────────── Estado ─────────────────────────────

let cur: Key = 'incision';
let guide: GuideLevel = 'full';
let tutorial = false;
let f!: FakeCtx;
let step!: StepController;
let tool!: CauteryToolAPI;
let usingCautery = false;
let pressure = 3;
let down = false;
let hover: Vec2 = { x: 80, y: 50 };
let zHeld = false;
let sayTimer = 0;
let flashT = 0;
let flashColor = '#ff4d6d';
let lastFlashCount = 0;
const logLines: Array<{ cls: string; text: string }> = [];

function addLog(cls: string, text: string) {
  logLines.unshift({ cls, text });
  if (logLines.length > 14) logLines.pop();
  $('log').innerHTML = logLines.map((l) => `<div class="${l.cls}">${l.text}</div>`).join('');
}

function select(k: Key) {
  if (step) step.end();
  if (tool) tool.dispose();
  cur = k;
  popsEl.innerHTML = '';
  bannerEl.style.display = 'none';
  f = createFakeContext({
    anatomy: anatomyFor(STEP_DEFS[k].params.type),
    tutorial,
    guideLevel: guide,
    seed: 7,
    // Coordenadas relativas al escenario (los textos flotantes viven dentro de él).
    project: (mm) => ({ x: mm.x * S, y: mm.y * S }),
    onPop: (p) => {
      const el = document.createElement('div');
      el.className = `pop ${p.kind}`;
      el.textContent = p.text;
      el.style.left = `${p.screen.x}px`;
      el.style.top = `${p.screen.y}px`;
      popsEl.appendChild(el);
      setTimeout(() => el.remove(), 1150);
    },
  });
  prepare(k);
  f.bus.on('say', (s) => {
    const who = { emiliana: 'Emiliana', rodrigo: 'Rodrigo', gigi: 'Gigi', fritz: 'Fritz' } as Record<string, string>;
    sayEl.innerHTML = `<b>${who[s.speaker] ?? s.speaker}:</b> ${s.text}`;
    sayEl.style.opacity = '1';
    sayTimer = 3;
  });
  f.bus.on('gesture', () => {});
  const origGesture = f.log.gesture.bind(f.log);
  f.log.gesture = (label, q) => {
    origGesture(label, q);
    addLog('g', `✓ ${label} · ${(q * 100).toFixed(0)}%`);
  };
  const origFault = f.log.fault.bind(f.log);
  f.log.fault = (kind, detail) => {
    origFault(kind, detail);
    addLog('f', `✗ Falta: ${kind}${detail ? ` (${detail})` : ''}`);
  };
  const origBonus = f.log.bonus.bind(f.log);
  f.log.bonus = (label, d) => {
    origBonus(label, d);
    addLog('b', `★ ${label} +${d}`);
  };
  step = STEPS_A[STEP_DEFS[k].params.type]!(STEP_DEFS[k]);
  step.begin(f.ctx);
  tool = createCauteryTool(f.ctx);
  usingCautery = false;
  lastFlashCount = 0;
  addLog('', `— ${TAB_LABEL[k]} (${tutorial ? 'tutorial, ' : ''}guía ${guide}) —`);
  renderTabs();
}

/** Estado previo de la herida para que cada paso tenga sentido visual. */
function prepare(k: Key) {
  const w = f.wound;
  const cutAll = (width: number, deep = false) => {
    w.cutAlong('skin', INCISION_PATH, width);
    w.cutAlong('subcut', INCISION_PATH, width * 0.8);
    w.cutAlong('fascia', INCISION_PATH, width * 0.6);
    if (deep) w.cutAlong('muscle', INCISION_PATH, width * 0.4);
  };
  if (k === 'hemostasis') {
    cutAll(5);
    w.setRetraction(0.35);
    f.blood.level = 22;
  } else if (k === 'retract') {
    cutAll(3);
  } else if (k === 'suture') {
    cutAll(5);
  } else if (k === 'bandage') {
    cutAll(1.2);
    w.setClosure(1);
    for (let x = 38; x <= 122; x += 12) w.addDecal('stitch', { x, y: 48.6 }, { to: { x: x + 1, y: 53 } });
  } else if (k === 'clickTargets' || k === 'pick') {
    cutAll(6, true);
    w.setRetraction(1);
  }
}

// ───────────────────────────── Entrada ─────────────────────────────

const mmFrom = (e: PointerEvent | WheelEvent): Vec2 => {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / S, y: (e.clientY - r.top) / S };
};

function activeInstrument(): InstrumentId {
  return usingCautery ? 'cautery' : step.instruments[0];
}

function ptr(mm: Vec2, button: number, buttons: number): WoundPointer {
  return { mm, onWound: true, button, buttons, pressure, shift: false, t: f.clock.t, instrument: activeInstrument() };
}

/** Destino de los punteros: el cauterio universal salvo en la hemostasia. */
function target() {
  return usingCautery && cur !== 'hemostasis' ? tool : step;
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  e.preventDefault();
  hover = mmFrom(e);
  down = true;
  if (!step.isComplete() || usingCautery) target().onPointerDown(ptr(hover, e.button, e.buttons));
});
canvas.addEventListener('pointermove', (e) => {
  hover = mmFrom(e);
  target().onPointerMove(ptr(hover, 0, e.buttons));
});
canvas.addEventListener('pointerup', (e) => {
  hover = mmFrom(e);
  down = false;
  target().onPointerUp(ptr(hover, e.button, e.buttons));
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('auxclick', (e) => e.preventDefault());
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    pressure = clamp(pressure + (e.deltaY < 0 ? 1 : -1), 1, 5);
    target().onPointerMove(ptr(mmFrom(e), 0, down ? 1 : 0));
  },
  { passive: false },
);
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const n = Number(e.key);
  if (n >= 1 && n <= 7) select(ORDER[n - 1]);
  else if (e.code === 'KeyC') {
    usingCautery = !usingCautery;
    if (cur === 'hemostasis') usingCautery = true;
  } else if (e.code === 'KeyZ') zHeld = true;
  else if (e.code === 'KeyG') {
    guide = guide === 'full' ? 'endpoints' : guide === 'endpoints' ? 'none' : 'full';
    select(cur);
  } else if (e.code === 'KeyT') {
    tutorial = !tutorial;
    select(cur);
  } else if (e.code === 'KeyR') select(cur);
  else step.onKey(e.code, true);
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'KeyZ') zHeld = false;
  else step.onKey(e.code, false);
});

function renderTabs() {
  const top = $('top');
  top.querySelectorAll('.tab').forEach((el) => el.remove());
  ORDER.forEach((k, i) => {
    const b = document.createElement('button');
    b.className = `tab${k === cur ? ' on' : ''}`;
    b.innerHTML = `<b>${i + 1}</b>${TAB_LABEL[k]}`;
    b.onclick = () => select(k);
    top.appendChild(b);
  });
}

// ───────────────────────────── Renderizado de la herida ─────────────────────────────

const tissue = document.createElement('canvas');
const tg = tissue.getContext('2d')!;
let tissueImg: ImageData | null = null;

const COL = {
  subcut: [244, 210, 122],
  fascia: [236, 232, 244],
  muscle: [178, 52, 66],
  deep: [120, 24, 38],
  edge: [196, 52, 70],
};

/** Tejido abierto a partir de las máscaras de la herida falsa. */
function drawTissue() {
  const w = f.wound;
  if (!tissueImg || tissue.width !== w.cols) {
    tissue.width = w.cols;
    tissue.height = w.rows;
    tissueImg = tg.createImageData(w.cols, w.rows);
  }
  const d = tissueImg.data;
  const { skin, subcut, fascia, muscle } = w.masks;
  const cols = w.cols;
  for (let i = 0, n = cols * w.rows; i < n; i++) {
    const o = i * 4;
    if (!skin[i]) {
      d[o + 3] = 0;
      continue;
    }
    let c = COL.subcut;
    if (subcut[i]) c = fascia[i] ? (muscle[i] ? COL.deep : COL.muscle) : COL.fascia;
    // Borde de piel: rosado más oscuro.
    const x = i % cols;
    const edge = (x > 0 && !skin[i - 1]) || (x < cols - 1 && !skin[i + 1]) || !skin[i - cols] || !skin[i + cols];
    if (edge) c = COL.edge;
    // Estriado del músculo.
    const stripe = c === COL.muscle && ((x + Math.floor(i / cols)) % 5 === 0) ? 0.85 : 1;
    d[o] = c[0] * stripe;
    d[o + 1] = c[1] * stripe;
    d[o + 2] = c[2] * stripe;
    d[o + 3] = 255;
  }
  tg.putImageData(tissueImg, 0, 0);
  g.imageSmoothingEnabled = true;
  g.drawImage(tissue, 0, 0, w.cols * CELL_MM * S, w.rows * CELL_MM * S);
}

function polyPath(poly: Vec2[]) {
  g.beginPath();
  poly.forEach((p, i) => (i ? g.lineTo(p.x * S, p.y * S) : g.moveTo(p.x * S, p.y * S)));
  g.closePath();
}

function drawBoneShape(poly: Vec2[], highlight = false) {
  polyPath(poly);
  const b = polygonBounds(poly);
  const grad = g.createLinearGradient(0, b.minY * S, 0, b.maxY * S);
  grad.addColorStop(0, '#fffaf0');
  grad.addColorStop(0.5, '#f2e6c9');
  grad.addColorStop(1, '#d9c6a0');
  g.fillStyle = grad;
  g.fill();
  g.strokeStyle = highlight ? '#9ff0d0' : 'rgba(120,90,50,0.6)';
  g.lineWidth = highlight ? 3 : 1.2;
  g.stroke();
}

function drawDeepWindow(t: number) {
  const r = f.wound.retraction;
  if (r <= 0.02) return;
  const a = f.ctx.caseDef.anatomy;
  const b = polygonBounds(a.window);
  const cy = (b.minY + b.maxY) / 2;
  const h = (b.maxY - b.minY) * clamp(r, 0, 1);
  const x0 = b.minX * S;
  const x1 = b.maxX * S;
  const y0 = (cy - h / 2) * S;
  const y1 = (cy + h / 2) * S;
  g.save();
  g.beginPath();
  g.ellipse((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, Math.max(2, (y1 - y0) / 2), 0, 0, Math.PI * 2);
  g.fillStyle = '#8e1f30';
  g.fill();
  g.clip();
  // Músculo profundo estriado.
  g.strokeStyle = 'rgba(210,90,100,0.35)';
  g.lineWidth = 2;
  for (let x = x0 - 40; x < x1 + 40; x += 9) {
    g.beginPath();
    g.moveTo(x, y0);
    g.lineTo(x + 30, y1);
    g.stroke();
  }
  g.globalAlpha = clamp((r - 0.3) / 0.5, 0, 1);
  for (const poly of a.boneStatic) drawBoneShape(poly);
  const cord = f.bone.cord();
  if (cord) {
    polyPath(cord);
    const cb = polygonBounds(cord);
    const grad = g.createLinearGradient(0, cb.minY * S, 0, cb.maxY * S);
    grad.addColorStop(0, '#fff3d6');
    grad.addColorStop(0.5, '#f7d6c4');
    grad.addColorStop(1, '#e8b4a8');
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = 'rgba(200,120,110,0.8)';
    g.stroke();
  }
  for (const fr of f.bone.fragments()) if (!fr.removed) drawBoneShape(f.bone.worldPolygon(fr.id), fr.highlighted);
  g.globalAlpha = 1;
  g.restore();
  // Bordes húmedos.
  g.strokeStyle = `rgba(255,190,200,${0.35 + 0.1 * Math.sin(t * 2)})`;
  g.lineWidth = 3;
  g.beginPath();
  g.ellipse((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, Math.max(2, (y1 - y0) / 2), 0, 0, Math.PI * 2);
  g.stroke();
}

function drawClosure() {
  const c = f.wound.closure;
  if (c <= 0) return;
  g.strokeStyle = f.ctx.caseDef.anatomy.skinTone;
  g.globalAlpha = clamp(c, 0, 1);
  g.lineWidth = 7 * S;
  g.lineCap = 'round';
  g.beginPath();
  INCISION_PATH.forEach((p, i) => (i ? g.lineTo(p.x * S, p.y * S) : g.moveTo(p.x * S, p.y * S)));
  g.stroke();
  g.globalAlpha = 1;
  g.strokeStyle = `rgba(190,90,100,${0.8 * c})`;
  g.lineWidth = 1.5;
  g.beginPath();
  INCISION_PATH.forEach((p, i) => (i ? g.lineTo(p.x * S, p.y * S) : g.moveTo(p.x * S, p.y * S)));
  g.stroke();
}

function drawImplants() {
  const im = f.bone.implants;
  for (const w of im.wires) {
    g.strokeStyle = '#cfd8e2';
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(w.a.x * S, w.a.y * S);
    g.lineTo(w.b.x * S, w.b.y * S);
    g.stroke();
  }
  for (const b of im.bars) {
    g.strokeStyle = '#7d8894';
    g.lineWidth = 8;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(b.a.x * S, b.a.y * S);
    g.lineTo(b.b.x * S, b.b.y * S);
    g.stroke();
  }
  for (const p of im.pins) {
    const x = p.pos.x * S;
    const y = p.pos.y * S;
    g.fillStyle = 'rgba(40,20,50,0.35)';
    g.beginPath();
    g.arc(x + 3, y + 4, 6, 0, Math.PI * 2);
    g.fill();
    const grad = g.createRadialGradient(x - 2, y - 2, 1, x, y, 7);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.5, '#c9d3dd');
    grad.addColorStop(1, '#6d7986');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, 6, 0, Math.PI * 2);
    g.fill();
  }
}

function drawDecals() {
  for (const d of f.wound.decals) {
    const x = d.pos.x * S;
    const y = d.pos.y * S;
    const size = (d.opts?.sizeMm ?? 3) * S;
    if (d.kind === 'char') {
      const grad = g.createRadialGradient(x, y, 0, x, y, size);
      grad.addColorStop(0, 'rgba(30,15,10,0.9)');
      grad.addColorStop(0.6, 'rgba(70,35,20,0.6)');
      grad.addColorStop(1, 'rgba(70,35,20,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, size, 0, Math.PI * 2);
      g.fill();
    } else if (d.kind === 'scratch') {
      const a = ((d.opts?.angleDeg ?? 0) * Math.PI) / 180;
      g.strokeStyle = 'rgba(190,30,50,0.8)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x - Math.cos(a) * size, y - Math.sin(a) * size);
      g.lineTo(x + Math.cos(a) * size, y + Math.sin(a) * size);
      g.stroke();
    } else if (d.kind === 'stitch' && d.opts?.to) {
      const tx = d.opts.to.x * S;
      const ty = d.opts.to.y * S;
      const fx = 2 * x - tx;
      const fy = 2 * y - ty;
      g.strokeStyle = '#6a4bd8';
      g.lineWidth = 2.5;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(fx, fy);
      g.lineTo(tx, ty);
      g.stroke();
      g.fillStyle = '#4a2fb0';
      g.beginPath();
      g.arc(x + 5, y - 2, 2.6, 0, Math.PI * 2);
      g.fill();
    } else if (d.kind === 'hole') {
      g.fillStyle = '#3a2020';
      g.beginPath();
      g.arc(x, y, size * 0.5, 0, Math.PI * 2);
      g.fill();
    } else {
      g.fillStyle = '#9aa6b2';
      g.fillRect(x - size / 2, y - size / 4, size, size / 2);
    }
  }
}

function drawBlood(t: number) {
  // Charco: mancha translúcida según el nivel de campo.
  const lvl = f.blood.levelPct();
  if (lvl > 0.5) {
    const r = (10 + lvl * 0.45) * S;
    const grad = g.createRadialGradient(80 * S, 50 * S, 0, 80 * S, 50 * S, r);
    grad.addColorStop(0, `rgba(158,11,23,${0.25 + lvl / 180})`);
    grad.addColorStop(0.7, `rgba(158,11,23,${0.15 + lvl / 300})`);
    grad.addColorStop(1, 'rgba(158,11,23,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(80 * S, 50 * S, r, r * 0.45, 0, 0, Math.PI * 2);
    g.fill();
  }
  for (const b of f.bleeding.list()) {
    const x = b.pos.x * S;
    const y = b.pos.y * S;
    if (!b.active) {
      g.fillStyle = b.charred ? '#2a150d' : 'rgba(90,30,30,0.7)';
      g.beginPath();
      g.arc(x, y, 3, 0, Math.PI * 2);
      g.fill();
      continue;
    }
    const pulse = b.kind === 'arterial' ? 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 2) : 0.5 + 0.2 * Math.sin(t * 3 + b.id);
    const base = b.kind === 'venous' ? '#5e0612' : b.kind === 'arterial' ? '#d8152a' : '#b3182b';
    const rad = (b.kind === 'capillary' ? 2 : 3) * S * (0.8 + 0.3 * pulse);
    g.fillStyle = base;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.beginPath();
    g.arc(x - rad * 0.3, y - rad * 0.35, rad * 0.25, 0, Math.PI * 2);
    g.fill();
    if (b.kind === 'arterial') {
      // Chorro pulsátil.
      for (let k = 0; k < 5; k++) {
        const ph = (t * 2 + k / 5) % 1;
        const h = ph * 9 * S * pulse;
        g.fillStyle = `rgba(216,21,42,${(1 - ph) * 0.9})`;
        g.beginPath();
        g.arc(x + Math.sin(k * 2.3) * ph * 10, y - h, 3.5 * (1 - ph * 0.5), 0, Math.PI * 2);
        g.fill();
      }
    }
  }
}

function drawGuide() {
  const gd = f.wound.guide;
  if (!gd.path || gd.level === 'none') return;
  g.strokeStyle = 'rgba(159,240,208,0.95)';
  g.lineWidth = 2.5;
  if (gd.level === 'full') {
    g.setLineDash([9, 7]);
    g.beginPath();
    gd.path.forEach((p, i) => (i ? g.lineTo(p.x * S, p.y * S) : g.moveTo(p.x * S, p.y * S)));
    g.stroke();
    g.setLineDash([]);
  }
  for (const p of [gd.path[0], gd.path[gd.path.length - 1]]) {
    g.fillStyle = '#9ff0d0';
    g.beginPath();
    g.arc(p.x * S, p.y * S, 5, 0, Math.PI * 2);
    g.fill();
  }
}

function drawCursor() {
  const x = hover.x * S;
  const y = hover.y * S;
  const inst = activeInstrument();
  g.save();
  g.translate(x, y);
  g.strokeStyle = '#fff';
  g.lineWidth = 2;
  g.shadowColor = 'rgba(0,0,0,0.5)';
  g.shadowBlur = 4;
  if (inst.startsWith('scalpel')) {
    g.rotate(-0.9);
    g.fillStyle = '#e8eef4';
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(8, -5);
    g.lineTo(26, -4);
    g.lineTo(26, 3);
    g.lineTo(6, 2);
    g.closePath();
    g.fill();
    g.fillStyle = '#ff8fc7';
    g.fillRect(26, -3.5, 34, 6);
  } else if (inst === 'cautery') {
    g.rotate(-0.8);
    g.fillStyle = '#9ff0d0';
    g.fillRect(4, -2, 40, 4);
    g.fillStyle = '#dfe7ef';
    g.fillRect(0, -1, 6, 2);
  } else {
    g.beginPath();
    g.arc(0, 0, 5, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(-9, 0);
    g.lineTo(-6, 0);
    g.moveTo(6, 0);
    g.lineTo(9, 0);
    g.moveTo(0, -9);
    g.lineTo(0, -6);
    g.moveTo(0, 6);
    g.lineTo(0, 9);
    g.stroke();
  }
  g.restore();
}

function drawDrapes(t: number) {
  const W = 160 * S;
  const H = 100 * S;
  g.fillStyle = '#b79cf2';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,0.12)';
  g.lineWidth = 10;
  for (let x = -H; x < W; x += 28) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + H, H);
    g.stroke();
  }
  const a = f.ctx.caseDef.anatomy;
  // Pelaje alrededor de la ventana.
  g.fillStyle = a.furColor;
  roundRectPath(12 * S, 10 * S, 136 * S, 80 * S, 10 * S);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.15)';
  g.lineWidth = 1;
  for (let i = 0; i < 260; i++) {
    const x = 12 * S + ((i * 97) % (136 * S));
    const y = 10 * S + ((i * 53) % (80 * S));
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 3, y + 5);
    g.stroke();
  }
  // Piel rasurada.
  const grad = g.createRadialGradient(80 * S, 50 * S, 10, 80 * S, 50 * S, 70 * S);
  grad.addColorStop(0, a.skinTone);
  grad.addColorStop(1, shade(a.skinTone, 0.9));
  g.fillStyle = grad;
  roundRectPath(18 * S, 16 * S, 124 * S, 68 * S, 12 * S);
  g.fill();
  // Antiséptico (bordes anaranjados suaves).
  g.strokeStyle = 'rgba(214,140,60,0.25)';
  g.lineWidth = 8;
  roundRectPath(20 * S, 18 * S, 120 * S, 64 * S, 12 * S);
  g.stroke();
  void t;
}

function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const gg = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${r},${gg},${b})`;
}

function roundRectPath(x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

const px = (p: Vec2) => ({ x: p.x * S, y: p.y * S });

function render(t: number) {
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawDrapes(t);
  drawTissue();
  drawDeepWindow(t);
  drawClosure();
  drawDecals();
  drawImplants();
  drawBlood(t);
  drawGuide();
  const overlays = [...f.wound.overlays.values()].sort((a, b) => a.z - b.z);
  for (const o of overlays) {
    g.save();
    o.draw(g, px, S, t);
    g.restore();
  }
  if (f.wound.flashes.length > lastFlashCount) {
    lastFlashCount = f.wound.flashes.length;
    const fl = f.wound.flashes[lastFlashCount - 1];
    flashT = fl.ms / 1000;
    flashColor = fl.color;
  }
  if (flashT > 0) {
    g.globalAlpha = clamp(flashT / 0.15, 0, 1) * 0.45;
    g.fillStyle = flashColor;
    g.fillRect(0, 0, 160 * S, 100 * S);
    g.globalAlpha = 1;
  }
  drawCursor();
}

// ───────────────────────────── Panel ─────────────────────────────

function renderPanel() {
  $('stepname').textContent = step.def.label;
  const inst = activeInstrument();
  $('meta').textContent = `Instrumento: ${INSTR_NAME[inst] ?? inst} · guía ${guide}${tutorial ? ' · tutorial' : ''}`;
  $('hint').textContent = step.hint();
  $('check').innerHTML = step
    .checklist()
    .map((c) => `<li class="${c.done ? 'done' : ''}">${c.label}</li>`)
    .join('');
  const gauges = usingCautery && cur !== 'hemostasis' ? [...tool.gauges(), ...step.gauges()] : step.gauges();
  $('gauges').innerHTML = gauges
    .map((gg) => {
      const span = gg.max - gg.min || 1;
      const zones = (gg.zones ?? [])
        .map((z) => `<div class="zone ${z.kind}" style="left:${((z.from - gg.min) / span) * 100}%;width:${((z.to - z.from) / span) * 100}%"></div>`)
        .join('');
      const pct = clamp((gg.value - gg.min) / span, 0, 1) * 100;
      const val = Number.isInteger(gg.value) ? gg.value : gg.value.toFixed(1);
      return `<div class="gauge"><div class="lbl"><span>${gg.label}</span><span>${val}${gg.unit ? ' ' + gg.unit : ''}</span></div><div class="bar">${zones}<div class="needle" style="left:${pct}%"></div></div></div>`;
    })
    .join('');
  const lvl = f.blood.levelPct();
  $('status').innerHTML =
    `<span>Presión: <b>${'●'.repeat(pressure)}${'○'.repeat(5 - pressure)}</b> (${pressure})</span>` +
    `<span>Campo: <b>${lvl.toFixed(0)}%</b>${zHeld ? ' · Rodrigo aspirando 🎸' : ''}</span>` +
    `<span>Sangrados activos: <b>${f.bleeding.active().length}</b></span>` +
    `<span>Progreso: <b>${Math.round(step.progress() * 100)}%</b></span>` +
    `<span>Cauterio universal: <b>${usingCautery ? 'sí' : 'no'}</b> (C)</span>`;
}

// ───────────────────────────── Bucle ─────────────────────────────

let last = performance.now();
let panelAcc = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  f.clock.t += dt;
  step.update(dt);
  tool.update(dt);
  // Sangre: los sangrados llenan el campo; Rodrigo aspira (más con Z).
  for (const e of f.bleeding.emit(dt, f.clock.t, 120)) f.blood.add(e.bleeder.pos, e.amount);
  f.blood.suction({ x: 80, y: 50 }, 10, zHeld ? 0.4 : 0.05, dt);
  if (flashT > 0) flashT -= dt;
  if (sayTimer > 0) {
    sayTimer -= dt;
    if (sayTimer <= 0) sayEl.style.opacity = '0';
  }
  if (step.isComplete() && bannerEl.style.display !== 'block') bannerEl.style.display = 'block';
  render(f.clock.t);
  panelAcc += dt;
  if (panelAcc > 0.1) {
    panelAcc = 0;
    renderPanel();
  }
  requestAnimationFrame(frame);
}

select('incision');
renderPanel();
requestAnimationFrame(frame);

// Ganchos para capturas automáticas.
(window as unknown as { __dev: unknown }).__dev = {
  select: (i: number) => select(ORDER[i - 1]),
  setPressure: (p: number) => (pressure = p),
  setGuide: (l: GuideLevel) => {
    guide = l;
    select(cur);
  },
  cautery: (on: boolean) => (usingCautery = on),
  fake: () => f,
  step: () => step,
  /** Evento de puntero sintético en mm. */
  ptr: (type: 'down' | 'move' | 'up', x: number, y: number, button = 0) => {
    hover = { x, y };
    const p = ptr(hover, button, type === 'up' ? 0 : 1);
    if (type === 'down') target().onPointerDown(p);
    else if (type === 'move') target().onPointerMove(p);
    else target().onPointerUp(p);
  },
  /** Avanza la simulación de forma síncrona (s). */
  advance: (sec: number) => {
    for (let t = 0; t < sec; t += 1 / 60) {
      f.clock.t += 1 / 60;
      step.update(1 / 60);
      tool.update(1 / 60);
    }
  },
};
