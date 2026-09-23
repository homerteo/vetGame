import { describe, expect, it } from 'vitest';
import type { BleedType } from '../../core/contracts';
import { classifyCautery, clipHint, createCauteryTool, signedDistToPolyline } from './CauteryTool';
import { PointerDriver } from './testing/a/driver';
import { createFakeContext } from './testing/a/fakeContext';
import { LIMB_ANATOMY } from './testing/a/scenarios';
import { drawOverlays } from './testing/a/setup';

function setup(tutorial = false) {
  const f = createFakeContext({ anatomy: LIMB_ANATOMY, tutorial });
  const tool = createCauteryTool(f.ctx);
  const d = new PointerDriver(tool, f, 'cautery');
  const spawn = (kind: BleedType, x = 80, y = 50) => f.bleeding.spawn({ x, y }, kind, f.clock.t);
  return { f, tool, d, spawn };
}

describe('Ventanas de contacto del cauterio', () => {
  it.each([
    [0.2, 'noSeal', 0],
    [0.49, 'noSeal', 0],
    [0.5, 'good', 0.7],
    [0.9, 'good', 0.7],
    [1, 'perfect', 1],
    [1.5, 'perfect', 1],
    [2, 'perfect', 1],
    [2.4, 'over', 0.75],
    [2.99, 'over', 0.75],
    [3, 'char', 0.3],
    [4, 'char', 0.3],
  ])('%s s → %s', (sec, outcome, q) => {
    const r = classifyCautery(sec);
    expect(r.outcome).toBe(outcome);
    expect(r.quality).toBeCloseTo(q);
  });
});

describe('Cauterio universal', () => {
  it('1,5 s sobre un arterial reciente: sella perfecto, bonus +4 y mensaje de la pareja', () => {
    const { f, d, spawn } = setup();
    const b = spawn('arterial');
    d.hold(81, 50, 1.5);
    expect(b.active).toBe(false);
    expect(b.charred).toBeFalsy();
    expect(f.log.gestureList).toHaveLength(1);
    expect(f.log.gestureList[0].quality).toBe(1);
    expect(f.log.bonusList).toEqual([{ label: 'Hemorragia arterial controlada', exitoDelta: 4 }]);
    expect(f.emiliana.offers).toBe(1);
    const sealed = f.events.find((e) => e.type === 'bleeder:sealed');
    expect(sealed?.payload).toMatchObject({ id: b.id, kind: 'arterial' });
    expect(f.audio.activeLoops()).toHaveLength(0);
  });

  it('arterial sellado tarde (> 5 s) no da bonus', () => {
    const { f, d, spawn } = setup();
    spawn('arterial');
    d.tick(5);
    d.hold(80, 50, 1.2);
    expect(f.log.bonusList).toHaveLength(0);
    expect(f.log.gestureList).toHaveLength(1);
  });

  it('< 0,5 s no sella ("No selló")', () => {
    const { f, d, spawn } = setup();
    const b = spawn('venous');
    d.hold(80, 50, 0.3);
    expect(b.active).toBe(true);
    expect(f.hud.pops.some((p) => p.text === 'No selló')).toBe(true);
    expect(f.log.gestureList).toHaveLength(0);
  });

  it('0,5–1 s sella con calidad 0,7 y 2–3 s con 0,75', () => {
    const a = setup();
    a.spawn('capillary');
    a.d.hold(80, 50, 0.7);
    expect(a.f.log.gestureList[0].quality).toBeCloseTo(0.7);
    const b = setup();
    b.spawn('capillary');
    b.d.hold(80, 50, 2.5);
    expect(b.f.log.gestureList[0].quality).toBeCloseTo(0.75);
  });

  it('mantener 3 s sella carbonizado: falta char, calcomanía, humo y auto-suelta', () => {
    const { f, tool, d, spawn } = setup();
    const b = spawn('arterial');
    d.down(80, 50).tick(3.2);
    expect(b.active).toBe(false);
    expect(b.charred).toBe(true);
    expect(f.log.faults()).toEqual(['char']);
    expect(f.wound.decals.some((x) => x.kind === 'char')).toBe(true);
    expect(f.log.bonusList).toHaveLength(0);
    expect(tool.contactSeconds()).toBe(0);
    expect(f.audio.activeLoops()).toHaveLength(0);
    // Seguir pulsando no hace nada más; soltar tampoco.
    d.tick(2).up();
    expect(f.log.faults()).toEqual(['char']);
    expect(f.log.gestureList).toHaveLength(0);
  });

  it('sobre tejido sin sangrado: calcomanía a 1 s sin falta; falta a los 3 s', () => {
    const { f, d } = setup();
    d.down(40, 40).tick(1.3);
    expect(f.wound.decals.filter((x) => x.kind === 'char')).toHaveLength(1);
    expect(f.log.faults()).toHaveLength(0);
    d.tick(2);
    expect(f.log.faults()).toEqual(['char']);
    d.up();
  });

  it('apartarse del vaso cuenta como soltar', () => {
    const { d, spawn } = setup();
    const b = spawn('venous');
    d.down(80, 50).tick(1.2);
    d.move(90, 50);
    expect(b.active).toBe(false);
  });

  it('radio 4 mm (6 mm en tutorial)', () => {
    const n = setup();
    const b1 = n.spawn('venous');
    n.d.hold(85, 50, 1.2);
    expect(b1.active).toBe(true);
    const t = setup(true);
    const b2 = t.spawn('venous');
    t.d.hold(85, 50, 1.2);
    expect(b2.active).toBe(false);
  });

  it('medidor de contacto con zonas; overlay y humo se retiran solos; dispose limpia', () => {
    const { f, tool, d, spawn } = setup();
    spawn('venous');
    d.down(80, 50).tick(1.2);
    const g = tool.gauges()[0];
    expect(g.label).toBe('Contacto');
    expect(g.value).toBeCloseTo(1.2, 1);
    expect(g.zones?.find((z) => z.kind === 'good')).toEqual({ from: 1, to: 2, kind: 'good' });
    expect(f.wound.overlays.has('cautery-tool')).toBe(true);
    const calls = drawOverlays(f);
    expect(calls.get('arc') ?? 0).toBeGreaterThan(3);
    expect(f.audio.activeLoops()[0].name).toBe('cautery');
    d.up();
    expect(tool.gauges()[0].value).toBe(0);
    d.tick(3);
    expect(f.wound.overlays.has('cautery-tool')).toBe(false);
    d.down(40, 40);
    tool.dispose();
    expect(f.wound.overlays.size).toBe(0);
    expect(f.audio.activeLoops()).toHaveLength(0);
  });
});

describe('Utilidades', () => {
  it('signedDistToPolyline da signo por lado y longitud de arco', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ];
    const out = { d: 0, s: 0, x: 0, y: 0 };
    signedDistToPolyline({ x: 15, y: 3 }, path, out);
    expect(Math.abs(out.d)).toBeCloseTo(3);
    expect(out.s).toBeCloseTo(15);
    const up = out.d;
    signedDistToPolyline({ x: 15, y: -3 }, path, out);
    expect(Math.sign(out.d)).toBe(-Math.sign(up));
  });

  it('clipHint recorta a 90 caracteres', () => {
    expect(clipHint('a'.repeat(120))).toHaveLength(90);
    expect(clipHint('hola')).toBe('hola');
  });
});
