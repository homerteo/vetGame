import { describe, expect, it } from 'vitest';
import type { GestureRecord } from '../core/contracts';
import {
  computeAudit,
  evaluateChallenge,
  leadershipScore,
  provisionalRank,
  RANK_MULTIPLIER,
  rankFromNota,
  timeScore,
  worstMomentsFrom,
  type ChallengeStats,
} from './Scoring';
import { makeAuditInput, makeCase } from './testing/fixtures';

const g = (quality: number): GestureRecord => ({ t: 0, label: 'g', quality, perfect: quality >= 0.9 });
/** Entrada que da exactamente 100 en todos los componentes. */
const perfect = () =>
  makeAuditInput({ gestures: [g(1)], exitoSamples: [100], bloodLostPct: 0, sterility: 100, elapsedSec: 100 });

describe('Scoring — componentes', () => {
  it('valores por defecto sin datos: T 70, E 60', () => {
    const r = computeAudit(makeAuditInput());
    expect(r.components.T).toBe(70);
    expect(r.components.E).toBe(60);
    expect(r.components.H).toBe(100);
    expect(r.components.S).toBe(100);
    expect(r.components.L).toBe(100);
    expect(r.components.t).toBe(100);
  });

  it('T = media de calidad × 100; E = 0,6·media + 0,4·mínimo', () => {
    const r = computeAudit(makeAuditInput({ gestures: [g(0.5), g(1)], exitoSamples: [80, 60, 40] }));
    expect(r.components.T).toBeCloseTo(75, 6);
    expect(r.components.E).toBeCloseTo(0.6 * 60 + 0.4 * 40, 6);
  });

  it('H = 100·(1 − min(1, perdida/30))', () => {
    expect(computeAudit(makeAuditInput({ bloodLostPct: 15 })).components.H).toBeCloseTo(50, 6);
    expect(computeAudit(makeAuditInput({ bloodLostPct: 45 })).components.H).toBe(0);
  });

  it('t: 100 hasta el objetivo, 40 en 2×, suelo 20; Jefe usa objetivo ×0,8', () => {
    expect(timeScore(300, 300)).toBe(100);
    expect(timeScore(450, 300)).toBeCloseTo(70, 6);
    expect(timeScore(600, 300)).toBeCloseTo(40, 6);
    expect(timeScore(5000, 300)).toBe(20);
    const caseDef = makeCase({ targetTimeSec: 300 });
    expect(computeAudit(makeAuditInput({ caseDef, elapsedSec: 280 })).components.t).toBe(100);
    expect(computeAudit(makeAuditInput({ caseDef, elapsedSec: 280, difficulty: 'jefe' })).components.t).toBeCloseTo(
      100 - (60 * 40) / 240,
      6,
    );
  });

  it('L: abandono, Dómina > 60 %, crisis y bonus de Firme y Dulce', () => {
    expect(leadershipScore({ kind: 4, domina: 6, firmSweet: 0, crises: 0, neglectSeconds: 0 })).toBe(100);
    // 100 % Dómina → −30
    expect(leadershipScore({ kind: 0, domina: 5, firmSweet: 0, crises: 0, neglectSeconds: 0 })).toBe(70);
    // 80 % → −15
    expect(leadershipScore({ kind: 1, domina: 4, firmSweet: 0, crises: 0, neglectSeconds: 0 })).toBeCloseTo(85, 6);
    // abandono topado en −40
    expect(leadershipScore({ kind: 1, domina: 0, firmSweet: 0, crises: 0, neglectSeconds: 100 })).toBe(60);
    expect(leadershipScore({ kind: 1, domina: 0, firmSweet: 0, crises: 2, neglectSeconds: 5 })).toBe(70);
    // firmSweet +2 c/u hasta +10 (y tope 100)
    expect(leadershipScore({ kind: 0, domina: 0, firmSweet: 3, crises: 1, neglectSeconds: 10 })).toBe(76);
    expect(leadershipScore({ kind: 0, domina: 0, firmSweet: 20, crises: 1, neglectSeconds: 10 })).toBe(80);
    expect(leadershipScore({ kind: 0, domina: 20, firmSweet: 0, crises: 10, neglectSeconds: 100 })).toBe(0);
  });

  it('nota ponderada exacta y +3 por reto', () => {
    const input = makeAuditInput({
      gestures: [g(0.8)],
      exitoSamples: [70],
      bloodLostPct: 6,
      sterility: 90,
      leadership: { kind: 5, domina: 0, firmSweet: 0, crises: 1, neglectSeconds: 0 },
      elapsedSec: 450,
    });
    const expected = 0.3 * 80 + 0.25 * 70 + 0.15 * 80 + 0.1 * 90 + 0.1 * 90 + 0.1 * 70;
    const r = computeAudit(input);
    expect(r.nota).toBeCloseTo(expected, 1);
    const r2 = computeAudit({
      ...input,
      challenge: { kind: 'noArrest', text: 'x' },
      challengeMet: true,
    });
    expect(r2.nota).toBeCloseTo(expected + 3, 1);
    expect(r2.challengeMet).toBe(true);
    // Sin reto no hay bonus aunque llegue challengeMet.
    expect(computeAudit({ ...input, challengeMet: true }).nota).toBeCloseTo(expected, 1);
  });

  it('nota limitada a 100', () => {
    const r = computeAudit({ ...perfect(), challenge: { kind: 'noArrest', text: 'x' }, challengeMet: true });
    expect(r.nota).toBe(100);
    expect(r.rank).toBe('S');
  });

  it('weakest es el componente más bajo', () => {
    expect(computeAudit(makeAuditInput({ sterility: 10 })).weakest).toBe('S');
    expect(computeAudit(makeAuditInput({ bloodLostPct: 29 })).weakest).toBe('H');
    expect(computeAudit(makeAuditInput({ elapsedSec: 9999 })).weakest).toBe('t');
  });
});

describe('Scoring — rangos y topes', () => {
  it('umbrales S ≥ 92, A ≥ 80, B ≥ 65, C ≥ 50', () => {
    expect(rankFromNota(92)).toBe('S');
    expect(rankFromNota(91.9)).toBe('A');
    expect(rankFromNota(80)).toBe('A');
    expect(rankFromNota(79.9)).toBe('B');
    expect(rankFromNota(65)).toBe('B');
    expect(rankFromNota(64.9)).toBe('C');
    expect(rankFromNota(50)).toBe('C');
    expect(rankFromNota(49.9)).toBe('F');
  });

  it('sin topes con una cirugía limpia', () => {
    const r = computeAudit(perfect());
    expect(r.rank).toBe('S');
    expect(r.cap).toBeNull();
  });

  it('falta crítica → sin S (máx. A)', () => {
    for (const f of ['plunge', 'iatrogenicFissure', 'cordTouch'] as const) {
      const r = computeAudit({ ...perfect(), faults: [f] });
      expect(r.rank).toBe('A');
      expect(r.cap?.rank).toBe('A');
      expect(r.cap?.reason).toMatch(/crítica/);
    }
    // Falta menor no limita.
    expect(computeAudit({ ...perfect(), faults: ['char', 'offPath'] }).rank).toBe('S');
  });

  it('paro o necrosis térmica → máx. B', () => {
    const a = computeAudit({ ...perfect(), arrestHappened: true });
    expect(a.rank).toBe('B');
    expect(a.cap).toEqual({ rank: 'B', reason: 'Hubo paro cardiorrespiratorio: máximo B.' });
    const n = computeAudit({ ...perfect(), faults: ['thermalNecrosis'] });
    expect(n.rank).toBe('B');
    expect(n.cap?.reason).toMatch(/Necrosis/);
  });

  it('implante contaminado → máx. C; Valerio al mando → F', () => {
    const c = computeAudit({ ...perfect(), faults: ['contaminatedImplant', 'thermalNecrosis'] });
    expect(c.rank).toBe('C');
    expect(c.cap?.reason).toMatch(/contaminado/);
    const f = computeAudit({ ...perfect(), valerioTookOver: true, arrestHappened: true });
    expect(f.rank).toBe('F');
    expect(f.cap?.reason).toMatch(/Valerio/);
    expect(f.coins.multiplier).toBe(0.2);
  });

  it('el tope solo se informa si de verdad baja el rango', () => {
    const r = computeAudit(makeAuditInput({ arrestHappened: true, sterility: 20, bloodLostPct: 30, elapsedSec: 9999 }));
    expect(rankFromNota(r.nota)).toBe(r.rank);
    expect(['C', 'F']).toContain(r.rank);
    expect(r.cap).toBeNull();
  });

  it('Jefe: la S exige cumplir el reto', () => {
    const base = { ...perfect(), difficulty: 'jefe' as const, challenge: { kind: 'noArrest' as const, text: 'x' } };
    const no = computeAudit({ ...base, challengeMet: false });
    expect(no.rank).toBe('A');
    expect(no.cap?.reason).toMatch(/Jefe/);
    expect(computeAudit({ ...base, challengeMet: true }).rank).toBe('S');
    // Especialista no lo exige.
    expect(computeAudit({ ...base, difficulty: 'especialista', challengeMet: false }).rank).toBe('S');
  });
});

describe('Scoring — monedas, retos, provisional', () => {
  it('multiplicadores y total = round(tarifa·mult + propina − costes), mínimo 0', () => {
    expect(RANK_MULTIPLIER).toEqual({ S: 2, A: 1.5, B: 1, C: 0.6, F: 0.2 });
    const r = computeAudit({ ...perfect(), tipHC: 30, costsHC: 55 });
    expect(r.coins).toEqual({ fee: 250, multiplier: 2, tip: 30, costs: 55, total: 475 });
    const f = computeAudit({ ...perfect(), valerioTookOver: true, costsHC: 500 });
    expect(f.coins.total).toBe(0);
    const c = computeAudit({ ...perfect(), faults: ['contaminatedImplant'], caseDef: makeCase({ feeHC: 125 }) });
    expect(c.coins.total).toBe(75);
  });

  it('worstMoments se recorta a 3', () => {
    const wm = [1, 2, 3, 4].map((t) => ({ t, label: `m${t}` }));
    expect(computeAudit(makeAuditInput({ worstMoments: wm })).worstMoments).toEqual(wm.slice(0, 3));
  });

  it('evaluateChallenge por tipo', () => {
    const s: ChallengeStats = {
      screwDrops: 0,
      elapsedSec: 200,
      targetSec: 300,
      dominaCount: 1,
      arrest: false,
      maxFieldPct: 69,
      carmShotsUsed: 3,
      carmShotsPlanned: 3,
    };
    expect(evaluateChallenge('noScrewDrops', s)).toBe(true);
    expect(evaluateChallenge('noScrewDrops', { ...s, screwDrops: 1 })).toBe(false);
    expect(evaluateChallenge('underTargetTime', s)).toBe(true);
    expect(evaluateChallenge('underTargetTime', { ...s, elapsedSec: 301 })).toBe(false);
    expect(evaluateChallenge('maxOneDomina', s)).toBe(true);
    expect(evaluateChallenge('maxOneDomina', { ...s, dominaCount: 2 })).toBe(false);
    expect(evaluateChallenge('noArrest', s)).toBe(true);
    expect(evaluateChallenge('noArrest', { ...s, arrest: true })).toBe(false);
    expect(evaluateChallenge('fieldNeverFlooded', s)).toBe(true);
    expect(evaluateChallenge('fieldNeverFlooded', { ...s, maxFieldPct: 70 })).toBe(false);
    expect(evaluateChallenge('noExtraCarm', s)).toBe(true);
    expect(evaluateChallenge('noExtraCarm', { ...s, carmShotsUsed: 4 })).toBe(false);
  });

  it('provisionalRank aproximado con topes por faltas', () => {
    expect(provisionalRank({ exitoAvg: 95, exitoMin: 90, techniqueAvg: 100, faults: [] })).toBe('S');
    expect(provisionalRank({ exitoAvg: 95, exitoMin: 90, techniqueAvg: 1, faults: [] })).toBe('S');
    expect(provisionalRank({ exitoAvg: 95, exitoMin: 90, techniqueAvg: 100, faults: ['plunge'] })).toBe('A');
    expect(provisionalRank({ exitoAvg: 30, exitoMin: 5, techniqueAvg: 40, faults: [] })).toBe('F');
    expect(provisionalRank({ exitoAvg: 95, exitoMin: 90, techniqueAvg: 100, faults: ['contaminatedImplant'] })).toBe('C');
    expect(provisionalRank({ exitoAvg: 95, exitoMin: 90, techniqueAvg: 100, faults: ['thermalNecrosis'] })).toBe('B');
    const mid = provisionalRank({ exitoAvg: 70, exitoMin: 60, techniqueAvg: 75, faults: ['char'] });
    expect(mid).toBe('B');
  });

  it('worstMomentsFrom: faltas más caras y gestos flojos', () => {
    const wm = worstMomentsFrom([
      { t: 1, kind: 'fault', label: 'Tejido carbonizado', value: -3 },
      { t: 2, kind: 'gesture', label: 'Sutura', data: { quality: 0.1 } },
      { t: 3, kind: 'fault', label: 'Fisura iatrogénica', value: -12 },
      { t: 4, kind: 'gesture', label: 'Incisión', data: { quality: 0.95 } },
      { t: 5, kind: 'fault', label: 'Fuera de la guía', value: -2 },
    ]);
    expect(wm.map((w) => w.label)).toEqual(['Fisura iatrogénica', 'Tejido carbonizado', 'Fuera de la guía']);
  });
});
