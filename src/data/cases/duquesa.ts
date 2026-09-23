import type { CaseDef, FragmentDef, PlateParams, Pose2, Vec2 } from '../../core/contracts';
import { displacedPose, fractureLine, P, splitLongBone, toLocal, worldPoint, type LongBoneSpec } from '../geometry';
import { closurePhase, EDU_DISCLAIMER, hemostasisPhase, incisionPath, incisionPhase, lesionAt, STD_WINDOW } from './common';

/** Caso 1 — Duquesa: fractura conminuta de fémur (gato paracaidista). Vista lateral, proximal a la izquierda. */

const FEMUR: LongBoneSpec = {
  top: [P(38, 44.5), P(44, 45.5), P(52, 46.2), P(70, 46.3), P(90, 46.2), P(108, 46), P(116, 45), P(122, 43.5)],
  bottom: [P(38, 56), P(44, 55), P(52, 53.8), P(70, 53.7), P(90, 53.8), P(108, 54), P(116, 55.5), P(122, 57.5)],
  // Trocánter menor, cuello, cabeza femoral redonda y trocánter mayor.
  capLeft: [
    P(34, 56.6),
    P(31.2, 55),
    P(29.8, 52.6),
    P(27.2, 52.3),
    P(24.5, 50.5),
    P(23.9, 47.7),
    P(25.3, 45.1),
    P(28, 44),
    P(31, 43.7),
    P(33, 41.8),
    P(35.8, 41.6),
    P(37.6, 42.8),
  ],
  // Cóndilos femorales (dos lóbulos con la escotadura).
  capRight: [P(126, 43.2), P(129.5, 45), P(131, 48.5), P(130, 51.5), P(131.5, 54.5), P(129.5, 57.4), P(126, 58.4)],
};

const [femurProx, , femurDist] = splitLongBone(FEMUR, [
  fractureLine(66.5, 43.5, 56.5, 7, 1.3, 21, 0.1),
  fractureLine(90, 43.5, 56.5, 7, 1.3, 22, -0.1),
]);

const distal = toLocal(femurDist);
const DISTAL_TARGET: Pose2 = { pos: distal.origin, angleDeg: 0 };

/** Esquirlas de la zona conminuta: no se tocan. */
const SPLINTERS: Array<{ id: string; pos: Vec2; angle: number; poly: Vec2[] }> = [
  { id: 'splinter1', pos: P(72.5, 47.8), angle: 8, poly: [P(-3.2, -0.9), P(1.2, -1.5), P(3.4, -0.4), P(2.2, 1.1), P(-2.6, 1.2)] },
  { id: 'splinter2', pos: P(78.5, 52.2), angle: -6, poly: [P(-3.6, -0.6), P(-0.5, -1.4), P(3.2, -1), P(2.8, 0.9), P(-1.8, 1.4)] },
  { id: 'splinter3', pos: P(84.5, 48.3), angle: 12, poly: [P(-2.6, -1.3), P(2.9, -1.1), P(3.3, 0.5), P(0.4, 1.5), P(-3, 0.6)] },
];

const FRAGMENTS: FragmentDef[] = [
  {
    id: 'distalFemur',
    label: 'Segmento distal del fémur',
    polygon: distal.polygon,
    target: DISTAL_TARGET,
    // Cabalgamiento típico: los músculos tiran del segmento distal hacia proximal.
    start: displacedPose(DISTAL_TARGET, -4, 3.5, -9),
    kind: 'bone',
  },
  ...SPLINTERS.map<FragmentDef>((s, i) => ({
    id: s.id,
    label: `Esquirla ${i + 1} (no tocar)`,
    polygon: s.poly,
    start: { pos: s.pos, angleDeg: s.angle },
    target: { pos: s.pos, angleDeg: s.angle },
    noTouch: true,
    kind: 'bone',
  })),
];

const PLATE: PlateParams = {
  type: 'plate',
  options: [
    { id: 'bridge8', label: 'Placa de puente 2,0 mm · 8 agujeros', holes: 8, lengthMm: 76 },
    { id: 'lcp4', label: 'Placa bloqueada 2,0 mm · 4 agujeros', holes: 4, lengthMm: 36 },
    { id: 'lcp12', label: 'Placa bloqueada 2,0 mm · 12 agujeros', holes: 12, lengthMm: 112 },
  ],
  correctId: 'bridge8',
  bendsRequired: 1,
  target: { pos: P(78.5, 50), angleDeg: 0 },
  tolMm: 2.5,
  tolDeg: 6,
  holes: [-31.5, -22.5, -13.5, -4.5, 4.5, 13.5, 22.5, 31.5].map((x) => P(x, 0)),
  lengthMm: 76,
  widthMm: 7,
};

/** Puente: solo los 2 agujeros más proximales y los 2 más distales llevan tornillo. */
const SCREW_HOLES = [0, 1, 6, 7].map((i) => worldPoint(PLATE.holes[i], PLATE.target));

const INCISION = incisionPath(32, 128, 50, 0.7);

export const DUQUESA: CaseDef = {
  id: 'duquesa',
  index: 1,
  week: 1,
  patient: { name: 'Duquesa', species: 'cat', animal: 'cat', breed: 'Gata común europea', weightKg: 4, ageText: '5 años' },
  owner: { name: 'Marisol, vecina de Gigi', human: 'ownerA' },
  diagnosis: 'Síndrome del gato paracaidista: fractura conminuta de fémur',
  procedure: 'Placa-clavo en puente (osteosíntesis biológica)',
  difficulty: 2,
  feeHC: 250,
  requiredReputation: 0,
  newMechanic: 'Abrir pero no tocar: tocar esquirlas penaliza. Radiografía de tórax obligatoria. Debuta el Solo de Guitarra.',
  targetTimeSec: 540,
  anatomy: {
    region: 'Fémur derecho, vista lateral',
    boneStatic: [femurProx],
    fragments: FRAGMENTS,
    window: STD_WINDOW,
    skinTone: '#f3cfc9',
    furColor: '#8c8f99',
  },
  phases: [
    incisionPhase({ weight: 15, path: INCISION, pressures: [3, 2, 3], instrument: 'scalpel15', hazards: [P(60, 49.5)] }),
    hemostasisPhase({
      weight: 15,
      bleeders: [
        [58, 44.5, 'arterial'],
        [44, 56, 'venous'],
        [97, 56, 'venous'],
        [112, 44.8, 'capillary'],
      ],
      targetFieldPct: 40,
      retract: { instrument: 'weitlaner', pairs: [[P(78, 41), P(78, 59)]], ideal: 3, max: 5 },
    }),
    {
      id: 'bioReduction',
      label: 'Reducción biológica',
      weight: 20,
      steps: [
        {
          id: 'bio-rod',
          label: 'Introducir el clavo desde la fosa trocantérica',
          params: { type: 'drillPins', spots: [P(35.5, 45)], tolMm: 2, item: 'rod', cortexProfileMm: [1.5, 20, 1.5] },
        },
        {
          id: 'bio-align',
          label: 'Alinear el segmento distal sin tocar las esquirlas',
          params: {
            type: 'reduction',
            fragmentIds: ['distalFemur'],
            avoidIds: SPLINTERS.map((s) => s.id),
            tolMm: 3,
            tolDeg: 8,
            carmShots: 2,
            mode: 'reduce',
            showGhost: true,
          },
        },
      ],
    },
    {
      id: 'bridgePlate',
      label: 'Placa en puente',
      weight: 20,
      steps: [{ id: 'bridge-plate', label: 'Placa larga que salta la zona conminuta', params: PLATE }],
    },
    {
      id: 'screws',
      label: 'Tornillos',
      weight: 15,
      steps: [
        {
          id: 'screws-ends',
          label: 'Dos tornillos arriba, dos abajo, nada en medio',
          params: {
            type: 'screws',
            holes: SCREW_HOLES,
            depthsMm: [8.6, 9.4, 10.4, 11],
            lengthOptionsMm: [8, 10, 12],
            torqueWindow: [0.72, 0.9],
          },
        },
      ],
    },
    closurePhase({ weight: 15, path: INCISION, layers: ['fascia', 'subcut', 'skin'], spacingMm: 8 }),
  ],
  clinic: {
    complaint: 'Se tiró del sexto piso persiguiendo una paloma. Cayó de pie, como en las películas, pero ya no se para.',
    tests: ['thoracicXray', 'xray', 'crepitus'],
    keyTest: 'xray',
    requiredTests: ['thoracicXray'],
    xrayLesion: lesionAt(P(78, 50), 0.09),
    diagnosisOptions: [
      'Fractura conminuta de fémur (gato paracaidista)',
      'Luxación de cadera',
      'Contusión muscular sin fractura',
    ],
    correctDiagnosis: 0,
    explanations: {
      absurd:
        'Duquesa aterrizó como superheroína, pero su fémur hizo confeti. No armaremos el rompecabezas: le ponemos un puente de metal encima y su cuerpo pega las piezas solito. Antes, revisamos los pulmones.',
      technical:
        'Fractura diafisaria conminuta de fémur por caída desde altura. Tras descartar neumotórax y contusión pulmonar, osteosíntesis biológica con placa-clavo en puente, sin manipular los fragmentos.',
      evasive: 'Los gatos siempre caen de pie, ¿no? Pues esta cayó de pie... y de fémur. Nosotros nos encargamos.',
    },
    minorCases: 2,
    ownerTemper: 'anxious',
  },
  chaos: ['rodrigoSolo'],
  valerioChallenges: [
    { kind: 'noExtraCarm', text: 'No dispare el arco en C más de lo planeado. La radiación no es un filtro de Instagram.' },
    { kind: 'fieldNeverFlooded', text: 'Que el campo no se inunde, doctora. Esto es un quirófano, no un acuario.' },
  ],
  education: {
    title: 'Gato paracaidista y osteosíntesis biológica',
    facts: [
      'En caídas desde altura, primero se descarta trauma torácico: neumotórax y contusión pulmonar.',
      'La osteosíntesis biológica no manipula los fragmentos: respeta su irrigación y el hematoma que ayuda a consolidar.',
      'En la técnica placa-clavo, el clavo intramedular ocupa aproximadamente el 30–40% del canal medular.',
    ],
    disclaimer: EDU_DISCLAIMER,
  },
  flags: {},
  intro: [
    'Semana 1. Marisol, la vecina de Gigi, llega con una gata muy digna y muy rota.',
    'Marisol: «Duquesa se tiró del sexto piso por una paloma. La paloma está perfecta.»',
    'Gigi: «¡Es mi vecina! Clínica Arcoíris: aquí hasta los gatos caen con estilo.»',
    'Valerio: «Primero el tórax, doctora. Después el fémur. El orden no es opcional.»',
    'Regla del día: abrir pero no tocar. Las esquirlas se quedan donde están.',
  ],
  outro: [
    'Duquesa despierta, mira a todos con desprecio y exige su almohadón. Señal de buena salud.',
    'Marisol: «¿Puede volver al balcón?» Emiliana: «Con malla. Mucha malla.»',
    'Rodrigo: «Ese solo de guitarra fue para Duquesa. Ella lo sabe.»',
    'Valerio: «Biológica, dice usted. Lo sabremos cuando consolide.»',
  ],
};
