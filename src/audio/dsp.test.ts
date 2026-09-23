import { describe, expect, it } from 'vitest';
import { brownNoise, fuzzCurve, midiToHz, pinkNoise, smallRoomImpulse, softClipCurve, whiteNoise } from './dsp';

describe('dsp', () => {
  it('afinación MIDI', () => {
    expect(midiToHz(69)).toBeCloseTo(440, 9);
    expect(midiToHz(81)).toBeCloseTo(880, 9);
    expect(midiToHz(60)).toBeCloseTo(261.6256, 3);
  });

  it('ruidos acotados, deterministas y con energía', () => {
    for (const gen of [whiteNoise, pinkNoise, brownNoise]) {
      const a = gen(4000);
      const b = gen(4000);
      expect(a).toEqual(b);
      let peak = 0;
      let sum = 0;
      for (const v of a) {
        peak = Math.max(peak, Math.abs(v));
        sum += v * v;
      }
      expect(peak).toBeLessThanOrEqual(1);
      expect(Math.sqrt(sum / a.length)).toBeGreaterThan(0.05);
    }
  });

  it('el ruido marrón es más grave que el blanco (menos cruces por cero)', () => {
    const zc = (x: Float32Array) => {
      let n = 0;
      for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 !== x[i] < 0) n++;
      return n;
    };
    expect(zc(brownNoise(8000))).toBeLessThan(zc(whiteNoise(8000)) / 5);
  });

  it('curvas de saturación monótonas y en [-1, 1]', () => {
    for (const c of [softClipCurve(2), fuzzCurve(8)]) {
      for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]);
      expect(Math.max(...c)).toBeLessThanOrEqual(1);
      expect(Math.min(...c)).toBeGreaterThanOrEqual(-1);
    }
  });

  it('respuesta al impulso de sala: finita, estéreo y que decae', () => {
    const [l, r] = smallRoomImpulse(8000, 0.8);
    expect(l.length).toBe(6400);
    expect(l).not.toEqual(r);
    const energy = (x: Float32Array, a: number, b: number) => {
      let s = 0;
      for (let i = a; i < b; i++) s += x[i] * x[i];
      return s;
    };
    expect(energy(l, 0, 1600)).toBeGreaterThan(energy(l, 4800, 6400) * 20);
    expect(l.every((v) => Number.isFinite(v))).toBe(true);
  });
});
