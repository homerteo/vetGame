/**
 * Página de desarrollo del HUD: modelo falso animado (constantes que fluctúan,
 * progreso que avanza, campo que se llena, crisis, mensaje pendiente, alertas y popText).
 * ?state=calm|busy|crisis|arrest|nosignal|immersive fija un escenario para capturas.
 */
import { createSurgeryHud } from '../src/ui/SurgeryHud';
import type { Gauge, HudModel, InstrumentId, Settings } from '../src/core/contracts';

const params = new URLSearchParams(location.search);
const state = params.get('state') ?? 'live';

const settings: Settings = {
  difficulty: 'especialista',
  goreLevel: 70,
  pastelMode: params.has('pastel'),
  tremorScale: 1,
  rhythmWindowScale: 1,
  reduceFlashes: params.has('reduce'),
  subtitles: true,
  tts: false,
  masterVolume: 0.8,
  musicVolume: 0.6,
  sfxVolume: 0.8,
  asmrVolume: 0.7,
  immersive: false,
  adaptiveDirector: true,
  colorblind: (params.get('cb') as Settings['colorblind']) ?? 'none',
};

const root = document.getElementById('ui-root')!;
const hud = createSurgeryHud(root, settings);

const names: Record<string, string> = {
  scalpel10: 'Bisturí', cautery: 'Cauterio', gelpi: 'Gelpi', kern: 'Kern', drill: 'Taladro', plate: 'Placa', screwdriver: 'Tornillo',
};
const slots: InstrumentId[] = ['scalpel10', 'cautery', 'gelpi', 'kern', 'drill', 'plate', 'screwdriver'];
const phases = [
  { label: 'Incisión', weight: 15 },
  { label: 'Hemostasia', weight: 15 },
  { label: 'Reducción ósea', weight: 20 },
  { label: 'Placa', weight: 20 },
  { label: 'Tornillos', weight: 15 },
  { label: 'Sutura y vendaje', weight: 15 },
];
const heatGauge: Gauge = { id: 'heat', label: 'Temperatura del hueso', value: 38, min: 30, max: 60, unit: '°C', zones: [
  { from: 30, to: 44, kind: 'good' }, { from: 44, to: 47, kind: 'warn' }, { from: 47, to: 60, kind: 'bad' }] };
const depthGauge: Gauge = { id: 'depth', label: 'Profundidad', value: 4, min: 0, max: 12, unit: 'mm', zones: [
  { from: 0, to: 8, kind: 'good' }, { from: 8, to: 10, kind: 'warn' }, { from: 10, to: 12, kind: 'bad' }] };
const torqueGauge: Gauge = { id: 'torque', label: 'Torque', value: 0.4, min: 0, max: 1, zones: [
  { from: 0, to: 0.55, kind: 'warn' }, { from: 0.55, to: 0.8, kind: 'good' }, { from: 0.8, to: 1, kind: 'bad' }] };

const model: HudModel = {
  caseName: 'Panchito',
  vitals: { hr: 118, spo2: 98, map: 78, etco2: 38, tempC: 37.8, bloodVolumePct: 100, bloodLostPct: 0, exito: 64, arrest: false, rhythm: 'sinus', alarms: [] },
  progress: { phases: phases.map((p) => ({ ...p, done: false, active: false })), totalPct: 0, phaseLabel: '', stepLabel: '', checklist: [], hint: '' },
  field: { levelPct: 12, floodThresholdPct: 70, rodrigoSuctioning: true },
  emiliana: {
    concentration: 78, reserve: 82, crisis: false, crisisLeft: 0, serenoLeft: 0, precision: false, blush: 0,
    message: { pending: false, secondsLeft: 0, text: null, showing: false, stored: 0 },
  },
  crew: [
    { id: 'rodrigo', name: 'Rodrigo', state: 'working', morale: 72, problem: false },
    { id: 'fritz', name: 'Fritz', state: 'ok', morale: 55, problem: false },
    { id: 'gigi', name: 'Gigi', state: 'ok', morale: 80, problem: false },
  ],
  instruments: { slots, active: 'kern', contaminated: [], names },
  valerio: { gazing: false, provisionalRank: 'B', hidden: false, line: null },
  timer: { elapsedSec: 0, targetSec: 480 },
  gauges: [],
  pressure: 3,
  lightLevel: 1,
  immersive: false,
  microMode: false,
  challenge: 'Ni un solo tornillo al suelo, doctora.',
  carmShotsLeft: 3,
};

const checklists: Array<Array<[string, number]>> = [
  [['Piel', 0.3], ['Subcutáneo', 0.6], ['Fascia', 1]],
  [['Sellar 4 sangrados', 0.7], ['Campo < 30 %', 1]],
  [['Reducir fragmento distal', 0.5], ['Aguja de Kirschner temporal', 1]],
  [['Elegir placa', 0.3], ['Contornear (2 dobleces)', 0.7], ['Apoyar placa', 1]],
  [['Atrapar y atornillar 6 tornillos', 1]],
  [['Sutura por capas', 0.7], ['Vendaje', 1]],
];
const hints = [
  'Mantén la presión en 3 y sigue la guía punteada.',
  'Cauteriza 1–2 s sobre cada punto sangrante. ¡Primero el arterial!',
  'Arrastra el fragmento con las pinzas Kern; Q/E para girar.',
  'Elige la placa de 6 agujeros y contornéala con dos dobleces.',
  'Espacio cuando el anillo se cierre sobre el tornillo de Fritz.',
  'Semicírculos regulares que crucen la incisión.',
];

function setProgress(total: number) {
  let acc = 0;
  model.progress.totalPct = total;
  let active = 0;
  for (let i = 0; i < phases.length; i++) {
    const ph = model.progress.phases[i];
    ph.done = total >= acc + phases[i].weight;
    ph.active = !ph.done && total >= acc;
    if (ph.active) active = i;
    acc += phases[i].weight;
  }
  if (model.progress.phases.every((p) => p.done)) active = phases.length - 1;
  let start = 0;
  for (let i = 0; i < active; i++) start += phases[i].weight;
  const within = Math.min(1, (total - start) / phases[active].weight);
  model.progress.phaseLabel = phases[active].label;
  model.progress.stepLabel = checklists[active].find(([, th]) => within < th)?.[0] ?? checklists[active][checklists[active].length - 1][0];
  model.progress.checklist = checklists[active].map(([label, th]) => ({ label, done: within >= th }));
  model.progress.hint = hints[active];
}

function scenario(name: string) {
  const v = model.vitals;
  const e = model.emiliana;
  switch (name) {
    case 'calm':
      setProgress(38);
      model.timer.elapsedSec = 171;
      model.gauges = [];
      model.valerio.line = 'Primum non nocere, doctora. Tómeselo como sugerencia.';
      break;
    case 'busy':
      setProgress(76);
      model.timer.elapsedSec = 402;
      v.hr = 146; v.map = 58; v.spo2 = 93; v.rhythm = 'tachy'; v.alarms = ['hr', 'map']; v.exito = 41;
      model.field.levelPct = 56; model.field.rodrigoSuctioning = false;
      model.crew[0].state = 'distracted'; model.crew[0].problem = true;
      model.crew[2].state = 'filming'; model.crew[2].problem = true;
      model.instruments.active = 'drill'; model.instruments.contaminated = ['screwdriver'];
      model.gauges = [{ ...heatGauge, value: 45.5 }, { ...depthGauge, value: 6.2 }, { ...torqueGauge, value: 0.62 }];
      model.valerio.gazing = true; model.valerio.line = 'Le estoy mirando. Los errores ahora cuentan doble.';
      model.pressure = 4; model.lightLevel = 0.3;
      e.message = { pending: true, secondsLeft: 13, text: null, showing: false, stored: 1 };
      e.concentration = 51;
      break;
    case 'crisis':
      setProgress(55);
      model.timer.elapsedSec = 530;
      v.hr = 168; v.map = 49; v.spo2 = 89; v.etco2 = 29; v.tempC = 36.1; v.rhythm = 'tachy'; v.alarms = ['hr', 'map', 'spo2', 'temp']; v.exito = 18;
      model.field.levelPct = 81;
      e.concentration = 27; e.reserve = 0; e.crisis = true; e.crisisLeft = 2.2;
      model.crew[1].state = 'trembling'; model.crew[1].problem = true; model.crew[1].morale = 22;
      model.instruments.active = 'plate';
      model.gauges = [{ ...heatGauge, value: 49 }];
      model.valerio.provisionalRank = 'C';
      model.carmShotsLeft = 0;
      model.microMode = true;
      break;
    case 'arrest':
      setProgress(61);
      model.timer.elapsedSec = 600;
      Object.assign(v, { hr: 0, map: 12, spo2: 71, etco2: 8, exito: 0, arrest: true, rhythm: 'vfib', alarms: ['hr', 'map', 'spo2', 'etco2'] });
      model.field.levelPct = 74;
      e.concentration = 35;
      model.valerio.provisionalRank = 'B';
      break;
    case 'nosignal':
      setProgress(22);
      model.timer.elapsedSec = 150;
      Object.assign(v, { hr: Number.NaN, spo2: Number.NaN, map: Number.NaN, etco2: Number.NaN, tempC: Number.NaN, alarms: [] });
      e.message = { pending: false, secondsLeft: 0, text: 'Buena niña. Esa sutura va a salir preciosa, como tú. — {Sam}'.replace('{Sam}', 'Sam'), showing: true, stored: 0 };
      e.blush = 0.9; e.serenoLeft = 8.4;
      model.valerio.hidden = true;
      model.challenge = null;
      break;
    case 'immersive':
      setProgress(48);
      model.immersive = true;
      break;
  }
}

if (state !== 'live') scenario(state);
else setProgress(0);

// Eventos puntuales de ejemplo (también en capturas).
function demoEvents() {
  if (state === 'busy') {
    hud.alert('arterial', '¡Sangrado arterial! Cauteriza ya');
    hud.alert('crew', 'Gigi está grabando: la luz cae');
    hud.alert('comment', 'Valerio anota algo en su libreta…');
    hud.subtitle('rodrigo', '¡Aspiración en re menor, jefa!');
    hud.subtitle('gigi', '¡Hola, mis huesitos! Hoy toca placa bloqueada, ¿sí?');
    hud.popText('¡Perfecto!', { x: innerWidth * 0.46, y: innerHeight * 0.42 }, 'perfect');
    hud.popText('Bien', { x: innerWidth * 0.58, y: innerHeight * 0.55 }, 'good');
    hud.toast('Tornillo contaminado: −15 HC', 'bad');
  } else if (state === 'crisis') {
    hud.alert('boneHeat', 'Hueso a 49 °C: ¡irriga!');
    hud.alert('flood', 'Campo inundado: pide aspiración');
    hud.subtitle('emiliana', 'Fritz… perdón. Perdón. Dame un segundo.');
    hud.popText('Fallo', { x: innerWidth * 0.5, y: innerHeight * 0.45 }, 'miss');
    hud.toast('Micro-crisis: −15 Concentración', 'bad');
  } else if (state === 'arrest') {
    hud.alert('arrest', '¡PARO CARDÍACO! Prepara la RCP');
    hud.alert('info', 'Adrenalina lista en el carro');
    hud.subtitle('valerio', 'Doctora, el paciente no espera por su estética.');
  } else if (state === 'calm') {
    hud.subtitle('fritz', 'T-t-tornillo de 2,7… ¡no, no, no! Ah, sí. Aquí está.');
    hud.toast('Hemorragia arterial controlada +4', 'good');
    hud.popText('¡Perfecto!', { x: innerWidth * 0.52, y: innerHeight * 0.48 }, 'perfect');
  } else if (state === 'nosignal') {
    hud.alert('info', 'Don Braulio envolvió el monitor en aluminio');
    hud.subtitle('braulio', 'Ese tornillo lleva chip, doctora. Yo lo sé.');
  } else if (state === 'immersive') {
    hud.subtitle('valerio', 'Modo inmersivo. Qué valiente.');
    hud.alert('arterial', '¡Sangrado arterial!');
  }
}
setTimeout(demoEvents, 300);
if (state !== 'live') setInterval(demoEvents, 2000);

// Animación continua
let t0 = performance.now();
let lastAlert = 0;
function frame(nowMs: number) {
  const t = (nowMs - t0) / 1000;
  const v = model.vitals;
  if (state === 'live') {
    const total = Math.min(100, t * 2.2);
    setProgress(total);
    model.timer.elapsedSec = t * 8;
    const stress = Math.max(0, Math.sin(t * 0.25));
    v.hr = 112 + stress * 50 + Math.sin(t * 1.3) * 3;
    v.map = 80 - stress * 28;
    v.spo2 = 98 - stress * 7;
    v.etco2 = 38 - stress * 6;
    v.tempC = 37.8 - t * 0.01;
    v.rhythm = v.hr > 140 ? 'tachy' : 'sinus';
    v.alarms = [];
    if (v.hr > 140) v.alarms.push('hr');
    if (v.map < 60) v.alarms.push('map');
    if (v.spo2 < 93) v.alarms.push('spo2');
    v.exito = 70 - stress * 55;
    model.field.levelPct = 20 + stress * 65;
    model.field.rodrigoSuctioning = Math.sin(t * 0.7) > -0.3;
    model.emiliana.concentration = 80 - stress * 50;
    model.emiliana.reserve = Math.max(0, 90 - t * 2.5);
    model.emiliana.crisis = model.emiliana.reserve <= 0;
    model.emiliana.crisisLeft = 3 - (t % 3);
    const mt = t % 30;
    model.emiliana.message.pending = mt > 6 && mt < 20;
    model.emiliana.message.secondsLeft = 20 - (mt - 6) * (20 / 14);
    model.emiliana.message.showing = mt >= 20 && mt < 26;
    model.emiliana.message.text = 'Buena niña. Respira: nadie cose como tú. — Sam';
    model.emiliana.blush = model.emiliana.message.showing ? 1 - (mt - 20) / 6 : 0;
    model.emiliana.serenoLeft = model.emiliana.message.showing ? 26 - mt + 4 : 0;
    model.valerio.gazing = Math.sin(t * 0.4) > 0.6;
    model.valerio.line = model.valerio.gazing ? 'Le observo, doctora. Sin presión.' : null;
    model.valerio.provisionalRank = v.exito > 60 ? 'A' : v.exito > 40 ? 'B' : 'C';
    model.crew[0].problem = !model.field.rodrigoSuctioning;
    model.crew[0].state = model.field.rodrigoSuctioning ? 'working' : 'distracted';
    model.crew[2].state = model.lightLevel < 0.5 ? 'filming' : 'ok';
    model.lightLevel = Math.sin(t * 0.33) > 0.7 ? 0.2 : 1;
    model.crew[2].problem = model.lightLevel < 0.5;
    model.pressure = 1 + Math.floor((t * 0.8) % 5);
    heatGauge.value = 38 + ((t * 2) % 16);
    model.gauges = total > 50 && total < 85 ? [heatGauge, torqueGauge] : [];
    torqueGauge.value = (t * 0.3) % 1;
    model.instruments.active = slots[Math.floor(t / 4) % slots.length];
    if (t - lastAlert > 5) {
      lastAlert = t;
      const k = Math.floor(t / 5) % 4;
      if (k === 0) hud.alert('arterial', '¡Sangrado arterial! Cauteriza ya');
      if (k === 1) hud.alert('crew', 'Rodrigo se marcó un solo de guitarra');
      if (k === 2) hud.alert('comment', 'Valerio: «Interesante técnica… para 1998».');
      if (k === 3) hud.alert('boneHeat', 'Hueso a 47 °C: ¡irriga!');
      hud.subtitle(k % 2 ? 'rodrigo' : 'valerio', k % 2 ? '¡Eso es rock, jefa!' : 'Tómeselo como sugerencia.');
      hud.popText(k % 2 ? 'Bien' : '¡Perfecto!', { x: innerWidth * (0.4 + 0.05 * k), y: innerHeight * 0.5 }, k % 2 ? 'good' : 'perfect');
    }
  } else if (!Number.isNaN(v.hr) && !v.arrest) {
    // Fluctuación suave en escenarios fijos
    v.hr += Math.sin(t * 2) * 0.05;
  }
  hud.update(model);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

addEventListener('keydown', (e) => {
  if (e.code === 'KeyA') hud.alert('arrest', '¡PARO CARDÍACO!');
  if (e.code === 'KeyP') hud.popText('¡Perfecto!', { x: innerWidth / 2, y: innerHeight / 2 }, 'perfect');
  if (e.code === 'KeyT') hud.toast('Clip viral: +0,1 de reputación', 'good');
  if (e.code === 'KeyS') hud.subtitle('hortensia', '¡Merengue es lo único que me queda!');
  if (e.code === 'KeyI') model.immersive = !model.immersive;
});

(window as unknown as { __hud: unknown }).__hud = { hud, model };
