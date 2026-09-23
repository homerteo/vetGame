/** Cálculo del resultado de la clínica que recibe el quirófano. Lógica pura. */
import type { ClinicOutcome, DiagnosticTest } from '../../core/contracts';
import { clamp } from '../../core/math';
import { contaminationOutcome, type ContaminationState } from './contamination';
import { ownerCalmOf, type ExplanationKind, type OwnerState } from './owners';
import { moraleOf, type TeamState } from './team';
import { TUNING } from './tuning';

export interface OutcomeInput {
  diagnosisChosen: number | null;
  correctDiagnosis: number;
  xrayMarked: boolean;
  requiredTests: DiagnosticTest[];
  testsDone: DiagnosticTest[];
  team: TeamState;
  contamination: ContaminationState;
  caseOwner: OwnerState;
  explanation: ExplanationKind | null;
  minorCasesHC: number;
  educationPoints: number;
  /** Medidores de Emiliana ya descontados por el estrés vivido en la clínica. */
  emiliana: { concentration: number; reserve: number };
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function requiredDone(required: DiagnosticTest[], done: DiagnosticTest[]): boolean {
  return required.every((t) => done.includes(t));
}

export function computeClinicOutcome(i: OutcomeInput): ClinicOutcome {
  const diagnosed = i.diagnosisChosen !== null;
  const diagnosisCorrect = diagnosed && i.diagnosisChosen === i.correctDiagnosis;
  const contamination = r2(contaminationOutcome(i.contamination));

  let ownerCalm = ownerCalmOf(i.caseOwner);
  if (i.team.consentDone) ownerCalm += 0.1;
  if (!diagnosed) ownerCalm -= 0.2;
  ownerCalm = r2(clamp(ownerCalm, 0, 1));

  let tip = 0;
  if (diagnosed) {
    tip = TUNING.tip.max * ownerCalm;
    if (i.explanation === 'evasive') tip *= TUNING.tip.evasiveMult;
    if (!diagnosisCorrect) tip *= TUNING.tip.wrongDiagnosisMult;
  }

  const E = TUNING.emiliana;
  const concentration = Math.round(
    clamp(i.emiliana.concentration - contamination * E.contamination, E.minConcentration, 100),
  );
  const reserve = Math.round(clamp(i.emiliana.reserve, 0, 100));

  return {
    diagnosisCorrect,
    xrayMarked: i.xrayMarked,
    requiredTestsDone: requiredDone(i.requiredTests, i.testsDone),
    sterileSets: i.team.sterileSets,
    prepQuality: r2(clamp(i.team.prepQuality, 0, 1)),
    contamination,
    ownerCalm,
    tipHC: Math.round(clamp(tip, 0, TUNING.tip.max)),
    minorCasesHC: Math.round(i.minorCasesHC),
    educationPoints: i.educationPoints,
    emilianaStart: { concentration, reserve },
    morale: moraleOf(i.team),
  };
}
