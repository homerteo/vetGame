/**
 * Generadores de datos de audio puros (sin WebAudio): ruidos, curvas de saturación,
 * respuesta al impulso de sala pequeña y utilidades de afinación. Se calculan una vez.
 */
import { createRng } from '../core/rng';

/** Float32Array respaldado por ArrayBuffer (lo que exigen los tipos DOM de WebAudio). */
export type F32 = Float32Array<ArrayBuffer>;

export const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Ruido blanco uniforme en [-1, 1]. */
export function whiteNoise(n: number, seed = 1): F32 {
  const r = createRng(seed);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = r() * 2 - 1;
  return out;
}

/** Ruido rosa (filtro de Paul Kellet), normalizado a pico ~0,95. */
export function pinkNoise(n: number, seed = 2): F32 {
  const r = createRng(seed);
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  return normalize(out, 0.95);
}

/** Ruido marrón (integración con fuga), grave y retumbante. */
export function brownNoise(n: number, seed = 3): F32 {
  const r = createRng(seed);
  const out = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    last = (last + 0.02 * (r() * 2 - 1)) / 1.02;
    out[i] = last;
  }
  return normalize(out, 0.95);
}

export function normalize(buf: F32, peak = 1): F32 {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
  if (m > 0) {
    const k = peak / m;
    for (let i = 0; i < buf.length; i++) buf[i] *= k;
  }
  return buf;
}

/** Curva de saturación suave tanh(k·x) normalizada. */
export function softClipCurve(k = 2, n = 1024): F32 {
  const out = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    out[i] = Math.tanh(k * x) / norm;
  }
  return out;
}

/** Fuzz asimétrico (guitarra grunge): recorte duro con un poco de asimetría para armónicos pares. */
export function fuzzCurve(drive = 8, n = 2048): F32 {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const y = x >= 0 ? Math.tanh(drive * x) : Math.tanh(drive * 0.7 * x) * 0.85;
    out[i] = y;
  }
  return normalize(out, 0.9);
}

/**
 * Respuesta al impulso estéreo de sala pequeña: primeras reflexiones discretas
 * y cola de ruido con decaimiento exponencial que se oscurece con el tiempo.
 */
export function smallRoomImpulse(sampleRate: number, seconds = 0.8, seed = 7): [F32, F32] {
  const n = Math.max(1, Math.floor(sampleRate * seconds));
  const chans: [F32, F32] = [new Float32Array(n), new Float32Array(n)];
  const early = [0.0071, 0.0113, 0.0167, 0.0229, 0.0291, 0.0373];
  for (let c = 0; c < 2; c++) {
    const r = createRng(seed + c * 31);
    const d = chans[c];
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      // Cola: ruido que se amortigua y pierde agudos (paso bajo de un polo que se cierra).
      const a = 0.35 + 0.6 * Math.min(1, t / seconds);
      lp = lp * a + (r() * 2 - 1) * (1 - a);
      const fadeIn = Math.min(1, t / 0.012);
      d[i] = lp * Math.exp(-t * 7.5) * fadeIn * 1.6;
    }
    for (let k = 0; k < early.length; k++) {
      const idx = Math.floor((early[k] + c * 0.0017 * (k % 2 ? 1 : -1)) * sampleRate);
      if (idx > 0 && idx < n) d[idx] += (k % 2 ? -1 : 1) * 0.55 * Math.pow(0.78, k);
    }
  }
  return chans;
}
