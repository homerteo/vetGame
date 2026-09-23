import { describe, expect, it } from 'vitest';
import { BLEED_RATE, createBleeding, pulseWave } from './Bleeding';

function integrate(b: ReturnType<typeof createBleeding>, seconds: number, hr: number, dt = 1 / 60) {
  const totals = new Map<number, number>();
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    for (const e of b.emit(dt, i * dt, hr)) totals.set(e.bleeder.id, (totals.get(e.bleeder.id) ?? 0) + e.amount);
  }
  return totals;
}

describe('Bleeding', () => {
  it('ids incrementales y lista/activos', () => {
    const b = createBleeding();
    const a = b.spawn({ x: 10, y: 10 }, 'venous', 0);
    const c = b.spawn({ x: 20, y: 10 }, 'arterial', 1);
    expect(a.id).toBe(1);
    expect(c.id).toBe(2);
    expect(b.list().length).toBe(2);
    b.seal(1, 5, true);
    expect(b.active().map((x) => x.id)).toEqual([2]);
    const sealed = b.list()[0];
    expect(sealed.active).toBe(false);
    expect(sealed.sealedAt).toBe(5);
    expect(sealed.charred).toBe(true);
    expect(b.spawn({ x: 0, y: 0 }, 'capillary', 2).id).toBe(3);
  });

  it('copia la posición al crear', () => {
    const b = createBleeding();
    const p = { x: 1, y: 2 };
    const bl = b.spawn(p, 'venous', 0);
    p.x = 99;
    expect(bl.pos.x).toBe(1);
  });

  it('tasas medias × rateScale', () => {
    expect(BLEED_RATE).toEqual({ capillary: 0.02, venous: 0.06, arterial: 0.15 });
    const b = createBleeding({ rateScale: 1.25 });
    b.spawn({ x: 0, y: 0 }, 'capillary', 0);
    b.spawn({ x: 0, y: 0 }, 'venous', 0);
    b.spawn({ x: 0, y: 0 }, 'arterial', 0);
    expect(b.totalRatePctPerSec()).toBeCloseTo(0.23 * 1.25, 6);
    b.seal(3, 1);
    expect(b.totalRatePctPerSec()).toBeCloseTo(0.08 * 1.25, 6);
  });

  it('la onda de pulso tiene media 1 y pico sistólico agudo', () => {
    let s = 0;
    const N = 10000;
    let peak = 0;
    for (let i = 0; i < N; i++) {
      const w = pulseWave(i / N);
      s += w;
      peak = Math.max(peak, w);
    }
    expect(s / N).toBeCloseTo(1, 3);
    expect(peak).toBeGreaterThan(4);
    expect(pulseWave(0.6)).toBeLessThan(0.3);
  });

  it('arterial conserva la media (0,15 %BV/s) con cualquier FC y dt', () => {
    for (const [hr, dt] of [
      [120, 1 / 60],
      [90, 1 / 20],
      [200, 0.05],
      [73, 0.013],
    ] as const) {
      const b = createBleeding();
      b.spawn({ x: 0, y: 0 }, 'arterial', 0);
      const tot = integrate(b, 30, hr, dt).get(1) ?? 0;
      expect(tot / 30).toBeCloseTo(0.15, 2);
    }
  });

  it('arterial es pulsátil a la FC; venoso es constante', () => {
    const b = createBleeding();
    b.spawn({ x: 0, y: 0 }, 'arterial', 0);
    b.spawn({ x: 0, y: 0 }, 'venous', 0);
    const dt = 1 / 120;
    const art: number[] = [];
    const ven: number[] = [];
    for (let i = 0; i < 120; i++) {
      const out = b.emit(dt, i * dt, 120); // 2 latidos por segundo
      art.push(out[0].amount);
      ven.push(out[1].amount);
    }
    expect(Math.max(...art) / Math.min(...art)).toBeGreaterThan(10);
    expect(Math.max(...ven)).toBeCloseTo(Math.min(...ven), 10);
    // Dos picos en un segundo.
    let peaks = 0;
    for (let i = 1; i < art.length - 1; i++) if (art[i] > art[i - 1] && art[i] >= art[i + 1] && art[i] > 0.001) peaks++;
    expect(peaks).toBe(2);
  });

  it('en paro (FC 0) el arterial solo rezuma', () => {
    const b = createBleeding();
    b.spawn({ x: 0, y: 0 }, 'arterial', 0);
    const tot = integrate(b, 10, 0).get(1) ?? 0;
    expect(tot).toBeCloseTo(0.15, 3);
  });

  it('emit no devuelve sellados y dt ≤ 0 no emite', () => {
    const b = createBleeding();
    b.spawn({ x: 0, y: 0 }, 'venous', 0);
    b.spawn({ x: 0, y: 0 }, 'venous', 0);
    b.seal(1, 0);
    const out = b.emit(0.1, 0, 100);
    expect(out.length).toBe(1);
    expect(out[0].bleeder.id).toBe(2);
    expect(out[0].amount).toBeCloseTo(0.006, 6);
    expect(b.emit(0, 0, 100).length).toBe(0);
  });

  it('nearest solo entre activos y dentro del radio', () => {
    const b = createBleeding();
    b.spawn({ x: 10, y: 10 }, 'venous', 0);
    b.spawn({ x: 12, y: 10 }, 'capillary', 0);
    b.spawn({ x: 30, y: 30 }, 'arterial', 0);
    expect(b.nearest({ x: 11.8, y: 10 }, 4)?.id).toBe(2);
    b.seal(2, 1);
    expect(b.nearest({ x: 11.8, y: 10 }, 4)?.id).toBe(1);
    expect(b.nearest({ x: 20, y: 20 }, 4)).toBeNull();
  });

  it('sellar dos veces no cambia el primer sellado', () => {
    const b = createBleeding();
    b.spawn({ x: 0, y: 0 }, 'venous', 0);
    b.seal(1, 2);
    b.seal(1, 9, true);
    expect(b.list()[0].sealedAt).toBe(2);
    expect(b.list()[0].charred).toBeUndefined();
  });
});
