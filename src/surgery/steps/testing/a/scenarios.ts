/* Escenarios de ejemplo (anatomías y definiciones de paso) para pruebas y la página de desarrollo. */
import type { AnatomyDef, StepDef, StepType, Vec2 } from '../../../../core/contracts';
import { rectPoly } from '../../../../core/math';

export const INCISION_PATH: Vec2[] = [
  { x: 30, y: 50 },
  { x: 55, y: 48.5 },
  { x: 80, y: 48 },
  { x: 105, y: 48.5 },
  { x: 130, y: 50 },
];

/** Antebrazo de chihuahua: hueso largo horizontal en la ventana. */
export const LIMB_ANATOMY: AnatomyDef = {
  region: 'Antebrazo',
  boneStatic: [
    [
      { x: 34, y: 46 },
      { x: 60, y: 45.2 },
      { x: 100, y: 45.2 },
      { x: 126, y: 46 },
      { x: 128, y: 50 },
      { x: 126, y: 54 },
      { x: 100, y: 54.8 },
      { x: 60, y: 54.8 },
      { x: 34, y: 54 },
      { x: 32, y: 50 },
    ],
  ],
  fragments: [],
  window: rectPoly(80, 50, 92, 30),
  skinTone: '#f3c9c0',
  furColor: '#c98f52',
};

export const CORD_POLY: Vec2[] = rectPoly(80, 58, 76, 6);

/** Columna de teckel: lámina encima de la médula, con material discal. */
export const SPINE_ANATOMY: AnatomyDef = {
  region: 'Columna T13–L1',
  boneStatic: [rectPoly(56, 43, 30, 9), rectPoly(106, 43, 30, 9)],
  fragments: [
    {
      id: 'lamina',
      label: 'lámina liberada',
      polygon: rectPoly(0, 0, 18, 7),
      start: { pos: { x: 80, y: 42 }, angleDeg: 4 },
      locked: false,
      kind: 'bone',
    },
  ],
  cord: CORD_POLY,
  window: rectPoly(80, 50, 90, 32),
  skinTone: '#e9c2b4',
  furColor: '#7a4a26',
};

export const STEP_DEFS: Record<
  'incision' | 'hemostasis' | 'retract' | 'suture' | 'bandage' | 'clickTargets' | 'pick',
  StepDef
> = {
  incision: {
    id: 'inc',
    label: 'Incisión por capas',
    params: {
      type: 'incision',
      path: INCISION_PATH,
      layers: [
        { layer: 'skin', targetPressure: 2 },
        { layer: 'subcut', targetPressure: 2 },
        { layer: 'fascia', targetPressure: 3 },
      ],
      instrument: 'scalpel10',
      vesselHazards: [
        { x: 62, y: 48.4 },
        { x: 100, y: 48.4 },
      ],
    },
  },
  hemostasis: {
    id: 'hemo',
    label: 'Hemostasia',
    params: {
      type: 'hemostasis',
      bleeders: [
        { pos: { x: 60, y: 47 }, kind: 'capillary' },
        { pos: { x: 78, y: 52 }, kind: 'arterial' },
        { pos: { x: 96, y: 49 }, kind: 'venous' },
        { pos: { x: 110, y: 51 }, kind: 'capillary' },
      ],
      targetFieldPct: 30,
    },
  },
  retract: {
    id: 'ret',
    label: 'Separadores',
    params: {
      type: 'retract',
      instrument: 'gelpi',
      pairs: [
        { a: { x: 66, y: 42 }, b: { x: 66, y: 55 } },
        { a: { x: 96, y: 42 }, b: { x: 96, y: 55 } },
      ],
      idealClicks: 4,
      maxClicks: 6,
    },
  },
  suture: {
    id: 'sut',
    label: 'Sutura por capas',
    params: { type: 'suture', path: INCISION_PATH, layers: ['fascia', 'subcut', 'skin'], spacingMm: 12 },
  },
  bandage: {
    id: 'ban',
    label: 'Vendaje cohesivo',
    params: { type: 'bandage', center: { x: 80, y: 50 }, radiusMm: 22, turns: 3 },
  },
  clickTargets: {
    id: 'kw',
    label: 'Agujas de Kirschner',
    params: {
      type: 'clickTargets',
      targets: [
        { pos: { x: 56, y: 50 }, label: 'Aguja proximal' },
        { pos: { x: 80, y: 50 }, label: 'Aguja central' },
        { pos: { x: 104, y: 50 }, label: 'Aguja distal' },
      ],
      tolMm: 2.5,
      ordered: true,
      instrument: 'kwire',
      decal: 'kwire',
      label: 'Agujas de Kirschner',
    },
  },
  pick: {
    id: 'disc',
    label: 'Extraer material discal',
    params: {
      type: 'pick',
      items: [
        { id: 'd1', pos: { x: 64, y: 51 }, radiusMm: 2.4 },
        { id: 'd2', pos: { x: 75, y: 51.5 }, radiusMm: 2 },
        { id: 'd3', pos: { x: 87, y: 51 }, radiusMm: 2.6 },
        { id: 'd4', pos: { x: 97, y: 51.5 }, radiusMm: 2.1 },
      ],
      removeFragmentIds: ['lamina'],
      forbidden: CORD_POLY,
      tool: 'forceps',
      label: 'Material discal',
    },
  },
};

/** Anatomía adecuada para cada tipo de paso de ejemplo. */
export function anatomyFor(type: StepType): AnatomyDef {
  return type === 'pick' ? SPINE_ANATOMY : LIMB_ANATOMY;
}
