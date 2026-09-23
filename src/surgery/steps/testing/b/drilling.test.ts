import { describe, expect, it } from 'vitest';
import { BoneHeat, clampHint, createDrillHole, distToPolygonEdge, fmt, nearPolygon, polygonsOverlap, type DrillHole } from '../../drilling';
import { createFakeContext } from './fakeContext';
import { drillPinsScenario } from './scenarios';
import { rectPoly } from '../../../../core/math';

const DT = 1 / 60;

function setup(o: { tutorial?: boolean; profile?: [number, number, number]; fragile?: boolean } = {}) {
  const h = createFakeContext({ anatomy: drillPinsScenario().anatomy, tutorial: o.tutorial });
  const pos = { x: 44, y: 50 };
  const hole = createDrillHole({
    ctx: h.ctx,
    pos,
    tolMm: 1.5,
    profileMm: o.profile ?? [1, 4.5, 1],
    fragile: o.fragile,
    tutorial: o.tutorial,
  });
  const tick = (sec: number) => {
    const n = Math.round(sec / DT);
    for (let i = 0; i < n; i++) {
      h.t += DT;
      hole.update(DT);
    }
  };
  const until = (pred: (hh: DrillHole) => boolean, maxSec = 20) => {
    let s = 0;
    while (!pred(hole) && s < maxSec) {
      h.t += DT;
      hole.update(DT);
      s += DT;
    }
    return s;
  };
  return { h, hole, pos, tick, until };
}

describe('createDrillHole', () => {
  it('avanza por capas, anuncia la salida y termina limpio si se suelta a tiempo', () => {
    const { h, hole, pos, tick, until } = setup();
    expect(hole.press(h.ptr(pos.x, pos.y, { pressure: 3 }))).toBe(true);
    expect(hole.phase()).toBe('drilling');
    const tCis = until((x) => x.layer() !== 'cis');
    const tMed = until((x) => x.layer() !== 'medulla');
    // La cortical (1 mm) cuesta más por mm que la médula (4,5 mm).
    expect(tCis / 1).toBeGreaterThan(tMed / 4.5);
    until((x) => x.phase() === 'breakthrough');
    expect(hole.depth()).toBeCloseTo(hole.totalMm, 5);
    expect(h.hud.pops.some((p) => p.text === '¡Salida!')).toBe(true);
    const loop = h.audio.loops.find((l) => l.name === 'drill')!;
    expect(loop.params.rate).toBeCloseTo(0.25);
    tick(0.15);
    hole.release();
    const r = hole.result()!;
    expect(hole.phase()).toBe('done');
    expect(r.plunged).toBe(false);
    expect(r.quality).toBeGreaterThan(0.8);
    expect(h.log.faults()).not.toContain('plunge');
    expect(loop.stopped).toBe(true);
  });

  it('registra plunge si no se suelta en 0,4 s tras la salida', () => {
    const { h, hole, pos, until } = setup();
    hole.press(h.ptr(pos.x, pos.y));
    until((x) => x.phase() === 'breakthrough');
    until((x) => x.phase() === 'done', 1);
    const r = hole.result()!;
    expect(r.plunged).toBe(true);
    expect(h.log.faultCount('plunge')).toBe(1);
    expect(r.quality).toBeLessThan(0.6);
  });

  it('en el tutorial la ventana de salida es de 0,6 s', () => {
    const { h, hole, pos, tick, until } = setup({ tutorial: true });
    hole.press(h.ptr(pos.x, pos.y));
    until((x) => x.phase() === 'breakthrough');
    tick(0.5);
    expect(hole.phase()).toBe('breakthrough');
    hole.release();
    expect(hole.result()!.plunged).toBe(false);
  });

  it('se puede pausar en la médula y continuar', () => {
    const { h, hole, pos, tick, until } = setup();
    hole.press(h.ptr(pos.x, pos.y));
    until((x) => x.layer() === 'medulla');
    hole.release();
    const d = hole.depth();
    tick(1);
    expect(hole.depth()).toBe(d);
    expect(hole.phase()).toBe('drilling');
    hole.press(h.ptr(pos.x, pos.y));
    tick(0.2);
    expect(hole.depth()).toBeGreaterThan(d);
  });

  it('sobrecalienta una cortical gruesa con presión alta → necrosis térmica', () => {
    const { h, hole, pos, until } = setup({ profile: [4, 2, 4] });
    hole.press(h.ptr(pos.x, pos.y, { pressure: 5 }));
    until((x) => x.phase() !== 'drilling', 30);
    expect(h.log.faultCount('thermalNecrosis')).toBe(1);
    expect(h.wound.decals.some((d) => d.kind === 'necrosis')).toBe(true);
  });

  it('presión moderada en cortical normal no produce necrosis', () => {
    const { h, hole, pos, tick, until } = setup({ profile: [1.5, 5, 1.5] });
    hole.press(h.ptr(pos.x, pos.y, { pressure: 2 }));
    until((x) => x.phase() === 'breakthrough');
    tick(0.1);
    hole.release();
    expect(h.log.faults()).toEqual([]);
    expect(hole.result()!.peakHeat).toBeLessThan(47);
  });

  it('hueso frágil con presión ≥ 4 en cortical → fisura iatrogénica (una vez)', () => {
    const { h, hole, pos, tick } = setup({ fragile: true });
    hole.press(h.ptr(pos.x, pos.y, { pressure: 4 }));
    tick(0.5);
    expect(h.log.faultCount('iatrogenicFissure')).toBe(1);
    expect(h.wound.decals.some((d) => d.kind === 'fissure')).toBe(true);
  });

  it('menos presión calienta menos por mm de cortical', () => {
    const peak = (pressure: number) => {
      const { h, hole, pos, until } = setup({ profile: [3, 10, 3] });
      hole.press(h.ptr(pos.x, pos.y, { pressure }));
      until((x) => x.layer() !== 'cis', 30);
      return hole.heat();
    };
    const p1 = peak(1);
    const p3 = peak(3);
    const p5 = peak(5);
    expect(p1).toBeLessThan(39);
    expect(p3).toBeGreaterThan(p1 + 3);
    expect(p3).toBeLessThan(47);
    expect(p5).toBeGreaterThan(55);
  });

  it('hueso frágil con presión 3 mantenida en cortical cruje y luego fisura', () => {
    const { h, hole, pos, tick } = setup({ fragile: true, profile: [0.8, 4, 0.8] });
    hole.press(h.ptr(pos.x, pos.y, { pressure: 3 }));
    tick(0.3);
    expect(h.hud.pops.some((p) => p.text === 'Cruje…')).toBe(true);
    expect(h.log.faultCount('iatrogenicFissure')).toBe(0);
    tick(0.3);
    expect(h.log.faultCount('iatrogenicFissure')).toBe(1);
  });

  it('hueso frágil: a pulsos cortos con presión 3, o con presión 2 seguida, no fisura', () => {
    const pulses = setup({ fragile: true, profile: [0.8, 4, 0.8] });
    for (let i = 0; i < 80 && pulses.hole.phase() !== 'breakthrough'; i++) {
      pulses.hole.press(pulses.h.ptr(pulses.pos.x, pulses.pos.y, { pressure: 3 }));
      pulses.tick(0.3);
      pulses.hole.release();
      pulses.tick(0.1);
    }
    expect(pulses.h.log.faultCount('iatrogenicFissure')).toBe(0);
    const low = setup({ fragile: true, profile: [0.8, 4, 0.8] });
    low.hole.press(low.h.ptr(low.pos.x, low.pos.y, { pressure: 2 }));
    low.until((x) => x.phase() === 'breakthrough');
    expect(low.h.log.faultCount('iatrogenicFissure')).toBe(0);
  });

  it('desviarse más de 2×tol detiene la broca y raya el hueso', () => {
    const { h, hole, pos, tick } = setup();
    hole.press(h.ptr(pos.x, pos.y));
    tick(0.3);
    hole.move(h.ptr(pos.x + 4, pos.y));
    expect(hole.holding()).toBe(false);
    expect(h.hud.pops.some((p) => p.text === 'Broca desviada')).toBe(true);
    expect(h.wound.decals.some((d) => d.kind === 'scratch')).toBe(true);
    expect(hole.press(h.ptr(pos.x + 4, pos.y))).toBe(false);
    expect(hole.press(h.ptr(pos.x, pos.y))).toBe(true);
  });
});

describe('utilidades', () => {
  it('BoneHeat acumula tiempo sobre 47 °C y dispara necrosis una vez', () => {
    const heat = new BoneHeat();
    let fired = 0;
    for (let i = 0; i < 300; i++) if (heat.step(DT, 6)) fired++;
    expect(fired).toBe(1);
    expect(heat.peak).toBeGreaterThan(47);
    for (let i = 0; i < 600; i++) heat.step(DT, 0);
    expect(heat.c).toBe(37);
  });

  it('geometría: solapes y distancias', () => {
    const a = rectPoly(0, 0, 10, 10);
    expect(polygonsOverlap(a, rectPoly(8, 0, 10, 10))).toBe(true);
    expect(polygonsOverlap(a, rectPoly(20, 0, 10, 10))).toBe(false);
    expect(distToPolygonEdge({ x: 8, y: 0 }, a)).toBeCloseTo(3);
    expect(nearPolygon({ x: 7, y: 0 }, a, 2.5)).toBe(true);
    expect(nearPolygon({ x: 8, y: 0 }, a, 2.5)).toBe(false);
  });

  it('pistas y formato', () => {
    expect(clampHint('x'.repeat(120)).length).toBe(90);
    expect(fmt(13.25)).toBe('13,3');
  });
});
