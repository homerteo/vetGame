import { describe, expect, it } from 'vitest';
import type { RetractParams, StepDef } from '../../core/contracts';
import { STEP_DEFS } from './testing/a/scenarios';
import { drawOverlays, setupStep } from './testing/a/setup';
import { RETRACTOR_OVERLAY_ID } from './Retract';
import { STEPS_A } from './registryA';

const params = STEP_DEFS.retract.params as RetractParams;

describe('Separadores', () => {
  it('colocar puntas y abrir hasta los clics ideales completa el paso', () => {
    const { f, step, d } = setupStep('retract');
    expect(step.instruments).toEqual(['gelpi']);
    for (const pair of params.pairs) {
      d.click(pair.a.x, pair.a.y);
      d.click(pair.b.x + 1, pair.b.y);
      for (let i = 0; i < params.idealClicks; i++) d.click(80, 30);
    }
    expect(step.isComplete()).toBe(true);
    expect(f.wound.retraction).toBe(1);
    expect(f.log.gestureList).toHaveLength(2);
    expect(f.log.gestureList[0].label).toBe('Separador Gelpi');
    expect(f.log.gestureList[0].quality).toBeGreaterThan(0.9);
    expect(f.log.faultList).toHaveLength(0);
    expect(f.audio.plays.filter((s) => s === 'retractorClick').length).toBeGreaterThanOrEqual(2 * params.idealClicks);
    expect(f.audio.plays).toContain('squelch');
  });

  it('colocar los dos separadores primero y abrir después también completa el paso', () => {
    const { f, step, d } = setupStep('retract');
    expect(params.pairs.length).toBeGreaterThanOrEqual(2);
    for (const pair of params.pairs) {
      d.click(pair.a.x, pair.a.y);
      d.click(pair.b.x, pair.b.y);
    }
    for (let i = 0; i < params.idealClicks * params.pairs.length; i++) d.click(80, 30);
    expect(step.isComplete()).toBe(true);
    expect(f.wound.retraction).toBe(1);
    expect(f.log.faultList).toHaveLength(0);
  });

  it('la retracción es la media de clics/ideales entre pares', () => {
    const { f, d } = setupStep('retract');
    const p0 = params.pairs[0];
    d.click(p0.a.x, p0.a.y).click(p0.b.x, p0.b.y);
    d.click(80, 30).click(80, 30);
    expect(f.wound.retraction).toBeCloseTo(2 / params.idealClicks / 2);
  });

  it('pasarse de maxClicks: falta overRetraction una vez y estrés +10', () => {
    const { f, step, d } = setupStep('retract');
    const p0 = params.pairs[0];
    d.click(p0.a.x, p0.a.y).click(p0.b.x, p0.b.y);
    for (let i = 0; i < params.maxClicks + 3; i++) d.click(80, 30, 1); // clic de rueda
    expect(f.log.faults()).toEqual(['overRetraction']);
    expect(f.emiliana.stresses).toEqual([{ amount: 10, reason: 'Separó de más' }]);
    expect(step.isComplete()).toBe(false);
  });

  it('un clic lejos del borde no coloca la punta', () => {
    const { f, step, d } = setupStep('retract');
    d.click(120, 20);
    expect(step.progress()).toBe(0);
    expect(f.hud.pops.at(-1)?.text).toMatch(/borde/);
    // A 3 mm sí (tolerancia 5 mm) y la calidad baja con el error.
    const p0 = params.pairs[0];
    d.click(p0.a.x + 3, p0.a.y).click(p0.b.x, p0.b.y + 3);
    for (let i = 0; i < params.idealClicks; i++) d.click(80, 30);
    expect(f.log.gestureList[0].quality).toBeCloseTo(1 - (3 / 5) * 0.6);
  });

  it('tutorial: tolerancia 7,5 mm', () => {
    const one: StepDef = { ...STEP_DEFS.retract, params: { ...params, pairs: [params.pairs[0]] } };
    const n = setupStep('retract', { def: one });
    n.d.click(params.pairs[0].a.x + 6.5, params.pairs[0].a.y);
    expect(n.step.progress()).toBe(0);
    const t = setupStep('retract', { def: one, tutorial: true });
    t.d.click(params.pairs[0].a.x + 6.5, params.pairs[0].a.y);
    expect(t.step.progress()).toBeGreaterThan(0);
  });

  it('medidor de apertura, pistas ≤ 90 con teclas, overlay del separador y end()', () => {
    const { f, step, d } = setupStep('retract');
    expect(step.hint()).toMatch(/clic izq/i);
    const p0 = params.pairs[0];
    d.click(p0.a.x, p0.a.y).click(p0.b.x, p0.b.y).click(80, 30);
    expect(step.gauges()[0].label).toBe('Apertura');
    expect(step.gauges()[0].value).toBe(1);
    expect(step.hint()).toMatch(/rueda/);
    expect(step.hint().length).toBeLessThanOrEqual(90);
    const calls = drawOverlays(f);
    expect(calls.get('quadraticCurveTo') ?? 0).toBeGreaterThan(0);
    expect(calls.get('ellipse') ?? 0).toBe(2); // anillas rosas
    step.end();
    // El separador sigue puesto (la herida sigue abierta) hasta el cierre.
    expect([...f.wound.overlays.keys()]).toEqual([RETRACTOR_OVERLAY_ID]);
    const after = drawOverlays(f);
    expect(after.get('ellipse') ?? 0).toBe(2);
    // La sutura lo retira y deja de separar.
    const suture = STEPS_A.suture!(STEP_DEFS.suture);
    suture.begin(f.ctx);
    expect(f.wound.overlays.has(RETRACTOR_OVERLAY_ID)).toBe(false);
    expect(f.wound.retraction).toBe(0);
    suture.end();
    expect(f.wound.overlays.size).toBe(0);
  });

  it('sin separador colocado, end() no deja nada', () => {
    const { f, step } = setupStep('retract');
    step.end();
    expect(f.wound.overlays.size).toBe(0);
  });
});
