/** Medidores de Contaminación de las zonas estériles. Lógica pura. */
import { clamp } from '../../core/math';
import { ZONE_IDS, type ZoneId } from './layout';
import { TUNING } from './tuning';

export interface ContaminationState {
  values: Record<ZoneId, number>;
  peak: Record<ZoneId, number>;
}

export function createContamination(): ContaminationState {
  return { values: { or: 0, prep: 0, autoclave: 0 }, peak: { or: 0, prep: 0, autoclave: 0 } };
}

/**
 * @param intruderZone zona donde está Panchito (null si fuera)
 * @param zooming Panchito corre en círculos (sube más)
 * @param cleaners zonas con un asistente trabajando (limpian más rápido)
 * @returns zona que acaba de cruzar el 50% (para avisar) o null
 */
export function tickContamination(
  s: ContaminationState,
  dt: number,
  intruderZone: ZoneId | null,
  zooming: boolean,
  cleaners: Partial<Record<ZoneId, boolean>>,
): ZoneId | null {
  const C = TUNING.contamination;
  let crossed: ZoneId | null = null;
  for (const z of ZONE_IDS) {
    const before = s.values[z];
    if (z === intruderZone) {
      s.values[z] = clamp(before + C.rise * (zooming ? C.zoomMult : 1) * dt, 0, 1);
    } else {
      s.values[z] = clamp(before - C.decay * (cleaners[z] ? C.cleanerMult : 1) * dt, 0, 1);
    }
    if (s.values[z] > s.peak[z]) s.peak[z] = s.values[z];
    if (before < 0.5 && s.values[z] >= 0.5) crossed = z;
  }
  return crossed;
}

/** Valor para el quirófano: la zona más sucia al salir (0..1). */
export function contaminationOutcome(s: ContaminationState): number {
  let m = 0;
  for (const z of ZONE_IDS) m = Math.max(m, s.values[z]);
  return m;
}

export function peakContamination(s: ContaminationState): number {
  let m = 0;
  for (const z of ZONE_IDS) m = Math.max(m, s.peak[z]);
  return m;
}
