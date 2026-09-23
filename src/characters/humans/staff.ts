/** Equipo del quirófano: Valerio, Rodrigo, Fritz y Gigi. */
import * as THREE from 'three';
import { HumanRig } from '../HumanRig';
import { rockTeeTexture } from '../textures';
import { bangs, glasses, hairCap, heartGeo, interpR, scrubs, shade } from './common';

// ───────────── Dr. Valerio Sterling ─────────────
export function buildValerio(): HumanRig {
  const SKIN = '#ecc6a8';
  const COAT = '#fbfbff';
  const rig = new HumanRig('valerio', {
    height: 1.88,
    headR: 0.152,
    headScale: [0.97, 1.06, 0.98],
    skin: SKIN,
    legRatio: 0.465,
    hipX: 0.085,
    thighR: 0.066,
    shinR: 0.052,
    armR: 0.046,
    shoulderX: 0.215,
    torso: [[0, 0.165], [0.3, 0.16], [0.6, 0.185], [0.82, 0.2], [0.93, 0.15], [1, 0.058]],
    pelvis: [[-0.12, 0.08], [-0.06, 0.15], [0.02, 0.165], [0.1, 0.165]],
    depth: 0.72,
    handR: 0.046,
    neckR: 0.05,
    neckLen: 0.05,
    style: { stiff: 0.85, sway: 0.05, phase: 1.1 },
  });
  const k = rig.kit;
  const skin = rig.mat(SKIN, { finish: 'skin' });
  const coat = rig.mat(COAT, { finish: 'cloth' });
  // camisa, corbata y pantalón
  rig.torsoLayer('#cfe3ff', { from: 0, to: 1, capTop: true });
  rig.pelvisLayer('#3a3a48', { offset: 0.004 });
  const tieTop = rig.torsoPt(0, 0.95, 0.006);
  k.ball('#7a1f3d', rig.torso, [0, tieTop.y - 0.01, tieTop.z], [0.022, 0.02, 0.012], { finish: 'gloss' });
  const tie = k.mesh(k.boxGeo(0.045, 0.3, 0.008), rig.mat('#7a1f3d', { finish: 'gloss' }), rig.torso, [0, tieTop.y - 0.17, rig.torsoPt(0, 0.7, 0.012).z]);
  tie.rotation.x = -0.1;
  // bata impecable, abierta al frente
  rig.torsoLayer(COAT, { from: 0, to: 0.97, offset: 0.024, gapDeg: 46, capTop: false });
  rig.flare(rig.torso, COAT, 0.04, -0.46, interpR(rig, 0) + 0.024, interpR(rig, 0) + 0.075, { gapDeg: 34 });
  // solapas
  for (const side of [1, -1]) {
    const a = rig.torsoPt(side * 0.45, 0.97, 0.03);
    const b = rig.torsoPt(side * 0.34, 0.58, 0.032);
    k.limb(COAT, rig.torso, a, b, 0.018, { finish: 'cloth' });
    // bolsillos
    const pk = rig.torsoPt(side * 0.75, 0.08, 0.03);
    k.mesh(k.boxGeo(0.09, 0.08, 0.01), rig.mat('#eef0fa', { finish: 'cloth' }), rig.torso, [pk.x, pk.y - 0.05, pk.z], 1, [0, side * 0.75, 0]);
  }
  const bp = rig.torsoPt(0.62, 0.74, 0.03);
  k.mesh(k.boxGeo(0.07, 0.06, 0.01), rig.mat('#eef0fa', { finish: 'cloth' }), rig.torso, [bp.x, bp.y, bp.z], 1, [0, 0.62, 0]);
  k.mesh(k.cylGeo(0.005, 0.005, 0.08, 8), rig.mat('#2b2b3a', { finish: 'gloss' }), rig.torso, [bp.x, bp.y + 0.03, bp.z], 1, [0, 0, 0.1]);
  // gafete
  k.mesh(k.boxGeo(0.05, 0.065, 0.004), rig.mat('#ffffff', { finish: 'vinyl' }), rig.torso, [-bp.x, bp.y, bp.z], 1, [0, -0.62, 0]);
  k.mesh(k.boxGeo(0.05, 0.015, 0.005), rig.mat('#6f3fd1', { finish: 'vinyl' }), rig.torso, [-bp.x, bp.y + 0.024, bp.z + 0.001], 1, [0, -0.62, 0]);
  rig.buildArms(coat, coat, skin, { upperR: 0.056, foreR: 0.05 });
  for (const el of [rig.elbowL, rig.elbowR]) k.mesh(k.torusGeo(0.048, 0.008), rig.mat('#eef0fa', { finish: 'cloth' }), el, [0, -rig.foreArm + 0.03, 0], 1, [Math.PI / 2, 0, 0]);
  const trouser = rig.mat('#3a3a48', { finish: 'cloth' });
  rig.buildLegs(trouser, trouser, { thighR: 0.072, shinR: 0.06 });
  rig.buildShoes('#1d1a22', { finish: 'gloss', sole: '#141118', len: 0.24, width: 0.085 });
  rig.buildHead();
  rig.buildFace({
    pupil: '#1d2433', eyeSize: 0.9, eyeSpacing: 0.34, eyeY: -0.08,
    brow: { color: '#4a4448', tilt: 0.38, thick: 0.045, y: 0.24, len: 0.24 },
    frown: true, blushBase: 0.08, nose: '#dcae8e',
  });
  // pelo oscuro con canas, peinado hacia atrás
  const R = rig.headR;
  hairCap(rig, '#2e2826', { tilt: 0.75, theta: 1.7, scale: 1.06 });
  hairCap(rig, '#b8b4ba', { tilt: 0.95, theta: 1.25, scale: 1.1, y: R * 0.05, sx: 0.9 });
  k.ball('#c9c5cb', rig.headCenter, [0, R * 0.78, R * 0.25], [R * 0.62, R * 0.22, R * 0.5], {}, [-0.35, 0, 0]);
  for (const side of [1, -1]) k.ball('#d8d4da', rig.headCenter, [side * R * 0.9, R * 0.1, -R * 0.1], [R * 0.2, R * 0.32, R * 0.4]);
  glasses(rig, '#c9ced8', { rect: true, lensR: 0.16, spacing: 0.34, y: -0.08, lens: '#e6f3ff' });
  return rig;
}

// ───────────── Rodrigo ─────────────
export function buildRodrigo(): HumanRig {
  const SKIN = '#c98f6c';
  const SCRUB = '#3fbf8a';
  const DREAD = '#4a2e1c';
  const rig = new HumanRig('rodrigo', {
    height: 1.8,
    headR: 0.158,
    headScale: [1.06, 0.98, 1.0],
    skin: SKIN,
    legRatio: 0.42,
    hipX: 0.11,
    thighR: 0.09,
    shinR: 0.072,
    armR: 0.066,
    shoulderX: 0.255,
    torso: [[0, 0.225], [0.2, 0.235], [0.45, 0.245], [0.7, 0.255], [0.85, 0.24], [0.94, 0.16], [1, 0.07]],
    pelvis: [[-0.13, 0.12], [-0.07, 0.2], [0.02, 0.228], [0.1, 0.228]],
    depth: 0.8,
    belly: { y: 0.33, h: 0.22, amount: 0.1 },
    handR: 0.056,
    neckR: 0.075,
    neckLen: 0.04,
    style: { heavy: 0.85, sway: 0.2, phase: 2.3 },
  });
  const k = rig.kit;
  const skin = rig.mat(SKIN, { finish: 'skin' });
  const scrub = rig.mat(SCRUB, { finish: 'cloth' });
  // camiseta de rock gastada
  rig.torsoLayer('#35303e', { from: 0, to: 1, capTop: true });
  const tee = k.own(rockTeeTexture());
  const pr = interpR(rig, 0.72) + 0.012;
  const printG = k.own(new THREE.CylinderGeometry(pr, pr, 0.2, 18, 1, true, -0.5, 1.0));
  const print = k.mesh(printG, rig.mat('#ffffff', { finish: 'cloth', map: tee, opacity: 0.999, emissiveIntensity: 0.3 }), rig.torso, [0, rig.torsoLen * 0.7, 0]);
  print.scale.z = rig.spec.depth;
  // scrub verde abierto con mangas cortas
  rig.torsoLayer(SCRUB, { from: 0, to: 0.96, offset: 0.016, gapDeg: 76, bulge: 1 });
  for (const side of [1, -1]) {
    k.limb(shade(SCRUB, -0.1), rig.torso, rig.torsoPt(side * 0.66, 0.95, 0.02), rig.torsoPt(side * 0.72, 0.1, 0.03), 0.012, { finish: 'cloth' });
    const pk = rig.torsoPt(side * 0.95, 0.12, 0.022);
    k.mesh(k.boxGeo(0.08, 0.07, 0.01), rig.mat(shade(SCRUB, -0.08), { finish: 'cloth' }), rig.torso, [pk.x, pk.y, pk.z], 1, [0, side * 0.95, 0]);
  }
  rig.pelvisLayer(SCRUB, { offset: 0.005 });
  rig.buildArms(skin, skin, skin);
  for (const sh of [rig.shoulderL, rig.shoulderR]) k.mesh(k.capsuleGeo(0.082, rig.upperArm * 0.3), scrub, sh, [0, -rig.upperArm * 0.22, 0]);
  rig.buildLegs(scrub, scrub, { thighR: 0.098, shinR: 0.085 });
  rig.buildShoes('#f4f1f7', { finish: 'vinyl', sole: '#3a3440', len: 0.24, width: 0.1, laces: SCRUB });
  // auriculares al cuello
  const hp = new THREE.Group();
  hp.name = 'headphones';
  hp.position.y = rig.torsoLen * 0.99;
  rig.torso.add(hp);
  k.mesh(k.torusGeo(0.105, 0.012, Math.PI * 1.2, 20), rig.mat('#26222c', { finish: 'gloss' }), hp, [0, 0.02, 0.005], [1, 1, 1], [1.25, 0, -Math.PI * 0.1]);
  for (const side of [1, -1]) {
    k.mesh(k.cylGeo(0.048, 0.048, 0.035, 18), rig.mat('#ff2e93', { finish: 'gloss' }), hp, [side * 0.1, -0.005, 0.07], 1, [0.3, 0, Math.PI / 2 + side * 0.4]);
    k.mesh(k.cylGeo(0.04, 0.04, 0.02, 18), rig.mat('#26222c', { finish: 'vinyl' }), hp, [side * 0.085, 0.0, 0.08], 1, [0.3, 0, Math.PI / 2 + side * 0.4]);
  }
  rig.buildHead();
  rig.buildFace({
    pupil: '#2a1a12', eyeSize: 0.9, eyeSpacing: 0.36, eyeY: -0.06,
    brow: { color: DREAD, tilt: -0.05, thick: 0.05, y: 0.26, len: 0.22 },
    blushBase: 0.2, nose: '#b87a58', cheeks: 0.4,
  });
  const R = rig.headR;
  // coronilla calva + corona de pelo atrás
  const band = k.geo('rodrigoBand', () => new THREE.SphereGeometry(1, 26, 12, Math.PI - 0.35, Math.PI + 0.7, 0.95, 1.05));
  k.mesh(band, rig.mat(DREAD, { finish: 'vinyl', side: THREE.DoubleSide }), rig.headCenter, [0, 0, 0], [R * 1.1, R * 1.0, R * 1.04]);
  // perilla
  k.ball(DREAD, rig.headCenter, [0, -R * 0.82, R * 0.62], [R * 0.2, R * 0.2, R * 0.14]);
  k.ball(DREAD, rig.headCenter, [0, -R * 0.5, R * 0.92], [R * 0.16, R * 0.05, R * 0.05]);
  // rastas largas con movimiento secundario (cadenas de cápsulas)
  const dread = rig.mat(DREAD, { finish: 'vinyl' });
  const beads = [rig.mat('#f5c542', { finish: 'metal' }), rig.mat('#ff2e93', { finish: 'gloss' }), rig.mat('#9ff0d0', { finish: 'gloss' })];
  const N = 9;
  for (let i = 0; i < N; i++) {
    const yaw = Math.PI * 0.55 + (Math.PI * 0.9 * i) / (N - 1);
    const pitch = 0.08 - Math.abs(Math.cos(yaw)) * 0.05 + (i % 2) * 0.05;
    const p = rig.surf(yaw, pitch, -R * 0.04);
    const out = Math.sin(yaw);
    const back = Math.cos(yaw);
    rig.addChain(rig.headCenter, [p.x, p.y, p.z], [-back * 0.25, out * 0.22], 4, 0.105 + (i % 3) * 0.012, 0.026, dread, {
      taper: 0.15, stiffness: 36, damping: 5, gain: 0.018, bead: beads[i % 3],
    });
  }
  rig.emoteY(R * 1.35);
  return rig;
}

// ───────────── Fritz ─────────────
export function buildFritz(): HumanRig {
  const SKIN = '#f9dccf';
  const HAIR = '#b07e52';
  const rig = new HumanRig('fritz', {
    height: 1.76,
    headR: 0.15,
    headScale: [1.0, 1.02, 0.98],
    skin: SKIN,
    legRatio: 0.465,
    hipX: 0.075,
    thighR: 0.056,
    shinR: 0.044,
    armR: 0.038,
    shoulderX: 0.17,
    torso: [[0, 0.14], [0.3, 0.13], [0.6, 0.142], [0.84, 0.152], [0.94, 0.11], [1, 0.05]],
    pelvis: [[-0.1, 0.07], [-0.05, 0.13], [0.03, 0.14], [0.1, 0.138]],
    depth: 0.7,
    handR: 0.042,
    neckR: 0.042,
    neckLen: 0.06,
    style: { jitter: 0.55, sway: 0.1, phase: 3.7 },
  });
  const k = rig.kit;
  scrubs(rig, '#78b8f2', { trim: '#4f95d8' });
  rig.buildShoes('#e2e6ee', { finish: 'vinyl', sole: '#9aa3b5', len: 0.22, width: 0.08, laces: '#6fb4f0' });
  rig.buildHead();
  rig.buildFace({
    pupil: '#2f3b52', eyeSize: 1.18, eyeSpacing: 0.35, eyeY: -0.07,
    brow: { color: HAIR, tilt: -0.4, thick: 0.03, y: 0.33, len: 0.2 },
    blushBase: 0.3, blush: '#ff9aa8', nose: '#f2c8b8', freckles: '#e8a488',
  });
  const R = rig.headR;
  // ojeras de no dormir
  for (const side of [1, -1]) rig.onFace(k.mesh(k.circleGeo(), rig.mat('#c9b3e6', { finish: 'flat', opacity: 0.45 }), rig.headCenter, undefined, [R * 0.13, R * 0.05, 1]), side * 0.35, -0.3, 0.006);
  // mascarilla colgando bajo la barbilla, con gomas a las orejas
  const mask = k.ball('#bfe3ff', rig.headCenter, [0, -R * 0.98, R * 0.42], [R * 0.52, R * 0.26, R * 0.16], { finish: 'cloth' }, [0.5, 0, 0]);
  mask.name = 'mask';
  for (let i = 0; i < 3; i++) k.mesh(k.boxGeo(R * 0.7, R * 0.012, R * 0.02), rig.mat('#9fcff2', { finish: 'cloth' }), mask, [0, (i - 1) * 0.3, 0.9], [1 / (R * 0.52 * 1.4), 1 / (R * 0.26), 1 / (R * 0.16)]);
  for (const side of [1, -1]) {
    k.tube('#ffffff', rig.headCenter, [
      new THREE.Vector3(side * R * 0.48, -R * 0.95, R * 0.4),
      new THREE.Vector3(side * R * 0.9, -R * 0.6, R * 0.05),
      new THREE.Vector3(side * R * 1.0, -R * 0.15, -R * 0.02),
    ], R * 0.02, { finish: 'vinyl' });
  }
  // pelo revuelto
  hairCap(rig, HAIR, { tilt: 0.45, theta: 1.6, scale: 1.06 });
  const tufts: Array<[number, number, number, number]> = [
    [0.1, 1.0, 0.25, 0.28], [-0.35, 0.95, 0.1, 0.25], [0.45, 0.9, 0.05, 0.24], [0, 0.95, -0.35, 0.3], [-0.2, 0.75, 0.55, 0.22], [0.3, 0.72, 0.58, 0.2],
  ];
  for (const [x, y, z, r] of tufts) k.ball(HAIR, rig.headCenter, [x * R, y * R, z * R], [r * R, r * R * 0.8, r * R], {}, [x, 0, z]);
  bangs(rig, HAIR, 4, { from: -0.5, to: 0.5, pitch: 0.5, size: 0.26, sweep: -0.3 });
  // gota de sudor permanente
  const drop = k.ball('#9fe0ff', rig.headCenter, [0, 0, 0], [R * 0.06, R * 0.1, R * 0.05], { finish: 'gloss' });
  rig.onFace(drop, 0.78, 0.2, R * 0.03);
  drop.name = 'sweatDrop';
  return rig;
}

// ───────────── Gigi ─────────────
export function buildGigi(): HumanRig {
  const SKIN = '#f8d6c2';
  const HAIR = '#ffd66b';
  const rig = new HumanRig('gigi', {
    height: 1.68,
    headR: 0.156,
    headScale: [1.03, 0.98, 0.98],
    skin: SKIN,
    legRatio: 0.45,
    hipX: 0.085,
    thighR: 0.07,
    shinR: 0.05,
    armR: 0.042,
    shoulderX: 0.18,
    torso: [[0, 0.172], [0.22, 0.155], [0.45, 0.14], [0.66, 0.165], [0.8, 0.165], [0.92, 0.12], [1, 0.052]],
    pelvis: [[-0.11, 0.09], [-0.05, 0.165], [0.03, 0.178], [0.1, 0.17]],
    depth: 0.74,
    handR: 0.042,
    neckR: 0.045,
    neckLen: 0.05,
    style: { bounce: 0.8, sway: 0.7, phase: 5.1 },
  });
  const k = rig.kit;
  scrubs(rig, '#ffa3d1', { trim: '#ff5ca8' });
  // cinturita con lazo
  rig.torsoLayer('#ff5ca8', { from: 0.26, to: 0.31, offset: 0.012 });
  const bow = rig.torsoPt(-0.9, 0.28, 0.02);
  k.mesh(heartGeo(rig, 0.02, 0.008), rig.mat('#ffffff', { finish: 'gloss' }), rig.torso, [bow.x, bow.y, bow.z], 1, [0, -0.9, 0]);
  rig.buildShoes('#ffffff', { finish: 'vinyl', sole: '#ffb3d9', soleH: 0.04, len: 0.21, width: 0.08, laces: '#ff5ca8' });
  rig.buildHead();
  rig.buildFace({
    pupil: '#3d2a55', eyeSize: 1.1, eyeSpacing: 0.37, eyeY: -0.1,
    lashes: '#2b1a2a', shadow: '#ff8fd0',
    brow: { color: '#c9a04a', tilt: -0.05, thick: 0.025, y: 0.33, len: 0.2 },
    lips: '#ff3d86', blush: '#ff6fa8', blushBase: 0.42, nose: '#f0bca6', cheeks: 0.3,
  });
  const R = rig.headR;
  // aros dorados
  for (const side of [1, -1]) k.mesh(k.torusGeo(R * 0.12, R * 0.02, Math.PI * 2, 16), rig.mat('#f5c542', { finish: 'metal' }), rig.headCenter, [side * R * 1.05, -R * 0.38, 0], 1, [0, Math.PI / 2, 0]);
  // pelo rubio con coleta alta que rebota
  hairCap(rig, HAIR, { tilt: 0.6, theta: 1.8, scale: 1.07 });
  bangs(rig, HAIR, 5, { from: -0.8, to: 0.35, pitch: 0.5, size: 0.28, sweep: 0.8 });
  const tie = k.mesh(k.torusGeo(R * 0.2, R * 0.08, Math.PI * 2, 18), rig.mat('#ff5ca8', { finish: 'plush' }), rig.headCenter, [0, R * 0.9, -R * 0.52], 1, [Math.PI / 2 - 0.9, 0, 0]);
  tie.name = 'scrunchie';
  const hair = rig.mat(HAIR, { finish: 'vinyl' });
  rig.addChain(rig.headCenter, [0, R * 1.02, -R * 0.6], [2.25, 0], 6, 0.075, 0.066, hair, { taper: 0.5, stiffness: 18, damping: 2.4, gain: 0.04, bend: -0.42 });
  rig.alwaysPhone = true;
  rig.emoteY(R * 1.6);
  return rig;
}
