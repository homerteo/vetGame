/** Asignación del equipo a estaciones y su producción (juegos estériles, rasurado, consentimiento). Lógica pura. */
import type { AssistantId, CommandTone } from '../../core/contracts';
import { clamp } from '../../core/math';
import { TUNING } from './tuning';

export type TeamStation = 'autoclave' | 'prep' | 'consent';
export const ASSISTANTS: AssistantId[] = ['fritz', 'rodrigo', 'gigi'];
export const STATION_OF: Record<AssistantId, TeamStation> = { fritz: 'autoclave', rodrigo: 'prep', gigi: 'consent' };
export const ASSISTANT_OF: Record<TeamStation, AssistantId> = { autoclave: 'fritz', prep: 'rodrigo', consent: 'gigi' };

export interface AssistantState {
  id: AssistantId;
  assigned: boolean;
  tone: CommandTone | null;
  /** Lo pone la escena cuando el personaje llega a su puesto. */
  atStation: boolean;
  /** Segundos que Hortensia lo tiene abanicándola. */
  awayLeft: number;
  morale: number;
  boostLeft: number;
  /** Retraso antes de ir (Gigi termina su TikTok). */
  delayLeft: number;
  filming: boolean;
  filmTimer: number;
  filmLeft: number;
}

export interface TeamState {
  a: Record<AssistantId, AssistantState>;
  sterileSets: number;
  autoclaveProgress: number;
  prepQuality: number;
  consentProgress: number;
  consentDone: boolean;
  filmingSec: number;
  kindCount: number;
  dominaCount: number;
}

export type TeamEvent = 'set' | 'setsFull' | 'prepFull' | 'consentDone' | 'filmStart' | 'filmEnd' | 'arrived';

function mkAssistant(id: AssistantId, morale: number, filmTimer: number): AssistantState {
  return {
    id,
    assigned: false,
    tone: null,
    atStation: false,
    awayLeft: 0,
    morale,
    boostLeft: 0,
    delayLeft: 0,
    filming: false,
    filmTimer,
    filmLeft: 0,
  };
}

export function createTeam(moraleBonus = 0): TeamState {
  const m = clamp(TUNING.morale.base + moraleBonus, 0, 100);
  return {
    a: {
      fritz: mkAssistant('fritz', m, 0),
      rodrigo: mkAssistant('rodrigo', m, 0),
      gigi: mkAssistant('gigi', m, TUNING.team.gigiFilmEverySec[0] * 0.5),
    },
    sterileSets: 0,
    autoclaveProgress: 0,
    prepQuality: 0,
    consentProgress: 0,
    consentDone: false,
    filmingSec: 0,
    kindCount: 0,
    dominaCount: 0,
  };
}

export interface AssignResult {
  reserveCost: number;
  moraleDelta: number;
  /** Segundos antes de ponerse en marcha. */
  delay: number;
  ignoredWhileFilming: boolean;
}

/** Asigna un asistente a su estación con un tono. null si ya estaba asignado. */
export function assign(t: TeamState, id: AssistantId, tone: 'kind' | 'domina', dominaCost: number = TUNING.emiliana.dominaCost): AssignResult | null {
  const s = t.a[id];
  if (s.assigned) return null;
  s.assigned = true;
  s.tone = tone;
  let moraleDelta: number;
  let delay = 0;
  let ignored = false;
  if (tone === 'domina') {
    t.dominaCount++;
    moraleDelta = id === 'fritz' ? TUNING.morale.fritzDomina : TUNING.morale.domina;
    s.boostLeft = TUNING.team.dominaBoostSec;
    if (s.filming) {
      s.filming = false;
      s.filmLeft = 0;
    }
  } else {
    t.kindCount++;
    moraleDelta = TUNING.morale.kind;
    if (s.filming) {
      // Gigi ignora las peticiones amables mientras graba: termina su TikTok primero.
      delay = Math.min(TUNING.team.gigiFinishTikTokSec, Math.max(1.5, s.filmLeft));
      ignored = true;
    }
  }
  s.delayLeft = delay;
  s.morale = clamp(s.morale + moraleDelta, 0, 100);
  return { reserveCost: tone === 'domina' ? dominaCost : 0, moraleDelta, delay, ignoredWhileFilming: ignored };
}

/** ¿Está produciendo ahora mismo? */
export function isWorking(s: AssistantState): boolean {
  return s.assigned && s.atStation && s.awayLeft <= 0 && s.delayLeft <= 0;
}

/** Hortensia se desmaya y arrastra a este asistente a abanicarla. */
export function dragAway(t: TeamState, id: AssistantId, sec: number): void {
  const s = t.a[id];
  s.awayLeft = sec;
  s.atStation = false;
  s.filming = false;
  s.filmLeft = 0;
  s.morale = clamp(s.morale + TUNING.morale.draggedByHortensia, 0, 100);
}

/** Elige a quién arrastra Hortensia: primero alguien trabajando (el drama necesita público). */
export function pickDragVictim(t: TeamState, rng: () => number): AssistantId | null {
  const free = (['fritz', 'rodrigo', 'gigi'] as AssistantId[]).filter((id) => t.a[id].awayLeft <= 0);
  if (!free.length) return null;
  const working = free.filter((id) => isWorking(t.a[id]));
  const pool = working.length ? working : free;
  return pool[Math.floor(rng() * pool.length) % pool.length];
}

export interface TeamEnv {
  autoclaveFoiled: boolean;
  rng: () => number;
}

/** Avanza la producción del equipo. Los eventos se añaden a `out`. */
export function tickTeam(t: TeamState, dt: number, env: TeamEnv, out: TeamEvent[]): void {
  const T = TUNING.team;
  for (const id of ASSISTANTS) {
    const s = t.a[id];
    if (s.awayLeft > 0) s.awayLeft = Math.max(0, s.awayLeft - dt);
    if (s.boostLeft > 0) s.boostLeft = Math.max(0, s.boostLeft - dt);
    if (s.delayLeft > 0) {
      s.delayLeft = Math.max(0, s.delayLeft - dt);
      if (s.delayLeft === 0 && s.filming) {
        s.filming = false;
        s.filmLeft = 0;
        out.push('filmEnd');
      }
    }
    if (isWorking(s) && s.tone === 'kind') s.morale = clamp(s.morale + (TUNING.morale.workingPerMin / 60) * dt, 0, 100);
  }

  // Gigi sin asignar: TikToks periódicos
  const g = t.a.gigi;
  if (g.filming) {
    g.filmLeft -= dt;
    t.filmingSec += dt;
    g.morale = clamp(g.morale - TUNING.morale.gigiFilmingPerSec * dt, 0, 100);
    if (g.filmLeft <= 0 && g.delayLeft <= 0) {
      g.filming = false;
      g.filmLeft = 0;
      g.filmTimer = T.gigiFilmEverySec[0] + env.rng() * (T.gigiFilmEverySec[1] - T.gigiFilmEverySec[0]);
      out.push('filmEnd');
    }
  } else if (!g.assigned && g.awayLeft <= 0) {
    g.filmTimer -= dt;
    if (g.filmTimer <= 0) {
      g.filming = true;
      g.filmLeft = T.gigiFilmSec;
      out.push('filmStart');
    }
  }

  // Fritz: autoclave
  const f = t.a.fritz;
  if (isWorking(f) && !env.autoclaveFoiled && t.sterileSets < T.maxSets) {
    const mult = f.boostLeft > 0 ? T.dominaBoostMult : 1;
    t.autoclaveProgress += (dt / T.autoclaveCycleSec) * mult;
    if (t.autoclaveProgress >= 1) {
      t.autoclaveProgress = 0;
      t.sterileSets++;
      out.push(t.sterileSets >= T.maxSets ? 'setsFull' : 'set');
    }
  }

  // Rodrigo: rasurado y antisepsia
  const r = t.a.rodrigo;
  if (isWorking(r)) {
    if (t.prepQuality < 1) {
      const sec = r.tone === 'domina' ? T.prepSecDomina : T.prepSec;
      const mult = r.boostLeft > 0 ? T.dominaBoostMult : 1;
      t.prepQuality = Math.min(1, t.prepQuality + (dt / sec) * mult);
      if (t.prepQuality >= 1) out.push('prepFull');
    }
  } else if (!r.assigned && t.prepQuality < T.unassignedPrepCap) {
    // sin Rodrigo, alguien rasura a la carrera (tope 0,4)
    t.prepQuality = Math.min(T.unassignedPrepCap, t.prepQuality + (T.unassignedPrepCap / T.unassignedPrepSec) * dt);
  }

  // Gigi: consentimiento informado
  if (isWorking(g) && !t.consentDone) {
    t.consentProgress = Math.min(1, t.consentProgress + dt / T.consentSec);
    if (t.consentProgress >= 1) {
      t.consentDone = true;
      out.push('consentDone');
    }
  }
}

export function consentActive(t: TeamState): boolean {
  return isWorking(t.a.gigi);
}

export function moraleOf(t: TeamState): Record<AssistantId, number> {
  return {
    rodrigo: Math.round(t.a.rodrigo.morale),
    fritz: Math.round(t.a.fritz.morale),
    gigi: Math.round(t.a.gigi.morale),
  };
}
