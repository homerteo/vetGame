import type {
  AnatomyDef,
  BurrParams,
  DrillPinsParams,
  FragmentDef,
  HumanId,
  PlateParams,
  ReductionParams,
  RotateParams,
  SawParams,
  ScrewsParams,
  StepDef,
  StepParams,
  StepType,
  Vec2,
} from '../../../../core/contracts';
import { arcPath, rectPoly } from '../../../../core/math';

// Escenarios de demostración (pruebas y página dev/stepsB). Todo dentro de la ventana 20..140 × 32..68.

export interface Scenario {
  type: StepType;
  title: string;
  anatomy: AnatomyDef;
  def: StepDef;
  owner?: HumanId;
  closed?: boolean;
  /** Preparación extra del hueso (p. ej. placa ya colocada para tornillos). */
  plate?: boolean;
}

const WINDOW: Vec2[] = rectPoly(80, 50, 124, 34);
const SKIN = '#f2c9b8';
const FUR = '#d9a066';

/** Diáfisis estática (mitad proximal) con extremo de fractura irregular. */
const proximalShaft: Vec2[] = [
  { x: 24, y: 44 },
  { x: 76, y: 44 },
  { x: 78.5, y: 47 },
  { x: 77, y: 50 },
  { x: 79, y: 53 },
  { x: 77.5, y: 56 },
  { x: 24, y: 56 },
];

/** Fragmento distal (local, origen en su centro). Encaja con la diáfisis en target (101,50). */
const distalLocal: Vec2[] = [
  { x: -22.5, y: -6 },
  { x: 22, y: -6.5 },
  { x: 25, y: -3 },
  { x: 25, y: 3 },
  { x: 22, y: 6.5 },
  { x: -23.5, y: 6 },
  { x: -22, y: 3 },
  { x: -24, y: 0 },
  { x: -22.5, y: -3 },
];

const shard: FragmentDef = {
  id: 'esquirla',
  label: 'Esquirla',
  polygon: [
    { x: -2.5, y: -1.5 },
    { x: 2.5, y: -1 },
    { x: 1, y: 2 },
    { x: -2, y: 1.5 },
  ],
  start: { pos: { x: 72, y: 59.5 }, angleDeg: 10 },
  target: { pos: { x: 72, y: 59.5 }, angleDeg: 10 },
  noTouch: true,
};

function radiusAnatomy(reduced: boolean): AnatomyDef {
  const distal: FragmentDef = {
    id: 'distal',
    label: 'Fragmento distal',
    polygon: distalLocal,
    start: reduced ? { pos: { x: 101.5, y: 50 }, angleDeg: 0 } : { pos: { x: 109, y: 57 }, angleDeg: 16 },
    target: { pos: { x: 101.5, y: 50 }, angleDeg: 0 },
  };
  return {
    region: 'Radio distal',
    boneStatic: [proximalShaft],
    fragments: reduced ? [distal] : [distal, shard],
    window: WINDOW,
    skinTone: SKIN,
    furColor: FUR,
  };
}

function step<P extends StepParams>(id: string, label: string, params: P): StepDef {
  return { id, label, params };
}

export function reductionScenario(o: { closed?: boolean; mode?: 'reduce' | 'place' } = {}): Scenario {
  const anatomy = radiusAnatomy(false);
  anatomy.closed = o.closed;
  const params: ReductionParams = {
    type: 'reduction',
    fragmentIds: ['distal'],
    avoidIds: ['esquirla'],
    tolMm: 1.5,
    tolDeg: 4,
    kwireSpots: [
      { x: 84, y: 47 },
      { x: 88, y: 53 },
    ],
    carmShots: 3,
    mode: o.mode ?? 'reduce',
    showGhost: true,
  };
  return { type: 'reduction', title: 'Reducción con pinzas Kern', anatomy, def: step('reduccion', 'Reducir la fractura', params), closed: o.closed };
}

export function rotateScenario(): Scenario {
  const pivot = { x: 100, y: 50 };
  // Meseta: casquete a la derecha del corte birradial (radio 12 alrededor del pivote).
  const cut = arcPath({ x: 0, y: 0 }, 12, -62, 62, 12);
  const plateau: Vec2[] = [...cut, { x: 16, y: 13 }, { x: 28, y: 12 }, { x: 34, y: 4 }, { x: 34, y: -6 }, { x: 26, y: -13 }, { x: 14, y: -13 }];
  const anatomy: AnatomyDef = {
    region: 'Tibia proximal',
    boneStatic: [
      [
        { x: 26, y: 45 },
        { x: 88, y: 44 },
        { x: 98, y: 40.5 },
        ...arcPath(pivot, 12, -62, 62, 12),
        { x: 98, y: 59.5 },
        { x: 88, y: 57 },
        { x: 26, y: 56 },
      ],
    ],
    fragments: [
      {
        id: 'meseta',
        label: 'Meseta tibial',
        polygon: plateau,
        start: { pos: pivot, angleDeg: 0 },
        target: { pos: pivot, angleDeg: 23 },
      },
    ],
    window: WINDOW,
    skinTone: SKIN,
    furColor: '#8a8a8a',
  };
  const params: RotateParams = {
    type: 'rotate',
    fragmentId: 'meseta',
    pivot,
    valueLabel: 'Ángulo de meseta tibial',
    startValue: 28,
    targetValue: 5,
    tolValue: 1,
    degPerUnit: 1,
    pinSpot: { x: 104, y: 40 },
  };
  return { type: 'rotate', title: 'Rotación de meseta (TPLO)', anatomy, def: step('rotar', 'Rotar la meseta a 5°', params) };
}

export function sawScenario(): Scenario {
  const anatomy: AnatomyDef = {
    region: 'Fémur proximal',
    boneStatic: [
      [
        { x: 24, y: 45 },
        { x: 92, y: 45 },
        { x: 100, y: 42 },
        { x: 104, y: 58 },
        { x: 94, y: 56 },
        { x: 24, y: 56 },
      ],
    ],
    fragments: [
      {
        id: 'cabeza',
        label: 'Cabeza femoral',
        polygon: [
          { x: -4, y: -9 },
          { x: 4, y: -12 },
          { x: 13, y: -10 },
          { x: 18, y: -3 },
          { x: 17, y: 5 },
          { x: 11, y: 10 },
          { x: 2, y: 10 },
          { x: -0.5, y: 8 },
        ],
        start: { pos: { x: 101, y: 50 }, angleDeg: -4 },
        locked: true,
      },
    ],
    window: WINDOW,
    skinTone: SKIN,
    furColor: '#fdfdfd',
  };
  const params: SawParams = {
    type: 'saw',
    path: [
      { x: 97, y: 39 },
      { x: 101.5, y: 61 },
    ],
    kind: 'oscillating',
    tolMm: 1.5,
    releases: ['cabeza'],
    irrigationRequired: true,
  };
  return { type: 'saw', title: 'Ostectomía con sierra oscilante', anatomy, def: step('sierra', 'Cortar el cuello femoral', params), owner: 'hortensia' };
}

export function burrScenario(): Scenario {
  const cord = rectPoly(80, 57.5, 56, 6);
  const anatomy: AnatomyDef = {
    region: 'Columna T13–L1',
    boneStatic: [
      [
        { x: 44, y: 38 },
        { x: 116, y: 38 },
        { x: 116, y: 54 },
        { x: 44, y: 54 },
      ],
    ],
    fragments: [],
    cord,
    window: WINDOW,
    skinTone: SKIN,
    furColor: '#7a4a2a',
  };
  const params: BurrParams = {
    type: 'burr',
    area: rectPoly(80, 48.5, 30, 7),
    forbidden: cord,
    requiredPct: 0.8,
    layer: 'bone',
    label: 'Fresar la lámina',
    brushMm: 2.2,
    instrument: 'burr',
  };
  return { type: 'burr', title: 'Hemilaminectomía con fresa', anatomy, def: step('fresa', 'Fresar la lámina', params) };
}

export function drillPinsScenario(): Scenario {
  const anatomy: AnatomyDef = {
    region: 'Tibia de conejo',
    boneStatic: [rectPoly(80, 50, 104, 9)],
    fragments: [],
    window: WINDOW,
    skinTone: '#f6d6cf',
    furColor: '#f4f1ea',
  };
  const params: DrillPinsParams = {
    type: 'drillPins',
    spots: [
      { x: 44, y: 50 },
      { x: 58, y: 50 },
      { x: 102, y: 50 },
      { x: 116, y: 50 },
    ],
    tolMm: 1.5,
    item: 'pin',
    cortexProfileMm: [1, 4.5, 1],
    fragile: true,
  };
  return { type: 'drillPins', title: 'Agujas del fijador externo', anatomy, def: step('agujas', 'Insertar agujas', params) };
}

export const DEMO_PLATE_HOLES: Vec2[] = [-17.5, -10.5, -3.5, 3.5, 10.5, 17.5].map((x) => ({ x, y: 0 }));

export function plateScenario(): Scenario {
  const params: PlateParams = {
    type: 'plate',
    options: [
      { id: 'p4', label: 'Miniplaca 2.0 corta', holes: 4, lengthMm: 28 },
      { id: 'p6', label: 'Miniplaca 2.0 bloqueada', holes: 6, lengthMm: 42 },
      { id: 'p8', label: 'Placa 2.4 larga', holes: 8, lengthMm: 58 },
    ],
    correctId: 'p6',
    bendsRequired: 3,
    target: { pos: { x: 79, y: 50 }, angleDeg: 0 },
    tolMm: 2,
    tolDeg: 5,
    holes: DEMO_PLATE_HOLES,
    lengthMm: 42,
    widthMm: 7,
  };
  return { type: 'plate', title: 'Placa bloqueada', anatomy: radiusAnatomy(true), def: step('placa', 'Colocar la placa', params) };
}

export function screwsScenario(): Scenario {
  const params: ScrewsParams = {
    type: 'screws',
    holes: 'plate',
    depthsMm: [7.4, 7.8, 8.2, 8.3, 7.9, 7.2],
    lengthOptionsMm: [6, 8, 10],
    torqueWindow: [0.72, 0.9],
  };
  return { type: 'screws', title: 'Tornillos bloqueados', anatomy: radiusAnatomy(true), def: step('tornillos', 'Colocar tornillos', params), plate: true };
}

export const ALL_SCENARIOS: Array<() => Scenario> = [
  reductionScenario,
  rotateScenario,
  sawScenario,
  burrScenario,
  drillPinsScenario,
  plateScenario,
  screwsScenario,
];
