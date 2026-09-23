import { describe, expect, it } from 'vitest';
import type { ClinicCaseDef } from '../../core/contracts';
import { createContamination } from './contamination';
import { isPositive, splitTests, testResult, xrayHit } from './diagnosis';
import { createAngleAccumulator, createCoverage, createSmallCircleDetector, createStrokeCounter } from './gestures';
import { nextObjective, type ObjectiveSnapshot } from './objectives';
import { computeClinicOutcome, requiredDone, type OutcomeInput } from './outcome';
import { createOwner } from './owners';
import { createTeam } from './team';
import { TUNING } from './tuning';

function input(over: Partial<OutcomeInput> = {}): OutcomeInput {
  const owner = createOwner({ id: 'c', kind: 'case', human: 'braulio', name: 'Don Braulio', petName: 'Panchito', pet: 'chihuahua', temper: 'paranoid', patience: 80 });
  return {
    diagnosisChosen: 0,
    correctDiagnosis: 0,
    xrayMarked: true,
    requiredTests: [],
    testsDone: ['xray'],
    team: createTeam(),
    contamination: createContamination(),
    caseOwner: owner,
    explanation: 'absurd',
    minorCasesHC: 55,
    educationPoints: 3,
    emiliana: { concentration: 80, reserve: 90 },
    ...over,
  };
}

describe('resultado de la clínica', () => {
  it('calcula todos los campos', () => {
    const i = input();
    i.team.sterileSets = 2;
    i.team.prepQuality = 0.7333;
    i.contamination.values.or = 0.2;
    i.contamination.values.prep = 0.4;
    const o = computeClinicOutcome(i);
    expect(o.diagnosisCorrect).toBe(true);
    expect(o.xrayMarked).toBe(true);
    expect(o.requiredTestsDone).toBe(true);
    expect(o.sterileSets).toBe(2);
    expect(o.prepQuality).toBe(0.73);
    expect(o.contamination).toBe(0.4);
    expect(o.ownerCalm).toBe(0.8);
    expect(o.tipHC).toBe(Math.round(TUNING.tip.max * 0.8));
    expect(o.minorCasesHC).toBe(55);
    expect(o.educationPoints).toBe(3);
    expect(o.emilianaStart).toEqual({ concentration: Math.round(80 - 0.4 * TUNING.emiliana.contamination), reserve: 90 });
    expect(o.morale).toEqual({ rodrigo: TUNING.morale.base, fritz: TUNING.morale.base, gigi: TUNING.morale.base });
  });

  it('diagnóstico erróneo o ausente', () => {
    const wrong = computeClinicOutcome(input({ diagnosisChosen: 2 }));
    expect(wrong.diagnosisCorrect).toBe(false);
    expect(wrong.tipHC).toBe(Math.round(TUNING.tip.max * 0.8 * TUNING.tip.wrongDiagnosisMult));
    const none = computeClinicOutcome(input({ diagnosisChosen: null }));
    expect(none.diagnosisCorrect).toBe(false);
    expect(none.tipHC).toBe(0);
    expect(none.ownerCalm).toBeCloseTo(0.6, 5);
  });

  it('la explicación evasiva recorta la propina; el consentimiento suma calma', () => {
    const ev = computeClinicOutcome(input({ explanation: 'evasive' }));
    expect(ev.tipHC).toBe(Math.round(TUNING.tip.max * 0.8 * TUNING.tip.evasiveMult));
    const i = input();
    i.team.consentDone = true;
    expect(computeClinicOutcome(i).ownerCalm).toBe(0.9);
  });

  it('pruebas obligatorias', () => {
    expect(requiredDone(['thoracicXray'], ['xray'])).toBe(false);
    expect(computeClinicOutcome(input({ requiredTests: ['thoracicXray'] })).requiredTestsDone).toBe(false);
    expect(computeClinicOutcome(input({ requiredTests: ['thoracicXray'], testsDone: ['thoracicXray'] })).requiredTestsDone).toBe(true);
  });

  it('la concentración inicial nunca baja del mínimo', () => {
    const i = input({ emiliana: { concentration: 10, reserve: -5 } });
    const o = computeClinicOutcome(i);
    expect(o.emilianaStart.concentration).toBe(TUNING.emiliana.minConcentration);
    expect(o.emilianaStart.reserve).toBe(0);
  });
});

const CLINIC: ClinicCaseDef = {
  complaint: 'Cojea.',
  tests: ['drawer', 'xray', 'patella', 'thoracicXray'],
  keyTest: 'drawer',
  xrayLesion: { u: 0.2, v: 0.5, radius: 0.09 },
  diagnosisOptions: ['Rotura del ligamento cruzado craneal', 'Luxación patelar lateral', 'Esguince'],
  correctDiagnosis: 0,
  explanations: { absurd: 'a', technical: 't', evasive: 'e' },
  minorCases: 2,
  ownerTemper: 'calm',
};

describe('diagnóstico', () => {
  it('la prueba clave es positiva; las relacionadas con el diagnóstico también', () => {
    expect(isPositive(CLINIC, 'drawer')).toBe(true);
    expect(isPositive(CLINIC, 'patella')).toBe(false);
    const patellar = { ...CLINIC, keyTest: 'xray' as const, correctDiagnosis: 1 };
    expect(isPositive(patellar, 'patella')).toBe(true);
    expect(testResult(CLINIC, 'drawer', 'Tanque').note).toContain('Tanque');
    expect(testResult(CLINIC, 'thoracicXray', 'Tanque').stamp).toBe('NORMAL');
  });

  it('marca de radiografía dentro del radio', () => {
    expect(xrayHit({ u: 0.2, v: 0.5 }, CLINIC.xrayLesion)).toBe(true);
    expect(xrayHit({ u: 0.28, v: 0.5 }, CLINIC.xrayLesion)).toBe(true);
    expect(xrayHit({ u: 0.4, v: 0.5 }, CLINIC.xrayLesion)).toBe(false);
  });

  it('separa pruebas de camilla y de negatoscopio', () => {
    const s = splitTests(CLINIC);
    expect(s.table).toEqual(['drawer', 'patella']);
    expect(s.lightbox).toEqual(['xray', 'thoracicXray']);
  });
});

describe('gestos', () => {
  it('vaivenes horizontales', () => {
    const c = createStrokeCounter(20);
    for (const x of [0, 10, 25, 30, 5, 0, 30, 35, 10]) c.feed(x);
    expect(c.strokes).toBe(3);
  });

  it('ángulo acumulado alrededor de un centro', () => {
    const a = createAngleAccumulator(0, 0, 10, 100);
    for (let i = 0; i <= 64; i++) a.feed(Math.cos((i / 32) * Math.PI) * 50, Math.sin((i / 32) * Math.PI) * 50);
    expect(a.total).toBeCloseTo(Math.PI * 2, 1);
    a.feed(0, 0); // fuera del anillo: no cuenta
    expect(a.total).toBeCloseTo(Math.PI * 2, 1);
  });

  it('circulitos pequeños', () => {
    const d = createSmallCircleDetector(1);
    for (let i = 0; i <= 96; i++) d.feed(100 + Math.cos((i / 16) * Math.PI) * 15, 100 + Math.sin((i / 16) * Math.PI) * 15);
    expect(d.total).toBeGreaterThan(Math.PI * 5);
    const line = createSmallCircleDetector(1);
    for (let i = 0; i < 50; i++) line.feed(i * 4, 0);
    expect(line.total).toBeLessThan(0.01);
  });

  it('cobertura con máscara', () => {
    const c = createCoverage(10, 10, 100, 100, (u) => u < 0.5);
    c.mark(25, 50, 200);
    expect(c.fraction).toBe(1);
    const d = createCoverage(10, 10, 100, 100, () => true);
    d.mark(5, 5, 1);
    expect(d.fraction).toBeCloseTo(0.01, 5);
  });
});

function snap(over: Partial<ObjectiveSnapshot> = {}): ObjectiveSnapshot {
  return {
    tutorial: true,
    ownerId: 'case',
    ownerName: 'Don Braulio',
    petName: 'Panchito',
    complaintHeard: false,
    tablePending: ['crepitus', 'xray'],
    platesPending: [],
    requiredPending: [],
    diagnosed: false,
    minor: { id: 'm0', name: 'Doña Pili' },
    assigned: { fritz: false, rodrigo: false, gigi: false },
    foiled: null,
    holdingPanchito: false,
    panchitoZone: null,
    hortensiaHigh: false,
    carryingTila: false,
    tilaGiven: false,
    ...over,
  };
}

describe('objetivos', () => {
  it('el tutorial va en orden', () => {
    expect(nextObjective(snap()).id).toBe('talk');
    expect(nextObjective(snap({ complaintHeard: true })).id).toBe('exam');
    expect(nextObjective(snap({ complaintHeard: true, tablePending: [], platesPending: ['xray'] })).id).toBe('plates');
    const s = snap({ complaintHeard: true, tablePending: [] });
    expect(nextObjective(s).id).toBe('minor');
    s.minor = null;
    expect(nextObjective(s).id).toBe('assign-fritz');
    s.assigned = { fritz: true, rodrigo: true, gigi: true };
    expect(nextObjective(s).id).toBe('tila-get');
    s.carryingTila = true;
    expect(nextObjective(s).id).toBe('tila-give');
    s.tilaGiven = true;
    expect(nextObjective(s).id).toBe('diagnose');
    s.diagnosed = true;
    expect(nextObjective(s).id).toBe('or');
  });

  it('las urgencias mandan', () => {
    expect(nextObjective(snap({ foiled: 'autoclave' })).id).toBe('foil');
    expect(nextObjective(snap({ holdingPanchito: true })).id).toBe('carrier');
    const s = snap({ tutorial: false, panchitoZone: 'prep' });
    const o = nextObjective(s);
    expect(o.id).toBe('panchito');
    expect(o.urgent).toBe(true);
    expect(nextObjective(snap({ tutorial: false, hortensiaHigh: true })).id).toBe('tila-get');
  });

  it('fuera del tutorial prioriza diagnosticar antes que asignar', () => {
    const s = snap({ tutorial: false, complaintHeard: true, tablePending: [] });
    expect(nextObjective(s).id).toBe('diagnose');
    s.diagnosed = true;
    expect(nextObjective(s).id).toBe('assign-fritz');
  });
});
