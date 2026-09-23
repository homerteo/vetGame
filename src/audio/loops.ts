/**
 * Bucles ASMR del instrumental (GDD §9). Cada bucle expone parámetros 0..1
 * (rate, load, wet, intensity), entra y sale con fundido sin clics y programa
 * microeventos (chispas, burbujas, crujidos) desde `tick` con anticipación.
 */
import type { LoopSfxName } from '../core/contracts';
import { EPS, chain, filt, gain, holdParam, shaper, type NoiseKind, type Synth } from './synth';

export type LoopParam = 'rate' | 'load' | 'wet' | 'intensity';
export type LoopParams = Record<LoopParam, number>;

export interface LoopImpl {
  readonly params: LoopParams;
  /** Traslada los parámetros a los nodos (suavizado). */
  apply(now: number): void;
  /** Programa microeventos hasta `horizon`. */
  tick(now: number, horizon: number): void;
  /** Fundido de salida; devuelve el instante en que ya está en silencio. */
  stop(now: number): number;
  /** Desconecta todo (tras `stop`). */
  dispose(): void;
  readonly stopped: boolean;
}

export type LoopFactory = (s: Synth, out: AudioNode, now: number) => LoopImpl;

export const DEFAULT_LOOP_PARAMS: Readonly<LoopParams> = { rate: 0.5, load: 0, wet: 0, intensity: 0.5 };

const FADE_IN = 0.08;

/** Nivel de cada bucle (calibrado por RMS offline con parámetros medios). */
export const LOOP_LEVEL: Record<LoopSfxName, number> = {
  scalpel: 1.8,
  cautery: 1,
  suction: 1.3,
  drill: 0.57,
  saw: 1.4,
  burr: 1.2,
  clipper: 1.4,
  bandage: 2.5,
};
const FADE_OUT_TC = 0.03;
const SMOOTH_TC = 0.04;

/**
 * Canal de impulsos: fuente y filtro/oscilador persistentes; cada evento es solo
 * automatización de ganancia (y de frecuencia), sin crear nodos. Los eventos que se
 * solaparían con el anterior se descartan (así la cola nunca se adelanta al tiempo real).
 */
function spikeChannel(gp: AudioParam, fp: AudioParam) {
  let busy = 0;
  return {
    hit(t: number, peak: number, attack: number, decay: number, f0?: number, f1?: number) {
      if (t < busy) {
        if (busy - t > 0.004) return;
        t = busy;
      }
      const end = t + attack + decay;
      gp.setValueAtTime(EPS, t);
      gp.linearRampToValueAtTime(Math.max(EPS, peak), t + attack);
      gp.exponentialRampToValueAtTime(EPS, end);
      if (f0 !== undefined) {
        fp.setValueAtTime(Math.max(EPS, f0), t);
        if (f1 !== undefined) fp.exponentialRampToValueAtTime(Math.max(EPS, f1), end);
      }
      busy = end + 0.0005;
    },
  };
}

/** Base común: fundidos, fuentes abiertas y flujos de eventos de Poisson. */
function base(s: Synth, out: AudioNode, now: number, level: number) {
  const sources: AudioScheduledSourceNode[] = [];
  const vol = s.ctx.createGain();
  vol.gain.setValueAtTime(0, now);
  vol.gain.linearRampToValueAtTime(level, now + FADE_IN);
  vol.connect(out);
  const params: LoopParams = { ...DEFAULT_LOOP_PARAMS };
  let first = true;
  let stopped = false;

  const b = {
    vol,
    params,
    get stopped() {
      return stopped;
    },
    noise(kind: NoiseKind, rate = 1) {
      const src = s.ctx.createBufferSource();
      src.buffer = s.buffers[kind];
      src.loop = true;
      src.playbackRate.value = rate;
      src.start(now, s.rand() * 1.8);
      sources.push(src);
      return src;
    },
    osc(type: OscillatorType, freq: number) {
      const o = s.ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.start(now);
      sources.push(o);
      return o;
    },
    /** Impulsos de ruido filtrado (chispas, granos, crujidos). */
    noiseSpikes(kind: NoiseKind, type: BiquadFilterType, freq: number, q: number, dest: AudioNode = vol) {
      const f = filt(s, type, freq, q);
      const g = s.ctx.createGain();
      g.gain.value = 0;
      chain(b.noise(kind), f, g, dest);
      return spikeChannel(g.gain, f.frequency);
    },
    /** Impulsos tonales con glissando (burbujas, "pops"). */
    toneSpikes(type: OscillatorType, dest: AudioNode = vol) {
      const o = b.osc(type, 300);
      const g = s.ctx.createGain();
      g.gain.value = 0;
      chain(o, g, dest);
      return spikeChannel(g.gain, o.frequency);
    },
    /** Lleva un parámetro a `v` con suavizado (la primera vez, de golpe). */
    smooth(p: AudioParam, v: number, t: number, tc = SMOOTH_TC) {
      if (first) p.setValueAtTime(v, t);
      else p.setTargetAtTime(v, t, tc);
    },
    endFirst() {
      first = false;
    },
    /** Flujo de eventos de Poisson con densidad variable (eventos/s). */
    stream(density: () => number, fire: (t: number) => void) {
      let next = -1;
      return (t: number, horizon: number) => {
        const d = density();
        if (!(d > 0.05)) {
          next = -1;
          return;
        }
        if (next < t) next = t + s.rand() / d;
        let guard = 0;
        while (next < horizon && guard++ < 64) {
          fire(next);
          next += -Math.log(1 - s.rand() * 0.999) / d;
        }
      };
    },
    stop(t: number) {
      if (stopped) return t;
      stopped = true;
      holdParam(vol.gain, t);
      vol.gain.setTargetAtTime(0, t, FADE_OUT_TC);
      const end = t + FADE_OUT_TC * 8;
      for (const src of sources) {
        try {
          src.stop(end + 0.02);
        } catch {
          // ya parado
        }
      }
      return end + 0.03;
    },
    dispose() {
      try {
        vol.disconnect();
      } catch {
        // ya desconectado
      }
    },
  };
  return b;
}

type Base = ReturnType<typeof base>;

function finish(b: Base, apply: (now: number) => void, tick: (now: number, h: number) => void, now: number): LoopImpl {
  apply(now);
  b.endFirst();
  return {
    params: b.params,
    apply(t) {
      if (!b.stopped) apply(t);
    },
    tick(t, h) {
      if (!b.stopped) tick(t, h);
    },
    stop: (t) => b.stop(t),
    dispose: () => b.dispose(),
    get stopped() {
      return b.stopped;
    },
  };
}

export const LOOPS: Record<LoopSfxName, LoopFactory> = {
  /** "sssk": ruido en banda granulado; rate → brillo y volumen; load → capas duras con "pop". */
  scalpel(s, out, now) {
    const b = base(s, out, now, LOOP_LEVEL.scalpel);
    const p = b.params;
    const bp = filt(s, 'bandpass', 3000, 1.3);
    const hs = filt(s, 'highshelf', 7000, 0.7, -6);
    const body = gain(s, 0);
    chain(b.noise('white'), bp, hs, body, b.vol);
    const wetLp = filt(s, 'lowpass', 700, 1.5);
    const wetG = gain(s, 0);
    chain(b.noise('pink'), wetLp, wetG, b.vol);
    const grainCh = b.noiseSpikes('white', 'bandpass', 3000, 2.2);
    const popTone = b.toneSpikes('sine');
    const popClick = b.noiseSpikes('white', 'highpass', 2500, 0.7);
    const squishCh = b.toneSpikes('sine');
    const grains = b.stream(
      () => (p.rate > 0.03 ? 10 + 45 * p.rate : 0),
      (t) =>
        grainCh.hit(
          t,
          (0.12 + 0.3 * p.rate) * (0.5 + 0.5 * p.intensity),
          0.001,
          0.01 + 0.03 * s.rand(),
          (2400 + 3600 * p.rate) * (1 - 0.3 * p.load) * (0.85 + 0.3 * s.rand()),
        ),
    );
    const pops = b.stream(
      () => (p.load > 0.45 ? (p.load - 0.45) * 14 * (0.3 + p.rate) : 0),
      (t) => {
        popTone.hit(t, 0.25, 0.001, 0.03, 420, 160);
        popClick.hit(t, 0.2, 0.001, 0.004);
      },
    );
    const squish = b.stream(
      () => p.wet * 6 * p.rate,
      (t) => squishCh.hit(t, 0.08, 0.002, 0.04, 240 + s.rand() * 200, 520),
    );
    const apply = (t: number) => {
      b.smooth(bp.frequency, (2200 + 3800 * p.rate) * (1 - 0.35 * p.load), t);
      b.smooth(body.gain, (0.04 + 0.3 * p.rate) * (0.55 + 0.45 * p.intensity), t);
      b.smooth(wetG.gain, p.wet * 0.25 * (0.2 + p.rate), t);
    };
    return finish(b, apply, (t, h) => {
      grains(t, h);
      pops(t, h);
      squish(t, h);
    }, now);
  },

  /** "tzzzt": zumbido de 120 Hz + chispas; por encima de 0,9 de intensidad, crujido a quemado. */
  cautery(s, out, now) {
    const b = base(s, out, now, LOOP_LEVEL.cautery);
    const p = b.params;
    const mix = gain(s, 1);
    const saw = b.osc('sawtooth', 120);
    const sqr = b.osc('square', 240);
    const sqrG = gain(s, 0.35);
    saw.connect(mix);
    chain(sqr, sqrG, mix);
    const drive = gain(s, 1);
    const sh = shaper(s, s.curves.warm);
    const bp = filt(s, 'bandpass', 1500, 0.9);
    const buzzG = gain(s, 0);
    chain(mix, drive, sh, bp, buzzG, b.vol);
    const hum = b.osc('sine', 120);
    const humG = gain(s, 0);
    chain(hum, humG, b.vol);
    const sizzleBp = filt(s, 'bandpass', 900, 0.8);
    const sizzleG = gain(s, 0);
    chain(b.noise('pink'), sizzleBp, sizzleG, b.vol);
    const steamHp = filt(s, 'highpass', 4200, 0.7);
    const steamG = gain(s, 0);
    chain(b.noise('white'), steamHp, steamG, b.vol);
    const sparkCh = b.noiseSpikes('white', 'highpass', 4000, 0.7);
    const charTone = b.toneSpikes('sine');
    const charNoise = b.noiseSpikes('white', 'bandpass', 1800, 1.5);
    const burnt = () => Math.max(0, (p.intensity - 0.9) * 10);
    const sparks = b.stream(
      () => 4 + 70 * Math.pow(p.intensity, 1.5),
      (t) => sparkCh.hit(t, 0.12 + 0.45 * s.rand() * p.intensity, 0.0004, 0.002 + 0.005 * s.rand(), 2800 + s.rand() * 4500),
    );
    const charPops = b.stream(
      () => burnt() * 28,
      (t) => {
        charTone.hit(t, 0.3, 0.001, 0.035, 180 + s.rand() * 120, 55);
        charNoise.hit(t, 0.35, 0.001, 0.012, 1200 + s.rand() * 1500);
      },
    );
    const apply = (t: number) => {
      const bt = burnt();
      b.smooth(buzzG.gain, 0.05 + 0.32 * p.intensity - 0.1 * bt, t);
      b.smooth(humG.gain, 0.04 + 0.06 * p.intensity, t);
      b.smooth(drive.gain, 1 + 2.5 * bt, t);
      b.smooth(bp.frequency, 1500 - 600 * bt, t);
      b.smooth(sizzleG.gain, 0.45 * bt, t);
      b.smooth(steamG.gain, p.wet * 0.18 * (0.3 + p.intensity), t);
    };
    return finish(b, apply, (t, h) => {
      sparks(t, h);
      charPops(t, h);
    }, now);
  },

  /** SLURP: silbido de aire con la cánula en seco; gorgoteo de burbujas sumergida. */
  suction(s, out, now) {
    const b = base(s, out, now, LOOP_LEVEL.suction);
    const p = b.params;
    const whBp = filt(s, 'bandpass', 1900, 14);
    const whG = gain(s, 0);
    chain(b.noise('white'), whBp, whG, b.vol);
    const whTone = b.osc('sine', 1700);
    const vib = b.osc('sine', 5.5);
    const vibD = gain(s, 18);
    chain(vib, vibD);
    vibD.connect(whTone.detune);
    const toneG = gain(s, 0);
    chain(whTone, toneG, b.vol);
    const airHp = filt(s, 'highpass', 500, 0.7);
    const airLp = filt(s, 'lowpass', 6000, 0.7);
    const airG = gain(s, 0);
    chain(b.noise('pink'), airHp, airLp, airG, b.vol);
    const gurLp = filt(s, 'lowpass', 420, 2);
    const gurG = gain(s, 0);
    chain(b.noise('brown'), gurLp, gurG, b.vol);
    const bubA = b.toneSpikes('sine');
    const bubB = b.toneSpikes('sine');
    const slurpCh = b.noiseSpikes('pink', 'bandpass', 1300, 3);
    let flip = false;
    const bubbles = b.stream(
      () => p.wet * (8 + 45 * p.rate),
      (t) => {
        const f = 170 + s.rand() * 480;
        flip = !flip;
        (flip ? bubA : bubB).hit(t, 0.12 + 0.22 * s.rand(), 0.002, 0.02 + s.rand() * 0.045, f, f * 2.3);
      },
    );
    const slurps = b.stream(
      () => 5 * Math.sin(Math.PI * Math.min(1, p.wet)) * (0.3 + p.rate),
      (t) => slurpCh.hit(t, 0.35, 0.02, 0.08, 900 + s.rand() * 900),
    );
    const apply = (t: number) => {
      const dry = 1 - p.wet;
      b.smooth(whBp.frequency, 1700 + 800 * p.rate, t);
      b.smooth(whTone.frequency, 1650 + 700 * p.rate, t);
      b.smooth(whG.gain, dry * (0.25 + 0.5 * p.rate), t);
      b.smooth(toneG.gain, dry * dry * 0.035, t);
      b.smooth(airG.gain, (0.1 + 0.18 * p.rate) * (1 - 0.6 * p.wet), t);
      b.smooth(gurG.gain, p.wet * (0.3 + 0.35 * p.rate), t);
    };
    return finish(b, apply, (t, h) => {
      bubbles(t, h);
      slurps(t, h);
    }, now);
  },

  /** Taladro: motor de sierra + ruido; rate → RPM; load → baja de tono y rechina; intensity alta → siseo térmico. */
  drill(s, out, now) {
    const b = base(s, out, now, LOOP_LEVEL.drill);
    const p = b.params;
    const m1 = b.osc('sawtooth', 300);
    const m2 = b.osc('sawtooth', 600);
    m2.detune.value = 7;
    const sub = b.osc('square', 150);
    const mix = gain(s, 1);
    const m2g = gain(s, 0.45);
    const subg = gain(s, 0.3);
    m1.connect(mix);
    chain(m2, m2g, mix);
    chain(sub, subg, mix);
    const lp = filt(s, 'lowpass', 2000, 1.2);
    const sh = shaper(s, s.curves.soft);
    const motorG = gain(s, 0);
    chain(mix, lp, sh, motorG, b.vol);
    const whine = b.osc('sine', 1200);
    const whineG = gain(s, 0);
    chain(whine, whineG, b.vol);
    const grBp = filt(s, 'bandpass', 1700, 0.9);
    const grindG = gain(s, 0);
    chain(b.noise('white'), grBp, grindG, b.vol);
    const heatHp = filt(s, 'highpass', 5200, 0.7);
    const heatG = gain(s, 0);
    chain(b.noise('pink'), heatHp, heatG, b.vol);
    const chatCh = b.noiseSpikes('white', 'bandpass', 3000, 2);
    const chatter = b.stream(
      () => p.load * p.rate * 35,
      (t) => chatCh.hit(t, 0.08 + 0.18 * p.load, 0.001, 0.006, 2200 + s.rand() * 1800),
    );
    let jitterAt = 0;
    const apply = (t: number) => {
      const f = (140 + 380 * p.rate) * (1 - 0.3 * p.load);
      b.smooth(m1.frequency, f, t, 0.06);
      b.smooth(m2.frequency, f * 2, t, 0.06);
      b.smooth(sub.frequency, f / 2, t, 0.06);
      b.smooth(whine.frequency, f * 4, t, 0.06);
      b.smooth(lp.frequency, 700 + 3200 * p.rate * (1 - 0.4 * p.load), t);
      b.smooth(motorG.gain, p.rate < 0.01 ? 0 : 0.08 + 0.26 * Math.sqrt(p.rate), t, 0.08);
      b.smooth(whineG.gain, 0.012 + 0.03 * p.rate * (1 - p.load), t);
      b.smooth(grindG.gain, p.load * p.rate * 0.4, t);
      b.smooth(heatG.gain, Math.max(0, p.intensity - 0.72) * 0.7, t);
    };
    return finish(b, apply, (t, h) => {
      chatter(t, h);
      // irregularidad del motor bajo carga
      if (p.load > 0.15 && t >= jitterAt) {
        jitterAt = t + 0.04 + s.rand() * 0.05;
        m1.detune.setTargetAtTime((s.rand() - 0.5) * 60 * p.load, t, 0.02);
      }
    }, now);
  },

  /** Sierra oscilante: zumbido agudo con AM; wet → más apagada y chapoteante. */
  saw(s, out, now) {
    const b = base(s, out, now, LOOP_LEVEL.saw);
    const p = b.params;
    const c1 = b.osc('sawtooth', 1000);
    const c2 = b.osc('sawtooth', 1500);
    c2.detune.value = -12;
    const nBp = filt(s, 'bandpass', 3500, 1.4);
    const n = b.noise('white');
    const sum = gain(s, 1);
    const c2g = gain(s, 0.4);
    const ng = gain(s, 0.8);
    c1.connect(sum);
    chain(c2, c2g, sum);
    chain(n, nBp, ng, sum);
    const am = gain(s, 0.55);
    const lfo = b.osc('triangle', 38);
    const lfoD = gain(s, 0.45);
    chain(lfo, lfoD);
    lfoD.connect(am.gain);
    const lp = filt(s, 'lowpass', 8000, 0.8);
    const level = gain(s, 0);
    chain(sum, am, lp, level, b.vol);
    const grBp = filt(s, 'bandpass', 2200, 1);
    const grindG = gain(s, 0);
    chain(b.noise('white'), grBp, grindG, b.vol);
    const sloshLp = filt(s, 'lowpass', 650, 1.5);
    const sloshG = gain(s, 0);
    chain(b.noise('brown'), sloshLp, sloshG, b.vol);
    const bubCh = b.toneSpikes('sine');
    const bubbles = b.stream(
      () => p.wet * 14 * (0.3 + p.rate),
      (t) => {
        const f = 250 + s.rand() * 400;
        bubCh.hit(t, 0.12, 0.002, 0.04, f, f * 2.2);
      },
    );
    const apply = (t: number) => {
      const f = (800 + 500 * p.rate) * (1 - 0.25 * p.load);
      b.smooth(c1.frequency, f, t, 0.05);
      b.smooth(c2.frequency, f * 1.5, t, 0.05);
      b.smooth(lfo.frequency, 22 + 30 * p.rate, t);
      b.smooth(lp.frequency, 900 + 7500 * (1 - 0.8 * p.wet) * (1 - 0.3 * p.load), t);
      b.smooth(level.gain, p.rate < 0.01 ? 0 : (0.05 + 0.2 * p.rate) * (1 - 0.3 * p.wet), t, 0.06);
      b.smooth(grindG.gain, p.load * (0.1 + 0.25 * p.rate), t);
      b.smooth(sloshG.gain, p.wet * 0.3 * (0.3 + p.rate), t);
    };
    return finish(b, apply, bubbles, now);
  },

  /** Fresa: silbido agudo; load → baja y rechina. */
  burr(s, out, now) {
    const b = base(s, out, now, LOOP_LEVEL.burr);
    const p = b.params;
    const w1 = b.osc('triangle', 3000);
    const w2 = b.osc('sine', 6000);
    const w2g = gain(s, 0.2);
    const sum = gain(s, 1);
    w1.connect(sum);
    chain(w2, w2g, sum);
    const am = gain(s, 0.9);
    const flutter = b.osc('sine', 90);
    const flD = gain(s, 0.08);
    chain(flutter, flD);
    flD.connect(am.gain);
    const lp = filt(s, 'lowpass', 9000, 0.7);
    const level = gain(s, 0);
    chain(sum, am, lp, level, b.vol);
    const airBp = filt(s, 'bandpass', 6000, 2);
    const airG = gain(s, 0);
    chain(b.noise('white'), airBp, airG, b.vol);
    const grBp = filt(s, 'bandpass', 2400, 1.2);
    const grindG = gain(s, 0);
    chain(b.noise('white'), grBp, grindG, b.vol);
    const chatCh = b.noiseSpikes('white', 'bandpass', 4000, 2);
    const chatter = b.stream(
      () => p.load * (10 + 40 * p.rate),
      (t) => chatCh.hit(t, 0.06 + 0.12 * p.load, 0.001, 0.004, 3000 + s.rand() * 3000),
    );
    const apply = (t: number) => {
      const f = (2200 + 2600 * p.rate) * (1 - 0.3 * p.load);
      b.smooth(w1.frequency, f, t, 0.05);
      b.smooth(w2.frequency, f * 2, t, 0.05);
      b.smooth(level.gain, p.rate < 0.01 ? 0 : 0.03 + 0.12 * p.rate, t, 0.06);
      b.smooth(airG.gain, 0.04 + 0.1 * p.rate, t);
      b.smooth(grindG.gain, p.load * (0.08 + 0.25 * p.rate), t);
      b.smooth(lp.frequency, 9000 - 5000 * p.wet, t);
    };
    return finish(b, apply, chatter, now);
  },

  /** Maquinilla de rasurar: zumbido de 120 Hz + cuchillas; load → pelo cortado. */
  clipper(s, out, now) {
    const b = base(s, out, now, LOOP_LEVEL.clipper);
    const p = b.params;
    const buzz = b.osc('square', 120);
    const bp = filt(s, 'bandpass', 1100, 0.8);
    const hp = filt(s, 'highpass', 180, 0.7);
    const buzzG = gain(s, 0);
    chain(buzz, bp, hp, buzzG, b.vol);
    const rattle = b.osc('triangle', 240);
    const ratG = gain(s, 0);
    chain(rattle, ratG, b.vol);
    const bladeHp = filt(s, 'highpass', 5000, 0.7);
    const bladeG = gain(s, 0);
    chain(b.noise('white'), bladeHp, bladeG, b.vol);
    const hairCh = b.noiseSpikes('white', 'bandpass', 4500, 1.5);
    const hair = b.stream(
      () => p.load * 50,
      (t) => hairCh.hit(t, 0.05 + 0.1 * s.rand(), 0.001, 0.003, 3500 + s.rand() * 3000),
    );
    const apply = (t: number) => {
      const f = 120 * (1 - 0.07 * p.load);
      b.smooth(buzz.frequency, f, t);
      b.smooth(rattle.frequency, f * 2, t);
      b.smooth(buzzG.gain, 0.08 + 0.14 * p.rate, t);
      b.smooth(ratG.gain, 0.02 + 0.03 * p.rate, t);
      b.smooth(bladeG.gain, 0.015 + 0.03 * p.rate + 0.03 * p.load, t);
    };
    return finish(b, apply, hair, now);
  },

  /** Venda cohesiva: crujidos de plástico y "riiip" con tensión (load). */
  bandage(s, out, now) {
    const b = base(s, out, now, LOOP_LEVEL.bandage);
    const p = b.params;
    const lp = filt(s, 'lowpass', 12000, 0.7);
    lp.connect(b.vol);
    const rBp = filt(s, 'bandpass', 1800, 1.5);
    const rAm = gain(s, 0.5);
    const riipG = gain(s, 0);
    chain(b.noise('white'), rBp, rAm, riipG, lp);
    const crA = b.noiseSpikes('white', 'highpass', 4000, 0.8, lp);
    const crB = b.noiseSpikes('white', 'highpass', 4000, 0.8, lp);
    const crinkle = b.stream(
      () => (4 + 40 * p.rate) * (0.3 + 0.7 * p.intensity),
      (t) => {
        // ráfaga de 2–5 microcrujidos alternando dos canales
        const k = 2 + Math.floor(s.rand() * 4);
        let ti = t;
        for (let i = 0; i < k; i++) {
          const d = 0.001 + s.rand() * 0.003;
          (i % 2 ? crB : crA).hit(ti, (0.08 + 0.25 * s.rand()) * (0.4 + 0.6 * p.intensity), 0.0004, d, 2500 + s.rand() * 4500);
          ti += 0.002 + s.rand() * 0.006;
        }
      },
    );
    let amAt = 0;
    const apply = (t: number) => {
      b.smooth(riipG.gain, p.load * 0.35 * (0.3 + p.rate), t);
      b.smooth(rBp.frequency, 1500 + 900 * p.rate, t);
      b.smooth(lp.frequency, 12000 - 8500 * p.wet, t);
    };
    return finish(b, apply, (t, h) => {
      crinkle(t, h);
      if (t >= amAt) {
        amAt = t + 0.02 + s.rand() * 0.03;
        rAm.gain.setTargetAtTime(Math.max(EPS, 0.2 + s.rand() * 0.8), t, 0.01);
      }
    }, now);
  },
};

export const LOOP_NAMES = Object.keys(LOOPS) as LoopSfxName[];

export const LOOP_PARAM_KEYS: readonly LoopParam[] = ['rate', 'load', 'wet', 'intensity'];
