/**
 * Medidor de ritmo de compresiones (compresiones/min) con ventana deslizante.
 * Búfer circular fijo: sin asignaciones por pulsación.
 */
export interface RateMeter {
  /** Registra una pulsación en t (s) y devuelve el ritmo tras ella (0 si aún no hay dos). */
  press(t: number): number;
  /** Ritmo actual en t: decae si el jugador deja de pulsar. */
  rate(t: number): number;
  /** Segundos desde la última pulsación (Infinity si nunca). */
  sinceLast(t: number): number;
  readonly count: number;
  reset(): void;
}

export function createRateMeter(windowSec = 4, capacity = 16): RateMeter {
  const buf = new Float64Array(capacity);
  let head = 0; // próxima posición de escritura
  let size = 0;
  let total = 0;

  const rollingAt = (t: number) => {
    if (size < 2) return 0;
    const lastIdx = (head - 1 + capacity) % capacity;
    const last = buf[lastIdx];
    let first = last;
    let n = 1;
    for (let k = 1; k < size; k++) {
      const v = buf[(head - 1 - k + capacity * 2) % capacity];
      if (last - v > windowSec) break;
      first = v;
      n++;
    }
    if (n < 2 || last - first <= 1e-6) return 0;
    const r = ((n - 1) * 60) / (last - first);
    // Si ha pasado más de un intervalo esperado sin pulsar, el ritmo cae.
    const gap = t - last;
    const expected = 60 / r;
    return gap > expected ? Math.min(r, 60 / gap) : r;
  };

  return {
    press(t) {
      buf[head] = t;
      head = (head + 1) % capacity;
      if (size < capacity) size++;
      total++;
      return rollingAt(t);
    },
    rate: rollingAt,
    sinceLast(t) {
      if (size === 0) return Infinity;
      return t - buf[(head - 1 + capacity) % capacity];
    },
    get count() {
      return total;
    },
    reset() {
      head = 0;
      size = 0;
      total = 0;
    },
  };
}
