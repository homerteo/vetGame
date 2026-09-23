/**
 * Actor: envuelve un CharacterRig con posición, desplazamiento a puntos, giro suave
 * y animación sin repeticiones. Funciona con cualquier rig que cumpla el contrato.
 */
import * as THREE from 'three';
import type { CharacterAnim, CharacterRig, Emote } from '../../core/contracts';

const TURN_RATE = 9; // rad/s aprox. (suavizado exponencial)

export class Actor {
  readonly pos = new THREE.Vector3();
  readonly home = new THREE.Vector3();
  private target = new THREE.Vector3();
  private hasTarget = false;
  private speed = 1.1;
  private look = new THREE.Vector3();
  private yaw = 0;
  private yawOffset = 0;
  private anim: CharacterAnim | null = null;
  private emote: Emote = null;
  private tmp = new THREE.Vector3();

  constructor(readonly rig: CharacterRig, parent: THREE.Object3D, home: THREE.Vector3, lookAt: THREE.Vector3) {
    this.home.copy(home);
    this.pos.copy(home);
    this.look.copy(lookAt);
    parent.add(rig.root);
    rig.root.position.copy(home);
    this.yaw = this.yawTo(lookAt);
    rig.root.rotation.y = this.yaw;
  }

  private yawTo(p: THREE.Vector3): number {
    return Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
  }

  setAnim(a: CharacterAnim): void {
    if (a === this.anim) return;
    this.anim = a;
    this.rig.setAnim(a);
  }

  setEmote(e: Emote): void {
    if (e === this.emote) return;
    this.emote = e;
    this.rig.setEmote(e);
  }

  /** Mira a un punto (con giro extra opcional, p. ej. darse la vuelta para la selfie). */
  lookAt(p: THREE.Vector3, offset = 0): void {
    this.look.copy(p);
    this.yawOffset = offset;
  }

  moveTo(p: THREE.Vector3, speed: number): void {
    this.target.copy(p);
    this.hasTarget = true;
    this.speed = speed;
  }

  goHome(speed = 1.1): void {
    this.moveTo(this.home, speed);
  }

  stop(): void {
    this.hasTarget = false;
  }

  get moving(): boolean {
    return this.hasTarget;
  }

  distTo(p: THREE.Vector3): number {
    this.tmp.subVectors(p, this.pos);
    this.tmp.y = 0;
    return this.tmp.length();
  }

  atHome(eps = 0.08): boolean {
    return this.distTo(this.home) < eps;
  }

  update(dt: number): void {
    let desired: number;
    if (this.hasTarget) {
      this.tmp.subVectors(this.target, this.pos);
      this.tmp.y = 0;
      const d = this.tmp.length();
      const stepLen = this.speed * dt;
      if (d <= Math.max(0.02, stepLen)) {
        this.pos.x = this.target.x;
        this.pos.z = this.target.z;
        this.hasTarget = false;
        desired = this.yawTo(this.look) + this.yawOffset;
      } else {
        this.pos.addScaledVector(this.tmp, stepLen / d);
        desired = Math.atan2(this.tmp.x, this.tmp.z);
      }
    } else desired = this.yawTo(this.look) + this.yawOffset;
    let diff = desired - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * (1 - Math.exp(-TURN_RATE * dt));
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
    this.rig.update(dt);
  }

  dispose(): void {
    this.rig.root.removeFromParent();
    this.rig.dispose();
  }
}
