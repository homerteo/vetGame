import { describe, expect, it } from 'vitest';
import { createBeatClock } from './BeatClock';

function fakeNow(start = 10) {
  let t = start;
  return { now: () => t, set: (v: number) => (t = v), add: (d: number) => (t += d) };
}

describe('BeatClock', () => {
  it('fase, índice y tiempo al siguiente pulso a 110 BPM', () => {
    const f = fakeNow(10);
    const c = createBeatClock(f.now, 110);
    const spb = 60 / 110;
    expect(c.bpm).toBe(110);
    expect(c.beatIndex()).toBe(0);
    expect(c.phase()).toBeCloseTo(0, 9);
    f.add(spb * 0.25);
    expect(c.phase()).toBeCloseTo(0.25, 9);
    expect(c.timeToNextBeat()).toBeCloseTo(spb * 0.75, 9);
    f.add(spb * 3.5);
    expect(c.beatIndex()).toBe(3);
    expect(c.phase()).toBeCloseTo(0.75, 9);
    expect(c.timeToNextBeat()).toBeCloseTo(spb * 0.25, 9);
  });

  it('timeOfBeat y beatAt son inversas', () => {
    const f = fakeNow(3);
    const c = createBeatClock(f.now, 96);
    for (const b of [0, 1, 2.5, 17, 100.25]) expect(c.beatAt(c.timeOfBeat(b))).toBeCloseTo(b, 9);
    expect(c.timeOfBeat(4) - c.timeOfBeat(0)).toBeCloseTo(4 * (60 / 96), 9);
  });

  it('el cambio de tempo entra en el siguiente pulso, sin saltos de fase', () => {
    const f = fakeNow(0);
    const c = createBeatClock(f.now, 100);
    f.set(0.6 * 2.3); // pulso 2,3
    const before = c.beatAt(f.now());
    c.setTempo(120);
    // el reloj sigue igual hasta el pulso 3
    expect(c.beatAt(f.now())).toBeCloseTo(before, 9);
    expect(c.bpm).toBe(100);
    const t3 = c.timeOfBeat(3);
    expect(t3).toBeCloseTo(1.8, 9);
    f.set(t3 + 0.25); // medio pulso a 120
    expect(c.bpm).toBe(120);
    expect(c.beatIndex()).toBe(3);
    expect(c.phase()).toBeCloseTo(0.5, 9);
    expect(c.timeOfBeat(5) - c.timeOfBeat(4)).toBeCloseTo(0.5, 9);
  });

  it('un cambio pedido para un pulso ya pasado se aplaza al siguiente', () => {
    const f = fakeNow(0);
    const c = createBeatClock(f.now, 60);
    f.set(5.4);
    c.setTempo(120, 2);
    expect(c.timeOfBeat(6)).toBeCloseTo(6, 9);
    expect(c.timeOfBeat(7)).toBeCloseTo(6.5, 9);
  });

  it('un segundo cambio pendiente sustituye al primero', () => {
    const f = fakeNow(0);
    const c = createBeatClock(f.now, 60);
    c.setTempo(120, 4);
    c.setTempo(90, 4);
    expect(c.timeOfBeat(5) - c.timeOfBeat(4)).toBeCloseTo(60 / 90, 9);
    // volver al tempo vigente cancela el cambio
    c.setTempo(60, 4);
    expect(c.timeOfBeat(5) - c.timeOfBeat(4)).toBeCloseTo(1, 9);
  });

  it('shift desplaza el eje sin cambiar el pulso', () => {
    const f = fakeNow(1);
    const c = createBeatClock(f.now, 110);
    f.add(0.3);
    const b = c.beatAt(f.now());
    c.shift(100);
    f.add(100);
    expect(c.beatAt(f.now())).toBeCloseTo(b, 9);
  });

  it('valores absurdos de BPM se acotan', () => {
    const f = fakeNow(0);
    const c = createBeatClock(f.now, Number.NaN);
    expect(c.bpm).toBe(110);
    c.setTempo(10_000);
    f.set(10);
    expect(c.bpm).toBe(300);
  });
});
