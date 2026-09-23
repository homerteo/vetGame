/**
 * Fase 1 — Clínica (GDD §3): triage, exploración, diagnóstico, contención de Panchito y coordinación del equipo.
 * Tercera persona sobre una maqueta kawaii; HUD propio en deps.uiRoot. Llama a deps.onComplete una sola vez.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type {
  AssistantId,
  CharacterAnim,
  CharacterRig,
  ClinicAPI,
  ClinicDeps,
  ClinicOutcome,
  DiagnosticTest,
  HumanId,
  LoopHandle,
  SfxName,
  SpeakerId,
} from '../core/contracts';
import { clamp } from '../core/math';
import { createRng } from '../core/rng';
import { fmtDec } from '../ui/logic/format';
import './clinic.css';
import * as L from './lines';
import { pickLine } from './lines';
import { createContamination, tickContamination } from './logic/contamination';
import { isPositive, shuffledOrder, splitTests, testResult, TEST_INFO } from './logic/diagnosis';
import { EXIT, SEATS, SPAWN, STATIONS, TEAM_IDLE, TEAM_WORK, ZONE_LABEL, type P2, type StationId } from './logic/layout';
import { inPuddle, resolveCollisions, stepBody, type Body, type Collider } from './logic/movement';
import { findPath } from './logic/nav';
import { nextObjective, type Objective, type ObjectiveSnapshot } from './logic/objectives';
import { computeClinicOutcome } from './logic/outcome';
import { addHisteria, applyExplanation, applyTila, createOwner, tickOwner, type ExplanationKind, type OwnerState, type Temper } from './logic/owners';
import {
  catchPanchito,
  createPanchito,
  isLoose,
  isZooming,
  panchitoZone,
  putInCarrier,
  tackleHits,
  tickPanchito,
  wriggleFree,
  type PanchitoEvent,
} from './logic/panchito';
import { ASSISTANTS, assign, consentActive, createTeam, dragAway, isWorking, pickDragVictim, tickTeam, type TeamEvent } from './logic/team';
import { TUNING } from './logic/tuning';
import { openChoice, openDiagnosisDialog, openExamPanel, type Dialog, type Note } from './ui/Dialogs';
import { ASSISTANT_NAME, createHud, SPEAKER_NAME, type TeamChipView, type WorldLabel } from './ui/Hud';
import { startMinigame, type Minigame } from './ui/Minigames';
import { createObjectiveMarker, createParticles } from './world/Fx';
import { buildLevel } from './world/Level';
import { drawBoneXray, drawThoraxXray } from './world/xrayImage';

// ───────────────────────── agentes (NPC) ─────────────────────────

interface Agent {
  rig: CharacterRig;
  x: number;
  z: number;
  yaw: number;
  restYaw: number;
  path: P2[];
  pi: number;
  speed: number;
  moving: boolean;
  restAnim: CharacterAnim;
  anim: CharacterAnim | null;
  onArrive: (() => void) | null;
  col: { kind: 'circle'; x: number; z: number; r: number } | null;
}

function makeAgent(rig: CharacterRig, x: number, z: number, yaw: number, restAnim: CharacterAnim, colR = 0): Agent {
  const a: Agent = { rig, x, z, yaw, restYaw: yaw, path: [], pi: 0, speed: 1.8, moving: false, restAnim, anim: null, onArrive: null, col: colR ? { kind: 'circle', x, z, r: colR } : null };
  rig.root.position.set(x, 0, z);
  rig.root.rotation.y = yaw;
  setAnim(a, restAnim);
  return a;
}

function setAnim(a: { rig: CharacterRig; anim: CharacterAnim | null }, anim: CharacterAnim): void {
  if (a.anim !== anim) {
    a.anim = anim;
    a.rig.setAnim(anim);
  }
}

function goAgent(a: Agent, to: P2, restYaw: number, restAnim: CharacterAnim, speed = 1.8, onArrive: (() => void) | null = null): void {
  a.path = findPath({ x: a.x, z: a.z }, to, 0.65);
  a.pi = 0;
  a.moving = true;
  a.speed = speed;
  a.restYaw = restYaw;
  a.restAnim = restAnim;
  a.onArrive = onArrive;
}

function turnTowards(cur: number, target: number, k: number): number {
  let d = (target - cur) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return cur + d * k;
}

function stepAgent(a: Agent, dt: number): void {
  if (a.moving) {
    let budget = a.speed * dt;
    while (budget > 0 && a.pi < a.path.length) {
      const t = a.path[a.pi];
      const dx = t.x - a.x;
      const dz = t.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d <= budget) {
        a.x = t.x;
        a.z = t.z;
        budget -= d;
        a.pi++;
      } else {
        a.x += (dx / d) * budget;
        a.z += (dz / d) * budget;
        a.yaw = turnTowards(a.yaw, Math.atan2(dx, dz), 1 - Math.exp(-dt * 10));
        budget = 0;
      }
    }
    setAnim(a, a.speed > 2.6 ? 'run' : 'walk');
    if (a.pi >= a.path.length) {
      a.moving = false;
      setAnim(a, a.restAnim);
      const cb = a.onArrive;
      a.onArrive = null;
      cb?.();
    }
  } else {
    a.yaw = turnTowards(a.yaw, a.restYaw, 1 - Math.exp(-dt * 6));
  }
  a.rig.root.position.set(a.x, a.rig.root.position.y, a.z);
  a.rig.root.rotation.y = a.yaw;
  if (a.col) {
    a.col.x = a.x;
    a.col.z = a.z;
  }
}

// ───────────────────────── clínica ─────────────────────────

interface OwnerEntry {
  state: OwnerState;
  agent: Agent;
  pet: Agent | null;
  seat: number;
  label: WorldLabel;
  labelBars: { pat: HTMLElement; hist: HTMLElement | null };
  present: boolean;
  arriveAt: number;
  /** Comparte personaje con un asistente (Rodrigo dueño de Chorizo). */
  sharedWith: AssistantId | null;
  talkCooldown: number;
}

interface Interaction {
  key: string;
  label: string;
  hold: number;
  enabled: boolean;
  run(): void;
}

export interface ClinicDebug {
  state(): Record<string, unknown>;
  teleport(x: number, z: number): void;
  teleportTo(station: StationId | 'owner'): void;
  setTimeLeft(sec: number): void;
  setHisteria(v: number): void;
  /** Coloca a Emiliana a 0,9 m de Panchito, mirándolo. */
  nearPanchito(): void;
  /** Simula `sec` segundos de juego de golpe (capturas y pruebas). */
  advance(sec: number): void;
  interact(): void;
  outcome(): ClinicOutcome;
}

const hashStr = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

const ASSISTANT_COLOR: Record<AssistantId, string> = { fritz: '#8fb8de', rodrigo: '#3fcf9c', gigi: '#f5c542' };

export function createClinic(deps: ClinicDeps): ClinicAPI & { debug: ClinicDebug } {
  const { caseDef, audio, bus, input, factory, effects } = deps;
  const cc = caseDef.clinic;
  const tutorial = !!caseDef.flags.tutorial;
  const rng = createRng(hashStr(caseDef.id) ^ (caseDef.index * 7919));
  const petName = caseDef.patient.name;

  // ── escena ──
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#3b2146');
  scene.fog = new THREE.Fog('#3b2146', 26, 48);
  const pmrem = new THREE.PMREMGenerator(deps.renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.32;
  pmrem.dispose();
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 120);
  let viewW = 1280;
  let viewH = 720;
  scene.add(new THREE.HemisphereLight('#fff6fb', '#b58fd6', 0.62));
  const key = new THREE.DirectionalLight('#fff1e6', 1.55);
  key.position.set(-7, 16, 9);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera;
  sc.left = -16;
  sc.right = 16;
  sc.top = 12;
  sc.bottom = -12;
  sc.near = 1;
  sc.far = 45;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight('#c8e8ff', 0.45);
  fill.position.set(8, 6, -6);
  scene.add(fill);

  const level = buildLevel();
  scene.add(level.root);
  const fx = createParticles(scene);
  const marker = createObjectiveMarker(scene);
  const hud = createHud(deps.uiRoot, { tutorial, shiftSec: TUNING.shiftSec });

  // placas de rayos X
  const boneXray = document.createElement('canvas');
  boneXray.width = 800;
  boneXray.height = 500;
  drawBoneXray(boneXray, caseDef.anatomy, cc.xrayLesion, `${petName.toUpperCase()} · ${caseDef.patient.breed} · CLÍNICA DRA. EMILIANA`, caseDef.index + 3);
  let thoraxXray: HTMLCanvasElement | null = null;
  const getThorax = () => {
    if (!thoraxXray) {
      thoraxXray = document.createElement('canvas');
      thoraxXray.width = 800;
      thoraxXray.height = 500;
      drawThoraxXray(thoraxXray, `${petName.toUpperCase()} · TÓRAX VD · CLÍNICA DRA. EMILIANA`, caseDef.index + 5);
    }
    return thoraxXray;
  };

  // ── estado general ──
  let time = 0;
  let shiftLeft = TUNING.shiftSec;
  let finishing = false;
  let finishT = 0;
  let completed = false;
  let hurryWarned = false;
  let concentration = TUNING.emiliana.concentration;
  let reserve = TUNING.emiliana.reserve;
  let minorHC = 0;
  let education = 0;
  let diagnosis: number | null = null;
  // Orden de los diagnósticos en el diálogo (posición mostrada → índice en los datos). Se baraja en cada
  // intento (no con la semilla fija del caso) para que la respuesta no sea siempre "1" ni memorizable.
  const dxOrder = shuffledOrder(cc.diagnosisOptions.length, createRng((Math.random() * 0x100000000) >>> 0));
  let explanation: ExplanationKind | null = null;
  let xrayMarked = false;
  let tilaGiven = false;
  let carryingTila = false;
  const testsDone = new Set<DiagnosticTest>();
  const platesTaken = new Set<DiagnosticTest>();
  const notes: Note[] = [];
  const { table: tableTests, lightbox: lightboxTests } = splitTests(cc);
  const required = cc.requiredTests ?? [];
  // moral inicial con el bonus de la Boutique (gorros de corazones)
  const team = createTeam(effects.teamMoraleBonus);
  const contamination = createContamination();
  const panchitoEnabled = !tutorial;
  const panchito = createPanchito(panchitoEnabled, rng);
  const foiled: Record<'lightbox' | 'autoclave', boolean> = { lightbox: false, autoclave: false };
  const dominaCost = Math.round((TUNING.emiliana.dominaCost * effects.dominaCost) / 15);

  // ── voz y subtítulos (escuchamos el bus: se muestra lo que emitimos y lo que emitan otros) ──
  const speakerName = new Map<SpeakerId, string>(Object.entries(SPEAKER_NAME) as Array<[SpeakerId, string]>);
  const lastSaid = new Map<string, number>();
  let selfEmit = false;
  const showLine = (speaker: SpeakerId, text: string, dur: number, name?: string) => {
    if (deps.settings.subtitles !== false) hud.subtitle(speaker, text, dur, name ?? speakerName.get(speaker));
    audio.voice(speaker, text);
  };
  // frases de otros módulos por el bus (las nuestras ya se pintan con el nombre correcto)
  const offSay = bus.on('say', (p) => {
    if (!selfEmit) showLine(p.speaker, p.text, p.durationSec ?? 3.4);
  });
  const offToast = bus.on('toast', (p) => hud.toast(p.text, p.kind === 'good' ? 'good' : p.kind === 'bad' ? 'bad' : 'info'));
  /** Frase con enfriamiento de 8 s por personaje (force = siempre). */
  function say(speaker: SpeakerId, text: string | undefined, force = false, dur?: number, name?: string): void {
    if (!text) return;
    const key = name ?? speaker;
    const last = lastSaid.get(key) ?? -99;
    if (!force && time - last < 8) return;
    lastSaid.set(key, time);
    selfEmit = true;
    bus.emit('say', { speaker, text, durationSec: dur });
    selfEmit = false;
    showLine(speaker, text, dur ?? 3.4, name);
  }
  const sayOwner = (o: OwnerState, text: string | undefined, force = false, dur?: number) => say(o.human, text, force, dur, o.name.split(',')[0]);
  const toast = (text: string, kind: 'info' | 'good' | 'bad' = 'info') => bus.emit('toast', { text, kind: kind === 'info' ? 'info' : kind });
  const sfx = (name: SfxName, volume = 1, pitch = 1) => audio.play(name, { volume, pitch });
  const line = (arr: readonly string[] | undefined) => (arr && arr.length ? pickLine(rng, arr) : undefined);
  const requiredPendingNow = () => {
    for (let i = 0; i < required.length; i++) if (!testsDone.has(required[i])) return true;
    return false;
  };
  const orReadyNow = () => diagnosis !== null && !requiredPendingNow();
  /** Temporizadores en tiempo de juego (se congelan con la pausa, a diferencia de window.setTimeout). */
  const timers: Array<{ at: number; fn: () => void }> = [];
  function later(sec: number, fn: () => void): void {
    timers.push({ at: time + sec, fn });
  }
  function runTimers(): void {
    for (let i = timers.length - 1; i >= 0; i--) {
      if (timers[i].at <= time) {
        const t = timers[i];
        timers.splice(i, 1);
        t.fn();
      }
    }
  }
  function stress(conc: number, res = 0): void {
    concentration = clamp(concentration - conc, 0, 100);
    reserve = clamp(reserve - res, 0, 100);
  }

  // ── Emiliana ──
  const emi = factory.human('emiliana');
  scene.add(emi.root);
  const emiA = { rig: emi, anim: null as CharacterAnim | null };
  setAnim(emiA, 'idle');
  const body: Body = { x: SPAWN.x, z: SPAWN.z, vx: 0, vz: 0, r: TUNING.player.radius };
  let yaw = Math.PI;
  let dashLeft = 0;
  let sprawlLeft = 0;
  let dashCooldown = 0;
  let dashDirX = 0;
  let dashDirZ = 1;
  let caught = false;
  let slipCooldown = 0;
  let wobble = 0;
  let stepTimer = 0;
  let holdKey = '';
  let holdT = 0;
  let pulseAnimLeft = 0;
  let pulseAnim: CharacterAnim = 'idle';
  const cupGeo = new THREE.CylinderGeometry(0.06, 0.05, 0.1, 14);
  const cupMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3 });
  const teaMat = new THREE.MeshStandardMaterial({ color: '#d9c060', roughness: 0.2 });
  const cup = new THREE.Group();
  const cupMesh = new THREE.Mesh(cupGeo, cupMat);
  const tea = new THREE.Mesh(new THREE.CircleGeometry(0.052, 14), teaMat);
  tea.rotation.x = -Math.PI / 2;
  tea.position.y = 0.045;
  cup.add(cupMesh, tea);
  cup.position.set(0.28, 1.02, 0.32);
  cup.visible = false;
  emi.root.add(cup);
  function pulse(anim: CharacterAnim, sec: number): void {
    pulseAnim = anim;
    pulseAnimLeft = sec;
  }

  // ── equipo ──
  const ownerHuman = caseDef.owner.human;
  const ownerIsAssistant = ownerHuman === 'rodrigo' || ownerHuman === 'fritz' || ownerHuman === 'gigi';
  const teamAgents = {} as Record<AssistantId, Agent>;
  for (const id of ASSISTANTS) {
    const rig = factory.human(id);
    scene.add(rig.root);
    const p = TEAM_IDLE[id];
    teamAgents[id] = makeAgent(rig, p.x, p.z, 0, id === 'fritz' ? 'tremble' : 'idle', 0.3);
  }
  const teamLabel = {} as Record<AssistantId, WorldLabel>;
  for (const id of ASSISTANTS) {
    teamLabel[id] = hud.addLabel('<div class="alert warn"></div>');
    teamLabel[id].setVisible(false);
  }
  let clipperLoop: LoopHandle | null = null;

  // ── dueños ──
  const owners: OwnerEntry[] = [];
  function addOwner(o: {
    id: string;
    kind: 'case' | 'minor';
    human: HumanId;
    name: string;
    petName: string;
    pet: CaseDefAnimal;
    temper: Temper;
    seat: number;
    errand?: string;
    arriveAt: number;
    patience?: number;
  }): OwnerEntry {
    const state = createOwner({ id: o.id, kind: o.kind, human: o.human, name: o.name, petName: o.petName, pet: o.pet, temper: o.temper, patience: o.patience, errand: o.errand });
    const seat = SEATS[o.seat];
    let agent: Agent;
    let sharedWith: AssistantId | null = null;
    if (o.kind === 'case' && ownerIsAssistant) {
      sharedWith = ownerHuman as AssistantId;
      agent = teamAgents[sharedWith];
    } else {
      const rig = factory.human(o.human);
      scene.add(rig.root);
      const start = o.arriveAt > 0 ? EXIT : seat;
      agent = makeAgent(rig, start.x, start.z, seat.yaw, 'sit', 0);
      rig.root.visible = o.arriveAt <= 0;
    }
    const petRig = factory.animal(o.pet, { cone: false });
    scene.add(petRig.root);
    const pp = { x: (o.arriveAt > 0 ? EXIT.x : seat.x) + 0.55, z: (o.arriveAt > 0 ? EXIT.z : seat.z) + 0.55 };
    const pet = makeAgent(petRig, pp.x, pp.z, seat.yaw, 'sit', 0);
    petRig.root.visible = o.arriveAt <= 0;
    const lbl = hud.addLabel(
      `<div class="pill ${o.kind === 'case' ? 'case' : ''}">${o.name}</div><div class="mini"><i></i></div>${state.histeria !== null ? '<div class="mini hist"><i></i></div>' : ''}`,
    );
    const bars = lbl.root.querySelectorAll('.mini i');
    const e: OwnerEntry = {
      state,
      agent,
      pet,
      seat: o.seat,
      label: lbl,
      labelBars: { pat: bars[0] as HTMLElement, hist: (bars[1] as HTMLElement) ?? null },
      present: o.arriveAt <= 0,
      arriveAt: o.arriveAt,
      sharedWith,
      talkCooldown: 0,
    };
    if (o.human !== 'emiliana') speakerName.set(o.human, o.name.split(',')[0]);
    owners.push(e);
    return e;
  }
  type CaseDefAnimal = typeof caseDef.patient.animal;

  const temper: Temper = cc.ownerTemper;
  const caseOwner = addOwner({
    id: 'case',
    kind: 'case',
    human: ownerHuman,
    name: caseDef.owner.name,
    petName,
    pet: caseDef.patient.animal,
    temper,
    seat: 1,
    arriveAt: 0,
  });
  if (caseOwner.sharedWith) {
    // Rodrigo (dueño) espera en la sala con su perro hasta que lo asignes
    const s = SEATS[1];
    const a = caseOwner.agent;
    a.x = s.x;
    a.z = s.z + 0.8;
    a.restYaw = 0;
  }
  const minorPool = L.MINOR_OWNERS.filter((m) => m.human !== ownerHuman);
  const minorSeats = [3, 4, 0, 5];
  const nMinor = Math.min(cc.minorCases, minorPool.length);
  for (let i = 0; i < nMinor; i++) {
    const m = minorPool[i];
    const errand = L.MINOR_ERRANDS[Math.floor(rng() * L.MINOR_ERRANDS.length)];
    addOwner({
      id: `m${i}`,
      kind: 'minor',
      human: m.human,
      name: m.name,
      petName: m.petName,
      pet: m.pet,
      temper: 'calm',
      seat: minorSeats[i],
      errand: errand.errand,
      arriveAt: i === 0 ? 0 : 30 + i * 45,
      patience: 90 + rng() * 10,
    });
  }
  const minorDone = new Map<string, string[]>();
  const caseState = caseOwner.state;
  const hortensia = caseState.histeria !== null ? caseOwner : null;

  // Don Braulio: dueño en el tutorial; visitante conspiranoico si el caso trae su caos
  const braulioVisitor = !tutorial && ownerHuman !== 'braulio' && (caseDef.chaos.includes('braulioFoil') || caseDef.chaos.includes('panchitoIntrusion'));
  let braulio: Agent | null = ownerHuman === 'braulio' ? caseOwner.agent : null;
  if (braulioVisitor) {
    const rig = factory.human('braulio');
    scene.add(rig.root);
    const s = SEATS[2];
    braulio = makeAgent(rig, s.x, s.z, s.yaw, 'sit', 0);
  }
  const braulioSeat = braulioVisitor ? SEATS[2] : SEATS[caseOwner.seat];
  let foilTimer: number = tutorial ? Infinity : TUNING.braulio.firstFoilSec;
  let tutorialFoilDone = false;
  let braulioBusy = false;

  // ── Panchito (el de verdad, con cono) ──
  const panchitoRig = panchitoEnabled ? factory.animal('chihuahua', { cone: true }) : null;
  const pA = panchitoRig ? { rig: panchitoRig, anim: null as CharacterAnim | null } : null;
  if (panchitoRig) {
    scene.add(panchitoRig.root);
    panchitoRig.root.position.set(panchito.x, 0, panchito.z);
  }
  const panchitoLabel = hud.addLabel('<div class="alert">¡!</div>');
  panchitoLabel.setVisible(false);
  const foilLabels = {
    lightbox: hud.addLabel('<div class="alert warn">¡ALUMINIO!</div>'),
    autoclave: hud.addLabel('<div class="alert warn">¡ALUMINIO!</div>'),
  };
  foilLabels.lightbox.setVisible(false);
  foilLabels.autoclave.setVisible(false);

  // colisionadores: nivel + NPC de pie (se actualizan en su sitio, sin asignar memoria)
  const colliders: Collider[] = [...level.colliders];
  for (const id of ASSISTANTS) if (teamAgents[id].col) colliders.push(teamAgents[id].col!);

  // ── modales ──
  let dialog: (Dialog & { refresh?(): void; setVisible?(v: boolean): void }) | null = null;
  let examPanel: ReturnType<typeof openExamPanel> | null = null;
  let game: Minigame | null = null;
  const modalOpen = () => !!dialog || !!game || !!examPanel;
  function closeDialog(): void {
    dialog?.close();
    dialog = null;
  }

  // ───────────────────────── acciones ─────────────────────────

  function hearComplaint(): void {
    caseState.complaintHeard = true;
    sayOwner(caseState, cc.complaint, true, 5.5);
    later(2.6, () => say('emiliana', line(L.EMILIANA_COMPLAINT_REPLY), true));
    // el paciente pasa a la camilla
    const pet = caseOwner.pet!;
    pet.moving = false;
    pet.x = level.examTop.x;
    pet.z = level.examTop.z;
    pet.rig.root.position.set(pet.x, level.examTop.y, pet.z);
    pet.restYaw = Math.PI / 2;
    pet.yaw = Math.PI / 2;
    setAnim(pet, 'idle');
    fx.burst('sparkle', pet.x, 1.2, pet.z, 10, 1.2, { size: 0.22 });
    toast(`${petName} ya está en la camilla de exploración`, 'good');
    sfx('uiClick');
  }

  function openExam(): void {
    examPanel = openExamPanel(hud.modalLayer, {
      petName,
      patientLine: `${caseDef.patient.breed} · ${fmtDec(caseDef.patient.weightKg, 1)} kg · ${caseDef.patient.ageText}`,
      complaint: cc.complaint,
      tests: cc.tests,
      state: () => ({ done: testsDone, taken: platesTaken, required, notes, busy: !!game }),
      onPick: runTest,
      onClose: () => {
        examPanel?.close();
        examPanel = null;
      },
    });
    setAnim(emiA, 'work');
  }

  function addNote(test: DiagnosticTest, stampOverride?: string, text?: string): void {
    const r = testResult(cc, test, petName);
    notes.push({ test, stamp: stampOverride ?? r.stamp, positive: r.positive, text: text ?? r.note });
  }

  function completeTest(test: DiagnosticTest): void {
    if (testsDone.has(test)) return;
    testsDone.add(test);
    if (test === cc.keyTest) education += 1;
  }

  function runTest(test: DiagnosticTest): void {
    if (game) return;
    const info = TEST_INFO[test];
    if (info.atLightbox) {
      platesTaken.add(test);
      sfx('xray');
      fx.burst('sparkle', level.examTop.x, 1.6, level.examTop.z, 8, 1, { size: 0.3 });
      level.setLightboxImage(test === 'xray' ? boneXray : getThorax());
      toast(`${info.label}: placa lista en el negatoscopio`, 'good');
      if (hortensia && test === 'xray') {
        const ev = addHisteria(hortensia.state, TUNING.histeria.xray);
        say('hortensia', line(L.HORTENSIA_XRAY), true);
        if (ev === 'faint') hortensiaFaint();
      }
      examPanel?.refresh();
      return;
    }
    examPanel?.setVisible(false);
    const positive = isPositive(cc, test);
    game = startMinigame({
      layer: hud.modalLayer,
      test,
      positive,
      petName,
      furColor: caseDef.anatomy.furColor || '#e8c9a0',
      audio,
      leniency: tutorial ? 1.5 : 1,
      resultText: testResult(cc, test, petName).note,
      onFinish: (r) => {
        game?.dispose();
        game = null;
        if (r.completed) {
          completeTest(test);
          addNote(test);
          sfx(positive ? 'perfect' : 'good');
        } else sfx('miss');
        examPanel?.setVisible(true);
        examPanel?.refresh();
      },
    });
  }

  function readPlate(): void {
    const pending = lightboxTests.filter((t) => platesTaken.has(t) && !testsDone.has(t));
    const test = pending[0];
    if (!test) return;
    level.setLightboxImage(test === 'xray' ? boneXray : getThorax());
    setAnim(emiA, 'point');
    game = startMinigame({
      layer: hud.modalLayer,
      test,
      positive: test === 'xray',
      petName,
      furColor: caseDef.anatomy.furColor || '#e8c9a0',
      audio,
      leniency: tutorial ? 1.5 : 1,
      plate: test === 'xray' ? boneXray : getThorax(),
      lesion: cc.xrayLesion,
      resultText: test === 'xray' ? '¡Lesión marcada con la fusta! Justo donde duele.' : testResult(cc, test, petName).note,
      onFinish: (r) => {
        game?.dispose();
        game = null;
        if (!r.completed) return;
        completeTest(test);
        if (test === 'xray') {
          xrayMarked = !!r.hit;
          addNote('xray', r.hit ? 'LESIÓN' : 'DUDOSA', r.hit ? 'Lesión marcada con la fusta: se ve clarita en la placa.' : 'No encontraste la lesión. Valerio lo anotará en rojo.');
          if (r.hit) {
            sfx('perfect');
            say('emiliana', '¡Ahí está! Nadie se me escapa, ni una fisura.', true);
          }
        } else addNote(test);
      },
    });
  }

  function openDiagnosis(): void {
    const pendingReq = required.filter((t) => !testsDone.has(t));
    const warning = pendingReq.length
      ? `Falta la prueba obligatoria: ${pendingReq.map((t) => TEST_INFO[t].label).join(', ')}. Podrás darla, pero no operar sin ella.`
      : testsDone.size === 0
        ? '¿Sin explorar? Valerio frunciría el ceño desde algún lugar.'
        : null;
    dialog = openDiagnosisDialog(hud.modalLayer, {
      ownerName: caseDef.owner.name,
      petName,
      notes,
      options: dxOrder.map((i) => cc.diagnosisOptions[i]),
      explanations: cc.explanations,
      warning,
      onCancel: closeDialog,
      onPick: (shown, kind) => {
        closeDialog();
        const dx = dxOrder[shown];
        if (tutorial && dx !== cc.correctDiagnosis) {
          toast(L.WRONG_DIAG_HINT, 'bad');
          say('emiliana', 'Mmm... no. Revisemos la libreta otra vez.', true);
          return;
        }
        diagnosis = dx;
        explanation = kind;
        say('emiliana', cc.explanations[kind], true, 6);
        const { effect, event } = applyExplanation(caseState, kind);
        education += effect.education;
        concentration = clamp(concentration + effect.concentration, 0, 100);
        later(3.2, () => {
          if (hortensia && kind === 'technical') say('hortensia', line(L.HORTENSIA_TECH), true);
          else sayOwner(caseState, line(L.DIAG_THANKS[kind]), true);
        });
        if (event === 'faint') hortensiaFaint();
        fx.burst(kind === 'technical' && hortensia ? 'bang' : 'heart', caseOwner.agent.x, 2, caseOwner.agent.z, 8, 1.2);
        sfx(kind === 'absurd' ? 'praise' : 'uiClick');
        if (kind === 'absurd') toast('+2 Educación: explicaste con peras y manzanas (y fideos)', 'good');
        const ready = !requiredPendingNow();
        toast(ready ? '¡Puerta del quirófano desbloqueada!' : 'Diagnóstico dado. Falta la prueba obligatoria para operar.', ready ? 'good' : 'info');
      },
    });
  }

  function giveTila(o: OwnerEntry): void {
    carryingTila = false;
    cup.visible = false;
    applyTila(o.state);
    tilaGiven = tilaGiven || o === caseOwner;
    say('emiliana', line(L.TILA_GIVE), true);
    later(1.8, () => sayOwner(o.state, line(L.TILA_THANKS), true));
    fx.burst('heart', o.agent.x, 1.9, o.agent.z, 9, 1);
    sfx('heartFlutter');
    pulse('offer', 1.2);
  }

  function serveMinor(o: OwnerEntry): void {
    const hc = Math.round(TUNING.minor.hcMin + rng() * (TUNING.minor.hcMax - TUNING.minor.hcMin));
    minorHC += hc;
    o.state.status = 'served';
    concentration = clamp(concentration + TUNING.emiliana.minorDone, 0, 100);
    const err = L.MINOR_ERRANDS.find((e) => e.errand === o.state.errand) ?? L.MINOR_ERRANDS[0];
    say('emiliana', line(err.done), true);
    later(2.2, () => sayOwner(o.state, line(L.MINOR_THANKS), true));
    sfx('coins');
    toast(`+${hc} HC · ${o.state.errand} de ${o.state.petName}`, 'good');
    fx.burst('star', o.agent.x, 1.8, o.agent.z, 10, 1.4);
    setAnim(o.agent, 'cheer');
    minorDone.set(o.state.id, []);
    later(1.8, () => leave(o));
  }

  function leave(o: OwnerEntry): void {
    const exitCb = () => {
      o.agent.rig.root.visible = false;
      if (o.pet) o.pet.rig.root.visible = false;
      o.present = false;
    };
    goAgent(o.agent, EXIT, 0, 'idle', 1.9, exitCb);
  }

  function assignDialog(id: AssistantId): void {
    const what = id === 'fritz' ? 'esterilizar instrumental en el autoclave' : id === 'rodrigo' ? 'rasurar y hacer la antisepsia' : 'explicar y firmar los consentimientos';
    const filming = team.a.gigi.filming && id === 'gigi';
    dialog = openChoice(hud.modalLayer, {
      title: `¿Cómo se lo pides a ${ASSISTANT_NAME[id]}?`,
      lead: `Tarea: ${what}.${filming ? ' Ojo: Gigi está grabando un TikTok.' : ''}`,
      items: [
        { title: 'Con cariño', sub: ' — petición amable.', tag: filming ? '+Moral · pero terminará su TikTok primero' : '+Moral · gratis' },
        { title: 'Orden de Dómina ¡CHAS!', sub: ' — fusta al aire.', tag: `−${dominaCost} Reserva · empieza ya y trabaja más rápido · −Moral`, kind: 'domina' },
      ],
      onCancel: closeDialog,
      onPick: (i) => {
        closeDialog();
        const tone = i === 1 ? 'domina' : 'kind';
        const r = assign(team, id, tone, dominaCost);
        if (!r) return;
        reserve = clamp(reserve - r.reserveCost, 0, 100);
        say('emiliana', line(deps.dialogue.commands[id]?.[tone]) ?? (tone === 'domina' ? `${ASSISTANT_NAME[id]}. Ahora.` : `${ASSISTANT_NAME[id]}, ¿me ayudas, cielo?`), true);
        if (tone === 'domina') {
          sfx('whip');
          pulse('crack', 1.1);
          fx.burst('star', body.x, 1.8, body.z, 6, 1.2, { size: 0.2 });
        } else pulse('point', 1);
        bus.emit('command', { target: id, tone, accepted: true });
        const replyKey = r.ignoredWhileFilming ? 'ignored' : tone;
        later(1.2, () => say(id, line(deps.dialogue.replies[id]?.[replyKey]) ?? (tone === 'domina' ? '¡Sí, doctora!' : '¡Voy!'), true));
        const a = teamAgents[id];
        const w = TEAM_WORK[id];
        const go = () =>
          goAgent(a, w, w.yaw, 'work', tone === 'domina' ? 3.0 : 1.9, () => {
            team.a[id].atStation = true;
          });
        if (r.delay > 0) later(r.delay, go);
        else go();
        toast(`${ASSISTANT_NAME[id]} asignad${id === 'gigi' ? 'a' : 'o'} ${tone === 'domina' ? 'con Orden de Dómina' : 'con cariño'}`, tone === 'domina' ? 'bad' : 'good');
      },
    });
  }

  function removeFoil(device: 'lightbox' | 'autoclave'): void {
    foiled[device] = false;
    level.setFoil(device, false);
    const s = STATIONS[device].pos;
    fx.burst('sparkle', s.x, 1.6, s.z, 12, 1.6, { size: 0.25 });
    sfx('bendPlate', 0.7, 1.4);
    if (braulio) say('braulio', line(L.BRAULIO_FOIL_REMOVED), true);
    toast(`Aluminio fuera. El ${device === 'lightbox' ? 'negatoscopio' : 'autoclave'} vuelve a funcionar`, 'good');
  }

  function braulioFoil(): void {
    if (!braulio || braulioBusy) return;
    const device: 'lightbox' | 'autoclave' = tutorial ? 'autoclave' : !foiled.autoclave && (isWorking(team.a.fritz) || rng() < 0.5) ? 'autoclave' : 'lightbox';
    if (foiled[device]) return;
    braulioBusy = true;
    const target = device === 'autoclave' ? { x: 10.9, z: 6.2 } : { x: -6.2, z: -6.9 };
    const agent = braulio;
    say('braulio', line(L.CONSPIRACIES), true);
    goAgent(agent, target, device === 'autoclave' ? Math.PI / 2 : Math.PI, 'work', 2.2, () => {
      later(1.4, () => {
        if (disposed) return;
        foiled[device] = true;
        level.setFoil(device, true);
        stress(TUNING.emiliana.foil);
        sfx('bendPlate', 0.8, 0.8);
        toast(`¡Don Braulio forró el ${device === 'lightbox' ? 'negatoscopio' : 'autoclave'} de aluminio!`, 'bad');
        say('braulio', line(deps.dialogue.chaos.braulioFoil?.start) ?? 'Listo. Ahora el 5G rebota.', true);
        goAgent(agent, braulioSeat, braulioSeat.yaw, 'sit', 1.6, () => (braulioBusy = false));
      });
    });
  }

  function hortensiaFaint(): void {
    if (!hortensia) return;
    const h = hortensia.agent;
    // se levanta y cae hacia la sala (de espaldas al tabique), bien a la vista
    const seat = SEATS[hortensia.seat];
    h.moving = false;
    h.x = seat.x;
    h.z = seat.z + 0.55;
    h.yaw = h.restYaw = Math.PI;
    setAnim(h, 'faint');
    sfx('hortensiaScream');
    later(0.7, () => sfx('faint'));
    say('hortensia', line(L.HORTENSIA_FAINT), true);
    stress(TUNING.emiliana.faint);
    toast('¡Doña Hortensia se desmayó y arrastra a alguien del equipo!', 'bad');
    fx.burst('bang', h.x, 2, h.z, 6, 1.5);
    const victim = pickDragVictim(team, rng);
    if (victim) {
      dragAway(team, victim, TUNING.histeria.faintSec);
      const a = teamAgents[victim];
      goAgent(a, { x: h.x + 0.9, z: h.z + 0.7 }, -Math.PI / 2, 'panic', 3.2);
      say(victim, `¡Voy, voy! ¡Aire, señora, aire!`, true);
      later(TUNING.histeria.faintSec, () => {
        if (disposed) return;
        const s = team.a[victim];
        if (s.assigned) goAgent(a, TEAM_WORK[victim], TEAM_WORK[victim].yaw, 'work', 2.2, () => (s.atStation = true));
        else goAgent(a, TEAM_IDLE[victim], 0, victim === 'fritz' ? 'tremble' : 'idle', 1.8);
      });
    }
  }

  function goToOR(auto: boolean): void {
    if (finishing) return;
    if (!auto) {
      const pend: string[] = [];
      if (team.prepQuality < 0.95) pend.push(`rasurado al ${Math.round(team.prepQuality * 100)}%`);
      if (team.sterileSets < TUNING.team.maxSets) pend.push(`${team.sterileSets}/${TUNING.team.maxSets} juegos estériles`);
      if (!team.consentDone) pend.push('consentimiento sin firmar');
      const waitingMinor = owners.filter((o) => o.state.kind === 'minor' && o.present && o.state.status === 'waiting').length;
      if (waitingMinor) pend.push(`${waitingMinor} caso${waitingMinor > 1 ? 's' : ''} menor${waitingMinor > 1 ? 'es' : ''} esperando`);
      if (pend.length) {
        dialog = openChoice(hud.modalLayer, {
          title: '¿Ir al quirófano ya?',
          lead: `Aún queda: ${pend.join(' · ')}.`,
          items: [{ title: '¡Vamos! El paciente no espera' }, { title: 'Todavía no', sub: ' — sigo organizando.' }],
          onCancel: closeDialog,
          onPick: (i) => {
            closeDialog();
            if (i === 0) startFinish(false);
          },
        });
        return;
      }
    }
    startFinish(auto);
  }

  function startFinish(auto: boolean): void {
    finishing = true;
    finishT = 0;
    closeDialog();
    examPanel?.close();
    examPanel = null;
    game?.dispose();
    game = null;
    say('emiliana', auto ? '¡Se acabó el turno! Al quirófano como estemos.' : line(L.OR_READY), true);
    sfx('doorClose', 0.8, 1.2);
    hud.setPrompt(null, null);
    clipperLoop?.stop();
    clipperLoop = null;
    const d = STATIONS.orDoor.pos;
    yaw = Math.PI;
    body.vx = body.vz = 0;
    void d;
  }

  function buildOutcome(): ClinicOutcome {
    return computeClinicOutcome({
      diagnosisChosen: diagnosis,
      correctDiagnosis: cc.correctDiagnosis,
      xrayMarked,
      requiredTests: required,
      testsDone: [...testsDone],
      team,
      contamination,
      caseOwner: caseState,
      explanation,
      minorCasesHC: minorHC,
      educationPoints: education,
      emiliana: { concentration, reserve },
    });
  }

  function tackle(): void {
    if (dashCooldown > 0 || dashLeft > 0 || sprawlLeft > 0 || caught) return;
    const P = TUNING.player;
    const sp = Math.hypot(body.vx, body.vz);
    dashDirX = sp > 0.3 ? body.vx / sp : Math.sin(yaw);
    dashDirZ = sp > 0.3 ? body.vz / sp : Math.cos(yaw);
    dashLeft = P.dashSec;
    dashCooldown = P.dashCooldown;
    setAnim(emiA, 'run');
    sfx('footstep', 0.8, 0.7);
    if (carryingTila) {
      carryingTila = false;
      cup.visible = false;
      level.addPuddle(body.x + dashDirX * 0.6, body.z + dashDirZ * 0.6, 0.45);
      say('emiliana', line(L.TILA_SPILL), true);
      sfx('splash', 0.6);
    }
  }

  // ───────────────────────── interacciones ─────────────────────────

  const I = (k: string, label: string, hold: number, enabled: boolean, run: () => void): Interaction => ({ key: k, label, hold, enabled, run });
  const dist2 = (x: number, z: number) => (body.x - x) ** 2 + (body.z - z) ** 2;

  function stationInteraction(id: StationId): Interaction | null {
    switch (id) {
      case 'exam':
        if (!caseState.complaintHeard) return I('exam-no', `Primero escucha a ${caseDef.owner.name}`, 0, false, () => {});
        return I('exam', `Explorar a ${petName}`, 0, true, openExam);
      case 'lightbox': {
        if (foiled.lightbox) return I('foil-lb', 'Quitar el aluminio del negatoscopio (mantén E)', TUNING.braulio.removeHoldSec, true, () => removeFoil('lightbox'));
        const pending = lightboxTests.find((t) => platesTaken.has(t) && !testsDone.has(t));
        if (pending) return I('plate', `Leer la placa: ${TEST_INFO[pending].label}`, 0, true, readPlate);
        return I('lb-empty', lightboxTests.length ? 'Negatoscopio: toma la placa en la camilla' : 'Negatoscopio (este caso no necesita placas)', 0, false, () => {});
      }
      case 'autoclave':
        if (foiled.autoclave) return I('foil-ac', 'Quitar el aluminio del autoclave (mantén E)', TUNING.braulio.removeHoldSec, true, () => removeFoil('autoclave'));
        if (!team.a.fritz.assigned) return I('as-fritz', 'Asignar a Fritz: esterilizar instrumental', 0, true, () => assignDialog('fritz'));
        return I('info-fritz', `Autoclave: ${team.sterileSets}/${TUNING.team.maxSets} juegos estériles`, 0, false, () => {});
      case 'prep':
        if (!team.a.rodrigo.assigned) return I('as-rodrigo', 'Asignar a Rodrigo: rasurado y antisepsia', 0, true, () => assignDialog('rodrigo'));
        return I('info-rodrigo', `Preparación: ${Math.round(team.prepQuality * 100)}%`, 0, false, () => {});
      case 'consent':
        if (!team.a.gigi.assigned) return I('as-gigi', 'Asignar a Gigi: consentimientos', 0, true, () => assignDialog('gigi'));
        return I('info-gigi', team.consentDone ? 'Consentimiento firmado ✓' : `Consentimiento: ${Math.round(team.consentProgress * 100)}%`, 0, false, () => {});
      case 'cooler':
        if (carryingTila) return I('tila-have', 'Ya llevas una tila', 0, false, () => {});
        return I('tila', 'Servir una tila (mantén E)', 0.8, true, () => {
          carryingTila = true;
          cup.visible = true;
          sfx('splash', 0.35, 1.6);
          say('emiliana', line(L.TILA_GRAB));
        });
      case 'carrier':
        return null;
      case 'orDoor': {
        const ready = orReadyNow();
        if (!ready)
          return I('or-no', diagnosis === null ? 'Quirófano: primero da el diagnóstico' : 'Quirófano: falta la prueba obligatoria', 0, false, () => {});
        return I('or', 'Ir al quirófano', 0, true, () => goToOR(false));
      }
    }
  }

  function ownerInteraction(o: OwnerEntry): Interaction | null {
    const s = o.state;
    if (!o.present || s.status !== 'waiting') return null;
    // quien aún está entrando por la puerta no atiende; el dueño que va y viene (Braulio) sí
    if (o.agent.moving && s.kind === 'minor') return null;
    if (s.faintLeft > 0) return I(`faint-${s.id}`, `${s.name} está desmayada (espera)`, 0, false, () => {});
    if (carryingTila) return I(`tila-${s.id}`, `Dar tila a ${s.name}`, 0, true, () => giveTila(o));
    if (s.kind === 'minor') return I(`minor-${s.id}`, `Atender a ${s.name}: ${s.errand} (mantén E)`, TUNING.minor.holdSec, true, () => serveMinor(o));
    if (!s.complaintHeard) return I('complaint', `Escuchar a ${s.name}`, 0, true, hearComplaint);
    if (diagnosis === null) return I('diagnose', `Dar el diagnóstico a ${s.name}`, 0, true, openDiagnosis);
    return I('chat', `Charlar con ${s.name}`, 0, o.talkCooldown <= 0, () => {
      o.talkCooldown = 12;
      s.patience = clamp(s.patience + 4, 0, 100);
      sayOwner(s, line(s.human === 'hortensia' ? deps.dialogue.owners.hortensia?.calm : s.human === 'braulio' ? deps.dialogue.owners.braulio?.calm : deps.dialogue.owners.generic?.calm) ?? '¡Gracias por todo, doctora!', true);
    });
  }

  function currentInteraction(): Interaction | null {
    if (caught) {
      const c = STATIONS.carrier.pos;
      if (dist2(c.x, c.z) < STATIONS.carrier.radius ** 2) return I('store', 'Guardar a Panchito en el transportín', 0, true, storePanchito);
      return null;
    }
    let best: Interaction | null = null;
    let bestD = Infinity;
    const fwdX = Math.sin(yaw);
    const fwdZ = Math.cos(yaw);
    const consider = (x: number, z: number, r: number, make: () => Interaction | null) => {
      const d2 = dist2(x, z);
      if (d2 > r * r) return;
      // favorece lo que está delante de Emiliana
      const d = Math.sqrt(d2);
      const facing = d > 1e-3 ? ((x - body.x) * fwdX + (z - body.z) * fwdZ) / d : 1;
      const score = d - facing * 0.35;
      if (score >= bestD) return;
      const it = make();
      if (!it) return;
      // lo desactivado solo gana si no hay nada activo cerca
      if (best && best.enabled && !it.enabled) return;
      best = it;
      bestD = score;
    };
    for (const id of Object.keys(STATIONS) as StationId[]) {
      const s = STATIONS[id];
      consider(s.pos.x, s.pos.z, s.radius, () => stationInteraction(id));
    }
    for (const o of owners) {
      if (!o.present) continue;
      consider(o.agent.x, o.agent.z, 1.75, () => ownerInteraction(o));
    }
    return best;
  }

  function storePanchito(): void {
    caught = false;
    putInCarrier(panchito, rng);
    level.setCarrierOpen(false);
    sfx('doorClose', 0.6, 1.5);
    say('emiliana', line(L.PANCHITO_STORED), true);
    fx.burst('star', STATIONS.carrier.pos.x, 1, STATIONS.carrier.pos.z, 8, 1);
  }

  // ───────────────────────── entrada ─────────────────────────

  const offKey = input.onKey((code, down, repeat) => {
    if (!down || repeat || finishing || disposed) return;
    if (game) return;
    if (dialog) {
      dialog.onKey(code);
      return;
    }
    if (examPanel) {
      examPanel.onKey(code);
      return;
    }
    if (code === 'KeyE') {
      const it = currentInteraction();
      if (it && it.enabled && it.hold === 0) {
        sfx('uiClick', 0.6);
        it.run();
        interactionTimer = 0;
      } else if (it && !it.enabled) sfx('uiError', 0.4);
    } else if (code === 'Space') tackle();
  });

  // ───────────────────────── bucle ─────────────────────────

  let disposed = false;
  let hudTimer = 0;
  let chatterTimer = 14 + rng() * 8;
  let fritzSetsAnnounced = 0;
  let steamTimer = 0;
  let objective: Objective | null = null;
  let objectiveTimer = 0;
  let interactionTimer = 0;
  let tutorialTipShown = false;
  let currentIt: Interaction | null = null;
  const tmpV = new THREE.Vector3();
  const camPos = new THREE.Vector3(SPAWN.x, 11, SPAWN.z + 9);
  const camLook = new THREE.Vector3(SPAWN.x, 0.6, SPAWN.z);
  const camWant = new THREE.Vector3();
  let shake = 0;
  const teamEvents: TeamEvent[] = [];
  const pEvents: PanchitoEvent[] = [];
  const snap: ObjectiveSnapshot = {
    tutorial,
    ownerId: 'case',
    ownerName: caseDef.owner.name,
    petName,
    complaintHeard: false,
    tablePending: [],
    platesPending: [],
    requiredPending: [],
    diagnosed: false,
    minor: null,
    assigned: { fritz: false, rodrigo: false, gigi: false },
    foiled: null,
    holdingPanchito: false,
    panchitoZone: null,
    hortensiaHigh: false,
    carryingTila: false,
    tilaGiven: false,
  };

  camera.position.copy(camPos);
  camera.lookAt(camLook);
  audio.setMusic('clinic');
  later(0.6, () => !disposed && say('emiliana', line(L.EMILIANA_START), true));
  if (tutorial) later(1.5, () => !disposed && toast('Tutorial: sigue la flecha rosa. Aquí nadie tiene prisa ♥', 'good'));

  function project(x: number, y: number, z: number, lbl: WorldLabel): void {
    tmpV.set(x, y, z).project(camera);
    if (tmpV.z > 1 || tmpV.x < -1.1 || tmpV.x > 1.1 || tmpV.y < -1.1 || tmpV.y > 1.1) {
      lbl.setVisible(false);
      return;
    }
    lbl.setVisible(true);
    lbl.setPos(((tmpV.x + 1) / 2) * viewW, ((1 - tmpV.y) / 2) * viewH);
  }

  function updatePlayer(dt: number): void {
    const P = TUNING.player;
    const blocked = modalOpen() || finishing;
    let ix = 0;
    let iz = 0;
    if (!blocked && sprawlLeft <= 0) {
      if (input.isDown('KeyD') || input.isDown('ArrowRight')) ix += 1;
      if (input.isDown('KeyA') || input.isDown('ArrowLeft')) ix -= 1;
      if (input.isDown('KeyS') || input.isDown('ArrowDown')) iz += 1;
      if (input.isDown('KeyW') || input.isDown('ArrowUp')) iz -= 1;
    }
    const slippery = !effects.noSlip && inPuddle(body.x, body.z, level.puddles);
    dashCooldown = Math.max(0, dashCooldown - dt);
    if (dashLeft > 0) {
      dashLeft -= dt;
      body.vx = dashDirX * P.dashSpeed;
      body.vz = dashDirZ * P.dashSpeed;
      body.x += body.vx * dt;
      body.z += body.vz * dt;
      if (panchitoEnabled && tackleHits(body.x, body.z, panchito)) {
        catchPanchito(panchito);
        caught = true;
        dashLeft = 0;
        body.vx *= 0.2;
        body.vz *= 0.2;
        sfx('panchitoBark', 1, 1.3);
        sfx('perfect', 0.7);
        say('emiliana', line(L.TACKLE_OK), true);
        fx.burst('star', panchito.x, 0.8, panchito.z, 12, 2);
        shake = 0.25;
        toast('¡Panchito atrapado! Llévalo al transportín', 'good');
      } else if (dashLeft <= 0) {
        sprawlLeft = P.sprawlSec;
        const near = panchitoEnabled && isLoose(panchito) && Math.hypot(panchito.x - body.x, panchito.z - body.z) < 4;
        if (near) say('emiliana', line(L.TACKLE_MISS));
        shake = 0.12;
      }
    } else {
      if (sprawlLeft > 0) sprawlLeft -= dt;
      stepBody(body, ix, iz, dt, {
        maxSpeed: P.maxSpeed * (caught ? P.carrySpeedMult : 1),
        accel: P.accel,
        decel: P.decel,
        slipAccelMult: P.slipAccelMult,
        slipDecelMult: P.slipDecelMult,
        slippery,
      });
    }
    resolveCollisions(body, colliders);
    const sp = Math.hypot(body.vx, body.vz);
    if (sp > 0.25 && dashLeft <= 0) yaw = turnTowards(yaw, Math.atan2(body.vx, body.vz), 1 - Math.exp(-dt * (slippery ? 3 : 11)));
    else if (dashLeft > 0) yaw = Math.atan2(dashDirX, dashDirZ);
    // resbalón
    slipCooldown = Math.max(0, slipCooldown - dt);
    if (slippery && sp > 1.6) {
      wobble = Math.min(1, wobble + dt * 4);
      if (slipCooldown <= 0) {
        slipCooldown = 6;
        say('emiliana', line(L.SLIP));
        stress(TUNING.emiliana.slip);
        sfx('splash', 0.5, 1.2);
        fx.burst('drop', body.x, 0.3, body.z, 8, 1.2, { size: 0.15, up: 1.8 });
      }
    } else wobble = Math.max(0, wobble - dt * 3);
    emi.root.position.set(body.x, 0, body.z);
    emi.root.rotation.set(0, yaw, Math.sin(time * 14) * 0.18 * wobble);
    // animación
    pulseAnimLeft = Math.max(0, pulseAnimLeft - dt);
    let anim: CharacterAnim;
    if (dashLeft > 0) anim = 'run';
    else if (sprawlLeft > 0) anim = 'panic';
    else if (wobble > 0.3) anim = 'panic';
    else if (pulseAnimLeft > 0) anim = pulseAnim;
    else if (holdT > 0) anim = 'work';
    else if (examPanel || game) anim = 'work';
    else if (sp > 2.7) anim = 'run';
    else if (sp > 0.3) anim = 'walk';
    else anim = caught || carryingTila ? 'offer' : 'idle';
    setAnim(emiA, anim);
    // pasos de botas de plataforma
    if (sp > 0.6 && dashLeft <= 0) {
      stepTimer -= dt * sp;
      if (stepTimer <= 0) {
        stepTimer = 1.05;
        sfx('footstep', 0.28, 0.75 + rng() * 0.15);
      }
    }
  }

  function updateInteraction(dt: number): void {
    if (modalOpen() || finishing || dashLeft > 0 || sprawlLeft > 0) {
      currentIt = null;
      interactionTimer = 0;
      hud.setPrompt(null, null);
      holdT = 0;
      return;
    }
    interactionTimer -= dt;
    if (interactionTimer <= 0) {
      interactionTimer = 0.08;
      currentIt = currentInteraction();
    }
    if (!currentIt) {
      holdT = 0;
      hud.setPrompt(null, null);
      return;
    }
    if (currentIt.hold > 0 && currentIt.enabled) {
      if (holdKey !== currentIt.key) {
        holdKey = currentIt.key;
        holdT = 0;
      }
      if (input.isDown('KeyE')) {
        holdT += dt;
        if (Math.floor((holdT - dt) * 4) !== Math.floor(holdT * 4)) sfx('tick', 0.25, 1 + holdT * 0.2);
        if (holdT >= currentIt.hold) {
          holdT = 0;
          const it = currentIt;
          it.run();
          currentIt = null;
          interactionTimer = 0;
          hud.setPrompt(null, null);
          return;
        }
      } else holdT = Math.max(0, holdT - dt * 2);
    } else holdT = 0;
    hud.setPrompt(currentIt.label, currentIt.hold > 0 ? holdT / currentIt.hold : null, 'E', !currentIt.enabled);
  }

  function updateOwners(dt: number): void {
    const ctx = { tutorial, consentActive: consentActive(team), gigiFilming: team.a.gigi.filming };
    for (const o of owners) {
      if (!o.present && o.arriveAt > 0 && time >= o.arriveAt && o.state.status === 'waiting') {
        o.present = true;
        o.arriveAt = 0;
        o.agent.rig.root.visible = true;
        if (o.pet) o.pet.rig.root.visible = true;
        const seat = SEATS[o.seat];
        goAgent(o.agent, seat, seat.yaw, 'sit', 1.7);
        toast(`Llegó ${o.state.name} con ${o.state.petName} (${o.state.errand})`);
        sfx('phone', 0.4, 1.5);
      }
      if (o.talkCooldown > 0) o.talkCooldown -= dt;
      if (!o.present) continue;
      const ev = o.present && !o.agent.moving ? tickOwner(o.state, dt, ctx) : null;
      if (ev === 'left') {
        stress(TUNING.emiliana.minorLeft);
        sayOwner(o.state, line(L.MINOR_LEFT), true);
        toast(`${o.state.name} se fue sin atender`, 'bad');
        sfx('uiError');
        setAnim(o.agent, 'panic');
        later(1.2, () => leave(o));
      } else if (ev === 'impatient') {
        sayOwner(o.state, line(L.MINOR_WAITING), true);
        o.agent.rig.setEmote('anger');
      } else if (ev === 'faint') hortensiaFaint();
      else if (ev === 'recover') {
        const seat = SEATS[o.seat];
        o.agent.x = seat.x;
        o.agent.z = seat.z;
        o.agent.yaw = o.agent.restYaw = seat.yaw;
        setAnim(o.agent, 'sit');
        say('hortensia', '¿Dónde estoy? ¿Ya operaron? ¿Por qué nadie me trae tila?', true);
      }
      // la mascota sigue al dueño cuando camina
      if (o.pet && o !== caseOwner) {
        const p = o.pet;
        const tx = o.agent.x + 0.55;
        const tz = o.agent.z + 0.5;
        const d = Math.hypot(tx - p.x, tz - p.z);
        if (d > 0.25) {
          const sp = Math.min(d, (o.agent.moving ? 2.2 : 1.5) * dt);
          p.x += ((tx - p.x) / d) * sp;
          p.z += ((tz - p.z) / d) * sp;
          p.yaw = turnTowards(p.yaw, Math.atan2(tx - p.x, tz - p.z), 0.2);
          setAnim(p, 'walk');
        } else {
          setAnim(p, 'sit');
          p.yaw = turnTowards(p.yaw, o.agent.restYaw, 0.1);
        }
        p.rig.root.position.set(p.x, 0, p.z);
        p.rig.root.rotation.y = p.yaw;
      }
    }
    // el paciente del caso antes de subir a la camilla también sigue a su dueño
    if (!caseState.complaintHeard && caseOwner.pet) {
      const p = caseOwner.pet;
      p.x = caseOwner.agent.x + 0.6;
      p.z = caseOwner.agent.z + 0.55;
      p.rig.root.position.set(p.x, 0, p.z);
    }
  }

  function updateTeam(dt: number): void {
    teamEvents.length = 0;
    tickTeam(team, dt, { autoclaveFoiled: foiled.autoclave, rng }, teamEvents);
    for (const ev of teamEvents) {
      if (ev === 'set' || ev === 'setsFull') {
        sfx('autoclave');
        fx.burst('sparkle', level.steamOrigin.x, level.steamOrigin.y, level.steamOrigin.z, 10, 1);
        say('fritz', line(ev === 'setsFull' ? L.FRITZ_FULL : L.FRITZ_SET), true);
        toast(`Juego estéril listo (${team.sterileSets}/${TUNING.team.maxSets})`, 'good');
      } else if (ev === 'prepFull') {
        say('rodrigo', line(L.RODRIGO_PREP_FULL), true);
        toast('Rasurado y antisepsia al 100%', 'good');
      } else if (ev === 'consentDone') {
        say('gigi', line(L.GIGI_CONSENT), true);
        toast('Consentimiento informado firmado ✓', 'good');
        sfx('camera', 0.6);
      } else if (ev === 'filmStart') {
        const g = teamAgents.gigi;
        if (!g.moving) setAnim(g, 'selfie');
        say('gigi', line(deps.dialogue.gigi?.filming) ?? line(L.GIGI_FILM));
        sfx('camera', 0.5);
      } else if (ev === 'filmEnd') {
        const g = teamAgents.gigi;
        if (!g.moving && !team.a.gigi.assigned) setAnim(g, 'idle');
      }
    }
    // Rodrigo: bucle de la máquina de rasurar
    const rodWorking = isWorking(team.a.rodrigo) && team.prepQuality < 1;
    level.setClipperActive(rodWorking);
    if (rodWorking && !clipperLoop) clipperLoop = audio.loop('clipper');
    if (!rodWorking && clipperLoop) {
      clipperLoop.stop();
      clipperLoop = null;
    }
    if (clipperLoop) {
      const d = Math.hypot(body.x - TEAM_WORK.rodrigo.x, body.z - TEAM_WORK.rodrigo.z);
      clipperLoop.set('intensity', clamp(1 - d / 14, 0.05, 1));
      clipperLoop.set('rate', 0.6 + 0.4 * team.prepQuality);
    }
    if (rodWorking && rng() < dt * 6) fx.spawn('fur', level.prepTop.x + (rng() - 0.5) * 1.2, level.prepTop.y + 0.1, level.prepTop.z + (rng() - 0.5) * 0.5, { vy: 0.6, life: 0.8, size: 0.14, gravity: 1.5, spin: 3 });
    // Fritz / autoclave
    const fritzWorking = isWorking(team.a.fritz);
    level.setAutoclave(foiled.autoclave ? 'blocked' : team.sterileSets >= TUNING.team.maxSets ? 'full' : fritzWorking ? 'working' : 'idle');
    steamTimer -= dt;
    if (fritzWorking && !foiled.autoclave && team.sterileSets < TUNING.team.maxSets && steamTimer <= 0) {
      steamTimer = 0.35;
      const o = level.steamOrigin;
      fx.spawn('steam', o.x + (rng() - 0.5) * 0.3, o.y, o.z + (rng() - 0.5) * 0.3, { vy: 0.7, life: 1.6, size: 0.35, grow: 0.5 });
    }
    level.setRingLight(isWorking(team.a.gigi));
    // Rodrigo sin asignar: guitarra de aire de vez en cuando
    const rod = teamAgents.rodrigo;
    if (!team.a.rodrigo.assigned && !rod.moving && team.a.rodrigo.awayLeft <= 0 && !caseOwner.sharedWith) {
      const air = Math.sin(time * 0.35) > 0.55;
      setAnim(rod, air ? 'guitar' : 'idle');
      if (air && rng() < dt * 1.5) fx.spawn('note', rod.x + (rng() - 0.5) * 0.5, 2, rod.z, { vy: 0.5, vx: (rng() - 0.5) * 0.4, life: 1.4, size: 0.22 });
    }
  }

  function updatePanchito(dt: number): void {
    if (!panchitoEnabled || !panchitoRig || !pA) return;
    pEvents.length = 0;
    tickPanchito(panchito, dt, rng, pEvents);
    for (const ev of pEvents) {
      if (ev === 'escape') {
        toast(line(L.PANCHITO_ESCAPE) ?? '¡Panchito se escapó!', 'bad');
        level.setCarrierOpen(true);
        fx.burst('bang', panchito.x, 0.8, panchito.z, 4, 1);
      } else if (ev === 'bark') {
        const d = Math.hypot(panchito.x - body.x, panchito.z - body.z);
        sfx('panchitoBark', clamp(1.1 - d / 16, 0.15, 1), 0.9 + rng() * 0.3);
        if (rng() < 0.25) say('panchito', line(L.PANCHITO_BARK));
        if (hortensia && hortensia.present && Math.hypot(panchito.x - hortensia.agent.x, panchito.z - hortensia.agent.z) < TUNING.histeria.barkRadius) {
          const e2 = addHisteria(hortensia.state, TUNING.histeria.bark);
          say('hortensia', line(L.HORTENSIA_BARK));
          if (e2 === 'faint') hortensiaFaint();
        }
      } else if (ev === 'enterZone') {
        const z = panchitoZone(panchito);
        if (z) {
          toast(line(L.ZONE_ALERT[z]) ?? `¡Panchito en ${ZONE_LABEL[z]}!`, 'bad');
          sfx('alarm', 0.35, 1.4);
        }
      } else if (ev === 'wriggle') {
        caught = false;
        wriggleFree(panchito, body.x + Math.sin(yaw) * 0.6, body.z + Math.cos(yaw) * 0.6, rng);
        say('emiliana', line(L.PANCHITO_WRIGGLE), true);
        sfx('panchitoBark', 1, 1.4);
      }
    }
    const crossed = tickContamination(contamination, dt, panchitoZone(panchito), isZooming(panchito), {
      autoclave: isWorking(team.a.fritz),
      prep: isWorking(team.a.rodrigo),
    });
    if (crossed) {
      toast(`¡Contaminación de ${ZONE_LABEL[crossed]} al 50%!`, 'bad');
      stress(2);
    }
    // modelo
    const r = panchitoRig.root;
    if (panchito.mode === 'held') {
      r.position.set(body.x + Math.sin(yaw) * 0.38, 0.85, body.z + Math.cos(yaw) * 0.38);
      r.rotation.y = yaw + Math.PI / 2;
      setAnim(pA, 'panic');
    } else if (panchito.mode === 'carrier') {
      const c = STATIONS.carrier.pos;
      r.position.set(c.x, 0.06, c.z);
      r.rotation.y = Math.PI / 2;
      setAnim(pA, 'sit');
      if (panchito.timer > 3) level.setCarrierOpen(false);
    } else {
      r.position.set(panchito.x, Math.abs(Math.sin(time * 18)) * 0.05, panchito.z);
      r.rotation.y = Math.atan2(panchito.hx, panchito.hz);
      setAnim(pA, panchito.mode === 'sniff' ? 'walk' : 'run');
    }
  }

  function updateBraulio(dt: number): void {
    if (!braulio) return;
    if (tutorial) {
      if (!tutorialFoilDone && team.a.fritz.atStation && time > 0) {
        tutorialFoilDone = true;
        later(3.5, () => !disposed && braulioFoil());
      }
      return;
    }
    if (foiled.lightbox || foiled.autoclave || braulioBusy) return;
    foilTimer -= dt;
    if (foilTimer <= 0) {
      const [a, b] = TUNING.braulio.foilEverySec;
      foilTimer = a + rng() * (b - a);
      braulioFoil();
    }
  }

  function updateChatter(dt: number): void {
    chatterTimer -= dt;
    if (chatterTimer > 0) return;
    chatterTimer = 16 + rng() * 14;
    const waiting = owners.filter((o) => o.present && o.state.status === 'waiting' && !o.agent.moving && o.state.faintLeft <= 0);
    const r = rng();
    if (r < 0.45 && waiting.length) {
      const o = waiting[Math.floor(rng() * waiting.length)];
      const bank = o.state.human === 'hortensia' ? deps.dialogue.owners.hortensia : o.state.human === 'braulio' ? deps.dialogue.owners.braulio : deps.dialogue.owners.generic;
      sayOwner(o.state, line(o.state.patience < 40 ? bank?.upset : bank?.waiting) ?? line(L.MINOR_WAITING));
    } else if (r < 0.65 && !team.a.rodrigo.assigned) say('rodrigo', line(deps.dialogue.rodrigo?.idle));
    else if (r < 0.8 && !team.a.fritz.assigned) say('fritz', line(deps.dialogue.fritz?.nervous));
    else if (braulio && !braulioBusy) say('braulio', line(L.CONSPIRACIES));
  }

  function updateObjective(): void {
    snap.complaintHeard = caseState.complaintHeard;
    snap.tablePending = cc.tests.filter((t) => (TEST_INFO[t].atLightbox ? !platesTaken.has(t) : !testsDone.has(t)));
    snap.platesPending = lightboxTests.filter((t) => platesTaken.has(t) && !testsDone.has(t));
    snap.requiredPending = required.filter((t) => !testsDone.has(t));
    snap.diagnosed = diagnosis !== null;
    const m = owners.find((o) => o.state.kind === 'minor' && o.present && o.state.status === 'waiting' && !o.agent.moving);
    snap.minor = m ? { id: m.state.id, name: m.state.name } : null;
    snap.assigned.fritz = team.a.fritz.assigned;
    snap.assigned.rodrigo = team.a.rodrigo.assigned;
    snap.assigned.gigi = team.a.gigi.assigned;
    snap.foiled = foiled.autoclave ? 'autoclave' : foiled.lightbox ? 'lightbox' : null;
    snap.holdingPanchito = caught;
    snap.panchitoZone = panchitoEnabled ? panchitoZone(panchito) : null;
    snap.hortensiaHigh = !!hortensia && (hortensia.state.histeria ?? 0) > 70 && hortensia.state.faintLeft <= 0;
    snap.carryingTila = carryingTila;
    snap.tilaGiven = tilaGiven;
    objective = nextObjective(snap);
    hud.setObjective(objective.text, !!objective.urgent);
    if (tutorial && diagnosis !== null && !tutorialTipShown) {
      tutorialTipShown = true;
      toast('Consejo: en otros casos Panchito se escapa. ¡Placaje con Espacio y al transportín!', 'info');
    }
  }

  function updateMarker(): void {
    if (!objective || finishing) {
      marker.set(null);
      return;
    }
    const t = objective.target;
    if (!t) marker.set(null);
    else if (t.kind === 'station') {
      const s = STATIONS[t.id].pos;
      marker.set({ x: s.x, y: t.id === 'lightbox' || t.id === 'orDoor' ? 2.6 : 2.0, z: s.z }, !!objective.urgent);
    } else if (t.kind === 'owner') {
      const o = owners.find((x) => x.state.id === t.id);
      if (o) marker.set({ x: o.agent.x, y: o.agent.rig.height + 0.6, z: o.agent.z }, !!objective.urgent);
      else marker.set(null);
    } else marker.set({ x: panchito.x, y: 1.1, z: panchito.z }, true);
  }

  function teamViews(): TeamChipView[] {
    return ASSISTANTS.map((id) => {
      const s = team.a[id];
      let status: string;
      let level: TeamChipView['level'] = 'idle';
      if (s.awayLeft > 0) {
        status = 'Abanicando a Hortensia...';
        level = 'bad';
      } else if (id === 'gigi' && s.filming) {
        status = s.assigned ? 'Terminando su TikTok...' : '● Grabando TikTok';
        level = 'warn';
      } else if (!s.assigned) {
        status = id === 'rodrigo' ? (caseOwner.sharedWith === 'rodrigo' ? 'Preocupado por Chorizo' : 'Guitarra de aire') : id === 'fritz' ? 'Temblando sin tarea' : 'Mirando su móvil';
      } else if (!s.atStation) {
        status = 'En camino...';
        level = 'ok';
      } else {
        level = 'ok';
        if (id === 'fritz') {
          if (foiled.autoclave) {
            status = '¡Autoclave con aluminio!';
            level = 'bad';
          } else status = team.sterileSets >= TUNING.team.maxSets ? `Juegos ${team.sterileSets}/3 ✓` : `Autoclave ${team.sterileSets}/3 · ${Math.round(team.autoclaveProgress * 100)}%`;
        } else if (id === 'rodrigo') status = `Rasurado ${Math.round(team.prepQuality * 100)}%${team.prepQuality >= 1 ? ' ✓' : ''}`;
        else status = team.consentDone ? 'Consentimiento ✓' : `Consentimiento ${Math.round(team.consentProgress * 100)}%`;
      }
      return { id, status, level, morale: s.morale };
    });
  }

  function updateHud(dt: number): void {
    hudTimer -= dt;
    // etiquetas cada fotograma (siguen a la cámara)
    for (const o of owners) {
      if (!o.present || o.state.status !== 'waiting') {
        o.label.setVisible(false);
        continue;
      }
      project(o.agent.x, o.agent.rig.height + 0.3, o.agent.z, o.label);
    }
    for (const id of ASSISTANTS) {
      const s = team.a[id];
      const a = teamAgents[id];
      const txt = s.awayLeft > 0 ? 'Abanicando' : id === 'gigi' && s.filming ? '● REC' : null;
      if (!txt) teamLabel[id].setVisible(false);
      else {
        const el = teamLabel[id].root.firstElementChild as HTMLElement;
        if (el.textContent !== txt) el.textContent = txt;
        project(a.x, a.rig.height + 0.35, a.z, teamLabel[id]);
      }
    }
    for (const d of ['lightbox', 'autoclave'] as const) {
      if (!foiled[d]) foilLabels[d].setVisible(false);
      else project(STATIONS[d].pos.x, 2.6, STATIONS[d].pos.z, foilLabels[d]);
    }
    if (panchitoEnabled && isLoose(panchito)) {
      const inZone = !!panchitoZone(panchito);
      const near = Math.hypot(panchito.x - body.x, panchito.z - body.z) < 2.5;
      const el = panchitoLabel.root.firstElementChild as HTMLElement;
      const txt = near ? '¡Espacio!' : inZone ? '¡Zona estéril!' : '';
      if (txt) {
        if (el.textContent !== txt) el.textContent = txt;
        project(panchito.x, 0.95, panchito.z, panchitoLabel);
      } else panchitoLabel.setVisible(false);
      marker.setTackleRing({ x: panchito.x, z: panchito.z }, Math.hypot(panchito.x - body.x, panchito.z - body.z) <= TUNING.panchito.tackleRange);
      if (!near && !inZone) marker.setTackleRing(null, false);
    } else {
      panchitoLabel.setVisible(false);
      marker.setTackleRing(null, false);
    }
    if (hudTimer > 0) return;
    hudTimer = 0.1;
    for (const o of owners) {
      o.labelBars.pat.style.width = `${o.state.patience.toFixed(0)}%`;
      if (o.labelBars.hist && o.state.histeria !== null) o.labelBars.hist.style.width = `${o.state.histeria.toFixed(0)}%`;
    }
    hud.setClock(shiftLeft, TUNING.shiftSec, !tutorial && shiftLeft < 60, tutorial ? time : null);
    const targetOwner = objective?.target?.kind === 'owner' ? objective.target.id : null;
    hud.setQueue(
      owners.filter((o) => o.present || o.state.status !== 'waiting').map((o) => o.state),
      targetOwner,
    );
    hud.setTeam(teamViews());
    hud.setEmiliana(concentration, reserve, minorHC, caught ? 'Llevas a Panchito en brazos' : carryingTila ? 'Llevas una tila calentita' : '');
    const t = objective?.target;
    const tp = !t ? null : t.kind === 'station' ? STATIONS[t.id].pos : t.kind === 'owner' ? (() => {
      const o = owners.find((x) => x.state.id === t.id);
      return o ? { x: o.agent.x, z: o.agent.z } : null;
    })() : { x: panchito.x, z: panchito.z };
    hud.drawMap(
      {
        player: { x: body.x, z: body.z },
        panchito: panchitoEnabled && panchito.mode !== 'off' ? { x: panchito.x, z: panchito.z } : null,
        owners: owners.filter((o) => o.present && o.state.status === 'waiting' && !o.sharedWith).map((o) => ({ x: o.agent.x, z: o.agent.z, case: o === caseOwner })),
        team: ASSISTANTS.map((id) => ({ x: teamAgents[id].x, z: teamAgents[id].z, color: ASSISTANT_COLOR[id] })),
        contamination: contamination.values,
        target: tp,
        foiled: (['lightbox', 'autoclave'] as const).filter((d) => foiled[d]),
      },
      time,
    );
  }

  function updateCamera(dt: number): void {
    const lookAheadX = body.vx * 0.45;
    const lookAheadZ = body.vz * 0.35;
    const tx = clamp(body.x + lookAheadX, -8, 8);
    const tz = clamp(body.z + lookAheadZ - 0.9, -5.4, 4.2);
    camWant.set(tx, 0.6, tz);
    const k = 1 - Math.exp(-dt * 3.5);
    camLook.lerp(camWant, k);
    camWant.set(camLook.x, camLook.y + 12.6, camLook.z + 10.4);
    camPos.lerp(camWant, 1 - Math.exp(-dt * 4.5));
    camera.position.copy(camPos);
    if (shake > 0) {
      shake = Math.max(0, shake - dt);
      camera.position.x += (rng() - 0.5) * shake * 0.6;
      camera.position.y += (rng() - 0.5) * shake * 0.6;
    }
    camera.lookAt(camLook);
  }

  function update(dt: number): void {
    if (disposed) return;
    time += dt;
    runTimers();
    if (finishing) {
      finishT += dt;
      level.setOrDoorOpen(Math.min(1, finishT / 0.8));
      if (finishT > 0.5) hud.fade(true);
      if (finishT > 1.7 && !completed) {
        completed = true;
        deps.onComplete(buildOutcome());
      }
    } else if (!tutorial) {
      shiftLeft -= dt;
      if (!hurryWarned && shiftLeft < 60) {
        hurryWarned = true;
        toast('¡Queda un minuto de turno!', 'bad');
        say('emiliana', 'Un minuto. Respira, Emiliana. Botas firmes.', true);
        sfx('tick', 0.8, 0.8);
      }
      if (shiftLeft <= 0) {
        shiftLeft = 0;
        goToOR(true);
      }
    }
    updatePlayer(dt);
    updateInteraction(dt);
    if (!finishing) {
      updateOwners(dt);
      updateTeam(dt);
      updatePanchito(dt);
      updateBraulio(dt);
      updateChatter(dt);
    }
    for (const id of ASSISTANTS) stepAgent(teamAgents[id], dt);
    for (const o of owners) {
      if (!o.sharedWith) stepAgent(o.agent, dt);
      if (o.pet && o === caseOwner && caseState.complaintHeard) {
        o.pet.rig.root.position.set(o.pet.x, level.examTop.y, o.pet.z);
        o.pet.rig.root.rotation.y = o.pet.yaw;
      }
    }
    if (braulio && braulioVisitor) stepAgent(braulio, dt);
    if (hortensia && hortensia.state.faintLeft > 0) setAnim(hortensia.agent, 'faint');
    emi.update(dt);
    for (const id of ASSISTANTS) teamAgents[id].rig.update(dt);
    for (const o of owners) {
      if (!o.sharedWith && o.agent.rig.root.visible) o.agent.rig.update(dt);
      if (o.pet?.rig.root.visible) o.pet.rig.update(dt);
    }
    if (braulio && braulioVisitor) braulio.rig.update(dt);
    panchitoRig?.update(dt);
    level.update(dt, time);
    fx.update(dt);
    marker.update(time);
    updateCamera(dt);
    level.setOrDoorReady(orReadyNow());
    objectiveTimer -= dt;
    if (!finishing && objectiveTimer <= 0) {
      objectiveTimer = 0.2;
      updateObjective();
    }
    updateMarker();
    updateHud(dt);
    game?.update(dt);
    examPanel?.refresh?.();
  }

  const api: ClinicAPI & { debug: ClinicDebug } = {
    update,
    render() {
      if (disposed) return;
      deps.renderer.render(scene, camera);
    },
    resize(w, h) {
      viewW = w;
      viewH = h;
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      offKey();
      offSay();
      offToast();
      clipperLoop?.stop();
      clipperLoop = null;
      closeDialog();
      examPanel?.close();
      game?.dispose();
      hud.dispose();
      emi.dispose();
      for (const id of ASSISTANTS) teamAgents[id].rig.dispose();
      for (const o of owners) {
        if (!o.sharedWith) o.agent.rig.dispose();
        o.pet?.rig.dispose();
      }
      if (braulio && braulioVisitor) braulio.rig.dispose();
      panchitoRig?.dispose();
      cupGeo.dispose();
      cupMat.dispose();
      teaMat.dispose();
      (tea.geometry as THREE.BufferGeometry).dispose();
      fx.dispose();
      marker.dispose();
      level.dispose();
      envRT.dispose();
      key.dispose();
      fill.dispose();
      scene.environment = null;
      scene.clear();
    },
    debug: {
      state: () => ({
        time: Math.round(time * 10) / 10,
        shiftLeft: Math.round(shiftLeft),
        player: { x: Math.round(body.x * 100) / 100, z: Math.round(body.z * 100) / 100 },
        objective: objective?.text,
        interaction: currentIt?.label ?? null,
        testsDone: [...testsDone],
        platesTaken: [...platesTaken],
        diagnosis,
        /** Tecla (1..n) del diagnóstico correcto en el diálogo barajado (para scripts de prueba). */
        correctDxKey: dxOrder.indexOf(cc.correctDiagnosis) + 1,
        explanation,
        xrayMarked,
        team: { sets: team.sterileSets, prep: Math.round(team.prepQuality * 100) / 100, consent: team.consentDone, assigned: ASSISTANTS.filter((id) => team.a[id].assigned) },
        contamination: { ...contamination.values },
        panchito: { mode: panchito.mode, x: Math.round(panchito.x * 10) / 10, z: Math.round(panchito.z * 10) / 10, zone: panchitoZone(panchito) },
        foiled: { ...foiled },
        owners: owners.map((o) => ({ id: o.state.id, name: o.state.name, patience: Math.round(o.state.patience), histeria: o.state.histeria, status: o.state.status, present: o.present })),
        emiliana: { concentration: Math.round(concentration), reserve: Math.round(reserve) },
        completed,
      }),
      teleport(x, z) {
        body.x = x;
        body.z = z;
        body.vx = body.vz = 0;
        camLook.set(x, 0.6, z);
        camPos.set(x, 11.8, z + 9.2);
      },
      teleportTo(st) {
        if (st === 'owner') {
          const a = caseOwner.agent;
          this.teleport(a.x, a.z + 1.1);
          yaw = Math.PI;
          return;
        }
        const s = STATIONS[st].pos;
        const off: Record<StationId, [number, number]> = {
          exam: [0, 1.1],
          lightbox: [0, 0.9],
          prep: [0, 1.1],
          autoclave: [-1.2, 0],
          consent: [0, 1.0],
          cooler: [0, -0.9],
          carrier: [1.0, 0],
          orDoor: [0, 0.9],
        };
        this.teleport(s.x + off[st][0], s.z + off[st][1]);
        yaw = Math.atan2(-off[st][0], -off[st][1]);
      },
      setTimeLeft(sec) {
        shiftLeft = sec;
      },
      setHisteria(v) {
        if (caseState.histeria !== null) caseState.histeria = v;
      },
      nearPanchito() {
        const d = 0.9;
        this.teleport(panchito.x - d, panchito.z);
        yaw = Math.PI / 2;
      },
      advance(sec) {
        for (let t = 0; t < sec; t += 1 / 30) update(1 / 30);
      },
      interact() {
        const it = currentInteraction();
        if (it && it.enabled) it.run();
      },
      outcome: buildOutcome,
    },
  };
  return api;
}

