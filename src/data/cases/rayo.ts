import type { CaseDef, FragmentDef, PlateParams, Vec2 } from '../../core/contracts';
import { longBone, P, superEllipse, toLocal, wobble, worldPoint, type LongBoneSpec } from '../geometry';
import { closurePhase, EDU_DISCLAIMER, hemostasisPhase, incisionPath, incisionPhase, lesionAt, STD_WINDOW } from './common';

/**
 * Caso 7 (final) — Rayo: hiperextensión del carpo, artrodesis pancarpiana.
 * Vista dorsal: radio y cúbito a la izquierda, huesos del carpo al centro, metacarpianos a la derecha.
 */

const RADIUS: LongBoneSpec = {
  top: [P(27, 45.5), P(38, 45.2), P(48, 43.8), P(55, 42.3)],
  bottom: [P(27, 54), P(38, 54.2), P(48, 55.5), P(55, 56.5)],
  capLeft: [P(25.2, 53), P(24.4, 49.8), P(25.2, 46.5)],
  capRight: [P(56.8, 43.3), P(57.5, 46.5), P(56.9, 49.8), P(57.5, 53), P(56.8, 56)],
};

const ULNA: LongBoneSpec = {
  top: [P(26, 57.4), P(45, 57.6), P(54, 58.3)],
  bottom: [P(26, 60.8), P(45, 60.6), P(54, 62)],
  capLeft: [P(24.8, 60.2), P(24.6, 58)],
  capRight: [P(56.4, 58.8), P(57.2, 60.4), P(55.8, 62.4)],
};

/** Metacarpiano con base proximal ancha y cabeza distal redonda. */
function metacarpal(yTop: number, yBot: number, xEnd: number, drift: number): Vec2[] {
  const mid = (yTop + yBot) / 2;
  return longBone({
    top: [P(81.5, yTop), P(95, yTop + 0.6), P(110, yTop + 0.5 + drift * 0.5), P(xEnd - 3, yTop + 0.3 + drift)],
    bottom: [P(81.5, yBot), P(95, yBot - 0.6), P(110, yBot - 0.6 + drift * 0.5), P(xEnd - 3, yBot - 0.2 + drift)],
    capLeft: [P(80.4, yBot - 0.8), P(80.2, yTop + 0.8)],
    capRight: [P(xEnd - 1, yTop + 0.4 + drift), P(xEnd, mid + drift), P(xEnd - 1, yBot - 0.4 + drift)],
  });
}

const CARPALS: Vec2[][] = [
  wobble(superEllipse(63.8, 48.6, 4.9, 6.4, 3.2, 0, 24), 0.2, 71), // hueso radiocarpiano
  wobble(superEllipse(63.4, 58.6, 4.1, 3.4, 3, 0, 20), 0.15, 72), // cubitocarpiano
  wobble(superEllipse(74.8, 44, 3.6, 2.3, 3, 0, 18), 0.12, 73), // carpiano II
  wobble(superEllipse(74.8, 49.4, 3.6, 2.8, 3, 0, 18), 0.12, 74), // carpiano III
  wobble(superEllipse(74.8, 55.6, 3.6, 3.2, 3, 0, 18), 0.12, 75), // carpiano IV
];

const METACARPALS: Vec2[][] = [
  metacarpal(42.6, 45.8, 122.2, -0.8),
  metacarpal(46.8, 51.2, 131.2, -0.2),
  metacarpal(51.9, 56.2, 131.2, 0.4),
  metacarpal(57, 60.4, 122, 1.2),
];

/** Líneas articulares: antebraquiocarpiana, mediocarpiana y carpometacarpiana. */
const JOINT_X = [58.2, 69.9, 79.3];

/** Área de desbridamiento en forma de peine: una banda por articulación unidas por arriba. */
const DEBRIDE_AREA: Vec2[] = [
  P(55.7, 42.4),
  P(81.8, 42.4),
  P(81.8, 58.2),
  P(76.8, 58.2),
  P(76.8, 44.6),
  P(72.4, 44.6),
  P(72.4, 58.2),
  P(67.4, 58.2),
  P(67.4, 44.6),
  P(60.7, 44.6),
  P(60.7, 58.2),
  P(55.7, 58.2),
];

/** Injerto esponjoso del húmero, esperando sobre una gasa en la esquina de la ventana. */
const GRAFT_START = [P(32.5, 40.8), P(38, 39.8), P(43.5, 41)];
const GRAFT_TARGET = [P(JOINT_X[0], 47.2), P(JOINT_X[1], 49.5), P(JOINT_X[2], 53.4)];
const GRAFTS: FragmentDef[] = GRAFT_START.map((s, i) => {
  const shape = toLocal(wobble(superEllipse(0, 0, 1.9, 1.35, 2.4, 0, 14), 0.25, 80 + i));
  return {
    id: `graft${i + 1}`,
    label: `Injerto esponjoso ${i + 1}`,
    polygon: shape.polygon,
    start: { pos: s, angleDeg: 15 * i - 10 },
    target: { pos: GRAFT_TARGET[i], angleDeg: 90 },
    kind: 'graft',
  };
});

const PLATE_CENTER = P(77, 49.2);
const PLATE: PlateParams = {
  type: 'plate',
  options: [
    { id: 'hybrid9', label: 'Placa híbrida pancarpiana 3,5/2,7 mm · 9 agujeros', holes: 9, lengthMm: 96 },
    { id: 'lcp7', label: 'Placa bloqueada 3,5 mm · 7 agujeros', holes: 7, lengthMm: 78 },
    { id: 'hybrid11', label: 'Placa híbrida 3,5/2,7 mm · 11 agujeros', holes: 11, lengthMm: 118 },
  ],
  correctId: 'hybrid9',
  bendsRequired: 3,
  target: { pos: PLATE_CENTER, angleDeg: 0 },
  tolMm: 2.5,
  tolDeg: 5,
  // 3 en el radio (3,5 mm), 1 en el radiocarpiano, 5 en el metacarpiano III (2,7 mm).
  holes: [33, 40.5, 48, 63.8, 88, 96, 104, 112, 120].map((x) => P(Math.round((x - PLATE_CENTER.x) * 10) / 10, 0)),
  lengthMm: 96,
  widthMm: 8,
  hybrid: true,
};

const SCREW_HOLES = [0, 1, 2, 6, 7, 8].map((i) => worldPoint(PLATE.holes[i], PLATE.target));

const INCISION = incisionPath(28, 132, 50, 0.5);

export const RAYO: CaseDef = {
  id: 'rayo',
  index: 7,
  week: 7,
  patient: { name: 'Rayo', species: 'dog', animal: 'bordercollie', breed: 'Border collie', weightKg: 19, ageText: '6 años' },
  owner: { name: 'Dr. Valerio Sterling', human: 'valerio' },
  diagnosis: 'Hiperextensión del carpo por rotura del fibrocartílago palmar',
  procedure: 'Artrodesis pancarpiana con placa dorsal híbrida e injerto esponjoso',
  difficulty: 5,
  feeHC: 900,
  requiredReputation: 3,
  newMechanic: 'Sin guías y con Valerio en la sala. Injerto del húmero y doble campo. Todo el caos a la vez.',
  targetTimeSec: 780,
  anatomy: {
    region: 'Carpo izquierdo, vista dorsal',
    boneStatic: [longBone(RADIUS), longBone(ULNA), ...CARPALS, ...METACARPALS],
    fragments: GRAFTS,
    window: STD_WINDOW,
    skinTone: '#f0c5b7',
    furColor: '#1f1d24',
  },
  phases: [
    incisionPhase({ weight: 12, path: INCISION, pressures: [3, 2, 4], instrument: 'scalpel10', hazards: [P(70, 49.6)] }),
    hemostasisPhase({
      weight: 13,
      bleeders: [
        [40, 44.5, 'venous'],
        [70, 56.5, 'arterial'],
        [98, 44.2, 'capillary'],
        [112, 56.2, 'venous'],
      ],
      targetFieldPct: 40,
      retract: { instrument: 'weitlaner', pairs: [[P(70, 40.8), P(70, 59.2)]], ideal: 3, max: 5 },
    }),
    {
      id: 'debridement',
      label: 'Desbridamiento',
      weight: 20,
      steps: [
        {
          id: 'debride-cartilage',
          label: 'Fresar el cartílago de las tres articulaciones',
          params: {
            type: 'burr',
            area: DEBRIDE_AREA,
            requiredPct: 0.85,
            layer: 'bone',
            label: 'Cartílago articular del carpo',
            brushMm: 2.5,
            instrument: 'burr',
          },
        },
      ],
    },
    {
      id: 'graft',
      label: 'Injerto',
      weight: 15,
      steps: [
        {
          id: 'graft-pack',
          label: 'Rellenar cada articulación con injerto',
          params: {
            type: 'reduction',
            fragmentIds: GRAFTS.map((g) => g.id),
            tolMm: 3,
            tolDeg: 15,
            carmShots: 1,
            mode: 'place',
            showGhost: true,
          },
        },
      ],
    },
    {
      id: 'hybridPlate',
      label: 'Placa híbrida',
      weight: 15,
      steps: [{ id: 'hybrid-plate', label: 'Contornear en ligera extensión y apoyar', params: PLATE }],
    },
    {
      id: 'screws',
      label: 'Tornillos',
      weight: 12,
      steps: [
        {
          id: 'screws-hybrid',
          label: 'Tres en el radio, tres en el metacarpiano',
          params: {
            type: 'screws',
            holes: SCREW_HOLES,
            depthsMm: [15.5, 16, 16.5, 9, 8.6, 8.2],
            lengthOptionsMm: [10, 14, 18],
            torqueWindow: [0.74, 0.88],
          },
        },
      ],
    },
    closurePhase({
      weight: 13,
      path: INCISION,
      layers: ['subcut', 'skin'],
      spacingMm: 8,
      bandage: { center: P(80, 50), radiusMm: 26, turns: 3 },
    }),
  ],
  clinic: {
    complaint: 'Rayo cayó mal en un salto de agility. El carpo se le hunde al apoyar. Ahórrese los adjetivos y examínelo.',
    tests: ['carpusStress', 'xray', 'crepitus'],
    keyTest: 'carpusStress',
    xrayLesion: lesionAt(P(69, 50), 0.1),
    diagnosisOptions: [
      'Hiperextensión del carpo (fibrocartílago palmar roto)',
      'Fractura distal de radio',
      'Poliartritis inmunomediada',
    ],
    correctDiagnosis: 0,
    explanations: {
      absurd:
        'El carpo de Rayo es una bisagra con una correa por detrás, y la correa se rompió. No se cose: soldamos la bisagra con una placa y relleno de hueso de su húmero. Adiós agility de élite, hola paseos gloriosos.',
      technical:
        'Hiperextensión carpiana por rotura del fibrocartílago palmar. Artrodesis pancarpiana con placa dorsal híbrida e injerto esponjoso del húmero proximal, fijando en ~10–12° de extensión.',
      evasive: 'Es un problemita en la muñeca, nada que... Usted ya lo sabe, doctor. Perdón. Sí, es serio.',
    },
    minorCases: 3,
    ownerTemper: 'stern',
  },
  chaos: ['rodrigoSolo', 'gigiSelfie', 'fritzTremorSpike', 'panchitoIntrusion', 'valerioGaze', 'braulioFoil', 'hortensiaCall'],
  valerioChallenges: [
    { kind: 'maxOneDomina', text: 'Mi perro, su quirófano. Pero no más de una Orden de Dómina, doctora.' },
    { kind: 'noScrewDrops', text: 'Ni un tornillo al suelo. Es mi perro, doctora. Mi perro.' },
  ],
  education: {
    title: 'Hiperextensión del carpo y artrodesis pancarpiana',
    facts: [
      'El fibrocartílago palmar sostiene el carpo; si se rompe, la articulación se hunde al apoyar.',
      'La artrodesis pancarpiana fusiona el carpo en ligera extensión, alrededor de 10–12°.',
      'El injerto de hueso esponjoso (por ejemplo, del húmero proximal) acelera la fusión.',
      'Después, el perro camina y corre bien, pero suele retirarse del agility de alto nivel.',
    ],
    disclaimer: EDU_DISCLAIMER,
  },
  flags: { final: true, noGuides: true, valerioInRoom: true },
  intro: [
    'Semana 7. Valerio entra con un border collie y sin carpeta. Nunca viene sin carpeta.',
    'Valerio: «Se llama Rayo. Es mi perro. Opere usted, doctora.»',
    'Rodrigo: «Jefa... el jefe tiene perro. Y sentimientos.»',
    'Gigi: «Mis huesitos, hoy no grabo. Bueno, grabo un poquito.»',
    'Emiliana respira hondo. Sin guías, sin excusas y con toda la dulzura del mundo.',
  ],
  outro: [
    'Rayo despierta y le lame la mano a Valerio. Valerio finge que no pasó nada.',
    'Valerio: «Buen trabajo, doctora.»',
    'Fritz suelta una lagrimita. Rodrigo toca un acorde suavecito. Gigi, por una vez, no graba.',
    'El reloj de Emiliana vibra. No hace falta leerlo para saber lo que dice.',
  ],
};
