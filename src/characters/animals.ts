/** Razas: chihuahua, caniche toy, bulldog inglés, teckel, pit bull, border collie, gato atigrado y conejo enano. */
import * as THREE from 'three';
import type { AnimalModelId } from '../core/contracts';
import { AnimalRig, type AnimalSpec } from './AnimalRig';
import { tabbyTexture } from './textures';

const SPECS: Record<AnimalModelId, () => AnimalSpec> = {
  chihuahua: () => ({
    bodyLen: 0.17, bodyR: 0.06, bodyH: 1, legLen: 0.1, legR: 0.014, legX: 0.035,
    headR: 0.068, headScale: [1.05, 1, 0.95], snoutLen: 0.02, snoutR: 0.024, neckLen: 0.04, neckUp: 0.9,
    ears: 'bat', earSize: 0.07, tail: 'curl', tailLen: 0.1,
    colors: { main: '#e9b784', belly: '#fbe4c8', nose: '#3b2146', innerEar: '#ffb3c7' },
    eyeSize: 1.25, style: { speed: 1.5, wagSpeed: 1.6, hop: false, phase: 0.4 },
  }),
  poodle: () => ({
    bodyLen: 0.19, bodyR: 0.058, legLen: 0.15, legR: 0.014, legX: 0.034,
    headR: 0.058, headScale: [0.95, 1, 1.05], snoutLen: 0.045, snoutR: 0.022, neckLen: 0.07, neckUp: 1.0,
    ears: 'poodle', earSize: 0.06, tail: 'pompom', tailLen: 0.08,
    colors: { main: '#fbf7f2', nose: '#3b2146', innerEar: '#ffd1e0' },
    finish: 'plush', eyeSize: 1.1, style: { speed: 1.2, wagSpeed: 1.2, hop: false, phase: 1.1 },
  }),
  bulldog: () => ({
    bodyLen: 0.3, bodyR: 0.12, bodyH: 0.92, bodyW: 1.2, legLen: 0.12, legR: 0.03, legX: 0.085,
    headR: 0.11, headScale: [1.25, 0.95, 0.95], snoutLen: 0.02, snoutR: 0.06, neckLen: 0.03, neckUp: 0.5,
    ears: 'rose', earSize: 0.06, tail: 'stub', tailLen: 0.03,
    colors: { main: '#dca46a', second: '#b97b45', belly: '#fff6ea', nose: '#2b1d22', innerEar: '#f0a3b5' },
    eyeSize: 0.9, style: { speed: 0.9, wagSpeed: 2, hop: false, phase: 2.2 },
  }),
  dachshund: () => ({
    bodyLen: 0.4, bodyR: 0.065, legLen: 0.07, legR: 0.018, legX: 0.04,
    headR: 0.065, headScale: [0.9, 0.95, 1.05], snoutLen: 0.07, snoutR: 0.026, neckLen: 0.06, neckUp: 0.6,
    ears: 'floppy', earSize: 0.08, tail: 'thin', tailLen: 0.16,
    colors: { main: '#a4532c', belly: '#c47245', nose: '#2b1d22' },
    eyeSize: 1.05, style: { speed: 1.9, wagSpeed: 1.3, hop: false, phase: 3.3 },
  }),
  pitbull: () => ({
    bodyLen: 0.4, bodyR: 0.115, bodyH: 1, bodyW: 1.05, legLen: 0.25, legR: 0.03, legX: 0.07,
    headR: 0.1, headScale: [1.18, 1, 1], snoutLen: 0.05, snoutR: 0.05, neckLen: 0.07, neckUp: 0.55,
    ears: 'rose', earSize: 0.075, tail: 'whip', tailLen: 0.22,
    colors: { main: '#8c93a5', second: '#7a8194', belly: '#f5f2f6', nose: '#2b2630', innerEar: '#e9a0b4' },
    eyeSize: 0.9, style: { speed: 1, wagSpeed: 1.8, hop: false, phase: 4.1 },
  }),
  bordercollie: () => ({
    bodyLen: 0.42, bodyR: 0.095, legLen: 0.28, legR: 0.024, legX: 0.055,
    headR: 0.09, headScale: [1, 0.95, 1.05], snoutLen: 0.075, snoutR: 0.034, neckLen: 0.09, neckUp: 0.75,
    ears: 'tri', earSize: 0.075, tail: 'fluffy', tailLen: 0.3,
    colors: { main: '#25232c', second: '#25232c', belly: '#ffffff', nose: '#1a1820', innerEar: '#f2a8bc', paws: '#ffffff' },
    eyeSize: 0.95, style: { speed: 1, wagSpeed: 1, hop: false, phase: 5.2 },
  }),
  cat: () => ({
    bodyLen: 0.3, bodyR: 0.075, legLen: 0.16, legR: 0.018, legX: 0.04,
    headR: 0.078, headScale: [1.1, 0.95, 0.95], snoutLen: 0.012, snoutR: 0.026, neckLen: 0.05, neckUp: 0.9,
    ears: 'cat', earSize: 0.055, tail: 'curl', tailLen: 0.24,
    colors: { main: '#ec9f55', belly: '#fff0dc', nose: '#ff8fae', innerEar: '#ffb3c7' },
    eyeSize: 1.15, style: { speed: 1.1, wagSpeed: 0.5, hop: false, phase: 6.3 },
  }),
  rabbit: () => ({
    bodyLen: 0.17, bodyR: 0.075, bodyH: 1, legLen: 0.05, legR: 0.018, legX: 0.04, hindBig: true,
    headR: 0.062, headScale: [1.05, 0.98, 1], snoutLen: 0.012, snoutR: 0.024, neckLen: 0.03, neckUp: 1.0,
    ears: 'bunnyUp', earSize: 0.07, tail: 'cotton', tailLen: 0.02,
    colors: { main: '#fbf8f8', belly: '#ffffff', nose: '#ff8fae', innerEar: '#ffc2d4' },
    finish: 'plush', eyeSize: 1.2, style: { speed: 1.4, wagSpeed: 0.3, hop: true, phase: 7.4 },
  }),
};

export function buildAnimal(id: AnimalModelId, opts: { cone?: boolean; shaved?: boolean } = {}): AnimalRig {
  const spec = SPECS[id]();
  const rig = new AnimalRig(id, spec);
  if (id === 'cat') spec.map = rig.kit.own(tabbyTexture('#ec9f55', '#b8612b'));
  rig.build();
  extras(id, rig);
  if (opts.shaved) rig.addShavedPatch();
  if (opts.cone) rig.addCone();
  return rig;
}

function extras(id: AnimalModelId, rig: AnimalRig) {
  const k = rig.kit;
  const s = rig.spec;
  const hc = rig.headCenter;
  const R = s.headR;
  switch (id) {
    case 'chihuahua': {
      // frente abombada y manchita en la frente
      k.ball('#fbe4c8', hc, [0, R * 0.35, R * 0.72], [R * 0.25, R * 0.3, R * 0.12]);
      break;
    }
    case 'poodle': {
      // moño y pompones en tobillos
      const fluff = rig.mat('#ffffff', { finish: 'plush' });
      k.mesh(k.sphereGeo(16), fluff, hc, [0, R * 0.85, -R * 0.05], [R * 0.85, R * 0.7, R * 0.85]);
      k.mesh(k.torusGeo(R * 0.25, R * 0.07, Math.PI * 2, 14), rig.mat('#ff8fc7', { finish: 'gloss' }), hc, [0, R * 1.2, 0.0], 1, [Math.PI / 2, 0, 0]);
      for (const leg of rig.legs) k.mesh(k.sphereGeo(14), fluff, leg, [0, -s.legLen * 0.72, 0], s.legR * 2.2);
      k.mesh(k.sphereGeo(16), fluff, rig.body, [0, s.bodyR * 0.2, s.bodyLen * 0.3], [s.bodyR * 1.35, s.bodyR * 1.3, s.bodyR * 1.4]);
      break;
    }
    case 'bulldog': {
      // papada, arrugas, belfos y dientes de abajo; manchas
      const main = rig.mat(s.colors.main);
      for (const side of [1, -1]) k.ball('#fff6ea', hc, [side * R * 0.3, -R * 0.55, R * 0.78], [R * 0.36, R * 0.3, R * 0.25]);
      k.mesh(k.sphereGeo(14), main, hc, [0, -R * 0.75, R * 0.4], [R * 0.7, R * 0.3, R * 0.5]);
      for (let i = 0; i < 3; i++) k.mesh(k.torusGeo(R * 0.25, R * 0.025, Math.PI * 0.8, 12), rig.mat('#e3d5c4'), hc, [0, R * (0.3 + i * 0.13), R * 0.88 - i * R * 0.06], 1, [0.2, 0, Math.PI * 0.1 + Math.PI]);
      for (const side of [1, -1]) k.mesh(k.cylGeo(R * 0.03, R * 0.04, R * 0.1, 6), rig.mat('#ffffff', { finish: 'gloss' }), hc, [side * R * 0.18, -R * 0.52, R * 1.0], 1);
      k.ball('#fff6ea', hc, [0, -R * 0.1, R * 0.62], [R * 0.3, R * 0.75, R * 0.4]);
      k.ball('#fff6ea', rig.body, [0, -s.bodyR * 0.15, s.bodyLen * 0.38], [s.bodyR * 0.75, s.bodyR * 0.8, s.bodyR * 0.45]);
      break;
    }
    case 'dachshund': {
      k.ball('#8a4424', rig.body, [0, s.bodyR * 0.55, 0], [s.bodyR * 0.75, s.bodyR * 0.5, s.bodyLen * 0.4]);
      break;
    }
    case 'pitbull': {
      // hombros musculosos, pecho blanco, mejillas anchas
      const main = rig.mat(s.colors.main);
      for (const side of [1, -1]) {
        k.mesh(k.sphereGeo(16), main, rig.body, [side * s.bodyR * 0.7, s.bodyR * 0.2, s.bodyLen * 0.28], [s.bodyR * 0.55, s.bodyR * 0.75, s.bodyR * 0.7]);
        k.ball(s.colors.main, hc, [side * R * 0.55, -R * 0.2, R * 0.3], [R * 0.45, R * 0.45, R * 0.5]);
      }
      k.ball('#f5f2f6', rig.body, [0, -s.bodyR * 0.1, s.bodyLen * 0.45], [s.bodyR * 0.55, s.bodyR * 0.75, s.bodyR * 0.35]);
      // collar con placa de corazón
      k.mesh(k.torusGeo(R * 0.62, R * 0.07, Math.PI * 2, 20), rig.mat('#ff2e93', { finish: 'gloss' }), rig.neck, [0, s.neckLen * 0.3, s.neckLen * 0.3], 1, [Math.PI / 2 - 0.4, 0, 0]);
      break;
    }
    case 'bordercollie': {
      // lista blanca, pecho, cuello y punta de la cola blancos
      const w = '#ffffff';
      k.ball(w, hc, [0, R * 0.35, R * 0.75], [R * 0.18, R * 0.6, R * 0.2]);
      k.ball(w, hc, [0, -R * 0.25, R * 0.72], [R * 0.45, R * 0.35, R * 0.35]);
      k.mesh(k.torusGeo(R * 0.6, R * 0.25, Math.PI * 2, 18), rig.mat(w, { finish: 'plush' }), rig.neck, [0, s.neckLen * 0.45, s.neckLen * 0.35], 1, [Math.PI / 2 - 0.7, 0, 0]);
      k.ball(w, rig.body, [0, -s.bodyR * 0.2, s.bodyLen * 0.45], [s.bodyR * 0.6, s.bodyR * 0.75, s.bodyR * 0.35], { finish: 'plush' });
      break;
    }
    case 'cat': {
      // bigotes y hocico claro
      const wh = rig.mat('#ffffff', { finish: 'gloss' });
      for (const side of [1, -1]) {
        for (let i = 0; i < 3; i++) {
          const a = new THREE.Vector3(side * R * 0.25, -R * 0.25, R * 0.85);
          const b = new THREE.Vector3(side * R * 1.15, -R * (0.12 + i * 0.12), R * 0.75);
          k.limb('#ffffff', hc, a, b, R * 0.012, { finish: 'gloss' });
        }
      }
      k.ball('#fff0dc', hc, [0, -R * 0.35, R * 0.7], [R * 0.45, R * 0.3, R * 0.3]);
      void wh;
      break;
    }
    case 'rabbit': {
      // mofletes y bigotitos
      for (const side of [1, -1]) {
        k.ball('#ffffff', hc, [side * R * 0.3, -R * 0.35, R * 0.7], [R * 0.3, R * 0.25, R * 0.25], { finish: 'plush' });
        k.limb('#e8e0e4', hc, new THREE.Vector3(side * R * 0.3, -R * 0.3, R * 0.9), new THREE.Vector3(side * R * 1.0, -R * 0.2, R * 0.8), R * 0.01);
      }
      break;
    }
  }
}
