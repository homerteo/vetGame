/**
 * Página de desarrollo de pantallas y superposiciones con datos falsos en línea.
 * Teclas 1–9 y 0 cambian de pantalla; ?s=N abre una directamente (para capturas).
 * ?gigi=touch mantiene a Gigi tocando la camilla durante la RCP.
 */
import { createScreens } from '../src/ui/Screens';
import { createCPROverlay } from '../src/ui/CPROverlay';
import { createBreathingOverlay } from '../src/ui/BreathingOverlay';
import type {
  AudioAPI,
  AuditResult,
  BeatClock,
  BoutiqueItem,
  CaseDef,
  DialogueBank,
  PartnerProfile,
  SaveData,
  Settings,
} from '../src/core/contracts';

const params = new URLSearchParams(location.search);
const logEl = document.getElementById('log')!;
const log = (s: string) => {
  logEl.textContent = s;
  console.log(s);
};

// ── Audio falso con reloj de pulso a 110 BPM ──
const t0 = performance.now();
const beat: BeatClock = {
  bpm: 110,
  phase: () => (((performance.now() - t0) / 1000) * (110 / 60)) % 1,
  timeToNextBeat: () => (1 - beat.phase()) * (60 / 110),
  beatIndex: () => Math.floor(((performance.now() - t0) / 1000) * (110 / 60)),
};
const audio: AudioAPI = {
  unlock: async () => {},
  play: (name, p) => log(`sfx: ${name}${p?.volume !== undefined ? ` (${p.volume})` : ''}`),
  loop: () => ({ set() {}, stop() {} }),
  setMusic: (s) => log(`música: ${s}`),
  beat,
  setVitals: () => {},
  voice: () => {},
  applySettings: () => {},
  dispose: () => {},
};

// ── Datos falsos ──
let settings: Settings = {
  difficulty: 'especialista', goreLevel: 70, pastelMode: false, tremorScale: 1, rhythmWindowScale: 1, reduceFlashes: false,
  subtitles: true, tts: false, masterVolume: 0.8, musicVolume: 0.6, sfxVolume: 0.8, asmrVolume: 0.7, immersive: false,
  adaptiveDirector: true, colorblind: 'none',
};
let partner: PartnerProfile = { name: 'Sam', pronoun: 'ella' };

type CaseSeed = [string, CaseDef['patient']['species'], CaseDef['patient']['animal'], string, number, string, string, string, 1 | 2 | 3 | 4 | 5, number, number, string];
const SEEDS: CaseSeed[] = [
  ['Panchito', 'dog', 'chihuahua', 'Chihuahua', 2.1, 'Don Braulio', 'Fractura distal de radio y cúbito', 'Miniplaca bloqueada', 1, 100, 0, 'Tutorial: bisturí, aspiración y tornillos. Sin caos (por ahora).'],
  ['Duquesa', 'cat', 'cat', 'Gata común europea', 4, 'Vecina de Gigi', 'Síndrome del gato paracaidista: fractura conminuta de fémur', 'Placa-clavo en puente («abrir pero no tocar»)', 2, 250, 0, 'Tocar esquirlas penaliza; radiografía de tórax obligatoria.'],
  ['Merengue', 'dog', 'poodle', 'Caniche toy', 3.5, 'Doña Hortensia', 'Legg-Calvé-Perthes', 'Ostectomía de cabeza y cuello femoral (FHO)', 2, 250, 0, 'Sierra oscilante: el ruido dispara la Histeria de Hortensia.'],
  ['Sir Winston', 'dog', 'bulldog', 'Bulldog inglés', 24, 'Lord Pardo', 'Luxación patelar medial grado III', 'Trocleoplastia en bloque + transposición de la tuberosidad tibial', 3, 400, 2, 'Tallar y encajar el bloque; selfies de Gigi al máximo.'],
  ['Chorizo', 'dog', 'dachshund', 'Teckel', 7, 'Rodrigo', 'Hernia discal Hansen I T13–L1', 'Hemilaminectomía', 4, 600, 3, 'Fresa a 1 mm de la médula; Rodrigo no hace solos (llora).'],
  ['Tanque', 'dog', 'pitbull', 'Pit bull', 32, 'Yeni', 'Rotura del ligamento cruzado craneal', 'TPLO', 4, 600, 3, 'Sierra birradial y rotación de meseta (28° → 5°).'],
  ['Copito', 'rabbit', 'rabbit', 'Conejo enano', 1.3, 'Profesor Anselmo', 'Fractura de tibia', 'Fijador esquelético externo con agujas finas', 4, 600, 3, 'Modo Micro: zoom ×3 y temblor ×2; cuidado con la hipotermia.'],
  ['Rayo', 'dog', 'bordercollie', 'Border collie', 19, 'Dr. Valerio', 'Hiperextensión del carpo', 'Artrodesis pancarpiana con placa dorsal híbrida + injerto', 5, 900, 3.5, 'Sin guías, Valerio en la sala, injerto del húmero.'],
];
const CASES: CaseDef[] = SEEDS.map(([name, species, animal, breed, kg, owner, dx, proc, diff, fee, rep, mech], i) => ({
  id: `case-${i}`,
  index: i,
  week: i,
  patient: { name, species, animal, breed, weightKg: kg, ageText: ['2 años', '5 años', '9 meses', '4 años', '6 años', '3 años', '1 año', '7 años'][i] },
  owner: { name: owner, human: 'ownerA' },
  diagnosis: dx,
  procedure: proc,
  difficulty: diff,
  feeHC: fee,
  requiredReputation: rep,
  newMechanic: mech,
  targetTimeSec: 420 + i * 60,
  anatomy: { region: 'radio', boneStatic: [], fragments: [], window: [], skinTone: '#f3c9b3', furColor: '#c68a52' },
  phases: [],
  clinic: {
    complaint: '', tests: ['xray'], keyTest: 'xray', xrayLesion: { u: 0.5, v: 0.5, radius: 0.1 }, diagnosisOptions: ['a', 'b', 'c'], correctDiagnosis: 0,
    explanations: { absurd: '', technical: '', evasive: '' }, minorCases: 2, ownerTemper: 'calm',
  },
  chaos: [],
  valerioChallenges: [{ kind: 'noScrewDrops', text: 'Ni un solo tornillo al suelo, doctora.' }],
  education: {
    title: 'Radio distal en razas toy',
    facts: [
      'En razas toy el radio distal está poco irrigado: con solo escayola son frecuentes el retraso de consolidación y la no unión.',
      'Por eso se prefiere la osteosíntesis con placa bloqueada.',
      'El cono isabelino evita que se lama la herida (y que muerda el vendaje).',
    ],
    disclaimer: 'Datos aproximados con fines divulgativos, pendientes de revisión veterinaria. No es consejo clínico.',
  },
  flags: { tutorial: i === 0, final: i === 7 },
  intro: [
    'Don Braulio trae a Panchito en una caja de zapatos forrada de aluminio «por si acaso».',
    'Saltó del sofá persiguiendo un dron que, según Braulio, «lo estaba midiendo».',
    'Radiografía: fractura distal de radio y cúbito. Nada que una miniplaca no arregle.',
    'Rodrigo ya afinó la aspiración. Fritz jura que hoy no tiembla. Gigi ya está en directo.',
  ],
  outro: [],
}));

const save: SaveData = {
  version: 1, coins: 780, reputation: 3.4, lastRanks: ['A', 'B', 'S'], completed: { 'case-0': 'S', 'case-1': 'A', 'case-2': 'B' },
  owned: ['skin-bisturi-gatito', 'gorros-corazones'], equipped: ['gorros-corazones'], settings, partner, viralClips: 2, unlockedWeek: 4, seenIntro: true,
};

const ITEMS: BoutiqueItem[] = [
  { id: 'gargantilla-estrella', name: 'Gargantilla con candado de estrella', priceHC: 150, description: 'Cuero rosa, candado dorado y una llavecita que nadie encuentra.', effectText: 'Los mensajes duran 30 s', category: 'accesorio', color: '#ff8fc7' },
  { id: 'botas-antideslizantes', name: 'Botas de plataforma antideslizantes', priceHC: 200, description: 'Doce centímetros de estilo y cero resbalones en la sangre ajena.', effectText: 'No resbalas en la clínica', category: 'accesorio', color: '#b79cf2' },
  { id: 'anillas-oro-rosa', name: 'Anillas en D de oro rosa', priceHC: 250, description: 'Más anillas, más sitio para colgar cosas importantes.', effectText: '+1 ranura de instrumental', category: 'accesorio', color: '#f5b5a0' },
  { id: 'fusta-pompon', name: 'Fusta con borla de pompón', priceHC: 300, description: 'La autoridad, pero esponjosita.', effectText: 'La Orden de Dómina cuesta 12', category: 'accesorio', color: '#ff5bb0' },
  { id: 'esposas-arcoiris', name: 'Esposas de felpa arcoíris', priceHC: 350, description: 'Engánchalas a la cánula y la aspiración va sola un ratito.', effectText: '10 s de aspiración autónoma (tecla H)', category: 'equipo', color: '#9ff0d0' },
  { id: 'arnes-menta', name: 'Arnés shibari menta', priceHC: 400, description: 'Nudos perfectos, pulso más perfecto todavía.', effectText: '−10 % de temblor con Concentración baja', category: 'accesorio', color: '#6fe0b8' },
  { id: 'skin-bisturi-gatito', name: 'Bisturí con mango de gatito', priceHC: 120, description: 'Corta igual. Ronronea más.', effectText: 'Cosmético', category: 'instrumental', color: '#ffd35c' },
  { id: 'skin-taladro-conejo', name: 'Taladro con orejas de conejo', priceHC: 200, description: 'Brrrr-zzzt, pero adorable.', effectText: 'Cosmético', category: 'instrumental', color: '#c8a2e8' },
  { id: 'gorros-corazones', name: 'Gorros quirúrgicos de corazones', priceHC: 180, description: 'Para todo el equipo. Hasta Valerio (a regañadientes).', effectText: '+5 de moral del equipo', category: 'equipo', color: '#ff9fb1' },
];

const audit: AuditResult = {
  components: { T: 88, E: 74, H: 81, S: 92, L: 58, t: 70 },
  nota: 79.6,
  rank: 'A',
  cap: null,
  coins: { fee: 100, multiplier: 1.5, tip: 40, costs: 15, total: 175 },
  worstMoments: [
    { t: 142, label: 'Vaso cortado en la fascia (−5)' },
    { t: 305, label: 'Tornillo al suelo: ¡contaminado!' },
    { t: 388, label: 'Orden de Dómina a Fritz: temblor +50 %' },
  ],
  weakest: 'L',
  challengeMet: true,
};
if (params.get('rank')) {
  audit.rank = params.get('rank') as AuditResult['rank'];
  if (audit.rank === 'B') audit.cap = { rank: 'B', reason: 'hubo paro cardíaco' };
}

const dialogue = {
  cpr: {
    start: ['¡Paro! ¡Compresiones al ritmo, equipo!', '¡Sin pulso! ¡Rodrigo, el riff! ¡Uno, dos, tres, cuatro!'],
    clear: ['¡Despejen! ¡Gigi, suelta la camilla!', '¡Todos atrás! ¡Manos fuera!'],
    rosc: ['¡Pulso! ¡Tenemos pulso! Buen chico, Panchito.', '¡Ritmo sinusal! Respira, pequeño.'],
    fail: ['Nada… Valerio, por favor.', 'Doctor Valerio, tome el control.'],
  },
} as unknown as DialogueBank;

// ── Montaje ──
const root = document.getElementById('ui-root')!;
const screens = createScreens(root, audio);
const cpr = createCPROverlay(root);
const breath = createBreathingOverlay(root);
let gigiTouch = params.get('gigi') === 'touch';
const unlocked = (c: CaseDef) => c.week <= save.unlockedWeek && save.reputation >= c.requiredReputation;

function show(n: number) {
  cpr.stop();
  breath.stop();
  screens.hideAll();
  switch (n) {
    case 1:
      screens.showTitle({ hasSave: true, onPlay: () => show(2), onContinue: () => show(2), onBoutique: () => show(5), onSettings: () => show(6) });
      break;
    case 2:
      screens.showCaseSelect({ cases: CASES, save, isUnlocked: unlocked, onPick: (id) => (log(`caso: ${id}`), show(3)), onBack: () => show(1), onBoutique: () => show(5) });
      break;
    case 3:
      screens.showCaseIntro({ caseDef: CASES[0], challenge: CASES[0].valerioChallenges[0], settings, onStart: () => show(8), onBack: () => show(2) });
      break;
    case 4:
      screens.showAudit({
        caseDef: CASES[0], result: audit, save,
        valerioLines: ['Técnica limpia. Liderazgo… mejorable. Fritz aún tiembla.', 'Primum non nocere, doctora. Hoy casi lo cumple.'],
        onContinue: () => show(2), onRetry: () => show(3),
      });
      break;
    case 5:
      screens.showBoutique({
        save, items: ITEMS,
        onBuy: (id) => {
          const it = ITEMS.find((x) => x.id === id)!;
          if (save.coins < it.priceHC) return false;
          save.coins -= it.priceHC;
          save.owned.push(id);
          return true;
        },
        onToggleEquip: (id) => {
          const i = save.equipped.indexOf(id);
          if (i >= 0) save.equipped.splice(i, 1);
          else save.equipped.push(id);
        },
        onBack: () => show(1),
      });
      break;
    case 6:
      screens.showSettings({
        settings, partner,
        onChange: (s, p) => {
          settings = s;
          partner = p;
          log(`ajustes: gore ${s.goreLevel}, pareja ${p.name} (${p.pronoun})`);
        },
        onBack: () => show(1),
      });
      break;
    case 7:
      screens.showPause({ onResume: () => screens.hideAll(), onSettings: () => show(6), onQuit: () => show(1) });
      break;
    case 8:
      screens.showInterstitial({ title: 'Fase 3: Reducción ósea', subtitle: 'Pinzas Kern, silueta menta y mucho crunch', seconds: Number(params.get('secs') ?? 4), onDone: () => log('intersticial: onDone') });
      break;
    case 9:
      cpr.start({
        beat, rhythmWindowScale: settings.rhythmWindowScale, reduceFlashes: settings.reduceFlashes || params.has('reduce'),
        isClear: () => !gigiTouch, dialogue, audio,
        onDone: (r) => log(`RCP: ${r.success ? 'éxito' : 'fracaso'} · calidad ${(r.quality * 100).toFixed(0)} %`),
      });
      break;
    case 10:
      breath.start({ rhythmWindowScale: settings.rhythmWindowScale, audio, onDone: (q) => log(`respiración: ${(q * 100).toFixed(0)} %`) });
      break;
  }
}

addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  if (cpr.isActive() && cpr.onKey(e.code, true)) return e.preventDefault();
  if (breath.isActive() && breath.onKey(e.code, true)) return e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'KeyG') gigiTouch = !gigiTouch;
  const d = /^Digit(\d)$/.exec(e.code);
  if (d) show(d[1] === '0' ? 10 : Number(d[1]));
});
addEventListener('keyup', (e) => {
  if (cpr.isActive()) cpr.onKey(e.code, false);
  if (breath.isActive()) breath.onKey(e.code, false);
});

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (cpr.isActive()) cpr.update(dt);
  if (breath.isActive()) breath.update(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

show(Number(params.get('s') ?? 1));
(window as unknown as { __dev: unknown }).__dev = { screens, cpr, breath, show, save };
