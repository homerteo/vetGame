/**
 * Poses procedurales de animales cuadrúpedos (lógica pura).
 * Patas en orden: 0 delantera izq., 1 delantera der., 2 trasera izq., 3 trasera der.
 * swing > 0 adelanta la pata. El animal mira a +Z.
 */
import type { CharacterAnim } from '../../core/contracts';
import { smoothstep } from '../../core/math';

export interface AnimalPose {
  bob: number;
  pitch: number; // cabeceo del cuerpo (+ = morro abajo)
  roll: number; // alabeo (tumbado de lado en desmayo)
  headPitch: number;
  headYaw: number;
  headTilt: number;
  tailWag: number; // ángulo lateral de la cola
  tailUp: number; // 0 caída .. 1 levantada
  legs: [number, number, number, number];
  earFlap: number;
  sit: number; // 0..1
  lie: number; // 0..1 (desmayo)
  shake: number;
  mouthOpen: number; // 0..1 (jadeo/ladrido)
  eyesClosed: number; // 0..1
}

export interface AnimalStyle {
  speed: number; // multiplicador de frecuencia de pasos (patas cortas = más rápido)
  wagSpeed: number;
  hop: boolean; // conejo: salta en lugar de andar
  phase: number;
}

export function createAnimalPose(): AnimalPose {
  return {
    bob: 0, pitch: 0, roll: 0, headPitch: 0, headYaw: 0, headTilt: 0,
    tailWag: 0, tailUp: 0.6, legs: [0, 0, 0, 0], earFlap: 0, sit: 0, lie: 0,
    shake: 0, mouthOpen: 0, eyesClosed: 0,
  };
}

const TAU = Math.PI * 2;

export function computeAnimalPose(anim: CharacterAnim, t: number, a: number, st: AnimalStyle, o: AnimalPose): AnimalPose {
  const tt = t + st.phase;
  const breath = Math.sin(tt * TAU * 0.5);
  o.bob = breath * 0.003;
  o.pitch = 0;
  o.roll = 0;
  o.headPitch = 0;
  o.headYaw = Math.sin(tt * TAU * 0.13) * 0.3;
  o.headTilt = 0;
  o.tailWag = Math.sin(tt * TAU * 1.2 * st.wagSpeed) * 0.35;
  o.tailUp = 0.6;
  o.legs[0] = o.legs[1] = o.legs[2] = o.legs[3] = 0;
  o.earFlap = 0;
  o.sit = 0;
  o.lie = 0;
  o.shake = 0;
  o.mouthOpen = 0.15 + breath * 0.1;
  o.eyesClosed = (tt % 3.7) < 0.12 ? 1 : 0; // parpadeo
  switch (anim) {
    case 'walk':
    case 'run':
    case 'panic': {
      const fast = anim !== 'walk';
      const freq = (fast ? 3.2 : 1.8) * st.speed * (anim === 'panic' ? 1.2 : 1);
      const ph = tt * TAU * freq;
      if (st.hop) {
        const h = Math.max(0, Math.sin(ph));
        o.bob = h * (fast ? 0.08 : 0.04);
        o.pitch = -Math.cos(ph) * 0.15;
        o.legs[0] = o.legs[1] = Math.cos(ph) * 0.5;
        o.legs[2] = o.legs[3] = -Math.cos(ph) * 0.6;
      } else {
        const s = Math.sin(ph);
        const amp = fast ? 0.75 : 0.45;
        // trote: diagonales en fase
        o.legs[0] = s * amp;
        o.legs[3] = s * amp;
        o.legs[1] = -s * amp;
        o.legs[2] = -s * amp;
        o.bob = Math.abs(Math.cos(ph)) * (fast ? 0.025 : 0.012);
        o.pitch = Math.sin(ph * 2) * 0.03;
      }
      o.headYaw = 0;
      o.headPitch = -0.1;
      o.earFlap = Math.sin(ph * 1.3) * (fast ? 0.5 : 0.2);
      o.tailWag = Math.sin(tt * TAU * (fast ? 4 : 2.5) * st.wagSpeed) * 0.5;
      o.tailUp = 0.85;
      o.mouthOpen = fast ? 0.8 : 0.4;
      if (anim === 'panic') o.shake = 0.2;
      break;
    }
    case 'tremble':
    case 'crack': {
      o.shake = anim === 'tremble' ? 1 : 0.4;
      o.tailUp = 0.1;
      o.tailWag = 0;
      o.headPitch = 0.2;
      o.earFlap = -0.4;
      o.mouthOpen = 0;
      break;
    }
    case 'cheer':
    case 'guitar': {
      const j = Math.abs(Math.sin(tt * TAU * (anim === 'cheer' ? 1.6 : 2)));
      o.bob = anim === 'cheer' ? j * 0.07 : j * 0.015;
      o.headPitch = anim === 'guitar' ? Math.sin(tt * TAU * 2) * 0.25 : -0.2;
      o.tailWag = Math.sin(tt * TAU * 5 * st.wagSpeed) * 0.6;
      o.tailUp = 1;
      o.legs[0] = o.legs[1] = j * 0.4;
      o.mouthOpen = 0.9;
      o.earFlap = j * 0.4;
      break;
    }
    case 'faint': {
      o.lie = smoothstep(0.2, 0.9, a);
      o.roll = o.lie * 1.35;
      o.tailWag = 0;
      o.tailUp = 0.3;
      o.eyesClosed = o.lie > 0.5 ? 1 : 0;
      o.mouthOpen = 0.3;
      o.legs[0] = o.legs[1] = o.lie * 0.4;
      o.legs[2] = o.legs[3] = -o.lie * 0.4;
      break;
    }
    case 'think':
    case 'selfie': {
      o.headTilt = 0.35 + Math.sin(tt * TAU * 0.4) * 0.05;
      o.headYaw = 0.2;
      o.sit = anim === 'selfie' ? 1 : 0;
      o.mouthOpen = 0.1;
      break;
    }
    case 'sit': {
      o.sit = 1;
      o.headPitch = -0.1;
      break;
    }
    case 'point':
    case 'offer': {
      // pata delantera levantada ("dame la patita")
      o.sit = 1;
      o.legs[1] = 1.1 + Math.sin(tt * TAU * 1.5) * 0.15;
      o.headTilt = 0.2;
      o.mouthOpen = 0.6;
      break;
    }
    default:
      // idle / work / suction / compress: reposo con jadeo tierno
      break;
  }
  return o;
}

export function blendAnimalPose(c: AnimalPose, t: AnimalPose, k: number): void {
  c.bob += (t.bob - c.bob) * k;
  c.pitch += (t.pitch - c.pitch) * k;
  c.roll += (t.roll - c.roll) * k;
  c.headPitch += (t.headPitch - c.headPitch) * k;
  c.headYaw += (t.headYaw - c.headYaw) * k;
  c.headTilt += (t.headTilt - c.headTilt) * k;
  c.tailWag += (t.tailWag - c.tailWag) * k;
  c.tailUp += (t.tailUp - c.tailUp) * k;
  for (let i = 0; i < 4; i++) c.legs[i] += (t.legs[i] - c.legs[i]) * k;
  c.earFlap += (t.earFlap - c.earFlap) * k;
  c.sit += (t.sit - c.sit) * k;
  c.lie += (t.lie - c.lie) * k;
  c.shake += (t.shake - c.shake) * k;
  c.mouthOpen += (t.mouthOpen - c.mouthOpen) * k;
  c.eyesClosed = t.eyesClosed;
}
