import { describe, expect, it } from 'vitest';
import { computeHudLayout, hudScale, type HudBoxes } from './hudLayout';

const boxes = (w: number, h: number, over: Partial<HudBoxes> = {}): HudBoxes => ({
  w,
  h,
  queue: { w: 236, h: 170 },
  map: { w: 260, h: 214 },
  clock: { h: 54 },
  objective: { h: 36 },
  team: { w: 412, h: 96 },
  emi: { w: 220, h: 104 },
  bottomCenterW: 440,
  ...over,
});

/** Caja en pantalla de un panel escalado con origen en su esquina. */
const overlapX = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;

describe('hudScale', () => {
  it('1 a 1280x720, crece en pantallas grandes y se limita', () => {
    expect(hudScale(1280, 720)).toBe(1);
    expect(hudScale(1920, 1080)).toBeCloseTo(1.5);
    expect(hudScale(4000, 3000)).toBe(1.6);
    expect(hudScale(700, 1000)).toBe(0.7);
  });
});

describe('computeHudLayout', () => {
  it('1280x720: objetivo bajo el reloj y pila de abajo en su sitio de siempre', () => {
    const l = computeHudLayout(boxes(1280, 720));
    expect(l.narrowTop).toBe(false);
    expect(l.narrowBottom).toBe(false);
    expect(l.objMaxW).toBe(560);
    expect(l.bottomBase).toBe(60);
  });

  it('700x1000: el objetivo baja por debajo de la cola y el minimapa (no queda tapado)', () => {
    const b = boxes(700, 1000);
    const l = computeHudLayout(b);
    expect(l.narrowTop).toBe(true);
    expect(l.objTop).toBeGreaterThanOrEqual(12 + Math.max(b.queue.h, b.map.h) * l.s);
    // cabe a lo ancho de la pantalla
    expect(l.objMaxW * l.s).toBeLessThanOrEqual(700 - 24);
    expect(l.toastTop).toBeGreaterThan(l.objTop);
  });

  it('700x1000: la leyenda y el aviso E suben por encima de las tarjetas del equipo', () => {
    const b = boxes(700, 1000);
    const l = computeHudLayout(b);
    expect(l.narrowBottom).toBe(true);
    expect(l.bottomBase).toBeGreaterThanOrEqual(12 + b.team.h * l.s);
    expect(l.bottomBase).toBeGreaterThanOrEqual(12 + b.emi.h * l.s);
  });

  it('en modo ancho el objetivo nunca invade la cola ni el minimapa', () => {
    for (const [w, h] of [[1024, 768], [1280, 720], [1366, 768], [1920, 1080], [900, 900]]) {
      const b = boxes(w, h);
      const l = computeHudLayout(b);
      if (l.narrowTop) continue;
      const half = (l.objMaxW * l.s) / 2;
      const qR = 12 + b.queue.w * l.s;
      const mL = w - 12 - b.map.w * l.s;
      expect(overlapX(w / 2 - half, w / 2 + half, 0, qR)).toBe(false);
      expect(overlapX(w / 2 - half, w / 2 + half, mL, w)).toBe(false);
    }
  });
});
