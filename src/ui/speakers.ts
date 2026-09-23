/** Nombres visibles y colores de cada hablante (subtítulos, tarjetas). */
import type { AssistantId, Rank, SpeakerId } from '../core/contracts';

export const SPEAKER_NAME: Record<SpeakerId, string> = {
  emiliana: 'Emiliana',
  valerio: 'Dr. Valerio',
  rodrigo: 'Rodrigo',
  fritz: 'Fritz',
  gigi: 'Gigi',
  hortensia: 'Doña Hortensia',
  braulio: 'Don Braulio',
  ownerA: 'Cliente',
  ownerB: 'Cliente',
  ownerC: 'Cliente',
  panchito: 'Panchito',
  sistema: 'Sistema',
  pareja: 'Tu pareja',
};

export const SPEAKER_COLOR: Record<SpeakerId, string> = {
  emiliana: '#ff4fa8',
  valerio: '#9fb4e0',
  rodrigo: '#62d68f',
  fritz: '#8fd0ff',
  gigi: '#ffd35c',
  hortensia: '#d59bff',
  braulio: '#c8d3dc',
  ownerA: '#ffb987',
  ownerB: '#ffb987',
  ownerC: '#ffb987',
  panchito: '#ffae5c',
  sistema: '#e9dcff',
  pareja: '#ff9fd0',
};

export const ASSISTANT_KEY: Record<AssistantId, string> = { rodrigo: 'Z', fritz: 'X', gigi: 'C' };

export const COMPONENT_LABEL: Record<'T' | 'E' | 'H' | 'S' | 'L' | 't', string> = {
  T: 'Técnica',
  E: 'Estabilidad',
  H: 'Hemostasia',
  S: 'Esterilidad',
  L: 'Liderazgo',
  t: 'Tiempo',
};

export const COMPONENT_WEIGHT: Record<'T' | 'E' | 'H' | 'S' | 'L' | 't', number> = {
  T: 30,
  E: 25,
  H: 15,
  S: 10,
  L: 10,
  t: 10,
};

export const RANK_WORD: Record<Rank, string> = {
  S: 'Sublime',
  A: 'Admirable',
  B: 'Bien',
  C: 'Cumplidora',
  F: 'Fracaso controlado',
};
