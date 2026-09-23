import type { EventBus } from '../core/EventBus';
import type { FaultKind, GameEvents, GestureRecord, LogRecord, SurgeryLogAPI } from '../core/contracts';
import { clamp } from '../core/math';

/** Penalización estándar de Éxito por falta (GDD §5; las menores, afinadas aquí). */
export const FAULT_EXITO: Record<FaultKind, number> = {
  vesselCut: -5,
  thermalNecrosis: -8,
  plunge: -10,
  contaminatedImplant: -10,
  iatrogenicFissure: -12,
  char: -3,
  overRetraction: -3,
  strippedScrew: -4,
  cordTouch: -8,
  noTouchViolation: -4,
  screwDropped: -2,
  tightBandage: -3,
  wrongPlate: -3,
  malalignment: -5,
  offPath: -2,
};

export const FAULT_LABEL: Record<FaultKind, string> = {
  vesselCut: 'Vaso cortado',
  thermalNecrosis: 'Necrosis térmica del hueso',
  plunge: 'Broca atravesó de más',
  contaminatedImplant: 'Implante contaminado',
  iatrogenicFissure: 'Fisura iatrogénica',
  char: 'Tejido carbonizado',
  overRetraction: 'Separación excesiva',
  strippedScrew: 'Rosca del tornillo rota',
  cordTouch: 'Contacto con la médula',
  noTouchViolation: 'Tocaste una esquirla intocable',
  screwDropped: 'Tornillo al suelo',
  tightBandage: 'Vendaje demasiado apretado',
  wrongPlate: 'Placa equivocada',
  malalignment: 'Mala alineación',
  offPath: 'Fuera de la guía',
};

/** Faltas críticas: impiden la S (GDD §5). */
export const CRITICAL_FAULTS: readonly FaultKind[] = [
  'thermalNecrosis',
  'plunge',
  'contaminatedImplant',
  'iatrogenicFissure',
  'cordTouch',
];

export const PERFECT_THRESHOLD = 0.9;

/** Bonus de Éxito de un gesto perfecto: +1 (0,9) … +3 (1,0). */
export function perfectBonus(quality: number): number {
  const q = clamp(quality, PERFECT_THRESHOLD, 1);
  return Math.round((1 + 20 * (q - PERFECT_THRESHOLD)) * 10) / 10;
}

/** Extensión local: multiplicador de faltas (la Mirada de Valerio las cuenta doble). */
export interface SurgeryLogExt extends SurgeryLogAPI {
  setFaultMultiplier(mult: number): void;
}

export function createSurgeryLog(
  onExito: (delta: number, reason: string) => void,
  bus?: EventBus<GameEvents>,
): SurgeryLogExt {
  let now = 0;
  let faultMult = 1;
  const recs: LogRecord[] = [];
  const faultKinds: FaultKind[] = [];
  const gestureRecs: GestureRecord[] = [];

  return {
    setTime(t) {
      now = t;
    },

    setFaultMultiplier(mult) {
      faultMult = Number.isFinite(mult) && mult > 0 ? mult : 1;
    },

    gesture(label, quality) {
      const q = clamp(Number.isFinite(quality) ? quality : 0, 0, 1);
      const perfect = q >= PERFECT_THRESHOLD;
      gestureRecs.push({ t: now, label, quality: q, perfect });
      let value: number | undefined;
      if (perfect) {
        value = perfectBonus(q);
        onExito(value, `¡Perfecto! ${label}`);
      }
      recs.push({ t: now, kind: 'gesture', label, value, data: { quality: q, perfect } });
      bus?.emit('gesture', { label, quality: q, perfect });
    },

    fault(kind, detail) {
      const delta = FAULT_EXITO[kind] * faultMult;
      faultKinds.push(kind);
      const label = detail ? `${FAULT_LABEL[kind]} (${detail})` : FAULT_LABEL[kind];
      recs.push({ t: now, kind: 'fault', label, value: delta, data: { fault: kind, doubled: faultMult > 1 } });
      onExito(delta, FAULT_LABEL[kind]);
      bus?.emit('fault', detail ? { kind, detail } : { kind });
    },

    bonus(label, exitoDelta) {
      recs.push({ t: now, kind: 'bonus', label, value: exitoDelta });
      if (exitoDelta !== 0) onExito(exitoDelta, label);
      bus?.emit('bonus', { label, exitoDelta });
    },

    note(label, data) {
      recs.push(data ? { t: now, kind: 'note', label, data } : { t: now, kind: 'note', label });
    },

    records: () => recs.slice(),
    faults: () => faultKinds.slice(),
    gestures: () => gestureRecs.slice(),
  };
}
