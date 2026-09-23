import { describe, expect, it } from 'vitest';
import type { StepDef, SutureParams, Vec2 } from '../../core/contracts';
import { pointAtLength, polylineLength } from '../../core/math';
import { INCISION_PATH, STEP_DEFS } from './testing/a/scenarios';
import { type StepHarness, drawOverlays, setupStep } from './testing/a/setup';

const params = STEP_DEFS.suture.params as SutureParams;
const L = polylineLength(INCISION_PATH);
const perLayer = Math.max(3, Math.floor(L / params.spacingMm));

/** Posición esperada del punto k (0..perLayer-1). */
function expected(k: number, n = perLayer): Vec2 {
  return pointAtLength(INCISION_PATH, (L * (k + 0.5)) / n);
}

/** Trazo vertical que cruza en x con mordiscos de 6 mm, durante `sec` segundos. */
function stitch(h: StepHarness, at: Vec2, sec = 0.6, bite = 6, dx = 0) {
  const a = { x: at.x + dx, y: at.y - bite };
  const b = { x: at.x + dx, y: at.y + bite };
  h.d.stroke([a, b], (2 * bite) / sec);
}

describe('Sutura', () => {
  it('se completa por capas con trazos que cruzan en el punto marcado', () => {
    const h = setupStep('suture');
    const { f, step } = h;
    expect(step.instruments).toEqual(['needleHolder']);
    expect(step.checklist()[0].label).toBe(`Sutura de fascia (0/${perLayer})`);
    for (let layer = 0; layer < params.layers.length; layer++) {
      for (let k = 0; k < perLayer; k++) stitch(h, expected(k));
    }
    h.d.tick(0.5);
    expect(step.isComplete()).toBe(true);
    expect(f.wound.closure).toBe(1);
    expect(f.wound.decals.filter((x) => x.kind === 'stitch')).toHaveLength(perLayer * params.layers.length);
    expect(f.wound.decals[0].opts?.to).toBeDefined();
    expect(f.log.gestureList).toHaveLength(perLayer * params.layers.length);
    expect(f.log.gestureList.every((g) => g.quality > 0.9)).toBe(true);
    expect(f.audio.plays).toContain('suturePull');
    expect(f.audio.plays).toContain('knot');
    expect(step.checklist().every((c) => c.done)).toBe(true);
  });

  it('el cierre progresa con cada punto', () => {
    const h = setupStep('suture');
    stitch(h, expected(0));
    expect(h.f.wound.closure).toBeCloseTo(1 / (perLayer * params.layers.length));
  });

  it('trazos inválidos: sin cruzar, mordisco corto o lejos del punto', () => {
    const h = setupStep('suture');
    const e = expected(0);
    // No cruza.
    h.d.stroke([{ x: e.x, y: e.y - 8 }, { x: e.x + 5, y: e.y - 4 }], 20);
    // Mordisco corto (sale a 2 mm).
    h.d.stroke([{ x: e.x, y: e.y - 6 }, { x: e.x, y: e.y + 2 }], 20);
    // Lejos del punto esperado (siguiente posición).
    stitch(h, expected(2));
    expect(h.f.wound.decals).toHaveLength(0);
    expect(h.f.log.gestureList).toHaveLength(0);
    const texts = h.f.hud.pops.map((p) => p.text);
    expect(texts).toContain('Cruza la incisión de lado a lado');
    expect(texts).toContain('Muerde más: entra y sal a ≥ 3 mm del borde');
    expect(texts.some((t) => t.startsWith('Aquí no') || t === 'Espaciado irregular')).toBe(true);
    expect(h.step.gauges()[0].value).toBeGreaterThan(params.spacingMm * 0.5);
  });

  it('un trazo demasiado rápido marca "Tensión excesiva" y baja la calidad', () => {
    const h = setupStep('suture');
    stitch(h, expected(0), 0.1);
    expect(h.f.hud.pops.some((p) => p.text === 'Tensión excesiva')).toBe(true);
    expect(h.f.log.gestureList[0].quality).toBeLessThan(0.6);
  });

  it('tolerancia de espaciado ×1,5 en el tutorial', () => {
    const off = 0.6 * params.spacingMm; // 7,2 mm: fuera de 6, dentro de 9
    const n = setupStep('suture');
    stitch(n, expected(0), 0.6, 6, off);
    expect(n.f.log.gestureList).toHaveLength(0);
    const t = setupStep('suture', { tutorial: true });
    stitch(t, expected(0), 0.6, 6, off);
    expect(t.f.log.gestureList).toHaveLength(1);
  });

  it('mínimo de 3 puntos por capa en incisiones cortas', () => {
    const def: StepDef = {
      ...STEP_DEFS.suture,
      params: { ...params, path: [{ x: 70, y: 50 }, { x: 90, y: 50 }], layers: ['skin'] },
    };
    const h = setupStep('suture', { def });
    expect(h.step.checklist()[0].label).toBe('Sutura de piel (0/3)');
  });

  it('overlay del punto (atenuado sin guía), pistas y end()', () => {
    const full = setupStep('suture');
    const cFull = drawOverlays(full.f);
    expect(cFull.get('quadraticCurveTo') ?? 0).toBe(1);
    const none = setupStep('suture', { guideLevel: 'none' });
    const cNone = drawOverlays(none.f);
    expect(cNone.get('quadraticCurveTo') ?? 0).toBe(0);
    // Entrada y salida siempre visibles: 2 marcadores × (halo + anillo + punto central).
    expect(cNone.get('arc') ?? 0).toBe(6);
    expect(cNone.get('fillText') ?? 0).toBe(0);
    expect(full.step.hint().length).toBeLessThanOrEqual(90);
    expect(full.step.hint()).toMatch(/clic izq/);
    full.step.end();
    expect(full.f.wound.overlays.size).toBe(0);
  });
});
