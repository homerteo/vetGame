import { describe, expect, it } from 'vitest';
import { createBloodPool, POOL_DRAIN_IN_PER_SEC, POOL_OUTSIDE_MAX } from './BloodPool';
import { makeAnatomy } from './testing/fixtures';

describe('BloodPool', () => {
  it('rejilla por defecto 64×40 y capacidad 5 %BV', () => {
    const p = createBloodPool();
    expect(p.cols).toBe(64);
    expect(p.rows).toBe(40);
    expect(p.grid.length).toBe(64 * 40);
    expect(p.capacityPctBV).toBe(5);
    expect(p.levelPct()).toBe(0);
  });

  it('add deposita exactamente la cantidad como mancha gaussiana', () => {
    const p = createBloodPool();
    p.add({ x: 80, y: 50 }, 0.5);
    expect(p.totalPctBV()).toBeCloseTo(0.5, 5);
    expect(p.levelPct()).toBeCloseTo(10, 3);
    // Celda del centro con más fluido que una vecina a 2 celdas.
    const c = 32 + 20 * 64; // (80,50) mm → celda 32,20 aprox
    const center = Math.max(p.grid[c], p.grid[c - 1], p.grid[c - 65]);
    expect(center).toBeGreaterThan(p.grid[c + 2]);
    expect(p.grid[c + 5]).toBe(0);
  });

  it('add en el borde y fuera de la rejilla conserva la cantidad', () => {
    const p = createBloodPool();
    p.add({ x: 0, y: 0 }, 0.2);
    p.add({ x: 500, y: -50 }, 0.1);
    expect(p.totalPctBV()).toBeCloseTo(0.3, 5);
  });

  it('la difusión conserva el volumen (salvo el drenaje pasivo) y no da negativos', () => {
    const p = createBloodPool();
    p.add({ x: 80, y: 50 }, 2);
    const dt = 1 / 60;
    let expected = 2;
    for (let i = 0; i < 600; i++) {
      p.step(dt);
      expected *= 1 - POOL_DRAIN_IN_PER_SEC * dt;
    }
    expect(p.totalPctBV()).toBeCloseTo(expected, 3);
    let min = Infinity;
    for (const v of p.grid) min = Math.min(min, v);
    expect(min).toBeGreaterThanOrEqual(0);
  });

  it('se extiende: la mancha se aplana y crece', () => {
    const p = createBloodPool();
    p.add({ x: 80, y: 50 }, 1);
    const peak0 = Math.max(...p.grid);
    const wet0 = p.grid.filter((v) => v > 0.001).length;
    for (let i = 0; i < 300; i++) p.step(1 / 60);
    const peak1 = Math.max(...p.grid);
    const wet1 = p.grid.filter((v) => v > 0.001).length;
    expect(peak1).toBeLessThan(peak0);
    expect(wet1).toBeGreaterThan(wet0 * 2);
  });

  it('estable con dt grande (0,05 s) y fluido abundante', () => {
    const p = createBloodPool();
    for (let i = 0; i < 20; i++) p.add({ x: 40 + i * 4, y: 50 }, 0.3);
    for (let i = 0; i < 200; i++) p.step(0.05);
    for (const v of p.grid) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
    expect(p.totalPctBV()).toBeLessThanOrEqual(6);
  });

  it('con ventana: la sangre se acumula dentro y fuera no pasa de 0,35', () => {
    const anatomy = makeAnatomy();
    const p = createBloodPool({ window: anatomy.window });
    for (let k = 0; k < 40; k++) {
      p.add({ x: 80, y: 20 }, 0.05); // cae fuera de la ventana (y < 35)
      p.add({ x: 80, y: 50 }, 0.05);
      p.step(1 / 30);
    }
    for (let i = 0; i < 300; i++) p.step(1 / 30);
    let inside = 0;
    let outside = 0;
    let maxOut = 0;
    for (let r = 0; r < p.rows; r++) {
      for (let c = 0; c < p.cols; c++) {
        const v = p.grid[r * p.cols + c];
        const y = (r + 0.5) * 2.5;
        const x = (c + 0.5) * 2.5;
        const isIn = x > 20 && x < 140 && y > 35 && y < 65;
        if (isIn) inside += v;
        else {
          outside += v;
          maxOut = Math.max(maxOut, v);
        }
      }
    }
    expect(inside).toBeGreaterThan(outside * 3);
    expect(maxOut).toBeLessThanOrEqual(POOL_OUTSIDE_MAX + 1e-6);
  });

  it('fuera de la ventana drena ×3 más rápido', () => {
    const anatomy = makeAnatomy();
    // Ventana pequeña lejos del depósito para medir drenaje exterior casi puro.
    const pIn = createBloodPool();
    const pOut = createBloodPool({ window: [{ x: 150, y: 90 }, { x: 159, y: 90 }, { x: 159, y: 99 }, { x: 150, y: 99 }] });
    pIn.add({ x: 30, y: 20 }, 0.002);
    pOut.add({ x: 30, y: 20 }, 0.002);
    for (let i = 0; i < 600; i++) {
      pIn.step(1 / 60);
      pOut.step(1 / 60);
    }
    const lossIn = 1 - pIn.totalPctBV() / 0.002;
    const lossOut = 1 - pOut.totalPctBV() / 0.002;
    expect(lossOut / lossIn).toBeGreaterThan(2.7);
    expect(lossOut / lossIn).toBeLessThan(3.2);
    expect(anatomy.window.length).toBe(4);
  });

  it('aspiración: retira hasta max·dt, con caída radial, y devuelve lo retirado', () => {
    const p = createBloodPool();
    p.add({ x: 80, y: 50 }, 1);
    const before = p.totalPctBV();
    const got = p.suction({ x: 80, y: 50 }, 10, 0.12, 0.5);
    expect(got).toBeCloseTo(0.06, 6);
    expect(p.totalPctBV()).toBeCloseTo(before - 0.06, 6);
    // Con poco fluido retira lo alcanzable (sin negativos).
    const q = createBloodPool();
    q.add({ x: 80, y: 50 }, 0.001);
    const got2 = q.suction({ x: 80, y: 50 }, 10, 5, 1);
    expect(got2).toBeGreaterThan(0.0008);
    expect(got2).toBeLessThanOrEqual(0.001 + 1e-9);
    for (const v of q.grid) expect(v).toBeGreaterThanOrEqual(0);
  });

  it('aspiración lejos del charco no retira nada; parámetros inválidos → 0', () => {
    const p = createBloodPool();
    p.add({ x: 20, y: 20 }, 0.5);
    expect(p.suction({ x: 140, y: 80 }, 5, 1, 1)).toBe(0);
    expect(p.suction({ x: 20, y: 20 }, 0, 1, 1)).toBe(0);
    expect(p.suction({ x: 20, y: 20 }, 5, 1, 0)).toBe(0);
    expect(p.totalPctBV()).toBeCloseTo(0.5, 6);
  });

  it('aspiración de Rodrigo (0,12 %BV/s) gana a un sangrado venoso', () => {
    const p = createBloodPool();
    const dt = 1 / 30;
    for (let i = 0; i < 30 * 60; i++) {
      p.add({ x: 80, y: 50 }, 0.06 * dt);
      p.step(dt);
      p.suction({ x: 82, y: 50 }, 10, 0.12, dt);
    }
    expect(p.levelPct()).toBeLessThan(15);
  });

  it('levelPct se limita a 100 y clear vacía', () => {
    const p = createBloodPool({ cols: 8, rows: 5, capacityPctBV: 1 });
    p.add({ x: 80, y: 50 }, 3);
    expect(p.levelPct()).toBe(100);
    p.clear();
    expect(p.levelPct()).toBe(0);
    expect(p.totalPctBV()).toBe(0);
    expect([...p.grid].every((v) => v === 0)).toBe(true);
  });

  it('grid es el mismo Float32Array tras step (doble búfer sin reasignar)', () => {
    const p = createBloodPool();
    const ref = p.grid;
    p.add({ x: 80, y: 50 }, 0.5);
    p.step(1 / 60);
    expect(p.grid).toBe(ref);
    expect(ref.some((v) => v > 0)).toBe(true);
  });
});
