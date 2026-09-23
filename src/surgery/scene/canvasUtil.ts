/** Utilidades de Canvas 2D compartidas por la herida (requieren DOM). */
import type { Vec2 } from '../../core/contracts';

export function makeCanvas(w: number, h: number, readback = false): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', readback ? { willReadFrequently: true } : undefined);
  if (!g) throw new Error('Canvas 2D no disponible');
  return { c, g };
}

/** Color hex → [r, g, b]. */
export function hexRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [200, 160, 150];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Aclara (amt > 0) u oscurece (amt < 0) un color; devuelve rgba(). */
export function shade(hex: string, amt: number, alpha = 1): string {
  const [r, g, b] = hexRgb(hex);
  const f = (v: number) => Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt));
  return `rgba(${f(r)},${f(g)},${f(b)},${alpha})`;
}

export const rgba = (r: number, g: number, b: number, a: number) =>
  `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;

/** Traza un polígono en px (sin beginPath previo si append). */
export function tracePoly(g: CanvasRenderingContext2D, poly: readonly Vec2[], s: number, append = false): void {
  if (!append) g.beginPath();
  if (poly.length === 0) return;
  g.moveTo(poly[0].x * s, poly[0].y * s);
  for (let i = 1; i < poly.length; i++) g.lineTo(poly[i].x * s, poly[i].y * s);
  g.closePath();
}

/** Traza un polígono con esquinas suavizadas (curvas cuadráticas por los puntos medios). */
export function traceSmoothPoly(g: CanvasRenderingContext2D, poly: readonly Vec2[], s: number): void {
  g.beginPath();
  const n = poly.length;
  if (n < 3) return tracePoly(g, poly, s, true);
  const mid = (a: Vec2, b: Vec2) => ({ x: ((a.x + b.x) / 2) * s, y: ((a.y + b.y) / 2) * s });
  const m0 = mid(poly[n - 1], poly[0]);
  g.moveTo(m0.x, m0.y);
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const m = mid(p, poly[(i + 1) % n]);
    g.quadraticCurveTo(p.x * s, p.y * s, m.x, m.y);
  }
  g.closePath();
}

/** Eje mayor (grados) de un polígono por covarianza, para sombrear huesos alargados. */
export function majorAxisDeg(poly: readonly Vec2[]): number {
  let cx = 0;
  let cy = 0;
  for (const p of poly) {
    cx += p.x;
    cy += p.y;
  }
  cx /= poly.length || 1;
  cy /= poly.length || 1;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of poly) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  return (0.5 * Math.atan2(2 * sxy, sxx - syy) * 180) / Math.PI;
}

/** Estrella de 4 puntas (destello kawaii) pre-renderizada. */
export function makeSparkle(size: number, color = '#ffffff'): HTMLCanvasElement {
  const { c, g } = makeCanvas(size, size);
  const h = size / 2;
  const grd = g.createRadialGradient(h, h, 0, h, h, h);
  grd.addColorStop(0, color);
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(h, 0);
  g.quadraticCurveTo(h, h, size, h);
  g.quadraticCurveTo(h, h, h, size);
  g.quadraticCurveTo(h, h, 0, h);
  g.quadraticCurveTo(h, h, h, 0);
  g.fill();
  return c;
}
