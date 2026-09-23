import { describe, expect, it } from 'vitest';
import { cleanForSpeech, createVoice, pickSpanishVoice, VOICE_PROFILES, type SpeechLike, type UtteranceLike, type VoiceLike } from './Voice';

class FakeUtterance implements UtteranceLike {
  lang = '';
  pitch = 1;
  rate = 1;
  volume = 1;
  voice: unknown = null;
  onend: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(public text: string) {}
}

function fakeSpeech(voices: VoiceLike[]) {
  const spoken: FakeUtterance[] = [];
  let current: FakeUtterance | null = null;
  let cancels = 0;
  const s: SpeechLike & { spoken: FakeUtterance[]; finish(): void; cancels(): number } = {
    spoken,
    speak(u) {
      spoken.push(u as FakeUtterance);
      current = u as FakeUtterance;
    },
    cancel() {
      cancels++;
      const c = current;
      current = null;
      c?.onerror?.({});
    },
    getVoices: () => voices,
    finish() {
      const c = current;
      current = null;
      c?.onend?.({});
    },
    cancels: () => cancels,
  };
  return s;
}

const VOICES: VoiceLike[] = [
  { lang: 'en-US', name: 'Samantha' },
  { lang: 'es-ES', name: 'Mónica' },
  { lang: 'es-MX', name: 'Paulina' },
  { lang: 'es-US', name: 'Google español de Estados Unidos' },
];

describe('pickSpanishVoice', () => {
  it('prefiere es-MX, luego es-US, luego es-ES', () => {
    expect(pickSpanishVoice(VOICES)?.lang).toBe('es-MX');
    expect(pickSpanishVoice(VOICES.filter((v) => v.lang !== 'es-MX'))?.lang).toBe('es-US');
    expect(pickSpanishVoice(VOICES.filter((v) => v.lang === 'es-ES' || v.lang === 'en-US'))?.lang).toBe('es-ES');
    expect(pickSpanishVoice([{ lang: 'es_AR', name: 'x' }])?.lang).toBe('es_AR');
    expect(pickSpanishVoice([{ lang: 'en-GB', name: 'x' }])).toBeNull();
  });
});

describe('cleanForSpeech', () => {
  it('quita acotaciones, asteriscos y emojis', () => {
    expect(cleanForSpeech('Rodrigo. Cánula. Ahora. (susurro) Gracias, cielo.')).toBe('Rodrigo. Cánula. Ahora. Gracias, cielo.');
    expect(cleanForSpeech('[SLURP viscoso] *¡Eso es rock!* 🎸♥')).toBe('¡Eso es rock!');
  });
});

describe('voz', () => {
  it('no hace nada sin speechSynthesis ni lanza', () => {
    const v = createVoice({ speech: null, Utterance: null });
    v.setEnabled(true);
    expect(v.available).toBe(false);
    expect(v.say('valerio', 'Primum non nocere')).toBe(false);
    expect(() => v.cancel()).not.toThrow();
    expect(() => v.dispose()).not.toThrow();
  });

  it('respeta el ajuste tts', () => {
    const sp = fakeSpeech(VOICES);
    const v = createVoice({ speech: sp, Utterance: FakeUtterance });
    expect(v.say('gigi', '¡Hola, mis huesitos!')).toBe(false);
    v.setEnabled(true);
    expect(v.say('gigi', '¡Hola, mis huesitos!')).toBe(true);
    expect(sp.spoken.length).toBe(1);
  });

  it('tono y velocidad por personaje, voz en español', () => {
    const sp = fakeSpeech(VOICES);
    const v = createVoice({ speech: sp, Utterance: FakeUtterance, rand: () => 0.5 });
    v.setEnabled(true);
    v.say('valerio', 'Doctora.');
    const u = sp.spoken[0];
    expect(u.pitch).toBeCloseTo(0.7);
    expect(u.rate).toBeCloseTo(VOICE_PROFILES.valerio!.rate);
    expect(u.lang).toBe('es-MX');
    expect((u.voice as VoiceLike).name).toBe('Paulina');
    sp.finish();
    v.say('fritz', 'T-t-tornillo');
    expect(sp.spoken[1].pitch).toBeCloseTo(1.4);
    sp.finish();
    v.say('hortensia', '¡Merengue!');
    expect(sp.spoken[2].pitch).toBeGreaterThan(1.3);
  });

  it('Panchito y la pareja no usan síntesis', () => {
    const sp = fakeSpeech(VOICES);
    const v = createVoice({ speech: sp, Utterance: FakeUtterance });
    v.setEnabled(true);
    expect(v.say('panchito', '¡Guau!')).toBe(false);
    expect(v.say('pareja', 'Buena niña')).toBe(false);
    expect(sp.spoken.length).toBe(0);
  });

  it('cola de 2 como máximo: se cancelan las frases viejas', () => {
    const sp = fakeSpeech(VOICES);
    const v = createVoice({ speech: sp, Utterance: FakeUtterance });
    v.setEnabled(true);
    v.say('rodrigo', 'uno');
    v.say('rodrigo', 'dos');
    expect(v.pending()).toBe(2);
    expect(v.currentText()).toBe('uno');
    v.say('rodrigo', 'tres');
    expect(v.pending()).toBe(2);
    expect(sp.cancels()).toBe(1);
    expect(v.currentText()).toBe('dos');
    v.say('rodrigo', 'cuatro');
    expect(v.currentText()).toBe('tres');
    sp.finish();
    expect(v.currentText()).toBe('cuatro');
    sp.finish();
    expect(v.pending()).toBe(0);
    expect(sp.spoken.map((u) => u.text)).toEqual(['uno', 'dos', 'tres', 'cuatro']);
  });

  it('no lanza si speak falla', () => {
    const sp = fakeSpeech(VOICES);
    sp.speak = () => {
      throw new Error('boom');
    };
    const v = createVoice({ speech: sp, Utterance: FakeUtterance });
    v.setEnabled(true);
    expect(() => v.say('emiliana', 'Hola')).not.toThrow();
  });
});
