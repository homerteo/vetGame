/**
 * Forma de onda del ECG (sin DOM): complejo P-QRS-T a la FC real, fibrilación
 * ventricular caótica, línea plana en asistolia y ruido cuando no hay señal.
 */

export type EcgRhythm = 'sinus' | 'tachy' | 'brady' | 'vfib' | 'asystole' | 'noSignal';

const gauss = (x: number, mu: number, sigma: number) => {
  const d = (x - mu) / sigma;
  return Math.exp(-0.5 * d * d);
};

/**
 * Amplitud (≈ -0,3..1) del latido sinusal en función del tiempo desde el inicio
 * del latido (s). Las ondas se comprimen si el latido es más corto que el complejo.
 */
export function beatSample(tb: number, beatSec: number): number {
  const k = Math.min(1, beatSec / 0.62);
  const x = tb / k;
  return (
    0.12 * gauss(x, 0.09, 0.022) - // P
    0.1 * gauss(x, 0.2, 0.008) + // Q
    1.0 * gauss(x, 0.222, 0.009) - // R
    0.26 * gauss(x, 0.245, 0.01) + // S
    0.28 * gauss(x, 0.42, 0.045) // T
  );
}

/** Fibrilación ventricular: ondulación irregular de amplitud cambiante. */
export function vfibSample(t: number): number {
  const env = 0.45 + 0.25 * Math.sin(t * 1.3) + 0.12 * Math.sin(t * 3.7 + 1.1);
  return (
    env *
    (Math.sin(t * 2 * Math.PI * 4.7) * 0.6 +
      Math.sin(t * 2 * Math.PI * 6.3 + 0.7) * 0.3 +
      Math.sin(t * 2 * Math.PI * 9.1 + 2.1) * 0.12)
  );
}

/** Ruido de "sin señal" (pseudoaleatorio pero determinista). */
export function noiseSample(t: number): number {
  const s = Math.sin(t * 12.9898 * 97.3) * 43758.5453;
  return (s - Math.floor(s) - 0.5) * 0.18;
}

/** Artefacto de una compresión torácica (RCP) en la traza. */
export function compressionArtifact(sinceSec: number): number {
  if (sinceSec < 0 || sinceSec > 0.35) return 0;
  return 0.55 * Math.sin((sinceSec / 0.35) * Math.PI) * Math.exp(-sinceSec * 4);
}

/** Generador de traza con estado (fase del latido). Sin asignaciones por muestra. */
export interface EcgTrace {
  /** Avanza dt segundos y devuelve la muestra actual. */
  step(dt: number, hr: number, rhythm: EcgRhythm): number;
  /** Tiempo acumulado (s). */
  readonly time: number;
  /** Número de latidos completados (para pitidos o el corazón que late). */
  readonly beats: number;
}

export function createEcgTrace(): EcgTrace {
  let t = 0;
  let tb = 0;
  let beats = 0;
  return {
    step(dt, hr, rhythm) {
      t += dt;
      if (rhythm === 'vfib') return vfibSample(t);
      if (rhythm === 'asystole') return noiseSample(t) * 0.15;
      if (rhythm === 'noSignal') return noiseSample(t) * 2.2;
      const rate = Number.isFinite(hr) && hr > 1 ? hr : 60;
      const beatSec = 60 / rate;
      tb += dt;
      while (tb >= beatSec) {
        tb -= beatSec;
        beats++;
      }
      return beatSample(tb, beatSec) + noiseSample(t) * 0.12;
    },
    get time() {
      return t;
    },
    get beats() {
      return beats;
    },
  };
}
