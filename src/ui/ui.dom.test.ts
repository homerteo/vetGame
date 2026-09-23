// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioAPI, AuditResult, BeatClock, BoutiqueItem, CaseDef, DialogueBank, HudModel, SaveData, Settings } from '../core/contracts';
import { createSurgeryHud } from './SurgeryHud';
import { createScreens } from './Screens';
import { createCPROverlay } from './CPROverlay';
import { createBreathingOverlay } from './BreathingOverlay';

const settings: Settings = {
  difficulty: 'especialista', goreLevel: 60, pastelMode: false, tremorScale: 1, rhythmWindowScale: 1, reduceFlashes: false, subtitles: true,
  tts: false, masterVolume: 1, musicVolume: 1, sfxVolume: 1, asmrVolume: 1, immersive: false, adaptiveDirector: true, colorblind: 'none',
};

function fakeAudio() {
  const played: string[] = [];
  const beat: BeatClock = { bpm: 110, phase: () => 0.5, timeToNextBeat: () => 0.2, beatIndex: () => 0 };
  const audio: AudioAPI = {
    unlock: async () => {}, play: (n) => void played.push(n), loop: () => ({ set() {}, stop() {} }), setMusic: () => {}, beat,
    setVitals: () => {}, voice: () => {}, applySettings: () => {}, dispose: () => {},
  };
  return { audio, played, beat };
}

function model(): HudModel {
  return {
    caseName: 'Panchito',
    vitals: { hr: 120, spo2: 98, map: 75, etco2: 38, tempC: 37.9, bloodVolumePct: 100, bloodLostPct: 0, exito: 62, arrest: false, rhythm: 'sinus', alarms: [] },
    progress: {
      phases: [
        { label: 'Incisión', weight: 15, done: true, active: false },
        { label: 'Hemostasia', weight: 15, done: false, active: true },
        { label: 'Reducción', weight: 70, done: false, active: false },
      ],
      totalPct: 20, phaseLabel: 'Hemostasia', stepLabel: 'Sellar sangrados', checklist: [{ label: 'Sellar 3 sangrados', done: false }], hint: 'Cauteriza 1–2 s',
    },
    field: { levelPct: 30, floodThresholdPct: 70, rodrigoSuctioning: true },
    emiliana: { concentration: 80, reserve: 90, crisis: false, crisisLeft: 0, serenoLeft: 0, precision: false, blush: 0, message: { pending: false, secondsLeft: 0, text: null, showing: false, stored: 0 } },
    crew: [
      { id: 'rodrigo', name: 'Rodrigo', state: 'working', morale: 70, problem: false },
      { id: 'fritz', name: 'Fritz', state: 'ok', morale: 60, problem: false },
      { id: 'gigi', name: 'Gigi', state: 'filming', morale: 80, problem: true },
    ],
    instruments: { slots: ['scalpel10', 'cautery', 'kern'], active: 'cautery', contaminated: ['kern'], names: { scalpel10: 'Bisturí', cautery: 'Cauterio', kern: 'Kern' } },
    valerio: { gazing: false, provisionalRank: 'A', hidden: false, line: null },
    timer: { elapsedSec: 90, targetSec: 480 },
    gauges: [{ id: 'heat', label: 'Calor', value: 40, min: 30, max: 60, unit: '°C', zones: [{ from: 30, to: 47, kind: 'good' }, { from: 47, to: 60, kind: 'bad' }] }],
    pressure: 3,
    lightLevel: 1,
    immersive: false,
    microMode: false,
    challenge: 'Ni un tornillo al suelo',
    carmShotsLeft: 2,
  };
}

async function countMutations(target: Node, fn: () => void) {
  let n = 0;
  const mo = new MutationObserver((r) => (n += r.length));
  mo.observe(target, { subtree: true, childList: true, attributes: true, characterData: true });
  fn();
  await Promise.resolve();
  n += mo.takeRecords().length;
  mo.disconnect();
  return n;
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  document.body.innerHTML = '';
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('SurgeryHud', () => {
  it('pinta el modelo y no toca el DOM si nada cambia', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const hud = createSurgeryHud(root, settings);
    const m = model();
    hud.update(m);
    expect(root.querySelector('.v-hr .v-val')?.textContent).toBe('120');
    expect(root.querySelector('.ex-val')?.textContent).toBe('62 %');
    expect(root.querySelectorAll('.seg').length).toBe(3);
    expect(root.querySelector('.seg.done')).not.toBeNull();
    expect(root.querySelector('.prog-hint .hint-txt')?.textContent).toBe('Cauteriza 1–2 s');
    expect(root.querySelectorAll('.slot').length).toBe(3);
    expect(root.querySelector('.slot.active .slot-name')?.textContent).toBe('Cauterio');
    expect(root.querySelector('.slot.contaminated .slot-name')?.textContent).toBe('Kern');
    expect(root.querySelector('.crew-card.problem .cc-name')?.textContent).toBe('Gigi');
    expect(root.querySelector('.crew-card.problem .cc-stxt')?.textContent).toBe('Grabando');
    expect(root.querySelector('.vr-letter')?.textContent).toBe('A');
    expect(root.querySelectorAll('.gauge').length).toBe(1);
    hud.update(m);
    const n = await countMutations(root, () => hud.update(m));
    expect(n).toBe(0);
    hud.dispose();
    expect(root.children.length).toBe(0);
  });

  it('refleja alarmas, "sin señal", crisis, mensaje y modo inmersivo', () => {
    const root = document.createElement('div');
    const hud = createSurgeryHud(root, { ...settings, reduceFlashes: true, colorblind: 'deuter' });
    const m = model();
    m.vitals.alarms = ['map'];
    m.vitals.map = 52;
    hud.update(m);
    expect(root.querySelector('.v-map')?.classList.contains('alarm')).toBe(true);
    expect(root.querySelector('.emi-hud')?.classList.contains('reduce-flashes')).toBe(true);
    expect(root.querySelector('.emi-hud')?.classList.contains('cb-deuter')).toBe(true);
    m.vitals.hr = Number.NaN;
    m.vitals.spo2 = Number.NaN;
    m.emiliana.crisis = true;
    m.emiliana.crisisLeft = 2.2;
    m.emiliana.message = { pending: false, secondsLeft: 0, text: 'Buena niña.', showing: true, stored: 0 };
    m.valerio.hidden = true;
    m.immersive = true;
    hud.update(m);
    expect(root.querySelector('.hud-monitor')?.classList.contains('nosig')).toBe(true);
    expect(root.querySelector('.v-hr .v-val')?.textContent).toBe('--');
    expect(root.querySelector('.hud-emi')?.classList.contains('crisis')).toBe(true);
    expect(root.querySelector('.emi-chip.crisis')?.textContent).toContain('3 s');
    expect(root.querySelector('.hud-msg')?.classList.contains('show')).toBe(true);
    expect(root.querySelector('.msg-txt')?.textContent).toBe('Buena niña.');
    expect(root.querySelector('.val-rank')?.classList.contains('hidden')).toBe(true);
    expect(root.querySelector('.emi-hud')?.classList.contains('immersive')).toBe(true);
  });

  it('cuenta atrás del reloj con mensaje pendiente', () => {
    const root = document.createElement('div');
    const hud = createSurgeryHud(root, settings);
    const m = model();
    m.emiliana.message = { pending: true, secondsLeft: 20, text: null, showing: false, stored: 1 };
    hud.update(m);
    m.emiliana.message.secondsLeft = 10;
    hud.update(m);
    const watch = root.querySelector('.hud-watch') as HTMLElement;
    expect(watch.classList.contains('pending')).toBe(true);
    expect(watch.style.getPropertyValue('--wr')).toBe('0.5');
    expect(root.querySelector('.w-secs')?.textContent).toBe('10 s');
    expect(watch.classList.contains('stored')).toBe(true);
  });

  it('alertas: máximo 2 con prioridad; subtítulos, avisos y textos flotantes', () => {
    const root = document.createElement('div');
    const hud = createSurgeryHud(root, settings);
    hud.alert('info', 'info');
    hud.alert('comment', 'comentario');
    hud.alert('arrest', '¡Paro!');
    hud.update(model());
    const shown = [...root.querySelectorAll('.hud-alert.show')].map((e) => e.textContent);
    expect(shown).toEqual(['¡Paro!', 'comentario']);
    hud.subtitle('valerio', 'Tómeselo como sugerencia.');
    const sub = root.querySelector('.hud-sub');
    expect(sub?.querySelector('.sub-who')?.textContent).toBe('Dr. Valerio');
    hud.toast('Clip viral', 'good');
    expect(root.querySelector('.hud-toast.t-good')).not.toBeNull();
    hud.popText('¡Perfecto!', { x: 100, y: 200 }, 'perfect');
    const pop = root.querySelector('.hud-pop.pop-perfect') as HTMLElement;
    expect(pop.style.left).toBe('100px');
    expect(hud.minigameLayer().classList.contains('hud-minigame')).toBe(true);
    hud.setVisible(false);
    expect((root.querySelector('.emi-hud') as HTMLElement).style.display).toBe('none');
  });

  it('los medidores de conteo van sin decimales; los continuos con decimales', () => {
    const root = document.createElement('div');
    const hud = createSurgeryHud(root, settings);
    const m = model();
    m.gauges = [
      { id: 'carm', label: 'Rayos X restantes', value: 3, min: 0, max: 4 },
      { id: 'press', label: 'Presión', value: 3, min: 1, max: 5 },
      { id: 'heat', label: 'Calor', value: 40, min: 30, max: 60, unit: '°C' },
    ];
    hud.update(m);
    const vals = () => [...root.querySelectorAll('.g-val')].map((e) => e.textContent);
    expect(vals()).toEqual(['3', '3', '40 °C']);
    m.gauges[2].value = 41.37;
    hud.update(m);
    expect(vals()[2]).toBe('41,4 °C');
    // Si un medidor que parecía de conteo resulta continuo, pasa a decimales.
    m.gauges[0].value = 2.5;
    hud.update(m);
    expect(vals()[0]).toBe('2,50');
  });

  it('la alerta del equipo dura lo que el problema', () => {
    const root = document.createElement('div');
    const hud = createSurgeryHud(root, settings);
    const m = model();
    m.crew = [{ id: 'rodrigo', name: 'Rodrigo', state: 'ok', morale: 80, problem: true }];
    hud.alert('crew', 'Rodrigo se marca un solo');
    hud.update(m);
    expect(root.textContent).toContain('Rodrigo se marca un solo');
    m.crew[0].problem = false;
    hud.update(m);
    hud.update(m);
    expect([...root.querySelectorAll('.hud-alert.show')].map((e) => e.textContent).join()).not.toContain('solo');
  });

  it('sin subtítulos si el ajuste está desactivado', () => {
    const root = document.createElement('div');
    const hud = createSurgeryHud(root, { ...settings, subtitles: false });
    hud.subtitle('rodrigo', 'hola');
    expect(root.querySelector('.hud-sub')).toBeNull();
  });
});

const CASE: CaseDef = {
  id: 'c0', index: 0, week: 0,
  patient: { name: 'Panchito', species: 'dog', animal: 'chihuahua', breed: 'Chihuahua', weightKg: 2.1, ageText: '2 años' },
  owner: { name: 'Don Braulio', human: 'braulio' }, diagnosis: 'Fractura de radio', procedure: 'Miniplaca', difficulty: 1, feeHC: 100,
  requiredReputation: 0, newMechanic: 'Tutorial', targetTimeSec: 420,
  anatomy: { region: 'radio', boneStatic: [], fragments: [], window: [], skinTone: '#fff', furColor: '#000' }, phases: [],
  clinic: { complaint: '', tests: [], keyTest: 'xray', xrayLesion: { u: 0, v: 0, radius: 0 }, diagnosisOptions: [], correctDiagnosis: 0, explanations: { absurd: '', technical: '', evasive: '' }, minorCases: 0, ownerTemper: 'calm' },
  chaos: [], valerioChallenges: [], education: { title: 'Ficha', facts: ['Dato 1', 'Dato 2'], disclaimer: 'Aproximado' }, flags: { tutorial: true },
  intro: ['Línea uno.', 'Línea dos.'], outro: [],
};
const SAVE: SaveData = {
  version: 1, coins: 200, reputation: 2.5, lastRanks: [], completed: { c0: 'A' }, owned: ['b'], equipped: [], settings, partner: { name: 'Sam', pronoun: 'elle' },
  viralClips: 0, unlockedWeek: 0, seenIntro: true,
};

describe('Screens', () => {
  it('título: botones y "Continuar" desactivado sin partida', () => {
    const root = document.createElement('div');
    const { audio, played } = fakeAudio();
    const s = createScreens(root, audio);
    const onPlay = vi.fn();
    s.showTitle({ hasSave: false, onPlay, onContinue: vi.fn(), onBoutique: vi.fn(), onSettings: vi.fn() });
    const btns = [...root.querySelectorAll('button')];
    expect(btns.map((b) => b.textContent)).toEqual(['Jugar', 'Continuar', 'Boutique', 'Ajustes']);
    expect(btns[1].disabled).toBe(true);
    btns[0].click();
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(played).toContain('uiClick');
    expect(root.textContent).toContain('Ningún animal muere');
    s.hideAll();
    expect(root.querySelector('.scr')).toBeNull();
  });

  it('selección de caso: bloqueo con requisito y rango', () => {
    const root = document.createElement('div');
    const s = createScreens(root, null);
    const locked: CaseDef = { ...CASE, id: 'c1', index: 1, week: 3, patient: { ...CASE.patient, name: 'Duquesa' } };
    const onPick = vi.fn();
    s.showCaseSelect({ cases: [locked, CASE], save: SAVE, isUnlocked: (c) => c.week === 0, onPick, onBack: vi.fn(), onBoutique: vi.fn() });
    const cards = [...root.querySelectorAll('.case-card')] as HTMLButtonElement[];
    expect(cards[0].textContent).toContain('Panchito');
    expect(cards[0].querySelector('.rs-letter')?.textContent).toBe('A');
    expect(cards[1].disabled).toBe(true);
    expect(cards[1].textContent).toContain('Completa la semana 2');
    cards[0].click();
    expect(onPick).toHaveBeenCalledWith('c0');
  });

  it('briefing con reto y aviso', () => {
    const root = document.createElement('div');
    const s = createScreens(root, null);
    const onStart = vi.fn();
    s.showCaseIntro({ caseDef: CASE, challenge: { kind: 'noArrest', text: 'Sin paros, doctora.' }, settings: { ...settings, pastelMode: true }, onStart, onBack: vi.fn() });
    expect(root.textContent).toContain('Sin paros, doctora.');
    expect(root.textContent).toContain('Modo Pastel activado');
    (root.querySelector('.scr-btn.big') as HTMLButtonElement).click();
    expect(onStart).toHaveBeenCalled();
  });

  it('auditoría: componentes, rango y sonido de revelación', () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    const { audio, played } = fakeAudio();
    const s = createScreens(root, audio);
    const result: AuditResult = {
      components: { T: 90, E: 80, H: 70, S: 60, L: 50, t: 40 }, nota: 71.5, rank: 'B', cap: { rank: 'B', reason: 'hubo paro' },
      coins: { fee: 100, multiplier: 1, tip: 10, costs: 0, total: 110 }, worstMoments: [{ t: 61, label: 'Vaso cortado' }], weakest: 't', challengeMet: false,
    };
    s.showAudit({ caseDef: CASE, result, valerioLines: ['Correcto.'], save: SAVE, onContinue: vi.fn(), onRetry: vi.fn() });
    const labels = [...root.querySelectorAll('.comp-lbl span:not(.comp-w)')].map((e) => e.textContent);
    expect(labels).toEqual(['Técnica', 'Estabilidad', 'Hemostasia', 'Esterilidad', 'Liderazgo', 'Tiempo']);
    expect(root.querySelector('.comp.weakest .comp-key')?.textContent).toBe('t');
    expect(root.textContent).toContain('Tope B: hubo paro');
    expect(root.textContent).toContain('1:01');
    expect(root.querySelector('.rank-stamp.big .rs-letter')?.textContent).toBe('B');
    vi.advanceTimersByTime(5000);
    expect(played).toContain('rankReveal');
    expect(root.querySelector('.rank-stamp.big')?.classList.contains('in')).toBe(true);
  });

  it('auditoría: sin reto no se habla de reto; con reto sí', () => {
    const root = document.createElement('div');
    const s = createScreens(root, null);
    const result: AuditResult = {
      components: { T: 90, E: 80, H: 70, S: 60, L: 50, t: 40 }, nota: 71.5, rank: 'B', cap: null,
      coins: { fee: 100, multiplier: 1, tip: 10, costs: 0, total: 110 }, worstMoments: [], weakest: 't', challengeMet: false,
    };
    // Tutorial sin briefing previo (?skip=clinic): sin reto
    s.showAudit({ caseDef: CASE, result, valerioLines: [], save: SAVE, onContinue: vi.fn(), onRetry: vi.fn() });
    expect(root.querySelector('.chal-line')).toBeNull();
    // Caso con reto mostrado en el briefing: la línea aparece aunque no se cumpliera
    const hard: CaseDef = { ...CASE, id: 'c6', week: 6, flags: {}, valerioChallenges: [{ kind: 'noArrest', text: 'Sin paros.' }] };
    s.showCaseIntro({ caseDef: hard, challenge: hard.valerioChallenges[0], settings, onStart: vi.fn(), onBack: vi.fn() });
    s.showAudit({ caseDef: hard, result, valerioLines: [], save: SAVE, onContinue: vi.fn(), onRetry: vi.fn() });
    expect(root.querySelector('.chal-line')?.textContent).toContain('Reto no cumplido');
    // El briefing dijo «hoy no hay reto»: la auditoría no lo contradice
    s.showCaseIntro({ caseDef: hard, challenge: null, settings, onStart: vi.fn(), onBack: vi.fn() });
    s.showAudit({ caseDef: hard, result, valerioLines: [], save: SAVE, onContinue: vi.fn(), onRetry: vi.fn() });
    expect(root.querySelector('.chal-line')).toBeNull();
  });

  it('el briefing y la tarjeta no destripan el diagnóstico', () => {
    const root = document.createElement('div');
    const s = createScreens(root, null);
    const c: CaseDef = { ...CASE, clinic: { ...CASE.clinic, complaint: 'No apoya la patita.' } };
    s.showCaseIntro({ caseDef: c, challenge: null, settings, onStart: vi.fn(), onBack: vi.fn() });
    expect(root.textContent).not.toContain(c.diagnosis);
    expect(root.textContent).toContain('No apoya la patita.');
    expect(root.querySelector('.xr-mark')).toBeNull();
    s.showCaseSelect({ cases: [c], save: SAVE, isUnlocked: () => true, onPick: vi.fn(), onBack: vi.fn(), onBoutique: vi.fn() });
    expect(root.textContent).not.toContain(c.diagnosis);
  });

  it('boutique: comprar, fallar y equipar', () => {
    const root = document.createElement('div');
    const { audio, played } = fakeAudio();
    const s = createScreens(root, audio);
    const items: BoutiqueItem[] = [
      { id: 'a', name: 'Barata', priceHC: 150, description: '', effectText: 'x', category: 'accesorio', color: '#f0f' },
      { id: 'b', name: 'Tuya', priceHC: 999, description: '', effectText: 'y', category: 'equipo', color: '#0f0' },
      { id: 'c', name: 'Cara', priceHC: 900, description: '', effectText: 'z', category: 'instrumental', color: '#00f' },
    ];
    const onBuy = vi.fn(() => true);
    const onToggleEquip = vi.fn();
    s.showBoutique({ save: SAVE, items, onBuy, onToggleEquip, onBack: vi.fn() });
    const btns = [...root.querySelectorAll('.shop-btn')] as HTMLButtonElement[];
    expect(btns[2].disabled).toBe(true);
    expect(root.textContent).toContain('Faltan 700 HC');
    btns[0].click();
    expect(onBuy).toHaveBeenCalledWith('a');
    expect(played).toContain('uiBuy');
    expect(root.querySelector('.coins-chip b')?.textContent).toBe('50');
    expect(btns[0].textContent).toBe('Equipar');
    btns[1].click();
    expect(onToggleEquip).toHaveBeenCalledWith('b');
    expect(btns[1].textContent).toBe('Quitar');
  });

  it('ajustes: onChange en vivo con copias', () => {
    const root = document.createElement('div');
    const s = createScreens(root, null);
    const onChange = vi.fn();
    s.showSettings({ settings, partner: { name: 'Sam', pronoun: 'ella' }, onChange, onBack: vi.fn() });
    const pastel = [...root.querySelectorAll('.set-field')].find((f) => f.textContent?.includes('Modo Pastel'))!.querySelector('input') as HTMLInputElement;
    pastel.checked = true;
    pastel.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ pastelMode: true }), { name: 'Sam', pronoun: 'ella' });
    const jefe = [...root.querySelectorAll('.seg-opt')].find((b) => b.textContent === 'Jefe de Servicio') as HTMLButtonElement;
    jefe.click();
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ difficulty: 'jefe' }), expect.anything());
    const name = root.querySelector('.k-input') as HTMLInputElement;
    name.value = 'Alex';
    name.dispatchEvent(new Event('input'));
    expect(onChange).toHaveBeenLastCalledWith(expect.anything(), { name: 'Alex', pronoun: 'ella' });
    const selects = [...root.querySelectorAll('select')] as HTMLSelectElement[];
    const pron = selects[selects.length - 1];
    pron.value = 'elle';
    pron.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenLastCalledWith(expect.anything(), { name: 'Alex', pronoun: 'elle' });
    expect(settings.pastelMode).toBe(false); // el original no se muta
    const labels = [...root.querySelectorAll('.set-lbl')].map((l) => l.textContent);
    for (const l of ['Dificultad', 'Nivel de gore', 'Modo Pastel', 'Temblor de manos', 'Ventana rítmica', 'Reducir destellos', 'Subtítulos', 'Voces sintetizadas', 'Volumen general', 'Música', 'Efectos', 'ASMR del instrumental', 'Modo inmersivo', 'Director de caos adaptativo', 'Daltonismo', 'Nombre', 'Pronombres'])
      expect(labels).toContain(l);
  });

  it('pausa e intersticial (onDone una sola vez)', () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    const s = createScreens(root, null);
    const onResume = vi.fn();
    s.showPause({ onResume, onSettings: vi.fn(), onQuit: vi.fn() });
    (root.querySelector('.scr-btn') as HTMLButtonElement).click();
    expect(onResume).toHaveBeenCalled();
    const onDone = vi.fn();
    s.showInterstitial({ title: 'Fase 2', seconds: 2, onDone });
    expect(root.textContent).toContain('Fase 2');
    vi.advanceTimersByTime(1900);
    expect(onDone).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onDone).toHaveBeenCalledTimes(1);
    // La cortina se retira al terminar: no puede quedarse capturando clics sobre la cirugía.
    expect(root.querySelector('.scr-inter')).toBeNull();
    expect((root.querySelector('.emi-screens') as HTMLElement).style.display).toBe('none');
    vi.advanceTimersByTime(5000);
    expect(onDone).toHaveBeenCalledTimes(1);
    const onDone2 = vi.fn();
    s.showInterstitial({ title: 'Fase 3', seconds: 1, onDone: onDone2 });
    s.hideAll();
    vi.advanceTimersByTime(3000);
    expect(onDone2).not.toHaveBeenCalled();
  });
});

const DIALOGUE = { cpr: { start: ['¡Paro!'], clear: ['¡Despejen!'], rosc: ['¡Pulso!'], fail: ['Nada.'] } } as unknown as DialogueBank;

describe('CPROverlay', () => {
  it('flujo completo: compresiones, FV, carga, despejen, descarga y onDone una vez', () => {
    let real = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => real * 1000);
    const root = document.createElement('div');
    const { audio, played, beat } = fakeAudio();
    const cpr = createCPROverlay(root);
    let clear = false;
    const onDone = vi.fn();
    cpr.start({ beat, rhythmWindowScale: 1, reduceFlashes: false, isClear: () => clear, dialogue: DIALOGUE, audio, onDone });
    expect(cpr.isActive()).toBe(true);
    expect(root.textContent).toContain('¡Paro!');
    const step = (sec: number, dHeld?: boolean) => {
      const dt = 1 / 60;
      for (let i = 0; i < sec * 60; i++) {
        real += dt;
        cpr.update(dt);
      }
      void dHeld;
    };
    // 110/min durante 4 s
    for (let i = 0; i < 8; i++) {
      cpr.onKey('Space', true);
      cpr.onKey('Space', false);
      step(60 / 110);
    }
    expect(root.querySelector('.cpr-monitor')?.classList.contains('r-vfib')).toBe(true);
    expect(cpr.onKey('KeyD', true)).toBe(true);
    for (let i = 0; i < 5; i++) {
      cpr.onKey('Space', true);
      cpr.onKey('Space', false);
      step(60 / 110);
    }
    expect(played).toContain('defibCharge');
    expect(root.textContent).toContain('¡Despejen!');
    expect(root.querySelector('.cpr-gigi')?.classList.contains('clear')).toBe(false);
    clear = true;
    step(0.2);
    cpr.onKey('KeyD', false);
    step(0.1);
    expect(played).toContain('defibShock');
    expect(played).toContain('bag');
    expect(root.querySelector('.cpr-flash')?.classList.contains('go')).toBe(true);
    step(3);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0][0].success).toBe(true);
    expect(cpr.isActive()).toBe(false);
    expect(root.children.length).toBe(0);
  });

  it('stop() cierra sin llamar a onDone', () => {
    const root = document.createElement('div');
    const { audio, beat } = fakeAudio();
    const cpr = createCPROverlay(root);
    const onDone = vi.fn();
    cpr.start({ beat, rhythmWindowScale: 1, reduceFlashes: true, isClear: () => true, dialogue: DIALOGUE, audio, onDone });
    expect(root.querySelector('.emi-cpr')?.classList.contains('reduce-flashes')).toBe(true);
    cpr.stop();
    expect(cpr.isActive()).toBe(false);
    expect(onDone).not.toHaveBeenCalled();
    expect(cpr.onKey('Space', true)).toBe(false);
  });
});

describe('BreathingOverlay', () => {
  it('16 s perfectos → calidad ~1 y onDone una vez', () => {
    const root = document.createElement('div');
    const { audio } = fakeAudio();
    const br = createBreathingOverlay(root);
    const onDone = vi.fn();
    br.start({ rhythmWindowScale: 1, audio, onDone });
    const dt = 1 / 60;
    let t = 0;
    let held = false;
    for (let i = 0; i < 60 * 19; i++) {
      const want = !(t >= 8 && t < 12);
      if (want !== held) {
        held = want;
        br.onKey('Space', held);
      }
      br.update(dt);
      t += dt;
    }
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0][0]).toBeGreaterThan(0.97);
    expect(br.isActive()).toBe(false);
  });

  it('sin pulsar nada la calidad es baja', () => {
    const root = document.createElement('div');
    const { audio } = fakeAudio();
    const br = createBreathingOverlay(root);
    const onDone = vi.fn();
    br.start({ rhythmWindowScale: 1, audio, onDone });
    expect(root.textContent).toContain('Respiración cuadrada');
    for (let i = 0; i < 60 * 19; i++) br.update(1 / 60);
    expect(onDone.mock.calls[0][0]).toBeLessThan(0.4);
  });
});
