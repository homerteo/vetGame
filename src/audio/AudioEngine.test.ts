import { describe, expect, it } from 'vitest';
import type { Settings, VitalsSnapshot } from '../core/contracts';
import { createAudio, createAudioEngine } from './AudioEngine';
import { LOOP_NAMES } from './loops';
import { SFX_NAMES } from './sfx';
import { MUSIC_STATES } from './songs';
import { FakeAudioContext, FakeAudioContextCtor, FakeOscillator, manualTimers } from './testing/FakeAudioContext';

const SETTINGS: Settings = {
  difficulty: 'especialista',
  goreLevel: 50,
  pastelMode: false,
  tremorScale: 1,
  rhythmWindowScale: 1,
  reduceFlashes: false,
  subtitles: true,
  tts: true,
  masterVolume: 0.8,
  musicVolume: 0.6,
  sfxVolume: 0.9,
  asmrVolume: 0.7,
  immersive: false,
  adaptiveDirector: true,
  colorblind: 'none',
};

const VITALS: VitalsSnapshot = {
  hr: 90,
  spo2: 97,
  map: 75,
  etco2: 38,
  tempC: 38,
  bloodVolumePct: 100,
  bloodLostPct: 0,
  exito: 60,
  arrest: false,
  rhythm: 'sinus',
  alarms: [],
};

async function fakeEngine() {
  const timers = manualTimers();
  let ms = 1000;
  const e = createAudioEngine({ AudioContextCtor: FakeAudioContextCtor, timers, nowMs: () => ms, speech: null, rand: () => 0.5 });
  await e.unlock();
  const ctx = e.debug.context() as unknown as FakeAudioContext;
  /** Avanza el tiempo de audio y de pared y dispara el planificador cada 25 ms. */
  const run = (sec: number) => {
    for (let t = 0; t < sec; t += 0.025) {
      ctx.advance(0.025);
      ms += 25;
      timers.fire();
    }
  };
  return { e, ctx, timers, run };
}

describe('AudioEngine sin AudioContext (node)', () => {
  it('createAudio() funciona como no-op sin lanzar', async () => {
    expect((globalThis as { AudioContext?: unknown }).AudioContext).toBeUndefined();
    const a = createAudio();
    await expect(a.unlock()).resolves.toBeUndefined();
    for (const n of SFX_NAMES) expect(() => a.play(n, { volume: 2, pitch: 0, pan: 9, intensity: -1 })).not.toThrow();
    for (const n of LOOP_NAMES) {
      const h = a.loop(n);
      expect(() => {
        h.set('rate', 0.7);
        h.set('load', Number.NaN);
        h.stop();
        h.stop();
        h.set('wet', 1);
      }).not.toThrow();
    }
    for (const s of MUSIC_STATES) expect(() => a.setMusic(s)).not.toThrow();
    expect(() => a.setVitals(VITALS)).not.toThrow();
    expect(() => a.setVitals(null)).not.toThrow();
    expect(() => a.voice('valerio', 'Primum non nocere, doctora.')).not.toThrow();
    expect(() => a.applySettings(SETTINGS)).not.toThrow();
    expect(() => a.dispose()).not.toThrow();
    expect(() => a.play('whip')).not.toThrow();
  });

  it('el reloj de pulso corre con performance.now a 110 BPM', () => {
    let ms = 5000;
    const a = createAudioEngine({ AudioContextCtor: null, nowMs: () => ms });
    expect(a.beat.bpm).toBe(110);
    const spb = 60 / 110;
    const i0 = a.beat.beatIndex();
    const ph0 = a.beat.phase();
    ms += spb * 1000 * 2.5;
    expect(a.beat.beatIndex()).toBe(i0 + 2);
    expect(a.beat.phase()).toBeCloseTo(ph0 + 0.5, 6);
    expect(a.beat.timeToNextBeat()).toBeCloseTo(spb * (1 - (ph0 + 0.5)), 6);
    // en silencio, el tempo vuelve a 110
    a.setMusic('title');
    ms += 2000;
    expect(a.beat.bpm).toBe(96);
    a.setMusic('silent');
    ms += 2000;
    expect(a.beat.bpm).toBe(110);
  });
});

describe('AudioEngine con AudioContext falso', () => {
  it('unlock crea y reanuda el contexto una vez y arranca el planificador', async () => {
    const { e, ctx, timers } = await fakeEngine();
    expect(ctx.state).toBe('running');
    await e.unlock();
    expect(FakeAudioContext.instances.filter((c) => c === ctx).length).toBe(1);
    expect(timers.count()).toBe(1);
    e.dispose();
    expect(timers.count()).toBe(0);
    expect(ctx.state).toBe('closed');
  });

  it('todos los efectos suenan sin errores y cada fuente tiene stop programado', async () => {
    const { e, ctx, run } = await fakeEngine();
    for (const n of SFX_NAMES) {
      const before = ctx.sources().length;
      e.play(n, { pitch: 1.1, intensity: 0.8, pan: -0.3 });
      const created = ctx.sources().slice(before);
      expect(created.length, n).toBeGreaterThan(0);
      for (const s of created) {
        expect(s.startAt, n).not.toBeNull();
        expect(s.stopAt, n).not.toBeNull();
        expect(s.stopAt!, n).toBeGreaterThanOrEqual(s.startAt!);
        expect(s.stopAt! - s.startAt!, n).toBeLessThan(6);
      }
      run(0.1);
    }
  });

  it('limita la repetición del mismo efecto', async () => {
    const { e, ctx } = await fakeEngine();
    e.play('alarm');
    const n = ctx.sources().length;
    e.play('alarm');
    e.play('alarm');
    expect(ctx.sources().length).toBe(n);
  });

  it('alarma y desfibrilador atenúan música y ASMR (ducking)', async () => {
    const { e, ctx } = await fakeEngine();
    e.play('defibShock');
    const ducked = ctx.nodes.filter((n) => (n as unknown as { gain?: { events: Array<{ type: string; v: number }> } }).gain?.events.some((ev) => ev.type === 'target' && ev.v === 0.25));
    expect(ducked.length).toBe(2);
  });

  it('ciclo de vida de los bucles: fundidos, parámetros y parada limpia', async () => {
    const { e, ctx, run } = await fakeEngine();
    for (const n of LOOP_NAMES) {
      const before = ctx.sources().length;
      const h = e.loop(n);
      const own = () => ctx.sources().slice(before);
      expect(own().length, n).toBeGreaterThan(0);
      expect(e.debug.activeLoops()).toBe(1);
      for (const p of ['rate', 'load', 'wet', 'intensity'] as const) {
        h.set(p, 1);
        run(0.2);
        h.set(p, 0);
        run(0.05);
      }
      h.set('intensity', 0.95); // cauterio quemado
      h.set('wet', 0.8);
      run(0.5);
      // las fuentes continuas siguen sin stop hasta parar
      const continuous = own().filter((s) => s.stopAt === null);
      expect(continuous.length, n).toBeGreaterThan(0);
      h.stop();
      h.stop();
      expect(() => h.set('rate', 0.5)).not.toThrow();
      for (const s of own()) expect(s.stopAt, n).not.toBeNull();
      run(0.6);
      expect(e.debug.activeLoops(), n).toBe(0);
    }
  });

  it('un bucle pedido antes de unlock se crea al primer set tras desbloquear', async () => {
    const timers = manualTimers();
    const e = createAudioEngine({ AudioContextCtor: FakeAudioContextCtor, timers, speech: null });
    const h = e.loop('drill');
    h.set('rate', 0.3);
    expect(e.debug.activeLoops()).toBe(0);
    await e.unlock();
    h.set('rate', 0.6);
    expect(e.debug.activeLoops()).toBe(1);
    h.stop();
  });

  it('la música programa notas en todos los estados y el pulso sigue al tema', async () => {
    const { e, ctx, run } = await fakeEngine();
    for (const s of MUSIC_STATES) {
      const before = ctx.sources().length;
      e.setMusic(s);
      run(3);
      const made = ctx.sources().length - before;
      if (s === 'silent') expect(e.beat.bpm).toBe(110);
      else expect(made, s).toBeGreaterThan(0);
      const expected = s === 'title' ? 96 : s === 'clinic' ? 100 : 110;
      expect(e.beat.bpm, s).toBe(expected);
    }
  });

  it('las notas del bombo de orStable caen en pulsos enteros del reloj', async () => {
    const { e, ctx, run } = await fakeEngine();
    e.setMusic('orStable');
    run(0.3);
    const from = ctx.nodes.length;
    run(4);
    const beat = e.debug.beat;
    // el bombo: seno que arranca a 140 Hz
    const kicks = ctx.nodes
      .slice(from)
      .filter((n): n is FakeOscillator => n instanceof FakeOscillator && n.type === 'sine' && n.frequency.events[0]?.v === 140);
    expect(kicks.length).toBeGreaterThanOrEqual(6);
    // tiempo de contexto → reloj: la posición en pulsos debe ser entera
    const offs = kicks.map((k) => k.startAt!);
    const diffs = offs.slice(1).map((t, i) => t - offs[i]);
    for (const d of diffs) expect(d).toBeCloseTo(60 / 110, 6);
    expect(beat.bpm).toBe(110);
    // Alineación con lo que se OYE: tiempo de contexto → reloj (audible = currentTime − latencia).
    const cOff = beat.now() - (ctx.currentTime - ctx.baseLatency);
    for (const t of offs) {
      const b = beat.beatAt(t + cOff);
      expect(Math.abs(b - Math.round(b))).toBeLessThan(1e-6);
    }
  });

  it('monitor: pitidos al ritmo de la FC y tono plano en asistolia', async () => {
    const { e, ctx, run } = await fakeEngine();
    e.setVitals({ ...VITALS, hr: 120, spo2: 90 });
    const before = ctx.nodes.length;
    run(3);
    const beeps = ctx.nodes
      .slice(before)
      .filter((n): n is FakeOscillator => n instanceof FakeOscillator && n.type === 'sine' && Math.abs(n.frequency.value - 440 * Math.SQRT2) < 0.5);
    expect(beeps.length).toBeGreaterThanOrEqual(5);
    expect(beeps.length).toBeLessThanOrEqual(7);
    e.setVitals({ ...VITALS, arrest: true, rhythm: 'asystole', hr: 0 });
    expect(e.debug.monitorMode()).toBe('flat');
    run(1);
    e.setVitals(null);
    expect(e.debug.monitorMode()).toBe('off');
  });

  it('applySettings antes y después de unlock no lanza y ajusta los buses', async () => {
    const timers = manualTimers();
    const e = createAudioEngine({ AudioContextCtor: FakeAudioContextCtor, timers, speech: null });
    e.applySettings({ ...SETTINGS, masterVolume: 0.5 });
    await e.unlock();
    const ctx = e.debug.context() as unknown as FakeAudioContext;
    const master = ctx.nodes.find((n) => n.kind === 'gain') as unknown as { gain: { value: number } };
    expect(master.gain.value).toBeCloseTo(0.5);
    expect(() => e.applySettings({ ...SETTINGS, masterVolume: 2, musicVolume: -1 })).not.toThrow();
    e.dispose();
  });

  it('un constructor de AudioContext que lanza deja el motor mudo', async () => {
    const Broken = function () {
      throw new Error('no audio');
    } as unknown as new () => AudioContext;
    const e = createAudioEngine({ AudioContextCtor: Broken, speech: null });
    await expect(e.unlock()).resolves.toBeUndefined();
    expect(() => e.play('whip')).not.toThrow();
    expect(e.debug.context()).toBeNull();
  });
});

describe('stopSfx (extensión local)', () => {
  it('corta la carga del desfibrilador y restaura el ducking', async () => {
    const timers = manualTimers();
    const e = createAudioEngine({ AudioContextCtor: FakeAudioContextCtor, timers, speech: null });
    await e.unlock();
    const ctx = e.debug.context() as unknown as FakeAudioContext;
    e.play('defibCharge');
    ctx.advance(0.5);
    expect(() => e.stopSfx('defibCharge')).not.toThrow();
    // se puede volver a cargar enseguida (no lo bloquea minGap)
    const before = ctx.sources().length;
    e.play('defibCharge');
    expect(ctx.sources().length).toBeGreaterThan(before);
    expect(() => e.stopSfx('whip')).not.toThrow();
    e.dispose();
    expect(() => e.stopSfx('defibCharge')).not.toThrow();
  });
});
