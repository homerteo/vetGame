/**
 * Clínica kawaii construida con primitivas: suelos con baldosas pastel, tabiques de maqueta,
 * carteles con chistes, mobiliario y aparatos. Devuelve colisionadores y manejadores animables.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng } from '../../core/rng';
import { POSTERS } from '../lines';
import { PUDDLES, ROOMS, SEATS, STATIONS, WALLS, WALL_THICK, type RoomId } from '../logic/layout';
import { wallColliders, type Collider } from '../logic/movement';
import { floorTexture, foilTexture, hazardTexture, labelTexture, posterTexture, puddleTexture, signTexture } from './textures';

export interface LevelHandles {
  root: THREE.Group;
  colliders: Collider[];
  /** Charcos activos (fijos + tila derramada). */
  puddles: Array<{ x: number; z: number; r: number }>;
  addPuddle(x: number, z: number, r: number): void;
  setLightboxImage(c: HTMLCanvasElement | null): void;
  setFoil(device: 'lightbox' | 'autoclave', on: boolean): void;
  setAutoclave(state: 'idle' | 'working' | 'blocked' | 'full'): void;
  setOrDoorReady(ready: boolean): void;
  setOrDoorOpen(t: number): void;
  setClipperActive(on: boolean): void;
  setRingLight(on: boolean): void;
  setCarrierOpen(open: boolean): void;
  /** Punto 3D (mundo) donde sale el vapor del autoclave. */
  steamOrigin: THREE.Vector3;
  examTop: THREE.Vector3;
  prepTop: THREE.Vector3;
  update(dt: number, t: number): void;
  dispose(): void;
}

type MatOpts = { rough?: number; metal?: number; clearcoat?: number; emissive?: string; emissiveIntensity?: number; transparent?: boolean; opacity?: number; map?: THREE.Texture };

/** Fusiona las mallas estáticas (sin ancestro con userData.dynamic) en una malla por material y sombra. */
function batchStatic(root: THREE.Group, owned: THREE.BufferGeometry[]): void {
  root.updateMatrixWorld(true);
  const buckets = new Map<string, { mat: THREE.Material; cast: boolean; recv: boolean; geos: THREE.BufferGeometry[] }>();
  const remove: THREE.Mesh[] = [];
  const keep = new Set(['position', 'normal', 'uv']);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material)) return;
    for (let p: THREE.Object3D | null = m; p && p !== root; p = p.parent) if (p.userData.dynamic) return;
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (!keep.has(name)) g.deleteAttribute(name);
    if (!g.attributes.uv || !g.attributes.normal) return;
    g.applyMatrix4(m.matrixWorld);
    const key = `${m.material.uuid}|${m.castShadow ? 1 : 0}|${m.receiveShadow ? 1 : 0}`;
    let b = buckets.get(key);
    if (!b) {
      b = { mat: m.material, cast: m.castShadow, recv: m.receiveShadow, geos: [] };
      buckets.set(key, b);
    }
    b.geos.push(g);
    remove.push(m);
  });
  for (const m of remove) m.removeFromParent();
  for (const b of buckets.values()) {
    const merged = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false);
    if (b.geos.length > 1) for (const g of b.geos) g.dispose();
    if (!merged) continue;
    owned.push(merged);
    const mesh = new THREE.Mesh(merged, b.mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.recv;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    root.add(mesh);
  }
  root.updateMatrixWorld(true);
}

export function buildLevel(): LevelHandles {
  const root = new THREE.Group();
  root.name = 'clinic-level';
  const disposables: Array<{ dispose(): void }> = [];
  const matCache = new Map<string, THREE.Material>();
  const rng = createRng(20240);

  const mat = (color: string, o: MatOpts = {}): THREE.MeshStandardMaterial => {
    const key = `${color}|${o.rough ?? 0.55}|${o.metal ?? 0}|${o.clearcoat ?? 0}|${o.emissive ?? ''}|${o.emissiveIntensity ?? 0}|${o.opacity ?? 1}|${o.map?.uuid ?? ''}`;
    const hit = matCache.get(key);
    if (hit) return hit as THREE.MeshStandardMaterial;
    const params = {
      color,
      roughness: o.rough ?? 0.55,
      metalness: o.metal ?? 0,
      emissive: new THREE.Color(o.emissive ?? '#000000'),
      emissiveIntensity: o.emissiveIntensity ?? (o.emissive ? 1 : 0),
      transparent: o.transparent ?? (o.opacity !== undefined && o.opacity < 1),
      opacity: o.opacity ?? 1,
      map: o.map ?? null,
    };
    const m = o.clearcoat ? new THREE.MeshPhysicalMaterial({ ...params, clearcoat: o.clearcoat, clearcoatRoughness: 0.15 }) : new THREE.MeshStandardMaterial(params);
    matCache.set(key, m);
    return m;
  };
  const vinyl = (color: string) => mat(color, { rough: 0.35, clearcoat: 0.8 });
  const steel = mat('#dfe6ee', { rough: 0.28, metal: 0.75 });
  const white = mat('#fffafd', { rough: 0.5 });

  const geoms: THREE.BufferGeometry[] = [];
  const G = <T extends THREE.BufferGeometry>(g: T): T => {
    geoms.push(g);
    return g;
  };
  const rbox = (w: number, h: number, d: number, r = 0.06) => G(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)));
  const boxG = (w: number, h: number, d: number) => G(new THREE.BoxGeometry(w, h, d));
  const cylG = (rt: number, rb: number, h: number, seg = 20) => G(new THREE.CylinderGeometry(rt, rb, h, seg));
  const sphG = (r: number, ws = 16, hs = 12) => G(new THREE.SphereGeometry(r, ws, hs));

  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = root, shadow = true) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    o.castShadow = shadow;
    o.receiveShadow = true;
    parent.add(o);
    return o;
  };
  const group = (x = 0, y = 0, z = 0, ry = 0, parent: THREE.Object3D = root) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = ry;
    parent.add(g);
    return g;
  };
  const texs: THREE.Texture[] = [];
  const T = <X extends THREE.Texture>(t: X): X => {
    texs.push(t);
    return t;
  };
  const colliders: Collider[] = wallColliders();
  const boxCol = (cx: number, cz: number, w: number, d: number) => colliders.push({ kind: 'box', minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
  const circCol = (x: number, z: number, r: number) => colliders.push({ kind: 'circle', x, z, r });

  // ── Suelo exterior (la maqueta flota sobre una alfombra lila con lunares) ──
  {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#5a3470';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#6b3f84';
    for (const [x, y] of [
      [32, 32],
      [96, 96],
      [96, 32],
      [32, 96],
    ])
      g.beginPath(), g.arc(x, y, 9, 0, Math.PI * 2), g.fill();
    const t = T(new THREE.CanvasTexture(c));
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(30, 30);
    const ground = mesh(G(new THREE.PlaneGeometry(90, 90)), new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 }), 0, -0.02, 0, root, false);
    disposables.push(ground.material as THREE.Material);
    ground.rotation.x = -Math.PI / 2;
    // zócalo de la maqueta
    mesh(rbox(26.6, 0.4, 16.6, 0.15), mat('#ffb3d9', { rough: 0.6 }), 0, -0.21, 0, root, false);
  }

  // ── Suelos por sala ──
  const floorStyle: Record<RoomId, [string, string, 'checker' | 'plain' | 'dots']> = {
    waiting: ['#ffc9e3', '#ffeef6', 'checker'],
    corridor: ['#ffe2c2', '#ffd3a8', 'plain'],
    autoclave: ['#c6e8ff', '#e6f5ff', 'checker'],
    exam: ['#bff5e2', '#e6fff5', 'checker'],
    prep: ['#dcc6ff', '#f1e8ff', 'checker'],
    or: ['#e8fff6', '#a8efd3', 'dots'],
  };
  let seed = 1;
  for (const id of Object.keys(ROOMS) as RoomId[]) {
    const r = ROOMS[id];
    const [a, b, pat] = floorStyle[id];
    const w = r.maxX - r.minX;
    const d = r.maxZ - r.minZ;
    const t = T(floorTexture(a, b, pat, undefined, seed++));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(w / 2, d / 2);
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.42, metalness: 0 });
    disposables.push(m);
    const f = mesh(G(new THREE.PlaneGeometry(w, d)), m, (r.minX + r.maxX) / 2, 0.001, (r.minZ + r.maxZ) / 2, root, false);
    f.rotation.x = -Math.PI / 2;
  }
  // franjas de aviso en los umbrales estériles
  {
    const ht = T(hazardTexture());
    const hm = new THREE.MeshStandardMaterial({ map: ht, roughness: 0.6 });
    disposables.push(hm);
    const strips: Array<[number, number, number]> = [
      [-0.5, -2.35, 0],
      [8.5, -2.35, 0],
      [5.35, 4.5, Math.PI / 2],
    ];
    for (const [x, z, ry] of strips) {
      const s = mesh(G(new THREE.PlaneGeometry(2, 0.3)), hm, x, 0.004, z, root, false);
      s.rotation.x = -Math.PI / 2;
      s.rotation.z = ry;
    }
  }
  // alfombra redonda de la sala de espera
  {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const cols = ['#c8a2e8', '#ffd6ec', '#9ff0d0', '#ffd6ec', '#c8a2e8'];
    cols.forEach((col, i) => {
      g.fillStyle = col;
      g.beginPath();
      g.arc(128, 128, 126 - i * 24, 0, Math.PI * 2);
      g.fill();
    });
    g.fillStyle = '#ff8fc7';
    g.translate(128, 128);
    for (let i = 0; i < 8; i++) {
      g.rotate(Math.PI / 4);
      g.beginPath();
      g.arc(0, -96, 7, 0, Math.PI * 2);
      g.fill();
    }
    const t = T(new THREE.CanvasTexture(c));
    t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.95, transparent: true, alphaTest: 0.5 });
    disposables.push(m);
    const rug = mesh(G(new THREE.CircleGeometry(2.1, 40)), m, -6.4, 0.006, 2.6, root, false);
    rug.rotation.x = -Math.PI / 2;
  }

  // ── Tabiques ──
  const wallLow = mat('#ffd3e8', { rough: 0.6 });
  const wallBand = mat('#cfa8f5', { rough: 0.6 });
  const wallCap = mat('#ff8fc7', { rough: 0.35, clearcoat: 0.6 });
  const northWall = mat('#ffe3f1', { rough: 0.7 });
  for (const w of WALLS) {
    const horiz = w.z1 === w.z2;
    const len = horiz ? Math.abs(w.x2 - w.x1) : Math.abs(w.z2 - w.z1);
    const cx = (w.x1 + w.x2) / 2;
    const cz = (w.z1 + w.z2) / 2;
    const g = group(cx, 0, cz, horiz ? 0 : Math.PI / 2);
    const tall = w.h > 2;
    const band = Math.min(0.5, w.h * 0.4);
    mesh(boxG(len + WALL_THICK, band, WALL_THICK), wallBand, 0, band / 2, 0, g);
    mesh(boxG(len + WALL_THICK, w.h - band, WALL_THICK), tall ? northWall : wallLow, 0, band + (w.h - band) / 2, 0, g);
    const cap = mesh(cylG(WALL_THICK * 0.62, WALL_THICK * 0.62, len + WALL_THICK, 10), wallCap, 0, w.h, 0, g, false);
    cap.rotation.z = Math.PI / 2;
  }
  // ventanas redondas del muro norte (cielo pastel)
  {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const gr = g.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, '#9fd8ff');
    gr.addColorStop(1, '#ffd6f0');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (const [x, y, r] of [
      [40, 52, 16],
      [58, 46, 20],
      [78, 54, 14],
    ])
      g.beginPath(), g.arc(x, y, r, 0, Math.PI * 2), g.fill();
    const t = T(new THREE.CanvasTexture(c));
    t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.MeshStandardMaterial({ map: t, emissive: new THREE.Color('#ffffff'), emissiveMap: t, emissiveIntensity: 0.55 });
    disposables.push(m);
    for (const x of [-10.8, -1.6, 11.3]) {
      const win = mesh(G(new THREE.CircleGeometry(0.55, 32)), m, x, 2.35, -8 + WALL_THICK / 2 + 0.01, root, false);
      const frame = mesh(G(new THREE.TorusGeometry(0.58, 0.07, 10, 32)), wallCap, x, 2.35, -8 + WALL_THICK / 2 + 0.03, root, false);
      void win;
      void frame;
    }
  }

  // ── Carteles ──
  const posterAt = (idx: number, x: number, y: number, z: number, ry = 0, scale = 1) => {
    const p = POSTERS[idx % POSTERS.length];
    const t = T(posterTexture(p, idx));
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, transparent: true });
    disposables.push(m);
    const o = mesh(G(new THREE.PlaneGeometry(0.62 * scale, 0.82 * scale)), m, x, y, z, root, false);
    o.rotation.y = ry;
    o.rotation.z = (rng() - 0.5) * 0.08;
    o.receiveShadow = false;
    return o;
  };
  const southFace = -2 + WALL_THICK / 2 + 0.012;
  const northFace = -8 + WALL_THICK / 2 + 0.012;
  posterAt(0, -11.6, 1.02, southFace);
  posterAt(1, -5.8, 1.12, southFace, 0, 0.8);
  posterAt(2, 2.2, 1.02, southFace);
  posterAt(6, 6.3, 1.02, southFace);
  posterAt(3, -12.2, 1.8, northFace, 0, 1.25);
  posterAt(4, 1.9, 1.8, northFace, 0, 1.25);
  posterAt(7, 5.0, 1.8, northFace, 0, 1.25);

  // ── Letreros sobre las puertas ──
  const signBoard = (text: string, sub: string | undefined, bg: string, fg: string, x: number, z: number, ry: number, y = 2.25) => {
    const g = group(x, 0, z, ry);
    const t = T(signTexture(text, bg, fg, sub));
    const m = new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.6 });
    disposables.push(m);
    mesh(G(new THREE.PlaneGeometry(1.9, 0.475)), m, 0, y, 0.02, g, false);
    const back = mesh(rbox(1.95, 0.5, 0.05, 0.02), mat('#ffffff'), 0, y, -0.02, g);
    void back;
    for (const sx of [-1.02, 1.02]) mesh(cylG(0.045, 0.045, y + 0.2, 8), wallCap, sx, (y + 0.2) / 2, 0, g);
    return g;
  };
  signBoard('EXPLORACIÓN', 'camilla y negatoscopio', '#9ff0d0', '#3b2146', -9, -1.98, 0);
  signBoard('PREPARACIÓN', 'zona estéril', '#c8a2e8', '#3b2146', -0.5, -1.98, 0);
  signBoard('QUIRÓFANO', 'zona estéril · por aquí', '#ff8fc7', '#3b2146', 8.5, -1.98, 0);
  signBoard('AUTOCLAVE', 'zona estéril', '#b8e1ff', '#3b2146', 4.98, 4.5, -Math.PI / 2);

  // ── Sala de espera ──
  const chairCols = ['#ff8fc7', '#9ff0d0', '#c8a2e8', '#ffd84d'];
  SEATS.forEach((s, i) => {
    const g = group(s.x, 0, s.z, s.yaw);
    const c = vinyl(chairCols[i % chairCols.length]);
    mesh(rbox(0.62, 0.14, 0.56, 0.06), c, 0, 0.44, 0.02, g);
    mesh(rbox(0.62, 0.52, 0.12, 0.05), c, 0, 0.74, -0.27, g);
    for (const [lx, lz] of [
      [-0.25, -0.22],
      [0.25, -0.22],
      [-0.25, 0.22],
      [0.25, 0.22],
    ])
      mesh(cylG(0.025, 0.025, 0.4, 6), steel, lx, 0.2, lz, g);
    boxCol(s.x, s.z, 0.5, 0.5);
  });
  // plantas
  const plant = (x: number, z: number, s = 1) => {
    const g = group(x, 0, z);
    mesh(cylG(0.24 * s, 0.18 * s, 0.4 * s, 16), vinyl('#ffb3d9'), 0, 0.2 * s, 0, g);
    const leaf = mat('#5fd39b', { rough: 0.5 });
    const leaf2 = mat('#3fbf85', { rough: 0.5 });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      mesh(sphG(0.2 * s, 10, 8), i % 2 ? leaf : leaf2, Math.cos(a) * 0.14 * s, (0.62 + (i % 2) * 0.12) * s, Math.sin(a) * 0.14 * s, g);
    }
    mesh(sphG(0.22 * s, 10, 8), leaf, 0, 0.86 * s, 0, g);
    circCol(x, z, 0.3 * s);
  };
  plant(-12.3, 7.3, 1.2);
  plant(4.4, 7.3, 1.1);
  plant(-8.2, -1.4, 0.9);
  plant(12.3, -1.5, 1);
  plant(-12.3, -2.7, 1);
  plant(12.3, 0.4, 0.8);
  // recepción
  {
    const g = group(-10.6, 0, 5.9);
    mesh(rbox(2.6, 1.0, 0.8, 0.1), vinyl('#ffd6ec'), 0, 0.5, 0, g);
    mesh(rbox(2.7, 0.08, 0.9, 0.03), vinyl('#ff8fc7'), 0, 1.03, 0, g);
    mesh(rbox(0.5, 0.36, 0.06, 0.02), mat('#3b2146', { rough: 0.3 }), -0.5, 1.28, 0.1, g);
    mesh(rbox(0.44, 0.3, 0.02, 0.01), mat('#9ff0d0', { emissive: '#9ff0d0', emissiveIntensity: 0.6 }), -0.5, 1.28, 0.135, g, false);
    mesh(sphG(0.07, 12, 8), mat('#f5c542', { metal: 0.8, rough: 0.2 }), 0.6, 1.12, 0.1, g);
    const t = T(labelTexture('RECEPCIÓN', '#c4136c', '800 58px "Baloo 2", sans-serif', 512, 96));
    const m = new THREE.MeshBasicMaterial({ map: t, transparent: true });
    disposables.push(m);
    mesh(G(new THREE.PlaneGeometry(1.6, 0.3)), m, 0, 0.6, 0.41, g, false);
    boxCol(-10.6, 5.9, 2.7, 0.9);
  }
  // mesita con revistas
  {
    const g = group(-6.4, 0, 2.6);
    mesh(cylG(0.5, 0.5, 0.06, 24), vinyl('#fff6fb'), 0, 0.42, 0, g);
    mesh(cylG(0.06, 0.12, 0.4, 10), wallCap, 0, 0.2, 0, g);
    const mags = ['#ff8fc7', '#9ff0d0', '#ffd84d'];
    mags.forEach((c, i) => {
      const m = mesh(boxG(0.3, 0.02, 0.22), mat(c), -0.12 + i * 0.1, 0.46 + i * 0.02, (i - 1) * 0.05, g);
      m.rotation.y = i * 0.5;
    });
    circCol(-6.4, 2.6, 0.5);
  }
  // garrafón de tila
  const coolerBubbles: THREE.Mesh[] = [];
  {
    const s = STATIONS.cooler.pos;
    const g = group(s.x, 0, s.z);
    mesh(rbox(0.5, 0.95, 0.45, 0.06), white, 0, 0.475, 0, g);
    mesh(rbox(0.12, 0.08, 0.1, 0.02), mat('#ff4d6d'), -0.1, 0.78, 0.24, g);
    mesh(rbox(0.12, 0.08, 0.1, 0.02), mat('#4dc3ff'), 0.1, 0.78, 0.24, g);
    const bottle = mesh(cylG(0.2, 0.2, 0.55, 20), mat('#a8e2ff', { rough: 0.1, opacity: 0.55, transparent: true }), 0, 1.24, 0, g, false);
    void bottle;
    mesh(sphG(0.2, 16, 8), mat('#a8e2ff', { rough: 0.1, opacity: 0.55, transparent: true }), 0, 1.52, 0, g, false);
    const bm = mat('#ffffff', { opacity: 0.8, transparent: true, emissive: '#ffffff', emissiveIntensity: 0.4 });
    for (let i = 0; i < 4; i++) {
      const b = mesh(sphG(0.03, 8, 6), bm, (rng() - 0.5) * 0.2, 1.0 + i * 0.12, (rng() - 0.5) * 0.2, g, false);
      b.userData.dynamic = true;
      coolerBubbles.push(b);
    }
    const t = T(labelTexture('TILA', '#3fcf9c', '900 70px "Baloo 2", sans-serif', 256, 96));
    const lm = new THREE.MeshBasicMaterial({ map: t, transparent: true });
    disposables.push(lm);
    mesh(G(new THREE.PlaneGeometry(0.4, 0.15)), lm, 0, 0.45, 0.232, g, false);
    circCol(s.x, s.z, 0.34);
    // cartel de piso mojado
    const wg = group(s.x + 1.1, 0, s.z - 0.8, -0.4);
    const ym = mat('#ffd84d', { rough: 0.4, clearcoat: 0.5 });
    const p1 = mesh(boxG(0.34, 0.6, 0.02), ym, 0, 0.3, 0.08, wg);
    p1.rotation.x = -0.25;
    const p2 = mesh(boxG(0.34, 0.6, 0.02), ym, 0, 0.3, -0.08, wg);
    p2.rotation.x = 0.25;
    const wt = T(labelTexture('¡PISO MOJADO!', '#3b2146', '900 34px "Nunito", sans-serif', 256, 64));
    const wm = new THREE.MeshBasicMaterial({ map: wt, transparent: true });
    disposables.push(wm);
    const lbl = mesh(G(new THREE.PlaneGeometry(0.32, 0.08)), wm, 0, 0.36, 0.1, wg, false);
    lbl.rotation.x = -0.25;
  }
  // cubeta del trapeador junto al charco del pasillo
  {
    const g = group(4.4, 0, 1.4);
    mesh(cylG(0.22, 0.18, 0.34, 16), vinyl('#4dc3ff'), 0, 0.17, 0, g);
    const stick = mesh(cylG(0.02, 0.02, 1.3, 6), mat('#c9a27a'), 0.05, 0.75, 0, g);
    stick.rotation.z = 0.25;
    circCol(4.4, 1.4, 0.24);
  }
  // mostrador de consentimiento (Gigi)
  const ringLight = new THREE.Group();
  let ringMesh: THREE.Mesh | null = null;
  {
    const s = STATIONS.consent.pos;
    const g = group(s.x, 0, s.z);
    mesh(rbox(1.8, 0.95, 0.7, 0.08), vinyl('#c8a2e8'), 0, 0.475, 0, g);
    mesh(rbox(1.9, 0.06, 0.8, 0.02), vinyl('#fff6fb'), 0, 0.98, 0, g);
    for (let i = 0; i < 3; i++) {
      const p = mesh(boxG(0.3, 0.01, 0.4), white, -0.4 + i * 0.12, 1.02 + i * 0.01, 0.05, g, false);
      p.rotation.y = (i - 1) * 0.2;
    }
    mesh(cylG(0.012, 0.012, 0.22, 6), mat('#ff2e93'), 0.2, 1.03, 0.1, g, false).rotation.z = Math.PI / 2;
    const t = T(labelTexture('CONSENTIMIENTOS', '#ffffff', '900 44px "Baloo 2", sans-serif', 512, 80));
    const lm = new THREE.MeshBasicMaterial({ map: t, transparent: true });
    disposables.push(lm);
    mesh(G(new THREE.PlaneGeometry(1.5, 0.23)), lm, 0, 0.6, 0.36, g, false);
    // aro de luz para TikToks
    ringLight.position.set(0.75, 0, -0.55);
    g.add(ringLight);
    mesh(cylG(0.015, 0.02, 1.5, 6), mat('#3b2146'), 0, 0.75, 0, ringLight);
    const ring = mesh(G(new THREE.TorusGeometry(0.2, 0.03, 8, 28)), mat('#ffffff', { emissive: '#fff4e0', emissiveIntensity: 0.2 }), 0, 1.55, 0, ringLight, false);
    ring.name = 'ring';
    ringMesh = ring;
    boxCol(s.x, s.z, 1.9, 0.8);
  }
  // transportín de Panchito
  let carrierDoor: THREE.Object3D;
  {
    const s = STATIONS.carrier.pos;
    const g = group(s.x, 0, s.z, Math.PI / 2);
    const shell = vinyl('#ff8fc7');
    mesh(rbox(0.8, 0.55, 0.55, 0.12), shell, 0, 0.3, -0.08, g);
    mesh(rbox(0.3, 0.06, 0.08, 0.03), mat('#3b2146'), 0, 0.62, -0.08, g);
    const doorPivot = new THREE.Group();
    doorPivot.position.set(-0.3, 0.3, 0.2);
    g.add(doorPivot);
    const bars = mat('#dfe6ee', { metal: 0.7, rough: 0.3 });
    const door = new THREE.Group();
    door.position.set(0.3, 0, 0);
    doorPivot.add(door);
    for (let i = 0; i < 6; i++) mesh(cylG(0.012, 0.012, 0.42, 6), bars, -0.25 + i * 0.1, 0, 0, door, false);
    for (const y of [-0.2, 0.2]) {
      const b = mesh(cylG(0.014, 0.014, 0.56, 6), bars, 0, y, 0, door, false);
      b.rotation.z = Math.PI / 2;
    }
    carrierDoor = doorPivot;
    doorPivot.userData.dynamic = true;
    const t = T(labelTexture('PANCHITO', '#ffffff', '900 56px "Baloo 2", sans-serif', 256, 80));
    const lm = new THREE.MeshBasicMaterial({ map: t, transparent: true });
    disposables.push(lm);
    const l = mesh(G(new THREE.PlaneGeometry(0.5, 0.15)), lm, 0.401, 0.35, -0.08, g, false);
    l.rotation.y = Math.PI / 2;
    boxCol(s.x, s.z, 0.6, 0.85);
  }

  // ── Exploración ──
  const examTop = new THREE.Vector3(STATIONS.exam.pos.x, 0.93, STATIONS.exam.pos.z);
  {
    const s = STATIONS.exam.pos;
    const g = group(s.x, 0, s.z);
    mesh(rbox(1.8, 0.06, 0.8, 0.03), steel, 0, 0.86, 0, g);
    mesh(rbox(1.7, 0.05, 0.7, 0.025), vinyl('#9ff0d0'), 0, 0.905, 0, g);
    mesh(cylG(0.12, 0.2, 0.84, 14), steel, 0, 0.42, 0, g);
    mesh(cylG(0.4, 0.45, 0.05, 20), steel, 0, 0.025, 0, g);
    boxCol(s.x, s.z, 1.85, 0.85);
    // armario con frascos
    const cab = group(-12.3, 0, -6.6);
    mesh(rbox(0.6, 1.6, 1.4, 0.06), vinyl('#fff6fb'), 0, 0.8, 0, cab);
    const jarCols = ['#ff8fc7', '#9ff0d0', '#ffd84d', '#c8a2e8', '#8fd3ff'];
    for (let i = 0; i < 5; i++) mesh(cylG(0.07, 0.07, 0.18, 10), mat(jarCols[i], { opacity: 0.85, transparent: true }), 0.33, 1.05 + (i % 2) * 0.28, -0.5 + i * 0.25, cab, false);
    boxCol(-12.3, -6.6, 0.65, 1.45);
    // báscula
    const sc = group(-6.0, 0, -3.1);
    mesh(rbox(0.9, 0.08, 0.6, 0.03), vinyl('#b8e1ff'), 0, 0.04, 0, sc);
    mesh(rbox(0.25, 0.14, 0.03, 0.02), mat('#3b2146'), 0, 0.18, -0.28, sc);
  }
  // negatoscopio
  let lightboxScreen: THREE.Mesh;
  let lightboxMat: THREE.MeshStandardMaterial;
  {
    const s = STATIONS.lightbox.pos;
    const g = group(s.x, 0, -8 + WALL_THICK / 2);
    mesh(rbox(1.5, 1.0, 0.12, 0.05), vinyl('#fff6fb'), 0, 1.75, 0.06, g);
    lightboxMat = new THREE.MeshStandardMaterial({ color: '#e8f4ff', emissive: new THREE.Color('#dff0ff'), emissiveIntensity: 0.9, roughness: 0.3 });
    disposables.push(lightboxMat);
    lightboxScreen = mesh(G(new THREE.PlaneGeometry(1.32, 0.825)), lightboxMat, 0, 1.75, 0.125, g, false);
    mesh(cylG(0.03, 0.03, 0.06, 8), mat('#3fcf9c', { emissive: '#3fcf9c' }), 0.62, 1.32, 0.13, g, false).rotation.x = Math.PI / 2;
  }

  // ── Preparación ──
  let clippers: THREE.Object3D;
  const prepTop = new THREE.Vector3(STATIONS.prep.pos.x, 0.9, STATIONS.prep.pos.z);
  {
    const s = STATIONS.prep.pos;
    const g = group(s.x, 0, s.z);
    mesh(rbox(1.6, 0.06, 0.8, 0.03), steel, 0, 0.84, 0, g);
    mesh(rbox(1.5, 0.05, 0.7, 0.025), vinyl('#c8a2e8'), 0, 0.885, 0, g);
    for (const [lx, lz] of [
      [-0.7, -0.32],
      [0.7, -0.32],
      [-0.7, 0.32],
      [0.7, 0.32],
    ])
      mesh(cylG(0.03, 0.03, 0.82, 8), steel, lx, 0.41, lz, g);
    boxCol(s.x, s.z, 1.65, 0.85);
    // carrito del rasurado
    const cart = group(1.6, 0, -6.7);
    mesh(rbox(0.7, 0.05, 0.5, 0.02), steel, 0, 0.8, 0, cart);
    mesh(rbox(0.7, 0.05, 0.5, 0.02), steel, 0, 0.35, 0, cart);
    for (const [lx, lz] of [
      [-0.3, -0.2],
      [0.3, -0.2],
      [-0.3, 0.2],
      [0.3, 0.2],
    ])
      mesh(cylG(0.02, 0.02, 0.8, 6), steel, lx, 0.4, lz, cart);
    mesh(cylG(0.06, 0.06, 0.22, 10), mat('#ff8fc7', { opacity: 0.85, transparent: true }), -0.15, 0.94, 0.05, cart, false);
    mesh(cylG(0.06, 0.06, 0.22, 10), mat('#8fd3ff', { opacity: 0.85, transparent: true }), 0.0, 0.94, 0.05, cart, false);
    clippers = group(0.2, 0.86, 0, 0, cart);
    clippers.userData.dynamic = true;
    mesh(rbox(0.1, 0.07, 0.24, 0.03), vinyl('#ff2e93'), 0, 0, 0, clippers);
    mesh(boxG(0.1, 0.02, 0.04), steel, 0, 0, -0.13, clippers);
    boxCol(1.6, -6.7, 0.75, 0.55);
    // estantería de paños
    const sh = group(-3.9, 0, -7.4);
    mesh(rbox(1.0, 1.4, 0.45, 0.04), vinyl('#fff6fb'), 0, 0.7, 0, sh);
    for (let i = 0; i < 3; i++) mesh(rbox(0.8, 0.12, 0.35, 0.04), mat('#b79cf2'), 0, 0.35 + i * 0.4, 0.03, sh, false);
    boxCol(-3.9, -7.4, 1.05, 0.5);
  }

  // ── Antesala del quirófano ──
  let orLight: THREE.Mesh;
  let orLightMat: THREE.MeshStandardMaterial;
  const orDoors: THREE.Object3D[] = [];
  {
    const s = STATIONS.orDoor.pos;
    const g = group(s.x, 0, -8 + WALL_THICK / 2);
    mesh(rbox(2.5, 2.5, 0.14, 0.05), vinyl('#ff8fc7'), 0, 1.25, 0.02, g);
    const doorMat = mat('#f4fffb', { rough: 0.4, clearcoat: 0.4 });
    const winMat = mat('#bfe7ff', { rough: 0.1, emissive: '#bfe7ff', emissiveIntensity: 0.35 });
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.userData.dynamic = true;
      pivot.position.set(side * 1.05, 0, 0.12);
      g.add(pivot);
      const leaf = new THREE.Group();
      leaf.position.x = -side * 0.52;
      pivot.add(leaf);
      mesh(rbox(1.02, 2.2, 0.08, 0.04), doorMat, 0, 1.1, 0, leaf);
      mesh(G(new THREE.CircleGeometry(0.17, 24)), winMat, 0, 1.55, 0.045, leaf, false);
      mesh(rbox(0.5, 0.05, 0.04, 0.02), steel, 0, 1.05, 0.06, leaf);
      orDoors.push(pivot);
    }
    orLightMat = new THREE.MeshStandardMaterial({ color: '#ff4d6d', emissive: new THREE.Color('#ff4d6d'), emissiveIntensity: 1.2 });
    disposables.push(orLightMat);
    orLight = mesh(sphG(0.11, 16, 10), orLightMat, 0, 2.62, 0.12, g, false);
    orLight.userData.dynamic = true;
    const t = T(signTexture('QUIRÓFANO', '#ff2e93', '#ffffff'));
    const m = new THREE.MeshStandardMaterial({ map: t, transparent: true, emissive: new THREE.Color('#ffffff'), emissiveMap: t, emissiveIntensity: 0.25 });
    disposables.push(m);
    mesh(G(new THREE.PlaneGeometry(1.6, 0.4)), m, 0, 2.92, 0.1, g, false);
    // lavabo quirúrgico
    const sink = group(5.3, 0, -7.45);
    mesh(rbox(1.5, 0.9, 0.55, 0.06), steel, 0, 0.45, 0, sink);
    mesh(rbox(1.3, 0.12, 0.4, 0.04), mat('#b9c4cf', { metal: 0.6, rough: 0.25 }), 0, 0.88, 0.02, sink);
    for (const x of [-0.4, 0.4]) {
      const tap = mesh(cylG(0.02, 0.02, 0.35, 6), steel, x, 1.12, -0.18, sink);
      void tap;
    }
    boxCol(5.3, -7.45, 1.55, 0.6);
    // estante con paquetes estériles
    const sh = group(12.4, 0, -4.8, -Math.PI / 2);
    mesh(rbox(1.6, 1.5, 0.45, 0.04), vinyl('#fff6fb'), 0, 0.75, 0, sh);
    for (let i = 0; i < 6; i++) mesh(rbox(0.4, 0.18, 0.3, 0.05), mat('#8fd3ff'), -0.5 + (i % 3) * 0.5, 0.4 + Math.floor(i / 3) * 0.5, 0.05, sh, false);
    boxCol(12.4, -4.8, 0.5, 1.65);
  }

  // ── Autoclave ──
  let autoLight: THREE.Mesh;
  let autoLightMat: THREE.MeshStandardMaterial;
  let autoDoor: THREE.Object3D;
  const steamOrigin = new THREE.Vector3();
  {
    const s = STATIONS.autoclave.pos;
    const g = group(s.x + 0.25, 0, s.z, -Math.PI / 2);
    mesh(rbox(1.5, 0.9, 0.8, 0.06), vinyl('#fff6fb'), 0, 0.45, 0, g);
    mesh(rbox(1.3, 0.95, 0.85, 0.2), vinyl('#b8e1ff'), 0, 1.38, 0, g);
    autoDoor = group(0, 1.38, 0.43, 0, g);
    autoDoor.userData.dynamic = true;
    mesh(cylG(0.36, 0.36, 0.08, 28), steel, 0, 0, 0, autoDoor).rotation.x = Math.PI / 2;
    mesh(G(new THREE.TorusGeometry(0.3, 0.025, 8, 28)), mat('#3b2146'), 0, 0, 0.045, autoDoor, false);
    mesh(rbox(0.3, 0.05, 0.05, 0.02), mat('#3b2146'), 0, -0.05, 0.07, autoDoor, false);
    autoLightMat = new THREE.MeshStandardMaterial({ color: '#b9c4cf', emissive: new THREE.Color('#000000'), emissiveIntensity: 1 });
    disposables.push(autoLightMat);
    autoLight = mesh(sphG(0.06, 12, 8), autoLightMat, 0.5, 1.7, 0.43, g, false);
    // manómetro
    mesh(cylG(0.11, 0.11, 0.04, 20), white, -0.45, 1.7, 0.43, g, false).rotation.x = Math.PI / 2;
    mesh(boxG(0.015, 0.09, 0.01), mat('#ff2e93'), -0.45, 1.72, 0.455, g, false);
    steamOrigin.set(s.x + 0.25, 1.95, s.z);
    boxCol(s.x + 0.25, s.z, 0.9, 1.6);
    // estantería de juegos
    const sh = group(6.1, 0, 7.4);
    mesh(rbox(1.6, 1.3, 0.45, 0.04), vinyl('#fff6fb'), 0, 0.65, 0, sh);
    for (let i = 0; i < 4; i++) mesh(rbox(0.5, 0.14, 0.3, 0.05), mat('#9ff0d0'), -0.45 + (i % 2) * 0.9, 0.4 + Math.floor(i / 2) * 0.5, 0.05, sh, false);
    boxCol(6.1, 7.4, 1.65, 0.5);
    // mesa auxiliar
    const tb = group(11.9, 0, 2.2);
    mesh(rbox(1.2, 0.06, 0.6, 0.02), steel, 0, 0.8, 0, tb);
    mesh(cylG(0.05, 0.08, 0.8, 8), steel, 0, 0.4, 0, tb);
    boxCol(11.9, 2.2, 1.25, 0.65);
  }

  // ── Aluminio de Braulio ──
  const foilT = T(foilTexture());
  const foilMat = new THREE.MeshStandardMaterial({ map: foilT, color: '#e9edf5', metalness: 0.75, roughness: 0.32 });
  disposables.push(foilMat);
  const crumple = (w: number, h: number, d: number, seedN: number) => {
    const g = G(new THREE.BoxGeometry(w, h, d, 6, 5, 3));
    const r = createRng(seedN);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const k = 0.035;
      pos.setXYZ(i, pos.getX(i) + (r() - 0.5) * k, pos.getY(i) + (r() - 0.5) * k, pos.getZ(i) + (r() - 0.5) * k);
    }
    g.computeVertexNormals();
    return g;
  };
  const foil: Record<'lightbox' | 'autoclave', THREE.Group> = {
    lightbox: group(STATIONS.lightbox.pos.x, 1.75, -8 + WALL_THICK / 2 + 0.12),
    autoclave: group(STATIONS.autoclave.pos.x + 0.25, 1.38, STATIONS.autoclave.pos.z, -Math.PI / 2),
  };
  mesh(crumple(1.62, 1.1, 0.3, 3), foilMat, 0, 0, 0, foil.lightbox);
  mesh(crumple(1.45, 1.1, 0.98, 4), foilMat, 0, 0, 0, foil.autoclave);
  const tag = T(labelTexture('ANTI-5G', '#ff2e93', '900 60px "Baloo 2", sans-serif', 256, 80));
  const tagMat = new THREE.MeshBasicMaterial({ map: tag, transparent: true });
  disposables.push(tagMat);
  mesh(G(new THREE.PlaneGeometry(0.6, 0.19)), tagMat, 0, 0.1, 0.17, foil.lightbox, false).rotation.z = 0.12;
  mesh(G(new THREE.PlaneGeometry(0.6, 0.19)), tagMat, 0, 0.1, 0.5, foil.autoclave, false).rotation.z = -0.1;
  foil.lightbox.userData.dynamic = true;
  foil.autoclave.userData.dynamic = true;
  foil.lightbox.visible = false;
  foil.autoclave.visible = false;

  // ── Charcos ──
  const puddleT = T(puddleTexture());
  const puddleMat = new THREE.MeshStandardMaterial({ map: puddleT, transparent: true, roughness: 0.05, metalness: 0.1, depthWrite: false });
  disposables.push(puddleMat);
  const puddleGeo = G(new THREE.PlaneGeometry(1, 1));
  const puddles: Array<{ x: number; z: number; r: number }> = [];
  const addPuddle = (x: number, z: number, r: number) => {
    puddles.push({ x, z, r });
    const m = mesh(puddleGeo, puddleMat, x, 0.012 + puddles.length * 0.0005, z, root, false);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = rng() * Math.PI * 2;
    m.scale.set(r * 2.3, r * 2.3, 1);
    m.receiveShadow = false;
  };
  for (const p of PUDDLES) addPuddle(p.x, p.z, p.r);

  // Lote estático: fusiona por material todo lo que no se anima (de ~500 a ~60 llamadas de dibujo)
  batchStatic(root, geoms);

  let autoState: 'idle' | 'working' | 'blocked' | 'full' = 'idle';
  let orReady = false;
  let clipperOn = false;
  let ringOn = false;
  let lightboxHasImage = false;
  let lightboxTex: THREE.CanvasTexture | null = null;

  return {
    root,
    colliders,
    puddles,
    addPuddle,
    steamOrigin,
    examTop,
    prepTop,
    setLightboxImage(c) {
      lightboxTex?.dispose();
      lightboxTex = null;
      if (c) {
        lightboxTex = new THREE.CanvasTexture(c);
        lightboxTex.colorSpace = THREE.SRGBColorSpace;
        lightboxMat.map = lightboxTex;
        lightboxMat.emissiveMap = lightboxTex;
        lightboxMat.color.set('#ffffff');
        lightboxMat.emissive.set('#ffffff');
        lightboxMat.emissiveIntensity = 1.1;
      } else {
        lightboxMat.map = null;
        lightboxMat.emissiveMap = null;
        lightboxMat.color.set('#e8f4ff');
        lightboxMat.emissive.set('#dff0ff');
        lightboxMat.emissiveIntensity = 0.9;
      }
      lightboxMat.needsUpdate = true;
      lightboxHasImage = !!c;
    },
    setFoil(device, on) {
      foil[device].visible = on;
    },
    setAutoclave(s) {
      autoState = s;
    },
    setOrDoorReady(r) {
      orReady = r;
    },
    setOrDoorOpen(t) {
      orDoors.forEach((d, i) => (d.rotation.y = (i === 0 ? 1 : -1) * t * 1.3));
    },
    setClipperActive(on) {
      clipperOn = on;
    },
    setRingLight(on) {
      ringOn = on;
    },
    setCarrierOpen(open) {
      carrierDoor.rotation.y = open ? -1.6 : 0;
    },
    update(dt, t) {
      // burbujas del garrafón
      for (let i = 0; i < coolerBubbles.length; i++) {
        const b = coolerBubbles[i];
        b.position.y += dt * (0.15 + i * 0.03);
        if (b.position.y > 1.5) b.position.y = 1.0;
      }
      // luz del quirófano
      if (orReady) {
        orLightMat.color.set('#3fcf9c');
        orLightMat.emissive.set('#3fcf9c');
        orLightMat.emissiveIntensity = 1 + Math.sin(t * 4) * 0.5;
      } else {
        orLightMat.color.set('#ff4d6d');
        orLightMat.emissive.set('#ff4d6d');
        orLightMat.emissiveIntensity = 0.9;
      }
      orLight.scale.setScalar(orReady ? 1 + Math.sin(t * 4) * 0.12 : 1);
      // autoclave
      if (autoState === 'working') {
        autoLightMat.emissive.set('#ffb347');
        autoLightMat.emissiveIntensity = 0.6 + (Math.sin(t * 6) > 0 ? 1 : 0);
        autoDoor.rotation.z = Math.sin(t * 20) * 0.01;
      } else if (autoState === 'full') {
        autoLightMat.emissive.set('#3fcf9c');
        autoLightMat.emissiveIntensity = 1.3;
      } else if (autoState === 'blocked') {
        autoLightMat.emissive.set('#ff4d6d');
        autoLightMat.emissiveIntensity = Math.sin(t * 10) > 0 ? 1.5 : 0.2;
      } else {
        autoLightMat.emissive.set('#000000');
      }
      // máquina de rasurar vibrando
      clippers.position.x = 0.2 + (clipperOn ? Math.sin(t * 90) * 0.006 : 0);
      clippers.rotation.y = clipperOn ? Math.sin(t * 70) * 0.05 : 0;
      if (ringMesh) (ringMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = ringOn ? 1.6 : 0.15;
      // negatoscopio parpadea un poquito (fluorescente barato)
      if (!lightboxHasImage) lightboxMat.emissiveIntensity = 0.85 + (Math.sin(t * 37) > 0.97 ? -0.35 : 0);
    },
    dispose() {
      for (const g of geoms) g.dispose();
      for (const m of matCache.values()) m.dispose();
      for (const d of disposables) d.dispose();
      for (const t of texs) t.dispose();
      lightboxTex?.dispose();
      root.removeFromParent();
    },
  };
}
