/**
 * Respiración cuadrada (16 s): inhala 4 · retén 4 · exhala 4 · retén 4.
 * Mantener Espacio al inhalar y retener; soltar al exhalar.
 * Calidad = fracción del tiempo con la entrada correcta (con tolerancia en los cambios).
 */

export interface BoxPhase {
  id: 'inhale' | 'holdIn' | 'exhale' | 'holdOut';
  label: string;
  /** ¿Hay que mantener Espacio? */
  hold: boolean;
}

export const BOX_SIDE_SEC = 4;
export const BOX_TOTAL_SEC = 16;
export const BOX_PHASES: readonly BoxPhase[] = [
  { id: 'inhale', label: 'Inhala', hold: true },
  { id: 'holdIn', label: 'Retén', hold: true },
  { id: 'exhale', label: 'Exhala', hold: false },
  { id: 'holdOut', label: 'Retén', hold: true },
];

export function phaseIndexAt(t: number): number {
  const i = Math.floor(Math.max(0, t) / BOX_SIDE_SEC);
  return i > 3 ? 3 : i;
}

/** ¿Debe estar pulsado Espacio en t? */
export function wantHeld(t: number): boolean {
  return BOX_PHASES[phaseIndexAt(t)].hold;
}

/** Punto sobre el perímetro del cuadrado (0..1 × 0..1), empezando abajo-izquierda y subiendo. */
export function squarePoint(t: number, out: { x: number; y: number }): { x: number; y: number } {
  const tt = Math.min(BOX_TOTAL_SEC, Math.max(0, t));
  const i = Math.min(3, Math.floor(tt / BOX_SIDE_SEC));
  const f = (tt - i * BOX_SIDE_SEC) / BOX_SIDE_SEC;
  if (i === 0) {
    out.x = 0;
    out.y = 1 - f; // sube por la izquierda (inhala)
  } else if (i === 1) {
    out.x = f;
    out.y = 0; // arriba (retén)
  } else if (i === 2) {
    out.x = 1;
    out.y = f; // baja por la derecha (exhala)
  } else {
    out.x = 1 - f;
    out.y = 1; // abajo (retén)
  }
  return out;
}

export interface BreathingScorer {
  /** Muestra dt segundos terminando en t con Espacio pulsado o no. Devuelve si fue correcto. */
  sample(t: number, dt: number, held: boolean): boolean;
  quality(): number;
  readonly correctSec: number;
  readonly totalSec: number;
}

export function createBreathingScorer(opts: { windowScale?: number } = {}): BreathingScorer {
  const ws = opts.windowScale ?? 1;
  const grace = 0.35 * ws; // tolerancia tras cada cambio de consigna
  const startGrace = 0.6 * ws; // reacción inicial
  let correct = 0;
  let total = 0;

  /** ¿Estamos dentro de la tolerancia de un cambio de consigna? */
  const inGrace = (t: number) => {
    if (t < startGrace) return true;
    // Cambios de consigna: 8 s (retén → exhala) y 12 s (exhala → retén).
    return (t >= 8 && t < 8 + grace) || (t >= 12 && t < 12 + grace);
  };

  return {
    sample(t, dt, held) {
      if (dt <= 0 || t > BOX_TOTAL_SEC) return held === wantHeld(t);
      const ok = held === wantHeld(t) || inGrace(t);
      total += dt;
      if (ok) correct += dt;
      return ok;
    },
    quality: () => (total > 0 ? Math.min(1, correct / total) : 0),
    get correctSec() {
      return correct;
    },
    get totalSec() {
      return total;
    },
  };
}
