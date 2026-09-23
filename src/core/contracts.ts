/**
 * CONTRATOS COMPARTIDOS — Dra. Emiliana: Kinky-Kawaii Ortho-Gore (versión web)
 *
 * Este archivo es la única fuente de verdad de los tipos e interfaces entre módulos.
 * Cada módulo implementa las interfaces que le corresponden (ver docs/ARCHITECTURE.md)
 * y solo depende de otros módulos a través de estas interfaces (inyección de dependencias).
 *
 * Unidades:
 *  - "Espacio de herida" (wound space) en milímetros. Origen arriba-izquierda del lienzo
 *    de la herida, x hacia la derecha, y hacia abajo. Tamaño: WOUND_W_MM × WOUND_H_MM.
 *  - Sangre en % del volumen sanguíneo total del paciente (%BV).
 *  - Tiempo en segundos. Ángulos en grados.
 */
import type * as THREE from 'three';
import type { EventBus } from './EventBus';

// ───────────────────────────── Básicos ─────────────────────────────

export interface Vec2 {
  x: number;
  y: number;
}

export interface Pose2 {
  pos: Vec2;
  angleDeg: number;
}

export type Rank = 'S' | 'A' | 'B' | 'C' | 'F';
export type Difficulty = 'residente' | 'especialista' | 'jefe';
export type GuideLevel = 'full' | 'endpoints' | 'none';
export type Species = 'dog' | 'cat' | 'rabbit';
export type AnimalModelId =
  | 'chihuahua'
  | 'poodle'
  | 'bulldog'
  | 'dachshund'
  | 'pitbull'
  | 'bordercollie'
  | 'cat'
  | 'rabbit';
export type AssistantId = 'rodrigo' | 'fritz' | 'gigi';
export type HumanId =
  | 'emiliana'
  | 'valerio'
  | AssistantId
  | 'hortensia'
  | 'braulio'
  | 'ownerA'
  | 'ownerB'
  | 'ownerC';
export type SpeakerId = HumanId | 'panchito' | 'sistema' | 'pareja';
export type CommandTone = 'kind' | 'domina' | 'firmSweet';
export type TissueLayer = 'skin' | 'subcut' | 'fascia' | 'muscle' | 'bone';
export type BleedType = 'capillary' | 'venous' | 'arterial';

export type InstrumentId =
  | 'scalpel10'
  | 'scalpel15'
  | 'cautery'
  | 'gelpi'
  | 'weitlaner'
  | 'kern'
  | 'drill'
  | 'saw'
  | 'burr'
  | 'plate'
  | 'screwdriver'
  | 'needleHolder'
  | 'bandage'
  | 'kwire'
  | 'forceps'
  | 'rasp'
  | 'carm'
  | 'hand';

export interface InstrumentInfo {
  id: InstrumentId;
  name: string; // nombre en español para la interfaz
  short: string; // etiqueta corta (≤ 10 caracteres) para la ranura
  description: string;
}

// ───────────────────────────── Pasos quirúrgicos (datos) ─────────────────────────────

export type StepType =
  | 'incision'
  | 'hemostasis'
  | 'retract'
  | 'reduction'
  | 'rotate'
  | 'saw'
  | 'burr'
  | 'drillPins'
  | 'plate'
  | 'screws'
  | 'pick'
  | 'clickTargets'
  | 'suture'
  | 'bandage';

/** Bisturí a lo largo de una guía, capa por capa. La presión (1..5, rueda del ratón) debe
 *  acercarse a targetPressure (±1). Más presión: riesgo de cortar vasos. Menos: la capa no se abre. */
export interface IncisionParams {
  type: 'incision';
  path: Vec2[];
  layers: Array<{ layer: Exclude<TissueLayer, 'bone'>; targetPressure: number }>;
  instrument: 'scalpel10' | 'scalpel15';
  /** Puntos donde un corte demasiado profundo (presión ≥ target+2) abre un sangrado. */
  vesselHazards?: Vec2[];
}

/** Sellar puntos sangrantes con el electrocauterio bipolar (1–2 s de contacto ideal). */
export interface HemostasisParams {
  type: 'hemostasis';
  bleeders: Array<{ pos: Vec2; kind: BleedType }>;
  /** El Nivel de Campo debe quedar por debajo de este % para completar el paso. */
  targetFieldPct: number;
}

/** Colocar separadores (dos puntas por par) y abrir por clics de trinquete. */
export interface RetractParams {
  type: 'retract';
  instrument: 'gelpi' | 'weitlaner';
  pairs: Array<{ a: Vec2; b: Vec2 }>;
  idealClicks: number; // clics de trinquete ideales por par
  maxClicks: number; // por encima: falta 'overRetraction'
}

/** Mover fragmentos con pinzas Kern hasta su pose objetivo (silueta fantasma). */
export interface ReductionParams {
  type: 'reduction';
  fragmentIds: string[];
  /** Fragmentos que NO se deben tocar (osteosíntesis biológica). Tocarlos = 'noTouchViolation'. */
  avoidIds?: string[];
  tolMm: number;
  tolDeg: number;
  /** Puntos donde fijar agujas de Kirschner temporales tras reducir (clic con 'kwire'). */
  kwireSpots?: Vec2[];
  /** Disparos de arco en C (rayos X) disponibles. */
  carmShots: number;
  /** 'reduce' = alinear fractura; 'place' = llevar piezas (injerto, bloque) a su sitio. */
  mode: 'reduce' | 'place';
  showGhost: boolean;
}

/** Rotar un fragmento alrededor de un pivote hasta que el valor mostrado llegue al objetivo (TPLO). */
export interface RotateParams {
  type: 'rotate';
  fragmentId: string;
  pivot: Vec2;
  valueLabel: string; // p. ej. 'Ángulo de meseta tibial'
  startValue: number; // p. ej. 28 (°)
  targetValue: number; // p. ej. 5 (°)
  tolValue: number; // p. ej. 1
  degPerUnit: number; // grados de rotación del fragmento por unidad del valor
  /** Aguja antirrotacional a colocar al terminar. */
  pinSpot?: Vec2;
}

/** Sierra a lo largo de una trayectoria (línea o arco). Libera fragmentos al terminar. */
export interface SawParams {
  type: 'saw';
  path: Vec2[];
  kind: 'oscillating' | 'biradial' | 'fine';
  tolMm: number;
  /** Ids de fragmentos que pasan de locked=true a false al completar el corte. */
  releases?: string[];
  /** Si true, cortar sin irrigar (tecla I / clic derecho) sobrecalienta el hueso. */
  irrigationRequired: boolean;
}

/** Fresar/raspar un área (lámina vertebral, cartílago, alisado) evitando una zona prohibida. */
export interface BurrParams {
  type: 'burr';
  area: Vec2[];
  forbidden?: Vec2[];
  requiredPct: number; // 0..1
  layer: TissueLayer;
  label: string;
  brushMm: number;
  instrument: 'burr' | 'rasp';
}

/** Taladrar orificios / insertar agujas en puntos dados (calor, rotura de segunda cortical). */
export interface DrillPinsParams {
  type: 'drillPins';
  spots: Vec2[];
  tolMm: number;
  item: 'pin' | 'kwire' | 'rod' | 'hole';
  /** Grosor en mm de [cortical cis, médula, cortical trans]. */
  cortexProfileMm: [number, number, number];
  /** Hueso frágil (conejo): exceso de velocidad → 'iatrogenicFissure'. */
  fragile?: boolean;
}

export interface PlateOption {
  id: string;
  label: string;
  holes: number;
  lengthMm: number;
}

/** Elegir placa, contornearla (dobleces) y posicionarla sobre el hueso. */
export interface PlateParams {
  type: 'plate';
  options: PlateOption[];
  correctId: string;
  bendsRequired: number;
  target: Pose2;
  tolMm: number;
  tolDeg: number;
  /** Agujeros en coordenadas locales de la placa (mm, origen = centro de la placa). */
  holes: Vec2[];
  lengthMm: number;
  widthMm: number;
  hybrid?: boolean;
}

/** Atrapar tornillos de Fritz (ritmo), taladrar piloto, medir y atornillar hasta el clic. */
export interface ScrewsParams {
  type: 'screws';
  /** 'plate' = usar los agujeros de la placa colocada (bone.implants.plate). */
  holes: 'plate' | Vec2[];
  depthsMm: number[]; // profundidad medida por agujero (misma longitud que los agujeros)
  lengthOptionsMm: number[];
  torqueWindow: [number, number]; // 0..1, zona buena del limitador de torque
}

/** Extraer elementos (material discal, cabeza femoral, esquirlas) con pinzas. */
export interface PickParams {
  type: 'pick';
  items: Array<{ id: string; pos: Vec2; radiusMm: number }>;
  /** Fragmentos (anatomy.fragments) que hay que arrastrar fuera de la herida para retirarlos. */
  removeFragmentIds?: string[];
  forbidden?: Vec2[];
  tool: 'forceps' | 'kern';
  label: string;
}

export type DecalKind =
  | 'char'
  | 'scratch'
  | 'hole'
  | 'kwire'
  | 'pin'
  | 'stitch'
  | 'knot'
  | 'wire'
  | 'bar'
  | 'clamp'
  | 'graft'
  | 'necrosis'
  | 'fissure';

/** Clicar objetivos con precisión (abrazaderas, cerclaje, marcas). */
export interface ClickTargetsParams {
  type: 'clickTargets';
  targets: Array<{ pos: Vec2; label: string }>;
  tolMm: number;
  ordered: boolean;
  instrument: InstrumentId;
  decal: DecalKind;
  label: string;
}

/** Suturar por capas: semicírculos que cruzan la incisión a intervalos regulares. */
export interface SutureParams {
  type: 'suture';
  path: Vec2[];
  layers: Array<'fascia' | 'subcut' | 'skin'>;
  spacingMm: number;
}

/** Vendaje: movimiento circular con velocidad (tensión) constante. */
export interface BandageParams {
  type: 'bandage';
  center: Vec2;
  radiusMm: number;
  turns: number;
}

export type StepParams =
  | IncisionParams
  | HemostasisParams
  | RetractParams
  | ReductionParams
  | RotateParams
  | SawParams
  | BurrParams
  | DrillPinsParams
  | PlateParams
  | ScrewsParams
  | PickParams
  | ClickTargetsParams
  | SutureParams
  | BandageParams;

export interface StepDef {
  id: string;
  label: string; // texto de la checklist
  params: StepParams;
}

export interface PhaseDef {
  id: string;
  label: string; // p. ej. 'Incisión'
  weight: number; // % del Progreso total; la suma de un caso = 100
  steps: StepDef[];
}

// ───────────────────────────── Anatomía y caso ─────────────────────────────

export interface FragmentDef {
  id: string;
  label: string;
  /** Polígono en coordenadas locales (mm) respecto al origen del fragmento. */
  polygon: Vec2[];
  start: Pose2; // pose inicial en espacio de herida
  target?: Pose2; // pose anatómica correcta
  locked?: boolean; // unido al hueso hasta que una sierra lo libere
  noTouch?: boolean; // esquirla conminuta que no se debe tocar
  kind?: 'bone' | 'cartilage' | 'disc' | 'graft' | 'block';
}

export interface AnatomyDef {
  region: string;
  /** Polígonos absolutos (mm) del hueso que no se mueve. */
  boneStatic: Vec2[][];
  fragments: FragmentDef[];
  /** Médula espinal (hemilaminectomía). */
  cord?: Vec2[];
  /** Ventana profunda que se ve al separar el músculo. */
  window: Vec2[];
  skinTone: string; // color CSS de la piel rasurada
  furColor: string; // color CSS del pelaje alrededor
  /** Reducción cerrada (sin incisión): el hueso se ve a través de la piel con rayos X. */
  closed?: boolean;
}

export type DiagnosticTest =
  | 'drawer'
  | 'patella'
  | 'deepPain'
  | 'crepitus'
  | 'xray'
  | 'thoracicXray'
  | 'hipPalpation'
  | 'carpusStress';

export interface ClinicCaseDef {
  complaint: string; // lo que dice el dueño
  tests: DiagnosticTest[];
  keyTest: DiagnosticTest;
  requiredTests?: DiagnosticTest[];
  /** Lesión en la radiografía, coordenadas normalizadas 0..1 de la imagen. */
  xrayLesion: { u: number; v: number; radius: number };
  diagnosisOptions: string[]; // 3 opciones
  correctDiagnosis: number;
  explanations: { absurd: string; technical: string; evasive: string };
  minorCases: number;
  ownerTemper: 'calm' | 'hysterical' | 'paranoid' | 'anxious' | 'stern';
}

export type ValerioChallengeKind =
  | 'noScrewDrops'
  | 'underTargetTime'
  | 'maxOneDomina'
  | 'noArrest'
  | 'fieldNeverFlooded'
  | 'noExtraCarm';

export interface ValerioChallenge {
  kind: ValerioChallengeKind;
  text: string;
}

export interface EducationCard {
  title: string;
  facts: string[];
  /** Aviso de rigor: datos aproximados pendientes de revisión veterinaria. */
  disclaimer: string;
}

export type ChaosEventKind =
  | 'rodrigoSolo'
  | 'gigiSelfie'
  | 'fritzTremorSpike'
  | 'panchitoIntrusion'
  | 'valerioGaze'
  | 'braulioFoil'
  | 'hortensiaCall';

export interface CaseFlags {
  tutorial?: boolean;
  final?: boolean;
  microMode?: boolean;
  hypothermia?: boolean;
  noGuides?: boolean;
  rodrigoNoSolos?: boolean;
  gigiSelfieBoost?: boolean;
  valerioInRoom?: boolean;
  fritzNoTremor?: boolean;
}

export interface CaseDef {
  id: string;
  index: number; // 0..7
  week: number; // 0..7
  patient: {
    name: string;
    species: Species;
    animal: AnimalModelId;
    breed: string;
    weightKg: number;
    ageText: string;
  };
  owner: { name: string; human: HumanId };
  diagnosis: string;
  procedure: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  feeHC: number;
  requiredReputation: number; // estrellas mínimas (0..5)
  newMechanic: string;
  targetTimeSec: number;
  anatomy: AnatomyDef;
  phases: PhaseDef[];
  clinic: ClinicCaseDef;
  chaos: ChaosEventKind[]; // interferencias permitidas en este caso
  valerioChallenges: ValerioChallenge[];
  education: EducationCard;
  flags: CaseFlags;
  intro: string[]; // líneas de briefing
  outro: string[]; // líneas al terminar
}

// ───────────────────────────── Guardado, ajustes, Boutique ─────────────────────────────

export interface Settings {
  difficulty: Difficulty;
  goreLevel: number; // 0..100
  pastelMode: boolean; // sangre → jarabe de fresa brillante
  tremorScale: number; // 0..1 (0 = sin temblor)
  rhythmWindowScale: 1 | 1.5 | 2;
  reduceFlashes: boolean;
  subtitles: boolean;
  tts: boolean; // voces con síntesis del navegador
  masterVolume: number; // 0..1
  musicVolume: number;
  sfxVolume: number;
  asmrVolume: number;
  immersive: boolean;
  adaptiveDirector: boolean;
  colorblind: 'none' | 'deuter' | 'protan' | 'tritan';
}

export interface PartnerProfile {
  name: string;
  pronoun: 'ella' | 'él' | 'elle';
}

export interface SaveData {
  version: 1;
  coins: number;
  reputation: number; // 0..5 (puede ser decimal)
  lastRanks: Rank[]; // más reciente al final
  completed: Record<string, Rank>; // mejor rango por caso
  owned: string[]; // ids de la Boutique
  equipped: string[];
  settings: Settings;
  partner: PartnerProfile;
  viralClips: number;
  unlockedWeek: number;
  seenIntro: boolean;
}

export interface BoutiqueItem {
  id: string;
  name: string;
  priceHC: number;
  description: string;
  effectText: string;
  category: 'accesorio' | 'instrumental' | 'equipo';
  color: string; // color CSS para la tarjeta
}

/** Efectos agregados de los artículos equipados. */
export interface BoutiqueEffects {
  messageDurationSec: number; // 20 base, 30 con gargantilla
  noSlip: boolean;
  extraSlot: boolean;
  dominaCost: number; // 15 base, 12 con fusta de pompón
  handcuffsAutoSuction: boolean;
  lowConcTremorMult: number; // 1 base, 0.9 con arnés menta
  teamMoraleBonus: number; // 0 base, 5 con gorros
}

// ───────────────────────────── Diálogo ─────────────────────────────

export interface DialogueBank {
  /** Frases de Emiliana al mandar, por asistente y tono. */
  commands: Record<AssistantId, Record<CommandTone, string[]>>;
  /** Respuestas de cada asistente según tono, o si ignora la orden. */
  replies: Record<AssistantId, Record<CommandTone | 'ignored', string[]>>;
  /** Frase al empezar/terminar cada interferencia (hablante implícito en el tipo). */
  chaos: Record<ChaosEventKind, { speaker: SpeakerId; start: string[]; end: string[] }>;
  valerio: {
    gaze: string[];
    praise: string[];
    fault: Record<FaultKind, string[]>;
    phaseDone: string[];
    audit: Record<Rank, string[]>;
    component: Record<'T' | 'E' | 'H' | 'S' | 'L' | 't', string[]>;
    takeover: string[];
    finalRespect: string; // "Buen trabajo, doctora."
  };
  emiliana: {
    crisis: string[];
    relief: string[]; // tras leer un mensaje
    perfect: string[];
    fault: string[];
    start: string[];
    win: string[];
    breathing: string[];
  };
  /** Mensajes de la pareja. Pueden contener {nombre}. Siempre afectuosos, nunca degradantes. */
  partnerMessages: string[];
  rodrigo: { idle: string[]; groove: string[] };
  fritz: { drop: string[]; catch: string[]; nervous: string[] };
  gigi: { filming: string[]; viral: string[]; leave: string[] };
  owners: Record<'hortensia' | 'braulio' | 'generic', { waiting: string[]; calm: string[]; upset: string[] }>;
  cpr: { start: string[]; clear: string[]; rosc: string[]; fail: string[] };
  /** Pistas del tutorial por tipo de paso. */
  tutorialHints: Partial<Record<StepType, string>>;
}

// ───────────────────────────── Eventos ─────────────────────────────

export type FaultKind =
  | 'vesselCut'
  | 'thermalNecrosis'
  | 'plunge'
  | 'contaminatedImplant'
  | 'iatrogenicFissure'
  | 'char'
  | 'overRetraction'
  | 'strippedScrew'
  | 'cordTouch'
  | 'noTouchViolation'
  | 'screwDropped'
  | 'tightBandage'
  | 'wrongPlate'
  | 'malalignment'
  | 'offPath';

export interface ChaosEvent {
  id: number;
  kind: ChaosEventKind;
  start: number;
  duration: number;
  intensity: number; // 0..1
}

export type SfxName =
  | 'retractorClick'
  | 'squelch'
  | 'crunch'
  | 'boneClonk'
  | 'screwThread'
  | 'torqueClick'
  | 'screwDrop'
  | 'contaminated'
  | 'suturePull'
  | 'knot'
  | 'alarm'
  | 'defibCharge'
  | 'defibShock'
  | 'whip'
  | 'praise'
  | 'heartFlutter'
  | 'uiClick'
  | 'uiHover'
  | 'uiBuy'
  | 'uiError'
  | 'perfect'
  | 'good'
  | 'miss'
  | 'rankReveal'
  | 'xray'
  | 'kwire'
  | 'plateSet'
  | 'splash'
  | 'slurpFinish'
  | 'panchitoBark'
  | 'hortensiaScream'
  | 'doorClose'
  | 'autoclave'
  | 'phone'
  | 'camera'
  | 'faint'
  | 'coins'
  | 'guitarRiff'
  | 'compress'
  | 'bag'
  | 'footstep'
  | 'bendPlate'
  | 'tick';

export type LoopSfxName =
  | 'scalpel'
  | 'cautery'
  | 'suction'
  | 'drill'
  | 'saw'
  | 'burr'
  | 'clipper'
  | 'bandage';

export type MusicState =
  | 'title'
  | 'clinic'
  | 'orStable'
  | 'orGroove'
  | 'orTension'
  | 'arrest'
  | 'audit'
  | 'rankS'
  | 'boutique'
  | 'silent';

/** Mapa de eventos del bus global. Todos los módulos pueden emitir/escuchar. */
export interface GameEvents {
  say: { speaker: SpeakerId; text: string; durationSec?: number };
  toast: { text: string; kind?: 'info' | 'good' | 'bad' | 'valerio' };
  sfx: { name: SfxName; volume?: number; pitch?: number };
  gesture: { label: string; quality: number; perfect: boolean };
  fault: { kind: FaultKind; detail?: string };
  bonus: { label: string; exitoDelta: number };
  'chaos:start': ChaosEvent;
  'chaos:end': ChaosEvent;
  command: { target: AssistantId; tone: CommandTone; accepted: boolean };
  'bleeder:spawn': { id: number; kind: BleedType; pos: Vec2 };
  'bleeder:sealed': { id: number; kind: BleedType; secondsOpen: number };
  'step:begin': { stepId: string; type: StepType };
  'step:complete': { stepId: string; type: StepType };
  'phase:complete': { phaseId: string };
  'arrest:start': Record<string, never>;
  'arrest:end': { success: boolean };
  'message:arrive': { text: string };
  'message:read': { text: string };
  'carm:shot': { left: number };
  'screw:dropped': Record<string, never>;
  'screw:caught': { quality: 'perfect' | 'good' };
  'viral:clip': Record<string, never>;
}

// ───────────────────────────── Simulación (src/sim) ─────────────────────────────

export interface VitalsSnapshot {
  hr: number; // lpm
  spo2: number; // %
  map: number; // mmHg (presión arterial media)
  etco2: number; // mmHg
  tempC: number;
  bloodVolumePct: number; // 100 = volumen completo
  bloodLostPct: number; // pérdida acumulada en %BV
  exito: number; // 0..100
  arrest: boolean;
  rhythm: 'sinus' | 'tachy' | 'brady' | 'vfib' | 'asystole';
  /** Constantes fuera de rango (para parpadeo en HUD). */
  alarms: Array<'hr' | 'spo2' | 'map' | 'etco2' | 'temp'>;
}

export interface VitalsInit {
  species: Species;
  weightKg: number;
  startExito: number;
  hypothermiaRisk: boolean;
}

export interface VitalsAPI {
  snapshot(): VitalsSnapshot;
  update(
    dt: number,
    inputs: { bleedPctPerSec: number; fieldLevelPct: number; warming: boolean },
  ): void;
  applyExito(delta: number, reason: string): void;
  /** Llamado por el controlador cuando exito llega a 0. */
  triggerArrest(): void;
  resolveArrest(success: boolean): void;
  transfuse(pctBV: number): void;
  /** Muestras de Éxito % a 1 Hz desde el inicio. */
  exitoHistory(): number[];
}

export interface Bleeder {
  id: number;
  pos: Vec2;
  kind: BleedType;
  active: boolean;
  bornAt: number;
  sealedAt?: number;
  charred?: boolean;
}

export interface BleedingAPI {
  spawn(pos: Vec2, kind: BleedType, t: number): Bleeder;
  seal(id: number, t: number, charred?: boolean): void;
  list(): Bleeder[];
  active(): Bleeder[];
  nearest(p: Vec2, maxMm: number): Bleeder | null;
  /** Emisión de este tick por sangrado (%BV), con pulso arterial sincronizado a la FC. */
  emit(dt: number, t: number, hr: number): Array<{ bleeder: Bleeder; amount: number }>;
  /** Tasa total actual en %BV por segundo (promediada). */
  totalRatePctPerSec(): number;
}

export interface BloodPoolAPI {
  readonly cols: number;
  readonly rows: number;
  /** Altura de fluido por celda (fila mayor). 0 = seco, ~1 = celda llena. */
  readonly grid: Float32Array;
  readonly capacityPctBV: number;
  add(pos: Vec2, amountPctBV: number): void;
  /** Aspira alrededor de pos; devuelve lo retirado (%BV). */
  suction(pos: Vec2, radiusMm: number, maxPctBVPerSec: number, dt: number): number;
  step(dt: number): void;
  /** Nivel de Campo 0..100 (100 = cavidad llena). */
  levelPct(): number;
  totalPctBV(): number;
  clear(): void;
}

export interface FragmentState {
  id: string;
  def: FragmentDef;
  pose: Pose2;
  locked: boolean;
  removed: boolean;
  highlighted: boolean;
}

export interface PlateState {
  optionId: string;
  pose: Pose2;
  holesLocal: Vec2[];
  lengthMm: number;
  widthMm: number;
  bend: number; // 0..1 contorneado alcanzado
  hybrid?: boolean;
}

export interface ImplantState {
  plate: PlateState | null;
  screws: Array<{ pos: Vec2; lengthMm: number; contaminated: boolean; stripped: boolean }>;
  pins: Array<{ pos: Vec2; kind: 'pin' | 'kwire' | 'rod' | 'hole' }>;
  wires: Array<{ a: Vec2; b: Vec2 }>;
  bars: Array<{ a: Vec2; b: Vec2 }>;
}

export interface BoneAPI {
  fragments(): FragmentState[];
  fragment(id: string): FragmentState | undefined;
  /** Polígono del fragmento en espacio de herida con su pose actual. */
  worldPolygon(id: string): Vec2[];
  /** Polígono objetivo (target) en espacio de herida, si existe. */
  targetPolygon(id: string): Vec2[] | null;
  staticPolygons(): Vec2[][];
  /** Fragmento movible (no locked, no removed) bajo el punto, el de encima primero. */
  hitTest(p: Vec2, includeLocked?: boolean): string | null;
  setPose(id: string, pose: Pose2): void;
  release(id: string): void;
  remove(id: string): void;
  alignmentError(id: string): { mm: number; deg: number };
  cord(): Vec2[] | null;
  /** ¿Está el punto sobre hueso (estático o fragmento no retirado)? */
  isOnBone(p: Vec2): boolean;
  /** Agujeros de la placa en espacio de herida (vacío si no hay placa). */
  plateHolesWorld(): Vec2[];
  readonly implants: ImplantState;
}

export interface EmilianaInit {
  concentration: number;
  reserve: number;
  effects: BoutiqueEffects;
  firmSweetUnlocked: boolean;
  partner: PartnerProfile;
  messagePool: string[];
  maxMessages: number; // 1..3
  tremorScale: number; // ajuste de accesibilidad
  microMode: boolean;
}

export interface EmilianaSnapshot {
  concentration: number; // 0..100
  reserve: number; // 0..100
  crisis: boolean;
  crisisLeft: number;
  serenoLeft: number; // segundos de Pulso Sereno
  precision: boolean;
  blush: number; // 0..1 (rubor tras mensaje)
  message: {
    pending: boolean;
    secondsLeft: number;
    text: string | null; // texto del mensaje leído que se está mostrando
    showing: boolean;
    stored: number; // mensajes guardados para la pausa entre fases
  };
}

export interface EmilianaAPI {
  snapshot(): EmilianaSnapshot;
  update(
    dt: number,
    stressors: { fieldLevelPct: number; valerioGazing: boolean; lowLight: boolean },
  ): void;
  stress(amount: number, reason: string): void;
  /** Coste emocional de mandar. En micro-crisis no se puede mandar (allowed=false). */
  command(tone: CommandTone): { allowed: boolean; reserveCost: number; crisis: boolean };
  setPrecision(on: boolean): void;
  /** Amplitud del temblor en mm (0 con Pulso Sereno). */
  tremorMm(): number;
  /** Hito alcanzado: encola un mensaje si quedan. Devuelve true si llegó uno nuevo. */
  offerMessage(): boolean;
  /** Lee el mensaje pendiente (o uno guardado entre fases). */
  readMessage(betweenPhases?: boolean): { text: string } | null;
  breathingDone(quality: number): void;
  stats(): { commands: Record<CommandTone, number>; crises: number; messagesRead: number };
}

export interface ChaosConfig {
  allowed: ChaosEventKind[];
  difficulty: Difficulty;
  adaptive: boolean;
  /** Éxito mínimo de las últimas cirugías (para el ajuste adaptativo ±30%). */
  recentMinExito: number[];
  seed: number;
  tutorial: boolean;
}

export interface ChaosDirectorAPI {
  update(
    dt: number,
    perf: { exito: number; fieldLevelPct: number; arrest: boolean; stepType: StepType | null },
  ): { started: ChaosEvent[]; ended: ChaosEvent[] };
  active(): ChaosEvent[];
  /** El jugador resolvió la interferencia (orden, empujar manguera...). */
  resolve(id: number): void;
}

export interface GestureRecord {
  t: number;
  label: string;
  quality: number; // 0..1
  perfect: boolean; // quality ≥ 0.9
}

export interface LogRecord {
  t: number;
  kind: 'gesture' | 'fault' | 'bonus' | 'note';
  label: string;
  value?: number;
  data?: Record<string, unknown>;
}

export interface SurgeryLogAPI {
  setTime(t: number): void;
  /** Registra un gesto técnico. Perfecto (≥0.9) suma +1..+3 de Éxito. */
  gesture(label: string, quality: number): void;
  /** Registra una falta y aplica su penalización estándar de Éxito. */
  fault(kind: FaultKind, detail?: string): void;
  bonus(label: string, exitoDelta: number): void;
  note(label: string, data?: Record<string, unknown>): void;
  records(): LogRecord[];
  faults(): FaultKind[];
  gestures(): GestureRecord[];
}

export interface AuditInput {
  caseDef: CaseDef;
  difficulty: Difficulty;
  gestures: GestureRecord[];
  faults: FaultKind[];
  exitoSamples: number[];
  bloodLostPct: number;
  elapsedSec: number;
  sterility: number; // 0..100
  leadership: {
    kind: number;
    domina: number;
    firmSweet: number;
    crises: number;
    neglectSeconds: number;
  };
  arrestHappened: boolean;
  valerioTookOver: boolean;
  challenge: ValerioChallenge | null;
  challengeMet: boolean;
  tipHC: number;
  costsHC: number;
  worstMoments: Array<{ t: number; label: string }>;
}

export interface AuditResult {
  components: { T: number; E: number; H: number; S: number; L: number; t: number };
  nota: number;
  rank: Rank;
  cap: { rank: Rank; reason: string } | null;
  coins: { fee: number; multiplier: number; tip: number; costs: number; total: number };
  worstMoments: Array<{ t: number; label: string }>;
  /** Componente más débil, para elegir el comentario de Valerio. */
  weakest: 'T' | 'E' | 'H' | 'S' | 'L' | 't';
  challengeMet: boolean;
}

// ───────────────────────────── Personajes (src/characters) ─────────────────────────────

export type CharacterAnim =
  | 'idle'
  | 'walk'
  | 'run'
  | 'work'
  | 'panic'
  | 'guitar'
  | 'selfie'
  | 'tremble'
  | 'point'
  | 'crack'
  | 'cheer'
  | 'faint'
  | 'think'
  | 'suction'
  | 'offer'
  | 'compress'
  | 'sit';

export type Emote = 'hearts' | 'sweat' | 'anger' | 'music' | 'stars' | 'zzz' | null;

export interface CharacterRig {
  root: THREE.Group;
  height: number; // metros
  setAnim(anim: CharacterAnim): void;
  update(dt: number): void;
  setBlush(v: number): void; // 0..1
  setEmote(e: Emote): void;
  /** Mira hacia un punto (rotación en Y). */
  faceTowards(p: THREE.Vector3): void;
  dispose(): void;
}

export interface CharacterFactory {
  human(id: HumanId): CharacterRig;
  animal(id: AnimalModelId, opts?: { cone?: boolean; shaved?: boolean }): CharacterRig;
}

// ───────────────────────────── Equipo quirúrgico (src/surgery/assistants) ─────────────────────────────

export type AssistantVisualState =
  | 'ok'
  | 'working'
  | 'distracted'
  | 'trembling'
  | 'filming'
  | 'out'
  | 'panic';

export interface RodrigoAPI {
  /** %BV por segundo que retira del campo ahora mismo (0 durante un solo). */
  suctionRate(): number;
  /** Punto donde aspira (espacio de herida) o null si no aspira. */
  focus(): Vec2 | null;
  /** Mano izquierda de Emiliana: redirige la manguera (termina un solo). */
  pushHose(mm: Vec2): void;
  isSoloing(): boolean;
  grooveActive(): boolean;
}

export interface FritzAPI {
  /** 0 = pulso firme, 1 = temblor normal, 2 = pánico. */
  tremor(): number;
  presentItem(kind: 'screw' | 'plate' | 'pin'): void;
  dropped(): void;
  caught(quality: 'perfect' | 'good'): void;
}

export interface GigiAPI {
  /** Nivel de luz de la lámpara sobre la herida 0..1. */
  lightLevel(): number;
  isFilming(): boolean;
  leaveRoomFor(sec: number): void;
  /** ¿Está apartada de la camilla? (desfibrilación) */
  isClear(): boolean;
  /** Emiliana reorienta la lámpara ella misma (tecla L). */
  fixLampByHand(): void;
}

export interface ValerioAPI {
  isGazing(): boolean;
  say(text: string): void;
}

export interface CrewWorld {
  t: number;
  fieldLevelPct: number;
  stepType: StepType | null;
  arrest: boolean;
  exito: number;
}

export interface CommandOutcome {
  ignored: boolean;
  responseDelaySec: number;
  perfectForSec: number;
  reply: string;
}

export interface CrewDeps {
  scene: SurgerySceneAPI;
  factory: CharacterFactory;
  bus: EventBus<GameEvents>;
  caseDef: CaseDef;
  settings: Settings;
  effects: BoutiqueEffects;
  dialogue: DialogueBank;
  morale: Record<AssistantId, number>; // 0..100
}

export interface CrewAPI {
  rodrigo: RodrigoAPI;
  fritz: FritzAPI;
  gigi: GigiAPI;
  valerio: ValerioAPI;
  /** Reacción del asistente a una orden (el coste emocional lo calcula EmilianaAPI). */
  command(target: AssistantId, tone: CommandTone): CommandOutcome;
  onChaosStart(ev: ChaosEvent): void;
  onChaosEnd(ev: ChaosEvent): void;
  /** Vincula al director para marcar interferencias resueltas. */
  setResolver(resolve: (id: number) => void): void;
  update(dt: number, world: CrewWorld): void;
  visualStates(): Array<{
    id: AssistantId;
    state: AssistantVisualState;
    morale: number;
    problem: boolean;
  }>;
  /** Segundos acumulados con un asistente causando un problema sin corregir más de 5 s. */
  neglectSeconds(): number;
  /** Animación de Emiliana (la maneja la tripulación porque comparte escena). */
  emiliana: CharacterRig;
  dispose(): void;
}

// ───────────────────────────── Escena y herida (src/surgery) ─────────────────────────────

export type CameraMode = 'overview' | 'wound' | 'micro';

export interface WoundOverlay {
  id: string;
  z: number; // orden de dibujo (mayor = encima). Tejido=0..10, sangre=20, implantes=30, guías=40, UI=50+
  draw(
    g: CanvasRenderingContext2D,
    px: (p: Vec2) => Vec2,
    pxPerMm: number,
    t: number,
  ): void;
}

export interface WoundAPI {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly pxPerMm: number;
  readonly canvas: HTMLCanvasElement;
  /** Abre (corta) una capa entre a y b con el ancho dado. */
  cut(layer: Exclude<TissueLayer, 'bone'>, a: Vec2, b: Vec2, widthMm: number): void;
  /** Retira tejido/hueso en un círculo (fresa, raspa). */
  erase(layer: TissueLayer, center: Vec2, radiusMm: number): void;
  /** Fracción de los puntos de muestra que ya están abiertos en esa capa. */
  openFraction(layer: TissueLayer, samples: Vec2[], radiusMm?: number): number;
  /** Fracción del polígono ya retirada en esa capa (muestreo en rejilla). */
  removedFraction(layer: TissueLayer, polygon: Vec2[]): number;
  /** Capa visible más superficial en un punto. */
  topLayerAt(p: Vec2): TissueLayer;
  /** 0..1: separación de bordes; en 1 el músculo deja ver la ventana profunda. */
  setRetraction(amount: number): void;
  /** Cierra la herida progresivamente (sutura): 0 abierta, 1 cerrada. */
  setClosure(amount: number): void;
  setGuide(path: Vec2[] | null, level: GuideLevel): void;
  addDecal(kind: DecalKind, pos: Vec2, opts?: { angleDeg?: number; sizeMm?: number; to?: Vec2 }): void;
  addOverlay(o: WoundOverlay): void;
  removeOverlay(id: string): void;
  setXray(on: boolean): void;
  setGhosts(on: boolean): void;
  /** Luz 0..1 (Gigi / lámpara). */
  setLight(level: number): void;
  flash(color: string, ms: number): void;
  /** Recompone el lienzo (lee hueso, sangrados y charco cada fotograma). */
  update(dt: number, t: number): void;
}

export interface SurgerySceneDeps {
  renderer: THREE.WebGLRenderer;
  caseDef: CaseDef;
  factory: CharacterFactory;
  bone: BoneAPI;
  bleeding: BleedingAPI;
  blood: BloodPoolAPI;
  settings: Settings;
}

export interface SurgerySceneAPI {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly wound: WoundAPI;
  /** Puntos de la sala donde se colocan personajes y objetos. */
  readonly spots: Record<
    'emiliana' | 'rodrigo' | 'fritz' | 'gigi' | 'valerio' | 'tray' | 'lamp' | 'monitor' | 'door',
    THREE.Object3D
  >;
  setCameraMode(mode: CameraMode): void;
  /** Convierte un punto de pantalla (clientX/Y) a espacio de herida. */
  pick(clientX: number, clientY: number): { mm: Vec2; onWound: boolean };
  /** Proyección inversa: mm de herida → píxeles de pantalla (para DOM sobre la herida). */
  project(mm: Vec2): { x: number; y: number };
  setLamp(level: number, aimOffset: Vec2): void;
  showInstrument(id: InstrumentId | null): void;
  poseInstrument(mm: Vec2, opts?: { active?: boolean; angleDeg?: number; heat?: number }): void;
  setPatientBreathing(ratePerMin: number): void;
  setMonitorVitals(v: VitalsSnapshot): void;
  shake(intensity: number): void;
  update(dt: number, t: number): void;
  render(): void;
  resize(w: number, h: number): void;
  dispose(): void;
}

// ───────────────────────────── Pasos (src/surgery/steps) ─────────────────────────────

export interface WoundPointer {
  mm: Vec2; // ya con temblor y Pulso Firme aplicados
  onWound: boolean;
  button: number; // 0 izquierdo, 2 derecho
  buttons: number; // bitmask de botones pulsados
  pressure: number; // 1..5 (rueda del ratón)
  shift: boolean;
  t: number; // tiempo de cirugía
  instrument: InstrumentId;
}

export interface ChecklistItem {
  label: string;
  done: boolean;
}

export interface Gauge {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  zones?: Array<{ from: number; to: number; kind: 'good' | 'warn' | 'bad' }>;
}

export interface BeatClock {
  bpm: number;
  /** Fase 0..1 dentro del pulso actual. */
  phase(): number;
  timeToNextBeat(): number;
  beatIndex(): number;
}

/** Todo lo que un paso puede usar. Lo construye SurgeryController. */
export interface SurgeryContext {
  readonly caseDef: CaseDef;
  readonly bus: EventBus<GameEvents>;
  readonly wound: WoundAPI;
  readonly scene: SurgerySceneAPI;
  readonly bone: BoneAPI;
  readonly bleeding: BleedingAPI;
  readonly blood: BloodPoolAPI;
  readonly vitals: VitalsAPI;
  readonly emiliana: EmilianaAPI;
  readonly log: SurgeryLogAPI;
  readonly crew: CrewAPI;
  readonly audio: AudioAPI;
  readonly hud: SurgeryHudAPI;
  readonly beat: BeatClock;
  readonly settings: Settings;
  readonly effects: BoutiqueEffects;
  readonly guideLevel: GuideLevel;
  readonly dialogue: DialogueBank;
  readonly rng: () => number; // 0..1 determinista
  /** Tiempo de cirugía actual (s). */
  now(): number;
  /** Pide al controlador que active un instrumento. */
  selectInstrument(id: InstrumentId): void;
  /** Coste en HuesoCoins (tornillo caído, placa desperdiciada...). */
  addCost(hc: number, reason: string): void;
}

export interface StepController {
  readonly def: StepDef;
  /** Instrumentos del paso; el primero es el predeterminado. */
  readonly instruments: InstrumentId[];
  begin(ctx: SurgeryContext): void;
  update(dt: number): void;
  onPointerDown(p: WoundPointer): void;
  onPointerMove(p: WoundPointer): void;
  onPointerUp(p: WoundPointer): void;
  /** Teclas propias del paso (Q/E girar, I irrigar, 1..3 longitud...). Devuelve true si la consumió. */
  onKey(key: string, down: boolean): boolean;
  checklist(): ChecklistItem[];
  /** Progreso dentro del paso 0..1. */
  progress(): number;
  isComplete(): boolean;
  /** Instrucción actual para el jugador (español, ≤ 90 caracteres). */
  hint(): string;
  /** Medidores específicos (calor, torque, presión...). */
  gauges(): Gauge[];
  end(): void;
}

export type StepFactory = (def: StepDef) => StepController;

/** Herramienta disponible en cualquier paso (el cauterio para sangrados imprevistos). */
export interface UniversalTool {
  readonly instrument: InstrumentId;
  onPointerDown(p: WoundPointer): void;
  onPointerMove(p: WoundPointer): void;
  onPointerUp(p: WoundPointer): void;
  update(dt: number): void;
  gauges(): Gauge[];
}

// ───────────────────────────── Interfaz (src/ui) ─────────────────────────────

export type AlertKind = 'arrest' | 'arterial' | 'boneHeat' | 'crew' | 'comment' | 'flood' | 'info';

export interface HudModel {
  caseName: string;
  vitals: VitalsSnapshot;
  progress: {
    phases: Array<{ label: string; weight: number; done: boolean; active: boolean }>;
    totalPct: number;
    phaseLabel: string;
    stepLabel: string;
    checklist: ChecklistItem[];
    hint: string;
  };
  field: { levelPct: number; floodThresholdPct: number; rodrigoSuctioning: boolean };
  emiliana: EmilianaSnapshot;
  crew: Array<{
    id: AssistantId;
    name: string;
    state: AssistantVisualState;
    morale: number;
    problem: boolean;
  }>;
  instruments: {
    slots: InstrumentId[];
    active: InstrumentId;
    contaminated: InstrumentId[];
    names: Record<string, string>;
  };
  valerio: { gazing: boolean; provisionalRank: Rank | null; hidden: boolean; line: string | null };
  timer: { elapsedSec: number; targetSec: number };
  gauges: Gauge[];
  pressure: number; // 1..5
  lightLevel: number;
  immersive: boolean;
  microMode: boolean;
  challenge: string | null;
  carmShotsLeft: number | null;
}

export interface SurgeryHudAPI {
  update(model: HudModel): void;
  toast(text: string, kind?: 'info' | 'good' | 'bad' | 'valerio'): void;
  subtitle(speaker: SpeakerId, text: string, durationSec?: number): void;
  /** Máx. 2 alertas a la vez con prioridad arrest > arterial > boneHeat > crew > comment. */
  alert(kind: AlertKind, text: string): void;
  /** Contenedor DOM a pantalla completa para mini-juegos (anillo de tornillos, etc.). */
  minigameLayer(): HTMLElement;
  /** Tarjeta de feedback flotante cerca de un punto de pantalla ("¡Perfecto!"). */
  popText(text: string, screen: { x: number; y: number }, kind: 'perfect' | 'good' | 'miss' | 'bad'): void;
  setVisible(v: boolean): void;
  dispose(): void;
}

export interface ScreensAPI {
  showTitle(o: {
    hasSave: boolean;
    onPlay(): void;
    onContinue(): void;
    onBoutique(): void;
    onSettings(): void;
  }): void;
  showCaseSelect(o: {
    cases: CaseDef[];
    save: SaveData;
    isUnlocked(c: CaseDef): boolean;
    onPick(caseId: string): void;
    onBack(): void;
    onBoutique(): void;
  }): void;
  /** Briefing del caso + aviso de contenido + reto de Valerio. */
  showCaseIntro(o: {
    caseDef: CaseDef;
    challenge: ValerioChallenge | null;
    settings: Settings;
    onStart(): void;
    onBack(): void;
  }): void;
  showAudit(o: {
    caseDef: CaseDef;
    result: AuditResult;
    valerioLines: string[];
    save: SaveData;
    onContinue(): void;
    onRetry(): void;
  }): void;
  showBoutique(o: {
    save: SaveData;
    items: BoutiqueItem[];
    onBuy(id: string): boolean;
    onToggleEquip(id: string): void;
    onBack(): void;
  }): void;
  showSettings(o: {
    settings: Settings;
    partner: PartnerProfile;
    onChange(s: Settings, p: PartnerProfile): void;
    onBack(): void;
  }): void;
  showPause(o: { onResume(): void; onSettings(): void; onQuit(): void }): void;
  /** Transición a pantalla completa con texto (entre fases). */
  showInterstitial(o: { title: string; subtitle?: string; seconds: number; onDone(): void }): void;
  hideAll(): void;
}

export interface CPRResult {
  success: boolean;
  quality: number; // 0..1
}

export interface CPROverlayAPI {
  start(o: {
    beat: BeatClock;
    rhythmWindowScale: number;
    reduceFlashes: boolean;
    /** ¿Gigi ya se apartó? (la descarga espera por ella) */
    isClear(): boolean;
    dialogue: DialogueBank;
    audio: AudioAPI;
    onDone(r: CPRResult): void;
  }): void;
  update(dt: number): void;
  onKey(key: string, down: boolean): boolean;
  stop(): void;
  isActive(): boolean;
}

export interface BreathingOverlayAPI {
  start(o: { rhythmWindowScale: number; audio: AudioAPI; onDone(quality: number): void }): void;
  update(dt: number): void;
  onKey(key: string, down: boolean): boolean;
  stop(): void;
  isActive(): boolean;
}

// ───────────────────────────── Audio (src/audio) ─────────────────────────────

export interface LoopHandle {
  /** Parámetros 0..1: rate (velocidad/RPM), load (carga), wet (humedad), intensity. */
  set(param: 'rate' | 'load' | 'wet' | 'intensity', value: number): void;
  stop(): void;
}

export interface AudioAPI {
  /** Llamar tras el primer gesto del usuario. */
  unlock(): Promise<void>;
  play(
    name: SfxName,
    params?: { volume?: number; pitch?: number; pan?: number; intensity?: number },
  ): void;
  loop(name: LoopSfxName): LoopHandle;
  setMusic(state: MusicState): void;
  readonly beat: BeatClock;
  /** Pitido del monitor: ritmo = FC, tono = SpO2 (baja con la saturación). null = silencio. */
  setVitals(v: VitalsSnapshot | null): void;
  voice(speaker: SpeakerId, text: string): void;
  applySettings(s: Settings): void;
  dispose(): void;
}

// ───────────────────────────── Clínica (src/clinic) ─────────────────────────────

export interface ClinicOutcome {
  diagnosisCorrect: boolean;
  xrayMarked: boolean;
  requiredTestsDone: boolean;
  sterileSets: number; // juegos de instrumental esterilizados (repuestos)
  prepQuality: number; // 0..1 rasurado + antisepsia
  contamination: number; // 0..1 máximo de las zonas estériles
  ownerCalm: number; // 0..1
  tipHC: number;
  minorCasesHC: number;
  educationPoints: number;
  emilianaStart: { concentration: number; reserve: number };
  morale: Record<AssistantId, number>;
}

export interface ClinicDeps {
  renderer: THREE.WebGLRenderer;
  uiRoot: HTMLElement;
  factory: CharacterFactory;
  audio: AudioAPI;
  bus: EventBus<GameEvents>;
  input: InputAPI;
  caseDef: CaseDef;
  save: SaveData;
  effects: BoutiqueEffects;
  dialogue: DialogueBank;
  settings: Settings;
  onComplete(outcome: ClinicOutcome): void;
}

export interface ClinicAPI {
  update(dt: number): void;
  render(): void;
  resize(w: number, h: number): void;
  dispose(): void;
}

// ───────────────────────────── Entrada (src/core/Input.ts) ─────────────────────────────

export interface InputAPI {
  isDown(code: string): boolean; // KeyboardEvent.code, p. ej. 'KeyW', 'Space', 'ShiftLeft'
  /** Suscripción a teclas: devuelve función para desuscribir. */
  onKey(cb: (code: string, down: boolean, repeat: boolean) => void): () => void;
  onPointer(
    cb: (e: { type: 'down' | 'move' | 'up'; x: number; y: number; button: number; buttons: number }) => void,
  ): () => void;
  onWheel(cb: (deltaY: number) => void): () => void;
  readonly pointer: { x: number; y: number; buttons: number };
  /** Bloquea la entrada de juego mientras hay un menú abierto. */
  setEnabled(v: boolean): void;
}
