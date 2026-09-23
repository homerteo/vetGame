/**
 * Motor de audio procedural (WebAudio). Buses: master → [música, efectos, ASMR, voz],
 * compresor en el master, reverb de sala pequeña por convolución y "ducking" de
 * música/ASMR bajo alarmas y desfibrilador. Sin AudioContext todo es no-op.
 */
import type {
  AudioAPI,
  LoopHandle,
  LoopSfxName,
  MusicState,
  Settings,
  SfxName,
  SpeakerId,
  VitalsSnapshot,
} from '../core/contracts';
import { createBeatClock, type BeatClockEx } from './BeatClock';
import { smallRoomImpulse } from './dsp';
import { LOOPS, type LoopImpl, type LoopParam } from './loops';
import { createMonitor } from './Monitor';
import { createMusic, type MusicManager } from './Music';
import { SCHED_LOOKAHEAD, SCHED_TICK_MS } from './Sequencer';
import { SFX, SFX_META } from './sfx';
import { SONGS } from './songs';
import { EPS, createSynth, filt, gain, holdParam, type Synth } from './synth';
import { createVoice, type SpeechLike, type UtteranceCtor } from './Voice';

type ACtor = new (opts?: AudioContextOptions) => AudioContext;

export interface AudioEngineOptions {
  /** Constructor de AudioContext; null fuerza modo mudo. Por defecto, el del navegador. */
  AudioContextCtor?: ACtor | null;
  /** Reloj de pared en ms (por defecto performance.now). */
  nowMs?: () => number;
  speech?: SpeechLike | null;
  Utterance?: UtteranceCtor | null;
  timers?: {
    setInterval(cb: () => void, ms: number): unknown;
    clearInterval(id: unknown): void;
  };
  rand?: () => number;
}

export interface AudioDebug {
  context(): BaseAudioContext | null;
  /** Analizador en la salida (se crea al pedirlo). */
  analyser(): AnalyserNode | null;
  musicState(): MusicState;
  activeLoops(): number;
  activeVoices(): number;
  monitorMode(): string;
  voiceName(): string | null;
  /** Fuerza un ciclo del planificador (pruebas). */
  tick(): void;
  readonly beat: BeatClockEx;
}

export interface AudioEngine extends AudioAPI {
  readonly beat: BeatClockEx;
  /** Extensión local (ver docs/contract-requests/audio.md): corta con fundido un efecto en curso (p. ej. la carga del desfibrilador). */
  stopSfx(name: SfxName): void;
  readonly debug: AudioDebug;
}

/** Niveles base de cada bus (antes de los ajustes del jugador). */
export const BUS_BASE = { music: 0.55, sfx: 0.9, asmr: 0.8, voice: 0.9 } as const;

const MAX_VOICES = 64;
const NOOP_HANDLE: LoopHandle = { set() {}, stop() {} };

const DEFAULT_MIX = { masterVolume: 0.8, musicVolume: 0.7, sfxVolume: 0.9, asmrVolume: 0.8, tts: false };

interface Graph {
  ctx: AudioContext;
  synth: Synth;
  master: GainNode;
  comp: DynamicsCompressorNode;
  music: GainNode;
  musicDuck: GainNode;
  sfx: GainNode;
  asmr: GainNode;
  asmrDuck: GainNode;
  voice: GainNode;
  reverb: ConvolverNode | null;
  flat: { osc: OscillatorNode; g: GainNode } | null;
  analyser: AnalyserNode | null;
}

function defaultCtor(): ACtor | null {
  const g = globalThis as unknown as { AudioContext?: ACtor; webkitAudioContext?: ACtor };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

export function createAudioEngine(opts: AudioEngineOptions = {}): AudioEngine {
  const Ctor = opts.AudioContextCtor !== undefined ? opts.AudioContextCtor : defaultCtor();
  const perfMs =
    opts.nowMs ?? (() => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()));
  const timers = opts.timers ?? {
    setInterval: (cb: () => void, ms: number) => setInterval(cb, ms),
    clearInterval: (id: unknown) => clearInterval(id as ReturnType<typeof setInterval>),
  };
  const rand = opts.rand ?? Math.random;
  const voice = createVoice({ speech: opts.speech, Utterance: opts.Utterance, rand });

  let g: Graph | null = null;
  let music: MusicManager | null = null;
  let disposed = false;
  let timerId: unknown = null;
  let desiredMusic: MusicState = 'silent';
  const mix = { ...DEFAULT_MIX };
  const lastPlayed = new Map<SfxName, number>();
  const voices: Array<{ out: AudioNode; end: number; name?: SfxName; gain?: GainNode }> = [];
  const loops = new Set<{ impl: LoopImpl; end: number }>();
  let duckUntil = 0;
  let vitals: VitalsSnapshot | null = null;

  // ── Reloj: dominio continuo que sigue al tiempo audible del contexto si está en marcha ──
  let mode: 'perf' | 'ctx' = 'perf';
  let pOff = 0;
  let cOff = 0;
  let lastClock = -Infinity;
  const perfSec = () => perfMs() / 1000;
  const running = () => !!g && g.ctx.state === 'running';
  function audible(): number {
    const ctx = g!.ctx;
    try {
      const ts = ctx.getOutputTimestamp?.();
      if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.contextTime > 0) {
        const t = ts.contextTime + (perfMs() - ts.performanceTime) / 1000;
        if (Number.isFinite(t)) return Math.min(ctx.currentTime, t);
      }
    } catch {
      // sin marca de salida
    }
    return ctx.currentTime - (ctx.baseLatency || 0);
  }
  function clockNow(): number {
    let v: number;
    if (running()) {
      if (mode !== 'ctx') {
        const c = perfSec() + pOff;
        cOff = c - audible();
        mode = 'ctx';
      }
      v = audible() + cOff;
    } else {
      if (mode !== 'perf') {
        const c = lastClock;
        pOff = c - perfSec();
        mode = 'perf';
      }
      v = perfSec() + pOff;
    }
    if (v < lastClock) v = lastClock;
    lastClock = v;
    return v;
  }
  const beat = createBeatClock(clockNow, 110);
  const toCtx = (clockT: number) => clockT - cOff;

  // ── Monitor ──
  const monitor = createMonitor({
    beep(t, hz) {
      if (!g) return;
      const s = g.synth;
      const o = s.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = hz;
      const o2 = s.ctx.createOscillator();
      o2.type = 'triangle';
      o2.frequency.value = hz * 2;
      const g2 = gain(s, 0.08);
      const env = gain(s, 0);
      env.gain.setValueAtTime(EPS, t);
      env.gain.linearRampToValueAtTime(0.16, t + 0.006);
      env.gain.setValueAtTime(0.16, t + 0.075);
      env.gain.exponentialRampToValueAtTime(EPS, t + 0.12);
      o.connect(env);
      o2.connect(g2).connect(env);
      env.connect(g.sfx);
      o.start(t);
      o2.start(t);
      o.stop(t + 0.14);
      o2.stop(t + 0.14);
      voices.push({ out: env, end: t + 0.3 });
    },
    alarm(t, high) {
      playAt('alarm', t, { volume: high ? 1 : 0.7, pitch: high ? 1.06 : 1, pan: 0, intensity: 0.5 });
    },
    flat(on, hz, t) {
      if (!g) return;
      if (on) {
        if (g.flat) return;
        const o = g.ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = hz;
        const fg = gain(g.synth, 0);
        fg.gain.setValueAtTime(0, t);
        fg.gain.linearRampToValueAtTime(0.07, t + 0.15);
        o.connect(fg).connect(g.sfx);
        o.start(t);
        g.flat = { osc: o, g: fg };
      } else if (g.flat) {
        const f = g.flat;
        g.flat = null;
        holdParam(f.g.gain, t);
        f.g.gain.setTargetAtTime(0, t, 0.03);
        f.osc.stop(t + 0.3);
        voices.push({ out: f.g, end: t + 0.4 });
      }
    },
  });

  // ── Construcción del grafo ──
  function build(): boolean {
    if (!Ctor || g || disposed) return !!g;
    let ctx: AudioContext;
    try {
      ctx = new Ctor({ latencyHint: 'interactive' });
    } catch {
      try {
        ctx = new Ctor();
      } catch {
        return false;
      }
    }
    try {
      const synth = createSynth(ctx, rand);
      const master = gain(synth, mix.masterVolume);
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 10;
      comp.ratio.value = 4;
      comp.attack.value = 0.004;
      comp.release.value = 0.2;
      master.connect(comp).connect(ctx.destination);
      const music = gain(synth, BUS_BASE.music * mix.musicVolume);
      const musicDuck = gain(synth, 1);
      const musicHp = filt(synth, 'highpass', 35, 0.7);
      music.connect(musicHp).connect(musicDuck).connect(master);
      const sfx = gain(synth, BUS_BASE.sfx * mix.sfxVolume);
      sfx.connect(master);
      const asmr = gain(synth, BUS_BASE.asmr * mix.asmrVolume);
      const asmrDuck = gain(synth, 1);
      asmr.connect(asmrDuck).connect(master);
      const voiceBus = gain(synth, BUS_BASE.voice * mix.sfxVolume);
      voiceBus.connect(master);
      let reverb: ConvolverNode | null = null;
      try {
        reverb = ctx.createConvolver();
        const [l, r] = smallRoomImpulse(ctx.sampleRate, 0.8);
        const ir = ctx.createBuffer(2, l.length, ctx.sampleRate);
        ir.copyToChannel(l, 0);
        ir.copyToChannel(r, 1);
        reverb.buffer = ir;
        const ret = gain(synth, 0.5);
        reverb.connect(ret).connect(master);
        const musicSend = gain(synth, 0.16);
        musicDuck.connect(musicSend).connect(reverb);
      } catch {
        reverb = null;
      }
      g = { ctx, synth, master, comp, music, musicDuck, sfx, asmr, asmrDuck, voice: voiceBus, reverb, flat: null, analyser: null };
      return true;
    } catch {
      try {
        void ctx.close();
      } catch {
        // nada
      }
      g = null;
      return false;
    }
  }

  /** El gestor de música nace cuando el contexto ya corre (así su eje de tiempo es el del contexto). */
  function musicMgr(): MusicManager | null {
    if (!g || !running()) return null;
    if (!music) {
      music = createMusic({ synth: g.synth, bus: g.music, clock: beat, toCtx });
      music.set(desiredMusic, clockNow());
    }
    return music;
  }

  function startTimer() {
    if (timerId !== null || disposed) return;
    timerId = timers.setInterval(tick, SCHED_TICK_MS);
  }

  function tick() {
    if (!g || disposed) return;
    const ctx = g.ctx;
    if (ctx.state !== 'running') return;
    try {
      clockNow(); // actualiza el dominio del reloj (cOff) antes de programar
      const now = ctx.currentTime;
      const horizon = now + SCHED_LOOKAHEAD;
      musicMgr()?.tick(now + cOff, horizon + cOff, now);
      for (const l of loops) {
        if (!l.impl.stopped) l.impl.tick(now, horizon);
        else if (now > l.end) {
          l.impl.dispose();
          loops.delete(l);
        }
      }
      monitor.tick(now, horizon);
      for (let i = voices.length - 1; i >= 0; i--) {
        if (voices[i].end < now) {
          try {
            voices[i].out.disconnect();
          } catch {
            // nada
          }
          voices.splice(i, 1);
        }
      }
    } catch {
      // el planificador no debe morir por una nota
    }
  }

  function duck(level: number, hold: number, now: number) {
    if (!g) return;
    duckUntil = Math.max(duckUntil, now + hold);
    for (const p of [g.musicDuck.gain, g.asmrDuck.gain]) {
      holdParam(p, now);
      p.setTargetAtTime(level, now, 0.05);
      p.setTargetAtTime(1, duckUntil, 0.35);
    }
  }

  function playAt(name: SfxName, t: number, p: { volume: number; pitch: number; pan: number; intensity: number }) {
    if (!g || disposed) return;
    const meta = SFX_META[name];
    const recipe = SFX[name];
    if (!meta || !recipe) return;
    const last = lastPlayed.get(name);
    if (last !== undefined && t - last < meta.minGap && t >= last) return;
    if (voices.length >= MAX_VOICES) return;
    lastPlayed.set(name, t);
    const s = g.synth;
    const out = gain(s, Math.max(0, Math.min(2, p.volume)) * meta.gain);
    let tail: AudioNode = out;
    if (p.pan !== 0 && typeof g.ctx.createStereoPanner === 'function') {
      const pan = g.ctx.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, p.pan));
      out.connect(pan);
      tail = pan;
    }
    tail.connect(meta.bus === 'voice' ? g.voice : g.sfx);
    if (g.reverb && meta.reverb > 0) {
      const send = gain(s, meta.reverb);
      tail.connect(send).connect(g.reverb);
    }
    const pitch = Number.isFinite(p.pitch) && p.pitch > 0 ? Math.max(0.25, Math.min(4, p.pitch)) : 1;
    const intensity = Number.isFinite(p.intensity) ? Math.max(0, Math.min(1, p.intensity)) : 0.5;
    let end = t + 1;
    try {
      end = recipe(s, out, t, { pitch, intensity });
    } catch {
      // receta rota: no bloquea el juego
    }
    if (meta.duck !== undefined) duck(meta.duck, Math.max(0.2, end - t), t);
    voices.push({ out: tail, end: end + 1.2, name, gain: out });
  }

  function applyMix(now: number) {
    if (!g) return;
    const tc = 0.05;
    g.master.gain.setTargetAtTime(mix.masterVolume, now, tc);
    g.music.gain.setTargetAtTime(BUS_BASE.music * mix.musicVolume, now, tc);
    g.sfx.gain.setTargetAtTime(BUS_BASE.sfx * mix.sfxVolume, now, tc);
    g.asmr.gain.setTargetAtTime(BUS_BASE.asmr * mix.asmrVolume, now, tc);
    g.voice.gain.setTargetAtTime(BUS_BASE.voice * mix.sfxVolume, now, tc);
  }

  const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

  const engine: AudioEngine = {
    beat,

    async unlock() {
      if (disposed) return;
      try {
        if (!g && !build()) return;
        if (g!.ctx.state === 'suspended') await g!.ctx.resume();
        startTimer();
        if (vitals) monitor.set(vitals, g!.ctx.currentTime);
      } catch {
        // sin audio: el juego sigue en silencio
      }
    },

    play(name, params) {
      if (!g || disposed) return;
      try {
        playAt(name, g.ctx.currentTime + 0.005, {
          volume: params?.volume ?? 1,
          pitch: params?.pitch ?? 1,
          pan: params?.pan ?? 0,
          intensity: params?.intensity ?? 0.5,
        });
      } catch {
        // no-op
      }
    },

    loop(name: LoopSfxName): LoopHandle {
      if (disposed || !LOOPS[name]) return NOOP_HANDLE;
      const pending: Partial<Record<LoopParam, number>> = {};
      let entry: { impl: LoopImpl; end: number } | null = null;
      let stopped = false;
      const ensure = () => {
        if (entry || stopped || !g || disposed) return;
        try {
          const impl = LOOPS[name](g.synth, g.asmr, g.ctx.currentTime);
          for (const k in pending) impl.params[k as LoopParam] = pending[k as LoopParam]!;
          impl.apply(g.ctx.currentTime);
          entry = { impl, end: Infinity };
          loops.add(entry);
        } catch {
          entry = null;
        }
      };
      ensure();
      return {
        set(param, value) {
          if (stopped) return;
          const v = clamp01(value);
          pending[param] = v;
          ensure();
          if (!entry || !g) return;
          const p = entry.impl.params;
          if (Math.abs(p[param] - v) < 0.004) return;
          p[param] = v;
          try {
            entry.impl.apply(g.ctx.currentTime);
          } catch {
            // nada
          }
        },
        stop() {
          if (stopped) return;
          stopped = true;
          if (!entry || !g) return;
          try {
            entry.end = entry.impl.stop(g.ctx.currentTime) + 0.1;
          } catch {
            entry.end = 0;
          }
        },
      };
    },

    stopSfx(name) {
      if (!g || disposed) return;
      const now = g.ctx.currentTime;
      for (const v of voices) {
        if (v.name !== name || !v.gain || v.end < now) continue;
        try {
          holdParam(v.gain.gain, now);
          v.gain.gain.setTargetAtTime(0, now, 0.02);
          v.end = Math.min(v.end, now + 0.2);
        } catch {
          // nada
        }
      }
      if (SFX_META[name]?.duck !== undefined) {
        duckUntil = now;
        for (const p of [g.musicDuck.gain, g.asmrDuck.gain]) {
          holdParam(p, now);
          p.setTargetAtTime(1, now, 0.3);
        }
      }
      lastPlayed.delete(name);
    },

    setMusic(state) {
      if (disposed || !SONGS[state]) return;
      if (state === desiredMusic) return;
      desiredMusic = state;
      try {
        const m = musicMgr();
        if (m) m.set(state, clockNow());
        else beat.setTempo(SONGS[state].bpm);
      } catch {
        // nada
      }
    },

    setVitals(v) {
      vitals = v;
      if (!g || disposed) return;
      try {
        monitor.set(v, g.ctx.currentTime);
      } catch {
        // nada
      }
    },

    voice(speaker: SpeakerId, text: string) {
      if (disposed) return;
      try {
        if (speaker === 'panchito') {
          engine.play('panchitoBark', { intensity: /!{2,}|¡/.test(text) ? 0.9 : 0.5 });
          return;
        }
        voice.say(speaker, text);
      } catch {
        // nada
      }
    },

    applySettings(s: Settings) {
      mix.masterVolume = clamp01(s.masterVolume);
      mix.musicVolume = clamp01(s.musicVolume);
      mix.sfxVolume = clamp01(s.sfxVolume);
      mix.asmrVolume = clamp01(s.asmrVolume);
      mix.tts = !!s.tts;
      voice.setEnabled(mix.tts);
      voice.setVolume(mix.masterVolume);
      if (g) {
        try {
          applyMix(g.ctx.currentTime);
        } catch {
          // nada
        }
      }
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      if (timerId !== null) timers.clearInterval(timerId);
      timerId = null;
      voice.dispose();
      if (g) {
        const ctx = g.ctx;
        try {
          for (const l of loops) l.impl.stop(ctx.currentTime);
          music?.dispose();
          void ctx.close().catch(() => {});
        } catch {
          // nada
        }
      }
      loops.clear();
      voices.length = 0;
      music = null;
      g = null;
    },

    debug: {
      context: () => g?.ctx ?? null,
      analyser() {
        if (!g) return null;
        if (!g.analyser) {
          const a = g.ctx.createAnalyser();
          a.fftSize = 2048;
          a.smoothingTimeConstant = 0.7;
          g.comp.connect(a);
          g.analyser = a;
        }
        return g.analyser;
      },
      musicState: () => desiredMusic,
      activeLoops: () => loops.size,
      activeVoices: () => voices.length,
      monitorMode: () => monitor.mode(),
      voiceName: () => voice.voiceName(),
      tick,
      beat,
    },
  };
  return engine;
}

/** Punto de entrada del contrato (docs/ARCHITECTURE.md §audio). */
export function createAudio(): AudioAPI {
  return createAudioEngine();
}
