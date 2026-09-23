/** Cola de dueños: Paciencia (todos) e Histeria (Doña Hortensia). Lógica pura. */
import type { AnimalModelId, HumanId } from '../../core/contracts';
import { clamp } from '../../core/math';
import { TUNING } from './tuning';

export type OwnerKind = 'case' | 'minor';
export type OwnerStatus = 'waiting' | 'served' | 'left';
export type Temper = 'calm' | 'hysterical' | 'paranoid' | 'anxious' | 'stern';
export type ExplanationKind = 'absurd' | 'technical' | 'evasive';

export interface OwnerState {
  id: string;
  kind: OwnerKind;
  human: HumanId;
  name: string;
  petName: string;
  pet: AnimalModelId;
  temper: Temper;
  /** 0..100 */
  patience: number;
  /** 0..100 o null si no tiene medidor de Histeria. */
  histeria: number | null;
  status: OwnerStatus;
  /** Segundos restantes de desmayo (0 = consciente). */
  faintLeft: number;
  faints: number;
  tilaShield: number;
  /** Caso menor: qué se le hace a la mascota. */
  errand: string;
  complaintHeard: boolean;
  tilas: number;
}

export type OwnerEvent = 'left' | 'faint' | 'recover' | 'impatient' | null;

export interface OwnerTickCtx {
  tutorial: boolean;
  consentActive: boolean;
  gigiFilming: boolean;
}

export function createOwner(o: {
  id: string;
  kind: OwnerKind;
  human: HumanId;
  name: string;
  petName: string;
  pet: AnimalModelId;
  temper: Temper;
  patience?: number;
  errand?: string;
}): OwnerState {
  return {
    id: o.id,
    kind: o.kind,
    human: o.human,
    name: o.name,
    petName: o.petName,
    pet: o.pet,
    temper: o.temper,
    patience: o.patience ?? 100,
    histeria: o.human === 'hortensia' ? 15 : null,
    status: 'waiting',
    faintLeft: 0,
    faints: 0,
    tilaShield: 0,
    errand: o.errand ?? '',
    complaintHeard: false,
    tilas: 0,
  };
}

/** Avanza un dueño. Devuelve un evento cuando cambia de estado. */
export function tickOwner(o: OwnerState, dt: number, ctx: OwnerTickCtx): OwnerEvent {
  if (o.status !== 'waiting') return null;
  const P = TUNING.patience;
  let ev: OwnerEvent = null;

  // Paciencia
  let drain = o.kind === 'case' ? P.caseDrain : P.minorDrain;
  drain *= P.temper[o.temper] ?? 1;
  if (ctx.tutorial) drain *= P.tutorialMult;
  if (ctx.consentActive) drain *= P.consentMult;
  if (ctx.gigiFilming) drain *= P.filmingMult;
  if (o.faintLeft > 0) drain = 0;
  const before = o.patience;
  o.patience = clamp(o.patience - drain * dt, 0, 100);
  if (o.kind === 'minor' && before > P.minorImpatientAt && o.patience <= P.minorImpatientAt) ev = 'impatient';
  if (o.kind === 'minor' && o.patience <= 0 && !ctx.tutorial) {
    o.status = 'left';
    return 'left';
  }

  // Histeria
  if (o.histeria !== null) {
    const H = TUNING.histeria;
    if (o.faintLeft > 0) {
      o.faintLeft = Math.max(0, o.faintLeft - dt);
      if (o.faintLeft === 0) {
        o.histeria = H.afterFaint;
        return 'recover';
      }
      return ev;
    }
    o.tilaShield = Math.max(0, o.tilaShield - dt);
    let rise = H.base * (ctx.tutorial ? H.tutorialMult : 1);
    if (o.tilaShield > 0) rise *= H.shieldMult;
    o.histeria = clamp(o.histeria + rise * dt, 0, 100);
    if (o.histeria >= 100) {
      o.faintLeft = H.faintSec;
      o.faints++;
      return 'faint';
    }
  }
  return ev;
}

/** Sube la Histeria (ladrido, radiografía, explicación técnica). Devuelve 'faint' si se desmaya. */
export function addHisteria(o: OwnerState, amount: number): OwnerEvent {
  if (o.histeria === null || o.faintLeft > 0 || o.status !== 'waiting') return null;
  const mult = o.tilaShield > 0 && amount > 0 ? 0.5 : 1;
  o.histeria = clamp(o.histeria + amount * mult, 0, 100);
  if (o.histeria >= 100) {
    o.faintLeft = TUNING.histeria.faintSec;
    o.faints++;
    return 'faint';
  }
  return null;
}

/** Tila: calma a Hortensia o devuelve paciencia a cualquier dueño. */
export function applyTila(o: OwnerState): void {
  o.tilas++;
  o.patience = clamp(o.patience + TUNING.patience.tila, 0, 100);
  if (o.histeria !== null && o.faintLeft <= 0) {
    o.histeria = clamp(o.histeria - TUNING.histeria.tila, 0, 100);
    o.tilaShield = TUNING.histeria.tilaShieldSec;
  }
}

export interface ExplanationEffect {
  patience: number;
  histeria: number;
  education: number;
  /** Multiplicador de la propina al final (queja después). */
  tipMult: number;
  concentration: number;
}

/** Efectos de la explicación del diagnóstico (GDD §3.3). */
export function explanationEffect(kind: ExplanationKind, hasHisteria: boolean): ExplanationEffect {
  switch (kind) {
    case 'absurd':
      return { patience: 25, histeria: -TUNING.histeria.absurd, education: 2, tipMult: 1, concentration: TUNING.emiliana.absurd };
    case 'technical':
      return { patience: hasHisteria ? -10 : 5, histeria: TUNING.histeria.technical, education: 1, tipMult: 1, concentration: 0 };
    case 'evasive':
      return { patience: 20, histeria: -TUNING.histeria.evasive, education: 0, tipMult: TUNING.tip.evasiveMult, concentration: 0 };
  }
}

export function applyExplanation(o: OwnerState, kind: ExplanationKind): { effect: ExplanationEffect; event: OwnerEvent } {
  const effect = explanationEffect(kind, o.histeria !== null);
  o.patience = clamp(o.patience + effect.patience, 0, 100);
  let event: OwnerEvent = null;
  if (o.histeria !== null) {
    if (effect.histeria > 0) event = addHisteria(o, effect.histeria);
    else o.histeria = clamp(o.histeria + effect.histeria, 0, 100);
  }
  return { effect, event };
}

/** Calma del dueño del caso 0..1 (1 − penalización por Histeria/Paciencia). */
export function ownerCalmOf(o: OwnerState): number {
  let calm = o.patience / 100;
  if (o.histeria !== null) calm = Math.min(calm, 1 - o.histeria / 100) - 0.12 * o.faints;
  return clamp(calm, 0, 1);
}
