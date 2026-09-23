/**
 * Dra. Emiliana: plus-size realista (pancita suave, caderas anchas, mejillas llenas), sonrisa dulce.
 * Corsé de vinilo fucsia con anillas en D doradas, arnés shibari lavanda que sujeta el estetoscopio,
 * gargantilla con candado de corazón y llavecita, esposas de felpa rosa en el cinto, medias de rejilla,
 * botas militares de plataforma y fusta rosada. Moda y comedia, nada más.
 */
import * as THREE from 'three';
import { HumanRig } from '../HumanRig';
import { fishnetTexture } from '../textures';
import { bangs, hairCap, heartGeo } from './common';

const SKIN = '#f1c29f';
const HAIR = '#2e1d2f';
const FUCHSIA = '#ff2e93';
const LAVENDER = '#b79cf2';
const GOLD = '#f5c542';
const BLOUSE = '#fbeefe';
const SKIRT = '#3b2146';

export function buildEmiliana(): HumanRig {
  const rig = new HumanRig('emiliana', {
    height: 1.65,
    headR: 0.168,
    headScale: [1.08, 0.97, 0.98],
    skin: SKIN,
    legRatio: 0.42,
    hipX: 0.115,
    thighR: 0.1,
    shinR: 0.062,
    armR: 0.06,
    shoulderX: 0.205,
    torso: [
      [0, 0.235], [0.12, 0.232], [0.3, 0.208], [0.46, 0.205], [0.62, 0.228], [0.74, 0.228], [0.86, 0.19], [0.95, 0.11], [1, 0.062],
    ],
    pelvis: [[-0.15, 0.12], [-0.1, 0.22], [-0.03, 0.262], [0.04, 0.258], [0.1, 0.238]],
    depth: 0.8,
    belly: { y: 0.34, h: 0.17, amount: 0.06 },
    chest: { y: 0.7, h: 0.1, amount: 0.035 },
    handR: 0.046,
    neckR: 0.066,
    neckLen: 0.05,
    style: { sway: 0.8, phase: 0.3 },
  });
  const k = rig.kit;
  const skin = rig.mat(SKIN, { finish: 'skin' });

  // ── cuerpo: blusa blanca de manga abullonada bajo el corsé ──
  rig.torsoLayer(BLOUSE, { from: 0, to: 1, capTop: true });
  rig.pelvisLayer(SKIRT, { offset: 0.004 });
  // falda de vuelo corta en capas (ciruela con volante rosa)
  rig.flare(rig.hips, SKIRT, 0.1, -0.16, 0.265, 0.36, { finish: 'vinyl', midBulge: 0.018, depth: 0.86 });
  rig.flare(rig.hips, '#ff8fc7', -0.13, -0.19, 0.36, 0.39, { finish: 'cloth', depth: 0.86 });

  // ── corsé fucsia brillante (bajo el pecho, abraza la pancita) ──
  rig.torsoLayer(FUCHSIA, { finish: 'gloss', from: 0.05, to: 0.6, offset: 0.014, bulge: 1.05, chest: 0.6 });
  for (const f of [0.05, 0.6]) {
    const p = rig.torsoPt(0, f, 0.015);
    const r = p.z / rig.spec.depth;
    k.mesh(k.torusGeo(r, 0.011, Math.PI * 2, 40), rig.mat('#c4166f', { finish: 'gloss' }), rig.torso, [0, p.y, 0], [1, rig.spec.depth, 1], [Math.PI / 2, 0, 0]);
  }
  // cordones y anillas en D doradas en el frente
  const belly = rig.spec.belly!;
  const frontZ = (f: number) => {
    const p = rig.torsoPt(0, f, 0.016);
    const dy = (f - belly.y) / belly.h;
    return p.z + belly.amount * Math.exp(-dy * dy * 2) * 1.05;
  };
  for (let i = 0; i < 5; i++) {
    const f = 0.1 + i * 0.105;
    const z = frontZ(f);
    k.mesh(k.boxGeo(0.07, 0.006, 0.006), rig.mat('#3b2146', { finish: 'gloss' }), rig.torso, [0, f * rig.torsoLen, z], 1, [0, 0, i % 2 ? 0.5 : -0.5]);
    k.mesh(k.boxGeo(0.07, 0.006, 0.006), rig.mat('#3b2146', { finish: 'gloss' }), rig.torso, [0, f * rig.torsoLen, z], 1, [0, 0, i % 2 ? -0.5 : 0.5]);
  }
  const dring = k.geo('dring', () => new THREE.TorusGeometry(0.018, 0.0045, 8, 20, Math.PI * 1.2));
  for (const side of [1, -1]) {
    for (const f of [0.18, 0.44]) {
      const th = side * 0.55;
      const p = rig.torsoPt(th, f, 0.02);
      const dz = (f - belly.y) / belly.h;
      p.z += belly.amount * 0.7 * Math.exp(-dz * dz * 2);
      const ring = k.mesh(dring, rig.mat(GOLD, { finish: 'metal' }), rig.torso, [p.x, p.y, p.z], 1, [0, th, Math.PI * 0.9]);
      ring.name = 'dring';
      k.mesh(k.boxGeo(0.03, 0.012, 0.006), rig.mat('#c4166f', { finish: 'gloss' }), rig.torso, [p.x, p.y + 0.012, p.z - 0.003], 1, [0, th, 0]);
    }
  }

  // ── cinturón con hebilla de corazón y esposas de felpa rosa ──
  rig.torsoLayer('#2a1a2e', { finish: 'gloss', from: 0.0, to: 0.06, offset: 0.02, bulge: 0.2 });
  const buckle = k.mesh(heartGeo(rig, 0.022, 0.006), rig.mat(GOLD, { finish: 'metal' }), rig.torso, [0, 0.03 * rig.torsoLen, rig.torsoPt(0, 0.03, 0.03).z]);
  buckle.name = 'buckle';
  const cuffs = new THREE.Group();
  cuffs.name = 'handcuffs';
  const hp = rig.torsoPt(-1.25, 0.02, 0.03);
  cuffs.position.set(hp.x, hp.y - 0.03, hp.z);
  cuffs.rotation.y = -1.2;
  rig.torso.add(cuffs);
  const plush = rig.mat('#ffa6d2', { finish: 'plush' });
  k.mesh(k.torusGeo(0.032, 0.014, Math.PI * 2, 18), plush, cuffs, [0, -0.02, 0]);
  k.mesh(k.torusGeo(0.032, 0.014, Math.PI * 2, 18), plush, cuffs, [0.025, -0.085, 0.012], 1, [0.3, 0.5, 0.3]);
  k.mesh(k.cylGeo(0.004, 0.004, 0.04, 6), rig.mat('#e6e6f0', { finish: 'metal' }), cuffs, [0.012, -0.05, 0.005], 1, [0, 0, 0.35]);

  // ── arnés shibari lavanda sobre la blusa ──
  const strap = (pts: Array<[number, number]>, lift = 0.012) =>
    k.tube(LAVENDER, rig.torso, pts.map(([th, f]) => rig.torsoPt(th, f, lift)), 0.0085, { finish: 'vinyl' });
  strap([[1.0, 0.95], [0.5, 0.85], [0.0, 0.78]]);
  strap([[-1.0, 0.95], [-0.5, 0.85], [0.0, 0.78]]);
  strap([[0.0, 0.78], [0.5, 0.7], [0.0, 0.61]]);
  strap([[0.0, 0.78], [-0.5, 0.7], [0.0, 0.61]]);
  strap([[-2.2, 0.7], [-1.4, 0.7], [-0.5, 0.7]]);
  strap([[0.5, 0.7], [1.4, 0.7], [2.2, 0.7]]);
  for (const [th, f] of [[0, 0.78], [0.5, 0.7], [-0.5, 0.7], [0, 0.61]] as const) {
    const p = rig.torsoPt(th, f, 0.016);
    k.ball(LAVENDER, rig.torso, [p.x, p.y, p.z], 0.015, { finish: 'vinyl' });
  }
  // estetoscopio colgado del cuello y sujeto por el arnés
  const steth = [
    rig.torsoPt(0.7, 0.99, 0.02), rig.torsoPt(1.4, 0.97, 0.02), rig.torsoPt(2.4, 0.98, 0.02),
    rig.torsoPt(3.1, 0.99, 0.02), rig.torsoPt(-2.4, 0.98, 0.02), rig.torsoPt(-1.4, 0.97, 0.02),
    rig.torsoPt(-0.7, 0.99, 0.02), rig.torsoPt(-0.35, 0.86, 0.022), rig.torsoPt(-0.2, 0.72, 0.024),
  ];
  k.tube('#8e7cc3', rig.torso, steth, 0.0065, { finish: 'vinyl' });
  k.tube('#8e7cc3', rig.torso, [rig.torsoPt(0.7, 0.99, 0.02), rig.torsoPt(0.42, 0.86, 0.022), rig.torsoPt(0.3, 0.76, 0.024)], 0.0065, { finish: 'vinyl' });
  const cp = rig.torsoPt(-0.2, 0.69, 0.03);
  const chest = new THREE.Group();
  chest.position.copy(cp);
  chest.rotation.set(-0.15, -0.2, 0);
  rig.torso.add(chest);
  k.mesh(k.cylGeo(0.026, 0.026, 0.012, 20), rig.mat('#e3e6ef', { finish: 'metal' }), chest, [0, 0, 0], 1, [Math.PI / 2, 0, 0]);
  k.mesh(k.torusGeo(0.026, 0.005, Math.PI * 2, 20), rig.mat('#ff8fc7', { finish: 'gloss' }), chest, [0, 0, 0.004]);
  const ep = rig.torsoPt(0.3, 0.75, 0.026);
  k.ball('#e3e6ef', rig.torso, [ep.x, ep.y, ep.z], 0.01, { finish: 'metal' });

  // ── mangas abullonadas y brazos ──
  rig.buildArms(skin, skin, skin);
  for (const sh of [rig.shoulderL, rig.shoulderR]) {
    k.ball(BLOUSE, sh, [0, -0.04, 0], [0.08, 0.075, 0.075], { finish: 'cloth' });
    k.mesh(k.torusGeo(0.058, 0.01, Math.PI * 2, 18), rig.mat('#ff8fc7', { finish: 'cloth' }), sh, [0, -0.1, 0], 1, [Math.PI / 2, 0, 0]);
  }

  // ── piernas con medias de rejilla y botas de plataforma ──
  const net = k.own(fishnetTexture(SKIN, '#2a1430', [8, 4]));
  const netMat = rig.mat('#ffffff', { finish: 'skin', map: net });
  rig.buildLegs(netMat, netMat);
  rig.buildShoes('#2a1a2e', { finish: 'gloss', sole: '#1c1220', soleH: 0.06, bootH: 0.22, bootR: 0.074, len: 0.22, width: 0.1, laces: '#ff8fc7', toe: '#3a2a3e' });

  // ── cuello: gargantilla de cuero con candado de corazón y llavecita ──
  rig.buildHead();
  const collar = new THREE.Group();
  collar.name = 'collar';
  collar.position.y = rig.spec.neckLen * 0.25;
  rig.head.add(collar);
  k.mesh(k.torusGeo(rig.spec.neckR * 1.1, 0.014, Math.PI * 2, 28), rig.mat('#2a1a2e', { finish: 'gloss' }), collar, [0, 0, 0], 1, [Math.PI / 2, 0, 0]);
  k.mesh(k.torusGeo(0.008, 0.0028, Math.PI * 2, 12), rig.mat(GOLD, { finish: 'metal' }), collar, [0, -0.012, rig.spec.neckR * 1.12], 1);
  const lock = k.mesh(heartGeo(rig, 0.02, 0.008), rig.mat(GOLD, { finish: 'metal' }), collar, [0, -0.032, rig.spec.neckR * 1.14], 1, [0, 0, Math.PI]);
  lock.rotation.z = 0;
  lock.name = 'padlock';
  const key = new THREE.Group();
  key.position.set(0.02, -0.03, rig.spec.neckR * 1.12);
  key.rotation.z = 0.35;
  collar.add(key);
  k.mesh(k.torusGeo(0.005, 0.0016, Math.PI * 2, 10), rig.mat(GOLD, { finish: 'metal' }), key, [0, 0, 0]);
  k.mesh(k.cylGeo(0.0016, 0.0016, 0.018, 6), rig.mat(GOLD, { finish: 'metal' }), key, [0, -0.013, 0]);
  k.mesh(k.boxGeo(0.006, 0.003, 0.002), rig.mat(GOLD, { finish: 'metal' }), key, [0.003, -0.02, 0]);

  // ── cara dulce ──
  rig.buildFace({
    pupil: '#3a2030',
    eyeSize: 1.08,
    eyeSpacing: 0.37,
    eyeY: -0.1,
    lashes: '#2e1d2f',
    shadow: '#d6a3ff',
    brow: { color: HAIR, tilt: -0.12, y: 0.3, thick: 0.03, len: 0.18 },
    lips: '#e0457b',
    blush: '#ff6fa8',
    blushBase: 0.38,
    cheeks: 0.9,
    nose: '#e8ab86',
  });
  // pendientes de corazón
  for (const side of [1, -1]) {
    const e = k.mesh(heartGeo(rig, 0.01, 0.004), rig.mat(FUCHSIA, { finish: 'gloss' }), rig.headCenter, [side * rig.headR * 1.1, -rig.headR * 0.32, -rig.headR * 0.02], 1, [0, side * 1.3, Math.PI]);
    e.name = 'earring';
  }

  // ── pelo oscuro en moño suave ──
  const R = rig.headR;
  hairCap(rig, HAIR, { tilt: 0.55, theta: 1.8, scale: 1.08 });
  k.ball(HAIR, rig.headCenter, [0, -R * 0.1, -R * 0.35], [R * 1.02, R * 0.92, R * 0.78]);
  bangs(rig, HAIR, 5, { from: -0.75, to: 0.55, pitch: 0.46, size: 0.3, sweep: 0.55 });
  // mechones sueltos junto a las mejillas
  for (const side of [1, -1]) {
    const lock = k.mesh(k.capsuleGeo(R * 0.1, R * 0.45, 10), rig.mat(HAIR, { finish: 'vinyl' }), rig.headCenter, [side * R * 1.02, -R * 0.12, -R * 0.12], 1, [0.15, 0, side * 0.1]);
    lock.name = 'lock';
  }
  // moño + coletero rosa
  k.ball(HAIR, rig.headCenter, [0, R * 0.95, -R * 0.42], [R * 0.5, R * 0.46, R * 0.48]);
  k.mesh(k.torusGeo(R * 0.36, R * 0.07, Math.PI * 2, 20), rig.mat('#ff8fc7', { finish: 'plush' }), rig.headCenter, [0, R * 0.7, -R * 0.36], 1, [Math.PI / 2 + 0.55, 0, 0]);
  rig.emoteY(R * 1.75);

  // ── fusta rosada: en la mano al mandar, enfundada en el cinto al operar ──
  const crop = new THREE.Group();
  crop.name = 'crop';
  k.mesh(k.cylGeo(0.013, 0.013, 0.11, 12), rig.mat('#2a1a2e', { finish: 'gloss' }), crop, [0, 0.02, 0]);
  for (let i = 0; i < 4; i++) k.mesh(k.torusGeo(0.0135, 0.003, Math.PI * 2, 12), rig.mat('#ff8fc7', { finish: 'gloss' }), crop, [0, -0.02 + i * 0.025, 0], 1, [Math.PI / 2, 0, 0]);
  k.mesh(k.sphereGeo(12), rig.mat(GOLD, { finish: 'metal' }), crop, [0, 0.08, 0], 0.016);
  k.mesh(k.cylGeo(0.005, 0.0035, 0.5, 8), rig.mat('#ff5ca8', { finish: 'gloss' }), crop, [0, -0.28, 0]);
  const flap = k.mesh(heartGeo(rig, 0.028, 0.006), rig.mat(FUCHSIA, { finish: 'gloss' }), crop, [0, -0.55, 0], 1, [0, 0, Math.PI]);
  flap.name = 'cropFlap';
  const inHand = () => {
    rig.handR.add(crop);
    crop.position.set(0, -0.04, 0.01);
    crop.rotation.set(-0.7, 0, -0.55);
  };
  const holster = () => {
    rig.hips.add(crop);
    crop.position.set(rig.spec.hipX + 0.15, 0.02, 0.05);
    crop.rotation.set(0.25, 0, 0.12);
  };
  inHand();
  rig.onAnimChange = (a) => {
    if (a === 'work' || a === 'compress' || a === 'suction' || a === 'offer' || a === 'selfie' || a === 'crack' || a === 'sit') holster();
    else inHand();
  };
  return rig;
}
