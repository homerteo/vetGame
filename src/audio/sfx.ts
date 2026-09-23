/**
 * Recetas de efectos (GDD §9). Cada receta programa sus nodos a partir de `t`
 * sobre `out` y devuelve el instante (s) en que termina de sonar.
 */
import type { SfxName } from '../core/contracts';
import { midiToHz } from './dsp';
import {
  ahr,
  chain,
  EPS,
  filt,
  gain,
  glide,
  metalPing,
  noise,
  noiseHit,
  osc,
  perc,
  shaper,
  tone,
  type Synth,
} from './synth';

export interface SfxParams {
  /** Multiplicador de afinación (1 = original). */
  pitch: number;
  /** 0..1, fuerza del gesto. */
  intensity: number;
}

export type SfxRecipe = (s: Synth, out: AudioNode, t: number, p: SfxParams) => number;

export type BusName = 'sfx' | 'voice';

export interface SfxMeta {
  bus: BusName;
  /** Ganancia de salida (calibrada por RMS con render offline). */
  gain: number;
  /** Envío a la reverb de sala 0..1. */
  reverb: number;
  /** Separación mínima entre dos disparos del mismo efecto (s). */
  minGap: number;
  /** Si existe, atenúa música y ASMR a este nivel mientras suena. */
  duck?: number;
}

// ───────────── Piezas reutilizables ─────────────

/** Burbuja: seno con subida rápida de tono (gorgoteo, plop). */
function bubble(s: Synth, out: AudioNode, t: number, f0: number, peak: number, dur: number): number {
  return tone(s, out, t, { freq: f0, to: f0 * 2.4, glide: dur, peak, attack: 0.002, decay: dur });
}

/** Clic seco y brillante. */
function click(s: Synth, out: AudioNode, t: number, freq: number, peak: number, decay = 0.006): number {
  return noiseHit(s, out, t, { type: 'bandpass', freq, q: 1.5, peak, decay });
}

/** Nota con parciales de campana (glockenspiel/celesta). */
function bell(s: Synth, out: AudioNode, t: number, freq: number, peak: number, decay = 0.9): number {
  tone(s, out, t, { freq, peak, attack: 0.002, decay });
  tone(s, out, t, { freq: freq * 2.76, peak: peak * 0.28, attack: 0.001, decay: decay * 0.35 });
  tone(s, out, t, { freq: freq * 5.4, peak: peak * 0.12, attack: 0.001, decay: decay * 0.15 });
  return t + decay;
}

/** Filtro formante (vocal) para ladridos y gritos. */
function formants(s: Synth, input: AudioNode, out: AudioNode, f: readonly [number, number, number], q = 8): void {
  const amps = [1, 0.6, 0.3];
  for (let i = 0; i < 3; i++) {
    const bp = filt(s, 'bandpass', f[i], q);
    const g = gain(s, amps[i]);
    input.connect(bp);
    chain(bp, g, out);
  }
}

/** Latido "lub-dub" suave. */
function heartbeat(s: Synth, out: AudioNode, t: number, peak: number): number {
  const lp = filt(s, 'lowpass', 220, 0.7);
  lp.connect(out);
  tone(s, lp, t, { freq: 75, to: 48, peak, attack: 0.006, decay: 0.13 });
  return tone(s, lp, t + 0.15, { freq: 66, to: 44, peak: peak * 0.7, attack: 0.006, decay: 0.12 });
}

/** Acorde quinta ("power chord") distorsionado de guitarra grunge. */
function powerChord(s: Synth, out: AudioNode, t: number, rootMidi: number, dur: number, peak: number, mute = false): number {
  const pre = gain(s, 0.5);
  const sh = shaper(s, s.curves.fuzz);
  const cab = filt(s, 'lowpass', mute ? 1300 : 3200, 0.9);
  const mid = filt(s, 'peaking', 700, 1.2, -4);
  const g = gain(s, 0);
  const release = mute ? 0.06 : 0.18;
  ahr(g.gain, t, peak, 0.004, Math.max(0.01, dur - release), release);
  chain(pre, sh, cab, mid, g, out);
  const end = t + dur + 0.02;
  const notes = [rootMidi, rootMidi + 7, rootMidi + 12];
  for (let i = 0; i < notes.length; i++) {
    for (const det of [-9, 8]) {
      const o = osc(s, 'sawtooth', midiToHz(notes[i]), t, end);
      o.detune.value = det + (s.rand() - 0.5) * 4;
      const og = gain(s, i === 2 ? 0.5 : 0.8);
      chain(o, og, pre);
    }
  }
  return end;
}

// ───────────── Recetas ─────────────

export const SFX: Record<SfxName, SfxRecipe> = {
  squelch(s, out, t, { pitch: P, intensity: I }) {
    const dur = 0.28 + 0.16 * I;
    const src = noise(s, 'pink', t, t + dur);
    const bp = filt(s, 'bandpass', 900 * P, 4.5);
    glide(bp.frequency, t, 1300 * P, 280 * P, dur * 0.85);
    const sh = shaper(s, s.curves.warm);
    const g = gain(s, 0);
    ahr(g.gain, t, 0.9, 0.012, dur * 0.3, dur * 0.65);
    chain(src, bp, sh, g, out);
    tone(s, out, t + 0.01, { freq: 240 * P, to: 95 * P, peak: 0.22, decay: dur * 0.8 });
    bubble(s, out, t + dur * 0.5, 330 * P, 0.14, 0.05);
    bubble(s, out, t + dur * 0.78, 460 * P, 0.08, 0.035);
    return t + dur + 0.06;
  },

  crunch(s, out, t, { pitch: P, intensity: I }) {
    // Apio/nuez: ráfagas de ruido filtrado con microimpulsos aleatorios.
    const n = 7 + Math.round(9 * I);
    const span = 0.16 + 0.14 * I;
    let end = t;
    for (let i = 0; i < n; i++) {
      const ti = t + span * Math.pow(s.rand(), 1.3);
      end = Math.max(
        end,
        noiseHit(s, out, ti, {
          type: 'bandpass',
          freq: (1400 + s.rand() * 4200) * P,
          q: 1.5 + s.rand() * 3,
          peak: 0.35 + s.rand() * 0.6,
          decay: 0.004 + s.rand() * 0.018,
        }),
      );
      if (s.rand() < 0.5) click(s, out, ti + 0.002, 6500 * P, 0.4 + 0.4 * s.rand(), 0.0015);
    }
    tone(s, out, t, { freq: 190 * P, to: 120 * P, peak: 0.35, decay: 0.05 });
    return end + 0.02;
  },

  boneClonk(s, out, t, { pitch: P, intensity: I }) {
    const pk = 0.6 + 0.4 * I;
    tone(s, out, t, { freq: 150 * P, to: 92 * P, peak: pk, attack: 0.002, decay: 0.2 });
    // resonancia de madera
    const src = osc(s, 'triangle', 430 * P, t, t + 0.12);
    const bp = filt(s, 'bandpass', 430 * P, 7);
    const g = gain(s, 0);
    perc(g.gain, t, pk * 0.8, 0.001, 0.09);
    chain(src, bp, g, out);
    tone(s, out, t, { freq: 860 * P, peak: pk * 0.2, attack: 0.001, decay: 0.04 });
    click(s, out, t, 3200 * P, pk * 0.6, 0.004);
    return t + 0.24;
  },

  retractorClick(s, out, t, { pitch: P, intensity: I }) {
    const gap = 0.028;
    for (let i = 0; i < 3; i++) {
      const ti = t + i * gap;
      const pk = i === 2 ? 0.7 : 0.4;
      noiseHit(s, out, ti, { type: 'bandpass', freq: 3600 * P, q: 9, peak: pk, decay: 0.008 });
      tone(s, out, ti, { freq: (4100 + i * 180) * P, peak: pk * 0.25, attack: 0.001, decay: 0.03 });
    }
    metalPing(s, out, t + 2 * gap, 2300 * P, 0.12 + 0.08 * I, 0.18);
    return t + 2 * gap + 0.2;
  },

  screwThread(s, out, t, { pitch: P, intensity: I }) {
    const n = 8;
    let ti = t;
    for (let i = 0; i < n; i++) {
      const pk = 0.3 + 0.2 * I + (i % 2 ? 0 : 0.1);
      noiseHit(s, out, ti, { type: 'bandpass', freq: 5200 * P, q: 6, peak: pk, decay: 0.004 });
      tone(s, out, ti, { freq: (2500 + i * 40) * P, peak: pk * 0.35, attack: 0.001, decay: 0.018 });
      ti += 0.064 - i * 0.0035;
    }
    return ti + 0.03;
  },

  torqueClick(s, out, t, { pitch: P }) {
    for (let i = 0; i < 2; i++) {
      const ti = t + i * 0.055;
      click(s, out, ti, 3000 * P, 0.9, 0.005);
      tone(s, out, ti, { type: 'square', freq: 1800 * P, peak: 0.12, attack: 0.001, decay: 0.015 });
      metalPing(s, out, ti, 3100 * P, 0.14, 0.06);
    }
    return t + 0.2;
  },

  screwDrop(s, out, t, { pitch: P, intensity: I }) {
    // tin-tin-tin: rebotes cada vez más seguidos y débiles
    let ti = t;
    let interval = 0.2 + 0.05 * I;
    let amp = 0.6;
    for (let i = 0; i < 7; i++) {
      metalPing(s, out, ti, (2900 + (s.rand() - 0.5) * 240) * P, amp, 0.14 + amp * 0.1, [1, 2.4, 3.9]);
      ti += interval;
      interval *= 0.66;
      amp *= 0.62;
    }
    // traqueteo final
    for (let i = 0; i < 5; i++) click(s, out, ti + i * 0.018, 6000 * P, 0.08 * (1 - i / 5), 0.003);
    return ti + 0.2;
  },

  contaminated(s, out, t, { pitch: P }) {
    // zumbador descendente de concurso
    const end1 = t + 0.55;
    const lp = filt(s, 'lowpass', 1800, 0.8);
    const g = gain(s, 0);
    ahr(g.gain, t, 0.5, 0.01, 0.4, 0.14);
    chain(lp, g, out);
    for (const [from, to] of [[240, 160], [254, 168]] as const) {
      const o = osc(s, 'sawtooth', from * P, t, end1);
      glide(o.frequency, t, from * P, to * P, 0.55);
      o.connect(lp);
    }
    // "boing" cómico: seno que sube con vibrato que se apaga
    const tb = t + 0.62;
    const b = osc(s, 'sine', 140 * P, tb, tb + 0.6);
    glide(b.frequency, tb, 110 * P, 330 * P, 0.45);
    const lfo = osc(s, 'sine', 18, tb, tb + 0.6);
    const depth = gain(s, 0);
    depth.gain.setValueAtTime(70 * P, tb);
    depth.gain.exponentialRampToValueAtTime(2, tb + 0.55);
    chain(lfo, depth);
    depth.connect(b.frequency);
    const bg = gain(s, 0);
    ahr(bg.gain, tb, 0.5, 0.005, 0.2, 0.35);
    chain(b, bg, out);
    return tb + 0.6;
  },

  suturePull(s, out, t, { pitch: P, intensity: I }) {
    // "zip": ruido que barre hacia arriba con granulado a 70 Hz
    const dur = 0.16 + 0.08 * I;
    const src = noise(s, 'white', t, t + dur);
    const bp = filt(s, 'bandpass', 1200 * P, 3);
    glide(bp.frequency, t, 1100 * P, 5200 * P, dur);
    const am = gain(s, 0.5);
    const lfo = osc(s, 'square', 70 + 40 * I, t, t + dur);
    const lfoG = gain(s, 0.5);
    chain(lfo, lfoG);
    lfoG.connect(am.gain);
    const g = gain(s, 0);
    ahr(g.gain, t, 0.7, 0.02, dur * 0.5, dur * 0.5);
    chain(src, bp, am, g, out);
    return t + dur + 0.02;
  },

  knot(s, out, t, { pitch: P }) {
    tone(s, out, t, { freq: 3300 * P, peak: 0.35, attack: 0.001, decay: 0.12 });
    tone(s, out, t, { freq: 4950 * P, peak: 0.12, attack: 0.001, decay: 0.06 });
    click(s, out, t, 7000 * P, 0.2, 0.002);
    return t + 0.14;
  },

  alarm(s, out, t, { pitch: P }) {
    // Monitor: dos tonos alternos (alto-bajo) ×3
    const lp = filt(s, 'lowpass', 3200, 0.7);
    lp.connect(out);
    const hi = 988 * P;
    const lo = 784 * P;
    let ti = t;
    for (let i = 0; i < 6; i++) {
      const f = i % 2 ? lo : hi;
      const o = osc(s, 'triangle', f, ti, ti + 0.16);
      const o2 = osc(s, 'square', f, ti, ti + 0.16);
      const g2 = gain(s, 0.18);
      const g = gain(s, 0);
      ahr(g.gain, ti, 0.45, 0.008, 0.12, 0.03);
      o.connect(g);
      chain(o2, g2, g);
      g.connect(lp);
      ti += i % 2 ? 0.26 : 0.18;
    }
    return ti;
  },

  defibCharge(s, out, t, { pitch: P }) {
    const dur = 2;
    const o = osc(s, 'sine', 380 * P, t, t + dur + 0.3);
    glide(o.frequency, t, 380 * P, 3400 * P, dur);
    const o2 = osc(s, 'sawtooth', 190 * P, t, t + dur);
    glide(o2.frequency, t, 190 * P, 1700 * P, dur);
    const lp = filt(s, 'lowpass', 2400, 0.8);
    const g2 = gain(s, 0);
    ahr(g2.gain, t, 0.08, 0.3, dur - 0.4, 0.1);
    chain(o2, lp, g2, out);
    // trémolo que se acelera
    const trem = gain(s, 0.7);
    const lfo = osc(s, 'sine', 6, t, t + dur);
    glide(lfo.frequency, t, 6, 30, dur);
    const lfoG = gain(s, 0.3);
    chain(lfo, lfoG);
    lfoG.connect(trem.gain);
    const g = gain(s, 0);
    ahr(g.gain, t, 0.35, 0.15, dur - 0.2, 0.05);
    chain(o, trem, g, out);
    // "listo": dos pitidos
    tone(s, out, t + dur + 0.02, { type: 'triangle', freq: 1760 * P, peak: 0.3, attack: 0.003, decay: 0.09 });
    tone(s, out, t + dur + 0.16, { type: 'triangle', freq: 1760 * P, peak: 0.3, attack: 0.003, decay: 0.12 });
    return t + dur + 0.3;
  },

  defibShock(s, out, t, { pitch: P }) {
    tone(s, out, t, { freq: 95 * P, to: 32 * P, peak: 1, attack: 0.003, decay: 0.4 });
    noiseHit(s, out, t, { kind: 'brown', type: 'lowpass', freq: 400, q: 0.7, peak: 0.9, decay: 0.25 });
    // zap eléctrico
    const z = osc(s, 'sawtooth', 60 * P, t, t + 0.2);
    const zn = noise(s, 'white', t, t + 0.2);
    const zg = gain(s, 0.6);
    const sh = shaper(s, s.curves.fuzz);
    const hp = filt(s, 'highpass', 900, 0.7);
    const g = gain(s, 0);
    perc(g.gain, t, 0.35, 0.002, 0.18);
    z.connect(zg);
    zn.connect(zg);
    chain(zg, sh, hp, g, out);
    return t + 0.45;
  },

  whip(s, out, t, { pitch: P, intensity: I }) {
    // silbido previo + chasquido seco
    const sw = noise(s, 'white', t, t + 0.12);
    const bp = filt(s, 'bandpass', 700, 2);
    glide(bp.frequency, t, 600 * P, 3200 * P, 0.11);
    const sg = gain(s, 0);
    ahr(sg.gain, t, 0.12, 0.06, 0.02, 0.03);
    chain(sw, bp, sg, out);
    const tc = t + 0.11;
    noiseHit(s, out, tc, { type: 'highpass', freq: 1800 * P, q: 0.8, peak: 0.9 + 0.1 * I, attack: 0.0005, decay: 0.03 });
    noiseHit(s, out, tc, { type: 'bandpass', freq: 4200 * P, q: 1.2, peak: 0.6, attack: 0.0003, decay: 0.012 });
    tone(s, out, tc, { freq: 900 * P, to: 300 * P, peak: 0.15, attack: 0.0005, decay: 0.03 });
    return tc + 0.08;
  },

  praise(s, out, t, { pitch: P }) {
    const notes = [84, 88, 91, 96, 100];
    for (let i = 0; i < notes.length; i++) bell(s, out, t + i * 0.075, midiToHz(notes[i]) * P, 0.28, 0.9);
    // destellos
    for (let i = 0; i < 6; i++) {
      const ti = t + 0.3 + i * 0.06 + s.rand() * 0.03;
      tone(s, out, ti, { freq: (4200 + s.rand() * 2400) * P, peak: 0.05, attack: 0.001, decay: 0.12 });
    }
    return t + 1.3;
  },

  heartFlutter(s, out, t, { pitch: P }) {
    let ti = t;
    let interval = 0.36;
    for (let i = 0; i < 6; i++) {
      heartbeat(s, out, ti, 0.7 * (1 - i * 0.09) * Math.min(1.2, P));
      ti += interval;
      interval *= 1.22;
    }
    return ti;
  },

  uiClick(s, out, t, { pitch: P }) {
    tone(s, out, t, { freq: 950 * P, to: 520 * P, peak: 0.5, attack: 0.001, decay: 0.045 });
    click(s, out, t, 5000 * P, 0.15, 0.003);
    return t + 0.06;
  },

  uiHover(s, out, t, { pitch: P }) {
    return tone(s, out, t, { freq: 1500 * P, to: 1700 * P, peak: 0.18, attack: 0.002, decay: 0.03 });
  },

  uiBuy(s, out, t, { pitch: P }) {
    for (let i = 0; i < 3; i++) {
      const ti = t + i * 0.085;
      tone(s, out, ti, { freq: 1976 * P, peak: 0.25, attack: 0.001, decay: 0.12 });
      tone(s, out, ti + 0.035, { freq: 2637 * P, peak: 0.25, attack: 0.001, decay: 0.25 });
    }
    bell(s, out, t + 0.28, midiToHz(96) * P, 0.25, 0.7);
    bell(s, out, t + 0.28, midiToHz(100) * P, 0.18, 0.7);
    return t + 1;
  },

  uiError(s, out, t, { pitch: P }) {
    const lp = filt(s, 'lowpass', 1400, 0.7);
    lp.connect(out);
    tone(s, lp, t, { type: 'triangle', freq: 233 * P, peak: 0.5, attack: 0.005, decay: 0.1 });
    tone(s, lp, t + 0.12, { type: 'triangle', freq: 185 * P, peak: 0.5, attack: 0.005, decay: 0.16 });
    return t + 0.3;
  },

  perfect(s, out, t, { pitch: P }) {
    const notes = [84, 88, 91, 96, 100];
    for (let i = 0; i < notes.length; i++) {
      const f = midiToHz(notes[i]) * P;
      const ti = t + i * 0.042;
      tone(s, out, ti, { type: 'triangle', freq: f, peak: 0.22, attack: 0.002, decay: 0.35 });
      tone(s, out, ti, { freq: f * 1.005, peak: 0.16, attack: 0.002, decay: 0.45 });
    }
    bell(s, out, t + 0.22, midiToHz(103) * P, 0.12, 0.8);
    return t + 1.05;
  },

  good(s, out, t, { pitch: P }) {
    tone(s, out, t, { freq: 1200 * P, to: 1800 * P, glide: 0.06, peak: 0.3, attack: 0.002, decay: 0.08 });
    return tone(s, out, t + 0.07, { freq: 1600 * P, to: 2400 * P, glide: 0.06, peak: 0.28, attack: 0.002, decay: 0.12 });
  },

  miss(s, out, t, { pitch: P }) {
    tone(s, out, t, { freq: 150 * P, to: 78 * P, peak: 0.7, attack: 0.004, decay: 0.18 });
    noiseHit(s, out, t, { kind: 'pink', type: 'lowpass', freq: 500, q: 0.7, peak: 0.3, decay: 0.08 });
    return t + 0.22;
  },

  rankReveal(s, out, t, { pitch: P }) {
    // redoble de caja en crescendo y sello final
    const rollDur = 1.45;
    let ti = t;
    let k = 0;
    while (ti < t + rollDur) {
      const x = (ti - t) / rollDur;
      const pk = 0.08 + 0.45 * x * x;
      noiseHit(s, out, ti, { type: 'bandpass', freq: 2100, q: 0.9, peak: pk, decay: 0.035 });
      tone(s, out, ti, { type: 'triangle', freq: 190, peak: pk * 0.35, attack: 0.001, decay: 0.03 });
      ti += k % 2 ? 0.034 : 0.03;
      k++;
    }
    const ts = t + rollDur + 0.08;
    tone(s, out, ts, { freq: 110 * P, to: 42 * P, peak: 1, attack: 0.002, decay: 0.45 });
    noiseHit(s, out, ts, { type: 'highpass', freq: 3500, q: 0.6, peak: 0.35, decay: 0.9 });
    noiseHit(s, out, ts, { kind: 'pink', type: 'bandpass', freq: 600, q: 1.2, peak: 0.8, decay: 0.07 });
    tone(s, out, ts, { type: 'triangle', freq: 330 * P, to: 210 * P, peak: 0.4, attack: 0.001, decay: 0.08 });
    return ts + 0.95;
  },

  xray(s, out, t, { pitch: P }) {
    const dur = 0.75;
    const lp = filt(s, 'lowpass', 520, 1.2);
    const g = gain(s, 0);
    ahr(g.gain, t, 0.55, 0.3, dur - 0.35, 0.05);
    chain(lp, g, out);
    for (const [type, f] of [['sawtooth', 60], ['square', 120], ['sawtooth', 180.5]] as const) {
      const o = osc(s, type, f * P, t, t + dur);
      const og = gain(s, type === 'square' ? 0.3 : 0.5);
      chain(o, og, lp);
    }
    tone(s, out, t + 0.1, { freq: 7400 * P, peak: 0.03, attack: 0.2, decay: 0.45 });
    // clunk del relé
    const tc = t + dur;
    tone(s, out, tc, { freq: 130 * P, to: 70 * P, peak: 0.7, attack: 0.002, decay: 0.12 });
    noiseHit(s, out, tc, { type: 'lowpass', freq: 900, q: 1, peak: 0.6, decay: 0.05 });
    click(s, out, tc, 2600, 0.4, 0.004);
    return tc + 0.16;
  },

  kwire(s, out, t, { pitch: P, intensity: I }) {
    click(s, out, t, 6000 * P, 0.5, 0.003);
    return metalPing(s, out, t, 1850 * P, 0.28 + 0.15 * I, 0.22, [1, 2.65, 3.9, 6.1]);
  },

  plateSet(s, out, t, { pitch: P, intensity: I }) {
    noiseHit(s, out, t, { type: 'bandpass', freq: 1500 * P, q: 1.4, peak: 0.6, decay: 0.03 });
    return metalPing(s, out, t, 520 * P, 0.32 + 0.12 * I, 0.55, [1, 2.54, 4.29, 6.67, 8.1]);
  },

  splash(s, out, t, { pitch: P, intensity: I }) {
    const dur = 0.35 + 0.1 * I;
    const src = noise(s, 'pink', t, t + dur);
    const lp = filt(s, 'lowpass', 3000, 1.5);
    glide(lp.frequency, t, 3400 * P, 380 * P, dur);
    const g = gain(s, 0);
    ahr(g.gain, t, 0.9, 0.004, 0.03, dur - 0.04);
    chain(src, lp, g, out);
    for (let i = 0; i < 5; i++) bubble(s, out, t + 0.03 + s.rand() * dur * 0.9, (260 + s.rand() * 380) * P, 0.12, 0.03 + s.rand() * 0.04);
    return t + dur + 0.08;
  },

  slurpFinish(s, out, t, { pitch: P }) {
    // sorbo de pajita al vaciar: silbido que sube, gorgoteo y corte seco
    const dur = 0.5;
    const src = noise(s, 'white', t, t + dur);
    const bp = filt(s, 'bandpass', 700, 6);
    glide(bp.frequency, t, 650 * P, 2300 * P, dur);
    const am = gain(s, 0.6);
    const lfo = osc(s, 'square', 22, t, t + dur);
    glide(lfo.frequency, t, 14, 38, dur);
    const lfoG = gain(s, 0.4);
    chain(lfo, lfoG);
    lfoG.connect(am.gain);
    const g = gain(s, 0);
    g.gain.setValueAtTime(EPS, t);
    g.gain.linearRampToValueAtTime(0.8, t + 0.05);
    g.gain.setValueAtTime(0.8, t + dur - 0.015);
    g.gain.linearRampToValueAtTime(0, t + dur);
    chain(src, bp, am, g, out);
    for (let i = 0; i < 6; i++) bubble(s, out, t + i * 0.07 + s.rand() * 0.03, (300 + i * 60) * P, 0.1, 0.035);
    tone(s, out, t + dur, { freq: 2400 * P, to: 3200 * P, peak: 0.12, attack: 0.002, decay: 0.04 });
    return t + dur + 0.06;
  },

  panchitoBark(s, out, t, { pitch: P, intensity: I }) {
    const yap = (ti: number, amp: number, f: number) => {
      const o = osc(s, 'sawtooth', f, ti, ti + 0.13);
      o.frequency.setValueAtTime(f * 0.85, ti);
      o.frequency.linearRampToValueAtTime(f * 1.35, ti + 0.035);
      o.frequency.exponentialRampToValueAtTime(f * 0.8, ti + 0.12);
      const g = gain(s, 0);
      ahr(g.gain, ti, amp, 0.008, 0.04, 0.07);
      o.connect(g);
      const mix = gain(s, 1);
      formants(s, g, mix, [1100 * P, 2000 * P, 3100 * P], 6);
      mix.connect(out);
      noiseHit(s, out, ti, { type: 'bandpass', freq: 2600 * P, q: 1, peak: amp * 0.15, decay: 0.05 });
    };
    yap(t, 1, 780 * P);
    if (I > 0.35) yap(t + 0.17, 0.7, 860 * P);
    if (I > 0.75) yap(t + 0.32, 0.8, 820 * P);
    return t + (I > 0.75 ? 0.47 : I > 0.35 ? 0.32 : 0.15);
  },

  hortensiaScream(s, out, t, { pitch: P }) {
    // Grito operístico cómico: "¡AAAAH-ooo!" con vibrato creciente y caída final
    const dur = 1.6;
    const f0 = 880 * P;
    const src = osc(s, 'sawtooth', f0, t, t + dur);
    src.frequency.setValueAtTime(f0 * 0.9, t);
    src.frequency.linearRampToValueAtTime(f0 * 1.12, t + 0.35);
    src.frequency.setValueAtTime(f0 * 1.12, t + 1.1);
    src.frequency.exponentialRampToValueAtTime(f0 * 0.62, t + dur);
    const tri = osc(s, 'triangle', f0 * 2, t, t + dur);
    const vib = osc(s, 'sine', 6.2, t, t + dur);
    const vibDepth = gain(s, 0);
    vibDepth.gain.setValueAtTime(10, t);
    vibDepth.gain.linearRampToValueAtTime(90, t + 1.2);
    chain(vib, vibDepth);
    vibDepth.connect(src.detune);
    vibDepth.connect(tri.detune);
    const pre = gain(s, 0);
    ahr(pre.gain, t, 0.9, 0.12, dur - 0.45, 0.33);
    src.connect(pre);
    const tg = gain(s, 0.25);
    chain(tri, tg, pre);
    const mix = gain(s, 1);
    formants(s, pre, mix, [950, 1450, 2850], 7);
    // "oo" final: los formantes se cierran
    const lp = filt(s, 'lowpass', 5000, 0.7);
    lp.frequency.setValueAtTime(5000, t + 1.05);
    lp.frequency.exponentialRampToValueAtTime(900, t + dur);
    chain(mix, lp, out);
    return t + dur + 0.02;
  },

  doorClose(s, out, t, { pitch: P }) {
    tone(s, out, t, { freq: 85 * P, to: 48 * P, peak: 0.9, attack: 0.004, decay: 0.3 });
    noiseHit(s, out, t, { kind: 'brown', type: 'lowpass', freq: 320, q: 0.8, peak: 0.9, decay: 0.2 });
    const tl = t + 0.085;
    click(s, out, tl, 3000 * P, 0.5, 0.006);
    metalPing(s, out, tl, 2100 * P, 0.12, 0.1, [1, 2.7]);
    return t + 0.36;
  },

  autoclave(s, out, t, { pitch: P }) {
    const dur = 1.5;
    const src = noise(s, 'white', t, t + dur);
    const hp = filt(s, 'highpass', 2600, 0.7);
    const pk = filt(s, 'peaking', 6500, 1, 5);
    const g = gain(s, 0);
    g.gain.setValueAtTime(EPS, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.2);
    g.gain.setValueAtTime(0.5, t + 1.0);
    g.gain.exponentialRampToValueAtTime(EPS, t + dur);
    chain(src, hp, pk, g, out);
    for (let i = 0; i < 3; i++) tone(s, out, t + dur + 0.05 + i * 0.16, { type: 'square', freq: 1500 * P, peak: 0.12, attack: 0.003, decay: 0.09 });
    return t + dur + 0.6;
  },

  phone(s, out, t, { pitch: P }) {
    // Melodía de timbre original, marimba brillante, dos veces
    const mel = [84, 88, 91, 88, 93, 91, 88, 84];
    const step = 0.11;
    let end = t;
    for (let r = 0; r < 2; r++) {
      for (let i = 0; i < mel.length; i++) {
        const ti = t + (r * (mel.length + 3) + i) * step;
        const f = midiToHz(mel[i]) * P;
        tone(s, out, ti, { freq: f, peak: 0.3, attack: 0.002, decay: 0.16 });
        end = tone(s, out, ti, { freq: f * 4, peak: 0.08, attack: 0.001, decay: 0.04 });
      }
    }
    return end + 0.15;
  },

  camera(s, out, t, { pitch: P }) {
    click(s, out, t, 4200 * P, 0.7, 0.005);
    noiseHit(s, out, t + 0.012, { type: 'bandpass', freq: 1800 * P, q: 0.8, peak: 0.25, attack: 0.004, decay: 0.04 });
    click(s, out, t + 0.07, 3200 * P, 0.6, 0.006);
    tone(s, out, t + 0.07, { freq: 900 * P, peak: 0.08, attack: 0.001, decay: 0.03 });
    return t + 0.12;
  },

  faint(s, out, t, { pitch: P }) {
    // silbato de émbolo hacia abajo + golpecito
    const dur = 0.95;
    const o = osc(s, 'sine', 1600 * P, t, t + dur);
    glide(o.frequency, t, 1650 * P, 260 * P, dur);
    const vib = osc(s, 'sine', 7, t, t + dur);
    const vd = gain(s, 25);
    chain(vib, vd);
    vd.connect(o.detune);
    const breath = noise(s, 'white', t, t + dur);
    const bp = filt(s, 'bandpass', 1500 * P, 4);
    glide(bp.frequency, t, 1650 * P, 280 * P, dur);
    const bg = gain(s, 0.08);
    chain(breath, bp, bg);
    const g = gain(s, 0);
    ahr(g.gain, t, 0.4, 0.04, dur - 0.14, 0.1);
    o.connect(g);
    bg.connect(g);
    g.connect(out);
    tone(s, out, t + dur + 0.05, { freq: 120, to: 60, peak: 0.5, attack: 0.003, decay: 0.15 });
    noiseHit(s, out, t + dur + 0.05, { kind: 'brown', type: 'lowpass', freq: 400, peak: 0.4, decay: 0.1 });
    return t + dur + 0.22;
  },

  coins(s, out, t, { pitch: P, intensity: I }) {
    const n = 4 + Math.round(3 * I);
    let end = t;
    for (let i = 0; i < n; i++) {
      const ti = t + i * 0.05 + s.rand() * 0.04;
      const f = (2200 + s.rand() * 1500) * P;
      tone(s, out, ti, { freq: f, peak: 0.2, attack: 0.001, decay: 0.12 });
      end = tone(s, out, ti + 0.004, { freq: f * 1.34, peak: 0.16, attack: 0.001, decay: 0.2 });
    }
    return end;
  },

  guitarRiff(s, out, t, { pitch: P }) {
    // Riff grunge corto a 110 BPM (corcheas), en Mi
    const e8 = 60 / 110 / 2;
    const base = 40 + Math.round(12 * Math.log2(P));
    const riff: Array<[number, number, number, boolean]> = [
      // [corchea, semitonos, duración en corcheas, silenciado]
      [0, 0, 1, true],
      [1, 0, 1, true],
      [2, 3, 1.5, false],
      [4, 5, 1, false],
      [5, 0, 1, true],
      [6, 6, 0.5, false],
      [6.5, 5, 1.5, false],
      [8, 0, 2.5, false],
    ];
    let end = t;
    for (const [pos, semi, len, mute] of riff) {
      end = Math.max(end, powerChord(s, out, t + pos * e8, base + semi, len * e8 * 0.95, mute ? 0.5 : 0.6, mute));
    }
    return end + 0.1;
  },

  compress(s, out, t, { pitch: P, intensity: I }) {
    tone(s, out, t, { freq: 115 * P, to: 58 * P, peak: 0.5 + 0.3 * I, attack: 0.004, decay: 0.12 });
    noiseHit(s, out, t, { kind: 'pink', type: 'lowpass', freq: 380, q: 0.7, peak: 0.35, decay: 0.07 });
    return t + 0.15;
  },

  bag(s, out, t, { pitch: P }) {
    const dur = 0.55;
    const src = noise(s, 'pink', t, t + dur);
    const bp = filt(s, 'bandpass', 800 * P, 0.8);
    glide(bp.frequency, t, 650 * P, 1100 * P, 0.25);
    const g = gain(s, 0);
    ahr(g.gain, t, 0.6, 0.1, 0.1, dur - 0.2);
    chain(src, bp, g, out);
    tone(s, out, t + 0.05, { type: 'triangle', freq: 310 * P, to: 360 * P, peak: 0.06, attack: 0.03, decay: 0.2 });
    return t + dur;
  },

  footstep(s, out, t, { pitch: P, intensity: I }) {
    const v = 0.9 + s.rand() * 0.2;
    noiseHit(s, out, t, { kind: 'brown', type: 'lowpass', freq: 520 * P * v, q: 1, peak: 0.7 + 0.3 * I, attack: 0.003, decay: 0.06 });
    tone(s, out, t, { freq: 95 * v, to: 60, peak: 0.3, attack: 0.002, decay: 0.05 });
    click(s, out, t + 0.012, 2400 * v * P, 0.08, 0.004);
    return t + 0.09;
  },

  bendPlate(s, out, t, { pitch: P, intensity: I }) {
    // crujido metálico: tren de pulsos por un resonador que deriva
    const dur = 0.6 + 0.2 * I;
    const o = osc(s, 'sawtooth', 70 * P, t, t + dur);
    o.frequency.setValueAtTime(55 * P, t);
    for (let k = 1; k < 8; k++) o.frequency.linearRampToValueAtTime((55 + k * 9 + s.rand() * 25) * P, t + (dur * k) / 8);
    const bp = filt(s, 'bandpass', 1300 * P, 14);
    glide(bp.frequency, t, 1100 * P, 1700 * P, dur);
    const bp2 = filt(s, 'bandpass', 2900 * P, 10);
    const g = gain(s, 0);
    ahr(g.gain, t, 0.9, 0.05, dur - 0.15, 0.1);
    o.connect(bp);
    o.connect(bp2);
    bp.connect(g);
    bp2.connect(g);
    g.connect(out);
    metalPing(s, out, t + dur - 0.05, 780 * P, 0.1, 0.4);
    return t + dur + 0.35;
  },

  tick(s, out, t, { pitch: P }) {
    tone(s, out, t, { type: 'square', freq: 2900 * P, peak: 0.12, attack: 0.0008, decay: 0.012 });
    return click(s, out, t, 5000 * P, 0.25, 0.003);
  },
};

const base: SfxMeta = { bus: 'sfx', gain: 1, reverb: 0.1, minGap: 0.03 };
const m = (o: Partial<SfxMeta>): SfxMeta => ({ ...base, ...o });

/**
 * Mezcla por efecto. Ganancias calibradas con render offline (dev/audio.html → «Calibrar»):
 * RMS en ventana de 50 ms ≈ −16 dB golpes quirúrgicos, −22..−26 detalles, −27..−35 interfaz.
 */
export const SFX_META: Record<SfxName, SfxMeta> = {
  squelch: m({ gain: 1.0, reverb: 0.12 }),
  crunch: m({ gain: 1.4, reverb: 0.08 }),
  boneClonk: m({ gain: 0.6, reverb: 0.18 }),
  retractorClick: m({ gain: 1.05, reverb: 0.12 }),
  screwThread: m({ gain: 1.95, minGap: 0.1 }),
  torqueClick: m({ gain: 1.1 }),
  screwDrop: m({ gain: 0.67, reverb: 0.25 }),
  contaminated: m({ gain: 0.46, reverb: 0.08, minGap: 0.4 }),
  suturePull: m({ gain: 1.4 }),
  knot: m({ gain: 0.6 }),
  alarm: m({ gain: 0.47, reverb: 0.1, minGap: 0.9, duck: 0.35 }),
  defibCharge: m({ gain: 0.65, minGap: 0.5, duck: 0.3 }),
  defibShock: m({ gain: 0.63, reverb: 0.2, minGap: 0.3, duck: 0.25 }),
  whip: m({ gain: 0.75, reverb: 0.25 }),
  praise: m({ gain: 0.6, reverb: 0.3, minGap: 0.2 }),
  heartFlutter: m({ gain: 0.56, reverb: 0.05, minGap: 0.5 }),
  uiClick: m({ gain: 0.53, reverb: 0.04 }),
  uiHover: m({ gain: 0.6, reverb: 0.02, minGap: 0.05 }),
  uiBuy: m({ gain: 0.45, reverb: 0.2 }),
  uiError: m({ gain: 0.45, reverb: 0.05 }),
  perfect: m({ gain: 0.74, reverb: 0.3 }),
  good: m({ gain: 0.82, reverb: 0.2 }),
  miss: m({ gain: 0.42, reverb: 0.05 }),
  rankReveal: m({ gain: 0.54, reverb: 0.3, minGap: 1, duck: 0.4 }),
  xray: m({ gain: 0.43, reverb: 0.1, minGap: 0.3 }),
  kwire: m({ gain: 0.6, reverb: 0.15 }),
  plateSet: m({ gain: 0.68, reverb: 0.25 }),
  splash: m({ gain: 0.71, reverb: 0.15 }),
  slurpFinish: m({ gain: 1.6, reverb: 0.1, minGap: 0.3 }),
  panchitoBark: m({ bus: 'voice', gain: 0.6, reverb: 0.2, minGap: 0.12 }),
  hortensiaScream: m({ bus: 'voice', gain: 0.31, reverb: 0.35, minGap: 1 }),
  doorClose: m({ gain: 0.5, reverb: 0.3 }),
  autoclave: m({ gain: 0.3, reverb: 0.2, minGap: 0.5 }),
  phone: m({ gain: 0.8, reverb: 0.15, minGap: 1 }),
  camera: m({ gain: 2.4, reverb: 0.1 }),
  faint: m({ gain: 0.44, reverb: 0.2, minGap: 0.5 }),
  coins: m({ gain: 0.8, reverb: 0.2 }),
  guitarRiff: m({ gain: 0.33, reverb: 0.2, minGap: 1 }),
  compress: m({ gain: 0.56, reverb: 0.05, minGap: 0.08 }),
  bag: m({ gain: 1.3, reverb: 0.1, minGap: 0.2 }),
  footstep: m({ gain: 0.6, reverb: 0.1, minGap: 0.06 }),
  bendPlate: m({ gain: 1.75, reverb: 0.2, minGap: 0.2 }),
  tick: m({ gain: 1.9, reverb: 0.05, minGap: 0.02 }),
};

export const SFX_NAMES = Object.keys(SFX) as SfxName[];
