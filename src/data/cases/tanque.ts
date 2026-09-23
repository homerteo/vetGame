import type { CaseDef, PlateParams, Pose2 } from '../../core/contracts';
import { arcPath } from '../../core/math';
import { P, rotatePoseAround, splitLongBone, toLocal, type LongBoneSpec } from '../geometry';
import { closurePhase, EDU_DISCLAIMER, hemostasisPhase, incisionPath, incisionPhase, lesionAt, STD_WINDOW } from './common';

/**
 * Caso 5 — Tanque: rotura del ligamento cruzado craneal, TPLO.
 * Vista medial de la tibia: proximal (meseta) a la izquierda, craneal (tuberosidad) arriba.
 * Convención de giro (la de RotateStep): giro = (valorInicial − valor) × degPerUnit → +23° al llegar a 5°.
 */

const TIBIA: LongBoneSpec = {
  // Borde craneal (arriba) con la tuberosidad tibial.
  top: [P(38, 41.5), P(44, 40.8), P(49, 38.8), P(54, 39.6), P(60, 43), P(68, 45.4), P(80, 46.2), P(100, 46.4), P(115, 46), P(124, 45)],
  // Borde caudal (abajo).
  bottom: [P(38, 60), P(44, 60), P(50, 58), P(60, 55.5), P(80, 54), P(100, 53.8), P(115, 54.2), P(124, 55.5)],
  // Meseta: el borde caudal queda más distal que el craneal (pendiente de ~28°) y la eminencia en medio.
  capLeft: [P(36.4, 59.6), P(35, 58), P(33.4, 55), P(31.6, 51.4), P(30.6, 49.8), P(29.6, 48), P(28.3, 45), P(28.8, 43.2), P(31, 41.4), P(34.5, 40.8)],
  // Maléolo medial.
  capRight: [P(126.6, 45.4), P(128.7, 47.4), P(129.5, 50), P(129, 52.4), P(127, 55)],
};

/** Centro de la osteotomía birradial (eminencia intercondílea) y radio de la hoja. */
const PIVOT = P(31.5, 50);
const SAW_RADIUS = 15;
const ARC = arcPath(PIVOT, SAW_RADIUS, -48, 48, 24).map((p) => P(Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100));

const START_TPA = 28;
const TARGET_TPA = 5;
const DEG_PER_UNIT = 1;

const [plateauAbs, tibiaRest] = splitLongBone(TIBIA, [ARC]);
const plateau = toLocal(plateauAbs);
const PLATEAU_START: Pose2 = { pos: plateau.origin, angleDeg: 0 };
/** Giro del fragmento = (inicial − objetivo) × gradosPorUnidad = +23° alrededor del pivote. */
const PLATEAU_TARGET = rotatePoseAround(PLATEAU_START, PIVOT, (START_TPA - TARGET_TPA) * DEG_PER_UNIT);

const PLATE: PlateParams = {
  type: 'plate',
  options: [
    { id: 'tplo35', label: 'Placa TPLO 3,5 mm · 6 agujeros', holes: 6, lengthMm: 52 },
    { id: 'tplo27', label: 'Placa TPLO 2,7 mm · 5 agujeros', holes: 5, lengthMm: 42 },
    { id: 'dcp8', label: 'Placa recta DCP 3,5 mm · 8 agujeros', holes: 8, lengthMm: 80 },
  ],
  correctId: 'tplo35',
  bendsRequired: 1,
  target: { pos: P(58, 50), angleDeg: 0 },
  tolMm: 2.5,
  tolDeg: 5,
  // Cabeza de la placa (3 agujeros en la meseta) y cuerpo (3 en la diáfisis).
  holes: [P(-19, 5), P(-22.5, -0.5), P(-18.5, -6), P(-3, -1), P(7, -1.5), P(17, -1.5)],
  lengthMm: 52,
  widthMm: 12,
};

const INCISION = incisionPath(28, 132, 50, 0.6);

export const TANQUE: CaseDef = {
  id: 'tanque',
  index: 5,
  week: 5,
  patient: { name: 'Tanque', species: 'dog', animal: 'pitbull', breed: 'Pit bull terrier', weightKg: 32, ageText: '4 años' },
  owner: { name: 'Yeni, entrenadora de canicross', human: 'ownerC' },
  diagnosis: 'Rotura del ligamento cruzado craneal',
  procedure: 'Osteotomía de nivelación de la meseta tibial (TPLO)',
  difficulty: 4,
  feeHC: 600,
  requiredReputation: 3,
  newMechanic: 'Sierra birradial en arco y rotación de la meseta (28° → 5°). Caso impuesto por Valerio; debuta su Mirada de Auditor.',
  targetTimeSec: 660,
  anatomy: {
    region: 'Tibia proximal derecha, vista medial',
    boneStatic: [tibiaRest],
    fragments: [
      {
        id: 'tibialPlateau',
        label: 'Meseta tibial',
        polygon: plateau.polygon,
        start: PLATEAU_START,
        target: PLATEAU_TARGET,
        locked: true,
        kind: 'bone',
      },
    ],
    window: STD_WINDOW,
    skinTone: '#dcae9b',
    furColor: '#6e6a73',
  },
  phases: [
    incisionPhase({ weight: 12, path: INCISION, pressures: [4, 2, 4], instrument: 'scalpel10', hazards: [P(54, 50.6)] }),
    hemostasisPhase({
      weight: 13,
      bleeders: [
        [52, 43, 'arterial'],
        [70, 55.5, 'venous'],
        [100, 45, 'capillary'],
        [36, 55.5, 'capillary'],
      ],
      targetFieldPct: 40,
      retract: { instrument: 'gelpi', pairs: [[P(66, 40.5), P(66, 59.5)]], ideal: 3, max: 5 },
    }),
    {
      id: 'osteotomy',
      label: 'Osteotomía',
      weight: 20,
      steps: [
        {
          id: 'osteotomy-arc',
          label: 'Corte en arco con la sierra birradial',
          params: { type: 'saw', path: ARC, kind: 'biradial', tolMm: 1.5, releases: ['tibialPlateau'], irrigationRequired: true },
        },
      ],
    },
    {
      id: 'rotation',
      label: 'Rotación',
      weight: 15,
      steps: [
        {
          id: 'rotation-plateau',
          label: 'Girar la meseta hasta 5°',
          params: {
            type: 'rotate',
            fragmentId: 'tibialPlateau',
            pivot: PIVOT,
            valueLabel: 'Ángulo de meseta tibial',
            startValue: START_TPA,
            targetValue: TARGET_TPA,
            tolValue: 1,
            degPerUnit: DEG_PER_UNIT,
            pinSpot: P(42.5, 56),
          },
        },
      ],
    },
    {
      id: 'fixation',
      label: 'Placa y tornillos',
      weight: 25,
      steps: [
        { id: 'fixation-plate', label: 'Apoyar la placa TPLO', params: PLATE },
        {
          id: 'fixation-screws',
          label: 'Seis tornillos: tres en la meseta, tres en la diáfisis',
          params: {
            type: 'screws',
            holes: 'plate',
            depthsMm: [25, 29, 26, 22, 21, 23],
            lengthOptionsMm: [24, 28, 32],
            torqueWindow: [0.72, 0.88],
          },
        },
      ],
    },
    closurePhase({ weight: 15, path: INCISION, layers: ['fascia', 'subcut', 'skin'], spacingMm: 9 }),
  ],
  clinic: {
    complaint: 'Tanque frenó en seco en una carrera y desde entonces apoya de puntitas. Él quiere seguir corriendo; yo no lo dejo.',
    tests: ['drawer', 'xray', 'patella'],
    keyTest: 'drawer',
    xrayLesion: lesionAt(P(32, 50), 0.09),
    diagnosisOptions: ['Rotura del ligamento cruzado craneal', 'Luxación patelar lateral', 'Esguince de tarso'],
    correctDiagnosis: 0,
    explanations: {
      absurd:
        'La tibia de Tanque es un tobogán muy empinado y el fémur se le resbala hacia adelante. Cortamos la parte de arriba en media luna y la giramos hasta dejar el tobogán casi plano: cinco grados.',
      technical:
        'Rotura del ligamento cruzado craneal con cajón positivo. TPLO para nivelar la meseta de 28° a ~5° y neutralizar el empuje tibial craneal, con revisión del menisco medial.',
      evasive: 'Se torció corriendo. Unos días de reposo y... bueno, y una cirugía. Pero tranquila, que es de rutina.',
    },
    minorCases: 3,
    ownerTemper: 'calm',
  },
  chaos: ['rodrigoSolo', 'fritzTremorSpike', 'gigiSelfie', 'valerioGaze', 'panchitoIntrusion'],
  valerioChallenges: [
    { kind: 'noScrewDrops', text: 'Seis tornillos, cero caídas. Tanque pesa 32 kilos; su pulso debería pesar más.' },
    { kind: 'underTargetTime', text: 'Once minutos, doctora. Este caso lo elegí yo; no me haga arrepentirme.' },
  ],
  education: {
    title: 'Ligamento cruzado y TPLO',
    facts: [
      'La TPLO nivela la meseta tibial a unos 5° para neutralizar el empuje tibial craneal al apoyar.',
      'Durante la cirugía se revisa el menisco medial, que a menudo se lesiona junto con el ligamento.',
      'La sierra birradial corta en arco para que la meseta pueda girar sobre su propio centro.',
    ],
    disclaimer: EDU_DISCLAIMER,
  },
  flags: {},
  intro: [
    'Semana 5. Valerio deja una carpeta sobre la mesa: «Este caso lo elijo yo.»',
    'Yeni, entrenadora de canicross, entra trotando con Tanque: 32 kilos de amor y músculo.',
    'Yeni: «Frenó en seco persiguiendo una ardilla. La ardilla ganó.»',
    'Valerio: «De veintiocho grados a cinco, doctora. Ni cuatro ni seis. Cinco.»',
    'Rodrigo: «Hoy la aspiración va en cuatro por cuatro, jefa.»',
  ],
  outro: [
    'Tanque despierta, mueve la cola y tumba el portasueros. Recuperación en curso.',
    'Yeni: «¿Cuándo vuelve a correr?» Emiliana: «Paseos con correa unas semanas, ¿sí?»',
    'Gigi: «Rotación de meseta en cámara lenta. Mis huesitos, esto es arte.»',
    'Valerio: «Cinco grados. Correcto.» Y se va sin decir nada más.',
  ],
};
