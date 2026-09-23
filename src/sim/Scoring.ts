import type {
  AuditInput,
  AuditResult,
  FaultKind,
  LogRecord,
  Rank,
  ValerioChallengeKind,
} from '../core/contracts';
import { clamp } from '../core/math';
import { CRITICAL_FAULTS, FAULT_LABEL } from './SurgeryLog';

/** Auditoría de Valerio (GDD §5, exacto). */

export const RANK_MULTIPLIER: Record<Rank, number> = { S: 2, A: 1.5, B: 1, C: 0.6, F: 0.2 };
export const RANK_ORDER: readonly Rank[] = ['F', 'C', 'B', 'A', 'S'];
export const RANK_THRESHOLDS: ReadonlyArray<[Rank, number]> = [
  ['S', 92],
  ['A', 80],
  ['B', 65],
  ['C', 50],
];
export const WEIGHTS = { T: 0.3, E: 0.25, H: 0.15, S: 0.1, L: 0.1, t: 0.1 } as const;
export const CHALLENGE_BONUS = 3;
/** Pérdida tolerable para la hemostasia (%BV). */
export const TOLERABLE_BLOOD_LOSS_PCT = 30;

export interface ChallengeStats {
  screwDrops: number;
  elapsedSec: number;
  targetSec: number;
  dominaCount: number;
  arrest: boolean;
  maxFieldPct: number;
  carmShotsUsed: number;
  carmShotsPlanned: number;
}

export const rankValue = (r: Rank) => RANK_ORDER.indexOf(r);
export const minRank = (a: Rank, b: Rank): Rank => (rankValue(a) <= rankValue(b) ? a : b);
export const maxRank = (a: Rank, b: Rank): Rank => (rankValue(a) >= rankValue(b) ? a : b);

export function rankFromNota(nota: number): Rank {
  for (const [r, th] of RANK_THRESHOLDS) if (nota >= th) return r;
  return 'F';
}

export function evaluateChallenge(kind: ValerioChallengeKind, s: ChallengeStats): boolean {
  switch (kind) {
    case 'noScrewDrops':
      return s.screwDrops === 0;
    case 'underTargetTime':
      return s.elapsedSec <= s.targetSec;
    case 'maxOneDomina':
      return s.dominaCount <= 1;
    case 'noArrest':
      return !s.arrest;
    case 'fieldNeverFlooded':
      return s.maxFieldPct < 70;
    case 'noExtraCarm':
      return s.carmShotsUsed <= s.carmShotsPlanned;
  }
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Componente de tiempo: 100 hasta el objetivo, lineal a 40 en 2×, suelo 20. */
export function timeScore(elapsedSec: number, targetSec: number): number {
  if (!(targetSec > 0)) return 100;
  if (elapsedSec <= targetSec) return 100;
  const v = 100 - (60 * (elapsedSec - targetSec)) / targetSec;
  return Math.max(20, v);
}

/** Liderazgo (GDD §5). */
export function leadershipScore(l: AuditInput['leadership']): number {
  const total = l.kind + l.domina + l.firmSweet;
  const share = total > 0 ? l.domina / total : 0;
  const dominaPenalty = share > 0.6 ? (30 * (Math.min(1, share) - 0.6)) / 0.4 : 0;
  const v =
    100 -
    Math.min(40, 2 * Math.max(0, l.neglectSeconds)) -
    dominaPenalty -
    10 * Math.max(0, l.crises) +
    Math.min(10, 2 * Math.max(0, l.firmSweet));
  return clamp(v, 0, 100);
}

interface CapCandidate {
  rank: Rank;
  reason: string;
}

function capsFor(input: {
  faults: FaultKind[];
  arrest: boolean;
  tookOver: boolean;
  jefeNeedsChallenge: boolean;
}): CapCandidate[] {
  const caps: CapCandidate[] = [];
  if (input.tookOver) caps.push({ rank: 'F', reason: 'Valerio tomó el control de la cirugía.' });
  if (input.faults.includes('contaminatedImplant'))
    caps.push({ rank: 'C', reason: 'Se implantó material contaminado: máximo C.' });
  if (input.arrest) caps.push({ rank: 'B', reason: 'Hubo paro cardiorrespiratorio: máximo B.' });
  if (input.faults.includes('thermalNecrosis'))
    caps.push({ rank: 'B', reason: 'Necrosis térmica del hueso: máximo B.' });
  const critical = input.faults.find((f) => CRITICAL_FAULTS.includes(f));
  if (critical) caps.push({ rank: 'A', reason: `Falta crítica (${FAULT_LABEL[critical].toLowerCase()}): sin S.` });
  if (input.jefeNeedsChallenge)
    caps.push({ rank: 'A', reason: 'En Jefe de Servicio, la S exige cumplir el reto de Valerio.' });
  return caps;
}

export function computeAudit(input: AuditInput): AuditResult {
  const T = input.gestures.length ? clamp(mean(input.gestures.map((g) => g.quality)) * 100, 0, 100) : 70;
  const samples = input.exitoSamples.filter((v) => Number.isFinite(v));
  const E = samples.length ? clamp(0.6 * mean(samples) + 0.4 * Math.min(...samples), 0, 100) : 60;
  const H = 100 * (1 - Math.min(1, Math.max(0, input.bloodLostPct) / TOLERABLE_BLOOD_LOSS_PCT));
  const S = clamp(input.sterility, 0, 100);
  const L = leadershipScore(input.leadership);
  const target = input.caseDef.targetTimeSec * (input.difficulty === 'jefe' ? 0.8 : 1);
  const t = timeScore(input.elapsedSec, target);

  const challengeMet = !!input.challenge && input.challengeMet;
  let nota =
    WEIGHTS.T * T + WEIGHTS.E * E + WEIGHTS.H * H + WEIGHTS.S * S + WEIGHTS.L * L + WEIGHTS.t * t +
    (challengeMet ? CHALLENGE_BONUS : 0);
  nota = Math.round(clamp(nota, 0, 100) * 10) / 10;

  const raw = rankFromNota(nota);
  const caps = capsFor({
    faults: input.faults,
    arrest: input.arrestHappened,
    tookOver: input.valerioTookOver,
    jefeNeedsChallenge: input.difficulty === 'jefe' && !!input.challenge && !challengeMet,
  });
  // Tope vinculante: el más restrictivo, si de verdad baja el rango.
  let binding: CapCandidate | null = null;
  for (const c of caps) if (!binding || rankValue(c.rank) < rankValue(binding.rank)) binding = c;
  let rank = raw;
  let cap: AuditResult['cap'] = null;
  if (binding && rankValue(binding.rank) < rankValue(raw)) {
    rank = binding.rank;
    cap = { rank: binding.rank, reason: binding.reason };
  }

  const multiplier = RANK_MULTIPLIER[rank];
  const fee = input.caseDef.feeHC;
  const tip = Math.max(0, input.tipHC);
  const costs = Math.max(0, input.costsHC);
  const total = Math.max(0, Math.round(fee * multiplier + tip - costs));

  const components = { T, E, H, S, L, t };
  const order = ['T', 'E', 'H', 'S', 'L', 't'] as const;
  let weakest: AuditResult['weakest'] = 'T';
  for (const k of order) if (components[k] < components[weakest]) weakest = k;

  return {
    components,
    nota,
    rank,
    cap,
    coins: { fee, multiplier, tip, costs, total },
    worstMoments: input.worstMoments.slice(0, 3),
    weakest,
    challengeMet,
  };
}

/**
 * Nota provisional aproximada para el HUD de Valerio. Lo aún no medido (H, S, L, t) se
 * estima a medio camino entre "correcto" (80) y el Éxito actual.
 */
export function provisionalRank(partial: {
  exitoAvg: number;
  exitoMin: number;
  techniqueAvg: number;
  faults: FaultKind[];
}): Rank {
  const T = clamp(partial.techniqueAvg <= 1 ? partial.techniqueAvg * 100 : partial.techniqueAvg, 0, 100);
  const E = clamp(0.6 * partial.exitoAvg + 0.4 * partial.exitoMin, 0, 100);
  let nota = WEIGHTS.T * T + WEIGHTS.E * E + (1 - WEIGHTS.T - WEIGHTS.E) * (0.5 * 80 + 0.5 * E);
  for (const f of partial.faults) nota -= CRITICAL_FAULTS.includes(f) ? 5 : 1.5;
  let rank = rankFromNota(clamp(nota, 0, 100));
  for (const c of capsFor({ faults: partial.faults, arrest: false, tookOver: false, jefeNeedsChallenge: false }))
    rank = minRank(rank, c.rank);
  return rank;
}

/** Los peores momentos de un registro: faltas más caras y gestos más flojos (< 0,5). */
export function worstMomentsFrom(records: LogRecord[], n = 3): Array<{ t: number; label: string }> {
  const scored: Array<{ t: number; label: string; score: number }> = [];
  for (const r of records) {
    if (r.kind === 'fault') scored.push({ t: r.t, label: r.label, score: r.value ?? -1 });
    else if (r.kind === 'gesture') {
      const q = typeof r.data?.quality === 'number' ? (r.data.quality as number) : 1;
      if (q < 0.5) scored.push({ t: r.t, label: `Gesto flojo: ${r.label}`, score: -(0.5 - q) * 4 });
    }
  }
  scored.sort((a, b) => a.score - b.score || a.t - b.t);
  return scored.slice(0, n).map(({ t, label }) => ({ t, label }));
}
