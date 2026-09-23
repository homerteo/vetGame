import { describe, expect, it } from 'vitest';
import { DrillPinsStep } from '../../DrillPins';
import { createFakeContext } from './fakeContext';
import { drillPinsScenario } from './scenarios';
import type { DrillPinsParams } from '../../../../core/contracts';

const DT = 1 / 60;

function setup(o: { fragile?: boolean } = {}) {
  const sc = drillPinsScenario();
  (sc.def.params as DrillPinsParams).fragile = o.fragile ?? false;
  const h = createFakeContext({ anatomy: sc.anatomy });
  const step = new DrillPinsStep(sc.def);
  step.begin(h.ctx);
  h.instrument = 'drill';
  /** Taladra un punto y suelta `lateSec` después de la salida. */
  const drillSpot = (x: number, y: number, pressure = 3, lateSec = 0.1) => {
    step.onPointerDown(h.ptr(x, y, { pressure }));
    let s = 0;
    while (step.current() && step.current()!.phase() !== 'breakthrough' && s < 20) {
      h.t += DT;
      s += DT;
      step.update(DT);
    }
    h.run(step, lateSec);
    step.onPointerUp(h.ptr(x, y, { buttons: 0 }));
  };
  return { h, step, drillSpot, spots: (sc.def.params as DrillPinsParams).spots };
}

describe('DrillPinsStep', () => {
  it('taladra los 4 puntos y coloca las agujas', () => {
    const { h, step, drillSpot, spots } = setup();
    for (const s of spots) drillSpot(s.x + 0.5, s.y);
    expect(step.isComplete()).toBe(true);
    expect(h.bone.implants.pins).toHaveLength(4);
    expect(h.bone.implants.pins.every((p) => p.kind === 'pin')).toBe(true);
    expect(h.wound.decals.filter((d) => d.kind === 'pin')).toHaveLength(4);
    expect(h.log.gestures().map((g) => g.label)).toEqual(['Aguja 1/4', 'Aguja 2/4', 'Aguja 3/4', 'Aguja 4/4']);
    expect(h.log.faults()).toEqual([]);
    expect(step.checklist()[0]).toEqual({ label: 'Insertar agujas (4/4)', done: true });
  });

  it('fuera de la tolerancia pide apuntar a la marca', () => {
    const { h, step } = setup();
    step.onPointerDown(h.ptr(80, 50));
    expect(step.current()).toBeNull();
    expect(h.hud.pops.at(-1)!.text).toBe('Apunta a la marca');
  });

  it('no soltar tras la salida → plunge, pero la aguja queda puesta', () => {
    const { h, step, drillSpot, spots } = setup();
    drillSpot(spots[0].x, spots[0].y, 3, 0.6);
    expect(h.log.faultCount('plunge')).toBe(1);
    expect(h.bone.implants.pins).toHaveLength(1);
    expect(h.log.gestures()[0].quality).toBeLessThan(0.6);
    expect(step.progress()).toBeCloseTo(0.25, 2);
  });

  it('hueso frágil (conejo) con presión 4 → fisura iatrogénica', () => {
    const { h, drillSpot, spots } = setup({ fragile: true });
    drillSpot(spots[0].x, spots[0].y, 4);
    expect(h.log.faultCount('iatrogenicFissure')).toBe(1);
  });

  it('medidores de profundidad y temperatura', () => {
    const { h, step, spots } = setup();
    step.onPointerDown(h.ptr(spots[0].x, spots[0].y));
    h.run(step, 1);
    const g = step.gauges();
    expect(g.map((x) => x.label)).toEqual(['Profundidad', 'Temperatura']);
    expect(g[0].value).toBeGreaterThan(0.5);
    expect(g[1].value).toBeGreaterThan(37);
    expect(step.hint().length).toBeLessThanOrEqual(90);
    step.end();
    expect(h.audio.activeLoops()).toHaveLength(0);
  });
});
