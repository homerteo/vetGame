/**
 * HUD del quirófano (GDD §8). La herida ocupa el centro; todo vive en los márgenes.
 * update(model) se llama cada fotograma: solo se toca el DOM cuando algo cambia.
 */
import './theme.css';
import './hud.css';
import type {
  AlertKind,
  AssistantId,
  AssistantVisualState,
  ChecklistItem,
  Gauge,
  HudModel,
  InstrumentId,
  Settings,
  SpeakerId,
  SurgeryHudAPI,
  VitalsSnapshot,
} from '../core/contracts';
import { clamp } from '../core/math';
import { createAlertQueue } from './logic/alerts';
import { ClassCell, EnumClassCell, NumCell, StyleCell, TextCell, VarCell, fromHtml, h } from './logic/dom';
import { fmtDec, fmtTime, readingSeconds } from './logic/format';
import type { EcgRhythm } from './logic/ecg';
import { cprDisplay, monitorRhythm } from './logic/cprDisplay';
import { EcgCanvas } from './EcgCanvas';
import { ICONS, STATE_ICON, STATE_LABEL, heartBatterySvg, heartPadlockSvg, instrumentIcon, type IconName } from './icons';
import { createPortrait } from './portraits';
import { ASSISTANT_KEY, SPEAKER_COLOR, SPEAKER_NAME } from './speakers';

type VitalKey = 'hr' | 'spo2' | 'map' | 'etco2' | 'temp';

const VITALS: Array<{ key: VitalKey; label: string; unit: string; icon: IconName; digits: number; field: keyof VitalsSnapshot }> = [
  { key: 'hr', label: 'FC', unit: 'lpm', icon: 'heart', digits: 0, field: 'hr' },
  { key: 'spo2', label: 'SpO₂', unit: '%', icon: 'drop', digits: 0, field: 'spo2' },
  { key: 'map', label: 'PAM', unit: 'mmHg', icon: 'diamond', digits: 0, field: 'map' },
  { key: 'etco2', label: 'EtCO₂', unit: 'mmHg', icon: 'cloud', digits: 0, field: 'etco2' },
  { key: 'temp', label: 'T', unit: '°C', icon: 'thermo', digits: 1, field: 'tempC' },
];

const RHYTHM_LABEL: Record<EcgRhythm, string> = {
  sinus: 'Ritmo sinusal',
  tachy: 'Taquicardia',
  brady: 'Bradicardia',
  vfib: '¡Fibrilación ventricular!',
  asystole: 'Asistolia',
  noSignal: 'Sin señal',
};

const ALERT_ICON: Record<AlertKind, IconName> = {
  arrest: 'brokenHeart',
  arterial: 'drop',
  boneHeat: 'flame',
  crew: 'alert',
  flood: 'wave',
  comment: 'speech',
  info: 'info',
};

const TOAST_ICON: Record<'info' | 'good' | 'bad' | 'valerio', IconName> = {
  info: 'info',
  good: 'check',
  bad: 'cross',
  valerio: 'speech',
};

const POP_ICON: Record<'perfect' | 'good' | 'miss' | 'bad', IconName> = {
  perfect: 'sparkle',
  good: 'check',
  miss: 'cross',
  bad: 'alert',
};

const ZONE_ICON: Record<'good' | 'warn' | 'bad' | 'none', IconName> = {
  good: 'check',
  warn: 'triangle',
  bad: 'cross',
  none: 'diamond',
};

/** Etiquetas en femenino para Gigi. */
const GIGI_LABEL: Partial<Record<AssistantVisualState, string>> = { ok: 'Lista', distracted: 'Distraída' };

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

interface Timed {
  el: HTMLElement;
  until: number;
}

export function createSurgeryHud(root: HTMLElement, settings: Settings): SurgeryHudAPI {
  const hud = h('div', 'emi-hud', root);
  if (settings.reduceFlashes) hud.classList.add('reduce-flashes');
  if (settings.colorblind !== 'none') hud.classList.add(`cb-${settings.colorblind}`);
  if (settings.pastelMode) hud.classList.add('pastel');

  // ── Escala según el tamaño del contenedor ──
  const applyScale = () => {
    const w = hud.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1280);
    const hh = hud.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 720);
    // Pantallas estrechas o verticales (w/h < 1,2): los paneles se reapilan (ver .narrow en hud.css)
    // y la escala sale del ancho, que es lo que se acaba.
    const narrow = w / Math.max(1, hh) < 1.2;
    const s = narrow ? clamp(w / 980, 0.5, 1) : clamp(Math.min(w / 1280, hh / 720), 0.72, 1.6);
    hud.style.setProperty('--hud-s', s.toFixed(3));
    hud.classList.toggle('narrow', narrow);
  };
  let ro: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(applyScale);
    ro.observe(hud);
  } else if (typeof window !== 'undefined') window.addEventListener('resize', applyScale);
  applyScale();

  // ══════════ Arriba izquierda: monitor + Éxito ══════════
  const tl = h('div', 'hud-anchor hud-tl hud-im', hud);
  const mon = h('div', 'hud-monitor', tl);
  const monCrest = fromHtml(ICONS.heart, 'mon-crest', mon);
  h('span', 'mon-crest-txt', monCrest, 'MONITOR');
  for (const c of ['tl', 'tr', 'bl', 'br']) fromHtml(ICONS.heart, `mon-rivet ${c}`, mon);
  const monScreen = h('div', 'mon-screen', mon);
  const ecg = new EcgCanvas(monScreen, 226, 62);
  const noSignal = h('div', 'mon-nosignal', monScreen);
  fromHtml(ICONS.zigzag, 'ns-ic', noSignal);
  h('span', '', noSignal, 'SIN SEÑAL');
  const rhythmLbl = new TextCell(h('div', 'mon-rhythm', monScreen));
  const monVals = h('div', 'mon-vals', mon);
  const vitalCells = VITALS.map((v) => {
    const el = h('div', `vital v-${v.key}`, monVals);
    fromHtml(ICONS[v.icon], 'v-ic', el);
    h('span', 'v-lbl', el, v.label);
    const val = h('span', 'v-val', el);
    h('span', 'v-unit', el, v.unit);
    fromHtml(ICONS.diamond, 'v-alarm', el);
    return {
      def: v,
      val: new NumCell(val, (x) => (Number.isFinite(x) ? fmtDec(x, v.digits) : '--'), v.digits ? 0.1 : 1),
      alarm: new ClassCell(el, 'alarm'),
      nan: new ClassCell(el, 'nan'),
    };
  });
  const monArrest = new ClassCell(mon, 'arrest');
  const monNoSig = new ClassCell(mon, 'nosig');

  const exito = h('div', 'hud-exito', tl);
  const hb = fromHtml(heartBatterySvg(), 'hb-wrap', exito);
  const exitoTxt = h('div', 'ex-txt', exito);
  h('span', 'ex-lbl', exitoTxt, 'Éxito');
  const exitoVal = new NumCell(h('span', 'ex-val', exitoTxt), (v) => `${Math.round(v)} %`, 1);
  const exitoBarWrap = h('div', 'ex-bar', exitoTxt);
  const exitoBar = new VarCell(h('i', '', exitoBarWrap), '--f', 0.005);
  const exFill = new VarCell(hb, '--fill', 0.005);
  const exLow = new ClassCell(exito, 'low');
  const exBroken = new ClassCell(exito, 'broken');
  const exBeat = new VarCell(exito, '--beat', 0.02, 's');

  // ══════════ Izquierda: Nivel de Campo ══════════
  const lf = h('div', 'hud-anchor hud-left hud-im', hud);
  const fieldBox = h('div', 'hud-field', lf);
  h('div', 'fld-title', fieldBox, 'Nivel de Campo');
  const tubeWrap = h('div', 'fld-wrap', fieldBox);
  h('i', 'fld-rim', tubeWrap);
  const tube = h('div', 'fld-tube', tubeWrap);
  const tubeLiquid = h('div', 'fld-liquid', tube);
  h('i', 'fld-meniscus', tubeLiquid);
  for (let i = 0; i < 3; i++) h('i', `fld-bubble b${i}`, tubeLiquid);
  h('i', 'fld-glass', tube);
  for (let i = 1; i < 5; i++) h('i', 'fld-tick', tubeWrap).style.bottom = `${i * 20}%`;
  const floodLine = h('div', 'fld-flood', tubeWrap);
  const floodLbl = h('span', 'fld-flood-lbl', floodLine);
  const fieldFill = new VarCell(fieldBox, '--lvl', 0.004);
  const floodPos = new StyleCell(floodLine, 'bottom');
  const floodTxt = new TextCell(floodLbl);
  const fieldVal = new NumCell(h('div', 'fld-val', fieldBox), (v) => `${Math.round(v)} %`, 1);
  const floodWarn = h('div', 'fld-warn', fieldBox);
  fromHtml(ICONS.wave, '', floodWarn);
  h('span', '', floodWarn, '¡Inundado!');
  const fieldFlood = new ClassCell(fieldBox, 'flood');
  const fieldWarn = new ClassCell(fieldBox, 'warn');
  const rod = h('div', 'fld-rod', fieldBox);
  fromHtml(ICONS.suction, 'rod-ic', rod);
  const rodTxt = new TextCell(h('span', 'rod-txt', rod));
  const rodOn = new ClassCell(fieldBox, 'suctioning');

  // ══════════ Arriba centro: progreso, checklist, pista, reloj ══════════
  const tc = h('div', 'hud-anchor hud-tc', hud);
  const prog = h('div', 'hud-progress hud-im', tc);
  h('i', 'k-dring prog-ring l', prog);
  h('i', 'k-dring prog-ring r', prog);
  const progHead = h('div', 'prog-head', prog);
  const phaseName = new TextCell(h('span', 'prog-phase', progHead));
  const stepName = new TextCell(h('span', 'prog-step', progHead));
  const timer = h('span', 'prog-timer', progHead);
  const timerIcon = fromHtml(ICONS.clock, 'tm-ic', timer);
  const timerElapsed = new NumCell(h('b', 'tm-el', timer), fmtTime, 1);
  h('span', 'tm-sep', timer, '/');
  const timerTarget = new NumCell(h('span', 'tm-tg', timer), fmtTime, 1);
  const timerOver = new ClassCell(timer, 'over');
  const progBar = h('div', 'prog-bar', prog);
  const progPct = new NumCell(h('span', 'prog-pct', progHead), (v) => `${Math.round(v)} %`, 1);
  const checkRow = h('div', 'prog-check', prog);
  const hintEl = h('div', 'prog-hint', prog);
  fromHtml(ICONS.sparkle, 'hint-ic', hintEl);
  const hintTxt = new TextCell(h('span', 'hint-txt', hintEl));
  const hintEmpty = new ClassCell(hintEl, 'empty');
  const alertsBox = h('div', 'hud-alerts', tc);
  const toastsBox = h('div', 'hud-toasts', tc);

  interface Seg {
    el: HTMLElement;
    fill: VarCell;
    done: ClassCell;
    active: ClassCell;
    label: string;
    weight: number;
  }
  let segs: Seg[] = [];
  const checkState: { labels: string[]; done: boolean[] } = { labels: [], done: [] };

  // ══════════ Arriba derecha: Valerio ══════════
  const tr = h('div', 'hud-anchor hud-tr hud-im', hud);
  const valRow = h('div', 'val-row', tr);
  const bubble = h('div', 'val-bubble', valRow);
  const bubbleTxt = new TextCell(h('span', '', bubble));
  const bubbleOn = new ClassCell(bubble, 'show');
  const valPortraitWrap = h('div', 'val-pwrap', valRow);
  const valPortrait = createPortrait('valerio', valPortraitWrap);
  h('div', 'val-name', valPortraitWrap, 'Dr. Valerio');
  const rankBadge = h('div', 'val-rank', valPortraitWrap);
  h('span', 'vr-cap', rankBadge, 'Nota');
  const rankLetter = new TextCell(h('b', 'vr-letter', rankBadge));
  const rankCls = new EnumClassCell<string>(rankBadge, 'rk-');
  const rankHidden = new ClassCell(rankBadge, 'hidden');
  const gazing = new ClassCell(valPortrait, 'gazing');
  const gazeChip = h('div', 'val-gaze', tr);
  fromHtml(ICONS.lens, 'gz-ic', gazeChip);
  h('span', '', gazeChip, 'Te observa: errores ×2');
  const gazeOn = new ClassCell(gazeChip, 'show');
  const chal = h('div', 'val-challenge', tr);
  fromHtml(ICONS.star, 'ch-ic', chal);
  h('b', '', chal, 'Reto:');
  const chalTxt = new TextCell(h('span', 'ch-txt', chal));
  const chalOn = new ClassCell(chal, 'show');

  // ══════════ Derecha: Emiliana ══════════
  const rt = h('div', 'hud-anchor hud-right hud-im', hud);
  const emi = h('div', 'hud-emi', rt);
  const ringWrap = h('div', 'emi-ring', emi);
  ringWrap.innerHTML = `<svg viewBox="0 0 100 100" class="ring-svg" aria-hidden="true"><circle cx="50" cy="50" r="46" class="ring-bg" pathLength="100"/><circle cx="50" cy="50" r="46" class="ring-fg" pathLength="100"/></svg>`;
  const emiPortrait = createPortrait('emiliana', ringWrap);
  const concVar = new VarCell(emi, '--conc', 0.005);
  const blushVar = new VarCell(emiPortrait, '--blush', 0.02);
  const emiCrisisFace = new ClassCell(emiPortrait, 'crisis');
  const emiHappy = new ClassCell(emiPortrait, 'happy');
  const emiLowConc = new ClassCell(emi, 'lowconc');
  const emiCrisis = new ClassCell(emi, 'crisis');
  const concRow = h('div', 'emi-row conc', emi);
  fromHtml(ICONS.lens, 'er-ic', concRow);
  h('span', 'er-lbl', concRow, 'Concentración');
  const concVal = new NumCell(h('b', 'er-val', concRow), (v) => String(Math.round(v)), 1);
  const resRow = h('div', 'emi-row res', emi);
  const padlock = fromHtml(heartPadlockSvg(), 'er-lock', resRow);
  const resVar = new VarCell(padlock, '--fill', 0.005);
  h('span', 'er-lbl', resRow, 'Reserva');
  const resVal = new NumCell(h('b', 'er-val', resRow), (v) => String(Math.round(v)), 1);
  const emiChips = h('div', 'emi-chips', emi);
  const chipCrisis = h('span', 'emi-chip crisis', emiChips);
  fromHtml(ICONS.brokenHeart, '', chipCrisis);
  const chipCrisisTxt = new NumCell(h('span', '', chipCrisis), (v) => `Micro-crisis ${Math.ceil(v)} s`, 1);
  const chipCrisisOn = new ClassCell(chipCrisis, 'show');
  const chipSereno = h('span', 'emi-chip sereno', emiChips);
  fromHtml(ICONS.heart, '', chipSereno);
  const chipSerenoTxt = new NumCell(h('span', '', chipSereno), (v) => `Pulso Sereno ${Math.ceil(v)} s`, 1);
  const chipSerenoOn = new ClassCell(chipSereno, 'show');
  const chipFirm = h('span', 'emi-chip firm', emiChips);
  fromHtml(ICONS.hand, '', chipFirm);
  h('span', '', chipFirm, 'Pulso Firme');
  const chipFirmOn = new ClassCell(chipFirm, 'show');
  const chipTremor = h('span', 'emi-chip tremor', emiChips);
  fromHtml(ICONS.zigzag, '', chipTremor);
  h('span', '', chipTremor, 'Temblor');
  const chipTremorOn = new ClassCell(chipTremor, 'show');

  // ══════════ Abajo izquierda: equipo ══════════
  const bl = h('div', 'hud-anchor hud-bl hud-im', hud);
  const crewBox = h('div', 'hud-crew', bl);
  interface CrewCard {
    id: AssistantId | null;
    el: HTMLElement;
    name: TextCell;
    key: TextCell;
    state: EnumClassCell<AssistantVisualState>;
    stateIcon: HTMLElement;
    stateTxt: TextCell;
    morale: VarCell;
    moraleLow: ClassCell;
    problem: ClassCell;
    lastState: AssistantVisualState | null;
    avatarWrap: HTMLElement;
  }
  const crewCards: CrewCard[] = [];
  for (let i = 0; i < 3; i++) {
    const el = h('div', 'crew-card', crewBox);
    const avatarWrap = h('div', 'cc-av', el);
    const info = h('div', 'cc-info', el);
    const top = h('div', 'cc-top', info);
    const name = new TextCell(h('b', 'cc-name', top));
    const keyEl = h('span', 'k-key cc-key', top);
    const stateEl = h('div', 'cc-state', info);
    const stateIcon = h('span', 'cc-sic', stateEl);
    const stateTxt = new TextCell(h('span', 'cc-stxt', stateEl));
    const mor = h('div', 'cc-morale', info);
    fromHtml(ICONS.heart, 'cc-mic', mor);
    const morBar = h('div', 'cc-mbar', mor);
    h('i', '', morBar);
    fromHtml(ICONS.alert, 'cc-problem', el);
    crewCards.push({
      id: null,
      el,
      name,
      key: new TextCell(keyEl),
      state: new EnumClassCell(el, 'st-'),
      stateIcon,
      stateTxt,
      morale: new VarCell(morBar, '--m', 0.01),
      moraleLow: new ClassCell(el, 'lowmorale'),
      problem: new ClassCell(el, 'problem'),
      lastState: null,
      avatarWrap,
    });
  }
  const legend = h('div', 'crew-legend', bl);
  legend.innerHTML =
    '<span><i class="lg-tap"></i>toca: <b>amable</b></span><span><i class="lg-hold"></i>mantén: <b>Dómina</b></span><span class="lg-firm"><i class="lg-dbl"></i>doble toque: <b>Voz Firme y Dulce</b></span>';

  // ══════════ Abajo centro: subtítulos, medidores, barra de instrumental ══════════
  const bc = h('div', 'hud-anchor hud-bc', hud);
  const subsBox = h('div', 'hud-subs', bc);
  const gaugesBox = h('div', 'hud-gauges hud-im', bc);
  const barRow = h('div', 'hud-barrow hud-im', bc);
  const pressure = h('div', 'hud-pressure', barRow);
  h('div', 'pr-lbl', pressure, 'Presión');
  const pips = h('div', 'pr-pips', pressure);
  const pipCells: ClassCell[] = [];
  for (let i = 0; i < 5; i++) {
    const p = h('i', `pip p${i + 1}`, pips);
    pipCells.push(new ClassCell(p, 'on'));
  }
  const prHint = h('div', 'pr-hint', pressure);
  prHint.innerHTML = '<span class="wheel"></span> rueda';
  const hotbar = h('div', 'hud-hotbar', barRow);
  const chips = h('div', 'hud-chips', barRow);
  const carmChip = h('span', 'hud-chip carm', chips);
  fromHtml(ICONS.xray, '', carmChip);
  const carmTxt = new NumCell(h('span', '', carmChip), (v) => `Arco en C · ${Math.round(v)}`, 1);
  h('span', 'k-key', carmChip, 'R');
  const carmOn = new ClassCell(carmChip, 'show');
  const carmEmpty = new ClassCell(carmChip, 'empty');
  const microChip = h('span', 'hud-chip micro', chips);
  fromHtml(ICONS.lens, '', microChip);
  h('span', '', microChip, 'MICRO ×3');
  const microOn = new ClassCell(microChip, 'show');
  const lampChip = h('span', 'hud-chip lamp', chips);
  fromHtml(ICONS.bulb, '', lampChip);
  h('span', '', lampChip, 'Poca luz');
  h('span', 'k-key', lampChip, 'L');
  h('span', 'lamp-sub', lampChip, 'lámpara');
  const lampOn = new ClassCell(lampChip, 'show');

  interface Slot {
    el: HTMLElement;
    active: ClassCell;
    cont: ClassCell;
  }
  let slots: Slot[] = [];
  let slotIds: InstrumentId[] = [];
  let slotNames: Record<string, string> | null = null;

  interface GaugeView {
    id: string;
    el: HTMLElement;
    fill: VarCell;
    marker: VarCell;
    val: NumCell;
    /** Medidor de conteo (mín., máx. y valores enteros): se muestra sin decimales hasta ver un valor fraccionario. */
    integral: boolean;
    valEl: HTMLElement;
    fmtFrac: (v: number) => string;
    q: number;
    zone: EnumClassCell<'good' | 'warn' | 'bad' | 'none'>;
    zoneIcon: HTMLElement;
    lastZone: string;
    zonesSig: string;
    zonesBox: HTMLElement;
  }
  let gaugeViews: GaugeView[] = [];

  // ══════════ Abajo derecha: reloj + mensaje ══════════
  const br = h('div', 'hud-anchor hud-br', hud);
  const msgCard = h('div', 'hud-msg', br);
  const msgHearts = h('div', 'msg-hearts', msgCard);
  for (let i = 0; i < 6; i++) fromHtml(ICONS.heart, `mh h${i}`, msgHearts);
  const msgHead = h('div', 'msg-head', msgCard);
  fromHtml(ICONS.heart, 'msg-hic', msgHead);
  h('span', '', msgHead, 'Mensaje nuevo');
  const msgTxt = new TextCell(h('div', 'msg-txt', msgCard));
  const msgOn = new ClassCell(msgCard, 'show');
  const watch = h('div', 'hud-watch', br);
  h('i', 'w-strap top', watch);
  h('i', 'w-strap bot', watch);
  const face = h('div', 'w-face', watch);
  face.innerHTML = `<svg viewBox="0 0 100 100" class="w-ring" aria-hidden="true"><circle cx="50" cy="50" r="44" class="wr-bg" pathLength="100"/><circle cx="50" cy="50" r="44" class="wr-fg" pathLength="100"/></svg>`;
  const wHeart = fromHtml(ICONS.heart, 'w-heart', face);
  const wTime = new NumCell(h('span', 'w-time', face), fmtTime, 1);
  const wSecs = new NumCell(h('span', 'w-secs', face), (v) => `${Math.ceil(v)} s`, 1);
  const wLabel = h('div', 'w-label', watch);
  wLabel.innerHTML = '<span class="k-key">F</span> leer';
  const wStored = new NumCell(h('span', 'w-stored', watch), (v) => `${Math.round(v)}`, 1);
  const wStoredOn = new ClassCell(watch, 'stored');
  const wRing = new VarCell(watch, '--wr', 0.005);
  const wPending = new ClassCell(watch, 'pending');
  let pendingTotal = 20;
  let wasPending = false;
  void wHeart;

  // ══════════ Capas sueltas ══════════
  const popsBox = h('div', 'hud-pops', hud);
  const minigame = h('div', 'hud-minigame', hud);

  // ── Estado temporal ──
  const alerts = createAlertQueue();
  let alertVersion = -1;
  const alertSlots = [0, 1].map(() => {
    const el = h('div', 'hud-alert', alertsBox);
    const ic = h('span', 'al-ic', el);
    const txt = new TextCell(h('span', 'al-txt', el));
    return { el, ic, txt, kind: new EnumClassCell<AlertKind>(el, 'al-'), on: new ClassCell(el, 'show'), iconKind: '' as string, id: -1 };
  });
  const subs: Timed[] = [];
  const toasts: Timed[] = [];
  const pops: Timed[] = [];
  let lastT = now();
  const immersive = new ClassCell(hud, 'immersive');
  let visible = true;
  let disposed = false;
  const isNum = Number.isFinite;

  // ── Construcción de segmentos / checklist / ranuras / medidores ──
  function rebuildSegments(phases: HudModel['progress']['phases']) {
    progBar.textContent = '';
    segs = phases.map((p, i) => {
      const el = h('div', 'seg', progBar);
      el.style.flexGrow = String(Math.max(1, p.weight));
      el.style.flexBasis = '0';
      const track = h('div', 'seg-track', el);
      h('i', 'seg-fill', track);
      fromHtml(ICONS.check, 'seg-check', track);
      h('span', 'seg-lbl', el, p.label);
      return { el, fill: new VarCell(el, '--f', 0.004), done: new ClassCell(el, 'done'), active: new ClassCell(el, 'active'), label: p.label, weight: p.weight };
    });
  }
  function segmentsChanged(phases: HudModel['progress']['phases']) {
    if (phases.length !== segs.length) return true;
    for (let i = 0; i < phases.length; i++) if (phases[i].label !== segs[i].label || phases[i].weight !== segs[i].weight) return true;
    return false;
  }
  function checklistChanged(items: ChecklistItem[]) {
    if (items.length !== checkState.labels.length) return true;
    for (let i = 0; i < items.length; i++) if (items[i].label !== checkState.labels[i] || items[i].done !== checkState.done[i]) return true;
    return false;
  }
  function rebuildChecklist(items: ChecklistItem[]) {
    checkRow.textContent = '';
    checkState.labels.length = 0;
    checkState.done.length = 0;
    for (const it of items) {
      const el = h('span', `chk${it.done ? ' done' : ''}`, checkRow);
      fromHtml(it.done ? ICONS.check : '', 'chk-box', el);
      h('span', 'chk-lbl', el, it.label);
      checkState.labels.push(it.label);
      checkState.done.push(it.done);
    }
  }
  function slotsChanged(ids: InstrumentId[], names: Record<string, string>) {
    if (names !== slotNames) {
      // Los nombres rara vez cambian; comparación superficial por contenido.
      if (!slotNames) return true;
      for (const id of ids) if (names[id] !== slotNames[id]) return true;
    }
    if (ids.length !== slotIds.length) return true;
    for (let i = 0; i < ids.length; i++) if (ids[i] !== slotIds[i]) return true;
    return false;
  }
  function rebuildSlots(ids: InstrumentId[], names: Record<string, string>) {
    hotbar.textContent = '';
    slotIds = ids.slice();
    slotNames = { ...names };
    slots = ids.map((id, i) => {
      const el = h('div', 'slot', hotbar);
      h('i', 'slot-bar', el);
      h('span', 'slot-key', el, String(i + 1));
      fromHtml(instrumentIcon(id), 'slot-ic', el);
      h('span', 'slot-name', el, names[id] ?? id);
      h('span', 'slot-cont', el, 'Contaminado');
      return { el, active: new ClassCell(el, 'active'), cont: new ClassCell(el, 'contaminated') };
    });
  }
  function zoneOf(g: Gauge): 'good' | 'warn' | 'bad' | 'none' {
    if (!g.zones) return 'none';
    for (const z of g.zones) if (g.value >= z.from && g.value <= z.to) return z.kind;
    return 'none';
  }
  function zonesSig(g: Gauge) {
    if (!g.zones) return `${g.min}|${g.max}`;
    let s = `${g.min}|${g.max}`;
    for (const z of g.zones) s += `|${z.from},${z.to},${z.kind}`;
    return s;
  }
  function renderZones(box: HTMLElement, g: Gauge) {
    box.textContent = '';
    const span = g.max - g.min || 1;
    for (const z of g.zones ?? []) {
      const el = h('i', `gz ${z.kind}`, box);
      el.style.left = `${((clamp(z.from, g.min, g.max) - g.min) / span) * 100}%`;
      el.style.width = `${((clamp(z.to, g.min, g.max) - clamp(z.from, g.min, g.max)) / span) * 100}%`;
    }
  }
  function rebuildGauges(gs: Gauge[]) {
    gaugesBox.textContent = '';
    gaugeViews = gs.map((g) => {
      const el = h('div', 'gauge', gaugesBox);
      const head = h('div', 'g-head', el);
      const zoneIcon = h('span', 'g-zic', head);
      h('span', 'g-lbl', head, g.label);
      const valEl = h('b', 'g-val', head);
      const track = h('div', 'g-track', el);
      const zonesBox = h('div', 'g-zones', track);
      renderZones(zonesBox, g);
      h('i', 'g-fill', track);
      h('i', 'g-marker', track);
      const range = Math.abs(g.max - g.min) || 1;
      const q = range >= 50 ? 1 : range >= 5 ? 0.1 : 0.01;
      const digits = q === 1 ? 0 : q === 0.1 ? 1 : 2;
      const unit = g.unit ? ` ${g.unit}` : '';
      const integral = Number.isInteger(g.min) && Number.isInteger(g.max) && Number.isInteger(g.value);
      const fmtFrac = (v: number) => `${fmtDec(v, digits)}${unit}`;
      return {
        id: g.id,
        el,
        fill: new VarCell(el, '--gf', 0.004),
        marker: new VarCell(el, '--gm', 0.004),
        val: integral ? new NumCell(valEl, (v) => `${fmtDec(v, 0)}${unit}`, 1) : new NumCell(valEl, fmtFrac, q),
        integral,
        valEl,
        fmtFrac,
        q,
        zone: new EnumClassCell(el, 'z-'),
        zoneIcon,
        lastZone: '',
        zonesSig: zonesSig(g),
        zonesBox,
      };
    });
  }
  function gaugesChanged(gs: Gauge[]) {
    if (gs.length !== gaugeViews.length) return true;
    for (let i = 0; i < gs.length; i++) if (gs[i].id !== gaugeViews[i].id) return true;
    return false;
  }

  function renderAlerts() {
    const vis = alerts.visible();
    for (let i = 0; i < alertSlots.length; i++) {
      const s = alertSlots[i];
      const a = vis[i];
      if (!a) {
        s.on.set(false);
        s.id = -1;
        continue;
      }
      if (s.iconKind !== a.kind) {
        s.ic.innerHTML = ICONS[ALERT_ICON[a.kind]];
        s.iconKind = a.kind;
      }
      s.kind.set(a.kind);
      s.txt.set(a.text);
      s.on.set(true);
      if (s.id !== a.id) {
        // Reinicia la animación de entrada.
        s.id = a.id;
        s.el.style.animation = 'none';
        void s.el.offsetWidth;
        s.el.style.animation = '';
      }
    }
  }

  function expire(list: Timed[], t: number) {
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].until <= t) {
        list[i].el.remove();
        list.splice(i, 1);
      }
    }
  }

  const api: SurgeryHudAPI = {
    update(m: HudModel) {
      if (disposed) return;
      const t = now();
      const dt = clamp(t - lastT, 0, 0.1);
      lastT = t;
      immersive.set(m.immersive);

      // Monitor
      const v = m.vitals;
      const noSig = !isNum(v.hr);
      const rhythm: EcgRhythm = noSig ? 'noSignal' : monitorRhythm(v.rhythm, v.arrest, cprDisplay.rhythm);
      ecg.step(dt, noSig ? 0 : v.hr, rhythm);
      monNoSig.set(noSig);
      monArrest.set(v.arrest || rhythm === 'vfib' || rhythm === 'asystole');
      rhythmLbl.set(RHYTHM_LABEL[rhythm]);
      for (const c of vitalCells) {
        const val = v[c.def.field] as number;
        c.val.set(val);
        c.nan.set(!isNum(val));
        c.alarm.set(isNum(val) && v.alarms.includes(c.def.key));
      }

      // Éxito
      const ex = clamp(isNum(v.exito) ? v.exito : 0, 0, 100);
      exitoVal.set(ex);
      exFill.set(ex / 100);
      exitoBar.set(ex / 100);
      exLow.set(ex < 25);
      exBroken.set(ex <= 0 || v.arrest);
      exBeat.set(isNum(v.hr) && v.hr > 20 ? clamp(60 / v.hr, 0.25, 2) : 1.2);

      // Campo
      const f = m.field;
      fieldFill.set(clamp(f.levelPct, 0, 100) / 100);
      floodPos.set(`${clamp(f.floodThresholdPct, 0, 100)}%`);
      floodTxt.set(`${Math.round(f.floodThresholdPct)} %`);
      fieldVal.set(f.levelPct);
      fieldFlood.set(f.levelPct >= f.floodThresholdPct);
      fieldWarn.set(f.levelPct >= f.floodThresholdPct * 0.7);
      rodOn.set(f.rodrigoSuctioning);
      rodTxt.set(f.rodrigoSuctioning ? 'Rodrigo aspira' : 'Sin aspiración');

      // Progreso
      const p = m.progress;
      if (segmentsChanged(p.phases)) rebuildSegments(p.phases);
      let acc = 0;
      let activeIdx = -1;
      for (let i = 0; i < p.phases.length; i++) {
        const ph = p.phases[i];
        const s = segs[i];
        s.done.set(ph.done);
        s.active.set(ph.active);
        if (ph.active) activeIdx = i;
        const within = ph.done ? 1 : ph.active ? clamp((p.totalPct - acc) / Math.max(1, ph.weight), 0, 1) : 0;
        s.fill.set(within);
        acc += ph.weight;
      }
      phaseName.set(activeIdx >= 0 ? `Fase ${activeIdx + 1} · ${p.phaseLabel}` : p.phaseLabel);
      stepName.set(p.stepLabel);
      progPct.set(p.totalPct);
      if (checklistChanged(p.checklist)) rebuildChecklist(p.checklist);
      hintTxt.set(p.hint);
      hintEmpty.set(!p.hint);
      timerElapsed.set(m.timer.elapsedSec);
      timerTarget.set(m.timer.targetSec);
      const over = m.timer.elapsedSec > m.timer.targetSec;
      if (timerOver.set(over)) timerIcon.innerHTML = over ? ICONS.hourglass : ICONS.clock;

      // Valerio
      const val = m.valerio;
      gazing.set(val.gazing);
      gazeOn.set(val.gazing);
      bubbleOn.set(!!val.line);
      if (val.line) bubbleTxt.set(val.line);
      rankHidden.set(val.hidden);
      rankLetter.set(val.hidden ? '' : (val.provisionalRank ?? '?'));
      rankCls.set(val.provisionalRank ?? 'none');
      chalOn.set(!!m.challenge);
      if (m.challenge) chalTxt.set(m.challenge);

      // Emiliana
      const e = m.emiliana;
      concVar.set(clamp(e.concentration, 0, 100) / 100);
      concVal.set(e.concentration);
      resVar.set(clamp(e.reserve, 0, 100) / 100);
      resVal.set(e.reserve);
      blushVar.set(clamp(e.blush, 0, 1));
      emiCrisisFace.set(e.crisis);
      emiCrisis.set(e.crisis);
      emiHappy.set(!e.crisis && (e.serenoLeft > 0 || e.blush > 0.35));
      emiLowConc.set(e.concentration < 40);
      chipCrisisOn.set(e.crisis);
      if (e.crisis) chipCrisisTxt.set(Math.ceil(Math.max(0, e.crisisLeft)));
      chipSerenoOn.set(e.serenoLeft > 0);
      if (e.serenoLeft > 0) chipSerenoTxt.set(Math.ceil(e.serenoLeft));
      chipFirmOn.set(e.precision);
      chipTremorOn.set(e.concentration < 40 && e.serenoLeft <= 0 && !e.crisis);

      // Reloj y mensaje
      const msg = e.message;
      if (msg.pending && !wasPending) pendingTotal = Math.max(1, msg.secondsLeft);
      wasPending = msg.pending;
      wPending.set(msg.pending);
      wRing.set(msg.pending ? clamp(msg.secondsLeft / pendingTotal, 0, 1) : 0);
      if (msg.pending) wSecs.set(Math.ceil(msg.secondsLeft));
      else wTime.set(m.timer.elapsedSec);
      wStoredOn.set(msg.stored > 0);
      wStored.set(msg.stored);
      const showMsg = msg.showing && !!msg.text;
      msgOn.set(showMsg);
      if (showMsg) msgTxt.set(msg.text!);

      // Equipo
      for (let i = 0; i < crewCards.length; i++) {
        const card = crewCards[i];
        const c = m.crew[i];
        card.el.style.display = c ? '' : 'none';
        if (!c) continue;
        if (card.id !== c.id) {
          card.id = c.id;
          card.avatarWrap.textContent = '';
          createPortrait(c.id, card.avatarWrap);
          card.key.set(ASSISTANT_KEY[c.id]);
          card.el.dataset.id = c.id;
        }
        card.name.set(c.name);
        card.state.set(c.state);
        if (card.lastState !== c.state) {
          card.lastState = c.state;
          card.stateIcon.innerHTML = ICONS[STATE_ICON[c.state]];
        }
        card.stateTxt.set(c.id === 'gigi' ? GIGI_LABEL[c.state] ?? STATE_LABEL[c.state] : STATE_LABEL[c.state]);
        card.morale.set(clamp(c.morale, 0, 100) / 100);
        card.moraleLow.set(c.morale < 35);
        card.problem.set(c.problem);
      }

      // Instrumental
      const ins = m.instruments;
      if (slotsChanged(ins.slots, ins.names)) rebuildSlots(ins.slots, ins.names);
      for (let i = 0; i < slots.length; i++) {
        slots[i].active.set(slotIds[i] === ins.active);
        slots[i].cont.set(ins.contaminated.includes(slotIds[i]));
      }

      // Medidores
      if (gaugesChanged(m.gauges)) rebuildGauges(m.gauges);
      for (let i = 0; i < gaugeViews.length; i++) {
        const g = m.gauges[i];
        const gv = gaugeViews[i];
        const sig = g.zones ? zonesSig(g) : `${g.min}|${g.max}`;
        if (sig !== gv.zonesSig) {
          gv.zonesSig = sig;
          renderZones(gv.zonesBox, g);
        }
        const span = g.max - g.min || 1;
        const n = clamp((g.value - g.min) / span, 0, 1);
        gv.fill.set(n);
        gv.marker.set(n);
        if (gv.integral && !Number.isInteger(g.value)) {
          // Era continuo: pasa a decimales para siempre (sin parpadeo entre formatos)
          gv.integral = false;
          gv.val = new NumCell(gv.valEl, gv.fmtFrac, gv.q);
        }
        gv.val.set(g.value);
        const z = zoneOf(g);
        gv.zone.set(z);
        if (gv.lastZone !== z) {
          gv.lastZone = z;
          gv.zoneIcon.innerHTML = ICONS[ZONE_ICON[z]];
        }
      }

      // Presión y avisos pequeños
      const pr = clamp(Math.round(m.pressure), 1, 5);
      for (let i = 0; i < 5; i++) pipCells[i].set(i < pr);
      carmOn.set(m.carmShotsLeft !== null);
      if (m.carmShotsLeft !== null) {
        carmTxt.set(m.carmShotsLeft);
        carmEmpty.set(m.carmShotsLeft <= 0);
      }
      microOn.set(m.microMode);
      lampOn.set(m.lightLevel < 0.5);

      // Tiempos: alertas, subtítulos, avisos, textos flotantes
      // La alerta del equipo dura lo que dure el problema (solo, selfie, temblor, Panchito), no un temporizador fijo
      let crewProblem = false;
      for (let i = 0; i < m.crew.length; i++) if (m.crew[i].problem) crewProblem = true;
      alerts.hold('crew', crewProblem, t);
      if (alerts.update(t) || alerts.version !== alertVersion) {
        alertVersion = alerts.version;
        renderAlerts();
      }
      expire(subs, t);
      expire(toasts, t);
      expire(pops, t);
    },

    toast(text, kind = 'info') {
      const el = h('div', `hud-toast t-${kind}`, toastsBox);
      fromHtml(ICONS[TOAST_ICON[kind]], 'tt-ic', el);
      h('span', '', el, text);
      toasts.push({ el, until: now() + 2.8 });
      while (toasts.length > 3) toasts.shift()!.el.remove();
    },

    subtitle(speaker: SpeakerId, text: string, durationSec?: number) {
      if (!settings.subtitles && speaker !== 'sistema') return;
      const el = h('div', `hud-sub sp-${speaker}`, subsBox);
      el.style.setProperty('--sp', SPEAKER_COLOR[speaker] ?? '#fff');
      h('b', 'sub-who', el, SPEAKER_NAME[speaker] ?? speaker);
      h('span', 'sub-txt', el, text);
      subs.push({ el, until: now() + (durationSec ?? readingSeconds(text)) });
      while (subs.length > 2) subs.shift()!.el.remove();
    },

    alert(kind, text) {
      alerts.push(kind, text, now());
      alertVersion = -1; // fuerza el repintado en el próximo update
    },

    minigameLayer() {
      return minigame;
    },

    popText(text, screen, kind) {
      const r = hud.getBoundingClientRect();
      const el = h('div', `hud-pop pop-${kind}`, popsBox);
      fromHtml(ICONS[POP_ICON[kind]], 'pop-ic', el);
      h('span', '', el, text);
      el.style.left = `${screen.x - r.left}px`;
      el.style.top = `${screen.y - r.top}px`;
      pops.push({ el, until: now() + 1.3 });
      while (pops.length > 8) pops.shift()!.el.remove();
    },

    setVisible(v) {
      visible = v;
      hud.style.display = visible ? '' : 'none';
    },

    dispose() {
      disposed = true;
      ro?.disconnect();
      if (!ro && typeof window !== 'undefined') window.removeEventListener('resize', applyScale);
      hud.remove();
    },
  };
  return api;
}
