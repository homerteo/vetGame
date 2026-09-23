import { describe, expect, it } from 'vitest';
import { BurrStep, CORD_STRESS } from '../../Burr';
import { createFakeContext } from './fakeContext';
import { burrScenario } from './scenarios';
import type { BurrParams } from '../../../../core/contracts';

const DT = 1 / 60;

function setup(instrument: 'burr' | 'rasp' = 'burr') {
  const sc = burrScenario();
  (sc.def.params as BurrParams).instrument = instrument;
  const h = createFakeContext({ anatomy: sc.anatomy });
  const step = new BurrStep(sc.def);
  step.begin(h.ctx);
  h.instrument = instrument;
  /** Barre el área (x 65..95, y 45..52) en filas, a ~25 mm/s. */
  const sweep = (maxSec = 30, irrigate = true) => {
    if (irrigate) step.onKey('KeyI', true);
    step.onPointerDown(h.ptr(66, 45.5));
    let s = 0;
    let row = 0;
    let x = 66;
    let dir = 1;
    while (!step.isComplete() && s < maxSec) {
      x += dir * 25 * DT;
      if (x > 94 || x < 66) {
        dir = -dir;
        row = (row + 1) % 5;
      }
      const y = 45.5 + row * 1.5;
      h.t += DT;
      s += DT;
      step.onPointerMove(h.ptr(x, y, { buttons: 1 }));
      step.update(DT);
    }
    return s;
  };
  return { h, step, sweep };
}

describe('BurrStep', () => {
  it('fresar el área hasta el porcentaje requerido completa con buena calidad', () => {
    const { h, step, sweep } = setup();
    sweep();
    expect(step.isComplete()).toBe(true);
    expect(step.removedFraction()).toBeGreaterThanOrEqual(0.8);
    expect(h.wound.erases).toBeGreaterThan(20);
    expect(h.log.faults()).toEqual([]);
    expect(h.log.gestures()[0].label).toBe('Fresar la lámina');
    expect(h.log.gestures()[0].quality).toBeGreaterThan(0.8);
    expect(h.audio.loops[0].name).toBe('burr');
    expect(h.audio.loops[0].stopped).toBe(true);
  });

  it('sin moverse no borra', () => {
    const { h, step } = setup();
    step.onPointerDown(h.ptr(80, 48));
    h.run(step, 1);
    expect(h.wound.erases).toBeLessThan(15);
  });

  it('acercarse a la médula → cordTouch, estrés 20, destello y "¡A 1 mm de la médula!"', () => {
    const { h, step } = setup();
    step.onPointerDown(h.ptr(80, 53));
    for (let i = 0; i < 30; i++) {
      h.t += DT;
      step.onPointerMove(h.ptr(80 + (i % 2) * 0.5, 53, { buttons: 1 }));
      step.update(DT);
    }
    expect(h.log.faultCount('cordTouch')).toBe(1);
    expect(h.stress).toEqual([{ amount: CORD_STRESS, reason: 'Casi toca la médula' }]);
    expect(h.wound.flashes.length).toBe(1);
    expect(h.hud.pops.some((p) => p.text === '¡A 1 mm de la médula!')).toBe(true);
    for (let i = 0; i < 70; i++) {
      h.t += DT;
      step.onPointerMove(h.ptr(80 + (i % 2) * 0.5, 53, { buttons: 1 }));
      step.update(DT);
    }
    expect(h.log.faultCount('cordTouch')).toBe(2);
  });

  it('los contactos con la médula y el fresado fuera del área bajan la calidad', () => {
    const { h, step, sweep } = setup();
    step.onPointerDown(h.ptr(80, 53));
    for (let i = 0; i < 10; i++) {
      h.t += DT;
      step.onPointerMove(h.ptr(80 + i * 0.3, 53, { buttons: 1 }));
      step.update(DT);
    }
    step.onPointerUp(h.ptr(80, 53, { buttons: 0 }));
    sweep();
    expect(step.isComplete()).toBe(true);
    expect(h.log.gestures()[0].quality).toBeLessThan(0.8);
  });

  it('la fresa se calienta sin irrigar; la raspa no', () => {
    const wiggle = (x: ReturnType<typeof setup>, sec: number) => {
      x.step.onPointerDown(x.h.ptr(50, 42));
      for (let i = 0; i < sec * 60; i++) {
        x.h.t += DT;
        x.step.onPointerMove(x.h.ptr(50 + (i % 2), 42, { buttons: 1 }));
        x.step.update(DT);
      }
    };
    const burr = setup('burr');
    wiggle(burr, 6);
    expect(burr.h.log.faultCount('thermalNecrosis')).toBe(1);
    expect(burr.step.temperature()).toBeGreaterThan(47);
    expect(burr.step.gauges().map((g) => g.label)).toEqual(['Retirado', 'Temperatura']);
    const rasp = setup('rasp');
    wiggle(rasp, 6);
    expect(rasp.h.log.faultCount('thermalNecrosis')).toBe(0);
    expect(rasp.step.gauges().map((g) => g.label)).toEqual(['Retirado']);
    expect(rasp.h.audio.loops[0].params.rate).toBeCloseTo(0.35);
  });

  it('pistas ≤ 90', () => {
    const { step } = setup();
    expect(step.hint().length).toBeLessThanOrEqual(90);
  });
});
