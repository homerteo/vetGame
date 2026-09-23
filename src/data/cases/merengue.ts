import type { CaseDef, Pose2, Vec2 } from '../../core/contracts';
import { P, splitLongBone, toLocal, type LongBoneSpec } from '../geometry';
import { closurePhase, EDU_DISCLAIMER, hemostasisPhase, incisionPath, incisionPhase, lesionAt, STD_WINDOW } from './common';

/** Caso 2 — Merengue: Legg-Calvé-Perthes, ostectomía de cabeza y cuello femoral (FHO). */

const FEMUR: LongBoneSpec = {
  top: [
    P(36, 46.1),
    P(39.5, 46.5),
    P(43, 45.2),
    P(46, 42.6),
    P(49, 41.4),
    P(52.5, 42),
    P(55.5, 45),
    P(60, 46.6),
    P(80, 47),
    P(100, 46.8),
    P(112, 46.2),
    P(118, 44.8),
    P(123, 43.8),
  ],
  bottom: [
    P(36, 51.6),
    P(40, 52.4),
    P(44, 54.2),
    P(47, 57.4),
    P(50, 56.6),
    P(55, 54),
    P(60, 53.4),
    P(80, 53.2),
    P(100, 53.4),
    P(112, 54),
    P(118, 55.6),
    P(123, 57),
  ],
  // Cabeza femoral algo aplanada arriba (necrosis avascular).
  capLeft: [P(34, 53), P(31.4, 54.4), P(28, 53.6), P(25.8, 51), P(25.4, 47.8), P(26.8, 45), P(29.4, 43.6), P(32.2, 43.6), P(34.4, 44.6)],
  capRight: [P(126.5, 43.6), P(129.8, 45.4), P(131.2, 48.6), P(130.2, 51.4), P(131.6, 54.4), P(129.6, 57.2), P(126.4, 58)],
};

/** Línea de ostectomía: del trocánter mayor al menor, a lo largo del cuello. */
const NECK_CUT: Vec2[] = [P(41.2, 41.2), P(43.8, 49.5), P(46.4, 58.6)];

const [headAbs, femurRest] = splitLongBone(FEMUR, [NECK_CUT]);
const head = toLocal(headAbs);
const HEAD_POSE: Pose2 = { pos: head.origin, angleDeg: 0 };

const INCISION = incisionPath(28, 128, 50, 0.5);

export const MERENGUE: CaseDef = {
  id: 'merengue',
  index: 2,
  week: 2,
  patient: { name: 'Merengue', species: 'dog', animal: 'poodle', breed: 'Caniche toy', weightKg: 3.5, ageText: '9 meses' },
  owner: { name: 'Doña Hortensia', human: 'hortensia' },
  diagnosis: 'Enfermedad de Legg-Calvé-Perthes',
  procedure: 'Ostectomía de cabeza y cuello femoral (FHO)',
  difficulty: 2,
  feeHC: 250,
  requiredReputation: 0,
  newMechanic: 'Sierra oscilante con irrigación (tecla I). El ruido dispara la Histeria de Hortensia. Fritz ya tiembla de verdad.',
  targetTimeSec: 480,
  anatomy: {
    region: 'Cadera y fémur izquierdos, vista craneal',
    boneStatic: [femurRest],
    fragments: [
      {
        id: 'femoralHead',
        label: 'Cabeza y cuello femoral',
        polygon: head.polygon,
        start: HEAD_POSE,
        target: HEAD_POSE,
        locked: true,
        kind: 'bone',
      },
    ],
    window: STD_WINDOW,
    skinTone: '#f7dad6',
    furColor: '#f2eee6',
  },
  phases: [
    incisionPhase({ weight: 15, path: INCISION, pressures: [3, 2, 3], instrument: 'scalpel15', hazards: [P(52, 50.4)] }),
    hemostasisPhase({
      weight: 15,
      bleeders: [
        [52, 44.5, 'venous'],
        [70, 55.5, 'capillary'],
        [100, 45, 'capillary'],
      ],
      targetFieldPct: 40,
      retract: { instrument: 'gelpi', pairs: [[P(60, 41.5), P(60, 58.5)]], ideal: 3, max: 5 },
    }),
    {
      id: 'exposure',
      label: 'Exposición',
      weight: 15,
      steps: [
        {
          id: 'exposure-capsule',
          label: 'Abrir la cápsula y cortar el ligamento redondo',
          params: {
            type: 'clickTargets',
            targets: [
              { pos: P(37, 46.4), label: 'Cápsula articular' },
              { pos: P(28.6, 48.6), label: 'Ligamento redondo' },
            ],
            tolMm: 3,
            ordered: true,
            instrument: 'scalpel15',
            decal: 'scratch',
            label: 'Exponer la cabeza femoral',
          },
        },
      ],
    },
    {
      id: 'ostectomy',
      label: 'Ostectomía',
      weight: 25,
      steps: [
        {
          id: 'ostectomy-neck',
          label: 'Cortar el cuello femoral con irrigación',
          params: { type: 'saw', path: NECK_CUT, kind: 'oscillating', tolMm: 2, releases: ['femoralHead'], irrigationRequired: true },
        },
      ],
    },
    {
      id: 'extraction',
      label: 'Extracción y alisado',
      weight: 15,
      steps: [
        {
          id: 'extraction-head',
          label: 'Sacar la cabeza femoral de la herida',
          params: { type: 'pick', items: [], removeFragmentIds: ['femoralHead'], tool: 'kern', label: 'Extraer la cabeza femoral' },
        },
        {
          id: 'extraction-rasp',
          label: 'Alisar el borde del corte con la raspa',
          params: {
            type: 'burr',
            area: [P(42.7, 45.6), P(45.5, 45.6), P(48.6, 56.2), P(45.8, 56.2)],
            requiredPct: 0.8,
            layer: 'bone',
            label: 'Borde del cuello femoral',
            brushMm: 2,
            instrument: 'rasp',
          },
        },
      ],
    },
    closurePhase({ weight: 15, path: INCISION, layers: ['fascia', 'subcut', 'skin'], spacingMm: 8 }),
  ],
  clinic: {
    complaint: '¡Merengue cojea de la patita de atrás y llora si le toco la cadera! ¡Es lo único que me queda, doctora!',
    tests: ['hipPalpation', 'xray', 'crepitus'],
    keyTest: 'xray',
    xrayLesion: lesionAt(P(30.8, 48.4), 0.07),
    diagnosisOptions: ['Enfermedad de Legg-Calvé-Perthes', 'Luxación patelar medial', 'Displasia de cadera del adulto'],
    correctDiagnosis: 0,
    explanations: {
      absurd:
        'A Merengue se le quedó sin riego la cabeza del fémur, como una maceta olvidada. Se la quitamos y su cuerpo arma una articulación nueva de tejido fibroso. Moño incluido.',
      technical:
        'Necrosis avascular de la cabeza femoral (Legg-Calvé-Perthes). Indicamos ostectomía de cabeza y cuello femoral; se formará una pseudoartrosis fibrosa y la fisioterapia temprana es decisiva.',
      evasive: 'Es cosa de la edad, de la cadera y un poquito de la vida. Confíe en nosotros y tómese esta tila.',
    },
    minorCases: 2,
    ownerTemper: 'hysterical',
  },
  chaos: ['rodrigoSolo', 'fritzTremorSpike', 'hortensiaCall'],
  valerioChallenges: [
    { kind: 'maxOneDomina', text: 'Una sola Orden de Dómina, doctora. Una. La autoridad no se grita.' },
    { kind: 'fieldNeverFlooded', text: 'Campo seco toda la cirugía. Ne quid nimis: ni sangre de más.' },
  ],
  education: {
    title: 'Legg-Calvé-Perthes y ostectomía de cabeza femoral',
    facts: [
      'Es una necrosis avascular de la cabeza femoral en razas pequeñas jóvenes, típicamente antes del año de edad.',
      'Tras retirar la cabeza y el cuello se forma una falsa articulación fibrosa que permite caminar sin dolor.',
      'La fisioterapia temprana (mover la pata pronto y a diario) es lo que más decide el resultado.',
    ],
    disclaimer: EDU_DISCLAIMER,
  },
  flags: {},
  intro: [
    'Semana 2. Doña Hortensia entra con Merengue y un abrigo de piel falsa que ocupa dos sillas.',
    'Doña Hortensia: «¡Merengue es lo único que me queda!»',
    'Fritz: «¿La s-s-sierra oscilante? ¿Hoy? ¿Con ella del otro lado de la puerta?»',
    'Valerio: «La sierra hace ruido, doctora. Los dueños también. Gestione ambos.»',
  ],
  outro: [
    'Merengue despierta con un moño nuevo y sin cabeza femoral. Está feliz y no lo sabe.',
    'Doña Hortensia se desmaya de alivio. Rodrigo la ataja sin soltar la cánula.',
    'Emiliana: «Fisioterapia desde mañana, ¿sí? Paseítos cortos y mucho amor.»',
    'Valerio: «El borde quedó liso. Anotado.»',
  ],
};
