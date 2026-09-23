import { describe, expect, it } from 'vitest';
import { adaptiveGapMult, CHAOS_DURATION, createChaosDirector, maxSimultaneous } from './ChaosDirector';
import type { ChaosConfig, ChaosDirectorAPI, ChaosEvent, ChaosEventKind, StepType } from '../core/contracts';

const ALL: ChaosEventKind[] = [
  'rodrigoSolo',
  'gigiSelfie',
  'fritzTremorSpike',
  'panchitoIntrusion',
  'valerioGaze',
  'braulioFoil',
  'hortensiaCall',
];

function cfg(over: Partial<ChaosConfig> = {}): ChaosConfig {
  return {
    allowed: ['rodrigoSolo', 'gigiSelfie', 'fritzTremorSpike'],
    difficulty: 'especialista',
    adaptive: false,
    recentMinExito: [],
    seed: 42,
    tutorial: false,
    ...over,
  };
}

interface Perf {
  exito: number;
  fieldLevelPct: number;
  arrest: boolean;
  stepType: StepType | null;
}
const okPerf: Perf = { exito: 70, fieldLevelPct: 20, arrest: false, stepType: 'hemostasis' };

/** Simula y registra inicios/fines copiados (los arrays devueltos se reutilizan). */
function simulate(d: ChaosDirectorAPI, seconds: number, perf: Perf | ((t: number) => Perf) = okPerf, dt = 0.1) {
  const started: ChaosEvent[] = [];
  const ended: Array<{ ev: ChaosEvent; t: number }> = [];
  let maxActive = 0;
  let t = 0;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    t += dt;
    const p = typeof perf === 'function' ? perf(t) : perf;
    const r = d.update(dt, p);
    started.push(...r.started.map((e) => ({ ...e })));
    for (const e of r.ended) ended.push({ ev: { ...e }, t });
    maxActive = Math.max(maxActive, d.active().filter((e) => e.kind !== 'valerioGaze').length);
  }
  return { started, ended, maxActive };
}

describe('ChaosDirector', () => {
  it('nada en tutorial ni con la lista vacía', () => {
    expect(simulate(createChaosDirector(cfg({ tutorial: true })), 600).started.length).toBe(0);
    expect(simulate(createChaosDirector(cfg({ allowed: [] })), 600).started.length).toBe(0);
  });

  it('determinista con la misma semilla; distinto con otra', () => {
    const a = simulate(createChaosDirector(cfg()), 400).started;
    const b = simulate(createChaosDirector(cfg()), 400).started;
    const c = simulate(createChaosDirector(cfg({ seed: 7 })), 400).started;
    expect(a.length).toBeGreaterThan(3);
    expect(a).toEqual(b);
    expect(c.map((e) => [e.kind, e.start])).not.toEqual(a.map((e) => [e.kind, e.start]));
  });

  it('solo tipos permitidos, ids incrementales e intensidad 0..1', () => {
    const { started } = simulate(createChaosDirector(cfg()), 600);
    started.forEach((e, i) => {
      expect(['rodrigoSolo', 'gigiSelfie', 'fritzTremorSpike']).toContain(e.kind);
      expect(e.id).toBe(i + 1);
      expect(e.intensity).toBeGreaterThanOrEqual(0);
      expect(e.intensity).toBeLessThanOrEqual(1);
    });
  });

  it('intervalos base de 20–35 s (Especialista) entre inicios', () => {
    const d = createChaosDirector(cfg({ allowed: ['fritzTremorSpike', 'braulioFoil', 'hortensiaCall'] }));
    const { started } = simulate(d, 1200);
    for (let i = 1; i < started.length; i++) {
      const gap = started[i].start - started[i - 1].start;
      expect(gap).toBeGreaterThanOrEqual(19.9);
      expect(gap).toBeLessThanOrEqual(35 + 8 + 0.2); // + posible reintento por simultaneidad
    }
  });

  it('Residente espacia más que Jefe', () => {
    const count = (difficulty: ChaosConfig['difficulty']) =>
      simulate(createChaosDirector(cfg({ difficulty, allowed: ['fritzTremorSpike', 'braulioFoil'] })), 1800).started
        .length;
    expect(count('residente')).toBeLessThan(count('especialista'));
    expect(count('especialista')).toBeLessThan(count('jefe'));
  });

  it('adaptativo ±30 %: Éxito reciente bajo → menos eventos', () => {
    expect(adaptiveGapMult([])).toBe(1);
    expect(adaptiveGapMult([10, 20, 15])).toBeCloseTo(1.3, 6);
    expect(adaptiveGapMult([90, 95, 85])).toBeCloseTo(0.7, 6);
    expect(adaptiveGapMult([55])).toBeCloseTo(1, 6);
    const n = (recent: number[]) =>
      simulate(
        createChaosDirector(cfg({ adaptive: true, recentMinExito: recent, allowed: ['fritzTremorSpike', 'braulioFoil'] })),
        1800,
      ).started.length;
    expect(n([10, 10, 10])).toBeLessThan(n([95, 95, 95]));
  });

  it('simultaneidad por dificultad', () => {
    expect(maxSimultaneous({ difficulty: 'residente', allowed: ALL })).toBe(1);
    expect(maxSimultaneous({ difficulty: 'especialista', allowed: ['rodrigoSolo'] })).toBe(1);
    expect(maxSimultaneous({ difficulty: 'especialista', allowed: ALL })).toBe(2);
    expect(maxSimultaneous({ difficulty: 'jefe', allowed: ['rodrigoSolo'] })).toBe(2);
    const res = simulate(createChaosDirector(cfg({ difficulty: 'residente', allowed: ALL })), 1800);
    expect(res.maxActive).toBeLessThanOrEqual(1);
    const jefe = simulate(createChaosDirector(cfg({ difficulty: 'jefe', allowed: ALL, seed: 3 })), 1800);
    expect(jefe.maxActive).toBeLessThanOrEqual(2);
  });

  it('duraciones según el tipo (solo 4–12 s)', () => {
    const { started } = simulate(createChaosDirector(cfg({ allowed: ALL, difficulty: 'jefe' })), 1800);
    for (const e of started) {
      if (e.kind === 'rodrigoSolo') {
        expect(e.duration).toBeGreaterThanOrEqual(4);
        expect(e.duration).toBeLessThanOrEqual(12);
      } else expect(e.duration).toBe(CHAOS_DURATION[e.kind]);
    }
    expect(CHAOS_DURATION).toMatchObject({
      gigiSelfie: 15,
      fritzTremorSpike: 10,
      panchitoIntrusion: 8,
      hortensiaCall: 6,
      braulioFoil: 10,
      valerioGaze: 6,
    });
  });

  it('terminan al caducar y se informan en ended', () => {
    const d = createChaosDirector(cfg({ allowed: ['hortensiaCall'] }));
    const { started, ended } = simulate(d, 300);
    expect(ended.length).toBeGreaterThan(0);
    const first = ended[0];
    expect(first.ev.id).toBe(started[0].id);
    expect(first.t - started[0].start).toBeCloseTo(6, 0);
  });

  it('resolve(id) lo termina en la siguiente actualización', () => {
    const d = createChaosDirector(cfg({ allowed: ['gigiSelfie'] }));
    let ev: ChaosEvent | null = null;
    for (let i = 0; i < 1000 && !ev; i++) ev = d.update(0.1, okPerf).started[0] ?? null;
    expect(ev?.kind).toBe('gigiSelfie');
    d.resolve(ev!.id);
    expect(d.active().length).toBe(1);
    const r = d.update(0.1, okPerf);
    expect(r.ended.map((e) => e.id)).toEqual([ev!.id]);
    expect(d.active().length).toBe(0);
    d.resolve(999); // id inexistente: sin efecto
    expect(d.update(0.1, okPerf).ended.length).toBe(0);
  });

  it('valle de 15–20 s tras un evento fuerte', () => {
    const d = createChaosDirector(cfg({ allowed: ['panchitoIntrusion', 'braulioFoil'], difficulty: 'jefe' }));
    const { started, ended } = simulate(d, 1800);
    let checked = 0;
    for (const e of ended) {
      if (e.ev.kind !== 'panchitoIntrusion') continue;
      const next = started.find((s) => s.start > e.t - 1e-9);
      if (next) {
        expect(next.start - e.t).toBeGreaterThanOrEqual(15 - 0.11);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(3);
  });

  it('mirada de Valerio periódica (25–40 s) que no cuenta para la simultaneidad', () => {
    const d = createChaosDirector(cfg({ allowed: ['valerioGaze', 'fritzTremorSpike'], difficulty: 'residente' }));
    const { started } = simulate(d, 600);
    const gazes = started.filter((e) => e.kind === 'valerioGaze');
    expect(gazes.length).toBeGreaterThanOrEqual(600 / 46 - 1);
    for (let i = 1; i < gazes.length; i++) {
      const gap = gazes[i].start - gazes[i - 1].start;
      expect(gap).toBeGreaterThanOrEqual(31 - 0.2);
      expect(gap).toBeLessThanOrEqual(46 + 0.2);
    }
    // Hubo fritz mientras miraba (no bloquea).
    const fritz = started.filter((e) => e.kind === 'fritzTremorSpike');
    expect(fritz.length).toBeGreaterThan(5);
  });

  it('en Jefe Valerio mira el doble de seguido', () => {
    const n = (difficulty: ChaosConfig['difficulty']) =>
      simulate(createChaosDirector(cfg({ allowed: ['valerioGaze'], difficulty })), 900).started.length;
    expect(n('jefe')).toBeGreaterThan(n('especialista') * 1.4);
  });

  it('nada nuevo durante el paro', () => {
    const d = createChaosDirector(cfg({ allowed: ALL }));
    const { started } = simulate(d, 600, { ...okPerf, arrest: true });
    expect(started.length).toBe(0);
  });

  it('misericordia: sin solo con el campo > 80 %', () => {
    const d = createChaosDirector(cfg({ allowed: ['rodrigoSolo', 'fritzTremorSpike'] }));
    const { started } = simulate(d, 1200, { ...okPerf, fieldLevelPct: 85 });
    expect(started.some((e) => e.kind === 'rodrigoSolo')).toBe(false);
    expect(started.length).toBeGreaterThan(0);
    const only = createChaosDirector(cfg({ allowed: ['rodrigoSolo'] }));
    expect(simulate(only, 600, { ...okPerf, fieldLevelPct: 85 }).started.length).toBe(0);
  });

  it('no repite un tipo mientras sigue activo', () => {
    const d = createChaosDirector(cfg({ allowed: ALL, difficulty: 'jefe', seed: 11 }));
    for (let i = 0; i < 18000; i++) {
      d.update(0.1, okPerf);
      const kinds = d.active().map((e) => e.kind);
      expect(new Set(kinds).size).toBe(kinds.length);
    }
  });
});
