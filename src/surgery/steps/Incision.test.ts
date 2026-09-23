import { describe, expect, it } from 'vitest';
import type { IncisionParams, StepDef } from '../../core/contracts';
import { INCISION_PATH, STEP_DEFS } from './testing/a/scenarios';
import { drawOverlays, setupStep } from './testing/a/setup';

const params = STEP_DEFS.incision.params as IncisionParams;

function withParams(p: Partial<IncisionParams>): StepDef {
  return { ...STEP_DEFS.incision, params: { ...params, ...p } };
}

describe('Incisión', () => {
  it('se completa capa a capa con la presión correcta siguiendo la guía', () => {
    const { f, step, d } = setupStep('incision');
    expect(f.wound.guide.path).toBe(params.path);
    for (const layer of params.layers) {
      d.pressure = layer.targetPressure;
      d.stroke(INCISION_PATH, 60);
    }
    expect(step.isComplete()).toBe(true);
    expect(step.progress()).toBe(1);
    expect(f.log.faultList).toHaveLength(0);
    expect(f.log.gestureList.map((g) => g.label)).toEqual(['Incisión: piel', 'Incisión: tejido subcutáneo', 'Incisión: fascia']);
    // Trazo recto y regular: calidad perfecta.
    for (const g of f.log.gestureList) expect(g.quality).toBeGreaterThan(0.9);
    // Cortes en orden de capas.
    const layersCut = [...new Set(f.wound.cuts.map((c) => c.layer))];
    expect(layersCut).toEqual(['skin', 'subcut', 'fascia']);
    expect(f.wound.guide.path).toBeNull();
    expect(step.checklist().every((c) => c.done)).toBe(true);
    expect(f.events.some((e) => e.type === 'step:complete')).toBe(true);
  });

  it('la desviación y las pasadas extra bajan la calidad del gesto', () => {
    const { f, d } = setupStep('incision');
    d.pressure = 2;
    // Un trazo a 2,5 mm (no abre la capa) y otro sobre la línea: 2 pasadas, desviación media 1,25 mm.
    d.stroke(
      INCISION_PATH.map((p) => ({ x: p.x, y: p.y + 2.5 })),
      60,
    );
    expect(f.log.gestureList).toHaveLength(0);
    d.stroke(INCISION_PATH, 60);
    expect(f.log.gestureList.length).toBeGreaterThanOrEqual(1);
    expect(f.log.gestureList[0].quality).toBeLessThan(0.95);
  });

  it('con presión muy baja no corta y avisa "Muy superficial"', () => {
    const { f, step, d } = setupStep('incision', { def: withParams({ layers: [{ layer: 'skin', targetPressure: 4 }] }) });
    d.pressure = 2;
    d.stroke(INCISION_PATH, 60);
    expect(f.wound.cuts).toHaveLength(0);
    expect(f.hud.pops.some((p) => p.text === 'Muy superficial')).toBe(true);
    expect(step.progress()).toBe(0);
  });

  it('con presión excesiva corta vasos: sangrado, falta vesselCut y evento del bus', () => {
    const { f, d } = setupStep('incision');
    d.pressure = 4; // objetivo 2 → +2
    d.stroke(INCISION_PATH, 60);
    expect(f.bleeding.list()).toHaveLength(2);
    expect(f.log.faults().filter((k) => k === 'vesselCut')).toHaveLength(2);
    expect(f.events.filter((e) => e.type === 'bleeder:spawn')).toHaveLength(2);
    // Corta igualmente (más ancho).
    expect(f.wound.cuts.length).toBeGreaterThan(0);
    // Cada vaso se dispara una sola vez.
    d.stroke(INCISION_PATH, 60);
    expect(f.bleeding.list()).toHaveLength(2);
  });

  it('salirse más de 15 mm de la guía en un trazo = offPath una vez y rayón', () => {
    const { f, d } = setupStep('incision');
    d.pressure = 2;
    d.stroke(
      [
        { x: 40, y: 62 },
        { x: 90, y: 62 },
      ],
      60,
    );
    expect(f.log.faults()).toEqual(['offPath']);
    expect(f.wound.decals.filter((x) => x.kind === 'scratch')).toHaveLength(1);
    expect(f.wound.cuts).toHaveLength(0);
  });

  it('el tutorial amplía la tolerancia ×1,5 (9 mm)', () => {
    const off = [
      { x: 40, y: 56 },
      { x: 90, y: 55.5 },
    ];
    const normal = setupStep('incision');
    normal.d.pressure = 2;
    normal.d.stroke(off, 60);
    expect(normal.f.log.faults()).toContain('offPath');

    const tut = setupStep('incision', { tutorial: true });
    tut.d.pressure = 2;
    tut.d.stroke(off, 60);
    expect(tut.f.log.faults()).not.toContain('offPath');
    expect(tut.f.wound.cuts.length).toBeGreaterThan(0);
  });

  it('pistas en español ≤ 90 caracteres, con teclas; en tutorial usa tutorialHints', () => {
    const { step, d } = setupStep('incision');
    for (const pr of [1, 2, 4]) {
      d.pressure = pr;
      d.move(50, 49);
      const h = step.hint();
      expect(h.length).toBeLessThanOrEqual(90);
      expect(h).toMatch(/rueda|clic/i);
    }
    const tut = setupStep('incision', { tutorial: true });
    expect(tut.step.hint()).toBe(tut.f.ctx.dialogue.tutorialHints.incision);
  });

  it('medidores de presión y desviación con zonas', () => {
    const { step, d } = setupStep('incision');
    d.pressure = 2;
    d.down(30, 50).drag([{ x: 30, y: 50 }, { x: 40, y: 53 }]);
    const [pres, dev] = step.gauges();
    expect(pres.label).toBe('Presión');
    expect(pres.value).toBe(2);
    expect(pres.zones?.find((z) => z.kind === 'good')).toEqual({ from: 1, to: 3, kind: 'good' });
    expect(dev.label).toBe('Desviación');
    expect(dev.value).toBeGreaterThan(2);
  });

  it('suena el bisturí mientras se corta y se calla al soltar; end() limpia todo', () => {
    const { f, step, d } = setupStep('incision');
    d.pressure = 2;
    d.down(30, 50).drag([{ x: 30, y: 50 }, { x: 60, y: 48.5 }]);
    expect(f.audio.activeLoops().map((l) => l.name)).toEqual(['scalpel']);
    expect(f.audio.activeLoops()[0].params.rate).toBeGreaterThan(0);
    const calls = drawOverlays(f);
    expect(calls.get('stroke') ?? 0).toBeGreaterThan(0);
    d.up();
    expect(f.audio.activeLoops()).toHaveLength(0);
    d.down(60, 48.5);
    step.end();
    expect(f.audio.activeLoops()).toHaveLength(0);
    expect(f.wound.overlays.size).toBe(0);
    expect(f.wound.guide.path).toBeNull();
  });
});
