/**
 * Kit de construcción de personajes: materiales tipo vinilo, geometrías cacheadas y
 * registro de recursos para liberarlos en dispose(). Cada rig tiene su propio Kit.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type Finish = 'vinyl' | 'gloss' | 'skin' | 'cloth' | 'metal' | 'plush' | 'eye' | 'flat' | 'glass';

export interface MatOpts {
  finish?: Finish;
  opacity?: number;
  side?: THREE.Side;
  map?: THREE.Texture | null;
  emissive?: string;
  emissiveIntensity?: number;
}

export class Kit {
  private mats = new Map<string, THREE.Material>();
  private geos = new Map<string, THREE.BufferGeometry>();
  private owned: Array<{ dispose(): void }> = [];

  /** Material cacheado por color y acabado. */
  mat(color: string, o: MatOpts = {}): THREE.Material {
    const finish = o.finish ?? 'vinyl';
    const key = `${color}|${finish}|${o.opacity ?? 1}|${o.side ?? 0}|${o.map?.uuid ?? ''}|${o.emissive ?? ''}`;
    let m = this.mats.get(key);
    if (m) return m;
    const c = new THREE.Color(color);
    const transparent = (o.opacity ?? 1) < 1;
    if (finish === 'flat') {
      m = new THREE.MeshBasicMaterial({ color: c, transparent, opacity: o.opacity ?? 1, side: o.side ?? THREE.FrontSide, depthWrite: !transparent, map: o.map ?? null });
    } else {
      const p = new THREE.MeshPhysicalMaterial({
        color: c,
        map: o.map ?? null,
        transparent,
        opacity: o.opacity ?? 1,
        side: o.side ?? THREE.FrontSide,
        depthWrite: !transparent,
      });
      // leve autoiluminación del propio color: sombras suaves, aspecto pastel "toon"
      p.emissive = o.emissive ? new THREE.Color(o.emissive) : c.clone();
      // con textura, la autoiluminación usa la misma textura para no lavar el dibujo
      if (o.map && !o.emissive) p.emissiveMap = o.map;
      p.emissiveIntensity = o.emissiveIntensity ?? (o.emissive ? 1 : 0.14);
      switch (finish) {
        case 'vinyl':
          p.roughness = 0.42; p.clearcoat = 0.7; p.clearcoatRoughness = 0.28; break;
        case 'gloss':
          p.roughness = 0.18; p.clearcoat = 1; p.clearcoatRoughness = 0.04; p.emissiveIntensity = o.emissiveIntensity ?? 0.1; break;
        case 'skin':
          p.roughness = 0.55; p.clearcoat = 0.35; p.clearcoatRoughness = 0.5;
          p.sheen = 0.5; p.sheenColor = new THREE.Color('#ffc2c8'); p.sheenRoughness = 0.6;
          p.emissiveIntensity = o.emissiveIntensity ?? 0.2; break;
        case 'cloth':
          p.roughness = 0.88; p.sheen = 0.6; p.sheenColor = c.clone().offsetHSL(0, 0, 0.25); p.sheenRoughness = 0.8;
          p.emissiveIntensity = o.emissiveIntensity ?? 0.16; break;
        case 'plush':
          p.roughness = 1; p.sheen = 1; p.sheenColor = new THREE.Color('#ffffff'); p.sheenRoughness = 0.4;
          p.emissiveIntensity = o.emissiveIntensity ?? 0.22; break;
        case 'metal':
          p.metalness = 1; p.roughness = 0.22; p.clearcoat = 0.5; p.emissiveIntensity = o.emissiveIntensity ?? 0.25; break;
        case 'eye':
          p.roughness = 0.08; p.clearcoat = 1; p.clearcoatRoughness = 0.02; p.emissiveIntensity = 0; break;
        case 'glass':
          p.roughness = 0.05; p.transmission = 0; p.clearcoat = 1; p.emissiveIntensity = o.emissiveIntensity ?? 0.05; break;
      }
      m = p;
    }
    this.mats.set(key, m);
    return m;
  }

  /** Material propio (no cacheado): p. ej. rubor con opacidad variable. */
  own<T extends { dispose(): void }>(x: T): T {
    this.owned.push(x);
    return x;
  }

  geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.geos.get(key);
    if (!g) {
      g = make();
      this.geos.set(key, g);
    }
    return g;
  }

  sphereGeo(seg = 18): THREE.BufferGeometry {
    return this.geo(`sphere${seg}`, () => new THREE.SphereGeometry(1, seg, Math.round(seg * 0.7)));
  }

  capsuleGeo(r: number, len: number, radial = 12): THREE.BufferGeometry {
    return this.geo(`cap${r.toFixed(3)}_${len.toFixed(3)}_${radial}`, () => new THREE.CapsuleGeometry(r, len, 4, radial));
  }

  cylGeo(rt: number, rb: number, h: number, seg = 16, open = false): THREE.BufferGeometry {
    return this.geo(`cyl${rt.toFixed(3)}_${rb.toFixed(3)}_${h.toFixed(3)}_${seg}_${open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open));
  }

  torusGeo(r: number, tube: number, arc = Math.PI * 2, seg = 24): THREE.BufferGeometry {
    return this.geo(`tor${r.toFixed(3)}_${tube.toFixed(3)}_${arc.toFixed(3)}_${seg}`, () => new THREE.TorusGeometry(r, tube, 8, seg, arc));
  }

  boxGeo(w: number, h: number, d: number): THREE.BufferGeometry {
    return this.geo(`box${w}_${h}_${d}`, () => new THREE.BoxGeometry(w, h, d));
  }

  circleGeo(seg = 20): THREE.BufferGeometry {
    return this.geo(`circle${seg}`, () => new THREE.CircleGeometry(1, seg));
  }

  /** Crea una malla hija con posición/rotación/escala opcionales. */
  mesh(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    parent: THREE.Object3D,
    pos?: [number, number, number],
    scl?: [number, number, number] | number,
    rot?: [number, number, number],
  ): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    if (pos) m.position.set(pos[0], pos[1], pos[2]);
    if (scl !== undefined) {
      if (typeof scl === 'number') m.scale.setScalar(scl);
      else m.scale.set(scl[0], scl[1], scl[2]);
    }
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  /** Esfera escalada (elipsoide) como hija. */
  ball(color: string, parent: THREE.Object3D, pos: [number, number, number], r: [number, number, number] | number, o: MatOpts = {}, rot?: [number, number, number]) {
    return this.mesh(this.sphereGeo(), this.mat(color, o), parent, pos, r, rot);
  }

  /** Cápsula entre dos puntos locales del padre. */
  limb(color: string, parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r: number, o: MatOpts = {}) {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = Math.max(0.001, d.length());
    const m = this.mesh(this.capsuleGeo(r, len), this.mat(color, o), parent);
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    return m;
  }

  /** Tubo por una curva (correas, cables, estetoscopio). */
  tube(color: string, parent: THREE.Object3D, pts: THREE.Vector3[], r: number, o: MatOpts = {}, closed = false) {
    const curve = new THREE.CatmullRomCurve3(pts, closed, 'catmullrom', 0.5);
    const g = this.own(new THREE.TubeGeometry(curve, Math.max(10, pts.length * 6), r, 6, closed));
    return this.mesh(g, this.mat(color, o), parent);
  }

  dispose(): void {
    for (const m of this.mats.values()) {
      const mm = m as THREE.MeshPhysicalMaterial;
      mm.dispose();
    }
    for (const g of this.geos.values()) g.dispose();
    for (const x of this.owned) x.dispose();
    this.mats.clear();
    this.geos.clear();
    this.owned.length = 0;
  }
}

/**
 * Perfil de revolución suave (radio en función de y) → LatheGeometry.
 * points: pares [y, r] de abajo arriba. Opcionalmente abre un hueco frontal (batas abiertas).
 */
export function latheProfile(points: Array<[number, number]>, segments = 28, opts: { gapDeg?: number; samples?: number } = {}): THREE.LatheGeometry {
  const ctrl = points.map(([y, r]) => new THREE.Vector2(r, y));
  const curve = new THREE.SplineCurve(ctrl);
  const pts = curve.getPoints(opts.samples ?? Math.max(16, points.length * 6)).map((p) => new THREE.Vector2(Math.max(0.0005, p.x), p.y));
  const gap = ((opts.gapDeg ?? 0) * Math.PI) / 180;
  // LatheGeometry: phi = 0 apunta a +Z; el hueco queda centrado en el frente
  const g = new THREE.LatheGeometry(pts, segments, gap / 2, Math.PI * 2 - gap);
  return g;
}

/**
 * Abulta los vértices del frente (+Z) de una geometría: barriga suave, pecho, etc.
 * amount en metros, centrada en y con semialtura h.
 */
export function bulgeFront(g: THREE.BufferGeometry, y: number, h: number, amount: number, widthFalloff = 1.4): void {
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const r = Math.hypot(px, pz);
    if (r < 1e-5) continue;
    const front = Math.max(0, pz / r); // coseno respecto a +Z
    const dy = (py - y) / h;
    const w = Math.exp(-dy * dy * 2) * Math.pow(front, widthFalloff);
    const k = 1 + (amount * w) / r;
    pos.setX(i, px * (1 + (k - 1) * 0.35));
    pos.setZ(i, pz * k);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
}

/** Desplaza vértices al azar de forma determinista (arrugas del aluminio, pelo rizado). */
export function crumple(g: THREE.BufferGeometry, amount: number, seed = 1): void {
  const pos = g.attributes.position as THREE.BufferAttribute;
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return (s / 2147483647) * 2 - 1;
  };
  // mismas posiciones → mismo desplazamiento (evita grietas en costuras)
  const cache = new Map<string, [number, number, number]>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    let d = cache.get(key);
    if (!d) {
      d = [rnd() * amount, rnd() * amount, rnd() * amount];
      cache.set(key, d);
    }
    pos.setXYZ(i, pos.getX(i) + d[0], pos.getY(i) + d[1], pos.getZ(i) + d[2]);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
}

/**
 * Fusiona las mallas estáticas hermanas que comparten material (mismo padre) en una sola:
 * reduce muchísimo las llamadas de dibujo. Respeta las mallas con nombre (se animan o se
 * muestran/ocultan), las transparentes y las que tienen hijos.
 */
export function mergeStatic(root: THREE.Object3D, kit: Kit): number {
  let saved = 0;
  const parents: THREE.Object3D[] = [];
  root.traverse((o) => parents.push(o));
  for (const parent of parents) {
    const byMat = new Map<THREE.Material, THREE.Mesh[]>();
    for (const c of parent.children) {
      const m = c as THREE.Mesh;
      if (!m.isMesh || m.name || m.children.length || !m.visible) continue;
      const mat = m.material as THREE.Material;
      if (Array.isArray(mat) || mat.transparent) continue;
      const list = byMat.get(mat) ?? [];
      list.push(m);
      byMat.set(mat, list);
    }
    for (const [mat, list] of byMat) {
      if (list.length < 2) continue;
      const geos: THREE.BufferGeometry[] = [];
      for (const m of list) {
        m.updateMatrix();
        let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        g.clearGroups();
        g.applyMatrix4(m.matrix);
        geos.push(g);
      }
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      kit.own(merged);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      parent.add(mesh);
      for (const m of list) parent.remove(m);
      saved += list.length - 1;
    }
  }
  return saved;
}

/** Las piezas diminutas (rasgos de la cara, botones...) no proyectan sombra: ahorra pasadas de sombra. */
export function trimShadows(root: THREE.Object3D, minRadius = 0.035): void {
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    const r = (m.geometry.boundingSphere?.radius ?? 1) * m.matrixWorld.getMaxScaleOnAxis();
    if (r < minRadius) m.castShadow = false;
  });
}
