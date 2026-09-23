/** Partículas kawaii (corazones, estrellas, vapor, notas...) en un grupo reutilizable y marcador de objetivo. */
import * as THREE from 'three';
import { particleTextures, type ParticleKind } from './textures';

interface P {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  life: number;
  max: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  grow: number;
  gravity: number;
  spin: number;
}

export function createParticles(parent: THREE.Object3D, capacity = 90) {
  const texs = particleTextures();
  const group = new THREE.Group();
  group.name = 'clinic-fx';
  parent.add(group);
  const pool: P[] = [];
  for (let i = 0; i < capacity; i++) {
    const mat = new THREE.SpriteMaterial({ map: texs.heart, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.visible = false;
    group.add(sprite);
    pool.push({ sprite, mat, life: 0, max: 1, vx: 0, vy: 0, vz: 0, size: 0.3, grow: 0, gravity: 0, spin: 0 });
  }
  let cursor = 0;

  function spawn(kind: ParticleKind, x: number, y: number, z: number, o: { vx?: number; vy?: number; vz?: number; life?: number; size?: number; grow?: number; gravity?: number; spin?: number } = {}): void {
    const p = pool[cursor];
    cursor = (cursor + 1) % pool.length;
    p.mat.map = texs[kind];
    p.mat.opacity = 1;
    p.mat.rotation = 0;
    p.sprite.position.set(x, y, z);
    p.vx = o.vx ?? 0;
    p.vy = o.vy ?? 0.6;
    p.vz = o.vz ?? 0;
    p.life = p.max = o.life ?? 1.2;
    p.size = o.size ?? 0.3;
    p.grow = o.grow ?? 0;
    p.gravity = o.gravity ?? 0;
    p.spin = o.spin ?? 0;
    p.sprite.scale.set(p.size, p.size, 1);
    p.sprite.visible = true;
  }

  /** Ráfaga radial de n partículas. */
  function burst(kind: ParticleKind, x: number, y: number, z: number, n: number, speed = 1.5, o: { life?: number; size?: number; gravity?: number; up?: number } = {}): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const s = speed * (0.6 + Math.random() * 0.6);
      spawn(kind, x, y, z, {
        vx: Math.cos(a) * s,
        vz: Math.sin(a) * s,
        vy: (o.up ?? 1.2) * (0.7 + Math.random() * 0.6),
        life: o.life ?? 0.9,
        size: o.size ?? 0.25,
        gravity: o.gravity ?? 3,
        spin: (Math.random() - 0.5) * 6,
      });
    }
  }

  function update(dt: number): void {
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.sprite.visible = false;
        continue;
      }
      p.vy -= p.gravity * dt;
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.y += p.vy * dt;
      p.sprite.position.z += p.vz * dt;
      p.size += p.grow * dt;
      const k = p.life / p.max;
      p.sprite.scale.set(p.size, p.size, 1);
      p.mat.opacity = Math.min(1, k * 2.5);
      p.mat.rotation += p.spin * dt;
    }
  }

  function dispose(): void {
    for (const p of pool) p.mat.dispose();
    for (const t of Object.values(texs)) t.dispose();
    group.removeFromParent();
  }

  return { spawn, burst, update, dispose };
}
export type Particles = ReturnType<typeof createParticles>;

/** Flecha rosa que rebota sobre el objetivo + aro en el suelo. */
export function createObjectiveMarker(parent: THREE.Object3D) {
  const g = new THREE.Group();
  const coneGeo = new THREE.ConeGeometry(0.2, 0.42, 20);
  const mat = new THREE.MeshStandardMaterial({ color: '#ff2e93', emissive: new THREE.Color('#ff2e93'), emissiveIntensity: 0.55, roughness: 0.3 });
  const cone = new THREE.Mesh(coneGeo, mat);
  cone.rotation.x = Math.PI;
  g.add(cone);
  const ringGeo = new THREE.RingGeometry(0.55, 0.68, 40);
  const ringMat = new THREE.MeshBasicMaterial({ color: '#ff2e93', transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  parent.add(g, ring);
  let urgent = false;

  // aro de alcance del placaje alrededor de Panchito
  const tRingGeo = new THREE.RingGeometry(1.1, 1.2, 40);
  const tRingMat = new THREE.MeshBasicMaterial({ color: '#ffd84d', transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
  const tRing = new THREE.Mesh(tRingGeo, tRingMat);
  tRing.rotation.x = -Math.PI / 2;
  tRing.visible = false;
  parent.add(tRing);

  return {
    set(pos: { x: number; y: number; z: number } | null, isUrgent = false) {
      g.visible = ring.visible = !!pos;
      urgent = isUrgent;
      if (pos) {
        g.position.set(pos.x, pos.y, pos.z);
        ring.position.set(pos.x, 0.02, pos.z);
      }
    },
    setTackleRing(pos: { x: number; z: number } | null, inRange: boolean) {
      tRing.visible = !!pos;
      if (pos) tRing.position.set(pos.x, 0.03, pos.z);
      tRingMat.color.set(inRange ? '#3fcf9c' : '#ffd84d');
    },
    update(t: number) {
      const base = g.position.y;
      cone.position.y = Math.abs(Math.sin(t * 3.2)) * 0.25;
      cone.rotation.y = t * 2;
      const c = urgent ? '#ff4d6d' : '#ff2e93';
      mat.color.set(c);
      mat.emissive.set(c);
      const s = 1 + Math.sin(t * 4) * 0.08;
      ring.scale.set(s, s, 1);
      ringMat.opacity = 0.35 + Math.sin(t * 4) * 0.15;
      void base;
    },
    dispose() {
      coneGeo.dispose();
      mat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      tRingGeo.dispose();
      tRingMat.dispose();
      g.removeFromParent();
      ring.removeFromParent();
      tRing.removeFromParent();
    },
  };
}
