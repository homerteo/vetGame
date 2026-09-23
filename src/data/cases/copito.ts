import type { CaseDef, Pose2, Vec2 } from '../../core/contracts';
import { displacedPose, fractureLine, longBone, P, splitLongBone, toLocal, worldPoint, type LongBoneSpec } from '../geometry';
import { EDU_DISCLAIMER, lesionAt, STD_WINDOW } from './common';

/**
 * Caso 6 — Copito: fractura cerrada de tibia en conejo enano. Fijador esquelético externo.
 * Sin incisión (`closed`): el hueso se ve con rayos X a través de la piel. Vista lateral.
 */

const TIBIA: LongBoneSpec = {
  top: [P(32, 46.4), P(40, 47.2), P(55, 47.8), P(75, 48), P(95, 47.9), P(110, 47.6), P(120, 46.8), P(125, 46.2)],
  bottom: [P(32, 54.6), P(40, 53.4), P(55, 52.4), P(75, 52.1), P(95, 52.2), P(110, 52.6), P(120, 53.6), P(125, 54.2)],
  // Meseta con los cóndilos tibiales.
  capLeft: [P(29.4, 55.2), P(27.4, 52.8), P(27.8, 50.2), P(27, 47.6), P(29.2, 45.8)],
  // Superficie articular distal (tarso).
  capRight: [P(127.6, 46.4), P(129, 48.4), P(128.4, 50.2), P(129.2, 52.2), P(127.6, 54.2)],
};

/** Peroné fino que se fusiona con la tibia hacia la mitad de la diáfisis (típico del conejo). */
const FIBULA: LongBoneSpec = {
  top: [P(34, 56.2), P(50, 55), P(66, 53.8), P(74, 53.2)],
  bottom: [P(34, 58.2), P(50, 56.8), P(66, 55), P(74, 54)],
  capLeft: [P(32.4, 58.4), P(31.6, 57.2), P(32.4, 56)],
  capRight: [P(77.5, 53.4)],
};

const [tibiaProx, tibiaDist] = splitLongBone(TIBIA, [fractureLine(80, 44.5, 55.5, 7, 0.9, 31, 0.6)]);
const distal = toLocal(tibiaDist);
const DISTAL_TARGET: Pose2 = { pos: distal.origin, angleDeg: 0 };

/** Agujas: dos en el fragmento proximal (fijo) y dos en el distal ya reducido. */
const PINS: Vec2[] = [P(46, 50.2), P(62, 50.1), worldPoint(P(100 - distal.origin.x, 0), DISTAL_TARGET), worldPoint(P(114 - distal.origin.x, 0), DISTAL_TARGET)];

export const COPITO: CaseDef = {
  id: 'copito',
  index: 6,
  week: 6,
  patient: { name: 'Copito', species: 'rabbit', animal: 'rabbit', breed: 'Conejo enano holandés', weightKg: 1.3, ageText: '2 años' },
  owner: { name: 'Profesor Anselmo', human: 'ownerA' },
  diagnosis: 'Fractura diafisaria cerrada de tibia',
  procedure: 'Fijador esquelético externo con agujas finas',
  difficulty: 4,
  feeHC: 600,
  requiredReputation: 3,
  newMechanic: 'Modo Micro: zoom ×3 y temblor ×2. Reducción cerrada con rayos X, agujas finas e hipotermia (pide la manta a Gigi).',
  targetTimeSec: 540,
  anatomy: {
    region: 'Tibia derecha, vista lateral (reducción cerrada)',
    boneStatic: [tibiaProx, longBone(FIBULA)],
    fragments: [
      {
        id: 'distalTibia',
        label: 'Fragmento distal de la tibia',
        polygon: distal.polygon,
        target: DISTAL_TARGET,
        start: displacedPose(DISTAL_TARGET, 4.5, 3.8, 11),
        kind: 'bone',
      },
    ],
    window: STD_WINDOW,
    skinTone: '#f8d6d3',
    furColor: '#f7f4ee',
    closed: true,
  },
  phases: [
    {
      id: 'closedReduction',
      label: 'Reducción cerrada',
      weight: 30,
      steps: [
        {
          id: 'closed-align',
          label: 'Alinear la tibia a ciegas, guiándote por rayos X',
          params: { type: 'reduction', fragmentIds: ['distalTibia'], tolMm: 1.5, tolDeg: 5, carmShots: 4, mode: 'reduce', showGhost: true },
        },
      ],
    },
    {
      id: 'pins',
      label: 'Agujas transcutáneas',
      weight: 30,
      steps: [
        {
          id: 'pins-drill',
          label: 'Cuatro agujas finas, despacito',
          params: { type: 'drillPins', spots: PINS, tolMm: 1.2, item: 'pin', cortexProfileMm: [0.8, 4, 0.8], fragile: true },
        },
      ],
    },
    {
      id: 'fixator',
      label: 'Fijador',
      weight: 20,
      steps: [
        {
          id: 'fixator-clamps',
          label: 'Abrazaderas en cada aguja y barra de unión',
          params: {
            type: 'clickTargets',
            targets: PINS.map((p, i) => ({ pos: p, label: `Abrazadera ${i + 1}` })),
            tolMm: 2,
            ordered: false,
            instrument: 'hand',
            decal: 'clamp',
            label: 'Montar el fijador externo',
          },
        },
      ],
    },
    {
      id: 'bandage',
      label: 'Vendaje',
      weight: 20,
      steps: [
        {
          id: 'bandage-padding',
          label: 'Acolchar el fijador sin apretar',
          params: { type: 'bandage', center: P(80, 50), radiusMm: 22, turns: 3 },
        },
      ],
    },
  ],
  clinic: {
    complaint: 'Copito saltó del escritorio mientras yo corregía exámenes. Ahora lleva la patita colgando. Me siento responsable.',
    tests: ['xray', 'crepitus'],
    keyTest: 'xray',
    xrayLesion: lesionAt(P(80, 50), 0.07),
    diagnosisOptions: ['Fractura de tibia', 'Luxación de cadera', 'Pododermatitis ulcerativa'],
    correctDiagnosis: 0,
    explanations: {
      absurd:
        'Los huesos de Copito son de galleta: livianos y quebradizos. Le pondremos agujas finitas por fuera, como un andamio de juguete. Y tiene que comer pronto, que su pancita no sabe esperar.',
      technical:
        'Fractura diafisaria cerrada de tibia. Por la cortical fina del conejo, fijador esquelético externo con agujas finas, soporte térmico y alimentación temprana para evitar la estasis gastrointestinal.',
      evasive: 'Los conejos son delicados, pero muy valientes. Déjelo en nuestras manos y vaya a descansar, profe.',
    },
    minorCases: 2,
    ownerTemper: 'anxious',
  },
  chaos: ['rodrigoSolo', 'fritzTremorSpike', 'gigiSelfie', 'valerioGaze'],
  valerioChallenges: [
    { kind: 'noExtraCarm', text: 'Cuatro disparos de rayos X y ni uno más. Copito no brilla en la oscuridad.' },
    { kind: 'noArrest', text: 'Sin paros. Un conejo de 1,3 kilos no tiene margen, doctora. Usted tampoco.' },
  ],
  education: {
    title: 'Conejos: huesos frágiles y pancitas delicadas',
    facts: [
      'El esqueleto del conejo pesa ~7–8% de su peso corporal, frente al 12–13% del gato: las corticales son finas y se fisuran fácil.',
      'Por eso se usan agujas finas y fijadores externos ligeros, perforando con poca fuerza y a baja velocidad.',
      'Tras la cirugía debe comer pronto: el ayuno prolongado provoca estasis gastrointestinal.',
      'Los pacientes pequeños pierden calor muy rápido: el soporte térmico es parte de la cirugía.',
    ],
    disclaimer: EDU_DISCLAIMER,
  },
  flags: { microMode: true, hypothermia: true },
  intro: [
    'Semana 6. El profesor Anselmo llega con Copito en una caja de zapatos forrada con apuntes.',
    'Profesor Anselmo: «Saltó del escritorio en plena corrección. Reprobó el aterrizaje.»',
    'Fritz: «¿A-a-agujas finas? ¿Con MIS manos?»',
    'Valerio: «Modo Micro, doctora. Cada temblor suyo se verá tres veces más grande.»',
  ],
  outro: [
    'Copito despierta, mueve la nariz a toda velocidad y se come una hoja de cilantro. Excelente señal.',
    'Profesor Anselmo: «Le pongo un diez. Con estrellita.»',
    'Gigi: «El fijador de Copito es literalmente un accesorio de moda, mis huesitos.»',
    'Valerio: «Ni una fisura. Mm.» Viniendo de él, eso fue un aplauso.',
  ],
};
