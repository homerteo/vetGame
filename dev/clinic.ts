/**
 * Página de desarrollo de la clínica con dobles propios (personajes de cápsulas, audio mudo, diálogo mínimo).
 * Parámetros: ?case=0|1|2|4 (variante), ?ff=<s> (avanza la simulación al cargar), ?noslip=1.
 * Depuración: window.__clinic (estado, teletransporte, interactuar), window.__outcome al terminar.
 */
import * as THREE from 'three';
import type { GameEvents } from '../src/core/contracts';
import { EventBus } from '../src/core/EventBus';
import { createInput } from '../src/core/Input';
import { createLoop } from '../src/core/Loop';
import { createClinic } from '../src/clinic/Clinic';
import { createFakeAudio, createFakeDialogue, createFakeFactory, fakeCase, fakeEffects, fakeSave, fakeSettings } from '../src/clinic/dev/fakes';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root') as HTMLElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const input = createInput(canvas);
const bus = new EventBus<GameEvents>();
const caseDef = fakeCase(Number(q.get('case') ?? 0));
const clinic = createClinic({
  renderer,
  uiRoot,
  factory: createFakeFactory(),
  audio: createFakeAudio(q.has('logsfx')),
  bus,
  input,
  caseDef,
  save: fakeSave(),
  effects: fakeEffects({ noSlip: q.get('noslip') === '1' }),
  dialogue: createFakeDialogue(),
  settings: fakeSettings(),
  onComplete: (o) => {
    (window as unknown as { __outcome: unknown }).__outcome = o;
    const pre = document.getElementById('outcome')!;
    pre.textContent = `onComplete(outcome)\n\n${JSON.stringify(o, null, 2)}`;
    pre.style.display = 'block';
  },
});
clinic.resize(window.innerWidth, window.innerHeight);
(window as unknown as { __clinic: unknown; __clinicApi: unknown; __renderer: unknown }).__clinic = clinic.debug;
(window as unknown as { __clinicApi: unknown }).__clinicApi = clinic;
(window as unknown as { __renderer: unknown }).__renderer = renderer;

const ff = Number(q.get('ff') ?? 0);
for (let t = 0; t < ff; t += 1 / 30) clinic.update(1 / 30);

const loop = createLoop((dt) => {
  clinic.update(dt);
  clinic.render();
});
loop.start();

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  clinic.resize(window.innerWidth, window.innerHeight);
});
