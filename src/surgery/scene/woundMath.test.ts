import { describe, expect, it } from 'vitest';
import {
  arterialPulse,
  bloodLook,
  boneSignature,
  buildCutStrokes,
  fitDistance,
  gridSamplesInPolygon,
  insertByZ,
  clampRect,
  implantsSignature,
  decalLevel,
  unionRect,
  maskOpenFraction,
  mmToPx,
  mmToUv,
  muscleParting,
  openingWidthMm,
  pxToMm,
  rasterizePool,
  poolAlpha,
  poolLevelCap,
  sampleAlpha,
  scalePolygon,
  strokeWidthAt,
  subdivideSegment,
  taperAlong,
  uvToMm,
  widenFactorAt,
} from './woundMath';
import { PX_PER_MM, WOUND_H_MM, WOUND_W_MM } from '../../core/constants';
import { pointInPolygon, rectPoly } from '../../core/math';

describe('mapeos', () => {
  it('mm ↔ px es reversible', () => {
    const p = { x: 37.5, y: 81.25 };
    const px = mmToPx(p, PX_PER_MM);
    expect(px.x).toBeCloseTo(240);
    expect(pxToMm(px, PX_PER_MM)).toEqual(p);
  });
  it('uv ↔ mm respeta que v crece hacia arriba', () => {
    expect(uvToMm(0, 1, WOUND_W_MM, WOUND_H_MM)).toEqual({ x: 0, y: 0 });
    expect(uvToMm(1, 0, WOUND_W_MM, WOUND_H_MM)).toEqual({ x: 160, y: 100 });
    const uv = mmToUv({ x: 40, y: 25 }, WOUND_W_MM, WOUND_H_MM);
    expect(uv.u).toBeCloseTo(0.25);
    expect(uv.v).toBeCloseTo(0.75);
    const back = uvToMm(uv.u, uv.v, WOUND_W_MM, WOUND_H_MM);
    expect(back.x).toBeCloseTo(40);
    expect(back.y).toBeCloseTo(25);
  });
});

describe('apertura por retracción', () => {
  const incision = [
    { x: 30, y: 50 },
    { x: 130, y: 50 },
  ];
  it('el taper es máximo en el centro y pequeño en los extremos', () => {
    expect(taperAlong(0.5)).toBeCloseTo(1);
    expect(taperAlong(0)).toBeLessThan(0.2);
    expect(taperAlong(1)).toBeLessThan(0.2);
    expect(taperAlong(0.25)).toBeGreaterThan(taperAlong(0.1));
  });
  it('el ancho crece con la retracción y vuelve a 0 con el cierre', () => {
    const w0 = openingWidthMm(1.5, 0, 0, 1, 1, 1);
    const w5 = openingWidthMm(1.5, 0.5, 0, 1, 1, 1);
    const w1 = openingWidthMm(1.5, 1, 0, 1, 1, 1);
    expect(w0).toBeCloseTo(1.5);
    expect(w5).toBeGreaterThan(w0);
    expect(w1).toBeGreaterThan(w5);
    expect(w1).toBeGreaterThan(30); // deja ver una ventana de ~30 mm
    expect(openingWidthMm(1.5, 1, 1, 1, 1, 1)).toBe(0);
    expect(openingWidthMm(1.5, 1, 0.5, 1, 1, 1)).toBeCloseTo(w1 / 2);
  });
  it('capas escalonadas: la piel se abre más que la fascia', () => {
    const [s] = buildCutStrokes({ x: 79, y: 50 }, { x: 81, y: 50 }, 1.2, incision);
    // Recién cortada (sin separar) la piel ya se abre algo más que el trazo.
    expect(strokeWidthAt(s, 'a', 'skin', 0, 0) / s.ja).toBeGreaterThan(1.2);
    const skin = strokeWidthAt(s, 'a', 'skin', 1, 0) / s.ja;
    const fascia = strokeWidthAt(s, 'a', 'fascia', 1, 0) / s.ja;
    const muscle = strokeWidthAt(s, 'a', 'muscle', 1, 0) / s.ja;
    expect(skin).toBeGreaterThan(fascia);
    expect(fascia).toBeGreaterThan(muscle);
  });
  it('cortes lejanos a la incisión apenas se ensanchan', () => {
    expect(widenFactorAt({ x: 80, y: 50 }, incision)).toBeCloseTo(1, 1);
    expect(widenFactorAt({ x: 80, y: 80 }, incision)).toBe(0);
  });
  it('subdivide segmentos largos en trozos cortos', () => {
    const pts = subdivideSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, 2);
    expect(pts.length).toBe(6);
    expect(pts[5]).toEqual({ x: 10, y: 0 });
    const strokes = buildCutStrokes({ x: 30, y: 50 }, { x: 130, y: 50 }, 1, incision, 2);
    expect(strokes.length).toBe(50);
    expect(strokes[0].a).toEqual({ x: 30, y: 50 });
    expect(strokes[49].b.x).toBeCloseTo(130);
    for (const s of strokes) {
      expect(s.ja).toBeGreaterThanOrEqual(0.9);
      expect(s.ja).toBeLessThanOrEqual(1.1);
    }
  });
  it('el músculo solo se separa a partir de 0.6', () => {
    expect(muscleParting(0.5, 0)).toBe(0);
    expect(muscleParting(0.6, 0)).toBe(0);
    expect(muscleParting(0.8, 0)).toBeGreaterThan(0.3);
    expect(muscleParting(1, 0)).toBe(1);
    expect(muscleParting(1, 1)).toBe(0);
  });
  it('escala polígonos respecto a un centro', () => {
    const p = scalePolygon([{ x: 10, y: 10 }, { x: 20, y: 30 }], { x: 10, y: 10 }, 2, 0.5);
    expect(p[1]).toEqual({ x: 30, y: 20 });
  });
});

describe('muestreo', () => {
  it('la rejilla del polígono no pasa de maxPoints y cae dentro', () => {
    const poly = rectPoly(80, 50, 100, 30, 12);
    const pts = gridSamplesInPolygon(poly, 400);
    expect(pts.length).toBeGreaterThan(100);
    expect(pts.length).toBeLessThanOrEqual(400);
    for (const p of pts) expect(pointInPolygon(p, poly)).toBe(true);
    expect(gridSamplesInPolygon([], 400)).toEqual([]);
  });
  it('lee el alfa del píxel y devuelve 0 fuera', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    data[(1 * 4 + 2) * 4 + 3] = 255;
    expect(sampleAlpha(data, 4, 4, 2.5, 1.2)).toBe(1);
    expect(sampleAlpha(data, 4, 4, 0, 0)).toBe(0);
    expect(sampleAlpha(data, 4, 4, -1, 0)).toBe(0);
    expect(sampleAlpha(data, 4, 4, 9, 9)).toBe(0);
  });
  it('fracción abierta con y sin radio', () => {
    // Máscara 20×10 px a 1 px/mm con la mitad izquierda abierta.
    const w = 20;
    const h = 10;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < 10; x++) data[(y * w + x) * 4 + 3] = 255;
    const samples = [
      { x: 2, y: 5 },
      { x: 8, y: 5 },
      { x: 12, y: 5 },
      { x: 18, y: 5 },
    ];
    expect(maskOpenFraction(data, w, h, 1, samples)).toBe(0.5);
    // Con radio 3 mm, el punto en x=12 ve apertura en x=9.
    expect(maskOpenFraction(data, w, h, 1, samples, 3)).toBe(0.75);
    expect(maskOpenFraction(data, w, h, 1, [])).toBe(0);
  });
});

describe('sangre', () => {
  it('el pulso arterial va de 0 a 1 y es periódico', () => {
    let min = 1;
    let max = 0;
    for (let t = 0; t < 2; t += 0.01) {
      const v = arterialPulse(t);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(max).toBeGreaterThan(0.95);
    expect(min).toBeLessThan(0.1);
    expect(arterialPulse(0.3)).toBeCloseTo(arterialPulse(0.3 + 1 / 1.7), 5);
  });
  it('Modo Pastel es rosa fresa y el gore bajo reduce la cantidad', () => {
    const p = bloodLook(100, true);
    expect([p.r, p.g, p.b]).toEqual([255, 92, 154]);
    const lo = bloodLook(0, false);
    const hi = bloodLook(100, false);
    expect(lo.amount).toBeLessThan(hi.amount);
    expect(lo.alpha).toBeLessThan(hi.alpha);
    // Más saturado con más gore.
    expect(hi.r - hi.g).toBeGreaterThan(lo.r - lo.g);
  });
  it('rasteriza el charco: seco = transparente, con fluido = opaco en el centro', () => {
    const cols = 8;
    const rows = 5;
    const grid = new Float32Array(cols * rows);
    const out = new Uint8ClampedArray(32 * 20 * 4);
    expect(rasterizePool(grid, cols, rows, out, 32, 20, bloodLook(100, false))).toBe(0);
    expect(out[3]).toBe(0);
    grid[2 * cols + 4] = 0.8;
    grid[2 * cols + 3] = 0.6;
    const max = rasterizePool(grid, cols, rows, out, 32, 20, bloodLook(100, false));
    expect(max).toBeCloseTo(0.8);
    const center = (10 * 32 + 16) * 4;
    expect(out[center + 3]).toBeGreaterThan(200);
    expect(out[3]).toBe(0); // esquina seca
    // Con máscara cerrada (alfa 0) no se ve nada; abierta, igual que sin máscara.
    const closedMask = new Uint8ClampedArray(16 * 10 * 4);
    rasterizePool(grid, cols, rows, out, 32, 20, bloodLook(100, false), undefined, closedMask, 16, 10);
    expect(out[center + 3]).toBe(0);
    const openMask = new Uint8ClampedArray(16 * 10 * 4).fill(255);
    rasterizePool(grid, cols, rows, out, 32, 20, bloodLook(100, false), undefined, openMask, 16, 10);
    expect(out[center + 3]).toBeGreaterThan(200);
  });
});

describe('legibilidad del charco', () => {
  it('una película fina deja ver el hueso; solo lo hondo es opaco', () => {
    expect(poolAlpha(0.01)).toBe(0);
    expect(poolAlpha(0.06)).toBeLessThan(0.3);
    expect(poolAlpha(0.3)).toBeLessThan(0.6);
    expect(poolAlpha(0.8)).toBeGreaterThan(0.95);
  });
  it('por debajo de la inundación el campo nunca se pinta opaco', () => {
    expect(poolLevelCap(6)).toBeLessThan(0.45);
    expect(poolLevelCap(30)).toBeLessThan(0.7);
    expect(poolLevelCap(70)).toBeGreaterThan(0.9);
    // Campo al 8 % con charco de altura 0,3: el hueso de debajo se ve (opacidad < 30 %).
    const cols = 4;
    const rows = 4;
    const grid = new Float32Array(cols * rows).fill(0.3);
    const out = new Uint8ClampedArray(8 * 8 * 4);
    rasterizePool(grid, cols, rows, out, 8, 8, bloodLook(100, false), undefined, undefined, 0, 0, poolLevelCap(8));
    expect(out[(4 * 8 + 4) * 4 + 3]).toBeLessThan(0.3 * 255);
  });
});

describe('varios', () => {
  it('la firma del hueso cambia al mover un fragmento', () => {
    const f = [{ pose: { pos: { x: 10, y: 20 }, angleDeg: 5 }, removed: false, highlighted: false, locked: false }];
    const a = boneSignature(f);
    f[0].pose.pos.x = 10.5;
    expect(boneSignature(f)).not.toBe(a);
    f[0].pose.pos.x = 10;
    expect(boneSignature(f)).toBe(a);
    f[0].highlighted = true;
    expect(boneSignature(f)).not.toBe(a);
  });
  it('la firma de implantes cambia al añadir o mover piezas', () => {
    const imp = { plate: null as null | { pose: { pos: { x: number; y: number }; angleDeg: number }; bend: number; holesLocal: { x: number; y: number }[]; lengthMm: number }, screws: [] as { pos: { x: number; y: number }; contaminated: boolean; stripped: boolean }[], pins: [], wires: [], bars: [] };
    const a = implantsSignature(imp);
    imp.screws.push({ pos: { x: 10, y: 20 }, contaminated: false, stripped: false });
    const b = implantsSignature(imp);
    expect(b).not.toBe(a);
    imp.screws[0].stripped = true;
    expect(implantsSignature(imp)).not.toBe(b);
    imp.plate = { pose: { pos: { x: 80, y: 50 }, angleDeg: 0 }, bend: 0.5, holesLocal: [{ x: 0, y: 0 }], lengthMm: 40 };
    const c = implantsSignature(imp);
    imp.plate.bend = 1;
    expect(implantsSignature(imp)).not.toBe(c);
  });
  it('los overlays quedan ordenados por z y se reemplazan por id', () => {
    const list: Array<{ id: string; z: number }> = [];
    insertByZ(list, { id: 'a', z: 40 });
    insertByZ(list, { id: 'b', z: 20 });
    insertByZ(list, { id: 'c', z: 40 });
    insertByZ(list, { id: 'd', z: 55 });
    expect(list.map((o) => o.id)).toEqual(['b', 'a', 'c', 'd']);
    insertByZ(list, { id: 'b', z: 60 });
    expect(list.map((o) => o.id)).toEqual(['a', 'c', 'd', 'b']);
  });
  it('clasifica calcomanías por nivel', () => {
    expect(decalLevel('hole')).toBe('bone');
    expect(decalLevel('necrosis')).toBe('bone');
    expect(decalLevel('char')).toBe('wound');
    expect(decalLevel('stitch')).toBe('skin');
    expect(decalLevel('bar')).toBe('skin');
    // En reducción cerrada todo va sobre la piel.
    expect(decalLevel('hole', true)).toBe('skin');
  });
  it('une y ajusta rectángulos sucios', () => {
    let r = unionRect(null, 10, 20, 30, 40);
    r = unionRect(r, 5, 25, 12, 60);
    expect(r).toEqual({ x0: 5, y0: 20, x1: 30, y1: 60 });
    expect(clampRect({ x0: -3, y0: 5, x1: 1030, y1: 17 }, 1024, 640, 4)).toEqual({ x0: 0, y0: 4, x1: 1024, y1: 20 });
  });
  it('encuadre de cámara: la herida ocupa la fracción pedida', () => {
    const d = fitDistance(0.24, 0.15, 40, 16 / 9, 0.6);
    const visibleH = 2 * d * Math.tan((40 * Math.PI) / 360);
    const visibleW = visibleH * (16 / 9);
    const frac = Math.max(0.24 / visibleW, 0.15 / visibleH);
    expect(frac).toBeCloseTo(0.6, 5);
  });
});
