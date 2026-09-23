// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { STEPS_B } from '../../registryB';
import { createFakeContext } from './fakeContext';
import { ALL_SCENARIOS } from './scenarios';

describe('STEPS_B', () => {
  it('registra los 7 pasos de hueso', () => {
    expect(Object.keys(STEPS_B).sort()).toEqual(['burr', 'drillPins', 'plate', 'reduction', 'rotate', 'saw', 'screws']);
  });

  it('cada paso arranca, da pista ≤ 90, checklist, medidores y limpia al terminar', () => {
    for (const make of ALL_SCENARIOS) {
      const sc = make();
      for (const tutorial of [false, true]) {
        const h = createFakeContext({ anatomy: sc.anatomy, tutorial });
        if (sc.plate) {
          h.bone.implants.plate = {
            optionId: 'p6',
            pose: { pos: { x: 79, y: 50 }, angleDeg: 0 },
            holesLocal: [{ x: -10, y: 0 }, { x: 10, y: 0 }],
            lengthMm: 42,
            widthMm: 7,
            bend: 1,
          };
        }
        const step = STEPS_B[sc.type]!(sc.def);
        expect(step.def).toBe(sc.def);
        expect(step.instruments.length).toBeGreaterThan(0);
        step.begin(h.ctx);
        h.run(step, 0.5);
        const hint = step.hint();
        expect(hint.length, `${sc.type}: ${hint}`).toBeLessThanOrEqual(90);
        expect(hint.length).toBeGreaterThan(5);
        expect(step.checklist().length).toBeGreaterThan(0);
        expect(step.progress()).toBeGreaterThanOrEqual(0);
        expect(step.progress()).toBeLessThan(1);
        expect(Array.isArray(step.gauges())).toBe(true);
        expect(step.isComplete()).toBe(false);
        expect(h.wound.overlays.size).toBeGreaterThan(0);
        step.end();
        expect(h.wound.overlays.size).toBe(0);
        expect(h.audio.activeLoops()).toHaveLength(0);
        expect(h.hud.layerEl?.children.length ?? 0).toBe(0);
        h.hud.dispose();
      }
    }
  });
});
