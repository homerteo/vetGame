/**
 * Voces con speechSynthesis del navegador: voz en español (es-MX/es-US antes que es-ES),
 * tono y velocidad por personaje, cola de 2 frases como máximo (se descartan las viejas).
 * Nunca lanza: si no hay síntesis de voz, todo es no-op.
 */
import type { SpeakerId } from '../core/contracts';

export interface VoiceProfile {
  pitch: number;
  rate: number;
  volume: number;
  /** Variación aleatoria del tono por frase (dramatismo). */
  pitchJitter?: number;
}

/** null = ese hablante no usa síntesis (Panchito ladra; la pareja es solo texto). */
export const VOICE_PROFILES: Record<SpeakerId, VoiceProfile | null> = {
  emiliana: { pitch: 1.2, rate: 0.98, volume: 0.85 },
  valerio: { pitch: 0.7, rate: 0.86, volume: 1 },
  rodrigo: { pitch: 0.8, rate: 1.05, volume: 1 },
  fritz: { pitch: 1.4, rate: 1.22, volume: 0.9 },
  gigi: { pitch: 1.3, rate: 1.12, volume: 1 },
  hortensia: { pitch: 1.5, rate: 0.94, volume: 1, pitchJitter: 0.12 },
  braulio: { pitch: 0.9, rate: 0.9, volume: 0.55 },
  ownerA: { pitch: 1.05, rate: 1, volume: 0.95 },
  ownerB: { pitch: 0.85, rate: 0.95, volume: 0.95 },
  ownerC: { pitch: 1.15, rate: 1.03, volume: 0.95 },
  sistema: { pitch: 1, rate: 1.05, volume: 0.85 },
  panchito: null,
  pareja: null,
};

export interface VoiceLike {
  lang: string;
  name: string;
  localService?: boolean;
  default?: boolean;
}

export interface UtteranceLike {
  text: string;
  lang: string;
  pitch: number;
  rate: number;
  volume: number;
  voice: unknown;
  onend: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface SpeechLike {
  speak(u: UtteranceLike): void;
  cancel(): void;
  getVoices(): VoiceLike[];
  addEventListener?(type: 'voiceschanged', cb: () => void): void;
  removeEventListener?(type: 'voiceschanged', cb: () => void): void;
}

export type UtteranceCtor = new (text: string) => UtteranceLike;

const LANG_ORDER = ['es-mx', 'es-us', 'es-419', 'es-es'];

/** Elige la mejor voz española disponible (o null). */
export function pickSpanishVoice<V extends VoiceLike>(voices: readonly V[]): V | null {
  let best: V | null = null;
  let bestScore = -1;
  for (const v of voices) {
    const lang = (v.lang || '').toLowerCase().replace('_', '-');
    if (!lang.startsWith('es')) continue;
    const idx = LANG_ORDER.indexOf(lang);
    // Preferencia por región; dentro de la región, voces de mejor calidad (Google/Natural/Premium).
    let score = idx >= 0 ? (LANG_ORDER.length - idx) * 10 : 5;
    if (/google|natural|premium|enhanced|neural/i.test(v.name)) score += 3;
    if (v.localService) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }
  return best;
}

/** Limpia el texto para la síntesis: acotaciones entre paréntesis/corchetes, asteriscos y emojis. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[*_~#]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}♥♡]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const VOICE_QUEUE_MAX = 2;

interface Line {
  u: UtteranceLike;
  token: number;
}

export function createVoice(opts: { speech?: SpeechLike | null; Utterance?: UtteranceCtor | null; rand?: () => number } = {}) {
  const g = globalThis as unknown as { speechSynthesis?: SpeechLike; SpeechSynthesisUtterance?: UtteranceCtor };
  const speech: SpeechLike | null = opts.speech !== undefined ? opts.speech : (g.speechSynthesis ?? null);
  const Utt: UtteranceCtor | null = opts.Utterance !== undefined ? opts.Utterance : (g.SpeechSynthesisUtterance ?? null);
  const rand = opts.rand ?? Math.random;
  const available = !!speech && !!Utt;

  let enabled = false;
  let volume = 1;
  let voice: VoiceLike | null = null;
  let voicesLoaded = false;
  const queue: Line[] = [];
  let speaking: Line | null = null;
  let tokenSeq = 0;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  const refreshVoices = () => {
    try {
      const list = speech?.getVoices() ?? [];
      if (list.length) {
        voice = pickSpanishVoice(list);
        voicesLoaded = true;
      }
    } catch {
      voice = null;
    }
  };
  if (available) {
    try {
      speech!.addEventListener?.('voiceschanged', refreshVoices);
    } catch {
      // sin eventos de voces
    }
  }

  function clearWatchdog() {
    if (watchdog !== null) {
      clearTimeout(watchdog);
      watchdog = null;
    }
  }

  function next() {
    clearWatchdog();
    speaking = null;
    const line = queue.shift();
    if (!line) return;
    speaking = line;
    const done = () => {
      if (speaking && speaking.token === line.token) next();
    };
    line.u.onend = done;
    line.u.onerror = done;
    try {
      speech!.speak(line.u);
      // Algunos navegadores no disparan onend: vigilante por duración estimada.
      const est = (1.2 + line.u.text.length * 0.085 / Math.max(0.5, line.u.rate)) * 1000 * 1.6;
      watchdog = setTimeout(done, est);
    } catch {
      speaking = null;
    }
  }

  return {
    available,
    setEnabled(v: boolean) {
      enabled = v;
      if (!v) this.cancel();
    },
    setVolume(v: number) {
      volume = Math.min(1, Math.max(0, v));
    },
    /** Encola una frase. Devuelve true si se va a decir. */
    say(speaker: SpeakerId, text: string): boolean {
      if (!available || !enabled) return false;
      const prof = VOICE_PROFILES[speaker];
      if (!prof) return false;
      const clean = cleanForSpeech(text);
      if (!clean) return false;
      try {
        if (!voicesLoaded) refreshVoices();
        const u = new Utt!(clean);
        u.lang = voice?.lang ?? 'es-MX';
        if (voice) u.voice = voice;
        const jitter = prof.pitchJitter ? (rand() * 2 - 1) * prof.pitchJitter : 0;
        u.pitch = Math.min(2, Math.max(0, prof.pitch + jitter));
        u.rate = Math.min(10, Math.max(0.1, prof.rate));
        u.volume = Math.min(1, Math.max(0, prof.volume * volume));
        queue.push({ u, token: ++tokenSeq });
        // Máximo 2 frases entre la que suena y las pendientes: se descartan las más viejas.
        while (queue.length + (speaking ? 1 : 0) > VOICE_QUEUE_MAX) {
          if (speaking) {
            speaking = null;
            clearWatchdog();
            speech!.cancel();
          } else {
            queue.shift();
          }
        }
        if (!speaking) next();
        return true;
      } catch {
        return false;
      }
    },
    /** Frases en cola + la que suena. */
    pending(): number {
      return queue.length + (speaking ? 1 : 0);
    },
    currentText(): string | null {
      return speaking?.u.text ?? null;
    },
    voiceName(): string | null {
      if (!voicesLoaded) refreshVoices();
      return voice ? `${voice.name} (${voice.lang})` : null;
    },
    cancel() {
      queue.length = 0;
      speaking = null;
      clearWatchdog();
      try {
        if (available) speech!.cancel();
      } catch {
        // nada
      }
    },
    dispose() {
      this.cancel();
      try {
        speech?.removeEventListener?.('voiceschanged', refreshVoices);
      } catch {
        // nada
      }
    },
  };
}

export type VoiceAPI = ReturnType<typeof createVoice>;
