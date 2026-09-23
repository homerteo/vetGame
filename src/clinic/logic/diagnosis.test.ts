import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/rng';
import { shuffledOrder } from './diagnosis';

describe('shuffledOrder', () => {
  it('devuelve una permutación de 0..n-1', () => {
    for (let s = 0; s < 50; s++) {
      const o = shuffledOrder(3, createRng(s));
      expect([...o].sort()).toEqual([0, 1, 2]);
    }
  });

  it('el diagnóstico correcto (índice 0) cae en todas las posiciones con semillas distintas', () => {
    const pos = new Set<number>();
    for (let s = 1; s < 60; s++) pos.add(shuffledOrder(3, createRng(s)).indexOf(0));
    expect([...pos].sort()).toEqual([0, 1, 2]);
  });

  it('es determinista para la misma semilla', () => {
    expect(shuffledOrder(3, createRng(42))).toEqual(shuffledOrder(3, createRng(42)));
  });

  it('tolera rng() === 1 sin salirse de rango', () => {
    expect([...shuffledOrder(3, () => 0.9999999999)].sort()).toEqual([0, 1, 2]);
  });
});
