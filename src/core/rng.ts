/** Generador determinista (mulberry32). */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(rng: () => number, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length) % arr.length];

/** Ruido suave 1D (para temblores): suma de senos con fases aleatorias. */
export function createSmoothNoise(seed: number) {
  const r = createRng(seed);
  const f = [0.7 + r() * 0.6, 2.1 + r() * 1.2, 5.3 + r() * 2.0];
  const ph = [r() * 6.28, r() * 6.28, r() * 6.28];
  return (t: number) =>
    (Math.sin(t * f[0] * 6.28 + ph[0]) * 0.55 + Math.sin(t * f[1] * 6.28 + ph[1]) * 0.3 + Math.sin(t * f[2] * 6.28 + ph[2]) * 0.15);
}
