import type { BeatClock } from '../core/contracts';

/**
 * Reloj de pulso con cambios de tempo alineados a pulsos enteros.
 * El tiempo está en segundos en el dominio que devuelva `now` (lo decide el motor:
 * tiempo audible del AudioContext o performance.now()). Sin asignaciones en las consultas.
 */
export interface TempoSegment {
  /** Instante (s) en que empieza el tramo. */
  t0: number;
  /** Pulso (continuo) en ese instante. */
  b0: number;
  bpm: number;
}

export interface BeatClockEx extends BeatClock {
  now(): number;
  /** Posición continua en pulsos en el instante t. */
  beatAt(t: number): number;
  /** Instante en que cae el pulso b (puede ser fraccionario). */
  timeOfBeat(b: number): number;
  /** Cambia el tempo a partir del pulso entero `atBeat` (por defecto, el siguiente pulso). */
  setTempo(bpm: number, atBeat?: number): void;
  /** Desplaza todo el eje de tiempo (al cambiar de fuente de reloj). */
  shift(dt: number): void;
  /** Tempo vigente en el instante t. */
  bpmAt(t: number): number;
}

const MIN_BPM = 20;
const MAX_BPM = 300;

export function createBeatClock(now: () => number, bpm = 110): BeatClockEx {
  const segs: TempoSegment[] = [{ t0: now(), b0: 0, bpm: clampBpm(bpm) }];

  function clampBpm(v: number) {
    return Number.isFinite(v) ? Math.min(MAX_BPM, Math.max(MIN_BPM, v)) : 110;
  }
  function segAtTime(t: number): TempoSegment {
    let s = segs[0];
    for (let i = 1; i < segs.length; i++) if (segs[i].t0 <= t) s = segs[i];
    return s;
  }
  function segAtBeat(b: number): TempoSegment {
    let s = segs[0];
    for (let i = 1; i < segs.length; i++) if (segs[i].b0 <= b) s = segs[i];
    return s;
  }
  /** Quita tramos ya superados (conserva el vigente). */
  function prune(t: number) {
    while (segs.length > 1 && segs[1].t0 <= t) segs.shift();
  }
  function beatAt(t: number) {
    const s = segAtTime(t);
    return s.b0 + ((t - s.t0) * s.bpm) / 60;
  }
  function timeOfBeat(b: number) {
    const s = segAtBeat(b);
    return s.t0 + ((b - s.b0) * 60) / s.bpm;
  }

  const clock: BeatClockEx = {
    get bpm() {
      return segAtTime(now()).bpm;
    },
    set bpm(v: number) {
      clock.setTempo(v);
    },
    now,
    beatAt,
    timeOfBeat,
    bpmAt(t: number) {
      return segAtTime(t).bpm;
    },
    phase() {
      const b = beatAt(now());
      return b - Math.floor(b);
    },
    timeToNextBeat() {
      const t = now();
      const b = beatAt(t);
      return Math.max(0, timeOfBeat(Math.floor(b) + 1) - t);
    },
    beatIndex() {
      return Math.floor(beatAt(now()));
    },
    setTempo(nextBpm: number, atBeat?: number) {
      const t = now();
      prune(t);
      const v = clampBpm(nextBpm);
      const minBeat = Math.floor(beatAt(t)) + 1;
      const b = Math.max(minBeat, Math.ceil(atBeat ?? minBeat));
      // Los tramos que empiezan en b o después se sustituyen.
      while (segs.length > 1 && segs[segs.length - 1].b0 >= b) segs.pop();
      const last = segs[segs.length - 1];
      if (last.bpm === v) return;
      segs.push({ t0: timeOfBeat(b), b0: b, bpm: v });
    },
    shift(dt: number) {
      for (const s of segs) s.t0 += dt;
    },
  };
  return clock;
}
