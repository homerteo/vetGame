import { describe, expect, it } from 'vitest';
import { createBleeding } from './Bleeding';
import { createBloodPool } from './BloodPool';
import { createVitals } from './Vitals';
import { makeAnatomy } from './testing/fixtures';

/** Pruebas de equilibrio: los módulos de sim juntos, como en el bucle del quirófano. */
function surgery(opts: { suction: number; arterial: boolean; seconds: number; weightKg?: number }) {
  const anatomy = makeAnatomy();
  const bleeding = createBleeding({ rateScale: 1 });
  const blood = createBloodPool({ window: anatomy.window });
  const vitals = createVitals({ species: 'dog', weightKg: opts.weightKg ?? 7, startExito: 60, hypothermiaRisk: false });
  bleeding.spawn({ x: 60, y: 50 }, 'venous', 0);
  bleeding.spawn({ x: 100, y: 48 }, 'capillary', 0);
  if (opts.arterial) bleeding.spawn({ x: 80, y: 52 }, 'arterial', 0);
  const dt = 1 / 20; // dt máximo del bucle (peor caso de estabilidad)
  let t = 0;
  let maxField = 0;
  let firstFlood = -1;
  for (let i = 0; i < opts.seconds / dt; i++) {
    t += dt;
    let emitted = 0;
    for (const e of bleeding.emit(dt, t, vitals.snapshot().hr)) {
      blood.add(e.bleeder.pos, e.amount);
      emitted += e.amount;
    }
    if (opts.suction > 0) blood.suction({ x: 80, y: 50 }, 10, opts.suction, dt);
    blood.step(dt);
    const field = blood.levelPct();
    maxField = Math.max(maxField, field);
    if (field >= 70 && firstFlood < 0) firstFlood = t;
    vitals.update(dt, { bleedPctPerSec: emitted / dt, fieldLevelPct: field, warming: false });
  }
  return { vitals: vitals.snapshot(), maxField, firstFlood, field: blood.levelPct() };
}

describe('Equilibrio de la simulación', () => {
  it('arterial sin aspiración inunda el campo en ~20–45 s', () => {
    const r = surgery({ suction: 0, arterial: true, seconds: 60 });
    expect(r.firstFlood).toBeGreaterThan(15);
    expect(r.firstFlood).toBeLessThan(45);
  });

  it('con la aspiración de Rodrigo (0,12 %BV/s) un venoso + capilar no inundan', { timeout: 20000 }, () => {
    const r = surgery({ suction: 0.12, arterial: false, seconds: 150 });
    expect(r.maxField).toBeLessThan(40);
    expect(r.vitals.alarms).toEqual([]);
  });

  it('una hemorragia arterial sin tratar durante 2 min causa hipotensión (y no antes de 1 min)', () => {
    const early = surgery({ suction: 0.12, arterial: true, seconds: 60 });
    expect(early.vitals.map).toBeGreaterThanOrEqual(60);
    const late = surgery({ suction: 0.12, arterial: true, seconds: 150 });
    expect(late.vitals.bloodLostPct).toBeGreaterThan(30);
    expect(late.vitals.map).toBeLessThan(60);
    expect(late.vitals.exito).toBeLessThan(60);
  }, 20000);

  it('el charco cuesta poco por paso (64×40)', () => {
    const blood = createBloodPool({ window: makeAnatomy().window });
    for (let i = 0; i < 30; i++) blood.add({ x: 30 + i * 3, y: 50 }, 0.1);
    for (let i = 0; i < 60; i++) blood.step(1 / 60); // calentamiento
    const n = 600;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) blood.step(1 / 60);
    const ms = (performance.now() - t0) / n;
    expect(ms).toBeLessThan(1.5); // holgura: la máquina de pruebas está compartida
  });
});
