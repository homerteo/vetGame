/*
 * Contexto quirúrgico falso (en memoria) para probar los pasos A sin otros módulos.
 * También lo usa la página de desarrollo dev/stepsA.* con un renderizador 2D propio.
 */
import type {
  AnatomyDef,
  AudioAPI,
  BeatClock,
  Bleeder,
  BleedingAPI,
  BleedType,
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
  GestureRecord,
  GuideLevel,
  ImplantState,
  LogRecord,
  LoopHandle,
  LoopSfxName,
  Pose2,
  Settings,
  SfxName,
  SurgeryContext,
  SurgeryHudAPI,
  SurgeryLogAPI,
  SurgerySceneAPI,
  TissueLayer,
  Vec2,
  VitalsAPI,
  VitalsSnapshot,
  WoundAPI,
  WoundOverlay,
} from '../../../../core/contracts';
import { EventBus } from '../../../../core/EventBus';
import type { GameEvents } from '../../../../core/contracts';
import { applyPosePoly, distToSegment, pointInPolygon, polygonBounds } from '../../../../core/math';
import { createRng } from '../../../../core/rng';
import { WOUND_H_MM, WOUND_W_MM } from '../../../../core/constants';

// ───────────────────────────── Herida ─────────────────────────────

export const LAYERS: TissueLayer[] = ['skin', 'subcut', 'fascia', 'muscle', 'bone'];
/** Resolución de la rejilla de cobertura (mm por celda). */
export const CELL_MM = 0.5;

export interface FakeDecal {
  kind: DecalKind;
  pos: Vec2;
  opts?: { angleDeg?: number; sizeMm?: number; to?: Vec2 };
}

export interface FakeWound extends WoundAPI {
  readonly cols: number;
  readonly rows: number;
  /** Máscaras de apertura por capa (1 = abierta), fila mayor. */
  readonly masks: Record<TissueLayer, Uint8Array>;
  readonly cuts: Array<{ layer: TissueLayer; a: Vec2; b: Vec2; width: number }>;
  readonly erases: Array<{ layer: TissueLayer; center: Vec2; radius: number }>;
  readonly decals: FakeDecal[];
  readonly overlays: Map<string, WoundOverlay>;
  readonly flashes: Array<{ color: string; ms: number }>;
  guide: { path: Vec2[] | null; level: GuideLevel };
  retraction: number;
  closure: number;
  light: number;
  xray: boolean;
  ghosts: boolean;
  /** Corta directamente una capa a lo largo de una polilínea (preparar escenarios). */
  cutAlong(layer: Exclude<TissueLayer, 'bone'>, path: Vec2[], width: number): void;
}

export function createFakeWound(): FakeWound {
  const cols = Math.round(WOUND_W_MM / CELL_MM);
  const rows = Math.round(WOUND_H_MM / CELL_MM);
  const masks = {} as Record<TissueLayer, Uint8Array>;
  for (const l of LAYERS) masks[l] = new Uint8Array(cols * rows);
  const cuts: FakeWound['cuts'] = [];
  const erases: FakeWound['erases'] = [];
  const decals: FakeDecal[] = [];
  const overlays = new Map<string, WoundOverlay>();
  const flashes: FakeWound['flashes'] = [];

  const markSegment = (m: Uint8Array, a: Vec2, b: Vec2, half: number) => {
    const minX = Math.max(0, Math.floor((Math.min(a.x, b.x) - half) / CELL_MM));
    const maxX = Math.min(cols - 1, Math.ceil((Math.max(a.x, b.x) + half) / CELL_MM));
    const minY = Math.max(0, Math.floor((Math.min(a.y, b.y) - half) / CELL_MM));
    const maxY = Math.min(rows - 1, Math.ceil((Math.max(a.y, b.y) + half) / CELL_MM));
    const q = { x: 0, y: 0 };
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        q.x = (x + 0.5) * CELL_MM;
        q.y = (y + 0.5) * CELL_MM;
        if (distToSegment(q, a, b) <= half) m[y * cols + x] = 1;
      }
    }
  };

  const openNear = (m: Uint8Array, p: Vec2, r: number) => {
    const minX = Math.max(0, Math.floor((p.x - r) / CELL_MM));
    const maxX = Math.min(cols - 1, Math.ceil((p.x + r) / CELL_MM));
    const minY = Math.max(0, Math.floor((p.y - r) / CELL_MM));
    const maxY = Math.min(rows - 1, Math.ceil((p.y + r) / CELL_MM));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (!m[y * cols + x]) continue;
        const dx = (x + 0.5) * CELL_MM - p.x;
        const dy = (y + 0.5) * CELL_MM - p.y;
        if (dx * dx + dy * dy <= r * r) return true;
      }
    }
    return false;
  };

  const w: FakeWound = {
    widthMm: WOUND_W_MM,
    heightMm: WOUND_H_MM,
    pxPerMm: 6.4,
    canvas: (typeof document !== 'undefined' ? document.createElement('canvas') : null) as unknown as HTMLCanvasElement,
    cols,
    rows,
    masks,
    cuts,
    erases,
    decals,
    overlays,
    flashes,
    guide: { path: null, level: 'full' },
    retraction: 0,
    closure: 0,
    light: 1,
    xray: false,
    ghosts: false,
    cut(layer, a, b, widthMm) {
      cuts.push({ layer, a: { ...a }, b: { ...b }, width: widthMm });
      markSegment(masks[layer], a, b, widthMm / 2);
    },
    erase(layer, center, radiusMm) {
      erases.push({ layer, center: { ...center }, radius: radiusMm });
      markSegment(masks[layer], center, center, radiusMm);
    },
    openFraction(layer, samples, radiusMm = 1) {
      if (samples.length === 0) return 0;
      let n = 0;
      for (const s of samples) if (openNear(masks[layer], s, radiusMm)) n++;
      return n / samples.length;
    },
    removedFraction(layer, polygon) {
      const b = polygonBounds(polygon);
      let tot = 0;
      let open = 0;
      const q = { x: 0, y: 0 };
      for (let y = b.minY; y <= b.maxY; y += 1) {
        for (let x = b.minX; x <= b.maxX; x += 1) {
          q.x = x;
          q.y = y;
          if (!pointInPolygon(q, polygon)) continue;
          tot++;
          const cx = Math.floor(x / CELL_MM);
          const cy = Math.floor(y / CELL_MM);
          if (cx >= 0 && cy >= 0 && cx < cols && cy < rows && masks[layer][cy * cols + cx]) open++;
        }
      }
      return tot ? open / tot : 0;
    },
    topLayerAt(p) {
      const cx = Math.floor(p.x / CELL_MM);
      const cy = Math.floor(p.y / CELL_MM);
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return 'skin';
      for (const l of LAYERS) if (!masks[l][cy * cols + cx]) return l;
      return 'bone';
    },
    setRetraction(v) {
      w.retraction = v;
    },
    setClosure(v) {
      w.closure = v;
    },
    setGuide(path, level) {
      w.guide = { path, level };
    },
    addDecal(kind, pos, opts) {
      decals.push({ kind, pos: { ...pos }, opts });
    },
    addOverlay(o) {
      overlays.set(o.id, o);
    },
    removeOverlay(id) {
      overlays.delete(id);
    },
    setXray(on) {
      w.xray = on;
    },
    setGhosts(on) {
      w.ghosts = on;
    },
    setLight(l) {
      w.light = l;
    },
    flash(color, ms) {
      flashes.push({ color, ms });
    },
    update() {},
    cutAlong(layer, path, width) {
      for (let i = 0; i < path.length - 1; i++) markSegment(masks[layer], path[i], path[i + 1], width / 2);
    },
  };
  return w;
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
  const byId = (id: string) => frags.find((f) => f.id === id);
  const api: BoneAPI = {
    fragments: () => frags,
    fragment: byId,
    worldPolygon(id) {
      const f = byId(id);
      return f ? applyPosePoly(f.def.polygon, f.pose) : [];
    },
    targetPolygon(id) {
      const f = byId(id);
      return f?.def.target ? applyPosePoly(f.def.polygon, f.def.target) : null;
    },
    staticPolygons: () => anatomy.boneStatic,
    hitTest(p, includeLocked = false) {
      for (let i = frags.length - 1; i >= 0; i--) {
        const f = frags[i];
        if (f.removed || (f.locked && !includeLocked)) continue;
        if (pointInPolygon(p, api.worldPolygon(f.id))) return f.id;
      }
      return null;
    },
    setPose(id, pose: Pose2) {
      const f = byId(id);
      if (f) f.pose = { pos: { ...pose.pos }, angleDeg: pose.angleDeg };
    },
    release(id) {
      const f = byId(id);
      if (f) f.locked = false;
    },
    remove(id) {
      const f = byId(id);
      if (f) f.removed = true;
    },
    alignmentError(id) {
      const f = byId(id);
      if (!f?.def.target) return { mm: 0, deg: 0 };
      return {
        mm: Math.hypot(f.pose.pos.x - f.def.target.pos.x, f.pose.pos.y - f.def.target.pos.y),
        deg: Math.abs(f.pose.angleDeg - f.def.target.angleDeg),
      };
    },
    cord: () => anatomy.cord ?? null,
    isOnBone(p) {
      if (anatomy.boneStatic.some((poly) => pointInPolygon(p, poly))) return true;
      return frags.some((f) => !f.removed && pointInPolygon(p, api.worldPolygon(f.id)));
    },
    plateHolesWorld: () => [],
    implants,
  };
  return api;
}

// ───────────────────────────── Sangrado y charco ─────────────────────────────

export const FAKE_BLEED_RATE: Record<BleedType, number> = { capillary: 0.02, venous: 0.06, arterial: 0.15 };

export function createFakeBleeding(): BleedingAPI {
  const list: Bleeder[] = [];
  let nextId = 1;
  return {
    spawn(pos, kind, t) {
      const b: Bleeder = { id: nextId++, pos: { ...pos }, kind, active: true, bornAt: t };
      list.push(b);
      return b;
    },
    seal(id, t, charred) {
      const b = list.find((x) => x.id === id);
      if (!b || !b.active) return;
      b.active = false;
      b.sealedAt = t;
      if (charred) b.charred = true;
    },
    list: () => list,
    active: () => list.filter((b) => b.active),
    nearest(p, maxMm) {
      let best: Bleeder | null = null;
      let bd = maxMm;
      for (const b of list) {
        if (!b.active) continue;
        const d = Math.hypot(b.pos.x - p.x, b.pos.y - p.y);
        if (d <= bd) {
          bd = d;
          best = b;
        }
      }
      return best;
    },
    emit(dt, t, hr) {
      const out: Array<{ bleeder: Bleeder; amount: number }> = [];
      for (const b of list) {
        if (!b.active) continue;
        let rate = FAKE_BLEED_RATE[b.kind];
        if (b.kind === 'arterial') rate *= 1 + 0.8 * Math.sin((t * hr * Math.PI * 2) / 60);
        out.push({ bleeder: b, amount: Math.max(0, rate * dt) });
      }
      return out;
    },
    totalRatePctPerSec() {
      let s = 0;
      for (const b of list) if (b.active) s += FAKE_BLEED_RATE[b.kind];
      return s;
    },
  };
}

export interface FakeBlood extends BloodPoolAPI {
  /** Nivel de Campo forzado (0..100). */
  level: number;
}

export function createFakeBlood(): FakeBlood {
  const cols = 64;
  const rows = 40;
  const grid = new Float32Array(cols * rows);
  const b: FakeBlood = {
    cols,
    rows,
    grid,
    capacityPctBV: 5,
    level: 0,
    add(_pos, amount) {
      b.level = Math.min(100, b.level + (amount / b.capacityPctBV) * 100);
    },
    suction(_pos, _r, maxPerSec, dt) {
      const take = Math.min((b.level / 100) * b.capacityPctBV, maxPerSec * dt);
      b.level = Math.max(0, b.level - (take / b.capacityPctBV) * 100);
      return take;
    },
    step() {},
    levelPct: () => b.level,
    totalPctBV: () => (b.level / 100) * b.capacityPctBV,
    clear() {
      b.level = 0;
    },
  };
  return b;
}

// ───────────────────────────── Registro, audio, HUD, personas ─────────────────────────────

export interface FakeLog extends SurgeryLogAPI {
  readonly gestureList: GestureRecord[];
  readonly faultList: Array<{ kind: FaultKind; detail?: string; t: number }>;
  readonly bonusList: Array<{ label: string; exitoDelta: number }>;
}

export function createFakeLog(now: () => number): FakeLog {
  const recs: LogRecord[] = [];
  const gestureList: GestureRecord[] = [];
  const faultList: FakeLog['faultList'] = [];
  const bonusList: FakeLog['bonusList'] = [];
  return {
    gestureList,
    faultList,
    bonusList,
    setTime() {},
    gesture(label, quality) {
      const g = { t: now(), label, quality, perfect: quality >= 0.9 };
      gestureList.push(g);
      recs.push({ t: g.t, kind: 'gesture', label, value: quality });
    },
    fault(kind, detail) {
      faultList.push({ kind, detail, t: now() });
      recs.push({ t: now(), kind: 'fault', label: kind });
    },
    bonus(label, exitoDelta) {
      bonusList.push({ label, exitoDelta });
      recs.push({ t: now(), kind: 'bonus', label, value: exitoDelta });
    },
    note(label, data) {
      recs.push({ t: now(), kind: 'note', label, data });
    },
    records: () => recs,
    faults: () => faultList.map((f) => f.kind),
    gestures: () => gestureList,
  };
}

export interface FakeLoop extends LoopHandle {
  name: LoopSfxName;
  stopped: boolean;
  params: Record<string, number>;
}

export interface FakeAudio extends AudioAPI {
  readonly plays: SfxName[];
  readonly loops: FakeLoop[];
  activeLoops(): FakeLoop[];
}

export function createFakeBeat(): BeatClock {
  return { bpm: 110, phase: () => 0, timeToNextBeat: () => 0.5, beatIndex: () => 0 };
}

export function createFakeAudio(onPlay?: (name: SfxName) => void): FakeAudio {
  const plays: SfxName[] = [];
  const loops: FakeLoop[] = [];
  return {
    plays,
    loops,
    activeLoops: () => loops.filter((l) => !l.stopped),
    async unlock() {},
    play(name) {
      plays.push(name);
      onPlay?.(name);
    },
    loop(name) {
      const l: FakeLoop = {
        name,
        stopped: false,
        params: {},
        set(param, v) {
          l.params[param] = v;
        },
        stop() {
          l.stopped = true;
        },
      };
      loops.push(l);
      return l;
    },
    setMusic() {},
    beat: createFakeBeat(),
    setVitals() {},
    voice() {},
    applySettings() {},
    dispose() {},
  };
}

export interface PopRecord {
  text: string;
  kind: 'perfect' | 'good' | 'miss' | 'bad';
  screen: { x: number; y: number };
}

export interface FakeHud extends SurgeryHudAPI {
  readonly pops: PopRecord[];
  readonly alerts: Array<{ kind: string; text: string }>;
}

export function createFakeHud(onPop?: (p: PopRecord) => void): FakeHud {
  const pops: PopRecord[] = [];
  const alerts: FakeHud['alerts'] = [];
  return {
    pops,
    alerts,
    update() {},
    toast() {},
    subtitle() {},
    alert(kind, text) {
      alerts.push({ kind, text });
    },
    minigameLayer: () => (typeof document !== 'undefined' ? document.body : null) as unknown as HTMLElement,
    popText(text, screen, kind) {
      const p = { text, kind, screen: { ...screen } };
      pops.push(p);
      onPop?.(p);
    },
    setVisible() {},
    dispose() {},
  };
}

export interface FakeEmiliana extends EmilianaAPI {
  readonly stresses: Array<{ amount: number; reason: string }>;
  offers: number;
}

export function createFakeEmiliana(): FakeEmiliana {
  const stresses: FakeEmiliana['stresses'] = [];
  const e: FakeEmiliana = {
    stresses,
    offers: 0,
    snapshot: () => ({
      concentration: 80,
      reserve: 80,
      crisis: false,
      crisisLeft: 0,
      serenoLeft: 0,
      precision: false,
      blush: 0,
      message: { pending: false, secondsLeft: 0, text: null, showing: false, stored: 0 },
    }),
    update() {},
    stress(amount, reason) {
      stresses.push({ amount, reason });
    },
    command: () => ({ allowed: true, reserveCost: 0, crisis: false }),
    setPrecision() {},
    tremorMm: () => 0,
    offerMessage() {
      e.offers++;
      return true;
    },
    readMessage: () => null,
    breathingDone() {},
    stats: () => ({ commands: { kind: 0, domina: 0, firmSweet: 0 }, crises: 0, messagesRead: 0 }),
  };
  return e;
}

function fakeCrew(): CrewAPI {
  return {
    rodrigo: { suctionRate: () => 0.12, focus: () => null, pushHose() {}, isSoloing: () => false, grooveActive: () => false },
    fritz: { tremor: () => 1, presentItem() {}, dropped() {}, caught() {} },
    gigi: { lightLevel: () => 1, isFilming: () => false, leaveRoomFor() {}, isClear: () => true, fixLampByHand() {} },
    valerio: { isGazing: () => false, say() {} },
    command: () => ({ ignored: false, responseDelaySec: 1, perfectForSec: 0, reply: '¡Voy!' }),
    onChaosStart() {},
    onChaosEnd() {},
    setResolver() {},
    update() {},
    visualStates: () => [],
    neglectSeconds: () => 0,
    emiliana: null as unknown as CrewAPI['emiliana'],
    dispose() {},
  };
}

function fakeVitals(): VitalsAPI {
  const snap: VitalsSnapshot = {
    hr: 120,
    spo2: 98,
    map: 80,
    etco2: 38,
    tempC: 38.2,
    bloodVolumePct: 100,
    bloodLostPct: 0,
    exito: 60,
    arrest: false,
    rhythm: 'sinus',
    alarms: [],
  };
  return {
    snapshot: () => snap,
    update() {},
    applyExito(d) {
      snap.exito = Math.max(0, Math.min(100, snap.exito + d));
    },
    triggerArrest() {},
    resolveArrest() {},
    transfuse() {},
    exitoHistory: () => [],
  };
}

// ───────────────────────────── Diálogo, ajustes, caso ─────────────────────────────

const four = (base: string) => [`${base} (1)`, `${base} (2)`, `${base} (3)`, `${base} (4)`];

/** Banco de diálogo mínimo con todas las listas. */
export function createFakeDialogue(): DialogueBank {
  const tones = () => ({ kind: four('Por favor'), domina: four('¡Ahora!'), firmSweet: four('Con cariño, ya') });
  const replies = () => ({ kind: four('Sí, jefa'), domina: four('¡A la orden!'), firmSweet: four('Voy, doc'), ignored: four('¿Eh?') });
  const faults = {} as Record<FaultKind, string[]>;
  for (const k of [
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
  ] as FaultKind[])
    faults[k] = four(`Valerio: ${k}`);
  const chaos = (speaker: 'rodrigo' | 'gigi' | 'fritz' | 'panchito' | 'valerio' | 'braulio' | 'hortensia') => ({
    speaker,
    start: four('Empieza el caos'),
    end: four('Se acabó el caos'),
  });
  return {
    commands: { rodrigo: tones(), fritz: tones(), gigi: tones() },
    replies: { rodrigo: replies(), fritz: replies(), gigi: replies() },
    chaos: {
      rodrigoSolo: chaos('rodrigo'),
      gigiSelfie: chaos('gigi'),
      fritzTremorSpike: chaos('fritz'),
      panchitoIntrusion: chaos('panchito'),
      valerioGaze: chaos('valerio'),
      braulioFoil: chaos('braulio'),
      hortensiaCall: chaos('hortensia'),
    },
    valerio: {
      gaze: four('Lo estoy mirando'),
      praise: four('Aceptable'),
      fault: faults,
      phaseDone: four('Siguiente'),
      audit: { S: four('S'), A: four('A'), B: four('B'), C: four('C'), F: four('F') },
      component: { T: four('T'), E: four('E'), H: four('H'), S: four('S'), L: four('L'), t: four('t') },
      takeover: four('Me encargo yo'),
      finalRespect: 'Buen trabajo, doctora.',
    },
    emiliana: {
      crisis: four('Perdón, Fritz'),
      relief: four('Gracias, cielo'),
      perfect: ['¡Eso es técnica!', 'Mírenme, mírenme.', 'Precisión de relojera.', 'Ni Valerio lo haría mejor.'],
      fault: ['Ups. Nadie vio eso.', 'Eso… fue a propósito.', 'Respira, Emi.', '¡Rodrigo, no grabes!'],
      start: four('Vamos'),
      win: four('¡Lo logramos!'),
      breathing: four('Inspira'),
    },
    partnerMessages: four('Buena niña'),
    rodrigo: {
      idle: ['¡Aspiración en re menor, jefa!', 'Esto suena a grunge.', 'Tengo la cánula lista, doc.', 'Qué groove tiene esta herida.'],
      groove: ['¡Eso es rock!', 'Separador afinado.', '¡Wooo, exposición!', 'Clic, clic, rock and roll.'],
    },
    fritz: { drop: four('¡No, no, no!'), catch: four('¡La tengo!'), nervous: four('T-t-tranquilo') },
    gigi: {
      filming: ['¡Hola, mis huesitos!', 'Esta costura es contenido.', 'Sonrían para el reel.', 'Esto se va viral.'],
      viral: ['¡Mil likes en un minuto!', 'La venda lila es tendencia.', '¡Viral, doctora!', 'Los comentarios aman la venda.'],
      leave: four('Ya salgo'),
    },
    owners: {
      hortensia: { waiting: four('¿Y Merengue?'), calm: four('Gracias'), upset: four('¡Ay!') },
      braulio: { waiting: four('5G'), calm: four('Ok'), upset: four('¡Chip!') },
      generic: { waiting: four('¿Falta?'), calm: four('Bien'), upset: four('¡Uf!') },
    },
    cpr: { start: four('RCP'), clear: four('¡Despejen!'), rosc: four('¡Pulso!'), fail: four('No…') },
    tutorialHints: {
      incision: 'Tutorial: sigue la línea punteada con clic izq. y ajusta la presión con la rueda.',
      hemostasis: 'Tutorial: mantén clic izq. sobre cada sangrado entre 1 y 2 segundos.',
      suture: 'Tutorial: arrastra de un lado al otro de la herida por el punto verde.',
    },
  };
}

export function createFakeSettings(): Settings {
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
  };
}

export function createFakeEffects(): BoutiqueEffects {
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

export function createFakeCase(anatomy: AnatomyDef, tutorial = false): CaseDef {
  return {
    id: 'fake',
    index: 0,
    week: 0,
    patient: { name: 'Panchito', species: 'dog', animal: 'chihuahua', breed: 'Chihuahua', weightKg: 2.1, ageText: '3 años' },
    owner: { name: 'Don Braulio', human: 'braulio' },
    diagnosis: 'Fractura de prueba',
    procedure: 'Procedimiento de prueba',
    difficulty: 1,
    feeHC: 100,
    requiredReputation: 0,
    newMechanic: '',
    targetTimeSec: 600,
    anatomy,
    phases: [],
    clinic: {
      complaint: '',
      tests: ['xray'],
      keyTest: 'xray',
      xrayLesion: { u: 0.5, v: 0.5, radius: 0.1 },
      diagnosisOptions: ['a', 'b', 'c'],
      correctDiagnosis: 0,
      explanations: { absurd: '', technical: '', evasive: '' },
      minorCases: 0,
      ownerTemper: 'calm',
    },
    chaos: [],
    valerioChallenges: [],
    education: { title: '', facts: [], disclaimer: '' },
    flags: { tutorial },
    intro: [],
    outro: [],
  };
}

// ───────────────────────────── Contexto ─────────────────────────────

export interface FakeCtxOptions {
  anatomy: AnatomyDef;
  tutorial?: boolean;
  guideLevel?: GuideLevel;
  seed?: number;
  /** Proyección mm → pantalla (por defecto ×4). */
  project?: (mm: Vec2) => { x: number; y: number };
  onPop?: (p: PopRecord) => void;
  onPlay?: (name: SfxName) => void;
}

export interface FakeCtx {
  ctx: SurgeryContext;
  wound: FakeWound;
  bone: BoneAPI;
  bleeding: BleedingAPI;
  blood: FakeBlood;
  log: FakeLog;
  audio: FakeAudio;
  hud: FakeHud;
  emiliana: FakeEmiliana;
  bus: EventBus<GameEvents>;
  /** Eventos emitidos por el bus, en orden. */
  events: Array<{ type: keyof GameEvents; payload: unknown }>;
  clock: { t: number };
  selected: string[];
  costs: Array<{ hc: number; reason: string }>;
}

const BUS_EVENTS: Array<keyof GameEvents> = [
  'say',
  'toast',
  'gesture',
  'fault',
  'bonus',
  'bleeder:spawn',
  'bleeder:sealed',
  'step:begin',
  'step:complete',
];

export function createFakeContext(o: FakeCtxOptions): FakeCtx {
  const clock = { t: 0 };
  const now = () => clock.t;
  const wound = createFakeWound();
  const bone = createFakeBone(o.anatomy);
  const bleeding = createFakeBleeding();
  const blood = createFakeBlood();
  const log = createFakeLog(now);
  const audio = createFakeAudio(o.onPlay);
  const hud = createFakeHud(o.onPop);
  const emiliana = createFakeEmiliana();
  const bus = new EventBus<GameEvents>();
  const events: FakeCtx['events'] = [];
  for (const type of BUS_EVENTS) bus.on(type, (payload) => events.push({ type, payload }));
  const project = o.project ?? ((mm: Vec2) => ({ x: mm.x * 4, y: mm.y * 4 }));
  const scene = {
    scene: null,
    camera: null,
    wound,
    spots: {},
    setCameraMode() {},
    pick: (x: number, y: number) => ({ mm: { x: x / 4, y: y / 4 }, onWound: true }),
    project,
    setLamp() {},
    showInstrument() {},
    poseInstrument() {},
    setPatientBreathing() {},
    setMonitorVitals() {},
    shake() {},
    update() {},
    render() {},
    resize() {},
    dispose() {},
  } as unknown as SurgerySceneAPI;
  const selected: string[] = [];
  const costs: FakeCtx['costs'] = [];
  const ctx: SurgeryContext = {
    caseDef: createFakeCase(o.anatomy, o.tutorial),
    bus,
    wound,
    scene,
    bone,
    bleeding,
    blood,
    vitals: fakeVitals(),
    emiliana,
    log,
    crew: fakeCrew(),
    audio,
    hud,
    beat: audio.beat,
    settings: createFakeSettings(),
    effects: createFakeEffects(),
    guideLevel: o.guideLevel ?? 'full',
    dialogue: createFakeDialogue(),
    rng: createRng(o.seed ?? 42),
    now,
    selectInstrument(id) {
      selected.push(id);
    },
    addCost(hc, reason) {
      costs.push({ hc, reason });
    },
  };
  return { ctx, wound, bone, bleeding, blood, log, audio, hud, emiliana, bus, events, clock, selected, costs };
}
