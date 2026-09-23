/** Dueños: Doña Hortensia, Don Braulio y tres dueños genéricos (todos adultos). */
import * as THREE from 'three';
import { HumanRig } from '../HumanRig';
import { crumple } from '../kit';
import { furTexture, plaidTexture } from '../textures';
import { bangs, glasses, hairCap, interpR, shade } from './common';

// ───────────── Doña Hortensia ─────────────
export function buildHortensia(): HumanRig {
  const SKIN = '#f4d8c8';
  const COAT = '#e6b3cf';
  const HAIR = '#d6bfe6';
  const rig = new HumanRig('hortensia', {
    height: 1.6,
    headR: 0.15,
    headScale: [1.02, 1.0, 0.98],
    skin: SKIN,
    legRatio: 0.42,
    hipX: 0.085,
    thighR: 0.068,
    shinR: 0.048,
    armR: 0.045,
    shoulderX: 0.19,
    torso: [[0, 0.19], [0.3, 0.178], [0.6, 0.198], [0.8, 0.19], [0.92, 0.14], [1, 0.055]],
    pelvis: [[-0.11, 0.09], [-0.05, 0.18], [0.03, 0.195], [0.1, 0.19]],
    depth: 0.78,
    belly: { y: 0.3, h: 0.2, amount: 0.02 },
    handR: 0.042,
    neckR: 0.045,
    neckLen: 0.045,
    style: { stiff: 0.35, sway: 0.55, phase: 0.7 },
  });
  const k = rig.kit;
  const skin = rig.mat(SKIN, { finish: 'skin' });
  const fur = k.own(furTexture(COAT, '#b98aa5'));
  const coatMat = rig.mat('#ffffff', { finish: 'plush', map: fur });
  // vestido burdeos bajo el abrigo
  rig.torsoLayer('#8e2446', { from: 0, to: 1, capTop: true });
  rig.pelvisLayer('#8e2446', { offset: 0.004 });
  rig.flare(rig.hips, '#8e2446', 0.05, -0.3, 0.2, 0.24);
  // abrigo de piel sintética, abierto
  const coat = rig.torsoLayer('#ffffff', { from: 0, to: 0.94, offset: 0.035, gapDeg: 40, finish: 'plush', map: fur });
  coat.name = 'furCoat';
  // ribete de piel esponjosa en la abertura
  for (const side of [1, -1]) for (let i = 0; i < 7; i++) {
    const p = rig.torsoPt(side * 0.36, 0.08 + i * 0.13, 0.05);
    k.mesh(k.sphereGeo(12), coatMat, rig.torso, [p.x, p.y, p.z], 0.042);
  }
  rig.flare(rig.torso, '#ffffff', 0.04, -0.42, interpR(rig, 0) + 0.035, interpR(rig, 0) + 0.1, { gapDeg: 30, finish: 'plush', map: fur });
  // cuello de piel enorme
  k.mesh(k.torusGeo(0.13, 0.055, Math.PI * 2, 24), coatMat, rig.torso, [0, rig.torsoLen * 0.93, 0.0], [1, 0.8, 1], [Math.PI / 2 + 0.25, 0, 0]);
  rig.buildArms(coatMat, coatMat, skin, { upperR: 0.068, foreR: 0.06 });
  for (const el of [rig.elbowL, rig.elbowR]) k.mesh(k.torusGeo(0.058, 0.03, Math.PI * 2, 16), coatMat, el, [0, -rig.foreArm + 0.035, 0], 1, [Math.PI / 2, 0, 0]);
  const tights = rig.mat('#e9c6b4', { finish: 'skin' });
  rig.buildLegs(tights, tights);
  rig.buildShoes('#8e2446', { finish: 'gloss', sole: '#5a1630', len: 0.19, width: 0.07, toe: '#a8315a' });
  // bolso con cierre dorado
  const bag = new THREE.Group();
  bag.name = 'handbag';
  bag.position.set(0, -0.12, 0.02);
  rig.handL.add(bag);
  k.mesh(k.boxGeo(0.16, 0.11, 0.06), rig.mat('#6d1e3a', { finish: 'gloss' }), bag, [0, -0.04, 0]);
  k.mesh(k.torusGeo(0.05, 0.007, Math.PI, 14), rig.mat('#6d1e3a', { finish: 'gloss' }), bag, [0, 0.015, 0]);
  k.mesh(k.boxGeo(0.03, 0.02, 0.065), rig.mat('#f5c542', { finish: 'metal' }), bag, [0, 0.005, 0]);
  rig.buildHead();
  // collar de perlas en dos vueltas
  const pearl = rig.mat('#fffaf2', { finish: 'gloss' });
  for (const [n, drop, r] of [[18, 0.035, 0.07], [24, 0.075, 0.09]] as const) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const front = Math.max(0, Math.cos(a));
      k.mesh(k.sphereGeo(10), pearl, rig.torso, [Math.sin(a) * r, rig.torsoLen * 0.98 - front * drop, Math.cos(a) * r * 0.95 + 0.02], 0.011);
    }
  }
  rig.buildFace({
    pupil: '#3b2a3a', eyeSize: 0.95, eyeSpacing: 0.36, eyeY: -0.08,
    lashes: '#3b2a3a', shadow: '#b48ad8',
    brow: { color: '#8f6f86', tilt: -0.25, thick: 0.02, y: 0.36, len: 0.22 },
    lips: '#d4284f', blushBase: 0.35, nose: '#e7b8a4',
  });
  const R = rig.headR;
  for (const side of [1, -1]) k.mesh(k.sphereGeo(10), pearl, rig.headCenter, [side * R * 1.03, -R * 0.32, 0], R * 0.08);
  // peinado cardado enorme con reflejos lila
  hairCap(rig, HAIR, { tilt: 0.4, theta: 1.8, scale: 1.1 });
  k.ball(HAIR, rig.headCenter, [0, R * 0.6, -R * 0.1], [R * 1.25, R * 0.95, R * 1.15]);
  for (const side of [1, -1]) k.ball(HAIR, rig.headCenter, [side * R * 0.95, R * 0.05, -R * 0.1], [R * 0.45, R * 0.6, R * 0.6]);
  k.ball(shade(HAIR, 0.06), rig.headCenter, [R * 0.2, R * 1.05, R * 0.35], [R * 0.6, R * 0.4, R * 0.5]);
  rig.emoteY(R * 1.9);
  return rig;
}

// ───────────── Don Braulio ─────────────
export function buildBraulio(): HumanRig {
  const SKIN = '#d9a27c';
  const rig = new HumanRig('braulio', {
    height: 1.7,
    headR: 0.155,
    skin: SKIN,
    legRatio: 0.43,
    hipX: 0.095,
    thighR: 0.075,
    shinR: 0.058,
    armR: 0.052,
    shoulderX: 0.215,
    torso: [[0, 0.2], [0.3, 0.2], [0.6, 0.21], [0.82, 0.21], [0.93, 0.15], [1, 0.062]],
    pelvis: [[-0.12, 0.1], [-0.06, 0.18], [0.02, 0.2], [0.1, 0.2]],
    depth: 0.8,
    belly: { y: 0.33, h: 0.2, amount: 0.05 },
    handR: 0.05,
    neckR: 0.062,
    neckLen: 0.04,
    style: { jitter: 0.12, sway: 0.2, phase: 4.4 },
  });
  const k = rig.kit;
  const skin = rig.mat(SKIN, { finish: 'skin' });
  const plaid = k.own(plaidTexture('#c2504a', '#5a1f24', [6, 3]));
  const shirt = rig.mat('#ffffff', { finish: 'cloth', map: plaid });
  rig.torsoLayer('#ffffff', { from: 0, to: 1, capTop: true, map: plaid });
  rig.pelvisLayer('#7b7a52', { offset: 0.005 });
  // chaleco multibolsillos
  const VEST = '#b9a56a';
  rig.torsoLayer(VEST, { from: 0.02, to: 0.94, offset: 0.02, gapDeg: 44 });
  for (const side of [1, -1]) {
    for (const [f, th] of [[0.25, 0.55], [0.5, 0.6], [0.75, 0.5]] as const) {
      const p = rig.torsoPt(side * th, f, 0.024);
      k.mesh(k.boxGeo(0.07, 0.065, 0.014), rig.mat(shade(VEST, -0.06), { finish: 'cloth' }), rig.torso, [p.x, p.y, p.z], 1, [0, side * th, 0]);
      k.mesh(k.boxGeo(0.072, 0.02, 0.016), rig.mat(shade(VEST, -0.12), { finish: 'cloth' }), rig.torso, [p.x, p.y + 0.028, p.z + 0.002], 1, [0, side * th, 0]);
    }
  }
  // antena de bolsillo (radio de onda corta, por si acaso)
  const ant = rig.torsoPt(0.6, 0.8, 0.03);
  k.mesh(k.cylGeo(0.003, 0.003, 0.14, 6), rig.mat('#2b2b33', { finish: 'metal' }), rig.torso, [ant.x, ant.y + 0.08, ant.z], 1, [0, 0, -0.15]);
  k.mesh(k.sphereGeo(8), rig.mat('#ff2e4d', { finish: 'gloss' }), rig.torso, [ant.x + 0.01, ant.y + 0.15, ant.z], 0.008);
  rig.buildArms(shirt, skin, skin, { upperR: 0.058 });
  const cargo = rig.mat('#7b7a52', { finish: 'cloth' });
  rig.buildLegs(cargo, cargo, { thighR: 0.084, shinR: 0.07 });
  for (const hip of [rig.hipL, rig.hipR]) k.mesh(k.boxGeo(0.02, 0.09, 0.08), rig.mat(shade('#7b7a52', -0.07), { finish: 'cloth' }), hip, [hip === rig.hipL ? 0.085 : -0.085, -rig.thighLen * 0.6, 0]);
  rig.buildShoes('#6b4a32', { finish: 'vinyl', sole: '#3a281c', bootH: 0.1, len: 0.23, width: 0.095, laces: '#e9d9b8' });
  rig.buildHead();
  rig.buildFace({
    pupil: '#2a1a12', eyeSize: 1, eyeSpacing: 0.35, eyeY: -0.1, squint: true,
    brow: { color: '#6d6468', tilt: 0.3, thick: 0.055, y: 0.18, len: 0.25 },
    blushBase: 0.15, nose: '#c98b66',
  });
  const R = rig.headR;
  // bigote poblado
  for (const side of [1, -1]) k.ball('#7a6f70', rig.headCenter, [side * R * 0.16, -R * 0.36, R * 0.9], [R * 0.2, R * 0.08, R * 0.08], {}, [0, 0, side * 0.35]);
  // pelo canoso a los lados
  const band = k.geo('braulioBand', () => new THREE.SphereGeometry(1, 24, 10, Math.PI - 0.6, Math.PI + 1.2, 1.1, 0.75));
  k.mesh(band, rig.mat('#9e979b', { finish: 'vinyl', side: THREE.DoubleSide }), rig.headCenter, [0, 0, 0], R * 1.05);
  // gorro de papel de aluminio arrugado
  const hatG = k.own(new THREE.ConeGeometry(R * 1.05, R * 1.5, 11, 5, true));
  crumple(hatG, R * 0.05, 11);
  const hat = k.mesh(hatG, rig.mat('#d9dde6', { finish: 'metal', side: THREE.DoubleSide }), rig.headCenter, [R * 0.05, R * 1.02, -R * 0.02], 1, [-0.08, 0, -0.12]);
  hat.name = 'foilHat';
  const brimG = k.own(new THREE.TorusGeometry(R * 1.02, R * 0.07, 6, 14));
  crumple(brimG, R * 0.03, 5);
  k.mesh(brimG, rig.mat('#cfd4de', { finish: 'metal' }), rig.headCenter, [R * 0.02, R * 0.32, -R * 0.02], 1, [Math.PI / 2 - 0.08, 0.12, 0]);
  rig.emoteY(R * 2.1);
  return rig;
}

// ───────────── Dueños genéricos ─────────────
export function buildOwnerA(): HumanRig {
  const SKIN = '#8d5b3d';
  const rig = new HumanRig('ownerA', {
    height: 1.74, headR: 0.15, skin: SKIN, legRatio: 0.47, hipX: 0.08, thighR: 0.066, shinR: 0.05, armR: 0.042,
    shoulderX: 0.18, depth: 0.74, handR: 0.043, neckR: 0.046, neckLen: 0.06,
    torso: [[0, 0.165], [0.3, 0.15], [0.6, 0.165], [0.82, 0.17], [0.93, 0.125], [1, 0.052]],
    pelvis: [[-0.11, 0.08], [-0.05, 0.16], [0.03, 0.17], [0.1, 0.162]],
    style: { sway: 0.6, bounce: 0.3, phase: 2.9 },
  });
  const k = rig.kit;
  const skin = rig.mat(SKIN, { finish: 'skin' });
  const SWEATER = '#ffd45c';
  rig.torsoLayer(SWEATER, { from: 0, to: 1, capTop: true });
  rig.flare(rig.torso, SWEATER, 0.06, -0.07, interpR(rig, 0.02) + 0.01, interpR(rig, 0.02) + 0.02);
  k.mesh(k.torusGeo(0.058, 0.016, Math.PI * 2, 20), rig.mat(shade(SWEATER, -0.1), { finish: 'cloth' }), rig.torso, [0, rig.torsoLen * 0.98, 0], 1, [Math.PI / 2, 0, 0]);
  rig.pelvisLayer('#5d7fc6', { offset: 0.004 });
  const sw = rig.mat(SWEATER, { finish: 'cloth' });
  rig.buildArms(sw, sw, skin, { upperR: 0.05, foreR: 0.046 });
  const jeans = rig.mat('#5d7fc6', { finish: 'cloth' });
  rig.buildLegs(jeans, jeans, { thighR: 0.072, shinR: 0.056 });
  rig.buildShoes('#ffffff', { finish: 'vinyl', sole: '#e9e3ef', len: 0.22, width: 0.08, laces: '#ff8fc7' });
  rig.buildHead();
  rig.buildFace({ pupil: '#1e120c', eyeSize: 1.05, lashes: '#1e120c', brow: { color: '#1e120c', tilt: -0.1, thick: 0.03 }, lips: '#b0405a', blushBase: 0.3, blush: '#e0607e', nose: '#7a4c33' });
  const R = rig.headR;
  for (const side of [1, -1]) k.mesh(k.torusGeo(R * 0.14, R * 0.022, Math.PI * 2, 16), rig.mat('#f5c542', { finish: 'metal' }), rig.headCenter, [side * R * 1.05, -R * 0.42, 0], 1, [0, Math.PI / 2, 0]);
  // afro rizado
  const HAIR = '#24160f';
  hairCap(rig, HAIR, { tilt: 0.35, theta: 1.7, scale: 1.08 });
  for (let i = 0; i < 16; i++) {
    const yaw = (i / 16) * Math.PI * 2;
    const up = 0.3 + (i % 3) * 0.25;
    k.ball(HAIR, rig.headCenter, [Math.sin(yaw) * R * 0.95, R * (0.35 + up * 0.5), Math.cos(yaw) * R * 0.85 - R * 0.15], R * (0.42 + (i % 2) * 0.08));
  }
  k.ball(HAIR, rig.headCenter, [0, R * 0.75, -R * 0.1], R * 0.85);
  rig.emoteY(R * 1.9);
  return rig;
}

export function buildOwnerB(): HumanRig {
  const SKIN = '#e8b996';
  const rig = new HumanRig('ownerB', {
    height: 1.72, headR: 0.156, skin: SKIN, legRatio: 0.43, hipX: 0.1, thighR: 0.08, shinR: 0.062, armR: 0.056,
    shoulderX: 0.23, depth: 0.82, handR: 0.05, neckR: 0.066, neckLen: 0.04,
    torso: [[0, 0.215], [0.3, 0.22], [0.6, 0.228], [0.82, 0.225], [0.93, 0.16], [1, 0.066]],
    pelvis: [[-0.12, 0.1], [-0.06, 0.19], [0.02, 0.21], [0.1, 0.212]],
    belly: { y: 0.34, h: 0.2, amount: 0.06 },
    style: { heavy: 0.5, phase: 6.2 },
  });
  const k = rig.kit;
  const skin = rig.mat(SKIN, { finish: 'skin' });
  const HOOD = '#ff9a52';
  rig.torsoLayer(HOOD, { from: 0, to: 1, capTop: true });
  rig.flare(rig.torso, HOOD, 0.06, -0.08, interpR(rig, 0.02) + 0.012, interpR(rig, 0.02) + 0.02);
  // capucha y bolsillo canguro
  k.mesh(k.torusGeo(0.11, 0.04, Math.PI * 2, 20), rig.mat(shade(HOOD, -0.06), { finish: 'cloth' }), rig.torso, [0, rig.torsoLen * 0.96, -0.04], [1, 0.8, 1], [Math.PI / 2 - 0.5, 0, 0]);
  const pp = rig.torsoPt(0, 0.28, 0.01);
  k.mesh(k.boxGeo(0.22, 0.1, 0.02), rig.mat(shade(HOOD, -0.05), { finish: 'cloth' }), rig.torso, [0, pp.y, pp.z + (rig.spec.belly!.amount * 0.9)], 1, [-0.2, 0, 0]);
  for (const side of [1, -1]) k.limb('#ffffff', rig.torso, rig.torsoPt(side * 0.12, 0.93, 0.02), rig.torsoPt(side * 0.14, 0.72, 0.03), 0.006, { finish: 'vinyl' });
  rig.pelvisLayer('#8a8f9c', { offset: 0.004 });
  const hood = rig.mat(HOOD, { finish: 'cloth' });
  rig.buildArms(hood, hood, skin, { upperR: 0.064, foreR: 0.058 });
  const pants = rig.mat('#8a8f9c', { finish: 'cloth' });
  rig.buildLegs(pants, pants, { thighR: 0.088, shinR: 0.07 });
  rig.buildShoes('#39394a', { finish: 'vinyl', sole: '#f2f2f5', len: 0.24, width: 0.095, laces: '#ffffff' });
  rig.buildHead();
  rig.buildFace({ pupil: '#2a1a12', eyeSize: 0.95, brow: { color: '#6b4a32', tilt: 0.05, thick: 0.045 }, blushBase: 0.25, nose: '#d39a78', cheeks: 0.5 });
  const R = rig.headR;
  // barba
  const beard = k.geo('beard', () => new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45));
  k.mesh(beard, rig.mat('#6b4a32', { finish: 'vinyl', side: THREE.DoubleSide }), rig.headCenter, [0, -R * 0.02, R * 0.08], [R * 1.02, R * 1.02, R * 0.98]);
  // gorra verde azulado
  const CAP = '#2fa39a';
  hairCap(rig, '#6b4a32', { tilt: 0.3, theta: 1.65, scale: 1.04 });
  const capG = k.geo('cap', () => new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5));
  k.mesh(capG, rig.mat(CAP, { finish: 'cloth' }), rig.headCenter, [0, R * 0.2, -R * 0.02], [R * 1.1, R * 0.9, R * 1.1], [-0.15, 0, 0]);
  k.mesh(k.cylGeo(R * 0.7, R * 0.72, R * 0.06, 20), rig.mat(shade(CAP, -0.08), { finish: 'cloth' }), rig.headCenter, [0, R * 0.25, R * 0.95], [1, 1, 0.8], [0.12, 0, 0]);
  k.ball('#ffffff', rig.headCenter, [0, R * 1.08, 0], R * 0.09, { finish: 'cloth' });
  rig.emoteY(R * 1.6);
  return rig;
}

export function buildOwnerC(): HumanRig {
  const SKIN = '#c68a64';
  const rig = new HumanRig('ownerC', {
    height: 1.62, headR: 0.152, skin: SKIN, legRatio: 0.41, hipX: 0.1, thighR: 0.084, shinR: 0.058, armR: 0.054,
    shoulderX: 0.2, depth: 0.82, handR: 0.046, neckR: 0.058, neckLen: 0.04,
    torso: [[0, 0.225], [0.3, 0.215], [0.6, 0.222], [0.8, 0.21], [0.92, 0.15], [1, 0.06]],
    pelvis: [[-0.12, 0.1], [-0.06, 0.2], [0.02, 0.228], [0.1, 0.225]],
    belly: { y: 0.3, h: 0.2, amount: 0.05 },
    style: { stiff: 0.2, sway: 0.4, phase: 7.7 },
  });
  const k = rig.kit;
  const skin = rig.mat(SKIN, { finish: 'skin' });
  rig.torsoLayer('#fff3dc', { from: 0, to: 1, capTop: true });
  const CARD = '#9b6bd1';
  rig.torsoLayer(CARD, { from: 0, to: 0.95, offset: 0.018, gapDeg: 36 });
  rig.flare(rig.torso, CARD, 0.05, -0.12, interpR(rig, 0) + 0.018, interpR(rig, 0) + 0.035, { gapDeg: 30 });
  for (let i = 0; i < 4; i++) {
    const p = rig.torsoPt(0.33, 0.2 + i * 0.18, 0.024);
    k.mesh(k.sphereGeo(10), rig.mat('#f5c542', { finish: 'metal' }), rig.torso, [p.x, p.y, p.z], 0.01);
  }
  rig.pelvisLayer('#7a5a44', { offset: 0.004 });
  const card = rig.mat(CARD, { finish: 'cloth' });
  rig.buildArms(card, card, skin, { upperR: 0.064, foreR: 0.058 });
  const tr = rig.mat('#7a5a44', { finish: 'cloth' });
  rig.buildLegs(tr, tr, { thighR: 0.092, shinR: 0.066 });
  rig.buildShoes('#5a3a2a', { finish: 'gloss', sole: '#2e1d14', len: 0.21, width: 0.085 });
  rig.buildHead();
  rig.buildFace({ pupil: '#2a1a12', eyeSize: 0.95, brow: { color: '#d4ced8', tilt: -0.15, thick: 0.04 }, blushBase: 0.3, nose: '#b0765a', cheeks: 0.6 });
  const R = rig.headR;
  // pelo corto canoso y rizado
  const HAIR = '#d4ced8';
  hairCap(rig, HAIR, { tilt: 0.3, theta: 1.55, scale: 1.08 });
  for (let i = 0; i < 9; i++) {
    const yaw = -1.2 + (i / 8) * 2.4;
    const p = rig.surf(yaw, 0.55 + (i % 2) * 0.12, 0);
    k.ball(HAIR, rig.headCenter, [p.x, p.y, p.z * 0.9], R * 0.2);
  }
  bangs(rig, HAIR, 3, { from: -0.4, to: 0.4, pitch: 0.55, size: 0.22 });
  glasses(rig, '#6f3fd1', { lensR: 0.19, spacing: 0.36, y: -0.09, lens: '#eef6ff' });
  rig.emoteY(R * 1.5);
  return rig;
}
