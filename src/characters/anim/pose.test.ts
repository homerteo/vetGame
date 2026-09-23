import { describe, expect, it } from 'vitest';
import { computeAnimalPose, createAnimalPose } from './animalPose';
import { ALL_ANIMS, blendHumanPose, computeHumanPose, createHumanPose, DEFAULT_STYLE, EYES } from './humanPose';

const finite = (o: unknown): boolean => {
  if (typeof o === 'number') return Number.isFinite(o);
  if (o && typeof o === 'object') return Object.values(o).every(finite);
  return true;
};

describe('poses humanas', () => {
  it('todas las animaciones dan valores finitos en cualquier instante', () => {
    const p = createHumanPose();
    for (const a of ALL_ANIMS) for (const t of [0, 0.37, 1.9, 12.3]) expect(finite(computeHumanPose(a, t, t, DEFAULT_STYLE, p))).toBe(true);
  });

  it('al andar las piernas se alternan y los brazos van en contra', () => {
    const p = computeHumanPose('walk', 0.3, 0.3, DEFAULT_STYLE, createHumanPose());
    expect(Math.sign(p.legL.hip)).toBe(-Math.sign(p.legR.hip));
    expect(Math.sign(p.armL.swing)).toBe(-Math.sign(p.legL.hip));
  });

  it('el desmayo cae hacia atrás del todo y cierra los ojos', () => {
    const p = createHumanPose();
    expect(computeHumanPose('faint', 1, 0.1, DEFAULT_STYLE, p).fall).toBeLessThan(0.05);
    const end = computeHumanPose('faint', 5, 2, DEFAULT_STYLE, p);
    expect(end.fall).toBe(1);
    expect(end.eyes).toBe(EYES.closed);
  });

  it('accesorios según animación: móvil en selfie, bandeja al ofrecer, cánula en guitarra y aspiración', () => {
    const p = createHumanPose();
    expect(computeHumanPose('selfie', 1, 1, DEFAULT_STYLE, p).phone).toBe(1);
    expect(computeHumanPose('offer', 1, 1, DEFAULT_STYLE, p).tray).toBe(1);
    expect(computeHumanPose('guitar', 1, 1, DEFAULT_STYLE, p).cannula).toBe(1);
    expect(computeHumanPose('suction', 1, 1, DEFAULT_STYLE, p).cannula).toBe(1);
    expect(computeHumanPose('idle', 1, 1, DEFAULT_STYLE, p).phone).toBe(0);
  });

  it('el nerviosismo de estilo añade temblor y la mezcla converge', () => {
    const jitter = computeHumanPose('idle', 1, 1, { ...DEFAULT_STYLE, jitter: 1 }, createHumanPose());
    expect(jitter.shake).toBeGreaterThan(0);
    const cur = createHumanPose();
    const target = computeHumanPose('cheer', 1, 1, DEFAULT_STYLE, createHumanPose());
    for (let i = 0; i < 60; i++) blendHumanPose(cur, target, 0.2);
    expect(cur.armL.swing).toBeCloseTo(target.armL.swing, 3);
  });
});

describe('poses de animales', () => {
  it('valores finitos y trote en diagonal', () => {
    const p = createAnimalPose();
    const st = { speed: 1, wagSpeed: 1, hop: false, phase: 0 };
    for (const a of ALL_ANIMS) expect(finite(computeAnimalPose(a, 0.7, 0.7, st, p))).toBe(true);
    const w = computeAnimalPose('walk', 0.13, 0.13, st, p);
    expect(w.legs[0]).toBeCloseTo(w.legs[3]);
    expect(w.legs[1]).toBeCloseTo(w.legs[2]);
    expect(w.legs[0]).toBeCloseTo(-w.legs[1]);
  });

  it('desmayo: se tumba de lado; sentado: sit = 1', () => {
    const st = { speed: 1, wagSpeed: 1, hop: false, phase: 0 };
    expect(computeAnimalPose('faint', 3, 3, st, createAnimalPose()).lie).toBe(1);
    expect(computeAnimalPose('sit', 3, 3, st, createAnimalPose()).sit).toBe(1);
  });
});
