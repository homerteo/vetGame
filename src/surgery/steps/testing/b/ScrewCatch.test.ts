// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CATCH_MIN_LEAD_SEC, catchArrival, classifyCatch, createScrewCatch, type CatchResult } from '../../../minigames/ScrewCatch';
import { createFakeAudio, createFakeBeat } from './fakeContext';

function setup(o: { beatTime?: number; bpm?: number; windowScale?: number; tremor?: number; reoffers?: number } = {}) {
  const layer = document.createElement('div');
  document.body.appendChild(layer);
  const beat = createFakeBeat(o.bpm ?? 120, o.beatTime ?? 0);
  const audio = createFakeAudio(beat);
  const results: CatchResult[] = [];
  let reoffered = 0;
  const sc = createScrewCatch({
    layer,
    beat,
    tremor: () => o.tremor ?? 1,
    windowScale: o.windowScale ?? 1,
    audio,
    reoffers: o.reoffers,
    onReoffer: () => reoffered++,
    onResult: (r) => results.push(r),
  });
  return { layer, beat, audio, results, sc, reoffers: () => reoffered };
}

describe('classifyCatch', () => {
  it('ventanas perfecto ±0,08 s y bien ±0,2 s, escaladas', () => {
    expect(classifyCatch(0, 1)).toBe('perfect');
    expect(classifyCatch(-0.07, 1)).toBe('perfect');
    expect(classifyCatch(0.15, 1)).toBe('good');
    expect(classifyCatch(-0.19, 1)).toBe('good');
    expect(classifyCatch(0.25, 1)).toBe('miss');
    expect(classifyCatch(0.15, 2)).toBe('perfect');
    expect(classifyCatch(0.28, 1.5)).toBe('good');
  });
});

describe('catchArrival', () => {
  it('usa el primer pulso con al menos 1,5 s de margen', () => {
    expect(CATCH_MIN_LEAD_SEC).toBe(1.5);
    expect(catchArrival(0.2, 0.5)).toBeCloseTo(1.7, 9);
    expect(catchArrival(0, 0.5)).toBeCloseTo(1.5, 9);
    expect(catchArrival(0.45, 0.5)).toBeCloseTo(1.95, 9);
    expect(catchArrival(0.3, 0.5, 1)).toBeCloseTo(1.3, 9);
  });
});

describe('createScrewCatch', () => {
  it('crea el widget y llega en el primer pulso con ≥ 1,5 s de margen, con cuenta atrás', () => {
    // bpm 120 → periodo 0,5; en t=0,3 faltan 0,2 s → llega en 1,7 s.
    const { layer, results, sc, audio } = setup({ beatTime: 0.3 });
    expect(layer.querySelector('.sc-root')).not.toBeNull();
    expect(layer.textContent).toContain('Fritz te pasa un tornillo');
    expect(layer.querySelector('.sc-count')!.textContent).toBe('4');
    sc.update(0.5);
    expect(layer.querySelector('.sc-count')!.textContent).toBe('3');
    sc.update(1.19);
    expect(results).toEqual([]);
    sc.press();
    expect(results).toEqual(['perfect']);
    expect(audio.count('perfect')).toBe(1);
    expect(layer.querySelector('.sc-pop')!.textContent).toBe('¡Perfecto!');
    expect(layer.querySelector('.sc-root')!.classList.contains('sc-perfect')).toBe(true);
    expect(layer.querySelector('.sc-count')!.textContent).toBe('');
    sc.press();
    expect(results).toHaveLength(1);
  });

  it('el anillo solo se cierra en los dos últimos pulsos', () => {
    const { layer, sc } = setup({ beatTime: 0 }); // llega en 1,5 s; se cierra desde 0,5 s
    const scale = () => Number(/scale\(([\d.]+)\)/.exec((layer.querySelector('.sc-ring') as HTMLElement).style.transform)![1]);
    sc.update(0.3);
    expect(scale()).toBeGreaterThanOrEqual(3.2);
    sc.update(0.45); // t=0,75: a mitad del cierre (queda 0,75 de 1,0)
    expect(scale()).toBeCloseTo(1 + 2.2 * 0.75, 1);
    sc.update(0.74);
    expect(scale()).toBeLessThan(1.05);
  });

  it('pulsar un poco antes de la llegada es "bien"', () => {
    const { results, sc } = setup({ beatTime: 0.1 }); // faltan 0,4 → llega en 1,9 s
    sc.update(1.8);
    sc.press();
    expect(results).toEqual(['good']);
  });

  it('pulsar muy pronto no tira el tornillo: avisa y sigue esperando', () => {
    const { results, sc, layer, audio } = setup({ beatTime: 0 }); // llega en 1,5
    sc.update(1.1);
    sc.press();
    expect(results).toEqual([]);
    expect(layer.querySelector('.sc-pop')!.textContent).toBe('¡Espera al anillo!');
    expect(audio.count('miss')).toBe(0);
    sc.update(0.4);
    sc.press();
    expect(results).toEqual(['perfect']);
  });

  it('sin pulsar: Fritz insiste una vez (siguiente pulso con ≥ 1 s) y a la segunda se cae', () => {
    const { results, sc, layer, reoffers } = setup({ beatTime: 0 }); // llega en 1,5
    sc.update(1.5);
    sc.update(0.2);
    expect(results).toEqual([]);
    sc.update(0.06); // 1,76 > 1,5 + 0,25 → nueva oferta, llega en 3,0
    expect(results).toEqual([]);
    expect(reoffers()).toBe(1);
    expect(layer.querySelector('.sc-root')!.classList.contains('sc-again')).toBe(true);
    expect(layer.querySelector('.sc-title')!.textContent).toContain('Fritz insiste');
    sc.update(1.2); // t=2,96
    sc.press();
    expect(results).toEqual(['perfect']);
  });

  it('sin pulsar dos veces → fallo automático', () => {
    const { results, sc } = setup({ beatTime: 0 });
    sc.update(1.76);
    expect(results).toEqual([]);
    sc.update(1.2); // t=2,96
    expect(results).toEqual([]);
    sc.update(0.3); // t=3,26 > 3,0 + 0,25
    expect(results).toEqual(['miss']);
  });

  it('reoffers: 0 → fallo automático a los 0,25 s de la llegada', () => {
    const { results, sc } = setup({ beatTime: 0, reoffers: 0 });
    sc.update(1.5);
    sc.update(0.2);
    expect(results).toEqual([]);
    sc.update(0.06);
    expect(results).toEqual(['miss']);
  });

  it('ventana ×2 convierte un desfase de 0,2 s en "bien"', () => {
    const { results, sc } = setup({ beatTime: 0, windowScale: 2 });
    sc.update(1.7);
    sc.press();
    expect(results).toEqual(['good']);
  });

  it('el temblor de Fritz hace bambolear el tornillo', () => {
    const calm = setup({ tremor: 0 });
    const panic = setup({ tremor: 2 });
    const angle = (el: Element) => Math.abs(Number(/rotate\((-?[\d.]+)deg\)/.exec((el as HTMLElement).style.transform)![1]));
    let maxCalm = 0;
    let maxPanic = 0;
    for (let i = 0; i < 20; i++) {
      calm.sc.update(0.01);
      panic.sc.update(0.01);
      maxCalm = Math.max(maxCalm, angle(calm.layer.querySelector('.sc-screw')!));
      maxPanic = Math.max(maxPanic, angle(panic.layer.querySelector('.sc-screw')!));
    }
    expect(maxPanic).toBeGreaterThan(maxCalm * 2);
  });

  it('dispose elimina el DOM', () => {
    const { layer, sc } = setup();
    sc.dispose();
    expect(layer.children).toHaveLength(0);
    sc.update(1);
    sc.press();
  });
});
