import { describe, expect, it } from 'vitest';
import { ReductionStep } from '../../Reduction';
import { createFakeContext } from './fakeContext';
import { reductionScenario } from './scenarios';
import type { Vec2 } from '../../../../core/contracts';

const DT = 1 / 60;

function setup(o: { tutorial?: boolean; closed?: boolean; mode?: 'reduce' | 'place'; guide?: 'full' | 'none' } = {}) {
  const sc = reductionScenario({ closed: o.closed, mode: o.mode });
  const h = createFakeContext({ anatomy: sc.anatomy, tutorial: o.tutorial, guideLevel: o.guide });
  const step = new ReductionStep(sc.def);
  step.begin(h.ctx);
  h.instrument = 'kern';
  return { h, step, sc };
}

/** Arrastre lento (≈ 30 mm/s) del punto a al b. */
function drag(h: ReturnType<typeof setup>['h'], step: ReductionStep, a: Vec2, b: Vec2, speed = 30) {
  step.onPointerDown(h.ptr(a.x, a.y, { buttons: 1 }));
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.ceil(d / (speed * DT)));
  for (let i = 1; i <= n; i++) {
    h.t += DT;
    const k = i / n;
    step.onPointerMove(h.ptr(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, { buttons: 1 }));
    step.update(DT);
    if (step.isComplete()) break;
  }
  step.onPointerUp(h.ptr(b.x, b.y, { buttons: 0 }));
}

describe('ReductionStep', () => {
  it('reduce el fragmento: gira con Q, arrastra, encaja con clonk y pide agujas K', () => {
    const { h, step } = setup();
    expect(h.wound.ghosts).toBe(true);
    expect(step.instruments).toEqual(['kern', 'kwire', 'carm']);
    // Girar -16° con Q (60°/s).
    step.onKey('KeyQ', true);
    h.run(step, 16 / 60 - 0.02);
    step.onKey('KeyQ', false);
    const f = h.bone.fragment('distal')!;
    expect(f.pose.angleDeg).toBeLessThan(2);
    expect(f.pose.angleDeg).toBeGreaterThan(-2);
    drag(h, step, { x: 109, y: 57 }, { x: 101.5, y: 50 });
    expect(f.pose.pos).toEqual({ x: 101.5, y: 50 });
    expect(f.pose.angleDeg).toBe(0);
    expect(h.audio.count('boneClonk')).toBe(1);
    const g = h.log.gestures().find((x) => x.label.startsWith('Reducción'))!;
    expect(g.quality).toBeGreaterThan(0.85);
    expect(h.selected).toContain('kwire');
    expect(step.isComplete()).toBe(false);
    expect(step.checklist()[0].done).toBe(true);
    // Ya no se puede agarrar.
    step.onPointerDown(h.ptr(101.5, 50, { instrument: 'kern' }));
    step.onPointerMove(h.ptr(90, 40, { buttons: 1 }));
    expect(f.pose.pos).toEqual({ x: 101.5, y: 50 });
    // Agujas K.
    step.onPointerDown(h.ptr(84.5, 47.5));
    step.onPointerDown(h.ptr(60, 40));
    step.onPointerDown(h.ptr(88, 53.2));
    expect(h.bone.implants.pins).toHaveLength(2);
    expect(h.bone.implants.pins.every((p) => p.kind === 'kwire')).toBe(true);
    expect(h.audio.count('kwire')).toBe(2);
    expect(step.isComplete()).toBe(true);
    expect(step.progress()).toBe(1);
    expect(h.log.faults()).toEqual([]);
    step.end();
    expect(h.wound.ghosts).toBe(false);
    expect(h.wound.overlays.size).toBe(0);
  });

  it('tocar la esquirla prohibida registra noTouchViolation con límite de 2 s', () => {
    const { h, step } = setup();
    step.onPointerDown(h.ptr(72, 59.5));
    step.onPointerUp(h.ptr(72, 59.5, { buttons: 0 }));
    step.onPointerDown(h.ptr(72, 59.5));
    expect(h.log.faultCount('noTouchViolation')).toBe(1);
    expect(h.says.some((s) => s.speaker === 'valerio')).toBe(true);
    h.t += 2.1;
    step.onPointerDown(h.ptr(72, 59.5));
    expect(h.log.faultCount('noTouchViolation')).toBe(2);
  });

  it('forzar el fragmento rápido contra el hueso fisura (máx. 1 cada 3 s)', () => {
    const { h, step } = setup();
    step.onPointerDown(h.ptr(109, 57));
    h.t += 0.05;
    step.onPointerMove(h.ptr(90, 50, { buttons: 1 }));
    expect(h.log.faultCount('iatrogenicFissure')).toBe(1);
    expect(h.wound.decals.some((d) => d.kind === 'fissure')).toBe(true);
    h.t += 0.05;
    step.onPointerMove(h.ptr(100, 58, { buttons: 1 }));
    h.t += 0.05;
    step.onPointerMove(h.ptr(90, 50, { buttons: 1 }));
    expect(h.log.faultCount('iatrogenicFissure')).toBe(1);
    h.t += 3;
    step.onPointerMove(h.ptr(100, 58, { buttons: 1 }));
    h.t += 0.05;
    step.onPointerMove(h.ptr(90, 50, { buttons: 1 }));
    expect(h.log.faultCount('iatrogenicFissure')).toBe(2);
  });

  it('sin fisuras en el tutorial ni en modo colocar', () => {
    for (const o of [{ tutorial: true }, { mode: 'place' as const }]) {
      const { h, step } = setup(o);
      step.onPointerDown(h.ptr(109, 57));
      h.t += 0.05;
      step.onPointerMove(h.ptr(90, 50, { buttons: 1 }));
      expect(h.log.faults()).toEqual([]);
    }
  });

  it('arrastrar lento hasta tocar hueso no fisura', () => {
    const { h, step } = setup();
    drag(h, step, { x: 109, y: 57 }, { x: 95, y: 50 }, 40);
    expect(h.log.faults()).toEqual([]);
    expect(h.audio.count('crunch')).toBeGreaterThan(1);
  });

  it('arco en C: rayos X 1,8 s, Gigi sale, cuenta disparos y se agota', () => {
    const { h, step } = setup({ closed: true });
    expect(step.hint()).toMatch(/R para rayos X/);
    // A ciegas: la silueta fantasma solo aparece con los rayos X.
    expect(h.wound.ghosts).toBe(false);
    step.onKey('KeyR', true);
    expect(h.wound.xray).toBe(true);
    expect(h.wound.ghosts).toBe(true);
    expect(h.crewCalls.gigiLeave).toEqual([4]);
    expect(h.events.find((e) => e.type === 'carm:shot')?.payload).toEqual({ left: 2 });
    expect(h.audio.count('xray')).toBe(1);
    expect(h.log.records().some((r) => r.kind === 'note' && r.label === 'carm')).toBe(true);
    h.run(step, 1.7);
    expect(h.wound.xray).toBe(true);
    h.run(step, 0.2);
    expect(h.wound.xray).toBe(false);
    expect(h.wound.ghosts).toBe(false);
    step.onKey('KeyR', true);
    step.onKey('KeyR', true);
    step.onKey('KeyR', true);
    expect(h.events.filter((e) => e.type === 'carm:shot')).toHaveLength(3);
    expect(h.audio.count('uiError')).toBe(1);
    expect(step.gauges().find((g) => g.id === 'carm')!.value).toBe(0);
  });

  it('sin guías no muestra la silueta fantasma', () => {
    const { h } = setup({ guide: 'none' });
    expect(h.wound.ghosts).toBe(false);
  });

  it('tolerancia ×1,5 en el tutorial', () => {
    const { h, step } = setup({ tutorial: true });
    step.onKey('KeyQ', true);
    h.run(step, 16 / 60);
    step.onKey('KeyQ', false);
    // A 2 mm del objetivo: fuera de 1,5 pero dentro de 2,25.
    drag(h, step, { x: 109, y: 57 }, { x: 103.5, y: 50 });
    expect(h.bone.fragment('distal')!.pose.pos).toEqual({ x: 101.5, y: 50 });
  });

  it('medidores y pistas', () => {
    const { step } = setup();
    const g = step.gauges();
    expect(g.map((x) => x.label)).toEqual(['Desplazamiento', 'Ángulo', 'Rayos X restantes']);
    expect(g[0].value).toBeGreaterThan(5);
    expect(step.hint().length).toBeLessThanOrEqual(90);
  });
});
