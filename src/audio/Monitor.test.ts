import { describe, expect, it } from 'vitest';
import type { VitalsSnapshot } from '../core/contracts';
import { ALARM_PERIOD_HIGH, ALARM_PERIOD_MEDIUM, createMonitor, monitorMode, spo2ToPitch } from './Monitor';

const V = (o: Partial<VitalsSnapshot> = {}): VitalsSnapshot => ({
  hr: 60,
  spo2: 98,
  map: 80,
  etco2: 38,
  tempC: 38,
  bloodVolumePct: 100,
  bloodLostPct: 0,
  exito: 60,
  arrest: false,
  rhythm: 'sinus',
  alarms: [],
  ...o,
});

function rec() {
  const beeps: Array<[number, number]> = [];
  const alarms: Array<[number, boolean]> = [];
  const flats: Array<[boolean, number]> = [];
  const m = createMonitor({
    beep: (t, hz) => beeps.push([t, hz]),
    alarm: (t, h) => alarms.push([t, h]),
    flat: (on, _hz, t) => flats.push([on, t]),
  });
  const run = (from: number, to: number) => {
    for (let t = from; t < to; t += 0.025) m.tick(t, t + 0.1);
  };
  return { m, beeps, alarms, flats, run };
}

describe('spo2ToPitch', () => {
  it('880 Hz al 100%, 440 Hz al 80%, monótona', () => {
    expect(spo2ToPitch(100)).toBeCloseTo(880, 6);
    expect(spo2ToPitch(80)).toBeCloseTo(440, 6);
    expect(spo2ToPitch(90)).toBeCloseTo(440 * Math.SQRT2, 6);
    let last = 0;
    for (let s = 70; s <= 100; s++) {
      const p = spo2ToPitch(s);
      expect(p).toBeGreaterThan(last);
      last = p;
    }
  });
  it('acota fuera de rango y tolera NaN', () => {
    expect(spo2ToPitch(120)).toBeCloseTo(880, 6);
    expect(spo2ToPitch(10)).toBeCloseTo(spo2ToPitch(70), 6);
    expect(spo2ToPitch(Number.NaN)).toBeCloseTo(880, 6);
  });
});

describe('monitor', () => {
  it('pitidos al ritmo de la FC con el tono de la SpO2', () => {
    const r = rec();
    r.m.set(V({ hr: 60, spo2: 100 }), 0);
    r.run(0, 5);
    expect(r.beeps.length).toBeGreaterThanOrEqual(5);
    expect(r.beeps.length).toBeLessThanOrEqual(6);
    for (let i = 1; i < r.beeps.length; i++) expect(r.beeps[i][0] - r.beeps[i - 1][0]).toBeCloseTo(1, 6);
    expect(r.beeps[0][1]).toBeCloseTo(880, 3);
    const r2 = rec();
    r2.m.set(V({ hr: 120, spo2: 80 }), 0);
    r2.run(0, 5);
    expect(r2.beeps.length).toBeGreaterThanOrEqual(10);
    expect(r2.beeps[0][1]).toBeCloseTo(440, 3);
  });

  it('una subida de FC adelanta el siguiente pitido sin reiniciar el ritmo', () => {
    const r = rec();
    r.m.set(V({ hr: 30 }), 0);
    r.run(0, 0.3);
    const first = r.beeps[0][0];
    r.m.set(V({ hr: 150 }), 0.3);
    r.run(0.3, 2);
    expect(r.beeps[1][0] - first).toBeLessThanOrEqual(60 / 150 + 0.3);
  });

  it('sin pitidos repetidos ni ráfagas en ticks solapados', () => {
    const r = rec();
    r.m.set(V({ hr: 100 }), 0);
    for (let t = 0; t < 3; t += 0.01) r.m.tick(t, t + 0.1);
    const times = r.beeps.map((b) => b[0]);
    expect(new Set(times).size).toBe(times.length);
    expect(times.length).toBeLessThanOrEqual(6);
  });

  it('alarma con ritmo limitado cuando hay constantes fuera de rango', () => {
    const r = rec();
    r.m.set(V({ alarms: ['map', 'hr'] }), 0);
    r.run(0, 30);
    expect(r.alarms.length).toBeGreaterThanOrEqual(3);
    expect(r.alarms.length).toBeLessThanOrEqual(Math.ceil(30 / ALARM_PERIOD_MEDIUM) + 1);
    expect(r.alarms.every((a) => a[1] === false)).toBe(true);
    // sin alarmas → se calla
    r.alarms.length = 0;
    r.m.set(V(), 30);
    r.run(30, 50);
    expect(r.alarms.length).toBe(0);
  });

  it('paro en asistolia: tono plano + alarma alta, sin pitidos', () => {
    const r = rec();
    r.m.set(V({ arrest: true, rhythm: 'asystole', hr: 0 }), 0);
    r.run(0, 10);
    expect(monitorMode(V({ arrest: true, rhythm: 'asystole' }))).toBe('flat');
    expect(r.flats).toEqual([[true, 0]]);
    expect(r.beeps.length).toBe(0);
    expect(r.alarms.length).toBeGreaterThanOrEqual(3);
    expect(r.alarms.length).toBeLessThanOrEqual(Math.ceil(10 / ALARM_PERIOD_HIGH) + 1);
    expect(r.alarms.every((a) => a[1])).toBe(true);
    // recupera circulación: se apaga el tono plano y vuelven los pitidos
    r.m.set(V({ hr: 90 }), 10);
    r.run(10, 12);
    expect(r.flats[r.flats.length - 1][0]).toBe(false);
    expect(r.beeps.length).toBeGreaterThan(0);
  });

  it('paro en FV: sin pitidos ni tono plano, con alarma', () => {
    const r = rec();
    r.m.set(V({ arrest: true, rhythm: 'vfib', hr: 250 }), 0);
    r.run(0, 6);
    expect(r.beeps.length).toBe(0);
    expect(r.flats.length).toBe(0);
    expect(r.alarms.length).toBeGreaterThan(0);
  });

  it('null = silencio', () => {
    const r = rec();
    r.m.set(V({ arrest: true, rhythm: 'asystole' }), 0);
    r.m.set(null, 1);
    r.run(1, 10);
    expect(r.flats).toEqual([
      [true, 0],
      [false, 1],
    ]);
    expect(r.beeps.length).toBe(0);
    expect(r.alarms.filter((a) => a[0] > 1).length).toBe(0);
  });
});
