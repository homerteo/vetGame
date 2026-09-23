import { describe, expect, it } from 'vitest';
import { createBone } from './Bone';
import { makeAnatomy } from './testing/fixtures';

describe('Bone', () => {
  it('crea fragmentos con pose inicial (copiada) y bloqueos del def', () => {
    const anatomy = makeAnatomy();
    const bone = createBone(anatomy);
    const f = bone.fragments();
    expect(f.map((s) => s.id)).toEqual(['distal', 'esquirla', 'bloque']);
    expect(bone.fragment('distal')?.pose).toEqual({ pos: { x: 95, y: 58 }, angleDeg: 15 });
    expect(bone.fragment('bloque')?.locked).toBe(true);
    expect(bone.fragment('distal')?.locked).toBe(false);
    bone.setPose('distal', { pos: { x: 1, y: 2 }, angleDeg: 3 });
    expect(anatomy.fragments[0].start.pos.x).toBe(95); // el def no se muta
    expect(bone.fragment('nada')).toBeUndefined();
  });

  it('worldPolygon aplica la pose y se actualiza al moverse', () => {
    const bone = createBone(makeAnatomy());
    bone.setPose('distal', { pos: { x: 50, y: 50 }, angleDeg: 90 });
    const poly = bone.worldPolygon('distal');
    expect(poly[0].x).toBeCloseTo(55, 6); // (-15,-5) girado 90° → (5,-15)
    expect(poly[0].y).toBeCloseTo(35, 6);
    bone.setPose('distal', { pos: { x: 60, y: 50 }, angleDeg: 90 });
    expect(bone.worldPolygon('distal')[0].x).toBeCloseTo(65, 6);
    // Mutación directa de la pose también invalida la caché.
    bone.fragment('distal')!.pose.pos.x = 70;
    expect(bone.worldPolygon('distal')[0].x).toBeCloseTo(75, 6);
    expect(bone.worldPolygon('nada')).toEqual([]);
  });

  it('targetPolygon usa el target o null', () => {
    const bone = createBone(makeAnatomy());
    const tp = bone.targetPolygon('distal')!;
    expect(tp[0]).toEqual({ x: 73, y: 45 });
    expect(bone.targetPolygon('esquirla')).toBeNull();
  });

  it('hitTest: el de encima primero, ignora bloqueados y retirados', () => {
    const bone = createBone(makeAnatomy());
    // esquirla (índice 1) está encima de distal en (95,58)
    expect(bone.hitTest({ x: 95, y: 58 })).toBe('esquirla');
    bone.remove('esquirla');
    expect(bone.hitTest({ x: 95, y: 58 })).toBe('distal');
    // bloque bloqueado
    expect(bone.hitTest({ x: 50, y: 50 })).toBeNull();
    expect(bone.hitTest({ x: 50, y: 50 }, true)).toBe('bloque');
    bone.release('bloque');
    expect(bone.hitTest({ x: 50, y: 50 })).toBe('bloque');
    expect(bone.hitTest({ x: 5, y: 5 })).toBeNull();
  });

  it('alignmentError: distancia y ángulo absoluto más corto', () => {
    const bone = createBone(makeAnatomy());
    const e0 = bone.alignmentError('distal');
    expect(e0.mm).toBeCloseTo(Math.hypot(7, 8), 6);
    expect(e0.deg).toBeCloseTo(15, 6);
    bone.setPose('distal', { pos: { x: 88, y: 50 }, angleDeg: 358 });
    const e1 = bone.alignmentError('distal');
    expect(e1.mm).toBe(0);
    expect(e1.deg).toBeCloseTo(2, 6);
    expect(bone.alignmentError('esquirla')).toEqual({ mm: 0, deg: 0 });
  });

  it('isOnBone con hueso estático y fragmentos no retirados', () => {
    const bone = createBone(makeAnatomy());
    expect(bone.isOnBone({ x: 35, y: 50 })).toBe(true);
    expect(bone.isOnBone({ x: 95, y: 58 })).toBe(true);
    bone.remove('distal');
    bone.remove('esquirla');
    expect(bone.isOnBone({ x: 95, y: 58 })).toBe(false);
    expect(bone.isOnBone({ x: 10, y: 10 })).toBe(false);
  });

  it('implantes vacíos y mutables; agujeros de placa en mundo', () => {
    const bone = createBone(makeAnatomy());
    expect(bone.implants).toEqual({ plate: null, screws: [], pins: [], wires: [], bars: [] });
    expect(bone.plateHolesWorld()).toEqual([]);
    bone.implants.plate = {
      optionId: 'p4',
      pose: { pos: { x: 80, y: 50 }, angleDeg: 90 },
      holesLocal: [
        { x: -10, y: 0 },
        { x: 10, y: 0 },
      ],
      lengthMm: 30,
      widthMm: 5,
      bend: 1,
    };
    const holes = bone.plateHolesWorld();
    expect(holes[0].x).toBeCloseTo(80, 6);
    expect(holes[0].y).toBeCloseTo(40, 6);
    expect(holes[1].y).toBeCloseTo(60, 6);
    bone.implants.screws.push({ pos: holes[0], lengthMm: 10, contaminated: false, stripped: false });
    expect(bone.implants.screws.length).toBe(1);
  });

  it('cord y staticPolygons', () => {
    const cord = [
      { x: 10, y: 60 },
      { x: 150, y: 60 },
    ];
    const bone = createBone(makeAnatomy({ cord }));
    expect(bone.cord()).toBe(cord);
    expect(createBone(makeAnatomy()).cord()).toBeNull();
    expect(bone.staticPolygons().length).toBe(1);
  });
});
