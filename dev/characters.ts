/**
 * Página de desarrollo: pasarela con todos los humanos y animales sobre peanas pastel giratorias,
 * con nombres y animaciones que cambian cada 2 s.
 * Parámetros: ?focus=<id> (un personaje en grande), ?anim=<anim> (fija la animación), ?spin=0 (sin giro),
 * ?yaw=<grados> (orientación fija), ?emote=hearts, ?blush=1, ?cone=0, ?shaved=1.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { AnimalModelId, CharacterAnim, CharacterRig, Emote, HumanId } from '../src/core/contracts';
import { createCharacterFactory } from '../src/characters/factory';
import { ALL_ANIMS } from '../src/characters/anim/humanPose';

const HUMANS: Array<[HumanId, string]> = [
  ['emiliana', 'Dra. Emiliana'],
  ['valerio', 'Dr. Valerio'],
  ['rodrigo', 'Rodrigo'],
  ['fritz', 'Fritz'],
  ['gigi', 'Gigi'],
  ['hortensia', 'Doña Hortensia'],
  ['braulio', 'Don Braulio'],
  ['ownerA', 'Dueña A'],
  ['ownerB', 'Dueño B'],
  ['ownerC', 'Dueño C'],
];
const ANIMALS: Array<[AnimalModelId, string]> = [
  ['chihuahua', 'Panchito (chihuahua)'],
  ['poodle', 'Merengue (caniche)'],
  ['bulldog', 'Sir Winston (bulldog)'],
  ['dachshund', 'Chorizo (teckel)'],
  ['pitbull', 'Tanque (pit bull)'],
  ['bordercollie', 'Rayo (border collie)'],
  ['cat', 'Duquesa (gata)'],
  ['rabbit', 'Copito (conejo)'],
];

const q = new URLSearchParams(location.search);
const focus = q.get('focus');
const fixedAnim = q.get('anim') as CharacterAnim | null;
const spin = q.get('spin') !== '0';
const fixedYaw = q.has('yaw') ? (Number(q.get('yaw')) * Math.PI) / 180 : null;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#ffe9f5');
scene.fog = new THREE.Fog('#ffe9f5', 14, 30);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

scene.add(new THREE.HemisphereLight('#fff6fb', '#c8a2e8', 1.1));
const key = new THREE.DirectionalLight('#fff1e6', 2.2);
key.position.set(3, 6, 5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -8;
key.shadow.camera.right = 8;
key.shadow.camera.top = 6;
key.shadow.camera.bottom = -3;
key.shadow.bias = -0.0005;
scene.add(key);
const rim = new THREE.DirectionalLight('#c9b6ff', 1.2);
rim.position.set(-4, 3, -4);
scene.add(rim);

const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshStandardMaterial({ color: '#f7d9ec', roughness: 0.9 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const factory = createCharacterFactory();
interface Entry { rig: CharacterRig; pedestal: THREE.Group; label: HTMLDivElement; animal: boolean }
const entries: Entry[] = [];

function pedestal(r: number, color: string): THREE.Group {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.04, 0.08, 40), new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, clearcoat: 0.8 }));
  top.position.y = 0.04;
  top.receiveShadow = true;
  top.castShadow = true;
  const band = new THREE.Mesh(new THREE.TorusGeometry(r * 1.02, 0.012, 8, 48), new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.3, clearcoat: 1 }));
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.08;
  g.add(top, band);
  scene.add(g);
  return g;
}

function addLabel(text: string, animal: boolean): HTMLDivElement {
  const d = document.createElement('div');
  d.className = animal ? 'label animal' : 'label';
  d.textContent = text;
  document.body.appendChild(d);
  return d;
}

const cone = q.get('cone') !== '0';
const shaved = q.get('shaved') === '1';
const pastel = ['#c8a2e8', '#9ff0d0', '#ffb8dc', '#ffe08a', '#b7d8ff'];
const humansShown = focus ? HUMANS.filter(([id]) => id === focus) : HUMANS;
const animalsShown = focus ? ANIMALS.filter(([id]) => id === focus) : ANIMALS;

humansShown.forEach(([id, name], i) => {
  const rig = factory.human(id);
  const p = pedestal(0.42, pastel[i % pastel.length]);
  const x = focus ? 0 : (i - (humansShown.length - 1) / 2) * 1.02;
  p.position.set(x, 0, focus ? 0 : -1.2);
  rig.root.position.y = 0.08;
  p.add(rig.root);
  entries.push({ rig, pedestal: p, label: addLabel(name, false), animal: false });
});
animalsShown.forEach(([id, name], i) => {
  const rig = factory.animal(id, { cone: id === 'chihuahua' && cone, shaved });
  const p = pedestal(0.36, pastel[(i + 2) % pastel.length]);
  const x = focus ? 0 : (i - (animalsShown.length - 1) / 2) * 1.0;
  p.position.set(x, 0, focus ? 0 : 2.4);
  rig.root.position.y = 0.08;
  p.add(rig.root);
  entries.push({ rig, pedestal: p, label: addLabel(name, true), animal: true });
});

const camera = new THREE.PerspectiveCamera(focus ? 26 : 30, innerWidth / innerHeight, 0.05, 80);
function frameCamera() {
  if (focus && entries[0]) {
    const h = entries[0].rig.height;
    const animal = entries[0].animal;
    const dist = animal ? 0.5 + h * 3.2 : h * 2.75;
    camera.position.set(0, animal ? h * 0.9 + 0.15 : h * 0.62, dist);
    camera.lookAt(0, animal ? h * 0.45 + 0.05 : h * 0.55, 0);
  } else {
    camera.position.set(0, 2.2, 11.2);
    camera.lookAt(0, 0.45, 0.4);
  }
}
frameCamera();

const emoteParam = q.get('emote') as Emote | null;
if (emoteParam) entries.forEach((e) => e.rig.setEmote(emoteParam));
if (q.get('blush')) entries.forEach((e) => e.rig.setBlush(Number(q.get('blush'))));

const animEl = document.getElementById('anim')!;
let animIndex = 0;
let paused = false;
const EMOTES: Emote[] = ['hearts', 'sweat', 'anger', 'music', 'stars', 'zzz'];
function applyAnim() {
  const a = fixedAnim ?? ALL_ANIMS[animIndex % ALL_ANIMS.length];
  animEl.textContent = a;
  entries.forEach((e, i) => {
    e.rig.setAnim(a);
    if (!emoteParam) e.rig.setEmote(animIndex % 3 === 2 ? EMOTES[(i + animIndex) % EMOTES.length] : null);
  });
}
applyAnim();
let cycleT = 0;
addEventListener('keydown', (ev) => {
  if (ev.code === 'Space') paused = !paused;
  if (ev.code === 'ArrowRight') { animIndex++; applyAnim(); }
});
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

const tmp = new THREE.Vector3();
let last = performance.now();
let t = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  t += dt;
  if (!paused && !fixedAnim) {
    cycleT += dt;
    if (cycleT >= 2) {
      cycleT = 0;
      animIndex++;
      applyAnim();
    }
  }
  entries.forEach((e, i) => {
    if (fixedYaw !== null) e.pedestal.rotation.y = fixedYaw;
    else if (spin) e.pedestal.rotation.y = Math.sin(t * 0.5 + i * 0.4) * 0.55;
    e.rig.update(dt);
    e.pedestal.getWorldPosition(tmp);
    tmp.y -= 0.02;
    tmp.project(camera);
    e.label.style.left = `${((tmp.x + 1) / 2) * innerWidth}px`;
    e.label.style.top = `${((1 - tmp.y) / 2) * innerHeight + 6}px`;
  });
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as { __ready: boolean }).__ready = true;
