/**
 * Instrumentos de la música procedural. Cada llamada programa una nota en `t`
 * sobre la salida del tema. Volúmenes suaves: la música acompaña, no molesta.
 */
import { midiToHz } from './dsp';
import { EPS, ahr, chain, filt, gain, glide, noise, noiseHit, osc, perc, shaper, tone, type Synth } from './synth';

export type Kit = ReturnType<typeof createKit>;

export function createKit(s: Synth, out: AudioNode) {
  const hz = midiToHz;

  /** Pad de varias voces desafinadas con filtro y envolvente lenta. */
  function padVoices(t: number, midis: readonly number[], dur: number, v: number, o: { wave: OscillatorType; cutoff: number; det: readonly number[]; attack: number; release: number; q?: number }) {
    const lp = filt(s, 'lowpass', o.cutoff, o.q ?? 0.6);
    const g = gain(s, 0);
    const hold = Math.max(0.01, dur - o.attack);
    ahr(g.gain, t, v, o.attack, hold, o.release);
    chain(lp, g, out);
    const end = t + dur + o.release + 0.05;
    const per = 1 / Math.sqrt(midis.length * o.det.length);
    for (const m of midis) {
      for (const d of o.det) {
        const x = osc(s, o.wave, hz(m), t, end);
        x.detune.value = d;
        const xg = gain(s, per);
        chain(x, xg, lp);
      }
    }
    return { lp, g, end };
  }

  return {
    kick(t: number, v = 1) {
      tone(s, out, t, { freq: 140, to: 44, glide: 0.11, peak: 0.55 * v, attack: 0.002, decay: 0.28 });
    },
    snare(t: number, v = 1) {
      noiseHit(s, out, t, { type: 'bandpass', freq: 1900, q: 0.8, peak: 0.22 * v, decay: 0.12 });
      tone(s, out, t, { type: 'triangle', freq: 200, to: 160, peak: 0.12 * v, attack: 0.001, decay: 0.07 });
    },
    rim(t: number, v = 1) {
      tone(s, out, t, { type: 'square', freq: 1650, peak: 0.05 * v, attack: 0.0005, decay: 0.02 });
      noiseHit(s, out, t, { type: 'bandpass', freq: 3200, q: 3, peak: 0.1 * v, decay: 0.015 });
    },
    clap(t: number, v = 1) {
      for (let i = 0; i < 3; i++) noiseHit(s, out, t + i * 0.011, { type: 'bandpass', freq: 1400, q: 1.1, peak: 0.13 * v, decay: i === 2 ? 0.1 : 0.012 });
    },
    hat(t: number, v = 1, open = false) {
      noiseHit(s, out, t, { type: 'highpass', freq: 7200, q: 0.7, peak: 0.07 * v, decay: open ? 0.16 : 0.035 });
    },
    shaker(t: number, v = 1) {
      noiseHit(s, out, t, { type: 'bandpass', freq: 6200, q: 1.2, peak: 0.06 * v, attack: 0.012, decay: 0.05 });
    },
    woodblock(t: number, v = 1, hi = true) {
      const f = hi ? 1250 : 900;
      tone(s, out, t, { freq: f, peak: 0.12 * v, attack: 0.001, decay: 0.05 });
      noiseHit(s, out, t, { type: 'bandpass', freq: f * 1.8, q: 5, peak: 0.08 * v, decay: 0.02 });
    },
    tom(t: number, v = 1, f = 110) {
      tone(s, out, t, { freq: f * 1.5, to: f, glide: 0.08, peak: 0.35 * v, attack: 0.002, decay: 0.32 });
      noiseHit(s, out, t, { kind: 'pink', type: 'lowpass', freq: 800, peak: 0.08 * v, decay: 0.05 });
    },
    crackle(t: number, v = 1) {
      noiseHit(s, out, t, { type: 'highpass', freq: 3000 + s.rand() * 4000, q: 0.7, peak: (0.02 + 0.04 * s.rand()) * v, attack: 0.0003, decay: 0.002 });
    },
    /** Pulsación tipo ukelele: diente de sierra con filtro que se cierra rápido. */
    pluck(t: number, midi: number, v = 1, dur = 0.5) {
      const f = hz(midi);
      const end = t + dur + 0.05;
      const o1 = osc(s, 'sawtooth', f, t, end);
      const o2 = osc(s, 'triangle', f * 2, t, end);
      o2.detune.value = 4;
      const lp = filt(s, 'lowpass', 3000, 2);
      lp.frequency.setValueAtTime(Math.min(9000, f * 9), t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(200, f * 1.3), t + 0.22);
      const g = gain(s, 0);
      perc(g.gain, t, 0.11 * v, 0.003, dur);
      const o2g = gain(s, 0.4);
      o1.connect(lp);
      chain(o2, o2g, lp);
      chain(lp, g, out);
    },
    /** Glockenspiel: parciales de campana. */
    glock(t: number, midi: number, v = 1, decay = 1.1) {
      const f = hz(midi);
      tone(s, out, t, { freq: f, peak: 0.1 * v, attack: 0.001, decay });
      tone(s, out, t, { freq: f * 2.76, peak: 0.03 * v, attack: 0.001, decay: decay * 0.3 });
      tone(s, out, t, { freq: f * 5.4, peak: 0.012 * v, attack: 0.001, decay: decay * 0.12 });
    },
    pad(t: number, midis: readonly number[], dur: number, v = 1, cutoff = 1400) {
      padVoices(t, midis, dur, 0.1 * v, { wave: 'triangle', cutoff, det: [-8, 8], attack: Math.min(1.2, dur * 0.4), release: 1.2 });
    },
    /** Pad brillante de sierra (electrónica pastel). */
    padSaw(t: number, midis: readonly number[], dur: number, v = 1, cutoff = 1100) {
      padVoices(t, midis, dur, 0.07 * v, { wave: 'sawtooth', cutoff, det: [-10, 0, 10], attack: Math.min(0.5, dur * 0.3), release: 0.8 });
    },
    /** Cuerdas tensas: sierras desafinadas con paso bajo y crescendo. */
    strings(t: number, midis: readonly number[], dur: number, v = 1, cutoff = 1100) {
      const { lp } = padVoices(t, midis, dur, 0.08 * v, { wave: 'sawtooth', cutoff: cutoff * 0.6, det: [-14, 0, 13], attack: dur * 0.6, release: 0.6, q: 1.2 });
      lp.frequency.setValueAtTime(cutoff * 0.6, t);
      lp.frequency.linearRampToValueAtTime(cutoff * 1.2, t + dur);
    },
    /** Coro "aah" kawaii: sierras con vibrato a través de formantes. */
    choir(t: number, midis: readonly number[], dur: number, v = 1) {
      const end = t + dur + 1;
      const mix = gain(s, 1);
      const g = gain(s, 0);
      ahr(g.gain, t, 0.12 * v, Math.min(0.6, dur * 0.3), Math.max(0.01, dur - 0.6), 0.9);
      const fm: Array<[number, number, number]> = [
        [800, 6, 1],
        [1150, 8, 0.55],
        [2900, 10, 0.3],
      ];
      for (const [f, q, a] of fm) {
        const bp = filt(s, 'bandpass', f, q);
        const ag = gain(s, a);
        mix.connect(bp);
        chain(bp, ag, g);
      }
      g.connect(out);
      const vib = osc(s, 'sine', 5.2, t, end);
      const vd = gain(s, 14);
      chain(vib, vd);
      for (const m of midis) {
        for (const d of [-6, 7]) {
          const x = osc(s, 'sawtooth', hz(m), t, end);
          x.detune.value = d;
          vd.connect(x.detune);
          const xg = gain(s, 0.5);
          chain(x, xg, mix);
        }
      }
    },
    bass(t: number, midi: number, dur: number, v = 1, cutoff = 650) {
      const f = hz(midi);
      const end = t + dur + 0.08;
      const o1 = osc(s, 'sawtooth', f, t, end);
      const o2 = osc(s, 'sine', f, t, end);
      const lp = filt(s, 'lowpass', cutoff, 3);
      lp.frequency.setValueAtTime(cutoff * 2, t);
      lp.frequency.exponentialRampToValueAtTime(cutoff, t + 0.08);
      const g = gain(s, 0);
      ahr(g.gain, t, 0.2 * v, 0.006, Math.max(0.01, dur - 0.06), 0.06);
      const o2g = gain(s, 0.8);
      o1.connect(lp);
      chain(o2, o2g, lp);
      chain(lp, g, out);
    },
    sub(t: number, midi: number, dur: number, v = 1) {
      const end = t + dur + 0.3;
      const o = osc(s, 'sine', hz(midi), t, end);
      const g = gain(s, 0);
      ahr(g.gain, t, 0.16 * v, 0.05, Math.max(0.01, dur - 0.1), 0.3);
      chain(o, g, out);
    },
    /** Arpegio de onda triangular/cuadrada con filtro. */
    arp(t: number, midi: number, dur: number, v = 1, cutoff = 2400) {
      const f = hz(midi);
      const end = t + dur + 0.12;
      const o1 = osc(s, 'triangle', f, t, end);
      const o2 = osc(s, 'square', f, t, end);
      o2.detune.value = 6;
      const lp = filt(s, 'lowpass', cutoff, 1.5);
      const g = gain(s, 0);
      perc(g.gain, t, 0.07 * v, 0.004, dur + 0.1);
      const o2g = gain(s, 0.22);
      o1.connect(lp);
      chain(o2, o2g, lp);
      chain(lp, g, out);
    },
    /** Acorde de quinta distorsionado (guitarra grunge). */
    stab(t: number, rootMidi: number, dur: number, v = 1, mute = false) {
      const pre = gain(s, 0.45);
      const sh = shaper(s, s.curves.fuzz, 'none');
      const cab = filt(s, 'lowpass', mute ? 1200 : 2800, 0.9);
      const g = gain(s, 0);
      const rel = mute ? 0.05 : 0.14;
      ahr(g.gain, t, 0.09 * v, 0.004, Math.max(0.01, dur - rel), rel);
      chain(pre, sh, cab, g, out);
      const end = t + dur + 0.05;
      for (const m of [rootMidi, rootMidi + 7, rootMidi + 12]) {
        for (const d of [-8, 9]) {
          const x = osc(s, 'sawtooth', hz(m), t, end);
          x.detune.value = d;
          x.connect(pre);
        }
      }
    },
    /** Timbal/redoble suave. */
    roll(t: number, dur: number, v = 1, f = 70) {
      const src = noise(s, 'brown', t, t + dur + 0.1);
      const bp = filt(s, 'bandpass', f * 2, 1.5);
      const g = gain(s, 0);
      g.gain.setValueAtTime(EPS, t);
      g.gain.exponentialRampToValueAtTime(0.35 * v, t + dur);
      g.gain.exponentialRampToValueAtTime(EPS, t + dur + 0.1);
      chain(src, bp, g, out);
      const o = osc(s, 'sine', f, t, t + dur + 0.6);
      const og = gain(s, 0);
      og.gain.setValueAtTime(EPS, t);
      og.gain.exponentialRampToValueAtTime(0.25 * v, t + dur);
      og.gain.exponentialRampToValueAtTime(EPS, t + dur + 0.55);
      glide(o.frequency, t + dur, f, f * 0.8, 0.5);
      chain(o, og, out);
    },
  };
}
