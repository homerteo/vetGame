import { describe, expect, it } from 'vitest';
import { RotateStep, valueAbbrev } from '../../Rotate';
import { createFakeContext } from './fakeContext';
import { rotateScenario } from './scenarios';

const DT = 1 / 60;

function setup(tutorial = false) {
  const sc = rotateScenario();
  const h = createFakeContext({ anatomy: sc.anatomy, tutorial });
  const step = new RotateStep(sc.def);
  step.begin(h.ctx);
  h.instrument = 'kern';
  const pivot = { x: 100, y: 50 };
  const at = (deg: number, r = 20) => {
    const a = (deg * Math.PI) / 180;
    return { x: pivot.x + Math.cos(a) * r, y: pivot.y + Math.sin(a) * r };
  };
  /** Arrastra alrededor del pivote de 0° a `deg` en pasos de 1°. */
  const dragTo = (deg: number, release = true) => {
    const s = at(0);
    step.onPointerDown(h.ptr(s.x, s.y));
    const n = Math.ceil(Math.abs(deg));
    for (let i = 1; i <= n; i++) {
      h.t += DT;
      const p = at((deg * i) / n);
      step.onPointerMove(h.ptr(p.x, p.y, { buttons: 1 }));
    }
    if (release) {
      const e = at(deg);
      step.onPointerUp(h.ptr(e.x, e.y, { buttons: 0 }));
    }
  };
  return { h, step, at, dragTo, pivot };
}

describe('RotateStep', () => {
  it('el valor baja con el giro: 28 − grados/degPerUnit', () => {
    const { step, dragTo } = setup();
    expect(step.value()).toBe(28);
    dragTo(10, false);
    expect(step.value()).toBeCloseTo(18, 5);
    expect(step.gauges()[0].value).toBeCloseTo(18, 5);
  });

  it('gira el fragmento alrededor del pivote', () => {
    const { h, step, dragTo } = setup();
    dragTo(12, false);
    const f = h.bone.fragment('meseta')!;
    expect(f.pose.angleDeg).toBeCloseTo(12, 5);
    expect(f.pose.pos.x).toBeCloseTo(100, 5);
    expect(step.progress()).toBeGreaterThan(0.4);
  });

  it('soltar en objetivo ± tol bloquea, registra el gesto y pide la aguja', () => {
    const { h, step, dragTo } = setup();
    dragTo(23);
    expect(step.value()).toBeCloseTo(5, 5);
    expect(step.checklist()[0].done).toBe(true);
    expect(h.log.gestures()[0].quality).toBeGreaterThan(0.9);
    expect(h.selected).toContain('kwire');
    expect(h.audio.count('boneClonk')).toBe(1);
    // Ya no gira.
    dragTo(5);
    expect(step.value()).toBeCloseTo(5, 5);
    // Aguja antirrotacional.
    h.instrument = 'kwire';
    step.onPointerDown(h.ptr(104.5, 40.5));
    expect(h.bone.implants.pins).toEqual([{ pos: { x: 104, y: 40 }, kind: 'kwire' }]);
    expect(step.isComplete()).toBe(true);
    expect(step.progress()).toBe(1);
  });

  it('soltar fuera de tolerancia no bloquea y dice cuánto falta', () => {
    const { h, step, dragTo } = setup();
    dragTo(18);
    expect(step.checklist()[0].done).toBe(false);
    expect(h.hud.pops.at(-1)!.text).toMatch(/^Faltan/);
  });

  it('pasarse más de 5 unidades → malalignment una sola vez; luego se corrige', () => {
    const { h, step, at } = setup();
    const s = at(0);
    step.onPointerDown(h.ptr(s.x, s.y));
    for (let d = 1; d <= 31; d++) {
      const p = at(d);
      step.onPointerMove(h.ptr(p.x, p.y, { buttons: 1 }));
    }
    expect(h.log.faultCount('malalignment')).toBe(1);
    for (let d = 31; d >= 23; d--) {
      const p = at(d);
      step.onPointerMove(h.ptr(p.x, p.y, { buttons: 1 }));
    }
    for (let d = 23; d <= 30; d++) {
      const p = at(d);
      step.onPointerMove(h.ptr(p.x, p.y, { buttons: 1 }));
    }
    expect(h.log.faultCount('malalignment')).toBe(1);
    const back = at(23);
    step.onPointerMove(h.ptr(back.x, back.y, { buttons: 1 }));
    step.onPointerUp(h.ptr(back.x, back.y, { buttons: 0 }));
    expect(step.checklist()[0].done).toBe(true);
    expect(h.log.gestures()[0].quality).toBeLessThan(0.9);
  });

  it('Q/E giran a 20°/s y bloquean al soltar la tecla en objetivo', () => {
    const { h, step } = setup();
    step.onKey('KeyE', true);
    h.run(step, 0.5, DT);
    step.onKey('KeyE', false);
    expect(step.value()).toBeCloseTo(18, 1);
    step.onKey('KeyE', true);
    h.run(step, 13 / 20, DT);
    step.onKey('KeyE', false);
    expect(step.value()).toBeCloseTo(5, 0);
    expect(step.checklist()[0].done).toBe(true);
    // Q en sentido contrario ya no cambia nada.
    step.onKey('KeyQ', true);
    h.run(step, 0.5, DT);
    expect(step.value()).toBeCloseTo(5, 0);
  });

  it('abreviatura y pistas', () => {
    expect(valueAbbrev('Ángulo de meseta tibial')).toBe('TPA');
    expect(valueAbbrev('Varo')).toBe('Varo');
    const { step } = setup();
    expect(step.hint().length).toBeLessThanOrEqual(90);
  });
});
