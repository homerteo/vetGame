/**
 * Quirófano kawaii procedural: sala, mesa, lámpara cialítica, monitor, mesa de Mayo, gotero,
 * máquina de anestesia con fuelle, ventana de la galería y puerta.
 * Eje X = largo de la mesa (cabeza del paciente en -X), +Z = lado de la cirujana.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { createInstrumentModel } from '../InstrumentModels';
import { beamTexture, clockTexture, floorTexture, posterTexture, signTexture, wallTexture } from './roomTextures';

export const ROOM = { minX: -3.6, maxX: 3.6, minZ: -3.4, maxZ: 4.2, height: 3.2 };
export const TABLE_TOP_Y = 0.8;

export interface RoomParts {
  group: THREE.Group;
  lamp: {
    /** Cabezal que se orienta hacia el objetivo. */
    head: THREE.Object3D;
    light: THREE.SpotLight;
    beam: THREE.Mesh;
    beamMat: THREE.MeshBasicMaterial;
    leds: THREE.MeshStandardMaterial;
  };
  /** Pantalla del monitor (se le asigna el material con la textura de constantes). */
  monitorScreen: THREE.Mesh;
  monitor: THREE.Object3D;
  tray: THREE.Object3D;
  bellows: THREE.Object3D;
  ivDrop: THREE.Mesh;
  doorLight: THREE.MeshStandardMaterial;
  clock: { draw(h: number, m: number): void };
  galleryAnchor: THREE.Object3D;
  anesthesia: THREE.Object3D;
}

function rb(w: number, h: number, d: number, r: number, mat: THREE.Material, seg = 3): THREE.Mesh {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2)), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function cyl(rt: number, rbt: number, h: number, mat: THREE.Material, seg = 20): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rbt, h, seg), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z);
  return o;
}

/** Base de cinco ruedas (pie de gotero, monitor, lámpara auxiliar). */
function wheelBase(mat: THREE.Material, wheel: THREE.Material, r = 0.28): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leg = rb(r, 0.03, 0.05, 0.012, mat);
    leg.position.set(Math.cos(a) * r * 0.5, 0.06, Math.sin(a) * r * 0.5);
    leg.rotation.y = -a;
    g.add(leg);
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), wheel);
    w.position.set(Math.cos(a) * r, 0.03, Math.sin(a) * r);
    w.castShadow = true;
    g.add(w);
  }
  return g;
}

export function buildRoom(): RoomParts {
  const group = new THREE.Group();
  group.name = 'quirofano';

  // ───────────── Materiales compartidos ─────────────
  const M = {
    wall: new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.4 }),
    floor: new THREE.MeshPhysicalMaterial({ map: floorTexture(), roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.3 }),
    ceiling: new THREE.MeshStandardMaterial({ color: '#fbf3ff', roughness: 0.9 }),
    panel: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff4fd', emissiveIntensity: 1.3 }),
    steel: new THREE.MeshStandardMaterial({ color: '#d9dee8', metalness: 1, roughness: 0.25 }),
    brushed: new THREE.MeshStandardMaterial({ color: '#c3c9d4', metalness: 0.9, roughness: 0.4 }),
    lilac: new THREE.MeshPhysicalMaterial({ color: '#c8a2e8', roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
    lavender: new THREE.MeshPhysicalMaterial({ color: '#b79cf2', roughness: 0.4, clearcoat: 0.7 }),
    mint: new THREE.MeshPhysicalMaterial({ color: '#9ff0d0', roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
    pink: new THREE.MeshPhysicalMaterial({ color: '#ff8fc7', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12 }),
    fuchsia: new THREE.MeshPhysicalMaterial({ color: '#ff2e93', roughness: 0.3, clearcoat: 1 }),
    cream: new THREE.MeshPhysicalMaterial({ color: '#fff6fb', roughness: 0.45, clearcoat: 0.5 }),
    ink: new THREE.MeshStandardMaterial({ color: '#3b2146', roughness: 0.6 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#5a4a6a', roughness: 0.8 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#dff7ff', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, clearcoat: 1, depthWrite: false }),
    fluid: new THREE.MeshPhysicalMaterial({ color: '#e8fbff', roughness: 0.1, transparent: true, opacity: 0.55, clearcoat: 1 }),
    towel: new THREE.MeshStandardMaterial({ color: '#b8efdc', roughness: 0.95 }),
    screen: new THREE.MeshBasicMaterial({ color: '#1b0f24' }),
  };

  // ───────────── Sala ─────────────
  const W = ROOM.maxX - ROOM.minX;
  const D = ROOM.maxZ - ROOM.minZ;
  const Hh = ROOM.height;
  const cx = (ROOM.minX + ROOM.maxX) / 2;
  const cz = (ROOM.minZ + ROOM.maxZ) / 2;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), M.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0, cz);
  floor.receiveShadow = true;
  (M.floor.map as THREE.Texture).repeat.set(W / 1.6, D / 1.6);
  group.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), M.ceiling);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(cx, Hh, cz);
  group.add(ceil);
  for (const [x, z] of [
    [-1.6, -1.5],
    [1.6, -1.5],
    [-1.6, 1.6],
    [1.6, 1.6],
  ]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7), M.panel);
    p.rotation.x = Math.PI / 2;
    p.position.set(x, Hh - 0.01, z);
    group.add(p);
  }

  const wallMat = (len: number) => {
    const m = M.wall.clone();
    m.map = (M.wall.map as THREE.Texture).clone();
    m.map.repeat.set(len / 1.6, 1);
    m.map.needsUpdate = true;
    return m;
  };
  const wallPlane = (len: number, h: number, x: number, z: number, ry: number, v0 = 0, v1 = 1, y0 = 0) => {
    const geo = new THREE.PlaneGeometry(len, h);
    // Recorta el rango vertical de la textura (paredes partidas por la ventana).
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setY(i, v0 + uv.getY(i) * (v1 - v0));
    const mesh = new THREE.Mesh(geo, wallMat(len));
    mesh.position.set(x, y0 + h / 2, z);
    mesh.rotation.y = ry;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  // Paredes laterales y frontal.
  wallPlane(D, Hh, ROOM.minX, cz, Math.PI / 2);
  wallPlane(D, Hh, ROOM.maxX, cz, -Math.PI / 2);
  wallPlane(W, Hh, cx, ROOM.maxZ, Math.PI);
  // Pared del fondo con la ventana de la galería (x 0.4..2.6, y 1.25..2.45).
  const gx0 = 0.4;
  const gx1 = 2.6;
  const gy0 = 1.25;
  const gy1 = 2.45;
  const bz = ROOM.minZ;
  wallPlane(gx0 - ROOM.minX, Hh, (ROOM.minX + gx0) / 2, bz, 0);
  wallPlane(ROOM.maxX - gx1, Hh, (gx1 + ROOM.maxX) / 2, bz, 0);
  wallPlane(gx1 - gx0, gy0, (gx0 + gx1) / 2, bz, 0, 0, gy0 / Hh, 0);
  wallPlane(gx1 - gx0, Hh - gy1, (gx0 + gx1) / 2, bz, 0, gy1 / Hh, 1, gy1);
  // Marco y cristal de la galería.
  const frameT = 0.08;
  const gw = gx1 - gx0;
  const gh = gy1 - gy0;
  const gmx = (gx0 + gx1) / 2;
  const gmy = (gy0 + gy1) / 2;
  for (const [w, h, x, y] of [
    [gw + frameT * 2, frameT, gmx, gy0 - frameT / 2 + 0.01],
    [gw + frameT * 2, frameT, gmx, gy1 + frameT / 2 - 0.01],
    [frameT, gh, gx0 - frameT / 2 + 0.01, gmy],
    [frameT, gh, gx1 + frameT / 2 - 0.01, gmy],
  ]) {
    group.add(at(rb(w, h, 0.14, 0.02, M.lilac), x, y, bz));
  }
  group.add(at(rb(gw + 0.2, 0.05, 0.25, 0.02, M.lavender), gmx, gy0 - 0.06, bz + 0.1)); // repisa
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), M.glass);
  glass.position.set(gmx, gmy, bz - 0.01);
  group.add(glass);
  // Galería de observación detrás (tarima elevada y luz tenue).
  const gallery = new THREE.Group();
  const gFloor = at(rb(3, 0.4, 2, 0.02, M.lavender), gmx, 0.2, bz - 1.05);
  gallery.add(gFloor);
  const gBack = new THREE.Mesh(new THREE.PlaneGeometry(3.2, Hh), new THREE.MeshStandardMaterial({ color: '#8c6bb8', roughness: 0.9 }));
  gBack.position.set(gmx, Hh / 2, bz - 2.05);
  gallery.add(gBack);
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(2.1, Hh), new THREE.MeshStandardMaterial({ color: '#9b7cc6', roughness: 0.9 }));
    side.position.set(gmx + sx * 1.5, Hh / 2, bz - 1.05);
    side.rotation.y = -sx * Math.PI / 2;
    gallery.add(side);
  }
  const gLight = new THREE.PointLight('#ffd6f0', 1.2, 4, 2);
  gLight.position.set(gmx, 2.6, bz - 1.2);
  gallery.add(gLight);
  group.add(gallery);
  const galleryAnchor = new THREE.Object3D();
  galleryAnchor.position.set(gmx - 0.2, 0.4, bz - 0.75);
  group.add(galleryAnchor);

  // ───────────── Puerta doble con ojos de buey ─────────────
  const doorZ = 1.1;
  const doorGroup = new THREE.Group();
  doorGroup.position.set(ROOM.maxX - 0.02, 0, doorZ);
  doorGroup.rotation.y = -Math.PI / 2;
  group.add(doorGroup);
  for (const sx of [-1, 1]) {
    const leaf = rb(0.78, 2.15, 0.06, 0.03, M.lilac);
    leaf.position.set(sx * 0.4, 1.08, 0);
    doorGroup.add(leaf);
    const port = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.03, 10, 32), M.cream);
    port.position.set(sx * 0.4, 1.55, 0.04);
    doorGroup.add(port);
    const pg = new THREE.Mesh(new THREE.CircleGeometry(0.15, 32), M.glass);
    pg.position.set(sx * 0.4, 1.55, 0.035);
    doorGroup.add(pg);
    doorGroup.add(at(rb(0.2, 0.3, 0.02, 0.01, M.steel), sx * 0.2, 1.05, 0.04));
  }
  doorGroup.add(at(rb(1.8, 0.1, 0.1, 0.02, M.lavender), 0, 2.2, 0));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.225), new THREE.MeshBasicMaterial({ map: signTexture('QUIRÓFANO 1'), toneMapped: false }));
  sign.position.set(0, 2.5, 0.02);
  doorGroup.add(sign);
  const doorLight = new THREE.MeshStandardMaterial({ color: '#ff2e93', emissive: '#ff2e93', emissiveIntensity: 2 });
  const lightBulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 10), doorLight);
  lightBulb.position.set(0.55, 2.5, 0.05);
  doorGroup.add(lightBulb);

  // ───────────── Decoración kawaii ─────────────
  const poster = new THREE.Mesh(
    new THREE.PlaneGeometry(0.6, 0.8),
    new THREE.MeshStandardMaterial({ map: posterTexture('¡Cuida el hueso!', ['47 °C = necrosis', 'Irriga siempre', 'Tú puedes, doctora']), roughness: 0.6 }),
  );
  poster.position.set(ROOM.minX + 0.01, 1.75, -1.4);
  poster.rotation.y = Math.PI / 2;
  group.add(poster);
  const clock = clockTexture();
  const clockMesh = new THREE.Mesh(new THREE.CircleGeometry(0.22, 40), new THREE.MeshStandardMaterial({ map: clock.tex, roughness: 0.5 }));
  clockMesh.position.set(-1.4, 2.55, ROOM.minZ + 0.02);
  group.add(clockMesh);
  const clockRim = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 10, 40), M.pink);
  clockRim.position.copy(clockMesh.position);
  group.add(clockRim);
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.12, 16), M.pink);
    ear.position.set(-1.4 + sx * 0.14, 2.8, ROOM.minZ + 0.03);
    ear.rotation.z = -sx * 0.35;
    group.add(ear);
  }
  // Estantería abierta menta con frascos (contra la pared izquierda).
  const shelfG = new THREE.Group();
  shelfG.position.set(ROOM.minX + 0.2, 0, 1.2);
  shelfG.rotation.y = Math.PI / 2;
  group.add(shelfG);
  shelfG.add(at(rb(1.2, 1.9, 0.03, 0.01, M.mint), 0, 0.95, -0.19));
  for (const sx of [-1, 1]) shelfG.add(at(rb(0.04, 1.9, 0.4, 0.015, M.mint), sx * 0.6, 0.95, 0));
  for (let i = 0; i < 4; i++) {
    shelfG.add(at(rb(1.2, 0.03, 0.4, 0.01, M.cream), 0, 0.1 + i * 0.58, 0));
    if (i === 3) continue;
    for (let k = 0; k < 5; k++) {
      const mat = [M.pink, M.lavender, M.fuchsia, M.cream, M.lilac][(k + i) % 5];
      const h = 0.12 + ((k * 7 + i * 3) % 4) * 0.03;
      shelfG.add(at(cyl(0.05, 0.05, h, mat, 16), -0.45 + k * 0.22, 0.115 + i * 0.58 + h / 2, 0.02));
      shelfG.add(at(cyl(0.035, 0.035, 0.025, M.cream, 16), -0.45 + k * 0.22, 0.115 + i * 0.58 + h + 0.012, 0.02));
    }
  }

  // ───────────── Mesa de operaciones ─────────────
  const table = new THREE.Group();
  table.name = 'mesa';
  table.add(at(rb(0.75, 0.08, 0.5, 0.03, M.brushed), 0, 0.04, 0));
  table.add(at(cyl(0.11, 0.14, 0.62, M.steel, 24), 0, 0.39, 0));
  table.add(at(rb(0.5, 0.06, 0.36, 0.02, M.brushed), 0, 0.72, 0));
  table.add(at(rb(1.55, 0.07, 0.6, 0.03, M.steel), 0.05, TABLE_TOP_Y - 0.035, 0));
  table.add(at(rb(1.5, 0.03, 0.56, 0.015, M.lavender), 0.05, TABLE_TOP_Y - 0.005, 0));
  for (const sz of [-1, 1]) table.add(at(rb(1.4, 0.02, 0.02, 0.008, M.steel), 0.05, TABLE_TOP_Y - 0.05, sz * 0.31)); // rieles
  group.add(table);

  // ───────────── Lámpara cialítica ─────────────
  const lampRoot = new THREE.Group();
  lampRoot.position.set(0.35, Hh, -0.95);
  group.add(lampRoot);
  lampRoot.add(at(cyl(0.18, 0.18, 0.05, M.cream, 32), 0, -0.025, 0));
  lampRoot.add(at(cyl(0.035, 0.035, 0.45, M.steel), 0, -0.25, 0));
  const j1 = new THREE.Vector3(0, -0.48, 0);
  lampRoot.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), M.pink), j1.x, j1.y, j1.z));
  // Brazo horizontal hacia la mesa.
  const headPos = new THREE.Vector3(0.0 - 0.35, 1.95 - Hh, 0.08 + 0.95); // relativo a lampRoot
  const j2 = new THREE.Vector3(headPos.x * 0.6, -0.62, headPos.z * 0.7);
  const armBetween = (a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) => {
    const d = new THREE.Vector3().subVectors(b, a);
    const m = cyl(r, r, d.length(), mat, 16);
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    return m;
  };
  lampRoot.add(armBetween(j1, j2, 0.032, M.cream));
  lampRoot.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), M.pink), j2.x, j2.y, j2.z));
  const j3 = new THREE.Vector3(headPos.x, headPos.y + 0.28, headPos.z);
  lampRoot.add(armBetween(j2, j3, 0.028, M.cream));
  lampRoot.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), M.pink), j3.x, j3.y, j3.z));
  // Horquilla y cabezal.
  const head = new THREE.Group();
  head.position.copy(headPos);
  lampRoot.add(head);
  lampRoot.add(armBetween(j3, headPos.clone().add(new THREE.Vector3(0, 0.06, 0)), 0.022, M.steel));
  // El cabezal mira hacia -Z local por defecto (lookAt de Object3D orienta +Z): construimos con la cara hacia +Z.
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.34, 40, 16, 0, Math.PI * 2, 0, Math.PI * 0.32), M.cream);
  shell.rotation.x = -Math.PI / 2; // la cúpula apunta a -Z (atrás), la boca a +Z
  shell.scale.set(1, 0.55, 1);
  shell.position.z = 0.115;
  shell.castShadow = true;
  head.add(shell);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.03, 12, 48), M.pink);
  rim.position.z = 0.02;
  head.add(rim);
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.29, 48), new THREE.MeshStandardMaterial({ color: '#f4eefa', roughness: 0.3 }));
  face.position.z = 0.015;
  head.add(face);
  const leds = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff7fb', emissiveIntensity: 3, toneMapped: false });
  const petal = new THREE.CircleGeometry(0.06, 24);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const r = i === 0 ? 0 : 0.17;
    const l = new THREE.Mesh(petal, leds);
    const ang = i === 0 ? 0 : a;
    l.position.set(Math.cos(ang) * r, Math.sin(ang) * r, 0.02);
    head.add(l);
    if (i > 0) {
      const ringM = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.008, 8, 24), M.lavender);
      ringM.position.copy(l.position);
      head.add(ringM);
    }
  }
  const handle = at(cyl(0.025, 0.025, 0.1, M.mint, 16), 0, 0, 0.07);
  handle.rotation.x = Math.PI / 2;
  head.add(handle);
  const light = new THREE.SpotLight('#fff8f2', 40, 5, 0.34, 0.75, 1.6);
  light.position.set(0, 0, 0.05);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.bias = -0.0004;
  light.shadow.normalBias = 0.01;
  light.shadow.camera.near = 0.2;
  light.shadow.camera.far = 4;
  head.add(light);
  group.add(light.target);
  // Haz visible (cono aditivo con degradado).
  const beamMat = new THREE.MeshBasicMaterial({
    map: beamTexture(),
    color: '#fff3fb',
    transparent: true,
    opacity: 0.1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const beamGeo = new THREE.CylinderGeometry(0.2, 0.42, 1, 40, 1, true);
  beamGeo.translate(0, -0.5, 0); // de 0 (lámpara) a -1
  beamGeo.rotateX(-Math.PI / 2); // eje hacia +Z
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.renderOrder = 5;
  head.add(beam);

  // ───────────── Monitor sobre pie ─────────────
  const monitor = new THREE.Group();
  monitor.position.set(-1.05, 0, -0.95);
  monitor.rotation.y = 0.55;
  group.add(monitor);
  monitor.add(wheelBase(M.lavender, M.rubber));
  monitor.add(at(cyl(0.025, 0.025, 1.3, M.steel), 0, 0.7, 0));
  const mBody = at(rb(0.58, 0.42, 0.08, 0.04, M.lilac), 0, 1.5, 0);
  monitor.add(mBody);
  const monitorScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.3125), M.screen);
  monitorScreen.position.set(0, 1.5, 0.042);
  monitor.add(monitorScreen);
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.1, 4, 12), M.pink);
    ear.position.set(sx * 0.16, 1.8, 0);
    ear.rotation.z = -sx * 0.25;
    ear.castShadow = true;
    monitor.add(ear);
  }
  monitor.add(at(rb(0.2, 0.06, 0.06, 0.02, M.mint), 0, 1.25, 0.02));

  // ───────────── Mesa de Mayo (bandeja de instrumental) ─────────────
  const tray = new THREE.Group();
  tray.position.set(0.95, 0, -0.62);
  group.add(tray);
  tray.add(wheelBase(M.brushed, M.rubber, 0.24));
  tray.add(at(cyl(0.022, 0.022, 0.95, M.steel), 0, 0.5, 0));
  tray.add(at(rb(0.62, 0.025, 0.42, 0.01, M.steel), 0, 0.99, 0));
  tray.add(at(rb(0.6, 0.01, 0.4, 0.005, M.towel), 0, 1.005, 0));
  const lay = (id: Parameters<typeof createInstrumentModel>[0], x: number, z: number, rot: number) => {
    const m = createInstrumentModel(id);
    m.rotation.set(-Math.PI / 2, 0, rot);
    m.position.set(x, 1.016, z);
    m.traverse((o) => {
      o.castShadow = true;
    });
    tray.add(m);
  };
  lay('scalpel10', -0.22, 0.1, 0.1);
  lay('forceps', -0.14, 0.1, -0.05);
  lay('needleHolder', -0.05, 0.1, 0.05);
  lay('kern', 0.08, 0.1, 0.1);
  lay('screwdriver', 0.2, 0.08, -0.1);
  const plateM = createInstrumentModel('plate');
  plateM.position.set(0.05, 1.012, -0.1);
  tray.add(plateM);
  // Cajita de tornillos dorados.
  const box = at(rb(0.12, 0.03, 0.08, 0.008, M.pink), -0.18, 1.025, -0.12);
  tray.add(box);
  const goldM = new THREE.MeshStandardMaterial({ color: '#e8c46a', metalness: 1, roughness: 0.3 });
  for (let i = 0; i < 8; i++) tray.add(at(cyl(0.004, 0.004, 0.012, goldM, 8), -0.22 + (i % 4) * 0.025, 1.045, -0.13 + Math.floor(i / 4) * 0.025));

  // ───────────── Gotero ─────────────
  const iv = new THREE.Group();
  iv.position.set(-0.95, 0, 0.65);
  group.add(iv);
  iv.add(wheelBase(M.brushed, M.rubber, 0.25));
  iv.add(at(cyl(0.015, 0.015, 1.95, M.steel), 0, 1.0, 0));
  iv.add(at(rb(0.3, 0.02, 0.02, 0.008, M.steel), 0, 1.97, 0));
  const bag = at(rb(0.13, 0.22, 0.04, 0.03, M.fluid), 0.1, 1.8, 0);
  iv.add(bag);
  iv.add(at(rb(0.08, 0.05, 0.042, 0.01, M.pink), 0.1, 1.78, 0.001));
  iv.add(at(cyl(0.012, 0.012, 0.06, M.glass, 12), 0.1, 1.64, 0));
  const ivDrop = at(new THREE.Mesh(new THREE.SphereGeometry(0.005, 8, 6), new THREE.MeshStandardMaterial({ color: '#c9f2ff', roughness: 0.1 })), 0.1, 1.66, 0);
  iv.add(ivDrop);
  const line = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.1, 1.61, 0), new THREE.Vector3(0.12, 1.2, 0.02), new THREE.Vector3(0.35, 0.95, -0.2), new THREE.Vector3(0.5, 0.86, -0.55)]), 40, 0.004, 6),
    new THREE.MeshStandardMaterial({ color: '#f4fbff', transparent: true, opacity: 0.7 }),
  );
  iv.add(line);

  // ───────────── Máquina de anestesia ─────────────
  const anesthesia = new THREE.Group();
  anesthesia.position.set(-1.6, 0, -0.25);
  anesthesia.rotation.y = 0.35;
  group.add(anesthesia);
  anesthesia.add(at(rb(0.62, 0.9, 0.5, 0.05, M.mint), 0, 0.55, 0));
  anesthesia.add(at(rb(0.66, 0.04, 0.54, 0.015, M.cream), 0, 1.02, 0));
  for (const [x, z] of [
    [-0.26, -0.2],
    [0.26, -0.2],
    [-0.26, 0.2],
    [0.26, 0.2],
  ])
    anesthesia.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), M.rubber), x, 0.045, z));
  // Cajones rosados.
  for (let i = 0; i < 3; i++) anesthesia.add(at(rb(0.5, 0.18, 0.02, 0.02, M.pink), 0, 0.3 + i * 0.22, 0.255));
  // Vaporizador y manómetros.
  anesthesia.add(at(cyl(0.06, 0.06, 0.2, M.fuchsia, 20), -0.18, 1.14, 0.05));
  anesthesia.add(at(cyl(0.035, 0.035, 0.05, M.cream, 16), -0.18, 1.265, 0.05));
  for (let i = 0; i < 3; i++) {
    const gauge = at(cyl(0.05, 0.05, 0.03, M.cream, 24), 0.02 + i * 0.12, 1.28, -0.15);
    gauge.rotation.x = Math.PI / 2;
    anesthesia.add(gauge);
    const needle = at(rb(0.004, 0.035, 0.004, 0.001, M.ink), 0.02 + i * 0.12, 1.29, -0.13);
    needle.rotation.z = -0.6 + i * 0.5;
    anesthesia.add(needle);
  }
  anesthesia.add(at(rb(0.5, 0.26, 0.04, 0.02, M.lavender), 0.08, 1.28, -0.19));
  // Fuelle en su campana transparente.
  const bellowsHousing = at(cyl(0.09, 0.09, 0.32, M.glass, 24), 0.22, 1.22, 0.1);
  anesthesia.add(bellowsHousing);
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) profile.push(new THREE.Vector2(i % 2 ? 0.07 : 0.078, i / 12));
  const bellows = new THREE.Mesh(new THREE.LatheGeometry(profile, 24), M.pink);
  bellows.position.set(0.22, 1.07, 0.1);
  bellows.scale.set(1, 0.24, 1);
  bellows.castShadow = true;
  anesthesia.add(bellows);
  anesthesia.add(at(cyl(0.1, 0.1, 0.02, M.cream, 24), 0.22, 1.39, 0.1));

  // Rendimiento: los objetos pequeños no proyectan sombra (menos llamadas en los mapas de sombra).
  group.traverse((o) => {
    const me = o as THREE.Mesh;
    if (!me.isMesh) return;
    me.geometry.computeBoundingSphere();
    const r = (me.geometry.boundingSphere?.radius ?? 1) * Math.max(me.scale.x, me.scale.y, me.scale.z);
    if (r < 0.07) me.castShadow = false;
  });

  return {
    group,
    lamp: { head, light, beam, beamMat, leds },
    monitorScreen,
    monitor,
    tray,
    bellows,
    ivDrop,
    doorLight,
    clock,
    galleryAnchor,
    anesthesia,
  };
}
