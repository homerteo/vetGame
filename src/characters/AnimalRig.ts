/**
 * Rig de animal cuadrúpedo estilizado (perros, gato, conejo): cuerpo, cabeza con hocico,
 * orejas, cola articulada y cuatro patas animadas proceduralmente. Opciones: cono y rasurado.
 */
import * as THREE from 'three';
import type { CharacterAnim, CharacterRig, Emote } from '../core/contracts';
import { clamp } from '../core/math';
import { blendAnimalPose, computeAnimalPose, createAnimalPose, type AnimalPose, type AnimalStyle } from './anim/animalPose';
import { EmoteDisplay } from './EmoteDisplay';
import { Kit, type MatOpts } from './kit';

export type EarKind = 'bat' | 'floppy' | 'rose' | 'tri' | 'cat' | 'bunnyUp' | 'bunnyLop' | 'poodle';
export type TailKind = 'curl' | 'thin' | 'stub' | 'pompom' | 'fluffy' | 'cotton' | 'whip';

export interface AnimalSpec {
  bodyLen: number;
  bodyR: number;
  bodyH?: number; // escala vertical del cuerpo
  bodyW?: number; // escala lateral del cuerpo
  legLen: number;
  legR: number;
  legX: number;
  hindBig?: boolean; // conejo: patas traseras grandes
  headR: number;
  headScale?: [number, number, number];
  snoutLen: number;
  snoutR: number;
  neckLen: number;
  neckUp: number; // ángulo del cuello (rad)
  ears: EarKind;
  earSize: number;
  tail: TailKind;
  tailLen: number;
  colors: { main: string; second?: string; belly?: string; nose: string; innerEar?: string; paws?: string };
  map?: THREE.Texture; // textura del pelaje (atigrado)
  finish?: 'vinyl' | 'plush' | 'cloth';
  eyeSize?: number;
  style: AnimalStyle;
}

const _v = new THREE.Vector3();

export class AnimalRig implements CharacterRig {
  readonly root = new THREE.Group();
  readonly height: number;
  readonly kit = new Kit();
  readonly spec: AnimalSpec;
  readonly body = new THREE.Group();
  readonly neck = new THREE.Group();
  readonly head = new THREE.Group();
  readonly headCenter = new THREE.Group();
  readonly tailBase = new THREE.Group();
  readonly tailPitch = new THREE.Group();
  readonly legs: THREE.Group[] = [];
  readonly ears: Array<{ g: THREE.Group; side: number; base: THREE.Euler }> = [];
  private tailSegs: THREE.Object3D[] = [];
  private tailCurl = 0;
  private mouthOpen: THREE.Object3D | null = null;
  private mouthClosed: THREE.Object3D | null = null;
  private eyesOpen: THREE.Object3D[] = [];
  private eyesClosed: THREE.Object3D[] = [];
  private blushMat: THREE.MeshBasicMaterial | null = null;
  private emote = new EmoteDisplay(0.12);
  private anim: CharacterAnim = 'idle';
  private animT = 0;
  private t = 0;
  private cur: AnimalPose = createAnimalPose();
  private target: AnimalPose = createAnimalPose();
  private first = true;
  readonly bodyY: number;

  constructor(name: string, spec: AnimalSpec) {
    this.spec = spec;
    this.root.name = name;
    this.root.userData.character = name;
    this.bodyY = spec.legLen + spec.bodyR * (spec.bodyH ?? 1) * 0.7;
    this.root.add(this.body);
    this.body.position.y = this.bodyY;
    this.height = this.bodyY + spec.neckLen + spec.headR * 2.2;
  }

  mat(color: string, o: MatOpts = {}) {
    return this.kit.mat(color, { finish: this.spec.finish ?? 'vinyl', ...o });
  }

  furMat(color: string) {
    return this.kit.mat(this.spec.map ? '#ffffff' : color, { finish: this.spec.finish ?? 'vinyl', map: this.spec.map });
  }

  /** Construye el cuerpo base. */
  build(): this {
    const s = this.spec;
    const k = this.kit;
    const main = this.furMat(s.colors.main);
    const bh = s.bodyH ?? 1;
    const bw = s.bodyW ?? 1;
    // tronco: pecho + vientre + grupa
    const trunk = k.mesh(k.capsuleGeo(s.bodyR, Math.max(0.01, s.bodyLen - s.bodyR * 1.2), 20), main, this.body, [0, 0, 0], [bw, 1, bh], [Math.PI / 2, 0, 0]);
    trunk.name = 'trunk';
    // pecho algo más lleno que la grupa
    k.mesh(k.sphereGeo(20), main, this.body, [0, s.bodyR * 0.08, s.bodyLen * 0.22], [s.bodyR * 1.04 * bw, s.bodyR * 1.02 * bh, s.bodyR * 1.15]);
    if (s.colors.belly) k.mesh(k.sphereGeo(20), this.mat(s.colors.belly), this.body, [0, -s.bodyR * 0.35 * bh, s.bodyLen * 0.08], [s.bodyR * 0.8 * bw, s.bodyR * 0.7 * bh, s.bodyLen * 0.42]);
    // patas
    const legZ = s.bodyLen * 0.34;
    const pawMat = this.mat(s.colors.paws ?? s.colors.main);
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      const side = i % 2 === 0 ? 1 : -1;
      const g = new THREE.Group();
      g.position.set(side * s.legX, -this.bodyY + s.legLen, front ? legZ : -legZ);
      this.body.add(g);
      const big = !front && s.hindBig;
      const len = s.legLen;
      k.mesh(k.capsuleGeo(s.legR * (big ? 1.5 : 1), Math.max(0.005, len - s.legR)), main, g, [0, -len / 2 + s.legR * 0.2, 0]);
      if (!front) k.mesh(k.sphereGeo(16), main, g, [0, -len * 0.15, 0], [s.legR * 1.6 * (big ? 1.4 : 1), len * 0.45, s.legR * 2.1 * (big ? 1.3 : 1)]);
      k.mesh(k.sphereGeo(14), pawMat, g, [0, -len + s.legR * 0.7, s.legR * (big ? 1.4 : 0.5)], [s.legR * 1.25, s.legR * 0.8, s.legR * (big ? 2.6 : 1.6)]);
      g.userData.front = front;
      this.legs.push(g);
    }
    // cuello y cabeza
    this.neck.position.set(0, s.bodyR * 0.45 * bh, s.bodyLen * 0.42);
    this.body.add(this.neck);
    this.neck.add(this.head);
    this.head.position.set(0, Math.sin(s.neckUp) * s.neckLen, Math.cos(s.neckUp) * s.neckLen);
    k.mesh(k.capsuleGeo(s.headR * 0.55, s.neckLen), main, this.neck, [0, Math.sin(s.neckUp) * s.neckLen * 0.5, Math.cos(s.neckUp) * s.neckLen * 0.5], 1, [Math.PI / 2 - s.neckUp, 0, 0]);
    this.head.add(this.headCenter);
    this.headCenter.name = 'head';
    const hs = s.headScale ?? [1, 0.95, 0.95];
    k.mesh(k.sphereGeo(20), main, this.headCenter, [0, 0, 0], [s.headR * hs[0], s.headR * hs[1], s.headR * hs[2]]);
    // hocico
    const snoutCol = s.colors.belly ?? s.colors.main;
    const sn = new THREE.Group();
    sn.position.set(0, -s.headR * 0.28, s.headR * hs[2] * 0.72);
    this.headCenter.add(sn);
    k.mesh(k.sphereGeo(18), this.mat(snoutCol), sn, [0, 0, s.snoutLen * 0.5], [s.snoutR, s.snoutR * 0.8, s.snoutLen * 0.5 + s.snoutR * 0.6]);
    k.mesh(k.sphereGeo(12), this.mat(s.colors.nose, { finish: 'gloss' }), sn, [0, s.snoutR * 0.45, s.snoutLen + s.snoutR * 0.45], [s.snoutR * 0.42, s.snoutR * 0.3, s.snoutR * 0.28]);
    // boca: "ω" cerrada y abierta con lengua
    const mc = new THREE.Group();
    mc.position.set(0, -s.snoutR * 0.35, s.snoutLen + s.snoutR * 0.35);
    sn.add(mc);
    const dark = this.kit.mat('#3b2146', { finish: 'flat' });
    for (const side of [1, -1]) k.mesh(k.torusGeo(s.snoutR * 0.2, s.snoutR * 0.045, Math.PI, 10), dark, mc, [side * s.snoutR * 0.2, 0, 0], 1, [0, 0, Math.PI]);
    this.mouthClosed = mc;
    const mo = new THREE.Group();
    mo.position.copy(mc.position);
    mo.position.y -= s.snoutR * 0.15;
    sn.add(mo);
    k.mesh(k.sphereGeo(12), this.kit.mat('#5c1830', { finish: 'flat' }), mo, [0, 0, 0], [s.snoutR * 0.38, s.snoutR * 0.3, s.snoutR * 0.15]);
    k.mesh(k.sphereGeo(12), this.kit.mat('#ff7fa6', { finish: 'gloss' }), mo, [0, -s.snoutR * 0.2, s.snoutR * 0.08], [s.snoutR * 0.24, s.snoutR * 0.2, s.snoutR * 0.14]);
    this.mouthOpen = mo;
    // ojos brillantes
    const es = (s.eyeSize ?? 1) * s.headR;
    const eyeMat = this.kit.mat('#1e1422', { finish: 'eye' });
    const white = this.kit.mat('#ffffff', { finish: 'flat' });
    for (const side of [1, -1]) {
      const g = this.onHead(new THREE.Group(), side * 0.5, 0.08);
      const open = new THREE.Group();
      g.add(open);
      k.mesh(k.sphereGeo(16), eyeMat, open, [0, 0, 0], [es * 0.2, es * 0.23, es * 0.12]);
      k.mesh(k.sphereGeo(8), white, open, [-side * es * 0.06, es * 0.09, es * 0.1], es * 0.065);
      k.mesh(k.sphereGeo(8), white, open, [side * es * 0.05, -es * 0.08, es * 0.1], es * 0.03);
      this.eyesOpen.push(open);
      const closed = k.mesh(k.torusGeo(es * 0.15, es * 0.035, Math.PI, 12), dark, g, [0, es * 0.03, es * 0.05], 1, [0, 0, Math.PI]);
      closed.visible = false;
      closed.name = 'eyeClosed';
      this.eyesClosed.push(closed);
    }
    this.blushMat = this.kit.own(new THREE.MeshBasicMaterial({ color: '#ff7fb0', transparent: true, opacity: 0.3, depthWrite: false }));
    for (const side of [1, -1]) {
      const d = k.mesh(k.circleGeo(), this.blushMat, this.headCenter, undefined, [s.headR * 0.16, s.headR * 0.1, 1]);
      this.onHead(d, side * 0.75, -0.2, 0.004);
    }
    // cola
    this.tailBase.position.set(0, s.bodyR * 0.55 * bh, -s.bodyLen * 0.5 - s.bodyR * 0.2);
    this.body.add(this.tailBase);
    this.tailBase.add(this.tailPitch);
    this.buildEars();
    this.buildTail();
    this.headCenter.add(this.emote.group);
    this.emote.group.position.y = s.headR * 1.6 + (s.ears === 'bunnyUp' ? s.earSize * 1.2 : 0);
    return this;
  }

  /** Punto sobre la cabeza (yaw, pitch), orientado hacia fuera. */
  onHead<T extends THREE.Object3D>(obj: T, yaw: number, pitch: number, lift = 0): T {
    const s = this.spec;
    const hs = s.headScale ?? [1, 0.95, 0.95];
    const n = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    obj.position.set(n.x * s.headR * hs[0], n.y * s.headR * hs[1], n.z * s.headR * hs[2]).addScaledVector(n, lift);
    obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    this.headCenter.add(obj);
    return obj;
  }

  private buildEars() {
    const s = this.spec;
    const k = this.kit;
    const E = s.earSize;
    const main = this.furMat(s.colors.main);
    const earCol = this.mat(s.colors.second && (s.ears === 'tri' || s.ears === 'rose') ? s.colors.second : s.colors.main);
    const inner = this.mat(s.colors.innerEar ?? '#ffb3c7');
    for (const side of [1, -1]) {
      const g = new THREE.Group();
      this.headCenter.add(g);
      let rot: [number, number, number] = [0, 0, 0];
      switch (s.ears) {
        case 'bat': // chihuahua: orejas enormes de murciélago
        case 'cat':
        case 'tri': {
          const tall = s.ears === 'bat' ? 1.35 : s.ears === 'cat' ? 1.0 : 0.9;
          g.position.set(side * s.headR * 0.55, s.headR * 0.65, -s.headR * 0.05);
          rot = [-0.1, 0, side * (s.ears === 'bat' ? -0.75 : -0.35)];
          const geo = k.geo(`ear${s.ears}`, () => new THREE.ConeGeometry(1, 1, 4, 1));
          k.mesh(geo, s.ears === 'tri' ? earCol : main, g, [0, E * tall * 0.5, 0], [E * 0.6, E * tall, E * 0.22], [0, Math.PI / 4, 0]);
          k.mesh(geo, inner, g, [0, E * tall * 0.45, E * 0.07], [E * 0.4, E * tall * 0.75, E * 0.1], [0, Math.PI / 4, 0]);
          if (s.ears === 'tri') {
            // punta doblada del border collie
            k.mesh(geo, earCol, g, [0, E * 0.95, E * 0.12], [E * 0.28, E * 0.35, E * 0.12], [0.9, Math.PI / 4, 0]);
          }
          break;
        }
        case 'rose': {
          g.position.set(side * s.headR * 0.62, s.headR * 0.55, -s.headR * 0.1);
          rot = [0.4, 0, side * -1.2];
          k.mesh(k.sphereGeo(12), earCol, g, [0, E * 0.35, 0], [E * 0.45, E * 0.4, E * 0.14]);
          break;
        }
        case 'floppy':
        case 'poodle': {
          g.position.set(side * s.headR * 0.78, s.headR * 0.35, -s.headR * 0.05);
          rot = [0.1, 0, side * 0.15];
          if (s.ears === 'poodle') {
            for (let i = 0; i < 3; i++) k.mesh(k.sphereGeo(12), main, g, [side * E * 0.08, -E * (0.2 + i * 0.32), 0], E * (0.34 - i * 0.03));
          } else {
            k.mesh(k.capsuleGeo(E * 0.28, E * 0.9, 10), earCol, g, [0, -E * 0.55, 0], [1, 1, 0.45]);
          }
          break;
        }
        case 'bunnyUp':
        case 'bunnyLop': {
          const up = s.ears === 'bunnyUp';
          g.position.set(side * s.headR * 0.35, s.headR * 0.75, -s.headR * 0.15);
          rot = up ? [-0.15, 0, side * -0.18] : [0, 0, side * 2.4];
          k.mesh(k.capsuleGeo(E * 0.2, E * 1.1, 12), main, g, [0, E * 0.7, 0], [1, 1, 0.45]);
          k.mesh(k.capsuleGeo(E * 0.12, E * 0.85, 10), inner, g, [0, E * 0.7, E * 0.07], [1, 1, 0.3]);
          break;
        }
      }
      g.rotation.set(rot[0], rot[1], rot[2]);
      this.ears.push({ g, side, base: g.rotation.clone() });
    }
  }

  private buildTail() {
    const s = this.spec;
    const k = this.kit;
    const main = this.furMat(s.colors.main);
    const tipCol = this.mat(s.colors.second && s.tail === 'fluffy' ? '#ffffff' : s.colors.main);
    const L = s.tailLen;
    const add = (n: number, r0: number, r1: number, curl: number, tip?: THREE.Material, fluff = false) => {
      let parent: THREE.Object3D = this.tailPitch;
      const seg = L / n;
      for (let i = 0; i < n; i++) {
        const g = new THREE.Group();
        if (i > 0) g.position.y = -seg;
        const r = r0 + ((r1 - r0) * i) / Math.max(1, n - 1);
        const m = i === n - 1 && tip ? tip : main;
        if (fluff) k.mesh(k.capsuleGeo(r * 1.35, seg * 0.9, 10), m, g, [0, -seg / 2, 0]);
        else k.mesh(k.capsuleGeo(r, Math.max(0.004, seg - r * 0.5), 8), m, g, [0, -seg / 2, 0]);
        parent.add(g);
        this.tailSegs.push(g);
        parent = g;
      }
      this.tailCurl = curl;
    };
    switch (s.tail) {
      case 'curl': add(5, s.legR * 0.8, s.legR * 0.5, 0.45); break;
      case 'thin': add(5, s.legR * 0.7, s.legR * 0.35, 0.08); break;
      case 'whip': add(5, s.legR * 0.8, s.legR * 0.3, 0.05); break;
      case 'stub': add(1, s.legR * 1.1, s.legR, 0); break;
      case 'fluffy': add(5, s.legR * 1.3, s.legR * 1.1, 0.12, tipCol, true); break;
      case 'pompom':
        add(3, s.legR * 0.5, s.legR * 0.45, 0.05);
        k.mesh(k.sphereGeo(14), this.mat(s.colors.main, { finish: 'plush' }), this.tailSegs[this.tailSegs.length - 1], [0, -L / 3, 0], s.legR * 2.4);
        break;
      case 'cotton':
        add(1, 0.001, 0.001, 0);
        k.mesh(k.sphereGeo(14), this.mat('#ffffff', { finish: 'plush' }), this.tailSegs[0], [0, -0.01, 0], s.bodyR * 0.45);
        break;
    }
  }

  /** Mancha pálida de piel rasurada (en el flanco derecho y la pata delantera). */
  addShavedPatch(): void {
    const s = this.spec;
    const k = this.kit;
    const skin = k.mat('#f7d6d2', { finish: 'skin' });
    const bw = s.bodyW ?? 1;
    const p = k.mesh(k.sphereGeo(16), skin, this.body, [-s.bodyR * bw * 0.93, s.bodyR * 0.05, s.bodyLen * 0.05], [s.bodyR * 0.14, s.bodyR * 0.55, s.bodyLen * 0.2]);
    p.name = 'shaved';
    const leg = this.legs[1];
    k.mesh(k.capsuleGeo(s.legR * 1.08, s.legLen * 0.35, 10), skin, leg, [0, -s.legLen * 0.45, 0]);
  }

  /** Cono isabelino translúcido. */
  addCone(): void {
    const s = this.spec;
    const k = this.kit;
    const r0 = s.headR * 0.7;
    const r1 = s.headR * 1.55;
    const h = s.headR * 1.6 + s.snoutLen * 0.6;
    const g = k.own(new THREE.CylinderGeometry(r1, r0, h, 28, 1, true));
    const coneMat = k.own(new THREE.MeshPhysicalMaterial({ color: '#d8f2ff', transparent: true, opacity: 0.5, roughness: 0.1, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false }));
    const cone = new THREE.Mesh(g, coneMat);
    cone.name = 'cone';
    cone.rotation.x = Math.PI / 2 - 0.15;
    cone.position.set(0, -s.headR * 0.1, h * 0.35);
    this.head.add(cone);
    const rim = k.mesh(k.torusGeo(r1, s.headR * 0.06, Math.PI * 2, 32), k.mat('#9ff0d0', { finish: 'gloss' }), cone, [0, h / 2, 0], 1, [Math.PI / 2, 0, 0]);
    rim.castShadow = false;
    k.mesh(k.torusGeo(r0, s.headR * 0.08, Math.PI * 2, 24), k.mat('#ff8fc7', { finish: 'gloss' }), cone, [0, -h / 2, 0], 1, [Math.PI / 2, 0, 0]);
  }

  // ───────────── CharacterRig ─────────────

  setAnim(anim: CharacterAnim): void {
    if (anim === this.anim) return;
    this.anim = anim;
    this.animT = 0;
  }

  setBlush(v: number): void {
    if (this.blushMat) this.blushMat.opacity = 0.3 + clamp(v, 0, 1) * 0.6;
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
    computeAnimalPose(this.anim, this.t, this.animT, this.spec.style, this.target);
    blendAnimalPose(this.cur, this.target, this.first ? 1 : 1 - Math.exp(-dt * 12));
    this.first = false;
    const p = this.cur;
    const s = this.spec;
    const t = this.t;
    const j = p.shake ? Math.sin(t * 55) * p.shake : 0;
    const sitPitch = -p.sit * 0.5;
    this.body.position.y = this.bodyY + p.bob - p.sit * s.legLen * 0.45 - p.lie * (s.legLen * 0.75);
    this.body.position.x = j * 0.004;
    this.body.rotation.set(p.pitch + sitPitch, 0, p.roll + j * 0.03);
    this.head.rotation.set(p.headPitch - sitPitch * 0.8, p.headYaw, p.headTilt + j * 0.05);
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      const legPose = p.legs[i];
      const sitFix = front ? -sitPitch : 1.2 * p.sit;
      this.legs[i].rotation.x = -legPose + sitFix;
    }
    for (const e of this.ears) {
      e.g.rotation.x = e.base.x + (s.ears === 'floppy' || s.ears === 'poodle' ? -Math.abs(p.earFlap) * 0.6 : p.earFlap * 0.3);
      e.g.rotation.z = e.base.z + e.side * p.earFlap * (s.ears === 'floppy' || s.ears === 'poodle' ? 0.5 : 0.15);
    }
    // cola: meneo lateral + altura + rizo
    this.tailBase.rotation.y = p.tailWag;
    this.tailPitch.rotation.x = 1.55 + p.tailUp * 1.1;
    for (let i = 0; i < this.tailSegs.length; i++) {
      if (i === 0) continue;
      this.tailSegs[i].rotation.x = this.tailCurl + Math.sin(t * 4 + i) * 0.04;
      this.tailSegs[i].rotation.z = p.tailWag * 0.25;
    }
    if (this.mouthOpen && this.mouthClosed) {
      const open = p.mouthOpen > 0.35;
      this.mouthOpen.visible = open;
      this.mouthClosed.visible = !open;
      if (open) this.mouthOpen.scale.set(1, 0.6 + p.mouthOpen * 0.6, 1);
    }
    for (const e of this.eyesOpen) e.visible = p.eyesClosed < 0.5;
    for (const e of this.eyesClosed) e.visible = p.eyesClosed >= 0.5;
    this.emote.update(dt);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.emote.dispose();
    this.kit.dispose();
  }
}
