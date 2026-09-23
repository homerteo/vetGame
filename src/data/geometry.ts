import type { Pose2, Vec2 } from '../core/contracts';
import { add, applyPose, applyPosePoly, deg2rad, rotate, sub } from '../core/math';
import { createRng } from '../core/rng';

/**
 * Utilidades geométricas para construir la anatomía de los casos (espacio de herida, mm).
 * Todo es determinista y se evalúa una sola vez al cargar los datos.
 */

export const P = (x: number, y: number): Vec2 => ({ x, y });

/** Redondea a centésimas de mm (datos legibles y estables). */
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Limpia un polígono: redondea y quita puntos casi duplicados (incluido el cierre). */
export function cleanPoly(poly: Vec2[], minGap = 0.08): Vec2[] {
  const out: Vec2[] = [];
  for (const p of poly) {
    const q = { x: r2(p.x), y: r2(p.y) };
    const last = out[out.length - 1];
    if (!last || Math.hypot(q.x - last.x, q.y - last.y) > minGap) out.push(q);
  }
  while (out.length > 3 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= minGap) out.pop();
  return out;
}

/** Rectángulo con esquinas redondeadas (sentido horario en pantalla). */
export function roundedRect(x0: number, y0: number, x1: number, y1: number, r: number, seg = 5): Vec2[] {
  const out: Vec2[] = [];
  const corners: Array<[number, number, number]> = [
    [x1 - r, y0 + r, -90],
    [x1 - r, y1 - r, 0],
    [x0 + r, y1 - r, 90],
    [x0 + r, y0 + r, 180],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = deg2rad(a0 + (90 * i) / seg);
      out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
  }
  return cleanPoly(out);
}

/** Punto de Catmull-Rom centrípeta (Barry–Goldman) entre p1 y p2. */
function crPoint(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, u: number): Vec2 {
  const kn = (a: Vec2, b: Vec2) => Math.max(1e-4, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)));
  const t0 = 0;
  const t1 = t0 + kn(p0, p1);
  const t2 = t1 + kn(p1, p2);
  const t3 = t2 + kn(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const mix = (a: Vec2, b: Vec2, ta: number, tb: number) => {
    const w = (t - ta) / (tb - ta);
    return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w };
  };
  const a1 = mix(p0, p1, t0, t1);
  const a2 = mix(p1, p2, t1, t2);
  const a3 = mix(p2, p3, t2, t3);
  const b1 = mix(a1, a2, t0, t2);
  const b2 = mix(a2, a3, t1, t3);
  return mix(b1, b2, t1, t2);
}

/** Curva suave abierta que pasa por los puntos de control (incluye extremos). */
export function openSpline(ctrl: Vec2[], perSeg = 4): Vec2[] {
  if (ctrl.length < 3) return ctrl.slice();
  const out: Vec2[] = [];
  const n = ctrl.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)];
    const p3 = ctrl[Math.min(n - 1, i + 2)];
    // Extremos reflejados para que la tangente inicial/final sea natural.
    const q0 = i === 0 ? sub(ctrl[0], sub(ctrl[1], ctrl[0])) : p0;
    const q3 = i === n - 2 ? add(ctrl[n - 1], sub(ctrl[n - 1], ctrl[n - 2])) : p3;
    for (let k = 0; k < perSeg; k++) out.push(crPoint(q0, ctrl[i], ctrl[i + 1], q3, k / perSeg));
  }
  out.push(ctrl[n - 1]);
  return out;
}

/** Curva suave cerrada por los puntos de control (polígono). */
export function closedSpline(ctrl: Vec2[], perSeg = 4): Vec2[] {
  const out: Vec2[] = [];
  const n = ctrl.length;
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n];
    const p1 = ctrl[i];
    const p2 = ctrl[(i + 1) % n];
    const p3 = ctrl[(i + 2) % n];
    for (let k = 0; k < perSeg; k++) out.push(crPoint(p0, p1, p2, p3, k / perSeg));
  }
  return cleanPoly(out);
}

/** Superelipse (bloque redondeado: huesos del carpo, cuerpos vertebrales). n=2 elipse, n≈4 bloque. */
export function superEllipse(cx: number, cy: number, rx: number, ry: number, n = 4, angleDeg = 0, count = 28): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * rx;
    const y = Math.sign(s) * Math.pow(Math.abs(s), 2 / n) * ry;
    out.push(add(rotate({ x, y }, angleDeg), { x: cx, y: cy }));
  }
  return cleanPoly(out);
}

/** Deforma levemente un polígono (aspecto orgánico) de forma determinista. */
export function wobble(poly: Vec2[], amountMm: number, seed: number): Vec2[] {
  const rng = createRng(seed);
  const c = areaCentroid(poly);
  return cleanPoly(
    poly.map((p) => {
      const d = sub(p, c);
      const l = Math.hypot(d.x, d.y) || 1;
      const k = (rng() * 2 - 1) * amountMm;
      return { x: p.x + (d.x / l) * k, y: p.y + (d.y / l) * k };
    }),
  );
}

/** Área con signo (positiva = sentido horario en pantalla, y hacia abajo). */
export function signedArea(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  return s / 2;
}

/** Centroide de área (mejor pivote que la media de vértices). */
export function areaCentroid(poly: Vec2[]): Vec2 {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j].x * poly[i].y - poly[i].x * poly[j].y;
    a += f;
    cx += (poly[j].x + poly[i].x) * f;
    cy += (poly[j].y + poly[i].y) * f;
  }
  if (Math.abs(a) < 1e-9) {
    let x = 0;
    let y = 0;
    for (const p of poly) {
      x += p.x;
      y += p.y;
    }
    return { x: x / poly.length, y: y / poly.length };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function translatePoly(poly: Vec2[], dx: number, dy: number): Vec2[] {
  return poly.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/** Pasa un polígono absoluto a local (origen en su centroide). Devuelve también el origen. */
export function toLocal(poly: Vec2[]): { polygon: Vec2[]; origin: Vec2 } {
  const c = areaCentroid(poly);
  const origin = { x: r2(c.x), y: r2(c.y) };
  return { polygon: cleanPoly(poly.map((p) => sub(p, origin))), origin };
}

/** Pose resultante de girar `pose` alrededor de `pivot` `deg` grados. */
export function rotatePoseAround(pose: Pose2, pivot: Vec2, deg: number): Pose2 {
  const pos = add(rotate(sub(pose.pos, pivot), deg), pivot);
  return { pos: { x: r2(pos.x), y: r2(pos.y) }, angleDeg: pose.angleDeg + deg };
}

/** Pose desplazada y girada (fracturas: pose inicial respecto a la anatómica). */
export function displacedPose(target: Pose2, dx: number, dy: number, ddeg: number): Pose2 {
  return { pos: { x: r2(target.pos.x + dx), y: r2(target.pos.y + dy) }, angleDeg: target.angleDeg + ddeg };
}

export function worldPoint(local: Vec2, pose: Pose2): Vec2 {
  const p = applyPose(local, pose);
  return { x: r2(p.x), y: r2(p.y) };
}

export function worldPoly(local: Vec2[], pose: Pose2): Vec2[] {
  return applyPosePoly(local, pose);
}

// ───────────────────────────── Huesos largos ─────────────────────────────

/**
 * Hueso largo descrito por su borde superior e inferior (x creciente) y dos tapas.
 * Las tapas se dan como puntos intermedios: la izquierda de abajo hacia arriba
 * y la derecha de arriba hacia abajo. Las curvas se suavizan con Catmull-Rom.
 */
export interface LongBoneSpec {
  top: Vec2[];
  bottom: Vec2[];
  capLeft: Vec2[];
  capRight: Vec2[];
  /** Muestras por tramo de spline (más = más suave). */
  perSeg?: number;
}

interface BoneEdges {
  top: Vec2[];
  bottom: Vec2[];
  capL: Vec2[]; // interior de la tapa izquierda (abajo → arriba)
  capR: Vec2[]; // interior de la tapa derecha (arriba → abajo)
}

function edgesOf(spec: LongBoneSpec): BoneEdges {
  const k = spec.perSeg ?? 4;
  const top = openSpline(spec.top, k);
  const bottom = openSpline(spec.bottom, k);
  const capR = openSpline([spec.top[spec.top.length - 1], ...spec.capRight, spec.bottom[spec.bottom.length - 1]], k).slice(1, -1);
  const capL = openSpline([spec.bottom[0], ...spec.capLeft, spec.top[0]], k).slice(1, -1);
  return { top, bottom, capL, capR };
}

/** Contorno completo del hueso largo. */
export function longBone(spec: LongBoneSpec): Vec2[] {
  const e = edgesOf(spec);
  return cleanPoly([...e.top, ...e.capR, ...e.bottom.slice().reverse(), ...e.capL]);
}

function segIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): { t: number; u: number } | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-12) return null;
  const ca = sub(c, a);
  const t = (ca.x * s.y - ca.y * s.x) / den;
  const u = (ca.x * r.y - ca.y * r.x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u };
}

interface EdgeHit {
  edgeIdx: number; // segmento del borde
  cutIdx: number; // segmento del corte
  point: Vec2;
}

function firstHit(edge: Vec2[], cut: Vec2[]): EdgeHit {
  for (let k = 0; k < cut.length - 1; k++) {
    for (let i = 0; i < edge.length - 1; i++) {
      const h = segIntersect(edge[i], edge[i + 1], cut[k], cut[k + 1]);
      if (h) {
        return {
          edgeIdx: i,
          cutIdx: k,
          point: { x: edge[i].x + (edge[i + 1].x - edge[i].x) * h.t, y: edge[i].y + (edge[i + 1].y - edge[i].y) * h.t },
        };
      }
    }
  }
  throw new Error('El corte no cruza el borde del hueso');
}

/**
 * Parte un hueso largo con cortes que van de arriba (fuera del hueso) hacia abajo
 * (fuera del hueso), ordenados de izquierda a derecha y sin cruzarse.
 * Devuelve cortes.length + 1 piezas (polígonos absolutos).
 */
export function splitLongBone(spec: LongBoneSpec, cuts: Vec2[][]): Vec2[][] {
  const e = edgesOf(spec);
  const hits = cuts.map((cut) => {
    const t = firstHit(e.top, cut);
    const b = firstHit(e.bottom, cut);
    if (b.cutIdx < t.cutIdx) throw new Error('El corte debe ir de arriba hacia abajo');
    const inner = [t.point, ...cut.slice(t.cutIdx + 1, b.cutIdx + 1), b.point];
    return { t, b, inner };
  });
  const pieces: Vec2[][] = [];
  for (let i = 0; i <= hits.length; i++) {
    const prev = i > 0 ? hits[i - 1] : null;
    const next = i < hits.length ? hits[i] : null;
    const poly: Vec2[] = [];
    // Borde superior de izquierda a derecha.
    if (prev) poly.push(prev.t.point);
    const topFrom = prev ? prev.t.edgeIdx + 1 : 0;
    const topTo = next ? next.t.edgeIdx : e.top.length - 1;
    for (let k = topFrom; k <= topTo; k++) poly.push(e.top[k]);
    // Lado derecho: corte siguiente o tapa derecha.
    if (next) poly.push(...next.inner);
    else poly.push(...e.capR);
    // Borde inferior de derecha a izquierda.
    const botFrom = next ? next.b.edgeIdx : e.bottom.length - 1;
    const botTo = prev ? prev.b.edgeIdx + 1 : 0;
    for (let k = botFrom; k >= botTo; k--) poly.push(e.bottom[k]);
    // Lado izquierdo: corte anterior (de abajo hacia arriba) o tapa izquierda.
    if (prev) poly.push(...prev.inner.slice().reverse());
    else poly.push(...e.capL);
    pieces.push(cleanPoly(poly));
  }
  return pieces;
}

/** y del borde superior (polilínea con x creciente) en x. */
function yOnEdge(edge: Vec2[], x: number): number {
  for (let i = 0; i < edge.length - 1; i++) {
    const a = edge[i];
    const b = edge[i + 1];
    if ((a.x <= x && x <= b.x) || (b.x <= x && x <= a.x)) {
      const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
      return a.y + (b.y - a.y) * t;
    }
  }
  throw new Error(`x=${x} fuera del borde`);
}

/**
 * Talla un bloque en el borde superior de un hueso largo (recesión troclear, tuberosidad tibial).
 * `base` es la línea de corte dentro del hueso, de izquierda a derecha; su primer y último
 * punto definen las paredes verticales del bloque. Devuelve el hueso con la muesca y el bloque.
 */
export function carveTop(spec: LongBoneSpec, base: Vec2[]): { bone: Vec2[]; block: Vec2[] } {
  const e = edgesOf(spec);
  const x0 = base[0].x;
  const x1 = base[base.length - 1].x;
  const top0 = P(x0, yOnEdge(e.top, x0));
  const top1 = P(x1, yOnEdge(e.top, x1));
  const inside = e.top.filter((p) => p.x > x0 && p.x < x1);
  const bone = cleanPoly([
    ...e.top.filter((p) => p.x < x0),
    top0,
    ...base,
    top1,
    ...e.top.filter((p) => p.x > x1),
    ...e.capR,
    ...e.bottom.slice().reverse(),
    ...e.capL,
  ]);
  const block = cleanPoly([top0, ...inside, top1, ...base.slice().reverse()]);
  return { bone, block };
}

/** Línea de fractura dentada vertical (de arriba abajo) alrededor de x. */
export function fractureLine(x: number, yTop: number, yBottom: number, teeth: number, amp: number, seed: number, slope = 0): Vec2[] {
  const rng = createRng(seed);
  const out: Vec2[] = [];
  for (let i = 0; i <= teeth; i++) {
    const t = i / teeth;
    const y = yTop + (yBottom - yTop) * t;
    const edge = i === 0 || i === teeth;
    const jitter = edge ? 0 : (i % 2 === 0 ? 1 : -1) * amp * (0.55 + rng() * 0.45);
    out.push({ x: r2(x + slope * (y - (yTop + yBottom) / 2) + jitter), y: r2(y) });
  }
  return out;
}

// ───────────────────────────── Comprobaciones ─────────────────────────────

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const h = segIntersect(a, b, c, d);
  return !!h && h.t > 1e-6 && h.t < 1 - 1e-6 && h.u > 1e-6 && h.u < 1 - 1e-6;
}

/** ¿El polígono es simple (sin autointersecciones)? */
export function isSimplePolygon(poly: Vec2[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(a, b, poly[j], poly[(j + 1) % n])) return false;
    }
  }
  return true;
}
