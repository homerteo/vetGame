import { describe, expect, it } from 'vitest';
import type { HemostasisParams } from '../../core/contracts';
import { HEMOSTASIS_STAGGER_SEC } from './Hemostasis';
import { STEP_DEFS } from './testing/a/scenarios';
import { drawOverlays, setupStep } from './testing/a/setup';

const params = STEP_DEFS.hemostasis.params as HemostasisParams;

describe('Hemostasia', () => {
  it('los sangrados aparecen escalonados cada 1,5 s', () => {
    const { f, d } = setupStep('hemostasis');
    expect(f.bleeding.list()).toHaveLength(1);
    d.tick(HEMOSTASIS_STAGGER_SEC + 0.01);
    expect(f.bleeding.list()).toHaveLength(2);
    d.tick(HEMOSTASIS_STAGGER_SEC * 2);
    expect(f.bleeding.list()).toHaveLength(4);
    expect(f.events.filter((e) => e.type === 'bleeder:spawn')).toHaveLength(4);
    expect(f.hud.alerts.some((a) => a.kind === 'arterial')).toBe(true);
  });

  it('se completa al sellar todo con el campo por debajo del objetivo', () => {
    const { f, step, d } = setupStep('hemostasis');
    expect(step.instruments).toEqual(['cautery']);
    d.tick(5);
    expect(step.checklist()[0].label).toBe('Sellar sangrados (0/4)');
    expect(step.checklist()[1].label).toBe('Campo por debajo de 30%');
    for (const b of params.bleeders) d.hold(b.pos.x, b.pos.y, 1.4);
    d.tick(0.05);
    expect(step.checklist()[0]).toEqual({ label: 'Sellar sangrados (4/4)', done: true });
    expect(step.isComplete()).toBe(true);
    expect(f.log.gestureList).toHaveLength(4);
    expect(f.log.faultList).toHaveLength(0);
    expect(f.events.filter((e) => e.type === 'bleeder:sealed')).toHaveLength(4);
  });

  it('con el campo alto no se completa y la pista sugiere a Rodrigo (Z)', () => {
    const { f, step, d } = setupStep('hemostasis');
    d.tick(5);
    for (const b of params.bleeders) d.hold(b.pos.x, b.pos.y, 1.4);
    f.blood.level = 55;
    d.tick(0.1);
    expect(step.isComplete()).toBe(false);
    expect(step.checklist()[1].done).toBe(false);
    expect(step.hint()).toMatch(/Rodrigo \(Z\)/);
    f.blood.level = 20;
    d.tick(0.1);
    expect(step.isComplete()).toBe(true);
  });

  it('un sangrado ajeno (p. ej. vaso cortado) también bloquea el final', () => {
    const { f, step, d } = setupStep('hemostasis');
    d.tick(5);
    f.bleeding.spawn({ x: 40, y: 45 }, 'venous', f.clock.t);
    for (const b of params.bleeders) d.hold(b.pos.x, b.pos.y, 1.4);
    d.tick(0.05);
    expect(step.checklist()[0].done).toBe(true);
    expect(step.isComplete()).toBe(false);
    d.hold(40, 45, 1.4).tick(0.05);
    expect(step.isComplete()).toBe(true);
    expect(f.log.gestureList).toHaveLength(5);
  });

  it('sin cauterio no sella; las pistas caben y el overlay dibuja', () => {
    const { f, step, d } = setupStep('hemostasis');
    d.instrument = 'forceps';
    d.hold(60, 47, 1.5);
    expect(f.bleeding.active()).toHaveLength(1);
    expect(f.hud.pops.some((p) => p.text.includes('cauterio'))).toBe(true);
    d.tick(3);
    expect(step.hint().length).toBeLessThanOrEqual(90);
    expect(step.hint()).toMatch(/clic/);
    const calls = drawOverlays(f);
    expect(calls.get('fillText') ?? 0).toBeGreaterThan(0); // etiqueta ¡ARTERIAL!
  });

  it('medidor de contacto del cauterio; end() quita overlays y bucles', () => {
    const { f, step, d } = setupStep('hemostasis');
    d.down(60, 47).tick(0.8);
    expect(step.gauges()[0].label).toBe('Contacto');
    expect(step.gauges()[0].value).toBeGreaterThan(0.7);
    expect(f.audio.activeLoops()).toHaveLength(1);
    step.end();
    expect(f.wound.overlays.size).toBe(0);
    expect(f.audio.activeLoops()).toHaveLength(0);
  });

  it('tutorial: pista de los datos al empezar', () => {
    const { f, step } = setupStep('hemostasis', { tutorial: true });
    expect(step.hint()).toBe(f.ctx.dialogue.tutorialHints.hemostasis);
  });
});
