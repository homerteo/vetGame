/**
 * Dibujo 2D de elementos de la herida: hueso, implantes, sangrados, calcomanías, guía y fantasmas.
 * Coordenadas de entrada en mm; `s` = px por mm.
 */
import type { Bleeder, DecalKind, FragmentState, ImplantState, PlateState, Vec2 } from '../../core/contracts';
import { PALETTE } from '../../core/constants';
import { clamp, deg2rad, polygonBounds, polygonCentroid } from '../../core/math';
import { arterialPulse, hashId, type BloodLook } from './woundMath';
import { majorAxisDeg, rgba, traceSmoothPoly } from './canvasUtil';

type Ctx = CanvasRenderingContext2D;

// ───────────── Hueso ─────────────

const BONE_TONES: Record<string, [string, string, string, string, string]> = {
  bone: ['#cdb488', '#f3e6cb', '#fffaf0', '#ead9b6', '#c2a578'],
  block: ['#cdb488', '#f3e6cb', '#fffaf0', '#ead9b6', '#c2a578'],
  cartilage: ['#aebfd6', '#e3edf8', '#fbfdff', '#d6e3f2', '#9fb2cc'],
  disc: ['#c9b460', '#efe19a', '#fbf4c8', '#e6d27e', '#b89f48'],
  graft: ['#d0a870', '#f3d9a6', '#fff0cc', '#e8c790', '#bf935a'],
};

/** Dibuja un polígono óseo con sombreado cilíndrico, trabéculas y cortical. */
export function drawBonePoly(
  g: Ctx,
  poly: Vec2[],
  s: number,
  pattern: CanvasPattern | null,
  kind: string = 'bone',
  opts: { highlight?: boolean; noTouch?: boolean; shadow?: boolean } = {},
): void {
  if (poly.length < 3) return;
  const tones = BONE_TONES[kind] ?? BONE_TONES.bone;
  const ang = deg2rad(majorAxisDeg(poly));
  const c = polygonCentroid(poly);
  // Extensión a lo largo del eje menor.
  let lo = Infinity;
  let hi = -Infinity;
  const nx = -Math.sin(ang);
  const ny = Math.cos(ang);
  for (const p of poly) {
    const d = (p.x - c.x) * nx + (p.y - c.y) * ny;
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  const x0 = (c.x + nx * lo) * s;
  const y0 = (c.y + ny * lo) * s;
  const x1 = (c.x + nx * hi) * s;
  const y1 = (c.y + ny * hi) * s;
  g.save();
  if (opts.shadow !== false) {
    g.shadowColor = opts.highlight ? 'rgba(159,240,208,0.95)' : 'rgba(10,0,4,0.7)';
    g.shadowBlur = opts.highlight ? 22 : 12;
    g.shadowOffsetY = opts.highlight ? 0 : 4;
  }
  const lg = g.createLinearGradient(x0, y0, x1, y1);
  lg.addColorStop(0, tones[0]);
  lg.addColorStop(0.22, tones[1]);
  lg.addColorStop(0.42, tones[2]);
  lg.addColorStop(0.78, tones[3]);
  lg.addColorStop(1, tones[4]);
  g.fillStyle = lg;
  traceSmoothPoly(g, poly, s);
  g.fill();
  g.restore();
  g.save();
  traceSmoothPoly(g, poly, s);
  g.clip();
  if (pattern) {
    g.globalAlpha = kind === 'cartilage' || kind === 'disc' ? 0.12 : kind === 'graft' ? 0.75 : 0.28;
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = pattern;
    g.fill();
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
  }
  // Borde interior oscurecido (volumen) y reflejo húmedo.
  g.lineWidth = 2.6 * s;
  g.strokeStyle = 'rgba(120,80,40,0.22)';
  traceSmoothPoly(g, poly, s);
  g.stroke();
  g.lineWidth = 0.9 * s;
  g.strokeStyle = 'rgba(255,255,250,0.75)';
  g.beginPath();
  const hx = (c.x + nx * lo * 0.45) * s;
  const hy = (c.y + ny * lo * 0.45) * s;
  const tx = Math.cos(ang);
  const ty = Math.sin(ang);
  const b = polygonBounds(poly);
  const half = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.36 * s;
  g.moveTo(hx - tx * half, hy - ty * half);
  g.lineTo(hx + tx * half, hy + ty * half);
  g.stroke();
  g.restore();
  // Cortical.
  g.save();
  g.lineJoin = 'round';
  g.lineWidth = 0.45 * s;
  g.strokeStyle = kind === 'cartilage' ? 'rgba(90,110,150,0.8)' : 'rgba(140,105,60,0.85)';
  traceSmoothPoly(g, poly, s);
  g.stroke();
  if (opts.highlight) {
    g.lineWidth = 0.7 * s;
    g.strokeStyle = PALETTE.mint;
    g.stroke();
  }
  if (opts.noTouch) {
    g.setLineDash([1.1 * s, 0.8 * s]);
    g.lineWidth = 0.55 * s;
    g.strokeStyle = 'rgba(255,190,70,0.95)';
    traceSmoothPoly(g, poly, s);
    g.stroke();
  }
  g.restore();
}

export function drawFragments(g: Ctx, frags: FragmentState[], worldPoly: (id: string) => Vec2[], s: number, pattern: CanvasPattern | null): void {
  for (const f of frags) {
    if (f.removed) continue;
    drawBonePoly(g, worldPoly(f.id), s, pattern, f.def.kind ?? 'bone', { highlight: f.highlighted, noTouch: f.def.noTouch });
  }
}

// ───────────── Implantes ─────────────

/** Contorno de placa tipo LC-DCP: cintura entre agujeros. */
function tracePlate(g: Ctx, pl: PlateState, s: number): void {
  const L = pl.lengthMm;
  const W = pl.widthMm;
  const holes = pl.holesLocal.length > 0 ? [...pl.holesLocal].sort((a, b) => a.x - b.x) : [];
  g.beginPath();
  // Borde superior con cinturas.
  const r = W / 2;
  g.moveTo((-L / 2 + r) * s, -r * s);
  for (let i = 0; i < holes.length - 1; i++) {
    const mx = (holes[i].x + holes[i + 1].x) / 2;
    g.quadraticCurveTo((mx - 1.5) * s, -r * s, mx * s, -r * 0.78 * s);
    g.quadraticCurveTo((mx + 1.5) * s, -r * s, holes[i + 1].x * s, -r * s);
  }
  g.lineTo((L / 2 - r) * s, -r * s);
  g.arc((L / 2 - r) * s, 0, r * s, -Math.PI / 2, Math.PI / 2);
  for (let i = holes.length - 1; i > 0; i--) {
    const mx = (holes[i].x + holes[i - 1].x) / 2;
    g.quadraticCurveTo((mx + 1.5) * s, r * s, mx * s, r * 0.78 * s);
    g.quadraticCurveTo((mx - 1.5) * s, r * s, holes[i - 1].x * s, r * s);
  }
  g.lineTo((-L / 2 + r) * s, r * s);
  g.arc((-L / 2 + r) * s, 0, r * s, Math.PI / 2, (3 * Math.PI) / 2);
  g.closePath();
}

export function drawPlate(g: Ctx, pl: PlateState, s: number): void {
  const px = pl.pose.pos.x * s;
  const py = pl.pose.pos.y * s;
  const gap = (1 - clamp(pl.bend, 0, 1)) * 1.6 * s; // mal contorneada: "flota"
  g.save();
  g.translate(px, py);
  g.rotate(deg2rad(pl.pose.angleDeg));
  // Sombra propia.
  g.save();
  g.translate(0.5 * s + gap * 0.4, 1 * s + gap);
  g.fillStyle = `rgba(20,0,8,${0.45 - gap / s / 10})`;
  tracePlate(g, pl, s);
  g.fill();
  g.restore();
  const W = pl.widthMm;
  const lg = g.createLinearGradient(0, (-W / 2) * s, 0, (W / 2) * s);
  lg.addColorStop(0, '#7c8597');
  lg.addColorStop(0.18, '#eef2f8');
  lg.addColorStop(0.4, '#b9c1cf');
  lg.addColorStop(0.62, '#dfe5ee');
  lg.addColorStop(0.85, '#8e97a8');
  lg.addColorStop(1, '#5d6576');
  g.fillStyle = lg;
  tracePlate(g, pl, s);
  g.fill();
  g.lineWidth = 0.3 * s;
  g.strokeStyle = 'rgba(40,46,60,0.8)';
  g.stroke();
  // Reflejo anodizado (lila sutil, kawaii).
  g.globalCompositeOperation = 'overlay';
  g.fillStyle = 'rgba(200,162,232,0.35)';
  tracePlate(g, pl, s);
  g.fill();
  g.globalCompositeOperation = 'source-over';
  // Agujeros (los híbridos: los del extremo más pequeños).
  const n = pl.holesLocal.length;
  pl.holesLocal.forEach((h, i) => {
    const small = pl.hybrid && i >= Math.ceil(n * 0.6);
    const hr = (small ? 1.05 : 1.35) * s;
    const hx = h.x * s;
    const hy = h.y * s;
    const bev = g.createRadialGradient(hx - hr * 0.3, hy - hr * 0.3, hr * 0.2, hx, hy, hr * 1.55);
    bev.addColorStop(0, '#454b58');
    bev.addColorStop(0.62, '#8993a5');
    bev.addColorStop(0.7, '#f4f7fb');
    bev.addColorStop(1, 'rgba(160,170,185,0)');
    g.fillStyle = bev;
    g.beginPath();
    g.ellipse(hx, hy, hr * 1.5, hr * 1.25, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2a0a10';
    g.beginPath();
    g.ellipse(hx, hy, hr * (small ? 1 : 1.18), hr, 0, 0, Math.PI * 2);
    g.fill();
  });
  g.restore();
}

export function drawScrew(g: Ctx, pos: Vec2, s: number, contaminated: boolean, stripped: boolean, seed: number): void {
  const x = pos.x * s;
  const y = pos.y * s;
  const r = 1.65 * s;
  g.save();
  g.fillStyle = 'rgba(20,0,6,0.5)';
  g.beginPath();
  g.arc(x + 0.35 * s, y + 0.55 * s, r, 0, Math.PI * 2);
  g.fill();
  const rg = g.createRadialGradient(x - r * 0.4, y - r * 0.45, r * 0.1, x, y, r);
  if (contaminated) {
    rg.addColorStop(0, '#f1ffd8');
    rg.addColorStop(0.5, '#a8c46a');
    rg.addColorStop(1, '#5c7234');
  } else {
    rg.addColorStop(0, '#fff7da');
    rg.addColorStop(0.45, '#e6c46a');
    rg.addColorStop(1, '#8d6a2a');
  }
  g.fillStyle = rg;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  // Insinuación de rosca en el borde.
  g.strokeStyle = 'rgba(80,60,20,0.55)';
  g.lineWidth = 0.18 * s;
  g.beginPath();
  g.arc(x, y, r * 0.86, 0.3, Math.PI * 1.7);
  g.stroke();
  // Hexágono.
  const a0 = hashId(seed) * Math.PI;
  g.fillStyle = '#3a2a14';
  g.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = a0 + (k * Math.PI) / 3;
    const hx = x + Math.cos(a) * r * 0.46;
    const hy = y + Math.sin(a) * r * 0.46;
    if (k === 0) g.moveTo(hx, hy);
    else g.lineTo(hx, hy);
  }
  g.closePath();
  g.fill();
  if (stripped) {
    g.strokeStyle = '#ff5a5a';
    g.lineWidth = 0.28 * s;
    g.beginPath();
    g.moveTo(x - r * 0.55, y - r * 0.55);
    g.lineTo(x + r * 0.55, y + r * 0.55);
    g.moveTo(x + r * 0.55, y - r * 0.55);
    g.lineTo(x - r * 0.55, y + r * 0.55);
    g.stroke();
  }
  g.fillStyle = 'rgba(255,255,255,0.8)';
  g.beginPath();
  g.arc(x - r * 0.45, y - r * 0.5, r * 0.18, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function steelLine(g: Ctx, ax: number, ay: number, bx: number, by: number, w: number): void {
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(20,0,8,0.45)';
  g.lineWidth = w;
  g.beginPath();
  g.moveTo(ax + w * 0.5, ay + w * 0.8);
  g.lineTo(bx + w * 0.5, by + w * 0.8);
  g.stroke();
  g.strokeStyle = '#8c95a5';
  g.beginPath();
  g.moveTo(ax, ay);
  g.lineTo(bx, by);
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = w * 0.35;
  g.beginPath();
  g.moveTo(ax - w * 0.15, ay - w * 0.2);
  g.lineTo(bx - w * 0.15, by - w * 0.2);
  g.stroke();
}

export function drawPin(g: Ctx, pos: Vec2, kind: 'pin' | 'kwire' | 'rod' | 'hole', s: number, seed: number): void {
  const x = pos.x * s;
  const y = pos.y * s;
  g.save();
  if (kind === 'hole') {
    drawHole(g, x, y, 1.1 * s);
    g.restore();
    return;
  }
  const r = (kind === 'rod' ? 1.6 : kind === 'pin' ? 1.2 : 0.65) * s;
  // Extremo doblado (las agujas se doblan para no pinchar).
  const a = hashId(seed, 3) * Math.PI * 2;
  const tail = (kind === 'kwire' ? 7 : 4) * s;
  const bx = x + Math.cos(a) * tail;
  const by = y + Math.sin(a) * tail;
  steelLine(g, x, y, bx, by, r * (kind === 'kwire' ? 1.1 : 0.9));
  // Punta doblada.
  steelLine(g, bx, by, bx + Math.cos(a + 1.6) * r * 2.2, by + Math.sin(a + 1.6) * r * 2.2, r * 0.9);
  const rg = g.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  rg.addColorStop(0, '#ffffff');
  rg.addColorStop(0.5, '#b7c0cd');
  rg.addColorStop(1, '#5b6474');
  g.fillStyle = rg;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

export function drawHole(g: Ctx, x: number, y: number, r: number): void {
  // Polvo de hueso alrededor.
  g.fillStyle = 'rgba(255,248,230,0.7)';
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + 0.3;
    g.beginPath();
    g.arc(x + Math.cos(a) * r * 1.6, y + Math.sin(a) * r * 1.5, r * 0.18, 0, Math.PI * 2);
    g.fill();
  }
  const rg = g.createRadialGradient(x, y, 0, x, y, r * 1.3);
  rg.addColorStop(0, '#12020a');
  rg.addColorStop(0.7, '#3a0a14');
  rg.addColorStop(0.85, '#c9a67a');
  rg.addColorStop(1, 'rgba(201,166,122,0)');
  g.fillStyle = rg;
  g.beginPath();
  g.arc(x, y, r * 1.3, 0, Math.PI * 2);
  g.fill();
}

/** Banda de tensión en ocho. */
export function drawFigure8(g: Ctx, a: Vec2, b: Vec2, s: number): void {
  const ax = a.x * s;
  const ay = a.y * s;
  const bx = b.x * s;
  const by = b.y * s;
  const dx = bx - ax;
  const dy = by - ay;
  const l = Math.hypot(dx, dy) || 1;
  const nx = (-dy / l) * 3.2 * s;
  const ny = (dx / l) * 3.2 * s;
  g.save();
  g.lineCap = 'round';
  const path = () => {
    g.beginPath();
    g.moveTo(ax + nx, ay + ny);
    g.bezierCurveTo(ax + dx * 0.4 + nx, ay + dy * 0.4 + ny, ax + dx * 0.6 - nx, ay + dy * 0.6 - ny, bx - nx, by - ny);
    g.quadraticCurveTo(bx + dx * 0.08, by + dy * 0.08, bx + nx, by + ny);
    g.bezierCurveTo(ax + dx * 0.6 + nx, ay + dy * 0.6 + ny, ax + dx * 0.4 - nx, ay + dy * 0.4 - ny, ax - nx, ay - ny);
    g.quadraticCurveTo(ax - dx * 0.08, ay - dy * 0.08, ax + nx, ay + ny);
  };
  g.strokeStyle = 'rgba(20,0,8,0.45)';
  g.lineWidth = 0.8 * s;
  g.save();
  g.translate(0.4 * s, 0.6 * s);
  path();
  g.stroke();
  g.restore();
  g.strokeStyle = '#9aa3b2';
  g.lineWidth = 0.6 * s;
  path();
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.8)';
  g.lineWidth = 0.2 * s;
  path();
  g.stroke();
  // Torsión (nudo del alambre).
  const tx = ax + nx * 1.4;
  const ty = ay + ny * 1.4;
  g.strokeStyle = '#c3cad6';
  g.lineWidth = 0.45 * s;
  for (let k = 0; k < 4; k++) {
    g.beginPath();
    g.arc(tx + (nx / 3.2) * k * 0.5, ty + (ny / 3.2) * k * 0.5, 0.7 * s, 0, Math.PI * 1.4);
    g.stroke();
  }
  g.restore();
}

/** Barra del fijador externo con abrazaderas en los extremos. */
export function drawBar(g: Ctx, a: Vec2, b: Vec2, s: number): void {
  const ax = a.x * s;
  const ay = a.y * s;
  const bx = b.x * s;
  const by = b.y * s;
  const w = 3 * s;
  g.save();
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(20,0,10,0.4)';
  g.lineWidth = w;
  g.beginPath();
  g.moveTo(ax + 2 * s, ay + 3 * s);
  g.lineTo(bx + 2 * s, by + 3 * s);
  g.stroke();
  g.strokeStyle = '#8f6fc4';
  g.beginPath();
  g.moveTo(ax, ay);
  g.lineTo(bx, by);
  g.stroke();
  g.strokeStyle = '#c8a2e8';
  g.lineWidth = w * 0.55;
  g.beginPath();
  g.moveTo(ax, ay - w * 0.12);
  g.lineTo(bx, by - w * 0.12);
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.8)';
  g.lineWidth = w * 0.16;
  g.beginPath();
  g.moveTo(ax, ay - w * 0.25);
  g.lineTo(bx, by - w * 0.25);
  g.stroke();
  g.restore();
  drawClamp(g, a, s, Math.atan2(by - ay, bx - ax));
  drawClamp(g, b, s, Math.atan2(by - ay, bx - ax));
}

export function drawClamp(g: Ctx, p: Vec2, s: number, ang = 0): void {
  g.save();
  g.translate(p.x * s, p.y * s);
  g.rotate(ang);
  g.fillStyle = 'rgba(20,0,10,0.4)';
  g.fillRect(-2.3 * s + 1.5 * s, -2.8 * s + 2.5 * s, 4.6 * s, 5.6 * s);
  const lg = g.createLinearGradient(0, -2.8 * s, 0, 2.8 * s);
  lg.addColorStop(0, '#f3f5f9');
  lg.addColorStop(0.5, '#a9b2c1');
  lg.addColorStop(1, '#6a7383');
  g.fillStyle = lg;
  g.beginPath();
  g.roundRect(-2.3 * s, -2.8 * s, 4.6 * s, 5.6 * s, 0.9 * s);
  g.fill();
  g.strokeStyle = 'rgba(40,40,60,0.7)';
  g.lineWidth = 0.2 * s;
  g.stroke();
  g.fillStyle = '#ff8fc7';
  g.beginPath();
  g.arc(0, 0, 1.05 * s, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#3b2146';
  g.fillRect(-0.7 * s, -0.16 * s, 1.4 * s, 0.32 * s);
  g.restore();
}

export function drawImplants(g: Ctx, imp: ImplantState, s: number): void {
  if (imp.plate) drawPlate(g, imp.plate, s);
  for (let i = 0; i < imp.wires.length; i++) drawFigure8(g, imp.wires[i].a, imp.wires[i].b, s);
  for (let i = 0; i < imp.screws.length; i++) {
    const sc = imp.screws[i];
    drawScrew(g, sc.pos, s, sc.contaminated, sc.stripped, i + 1);
  }
  for (let i = 0; i < imp.pins.length; i++) drawPin(g, imp.pins[i].pos, imp.pins[i].kind, s, i + 11);
  for (let i = 0; i < imp.bars.length; i++) drawBar(g, imp.bars[i].a, imp.bars[i].b, s);
}

// ───────────── Sangrados ─────────────

const JET_DROPS = 16;

export function drawBleeder(g: Ctx, b: Bleeder, tIn: number, s: number, look: BloodLook, sparkle: HTMLCanvasElement | null): void {
  const t = Math.abs(tIn);
  const x = b.pos.x * s;
  const y = b.pos.y * s;
  const age = Math.max(0, tIn - b.bornAt);
  const grow = clamp(age / 0.6, 0, 1);
  const fresh = rgba(look.r, look.g, look.b, look.alpha);
  const dark = rgba(look.dr, look.dg, look.db, look.alpha);
  if (b.kind === 'arterial') {
    const phase = hashId(b.id, 1) * 0.6;
    const p = arterialPulse(t + phase);
    const ang = hashId(b.id, 2) * Math.PI * 2;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const L = (9 + 26 * p) * s * look.amount * grow;
    // Charquito en el origen.
    const pr = (2.2 + p * 0.8) * s;
    const rg = g.createRadialGradient(x - pr * 0.3, y - pr * 0.3, 0, x, y, pr);
    rg.addColorStop(0, rgba(Math.min(255, look.r + 50), look.g + 30, look.b + 30, look.alpha));
    rg.addColorStop(0.6, fresh);
    rg.addColorStop(1, rgba(look.dr, look.dg, look.db, 0));
    g.fillStyle = rg;
    g.beginPath();
    g.arc(x, y, pr, 0, Math.PI * 2);
    g.fill();
    // Chorro central afilado.
    const w0 = (0.7 + 1.1 * p) * s;
    const ex = x + ca * L * 0.65;
    const ey = y + sa * L * 0.65;
    g.fillStyle = fresh;
    g.beginPath();
    g.moveTo(x - sa * w0, y + ca * w0);
    g.quadraticCurveTo(x + ca * L * 0.35 - sa * w0 * 0.8, y + sa * L * 0.35 + ca * w0 * 0.8, ex, ey);
    g.quadraticCurveTo(x + ca * L * 0.35 + sa * w0 * 0.8, y + sa * L * 0.35 - ca * w0 * 0.8, x + sa * w0, y - ca * w0);
    g.closePath();
    g.fill();
    // Gotas en abanico que viajan hacia fuera.
    const n = Math.round(JET_DROPS * (0.4 + 0.6 * look.amount));
    for (let k = 0; k < n; k++) {
      const u = (hashId(b.id * 31 + k, 5) + t * 1.9) % 1;
      const spread = (hashId(b.id * 17 + k, 6) - 0.5) * 0.55;
      const d = u * L * (0.9 + 0.35 * p);
      const bend = u * u * 3 * s; // caída del arco
      const dxp = x + (ca - sa * spread) * d - sa * bend * 0.3;
      const dyp = y + (sa + ca * spread) * d + ca * bend * 0.3 + bend * 0.4;
      const r = (1 - u * 0.7) * (0.45 + hashId(k, 9) * 0.5) * s;
      g.fillStyle = k % 3 === 0 ? dark : fresh;
      g.globalAlpha = 1 - u * 0.6;
      g.beginPath();
      g.arc(dxp, dyp, r, 0, Math.PI * 2);
      g.fill();
      if (look.pastel && sparkle && k % 4 === 0) {
        g.globalAlpha = 0.5 + 0.5 * Math.sin(t * 12 + k);
        g.drawImage(sparkle, dxp - 5, dyp - 5, 10, 10);
      }
    }
    g.globalAlpha = 1;
    // Brillo del charquito.
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.beginPath();
    g.ellipse(x - pr * 0.35, y - pr * 0.4, pr * 0.28, pr * 0.16, -0.5, 0, Math.PI * 2);
    g.fill();
  } else if (b.kind === 'venous') {
    const r = (2.4 + 0.5 * Math.sin(t * 1.3 + b.id) + 0.8 * grow) * s * (0.7 + 0.3 * look.amount);
    // Lengua que escurre hacia abajo.
    g.fillStyle = dark;
    g.beginPath();
    g.ellipse(x + 0.6 * s, y + r * 0.9, r * 0.55, r * (0.9 + 0.2 * Math.sin(t * 0.7)), 0.15, 0, Math.PI * 2);
    g.fill();
    const rg = g.createRadialGradient(x - r * 0.25, y - r * 0.3, 0, x, y, r);
    rg.addColorStop(0, rgba(look.dr + 40, look.dg + 10, look.db + 20, look.alpha));
    rg.addColorStop(0.55, dark);
    rg.addColorStop(1, rgba(look.dr * 0.6, look.dg * 0.6, look.db * 0.6, look.alpha * 0.9));
    g.fillStyle = rg;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath();
    g.ellipse(x - r * 0.35, y - r * 0.42, r * 0.3, r * 0.14, -0.5, 0, Math.PI * 2);
    g.fill();
    // Borbotón lento.
    const w = (t * 0.8 + hashId(b.id)) % 1;
    g.strokeStyle = `rgba(255,200,200,${0.35 * (1 - w)})`;
    g.lineWidth = 0.25 * s;
    g.beginPath();
    g.arc(x, y, r * (0.3 + w * 0.6), 0, Math.PI * 2);
    g.stroke();
  } else {
    // Capilar: perlas que rezuman.
    for (let k = 0; k < 6; k++) {
      const a = hashId(b.id * 7 + k, 2) * Math.PI * 2;
      const d = (0.8 + hashId(b.id * 3 + k, 4) * 2.2) * s;
      const cyc = (t * 0.45 + hashId(b.id + k, 8)) % 1;
      const r = (0.35 + cyc * 0.75) * s * (0.6 + 0.4 * look.amount) * grow;
      const bx = x + Math.cos(a) * d;
      const by = y + Math.sin(a) * d + cyc * 0.6 * s;
      g.fillStyle = fresh;
      g.globalAlpha = 0.6 + 0.4 * cyc;
      g.beginPath();
      g.arc(bx, by, r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.beginPath();
      g.arc(bx - r * 0.35, by - r * 0.35, r * 0.3, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    if (look.pastel && sparkle) {
      g.globalAlpha = 0.5 + 0.5 * Math.sin(t * 9 + b.id);
      g.drawImage(sparkle, x - 6, y - 6, 12, 12);
      g.globalAlpha = 1;
    }
  }
}

export function drawSealed(g: Ctx, b: Bleeder, s: number): void {
  const x = b.pos.x * s;
  const y = b.pos.y * s;
  const r = (b.charred ? 2.2 : 1.1) * s;
  g.save();
  if (b.charred) {
    g.fillStyle = 'rgba(230,200,120,0.25)';
    g.beginPath();
    g.arc(x, y, r * 1.7, 0, Math.PI * 2);
    g.fill();
  }
  const rg = g.createRadialGradient(x, y, 0, x, y, r);
  rg.addColorStop(0, b.charred ? '#140a06' : '#3a1c10');
  rg.addColorStop(0.6, b.charred ? '#2e1a10' : '#6a3a22');
  rg.addColorStop(1, 'rgba(110,60,30,0)');
  g.fillStyle = rg;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

// ───────────── Calcomanías ─────────────

export interface DecalOpts {
  angleDeg?: number;
  sizeMm?: number;
  to?: Vec2;
}

export function drawDecal(g: Ctx, kind: DecalKind, pos: Vec2, o: DecalOpts, s: number, seed: number): void {
  const x = pos.x * s;
  const y = pos.y * s;
  const ang = deg2rad(o.angleDeg ?? 0);
  const size = (o.sizeMm ?? 0) * s;
  g.save();
  g.lineCap = 'round';
  switch (kind) {
    case 'char': {
      const r = size || 2.6 * s;
      const halo = g.createRadialGradient(x, y, r * 0.3, x, y, r * 1.8);
      halo.addColorStop(0, 'rgba(60,30,10,0.6)');
      halo.addColorStop(1, 'rgba(200,170,100,0)');
      g.fillStyle = halo;
      g.beginPath();
      g.arc(x, y, r * 1.8, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#1b0e08';
      g.beginPath();
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2;
        const rr = r * (0.6 + hashId(seed * 13 + k) * 0.5);
        if (k === 0) g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        else g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
      break;
    }
    case 'scratch': {
      const l = size || 5 * s;
      g.strokeStyle = 'rgba(255,250,235,0.7)';
      g.lineWidth = 0.3 * s;
      for (let k = 0; k < 3; k++) {
        const off = (k - 1) * 0.6 * s;
        g.beginPath();
        g.moveTo(x - Math.cos(ang) * l / 2 - Math.sin(ang) * off, y - Math.sin(ang) * l / 2 + Math.cos(ang) * off);
        g.lineTo(x + Math.cos(ang) * l / 2 - Math.sin(ang) * off, y + Math.sin(ang) * l / 2 + Math.cos(ang) * off);
        g.stroke();
      }
      break;
    }
    case 'hole':
      drawHole(g, x, y, (size || 2.2 * s) / 2);
      break;
    case 'kwire': {
      if (o.to) steelLine(g, x, y, o.to.x * s, o.to.y * s, 0.8 * s);
      else drawPin(g, pos, 'kwire', s, seed);
      break;
    }
    case 'pin':
      // Aguja transcutánea: piel ligeramente hundida alrededor.
      g.fillStyle = 'rgba(120,40,50,0.25)';
      g.beginPath();
      g.arc(x, y, 2.6 * s, 0, Math.PI * 2);
      g.fill();
      drawPin(g, pos, 'pin', s, seed);
      break;
    case 'stitch': {
      const l = (o.sizeMm ?? 7) * s;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const ax = x - ca * l / 2;
      const ay = y - sa * l / 2;
      const bx = x + ca * l / 2;
      const by = y + sa * l / 2;
      // Hoyuelos de entrada y salida.
      g.fillStyle = 'rgba(110,30,40,0.55)';
      g.beginPath();
      g.arc(ax, ay, 0.5 * s, 0, Math.PI * 2);
      g.arc(bx, by, 0.5 * s, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(30,0,20,0.35)';
      g.lineWidth = 0.7 * s;
      g.beginPath();
      g.moveTo(ax + 0.3 * s, ay + 0.5 * s);
      g.quadraticCurveTo(x - sa * 1.2 * s + 0.3 * s, y + ca * 1.2 * s + 0.5 * s, bx + 0.3 * s, by + 0.5 * s);
      g.stroke();
      g.strokeStyle = '#7b4df0';
      g.lineWidth = 0.5 * s;
      g.beginPath();
      g.moveTo(ax, ay);
      g.quadraticCurveTo(x - sa * 1.2 * s, y + ca * 1.2 * s, bx, by);
      g.stroke();
      g.strokeStyle = 'rgba(230,215,255,0.8)';
      g.lineWidth = 0.15 * s;
      g.stroke();
      break;
    }
    case 'knot': {
      g.strokeStyle = '#7b4df0';
      g.lineWidth = 0.45 * s;
      for (let k = 0; k < 2; k++) {
        const a = ang + (k ? 0.5 : -0.5);
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(a) * 2.6 * s, y + Math.sin(a) * 2.6 * s);
        g.stroke();
      }
      g.fillStyle = '#5a2fc8';
      g.beginPath();
      g.arc(x, y, 0.9 * s, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.beginPath();
      g.arc(x - 0.3 * s, y - 0.3 * s, 0.3 * s, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'wire':
      if (o.to) drawFigure8(g, pos, o.to, s);
      else {
        g.strokeStyle = '#a9b2c1';
        g.lineWidth = 0.6 * s;
        g.beginPath();
        g.ellipse(x, y, (size || 6 * s) / 2, 1.2 * s, ang, 0, Math.PI * 2);
        g.stroke();
      }
      break;
    case 'bar':
      if (o.to) drawBar(g, pos, o.to, s);
      else {
        const l = size || 20 * s;
        drawBar(g, { x: pos.x - (Math.cos(ang) * l) / s / 2, y: pos.y - (Math.sin(ang) * l) / s / 2 }, { x: pos.x + (Math.cos(ang) * l) / s / 2, y: pos.y + (Math.sin(ang) * l) / s / 2 }, s);
      }
      break;
    case 'clamp':
      drawClamp(g, pos, s, ang);
      break;
    case 'graft': {
      const r = size || 5 * s;
      for (let k = 0; k < 14; k++) {
        const a = hashId(seed * 5 + k, 1) * Math.PI * 2;
        const d = hashId(seed * 7 + k, 2) * r;
        const cr = (0.7 + hashId(k, seed) * 0.9) * s;
        const cx = x + Math.cos(a) * d;
        const cy = y + Math.sin(a) * d * 0.7;
        g.fillStyle = 'rgba(20,0,6,0.35)';
        g.beginPath();
        g.arc(cx + 0.3 * s, cy + 0.4 * s, cr, 0, Math.PI * 2);
        g.fill();
        const rg = g.createRadialGradient(cx - cr * 0.3, cy - cr * 0.3, 0, cx, cy, cr);
        rg.addColorStop(0, '#fff3d4');
        rg.addColorStop(1, '#d9a864');
        g.fillStyle = rg;
        g.beginPath();
        g.arc(cx, cy, cr, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(150,90,50,0.6)';
        g.beginPath();
        g.arc(cx + cr * 0.2, cy, cr * 0.25, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case 'necrosis': {
      const r = size || 4 * s;
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, 'rgba(70,50,40,0.85)');
      rg.addColorStop(0.5, 'rgba(120,100,80,0.6)');
      rg.addColorStop(1, 'rgba(160,140,110,0)');
      g.fillStyle = rg;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(40,25,20,0.7)';
      g.lineWidth = 0.2 * s;
      for (let k = 0; k < 5; k++) {
        const a = hashId(seed + k, 3) * Math.PI * 2;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8);
        g.stroke();
      }
      break;
    }
    case 'fissure': {
      const l = size || 10 * s;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      g.strokeStyle = 'rgba(40,0,6,0.9)';
      g.lineWidth = 0.45 * s;
      g.beginPath();
      g.moveTo(x - ca * l / 2, y - sa * l / 2);
      for (let k = 1; k <= 8; k++) {
        const u = k / 8 - 0.5;
        const j = (hashId(seed * 11 + k, 4) - 0.5) * 1.6 * s;
        g.lineTo(x + ca * l * u - sa * j, y + sa * l * u + ca * j);
      }
      g.stroke();
      g.strokeStyle = 'rgba(255,240,220,0.5)';
      g.lineWidth = 0.15 * s;
      g.stroke();
      break;
    }
  }
  g.restore();
}

// ───────────── Guía y fantasmas ─────────────

export function drawGuide(g: Ctx, path: Vec2[], level: 'full' | 'endpoints' | 'none', s: number, t: number): void {
  if (level === 'none' || path.length < 2) return;
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (level === 'full') {
    const trace = () => {
      g.beginPath();
      g.moveTo(path[0].x * s, path[0].y * s);
      for (let i = 1; i < path.length; i++) g.lineTo(path[i].x * s, path[i].y * s);
    };
    g.strokeStyle = 'rgba(59,33,70,0.35)';
    g.lineWidth = 1.3 * s;
    trace();
    g.stroke();
    g.strokeStyle = 'rgba(159,240,208,0.25)';
    g.lineWidth = 3 * s;
    trace();
    g.stroke();
    g.setLineDash([0.1 * s, 1.6 * s]);
    g.lineDashOffset = -t * 6 * s;
    g.strokeStyle = PALETTE.mint;
    g.lineWidth = 0.85 * s;
    trace();
    g.stroke();
    g.setLineDash([]);
  }
  const a = path[0];
  const b = path[path.length - 1];
  const pulse = 1 + 0.15 * Math.sin(t * 4);
  // Inicio: círculo con triángulo; fin: diana.
  g.fillStyle = 'rgba(59,33,70,0.55)';
  g.beginPath();
  g.arc(a.x * s, a.y * s, 2.4 * s * pulse, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = PALETTE.mint;
  g.lineWidth = 0.5 * s;
  g.stroke();
  const dir = Math.atan2(path[1].y - a.y, path[1].x - a.x);
  g.fillStyle = PALETTE.mint;
  g.beginPath();
  for (let k = 0; k < 3; k++) {
    const an = dir + (k * Math.PI * 2) / 3;
    const px = a.x * s + Math.cos(an) * 1.2 * s;
    const py = a.y * s + Math.sin(an) * 1.2 * s;
    if (k === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.fill();
  g.strokeStyle = PALETTE.mint;
  g.lineWidth = 0.5 * s;
  g.fillStyle = 'rgba(59,33,70,0.55)';
  g.beginPath();
  g.arc(b.x * s, b.y * s, 2.4 * s * pulse, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = PALETTE.bubblegum;
  g.beginPath();
  g.arc(b.x * s, b.y * s, 0.9 * s, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

export function drawGhost(g: Ctx, poly: Vec2[], s: number, t: number): void {
  if (poly.length < 3) return;
  g.save();
  const a = 0.2 + 0.08 * Math.sin(t * 3);
  g.fillStyle = `rgba(159,240,208,${a})`;
  traceSmoothPoly(g, poly, s);
  g.fill();
  g.setLineDash([1.2 * s, 0.8 * s]);
  g.lineDashOffset = -t * 3 * s;
  g.lineWidth = 0.5 * s;
  g.strokeStyle = 'rgba(159,240,208,0.95)';
  g.stroke();
  g.restore();
}

// ───────────── Rayos X ─────────────

export function drawXrayBone(g: Ctx, poly: Vec2[], s: number): void {
  if (poly.length < 3) return;
  g.save();
  g.shadowColor = 'rgba(200,225,255,0.55)';
  g.shadowBlur = 10;
  g.fillStyle = 'rgba(170,190,215,0.85)';
  traceSmoothPoly(g, poly, s);
  g.fill();
  g.shadowBlur = 0;
  g.lineWidth = 1.3 * s;
  g.strokeStyle = 'rgba(240,248,255,0.95)';
  g.stroke();
  // Canal medular más oscuro.
  const c = polygonCentroid(poly);
  const ang = deg2rad(majorAxisDeg(poly));
  g.clip();
  g.strokeStyle = 'rgba(80,100,130,0.45)';
  g.lineWidth = 2.2 * s;
  const b = polygonBounds(poly);
  const half = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.42 * s;
  g.beginPath();
  g.moveTo(c.x * s - Math.cos(ang) * half, c.y * s - Math.sin(ang) * half);
  g.lineTo(c.x * s + Math.cos(ang) * half, c.y * s + Math.sin(ang) * half);
  g.stroke();
  g.restore();
}

export function drawXrayImplants(g: Ctx, imp: ImplantState, s: number): void {
  g.save();
  g.shadowColor = 'rgba(255,255,255,0.9)';
  g.shadowBlur = 8;
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#ffffff';
  if (imp.plate) {
    const pl = imp.plate;
    g.save();
    g.translate(pl.pose.pos.x * s, pl.pose.pos.y * s);
    g.rotate(deg2rad(pl.pose.angleDeg));
    tracePlate(g, pl, s);
    g.fill();
    g.globalCompositeOperation = 'destination-out';
    for (const h of pl.holesLocal) {
      g.beginPath();
      g.arc(h.x * s, h.y * s, 1.2 * s, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }
  for (const sc of imp.screws) {
    g.beginPath();
    g.arc(sc.pos.x * s, sc.pos.y * s, 1.6 * s, 0, Math.PI * 2);
    g.fill();
  }
  g.lineCap = 'round';
  for (const p of imp.pins) {
    g.beginPath();
    g.arc(p.pos.x * s, p.pos.y * s, (p.kind === 'kwire' ? 0.7 : 1.2) * s, 0, Math.PI * 2);
    g.fill();
  }
  g.lineWidth = 0.6 * s;
  for (const w of imp.wires) {
    g.beginPath();
    g.moveTo(w.a.x * s, w.a.y * s);
    g.lineTo(w.b.x * s, w.b.y * s);
    g.stroke();
  }
  g.lineWidth = 2.4 * s;
  g.globalAlpha = 0.5; // barras de fibra: semirradiolúcidas
  for (const b of imp.bars) {
    g.beginPath();
    g.moveTo(b.a.x * s, b.a.y * s);
    g.lineTo(b.b.x * s, b.b.y * s);
    g.stroke();
  }
  g.restore();
}
