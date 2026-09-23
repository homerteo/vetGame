/**
 * Página de desarrollo de la tripulación: quirófano falso (camilla, lámpara, bandeja, puerta),
 * director de caos falso y botones/teclas para lanzar interferencias y órdenes.
 * Parámetros: ?auto=solo|selfie|spike|panchito|gaze|foil|call (lanza una interferencia al cargar),
 * ?cmd=rodrigo:kind (orden automática a los 3 s), ?flags=rodrigoNoSolos,gigiSelfieBoost, ?cam=close,
 * ?step=0.25 (cada fotograma avanza ese tiempo fijo: útil en navegadores sin GPU), ?arrest=1.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type {
  AssistantId, BoutiqueEffects, CaseDef, CaseFlags, ChaosEvent, ChaosEventKind, CommandTone, CrewWorld, GameEvents,
  Settings, SurgerySceneAPI, WoundAPI,
} from '../src/core/contracts';
import { EventBus } from '../src/core/EventBus';
import { createCharacterFactory } from '../src/characters/factory';
import { createCrew } from '../src/surgery/assistants/Crew';
import { fakeDialogue } from '../src/surgery/assistants/logic/testing/fakeDialogue';

const q = new URLSearchParams(location.search);

// ───────────── escena falsa ─────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#e9dcf5');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;
scene.add(new THREE.HemisphereLight('#fff6fb', '#b79cf2', 0.9));
const sun = new THREE.DirectionalLight('#fff1e6', 1.4);
sun.position.set(3, 7, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -5;
sun.shadow.camera.right = 5;
sun.shadow.camera.top = 5;
sun.shadow.camera.bottom = -5;
scene.add(sun);

const mat = (color: string, o: Partial<THREE.MeshPhysicalMaterialParameters> = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.6, ...o });
// suelo de azulejos lila/menta
const tileC = document.createElement('canvas');
tileC.width = tileC.height = 64;
const tg = tileC.getContext('2d')!;
tg.fillStyle = '#e5d2f7';
tg.fillRect(0, 0, 64, 64);
tg.fillStyle = '#d4f5e8';
tg.fillRect(0, 0, 32, 32);
tg.fillRect(32, 32, 32, 32);
const tileT = new THREE.CanvasTexture(tileC);
tileT.wrapS = tileT.wrapT = THREE.RepeatWrapping;
tileT.repeat.set(12, 12);
tileT.colorSpace = THREE.SRGBColorSpace;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshStandardMaterial({ map: tileT, roughness: 0.8 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const wallM = mat('#f4e6ff');
for (const [x, z, r] of [[0, -3.5, 0], [-4, 0, Math.PI / 2]] as const) {
  const w = new THREE.Mesh(new THREE.PlaneGeometry(9, 4), wallM);
  w.position.set(x, 2, z);
  w.rotation.y = r;
  w.receiveShadow = true;
  scene.add(w);
}
// camilla con paños lila
const table = new THREE.Group();
scene.add(table);
const drape = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 0.8), mat('#c8a2e8', { sheen: 1, sheenColor: new THREE.Color('#ffffff') }));
drape.position.y = 0.92;
drape.castShadow = drape.receiveShadow = true;
table.add(drape);
const skirt = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.5, 0.85), mat('#b79cf2'));
skirt.position.y = 0.66;
table.add(skirt);
const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 0.45, 16), mat('#d9dde6', { metalness: 0.8, roughness: 0.25 }));
leg.position.y = 0.22;
table.add(leg);
const woundM = new THREE.MeshStandardMaterial({ color: '#ff7b9a', emissive: '#ff4f7a', emissiveIntensity: 0.3, roughness: 0.4 });
const wound = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.22), woundM);
wound.rotation.x = -Math.PI / 2;
wound.position.set(-0.1, 0.985, 0);
table.add(wound);
const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 14), mat('#e9b784', { clearcoat: 0.6 }));
head.position.set(0.82, 1.04, 0);
table.add(head);
// bandeja, monitor y puerta
const tray = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.35), mat('#d9dde6', { metalness: 0.9, roughness: 0.2 }));
tray.position.set(1.45, 1.0, 0.75);
scene.add(tray);
const trayLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 8), mat('#b9c2d6', { metalness: 0.9 }));
trayLeg.position.set(1.45, 0.5, 0.75);
scene.add(trayLeg);
const monitor = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.4, 0.08), mat('#3b2146', { clearcoat: 1 }));
monitor.position.set(1.4, 1.55, -1.1);
scene.add(monitor);
const screenM = new THREE.MeshBasicMaterial({ color: '#57ffb0' });
const screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.3), screenM);
screenMesh.position.set(1.4, 1.55, -1.055);
scene.add(screenMesh);
const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.2, 0.08), mat('#9ff0d0', { clearcoat: 0.8 }));
doorMesh.position.set(2.6, 1.1, -3.45);
scene.add(doorMesh);
const porthole = new THREE.Mesh(new THREE.CircleGeometry(0.18, 24), mat('#dff6ff', { roughness: 0.1 }));
porthole.position.set(2.6, 1.55, -3.4);
scene.add(porthole);
// lámpara cialítica
const lamp = new THREE.Group();
lamp.position.set(0, 2.35, 0);
scene.add(lamp);
const lampHead = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.26, 0.12, 32), mat('#ffffff', { clearcoat: 1 }));
lamp.add(lampHead);
const lampGlowM = new THREE.MeshBasicMaterial({ color: '#fff6c0' });
const lampGlow = new THREE.Mesh(new THREE.CircleGeometry(0.24, 32), lampGlowM);
lampGlow.rotation.x = Math.PI / 2;
lampGlow.position.y = -0.065;
lamp.add(lampGlow);
const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.2, 8), mat('#d9dde6', { metalness: 0.8 }));
arm.position.y = 0.66;
lamp.add(arm);
const spot = new THREE.SpotLight('#fff2d8', 30, 6, 0.45, 0.5, 1.2);
spot.position.set(0, 2.3, 0);
spot.castShadow = true;
scene.add(spot);
const spotTarget = new THREE.Object3D();
scene.add(spotTarget);
spot.target = spotTarget;

const spotPt = (x: number, z: number) => {
  const o = new THREE.Object3D();
  o.position.set(x, 0, z);
  scene.add(o);
  return o;
};
const spots = {
  emiliana: spotPt(-0.15, 0.78),
  rodrigo: spotPt(-1.25, 0.2),
  fritz: spotPt(0.95, 0.8),
  gigi: spotPt(0.2, -0.8),
  valerio: spotPt(-2.3, -0.9),
  tray: tray,
  lamp: lamp,
  monitor: monitor,
  door: spotPt(2.6, -2.9),
};

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.05, 60);
const close = q.get('cam') === 'close';
camera.position.set(close ? 2.2 : 3.3, close ? 2.8 : 3.9, close ? 2.9 : 4.3);
camera.lookAt(-0.35, 0.72, -0.3);
if (q.get('cam') === 'valerio') {
  camera.position.set(-1.1, 1.75, 0.6);
  camera.lookAt(-2.3, 1.55, -0.9);
}

const noop = () => {};
const fakeWound = { widthMm: 160, heightMm: 100, pxPerMm: 6.4, canvas: document.createElement('canvas') } as unknown as WoundAPI;
const fakeScene: SurgerySceneAPI = {
  scene,
  camera,
  wound: fakeWound,
  spots,
  setCameraMode: noop,
  pick: () => ({ mm: { x: 80, y: 50 }, onWound: true }),
  project: () => ({ x: innerWidth / 2, y: innerHeight / 2 }),
  setLamp: noop,
  showInstrument: noop,
  poseInstrument: noop,
  setPatientBreathing: noop,
  setMonitorVitals: noop,
  shake: noop,
  update: noop,
  render: () => renderer.render(scene, camera),
  resize: noop,
  dispose: noop,
};

// ───────────── tripulación ─────────────
const bus = new EventBus<GameEvents>();
const flags: CaseFlags = {};
for (const f of (q.get('flags') ?? '').split(',').filter(Boolean)) (flags as Record<string, boolean>)[f] = true;
const caseDef = { id: 'dev-crew', index: 3, flags } as unknown as CaseDef;
const settings = { reduceFlashes: false, tts: false, subtitles: true } as unknown as Settings;
const effects: BoutiqueEffects = { messageDurationSec: 20, noSlip: false, extraSlot: false, dominaCost: 15, handcuffsAutoSuction: false, lowConcTremorMult: 1, teamMoraleBonus: 5 };
const crew = createCrew({
  scene: fakeScene,
  factory: createCharacterFactory(),
  bus,
  caseDef,
  settings,
  effects,
  dialogue: fakeDialogue(),
  morale: { rodrigo: 60, fritz: 45, gigi: 55 },
});

// director de caos falso: termina las interferencias por tiempo o al resolverlas
let t = 0;
let nextId = 1;
const active = new Map<number, ChaosEvent>();
const DUR: Record<ChaosEventKind, number> = { rodrigoSolo: 12, gigiSelfie: 15, fritzTremorSpike: 10, panchitoIntrusion: 8, valerioGaze: 6, braulioFoil: 10, hortensiaCall: 6 };
const endEvent = (id: number) => {
  const ev = active.get(id);
  if (!ev) return;
  active.delete(id);
  crew.onChaosEnd(ev);
};
crew.setResolver((id) => endEvent(id));
const startChaos = (kind: ChaosEventKind) => {
  const ev: ChaosEvent = { id: nextId++, kind, start: t, duration: DUR[kind], intensity: 1 };
  active.set(ev.id, ev);
  crew.onChaosStart(ev);
};

// ───────────── interfaz ─────────────
const subs = document.getElementById('subs')!;
const pushSub = (html: string, cls = '') => {
  const d = document.createElement('div');
  d.className = `sub ${cls}`;
  d.innerHTML = html;
  subs.appendChild(d);
  while (subs.children.length > 4) subs.firstChild?.remove();
  setTimeout(() => d.remove(), 4200);
};
const NAMES: Record<string, string> = { emiliana: 'Emiliana', rodrigo: 'Rodrigo', fritz: 'Fritz', gigi: 'Gigi', valerio: 'Valerio', sistema: 'Sistema', panchito: 'Panchito', hortensia: 'Hortensia', braulio: 'Braulio' };
bus.on('say', (s) => pushSub(`<span class="who">${NAMES[s.speaker] ?? s.speaker}:</span>${s.text}`));
bus.on('toast', (s) => pushSub(s.text, 'toast'));
bus.on('sfx', (s) => pushSub(`[${s.name}]`, 'sfx'));

const KINDS: Array<[ChaosEventKind, string]> = [
  ['rodrigoSolo', 'Solo'], ['gigiSelfie', 'Selfie'], ['fritzTremorSpike', 'Temblor'], ['panchitoIntrusion', 'Panchito'],
  ['valerioGaze', 'Mirada'], ['braulioFoil', 'Aluminio'], ['hortensiaCall', 'Llamada'],
];
const chaosEl = document.getElementById('chaos')!;
KINDS.forEach(([k, label], i) => {
  const b = document.createElement('button');
  b.textContent = `${i + 1} ${label}`;
  b.onclick = () => startChaos(k);
  chaosEl.appendChild(b);
});
const cmdsEl = document.getElementById('cmds')!;
const TONES: Array<[CommandTone, string, string]> = [['kind', 'Amable', 'kind'], ['domina', 'Dómina', 'domina'], ['firmSweet', 'Firme', 'firm']];
for (const who of ['rodrigo', 'fritz', 'gigi'] as AssistantId[]) {
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `<b>${NAMES[who]}</b>`;
  for (const [tone, label, cls] of TONES) {
    const b = document.createElement('button');
    b.className = cls;
    b.textContent = label;
    b.onclick = () => crew.command(who, tone);
    row.appendChild(b);
  }
  cmdsEl.appendChild(row);
}
let arrest = false;
const MISC: Array<[string, () => void]> = [
  ['Manguera (H)', () => crew.rodrigo.pushHose({ x: 70, y: 48 })],
  ['Lámpara (L)', () => crew.gigi.fixLampByHand()],
  ['Rayos X: sale 5 s', () => crew.gigi.leaveRoomFor(5)],
  ['Tornillo', () => crew.fritz.presentItem('screw')],
  ['Se cae', () => crew.fritz.dropped()],
  ['Atrapado', () => crew.fritz.caught('perfect')],
  ['Gesto perfecto (G)', () => bus.emit('gesture', { label: 'Tornillo', quality: 0.96, perfect: true })],
  ['Falta', () => bus.emit('fault', { kind: 'char', detail: 'demo' })],
  ['Fase lista', () => bus.emit('phase:complete', { phaseId: 'demo' })],
  ['Paro (A)', () => { arrest = !arrest; }],
  ['Rubor', () => crew.emiliana.setBlush(1)],
];
const miscEl = document.getElementById('misc')!;
for (const [label, fn] of MISC) {
  const b = document.createElement('button');
  b.className = 'misc';
  b.textContent = label;
  b.onclick = fn;
  miscEl.appendChild(b);
}
addEventListener('keydown', (e) => {
  const n = Number(e.key);
  if (n >= 1 && n <= 7) startChaos(KINDS[n - 1][0]);
  const who: AssistantId | null = e.code === 'KeyZ' ? 'rodrigo' : e.code === 'KeyX' ? 'fritz' : e.code === 'KeyC' ? 'gigi' : null;
  if (who) crew.command(who, e.shiftKey ? 'domina' : e.altKey ? 'firmSweet' : 'kind');
  if (e.code === 'KeyH') MISC[0][1]();
  if (e.code === 'KeyL') MISC[1][1]();
  if (e.code === 'KeyG') MISC[6][1]();
  if (e.code === 'KeyA') arrest = !arrest;
});

const stateEl = document.getElementById('state')!;
const lightEl = document.getElementById('light')!;
const renderState = () => {
  const vs = crew.visualStates();
  const rows: Array<[string, string]> = vs.map((s) => [NAMES[s.id], `<span class="tag ${s.problem ? 'problem' : ''}">${s.state}</span> moral ${s.morale.toFixed(0)}`]);
  const focus = crew.rodrigo.focus();
  rows.push(
    ['Aspiración', `${crew.rodrigo.suctionRate().toFixed(3)} %BV/s${crew.rodrigo.grooveActive() ? ' 🎸' : ''}`],
    ['Foco', focus ? `${focus.x.toFixed(0)}, ${focus.y.toFixed(0)} mm` : 'auto'],
    ['Temblor Fritz', crew.fritz.tremor().toFixed(2)],
    ['Luz', crew.gigi.lightLevel().toFixed(2)],
    ['Grabando', crew.gigi.isFilming() ? 'sí' : 'no'],
    ['Despejado', crew.gigi.isClear() ? 'sí' : 'no'],
    ['Mirada', crew.valerio.isGazing() ? 'SÍ' : 'no'],
    ['Paro', arrest ? 'SÍ' : 'no'],
    ['Descuido', `${crew.neglectSeconds().toFixed(1)} s`],
    ['Activos', [...active.values()].map((e) => e.kind).join(', ') || '—'],
  );
  stateEl.innerHTML = rows.map(([k, v]) => `<tr><td class="k">${k}</td><td>${v}</td></tr>`).join('');
  lightEl.style.width = `${(crew.gigi.lightLevel() * 100).toFixed(0)}%`;
};

// arranque automático para capturas
const AUTO: Record<string, ChaosEventKind> = { solo: 'rodrigoSolo', selfie: 'gigiSelfie', spike: 'fritzTremorSpike', panchito: 'panchitoIntrusion', gaze: 'valerioGaze', foil: 'braulioFoil', call: 'hortensiaCall' };
const autoKinds = (q.get('auto') ?? '').split(',').map((a) => AUTO[a]).filter(Boolean);
let autoDone = false;
const autoCmd = q.get('cmd');
let autoCmdDone = false;

const world: CrewWorld = { t: 0, fieldLevelPct: 30, stepType: 'hemostasis', arrest: false, exito: 60 };
const aim = new THREE.Vector3();
const gigiHead = new THREE.Vector3();
let last = performance.now();
let uiT = 0;
const fixedStep = Number(q.get('step') ?? 0);
if (q.get('arrest') === '1') arrest = true;
function frame(now: number) {
  const real = Math.min(0.05, (now - last) / 1000);
  last = now;
  const total = fixedStep > 0 ? fixedStep : real;
  for (let done = 0; done < total - 1e-6; done += 0.05) tick(Math.min(0.05, total - done));
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
function tick(dt: number) {
  t += dt;
  if (!autoDone && t > 0.6) {
    autoDone = true;
    for (const k of autoKinds) startChaos(k);
  }
  if (autoCmd && !autoCmdDone && t > 3) {
    autoCmdDone = true;
    const [who, tone] = autoCmd.split(':') as [AssistantId, CommandTone];
    crew.command(who, tone ?? 'kind');
  }
  for (const ev of [...active.values()]) if (t - ev.start >= ev.duration) endEvent(ev.id);
  world.t = t;
  world.arrest = arrest;
  crew.update(dt, world);
  // la lámpara sigue la luz de Gigi (en el juego lo hace el controlador con scene.setLamp)
  const light = crew.gigi.lightLevel();
  spot.intensity = 6 + 34 * light;
  lampGlowM.color.setRGB(1, 0.96, 0.75).multiplyScalar(0.4 + 0.6 * light);
  woundM.emissiveIntensity = 0.05 + 0.35 * light;
  const gigiRoot = scene.getObjectByName('gigi');
  if (gigiRoot) gigiRoot.getWorldPosition(gigiHead).setY(1.5);
  aim.set(-0.1, 0.95, 0).lerp(gigiHead, 1 - light);
  spotTarget.position.copy(aim);
  lamp.rotation.x = (aim.z - lamp.position.z) * 0.25;
  lamp.rotation.z = -(aim.x - lamp.position.x) * 0.25;
  screenM.color.set(Math.sin(t * 8) > 0 ? '#57ffb0' : '#3fe39a');
  uiT += dt;
  if (uiT > 0.15) {
    uiT = 0;
    renderState();
  }
}
requestAnimationFrame(frame);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
const dbg = window as unknown as { __crew: typeof crew; __info: () => unknown };
dbg.__crew = crew;
dbg.__info = () => ({ t: +t.toFixed(2), calls: renderer.info.render.calls, tris: renderer.info.render.triangles, programs: renderer.info.programs?.length, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures });
