/** Cinemática en el plano XZ (aceleración, inercia de botas de plataforma, resbalones) y colisiones simples. */
import { WALLS, WALL_THICK, type Rect } from './layout';

export interface Body {
  x: number;
  z: number;
  vx: number;
  vz: number;
  r: number;
}

export type Collider =
  | ({ kind: 'box' } & Rect)
  | { kind: 'circle'; x: number; z: number; r: number };

export interface MoveOpts {
  maxSpeed: number;
  accel: number;
  decel: number;
  slipAccelMult: number;
  slipDecelMult: number;
  slippery: boolean;
}

/**
 * Integra la velocidad hacia la deseada (entrada × velocidad máxima).
 * Sobre un charco la tracción cae mucho: se patina y cuesta frenar.
 */
export function stepBody(b: Body, ix: number, iz: number, dt: number, o: MoveOpts): void {
  const il = Math.hypot(ix, iz);
  if (il > 1) {
    ix /= il;
    iz /= il;
  }
  const hasInput = il > 1e-3;
  const tx = ix * o.maxSpeed;
  const tz = iz * o.maxSpeed;
  let rate = hasInput ? o.accel : o.decel;
  if (o.slippery) rate *= hasInput ? o.slipAccelMult : o.slipDecelMult;
  const dx = tx - b.vx;
  const dz = tz - b.vz;
  const dl = Math.hypot(dx, dz);
  const maxDv = rate * dt;
  if (dl <= maxDv || dl < 1e-9) {
    b.vx = tx;
    b.vz = tz;
  } else {
    b.vx += (dx / dl) * maxDv;
    b.vz += (dz / dl) * maxDv;
  }
  // en el charco se puede superar un poco la velocidad (derrape)
  const sp = Math.hypot(b.vx, b.vz);
  const cap = o.slippery ? o.maxSpeed * 1.25 : o.maxSpeed;
  if (sp > cap && !hasInput) {
    b.vx *= cap / sp;
    b.vz *= cap / sp;
  }
  b.x += b.vx * dt;
  b.z += b.vz * dt;
}

/** Empuja el cuerpo fuera de los colisionadores y anula la velocidad contra ellos. Devuelve si tocó algo. */
export function resolveCollisions(b: Body, colliders: readonly Collider[]): boolean {
  let hit = false;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    let nx = 0;
    let nz = 0;
    let pen = 0;
    if (c.kind === 'circle') {
      const dx = b.x - c.x;
      const dz = b.z - c.z;
      const d = Math.hypot(dx, dz);
      const minD = b.r + c.r;
      if (d >= minD) continue;
      if (d < 1e-6) {
        nx = 1;
        nz = 0;
      } else {
        nx = dx / d;
        nz = dz / d;
      }
      pen = minD - d;
    } else {
      const cx = b.x < c.minX ? c.minX : b.x > c.maxX ? c.maxX : b.x;
      const cz = b.z < c.minZ ? c.minZ : b.z > c.maxZ ? c.maxZ : b.z;
      const dx = b.x - cx;
      const dz = b.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 > 1e-12) {
        if (d2 >= b.r * b.r) continue;
        const d = Math.sqrt(d2);
        nx = dx / d;
        nz = dz / d;
        pen = b.r - d;
      } else {
        // centro dentro de la caja: sale por el lado más cercano
        const l = b.x - c.minX;
        const r = c.maxX - b.x;
        const t = b.z - c.minZ;
        const bo = c.maxZ - b.z;
        const m = Math.min(l, r, t, bo);
        if (m === l) {
          nx = -1;
          pen = l + b.r;
        } else if (m === r) {
          nx = 1;
          pen = r + b.r;
        } else if (m === t) {
          nz = -1;
          pen = t + b.r;
        } else {
          nz = 1;
          pen = bo + b.r;
        }
      }
    }
    b.x += nx * pen;
    b.z += nz * pen;
    const vn = b.vx * nx + b.vz * nz;
    if (vn < 0) {
      b.vx -= vn * nx;
      b.vz -= vn * nz;
    }
    hit = true;
  }
  return hit;
}

/** Colisionadores de los tabiques del plano. */
export function wallColliders(): Collider[] {
  const h = WALL_THICK / 2;
  return WALLS.map((w) => ({
    kind: 'box' as const,
    minX: Math.min(w.x1, w.x2) - h,
    maxX: Math.max(w.x1, w.x2) + h,
    minZ: Math.min(w.z1, w.z2) - h,
    maxZ: Math.max(w.z1, w.z2) + h,
  }));
}

export function inPuddle(x: number, z: number, puddles: ReadonlyArray<{ x: number; z: number; r: number }>): boolean {
  for (let i = 0; i < puddles.length; i++) {
    const p = puddles[i];
    const dx = x - p.x;
    const dz = z - p.z;
    if (dx * dx + dz * dz < p.r * p.r) return true;
  }
  return false;
}
