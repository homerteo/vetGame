/**
 * Emotes flotantes (sprites) sobre la cabeza: corazones, sudor, enfado, notas, estrellas, zzz.
 * Tres sprites reutilizables; texturas compartidas.
 */
import * as THREE from 'three';
import type { Emote } from '../core/contracts';
import { emoteTexture } from './textures';

const N = 3;

export class EmoteDisplay {
  readonly group = new THREE.Group();
  private sprites: THREE.Sprite[] = [];
  private mats: THREE.SpriteMaterial[] = [];
  private kind: Emote = null;
  private t = 0;
  private fade = 0;

  constructor(private size = 0.16) {
    this.group.name = 'emote';
    for (let i = 0; i < N; i++) {
      const m = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, opacity: 0 });
      const s = new THREE.Sprite(m);
      s.visible = false;
      s.renderOrder = 10;
      this.mats.push(m);
      this.sprites.push(s);
      this.group.add(s);
    }
  }

  get current(): Emote {
    return this.kind;
  }

  set(kind: Emote): void {
    if (kind === this.kind) return;
    this.kind = kind;
    this.t = 0;
    this.fade = 0;
    for (let i = 0; i < N; i++) {
      const s = this.sprites[i];
      s.visible = kind !== null;
      if (kind) this.mats[i].map = emoteTexture(kind);
      this.mats[i].needsUpdate = true;
    }
  }

  update(dt: number): void {
    if (!this.kind) return;
    this.t += dt;
    this.fade = Math.min(1, this.fade + dt * 5);
    const t = this.t;
    const S = this.size;
    for (let i = 0; i < N; i++) {
      const s = this.sprites[i];
      const m = this.mats[i];
      const ph = (t * 0.7 + i / N) % 1; // ciclo 0..1 escalonado
      let x = 0, y = 0, z = 0, sc = S, op = 1;
      switch (this.kind) {
        case 'hearts':
          x = Math.sin(t * 3 + i * 2) * 0.08 + (i - 1) * 0.1;
          y = ph * 0.35;
          sc = S * (0.7 + 0.5 * Math.sin(ph * Math.PI));
          op = Math.sin(ph * Math.PI);
          break;
        case 'sweat':
          if (i > 1) { op = 0; break; }
          x = (i === 0 ? 1 : -1) * 0.2;
          y = -0.02 - ((t * 0.9 + i * 0.5) % 1) * 0.12;
          sc = S * 0.75;
          op = 1 - ((t * 0.9 + i * 0.5) % 1) * 0.8;
          break;
        case 'anger':
          if (i > 0) { op = 0; break; }
          x = 0.16;
          y = 0.12;
          sc = S * (1 + 0.18 * Math.abs(Math.sin(t * 7)));
          break;
        case 'music':
          x = (i % 2 === 0 ? 1 : -1) * (0.1 + ph * 0.12);
          y = ph * 0.3;
          sc = S * 0.85;
          op = Math.sin(ph * Math.PI);
          break;
        case 'stars': {
          const a = t * 2.4 + (i * Math.PI * 2) / N;
          x = Math.cos(a) * 0.2;
          z = Math.sin(a) * 0.2;
          y = 0.02 + Math.sin(t * 5 + i) * 0.02;
          sc = S * 0.7;
          break;
        }
        case 'zzz':
          x = 0.08 + ph * 0.16;
          y = ph * 0.3;
          sc = S * (0.5 + ph * 0.6);
          op = Math.sin(ph * Math.PI);
          break;
      }
      s.position.set(x, y, z);
      s.scale.setScalar(sc);
      m.opacity = op * this.fade;
    }
  }

  dispose(): void {
    for (const m of this.mats) m.dispose();
  }
}
