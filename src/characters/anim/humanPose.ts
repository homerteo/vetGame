/**
 * Poses procedurales de humanos (lógica pura, sin Three.js).
 * Cada animación escribe ángulos de articulación en un objeto reutilizable (sin asignaciones por fotograma).
 * Convenciones (el personaje mira a +Z):
 *  - swing > 0 lleva el brazo hacia delante/arriba; spread > 0 lo abre hacia fuera; elbow > 0 dobla el antebrazo hacia delante.
 *  - hip > 0 adelanta el muslo; knee > 0 dobla la espinilla hacia atrás.
 *  - lean > 0 inclina el torso hacia delante; fall 0..1 = desmayo hacia atrás; sit 0..1 = sentado.
 */
import type { CharacterAnim } from '../../core/contracts';
import { clamp, smoothstep } from '../../core/math';

export interface ArmPose {
  swing: number;
  spread: number;
  twist: number;
  elbow: number;
}

export interface LegPose {
  hip: number;
  knee: number;
  splay: number;
}

/** Expresiones faciales simples. */
export const MOUTH = { smile: 0, open: 1, flat: 2, wavy: 3, grin: 4 } as const;
export const EYES = { open: 0, closed: 1, happy: 2, wide: 3 } as const;

export interface HumanPose {
  bob: number; // desplazamiento vertical de la cadera (m)
  sway: number; // desplazamiento lateral de cadera (m)
  lean: number;
  twist: number;
  roll: number;
  hipYaw: number;
  headPitch: number;
  headYaw: number;
  headRoll: number;
  armL: ArmPose;
  armR: ArmPose;
  legL: LegPose;
  legR: LegPose;
  fall: number;
  sit: number;
  shake: number; // amplitud de temblor de alta frecuencia (0..1)
  mouth: number;
  eyes: number;
  /** Visibilidad de accesorios 0/1. */
  phone: number;
  tray: number;
  cannula: number;
}

/** Estilo de movimiento por personaje. */
export interface MotionStyle {
  jitter: number; // Fritz: nervios constantes 0..1
  heavy: number; // Rodrigo: pasos pesados 0..1
  bounce: number; // Gigi: rebote 0..1
  stiff: number; // Valerio: rigidez 0..1
  sway: number; // balanceo de caderas 0..1
  phase: number; // desfase para que no se sincronicen
}

export const DEFAULT_STYLE: MotionStyle = { jitter: 0, heavy: 0, bounce: 0, stiff: 0, sway: 0.3, phase: 0 };

const arm = (): ArmPose => ({ swing: 0, spread: 0, twist: 0, elbow: 0 });
const leg = (): LegPose => ({ hip: 0, knee: 0, splay: 0 });

export function createHumanPose(): HumanPose {
  return {
    bob: 0, sway: 0, lean: 0, twist: 0, roll: 0, hipYaw: 0,
    headPitch: 0, headYaw: 0, headRoll: 0,
    armL: arm(), armR: arm(), legL: leg(), legR: leg(),
    fall: 0, sit: 0, shake: 0, mouth: MOUTH.smile, eyes: EYES.open,
    phone: 0, tray: 0, cannula: 0,
  };
}

function setArm(a: ArmPose, swing: number, spread: number, elbow: number, twist = 0) {
  a.swing = swing;
  a.spread = spread;
  a.elbow = elbow;
  a.twist = twist;
}

function setLeg(l: LegPose, hip: number, knee: number, splay = 0) {
  l.hip = hip;
  l.knee = knee;
  l.splay = splay;
}

function reset(o: HumanPose) {
  o.bob = 0; o.sway = 0; o.lean = 0; o.twist = 0; o.roll = 0; o.hipYaw = 0;
  o.headPitch = 0; o.headYaw = 0; o.headRoll = 0;
  setArm(o.armL, 0, 0.1, 0.15);
  setArm(o.armR, 0, 0.1, 0.15);
  setLeg(o.legL, 0, 0);
  setLeg(o.legR, 0, 0);
  o.fall = 0; o.sit = 0; o.shake = 0;
  o.mouth = MOUTH.smile; o.eyes = EYES.open;
  o.phone = 0; o.tray = 0; o.cannula = 0;
}

const TAU = Math.PI * 2;

/**
 * Calcula la pose objetivo de una animación.
 * @param t tiempo global (s) para ciclos
 * @param a tiempo desde que empezó la animación (s) para transiciones de una sola vez (desmayo)
 */
export function computeHumanPose(anim: CharacterAnim, t: number, a: number, st: MotionStyle, o: HumanPose): HumanPose {
  reset(o);
  const tt = t + st.phase;
  const breath = Math.sin(tt * TAU * 0.25);
  o.bob = breath * 0.006;
  o.headPitch = breath * 0.02;
  switch (anim) {
    case 'idle': {
      o.sway = Math.sin(tt * TAU * 0.18) * 0.012 * (0.5 + st.sway);
      o.roll = Math.sin(tt * TAU * 0.18) * 0.02 * st.sway;
      o.headYaw = Math.sin(tt * TAU * 0.11) * 0.18 * (1 - st.stiff * 0.6);
      o.headRoll = Math.sin(tt * TAU * 0.07) * 0.05;
      setArm(o.armL, 0.05 + breath * 0.02, 0.2, 0.2);
      setArm(o.armR, 0.05 - breath * 0.02, 0.2, 0.2);
      if (st.stiff > 0.5) {
        // brazos a la espalda: rígido y solemne
        setArm(o.armL, -0.35, 0.15, 0.6);
        setArm(o.armR, -0.35, 0.15, 0.6);
      }
      break;
    }
    case 'walk':
    case 'run': {
      const run = anim === 'run';
      const freq = run ? 1.45 : 0.95 - st.heavy * 0.12;
      const ph = tt * TAU * freq;
      const s = Math.sin(ph);
      const c = Math.cos(ph);
      const stride = (run ? 0.8 : 0.42) * (1 - st.stiff * 0.25);
      setLeg(o.legL, s * stride, Math.max(0, -c) * (run ? 1.3 : 0.6) + 0.05);
      setLeg(o.legR, -s * stride, Math.max(0, c) * (run ? 1.3 : 0.6) + 0.05);
      const armAmp = (run ? 0.9 : 0.45) * (1 - st.stiff * 0.7);
      setArm(o.armL, -s * armAmp, 0.1, run ? 1.4 : 0.25);
      setArm(o.armR, s * armAmp, 0.1, run ? 1.4 : 0.25);
      o.bob = Math.abs(Math.cos(ph)) * (run ? 0.05 : 0.025) * (1 + st.bounce) - (run ? 0.03 : 0.01) * (1 + st.heavy);
      o.sway = Math.sin(ph) * 0.015 * (1 + st.heavy + st.sway);
      o.roll = Math.sin(ph) * 0.04 * (1 + st.heavy * 1.5 + st.sway);
      o.twist = -s * 0.08;
      o.lean = run ? 0.22 : 0.04;
      o.headRoll = -o.roll * 0.6;
      if (run) o.mouth = MOUTH.open;
      break;
    }
    case 'work': {
      const w = Math.sin(tt * TAU * 0.6);
      o.lean = 0.22;
      o.headPitch = 0.38 + Math.sin(tt * TAU * 0.13) * 0.04;
      o.headYaw = Math.sin(tt * TAU * 0.09) * 0.1;
      setArm(o.armL, 0.85 + w * 0.05, -0.08, 0.95 - w * 0.08);
      setArm(o.armR, 0.9 - w * 0.06, -0.1, 0.85 + Math.sin(tt * TAU * 1.1) * 0.12);
      setLeg(o.legL, 0.03, 0.06, 0.05);
      setLeg(o.legR, 0.03, 0.06, 0.05);
      o.mouth = MOUTH.flat;
      break;
    }
    case 'panic': {
      const f = Math.sin(tt * TAU * 4.2);
      const g = Math.sin(tt * TAU * 3.7 + 1);
      setArm(o.armL, 2.5 + f * 0.35, 0.55 + g * 0.2, 0.4 + f * 0.3);
      setArm(o.armR, 2.5 - f * 0.35, 0.55 - g * 0.2, 0.4 - f * 0.3);
      o.headYaw = Math.sin(tt * TAU * 3.1) * 0.35;
      o.bob = Math.abs(Math.sin(tt * TAU * 3)) * 0.04;
      setLeg(o.legL, Math.max(0, Math.sin(tt * TAU * 3)) * 0.5, Math.max(0, Math.sin(tt * TAU * 3)) * 0.8);
      setLeg(o.legR, Math.max(0, -Math.sin(tt * TAU * 3)) * 0.5, Math.max(0, -Math.sin(tt * TAU * 3)) * 0.8);
      o.shake = 0.3;
      o.mouth = MOUTH.open;
      o.eyes = EYES.wide;
      break;
    }
    case 'guitar': {
      // bajo de aire con la cánula de aspiración
      const bang = Math.sin(tt * TAU * 2);
      const strum = Math.sin(tt * TAU * 4);
      o.lean = -0.14;
      o.roll = 0.08 + bang * 0.03;
      o.twist = 0.18;
      o.headPitch = 0.1 + bang * 0.32;
      o.headRoll = 0.1;
      setArm(o.armL, 1.05, 0.65, 0.5 + bang * 0.05, 0);
      setArm(o.armR, 0.55 + strum * 0.22, -0.35, 1.45);
      setLeg(o.legL, 0.18, 0.25 + Math.max(0, bang) * 0.12, 0.25);
      setLeg(o.legR, -0.08, 0.2 + Math.max(0, bang) * 0.12, 0.25);
      o.bob = -0.035 - Math.max(0, bang) * 0.02;
      o.mouth = MOUTH.open;
      o.eyes = bang > 0.3 ? EYES.closed : EYES.happy;
      o.cannula = 1;
      break;
    }
    case 'selfie': {
      const pop = Math.sin(tt * TAU * 0.5);
      setArm(o.armR, 2.1, 0.35, 0.35, 0.3);
      setArm(o.armL, -0.25, 0.75, 1.5);
      o.headRoll = 0.24 + pop * 0.04;
      o.headPitch = -0.18;
      o.headYaw = -0.25;
      o.roll = -0.06 + pop * 0.02;
      o.sway = 0.03;
      setLeg(o.legL, 0.12, 0.3, 0.1);
      setLeg(o.legR, -0.04, 0.02, 0.08);
      o.mouth = MOUTH.grin;
      o.eyes = pop > 0.6 ? EYES.happy : EYES.open;
      o.phone = 1;
      break;
    }
    case 'tremble': {
      o.shake = 1;
      setArm(o.armL, 0.7, -0.25, 1.7);
      setArm(o.armR, 0.7, -0.25, 1.7);
      setLeg(o.legL, 0.12, 0.25, -0.08);
      setLeg(o.legR, 0.12, 0.25, -0.08);
      o.lean = 0.12;
      o.headPitch = 0.2;
      o.bob = -0.03;
      o.mouth = MOUTH.wavy;
      o.eyes = EYES.wide;
      break;
    }
    case 'point': {
      // señalar con la fusta: pequeño tirón al principio
      const snap = a < 0.18 ? -0.6 * (1 - a / 0.18) : Math.exp(-(a - 0.18) * 6) * 0.25;
      setArm(o.armR, 1.45 + snap, 0.12, 0.08);
      setArm(o.armL, -0.2, 0.7, 1.6);
      o.lean = 0.08;
      o.twist = -0.12;
      o.headPitch = 0.08;
      o.headYaw = -0.05;
      setLeg(o.legR, 0.18, 0.1);
      setLeg(o.legL, -0.08, 0.05);
      o.mouth = MOUTH.flat;
      break;
    }
    case 'crack': {
      // voz quebrada: manos a la cara, hombros que tiemblan
      const sob = Math.sin(tt * TAU * 5.5);
      setArm(o.armL, 1.45, -0.25, 2.3);
      setArm(o.armR, 1.45, -0.25, 2.3);
      o.lean = 0.28;
      o.headPitch = 0.45;
      o.bob = -0.02 + sob * 0.012;
      o.roll = sob * 0.03;
      o.shake = 0.15;
      setLeg(o.legL, 0.06, 0.15, -0.05);
      setLeg(o.legR, 0.06, 0.15, -0.05);
      o.mouth = MOUTH.wavy;
      o.eyes = EYES.closed;
      break;
    }
    case 'cheer': {
      const j = Math.abs(Math.sin(tt * TAU * 1.4));
      const w = Math.sin(tt * TAU * 2.8);
      setArm(o.armL, 2.75 + w * 0.12, 0.45, 0.2);
      setArm(o.armR, 2.75 - w * 0.12, 0.45, 0.2);
      o.bob = j * 0.09 * (1 + st.bounce * 0.5);
      setLeg(o.legL, j * 0.3, j * 0.6);
      setLeg(o.legR, j * 0.3, j * 0.6);
      o.headPitch = -0.2;
      o.mouth = MOUTH.grin;
      o.eyes = EYES.happy;
      break;
    }
    case 'faint': {
      // tambaleo breve y caída hacia atrás (0..1)
      const wob = a < 0.45 ? Math.sin(a * 22) * 0.12 * (1 - a / 0.45) : 0;
      o.fall = smoothstep(0.35, 1.1, a);
      o.roll = wob;
      o.headRoll = 0.3 * o.fall;
      o.headPitch = -0.2 * o.fall;
      setArm(o.armL, 0.3 + o.fall * 1.2, 0.3 + o.fall * 0.9, 0.3);
      setArm(o.armR, 0.3 + o.fall * 1.2, 0.3 + o.fall * 0.9, 0.3);
      setLeg(o.legL, o.fall * 0.25, o.fall * 0.2, 0.1);
      setLeg(o.legR, o.fall * 0.1, o.fall * 0.1, 0.1);
      o.mouth = MOUTH.open;
      o.eyes = o.fall > 0.6 ? EYES.closed : EYES.wide;
      break;
    }
    case 'think': {
      const s = Math.sin(tt * TAU * 0.3);
      setArm(o.armR, 1.2, -0.1, 2.25, 0.2);
      setArm(o.armL, 0.55, -0.35, 1.55);
      o.headRoll = 0.18 + s * 0.04;
      o.headPitch = 0.05;
      o.headYaw = 0.15;
      o.sway = 0.02;
      o.roll = 0.03;
      setLeg(o.legL, 0.05, 0.05);
      setLeg(o.legR, -0.02, 0.12);
      o.mouth = MOUTH.flat;
      break;
    }
    case 'suction': {
      const c = Math.sin(tt * TAU * 0.8);
      const d = Math.cos(tt * TAU * 0.8);
      o.lean = 0.2;
      o.headPitch = 0.34;
      setArm(o.armR, 0.8 + c * 0.08, -0.05 + d * 0.06, 0.95);
      setArm(o.armL, 0.7, 0.05, 1.05);
      setLeg(o.legL, 0.04, 0.08, 0.06);
      setLeg(o.legR, 0.04, 0.08, 0.06);
      o.mouth = MOUTH.smile;
      o.cannula = 1;
      break;
    }
    case 'offer': {
      const settle = Math.exp(-a * 5);
      setArm(o.armL, 1.25 + settle * 0.4, 0.05, 0.45 + settle * 0.6);
      setArm(o.armR, 1.25 + settle * 0.4, 0.05, 0.45 + settle * 0.6);
      o.lean = 0.14;
      o.headPitch = 0.1;
      setLeg(o.legR, 0.15, 0.05);
      o.mouth = MOUTH.smile;
      o.tray = 1;
      break;
    }
    case 'compress': {
      // RCP a ~110 lpm
      const p = Math.max(0, Math.sin(tt * TAU * (110 / 60)));
      o.lean = 0.55 + p * 0.08;
      o.bob = -0.04 - p * 0.04;
      setArm(o.armL, 0.95 + p * 0.1, -0.15, 0.05);
      setArm(o.armR, 0.95 + p * 0.1, -0.15, 0.05);
      o.headPitch = 0.2;
      setLeg(o.legL, 0.12, 0.2, 0.12);
      setLeg(o.legR, 0.12, 0.2, 0.12);
      o.mouth = MOUTH.flat;
      break;
    }
    case 'sit': {
      o.sit = 1;
      setLeg(o.legL, 1.45, 1.45, 0.06);
      setLeg(o.legR, 1.45, 1.45, 0.06);
      setArm(o.armL, 0.55 + breath * 0.02, 0.05, 0.5);
      setArm(o.armR, 0.55 - breath * 0.02, 0.05, 0.5);
      o.lean = 0.05;
      o.headYaw = Math.sin(tt * TAU * 0.09) * 0.25;
      break;
    }
  }
  // nervios permanentes (Fritz)
  if (st.jitter > 0) o.shake = clamp(o.shake + st.jitter * 0.25, 0, 1);
  return o;
}

/** Suaviza la pose actual hacia la objetivo; k = 1 - exp(-dt·velocidad). */
export function blendHumanPose(cur: HumanPose, target: HumanPose, k: number): void {
  cur.bob += (target.bob - cur.bob) * k;
  cur.sway += (target.sway - cur.sway) * k;
  cur.lean += (target.lean - cur.lean) * k;
  cur.twist += (target.twist - cur.twist) * k;
  cur.roll += (target.roll - cur.roll) * k;
  cur.hipYaw += (target.hipYaw - cur.hipYaw) * k;
  cur.headPitch += (target.headPitch - cur.headPitch) * k;
  cur.headYaw += (target.headYaw - cur.headYaw) * k;
  cur.headRoll += (target.headRoll - cur.headRoll) * k;
  blendArm(cur.armL, target.armL, k);
  blendArm(cur.armR, target.armR, k);
  blendLeg(cur.legL, target.legL, k);
  blendLeg(cur.legR, target.legR, k);
  cur.fall += (target.fall - cur.fall) * k;
  cur.sit += (target.sit - cur.sit) * k;
  cur.shake += (target.shake - cur.shake) * k;
  cur.mouth = target.mouth;
  cur.eyes = target.eyes;
  cur.phone = target.phone;
  cur.tray = target.tray;
  cur.cannula = target.cannula;
}

function blendArm(c: ArmPose, t: ArmPose, k: number) {
  c.swing += (t.swing - c.swing) * k;
  c.spread += (t.spread - c.spread) * k;
  c.twist += (t.twist - c.twist) * k;
  c.elbow += (t.elbow - c.elbow) * k;
}

function blendLeg(c: LegPose, t: LegPose, k: number) {
  c.hip += (t.hip - c.hip) * k;
  c.knee += (t.knee - c.knee) * k;
  c.splay += (t.splay - c.splay) * k;
}

export const ALL_ANIMS: CharacterAnim[] = [
  'idle', 'walk', 'run', 'work', 'panic', 'guitar', 'selfie', 'tremble', 'point',
  'crack', 'cheer', 'faint', 'think', 'suction', 'offer', 'compress', 'sit',
];
