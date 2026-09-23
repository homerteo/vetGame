/** Detectores de gestos de los mini-juegos de exploración (coordenadas de lienzo). Lógica pura. */

/** Cuenta vaivenes horizontales con amplitud mínima (prueba del cajón). */
export function createStrokeCounter(minAmp: number) {
  let dir = 0;
  let extreme = 0;
  let anchor = 0;
  let started = false;
  let strokes = 0;
  return {
    feed(x: number): number {
      if (!started) {
        started = true;
        anchor = extreme = x;
        return strokes;
      }
      if (dir >= 0 && x > extreme) extreme = x;
      if (dir <= 0 && x < extreme) extreme = x;
      if (dir === 0 && Math.abs(x - anchor) >= minAmp) {
        dir = Math.sign(x - anchor);
        extreme = x;
      } else if (dir !== 0 && (extreme - x) * dir >= minAmp) {
        strokes++;
        dir = -dir;
        extreme = x;
      }
      return strokes;
    },
    get strokes() {
      return strokes;
    },
    reset() {
      started = false;
      dir = 0;
      strokes = 0;
    },
  };
}

/** Acumula el ángulo recorrido alrededor de un centro dentro de un anillo (rótula). */
export function createAngleAccumulator(cx: number, cy: number, minR: number, maxR: number) {
  let last: number | null = null;
  let total = 0;
  return {
    feed(x: number, y: number): number {
      const r = Math.hypot(x - cx, y - cy);
      if (r < minR || r > maxR) {
        last = null;
        return total;
      }
      const a = Math.atan2(y - cy, x - cx);
      if (last !== null) {
        let d = a - last;
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        if (Math.abs(d) < 1.2) total += Math.abs(d);
      }
      last = a;
      return total;
    },
    lift() {
      last = null;
    },
    get total() {
      return total;
    },
  };
}

/**
 * Detecta circulitos pequeños en cualquier sitio (crepitación): integra el giro de la
 * dirección de movimiento mientras el trazo es corto y curvo.
 */
export function createSmallCircleDetector(minStep = 2) {
  let px: number | null = null;
  let py = 0;
  let lastHeading: number | null = null;
  let total = 0;
  return {
    feed(x: number, y: number): number {
      if (px === null) {
        px = x;
        py = y;
        return total;
      }
      const dx = x - px;
      const dy = y - py;
      if (Math.hypot(dx, dy) < minStep) return total;
      const h = Math.atan2(dy, dx);
      if (lastHeading !== null) {
        let d = h - lastHeading;
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        // cuenta curvas y esquinas de un garabato; ignora los vaivenes (giros de ~180°)
        if (Math.abs(d) < 2.0) total += Math.abs(d);
      }
      lastHeading = h;
      px = x;
      py = y;
      return total;
    },
    lift() {
      px = null;
      lastHeading = null;
    },
    get total() {
      return total;
    },
  };
}

/** Rejilla de cobertura (barrido de pulmones). La máscara indica qué celdas cuentan. */
export function createCoverage(cols: number, rows: number, w: number, h: number, mask: (u: number, v: number) => boolean) {
  const hit = new Uint8Array(cols * rows);
  const valid = new Uint8Array(cols * rows);
  let validCount = 0;
  let hitCount = 0;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      if (mask((i + 0.5) / cols, (j + 0.5) / rows)) {
        valid[j * cols + i] = 1;
        validCount++;
      }
    }
  return {
    mark(x: number, y: number, radius: number): number {
      const cw = w / cols;
      const ch = h / rows;
      const i0 = Math.max(0, Math.floor((x - radius) / cw));
      const i1 = Math.min(cols - 1, Math.floor((x + radius) / cw));
      const j0 = Math.max(0, Math.floor((y - radius) / ch));
      const j1 = Math.min(rows - 1, Math.floor((y + radius) / ch));
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const k = j * cols + i;
          if (!valid[k] || hit[k]) continue;
          const cx = (i + 0.5) * cw;
          const cy = (j + 0.5) * ch;
          if (Math.hypot(cx - x, cy - y) <= radius + Math.max(cw, ch) * 0.5) {
            hit[k] = 1;
            hitCount++;
          }
        }
      return this.fraction;
    },
    get fraction() {
      return validCount ? hitCount / validCount : 1;
    },
    isHit(i: number, j: number) {
      return hit[j * cols + i] === 1;
    },
    isValid(i: number, j: number) {
      return valid[j * cols + i] === 1;
    },
  };
}
