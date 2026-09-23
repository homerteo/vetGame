/*
 * Banco de pruebas del audio procedural: todos los efectos, bucles con sus parámetros,
 * estados de música con el reloj de pulso, simulador de constantes y voces TTS.
 * Espacio = prueba de ritmo (desfase respecto al pulso). "Calibrar" mide pico/RMS offline.
 */
import type { LoopHandle, LoopSfxName, MusicState, Settings, SfxName, SpeakerId, VitalsSnapshot } from '../src/core/contracts';
import { createAudioEngine } from '../src/audio/AudioEngine';
import { LOOP_NAMES, type LoopParam } from '../src/audio/loops';
import { spo2ToPitch } from '../src/audio/Monitor';
import { SFX, SFX_META, SFX_NAMES } from '../src/audio/sfx';
import { MUSIC_STATES, SONGS } from '../src/audio/songs';
import { createSynth } from '../src/audio/synth';
import { createBeatClock } from '../src/audio/BeatClock';
import { LOOPS } from '../src/audio/loops';
import { createMusic } from '../src/audio/Music';
import { BUS_BASE } from '../src/audio/AudioEngine';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const audio = createAudioEngine();
(window as unknown as { __audio: typeof audio }).__audio = audio;

// ───────── Ajustes ─────────
const settings: Settings = {
  difficulty: 'especialista',
  goreLevel: 60,
  pastelMode: false,
  tremorScale: 1,
  rhythmWindowScale: 1,
  reduceFlashes: false,
  subtitles: true,
  tts: true,
  masterVolume: 0.8,
  musicVolume: 0.7,
  sfxVolume: 0.9,
  asmrVolume: 0.8,
  immersive: false,
  adaptiveDirector: true,
  colorblind: 'none',
};
const volIds: Array<[string, keyof Settings]> = [
  ['vMaster', 'masterVolume'],
  ['vMusic', 'musicVolume'],
  ['vSfx', 'sfxVolume'],
  ['vAsmr', 'asmrVolume'],
];
for (const [id, key] of volIds) {
  $<HTMLInputElement>(id).addEventListener('input', (e) => {
    (settings as unknown as Record<string, number>)[key] = Number((e.target as HTMLInputElement).value);
    audio.applySettings(settings);
  });
}
$<HTMLInputElement>('tts').addEventListener('change', (e) => {
  settings.tts = (e.target as HTMLInputElement).checked;
  audio.applySettings(settings);
});
audio.applySettings(settings);

async function unlock() {
  await audio.unlock();
  const b = $('unlock');
  b.classList.add('done');
  b.textContent = '♥ Audio activo';
  audio.debug.analyser();
}
$('unlock').addEventListener('click', unlock);

// ───────── Efectos ─────────
const SFX_LABEL: Record<SfxName, [string, 'q' | 'c' | 'p' | 'u']> = {
  squelch: ['Chapoteo', 'q'],
  crunch: ['Crujido', 'q'],
  boneClonk: ['Clonk óseo', 'q'],
  retractorClick: ['Trinquete', 'q'],
  screwThread: ['Rosca', 'q'],
  torqueClick: ['Clic de torque', 'q'],
  screwDrop: ['Tornillo al suelo', 'q'],
  suturePull: ['Hilo (zip)', 'q'],
  knot: ['Nudo', 'q'],
  kwire: ['Aguja K', 'q'],
  plateSet: ['Placa', 'q'],
  bendPlate: ['Doblar placa', 'q'],
  splash: ['Salpicón', 'q'],
  slurpFinish: ['Sorbo final', 'q'],
  xray: ['Rayos X', 'q'],
  contaminated: ['¡Contaminado!', 'c'],
  alarm: ['Alarma', 'c'],
  defibCharge: ['Carga desfib.', 'c'],
  defibShock: ['Descarga', 'c'],
  compress: ['Compresión', 'c'],
  bag: ['Ambú', 'c'],
  faint: ['Desmayo', 'c'],
  whip: ['Fusta ¡CHAS!', 'p'],
  praise: ['Mensaje ♥', 'p'],
  heartFlutter: ['Latido', 'p'],
  panchitoBark: ['Panchito', 'p'],
  hortensiaScream: ['Hortensia', 'p'],
  guitarRiff: ['Riff grunge', 'p'],
  phone: ['Teléfono', 'p'],
  camera: ['Selfie', 'p'],
  doorClose: ['Puerta', 'p'],
  autoclave: ['Autoclave', 'p'],
  footstep: ['Paso', 'p'],
  coins: ['Monedas', 'p'],
  uiClick: ['UI clic', 'u'],
  uiHover: ['UI hover', 'u'],
  uiBuy: ['UI compra', 'u'],
  uiError: ['UI error', 'u'],
  perfect: ['¡Perfecto!', 'u'],
  good: ['Bien', 'u'],
  miss: ['Fallo', 'u'],
  rankReveal: ['Revelar rango', 'u'],
  tick: ['Tic', 'u'],
};
const sfxGrid = $('sfx');
for (const name of Object.keys(SFX_LABEL) as SfxName[]) {
  const [label, cat] = SFX_LABEL[name];
  const b = document.createElement('button');
  b.className = `btn sfx cat-${cat}`;
  b.dataset.sfx = name;
  b.innerHTML = `${label}<span>${name}</span>`;
  b.addEventListener('click', async (e) => {
    if (!audio.debug.context()) await unlock();
    audio.play(name, { pitch: e.shiftKey ? 1.3 : 1, intensity: e.altKey ? 1 : 0.6, pan: 0 });
    b.classList.add('hit');
    setTimeout(() => b.classList.remove('hit'), 120);
  });
  if (name === 'uiHover') b.addEventListener('mouseenter', () => audio.play('uiHover'));
  sfxGrid.appendChild(b);
}
// Integridad: el panel cubre todos los efectos del contrato
if (SFX_NAMES.some((n) => !SFX_LABEL[n])) console.error('Faltan efectos en el panel');

// ───────── Bucles ─────────
const LOOP_LABEL: Record<LoopSfxName, string> = {
  scalpel: 'Bisturí',
  cautery: 'Cauterio',
  suction: 'Aspiración',
  drill: 'Taladro',
  saw: 'Sierra',
  burr: 'Fresa',
  clipper: 'Maquinilla',
  bandage: 'Venda',
};
const PARAM_LABEL: Record<LoopParam, [string, string]> = {
  rate: ['Velocidad', 'rate · RPM, avance'],
  load: ['Carga', 'load · tejido duro'],
  wet: ['Humedad', 'wet · sangre, irrigación'],
  intensity: ['Intensidad', 'intensity · presión, calor'],
};
const running = new Map<LoopSfxName, { h: LoopHandle; p: Record<LoopParam, number> }>();
const loopParams = new Map<LoopSfxName, Record<LoopParam, number>>();
let selected: LoopSfxName = 'cautery';
const loopBtns = new Map<LoopSfxName, HTMLButtonElement>();
const loopsEl = $('loops');
for (const n of LOOP_NAMES) {
  loopParams.set(n, { rate: 0.6, load: 0.2, wet: 0.2, intensity: 0.6 });
  const b = document.createElement('button');
  b.className = 'btn';
  b.innerHTML = `<span class="dot"></span>${LOOP_LABEL[n]}`;
  b.addEventListener('click', async () => {
    if (!audio.debug.context()) await unlock();
    selected = n;
    const r = running.get(n);
    if (r) {
      r.h.stop();
      running.delete(n);
    } else {
      const p = loopParams.get(n)!;
      const h = audio.loop(n);
      for (const k of Object.keys(p) as LoopParam[]) h.set(k, p[k]);
      running.set(n, { h, p });
    }
    refreshLoops();
  });
  loopBtns.set(n, b);
  loopsEl.appendChild(b);
}
const sliderEls = new Map<LoopParam, [HTMLInputElement, HTMLOutputElement]>();
const sl = $('loopSliders');
for (const k of Object.keys(PARAM_LABEL) as LoopParam[]) {
  const lab = document.createElement('span');
  lab.innerHTML = `${PARAM_LABEL[k][0]}<span class="sub">${k}</span>`;
  const inp = document.createElement('input');
  inp.type = 'range';
  inp.min = '0';
  inp.max = '1';
  inp.step = '0.01';
  const out = document.createElement('output');
  inp.addEventListener('input', () => {
    const v = Number(inp.value);
    loopParams.get(selected)![k] = v;
    running.get(selected)?.h.set(k, v);
    out.textContent = v.toFixed(2);
  });
  sl.append(lab, inp, out);
  sliderEls.set(k, [inp, out]);
}
function refreshLoops() {
  for (const [n, b] of loopBtns) {
    b.classList.toggle('on', running.has(n));
    b.classList.toggle('sel', n === selected);
  }
  const p = loopParams.get(selected)!;
  for (const [k, [inp, out]] of sliderEls) {
    inp.value = String(p[k]);
    out.textContent = p[k].toFixed(2);
  }
}
refreshLoops();

// ───────── Música ─────────
const MUSIC_LABEL: Record<MusicState, string> = {
  title: 'Título',
  clinic: 'Clínica lo-fi',
  orStable: 'Quirófano estable',
  orGroove: 'Groove de Rodrigo',
  orTension: 'Tensión',
  arrest: 'Paro (RCP)',
  audit: 'Auditoría',
  rankS: 'Rango S',
  boutique: 'Boutique',
  silent: 'Silencio',
};
const musicBtns = new Map<MusicState, HTMLButtonElement>();
for (const s of MUSIC_STATES) {
  const b = document.createElement('button');
  b.className = 'btn';
  b.innerHTML = `${MUSIC_LABEL[s]}<span>${SONGS[s].bpm}</span>`;
  b.addEventListener('click', async () => {
    if (!audio.debug.context()) await unlock();
    audio.setMusic(s);
    for (const [k, el] of musicBtns) el.classList.toggle('on', k === s);
  });
  musicBtns.set(s, b);
  $('music').appendChild(b);
}
musicBtns.get('silent')!.classList.add('on');

// Prueba de ritmo
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || (e.target as HTMLElement).tagName === 'INPUT') return;
  e.preventDefault();
  const ph = audio.beat.phase();
  const spb = 60 / audio.beat.bpm;
  const off = (ph < 0.5 ? ph : ph - 1) * spb * 1000;
  $('tapMs').textContent = `${off >= 0 ? '+' : ''}${off.toFixed(0)} ms ${Math.abs(off) < 60 ? '♥ ¡a tempo!' : Math.abs(off) < 120 ? '· casi' : '· fuera'}`;
  audio.play('compress', { intensity: 0.5 });
});

// ───────── Monitor ─────────
const vit: VitalsSnapshot = {
  hr: 90,
  spo2: 98,
  map: 78,
  etco2: 38,
  tempC: 38.2,
  bloodVolumePct: 100,
  bloodLostPct: 0,
  exito: 60,
  arrest: false,
  rhythm: 'sinus',
  alarms: [],
};
let monitorOn = false;
let alarmsOn = false;
function pushVitals() {
  vit.alarms = alarmsOn ? ['map', 'spo2'] : [];
  $('hrV').textContent = String(vit.hr);
  $('spV').textContent = String(vit.spo2);
  $('hrOut').innerHTML = `${vit.arrest && vit.rhythm !== 'sinus' ? '--' : vit.hr}<small>lpm</small>`;
  $('spOut').innerHTML = `${vit.spo2}<small>% SpO₂</small>`;
  $('pitch').textContent = `tono: ${spo2ToPitch(vit.spo2).toFixed(0)} Hz · modo: ${monitorOn ? audio.debug.monitorMode() : 'off'}`;
  $('monOn').classList.toggle('on', monitorOn);
  $('alarmsOn').classList.toggle('on', alarmsOn);
  $('arrestOn').classList.toggle('on', vit.arrest);
  audio.setVitals(monitorOn ? { ...vit, alarms: [...vit.alarms] } : null);
  $('pitch').textContent = `tono: ${spo2ToPitch(vit.spo2).toFixed(0)} Hz · modo: ${monitorOn ? audio.debug.monitorMode() : 'off'}`;
}
$<HTMLInputElement>('hr').addEventListener('input', (e) => {
  vit.hr = Number((e.target as HTMLInputElement).value);
  pushVitals();
});
$<HTMLInputElement>('spo2').addEventListener('input', (e) => {
  vit.spo2 = Number((e.target as HTMLInputElement).value);
  pushVitals();
});
$<HTMLSelectElement>('rhythm').addEventListener('change', (e) => {
  vit.rhythm = (e.target as HTMLSelectElement).value as VitalsSnapshot['rhythm'];
  pushVitals();
});
$('monOn').addEventListener('click', async () => {
  if (!audio.debug.context()) await unlock();
  monitorOn = !monitorOn;
  pushVitals();
});
$('alarmsOn').addEventListener('click', () => {
  alarmsOn = !alarmsOn;
  pushVitals();
});
$('arrestOn').addEventListener('click', () => {
  vit.arrest = !vit.arrest;
  if (vit.arrest && vit.rhythm === 'sinus') vit.rhythm = 'vfib';
  if (!vit.arrest) vit.rhythm = 'sinus';
  $<HTMLSelectElement>('rhythm').value = vit.rhythm;
  pushVitals();
});
pushVitals();

// ───────── Voces ─────────
const SPEAKERS: Array<[SpeakerId, string, string]> = [
  ['emiliana', 'Emiliana', 'Rodrigo. Cánula. Ahora. (susurro) Gracias, cielo.'],
  ['valerio', 'Valerio', 'Primum non nocere, doctora. Tómeselo como sugerencia.'],
  ['rodrigo', 'Rodrigo', '¡Aspiración en re menor, jefa!'],
  ['fritz', 'Fritz', 'T-t-tornillo de 2,7… ¡no, no, no!'],
  ['gigi', 'Gigi', '¡Hola, mis huesitos! Hoy toca placa bloqueada, ¿sí?'],
  ['hortensia', 'Hortensia', '¡Merengue es lo único que me queda!'],
  ['braulio', 'Braulio', 'Ese tornillo lleva chip, doctora. Yo lo sé.'],
  ['panchito', 'Panchito', '¡Guau! ¡Guau!'],
];
const spSel = $<HTMLSelectElement>('speaker');
for (const [id, name] of SPEAKERS) {
  const o = document.createElement('option');
  o.value = id;
  o.textContent = name;
  spSel.appendChild(o);
  const line = SPEAKERS.find((s) => s[0] === id)![2];
  const b = document.createElement('button');
  b.className = 'btn';
  b.title = line;
  b.innerHTML = `<b>${name}:</b> ${line}`;
  b.addEventListener('click', async () => {
    if (!audio.debug.context()) await unlock();
    spSel.value = id;
    $<HTMLInputElement>('line').value = line;
    audio.voice(id, line);
  });
  $('presets').appendChild(b);
}
spSel.value = 'rodrigo';
$('say').addEventListener('click', async () => {
  if (!audio.debug.context()) await unlock();
  audio.voice(spSel.value as SpeakerId, $<HTMLInputElement>('line').value);
});

// ───────── Calibración offline ─────────
interface CalibRow {
  name: SfxName;
  peak: number;
  rms: number;
  dur: number;
}
async function calibrate(): Promise<CalibRow[]> {
  const sr = 44100;
  const rows: CalibRow[] = [];
  for (const name of SFX_NAMES) {
    const ctx = new OfflineAudioContext(1, sr * 3.5, sr);
    const s = createSynth(ctx, Math.random);
    const out = ctx.createGain();
    out.gain.value = SFX_META[name].gain;
    out.connect(ctx.destination);
    const end = SFX[name](s, out, 0.01, { pitch: 1, intensity: 0.6 });
    const buf = await ctx.startRendering();
    const d = buf.getChannelData(0);
    let peak = 0;
    let sum = 0;
    let n = 0;
    // RMS en ventanas de 50 ms: la más fuerte (volumen percibido del golpe)
    const win = Math.floor(sr * 0.05);
    let best = 0;
    for (let i = 0; i < d.length; i++) {
      const v = Math.abs(d[i]);
      if (v > peak) peak = v;
      sum += d[i] * d[i];
      n++;
      if (n === win) {
        best = Math.max(best, Math.sqrt(sum / n));
        sum = 0;
        n = 0;
      }
    }
    rows.push({ name, peak, rms: best, dur: end - 0.01 });
  }
  return rows;
}
/** RMS (dB) de un buffer entre a y b segundos. */
function rmsDb(buf: AudioBuffer, a: number, b: number) {
  const d = buf.getChannelData(0);
  const i0 = Math.floor(a * buf.sampleRate);
  const i1 = Math.min(d.length, Math.floor(b * buf.sampleRate));
  let sum = 0;
  let peak = 0;
  for (let i = i0; i < i1; i++) {
    sum += d[i] * d[i];
    peak = Math.max(peak, Math.abs(d[i]));
  }
  return { rms: 20 * Math.log10(Math.max(1e-6, Math.sqrt(sum / Math.max(1, i1 - i0)))), peak: 20 * Math.log10(Math.max(1e-6, peak)) };
}
/** Nivel de cada tema (8 s, medido desde el segundo 3) y de cada bucle (2 s) con la ganancia de su bus. */
async function calibrateMix() {
  const sr = 44100;
  const out: Record<string, { rms: number; peak: number }> = {};
  for (const st of MUSIC_STATES) {
    if (st === 'silent') continue;
    const ctx = new OfflineAudioContext(1, sr * 11, sr);
    const s = createSynth(ctx, Math.random);
    const bus = ctx.createGain();
    bus.gain.value = BUS_BASE.music * settings.musicVolume;
    bus.connect(ctx.destination);
    const clock = createBeatClock(() => 0, 110);
    const m = createMusic({ synth: s, bus, clock, toCtx: (t) => t });
    m.set(st, 0);
    for (let t = 0; t < 11; t += 1) m.tick(t, t + 1, 0);
    out[`música:${st}`] = rmsDb(await ctx.startRendering(), 3, 11);
  }
  for (const n of LOOP_NAMES) {
    const ctx = new OfflineAudioContext(1, sr * 2.5, sr);
    const s = createSynth(ctx, Math.random);
    const bus = ctx.createGain();
    bus.gain.value = BUS_BASE.asmr * settings.asmrVolume;
    bus.connect(ctx.destination);
    const l = LOOPS[n](s, bus, 0);
    Object.assign(l.params, { rate: 0.6, load: 0.3, wet: 0.3, intensity: 0.6 });
    l.apply(0);
    for (let t = 0; t < 2.4; t += 0.1) l.tick(t, t + 0.1);
    out[`bucle:${n}`] = rmsDb(await ctx.startRendering(), 0.5, 2.4);
  }
  return out;
}
(window as unknown as { __calibrate: () => Promise<CalibRow[]> }).__calibrate = calibrate;
(window as unknown as { __calibrateMix: typeof calibrateMix }).__calibrateMix = calibrateMix;
$('calibBtn').addEventListener('click', async () => {
  const box = $('calib');
  box.style.display = box.style.display === 'block' ? 'none' : 'block';
  if (box.style.display !== 'block') return;
  const rows = await calibrate();
  const db = (v: number) => (20 * Math.log10(Math.max(1e-6, v))).toFixed(1);
  $('calibBody').innerHTML =
    '<table><tr><th>efecto</th><th>pico dB</th><th>RMS50 dB</th><th>s</th></tr>' +
    rows
      .map((r) => {
        const cls = r.peak > 0.99 ? 'hot' : r.rms < 0.02 ? 'cold' : '';
        return `<tr class="${cls}"><td>${r.name}</td><td>${db(r.peak)}</td><td>${db(r.rms)}</td><td>${r.dur.toFixed(2)}</td></tr>`;
      })
      .join('') +
    '</table>';
});

// ───────── Animación: pulso, ECG, espectro, estado ─────────
const hearts = Array.from($('hearts').children) as HTMLElement[];
const ecg = $<HTMLCanvasElement>('ecg');
const ecx = ecg.getContext('2d')!;
const scope = $<HTMLCanvasElement>('scope');
const scx = scope.getContext('2d')!;
let freq: Uint8Array<ArrayBuffer> | null = null;
let ecgX = 0;
const ecgLastBeat = 0;
let ecgT = 0;
let ecgPrevY = 74;
ecx.fillStyle = '#0f1b1a';
ecx.fillRect(0, 0, ecg.width, ecg.height);

function ecgSample(t: number): number {
  if (!monitorOn) return 0;
  if (vit.arrest || vit.rhythm === 'asystole' || vit.rhythm === 'vfib') {
    if (vit.rhythm === 'vfib') return Math.sin(t * 31) * 0.35 + Math.sin(t * 47 + 1) * 0.25;
    return 0;
  }
  const period = 60 / Math.max(20, vit.hr);
  const p = ((t - ecgLastBeat) % period) / period;
  if (p < 0.04) return p * 5;
  if (p < 0.07) return -0.25;
  if (p < 0.1) return 1;
  if (p < 0.13) return -0.35;
  if (p > 0.3 && p < 0.42) return Math.sin(((p - 0.3) / 0.12) * Math.PI) * 0.25;
  return 0;
}

function frame(nowMs: number) {
  const t = nowMs / 1000;
  const idx = audio.beat.beatIndex();
  const ph = audio.beat.phase();
  for (let i = 0; i < 4; i++) {
    const lit = idx % 4 === i && ph < 0.35;
    hearts[i].classList.toggle('lit', lit);
    hearts[i].classList.toggle('down', lit && i === 0);
  }
  $('beatInfo').textContent = `♩ ${audio.beat.bpm} BPM · pulso ${idx} · fase ${ph.toFixed(2)} · próximo ${(audio.beat.timeToNextBeat() * 1000).toFixed(0)} ms`;
  $('phaseBar').style.width = `${(ph * 100).toFixed(1)}%`;

  // ECG: avanza con el tiempo real (independiente de los fps), 100 px/s
  if (ecgT === 0 || t - ecgT > 1) ecgT = t;
  for (let n = 0; ecgT < t && n < 400; n++) {
    ecgT += 0.01;
    ecx.fillStyle = '#0f1b1a';
    ecx.fillRect(ecgX, 0, 8, ecg.height);
    const y = 74 - ecgSample(ecgT) * 52;
    ecx.strokeStyle = vit.arrest ? '#ff4d6d' : '#9ff0d0';
    ecx.lineWidth = 3;
    ecx.lineCap = 'round';
    ecx.beginPath();
    ecx.moveTo(ecgX - 1, ecgPrevY);
    ecx.lineTo(ecgX, y);
    ecx.stroke();
    ecgPrevY = y;
    ecgX = (ecgX + 1) % ecg.width;
    if (ecgX === 0) ecgPrevY = y;
  }

  // Espectro
  const w = scope.width;
  const h = scope.height;
  scx.clearRect(0, 0, w, h);
  const an = audio.debug.analyser();
  if (an) {
    if (!freq || freq.length !== an.frequencyBinCount) freq = new Uint8Array(an.frequencyBinCount);
    an.getByteFrequencyData(freq);
    const bars = 64;
    const bw = w / bars;
    for (let i = 0; i < bars; i++) {
      // escala logarítmica de 40 Hz a 16 kHz
      const f0 = 40 * Math.pow(400, i / bars);
      const bin = Math.min(freq.length - 1, Math.floor((f0 / (an.context.sampleRate / 2)) * freq.length));
      const v = freq[bin] / 255;
      const bh = Math.max(2, v * (h - 8));
      const grad = scx.createLinearGradient(0, h, 0, h - bh);
      grad.addColorStop(0, '#b79cf2');
      grad.addColorStop(1, v > 0.8 ? '#ff2e93' : '#ff8fc7');
      scx.fillStyle = grad;
      scx.beginPath();
      scx.roundRect(i * bw + 2, h - bh, bw - 4, bh, 4);
      scx.fill();
    }
  } else {
    scx.fillStyle = 'rgba(255,246,251,0.55)';
    scx.font = '800 26px Nunito, system-ui, sans-serif';
    scx.textAlign = 'center';
    scx.fillText('Pulsa «Activar audio» ♥', w / 2, h / 2 + 9);
  }

  const ctx = audio.debug.context();
  $('ctxState').innerHTML = `contexto: <b>${ctx ? `${ctx.state} · ${ctx.sampleRate / 1000} kHz` : 'sin crear'}</b>`;
  $('voicesHint').textContent = `espectro del master · ${audio.debug.activeVoices()} efectos · ${audio.debug.activeLoops()} bucles`;
  $('ttsInfo').textContent = `voz: ${audio.debug.voiceName() ?? 'sin voz española (o síntesis no disponible)'}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
