import { describe, expect, it } from 'vitest';
import type { AnatomyDef, PickParams, StepDef } from '../../core/contracts';
import { PICK } from './Pick';
import { SPINE_ANATOMY, STEP_DEFS } from './testing/a/scenarios';
import { drawOverlays, setupStep } from './testing/a/setup';

const params = STEP_DEFS.pick.params as PickParams;

describe('Extracción con pinzas', () => {
  it('saca todo el material y retira la lámina arrastrándola fuera: completo', () => {
    const { f, step, d } = setupStep('pick');
    expect(step.instruments).toEqual(['forceps']);
    for (const it of params.items) d.hold(it.pos.x, it.pos.y, PICK.holdSec + 0.1);
    expect(f.log.gestureList).toHaveLength(4);
    expect(step.isComplete()).toBe(false);
    // Lámina en (80,42): arrastrar hacia arriba fuera de la ventana (y < 34).
    d.down(80, 42).drag(
      [
        { x: 80, y: 42 },
        { x: 80, y: 20 },
      ],
      40,
    );
    d.up();
    expect(f.bone.fragment('lamina')?.removed).toBe(true);
    expect(f.audio.plays).toContain('boneClonk');
    expect(f.audio.plays).toContain('crunch');
    expect(step.isComplete()).toBe(true);
    expect(f.log.gestureList).toHaveLength(5);
    expect(f.log.faultList).toHaveLength(0);
    expect(step.checklist().every((c) => c.done)).toBe(true);
  });

  it('un agarre corto (< 0,6 s) no extrae', () => {
    const { f, step, d } = setupStep('pick');
    const it0 = params.items[0];
    d.hold(it0.pos.x, it0.pos.y, 0.3);
    expect(f.log.gestureList).toHaveLength(0);
    expect(step.progress()).toBe(0);
    expect(f.hud.pops.some((p) => p.text.includes('agarre'))).toBe(true);
  });

  it('tocar la médula: falta cordTouch, estrés 15, destello y aviso, con enfriamiento de 2 s', () => {
    const { f, d } = setupStep('pick');
    d.down(80, 58); // dentro de la médula
    expect(f.log.faults()).toEqual(['cordTouch']);
    expect(f.emiliana.stresses).toEqual([{ amount: 15, reason: 'Tocó la médula' }]);
    expect(f.wound.flashes).toEqual([{ color: '#ff4d6d', ms: 150 }]);
    expect(f.hud.pops.some((p) => p.text === '¡La médula!')).toBe(true);
    d.drag([{ x: 80, y: 58 }, { x: 90, y: 58 }], 20); // 0,5 s más dentro
    expect(f.log.faults()).toHaveLength(1);
    d.tick(2);
    d.move(91, 58);
    expect(f.log.faults()).toHaveLength(2);
    d.up();
  });

  it('a menos de 1 mm del borde también cuenta; a 2 mm no', () => {
    const { f, d } = setupStep('pick');
    d.click(80, 55 - 2); // borde superior en y = 55
    expect(f.log.faults()).toHaveLength(0);
    d.click(80, 55 - 0.8);
    expect(f.log.faults()).toEqual(['cordTouch']);
  });

  it('fragmento bloqueado: no se puede sacar', () => {
    const anatomy: AnatomyDef = {
      ...SPINE_ANATOMY,
      fragments: SPINE_ANATOMY.fragments.map((fr) => ({ ...fr, locked: true })),
    };
    const { f, d } = setupStep('pick', { anatomy });
    d.down(80, 42).drag([{ x: 80, y: 42 }, { x: 80, y: 20 }], 40).up();
    expect(f.bone.fragment('lamina')?.removed).toBe(false);
    expect(f.hud.pops.some((p) => p.text.includes('unido'))).toBe(true);
  });

  it('soltar el fragmento dentro de la herida no lo retira', () => {
    const { f, d } = setupStep('pick');
    d.down(80, 42).drag([{ x: 80, y: 42 }, { x: 70, y: 40 }], 40).up();
    expect(f.bone.fragment('lamina')?.removed).toBe(false);
    expect(f.bone.fragment('lamina')?.pose.pos.x).toBeCloseTo(70);
  });

  it('medidores, overlay de pepitas y zona prohibida, pistas y end()', () => {
    const { f, step, d } = setupStep('pick');
    expect(step.gauges().map((g) => g.label)).toEqual(['Agarre', 'Distancia a la médula']);
    d.down(params.items[0].pos.x, params.items[0].pos.y).tick(0.3);
    expect(step.gauges()[0].value).toBeCloseTo(0.3, 1);
    const calls = drawOverlays(f);
    expect(calls.get('quadraticCurveTo') ?? 0).toBeGreaterThanOrEqual(params.items.length * 10);
    expect(calls.get('fillText') ?? 0).toBe(1); // «MÉDULA · ¡no tocar!»
    expect(step.hint().length).toBeLessThanOrEqual(90);
    expect(step.hint()).toMatch(/clic izq/);
    step.end();
    expect(f.wound.overlays.size).toBe(0);
  });

  it('sin zonas prohibidas no hay medidor de médula', () => {
    const def: StepDef = { ...STEP_DEFS.pick, params: { ...params, forbidden: undefined, removeFragmentIds: [] } };
    const anatomy: AnatomyDef = { ...SPINE_ANATOMY, cord: undefined };
    const { step, d } = setupStep('pick', { def, anatomy });
    expect(step.gauges()).toHaveLength(1);
    for (const it of params.items) d.hold(it.pos.x, it.pos.y, 0.7);
    expect(step.isComplete()).toBe(true);
  });
});
