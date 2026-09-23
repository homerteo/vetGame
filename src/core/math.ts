import type { Pose2, Vec2 } from './contracts';

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp(invLerp(a, b, v), 0, 1);
  return t * t * (3 - 2 * t);
};
export const deg2rad = (d: number) => (d * Math.PI) / 180;
export const rad2deg = (r: number) => (r * 180) / Math.PI;

export const v2 = (x = 0, y = 0): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
export const len = (a: Vec2) => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: Vec2): Vec2 => {
  const l = len(a);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};
export const rotate = (a: Vec2, deg: number): Vec2 => {
  const r = deg2rad(deg);
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
};
export const lerpV = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

/** Diferencia angular más corta en grados (-180..180]. */
export const angleDiff = (a: number, b: number) => {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
};

/** Transforma un punto local por una pose (rotación y luego traslación). */
export const applyPose = (p: Vec2, pose: Pose2): Vec2 => add(rotate(p, pose.angleDeg), pose.pos);
export const applyPosePoly = (poly: Vec2[], pose: Pose2): Vec2[] => poly.map((p) => applyPose(p, pose));

/** Distancia de un punto a un segmento. */
export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-12) return dist(p, a);
  const t = clamp(dot(sub(p, a), ab) / l2, 0, 1);
  return dist(p, { x: a.x + ab.x * t, y: a.y + ab.y * t });
}

/** Distancia de un punto a una polilínea y parámetro de longitud recorrida (0..1) del punto más cercano. */
export function closestOnPolyline(p: Vec2, path: Vec2[]): { dist: number; t: number; point: Vec2 } {
  let best = { dist: Infinity, t: 0, point: path[0] ?? { x: 0, y: 0 } };
  const total = polylineLength(path);
  let acc = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const ab = sub(b, a);
    const l2 = dot(ab, ab);
    const segLen = Math.sqrt(l2);
    const tt = l2 < 1e-12 ? 0 : clamp(dot(sub(p, a), ab) / l2, 0, 1);
    const q = { x: a.x + ab.x * tt, y: a.y + ab.y * tt };
    const d = dist(p, q);
    if (d < best.dist) best = { dist: d, t: total > 0 ? (acc + segLen * tt) / total : 0, point: q };
    acc += segLen;
  }
  return best;
}

export function polylineLength(path: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < path.length - 1; i++) s += dist(path[i], path[i + 1]);
  return s;
}

/** Muestrea n puntos equiespaciados a lo largo de una polilínea. */
export function samplePolyline(path: Vec2[], n: number): Vec2[] {
  if (path.length === 0) return [];
  if (path.length === 1 || n <= 1) return [path[0]];
  const total = polylineLength(path);
  const out: Vec2[] = [];
  for (let k = 0; k < n; k++) out.push(pointAtLength(path, (total * k) / (n - 1)));
  return out;
}

export function pointAtLength(path: Vec2[], s: number): Vec2 {
  let acc = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const d = dist(path[i], path[i + 1]);
    if (acc + d >= s) return lerpV(path[i], path[i + 1], d > 0 ? (s - acc) / d : 0);
    acc += d;
  }
  return path[path.length - 1];
}

/** Punto dentro de polígono (par-impar). */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function polygonCentroid(poly: Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  const n = Math.max(1, poly.length);
  return { x: x / n, y: y / n };
}

export function polygonBounds(poly: Vec2[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Arco de circunferencia como polilínea (para sierra birradial). */
export function arcPath(center: Vec2, radius: number, fromDeg: number, toDeg: number, n = 24): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = deg2rad(lerp(fromDeg, toDeg, i / n));
    out.push({ x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius });
  }
  return out;
}

/** Rectángulo (centro, tamaño, ángulo) como polígono. */
export function rectPoly(cx: number, cy: number, w: number, h: number, angleDeg = 0): Vec2[] {
  const hw = w / 2;
  const hh = h / 2;
  return [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ].map((p) => add(rotate(p, angleDeg), { x: cx, y: cy }));
}
