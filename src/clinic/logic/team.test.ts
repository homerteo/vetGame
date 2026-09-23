import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/rng';
import { assign, consentActive, createTeam, dragAway, isWorking, moraleOf, pickDragVictim, tickTeam, type TeamEvent } from './team';
import { TUNING } from './tuning';

const env = { autoclaveFoiled: false, rng: createRng(1) };

function run(t: ReturnType<typeof createTeam>, seconds: number, e = env, dt = 0.5): TeamEvent[] {
  const all: TeamEvent[] = [];
  const out: TeamEvent[] = [];
  for (let s = 0; s < seconds; s += dt) {
    out.length = 0;
    tickTeam(t, dt, e, out);
    all.push(...out);
  }
  return all;
}

describe('equipo', () => {
  it('Fritz produce un juego estéril cada 40 s, máximo 3', () => {
    const t = createTeam();
    assign(t, 'fritz', 'kind');
    t.a.fritz.atStation = true;
    const ev = run(t, 41);
    expect(t.sterileSets).toBe(1);
    expect(ev).toContain('set');
    run(t, 200);
    expect(t.sterileSets).toBe(TUNING.team.maxSets);
  });

  it('el aluminio de Braulio detiene el autoclave', () => {
    const t = createTeam();
    assign(t, 'fritz', 'kind');
    t.a.fritz.atStation = true;
    run(t, 100, { ...env, autoclaveFoiled: true });
    expect(t.sterileSets).toBe(0);
  });

  it('no produce hasta llegar a su puesto', () => {
    const t = createTeam();
    assign(t, 'fritz', 'kind');
    run(t, 60);
    expect(t.sterileSets).toBe(0);
  });

  it('Rodrigo lleva el rasurado a 1 en 60 s; sin él el tope es 0,4', () => {
    const a = createTeam();
    assign(a, 'rodrigo', 'kind');
    a.a.rodrigo.atStation = true;
    run(a, 30);
    expect(a.prepQuality).toBeCloseTo(0.5, 2);
    const ev = run(a, 31);
    expect(a.prepQuality).toBe(1);
    expect(ev).toContain('prepFull');

    const b = createTeam();
    run(b, 400);
    expect(b.prepQuality).toBeCloseTo(TUNING.team.unassignedPrepCap, 5);
  });

  it('la Orden de Dómina cuesta Reserva, baja la moral y acelera', () => {
    const t = createTeam();
    const r = assign(t, 'rodrigo', 'domina')!;
    expect(r.reserveCost).toBe(TUNING.emiliana.dominaCost);
    expect(t.a.rodrigo.morale).toBe(TUNING.morale.base + TUNING.morale.domina);
    t.a.rodrigo.atStation = true;
    run(t, 30);
    expect(t.prepQuality).toBeGreaterThan(0.6);
    const k = createTeam();
    const rk = assign(k, 'fritz', 'kind')!;
    expect(rk.reserveCost).toBe(0);
    expect(k.a.fritz.morale).toBe(TUNING.morale.base + TUNING.morale.kind);
    expect(assign(k, 'fritz', 'kind')).toBeNull();
  });

  it('a Fritz la Dómina le sienta peor', () => {
    const t = createTeam();
    assign(t, 'fritz', 'domina');
    expect(t.a.fritz.morale).toBe(TUNING.morale.base + TUNING.morale.fritzDomina);
  });

  it('Gigi sin asignar graba TikToks y pierde moral', () => {
    const t = createTeam();
    const ev = run(t, 60);
    expect(ev).toContain('filmStart');
    expect(t.filmingSec).toBeGreaterThan(0);
    expect(t.a.gigi.morale).toBeLessThan(TUNING.morale.base);
  });

  it('Gigi ignora la petición amable mientras graba (termina su TikTok)', () => {
    const t = createTeam();
    t.a.gigi.filming = true;
    t.a.gigi.filmLeft = 5;
    const r = assign(t, 'gigi', 'kind')!;
    expect(r.ignoredWhileFilming).toBe(true);
    expect(r.delay).toBeGreaterThan(0);
    t.a.gigi.atStation = true;
    expect(isWorking(t.a.gigi)).toBe(false);
    run(t, r.delay + 0.5);
    expect(isWorking(t.a.gigi)).toBe(true);
    expect(consentActive(t)).toBe(true);
    const d = createTeam();
    d.a.gigi.filming = true;
    d.a.gigi.filmLeft = 5;
    expect(assign(d, 'gigi', 'domina')!.delay).toBe(0);
    expect(d.a.gigi.filming).toBe(false);
  });

  it('el consentimiento se completa con Gigi en el mostrador', () => {
    const t = createTeam();
    assign(t, 'gigi', 'kind');
    t.a.gigi.atStation = true;
    const ev = run(t, TUNING.team.consentSec + 1);
    expect(t.consentDone).toBe(true);
    expect(ev).toContain('consentDone');
  });

  it('Hortensia arrastra a quien está trabajando y detiene su producción', () => {
    const t = createTeam();
    assign(t, 'fritz', 'kind');
    t.a.fritz.atStation = true;
    expect(pickDragVictim(t, createRng(3))).toBe('fritz');
    dragAway(t, 'fritz', 15);
    run(t, 14);
    expect(t.autoclaveProgress).toBe(0);
    expect(t.a.fritz.awayLeft).toBeGreaterThan(0);
  });

  it('la moral se redondea y se limita a 0..100', () => {
    const t = createTeam(50);
    const m = moraleOf(t);
    expect(m.fritz).toBe(100);
  });
});
