import { describe, expect, it } from 'vitest';
import type { CaseDef } from '../core/contracts';
import { pointInPolygon } from '../core/math';
import {
  areaCentroid,
  carveTop,
  cleanPoly,
  closedSpline,
  fractureLine,
  isSimplePolygon,
  longBone,
  P,
  rotatePoseAround,
  roundedRect,
  signedArea,
  splitLongBone,
  superEllipse,
  toLocal,
  type LongBoneSpec,
} from './geometry';
import { caseSummary, caseSvg } from './summary';
import { CASES } from './cases';

const BONE: LongBoneSpec = {
  top: [P(30, 46), P(60, 47), P(90, 47), P(120, 45)],
  bottom: [P(30, 54), P(60, 53), P(90, 53), P(120, 55)],
  capLeft: [P(27, 52), P(26, 50), P(27, 48)],
  capRight: [P(123, 46), P(124, 50), P(123, 54)],
};

const area = (poly: ReturnType<typeof longBone>) => Math.abs(signedArea(poly));

describe('geometría de datos', () => {
  it('roundedRect: rectángulo cerrado con el área esperada', () => {
    const r = roundedRect(0, 0, 100, 40, 8);
    expect(isSimplePolygon(r)).toBe(true);
    const expected = 100 * 40 - (4 - Math.PI) * 64;
    expect(area(r)).toBeGreaterThan(expected * 0.98);
    expect(area(r)).toBeLessThan(expected * 1.01);
  });

  it('longBone: contorno simple que contiene su eje', () => {
    const b = longBone(BONE);
    expect(isSimplePolygon(b)).toBe(true);
    for (let x = 32; x < 120; x += 8) expect(pointInPolygon(P(x, 50), b)).toBe(true);
    expect(pointInPolygon(P(75, 40), b)).toBe(false);
  });

  it('splitLongBone: las piezas cubren el hueso completo sin solaparse', () => {
    const whole = longBone(BONE);
    const pieces = splitLongBone(BONE, [fractureLine(60, 42, 58, 6, 1, 1), fractureLine(90, 42, 58, 6, 1, 2)]);
    expect(pieces).toHaveLength(3);
    for (const p of pieces) expect(isSimplePolygon(p)).toBe(true);
    const sum = pieces.reduce((s, p) => s + area(p), 0);
    expect(sum).toBeCloseTo(area(whole), 0);
    // Cada punto del eje pertenece a exactamente una pieza (salvo en la línea de fractura).
    for (const x of [40, 75, 110]) expect(pieces.filter((p) => pointInPolygon(P(x, 50), p))).toHaveLength(1);
  });

  it('splitLongBone lanza si el corte no cruza el hueso', () => {
    expect(() => splitLongBone(BONE, [[P(10, 10), P(12, 20)]])).toThrow();
  });

  it('carveTop: bloque + hueso con muesca conservan el área', () => {
    const whole = longBone(BONE);
    const { bone, block } = carveTop(BONE, [P(50, 49), P(70, 49)]);
    expect(isSimplePolygon(bone)).toBe(true);
    expect(isSimplePolygon(block)).toBe(true);
    expect(area(bone) + area(block)).toBeCloseTo(area(whole), 0);
    expect(pointInPolygon(P(60, 48), block)).toBe(true);
    expect(pointInPolygon(P(60, 48), bone)).toBe(false);
  });

  it('toLocal centra el polígono en su centroide', () => {
    const { polygon, origin } = toLocal(superEllipse(40, 30, 5, 3, 3));
    const c = areaCentroid(polygon);
    expect(Math.hypot(c.x, c.y)).toBeLessThan(0.05);
    expect(origin.x).toBeCloseTo(40, 1);
    expect(origin.y).toBeCloseTo(30, 1);
  });

  it('rotatePoseAround conserva la distancia al pivote', () => {
    const pose = { pos: P(10, 0), angleDeg: 5 };
    const r = rotatePoseAround(pose, P(0, 0), 90);
    expect(r.angleDeg).toBe(95);
    expect(r.pos.x).toBeCloseTo(0, 5);
    expect(r.pos.y).toBeCloseTo(10, 5);
  });

  it('closedSpline y cleanPoly no dejan puntos repetidos', () => {
    const s = closedSpline([P(0, 0), P(10, 0), P(10, 10), P(0, 10)], 4);
    expect(s.length).toBeGreaterThan(8);
    expect(isSimplePolygon(s)).toBe(true);
    expect(cleanPoly([P(0, 0), P(0, 0.01), P(5, 5), P(10, 0), P(0, 0)])).toHaveLength(3);
  });

  it('isSimplePolygon detecta un lazo en ocho', () => {
    expect(isSimplePolygon([P(0, 0), P(10, 10), P(10, 0), P(0, 10)])).toBe(false);
  });
});

describe('resumen y SVG', () => {
  it('caseSummary lista todas las fases', () => {
    for (const c of CASES as CaseDef[]) {
      const s = caseSummary(c);
      for (const ph of c.phases) expect(s).toContain(ph.label);
    }
  });

  it('caseSvg produce un SVG con la ventana y los huesos', () => {
    const svg = caseSvg(CASES[5], { mode: 'both' });
    expect(svg.startsWith('<svg')).toBe(true);
    expect((svg.match(/<polygon/g) ?? []).length).toBeGreaterThan(3);
  });
});
