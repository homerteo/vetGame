/**
 * Rig humano sin esqueleto: jerarquía de grupos (pivot → cadera → torso → cabeza/brazos, piernas)
 * animada con poses procedurales. Incluye constructor de cuerpo (perfiles de revolución), cara
 * expresiva, rubor, emotes, accesorios (móvil, bandeja, cánula) y cadenas con movimiento secundario.
 */
import * as THREE from 'three';
import type { CharacterAnim, CharacterRig, Emote } from '../core/contracts';
import { clamp } from '../core/math';
import {
  blendHumanPose, computeHumanPose, createHumanPose, DEFAULT_STYLE, EYES, MOUTH,
  type HumanPose, type MotionStyle,
} from './anim/humanPose';
import { EmoteDisplay } from './EmoteDisplay';
import { bulgeFront, Kit, latheProfile, type Finish, type MatOpts } from './kit';

export interface BodySpec {
  height: number;
  headR: number;
  headScale?: [number, number, number];
  skin: string;
  legRatio: number; // altura de la articulación de cadera / altura total
  hipX: number;
  thighR: number;
  shinR: number;
  armR: number;
  shoulderX: number;
  /** Perfil del torso: [fracción de altura 0..1, radio m]. */
  torso: Array<[number, number]>;
  /** Perfil de la pelvis: [y en m relativo a la cadera, radio m]. */
  pelvis: Array<[number, number]>;
  depth: number; // escala Z del torso (sección elíptica)
  belly?: { y: number; h: number; amount: number };
  chest?: { y: number; h: number; amount: number };
  handR: number;
  neckR: number;
  neckLen: number;
  style?: Partial<MotionStyle>;
}

export interface FaceSpec {
  pupil?: string;
  eyeSize?: number;
  eyeSpacing?: number;
  eyeY?: number;
  lashes?: string | null;
  shadow?: string | null;
  brow?: { color: string; tilt: number; thick?: number; y?: number; len?: number };
  lips?: string;
  blush?: string;
  blushBase?: number;
  squint?: boolean;
  frown?: boolean; // boca seria por defecto (Valerio)
  nose?: string | null;
  cheeks?: number; // mofletes (0..1)
  freckles?: string;
}

interface Chain {
  segs: THREE.Object3D[];
  ax: Float32Array;
  az: Float32Array;
  vx: Float32Array;
  vz: Float32Array;
  restX: number;
  restZ: number;
  bend: number; // curvatura de reposo de los segmentos siguientes
  stiffness: number;
  damping: number;
  gain: number;
  prev: THREE.Vector3;
  prevVel: THREE.Vector3;
  acc: THREE.Vector3;
  init: boolean;
  phase: number;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** Interpolación Catmull-Rom de un perfil [y, r] ordenado por y. */
export function interpProfile(pts: Array<[number, number]>, y: number): number {
  if (y <= pts[0][0]) return pts[0][1];
  const n = pts.length;
  if (y >= pts[n - 1][0]) return pts[n - 1][1];
  let i = 0;
  while (i < n - 2 && y > pts[i + 1][0]) i++;
  const p0 = pts[Math.max(0, i - 1)];
  const p1 = pts[i];
  const p2 = pts[i + 1];
  const p3 = pts[Math.min(n - 1, i + 2)];
  const t = (y - p1[0]) / Math.max(1e-6, p2[0] - p1[0]);
  const m1 = ((p2[1] - p0[1]) / Math.max(1e-6, p2[0] - p0[0])) * (p2[0] - p1[0]);
  const m2 = ((p3[1] - p1[1]) / Math.max(1e-6, p3[0] - p1[0])) * (p2[0] - p1[0]);
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
}

export class HumanRig implements CharacterRig {
  readonly root = new THREE.Group();
  readonly height: number;
  readonly kit = new Kit();
  readonly spec: BodySpec;
  readonly style: MotionStyle;

  // articulaciones
  readonly pivot = new THREE.Group();
  readonly hips = new THREE.Group();
  readonly torso = new THREE.Group();
  readonly neck = new THREE.Group();
  readonly head = new THREE.Group(); // articulación del cuello (rota)
  readonly headCenter = new THREE.Group(); // centro de la esfera de la cabeza
  readonly shoulderL = new THREE.Group();
  readonly shoulderR = new THREE.Group();
  readonly elbowL = new THREE.Group();
  readonly elbowR = new THREE.Group();
  readonly handL = new THREE.Group();
  readonly handR = new THREE.Group();
  readonly hipL = new THREE.Group();
  readonly hipR = new THREE.Group();
  readonly kneeL = new THREE.Group();
  readonly kneeR = new THREE.Group();
  readonly footL = new THREE.Group();
  readonly footR = new THREE.Group();

  // medidas derivadas
  readonly legLen: number;
  readonly torsoLen: number;
  readonly thighLen: number;
  readonly shinLen: number;
  readonly ankleH = 0.07;
  readonly upperArm: number;
  readonly foreArm: number;
  readonly headR: number;
  readonly headScale: [number, number, number];

  // cara
  private mouths: THREE.Object3D[] = [];
  private eyesOpen: THREE.Object3D[] = [];
  private eyesClosed: THREE.Object3D[] = [];
  private eyesHappy: THREE.Object3D[] = [];
  private blushMat: THREE.MeshBasicMaterial | null = null;
  private blushBase = 0.25;
  private blush = 0;

  // accesorios
  readonly props: Record<'phone' | 'tray' | 'cannula', THREE.Group> = {
    phone: new THREE.Group(),
    tray: new THREE.Group(),
    cannula: new THREE.Group(),
  };
  alwaysPhone = false;
  /** Gancho opcional al cambiar de animación (p. ej. enfundar la fusta). */
  onAnimChange: ((anim: CharacterAnim) => void) | null = null;

  private emote = new EmoteDisplay();
  private chains: Chain[] = [];
  private anim: CharacterAnim = 'idle';
  private animT = 0;
  private t = 0;
  private blinkIn = 2;
  private blinkLeft = 0;
  private cur: HumanPose = createHumanPose();
  private target: HumanPose = createHumanPose();
  private first = true;

  constructor(name: string, spec: BodySpec) {
    this.spec = spec;
    this.height = spec.height;
    this.style = { ...DEFAULT_STYLE, ...spec.style };
    this.headR = spec.headR;
    this.headScale = spec.headScale ?? [1.04, 0.98, 0.96];
    const headH = 2 * spec.headR * this.headScale[1];
    this.legLen = spec.height * spec.legRatio;
    this.torsoLen = spec.height - this.legLen - spec.neckLen - headH;
    this.thighLen = (this.legLen - this.ankleH) * 0.5;
    this.shinLen = (this.legLen - this.ankleH) * 0.5;
    const armTotal = this.torsoLen * 0.9 + this.legLen * 0.2 - spec.handR;
    this.upperArm = armTotal * 0.5;
    this.foreArm = armTotal * 0.5;
    this.blinkIn = 1.5 + (this.style.phase % 2);

    this.root.name = name;
    this.root.userData.character = name;
    this.root.add(this.pivot);
    this.pivot.add(this.hips);
    this.hips.position.y = this.legLen;
    this.hips.add(this.torso);
    this.torso.add(this.neck);
    this.neck.position.y = this.torsoLen;
    this.neck.add(this.head);
    this.head.position.y = spec.neckLen;
    this.head.add(this.headCenter);
    this.headCenter.position.y = spec.headR * this.headScale[1] * 0.96;
    this.headCenter.name = 'head';

    const shY = this.torsoLen * 0.86;
    this.shoulderL.position.set(spec.shoulderX, shY, 0);
    this.shoulderR.position.set(-spec.shoulderX, shY, 0);
    this.torso.add(this.shoulderL, this.shoulderR);
    this.shoulderL.add(this.elbowL);
    this.shoulderR.add(this.elbowR);
    this.elbowL.position.y = -this.upperArm;
    this.elbowR.position.y = -this.upperArm;
    this.elbowL.add(this.handL);
    this.elbowR.add(this.handR);
    this.handL.position.y = -this.foreArm;
    this.handR.position.y = -this.foreArm;
    this.handL.name = 'handL';
    this.handR.name = 'handR';

    this.hipL.position.set(spec.hipX, -0.02, 0);
    this.hipR.position.set(-spec.hipX, -0.02, 0);
    this.hips.add(this.hipL, this.hipR);
    this.hipL.add(this.kneeL);
    this.hipR.add(this.kneeR);
    this.kneeL.position.y = -this.thighLen;
    this.kneeR.position.y = -this.thighLen;
    this.kneeL.add(this.footL);
    this.kneeR.add(this.footR);
    this.footL.position.y = -this.shinLen;
    this.footR.position.y = -this.shinLen;

    this.headCenter.add(this.emote.group);
    this.emote.group.position.y = spec.headR * 1.45;
    this.buildProps();
  }

  // ───────────── construcción del cuerpo ─────────────

  mat(color: string, o?: MatOpts) {
    return this.kit.mat(color, o);
  }

  /** Capa sobre el torso siguiendo su perfil (piel, camiseta, corsé...). */
  torsoLayer(color: string, o: { finish?: Finish; from?: number; to?: number; offset?: number; gapDeg?: number; map?: THREE.Texture; capTop?: boolean; capBottom?: boolean; bulge?: number; chest?: number; side?: THREE.Side; seg?: number } = {}): THREE.Mesh {
    const s = this.spec;
    const from = o.from ?? 0;
    const to = o.to ?? 1;
    const off = o.offset ?? 0;
    const pts: Array<[number, number]> = [];
    const n = 18;
    if (o.capBottom) pts.push([from * this.torsoLen - 0.001, 0.002]);
    for (let k = 0; k <= n; k++) {
      const f = from + ((to - from) * k) / n;
      pts.push([f * this.torsoLen, interpProfile(s.torso, f) + off]);
    }
    if (o.capTop) pts.push([to * this.torsoLen + 0.001, 0.002]);
    const g = this.kit.own(latheProfile(pts, o.seg ?? 30, { gapDeg: o.gapDeg, samples: pts.length * 2 }));
    const b = s.belly;
    if (b && (o.bulge ?? 1) > 0) bulgeFront(g, b.y * this.torsoLen, b.h * this.torsoLen, (b.amount * (o.bulge ?? 1)) / s.depth);
    const c = s.chest;
    if (c && (o.chest ?? 1) > 0) bulgeFront(g, c.y * this.torsoLen, c.h * this.torsoLen, (c.amount * (o.chest ?? 1)) / s.depth, 2.2);
    const m = this.kit.mesh(g, this.mat(color, { finish: o.finish ?? 'cloth', map: o.map, side: o.side ?? (o.gapDeg ? THREE.DoubleSide : THREE.FrontSide) }), this.torso);
    m.scale.z = s.depth;
    return m;
  }

  /** Punto sobre la superficie del torso (theta: 0 = frente, + = lado izquierdo; frac 0..1). */
  torsoPt(theta: number, frac: number, lift = 0): THREE.Vector3 {
    const r = interpProfile(this.spec.torso, frac) + lift;
    return new THREE.Vector3(Math.sin(theta) * r, frac * this.torsoLen, Math.cos(theta) * r * this.spec.depth);
  }

  /** Capa sobre la pelvis (pantalón, falda corta, bragas del mono...). */
  pelvisLayer(color: string, o: { finish?: Finish; offset?: number; from?: number; to?: number; map?: THREE.Texture } = {}): THREE.Mesh {
    const s = this.spec;
    const from = o.from ?? s.pelvis[0][0];
    const to = o.to ?? s.pelvis[s.pelvis.length - 1][0];
    const pts: Array<[number, number]> = [[from - 0.001, 0.002]];
    const n = 12;
    for (let k = 0; k <= n; k++) {
      const y = from + ((to - from) * k) / n;
      pts.push([y, interpProfile(s.pelvis, y) + (o.offset ?? 0)]);
    }
    const g = this.kit.own(latheProfile(pts, 30, { samples: pts.length * 2 }));
    const m = this.kit.mesh(g, this.mat(color, { finish: o.finish ?? 'cloth', map: o.map }), this.hips);
    m.scale.z = s.depth * 1.02;
    return m;
  }

  /** Falda/bata acampanada colgando de un grupo. */
  flare(parent: THREE.Object3D, color: string, topY: number, botY: number, topR: number, botR: number, o: { finish?: Finish; gapDeg?: number; depth?: number; midBulge?: number; map?: THREE.Texture } = {}): THREE.Mesh {
    const mid = (topR + botR) / 2 + (o.midBulge ?? 0);
    const pts: Array<[number, number]> = [[botY, botR], [(topY + botY) / 2, mid], [topY, topR]];
    const g = this.kit.own(latheProfile(pts, 30, { gapDeg: o.gapDeg, samples: 12 }));
    const m = this.kit.mesh(g, this.mat(color, { finish: o.finish ?? 'cloth', side: THREE.DoubleSide, map: o.map }), parent);
    m.scale.z = o.depth ?? this.spec.depth;
    return m;
  }

  /** Piernas: muslo y espinilla (colores/acabados por tramo). */
  buildLegs(thigh: THREE.Material, shin: THREE.Material, o: { thighR?: number; shinR?: number } = {}) {
    const tr = o.thighR ?? this.spec.thighR;
    const sr = o.shinR ?? this.spec.shinR;
    for (const [hip, knee] of [[this.hipL, this.kneeL], [this.hipR, this.kneeR]] as const) {
      const th = this.kit.mesh(this.kit.capsuleGeo(tr, Math.max(0.01, this.thighLen - tr * 0.6)), thigh, hip, [0, -this.thighLen / 2, 0]);
      th.name = 'thigh';
      const sh = this.kit.mesh(this.kit.capsuleGeo(sr, Math.max(0.01, this.shinLen - sr * 0.4)), shin, knee, [0, -this.shinLen / 2, 0]);
      sh.name = 'shin';
    }
  }

  /** Brazos: parte superior, antebrazo y mano tipo manopla con pulgar. */
  buildArms(upper: THREE.Material, fore: THREE.Material, hand: THREE.Material, o: { upperR?: number; foreR?: number } = {}) {
    const ur = o.upperR ?? this.spec.armR;
    const fr = o.foreR ?? this.spec.armR * 0.88;
    const hr = this.spec.handR;
    for (const [sh, el, ha, side] of [[this.shoulderL, this.elbowL, this.handL, 1], [this.shoulderR, this.elbowR, this.handR, -1]] as const) {
      this.kit.mesh(this.kit.capsuleGeo(ur, Math.max(0.01, this.upperArm - ur * 0.5)), upper, sh, [0, -this.upperArm / 2, 0]);
      this.kit.mesh(this.kit.capsuleGeo(fr, Math.max(0.01, this.foreArm - fr * 0.5)), fore, el, [0, -this.foreArm / 2, 0]);
      this.kit.mesh(this.kit.sphereGeo(), hand, ha, [0, -hr * 0.55, 0.005], [hr * 0.95, hr * 1.15, hr * 0.75]);
      this.kit.mesh(this.kit.sphereGeo(), hand, ha, [side * hr * 0.2, -hr * 0.2, hr * 0.62], [hr * 0.35, hr * 0.5, hr * 0.35]);
    }
  }

  /** Zapatos/botas en los tobillos. */
  buildShoes(color: string, o: { finish?: Finish; sole?: string; soleH?: number; bootH?: number; bootR?: number; len?: number; width?: number; laces?: string; toe?: string } = {}) {
    const len = o.len ?? 0.2;
    const w = o.width ?? 0.085;
    const soleH = o.soleH ?? 0.025;
    const fin = o.finish ?? 'gloss';
    for (const foot of [this.footL, this.footR]) {
      const shoe = new THREE.Group();
      shoe.name = 'shoe';
      foot.add(shoe);
      // puntera redondeada
      this.kit.ball(color, shoe, [0, -this.ankleH + soleH + 0.035, len * 0.22], [w * 0.62, 0.05, len * 0.52], { finish: fin });
      this.kit.ball(color, shoe, [0, -this.ankleH + soleH + 0.045, -0.01], [w * 0.55, 0.06, len * 0.3], { finish: fin });
      if (o.toe) this.kit.ball(o.toe, shoe, [0, -this.ankleH + soleH + 0.04, len * 0.5], [w * 0.5, 0.036, 0.05], { finish: 'vinyl' });
      // suela
      const sole = this.kit.mesh(this.kit.capsuleGeo(w * 0.5, len * 0.8, 10), this.mat(o.sole ?? '#f4eef6', { finish: 'vinyl' }), shoe, [0, -this.ankleH + soleH / 2, len * 0.18], [1, 1, 1], [Math.PI / 2, 0, 0]);
      sole.scale.set(1.12, 1, soleH / (w * 0.9));
      if (o.bootH) {
        const br = o.bootR ?? this.spec.shinR * 1.25;
        const h = o.bootH;
        this.kit.mesh(this.kit.cylGeo(br * 1.06, br * 0.95, h, 18), this.mat(color, { finish: fin }), shoe, [0, -this.ankleH + soleH + h / 2, 0]);
        this.kit.mesh(this.kit.torusGeo(br * 1.06, 0.012, Math.PI * 2, 20), this.mat(color, { finish: fin }), shoe, [0, -this.ankleH + soleH + h, 0], 1, [Math.PI / 2, 0, 0]);
        if (o.laces) {
          for (let k = 0; k < Math.floor(h / 0.05); k++) {
            this.kit.mesh(this.kit.boxGeo(0.05, 0.008, 0.01), this.mat(o.laces, { finish: 'vinyl' }), shoe, [0, -this.ankleH + soleH + 0.07 + k * 0.05, br * 1.02], 1, [0, 0, k % 2 ? 0.35 : -0.35]);
          }
        }
      } else if (o.laces) {
        this.kit.mesh(this.kit.boxGeo(0.05, 0.008, 0.012), this.mat(o.laces, { finish: 'vinyl' }), shoe, [0, -this.ankleH + soleH + 0.08, len * 0.18]);
      }
    }
  }

  /** Cabeza (piel), cuello y mofletes. */
  buildHead(o: { ears?: boolean; chin?: number } = {}) {
    const s = this.spec;
    const R = this.headR;
    const skin = this.mat(s.skin, { finish: 'skin' });
    this.kit.mesh(this.kit.capsuleGeo(s.neckR, s.neckLen + 0.04), skin, this.neck, [0, s.neckLen / 2 + 0.01, 0]);
    const hs = this.headScale;
    this.kit.mesh(this.kit.sphereGeo(22), skin, this.headCenter, [0, 0, 0], [R * hs[0], R * hs[1], R * hs[2]]);
    // mandíbula/mofletes suaves
    this.kit.mesh(this.kit.sphereGeo(), skin, this.headCenter, [0, -R * 0.3, R * 0.12], [R * 0.82, R * 0.58, R * 0.8]);
    if (o.ears !== false) {
      for (const side of [1, -1]) this.kit.ball(s.skin, this.headCenter, [side * R * hs[0] * 0.98, -R * 0.1, -R * 0.02], [R * 0.13, R * 0.2, R * 0.1], { finish: 'skin' });
    }
  }

  /** Punto en la superficie de la cabeza (yaw, pitch en radianes). */
  surf(yaw: number, pitch: number, lift = 0): THREE.Vector3 {
    const R = this.headR;
    const hs = this.headScale;
    const d = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    return new THREE.Vector3(d.x * R * hs[0], d.y * R * hs[1], d.z * R * hs[2]).addScaledVector(d, lift);
  }

  /** Coloca un objeto sobre la cara orientado hacia fuera. */
  onFace(obj: THREE.Object3D, yaw: number, pitch: number, lift = 0): THREE.Object3D {
    obj.position.copy(this.surf(yaw, pitch, lift));
    const n = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    this.headCenter.add(obj);
    return obj;
  }

  /** Ojos brillantes, pestañas, cejas, boca con varias formas y rubor. */
  buildFace(f: FaceSpec = {}) {
    const R = this.headR;
    const k = this.kit;
    const es = (f.eyeSize ?? 1) * R;
    const spacing = f.eyeSpacing ?? 0.36;
    const eyeY = f.eyeY ?? -0.1;
    const pupil = this.mat(f.pupil ?? '#2a1830', { finish: 'eye' });
    const white = this.mat('#ffffff', { finish: 'flat' });
    const dark = this.mat('#3b2146', { finish: 'flat' });
    const cheeks = f.cheeks ?? 0;
    if (cheeks > 0) {
      const skin = this.mat(this.spec.skin, { finish: 'skin' });
      for (const side of [1, -1]) k.mesh(k.sphereGeo(), skin, this.headCenter, [side * R * 0.5, -R * 0.36, R * 0.55], [R * 0.36 * (0.8 + cheeks * 0.4), R * 0.3 * (0.8 + cheeks * 0.35), R * 0.3]);
    }
    for (const side of [1, -1]) {
      const g = new THREE.Group();
      g.name = side > 0 ? 'eyeL' : 'eyeR';
      this.onFace(g, side * spacing, eyeY, 0.0);
      const open = new THREE.Group();
      g.add(open);
      const sy = f.squint ? 0.08 : 0.2;
      k.mesh(k.sphereGeo(), pupil, open, [0, 0, 0], [es * 0.14, es * sy, es * 0.07]);
      if (!f.squint) {
        k.mesh(k.sphereGeo(10), white, open, [-side * es * 0.045, es * 0.075, es * 0.06], es * 0.05);
        k.mesh(k.sphereGeo(10), white, open, [side * es * 0.04, -es * 0.07, es * 0.06], es * 0.025);
      }
      if (f.lashes) {
        const lash = k.mesh(k.capsuleGeo(es * 0.022, es * 0.12, 6), this.mat(f.lashes, { finish: 'flat' }), open, [side * es * 0.13, es * 0.16, es * 0.03], 1, [0, 0, side * 1.0]);
        lash.name = 'lash';
        k.mesh(k.capsuleGeo(es * 0.018, es * 0.08, 6), this.mat(f.lashes, { finish: 'flat' }), open, [side * es * 0.06, es * 0.215, es * 0.02], 1, [0, 0, side * 1.35]);
      }
      if (f.shadow) k.mesh(k.sphereGeo(), this.mat(f.shadow, { finish: 'flat', opacity: 0.55 }), g, [0, es * 0.1, -es * 0.03], [es * 0.2, es * 0.16, es * 0.06]);
      this.eyesOpen.push(open);
      // ojos cerrados (∪) y felices (∩)
      const closed = k.mesh(k.torusGeo(es * 0.12, es * 0.026, Math.PI, 14), dark, g, [0, es * 0.04, es * 0.03], 1, [0, 0, Math.PI]);
      closed.visible = false;
      closed.name = 'eyeClosed';
      this.eyesClosed.push(closed);
      const happy = k.mesh(k.torusGeo(es * 0.12, es * 0.026, Math.PI, 14), dark, g, [0, -es * 0.05, es * 0.03]);
      happy.visible = false;
      happy.name = 'eyeHappy';
      this.eyesHappy.push(happy);
      if (f.brow) {
        const b = f.brow;
        const brow = k.mesh(k.capsuleGeo(R * (b.thick ?? 0.035), R * (b.len ?? 0.2), 6), this.mat(b.color, { finish: 'vinyl' }), this.headCenter);
        this.onFace(brow, side * spacing, eyeY + (b.y ?? 0.3), 0.004);
        brow.rotateZ(Math.PI / 2 - side * b.tilt);
      }
    }
    if (f.nose) this.onFace(k.mesh(k.sphereGeo(12), this.mat(f.nose, { finish: 'skin' }), this.headCenter, undefined, [R * 0.07, R * 0.055, R * 0.05]), 0, -0.25, 0.0);
    if (f.freckles) {
      for (const side of [1, -1]) for (let i = 0; i < 3; i++) this.onFace(k.mesh(k.circleGeo(8), this.mat(f.freckles, { finish: 'flat' }), this.headCenter, undefined, R * 0.018), side * (0.3 + i * 0.08), -0.28 - (i % 2) * 0.05, 0.004);
    }
    // bocas
    const mouthCol = this.mat(f.lips ?? '#7a2848', { finish: f.lips ? 'gloss' : 'flat' });
    const inner = this.mat('#5c1830', { finish: 'flat' });
    const tongue = this.mat('#ff7fa6', { finish: 'flat' });
    const mk = () => {
      const g = new THREE.Group();
      this.onFace(g, 0, -0.42, 0.002);
      g.visible = false;
      return g;
    };
    const smile = mk();
    if (f.frown) k.mesh(k.torusGeo(R * 0.12, R * 0.02, Math.PI * 0.7, 16), mouthCol, smile, [0, -R * 0.06, 0], 1, [0, 0, Math.PI * 0.15]);
    else k.mesh(k.torusGeo(R * 0.13, R * (f.lips ? 0.03 : 0.022), Math.PI, 16), mouthCol, smile, [0, R * 0.05, 0], 1, [0, 0, Math.PI]);
    const open = mk();
    k.mesh(k.sphereGeo(), inner, open, [0, 0, 0], [R * 0.11, R * 0.13, R * 0.03]);
    k.mesh(k.sphereGeo(), tongue, open, [0, -R * 0.06, R * 0.012], [R * 0.07, R * 0.05, R * 0.02]);
    const flat = mk();
    k.mesh(k.capsuleGeo(R * 0.022, R * 0.14, 6), mouthCol, flat, [0, 0, 0], 1, [0, 0, Math.PI / 2]);
    const wavy = mk();
    const wpts: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i++) wpts.push(new THREE.Vector3((i / 6 - 0.5) * R * 0.34, Math.sin(i * Math.PI) * 0 + (i % 2 ? 1 : -1) * R * 0.03, 0));
    k.tube(f.lips ?? '#7a2848', wavy, wpts, R * 0.02, { finish: 'flat' });
    const grin = mk();
    const half = k.geo('halfdisc', () => new THREE.CircleGeometry(1, 20, Math.PI, Math.PI));
    k.mesh(half, inner, grin, [0, R * 0.05, 0], [R * 0.17, R * 0.16, 1]);
    k.mesh(k.sphereGeo(), tongue, grin, [0, -R * 0.04, -R * 0.005], [R * 0.08, R * 0.045, R * 0.01]);
    k.mesh(k.boxGeo(1, 1, 1), white, grin, [0, R * 0.035, R * 0.003], [R * 0.3, R * 0.03, R * 0.004]);
    this.mouths = [smile, open, flat, wavy, grin];
    smile.visible = true;
    // rubor
    this.blushBase = f.blushBase ?? 0.28;
    this.blushMat = this.kit.own(new THREE.MeshBasicMaterial({ color: f.blush ?? '#ff7fb0', transparent: true, opacity: this.blushBase, depthWrite: false }));
    for (const side of [1, -1]) {
      const d = k.mesh(k.circleGeo(), this.blushMat, this.headCenter, undefined, [R * 0.15, R * 0.1, 1]);
      this.onFace(d, side * 0.62, -0.3, 0.012 + cheeks * 0.03);
      d.castShadow = false;
    }
  }

  /** Cadena de segmentos con movimiento secundario (rastas, coleta, orejas). */
  addChain(parent: THREE.Object3D, pos: [number, number, number], rest: [number, number], n: number, segLen: number, r: number, mat: THREE.Material, o: { taper?: number; stiffness?: number; damping?: number; gain?: number; bead?: THREE.Material; bend?: number } = {}): THREE.Object3D[] {
    const segs: THREE.Object3D[] = [];
    let p: THREE.Object3D = parent;
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      if (i === 0) {
        g.position.set(pos[0], pos[1], pos[2]);
        g.rotation.set(rest[0], 0, rest[1]);
      } else g.position.y = -segLen;
      const rr = r * (1 - ((o.taper ?? 0.3) * i) / Math.max(1, n - 1));
      this.kit.mesh(this.kit.capsuleGeo(rr, Math.max(0.005, segLen - rr * 0.5), 8), mat, g, [0, -segLen / 2, 0]);
      if (o.bead && i === n - 1) this.kit.mesh(this.kit.sphereGeo(10), o.bead, g, [0, -segLen, 0], rr * 1.15);
      p.add(g);
      segs.push(g);
      p = g;
    }
    this.chains.push({
      segs,
      ax: new Float32Array(n), az: new Float32Array(n), vx: new Float32Array(n), vz: new Float32Array(n),
      restX: rest[0], restZ: rest[1], bend: o.bend ?? 0,
      stiffness: o.stiffness ?? 40, damping: o.damping ?? 6, gain: o.gain ?? 0.02,
      prev: new THREE.Vector3(), prevVel: new THREE.Vector3(), acc: new THREE.Vector3(), init: false,
      phase: this.chains.length * 1.7,
    });
    return segs;
  }

  /** Altura de los emotes sobre el centro de la cabeza (peinados altos). */
  emoteY(y: number): void {
    this.emote.group.position.y = y;
  }

  // ───────────── accesorios genéricos ─────────────

  private buildProps() {
    const k = this.kit;
    // móvil (mano derecha): pantalla hacia +Z local de la mano
    const ph = this.props.phone;
    ph.name = 'phone';
    this.handR.add(ph);
    ph.position.set(0, -0.07, 0.03);
    ph.rotation.set(0.25, 0, 0);
    k.mesh(k.boxGeo(0.075, 0.14, 0.012), this.mat('#ff8fc7', { finish: 'gloss' }), ph);
    k.mesh(k.boxGeo(0.064, 0.125, 0.002), this.mat('#bff6ff', { finish: 'flat' }), ph, [0, 0, 0.0071]);
    k.mesh(k.cylGeo(0.008, 0.008, 0.004, 10), this.mat('#3b2146', { finish: 'gloss' }), ph, [0.02, 0.05, -0.008], 1, [Math.PI / 2, 0, 0]);
    k.mesh(k.torusGeo(0.012, 0.003), this.mat('#f5c542', { finish: 'metal' }), ph, [0, -0.01, -0.009]);
    ph.visible = false;
    // bandeja con instrumental (delante del torso)
    const tr = this.props.tray;
    tr.name = 'tray';
    this.torso.add(tr);
    tr.position.set(0, this.torsoLen * 0.18, 0.36);
    k.mesh(k.boxGeo(0.34, 0.015, 0.22), this.mat('#d9dde6', { finish: 'metal' }), tr);
    k.mesh(k.boxGeo(0.34, 0.03, 0.01), this.mat('#c5cad6', { finish: 'metal' }), tr, [0, 0.012, 0.11]);
    k.mesh(k.boxGeo(0.34, 0.03, 0.01), this.mat('#c5cad6', { finish: 'metal' }), tr, [0, 0.012, -0.11]);
    k.mesh(k.cylGeo(0.006, 0.004, 0.05, 8), this.mat('#e8ecf5', { finish: 'metal' }), tr, [-0.05, 0.02, 0.02], 1, [0, 0, Math.PI / 2]);
    k.mesh(k.boxGeo(0.12, 0.004, 0.018), this.mat('#b9c2d6', { finish: 'metal' }), tr, [0.06, 0.012, -0.02]);
    tr.visible = false;
    // cánula de aspiración (mano izquierda) con manguera
    const cn = this.props.cannula;
    cn.name = 'cannula';
    this.handL.add(cn);
    cn.position.set(0, -0.05, 0.02);
    cn.rotation.set(-0.9, 0, 0);
    k.mesh(k.cylGeo(0.016, 0.012, 0.36, 12), this.mat('#e9f6ff', { finish: 'glass', opacity: 0.8 }), cn, [0, -0.14, 0]);
    k.mesh(k.cylGeo(0.007, 0.005, 0.1, 8), this.mat('#e9f6ff', { finish: 'glass', opacity: 0.85 }), cn, [0, -0.35, 0.016], 1, [0.3, 0, 0]);
    k.mesh(k.torusGeo(0.017, 0.006, Math.PI * 2, 14), this.mat('#ff2e93', { finish: 'gloss' }), cn, [0, 0.02, 0], 1, [Math.PI / 2, 0, 0]);
    k.tube('#5fdcae', cn, [new THREE.Vector3(0, 0.03, 0), new THREE.Vector3(0.03, 0.14, -0.06), new THREE.Vector3(0.1, 0.12, -0.24), new THREE.Vector3(0.16, -0.25, -0.34), new THREE.Vector3(0.2, -0.6, -0.3)], 0.014, { finish: 'vinyl' });
    cn.visible = false;
  }

  // ───────────── CharacterRig ─────────────

  setAnim(anim: CharacterAnim): void {
    if (anim === this.anim) return;
    this.anim = anim;
    this.animT = 0;
    this.onAnimChange?.(anim);
  }

  get currentAnim(): CharacterAnim {
    return this.anim;
  }

  setBlush(v: number): void {
    this.blush = clamp(v, 0, 1);
    if (this.blushMat) this.blushMat.opacity = clamp(this.blushBase + this.blush * 0.65, 0, 0.95);
  }

  setEmote(e: Emote): void {
    this.emote.set(e);
  }

  faceTowards(p: THREE.Vector3): void {
    _v.copy(p);
    if (this.root.parent) this.root.parent.worldToLocal(_v);
    const dx = _v.x - this.root.position.x;
    const dz = _v.z - this.root.position.z;
    if (dx * dx + dz * dz < 1e-8) return;
    this.root.rotation.y = Math.atan2(dx, dz);
  }

  update(dt: number): void {
    this.t += dt;
    this.animT += dt;
    computeHumanPose(this.anim, this.t, this.animT, this.style, this.target);
    if (this.first) {
      blendHumanPose(this.cur, this.target, 1);
      this.first = false;
    } else blendHumanPose(this.cur, this.target, 1 - Math.exp(-dt * 11));
    this.apply(this.cur);
    this.updateFace(dt);
    this.updateChains(dt);
    this.emote.update(dt);
  }

  private apply(p: HumanPose) {
    const t = this.t;
    const sh = p.shake;
    const j1 = sh ? Math.sin(t * 47) * sh : 0;
    const j2 = sh ? Math.sin(t * 59 + 1.3) * sh : 0;
    const j3 = sh ? Math.sin(t * 71 + 2.1) * sh : 0;
    this.pivot.rotation.x = -p.fall * 1.42;
    this.pivot.position.y = p.fall * this.spec.depth * 0.16;
    this.hips.position.set(p.sway + j1 * 0.006, this.legLen + p.bob - p.sit * this.thighLen * 0.92, 0);
    this.hips.rotation.set(0, p.hipYaw, p.roll * 0.5);
    this.torso.rotation.set(p.lean + j2 * 0.02, p.twist, p.roll * 0.5 + j1 * 0.03);
    this.head.rotation.set(p.headPitch + j3 * 0.03, p.headYaw, p.headRoll + j2 * 0.03);
    const aL = p.armL;
    const aR = p.armR;
    this.shoulderL.rotation.set(-aL.swing + j3 * 0.06, aL.twist, aL.spread);
    this.shoulderR.rotation.set(-aR.swing - j1 * 0.06, -aR.twist, -aR.spread);
    this.elbowL.rotation.x = -aL.elbow;
    this.elbowR.rotation.x = -aR.elbow;
    // manos temblorosas
    this.handL.rotation.z = j2 * 0.15;
    this.handR.rotation.z = j3 * 0.15;
    this.hipL.rotation.set(-p.legL.hip, 0, p.legL.splay);
    this.hipR.rotation.set(-p.legR.hip, 0, -p.legR.splay);
    this.kneeL.rotation.x = p.legL.knee;
    this.kneeR.rotation.x = p.legR.knee;
    this.footL.rotation.x = (p.legL.hip - p.legL.knee) * 0.75;
    this.footR.rotation.x = (p.legR.hip - p.legR.knee) * 0.75;
    this.props.phone.visible = this.alwaysPhone || p.phone > 0.5;
    this.props.tray.visible = p.tray > 0.5;
    this.props.cannula.visible = p.cannula > 0.5;
  }

  private updateFace(dt: number) {
    const p = this.cur;
    for (let i = 0; i < this.mouths.length; i++) this.mouths[i].visible = i === p.mouth;
    if (this.mouths.length && p.mouth >= this.mouths.length) this.mouths[MOUTH.smile].visible = true;
    // parpadeo
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) {
      this.blinkLeft = 0.12;
      this.blinkIn = 2.2 + ((this.t * 7.3 + this.style.phase) % 2.5);
    }
    if (this.blinkLeft > 0) this.blinkLeft -= dt;
    const blink = this.blinkLeft > 0;
    const eyes = p.eyes;
    const openVis = eyes === EYES.open || eyes === EYES.wide;
    const sc = eyes === EYES.wide ? 1.25 : 1;
    for (const e of this.eyesOpen) {
      e.visible = openVis;
      e.scale.set(sc, blink ? 0.12 : sc, sc);
    }
    for (const e of this.eyesClosed) e.visible = eyes === EYES.closed;
    for (const e of this.eyesHappy) e.visible = eyes === EYES.happy;
  }

  private updateChains(dt: number) {
    if (!this.chains.length || dt <= 0) return;
    const idt = 1 / Math.max(dt, 1 / 240);
    // contrarrestar la inclinación de la cabeza/torso para que cuelguen con la gravedad
    const counterX = -(this.cur.headPitch + this.cur.lean) * 0.85 + this.cur.fall * 1.2;
    const counterZ = -(this.cur.headRoll + this.cur.roll * 0.5) * 0.85;
    this.root.getWorldQuaternion(_q).invert();
    for (const c of this.chains) {
      const anchor = c.segs[0].parent!;
      anchor.getWorldPosition(_v);
      if (!c.init) {
        c.prev.copy(_v);
        c.prevVel.set(0, 0, 0);
        c.init = true;
      }
      _v2.subVectors(_v, c.prev).multiplyScalar(idt); // velocidad
      _v3.subVectors(_v2, c.prevVel).multiplyScalar(idt).applyQuaternion(_q);
      c.acc.lerp(_v3, 0.3);
      c.prevVel.copy(_v2);
      c.prev.copy(_v);
      const n = c.segs.length;
      for (let i = 0; i < n; i++) {
        const w = (i + 1) / n;
        const sway = Math.sin(this.t * 1.3 + c.phase + i * 0.7) * 0.03;
        let tx = clamp(c.acc.z * c.gain * w, -0.9, 0.9) + sway;
        let tz = clamp(-c.acc.x * c.gain * w, -0.9, 0.9) + sway * 0.6;
        if (i === 0) {
          tx += c.restX + counterX;
          tz += c.restZ + counterZ;
        } else tx += c.bend;
        c.vx[i] += ((tx - c.ax[i]) * c.stiffness - c.vx[i] * c.damping) * dt;
        c.vz[i] += ((tz - c.az[i]) * c.stiffness - c.vz[i] * c.damping) * dt;
        c.ax[i] += c.vx[i] * dt;
        c.az[i] += c.vz[i] * dt;
        c.segs[i].rotation.x = c.ax[i];
        c.segs[i].rotation.z = c.az[i];
      }
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.emote.dispose();
    this.kit.dispose();
  }
}

