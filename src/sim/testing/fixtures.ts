import type {
  AnatomyDef,
  AuditInput,
  BoutiqueEffects,
  BoutiqueItem,
  CaseDef,
  EmilianaInit,
} from '../../core/contracts';

/** Dobles mínimos para las pruebas de src/sim (no dependen del módulo data). */

export function makeAnatomy(over: Partial<AnatomyDef> = {}): AnatomyDef {
  return {
    region: 'Radio distal (prueba)',
    boneStatic: [
      [
        { x: 30, y: 45 },
        { x: 70, y: 45 },
        { x: 70, y: 55 },
        { x: 30, y: 55 },
      ],
    ],
    fragments: [
      {
        id: 'distal',
        label: 'Fragmento distal',
        polygon: [
          { x: -15, y: -5 },
          { x: 15, y: -5 },
          { x: 15, y: 5 },
          { x: -15, y: 5 },
        ],
        start: { pos: { x: 95, y: 58 }, angleDeg: 15 },
        target: { pos: { x: 88, y: 50 }, angleDeg: 0 },
        kind: 'bone',
      },
      {
        id: 'esquirla',
        label: 'Esquirla',
        polygon: [
          { x: -4, y: -3 },
          { x: 4, y: -3 },
          { x: 4, y: 3 },
          { x: -4, y: 3 },
        ],
        start: { pos: { x: 95, y: 58 }, angleDeg: 0 },
        noTouch: true,
      },
      {
        id: 'bloque',
        label: 'Bloque troclear',
        polygon: [
          { x: -5, y: -5 },
          { x: 5, y: -5 },
          { x: 5, y: 5 },
          { x: -5, y: 5 },
        ],
        start: { pos: { x: 50, y: 50 }, angleDeg: 0 },
        target: { pos: { x: 50, y: 50 }, angleDeg: 0 },
        locked: true,
        kind: 'block',
      },
    ],
    window: [
      { x: 20, y: 35 },
      { x: 140, y: 35 },
      { x: 140, y: 65 },
      { x: 20, y: 65 },
    ],
    skinTone: '#f3c9c0',
    furColor: '#c89a6a',
    ...over,
  };
}

export function makeCase(over: Partial<CaseDef> = {}): CaseDef {
  return {
    id: 'caso-prueba',
    index: 1,
    week: 1,
    patient: { name: 'Panchito', species: 'dog', animal: 'chihuahua', breed: 'Chihuahua', weightKg: 2.1, ageText: '3 años' },
    owner: { name: 'Don Braulio', human: 'braulio' },
    diagnosis: 'Fractura distal de radio y cúbito',
    procedure: 'Miniplaca bloqueada',
    difficulty: 2,
    feeHC: 250,
    requiredReputation: 0,
    newMechanic: 'Prueba',
    targetTimeSec: 300,
    anatomy: makeAnatomy(),
    phases: [],
    clinic: {
      complaint: 'Cojea',
      tests: ['xray'],
      keyTest: 'xray',
      xrayLesion: { u: 0.5, v: 0.5, radius: 0.1 },
      diagnosisOptions: ['a', 'b', 'c'],
      correctDiagnosis: 0,
      explanations: { absurd: 'a', technical: 'b', evasive: 'c' },
      minorCases: 0,
      ownerTemper: 'calm',
    },
    chaos: ['rodrigoSolo', 'gigiSelfie'],
    valerioChallenges: [{ kind: 'noScrewDrops', text: 'Ni un tornillo al suelo.' }],
    education: { title: 'Ficha', facts: ['dato'], disclaimer: 'aviso' },
    flags: {},
    intro: [],
    outro: [],
    ...over,
  };
}

export function baseEffects(over: Partial<BoutiqueEffects> = {}): BoutiqueEffects {
  return {
    messageDurationSec: 20,
    noSlip: false,
    extraSlot: false,
    dominaCost: 15,
    handcuffsAutoSuction: false,
    lowConcTremorMult: 1,
    teamMoraleBonus: 0,
    ...over,
  };
}

export function makeEmilianaInit(over: Partial<EmilianaInit> = {}): EmilianaInit {
  return {
    concentration: 80,
    reserve: 60,
    effects: baseEffects(),
    firmSweetUnlocked: true,
    partner: { name: 'Sam', pronoun: 'elle' },
    messagePool: ['Buena niña, te espero con té. — {nombre}', 'Eres increíble. {nombre} te abraza.', 'Respira: lo estás haciendo genial.'],
    maxMessages: 3,
    tremorScale: 1,
    microMode: false,
    ...over,
  };
}

export function makeItem(id: string, priceHC: number): BoutiqueItem {
  return { id, name: id, priceHC, description: 'd', effectText: 'e', category: 'accesorio', color: '#ff8fc7' };
}

export function makeAuditInput(over: Partial<AuditInput> = {}): AuditInput {
  return {
    caseDef: makeCase(),
    difficulty: 'especialista',
    gestures: [],
    faults: [],
    exitoSamples: [],
    bloodLostPct: 0,
    elapsedSec: 200,
    sterility: 100,
    leadership: { kind: 5, domina: 0, firmSweet: 0, crises: 0, neglectSeconds: 0 },
    arrestHappened: false,
    valerioTookOver: false,
    challenge: null,
    challengeMet: false,
    tipHC: 0,
    costsHC: 0,
    worstMoments: [],
    ...over,
  };
}

/** Storage en memoria (sustituto de localStorage en node). */
export function memoryStorage(initial: Record<string, string> = {}): Storage {
  const m = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
  };
}
