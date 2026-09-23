import { describe, expect, it } from 'vitest';
import {
  anchorToMm,
  cameraGoal,
  cameraTransitionSec,
  caseFocusRect,
  easeCamera,
  incisionPathFor,
  instrumentBasis,
  mmToAnchor,
  MICRO_SAFE_FRACTION,
  stepFocusRect,
  WOUND_FOV,
  type V3,
} from './sceneMath';
import { ecgSample, ecgSinus, pleth, vitalsLabel } from './monitorMath';
import { createFakeBloodPool, createFakeBone, roundedWindow, sampleAnatomy, sampleCase } from './fakes';
import type { CaseDef } from '../../core/contracts';

const v = (): V3 => ({ x: 0, y: 0, z: 0 });
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: V3) => Math.sqrt(dot(a, a));

describe('ancla de la herida', () => {
  it('mm ↔ local del ancla es reversible y centrado', () => {
    const o = mmToAnchor({ x: 80, y: 50 }, 0.24, 0.15, v());
    expect(o.x).toBeCloseTo(0);
    expect(o.z).toBeCloseTo(0);
    const c = mmToAnchor({ x: 0, y: 100 }, 0.24, 0.15, v());
    expect(c.x).toBeCloseTo(-0.12);
    expect(c.z).toBeCloseTo(0.075); // y de la herida crece hacia la cirujana (+Z)
    const back = anchorToMm(c.x, c.z, 0.24, 0.15);
    expect(back.x).toBeCloseTo(0);
    expect(back.y).toBeCloseTo(100);
  });
});

describe('cámaras', () => {
  const wc = { x: 0.1, y: 0.96, z: 0 };
  const win = { x: 0.1, y: 0.96, z: 0.01 };
  it('en modo herida la herida ocupa ~60% y la cámara mira en picado desde +Z', () => {
    const g = cameraGoal('wound', wc, win, 0.24, 0.15, 16 / 9, 20, 0.6, { pos: v(), target: v(), fov: 0 });
    expect(g.fov).toBe(WOUND_FOV);
    expect(g.target).toEqual(wc);
    const d = { x: g.pos.x - wc.x, y: g.pos.y - wc.y, z: g.pos.z - wc.z };
    const dist = len(d);
    // 20° desde la vertical.
    expect(Math.acos(d.y / dist) * (180 / Math.PI)).toBeCloseTo(20, 3);
    expect(d.z).toBeGreaterThan(0);
    const visH = 2 * dist * Math.tan((WOUND_FOV * Math.PI) / 360);
    const frac = Math.max(0.24 / (visH * (16 / 9)), (0.15 * Math.cos((20 * Math.PI) / 180)) / visH);
    expect(frac).toBeCloseTo(0.6, 3);
  });
  it('micro es ×3 más cerca y centrada en la ventana', () => {
    const w = cameraGoal('wound', wc, win, 0.24, 0.15, 1.6, 20, 0.6, { pos: v(), target: v(), fov: 0 });
    const m = cameraGoal('micro', wc, win, 0.24, 0.15, 1.6, 20, 0.6, { pos: v(), target: v(), fov: 0 });
    const dw = Math.hypot(w.pos.x - wc.x, w.pos.y - wc.y, w.pos.z - wc.z);
    const dm = Math.hypot(m.pos.x - win.x, m.pos.y - win.y, m.pos.z - win.z);
    expect(dw / dm).toBeCloseTo(3, 5);
    expect(m.target).toEqual(win);
  });
  it('la vista general mira hacia la mesa desde arriba', () => {
    const g = cameraGoal('overview', wc, win, 0.24, 0.15, 1.8, 20, 0.6, { pos: v(), target: v(), fov: 0 });
    expect(g.pos.y).toBeGreaterThan(g.target.y);
    expect(g.fov).toBe(50);
  });
});

describe('encuadre de micro y transiciones', () => {
  const wc = { x: 0, y: 1, z: 0 };
  it('con zona de trabajo se centra en ella y la zona cabe en la parte libre de HUD', () => {
    const aspect = 16 / 9;
    const center = { x: 0.05, y: 1, z: 0.01 };
    const focus = { center, wM: 0.16, hM: 0.04 };
    const m = cameraGoal('micro', wc, wc, 0.24, 0.15, aspect, 20, 0.6, { pos: v(), target: v(), fov: 0 }, focus);
    expect(m.target).toEqual(center);
    const dist = Math.hypot(m.pos.x - center.x, m.pos.y - center.y, m.pos.z - center.z);
    const visH = 2 * dist * Math.tan((WOUND_FOV * Math.PI) / 360);
    expect(focus.wM / (visH * aspect)).toBeLessThanOrEqual(MICRO_SAFE_FRACTION + 1e-6);
    // Nunca más lejos que la vista de herida normal ni más cerca que ×3.
    const w = cameraGoal('wound', wc, wc, 0.24, 0.15, aspect, 20, 0.6, { pos: v(), target: v(), fov: 0 });
    const dw = Math.hypot(w.pos.x - wc.x, w.pos.y - wc.y, w.pos.z - wc.z);
    expect(dist).toBeLessThanOrEqual(dw + 1e-9);
    const tiny = cameraGoal('micro', wc, wc, 0.24, 0.15, aspect, 20, 0.6, { pos: v(), target: v(), fov: 0 }, { center, wM: 0.001, hM: 0.001 });
    const dt = Math.hypot(tiny.pos.x - center.x, tiny.pos.y - center.y, tiny.pos.z - center.z);
    expect(dw / dt).toBeCloseTo(3, 5);
  });
  it('zonas de trabajo por paso', () => {
    const anatomy = sampleAnatomy();
    expect(stepFocusRect({ type: 'bandage', center: { x: 80, y: 50 }, radiusMm: 22, turns: 3 }, anatomy)).toEqual({ x0: 54, y0: 24, x1: 106, y1: 76 });
    const pins = stepFocusRect({ type: 'drillPins', spots: [{ x: 46, y: 50 }, { x: 114, y: 50 }], tolMm: 1, item: 'pin', cortexProfileMm: [1, 2, 1] }, anatomy)!;
    expect(pins.x0).toBeLessThan(46);
    expect(pins.x1).toBeGreaterThan(114);
    expect(stepFocusRect({ type: 'incision', path: [], layers: [] } as never, anatomy)).toBeNull();
    const c = caseFocusRect(sampleCase());
    expect(c).not.toBeNull();
    expect(c!.x1).toBeGreaterThan(c!.x0);
  });
  it('la transición de cámara llega exactamente y sin cola', () => {
    expect(easeCamera(0)).toBe(0);
    expect(easeCamera(1)).toBe(1);
    expect(easeCamera(2)).toBe(1);
    expect(easeCamera(0.5)).toBeCloseTo(0.5);
    expect(cameraTransitionSec('overview', 'wound')).toBeLessThanOrEqual(1.2);
  });
});

describe('orientación del instrumento', () => {
  it('base ortonormal y con la inclinación pedida', () => {
    for (const [tilt, yaw] of [
      [0, 0],
      [45, 0],
      [56, 30],
      [20, -90],
    ]) {
      const [X, Y, Z] = instrumentBasis(tilt, yaw, { x: 1, y: 0, z: -0.25 });
      expect(len(X)).toBeCloseTo(1, 5);
      expect(len(Y)).toBeCloseTo(1, 5);
      expect(len(Z)).toBeCloseTo(1, 5);
      expect(dot(X, Y)).toBeCloseTo(0, 5);
      expect(dot(Y, Z)).toBeCloseTo(0, 5);
      expect(Math.acos(Y.y) * (180 / Math.PI)).toBeCloseTo(tilt, 4);
    }
  });
  it('el mango se inclina hacia la derecha y el filo mira hacia abajo', () => {
    const [X, Y] = instrumentBasis(50, 0, { x: 1, y: 0, z: 0 });
    expect(Y.x).toBeGreaterThan(0.7);
    expect(X.y).toBeLessThan(0);
  });
});

describe('caso y fakes', () => {
  it('usa la trayectoria del paso de incisión', () => {
    const base = sampleCase();
    const c: CaseDef = {
      ...base,
      phases: [
        {
          id: 'f1',
          label: 'Incisión',
          weight: 100,
          steps: [
            {
              id: 's1',
              label: 'Cortar',
              params: { type: 'incision', path: [{ x: 20, y: 40 }, { x: 140, y: 60 }], layers: [{ layer: 'skin', targetPressure: 2 }], instrument: 'scalpel10' },
            },
          ],
        },
      ],
    };
    expect(incisionPathFor(c)).toEqual([{ x: 20, y: 40 }, { x: 140, y: 60 }]);
    expect(incisionPathFor(base).length).toBe(2);
  });
  it('el charco falso llena hasta el nivel pedido', () => {
    const a = sampleAnatomy();
    const pool = createFakeBloodPool({ window: a.window });
    pool.fillTo(50);
    expect(pool.levelPct()).toBeCloseTo(50, 0);
    const got = pool.suction({ x: 80, y: 50 }, 10, 1, 1);
    expect(got).toBeGreaterThan(0);
    expect(pool.levelPct()).toBeLessThan(50);
    pool.clear();
    expect(pool.levelPct()).toBe(0);
  });
  it('el hueso falso mueve fragmentos y mide el error de alineación', () => {
    const bone = createFakeBone(sampleAnatomy());
    expect(bone.alignmentError('distal').mm).toBeGreaterThan(3);
    bone.setPose('distal', { pos: { x: 106.5, y: 49.4 }, angleDeg: 0 });
    expect(bone.alignmentError('distal').mm).toBeCloseTo(0);
    expect(bone.isOnBone({ x: 50, y: 50 })).toBe(true);
    expect(bone.isOnBone({ x: 50, y: 80 })).toBe(false);
    expect(roundedWindow(80, 50, 100, 30).length).toBe(40);
  });
});

describe('monitor', () => {
  it('ECG sinusal con el QRS como pico', () => {
    let maxP = 0;
    let maxV = -1;
    for (let p = 0; p < 1; p += 0.001) {
      const e = ecgSinus(p);
      if (e > maxV) {
        maxV = e;
        maxP = p;
      }
    }
    expect(maxP).toBeCloseTo(0.25, 2);
    expect(maxV).toBeGreaterThan(0.9);
    expect(Math.abs(ecgSample('asystole', 0.25, 3))).toBeLessThan(0.05);
    expect(ecgSample('sinus', 1.25, 0)).toBeCloseTo(ecgSinus(0.25));
    expect(pleth(0.32)).toBeGreaterThan(pleth(0.9));
    expect(vitalsLabel('map').name).toBe('PAM');
  });
});
