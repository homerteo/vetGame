import type { CaseDef, FragmentDef, Pose2 } from '../../core/contracts';
import { displacedPose, fractureLine, P, splitLongBone, toLocal, translatePoly, type LongBoneSpec } from '../geometry';
import { closurePhase, EDU_DISCLAIMER, hemostasisPhase, incisionPath, incisionPhase, lesionAt, STD_WINDOW } from './common';

/** Caso 0 — Panchito: fractura distal de radio y cúbito (tutorial). Vista dorsal del antebrazo. */

const RADIUS: LongBoneSpec = {
  top: [P(30, 46.2), P(40, 46.8), P(60, 47.2), P(80, 47.3), P(100, 46.8), P(112, 45.5), P(120, 43.8), P(126, 43)],
  bottom: [P(30, 53.2), P(40, 53), P(60, 52.8), P(80, 52.8), P(100, 53.2), P(112, 54.5), P(120, 56.2), P(126, 57)],
  // Cabeza del radio (codo), redondeada.
  capLeft: [P(27.6, 52.6), P(26.4, 50), P(27.6, 47.3)],
  // Superficie articular distal con apófisis estiloides.
  capRight: [P(128.6, 42.6), P(130.6, 44.6), P(129.6, 48.2), P(130.9, 51.8), P(129.9, 55.6)],
};

const ULNA: LongBoneSpec = {
  top: [P(28, 55.8), P(50, 55.6), P(80, 55.8), P(104, 56.4), P(118, 57.6), P(123, 58.2)],
  bottom: [P(28, 60.4), P(50, 59.2), P(80, 59), P(104, 59.3), P(118, 60.2), P(123, 60.8)],
  // Olécranon.
  capLeft: [P(25.2, 61.3), P(23.8, 58.6), P(25.2, 55.9)],
  // Estiloides cubital.
  capRight: [P(125.4, 58.6), P(126.6, 59.6), P(125.4, 60.8)],
};

const radiusCut = fractureLine(92, 44.5, 55.5, 7, 1.1, 11, 0.12);
const [radiusProx, radiusDist] = splitLongBone(RADIUS, [radiusCut]);
const ulnaCut = fractureLine(90, 54.6, 60.8, 5, 0.7, 5, -0.1);
const [ulnaProx, ulnaDist] = splitLongBone(ULNA, [ulnaCut]);

const distal = toLocal(radiusDist);
const DISTAL_TARGET: Pose2 = { pos: distal.origin, angleDeg: 0 };

const FRAGMENTS: FragmentDef[] = [
  {
    id: 'distalRadius',
    label: 'Fragmento distal del radio',
    polygon: distal.polygon,
    target: DISTAL_TARGET,
    start: displacedPose(DISTAL_TARGET, 5.5, 3.6, 13),
    kind: 'bone',
  },
];

const INCISION = incisionPath(30, 130, 50, 0.6);

export const PANCHITO: CaseDef = {
  id: 'panchito',
  index: 0,
  week: 0,
  patient: { name: 'Panchito', species: 'dog', animal: 'chihuahua', breed: 'Chihuahua', weightKg: 2.1, ageText: '3 años' },
  owner: { name: 'Don Braulio', human: 'braulio' },
  diagnosis: 'Fractura distal de radio y cúbito',
  procedure: 'Osteosíntesis con miniplaca bloqueada',
  difficulty: 1,
  feeHC: 100,
  requiredReputation: 0,
  newMechanic: 'Tutorial: bisturí por capas, cauterio, pinzas Kern, placa y tornillos. Sin caos y sin temblor de Fritz.',
  targetTimeSec: 420,
  anatomy: {
    region: 'Antebrazo izquierdo (radio y cúbito distales), vista dorsal',
    boneStatic: [radiusProx, ulnaProx, translatePoly(ulnaDist, 0.5, 0.35)],
    fragments: FRAGMENTS,
    window: STD_WINDOW,
    skinTone: '#f4cdb9',
    furColor: '#c98b4f',
  },
  phases: [
    incisionPhase({ weight: 15, path: INCISION, pressures: [3, 2, 3], instrument: 'scalpel15', hazards: [P(72, 50.3)] }),
    hemostasisPhase({
      weight: 15,
      bleeders: [
        [46, 45.5, 'capillary'],
        [74, 54.5, 'venous'],
        [116, 55.5, 'capillary'],
      ],
      targetFieldPct: 40,
      retract: { instrument: 'gelpi', pairs: [[P(80, 41.5), P(80, 58.5)]], ideal: 3, max: 5 },
    }),
    {
      id: 'reduction',
      label: 'Reducción',
      weight: 20,
      steps: [
        {
          id: 'reduction-radius',
          label: 'Alinear el radio distal con la silueta',
          params: {
            type: 'reduction',
            fragmentIds: ['distalRadius'],
            tolMm: 2,
            tolDeg: 5,
            kwireSpots: [P(108, 52.4)],
            carmShots: 3,
            mode: 'reduce',
            showGhost: true,
          },
        },
      ],
    },
    {
      id: 'plate',
      label: 'Placa',
      weight: 20,
      steps: [
        {
          id: 'plate-mini',
          label: 'Elegir, contornear y apoyar la miniplaca',
          params: {
            type: 'plate',
            options: [
              { id: 'mini4', label: 'Miniplaca bloqueada 1,5 mm · 4 agujeros', holes: 4, lengthMm: 28 },
              { id: 'lcp6', label: 'Placa bloqueada 2,0 mm · 6 agujeros', holes: 6, lengthMm: 42 },
              { id: 'lcp8', label: 'Placa bloqueada 2,4 mm · 8 agujeros', holes: 8, lengthMm: 58 },
            ],
            correctId: 'mini4',
            bendsRequired: 2,
            target: { pos: P(92, 50), angleDeg: 0 },
            tolMm: 2.5,
            tolDeg: 6,
            holes: [P(-11, 0), P(-5, 0), P(5, 0), P(11, 0)],
            lengthMm: 28,
            widthMm: 5,
          },
        },
      ],
    },
    {
      id: 'screws',
      label: 'Tornillos',
      weight: 15,
      steps: [
        {
          id: 'screws-plate',
          label: 'Atrapar, medir y atornillar 4 tornillos',
          params: {
            type: 'screws',
            holes: 'plate',
            depthsMm: [5.4, 6.6, 7, 5.8],
            lengthOptionsMm: [6, 8, 10],
            torqueWindow: [0.75, 0.92],
          },
        },
      ],
    },
    closurePhase({
      weight: 15,
      path: INCISION,
      layers: ['subcut', 'skin'],
      spacingMm: 8,
      bandage: { center: P(80, 50), radiusMm: 24, turns: 2 },
    }),
  ],
  clinic: {
    complaint: 'Saltó del sofá persiguiendo un dron del gobierno y ya no apoya la patita. El dron sigue ahí, doctora.',
    tests: ['crepitus', 'xray'],
    keyTest: 'xray',
    xrayLesion: lesionAt(P(92, 50), 0.07),
    diagnosisOptions: ['Fractura distal de radio y cúbito', 'Luxación de codo', 'Esguince leve de carpo'],
    correctDiagnosis: 0,
    explanations: {
      absurd:
        'Don Braulio, el radio de Panchito es un fideo seco con poca sangre: con yeso solo no pega. Le pondremos una placa del tamaño de un clip. Sin antena, lo juro.',
      technical:
        'Fractura transversa distal de radio y cúbito. En razas toy la perfusión del radio distal es pobre y la coaptación externa sola conlleva alto riesgo de no unión; indicamos miniplaca bloqueada de 1,5 mm.',
      evasive: 'Se torció la patita, nada grave. Usted tranquilo, que aquí la ciencia no la controla nadie. ¿Un cafecito?',
    },
    minorCases: 1,
    ownerTemper: 'paranoid',
  },
  chaos: [],
  valerioChallenges: [
    { kind: 'noScrewDrops', text: 'Ni un tornillo al suelo, doctora. El titanio no crece en los árboles.' },
    { kind: 'underTargetTime', text: 'Termine antes del tiempo objetivo. Tempus fugit, y el perro también.' },
  ],
  education: {
    title: 'Fracturas de radio en perros miniatura',
    facts: [
      'En razas toy el radio distal está poco irrigado: con solo escayola son frecuentes el retraso de consolidación y la no unión.',
      'Por eso suele preferirse la fijación interna con placas pequeñas (1,5–2,0 mm) y un manejo delicado de los tejidos.',
      'El collar isabelino (el cono) evita que el paciente se lama o muerda la herida y el vendaje.',
    ],
    disclaimer: EDU_DISCLAIMER,
  },
  flags: { tutorial: true, fritzNoTremor: true },
  intro: [
    'Semana 0. Primer día de la Dra. Emiliana en la Clínica Veterinaria Arcoíris.',
    'Don Braulio llega con Panchito en brazos y un gorro de aluminio recién planchado.',
    'Don Braulio: «Fue un dron del gobierno, doctora. Lo perseguía por la sala.»',
    'Gigi: «¡Hola, mis huesitos! Hoy toca placa bloqueada, ¿sí? Denle like a Panchito.»',
    'Valerio: «Una fractura sencilla, doctora. Veremos si usted también lo es.»',
  ],
  outro: [
    'Panchito despierta, le ladra al monitor y exige su cono. Se lo ganó.',
    'Don Braulio: «¿La placa trae GPS? No me mienta.» (No trae GPS.)',
    'Valerio: «Aceptable. Mañana, algo que muerda más.»',
    'Desde hoy Panchito lleva el cono a todas partes. Ya es parte de su personalidad.',
  ],
};
