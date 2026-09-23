/**
 * Ritmo que enseña la superposición de RCP mientras está activa. Es la única fuente del ritmo
 * visible durante un paro: el monitor del HUD lo copia para no contradecir a la RCP
 * (p. ej. FV en el HUD y "asistolia, esperando ritmo desfibrilable" en la RCP).
 */
import type { CPRRhythm } from './cpr';

export const cprDisplay: { rhythm: CPRRhythm | null } = { rhythm: null };

/** Ritmo que debe enseñar el monitor del HUD dado el de las constantes. */
export function monitorRhythm<R extends string>(vitalsRhythm: R, arrest: boolean, cprRhythm: CPRRhythm | null): R | CPRRhythm {
  if (cprRhythm) return cprRhythm;
  // Paro sin RCP en marcha todavía: la RCP siempre empieza en asistolia
  if (arrest) return 'asystole';
  return vitalsRhythm;
}
