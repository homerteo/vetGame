/**
 * Temas procedurales por estado de música. Cada tema recibe un paso de semicorchea
 * y programa sus notas. Variación cada 8 compases (frase A/B/C) para no cansar.
 */
import type { MusicState } from '../core/contracts';
import type { Kit } from './instruments';

export interface StepCtx {
  kit: Kit;
  /** Instante del paso en tiempo del AudioContext. */
  t: number;
  /** Paso local desde el inicio del tema (semicorcheas). */
  step: number;
  bar: number;
  /** 0..15 dentro del compás. */
  s16: number;
  /** Segundos por pulso. */
  spb: number;
  rand(): number;
}

export interface Song {
  bpm: number;
  /** Fundido de entrada (s). */
  fadeIn: number;
  /** Nivel de salida (calibrado por RMS offline para que todos los temas suenen parejo). */
  level: number;
  step(c: StepCtx): void;
}

type Chord = readonly number[];
type Motif = ReadonlyArray<readonly [number, number]>;

const phrase = (bar: number) => Math.floor(bar / 8);
/** Retardo de swing para la corchea a contratiempo. */
const swing8 = (c: StepCtx, amt: number) => (c.s16 % 4 === 2 ? amt * c.spb * 0.25 : 0);

function playMotif(c: StepCtx, motif: Motif, localStep: number, fn: (t: number, midi: number) => void) {
  for (let i = 0; i < motif.length; i++) if (motif[i][0] === localStep) fn(c.t, motif[i][1]);
}

/** Rasgueo: notas escalonadas (abajo = grave→agudo; arriba = al revés). */
function strum(c: StepCtx, chord: Chord, down: boolean, v: number, dur: number) {
  const n = chord.length;
  for (let i = 0; i < n; i++) {
    const m = down ? chord[i] : chord[n - 1 - i];
    c.kit.pluck(c.t + i * 0.014 + c.rand() * 0.004, m, v * (1 - i * 0.08), dur);
  }
}

// ───────────── Título: pads soñadores + glockenspiel (96 BPM) ─────────────
const TITLE_CHORDS: Chord[] = [
  [53, 57, 60, 64], // Fmaj7
  [50, 57, 60, 65], // Dm7
  [46, 53, 57, 62], // Bbmaj7
  [48, 55, 60, 62], // Csus2
];
const TITLE_MOTIFS: Motif[] = [
  [[0, 84], [6, 81], [8, 79], [12, 81], [16, 77], [22, 79], [24, 81]],
  [[0, 86], [4, 84], [8, 81], [10, 84], [16, 89], [24, 86], [28, 84]],
  [[0, 81], [3, 84], [6, 86], [12, 84], [16, 81], [20, 79], [24, 77]],
];
const TITLE_ORDER = [
  [0, 1, 0, 2],
  [1, 2, 0, -1],
  [-1, -1, 2, 0],
];

const title: Song = {
  bpm: 96,
  fadeIn: 2.2,
  level: 1.0,
  step(c) {
    const ch = TITLE_CHORDS[Math.floor(c.bar / 2) % 4];
    if (c.s16 === 0 && c.bar % 2 === 0) {
      c.kit.pad(c.t, ch, 8 * c.spb, 1, 1250);
      c.kit.sub(c.t, ch[0] - 12, 8 * c.spb, 0.7);
    }
    const ph = phrase(c.bar) % 3;
    const mi = TITLE_ORDER[ph][Math.floor((c.bar % 8) / 2)];
    if (mi >= 0) playMotif(c, TITLE_MOTIFS[mi], (c.bar % 2) * 16 + c.s16, (t, m) => c.kit.glock(t, m, 0.9));
    // centelleos
    if (c.s16 % 2 === 0 && c.rand() < 0.07) c.kit.glock(c.t, ch[1 + Math.floor(c.rand() * 3)] + 36, 0.3, 0.8);
    if (ph === 1 && c.s16 % 2 === 0) c.kit.shaker(c.t, c.s16 % 4 === 0 ? 0.5 : 0.3);
  },
};

// ───────────── Clínica: lo-fi kawaii (100 BPM) ─────────────
const CLINIC_CHORDS: Chord[] = [
  [60, 64, 67, 71], // Cmaj7
  [57, 64, 67, 72], // Am7
  [57, 62, 65, 72], // Dm7
  [59, 62, 65, 67], // G7
];
const CLINIC_ROOTS = [48, 45, 50, 43];
const CLINIC_MELODY: Motif[] = [
  [[0, 76], [3, 79], [6, 84], [10, 83], [12, 79]],
  [[0, 76], [4, 72], [6, 74], [8, 76], [14, 79]],
  [[0, 77], [2, 76], [4, 74], [8, 72], [12, 74]],
  [[0, 74], [3, 77], [6, 79], [10, 77], [12, 74]],
];

const clinic: Song = {
  bpm: 100,
  fadeIn: 1.5,
  level: 1.05,
  step(c) {
    const i = c.bar % 4;
    const ch = CLINIC_CHORDS[i];
    const fill = c.bar % 8 === 7;
    const ph = phrase(c.bar) % 2;
    const t = c.t + swing8(c, 0.5);
    const k = c.kit;
    if (c.s16 === 0) {
      k.pad(c.t, ch.map((m) => m - 12), 4 * c.spb, 0.55, 850);
      k.bass(c.t, CLINIC_ROOTS[i] - 12, 1.4 * c.spb, 0.55, 380);
    }
    if (c.s16 === 10 && !fill) k.bass(t, CLINIC_ROOTS[i] - 5, 0.9 * c.spb, 0.45, 380);
    if (c.s16 === 0 || (c.s16 === 10 && !fill) || (ph === 1 && c.s16 === 7)) k.kick(t, 0.75);
    if (c.s16 === 4 || c.s16 === 12) k.snare(t, 0.4);
    if (fill && (c.s16 === 13 || c.s16 === 14 || c.s16 === 15)) k.snare(c.t, 0.18 + 0.06 * (c.s16 - 13));
    if (c.s16 % 2 === 0) k.hat(t, c.s16 % 4 === 0 ? 0.55 : 0.35);
    if (c.s16 === 0) strum(c, ch, true, 0.8, 0.6);
    if (c.s16 === 6) strum({ ...c, t }, ch, false, 0.45, 0.35);
    if (c.s16 === 10) strum({ ...c, t }, ch, true, 0.6, 0.45);
    if (c.s16 === 14 && !fill) strum({ ...c, t }, ch, false, 0.35, 0.3);
    if (ph === 1) playMotif(c, CLINIC_MELODY[i], c.s16, (tt, m) => k.pluck(tt + swing8(c, 0.5), m, 0.9, 0.7));
    if (c.rand() < 0.3) k.crackle(c.t + c.rand() * c.spb * 0.25, 1);
  },
};

// ───────────── Quirófano estable: electrónica pastel (110 BPM) ─────────────
const OR_CHORDS: Chord[] = [
  [57, 61, 64, 69], // A
  [56, 59, 64, 68], // E
  [54, 57, 61, 66], // F#m
  [54, 57, 62, 66], // D
];
const OR_ROOTS = [45, 40, 42, 38];
const ARP_A = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 3, 1, 2];
const ARP_B = [0, 2, 1, 3, 0, 2, 3, 1, 3, 2, 1, 0, 1, 2, 3, 2];

function orBase(c: StepCtx, arpLevel: number) {
  const i = c.bar % 4;
  const ch = OR_CHORDS[i];
  const k = c.kit;
  const ph = phrase(c.bar) % 2;
  if (c.s16 % 4 === 0) k.kick(c.t, c.s16 === 0 ? 0.75 : 0.62);
  if ((c.s16 === 4 || c.s16 === 12) && c.bar % 8 !== 0) k.clap(c.t, 0.55);
  if (c.s16 % 4 === 2) k.hat(c.t, 0.6);
  else if (ph === 1) k.hat(c.t, 0.22);
  if (c.s16 === 0) k.padSaw(c.t, ch, 4 * c.spb, 0.6, 850 + 250 * Math.sin((c.bar / 8) * Math.PI));
  const pat = ph === 0 ? ARP_A : ARP_B;
  const deg = pat[c.s16];
  const oct = ph === 1 && c.s16 >= 8 ? 24 : 12;
  const cutoff = 1300 + 1300 * (0.5 + 0.5 * Math.sin((c.bar / 4) * Math.PI * 0.5));
  k.arp(c.t, ch[deg] + oct, c.spb * 0.22, arpLevel * (c.s16 % 4 === 0 ? 1 : 0.75), cutoff);
}

const orStable: Song = {
  bpm: 110,
  fadeIn: 1.2,
  level: 1.7,
  step(c) {
    orBase(c, 0.85);
  },
};

// ───────────── Rodrigo en groove: + bajo y guitarra grunge ─────────────
const BASS_STEPS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [3, 0],
  [6, 12],
  [8, 0],
  [11, 7],
  [14, 12],
];

const orGroove: Song = {
  bpm: 110,
  fadeIn: 0.8,
  level: 0.86,
  step(c) {
    orBase(c, 0.6);
    const i = c.bar % 4;
    const root = OR_ROOTS[i];
    const k = c.kit;
    for (const [st, off] of BASS_STEPS) if (st === c.s16) k.bass(c.t, root - 12 + off, c.spb * 0.45, 0.85, 700);
    // guitarra: golpes en compases pares, respuesta silenciada en impares
    if (c.bar % 2 === 0) {
      if (c.s16 === 0) k.stab(c.t, root, 1.4 * c.spb, 1);
      if (c.s16 === 6) k.stab(c.t, root, 0.45 * c.spb, 0.8);
    } else {
      if (c.s16 === 0 || c.s16 === 2) k.stab(c.t, root, 0.22 * c.spb, 0.75, true);
      if (c.s16 === 4) k.stab(c.t, root + 3, 0.9 * c.spb, 0.85);
      if (c.s16 === 10) k.stab(c.t, root + 5, 1.2 * c.spb, 0.85);
    }
  },
};

// ───────────── Tensión: cuerdas desafinadas + timbales ─────────────
const TENSION_CHORDS: Chord[] = [
  [50, 53, 57, 62], // Dm
  [46, 50, 53, 58], // Bb
  [43, 50, 55, 58], // Gm
  [45, 49, 52, 57], // A
];

const orTension: Song = {
  bpm: 110,
  fadeIn: 1,
  level: 1.0,
  step(c) {
    const i = c.bar % 4;
    const ch = TENSION_CHORDS[i];
    const k = c.kit;
    const ph = phrase(c.bar) % 2;
    if (c.s16 === 0) {
      k.strings(c.t, ch, 4 * c.spb, 1, 1300);
      if (ph === 1) k.strings(c.t, [ch[2] + 12, ch[3] + 12], 4 * c.spb, 0.55, 2200);
    }
    if (c.s16 % 2 === 0) k.bass(c.t, ch[0] - 12, c.spb * 0.35, 0.55, 320);
    if (c.s16 === 0 || c.s16 === 8) k.kick(c.t, 0.6);
    if (c.s16 === 6) k.tom(c.t, 0.8, 110);
    if (c.s16 === 10) k.tom(c.t, 0.7, 90);
    if (c.bar % 4 === 3 && (c.s16 === 12 || c.s16 === 14)) k.tom(c.t, 0.8, c.s16 === 12 ? 130 : 150);
    if (c.s16 % 2 === 1 || ph === 1) k.hat(c.t, 0.22);
  },
};

// ───────────── Paro: solo el pulso del riff a 110 para las compresiones ─────────────
const ARREST_RIFF = [
  [40, 40, 43, 40],
  [40, 40, 45, 43],
];

const arrest: Song = {
  bpm: 110,
  fadeIn: 0.15,
  level: 3.2,
  step(c) {
    if (c.s16 % 4 !== 0) return;
    const beat = c.s16 / 4;
    const note = ARREST_RIFF[c.bar % 2][beat];
    c.kit.stab(c.t, note, 0.32 * c.spb, beat === 0 ? 1.15 : 0.85, true);
    c.kit.woodblock(c.t, beat === 0 ? 0.55 : 0.35, beat === 0);
  },
};

// ───────────── Auditoría: suspenso y luego alivio luminoso ─────────────
const AUDIT_LIGHT: Chord[] = [
  [53, 57, 60, 65], // F
  [52, 55, 60, 64], // C/E
  [50, 53, 57, 62], // Dm
  [46, 53, 58, 62], // Bb
];
const AUDIT_MOTIFS: Motif[] = [
  [[0, 81], [4, 84], [8, 86], [12, 84]],
  [[0, 79], [4, 84], [6, 81], [8, 79]],
  [[0, 77], [4, 81], [8, 84], [10, 86]],
  [[0, 82], [4, 81], [8, 79], [12, 77]],
];

const audit: Song = {
  bpm: 110,
  fadeIn: 1,
  level: 1.8,
  step(c) {
    const k = c.kit;
    if (c.bar < 8) {
      if (c.s16 % 2 === 0) k.woodblock(c.t, 0.5, c.s16 % 4 === 0);
      if (c.s16 === 0 && c.bar % 2 === 0) k.pad(c.t, [50, 57, 62, 64], 8 * c.spb, 0.9, 650);
      if (c.s16 % 2 === 0) k.arp(c.t, c.bar < 4 ? 38 : 41, c.spb * 0.3, 0.45, 700);
      if ((c.bar === 3 || c.bar === 7) && c.s16 === 12) k.roll(c.t, c.spb, c.bar === 7 ? 1 : 0.6);
      return;
    }
    const lb = c.bar - 8;
    const i = lb % 4;
    const ch = AUDIT_LIGHT[i];
    const ph = phrase(lb) % 2;
    if (c.s16 === 0) {
      k.pad(c.t, ch, 4 * c.spb, 0.8, 1500);
      k.sub(c.t, ch[0] - 12, 4 * c.spb, 0.6);
    }
    if (c.s16 === 0 || c.s16 === 8) k.kick(c.t, 0.5);
    if (c.s16 % 2 === 0) k.shaker(c.t, c.s16 % 4 === 2 ? 0.6 : 0.35);
    if (c.s16 === 0 || c.s16 === 8) strum(c, ch.map((m) => m + 12), true, 0.5, 0.5);
    playMotif(c, AUDIT_MOTIFS[(i + ph) % 4], c.s16, (t, m) => k.glock(t, m + (ph ? 12 : 0), 0.8));
  },
};

// ───────────── Rango S: coro kawaii + acorde de poder ─────────────
const RANK_CHORDS: Chord[] = [
  [60, 64, 67, 72], // C
  [59, 62, 67, 71], // G/B
  [57, 60, 64, 69], // Am
  [53, 57, 60, 65], // F
];
const RANK_ROOTS = [48, 43, 45, 41];

const rankS: Song = {
  bpm: 110,
  fadeIn: 0.3,
  level: 1.8,
  step(c) {
    const i = c.bar % 4;
    const ch = RANK_CHORDS[i];
    const k = c.kit;
    if (c.s16 === 0) k.choir(c.t, ch, 4 * c.spb, 1);
    if (c.s16 === 0 && c.bar % 4 === 0) {
      k.stab(c.t, RANK_ROOTS[i] - 12, 2.5 * c.spb, c.bar === 0 ? 1.3 : 0.9);
      k.hat(c.t, 1.4, true);
    }
    if (c.bar > 0 || c.s16 >= 8) {
      if (c.s16 % 4 === 0) k.kick(c.t, 0.55);
      if (c.s16 === 4 || c.s16 === 12) k.clap(c.t, 0.45);
    }
    if (c.s16 % 2 === 0) k.glock(c.t, ch[(c.s16 / 2) % 4] + 24, c.s16 % 8 === 0 ? 0.55 : 0.3, 0.6);
  },
};

// ───────────── Boutique: jingle de compras monísimo ─────────────
const SHOP_CHORDS: Chord[] = [
  [60, 64, 67, 71], // Cmaj7
  [57, 61, 64, 67], // A7
  [57, 62, 65, 72], // Dm7
  [59, 62, 65, 67], // G7
];
const SHOP_ROOTS = [48, 45, 50, 43];
const SHOP_MELODY: Motif[] = [
  [[0, 76], [2, 79], [4, 84], [8, 83], [10, 81], [12, 79]],
  [[0, 85], [4, 81], [6, 76], [8, 79], [12, 81]],
  [[0, 77], [2, 81], [4, 86], [8, 84], [12, 81]],
  [[0, 83], [4, 86], [6, 89], [8, 91], [14, 86]],
];
const CLAVE = [0, 3, 6, 10, 12];

const boutique: Song = {
  bpm: 110,
  fadeIn: 0.8,
  level: 1.0,
  step(c) {
    const i = c.bar % 4;
    const ch = SHOP_CHORDS[i];
    const root = SHOP_ROOTS[i];
    const k = c.kit;
    const ph = phrase(c.bar) % 2;
    if (c.s16 === 0) k.pad(c.t, ch, 4 * c.spb, 0.45, 1600);
    if (c.s16 === 0) k.bass(c.t, root - 12, c.spb * 0.9, 0.7, 500);
    if (c.s16 === 6) k.bass(c.t, root - 5, c.spb * 0.4, 0.6, 500);
    if (c.s16 === 8) k.bass(c.t, root - 12, c.spb * 0.9, 0.6, 500);
    if (c.s16 === 14) k.bass(c.t, root - 11, c.spb * 0.4, 0.5, 500);
    if (CLAVE.includes(c.s16)) k.rim(c.t, 0.8);
    k.shaker(c.t, c.s16 % 4 === 2 ? 0.55 : 0.25);
    if (c.s16 === 4 || c.s16 === 12) strum(c, ch, true, 0.4, 0.3);
    const oct = ph === 1 ? 12 : 0;
    playMotif(c, SHOP_MELODY[i], c.s16, (t, m) => k.glock(t, m + oct, ph === 1 ? 0.6 : 0.85, 0.8));
  },
};

const silent: Song = { bpm: 110, fadeIn: 0.1, level: 0, step() {} };

export const SONGS: Record<MusicState, Song> = {
  title,
  clinic,
  orStable,
  orGroove,
  orTension,
  arrest,
  audit,
  rankS,
  boutique,
  silent,
};

export const MUSIC_STATES = Object.keys(SONGS) as MusicState[];
