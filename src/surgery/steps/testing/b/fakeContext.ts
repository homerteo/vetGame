import type {
  AnatomyDef,
  AudioAPI,
  BeatClock,
  BleedingAPI,
  BloodPoolAPI,
  BoneAPI,
  BoutiqueEffects,
  CaseDef,
  CrewAPI,
  DecalKind,
  DialogueBank,
  EmilianaAPI,
  FaultKind,
  FragmentState,
  GameEvents,
  GestureRecord,
  GuideLevel,
  HumanId,
  ImplantState,
  InstrumentId,
  LogRecord,
  LoopSfxName,
  Pose2,
  Settings,
  SfxName,
  SpeakerId,
  StepController,
  SurgeryContext,
  SurgeryHudAPI,
  SurgeryLogAPI,
  SurgerySceneAPI,
  TissueLayer,
  Vec2,
  VitalsAPI,
  WoundAPI,
  WoundOverlay,
  WoundPointer,
} from '../../../../core/contracts';
import { EventBus } from '../../../../core/EventBus';
import { createRng } from '../../../../core/rng';
import { angleDiff, applyPose, applyPosePoly, dist, pointInPolygon, polygonBounds } from '../../../../core/math';
import { WOUND_H_MM, WOUND_W_MM } from '../../../../core/constants';

// Contexto quirúrgico falso para probar los pasos B (y alimentar la página dev/stepsB).

const FAULTS: FaultKind[] = [
  'vesselCut',
  'thermalNecrosis',
  'plunge',
  'contaminatedImplant',
  'iatrogenicFissure',
  'char',
  'overRetraction',
  'strippedScrew',
  'cordTouch',
  'noTouchViolation',
  'screwDropped',
  'tightBandage',
  'wrongPlate',
  'malalignment',
  'offPath',
];

export function makeSettings(over: Partial<Settings> = {}): Settings {
  return {
    difficulty: 'especialista',
    goreLevel: 60,
    pastelMode: false,
    tremorScale: 1,
    rhythmWindowScale: 1,
    reduceFlashes: false,
    subtitles: true,
    tts: false,
    masterVolume: 1,
    musicVolume: 1,
    sfxVolume: 1,
    asmrVolume: 1,
    immersive: false,
    adaptiveDirector: true,
    colorblind: 'none',
    ...over,
  };
}

export function makeEffects(): BoutiqueEffects {
  return {
    messageDurationSec: 20,
    noSlip: false,
    extraSlot: false,
    dominaCost: 15,
    handcuffsAutoSuction: false,
    lowConcTremorMult: 1,
    teamMoraleBonus: 0,
  };
}

export function makeDialogue(): DialogueBank {
  const fault = {} as Record<FaultKind, string[]>;
  for (const k of FAULTS) fault[k] = [`Doctora, eso fue ${k}. Primum non nocere.`];
  fault.noTouchViolation = ['Biológica significa no tocar, doctora. Ni con la mirada.'];
  fault.iatrogenicFissure = ['Acaba de fabricar una fractura nueva. Impresionante, en el mal sentido.'];
  fault.plunge = ['Eso era la segunda cortical, no un túnel al otro lado.'];
  fault.contaminatedImplant = ['Un tornillo del suelo. Anotado con tinta roja.'];
  fault.thermalNecrosis = ['Huele a hueso a la parrilla, doctora. Irrigue.'];
  fault.cordTouch = ['La médula no es opcional, doctora.'];
  fault.offPath = ['La línea está dibujada por algo.'];
  fault.malalignment = ['Rotar de más también es rotar mal.'];
  fault.wrongPlate = ['Sesenta monedas al contenedor. Bravo.'];
  fault.strippedScrew = ['Rosca pasada. El tornillo ya no cree en usted.'];
  const tone = { kind: ['Por favor'], domina: ['¡Ahora!'], firmSweet: ['Ahora, cielo'] };
  const reply = { kind: ['Sí'], domina: ['¡Sí, doctora!'], firmSweet: ['Voy'], ignored: ['¿Eh?'] };
  const chaos = { speaker: 'sistema' as SpeakerId, start: ['Empieza'], end: ['Termina'] };
  const owner = { waiting: ['Espero'], calm: ['Tranquila'], upset: ['¡Ese ruido! ¡¿Qué le hacen a Merengue?!', '¡Merengue es lo único que me queda!'] };
  return {
    commands: { rodrigo: tone, fritz: tone, gigi: tone },
    replies: { rodrigo: reply, fritz: reply, gigi: reply },
    chaos: {
      rodrigoSolo: chaos,
      gigiSelfie: chaos,
      fritzTremorSpike: chaos,
      panchitoIntrusion: chaos,
      valerioGaze: chaos,
      braulioFoil: chaos,
      hortensiaCall: chaos,
    },
    valerio: {
      gaze: ['Observo.'],
      praise: ['Correcto.'],
      fault,
      phaseDone: ['Siguiente.'],
      audit: { S: ['S'], A: ['A'], B: ['B'], C: ['C'], F: ['F'] },
      component: { T: ['T'], E: ['E'], H: ['H'], S: ['S'], L: ['L'], t: ['t'] },
      takeover: ['Yo me encargo.'],
      finalRespect: 'Buen trabajo, doctora.',
    },
    emiliana: { crisis: ['Perdón'], relief: ['Ay'], perfect: ['¡Eso!'], fault: ['Ups'], start: ['Vamos'], win: ['¡Sí!'], breathing: ['Respira'] },
    partnerMessages: ['Buena niña, {nombre}.'],
    rodrigo: { idle: ['…'], groove: ['¡Rock!'] },
    fritz: { drop: ['¡N-no, no, no! ¡Se me cayó!'], catch: ['¡L-lo tiene!'], nervous: ['T-t-tornillo…'] },
    gigi: { filming: ['¡Hola, huesitos!'], viral: ['¡Viral!'], leave: ['Me salgo, me salgo'] },
    owners: { hortensia: owner, braulio: owner, generic: owner },
    cpr: { start: ['RCP'], clear: ['¡Despejen!'], rosc: ['¡Pulso!'], fail: ['No'] },
    tutorialHints: {
      reduction: 'Arrastra el fragmento con las pinzas hasta la silueta menta. Q/E para girar.',
      screws: 'Espacio cuando el anillo rosa toque el tornillo de Fritz.',
    },
  };
}

export function makeCaseDef(anatomy: AnatomyDef, o: { tutorial?: boolean; owner?: HumanId } = {}): CaseDef {
  return {
    id: 'caso-prueba',
    index: 0,
    week: 0,
    patient: { name: 'Panchito', species: 'dog', animal: 'chihuahua', breed: 'Chihuahua', weightKg: 2.1, ageText: '3 años' },
    owner: { name: o.owner === 'hortensia' ? 'Doña Hortensia' : 'Don Braulio', human: o.owner ?? 'braulio' },
    diagnosis: 'Fractura de prueba',
    procedure: 'Procedimiento de prueba',
    difficulty: 1,
    feeHC: 100,
    requiredReputation: 0,
    newMechanic: '—',
    targetTimeSec: 600,
    anatomy,
    phases: [],
    clinic: {
      complaint: '—',
      tests: ['xray'],
      keyTest: 'xray',
      xrayLesion: { u: 0.5, v: 0.5, radius: 0.1 },
      diagnosisOptions: ['a', 'b', 'c'],
      correctDiagnosis: 0,
      explanations: { absurd: 'a', technical: 't', evasive: 'e' },
      minorCases: 0,
      ownerTemper: 'calm',
    },
    chaos: [],
    valerioChallenges: [],
    education: { title: '—', facts: [], disclaimer: '—' },
    flags: { tutorial: !!o.tutorial },
    intro: [],
    outro: [],
  };
}

// ───────────────────────────── Hueso ─────────────────────────────

export function createFakeBone(anatomy: AnatomyDef): BoneAPI {
  const frags: FragmentState[] = anatomy.fragments.map((def) => ({
    id: def.id,
    def,
    pose: { pos: { ...def.start.pos }, angleDeg: def.start.angleDeg },
    locked: !!def.locked,
    removed: false,
    highlighted: false,
  }));
  const implants: ImplantState = { plate: null, screws: [], pins: [], wires: [], bars: [] };
  const get = (id: string) => frags.find((f) => f.id === id);
  const api: BoneAPI = {
    fragments: () => frags,
    fragment: get,
    worldPolygon: (id) => {
      const f = get(id);
      return f ? applyPosePoly(f.def.polygon, f.pose) : [];
    },
    targetPolygon: (id) => {
      const f = get(id);
      return f?.def.target ? applyPosePoly(f.def.polygon, f.def.target) : null;
    },
    staticPolygons: () => anatomy.boneStatic,
    hitTest(p, includeLocked) {
      for (let i = frags.length - 1; i >= 0; i--) {
        const f = frags[i];
        if (f.removed || (f.locked && !includeLocked)) continue;
        if (pointInPolygon(p, applyPosePoly(f.def.polygon, f.pose))) return f.id;
      }
      return null;
    },
    setPose(id, pose: Pose2) {
      const f = get(id);
      if (f) f.pose = { pos: { ...pose.pos }, angleDeg: pose.angleDeg };
    },
    release(id) {
      const f = get(id);
      if (f) f.locked = false;
    },
    remove(id) {
      const f = get(id);
      if (f) f.removed = true;
    },
    alignmentError(id) {
      const f = get(id);
      if (!f?.def.target) return { mm: 0, deg: 0 };
      return { mm: dist(f.pose.pos, f.def.target.pos), deg: Math.abs(angleDiff(f.pose.angleDeg, f.def.target.angleDeg)) };
    },
    cord: () => anatomy.cord ?? null,
    isOnBone(p) {
      for (const poly of anatomy.boneStatic) if (pointInPolygon(p, poly)) return true;
      for (const f of frags) if (!f.removed && pointInPolygon(p, applyPosePoly(f.def.polygon, f.pose))) return true;
      return false;
    },
    plateHolesWorld() {
      const pl = implants.plate;
      return pl ? pl.holesLocal.map((h) => applyPose(h, pl.pose)) : [];
    },
    implants,
  };
  return api;
}

// ───────────────────────────── Herida ─────────────────────────────

const CELL = 0.5; // mm por celda de la rejilla de tejido retirado
const GW = Math.ceil(WOUND_W_MM / CELL);
const GH = Math.ceil(WOUND_H_MM / CELL);

export interface FakeWound extends WoundAPI {
  overlays: Map<string, WoundOverlay>;
  decals: Array<{ kind: DecalKind; pos: Vec2; angleDeg?: number; sizeMm?: number; to?: Vec2 }>;
  erases: number;
  grids: Record<TissueLayer, Uint8Array>;
  xray: boolean;
  ghosts: boolean;
  guide: { path: Vec2[] | null; level: GuideLevel };
  flashes: Array<{ color: string; ms: number }>;
}

export function createFakeWound(): FakeWound {
  const grids = {
    skin: new Uint8Array(GW * GH),
    subcut: new Uint8Array(GW * GH),
    fascia: new Uint8Array(GW * GH),
    muscle: new Uint8Array(GW * GH),
    bone: new Uint8Array(GW * GH),
  } as Record<TissueLayer, Uint8Array>;
  const mark = (layer: TissueLayer, c: Vec2, r: number) => {
    const g = grids[layer];
    const x0 = Math.max(0, Math.floor((c.x - r) / CELL));
    const x1 = Math.min(GW - 1, Math.ceil((c.x + r) / CELL));
    const y0 = Math.max(0, Math.floor((c.y - r) / CELL));
    const y1 = Math.min(GH - 1, Math.ceil((c.y + r) / CELL));
    const r2 = r * r;
    for (let y = y0; y <= y1; y++) {
      const cy = (y + 0.5) * CELL - c.y;
      for (let x = x0; x <= x1; x++) {
        const cx = (x + 0.5) * CELL - c.x;
        if (cx * cx + cy * cy <= r2) g[y * GW + x] = 1;
      }
    }
  };
  const isOpen = (layer: TissueLayer, p: Vec2) => {
    const x = Math.floor(p.x / CELL);
    const y = Math.floor(p.y / CELL);
    if (x < 0 || y < 0 || x >= GW || y >= GH) return false;
    return grids[layer][y * GW + x] === 1;
  };
  const w: FakeWound = {
    widthMm: WOUND_W_MM,
    heightMm: WOUND_H_MM,
    pxPerMm: 6,
    canvas: null as unknown as HTMLCanvasElement,
    overlays: new Map(),
    decals: [],
    erases: 0,
    grids,
    xray: false,
    ghosts: false,
    guide: { path: null, level: 'full' },
    flashes: [],
    cut(layer, a, b, widthMm) {
      const n = Math.max(1, Math.ceil(dist(a, b) / (CELL * 0.5)));
      for (let i = 0; i <= n; i++) mark(layer, { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }, widthMm / 2);
    },
    erase(layer, center, radiusMm) {
      w.erases++;
      mark(layer, center, radiusMm);
    },
    openFraction(layer, samples, radiusMm = 0) {
      if (!samples.length) return 0;
      let n = 0;
      for (const s of samples) {
        if (isOpen(layer, s) || (radiusMm > 0 && (isOpen(layer, { x: s.x + radiusMm, y: s.y }) || isOpen(layer, { x: s.x - radiusMm, y: s.y })))) n++;
      }
      return n / samples.length;
    },
    removedFraction(layer, polygon) {
      const b = polygonBounds(polygon);
      let inside = 0;
      let removed = 0;
      for (let y = b.minY + CELL / 2; y < b.maxY; y += CELL) {
        for (let x = b.minX + CELL / 2; x < b.maxX; x += CELL) {
          const p = { x, y };
          if (!pointInPolygon(p, polygon)) continue;
          inside++;
          if (isOpen(layer, p)) removed++;
        }
      }
      return inside ? removed / inside : 0;
    },
    topLayerAt: () => 'bone',
    setRetraction() {},
    setClosure() {},
    setGuide(path, level) {
      w.guide = { path, level };
    },
    addDecal(kind, pos, opts) {
      w.decals.push({ kind, pos: { ...pos }, ...opts });
    },
    addOverlay(o) {
      w.overlays.set(o.id, o);
    },
    removeOverlay(id) {
      w.overlays.delete(id);
    },
    setXray(on) {
      w.xray = on;
    },
    setGhosts(on) {
      w.ghosts = on;
    },
    setLight() {},
    flash(color, ms) {
      w.flashes.push({ color, ms });
    },
    update() {},
  };
  return w;
}

// ───────────────────────────── Audio y ritmo ─────────────────────────────

export interface FakeBeat extends BeatClock {
  time: number;
  advance(dt: number): void;
}

export function createFakeBeat(bpm = 110, startTime = 0): FakeBeat {
  const period = () => 60 / b.bpm;
  const b: FakeBeat = {
    bpm,
    time: startTime,
    advance(dt) {
      b.time += dt;
    },
    phase: () => (b.time % period()) / period(),
    timeToNextBeat: () => {
      const r = period() - (b.time % period());
      return r >= period() - 1e-9 ? 0 : r;
    },
    beatIndex: () => Math.floor(b.time / period() + 1e-9),
  };
  return b;
}

export interface FakeLoop {
  name: LoopSfxName;
  params: Record<string, number>;
  stopped: boolean;
}

export interface FakeAudio extends AudioAPI {
  played: Array<{ name: SfxName; params?: Record<string, number | undefined> }>;
  loops: FakeLoop[];
  activeLoops(): FakeLoop[];
  count(name: SfxName): number;
}

export function createFakeAudio(beat: BeatClock): FakeAudio {
  const a: FakeAudio = {
    played: [],
    loops: [],
    activeLoops: () => a.loops.filter((l) => !l.stopped),
    count: (name) => a.played.filter((p) => p.name === name).length,
    unlock: async () => {},
    play(name, params) {
      a.played.push({ name, params });
    },
    loop(name) {
      const l: FakeLoop = { name, params: {}, stopped: false };
      a.loops.push(l);
      return {
        set(param, value) {
          l.params[param] = value;
        },
        stop() {
          l.stopped = true;
        },
      };
    },
    setMusic() {},
    beat,
    setVitals() {},
    voice() {},
    applySettings() {},
    dispose() {},
  };
  return a;
}

// ───────────────────────────── HUD, registro, equipo ─────────────────────────────

export interface FakeHud extends SurgeryHudAPI {
  pops: Array<{ text: string; kind: string; x: number; y: number }>;
  toasts: string[];
  layerEl: HTMLElement | null;
}

export function createFakeHud(): FakeHud {
  const h: FakeHud = {
    pops: [],
    toasts: [],
    layerEl: null,
    update() {},
    toast(text) {
      h.toasts.push(text);
    },
    subtitle() {},
    alert() {},
    minigameLayer() {
      if (!h.layerEl) {
        if (typeof document === 'undefined') throw new Error('minigameLayer requiere DOM (usa // @vitest-environment jsdom)');
        h.layerEl = document.createElement('div');
        h.layerEl.className = 'fake-minigame-layer';
        document.body.appendChild(h.layerEl);
      }
      return h.layerEl;
    },
    popText(text, screen, kind) {
      h.pops.push({ text, kind, x: screen.x, y: screen.y });
    },
    setVisible() {},
    dispose() {
      h.layerEl?.remove();
    },
  };
  return h;
}

export interface FakeLog extends SurgeryLogAPI {
  faultCount(kind: FaultKind): number;
}

export function createFakeLog(bus: EventBus<GameEvents>, now: () => number): FakeLog {
  const recs: LogRecord[] = [];
  const faults: FaultKind[] = [];
  const gestures: GestureRecord[] = [];
  let t = 0;
  const cur = () => Math.max(t, now());
  return {
    setTime(v) {
      t = v;
    },
    gesture(label, quality) {
      const g = { t: cur(), label, quality, perfect: quality >= 0.9 };
      gestures.push(g);
      recs.push({ t: g.t, kind: 'gesture', label, value: quality });
      bus.emit('gesture', { label, quality, perfect: g.perfect });
    },
    fault(kind, detail) {
      faults.push(kind);
      recs.push({ t: cur(), kind: 'fault', label: kind, data: detail ? { detail } : undefined });
      bus.emit('fault', { kind, detail });
    },
    bonus(label, exitoDelta) {
      recs.push({ t: cur(), kind: 'bonus', label, value: exitoDelta });
      bus.emit('bonus', { label, exitoDelta });
    },
    note(label, data) {
      recs.push({ t: cur(), kind: 'note', label, data });
    },
    records: () => recs,
    faults: () => faults,
    gestures: () => gestures,
    faultCount: (kind) => faults.filter((f) => f === kind).length,
  };
}

export interface FakeCrewCalls {
  fritz: string[];
  gigiLeave: number[];
}

export function createFakeCrew(tremor = () => 1): { crew: CrewAPI; calls: FakeCrewCalls } {
  const calls: FakeCrewCalls = { fritz: [], gigiLeave: [] };
  const crew = {
    rodrigo: { suctionRate: () => 0.1, focus: () => null, pushHose() {}, isSoloing: () => false, grooveActive: () => false },
    fritz: {
      tremor,
      presentItem: (k: string) => calls.fritz.push(`present:${k}`),
      dropped: () => calls.fritz.push('dropped'),
      caught: (q: string) => calls.fritz.push(`caught:${q}`),
    },
    gigi: {
      lightLevel: () => 1,
      isFilming: () => false,
      leaveRoomFor: (s: number) => calls.gigiLeave.push(s),
      isClear: () => true,
      fixLampByHand() {},
    },
    valerio: { isGazing: () => false, say() {} },
    command: () => ({ ignored: false, responseDelaySec: 1, perfectForSec: 0, reply: '' }),
    onChaosStart() {},
    onChaosEnd() {},
    setResolver() {},
    update() {},
    visualStates: () => [],
    neglectSeconds: () => 0,
    emiliana: null as unknown as CrewAPI['emiliana'],
    dispose() {},
  } satisfies CrewAPI;
  return { crew, calls };
}

// ───────────────────────────── Contexto completo ─────────────────────────────

export interface FakeContextOptions {
  anatomy: AnatomyDef;
  tutorial?: boolean;
  guideLevel?: GuideLevel;
  owner?: HumanId;
  settings?: Partial<Settings>;
  seed?: number;
  fritzTremor?: () => number;
  /** Sustituciones para la página dev (HUD real, proyección real...). */
  hud?: SurgeryHudAPI;
  project?: (mm: Vec2) => { x: number; y: number };
}

export interface FakeHarness {
  ctx: SurgeryContext;
  bus: EventBus<GameEvents>;
  bone: BoneAPI;
  wound: FakeWound;
  audio: FakeAudio;
  hud: FakeHud;
  log: FakeLog;
  beat: FakeBeat;
  crewCalls: FakeCrewCalls;
  costs: Array<{ hc: number; reason: string }>;
  selected: InstrumentId[];
  stress: Array<{ amount: number; reason: string }>;
  says: Array<GameEvents['say']>;
  events: Array<{ type: string; payload: unknown }>;
  /** Tiempo de cirugía (s). */
  t: number;
  instrument: InstrumentId;
  ptr(x: number, y: number, o?: Partial<WoundPointer>): WoundPointer;
  /** Avanza el reloj y llama a step.update en pasos de dt. */
  run(step: StepController, seconds: number, dt?: number, each?: () => void): void;
}

export function createFakeContext(o: FakeContextOptions): FakeHarness {
  const bus = new EventBus<GameEvents>();
  const bone = createFakeBone(o.anatomy);
  const wound = createFakeWound();
  const beat = createFakeBeat();
  const audio = createFakeAudio(beat);
  const fakeHud = createFakeHud();
  const { crew, calls } = createFakeCrew(o.fritzTremor);
  const settings = makeSettings(o.settings);
  const rng = createRng(o.seed ?? 7);
  const says: Array<GameEvents['say']> = [];
  const events: Array<{ type: string; payload: unknown }> = [];
  bus.on('say', (e) => says.push(e));
  for (const type of ['carm:shot', 'screw:dropped', 'screw:caught', 'step:complete'] as const) {
    bus.on(type, (payload) => events.push({ type, payload }));
  }

  const h = {} as FakeHarness;
  const log = createFakeLog(bus, () => h.t);
  const scene = {
    project: o.project ?? ((mm: Vec2) => ({ x: mm.x * 6, y: mm.y * 6 })),
    pick: () => ({ mm: { x: 0, y: 0 }, onWound: true }),
    wound,
  } as unknown as SurgerySceneAPI;
  const emiliana = {
    stress: (amount: number, reason: string) => h.stress.push({ amount, reason }),
    tremorMm: () => 0,
  } as unknown as EmilianaAPI;
  const ctx: SurgeryContext = {
    caseDef: makeCaseDef(o.anatomy, { tutorial: o.tutorial, owner: o.owner }),
    bus,
    wound,
    scene,
    bone,
    bleeding: { spawn: () => ({}), seal() {}, list: () => [], active: () => [], nearest: () => null, emit: () => [], totalRatePctPerSec: () => 0 } as unknown as BleedingAPI,
    blood: { levelPct: () => 0 } as unknown as BloodPoolAPI,
    vitals: {} as VitalsAPI,
    emiliana,
    log,
    crew,
    audio,
    hud: o.hud ?? fakeHud,
    beat,
    settings,
    effects: makeEffects(),
    guideLevel: o.guideLevel ?? 'full',
    dialogue: makeDialogue(),
    rng,
    now: () => h.t,
    selectInstrument: (id) => {
      h.selected.push(id);
      h.instrument = id;
    },
    addCost: (hc, reason) => h.costs.push({ hc, reason }),
  };
  Object.assign(h, {
    ctx,
    bus,
    bone,
    wound,
    audio,
    hud: fakeHud,
    log,
    beat,
    crewCalls: calls,
    costs: [],
    selected: [],
    stress: [],
    says,
    events,
    t: 0,
    instrument: 'hand' as InstrumentId,
    ptr(x: number, y: number, p: Partial<WoundPointer> = {}): WoundPointer {
      return {
        mm: { x, y },
        onWound: true,
        button: 0,
        buttons: 1,
        pressure: 3,
        shift: false,
        t: h.t,
        instrument: h.instrument,
        ...p,
      };
    },
    run(step: StepController, seconds: number, dt = 1 / 60, each?: () => void) {
      const n = Math.round(seconds / dt);
      for (let i = 0; i < n; i++) {
        h.t += dt;
        beat.advance(dt);
        each?.();
        step.update(dt);
      }
    },
  } satisfies Partial<FakeHarness>);
  return h;
}
