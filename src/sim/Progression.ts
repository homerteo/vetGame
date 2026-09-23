import type {
  AuditResult,
  BoutiqueEffects,
  BoutiqueItem,
  CaseDef,
  Difficulty,
  GuideLevel,
  PartnerProfile,
  Rank,
  SaveData,
  Settings,
} from '../core/contracts';
import { clamp } from '../core/math';
import { maxRank } from './Scoring';

/** Guardado (localStorage, tolerante a datos corruptos), reputación, Boutique y guías. */

export const SAVE_KEY = 'dra-emiliana-save-v1';
export const MAX_WEEK = 8; // tras el caso final (semana 7) queda desbloqueada la 8
const LAST_RANKS_KEPT = 5;
const RANK_STARS: Record<Rank, number> = { S: 5, A: 4, B: 3, C: 2, F: 0.5 };
const RANKS: readonly Rank[] = ['S', 'A', 'B', 'C', 'F'];

export function defaultSettings(): Settings {
  return {
    difficulty: 'especialista',
    goreLevel: 70,
    pastelMode: false,
    tremorScale: 1,
    rhythmWindowScale: 1,
    reduceFlashes: false,
    subtitles: true,
    tts: false,
    masterVolume: 0.8,
    musicVolume: 0.6,
    sfxVolume: 0.8,
    asmrVolume: 0.8,
    immersive: false,
    adaptiveDirector: true,
    colorblind: 'none',
  };
}

export function defaultSave(): SaveData {
  return {
    version: 1,
    coins: 0,
    reputation: 0,
    lastRanks: [],
    completed: {},
    owned: [],
    equipped: [],
    settings: defaultSettings(),
    partner: { name: 'Sam', pronoun: 'elle' },
    viralClips: 0,
    unlockedWeek: 0,
    seenIntro: false,
  };
}

// ───────────── Validación ─────────────

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isRank = (v: unknown): v is Rank => typeof v === 'string' && (RANKS as readonly string[]).includes(v);
const num = (v: unknown, def: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : def;
const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
const oneOf = <T extends string | number>(v: unknown, opts: readonly T[], def: T): T =>
  (opts as readonly unknown[]).includes(v) ? (v as T) : def;
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 64))] : [];

function sanitizeSettings(v: unknown): Settings {
  const d = defaultSettings();
  if (!isObj(v)) return d;
  return {
    difficulty: oneOf<Difficulty>(v.difficulty, ['residente', 'especialista', 'jefe'], d.difficulty),
    goreLevel: num(v.goreLevel, d.goreLevel, 0, 100),
    pastelMode: bool(v.pastelMode, d.pastelMode),
    tremorScale: num(v.tremorScale, d.tremorScale, 0, 1),
    rhythmWindowScale: oneOf<1 | 1.5 | 2>(v.rhythmWindowScale, [1, 1.5, 2], d.rhythmWindowScale),
    reduceFlashes: bool(v.reduceFlashes, d.reduceFlashes),
    subtitles: bool(v.subtitles, d.subtitles),
    tts: bool(v.tts, d.tts),
    masterVolume: num(v.masterVolume, d.masterVolume, 0, 1),
    musicVolume: num(v.musicVolume, d.musicVolume, 0, 1),
    sfxVolume: num(v.sfxVolume, d.sfxVolume, 0, 1),
    asmrVolume: num(v.asmrVolume, d.asmrVolume, 0, 1),
    immersive: bool(v.immersive, d.immersive),
    adaptiveDirector: bool(v.adaptiveDirector, d.adaptiveDirector),
    colorblind: oneOf<Settings['colorblind']>(v.colorblind, ['none', 'deuter', 'protan', 'tritan'], d.colorblind),
  };
}

function sanitizePartner(v: unknown): PartnerProfile {
  const d = defaultSave().partner;
  if (!isObj(v)) return d;
  const name = typeof v.name === 'string' ? v.name.trim().slice(0, 24) : '';
  return {
    name: name.length > 0 ? name : d.name,
    pronoun: oneOf<PartnerProfile['pronoun']>(v.pronoun, ['ella', 'él', 'elle'], d.pronoun),
  };
}

/** Mezcla un objeto desconocido con los valores por defecto, campo a campo. */
export function sanitizeSave(v: unknown): SaveData {
  const d = defaultSave();
  if (!isObj(v) || v.version !== 1) return d;
  const completed: Record<string, Rank> = {};
  if (isObj(v.completed)) for (const [k, r] of Object.entries(v.completed)) if (isRank(r)) completed[k] = r;
  const owned = strList(v.owned);
  const equipped = strList(v.equipped).filter((id) => owned.includes(id));
  const lastRanks = Array.isArray(v.lastRanks) ? v.lastRanks.filter(isRank).slice(-LAST_RANKS_KEPT) : [];
  return {
    version: 1,
    coins: Math.floor(num(v.coins, 0, 0, 1e9)),
    reputation: num(v.reputation, 0, 0, 5),
    lastRanks,
    completed,
    owned,
    equipped,
    settings: sanitizeSettings(v.settings),
    partner: sanitizePartner(v.partner),
    viralClips: Math.floor(num(v.viralClips, 0, 0, 1e6)),
    unlockedWeek: Math.floor(num(v.unlockedWeek, 0, 0, MAX_WEEK)),
    seenIntro: bool(v.seenIntro, false),
  };
}

function resolveStorage(storage: Storage | null | undefined): Storage | null {
  if (storage !== undefined) return storage;
  try {
    return typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null;
  } catch {
    return null;
  }
}

export function loadSave(storage?: Storage | null): SaveData {
  const s = resolveStorage(storage);
  if (!s) return defaultSave();
  try {
    const raw = s.getItem(SAVE_KEY);
    if (!raw) return defaultSave();
    return sanitizeSave(JSON.parse(raw));
  } catch {
    return defaultSave();
  }
}

export function persistSave(save: SaveData, storage?: Storage | null): void {
  const s = resolveStorage(storage);
  if (!s) return;
  try {
    s.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // Almacenamiento lleno o bloqueado: se juega sin guardar.
  }
}

// ───────────── Progreso ─────────────

export function reputationFrom(ranks: Rank[], viralClips: number): number {
  if (ranks.length === 0) return 0;
  const last = ranks.slice(-3);
  const base = last.reduce((a, r) => a + RANK_STARS[r], 0) / last.length;
  const viral = Math.min(0.5, 0.1 * Math.max(0, viralClips));
  return clamp(base + viral, 0, 5);
}

export function applyAudit(
  save: SaveData,
  caseDef: CaseDef,
  result: AuditResult,
  extras: { viralClips: number },
): SaveData {
  const lastRanks = [...save.lastRanks, result.rank].slice(-LAST_RANKS_KEPT);
  const prev = save.completed[caseDef.id];
  const completed = { ...save.completed, [caseDef.id]: prev ? maxRank(prev, result.rank) : result.rank };
  const viralClips = save.viralClips + Math.max(0, Math.floor(extras.viralClips || 0));
  return {
    ...save,
    coins: Math.max(0, save.coins + result.coins.total),
    lastRanks,
    completed,
    viralClips,
    unlockedWeek: Math.min(MAX_WEEK, Math.max(save.unlockedWeek, caseDef.week + 1)),
    reputation: reputationFrom(lastRanks, viralClips),
  };
}

/**
 * Caso 0 siempre. Los demás: el anterior completado (vía `allCases` si se pasa; si no,
 * semana desbloqueada ≥ semana del caso) y reputación suficiente. Un caso ya completado
 * sigue abierto aunque la reputación baje.
 */
export function isCaseUnlocked(save: SaveData, caseDef: CaseDef, allCases?: CaseDef[]): boolean {
  if (caseDef.index <= 0) return true;
  if (save.completed[caseDef.id]) return true;
  let prevDone: boolean;
  const prev = allCases?.find((c) => c.index === caseDef.index - 1);
  if (prev) prevDone = !!save.completed[prev.id];
  else prevDone = save.unlockedWeek >= caseDef.week;
  return prevDone && save.reputation >= caseDef.requiredReputation;
}

export function computeEffects(save: SaveData): BoutiqueEffects {
  const eq = new Set(save.equipped.filter((id) => save.owned.includes(id)));
  return {
    messageDurationSec: eq.has('gargantilla-estrella') ? 30 : 20,
    noSlip: eq.has('botas-antideslizantes'),
    extraSlot: eq.has('anillas-oro-rosa'),
    dominaCost: eq.has('fusta-pompon') ? 12 : 15,
    handcuffsAutoSuction: eq.has('esposas-arcoiris'),
    lowConcTremorMult: eq.has('arnes-menta') ? 0.9 : 1,
    teamMoraleBonus: eq.has('gorros-corazones') ? 5 : 0,
  };
}

export function buyItem(save: SaveData, item: BoutiqueItem): SaveData | null {
  if (save.owned.includes(item.id)) return null;
  if (save.coins < item.priceHC) return null;
  return {
    ...save,
    coins: save.coins - item.priceHC,
    owned: [...save.owned, item.id],
    equipped: save.equipped.includes(item.id) ? [...save.equipped] : [...save.equipped, item.id],
  };
}

export function toggleEquip(save: SaveData, id: string): SaveData {
  if (!save.owned.includes(id)) return { ...save };
  const on = save.equipped.includes(id);
  return { ...save, equipped: on ? save.equipped.filter((x) => x !== id) : [...save.equipped, id] };
}

export function guideLevelFor(caseDef: CaseDef, difficulty: Difficulty): GuideLevel {
  if (difficulty === 'residente') return 'full';
  if (difficulty === 'jefe') return 'none';
  if (caseDef.flags.noGuides) return 'none';
  if (caseDef.week <= 2) return 'full';
  if (caseDef.week <= 6) return 'endpoints';
  return 'none';
}

export function firmSweetUnlocked(save: SaveData): boolean {
  return save.unlockedWeek >= 4;
}
