import { describe, expect, it } from 'vitest';
import type { ClickTargetsParams, StepDef } from '../../core/contracts';
import { STEP_DEFS } from './testing/a/scenarios';
import { drawOverlays, setupStep } from './testing/a/setup';

const params = STEP_DEFS.clickTargets.params as ClickTargetsParams;
const withParams = (p: Partial<ClickTargetsParams>): StepDef => ({ ...STEP_DEFS.clickTargets, params: { ...params, ...p } });

describe('Clic en objetivos', () => {
  it('agujas de Kirschner en orden: implantes, sonido kwire y gesto por distancia', () => {
    const { f, step, d } = setupStep('clickTargets');
    expect(step.instruments).toEqual(['kwire']);
    d.click(params.targets[0].pos.x, params.targets[0].pos.y);
    d.click(params.targets[1].pos.x + 1.25, params.targets[1].pos.y);
    d.click(params.targets[2].pos.x, params.targets[2].pos.y);
    expect(step.isComplete()).toBe(true);
    expect(f.bone.implants.pins).toEqual(params.targets.map((t) => ({ pos: t.pos, kind: 'kwire' })));
    expect(f.audio.plays.filter((s) => s === 'kwire')).toHaveLength(3);
    const q = f.log.gestureList.map((g) => g.quality);
    expect(q[0]).toBe(1);
    expect(q[1]).toBeCloseTo(0.75);
    expect(f.log.gestureList[0].label).toBe('Agujas de Kirschner: Aguja proximal');
    expect(step.checklist()[0]).toEqual({ label: 'Agujas de Kirschner (3/3)', done: true });
  });

  it('fallar: "Casi…" y rayón con instrumento afilado; en orden no vale el siguiente', () => {
    const { f, step, d } = setupStep('clickTargets');
    d.click(params.targets[1].pos.x, params.targets[1].pos.y); // se salta el primero
    expect(step.progress()).toBe(0);
    expect(f.hud.pops.at(-1)?.text).toBe('Casi…');
    expect(f.wound.decals.filter((x) => x.kind === 'scratch')).toHaveLength(1);
    expect(f.bone.implants.pins).toHaveLength(0);
  });

  it('sin filo no raya; desordenado acepta cualquiera', () => {
    const def = withParams({ ordered: false, instrument: 'forceps', decal: 'graft' });
    const { f, step, d } = setupStep('clickTargets', { def });
    d.click(20, 20);
    expect(f.wound.decals).toHaveLength(0);
    d.click(params.targets[2].pos.x, params.targets[2].pos.y);
    d.click(params.targets[0].pos.x, params.targets[0].pos.y);
    d.click(params.targets[1].pos.x, params.targets[1].pos.y);
    expect(step.isComplete()).toBe(true);
    expect(f.wound.decals.filter((x) => x.kind === 'graft')).toHaveLength(3);
    expect(f.audio.plays).toContain('retractorClick');
  });

  it('cerclaje: alambres por pares consecutivos al terminar', () => {
    const targets = [0, 1, 2, 3].map((i) => ({ pos: { x: 50 + i * 10, y: 50 }, label: `Punto ${i + 1}` }));
    const { f, step, d } = setupStep('clickTargets', { def: withParams({ targets, decal: 'wire', instrument: 'kwire' }) });
    for (const t of targets) {
      expect(f.bone.implants.wires).toHaveLength(0);
      d.click(t.pos.x, t.pos.y);
    }
    expect(step.isComplete()).toBe(true);
    expect(f.bone.implants.wires).toEqual([
      { a: targets[0].pos, b: targets[1].pos },
      { a: targets[2].pos, b: targets[3].pos },
    ]);
  });

  it('abrazaderas: calcomanía clamp y barra del primero al último', () => {
    const { f, d } = setupStep('clickTargets', { def: withParams({ decal: 'clamp', instrument: 'hand' }) });
    for (const t of params.targets) d.click(t.pos.x, t.pos.y);
    expect(f.wound.decals.filter((x) => x.kind === 'clamp')).toHaveLength(3);
    expect(f.bone.implants.bars).toEqual([{ a: params.targets[0].pos, b: params.targets[2].pos }]);
  });

  it('tutorial: tolerancia ×1,5', () => {
    const at = { x: params.targets[0].pos.x + 3.2, y: params.targets[0].pos.y };
    const n = setupStep('clickTargets');
    n.d.click(at.x, at.y);
    expect(n.step.progress()).toBe(0);
    const t = setupStep('clickTargets', { tutorial: true });
    t.d.click(at.x, at.y);
    expect(t.step.progress()).toBeCloseTo(1 / 3);
  });

  it('guías: anillos+etiquetas / solo anillos / anillos tenues (siempre visibles)', () => {
    const full = setupStep('clickTargets');
    expect(drawOverlays(full.f).get('fillText')).toBe(3);
    const ends = setupStep('clickTargets', { guideLevel: 'endpoints' });
    const ce = drawOverlays(ends.f);
    expect(ce.get('fillText') ?? 0).toBe(0);
    expect(ce.get('arc')).toBe(3);
    // Sin guías los objetivos siguen visibles (el jugador nunca debe adivinar dónde actuar).
    const none = setupStep('clickTargets', { guideLevel: 'none' });
    const cn = drawOverlays(none.f);
    expect(cn.get('arc')).toBe(3);
    expect(cn.get('fillText') ?? 0).toBe(0);
    none.d.move(params.targets[0].pos.x + 4, params.targets[0].pos.y);
    expect(drawOverlays(none.f).get('arc')).toBe(3);
  });

  it('pistas ≤ 90 con teclas y end() limpia', () => {
    const { f, step } = setupStep('clickTargets');
    expect(step.hint()).toMatch(/Clic izq/);
    expect(step.hint().length).toBeLessThanOrEqual(90);
    step.end();
    expect(f.wound.overlays.size).toBe(0);
  });
});
