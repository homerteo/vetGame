import { describe, expect, it } from 'vitest';
import type { BandageParams } from '../../core/contracts';
import type { BandageStep } from './Bandage';
import { STEP_DEFS } from './testing/a/scenarios';
import { drawOverlays, setupStep } from './testing/a/setup';

const params = STEP_DEFS.bandage.params as BandageParams;

describe('Vendaje', () => {
  it('3 vueltas a ~0,8 vueltas/s: completo con buena tensión y sin falta', () => {
    const { f, step, d } = setupStep('bandage');
    expect(step.instruments).toEqual(['bandage']);
    d.circle(params.center, params.radiusMm, params.turns, 0.8);
    expect(step.isComplete()).toBe(true);
    expect(f.log.gestureList).toHaveLength(1);
    expect(f.log.gestureList[0].label).toBe('Vendaje cohesivo');
    expect(f.log.gestureList[0].quality).toBeGreaterThan(0.8);
    expect(f.log.faultList).toHaveLength(0);
    expect(step.checklist()[0]).toEqual({ label: 'Vendaje cohesivo (3/3 vueltas)', done: true });
    expect(f.audio.plays.filter((s) => s === 'tick')).toHaveLength(3);
  });

  it('demasiado rápido: calidad baja y falta tightBandage', () => {
    const { f, step, d } = setupStep('bandage');
    d.circle(params.center, params.radiusMm, params.turns, 2.2);
    expect(step.isComplete()).toBe(true);
    expect(f.log.gestureList[0].quality).toBeLessThan(0.5);
    expect(f.log.faults()).toEqual(['tightBandage']);
  });

  it('demasiado lento: calidad baja pero sin falta de apretado', () => {
    const { f, step, d } = setupStep('bandage');
    d.circle(params.center, params.radiusMm, params.turns, 0.3);
    expect(step.isComplete()).toBe(true);
    expect(f.log.gestureList[0].quality).toBeLessThan(0.5);
    expect(f.log.faultList).toHaveLength(0);
  });

  it('fuera del anillo (0,5R–1,6R) no acumula vueltas', () => {
    const { step, d } = setupStep('bandage');
    d.circle(params.center, params.radiusMm * 2, 1, 0.8);
    d.circle(params.center, params.radiusMm * 0.3, 1, 0.8);
    expect(step.progress()).toBe(0);
  });

  it('invertir el sentido deshace progreso', () => {
    const { step, d } = setupStep('bandage');
    d.circle(params.center, params.radiusMm, 0.5, 0.8);
    const p = step.progress();
    expect(p).toBeGreaterThan(0.1);
    // Media vuelta en sentido contrario.
    d.down(params.center.x - params.radiusMm, params.center.y);
    for (let a = 180; a >= 90; a -= 5) {
      d.tick(1 / 60);
      const r = (a * Math.PI) / 180;
      d.move(params.center.x + Math.cos(r) * params.radiusMm, params.center.y + Math.sin(r) * params.radiusMm);
    }
    d.up();
    expect(step.progress()).toBeLessThan(p);
  });

  it('medidor de tensión, bucle de venda, overlay con corazones y end()', () => {
    const { f, step, d } = setupStep('bandage');
    d.down(params.center.x + params.radiusMm, params.center.y);
    for (let i = 1; i <= 50; i++) {
      d.tick(1 / 60);
      const a = (i / 60) * 0.8 * Math.PI * 2;
      d.move(params.center.x + Math.cos(a) * params.radiusMm, params.center.y + Math.sin(a) * params.radiusMm);
    }
    const g = step.gauges()[0];
    expect(g.label).toBe('Tensión');
    expect(g.value).toBeGreaterThan(0.6);
    expect(g.value).toBeLessThan(1);
    expect(f.audio.activeLoops().map((l) => l.name)).toEqual(['bandage']);
    const calls = drawOverlays(f);
    expect(calls.get('bezierCurveTo') ?? 0).toBeGreaterThan(4); // corazones
    expect((step as BandageStep).tensionQuality()).toBeGreaterThan(0.5);
    d.up();
    expect(f.audio.activeLoops()).toHaveLength(0);
    expect(step.hint().length).toBeLessThanOrEqual(90);
    expect(step.hint()).toMatch(/clic izq/);
    step.end();
    expect(f.wound.overlays.size).toBe(0);
  });
});
