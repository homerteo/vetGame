/**
 * Paciente sobre la mesa: montículo bajo paños lila (con respiración), cabeza del animal asomando
 * con tubo endotraqueal y la ventana del paño donde se apoya el plano de la herida.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { AnimalModelId, CharacterFactory, CharacterRig } from '../../core/contracts';
import { smoothstep } from '../../core/math';
import { drapeTexture } from './roomTextures';
import { TABLE_TOP_Y } from './room';

/** Escala visual de la herida: 160×100 mm se muestran como 240×150 mm (legibilidad). */
export const WOUND_SCALE = 1.5;
export const WOUND_W_M = 0.16 * WOUND_SCALE;
export const WOUND_H_M = 0.1 * WOUND_SCALE;

const MOUND = { cx: 0.04, hx: 0.52, hz: 0.22, h: 0.15 };
const TABLE = { cx: 0.05, hx: 0.775, hz: 0.3 };
const DRAPE_X0 = -0.52;
const DRAPE_X1 = 1.12;
const DRAPE_HZ = 0.72;
export const WOUND_CENTER = new THREE.Vector3(0.1, TABLE_TOP_Y + MOUND.h + 0.006, 0);

export interface PatientParts {
  group: THREE.Group;
  /** Ancla de la herida: centro del plano, +Y normal, +X = x de la herida, +Z = y de la herida. */
  woundAnchor: THREE.Group;
  rig: CharacterRig | null;
  /** Fase de respiración −1..1 (1 = inspiración máxima). */
  setBreath(v: number): void;
  dispose(): void;
}

/** Altura de la tela en (x, z) sin respirar y la parte del montículo (para respirar). */
function drapeHeight(x: number, z: number): { base: number; bump: number } {
  const qx = Math.abs(x - MOUND.cx) / MOUND.hx;
  const qz = Math.abs(z) / MOUND.hz;
  const q = Math.pow(Math.pow(qx, 4) + Math.pow(qz, 4), 0.25);
  const bump = 1 - smoothstep(0.72, 1.12, q);
  const dx = Math.max(0, Math.abs(x - TABLE.cx) - TABLE.hx);
  const dz = Math.max(0, Math.abs(z) - TABLE.hz);
  const d = Math.hypot(dx, dz);
  // Fuera de la mesa la tela cae con pliegues.
  const fold = Math.sin(x * 34 + z * 3) * 0.014 * Math.min(1, d * 5) + Math.sin(x * 11) * 0.01 * Math.min(1, d * 4);
  let base = TABLE_TOP_Y + 0.006 - Math.min(d * 2.2, 0.6) + fold;
  // Borde redondeado de la mesa.
  if (d > 0 && d < 0.03) base += 0.012 * (1 - d / 0.03);
  return { base, bump: bump * MOUND.h };
}

const _bb = new THREE.Box3();

/**
 * Caja de lo que se ve: solo mallas visibles (ni sprites ni objetos ocultos). Los sprites ocultos
 * de los emotes del rig medían más de un metro y subían al paciente por encima de la mesa.
 */
export function visibleBounds(root: THREE.Object3D, out: THREE.Box3): THREE.Box3 {
  out.makeEmpty();
  root.updateMatrixWorld(true);
  const visit = (o: THREE.Object3D) => {
    if (!o.visible) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      _bb.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld);
      out.union(_bb);
    }
    for (const c of o.children) visit(c);
  };
  visit(root);
  return out;
}

export function buildPatient(factory: CharacterFactory, animal: AnimalModelId): PatientParts {
  const group = new THREE.Group();
  group.name = 'paciente';
  const drapeMat = new THREE.MeshPhysicalMaterial({
    map: drapeTexture(),
    roughness: 0.82,
    sheen: 0.8,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color('#fff0ff'),
    side: THREE.DoubleSide,
  });

  // ───────────── Paño con montículo ─────────────
  const segX = 96;
  const segZ = 60;
  const geo = new THREE.PlaneGeometry(DRAPE_X1 - DRAPE_X0, DRAPE_HZ * 2, segX, segZ);
  geo.rotateX(-Math.PI / 2);
  geo.translate((DRAPE_X0 + DRAPE_X1) / 2, 0, 0);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const base = new Float32Array(pos.count);
  const bump = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = drapeHeight(x, z);
    base[i] = h.base;
    bump[i] = h.bump;
    // La tela que cuelga se abre un poco hacia fuera.
    const dz = Math.max(0, Math.abs(z) - TABLE.hz);
    pos.setZ(i, z - Math.sign(z) * dz * 0.35);
    pos.setY(i, h.base + h.bump);
  }
  geo.computeVertexNormals();
  const drape = new THREE.Mesh(geo, drapeMat);
  drape.castShadow = true;
  drape.receiveShadow = true;
  group.add(drape);
  // Rollo de toalla en el borde del cuello.
  const cuff = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.46, 6, 16), drapeMat);
  cuff.rotation.x = Math.PI / 2;
  cuff.position.set(DRAPE_X0 + 0.03, TABLE_TOP_Y + 0.035, 0);
  cuff.castShadow = true;
  group.add(cuff);

  // ───────────── Ventana de la herida ─────────────
  const woundAnchor = new THREE.Group();
  woundAnchor.position.copy(WOUND_CENTER);
  group.add(woundAnchor);
  const frameMat = new THREE.MeshPhysicalMaterial({ color: '#a883d6', roughness: 0.6, sheen: 0.5, sheenColor: new THREE.Color('#ffffff') });
  const ft = 0.016;
  const fh = 0.012;
  for (const [w, d, x, z] of [
    [WOUND_W_M + ft * 2, ft, 0, -WOUND_H_M / 2 - ft / 2 + 0.003],
    [WOUND_W_M + ft * 2, ft, 0, WOUND_H_M / 2 + ft / 2 - 0.003],
    [ft, WOUND_H_M, -WOUND_W_M / 2 - ft / 2 + 0.003, 0],
    [ft, WOUND_H_M, WOUND_W_M / 2 + ft / 2 - 0.003, 0],
  ]) {
    const bar = new THREE.Mesh(new RoundedBoxGeometry(w, fh, d, 3, 0.005), frameMat);
    bar.position.set(x, fh / 2 - 0.004, z);
    bar.castShadow = true;
    bar.receiveShadow = true;
    woundAnchor.add(bar);
  }
  // Pinzas de campo (rosas, en las esquinas).
  const clampMat = new THREE.MeshPhysicalMaterial({ color: '#ff8fc7', roughness: 0.3, clearcoat: 1 });
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.TorusGeometry(0.0075, 0.0022, 8, 20), clampMat);
      c.position.set(sx * (WOUND_W_M / 2 + 0.01), 0.011, sz * (WOUND_H_M / 2 + 0.01));
      c.rotation.set(Math.PI / 2, 0, sx * sz * 0.7);
      c.castShadow = true;
      woundAnchor.add(c);
    }

  // ───────────── Cabeza del paciente (rig de la fábrica) ─────────────
  let rig: CharacterRig | null = null;
  const holder = new THREE.Group();
  try {
    rig = factory.animal(animal, { shaved: true });
    const inner = new THREE.Group();
    inner.rotation.y = -Math.PI / 2; // hocico (+Z del rig) hacia -X
    inner.add(rig.root);
    holder.add(inner);
    holder.rotation.x = Math.PI / 2; // tumbado de lado, lomo hacia la cirujana
    holder.rotation.z = 0;
    rig.setAnim?.('sit');
    rig.setAnim?.('idle');
    group.add(holder);
    holder.updateMatrixWorld(true);
    const box = visibleBounds(holder, new THREE.Box3());
    const len = Math.max(0.05, box.max.x - box.min.x);
    const s = 0.42 / len;
    holder.scale.setScalar(s);
    visibleBounds(holder, box);
    holder.position.x += -0.7 - box.min.x;
    holder.position.y += TABLE_TOP_Y + 0.03 - box.min.y;
    holder.position.z += -0.02 - (box.min.z + box.max.z) / 2;
    holder.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    visibleBounds(holder, box);
    // Tubo endotraqueal desde el hocico hasta la máquina de anestesia.
    const mouth = new THREE.Vector3(box.min.x + 0.015, box.min.y + (box.max.y - box.min.y) * 0.45, (box.min.z + box.max.z) / 2 - 0.01);
    const tubeMat = new THREE.MeshPhysicalMaterial({ color: '#9fd8ff', roughness: 0.15, transparent: true, opacity: 0.75, clearcoat: 1 });
    const curve = new THREE.CatmullRomCurve3([
      mouth,
      mouth.clone().add(new THREE.Vector3(-0.1, 0.03, -0.02)),
      new THREE.Vector3(-0.95, TABLE_TOP_Y + 0.22, -0.25),
      new THREE.Vector3(-1.3, 1.1, -0.2),
    ]);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 60, 0.007, 8, false), tubeMat);
    tube.castShadow = true;
    group.add(tube);
    // Lazo rosa en el tubo (kawaii) y conector menta.
    const bowMat = new THREE.MeshPhysicalMaterial({ color: '#ff2e93', roughness: 0.35, clearcoat: 1 });
    const bowAt = curve.getPoint(0.12);
    for (const sx of [-1, 1]) {
      const lobe = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.035, 12), bowMat);
      lobe.position.copy(bowAt).add(new THREE.Vector3(0, 0.01, sx * 0.02));
      lobe.rotation.x = sx * Math.PI / 2;
      group.add(lobe);
    }
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.01, 10, 8), bowMat);
    knot.position.copy(bowAt).add(new THREE.Vector3(0, 0.01, 0));
    group.add(knot);
    const conn = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.04, 12), new THREE.MeshPhysicalMaterial({ color: '#9ff0d0', clearcoat: 1, roughness: 0.3 }));
    conn.position.copy(curve.getPoint(0.3));
    conn.rotation.z = Math.PI / 2;
    group.add(conn);
  } catch (e) {
    console.warn('[escena] no se pudo crear el paciente', e);
  }
  // Almohadita bajo la cabeza.
  const pillow = new THREE.Mesh(
    new RoundedBoxGeometry(0.2, 0.035, 0.22, 4, 0.016),
    new THREE.MeshPhysicalMaterial({ color: '#ffd1e8', roughness: 0.7, sheen: 0.8, sheenColor: new THREE.Color('#ffffff') }),
  );
  pillow.position.set(-0.6, TABLE_TOP_Y + 0.016, -0.02);
  pillow.receiveShadow = true;
  group.add(pillow);

  let lastBreath = 0;
  return {
    group,
    woundAnchor,
    rig,
    setBreath(v) {
      if (Math.abs(v - lastBreath) < 0.004) return;
      lastBreath = v;
      const k = 0.045 * v;
      for (let i = 0; i < pos.count; i++) if (bump[i] > 0) pos.setY(i, base[i] + bump[i] * (1 + k));
      pos.needsUpdate = true;
      woundAnchor.position.y = WOUND_CENTER.y + MOUND.h * k;
    },
    dispose() {
      rig?.dispose();
    },
  };
}
