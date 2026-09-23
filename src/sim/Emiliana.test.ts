import { describe, expect, it } from 'vitest';
import { createEmiliana } from './Emiliana';
import { baseEffects, makeEmilianaInit } from './testing/fixtures';
import type { EmilianaAPI } from '../core/contracts';

const calm = { fieldLevelPct: 0, valerioGazing: false, lowLight: false };
function run(e: EmilianaAPI, seconds: number, s = calm, dt = 0.05) {
  for (let i = 0; i < Math.round(seconds / dt); i++) e.update(dt, s);
}

describe('Emiliana — mandar', () => {
  it('costes: amable 0, Dómina 15, Firme y Dulce 5', () => {
    const e = createEmiliana(makeEmilianaInit({ reserve: 60 }));
    expect(e.command('kind')).toEqual({ allowed: true, reserveCost: 0, crisis: false });
    expect(e.command('domina')).toEqual({ allowed: true, reserveCost: 15, crisis: false });
    expect(e.command('firmSweet')).toEqual({ allowed: true, reserveCost: 5, crisis: false });
    expect(e.snapshot().reserve).toBe(40);
    expect(e.stats().commands).toEqual({ kind: 1, domina: 1, firmSweet: 1 });
  });

  it('fusta de pompón: Dómina cuesta 12', () => {
    const e = createEmiliana(makeEmilianaInit({ reserve: 60, effects: baseEffects({ dominaCost: 12 }) }));
    expect(e.command('domina').reserveCost).toBe(12);
    expect(e.snapshot().reserve).toBe(48);
  });

  it('Firme y Dulce bloqueada antes de la semana 4', () => {
    const e = createEmiliana(makeEmilianaInit({ firmSweetUnlocked: false }));
    expect(e.command('firmSweet').allowed).toBe(false);
    expect(e.stats().commands.firmSweet).toBe(0);
  });

  it('reserva a 0 → micro-crisis de 3 s: no manda y −15 de concentración', () => {
    const e = createEmiliana(makeEmilianaInit({ reserve: 20, concentration: 70 }));
    expect(e.command('domina').crisis).toBe(false);
    const r = e.command('domina');
    expect(r).toEqual({ allowed: true, reserveCost: 5, crisis: true });
    let s = e.snapshot();
    expect(s.crisis).toBe(true);
    expect(s.crisisLeft).toBe(3);
    expect(s.concentration).toBe(55);
    expect(e.command('kind')).toEqual({ allowed: false, reserveCost: 0, crisis: true });
    run(e, 2.9);
    expect(e.snapshot().crisis).toBe(true);
    run(e, 0.2);
    s = e.snapshot();
    expect(s.crisis).toBe(false);
    expect(e.command('kind').allowed).toBe(true);
    expect(e.stats().crises).toBe(1);
  });

  it('con la reserva en 0 no hay nueva crisis hasta recuperarla y volver a vaciarla', () => {
    const e = createEmiliana(makeEmilianaInit({ reserve: 15 }));
    e.command('domina'); // → 0, crisis
    run(e, 3.5);
    const r = e.command('domina');
    expect(r).toEqual({ allowed: false, reserveCost: 0, crisis: false });
    expect(e.stats().crises).toBe(1);
    // Mensaje: +35 de reserva, luego se vacía otra vez → nueva crisis.
    e.offerMessage();
    e.readMessage();
    expect(e.snapshot().reserve).toBe(35);
    e.command('domina');
    e.command('domina');
    expect(e.command('firmSweet').crisis).toBe(true);
    expect(e.stats().crises).toBe(2);
  });
});

describe('Emiliana — concentración y temblor', () => {
  it('estresores: campo > 50, mirada de Valerio, poca luz; regeneración +0,4/s en calma', () => {
    const e = createEmiliana(makeEmilianaInit({ concentration: 50 }));
    run(e, 10);
    expect(e.snapshot().concentration).toBeCloseTo(54, 1);
    run(e, 10, { fieldLevelPct: 90, valerioGazing: false, lowLight: false });
    expect(e.snapshot().concentration).toBeCloseTo(39, 1);
    run(e, 10, { fieldLevelPct: 40, valerioGazing: true, lowLight: true });
    expect(e.snapshot().concentration).toBeCloseTo(21, 1);
    run(e, 100, { fieldLevelPct: 90, valerioGazing: true, lowLight: true });
    expect(e.snapshot().concentration).toBe(0);
  });

  it('campo entre 50 y 80 escala el drenaje', () => {
    const e = createEmiliana(makeEmilianaInit({ concentration: 50 }));
    run(e, 10, { fieldLevelPct: 65, valerioGazing: false, lowLight: false });
    expect(e.snapshot().concentration).toBeCloseTo(42.5, 1);
  });

  it('Pulso Firme: −5/s', () => {
    const e = createEmiliana(makeEmilianaInit({ concentration: 80 }));
    e.setPrecision(true);
    run(e, 4);
    expect(e.snapshot().precision).toBe(true);
    expect(e.snapshot().concentration).toBeCloseTo(60, 1);
  });

  it('stress y respiración', () => {
    const e = createEmiliana(makeEmilianaInit({ concentration: 50 }));
    e.stress(12, 'Valerio carraspea');
    expect(e.snapshot().concentration).toBe(38);
    e.breathingDone(1);
    expect(e.snapshot().concentration).toBe(58);
    e.breathingDone(0.5);
    expect(e.snapshot().concentration).toBe(68);
    e.breathingDone(5);
    expect(e.snapshot().concentration).toBe(88);
  });

  it('temblor base 0,15 mm y creciente por debajo de 40 hasta ~1,6 mm', () => {
    expect(createEmiliana(makeEmilianaInit({ concentration: 80 })).tremorMm()).toBeCloseTo(0.15, 6);
    expect(createEmiliana(makeEmilianaInit({ concentration: 40 })).tremorMm()).toBeCloseTo(0.15, 6);
    const t20 = createEmiliana(makeEmilianaInit({ concentration: 20 })).tremorMm();
    const t0 = createEmiliana(makeEmilianaInit({ concentration: 0 })).tremorMm();
    expect(t20).toBeGreaterThan(0.15);
    expect(t20).toBeLessThan(t0);
    expect(t0).toBeCloseTo(1.6, 6);
  });

  it('modificadores: arnés menta ×0,9 bajo 40, micro ×2, tremorScale', () => {
    const arnes = createEmiliana(
      makeEmilianaInit({ concentration: 0, effects: baseEffects({ lowConcTremorMult: 0.9 }) }),
    ).tremorMm();
    expect(arnes).toBeCloseTo(1.44, 6);
    const arnesAlto = createEmiliana(
      makeEmilianaInit({ concentration: 90, effects: baseEffects({ lowConcTremorMult: 0.9 }) }),
    ).tremorMm();
    expect(arnesAlto).toBeCloseTo(0.15, 6);
    expect(createEmiliana(makeEmilianaInit({ concentration: 90, microMode: true })).tremorMm()).toBeCloseTo(0.3, 6);
    expect(createEmiliana(makeEmilianaInit({ concentration: 0, microMode: true, tremorScale: 0.5 })).tremorMm()).toBeCloseTo(1.6, 6);
    expect(createEmiliana(makeEmilianaInit({ tremorScale: 0 })).tremorMm()).toBe(0);
  });
});

describe('Emiliana — mensajes de la pareja', () => {
  it('ofrecer respeta maxMessages y no apila pendientes', () => {
    const e = createEmiliana(makeEmilianaInit({ maxMessages: 2 }));
    expect(e.offerMessage()).toBe(true);
    expect(e.offerMessage()).toBe(false); // ya hay uno pendiente
    e.readMessage();
    expect(e.offerMessage()).toBe(true);
    e.readMessage();
    expect(e.offerMessage()).toBe(false);
  });

  it('leer: +35 reserva, +25 concentración, 10 s de Pulso Sereno, rubor que decae', () => {
    const e = createEmiliana(makeEmilianaInit({ reserve: 30, concentration: 20 }));
    expect(e.readMessage()).toBeNull();
    e.offerMessage();
    let s = e.snapshot();
    expect(s.message.pending).toBe(true);
    expect(s.message.secondsLeft).toBe(20);
    expect(s.message.text).toBeNull();
    const m = e.readMessage();
    expect(m?.text).toBe('Buena niña, te espero con té. — Sam');
    s = e.snapshot();
    expect(s.reserve).toBe(65);
    expect(s.concentration).toBe(45);
    expect(s.serenoLeft).toBe(10);
    expect(s.blush).toBe(1);
    expect(s.message.showing).toBe(true);
    expect(s.message.text).toBe(m?.text);
    expect(e.tremorMm()).toBe(0);
    run(e, 10.1);
    s = e.snapshot();
    expect(s.serenoLeft).toBe(0);
    expect(s.blush).toBeLessThan(0.5);
    expect(s.message.showing).toBe(false);
    expect(e.tremorMm()).toBeGreaterThan(0);
    expect(e.stats().messagesRead).toBe(1);
  });

  it('caduca a los 20 s (30 con gargantilla) y se guarda para entre fases con mitad de efecto', () => {
    const e = createEmiliana(makeEmilianaInit({ reserve: 10, concentration: 10 }));
    e.offerMessage();
    run(e, 19.9);
    expect(e.snapshot().message.pending).toBe(true);
    run(e, 0.2);
    let s = e.snapshot();
    expect(s.message.pending).toBe(false);
    expect(s.message.stored).toBe(1);
    expect(e.readMessage(false)).toBeNull();
    const before = e.snapshot();
    const m = e.readMessage(true);
    expect(m).not.toBeNull();
    s = e.snapshot();
    expect(s.reserve - before.reserve).toBeCloseTo(17.5, 6);
    expect(s.concentration - before.concentration).toBeCloseTo(12.5, 6);
    expect(s.serenoLeft).toBe(5);
    expect(s.message.stored).toBe(0);

    const g = createEmiliana(makeEmilianaInit({ effects: baseEffects({ messageDurationSec: 30 }) }));
    g.offerMessage();
    run(g, 25);
    expect(g.snapshot().message.pending).toBe(true);
    run(g, 5.1);
    expect(g.snapshot().message.stored).toBe(1);
  });

  it('textos cíclicos deterministas con {nombre}', () => {
    const e = createEmiliana(
      makeEmilianaInit({ partner: { name: 'Alex', pronoun: 'él' }, messagePool: ['A {nombre}', 'B {nombre} {nombre}'] }),
    );
    const texts: string[] = [];
    for (let i = 0; i < 3; i++) {
      e.offerMessage();
      texts.push(e.readMessage()!.text);
    }
    expect(texts).toEqual(['A Alex', 'B Alex Alex', 'A Alex']);
  });

  it('banco vacío: usa mensajes de reserva cariñosos', () => {
    const e = createEmiliana(makeEmilianaInit({ messagePool: [] }));
    e.offerMessage();
    expect(e.readMessage()!.text).toContain('Sam');
  });

  it('la reserva no pasa de 100', () => {
    const e = createEmiliana(makeEmilianaInit({ reserve: 90, concentration: 95 }));
    e.offerMessage();
    e.readMessage();
    expect(e.snapshot().reserve).toBe(100);
    expect(e.snapshot().concentration).toBe(100);
  });
});
