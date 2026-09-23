// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { EcgCanvas } from './EcgCanvas';

/** Contexto 2D falso que registra las coordenadas dibujadas. */
function fakeCtx() {
  const xs: number[] = [];
  const ys: number[] = [];
  const ctx = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: (x: number, y: number) => {
      xs.push(x);
      ys.push(y);
    },
    stroke: vi.fn(),
    lineJoin: '',
    lineCap: '',
    strokeStyle: '',
    lineWidth: 1,
  };
  return { ctx, xs, ys };
}

describe('EcgCanvas', () => {
  it('barre todo el ancho y vuelve a empezar sin NaN', () => {
    const f = fakeCtx();
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(f.ctx as unknown as CanvasRenderingContext2D);
    const ecg = new EcgCanvas(document.body, 200, 60, 80);
    for (let i = 0; i < 60 * 4; i++) ecg.step(1 / 60, 120, 'sinus'); // 4 s → 320 px → da la vuelta
    spy.mockRestore();
    expect(f.xs.length).toBeGreaterThan(100);
    expect(f.xs.every(Number.isFinite)).toBe(true);
    expect(f.ys.every(Number.isFinite)).toBe(true);
    expect(Math.max(...f.xs)).toBeGreaterThanOrEqual(199);
    // Tras dar la vuelta vuelve a dibujar cerca del inicio.
    expect(f.xs.slice(-5).every((x) => x < 200)).toBe(true);
    // 4 s en vivo + ~2,5 s de relleno inicial a 120 lpm
    expect(ecg.beats).toBeGreaterThanOrEqual(12);
    expect(ecg.beats).toBeLessThanOrEqual(13);
  });

  it('funciona sin contexto (entorno de pruebas)', () => {
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const ecg = new EcgCanvas(document.body, 100, 40);
    for (let i = 0; i < 125; i++) ecg.step(1 / 60, 60, "sinus");
    spy.mockRestore();
    expect(ecg.beats).toBeGreaterThanOrEqual(3);
  });
});
