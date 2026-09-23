/** Matemática pura de la escena 3D (cámaras, ancla de la herida, orientación del instrumento). */
import type { AnatomyDef, CameraMode, CaseDef, Pose2, StepParams, Vec2 } from '../../core/contracts';
import { WOUND_H_MM, WOUND_W_MM } from '../../core/constants';
import { fitDistance } from './woundMath';

export interface V3 {
  x: number;
  y: number;
  z: number;
}

/** Trazado de la incisión del caso (primer paso de incisión o, si no hay, de sutura). */
export function incisionPathFor(caseDef: CaseDef): Vec2[] {
  for (const ph of caseDef.phases)
    for (const st of ph.steps) if (st.params.type === 'incision' && st.params.path.length >= 2) return st.params.path;
  for (const ph of caseDef.phases)
    for (const st of ph.steps) if (st.params.type === 'suture' && st.params.path.length >= 2) return st.params.path;
  return [
    { x: 30, y: 50 },
    { x: 130, y: 50 },
  ];
}

/** mm de herida → coordenadas locales del ancla (x, z) en metros para un plano de wM × hM. */
export function mmToAnchor(mm: Vec2, wM: number, hM: number, out: V3, lift = 0): V3 {
  out.x = (mm.x / WOUND_W_MM - 0.5) * wM;
  out.y = lift;
  out.z = (mm.y / WOUND_H_MM - 0.5) * hM;
  return out;
}

/** Inversa de mmToAnchor. */
export function anchorToMm(x: number, z: number, wM: number, hM: number): Vec2 {
  return { x: (x / wM + 0.5) * WOUND_W_MM, y: (z / hM + 0.5) * WOUND_H_MM };
}

export const OVERVIEW_POSE = {
  pos: { x: 2.95, y: 2.9, z: 1.65 },
  posNarrow: { x: 3.3, y: 3.0, z: 2.3 },
  target: { x: -0.35, y: 0.72, z: -0.85 },
  fov: 50,
};
export const WOUND_FOV = 36;
/** Fracción de pantalla libre de paneles del HUD donde debe caber la zona de trabajo en 'micro'. */
export const MICRO_SAFE_FRACTION = 0.52;

/** Duración (s) de la transición de cámara entre dos modos. */
export function cameraTransitionSec(from: CameraMode, to: CameraMode): number {
  if (from === to) return 0.01;
  return from === 'overview' || to === 'overview' ? 1.1 : 0.6;
}

/** Curva de la transición: arranque y llegada suaves, y llega exactamente a 1 (sin cola). */
export function easeCamera(k: number): number {
  const x = k <= 0 ? 0 : k >= 1 ? 1 : k;
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/**
 * Objetivo de cámara para un modo. `woundCenter`/`windowCenter` en mundo.
 * En 'wound' la herida (w × h m, vista con inclinación `tiltDeg`) ocupa `fraction` de la pantalla;
 * 'micro' se acerca ×3 al centro de la ventana.
 */
export function cameraGoal(
  mode: CameraMode,
  woundCenter: V3,
  windowCenter: V3,
  wM: number,
  hM: number,
  aspect: number,
  tiltDeg: number,
  fraction: number,
  out: { pos: V3; target: V3; fov: number },
  /** Zona de trabajo (mundo) para 'micro': se centra en ella y el zoom no la deja salir de la zona sin HUD. */
  focus?: { center: V3; wM: number; hM: number } | null,
): { pos: V3; target: V3; fov: number } {
  if (mode === 'overview') {
    const p = aspect < 1.2 ? OVERVIEW_POSE.posNarrow : OVERVIEW_POSE.pos;
    out.pos.x = p.x;
    out.pos.y = p.y;
    out.pos.z = p.z;
    out.target.x = OVERVIEW_POSE.target.x;
    out.target.y = OVERVIEW_POSE.target.y;
    out.target.z = OVERVIEW_POSE.target.z;
    out.fov = OVERVIEW_POSE.fov;
    return out;
  }
  const tilt = (tiltDeg * Math.PI) / 180;
  const dWound = fitDistance(wM, hM * Math.cos(tilt), WOUND_FOV, aspect, fraction);
  let d = dWound / (mode === 'micro' ? 3 : 1);
  let c = mode === 'micro' ? windowCenter : woundCenter;
  if (mode === 'micro' && focus) {
    // ×3 como máximo, pero la zona de trabajo entera cabe entre los paneles del HUD.
    const dFit = fitDistance(focus.wM, focus.hM * Math.cos(tilt), WOUND_FOV, aspect, MICRO_SAFE_FRACTION);
    d = Math.max(d, Math.min(dWound, dFit));
    c = focus.center;
  }
  out.target.x = c.x;
  out.target.y = c.y;
  out.target.z = c.z;
  // Picado desde el lado de la cirujana (+Z).
  out.pos.x = c.x;
  out.pos.y = c.y + Math.cos(tilt) * d;
  out.pos.z = c.z + Math.sin(tilt) * d;
  out.fov = WOUND_FOV;
  return out;
}

/**
 * Base ortonormal del instrumento: Y = eje (de la punta al mango), inclinado `tiltDeg` desde la
 * normal hacia `lean` (horizontal) y girado `yawDeg` alrededor de la normal; X = lado que mira al
 * tejido (el filo del bisturí). Devuelve [X, Y, Z] en mundo (+Y arriba).
 */
export function instrumentBasis(
  tiltDeg: number,
  yawDeg: number,
  lean: V3,
  out: [V3, V3, V3] = [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
  ],
): [V3, V3, V3] {
  const t = (tiltDeg * Math.PI) / 180;
  const yw = (-yawDeg * Math.PI) / 180;
  // Giro de la dirección de inclinación alrededor de +Y.
  const ll = Math.hypot(lean.x, lean.z) || 1;
  const c = Math.cos(yw);
  const s = Math.sin(yw);
  const lx = (lean.x * c + lean.z * s) / ll;
  const lz = (-lean.x * s + lean.z * c) / ll;
  // side = up × lean = (lz, 0, -lx)
  const sx = lz;
  const sz = -lx;
  const [X, Y, Z] = out;
  Y.x = lx * Math.sin(t);
  Y.y = Math.cos(t);
  Y.z = lz * Math.sin(t);
  // X = side × Y
  X.x = -sz * Y.y;
  X.y = sz * Y.x - sx * Y.z;
  X.z = sx * Y.y;
  const xl = Math.hypot(X.x, X.y, X.z) || 1;
  X.x /= xl;
  X.y /= xl;
  X.z /= xl;
  // Z = X × Y
  Z.x = X.y * Y.z - X.z * Y.y;
  Z.y = X.z * Y.x - X.x * Y.z;
  Z.z = X.x * Y.y - X.y * Y.x;
  return out;
}

// ───────────── Zona de trabajo (encuadre de 'micro') ─────────────

/** Rectángulo en mm de herida. */
export interface RectMm {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const emptyRect = (): RectMm => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
const isEmpty = (r: RectMm) => !(r.x1 >= r.x0 && r.y1 >= r.y0);

function addPoint(r: RectMm, x: number, y: number, m = 0): void {
  if (x - m < r.x0) r.x0 = x - m;
  if (y - m < r.y0) r.y0 = y - m;
  if (x + m > r.x1) r.x1 = x + m;
  if (y + m > r.y1) r.y1 = y + m;
}

/** Añade un polígono local (fragmento) colocado en una pose. */
function addPosedPoly(r: RectMm, poly: Vec2[], pose: Pose2): void {
  const a = (pose.angleDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  for (const p of poly) addPoint(r, pose.pos.x + p.x * c - p.y * s, pose.pos.y + p.x * s + p.y * c);
}

function pad(r: RectMm, m: number): RectMm | null {
  if (isEmpty(r)) return null;
  return { x0: r.x0 - m, y0: r.y0 - m, x1: r.x1 + m, y1: r.y1 + m };
}

/** Hueso (estático y fragmentos en su pose inicial y objetivo). */
export function anatomyFocusRect(anatomy: AnatomyDef): RectMm | null {
  const r = emptyRect();
  for (const poly of anatomy.boneStatic) for (const p of poly) addPoint(r, p.x, p.y);
  for (const f of anatomy.fragments) {
    addPosedPoly(r, f.polygon, f.start);
    if (f.target) addPosedPoly(r, f.polygon, f.target);
  }
  return pad(r, 4);
}

/** Zona de trabajo de un paso (lo que el jugador tiene que ver entero), o null si no aplica. */
export function stepFocusRect(params: StepParams, anatomy: AnatomyDef): RectMm | null {
  const r = emptyRect();
  switch (params.type) {
    case 'reduction':
      for (const f of anatomy.fragments) {
        if (!params.fragmentIds.includes(f.id)) continue;
        addPosedPoly(r, f.polygon, f.start);
        if (f.target) addPosedPoly(r, f.polygon, f.target);
      }
      for (const k of params.kwireSpots ?? []) addPoint(r, k.x, k.y);
      return pad(r, 6);
    case 'drillPins':
      for (const p of params.spots) addPoint(r, p.x, p.y);
      return pad(r, 7);
    case 'clickTargets':
      for (const t of params.targets) addPoint(r, t.pos.x, t.pos.y);
      return pad(r, 7);
    case 'bandage':
      addPoint(r, params.center.x, params.center.y, params.radiusMm);
      return pad(r, 4);
    case 'screws':
      if (params.holes === 'plate') return null;
      for (const p of params.holes) addPoint(r, p.x, p.y);
      return pad(r, 7);
    default:
      return null;
  }
}

/** Encuadre por defecto de 'micro' para un caso: el hueso y todas las zonas de trabajo de sus pasos. */
export function caseFocusRect(caseDef: CaseDef): RectMm | null {
  const r = emptyRect();
  const add = (q: RectMm | null) => {
    if (!q) return;
    addPoint(r, q.x0, q.y0);
    addPoint(r, q.x1, q.y1);
  };
  add(anatomyFocusRect(caseDef.anatomy));
  for (const ph of caseDef.phases) for (const st of ph.steps) add(stepFocusRect(st.params, caseDef.anatomy));
  return isEmpty(r) ? null : r;
}
