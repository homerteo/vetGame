import type { CaseDef } from '../core/contracts';
import { CHORIZO } from './cases/chorizo';
import { COPITO } from './cases/copito';
import { DUQUESA } from './cases/duquesa';
import { MERENGUE } from './cases/merengue';
import { PANCHITO } from './cases/panchito';
import { RAYO } from './cases/rayo';
import { SIR_WINSTON } from './cases/sirWinston';
import { TANQUE } from './cases/tanque';

/** Los 8 casos de la campaña, en orden de semana (GDD §6). */
export const CASES: CaseDef[] = [PANCHITO, DUQUESA, MERENGUE, SIR_WINSTON, CHORIZO, TANQUE, COPITO, RAYO];

/** Caso por id. Lanza si no existe. */
export function getCase(id: string): CaseDef {
  const c = CASES.find((k) => k.id === id);
  if (!c) throw new Error(`Caso desconocido: "${id}"`);
  return c;
}
