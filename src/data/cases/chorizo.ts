import type { CaseDef, Vec2 } from '../../core/contracts';
import { closedSpline, longBone, P, type LongBoneSpec } from '../geometry';
import { closurePhase, EDU_DISCLAIMER, hemostasisPhase, incisionPath, incisionPhase, lesionAt, STD_WINDOW } from './common';

/**
 * Caso 4 — Chorizo: hernia discal Hansen I T13–L1, hemilaminectomía.
 * Vista lateral izquierda de la columna: craneal a la izquierda, dorsal arriba.
 * La médula queda bajo el arco vertebral; la ventana de fresado es ventral a ella.
 */

/** Contorno lateral de una vértebra toracolumbar a partir de su extremo craneal x0. */
function vertebra(x0: number, spineLean: number): Vec2[] {
  const c = (dx: number, y: number) => P(x0 + dx, y);
  return closedSpline(
    [
      c(6, 42.5),
      c(13, 41.2),
      c(15.5 + spineLean, 37.4),
      c(17 + spineLean, 35.6),
      c(21 + spineLean, 35.4),
      c(22.5 + spineLean, 37.6),
      c(24, 41),
      c(32, 41.6),
      c(38, 43.5),
      c(42, 47.4),
      c(46.5, 50.2), // apófisis articular caudal
      c(48, 52.5),
      c(46, 54.8),
      c(42, 55.2),
      c(43.5, 57),
      c(44.2, 60.5),
      c(42.5, 63),
      c(24, 63.4),
      c(5, 63),
      c(2.8, 60.6),
      c(3.2, 57.2),
      c(5, 55.6),
      c(1, 53.6),
      c(-1.8, 51.5),
      c(-2, 48.6), // apófisis articular craneal
      c(1.5, 46.2),
      c(4, 44),
    ],
    3,
  );
}

const T13 = vertebra(31, 0);
const L1 = vertebra(77.5, -1);

const CORD_SPEC: LongBoneSpec = {
  top: [P(26, 43), P(60, 42.8), P(100, 43.1), P(134, 43)],
  bottom: [P(26, 50.4), P(60, 50.6), P(100, 50.3), P(134, 50.4)],
  capLeft: [P(24.6, 48.5), P(24.3, 46.7), P(24.6, 44.9)],
  capRight: [P(135.4, 44.9), P(135.7, 46.7), P(135.4, 48.5)],
};
const CORD = longBone(CORD_SPEC);

/**
 * Ventana de hemilaminectomía: lámina y carillas T13–L1, ventral a la médula.
 * Su borde queda a algo más de un radio de fresa (2,5 mm) de la médula: fresando el borde,
 * el hueso retirado llega a ~0,2 mm de ella. Acercar el puntero más de 2,5 mm = falta.
 */
const LAMINA_WINDOW: Vec2[] = [P(65, 53.3), P(91, 53.3), P(93, 56.9), P(91, 60.5), P(65, 60.5), P(63, 56.9)];

const INCISION = incisionPath(28, 132, 50, 0.5);

export const CHORIZO: CaseDef = {
  id: 'chorizo',
  index: 4,
  week: 4,
  patient: { name: 'Chorizo', species: 'dog', animal: 'dachshund', breed: 'Teckel (dachshund)', weightKg: 7, ageText: '5 años' },
  owner: { name: 'Rodrigo', human: 'rodrigo' },
  diagnosis: 'Hernia discal Hansen tipo I T13–L1, dolor profundo conservado',
  procedure: 'Hemilaminectomía',
  difficulty: 4,
  feeHC: 600,
  requiredReputation: 3,
  newMechanic: 'Fresa a 1 mm de la médula: tocarla es falta grave. Rodrigo no hace solos (llora). Llega el aluminio de Braulio.',
  targetTimeSec: 600,
  anatomy: {
    region: 'Columna toracolumbar (T13–L1), vista lateral izquierda',
    boneStatic: [T13, L1],
    fragments: [],
    cord: CORD,
    window: STD_WINDOW,
    skinTone: '#ebbca6',
    furColor: '#8a3f1c',
  },
  phases: [
    incisionPhase({ weight: 12, path: INCISION, pressures: [3, 2, 4], instrument: 'scalpel10', hazards: [P(90, 50.2)] }),
    hemostasisPhase({
      weight: 13,
      label: 'Hemostasia',
      stepLabel: 'Cauterizar los vasos de la musculatura epaxial',
      bleeders: [
        [44, 45, 'venous'],
        [108, 55, 'venous'],
        [62, 57, 'arterial'],
        [92, 44.5, 'capillary'],
        [120, 47, 'capillary'],
      ],
      targetFieldPct: 40,
      retract: {
        instrument: 'gelpi',
        pairs: [
          [P(56, 40.5), P(56, 59.5)],
          [P(104, 40.5), P(104, 59.5)],
        ],
        ideal: 3,
        max: 5,
      },
    }),
    {
      id: 'burr',
      label: 'Fresado',
      weight: 30,
      steps: [
        {
          id: 'burr-lamina',
          label: 'Fresar lámina y carillas sin tocar la médula',
          params: {
            type: 'burr',
            area: LAMINA_WINDOW,
            forbidden: CORD,
            requiredPct: 0.9,
            layer: 'bone',
            label: 'Lámina y carilla articular T13–L1',
            brushMm: 2.5,
            instrument: 'burr',
          },
        },
      ],
    },
    {
      id: 'decompression',
      label: 'Descompresión',
      weight: 20,
      steps: [
        {
          id: 'decompression-disc',
          label: 'Retirar el material discal con pinzas',
          params: {
            type: 'pick',
            items: [
              { id: 'disc1', pos: P(74.5, 55.2), radiusMm: 1.5 },
              { id: 'disc2', pos: P(79, 55.8), radiusMm: 1.5 },
              { id: 'disc3', pos: P(83.5, 55), radiusMm: 1.5 },
              { id: 'disc4', pos: P(79.2, 58.4), radiusMm: 1.5 },
            ],
            forbidden: CORD,
            tool: 'forceps',
            label: 'Material discal extruido',
          },
        },
      ],
    },
    hemostasisPhase({
      id: 'fineHemostasis',
      label: 'Hemostasia fina',
      stepLabel: 'Sellar el sangrado del seno venoso',
      weight: 10,
      bleeders: [
        [70, 58.6, 'capillary'],
        [88, 58.4, 'capillary'],
      ],
      targetFieldPct: 30,
    }),
    closurePhase({ weight: 15, path: INCISION, layers: ['fascia', 'subcut', 'skin'], spacingMm: 8 }),
  ],
  clinic: {
    complaint: 'Jefa... Chorizo no mueve las patas de atrás. Se bajó del sillón como siempre y ya. No puedo ni tocar la guitarra.',
    tests: ['deepPain', 'xray'],
    keyTest: 'deepPain',
    xrayLesion: lesionAt(P(79, 53), 0.07),
    diagnosisOptions: ['Hernia discal Hansen tipo I (T13–L1)', 'Fractura de pelvis', 'Embolia fibrocartilaginosa'],
    correctDiagnosis: 0,
    explanations: {
      absurd:
        'Los discos de Chorizo son gomitas viejas: una reventó y aprieta la médula como quien pisa una manguera. Quitamos un pedacito de hueso y sacamos la gomita. Aún siente dolor profundo, y eso es buenísimo.',
      technical:
        'Extrusión discal Hansen tipo I en T13–L1 con dolor profundo conservado. Indicamos hemilaminectomía para descomprimir la médula retirando lámina y material discal.',
      evasive: 'Está cansadito de la espalda, como todos. Te lo dejamos como nuevo; tú tranquilo con tu guitarra.',
    },
    minorCases: 2,
    ownerTemper: 'anxious',
  },
  chaos: ['fritzTremorSpike', 'gigiSelfie', 'braulioFoil', 'panchitoIntrusion'],
  valerioChallenges: [
    { kind: 'fieldNeverFlooded', text: 'Campo seco junto a la médula, doctora. Aquí un charco es un naufragio.' },
    { kind: 'noArrest', text: 'Sin paros. Rodrigo ya está llorando lo suficiente por los dos.' },
  ],
  education: {
    title: 'Hernia discal en razas condrodistróficas',
    facts: [
      'Los teckel y otras razas condrodistróficas degeneran los discos intervertebrales desde muy jóvenes.',
      'Conservar el dolor profundo en las patas traseras es el mayor factor pronóstico.',
      'La hemilaminectomía descomprime la médula retirando parte de la lámina y el material discal extruido.',
    ],
    disclaimer: EDU_DISCLAIMER,
  },
  flags: { rodrigoNoSolos: true },
  intro: [
    'Semana 4. Rodrigo llega sin auriculares. Mala señal.',
    'Rodrigo: «Jefa... es Chorizo. Mi Chorizo. No mueve las patas de atrás.»',
    'Don Braulio pasa por la puerta y envuelve el monitor en aluminio «por si acaso».',
    'Valerio: «Médula a un milímetro, doctora. Ese milímetro es todo su margen.»',
  ],
  outro: [
    'Chorizo despierta y mueve la colita. Rodrigo llora otra vez, pero de las buenas.',
    'Rodrigo: «Te voy a componer una balada, jefa. En re menor, como la aspiración.»',
    'Emiliana: «Reposo en jaula y fisio, ¿sí? Nada de sillones por un tiempo.»',
    'Valerio: «Ni rozó la médula. Tomo nota.»',
  ],
};
