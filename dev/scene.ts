/**
 * Página de desarrollo del quirófano 3D con fakes (cápsulas en los puntos, herida con estado falso).
 * Parámetros: ?cam=overview|wound|micro · ?inst=<InstrumentId> · ?case=radius|spine|rabbit · ?valerio=in
 */
import * as THREE from 'three';
import { createSurgeryScene } from '../src/surgery/SurgeryScene';
import { createInstrumentModel } from '../src/surgery/InstrumentModels';
import {
  SAMPLE_INCISION,
  createFakeBleeding,
  createFakeBloodPool,
  createFakeBone,
  createFakeCharacterFactory,
  fakeSettings,
  sampleAnatomy,
  sampleCase,
  sampleClosedAnatomy,
  sampleSpineAnatomy,
} from '../src/surgery/scene/fakes';
import type { CameraMode, HumanId, InstrumentId, VitalsSnapshot } from '../src/core/contracts';
import { samplePolyline } from '../src/core/math';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight, false);

const caseKind = q.get('case') ?? 'radius';
const anatomy = caseKind === 'spine' ? sampleSpineAnatomy() : caseKind === 'rabbit' ? sampleClosedAnatomy() : sampleAnatomy();
const caseDef = sampleCase(anatomy, {
  patient: {
    name: 'Panchito',
    species: caseKind === 'rabbit' ? 'rabbit' : 'dog',
    animal: caseKind === 'rabbit' ? 'rabbit' : caseKind === 'spine' ? 'dachshund' : 'chihuahua',
    breed: '',
    weightKg: 2,
    ageText: '',
  },
  flags: { valerioInRoom: q.get('valerio') === 'in' },
});
const settings = fakeSettings({ goreLevel: 80, pastelMode: q.get('pastel') === '1' });
const bone = createFakeBone(anatomy);
const bleeding = createFakeBleeding();
const blood = createFakeBloodPool({ window: anatomy.window });
const factory = createFakeCharacterFactory();
const scene = createSurgeryScene({ renderer, caseDef, factory, bone, bleeding, blood, settings });
scene.resize(innerWidth, innerHeight);

// Personajes falsos (cápsulas) en sus puntos.
const crew: Array<[HumanId, keyof typeof scene.spots]> = [
  ['emiliana', 'emiliana'],
  ['rodrigo', 'rodrigo'],
  ['fritz', 'fritz'],
  ['gigi', 'gigi'],
  ['valerio', 'valerio'],
];
for (const [id, spot] of crew) {
  const rig = factory.human(id);
  const s = scene.spots[spot];
  rig.root.position.copy(s.position);
  rig.root.quaternion.copy(s.quaternion);
  scene.scene.add(rig.root);
}

// Estado de herida falso: abierta, con hueso, placa, sangrados y charco.
const w = scene.wound;
const cutAll = (layer: 'skin' | 'subcut' | 'fascia' | 'muscle', width: number) => {
  const pts = samplePolyline(SAMPLE_INCISION, 60);
  for (let i = 0; i < pts.length - 1; i++) w.cut(layer, pts[i], pts[i + 1], width);
};
if (!anatomy.closed) {
  cutAll('skin', 1.2);
  cutAll('subcut', 1.4);
  cutAll('fascia', 1.2);
  cutAll('muscle', 1.4);
  w.setRetraction(1);
  if (caseKind === 'radius') {
    bone.setPose('distal', { pos: { x: 106.5, y: 49.4 }, angleDeg: 0 });
    bone.implants.plate = {
      optionId: 'p6',
      pose: { pos: { x: 84, y: 49 }, angleDeg: -1 },
      holesLocal: [-24, -15, -6, 6, 15, 24].map((x) => ({ x, y: 0 })),
      lengthMm: 58,
      widthMm: 7,
      bend: 1,
    };
    bone.plateHolesWorld().forEach((p, i) => {
      if (i !== 2 && i !== 3) bone.implants.screws.push({ pos: p, lengthMm: 12, contaminated: false, stripped: false });
    });
  }
  bleeding.spawn({ x: 58, y: 42 }, 'arterial', 0);
  bleeding.spawn({ x: 100, y: 58 }, 'venous', 0);
  blood.fillTo(Number(q.get('pool') ?? 30));
} else {
  for (const x of [34, 56, 94, 118]) w.addDecal('pin', { x, y: 50 });
  w.addDecal('bar', { x: 34, y: 38 }, { to: { x: 118, y: 38 } });
}
w.setGuide(null, 'none');

// Monitor con constantes falsas.
const vitals: VitalsSnapshot = {
  hr: 118,
  spo2: 97,
  map: 74,
  etco2: 39,
  tempC: 37.6,
  bloodVolumePct: 94,
  bloodLostPct: 6,
  exito: 64,
  arrest: false,
  rhythm: 'sinus',
  alarms: q.get('alarm') ? ['map'] : [],
};
scene.setMonitorVitals(vitals);
scene.setPatientBreathing(16);

const INSTRUMENTS: InstrumentId[] = [
  'scalpel10',
  'scalpel15',
  'cautery',
  'gelpi',
  'weitlaner',
  'kern',
  'drill',
  'saw',
  'burr',
  'plate',
  'screwdriver',
  'needleHolder',
  'bandage',
  'kwire',
  'forceps',
  'rasp',
  'carm',
  'hand',
];
let instIdx = Math.max(0, INSTRUMENTS.indexOf((q.get('inst') ?? 'scalpel10') as InstrumentId));
scene.showInstrument(INSTRUMENTS[instIdx]);
let active = false;
let heat = 0;
let selfie = false;
let pointerMm = { x: 70, y: 50 };
scene.poseInstrument(pointerMm);

const startCam = (q.get('cam') ?? 'overview') as CameraMode;
scene.snapCamera(startCam);

const pickEl = document.getElementById('pick')!;
const marker = document.getElementById('marker')!;
addEventListener('pointermove', (e) => {
  const r = scene.pick(e.clientX, e.clientY);
  pointerMm = r.mm;
  pickEl.textContent = `${r.onWound ? 'Sobre la herida' : 'Fuera'}: (${r.mm.x.toFixed(1)}, ${r.mm.y.toFixed(1)}) mm · capa ${r.onWound ? w.topLayerAt(r.mm) : '—'} · ${INSTRUMENTS[instIdx]}`;
  const p = scene.project(r.mm);
  marker.style.left = `${p.x}px`;
  marker.style.top = `${p.y}px`;
});
addEventListener('keydown', (e) => {
  if (e.code === 'Digit1') scene.setCameraMode('overview');
  if (e.code === 'Digit2') scene.setCameraMode('wound');
  if (e.code === 'Digit3') scene.setCameraMode('micro');
  if (e.code === 'KeyI') {
    instIdx = (instIdx + 1) % INSTRUMENTS.length;
    scene.showInstrument(INSTRUMENTS[instIdx]);
  }
  if (e.code === 'KeyA') active = !active;
  if (e.code === 'KeyH') heat = heat > 0 ? 0 : 1;
  if (e.code === 'KeyS') scene.shake(1);
  if (e.code === 'KeyL') {
    selfie = !selfie;
    scene.setLamp(selfie ? 0.15 : 1, selfie ? { x: -420, y: -900 } : { x: 0, y: 0 });
  }
  if (e.code === 'KeyC') w.cut('fascia', pointerMm, { x: pointerMm.x + 4, y: pointerMm.y + 1 }, 1);
  if (e.code === 'KeyB') bleeding.spawn(pointerMm, 'arterial', t);
});
addEventListener('resize', () => scene.resize(innerWidth, innerHeight));

// Ciclo automático de cámaras para capturas: ?cycle=1
if (q.get('cycle') === '1') {
  const modes: CameraMode[] = ['overview', 'wound', 'micro'];
  let k = 0;
  setInterval(() => scene.setCameraMode(modes[++k % 3]), 2500);
}

// Vitrina de instrumental: ?showcase=1 (todos los modelos en una mesa, con etiqueta).
let showcaseCam: THREE.PerspectiveCamera | null = null;
if (q.get('showcase') === '1') {
  const shelf = new THREE.Group();
  shelf.position.set(0, 0, 3.1);
  scene.scene.add(shelf);
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.04, 1.2), new THREE.MeshStandardMaterial({ color: '#b8efdc', roughness: 0.8 }));
  top.position.y = 0.88;
  top.receiveShadow = true;
  shelf.add(top);
  INSTRUMENTS.forEach((id, i) => {
    const col = i % 6;
    const row = Math.floor(i / 6);
    const x = -0.85 + col * 0.34;
    const z = -0.42 + row * 0.38;
    const m = createInstrumentModel(id);
    m.scale.setScalar(1.3);
    // Tumbado: la punta mira a la cámara y el mango se aleja.
    m.rotation.set(-Math.PI / 2, 0, 0);
    if (id === 'plate' || id === 'carm') m.rotation.set(0.5, 0, 0);
    m.position.set(x, 0.91, z);
    m.traverse((o) => (o.castShadow = true));
    shelf.add(m);
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 48;
    const g = c.getContext('2d')!;
    g.fillStyle = '#3b2146';
    g.font = '800 30px Nunito, system-ui';
    g.textAlign = 'center';
    g.fillText(id, 128, 34);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.0375), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
    label.rotation.x = -Math.PI / 2;
    label.position.set(x, 0.902, z + 0.06);
    shelf.add(label);
  });
  showcaseCam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 20);
  showcaseCam.position.set(0, 2.35, 3.85);
  showcaseCam.lookAt(0, 0.88, 2.95);
}

let last = performance.now();
let t = 0;
let frames = 0;
let acc = 0;
function frame(now: number) {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  t += dt;
  for (const e of bleeding.emit(dt, t, vitals.hr)) blood.add(e.bleeder.pos, e.amount * 0.2);
  blood.step(dt);
  scene.poseInstrument(pointerMm, { active, heat, angleDeg: 0 });
  const a = performance.now();
  scene.update(dt, t);
  if (showcaseCam) renderer.render(scene.scene, showcaseCam);
  else scene.render();
  acc += performance.now() - a;
  frames++;
  if (frames % 60 === 0) {
    (window as unknown as { __frameMs: number }).__frameMs = acc / 60;
    acc = 0;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as { __scene: unknown; __renderer: unknown }).__scene = scene;
(window as unknown as { __renderer: unknown }).__renderer = renderer;
