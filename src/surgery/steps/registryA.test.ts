import { describe, expect, it } from 'vitest';
import type { StepType } from '../../core/contracts';
import { STEPS_A, createCauteryTool } from './registryA';
import { STEP_DEFS } from './testing/a/scenarios';
import { drawOverlays, setupStep } from './testing/a/setup';

const TYPES = ['incision', 'hemostasis', 'retract', 'suture', 'bandage', 'clickTargets', 'pick'] as const;

describe('Registro A', () => {
  it('exporta las 7 fábricas y el cauterio', () => {
    expect(Object.keys(STEPS_A).sort()).toEqual([...TYPES].sort());
    expect(typeof createCauteryTool).toBe('function');
    for (const t of TYPES) {
      const step = STEPS_A[t as StepType]!(STEP_DEFS[t]);
      expect(step.def).toBe(STEP_DEFS[t]);
      expect(step.instruments.length).toBeGreaterThan(0);
    }
  });

  it.each(TYPES)('%s: contrato completo (pista, checklist, progreso, medidores, overlays, end)', (t) => {
    for (const tutorial of [false, true]) {
      for (const guideLevel of ['full', 'endpoints', 'none'] as const) {
        const { f, step, d } = setupStep(t, { tutorial, guideLevel });
        d.tick(0.5);
        const h = step.hint();
        expect(h.length).toBeGreaterThan(0);
        expect(h.length).toBeLessThanOrEqual(90);
        expect(step.checklist().length).toBeGreaterThan(0);
        const p = step.progress();
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
        expect(step.isComplete()).toBe(false);
        expect(step.gauges().length).toBeGreaterThan(0);
        expect(step.onKey('KeyQ', true)).toBe(false);
        expect(f.wound.overlays.size).toBeGreaterThan(0);
        expect(() => drawOverlays(f)).not.toThrow();
        d.down(80, 50);
        step.end();
        expect(f.wound.overlays.size).toBe(0);
        expect(f.audio.activeLoops()).toHaveLength(0);
      }
    }
  });
});
