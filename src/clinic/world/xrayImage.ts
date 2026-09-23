/** Radiografías procedurales: hueso del caso (anatomía en mm de herida) y tórax ventrodorsal. */
import type { AnatomyDef, Vec2 } from '../../core/contracts';
import { applyPosePoly } from '../../core/math';
import { createRng } from '../../core/rng';

const W_MM = 160;
const H_MM = 100;

function pathPoly(g: CanvasRenderingContext2D, poly: Vec2[], s: number): void {
  g.beginPath();
  poly.forEach((p, i) => (i ? g.lineTo(p.x * s, p.y * s) : g.moveTo(p.x * s, p.y * s)));
  g.closePath();
}

function film(g: CanvasRenderingContext2D, w: number, h: number, seed: number): void {
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#0c1424');
  bg.addColorStop(1, '#070b16');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
}

function grainAndFrame(g: CanvasRenderingContext2D, w: number, h: number, seed: number, caption: string): void {
  const rng = createRng(seed);
  for (let i = 0; i < 1400; i++) {
    const a = rng() * 0.07;
    g.fillStyle = rng() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a * 1.5})`;
    g.fillRect(rng() * w, rng() * h, 1 + rng() * 1.5, 1 + rng() * 1.5);
  }
  const vg = g.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.7);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.65)');
  g.fillStyle = vg;
  g.fillRect(0, 0, w, h);
  // marcador R y pie de placa
  const u = w / 400;
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.fillRect(12 * u, 12 * u, 26 * u, 30 * u);
  g.fillStyle = '#0c1424';
  g.font = `900 ${24 * u}px "Baloo 2", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('R', 25 * u, 28 * u);
  g.fillStyle = 'rgba(210,230,255,0.75)';
  g.font = `700 ${9 * u}px "Nunito", sans-serif`;
  g.textAlign = 'right';
  g.fillText(caption, w - 12 * u, h - 12 * u);
  // regla
  g.strokeStyle = 'rgba(210,230,255,0.45)';
  g.lineWidth = Math.max(1, u);
  for (let i = 0; i <= 10; i++) {
    const x = 14 * u + i * 8 * u;
    g.beginPath();
    g.moveTo(x, h - 14 * u);
    g.lineTo(x, h - (i % 5 === 0 ? 24 : 19) * u);
    g.stroke();
  }
}

/**
 * Dibuja la radiografía del hueso del caso. Los fragmentos aparecen en su pose inicial
 * (desplazados en las fracturas) y la lesión con una línea oscura irregular.
 */
export function drawBoneXray(
  canvas: HTMLCanvasElement,
  anatomy: AnatomyDef | null,
  lesion: { u: number; v: number; radius: number },
  caption: string,
  seed = 3,
): void {
  const w = canvas.width;
  const h = canvas.height;
  const g = canvas.getContext('2d')!;
  const s = w / W_MM;
  film(g, w, h, seed);
  const polys: Array<{ poly: Vec2[]; faint: boolean }> = [];
  if (anatomy) {
    for (const p of anatomy.boneStatic) polys.push({ poly: p, faint: false });
    for (const f of anatomy.fragments) {
      if (f.kind === 'graft' || f.kind === 'block') continue;
      polys.push({ poly: applyPosePoly(f.polygon, f.start), faint: f.kind === 'disc' || f.kind === 'cartilage' });
    }
  }
  if (!polys.length) {
    // hueso genérico: diáfisis horizontal con dos epífisis
    const cy = lesion.v * H_MM;
    polys.push({
      poly: [
        { x: 18, y: cy - 7 },
        { x: 30, y: cy - 5 },
        { x: 130, y: cy - 5 },
        { x: 142, y: cy - 8 },
        { x: 142, y: cy + 8 },
        { x: 130, y: cy + 5 },
        { x: 30, y: cy + 5 },
        { x: 18, y: cy + 7 },
      ],
      faint: false,
    });
  }
  // tejido blando: halo difuso alrededor de los huesos
  g.save();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  for (const [lw, a] of [
    [34, 0.07],
    [22, 0.08],
    [12, 0.08],
  ] as const) {
    g.strokeStyle = `rgba(130,160,205,${a})`;
    g.lineWidth = lw * s;
    for (const p of polys) {
      pathPoly(g, p.poly, s);
      g.stroke();
      g.fillStyle = `rgba(130,160,205,${a})`;
      g.fill();
    }
  }
  g.restore();
  // hueso: relleno lechoso, médula más oscura (relleno interior) y cortical brillante
  g.save();
  g.shadowColor = 'rgba(190,220,255,0.6)';
  g.shadowBlur = 10 * s;
  for (const p of polys) {
    pathPoly(g, p.poly, s);
    g.fillStyle = p.faint ? 'rgba(170,195,230,0.35)' : 'rgba(205,225,250,0.82)';
    g.fill();
  }
  g.restore();
  for (const p of polys) {
    if (p.faint) continue;
    g.save();
    pathPoly(g, p.poly, s);
    g.clip();
    g.strokeStyle = 'rgba(40,60,95,0.35)';
    g.lineWidth = 5 * s;
    g.filter = 'blur(2px)';
    // "canal medular": trazo interior difuso siguiendo el contorno desplazado
    pathPoly(g, p.poly, s);
    g.stroke();
    g.restore();
    pathPoly(g, p.poly, s);
    g.strokeStyle = 'rgba(245,250,255,0.95)';
    g.lineWidth = 1.2 * s;
    g.stroke();
  }
  // lesión: grieta oscura irregular + halo
  const lx = lesion.u * w;
  const ly = lesion.v * h;
  const lr = lesion.radius * w;
  const rng = createRng(seed * 31 + 7);
  const halo = g.createRadialGradient(lx, ly, 0, lx, ly, lr * 0.9);
  halo.addColorStop(0, 'rgba(8,12,24,0.55)');
  halo.addColorStop(1, 'rgba(8,12,24,0)');
  g.fillStyle = halo;
  g.beginPath();
  g.arc(lx, ly, lr * 0.9, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(6,10,20,0.95)';
  g.lineWidth = Math.max(2, 1.4 * s);
  g.lineJoin = 'miter';
  g.beginPath();
  const n = 7;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = lx + (rng() - 0.5) * lr * 0.35 + (t - 0.5) * lr * 0.25;
    const y = ly - lr * 0.7 + t * lr * 1.4;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  // esquirlitas brillantes
  g.fillStyle = 'rgba(230,242,255,0.85)';
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.arc(lx + (rng() - 0.5) * lr * 0.9, ly + (rng() - 0.5) * lr * 0.9, (0.5 + rng() * 0.8) * s, 0, Math.PI * 2);
    g.fill();
  }
  grainAndFrame(g, w, h, seed, caption);
}

/** Máscara de campos pulmonares de la placa de tórax (u, v normalizados). */
export function lungMask(u: number, v: number): boolean {
  const l = ((u - 0.36) / 0.115) ** 2 + ((v - 0.5) / 0.34) ** 2 <= 1;
  const r = ((u - 0.64) / 0.115) ** 2 + ((v - 0.5) / 0.34) ** 2 <= 1;
  return l || r;
}

/** Placa de tórax ventrodorsal: columna, costillas, corazón y pulmones limpios. */
export function drawThoraxXray(canvas: HTMLCanvasElement, caption: string, seed = 5): void {
  const w = canvas.width;
  const h = canvas.height;
  const g = canvas.getContext('2d')!;
  film(g, w, h, seed);
  // silueta del tórax
  g.fillStyle = 'rgba(120,150,200,0.2)';
  g.beginPath();
  g.ellipse(w * 0.5, h * 0.52, w * 0.26, h * 0.46, 0, 0, Math.PI * 2);
  g.fill();
  // pulmones (aire = oscuro, con trama vascular)
  for (const cx of [0.36, 0.64]) {
    g.fillStyle = 'rgba(4,8,18,0.8)';
    g.beginPath();
    g.ellipse(w * cx, h * 0.5, w * 0.115, h * 0.34, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(150,180,220,0.18)';
    g.lineWidth = 1.2;
    const rng = createRng(seed + Math.round(cx * 100));
    for (let i = 0; i < 14; i++) {
      g.beginPath();
      const x0 = w * 0.5 + (cx < 0.5 ? -1 : 1) * w * 0.03;
      g.moveTo(x0, h * (0.35 + rng() * 0.3));
      g.quadraticCurveTo(w * cx, h * (0.25 + rng() * 0.5), w * (cx + (cx < 0.5 ? -1 : 1) * rng() * 0.1), h * (0.2 + rng() * 0.6));
      g.stroke();
    }
  }
  // corazón
  g.fillStyle = 'rgba(190,210,240,0.55)';
  g.beginPath();
  g.ellipse(w * 0.47, h * 0.6, w * 0.085, h * 0.19, -0.25, 0, Math.PI * 2);
  g.fill();
  // columna y costillas
  g.fillStyle = 'rgba(215,232,252,0.85)';
  for (let i = 0; i < 12; i++) {
    const y = h * 0.07 + i * h * 0.074;
    g.fillRect(w * 0.49, y, w * 0.02, h * 0.058);
  }
  g.strokeStyle = 'rgba(215,232,252,0.7)';
  g.lineWidth = Math.max(2, w * 0.006);
  for (let i = 0; i < 9; i++) {
    const y = h * 0.14 + i * h * 0.075;
    for (const sgn of [-1, 1]) {
      g.beginPath();
      g.moveTo(w * 0.5 + sgn * w * 0.012, y);
      g.bezierCurveTo(w * 0.5 + sgn * w * 0.16, y - h * 0.05, w * 0.5 + sgn * w * 0.25, y + h * 0.02, w * 0.5 + sgn * w * 0.22, y + h * 0.12);
      g.stroke();
    }
  }
  // diafragma
  g.strokeStyle = 'rgba(190,210,240,0.5)';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(w * 0.26, h * 0.86);
  g.quadraticCurveTo(w * 0.5, h * 0.7, w * 0.74, h * 0.86);
  g.stroke();
  grainAndFrame(g, w, h, seed, caption);
}
