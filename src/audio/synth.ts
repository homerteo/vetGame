/**
 * Ayudantes de síntesis sobre WebAudio: fuentes, filtros y envolventes.
 * Todo nodo fuente creado aquí queda con start/stop programados (sin fugas).
 */
import { brownNoise, fuzzCurve, pinkNoise, softClipCurve, whiteNoise, type F32 } from './dsp';

export type NoiseKind = 'white' | 'pink' | 'brown';

export interface Synth {
  readonly ctx: BaseAudioContext;
  readonly buffers: Record<NoiseKind, AudioBuffer>;
  readonly curves: { soft: F32; warm: F32; fuzz: F32 };
  /** Aleatorio para variación sonora (no afecta al juego). */
  rand(): number;
}

/** Valor mínimo para rampas exponenciales (no admiten 0). */
export const EPS = 0.0001;

export function createSynth(ctx: BaseAudioContext, rand: () => number = Math.random): Synth {
  const seconds = 2;
  const n = Math.max(128, Math.floor(ctx.sampleRate * seconds));
  const mk = (data: F32) => {
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    b.copyToChannel(data, 0);
    return b;
  };
  return {
    ctx,
    buffers: { white: mk(whiteNoise(n)), pink: mk(pinkNoise(n)), brown: mk(brownNoise(n)) },
    curves: { soft: softClipCurve(1.6), warm: softClipCurve(3.5), fuzz: fuzzCurve(9) },
    rand,
  };
}

export function osc(s: Synth, type: OscillatorType, freq: number, t0: number, t1: number): OscillatorNode {
  const o = s.ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  o.start(t0);
  o.stop(t1 + 0.02);
  return o;
}

/** Fuente de ruido en bucle con desfase aleatorio (dos disparos seguidos no suenan idénticos). */
export function noise(s: Synth, kind: NoiseKind, t0: number, t1: number, rate = 1): AudioBufferSourceNode {
  const src = s.ctx.createBufferSource();
  src.buffer = s.buffers[kind];
  src.loop = true;
  src.playbackRate.setValueAtTime(rate, t0);
  src.start(t0, s.rand() * 1.8);
  src.stop(t1 + 0.02);
  return src;
}

export function gain(s: Synth, v = 1): GainNode {
  const g = s.ctx.createGain();
  g.gain.value = v;
  return g;
}

export function filt(s: Synth, type: BiquadFilterType, freq: number, q = 0.707, gainDb = 0): BiquadFilterNode {
  const f = s.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  f.gain.value = gainDb;
  return f;
}

export function shaper(s: Synth, curve: F32, oversample: OverSampleType = '2x'): WaveShaperNode {
  const w = s.ctx.createWaveShaper();
  w.curve = curve;
  w.oversample = oversample;
  return w;
}

/** Conecta en serie y devuelve el último nodo. */
export function chain(...nodes: AudioNode[]): AudioNode {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return nodes[nodes.length - 1];
}

/** Envolvente percusiva: ataque lineal hasta `peak` y caída exponencial en `decay` s. */
export function perc(p: AudioParam, t: number, peak: number, attack: number, decay: number): number {
  p.setValueAtTime(EPS, t);
  p.linearRampToValueAtTime(Math.max(EPS, peak), t + attack);
  p.exponentialRampToValueAtTime(EPS, t + attack + decay);
  p.setValueAtTime(0, t + attack + decay + 0.001);
  return t + attack + decay;
}

/** Envolvente ataque–sostén–relajación (relajación exponencial). */
export function ahr(p: AudioParam, t: number, peak: number, attack: number, hold: number, release: number): number {
  const pk = Math.max(EPS, peak);
  p.setValueAtTime(EPS, t);
  p.linearRampToValueAtTime(pk, t + attack);
  p.setValueAtTime(pk, t + attack + hold);
  p.exponentialRampToValueAtTime(EPS, t + attack + hold + release);
  p.setValueAtTime(0, t + attack + hold + release + 0.001);
  return t + attack + hold + release;
}

/** Deslizamiento exponencial de frecuencia. */
export function glide(p: AudioParam, t: number, from: number, to: number, dur: number): void {
  p.setValueAtTime(Math.max(EPS, from), t);
  p.exponentialRampToValueAtTime(Math.max(EPS, to), t + Math.max(0.001, dur));
}

/** Congela el valor actual de un parámetro (evita saltos al cancelar rampas). */
export function holdParam(p: AudioParam, t: number): void {
  const anyP = p as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
  if (typeof anyP.cancelAndHoldAtTime === 'function') {
    anyP.cancelAndHoldAtTime(t);
  } else {
    const v = p.value;
    p.cancelScheduledValues(t);
    p.setValueAtTime(v, t);
  }
}

/** Golpe de ruido filtrado breve (clics, crujidos, chasquidos). */
export function noiseHit(
  s: Synth,
  out: AudioNode,
  t: number,
  o: { kind?: NoiseKind; type?: BiquadFilterType; freq: number; q?: number; peak: number; attack?: number; decay: number },
): number {
  const src = noise(s, o.kind ?? 'white', t, t + (o.attack ?? 0.001) + o.decay + 0.02);
  const f = filt(s, o.type ?? 'bandpass', o.freq, o.q ?? 1);
  const g = gain(s, 0);
  const end = perc(g.gain, t, o.peak, o.attack ?? 0.001, o.decay);
  chain(src, f, g, out);
  return end;
}

/** Tono simple con envolvente percusiva y deslizamiento opcional. */
export function tone(
  s: Synth,
  out: AudioNode,
  t: number,
  o: { type?: OscillatorType; freq: number; to?: number; glide?: number; peak: number; attack?: number; decay: number },
): number {
  const attack = o.attack ?? 0.003;
  const end = t + attack + o.decay;
  const oscN = osc(s, o.type ?? 'sine', o.freq, t, end);
  if (o.to !== undefined) glide(oscN.frequency, t, o.freq, o.to, o.glide ?? o.decay);
  const g = gain(s, 0);
  perc(g.gain, t, o.peak, attack, o.decay);
  chain(oscN, g, out);
  return end;
}

/** Campana metálica con parciales inarmónicos (ping de metal, tornillo, placa). */
export function metalPing(
  s: Synth,
  out: AudioNode,
  t: number,
  freq: number,
  peak: number,
  decay: number,
  ratios: readonly number[] = [1, 2.41, 3.93, 5.4],
): number {
  let end = t;
  for (let i = 0; i < ratios.length; i++) {
    const a = peak / (1 + i * 0.9);
    const d = decay / (1 + i * 0.5);
    end = Math.max(end, tone(s, out, t, { freq: freq * ratios[i], peak: a, attack: 0.001, decay: d }));
  }
  return end;
}
