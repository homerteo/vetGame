import type {
  AssistantId,
  ChaosEventKind,
  CommandTone,
  FaultKind,
  InstrumentId,
  Rank,
  StepType,
  ValerioChallengeKind,
} from '../core/contracts';

/**
 * Listas en tiempo de ejecución de los tipos unión de los contratos.
 * `exhaustive<T>()` hace que el compilador falle si falta algún miembro.
 */
const exhaustive =
  <T extends string>() =>
  <const A extends readonly T[]>(list: A & ([T] extends [A[number]] ? unknown : never)): A =>
    list;

export const INSTRUMENT_IDS = exhaustive<InstrumentId>()([
  'scalpel10',
  'scalpel15',
  'cautery',
  'gelpi',
  'weitlaner',
  'kern',
  'drill',
  'saw',
  'burr',
  'plate',
  'screwdriver',
  'needleHolder',
  'bandage',
  'kwire',
  'forceps',
  'rasp',
  'carm',
  'hand',
]);

export const STEP_TYPES = exhaustive<StepType>()([
  'incision',
  'hemostasis',
  'retract',
  'reduction',
  'rotate',
  'saw',
  'burr',
  'drillPins',
  'plate',
  'screws',
  'pick',
  'clickTargets',
  'suture',
  'bandage',
]);

export const FAULT_KINDS = exhaustive<FaultKind>()([
  'vesselCut',
  'thermalNecrosis',
  'plunge',
  'contaminatedImplant',
  'iatrogenicFissure',
  'char',
  'overRetraction',
  'strippedScrew',
  'cordTouch',
  'noTouchViolation',
  'screwDropped',
  'tightBandage',
  'wrongPlate',
  'malalignment',
  'offPath',
]);

export const RANKS = exhaustive<Rank>()(['S', 'A', 'B', 'C', 'F']);

export const CHAOS_KINDS = exhaustive<ChaosEventKind>()([
  'rodrigoSolo',
  'gigiSelfie',
  'fritzTremorSpike',
  'panchitoIntrusion',
  'valerioGaze',
  'braulioFoil',
  'hortensiaCall',
]);

export const ASSISTANT_IDS = exhaustive<AssistantId>()(['rodrigo', 'fritz', 'gigi']);

export const COMMAND_TONES = exhaustive<CommandTone>()(['kind', 'domina', 'firmSweet']);

export const CHALLENGE_KINDS = exhaustive<ValerioChallengeKind>()([
  'noScrewDrops',
  'underTargetTime',
  'maxOneDomina',
  'noArrest',
  'fieldNeverFlooded',
  'noExtraCarm',
]);
