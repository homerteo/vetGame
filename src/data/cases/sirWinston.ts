import type { CaseDef, Pose2, Vec2 } from '../../core/contracts';
import { carveTop, displacedPose, P, toLocal, worldPoint, type LongBoneSpec } from '../geometry';
import { closurePhase, EDU_DISCLAIMER, hemostasisPhase, incisionPath, incisionPhase, lesionAt, STD_WINDOW } from './common';

/**
 * Caso 3 — Sir Winston: luxación patelar medial grado III.
 * Vista craneolateral oblicua de la rodilla: fémur distal a la izquierda, tibia proximal a la derecha.
 * En esta proyección "más profundo" y "más lateral" quedan hacia abajo (y+).
 */

const FEMUR: LongBoneSpec = {
  top: [P(30, 43.5), P(45, 44), P(56, 42.8), P(66, 41.8), P(74, 42.2), P(78, 43.5)],
  bottom: [P(30, 56.5), P(45, 56), P(56, 57.5), P(66, 59.5), P(74, 60), P(78, 59)],
  capLeft: [P(27, 54), P(26.2, 50), P(27, 46)],
  // Cóndilos hacia la articulación.
  capRight: [P(80.5, 45), P(81.8, 49), P(80.8, 52.5), P(82, 56), P(80.5, 58.8)],
};

const TIBIA: LongBoneSpec = {
  top: [P(86, 43.5), P(90, 41.5), P(95, 41), P(100, 42.8), P(106, 45), P(115, 45.8), P(130, 46)],
  bottom: [P(86, 59), P(92, 58.5), P(100, 56.5), P(110, 55), P(120, 54.5), P(130, 54.3)],
  // Meseta tibial frente a los cóndilos.
  capLeft: [P(84, 58), P(83.5, 54), P(84.5, 51), P(83.5, 47.5), P(84.5, 44.5)],
  capRight: [P(133, 47.8), P(133.8, 50.2), P(133, 52.6)],
};

const trochlea = carveTop(FEMUR, [P(56.5, 48.4), P(66.5, 48.1), P(77, 48.4)]);
const tuberosity = carveTop(TIBIA, [P(87.5, 46.6), P(96, 46.9), P(104.5, 47.8)]);

const block = toLocal(trochlea.block);
const BLOCK_START: Pose2 = { pos: block.origin, angleDeg: 0 };
/** El bloque vuelve a su lecho 2,4 mm más hondo. */
const BLOCK_TARGET = displacedPose(BLOCK_START, 0, 2.4, 0);

const tub = toLocal(tuberosity.block);
const TUB_START: Pose2 = { pos: tub.origin, angleDeg: 0 };
/** Transposición lateral (hacia abajo en esta proyección) y leve giro. */
const TUB_TARGET = displacedPose(TUB_START, 1.2, 3.4, -3);
const TUB_PINS: Vec2[] = [worldPoint(P(-4, 0.2), TUB_TARGET), worldPoint(P(3.5, 0.4), TUB_TARGET)];

const MEDIAL_CUT: Vec2[] = [P(55.8, 48.5), P(66.5, 48.2), P(77.6, 48.5)];
const LATERAL_CUT: Vec2[] = [P(55.8, 49.2), P(66.5, 48.9), P(77.6, 49.2)];
const TUB_CUT: Vec2[] = [P(87, 46.7), P(96, 47), P(105, 47.9)];

const INCISION = incisionPath(28, 132, 50, 0.8);

export const SIR_WINSTON: CaseDef = {
  id: 'sir-winston',
  index: 3,
  week: 3,
  patient: { name: 'Sir Winston', species: 'dog', animal: 'bulldog', breed: 'Bulldog inglés', weightKg: 24, ageText: '2 años' },
  owner: { name: 'Lord Pardo', human: 'ownerB' },
  diagnosis: 'Luxación patelar medial grado III',
  procedure: 'Recesión troclear en bloque + transposición de la tuberosidad tibial',
  difficulty: 3,
  feeHC: 400,
  requiredReputation: 1,
  newMechanic: 'Tallar el bloque troclear, encajarlo más hondo y transponer la tuberosidad. Selfies de Gigi al máximo.',
  targetTimeSec: 600,
  anatomy: {
    region: 'Rodilla izquierda, vista craneolateral',
    boneStatic: [trochlea.bone, tuberosity.bone],
    fragments: [
      {
        id: 'trochlearBlock',
        label: 'Bloque osteocondral troclear',
        polygon: block.polygon,
        start: BLOCK_START,
        target: BLOCK_TARGET,
        locked: true,
        kind: 'block',
      },
      {
        id: 'tibialTuberosity',
        label: 'Tuberosidad tibial',
        polygon: tub.polygon,
        start: TUB_START,
        target: TUB_TARGET,
        locked: true,
        kind: 'bone',
      },
    ],
    window: STD_WINDOW,
    skinTone: '#f1c6b6',
    furColor: '#e6cfae',
  },
  phases: [
    incisionPhase({ weight: 12, path: INCISION, pressures: [4, 2, 4], instrument: 'scalpel10', hazards: [P(86, 49.7)] }),
    hemostasisPhase({
      weight: 13,
      bleeders: [
        [48, 45, 'venous'],
        [62, 56, 'capillary'],
        [92, 55.5, 'arterial'],
        [118, 45, 'capillary'],
      ],
      targetFieldPct: 40,
      retract: { instrument: 'gelpi', pairs: [[P(82, 40.5), P(82, 59.5)]], ideal: 3, max: 5 },
    }),
    {
      id: 'trochlea',
      label: 'Recesión troclear',
      weight: 25,
      steps: [
        {
          id: 'trochlea-medial',
          label: 'Corte medial de la cuña',
          params: { type: 'saw', path: MEDIAL_CUT, kind: 'fine', tolMm: 1.2, irrigationRequired: true },
        },
        {
          id: 'trochlea-lateral',
          label: 'Corte lateral: liberar el bloque',
          params: { type: 'saw', path: LATERAL_CUT, kind: 'fine', tolMm: 1.2, releases: ['trochlearBlock'], irrigationRequired: true },
        },
        {
          id: 'trochlea-deepen',
          label: 'Profundizar el lecho del surco',
          params: {
            type: 'burr',
            area: [P(57, 48.6), P(66.5, 48.3), P(76.5, 48.6), P(76.5, 51.2), P(66.5, 51.4), P(57, 51.2)],
            requiredPct: 0.8,
            layer: 'bone',
            label: 'Lecho del surco troclear',
            brushMm: 2,
            instrument: 'burr',
          },
        },
        {
          id: 'trochlea-seat',
          label: 'Encajar el bloque más hondo',
          params: { type: 'reduction', fragmentIds: ['trochlearBlock'], tolMm: 1.5, tolDeg: 6, carmShots: 1, mode: 'place', showGhost: true },
        },
      ],
    },
    {
      id: 'tuberosity',
      label: 'Transposición tibial',
      weight: 25,
      steps: [
        {
          id: 'tuberosity-cut',
          label: 'Osteotomía de la tuberosidad tibial',
          params: { type: 'saw', path: TUB_CUT, kind: 'fine', tolMm: 1.2, releases: ['tibialTuberosity'], irrigationRequired: true },
        },
        {
          id: 'tuberosity-move',
          label: 'Llevar la tuberosidad a lateral',
          params: { type: 'reduction', fragmentIds: ['tibialTuberosity'], tolMm: 1.5, tolDeg: 6, carmShots: 1, mode: 'place', showGhost: true },
        },
        {
          id: 'tuberosity-pins',
          label: 'Fijar con dos agujas de Kirschner',
          params: { type: 'drillPins', spots: TUB_PINS, tolMm: 1.5, item: 'kwire', cortexProfileMm: [2.5, 12, 2.5] },
        },
      ],
    },
    {
      id: 'tensionBand',
      label: 'Banda de tensión',
      weight: 10,
      steps: [
        {
          id: 'tension-wire',
          label: 'Alambre en ocho: agujas y orificio distal',
          params: {
            type: 'clickTargets',
            targets: [
              { pos: worldPoint(P(0, -0.8), TUB_TARGET), label: 'Lazo sobre las agujas' },
              { pos: P(114, 50.2), label: 'Orificio transverso' },
            ],
            tolMm: 2.5,
            ordered: true,
            instrument: 'needleHolder',
            decal: 'wire',
            label: 'Banda de tensión',
          },
        },
      ],
    },
    closurePhase({ weight: 15, path: INCISION, layers: ['fascia', 'subcut', 'skin'], spacingMm: 9 }),
  ],
  clinic: {
    complaint: 'Sir Winston camina a saltitos, como si bailara un vals mal. En Inglaterra esto no pasaba.',
    tests: ['patella', 'drawer', 'xray'],
    keyTest: 'patella',
    xrayLesion: lesionAt(P(80, 47), 0.09),
    diagnosisOptions: ['Luxación patelar medial grado III', 'Rotura del ligamento cruzado craneal', 'Displasia de codo'],
    correctDiagnosis: 0,
    explanations: {
      absurd:
        'La rótula de Sir Winston se sale del riel como un tren de juguete. Vamos a hacer el riel más hondo y a mover la estación para que el tren vaya derechito.',
      technical:
        'Luxación patelar medial grado III. Trocleoplastia de recesión en bloque y transposición lateral de la tuberosidad tibial para realinear el mecanismo extensor del cuádriceps.',
      evasive: 'Es una cuestión de rótula y de actitud. La rótula se la arreglamos nosotros; la actitud, Sir Winston.',
    },
    minorCases: 2,
    ownerTemper: 'stern',
  },
  chaos: ['rodrigoSolo', 'fritzTremorSpike', 'hortensiaCall', 'gigiSelfie'],
  valerioChallenges: [
    { kind: 'noArrest', text: 'Sin paros, doctora. Los braquicéfalos no perdonan, y yo tampoco.' },
    { kind: 'maxOneDomina', text: 'Una Orden de Dómina como máximo. Festina lente: apresúrese despacio.' },
  ],
  education: {
    title: 'Luxación patelar medial',
    facts: [
      'La luxación patelar se gradúa de I a IV según lo fácil que se sale la rótula y si vuelve sola a su sitio.',
      'La recesión troclear profundiza el surco del fémur por donde se desliza la rótula.',
      'La transposición de la tuberosidad tibial realinea el mecanismo extensor del cuádriceps.',
    ],
    disclaimer: EDU_DISCLAIMER,
  },
  flags: { gigiSelfieBoost: true },
  intro: [
    'Semana 3. Lord Pardo llega en traje de tweed con un bulldog que camina como si bailara un vals mal.',
    'Lord Pardo: «Sir Winston tiene pedigrí. Su rótula, por lo visto, no.»',
    'Gigi: «¡Hoy toca bulldog, mis huesitos! Esto va a ser viral sí o sí.»',
    'Valerio: «Braquicéfalo, doctora. Vigile la vía aérea y el orgullo. En ese orden.»',
  ],
  outro: [
    'Sir Winston despierta, ronca como un tractor y camina derecho por primera vez en años.',
    'Lord Pardo: «Aceptable. Muy aceptable.» Viniendo de él, es un abrazo.',
    'Gigi publica el clip del bloque troclear. Doce mil corazones en una hora.',
    'Valerio: «El bloque encajó. Usted empieza a encajar también.»',
  ],
};
