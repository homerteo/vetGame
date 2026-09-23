import { describe, expect, it } from 'vitest';
import { SAW_BINS, SawStep } from '../../Saw';
import { createFakeContext } from './fakeContext';
import { sawScenario } from './scenarios';
import { lerpV } from '../../../../core/math';

const DT = 1 / 60;

function setup(o: { owner?: 'hortensia' | 'braulio'; tutorial?: boolean } = {}) {
  const sc = sawScenario();
  const h = createFakeContext({ anatomy: sc.anatomy, owner: o.owner ?? sc.owner, tutorial: o.tutorial });
  const step = new SawStep(sc.def);
  step.begin(h.ctx);
  h.instrument = 'saw';
  const a = { x: 97, y: 39 };
  const b = { x: 101.5, y: 61 };
  /** Recorre la línea a `speed` mm/s (con desfase lateral opcional). */
  const cut = (speed: number, offset = 0, maxSec = 20) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    step.onPointerDown(h.ptr(a.x + offset, a.y, { buttons: 1 }));
    let s = 0;
    let dir = 1;
    let k = 0;
    while (!step.isComplete() && s < maxSec) {
      k += (dir * speed * DT) / len;
      if (k >= 1 || k <= 0) {
        dir = -dir;
        k = Math.min(1, Math.max(0, k));
      }
      const p = lerpV(a, b, k);
      h.t += DT;
      s += DT;
      step.onPointerMove(h.ptr(p.x + offset, p.y, { buttons: 1 }));
      step.update(DT);
    }
    return s;
  };
  return { h, step, cut, a, b };
}

describe('SawStep', () => {
  it('cortar a lo largo de la línea irrigando completa, libera la cabeza y no calienta', () => {
    const { h, step, cut } = setup({ owner: 'braulio' });
    expect(h.wound.guide.path).not.toBeNull();
    step.onKey('KeyI', true);
    cut(12);
    expect(step.isComplete()).toBe(true);
    expect(step.cutFraction()).toBe(1);
    expect(h.bone.fragment('cabeza')!.locked).toBe(false);
    expect(h.log.faults()).toEqual([]);
    const g = h.log.gestures()[0];
    expect(g.label).toBe('Osteotomía');
    expect(g.quality).toBeGreaterThan(0.85);
    const loop = h.audio.loops.find((l) => l.name === 'saw')!;
    expect(loop.params.wet).toBe(1);
    expect(loop.stopped).toBe(true);
    step.end();
    expect(h.wound.guide.path).toBeNull();
  });

  it('una sola pasada limpia de punta a punta completa el corte (incluidos los extremos)', () => {
    const { h, step, a, b } = setup();
    step.onKey('KeyI', true);
    step.onPointerDown(h.ptr(a.x, a.y));
    // Pasada a 5 mm/s en saltos de 0,6 mm (como a pocos fps): quieta al empezar.
    h.run(step, 0.1);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.ceil(len / 0.6);
    for (let i = 1; i <= n; i++) {
      const p = lerpV(a, b, i / n);
      step.onPointerMove(h.ptr(p.x, p.y, { buttons: 1 }));
      h.run(step, 0.12);
    }
    expect(step.cutFraction()).toBe(1);
    expect(step.isComplete()).toBe(true);
  });

  it('saltos grandes fuera de la línea no rellenan tramos', () => {
    const { h, step, a, b } = setup();
    step.onPointerDown(h.ptr(a.x, a.y));
    h.run(step, 0.05);
    // Salto de punta a punta en un fotograma, pero la hoja se sale de la línea por el camino.
    step.onPointerMove(h.ptr((a.x + b.x) / 2 + 12, (a.y + b.y) / 2, { buttons: 1 }));
    h.run(step, DT);
    step.onPointerMove(h.ptr(b.x, b.y, { buttons: 1 }));
    h.run(step, DT);
    expect(step.cutFraction()).toBeLessThan(0.2);
  });

  it('acorde derecho→izquierdo (irrigar primero): el pointermove con el bit 1 empieza a serrar', () => {
    const { h, step, a, b } = setup();
    step.onPointerDown(h.ptr(a.x, a.y, { button: 2, buttons: 2 }));
    h.run(step, 0.1);
    expect(step.cutFraction()).toBe(0);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    for (let k = 0; k <= 1.0001; k += 0.3 / len) {
      const p = lerpV(a, b, Math.min(1, k));
      step.onPointerMove(h.ptr(p.x, p.y, { button: 0, buttons: 3 }));
      h.run(step, 0.05);
    }
    expect(step.cutFraction()).toBe(1);
    expect(h.audio.loops.some((l) => l.name === 'saw')).toBe(true);
    expect(h.log.faults()).toEqual([]);
  });

  it('el progreso crece por tramos (40) solo cerca de la línea', () => {
    const { h, step } = setup();
    step.onPointerDown(h.ptr(97, 39));
    for (let i = 0; i < 30; i++) {
      h.t += DT;
      step.onPointerMove(h.ptr(97 + i * 0.05, 39 + i * 0.25, { buttons: 1 }));
      step.update(DT);
    }
    const f = step.cutFraction();
    expect(f).toBeGreaterThan(0);
    expect(f).toBeLessThan(0.5);
    expect(Number.isInteger(f * SAW_BINS)).toBe(true);
  });

  it('sin irrigar se calienta a +6 °C/s y produce necrosis térmica una vez', () => {
    const { h, step } = setup();
    step.onPointerDown(h.ptr(98, 44));
    h.run(step, 1);
    expect(step.temperature()).toBeCloseTo(43, 0);
    h.run(step, 4);
    expect(h.log.faultCount('thermalNecrosis')).toBe(1);
    expect(h.wound.decals.some((d) => d.kind === 'necrosis')).toBe(true);
    h.run(step, 4);
    expect(h.log.faultCount('thermalNecrosis')).toBe(1);
    expect(step.gauges()[0].value).toBeGreaterThan(47);
  });

  it('con irrigación sube despacio (+1,5 °C/s) y al parar enfría', () => {
    const { h, step } = setup();
    step.onPointerDown(h.ptr(98, 44, { button: 0, buttons: 3 }));
    h.run(step, 2);
    expect(step.temperature()).toBeCloseTo(40, 0);
    step.onPointerUp(h.ptr(98, 44, { buttons: 0 }));
    h.run(step, 2);
    expect(step.temperature()).toBe(37);
  });

  it('desviarse de la línea sobre el hueso → offPath (cada 2 s) y rayones', () => {
    const { h, step } = setup();
    step.onPointerDown(h.ptr(80, 50));
    for (let i = 0; i < 60; i++) {
      h.t += DT;
      step.onPointerMove(h.ptr(80 + Math.sin(i / 4) * 3, 50, { buttons: 1 }));
      step.update(DT);
    }
    expect(h.log.faultCount('offPath')).toBe(1);
    expect(h.wound.decals.filter((d) => d.kind === 'scratch').length).toBeGreaterThan(1);
    for (let i = 0; i < 80; i++) {
      h.t += DT;
      step.onPointerMove(h.ptr(80 + Math.sin(i / 4) * 3, 50, { buttons: 1 }));
      step.update(DT);
    }
    expect(h.log.faultCount('offPath')).toBe(2);
    expect(step.cutFraction()).toBe(0);
  });

  it('Doña Hortensia oye la sierra', () => {
    const { h, cut } = setup({ owner: 'hortensia' });
    cut(4, 0, 3);
    const lines = h.says.filter((s) => s.speaker === 'hortensia');
    expect(lines.length).toBe(1);
    expect(h.audio.count('hortensiaScream')).toBe(1);
  });

  it('pistas ≤ 90 caracteres', () => {
    const { h, step } = setup();
    expect(step.hint().length).toBeLessThanOrEqual(90);
    step.onPointerDown(h.ptr(98, 44));
    h.run(step, 2);
    expect(step.hint()).toMatch(/irrigar/);
    expect(step.hint().length).toBeLessThanOrEqual(90);
  });
});
