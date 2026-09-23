import type {
  ChaosConfig,
  ChaosDirectorAPI,
  ChaosEvent,
  ChaosEventKind,
  Difficulty,
  StepType,
} from '../core/contracts';
import { clamp, lerp } from '../core/math';
import { createRng } from '../core/rng';

/**
 * Director de Caos (determinista con la semilla).
 * - Intervalo base 20–35 s (Especialista); Residente ×1,4; Jefe ×0,8.
 * - Adaptativo ±30 %: Éxito mínimo reciente bajo → menos eventos (intervalo más largo).
 * - Simultaneidad: Residente 1; Especialista 1 (2 si el caso permite ≥ 5 tipos, "desde la
 *   semana 5"); Jefe 2. La mirada de Valerio es periódica y no cuenta.
 * - Tras un evento fuerte (solo, selfie, Panchito) hay un valle de 15–20 s.
 * - Nada en tutorial, ni con la lista vacía, ni durante un paro.
 * - Misericordia: no hay solo de guitarra con el campo > 80 % ni eventos nuevos con Éxito < 20.
 */

export const GAP_MULT: Record<Difficulty, number> = { residente: 1.4, especialista: 1, jefe: 0.8 };
export const STRONG_EVENTS: readonly ChaosEventKind[] = ['rodrigoSolo', 'gigiSelfie', 'panchitoIntrusion'];

/** Duraciones máximas (s). El solo depende de la intensidad (4–6 s base, hasta 12). */
export const CHAOS_DURATION: Record<ChaosEventKind, number> = {
  rodrigoSolo: 12,
  gigiSelfie: 15,
  fritzTremorSpike: 10,
  panchitoIntrusion: 8,
  hortensiaCall: 6,
  braulioFoil: 10,
  valerioGaze: 6,
};

const INTENSITY_RANGE: Record<Difficulty, [number, number]> = {
  residente: [0.2, 0.5],
  especialista: [0.4, 0.8],
  jefe: [0.6, 1],
};

const BASE_WEIGHT: Record<Exclude<ChaosEventKind, 'valerioGaze'>, number> = {
  rodrigoSolo: 1,
  gigiSelfie: 1,
  fritzTremorSpike: 1,
  panchitoIntrusion: 0.7,
  braulioFoil: 0.8,
  hortensiaCall: 0.8,
};

/** Afinidad de cada interferencia con el paso activo (flavor). */
function stepAffinity(kind: ChaosEventKind, step: StepType | null): number {
  switch (kind) {
    case 'rodrigoSolo':
      return step === 'hemostasis' ? 2.5 : 1; // su fase favorita
    case 'fritzTremorSpike':
      return step === 'plate' || step === 'screws' || step === 'drillPins' ? 2.5 : 1;
    case 'gigiSelfie':
      return step === 'suture' || step === 'bandage' ? 1.5 : 1;
    case 'hortensiaCall':
      return step === 'saw' ? 1.5 : 1; // la sierra dispara su histeria
    default:
      return 1;
  }
}

export function maxSimultaneous(cfg: Pick<ChaosConfig, 'difficulty' | 'allowed'>): number {
  if (cfg.difficulty === 'residente') return 1;
  if (cfg.difficulty === 'jefe') return 2;
  return cfg.allowed.length >= 5 ? 2 : 1;
}

/** Multiplicador adaptativo del intervalo (0,7..1,3). */
export function adaptiveGapMult(recentMinExito: number[]): number {
  const recent = recentMinExito.slice(-3).filter((v) => Number.isFinite(v));
  if (recent.length === 0) return 1;
  const m = recent.reduce((a, b) => a + b, 0) / recent.length;
  return lerp(1.3, 0.7, clamp((m - 30) / 50, 0, 1));
}

export function createChaosDirector(cfg: ChaosConfig): ChaosDirectorAPI {
  const rng = createRng(cfg.seed);
  const rand = (a: number, b: number) => a + (b - a) * rng();
  const enabled = !cfg.tutorial && cfg.allowed.length > 0;
  const gazeEnabled = enabled && cfg.allowed.includes('valerioGaze');
  const pool = cfg.allowed.filter((k): k is Exclude<ChaosEventKind, 'valerioGaze'> => k !== 'valerioGaze');
  const gapMult = GAP_MULT[cfg.difficulty] * (cfg.adaptive ? adaptiveGapMult(cfg.recentMinExito) : 1);
  const maxSim = maxSimultaneous(cfg);
  const gazeMult = cfg.difficulty === 'jefe' ? 0.5 : 1; // en Jefe, Valerio mira el doble
  const [iLo, iHi] = INTENSITY_RANGE[cfg.difficulty];

  const nextGap = () => rand(20, 35) * gapMult;
  const nextGazeGap = () => rand(25, 40) * gazeMult;

  let t = 0;
  let nextId = 1;
  let nextAt = enabled ? nextGap() * 0.7 : Infinity;
  let nextGazeAt = gazeEnabled ? nextGazeGap() : Infinity;
  let valleyUntil = 0;
  const activeList: ChaosEvent[] = [];
  const resolved = new Set<number>();
  // Resultados reutilizados (válidos hasta la siguiente llamada a update).
  const started: ChaosEvent[] = [];
  const ended: ChaosEvent[] = [];
  const weights: number[] = [];

  function start(kind: ChaosEventKind): ChaosEvent {
    const intensity = rand(iLo, iHi);
    let duration = CHAOS_DURATION[kind];
    if (kind === 'rodrigoSolo') duration = Math.min(CHAOS_DURATION.rodrigoSolo, rand(4, 6) * (1 + intensity));
    const ev: ChaosEvent = { id: nextId++, kind, start: t, duration, intensity };
    activeList.push(ev);
    started.push(ev);
    return ev;
  }

  function end(i: number) {
    const ev = activeList[i];
    activeList.splice(i, 1);
    ended.push(ev);
    if (STRONG_EVENTS.includes(ev.kind)) {
      valleyUntil = Math.max(valleyUntil, t + rand(15, 20));
      nextAt = Math.max(nextAt, valleyUntil);
    }
  }

  function countTowardLimit(): number {
    let c = 0;
    for (const ev of activeList) if (ev.kind !== 'valerioGaze') c++;
    return c;
  }

  function pickKind(perf: { fieldLevelPct: number; stepType: StepType | null }): ChaosEventKind | null {
    let total = 0;
    weights.length = 0;
    for (const k of pool) {
      let w = BASE_WEIGHT[k] * stepAffinity(k, perf.stepType);
      if (activeList.some((e) => e.kind === k)) w = 0;
      if (k === 'rodrigoSolo' && perf.fieldLevelPct > 80) w = 0;
      weights.push(w);
      total += w;
    }
    if (total <= 0) return null;
    let r = rng() * total;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r < 0 && weights[i] > 0) return pool[i];
    }
    for (let i = pool.length - 1; i >= 0; i--) if (weights[i] > 0) return pool[i];
    return null;
  }

  return {
    update(dt, perf) {
      started.length = 0;
      ended.length = 0;
      if (dt > 0) t += dt;

      // Fin de interferencias: primero las resueltas, luego las que caducan.
      for (let i = activeList.length - 1; i >= 0; i--) {
        const ev = activeList[i];
        if (resolved.has(ev.id) || t >= ev.start + ev.duration) end(i);
      }
      resolved.clear();

      if (!enabled) return { started, ended };
      if (perf.arrest) {
        // Durante el paro no empieza nada; al volver hay unos segundos de respiro.
        nextAt = Math.max(nextAt, t + 8);
        nextGazeAt = Math.max(nextGazeAt, t + 8);
        return { started, ended };
      }

      if (gazeEnabled && t >= nextGazeAt) {
        if (!activeList.some((e) => e.kind === 'valerioGaze')) start('valerioGaze');
        nextGazeAt = t + CHAOS_DURATION.valerioGaze + nextGazeGap();
      }

      if (pool.length > 0 && t >= nextAt && t >= valleyUntil) {
        if (countTowardLimit() < maxSim && perf.exito >= 20) {
          const kind = pickKind(perf);
          if (kind) {
            start(kind);
            nextAt = t + nextGap();
          } else nextAt = t + 3;
        } else {
          nextAt = t + rand(4, 8);
        }
      }
      return { started, ended };
    },

    active() {
      return activeList;
    },

    resolve(id) {
      if (activeList.some((e) => e.id === id)) resolved.add(id);
    },
  };
}
