import type { BloodPoolAPI, Vec2 } from '../core/contracts';
import { WOUND_H_MM, WOUND_W_MM } from '../core/constants';
import { pointInPolygon } from '../core/math';

/**
 * Charco de sangre en una rejilla de alturas (fila mayor) sobre el espacio de herida.
 * - Una celda llena (altura 1) contiene capacityPctBV / (cols·rows) %BV.
 * - Difusión explícita por aristas (conservativa y sin valores negativos): solo se mueve la
 *   sangre por encima de una película mínima (la que moja el tejido se queda pegada).
 * - Con `window`, las celdas de fuera están "más altas" y en pendiente (la sangre cae hacia
 *   la ventana), se escurren ×3 más rápido y no superan 0,35 (el borde hace de muro).
 * - Si el total supera la capacidad, el exceso se derrama (el nivel nunca pasa del 100 %).
 * - Sin asignaciones por paso: doble búfer (grid + scratch).
 */

/** Drenaje pasivo (gasas, absorción) por segundo dentro de la ventana. */
export const POOL_DRAIN_IN_PER_SEC = 0.006;
/** Fuera de la ventana escurre ×3. */
export const POOL_DRAIN_OUT_PER_SEC = POOL_DRAIN_IN_PER_SEC * 3;
/** Altura máxima de una celda fuera de la ventana. */
export const POOL_OUTSIDE_MAX = 0.35;
/** Película que no fluye (moja el tejido). */
export const POOL_FILM = 0.03;
/** Coeficiente de difusión (celdas²/s). */
const DIFFUSION = 40;
/** Desnivel de las celdas fuera de la ventana (en alturas de celda). */
const OUTSIDE_ELEVATION = 0.25;
/** Pendiente fuera de la ventana (altura por celda de distancia a ella). */
const OUTSIDE_SLOPE = 0.05;
/** Máximo coeficiente por subpaso para estabilidad. */
const MAX_COEF = 0.25;

export function createBloodPool(
  opts: { cols?: number; rows?: number; capacityPctBV?: number; window?: Vec2[] } = {},
): BloodPoolAPI {
  const cols = Math.max(2, Math.floor(opts.cols ?? 64));
  const rows = Math.max(2, Math.floor(opts.rows ?? 40));
  const n = cols * rows;
  const capacityPctBV = opts.capacityPctBV ?? 5;
  const unit = capacityPctBV / n; // %BV por celda llena
  const cellW = WOUND_W_MM / cols;
  const cellH = WOUND_H_MM / rows;

  const grid = new Float32Array(n);
  const scratch = new Float32Array(n);
  // 1 = dentro de la ventana (o sin ventana), 0 = fuera.
  const inside = new Uint8Array(n);
  const elevation = new Float32Array(n);
  const hasWindow = !!opts.window && opts.window.length >= 3;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const isIn = !hasWindow || pointInPolygon({ x: (c + 0.5) * cellW, y: (r + 0.5) * cellH }, opts.window as Vec2[]);
      inside[i] = isIn ? 1 : 0;
    }
  }
  if (hasWindow) {
    // Distancia (chamfer 3-4) a la ventana: fuera, el terreno cae en pendiente hacia ella.
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = inside[i] ? 0 : 1e9;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (c > 0) d[i] = Math.min(d[i], d[i - 1] + 3);
        if (r > 0) {
          d[i] = Math.min(d[i], d[i - cols] + 3);
          if (c > 0) d[i] = Math.min(d[i], d[i - cols - 1] + 4);
          if (c + 1 < cols) d[i] = Math.min(d[i], d[i - cols + 1] + 4);
        }
      }
    for (let r = rows - 1; r >= 0; r--)
      for (let c = cols - 1; c >= 0; c--) {
        const i = r * cols + c;
        if (c + 1 < cols) d[i] = Math.min(d[i], d[i + 1] + 3);
        if (r + 1 < rows) {
          d[i] = Math.min(d[i], d[i + cols] + 3);
          if (c + 1 < cols) d[i] = Math.min(d[i], d[i + cols + 1] + 4);
          if (c > 0) d[i] = Math.min(d[i], d[i + cols - 1] + 4);
        }
      }
    for (let i = 0; i < n; i++) elevation[i] = inside[i] ? 0 : OUTSIDE_ELEVATION + OUTSIDE_SLOPE * (d[i] / 3);
  }

  let totalCache = 0;
  let totalDirty = false;

  function total(): number {
    if (totalDirty) {
      let s = 0;
      for (let i = 0; i < n; i++) s += grid[i];
      totalCache = s * unit;
      totalDirty = false;
    }
    return totalCache;
  }

  /** Flujo de i→j por una arista, limitado a la sangre móvil disponible. */
  function edgeFlux(i: number, j: number, coef: number) {
    const hi = grid[i];
    const hj = grid[j];
    if (hi <= POOL_FILM && hj <= POOL_FILM) return; // nada móvil a ningún lado
    const mi = hi > POOL_FILM ? hi - POOL_FILM : 0;
    const mj = hj > POOL_FILM ? hj - POOL_FILM : 0;
    let f = coef * (mi + elevation[i] - mj - elevation[j]);
    if (f > 0) {
      const lim = mi * 0.25;
      if (f > lim) f = lim;
      // Fuera de la ventana el borde hace de muro: no se llena por encima del tope.
      if (!inside[j]) {
        const room = POOL_OUTSIDE_MAX - scratch[j];
        if (f > room) f = room > 0 ? room : 0;
      }
    } else if (f < 0) {
      const lim = mj * 0.25;
      if (-f > lim) f = -lim;
      if (!inside[i]) {
        const room = POOL_OUTSIDE_MAX - scratch[i];
        if (-f > room) f = room > 0 ? -room : 0;
      }
    } else return;
    if (f === 0) return;
    scratch[i] -= f;
    scratch[j] += f;
  }

  function substep(dt: number, coef: number) {
    scratch.set(grid);
    for (let r = 0; r < rows; r++) {
      const row = r * cols;
      for (let c = 0; c < cols; c++) {
        const i = row + c;
        if (c + 1 < cols) edgeFlux(i, i + 1, coef);
        if (r + 1 < rows) edgeFlux(i, i + cols, coef);
      }
    }
    for (let i = 0; i < n; i++) {
      let h = scratch[i];
      if (h <= 1e-7) {
        grid[i] = 0;
        continue;
      }
      h *= 1 - (inside[i] ? POOL_DRAIN_IN_PER_SEC : POOL_DRAIN_OUT_PER_SEC) * dt;
      // Lo que cae directamente fuera por encima del tope escurre por los paños.
      if (!inside[i] && h > POOL_OUTSIDE_MAX) h = POOL_OUTSIDE_MAX;
      grid[i] = h;
    }
  }

  return {
    cols,
    rows,
    grid,
    capacityPctBV,

    add(pos, amountPctBV) {
      if (!(amountPctBV > 0)) return;
      const amountCells = amountPctBV / unit;
      const gx = pos.x / cellW - 0.5;
      const gy = pos.y / cellH - 0.5;
      const cx = Math.round(gx);
      const cy = Math.round(gy);
      const sigma2 = 2 * 0.9 * 0.9;
      // Primera pasada: suma de pesos (solo celdas dentro de la rejilla).
      let wsum = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const r = cy + dy;
        if (r < 0 || r >= rows) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const c = cx + dx;
          if (c < 0 || c >= cols) continue;
          const ex = c - gx;
          const ey = r - gy;
          wsum += Math.exp(-(ex * ex + ey * ey) / sigma2);
        }
      }
      if (wsum <= 0) {
        // Fuera de la rejilla: todo a la celda más cercana.
        const c = Math.min(cols - 1, Math.max(0, cx));
        const r = Math.min(rows - 1, Math.max(0, cy));
        grid[r * cols + c] += amountCells;
        totalDirty = true;
        return;
      }
      for (let dy = -2; dy <= 2; dy++) {
        const r = cy + dy;
        if (r < 0 || r >= rows) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const c = cx + dx;
          if (c < 0 || c >= cols) continue;
          const ex = c - gx;
          const ey = r - gy;
          grid[r * cols + c] += (amountCells * Math.exp(-(ex * ex + ey * ey) / sigma2)) / wsum;
        }
      }
      totalDirty = true;
    },

    suction(pos, radiusMm, maxPctBVPerSec, dt) {
      if (!(radiusMm > 0) || !(maxPctBVPerSec > 0) || !(dt > 0)) return 0;
      const budget = (maxPctBVPerSec * dt) / unit;
      const c0 = Math.max(0, Math.floor((pos.x - radiusMm) / cellW));
      const c1 = Math.min(cols - 1, Math.floor((pos.x + radiusMm) / cellW));
      const r0 = Math.max(0, Math.floor((pos.y - radiusMm) / cellH));
      const r1 = Math.min(rows - 1, Math.floor((pos.y + radiusMm) / cellH));
      const rr = radiusMm * radiusMm;
      // Pasada 1: sangre alcanzable ponderada por la caída (1 − d²/r²).
      let reach = 0;
      for (let r = r0; r <= r1; r++) {
        const y = (r + 0.5) * cellH - pos.y;
        for (let c = c0; c <= c1; c++) {
          const x = (c + 0.5) * cellW - pos.x;
          const d2 = x * x + y * y;
          if (d2 >= rr) continue;
          reach += grid[r * cols + c] * (1 - d2 / rr);
        }
      }
      if (reach <= 0) return 0;
      const f = reach <= budget ? 1 : budget / reach;
      let removed = 0;
      for (let r = r0; r <= r1; r++) {
        const y = (r + 0.5) * cellH - pos.y;
        for (let c = c0; c <= c1; c++) {
          const x = (c + 0.5) * cellW - pos.x;
          const d2 = x * x + y * y;
          if (d2 >= rr) continue;
          const i = r * cols + c;
          const take = grid[i] * (1 - d2 / rr) * f;
          grid[i] -= take;
          removed += take;
        }
      }
      totalDirty = true;
      return removed * unit;
    },

    step(dt) {
      if (!(dt > 0)) return;
      const coefTotal = DIFFUSION * dt;
      const steps = Math.min(8, Math.max(1, Math.ceil(coefTotal / MAX_COEF)));
      const sdt = dt / steps;
      const coef = coefTotal / steps;
      for (let s = 0; s < steps; s++) substep(sdt, coef);
      totalDirty = true;
      // Cavidad desbordada: el exceso cae por los paños (el nivel nunca pasa del 100 %).
      const tot = total();
      if (tot > capacityPctBV) {
        const k = capacityPctBV / tot;
        for (let i = 0; i < n; i++) grid[i] *= k;
        totalCache = capacityPctBV;
      }
    },

    levelPct() {
      const l = (100 * total()) / capacityPctBV;
      return l < 0 ? 0 : l > 100 ? 100 : l;
    },

    totalPctBV() {
      return total();
    },

    clear() {
      grid.fill(0);
      totalCache = 0;
      totalDirty = false;
    },
  };
}
