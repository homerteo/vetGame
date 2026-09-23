// Página de desarrollo de los pasos B: renderizador 2D sencillo + contexto falso.
import '../src/ui/theme.css';
import type {
  Gauge,
  GuideLevel,
  InstrumentId,
  StepController,
  SurgeryHudAPI,
  Vec2,
  WoundPointer,
} from '../src/core/contracts';
import { applyPosePoly, clamp } from '../src/core/math';
import { createRng } from '../src/core/rng';
import { STEPS_B } from '../src/surgery/steps/registryB';
import { createFakeContext, type FakeHarness } from '../src/surgery/steps/testing/b/fakeContext';
import { ALL_SCENARIOS, DEMO_PLATE_HOLES, reductionScenario, type Scenario } from '../src/surgery/steps/testing/b/scenarios';

const S = 6; // px por mm
const TOP = 56;
const canvas = document.getElementById('wound') as HTMLCanvasElement;
const g = canvas.getContext('2d')!;
const mgLayer = document.getElementById('mg-layer')!;
const params = new URLSearchParams(location.search);
const guide = (params.get('guide') as GuideLevel) || 'full';
const tutorial = params.get('tutorial') === '1';

const NAMES: Record<string, string> = {
  kern: 'Pinzas Kern',
  kwire: 'Aguja K',
  carm: 'Arco en C',
  saw: 'Sierra',
  burr: 'Fresa',
  rasp: 'Raspa',
  drill: 'Taladro',
  plate: 'Placa',
  screwdriver: 'Destornillador',
};

// ── HUD de desarrollo ──
const devHud: SurgeryHudAPI = {
  update() {},
  toast(text) {
    logLine(`HC · ${text}`, 'fault');
  },
  subtitle() {},
  alert() {},
  minigameLayer: () => mgLayer,
  popText(text, screen, kind) {
    const el = document.createElement('div');
    el.className = `pop ${kind}`;
    el.textContent = text;
    el.style.left = `${screen.x}px`;
    el.style.top = `${screen.y}px`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  },
  setVisible() {},
  dispose() {},
};
const project = (mm: Vec2) => ({ x: mm.x * S, y: TOP + mm.y * S });

// ── Estado ──
let idx = Math.max(0, ALL_SCENARIOS.findIndex((f) => f().type === params.get('step')));
let sc: Scenario;
let h: FakeHarness;
let step: StepController;
let pointer: Vec2 = { x: 80, y: 50 };
let buttons = 0;
let pressure = 3;
let bg: HTMLCanvasElement;
const boneImg = document.createElement('canvas');
boneImg.width = 320;
boneImg.height = 200;
const boneCtx = boneImg.getContext('2d')!;
let lastErases = -1;
let flash: { color: string; until: number } | null = null;
const logEl = document.getElementById('log')!;
const subEl = document.getElementById('sub')!;
let subTimer = 0;

function logLine(text: string, cls: string) {
  const d = document.createElement('div');
  d.className = cls;
  d.textContent = text;
  logEl.prepend(d);
  while (logEl.children.length > 7) logEl.lastChild!.remove();
}

function load(i: number) {
  step?.end();
  mgLayer.innerHTML = '';
  logEl.innerHTML = '';
  idx = (i + ALL_SCENARIOS.length) % ALL_SCENARIOS.length;
  sc = ALL_SCENARIOS[idx]();
  if (sc.type === 'reduction' && params.get('closed') === '1') sc = reductionScenario({ closed: true });
  h = createFakeContext({ anatomy: sc.anatomy, owner: sc.owner, tutorial, guideLevel: guide, hud: devHud, project, seed: 11 });
  if (sc.plate) {
    h.bone.implants.plate = {
      optionId: 'p6',
      pose: { pos: { x: 79, y: 50 }, angleDeg: 0 },
      holesLocal: DEMO_PLATE_HOLES,
      lengthMm: 42,
      widthMm: 7,
      bend: 1,
    };
  }
  h.bus.on('say', (e) => {
    subEl.innerHTML = `<b>${e.speaker}:</b> ${e.text}`;
    subEl.style.opacity = '1';
    subTimer = e.durationSec ?? 3.5;
    logLine(`${e.speaker}: ${e.text}`, 'say');
  });
  h.bus.on('fault', (e) => logLine(`✗ ${e.kind}${e.detail ? ` · ${e.detail}` : ''}`, 'fault'));
  h.bus.on('gesture', (e) => logLine(`✓ ${e.label} · ${Math.round(e.quality * 100)}%`, 'gesture'));
  h.bus.on('bonus', (e) => logLine(`★ ${e.label}`, 'gesture'));
  const wflash = h.wound.flash.bind(h.wound);
  h.wound.flash = (color, ms) => {
    wflash(color, ms);
    flash = { color, until: performance.now() + ms };
  };
  step = STEPS_B[sc.type]!(sc.def);
  step.begin(h.ctx);
  h.instrument = step.instruments[0];
  bg = buildBackground(sc);
  lastErases = -1;
  document.getElementById('banner')!.style.display = 'none';
  renderTabs();
  renderHotbar();
}

// ── Fondo estático: pelaje, piel rasurada, ventana muscular ──
function buildBackground(s: Scenario): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 960;
  c.height = 600;
  const b = c.getContext('2d')!;
  const rng = createRng(3);
  b.fillStyle = s.anatomy.furColor;
  b.fillRect(0, 0, 960, 600);
  // Mechones de pelo.
  b.lineCap = 'round';
  for (let i = 0; i < 2600; i++) {
    const x = rng() * 960;
    const y = rng() * 600;
    b.strokeStyle = rng() < 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.12)';
    b.lineWidth = 1 + rng() * 1.5;
    b.beginPath();
    b.moveTo(x, y);
    b.lineTo(x + 6 + rng() * 6, y + 3 + rng() * 5);
    b.stroke();
  }
  // Piel rasurada.
  b.fillStyle = s.anatomy.skinTone;
  b.beginPath();
  b.ellipse(480, 300, 440, 200, 0, 0, Math.PI * 2);
  b.fill();
  const shade = b.createRadialGradient(480, 300, 120, 480, 300, 440);
  shade.addColorStop(0, 'rgba(255,255,255,0.12)');
  shade.addColorStop(1, 'rgba(120,60,60,0.18)');
  b.fillStyle = shade;
  b.fill();
  // Paños lila en los bordes.
  b.fillStyle = '#c8a2e8';
  b.fillRect(0, 0, 960, 48);
  b.fillRect(0, 552, 960, 48);
  b.fillStyle = 'rgba(59,33,70,0.15)';
  for (let x = 0; x < 960; x += 24) {
    b.fillRect(x, 0, 2, 48);
    b.fillRect(x, 552, 2, 48);
  }
  if (!s.anatomy.closed) {
    const w = s.anatomy.window;
    const path = () => {
      b.beginPath();
      w.forEach((p, i) => (i ? b.lineTo(p.x * S, p.y * S) : b.moveTo(p.x * S, p.y * S)));
      b.closePath();
    };
    // Borde de piel cortada.
    b.save();
    path();
    b.lineWidth = 16;
    b.strokeStyle = '#e59a93';
    b.lineJoin = 'round';
    b.stroke();
    b.lineWidth = 8;
    b.strokeStyle = '#f7e27a';
    b.stroke();
    b.restore();
    // Músculo.
    b.save();
    path();
    b.clip();
    const mg = b.createLinearGradient(0, 200, 0, 400);
    mg.addColorStop(0, '#7a1422');
    mg.addColorStop(0.5, '#a3263a');
    mg.addColorStop(1, '#6a0f1c');
    b.fillStyle = mg;
    b.fillRect(0, 0, 960, 600);
    for (let i = 0; i < 260; i++) {
      const y = 190 + rng() * 220;
      const x = rng() * 960;
      b.strokeStyle = rng() < 0.5 ? 'rgba(255,170,170,0.12)' : 'rgba(40,0,10,0.18)';
      b.lineWidth = 1 + rng() * 2;
      b.beginPath();
      b.moveTo(x, y);
      b.bezierCurveTo(x + 30, y - 4, x + 60, y + 4, x + 110, y + rng() * 6);
      b.stroke();
    }
    const inner = b.createRadialGradient(480, 300, 60, 480, 300, 420);
    inner.addColorStop(0, 'rgba(0,0,0,0)');
    inner.addColorStop(1, 'rgba(20,0,5,0.45)');
    b.fillStyle = inner;
    b.fillRect(0, 0, 960, 600);
    b.restore();
  }
  return c;
}

// ── Dibujo ──
const px = (p: Vec2): Vec2 => ({ x: p.x * S, y: p.y * S });

function polyPath(poly: Vec2[]) {
  g.beginPath();
  poly.forEach((p, i) => (i ? g.lineTo(p.x * S, p.y * S) : g.moveTo(p.x * S, p.y * S)));
  g.closePath();
}

function drawBone(poly: Vec2[], o: { xray: boolean; faint?: boolean; highlight?: boolean; locked?: boolean; noTouch?: boolean }) {
  g.save();
  polyPath(poly);
  if (o.xray) {
    g.fillStyle = 'rgba(223,244,255,0.82)';
    g.shadowColor = '#bfe9ff';
    g.shadowBlur = 10;
    g.fill();
  } else {
    g.globalAlpha = o.faint ? 0.18 : 1;
    const b = poly.reduce((a, p) => ({ minY: Math.min(a.minY, p.y), maxY: Math.max(a.maxY, p.y) }), { minY: 1e9, maxY: -1e9 });
    const gr = g.createLinearGradient(0, b.minY * S, 0, b.maxY * S);
    gr.addColorStop(0, '#fffaf0');
    gr.addColorStop(0.5, '#f1e2c2');
    gr.addColorStop(1, '#d9c39a');
    g.fillStyle = gr;
    g.shadowColor = 'rgba(30,0,10,0.5)';
    g.shadowBlur = 8;
    g.shadowOffsetY = 3;
    g.fill();
    g.shadowColor = 'transparent';
    g.strokeStyle = o.highlight ? '#9ff0d0' : o.noTouch ? '#ff4d6d' : '#b89a68';
    g.lineWidth = o.highlight ? 3 : 1.8;
    if (o.noTouch) g.setLineDash([4, 3]);
    g.stroke();
  }
  g.restore();
}

function drawDecals() {
  for (const d of h.wound.decals) {
    const c = px(d.pos);
    const sz = (d.sizeMm ?? 3) * S;
    const a = ((d.angleDeg ?? 0) * Math.PI) / 180;
    g.save();
    g.translate(c.x, c.y);
    g.rotate(a);
    switch (d.kind) {
      case 'scratch':
        g.strokeStyle = 'rgba(90,30,20,0.7)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(-sz / 2, 0);
        g.lineTo(sz / 2, 1);
        g.stroke();
        break;
      case 'fissure':
        g.strokeStyle = 'rgba(40,10,10,0.9)';
        g.lineWidth = 2;
        g.beginPath();
        for (let i = 0; i <= 6; i++) g.lineTo(-sz / 2 + (sz * i) / 6, (i % 2 ? 1 : -1) * 3);
        g.stroke();
        break;
      case 'necrosis':
        g.fillStyle = 'rgba(90,70,50,0.55)';
        g.beginPath();
        g.arc(0, 0, sz / 2, 0, Math.PI * 2);
        g.fill();
        break;
      case 'hole':
        g.fillStyle = '#2a0a10';
        g.beginPath();
        g.arc(0, 0, sz / 2, 0, Math.PI * 2);
        g.fill();
        break;
      case 'pin':
      case 'kwire': {
        const r = d.kind === 'pin' ? 5 : 3;
        g.strokeStyle = '#d8d4ee';
        g.lineWidth = d.kind === 'pin' ? 4 : 2.5;
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(-sz * 1.2, -sz * 1.2);
        g.stroke();
        g.fillStyle = '#f7f6ff';
        g.strokeStyle = '#6d5c8f';
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(0, 0, r, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        break;
      }
      default:
        break;
    }
    g.restore();
  }
}

function drawImplants(xray: boolean) {
  const im = h.bone.implants;
  const pl = im.plate;
  if (pl) {
    const c = px(pl.pose.pos);
    g.save();
    g.translate(c.x, c.y);
    g.rotate((pl.pose.angleDeg * Math.PI) / 180);
    const L = pl.lengthMm * S;
    const W = pl.widthMm * S;
    const gr = g.createLinearGradient(0, -W / 2, 0, W / 2);
    gr.addColorStop(0, xray ? '#ffffff' : '#f7f6ff');
    gr.addColorStop(0.5, xray ? '#e8f7ff' : '#b9b6cf');
    gr.addColorStop(1, xray ? '#ffffff' : '#e9e7f5');
    g.fillStyle = gr;
    g.shadowColor = 'rgba(0,0,0,0.45)';
    g.shadowBlur = 8;
    g.beginPath();
    g.roundRect(-L / 2, -W / 2, L, W, W / 2);
    g.fill();
    g.shadowColor = 'transparent';
    g.strokeStyle = '#6d5c8f';
    g.lineWidth = 2;
    g.stroke();
    for (const hl of pl.holesLocal) {
      g.fillStyle = '#3b2e52';
      g.beginPath();
      g.arc(hl.x * S, hl.y * S, 1.4 * S, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }
  for (const sc of im.screws) {
    const c = px(sc.pos);
    g.save();
    g.fillStyle = sc.contaminated ? '#b6d77a' : '#f5c542';
    g.strokeStyle = '#6d5c8f';
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      g.lineTo(c.x + Math.cos(a) * 1.5 * S, c.y + Math.sin(a) * 1.5 * S);
    }
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = '#6d5c8f';
    g.fillRect(c.x - 3, c.y - 1, 6, 2);
    if (sc.stripped) {
      g.strokeStyle = '#ff4d6d';
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(c.x - 6, c.y - 6);
      g.lineTo(c.x + 6, c.y + 6);
      g.moveTo(c.x + 6, c.y - 6);
      g.lineTo(c.x - 6, c.y + 6);
      g.stroke();
    }
    g.restore();
  }
}

function updateBoneImage() {
  if (h.wound.erases === lastErases) return;
  lastErases = h.wound.erases;
  const img = boneCtx.createImageData(320, 200);
  const grid = h.wound.grids.bone;
  for (let i = 0; i < grid.length; i++) {
    if (!grid[i]) continue;
    img.data[i * 4] = 120;
    img.data[i * 4 + 1] = 22;
    img.data[i * 4 + 2] = 34;
    img.data[i * 4 + 3] = 235;
  }
  boneCtx.putImageData(img, 0, 0);
}

function draw(t: number) {
  const xray = h.wound.xray;
  const closed = !!sc.anatomy.closed;
  if (xray) {
    g.fillStyle = '#0b1630';
    g.fillRect(0, 0, 960, 600);
  } else {
    g.drawImage(bg, 0, 0);
  }
  // Médula.
  const cord = h.bone.cord();
  if (cord) {
    g.save();
    polyPath(cord);
    g.fillStyle = xray ? 'rgba(140,180,220,0.4)' : '#f4e7b8';
    g.fill();
    g.strokeStyle = '#d6bf73';
    g.lineWidth = 2;
    g.stroke();
    g.restore();
  }
  // Hueso estático y fragmentos.
  for (const poly of h.bone.staticPolygons()) drawBone(poly, { xray, faint: closed });
  for (const f of h.bone.fragments()) {
    if (f.removed) continue;
    drawBone(applyPosePoly(f.def.polygon, f.pose), { xray, faint: closed, highlight: f.highlighted, locked: f.locked, noTouch: f.def.noTouch });
  }
  // Tejido óseo retirado (fresa).
  updateBoneImage();
  g.save();
  g.imageSmoothingEnabled = true;
  g.globalAlpha = xray ? 0.4 : 1;
  g.drawImage(boneImg, 0, 0, 960, 600);
  g.restore();
  // Siluetas fantasma.
  if (h.wound.ghosts) {
    for (const f of h.bone.fragments()) {
      const tp = h.bone.targetPolygon(f.id);
      if (!tp || f.def.noTouch) continue;
      const err = h.bone.alignmentError(f.id);
      if (err.mm < 0.01 && err.deg < 0.01) continue;
      g.save();
      polyPath(tp);
      g.fillStyle = 'rgba(159,240,208,0.18)';
      g.fill();
      g.strokeStyle = '#9ff0d0';
      g.setLineDash([6, 5]);
      g.lineWidth = 2;
      g.stroke();
      g.restore();
    }
  }
  // Guía.
  const gd = h.wound.guide;
  if (gd.path && gd.level !== 'none') {
    g.save();
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 2;
    if (gd.level === 'full') {
      g.setLineDash([8, 6]);
      g.beginPath();
      gd.path.forEach((p, i) => (i ? g.lineTo(p.x * S, p.y * S) : g.moveTo(p.x * S, p.y * S)));
      g.stroke();
    }
    g.fillStyle = '#fff';
    for (const e of [gd.path[0], gd.path[gd.path.length - 1]]) {
      g.beginPath();
      g.arc(e.x * S, e.y * S, 4, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }
  drawDecals();
  drawImplants(xray);
  // Overlays de los pasos por z.
  const ovs = [...h.wound.overlays.values()].sort((a, b) => a.z - b.z);
  for (const o of ovs) o.draw(g, px, S, t);
  // Cursor del instrumento.
  const c = px(pointer);
  g.save();
  g.strokeStyle = '#fff';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(c.x, c.y, 5, 0, Math.PI * 2);
  g.moveTo(c.x - 10, c.y);
  g.lineTo(c.x - 6, c.y);
  g.moveTo(c.x + 6, c.y);
  g.lineTo(c.x + 10, c.y);
  g.stroke();
  g.font = '800 11px Nunito, sans-serif';
  g.fillStyle = '#fff6fb';
  g.strokeStyle = 'rgba(59,33,70,0.9)';
  g.lineWidth = 3;
  const label = NAMES[h.instrument] ?? h.instrument;
  g.strokeText(label, c.x + 12, c.y + 16);
  g.fillText(label, c.x + 12, c.y + 16);
  g.restore();
  if (flash && performance.now() < flash.until) {
    g.fillStyle = flash.color;
    g.fillRect(0, 0, 960, 600);
  }
}

// ── Panel lateral ──
function renderTabs() {
  const tabs = document.getElementById('tabs')!;
  tabs.innerHTML = '';
  ALL_SCENARIOS.forEach((f, i) => {
    const s = f();
    const b = document.createElement('button');
    b.textContent = `${i + 1} ${s.title.split(' ')[0]}`;
    if (i === idx) b.className = 'on';
    b.onclick = () => load(i);
    tabs.appendChild(b);
  });
  document.getElementById('stitle')!.textContent = sc.title;
}

function renderHotbar() {
  const bar = document.getElementById('hotbar')!;
  bar.innerHTML = '';
  for (const id of step.instruments) {
    const s = document.createElement('div');
    s.className = `slot${id === h.instrument ? ' on' : ''}`;
    s.textContent = NAMES[id] ?? id;
    s.onclick = () => {
      h.instrument = id as InstrumentId;
      renderHotbar();
    };
    bar.appendChild(s);
  }
  const pr = document.createElement('div');
  pr.id = 'pressure';
  pr.innerHTML = `Presión <b>${'●'.repeat(pressure)}${'○'.repeat(5 - pressure)}</b>`;
  bar.appendChild(pr);
}

function gaugeHtml(gg: Gauge): string {
  const span = gg.max - gg.min || 1;
  const pct = (v: number) => clamp(((v - gg.min) / span) * 100, 0, 100);
  const zones = (gg.zones ?? []).map((z) => `<div class="zone ${z.kind}" style="left:${pct(z.from)}%;width:${pct(z.to) - pct(z.from)}%"></div>`).join('');
  const val = Number.isInteger(gg.value) ? String(gg.value) : gg.max <= 2 ? gg.value.toFixed(2) : gg.value.toFixed(1);
  return `<div class="gauge">${gg.label}: ${val.replace('.', ',')}${gg.unit ?? ''}<div class="bar">${zones}<div class="mark" style="left:${pct(gg.value)}%"></div></div></div>`;
}

let lastHotbarInstrument: InstrumentId | null = null;
function renderSide() {
  document.getElementById('hint')!.textContent = step.hint();
  (document.querySelector('#prog i') as HTMLElement).style.width = `${Math.round(step.progress() * 100)}%`;
  document.getElementById('check')!.innerHTML = step.checklist().map((c) => `<div class="${c.done ? 'done' : ''}">${c.done ? '✔' : '○'} ${c.label}</div>`).join('');
  document.getElementById('gauges')!.innerHTML = step.gauges().map(gaugeHtml).join('') || '<div class="gauge">—</div>';
  if (lastHotbarInstrument !== h.instrument) {
    lastHotbarInstrument = h.instrument;
    renderHotbar();
  }
}

// ── Entrada ──
function toMm(e: PointerEvent): Vec2 {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / S, y: (e.clientY - r.top) / S };
}
function ptr(button: number): WoundPointer {
  return { mm: { ...pointer }, onWound: true, button, buttons, pressure, shift: false, t: h.t, instrument: h.instrument };
}
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointer = toMm(e);
  buttons = e.buttons;
  step.onPointerDown(ptr(e.button));
});
canvas.addEventListener('pointermove', (e) => {
  pointer = toMm(e);
  buttons = e.buttons;
  step.onPointerMove(ptr(e.button));
});
canvas.addEventListener('pointerup', (e) => {
  pointer = toMm(e);
  buttons = e.buttons;
  step.onPointerUp(ptr(e.button));
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    pressure = clamp(pressure + (e.deltaY < 0 ? 1 : -1), 1, 5);
    renderHotbar();
  },
  { passive: false },
);
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
  if (step.onKey(e.code, true)) return;
  if (e.code.startsWith('Digit')) {
    const n = Number(e.code.slice(5)) - 1;
    if (n >= 0 && n < ALL_SCENARIOS.length) load(n);
  } else if (e.code === 'Tab') {
    const ins = step.instruments;
    h.instrument = ins[(ins.indexOf(h.instrument) + 1) % ins.length];
  } else if (e.code === 'KeyN') load(idx);
});
window.addEventListener('keyup', (e) => {
  step.onKey(e.code, false);
});

// ── Bucle ──
const perf = { drawMs: 0, frameMs: 0 };
let last = 0;
let sideAcc = 0;
function frame(now: number) {
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
  last = now;
  if (dt > 0) {
    h.t += dt;
    h.beat.advance(dt);
    step.update(dt);
    if (subTimer > 0) {
      subTimer -= dt;
      if (subTimer <= 0) subEl.style.opacity = '0';
    }
  }
  const t0 = performance.now();
  draw(h.t);
  const t1 = performance.now();
  perf.drawMs = perf.drawMs * 0.9 + (t1 - t0) * 0.1;
  sideAcc += dt;
  if (sideAcc > 0.08 || dt === 0) {
    sideAcc = 0;
    renderSide();
  }
  perf.frameMs = perf.frameMs * 0.9 + (performance.now() - t0) * 0.1;
  const banner = document.getElementById('banner')!;
  if (step.isComplete() && banner.style.display !== 'block') {
    banner.innerHTML = '¡Paso completo!<small>N repite · 1–7 cambia de paso</small>';
    banner.style.display = 'block';
  }
  requestAnimationFrame(frame);
}

load(idx);
(window as unknown as { __sb: unknown }).__sb = {
  get step() {
    return step;
  },
  get h() {
    return h;
  },
  screen: project,
  perf,
};
requestAnimationFrame(frame);
