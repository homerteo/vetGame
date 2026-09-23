/**
 * Utilidades puras de la herida (sin DOM): mapeo mm↔px/uv, ensanchado de la incisión
 * al separar, muestreo de máscaras, color de la sangre y rasterizado del charco.
 * Todo lo de aquí se prueba en Vitest (entorno node).
 */
import type { DecalKind, TissueLayer, Vec2 } from '../../core/contracts';
import { clamp, closestOnPolyline, dist, lerp, polygonBounds, pointInPolygon, smoothstep } from '../../core/math';

// ───────────── Mapeos ─────────────

export const mmToPx = (p: Vec2, pxPerMm: number): Vec2 => ({ x: p.x * pxPerMm, y: p.y * pxPerMm });
export const pxToMm = (p: Vec2, pxPerMm: number): Vec2 => ({ x: p.x / pxPerMm, y: p.y / pxPerMm });

/** uv de un PlaneGeometry (v = 1 arriba) → mm de herida (y hacia abajo). */
export const uvToMm = (u: number, v: number, wMm: number, hMm: number): Vec2 => ({ x: u * wMm, y: (1 - v) * hMm });
export const mmToUv = (p: Vec2, wMm: number, hMm: number): { u: number; v: number } => ({
  u: p.x / wMm,
  v: 1 - p.y / hMm,
});

// ───────────── Apertura de capas ─────────────

export type SoftLayer = Exclude<TissueLayer, 'bone'>;
export const SOFT_LAYERS: readonly SoftLayer[] = ['skin', 'subcut', 'fascia', 'muscle'];

/** Cuánto se abre cada capa al separar (escalonado: la piel más, el músculo menos). */
export const LAYER_OPEN_FACTOR: Record<SoftLayer, number> = { skin: 1, subcut: 0.9, fascia: 0.8, muscle: 0.5 };
/** Separación natural de los bordes recién cortados (mm), antes de separar. */
export const LAYER_GAPE_MM: Record<SoftLayer, number> = { skin: 1.8, subcut: 1.1, fascia: 0.7, muscle: 0.5 };
/** Apertura extra (mm, ancho total) con retracción 1 y la capa más externa. */
export const RETRACT_EXTRA_MM = 50;

/** Forma de "lente": más ancha en el centro de la incisión y estrecha en los extremos. */
export function taperAlong(t: number): number {
  const s = Math.sin(Math.PI * clamp(t, 0, 1));
  return 0.16 + 0.84 * Math.pow(Math.max(0, s), 0.55);
}

/** Los cortes lejos de la incisión principal apenas se ensanchan al separar. */
export const proximityFactor = (distMm: number) => 1 - smoothstep(3, 12, distMm);

/** Ancho efectivo (mm) de un trazo de corte según retracción, cierre y capa. */
export function openingWidthMm(
  baseMm: number,
  retraction: number,
  closure: number,
  layerFactor: number,
  taper: number,
  proximity: number,
): number {
  const r = clamp(retraction, 0, 1);
  const c = clamp(closure, 0, 1);
  return Math.max(0, (baseMm + r * RETRACT_EXTRA_MM * layerFactor * taper * proximity) * (1 - c));
}

/** Separación del músculo (0..1): empieza con retracción 0.6 y se cierra con la sutura. */
export const muscleParting = (retraction: number, closure: number) =>
  smoothstep(0.6, 1, retraction) * (1 - clamp(closure, 0, 1));

/** Factor de ensanchado de un punto según su posición respecto a la incisión principal. */
export function widenFactorAt(p: Vec2, incision: Vec2[]): number {
  if (incision.length < 2) return 0.5;
  const c = closestOnPolyline(p, incision);
  return taperAlong(c.t) * proximityFactor(c.dist);
}

/** Ruido determinista 0..1 para bordes orgánicos. */
export function hash2(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

export interface CutStroke {
  a: Vec2;
  b: Vec2;
  /** Ancho base (mm). */
  w: number;
  /** Factor de ensanchado (taper × proximidad) en a y b. */
  fa: number;
  fb: number;
  /** Irregularidad del borde 0.9..1.1. */
  ja: number;
  jb: number;
}

/** Divide un segmento en trozos de longitud ≤ maxLen (incluye extremos). */
export function subdivideSegment(a: Vec2, b: Vec2, maxLen: number): Vec2[] {
  const d = dist(a, b);
  const n = Math.max(1, Math.ceil(d / Math.max(1e-6, maxLen)));
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) out.push({ x: lerp(a.x, b.x, i / n), y: lerp(a.y, b.y, i / n) });
  return out;
}

/** Convierte un corte en trazos cortos con su factor de ensanchado precalculado. */
export function buildCutStrokes(a: Vec2, b: Vec2, widthMm: number, incision: Vec2[], maxLen = 2): CutStroke[] {
  const pts = subdivideSegment(a, b, maxLen);
  const out: CutStroke[] = [];
  let prevF = widenFactorAt(pts[0], incision);
  let prevJ = 0.9 + 0.2 * hash2(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const f = widenFactorAt(pts[i], incision);
    const j = 0.9 + 0.2 * hash2(pts[i].x, pts[i].y);
    out.push({ a: pts[i - 1], b: pts[i], w: widthMm, fa: prevF, fb: f, ja: prevJ, jb: j });
    prevF = f;
    prevJ = j;
  }
  return out;
}

/** Ancho (mm) de un trazo en su extremo a/b con los parámetros actuales. */
export function strokeWidthAt(s: CutStroke, end: 'a' | 'b', layer: SoftLayer, retraction: number, closure: number): number {
  const f = end === 'a' ? s.fa : s.fb;
  const j = end === 'a' ? s.ja : s.jb;
  return openingWidthMm(s.w + LAYER_GAPE_MM[layer] * f, retraction, closure, LAYER_OPEN_FACTOR[layer], f, 1) * j;
}

/** Escala un polígono respecto a un centro (sx, sy independientes). */
export function scalePolygon(poly: Vec2[], center: Vec2, sx: number, sy: number): Vec2[] {
  return poly.map((p) => ({ x: center.x + (p.x - center.x) * sx, y: center.y + (p.y - center.y) * sy }));
}

// ───────────── Muestreo ─────────────

/** Rejilla de puntos dentro de un polígono (como mucho maxPoints). */
export function gridSamplesInPolygon(poly: Vec2[], maxPoints = 400): Vec2[] {
  if (poly.length < 3) return [];
  const b = polygonBounds(poly);
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  if (w <= 0 || h <= 0) return [];
  const step = Math.sqrt((w * h) / Math.max(1, maxPoints));
  const nx = Math.max(1, Math.floor(w / step));
  const ny = Math.max(1, Math.floor(h / step));
  const out: Vec2[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const p = { x: b.minX + ((i + 0.5) * w) / nx, y: b.minY + ((j + 0.5) * h) / ny };
      if (pointInPolygon(p, poly)) out.push(p);
    }
  }
  // Polígonos muy finos: al menos el centro de la caja si cae dentro.
  if (out.length === 0) {
    const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    if (pointInPolygon(c, poly)) out.push(c);
  }
  return out;
}

/** Alfa 0..1 del píxel más cercano de un RGBA (fuera de rango = 0). */
export function sampleAlpha(data: Uint8ClampedArray, w: number, h: number, x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= w || iy >= h) return 0;
  return data[(iy * w + ix) * 4 + 3] / 255;
}

/** Offsets unitarios para comprobar "abierto cerca" con radio. */
export const RING_OFFSETS: readonly Vec2[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 0.7071, y: 0.7071 },
  { x: -0.7071, y: 0.7071 },
  { x: 0.7071, y: -0.7071 },
  { x: -0.7071, y: -0.7071 },
  { x: 0.5, y: 0 },
  { x: -0.5, y: 0 },
  { x: 0, y: 0.5 },
  { x: 0, y: -0.5 },
];

/**
 * Fracción de muestras "abiertas" en una máscara RGBA (alfa ≥ 0.5).
 * Con radio, una muestra cuenta si hay apertura en su vecindad.
 */
export function maskOpenFraction(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  maskPxPerMm: number,
  samples: Vec2[],
  radiusMm = 0,
): number {
  if (samples.length === 0) return 0;
  let open = 0;
  const offs = radiusMm > 0 ? RING_OFFSETS.length : 1;
  for (const s of samples) {
    for (let k = 0; k < offs; k++) {
      const o = RING_OFFSETS[k];
      const a = sampleAlpha(data, w, h, (s.x + o.x * radiusMm) * maskPxPerMm, (s.y + o.y * radiusMm) * maskPxPerMm);
      if (a >= 0.5) {
        open++;
        break;
      }
    }
  }
  return open / samples.length;
}

// ───────────── Sangre ─────────────

export const ARTERIAL_HZ = 1.7;

/** Onda pulsátil 0..1: subida sistólica rápida y caída exponencial. */
export function arterialPulse(t: number, hz = ARTERIAL_HZ): number {
  const p = t * hz - Math.floor(t * hz);
  return p < 0.12 ? p / 0.12 : Math.exp(-(p - 0.12) * 6);
}

/** Pseudoaleatorio 0..1 estable por id. */
export function hashId(id: number, salt = 0): number {
  return hash2(id * 1.618 + salt * 7.13, salt * 3.7 + id * 0.311);
}

export interface BloodLook {
  /** Color base (sangre fresca) y oscuro (profundo/venoso), 0..255. */
  r: number;
  g: number;
  b: number;
  dr: number;
  dg: number;
  db: number;
  /** Multiplicador de opacidad y de cantidad (gotas, chorro). */
  alpha: number;
  amount: number;
  pastel: boolean;
}

/** Aspecto de la sangre según gore (0..100) y Modo Pastel. */
export function bloodLook(goreLevel: number, pastel: boolean, out?: BloodLook): BloodLook {
  const g = clamp(goreLevel / 100, 0, 1);
  const o: BloodLook = out ?? { r: 0, g: 0, b: 0, dr: 0, dg: 0, db: 0, alpha: 1, amount: 1, pastel };
  o.pastel = pastel;
  if (pastel) {
    // Jarabe de fresa: #ff5c9a y un rosa frambuesa para lo profundo.
    o.r = 255;
    o.g = 92;
    o.b = 154;
    o.dr = 214;
    o.dg = 46;
    o.db = 120;
  } else {
    // Mezcla entre un granate apagado (gore bajo) y rojo arterial saturado.
    o.r = Math.round(lerp(150, 200, g));
    o.g = Math.round(lerp(70, 18, g));
    o.b = Math.round(lerp(88, 34, g));
    o.dr = Math.round(lerp(96, 110, g));
    o.dg = Math.round(lerp(44, 6, g));
    o.db = Math.round(lerp(60, 16, g));
  }
  o.alpha = 0.45 + 0.55 * g;
  o.amount = 0.25 + 0.75 * g;
  return o;
}

/**
 * Opacidad del charco según la profundidad local: la película fina es casi transparente (el hueso
 * se sigue leyendo debajo) y solo lo hondo se vuelve opaco.
 */
export const poolAlpha = (h: number) => smoothstep(0.02, 0.034, h) * (0.25 + 0.75 * smoothstep(0.04, 0.7, h));

/**
 * Tope de opacidad del charco según el nivel global del campo (%): por debajo de la inundación
 * (70 %) el campo nunca se pinta de rojo opaco; el rojo opaco queda para la inundación.
 */
export const poolLevelCap = (levelPct: number) => 0.42 + 0.53 * smoothstep(4, 70, levelPct);

/** Búferes reutilizables para el rasterizado (gradientes por celda). */
export interface PoolScratch {
  gx: Float32Array;
  gy: Float32Array;
}
export const createPoolScratch = (cols: number, rows: number): PoolScratch => ({
  gx: new Float32Array(cols * rows),
  gy: new Float32Array(cols * rows),
});

/**
 * Rasteriza la rejilla del charco (cols×rows) a un RGBA de outW×outH con interpolación bilineal,
 * borde de líquido nítido, color más oscuro con la profundidad y brillo especular a partir de
 * normales suaves (gradiente central interpolado). Devuelve el máximo de altura (0 = seco).
 */
export function rasterizePool(
  grid: Float32Array,
  cols: number,
  rows: number,
  out: Uint8ClampedArray,
  outW: number,
  outH: number,
  look: BloodLook,
  scratch: PoolScratch = createPoolScratch(cols, rows),
  /** Máscara RGBA opcional (alfa = zona visible) para recortar el charco al rasterizar. */
  mask?: Uint8ClampedArray,
  maskW = 0,
  maskH = 0,
  /** Tope de opacidad (ver `poolLevelCap`). */
  alphaCap = 1,
): number {
  let maxH = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i] > maxH) maxH = grid[i];
  if (maxH <= 0.015) {
    out.fill(0);
    return maxH;
  }
  const { gx, gy } = scratch;
  // Gradiente central por celda (la superficie del líquido se aplana: se comprime con tanh).
  for (let j = 0; j < rows; j++) {
    const jm = j > 0 ? j - 1 : j;
    const jp = j < rows - 1 ? j + 1 : j;
    for (let i = 0; i < cols; i++) {
      const im = i > 0 ? i - 1 : i;
      const ip = i < cols - 1 ? i + 1 : i;
      const k = j * cols + i;
      gx[k] = Math.tanh((grid[j * cols + ip] - grid[j * cols + im]) * 2.5);
      gy[k] = Math.tanh((grid[jp * cols + i] - grid[jm * cols + i]) * 2.5);
    }
  }
  const sx = cols / outW;
  const sy = rows / outH;
  const aMul = 255 * clamp(0.55 + 0.45 * look.alpha, 0, 1) * clamp(alphaCap, 0, 1);
  // Luz de la lámpara desde arriba-izquierda.
  const lx = -0.55;
  const ly = -0.65;
  const mx = maskW / outW;
  const my = maskH / outH;
  for (let y = 0; y < outH; y++) {
    const gyf = (y + 0.5) * sy - 0.5;
    const mrow = mask ? Math.min(maskH - 1, Math.floor((y + 0.5) * my)) * maskW : 0;
    const y0 = gyf < 0 ? 0 : Math.floor(gyf);
    const y1 = y0 + 1 < rows ? y0 + 1 : rows - 1;
    const fy = gyf < 0 ? 0 : gyf - y0;
    for (let x = 0; x < outW; x++) {
      const gxf = (x + 0.5) * sx - 0.5;
      const x0 = gxf < 0 ? 0 : Math.floor(gxf);
      const x1 = x0 + 1 < cols ? x0 + 1 : cols - 1;
      const fx = gxf < 0 ? 0 : gxf - x0;
      const k00 = y0 * cols + x0;
      const k10 = y0 * cols + x1;
      const k01 = y1 * cols + x0;
      const k11 = y1 * cols + x1;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      const h = grid[k00] * w00 + grid[k10] * w10 + grid[k01] * w01 + grid[k11] * w11;
      const o = (y * outW + x) * 4;
      let mA = 1;
      if (mask) {
        mA = mask[(mrow + Math.min(maskW - 1, Math.floor((x + 0.5) * mx))) * 4 + 3] / 255;
      }
      if (h < 0.02 || mA === 0) {
        out[o + 3] = 0;
        continue;
      }
      const nx = gx[k00] * w00 + gx[k10] * w10 + gx[k01] * w01 + gx[k11] * w11;
      const ny = gy[k00] * w00 + gy[k10] * w10 + gy[k01] * w01 + gy[k11] * w11;
      // Especular tipo Blinn simplificado: la pendiente que mira a la luz brilla.
      let spec = clamp((nx * lx + ny * ly) * 1.6, 0, 1);
      spec = spec * spec;
      spec = spec * spec;
      // Menisco: borde fino más claro.
      const rim = h < 0.045 ? clamp(1 - (h - 0.02) / 0.025, 0, 1) * 0.4 : 0;
      const d = clamp((h - 0.04) * 1.8, 0, 1);
      const hi = spec * 0.85 + rim;
      out[o] = clamp(lerp(look.r, look.dr, d) + hi * 200, 0, 255);
      out[o + 1] = clamp(lerp(look.g, look.dg, d) + hi * 175, 0, 255);
      out[o + 2] = clamp(lerp(look.b, look.db, d) + hi * 185, 0, 255);
      // El brillo húmedo suma algo de opacidad: la película se lee como líquido aunque sea fina.
      out[o + 3] = Math.min(1, poolAlpha(h) + hi * 0.35) * aMul * mA;
    }
  }
  return maxH;
}

// ───────────── Varios ─────────────

/** Firma numérica barata de las poses de los fragmentos (para cachear el hueso). */
export function boneSignature(
  frags: ReadonlyArray<{ pose: { pos: Vec2; angleDeg: number }; removed: boolean; highlighted: boolean; locked: boolean }>,
): number {
  let s = frags.length * 7.1;
  for (let i = 0; i < frags.length; i++) {
    const f = frags[i];
    const k = i + 1;
    s += (f.pose.pos.x * 1.37 + f.pose.pos.y * 2.11 + f.pose.angleDeg * 0.73) * k;
    s += (f.removed ? 101 : 0) * k + (f.highlighted ? 211 : 0) * k + (f.locked ? 307 : 0) * k;
  }
  return Math.round(s * 1000) / 1000;
}

/** Firma barata de los implantes (se recompone lo estático solo si cambia). */
export function implantsSignature(imp: {
  plate: { pose: { pos: Vec2; angleDeg: number }; bend: number; holesLocal: Vec2[]; lengthMm: number } | null;
  screws: ReadonlyArray<{ pos: Vec2; contaminated: boolean; stripped: boolean }>;
  pins: ReadonlyArray<{ pos: Vec2 }>;
  wires: ReadonlyArray<{ a: Vec2; b: Vec2 }>;
  bars: ReadonlyArray<{ a: Vec2; b: Vec2 }>;
}): number {
  let h = imp.screws.length * 131 + imp.pins.length * 137 + imp.wires.length * 139 + imp.bars.length * 149;
  const p = imp.plate;
  if (p) h += 7 + p.pose.pos.x * 3.1 + p.pose.pos.y * 5.3 + p.pose.angleDeg * 1.7 + p.bend * 11 + p.holesLocal.length * 13 + p.lengthMm;
  for (let i = 0; i < imp.screws.length; i++) {
    const sc = imp.screws[i];
    h += (sc.pos.x * 1.3 + sc.pos.y * 2.9 + (sc.contaminated ? 17 : 0) + (sc.stripped ? 19 : 0)) * (i + 1);
  }
  for (let i = 0; i < imp.pins.length; i++) h += (imp.pins[i].pos.x * 1.7 + imp.pins[i].pos.y * 2.3) * (i + 2);
  for (let i = 0; i < imp.wires.length; i++) h += (imp.wires[i].a.x + imp.wires[i].b.y * 1.9) * (i + 3);
  for (let i = 0; i < imp.bars.length; i++) h += (imp.bars[i].a.y + imp.bars[i].b.x * 2.1) * (i + 5);
  return Math.round(h * 1000) / 1000;
}

/** Inserta manteniendo el orden por z (estable: iguales conservan el orden de llegada). */
export function insertByZ<T extends { z: number; id: string }>(list: T[], item: T): void {
  const i = list.findIndex((o) => o.id === item.id);
  if (i >= 0) list.splice(i, 1);
  let k = list.length;
  while (k > 0 && list[k - 1].z > item.z) k--;
  list.splice(k, 0, item);
}

/**
 * Nivel de dibujo de cada calcomanía:
 *  - 'bone': sobre el hueso, bajo los tejidos (se tapa al cerrar).
 *  - 'wound': dentro de la herida abierta (carbonizado), recortada por la apertura de la piel.
 *  - 'skin': sobre la piel (puntos, nudos, agujas transcutáneas, barras, abrazaderas).
 */
export type DecalLevel = 'bone' | 'wound' | 'skin';
const DECAL_LEVEL: Record<DecalKind, DecalLevel> = {
  hole: 'bone',
  necrosis: 'bone',
  fissure: 'bone',
  graft: 'bone',
  wire: 'bone',
  scratch: 'bone',
  char: 'wound',
  kwire: 'skin',
  pin: 'skin',
  stitch: 'skin',
  knot: 'skin',
  bar: 'skin',
  clamp: 'skin',
};
export const decalLevel = (k: DecalKind, closed = false): DecalLevel => (closed ? 'skin' : DECAL_LEVEL[k]);

/** Rectángulo sucio en px (unión de cambios pendientes). */
export interface DirtyRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export function unionRect(r: DirtyRect | null, x0: number, y0: number, x1: number, y1: number): DirtyRect {
  if (!r) return { x0, y0, x1, y1 };
  r.x0 = Math.min(r.x0, x0);
  r.y0 = Math.min(r.y0, y0);
  r.x1 = Math.max(r.x1, x1);
  r.y1 = Math.max(r.y1, y1);
  return r;
}
/** Ajusta a enteros dentro de [0,W]×[0,H] (alineado a múltiplos de `align` para las máscaras reducidas). */
export function clampRect(r: DirtyRect, W: number, H: number, align = 4): DirtyRect {
  const x0 = clamp(Math.floor(r.x0 / align) * align, 0, W);
  const y0 = clamp(Math.floor(r.y0 / align) * align, 0, H);
  const x1 = clamp(Math.ceil(r.x1 / align) * align, 0, W);
  const y1 = clamp(Math.ceil(r.y1 / align) * align, 0, H);
  return { x0, y0, x1, y1 };
}

/**
 * Distancia de cámara para que un rectángulo W×H ocupe `fraction` de la vista
 * (el eje más restrictivo manda).
 */
export function fitDistance(w: number, h: number, fovDeg: number, aspect: number, fraction: number): number {
  const t = Math.tan((fovDeg * Math.PI) / 360);
  const dh = h / (fraction * 2 * t);
  const dw = w / (fraction * 2 * t * aspect);
  return Math.max(dh, dw);
}

/** Suavizado exponencial independiente del fps. */
export const damp = (current: number, target: number, rate: number, dt: number) =>
  lerp(current, target, 1 - Math.exp(-rate * dt));
