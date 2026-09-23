import { describe, expect, it } from 'vitest';
import { addHisteria, applyExplanation, applyTila, createOwner, explanationEffect, ownerCalmOf, tickOwner } from './owners';
import { TUNING } from './tuning';

const ctx = { tutorial: false, consentActive: false, gigiFilming: false };

function hortensia() {
  return createOwner({ id: 'h', kind: 'case', human: 'hortensia', name: 'Doña Hortensia', petName: 'Merengue', pet: 'poodle', temper: 'hysterical' });
}
function minor(patience = 100) {
  return createOwner({ id: 'm', kind: 'minor', human: 'ownerA', name: 'Sra. A', petName: 'Bola', pet: 'cat', temper: 'calm', patience });
}

describe('paciencia', () => {
  it('baja con el tiempo según el tipo y el temperamento', () => {
    const o = minor();
    for (let i = 0; i < 100; i++) tickOwner(o, 0.1, ctx);
    expect(o.patience).toBeCloseTo(100 - TUNING.patience.minorDrain * 0.8 * 10, 5);
  });

  it('el tutorial y el consentimiento la hacen bajar más despacio', () => {
    const a = minor();
    const b = minor();
    const c = minor();
    for (let i = 0; i < 100; i++) {
      tickOwner(a, 0.1, ctx);
      tickOwner(b, 0.1, { ...ctx, tutorial: true });
      tickOwner(c, 0.1, { ...ctx, consentActive: true });
    }
    expect(b.patience).toBeGreaterThan(a.patience);
    expect(c.patience).toBeGreaterThan(a.patience);
  });

  it('un caso menor sin paciencia se va (salvo en el tutorial)', () => {
    const o = minor(0.5);
    const ev = tickOwner(o, 5, ctx);
    expect(ev).toBe('left');
    expect(o.status).toBe('left');
    const t = minor(0.5);
    expect(tickOwner(t, 5, { ...ctx, tutorial: true })).toBeNull();
    expect(t.status).toBe('waiting');
  });

  it('avisa una vez cuando el caso menor se impacienta', () => {
    const o = minor(TUNING.patience.minorImpatientAt + 0.1);
    expect(tickOwner(o, 1, ctx)).toBe('impatient');
    expect(tickOwner(o, 1, ctx)).toBeNull();
  });

  it('la tila devuelve paciencia', () => {
    const o = minor(40);
    applyTila(o);
    expect(o.patience).toBe(40 + TUNING.patience.tila);
  });
});

describe('histeria de Hortensia', () => {
  it('solo Hortensia tiene medidor', () => {
    expect(hortensia().histeria).not.toBeNull();
    expect(minor().histeria).toBeNull();
  });

  it('sube con el tiempo y se desmaya al máximo; luego se recupera', () => {
    const o = hortensia();
    o.histeria = 99.95;
    expect(tickOwner(o, 1, ctx)).toBe('faint');
    expect(o.faintLeft).toBe(TUNING.histeria.faintSec);
    expect(o.faints).toBe(1);
    let ev = null;
    for (let t = 0; t < TUNING.histeria.faintSec + 1 && ev !== 'recover'; t += 0.5) ev = tickOwner(o, 0.5, ctx);
    expect(ev).toBe('recover');
    expect(o.histeria).toBe(TUNING.histeria.afterFaint);
  });

  it('los ladridos y la explicación técnica la disparan', () => {
    const o = hortensia();
    const h0 = o.histeria!;
    addHisteria(o, TUNING.histeria.bark);
    expect(o.histeria).toBe(h0 + TUNING.histeria.bark);
    const { event } = applyExplanation(o, 'technical');
    expect(event).toBeNull();
    expect(o.histeria).toBe(h0 + TUNING.histeria.bark + TUNING.histeria.technical);
  });

  it('la tila calma y protege un rato', () => {
    const o = hortensia();
    o.histeria = 80;
    applyTila(o);
    expect(o.histeria).toBe(80 - TUNING.histeria.tila);
    expect(o.tilaShield).toBe(TUNING.histeria.tilaShieldSec);
    const before = o.histeria!;
    tickOwner(o, 10, ctx);
    expect(o.histeria! - before).toBeCloseTo(TUNING.histeria.base * TUNING.histeria.shieldMult * 10, 5);
  });

  it('la explicación absurda calma y educa; la evasiva calma pero recorta la propina', () => {
    const abs = explanationEffect('absurd', true);
    expect(abs.histeria).toBeLessThan(0);
    expect(abs.education).toBeGreaterThan(0);
    const ev = explanationEffect('evasive', true);
    expect(ev.histeria).toBeLessThan(0);
    expect(ev.tipMult).toBeLessThan(1);
    expect(explanationEffect('technical', true).histeria).toBeGreaterThan(0);
  });

  it('la calma del dueño penaliza histeria y desmayos', () => {
    const o = hortensia();
    o.patience = 90;
    o.histeria = 60;
    expect(ownerCalmOf(o)).toBeCloseTo(0.4, 5);
    o.faints = 1;
    expect(ownerCalmOf(o)).toBeCloseTo(0.28, 5);
    const m = minor(70);
    expect(ownerCalmOf(m)).toBeCloseTo(0.7, 5);
  });
});
