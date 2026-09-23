/**
 * Secuenciador de semicorcheas con anticipación (patrón "A Tale of Two Clocks"):
 * cada tick programa los pasos que caen antes de `horizon`, en tiempo del reloj de pulso.
 * Paso global k ↔ pulso k/4. Lógica pura (se prueba con un reloj falso).
 */
import type { BeatClockEx } from './BeatClock';

export const STEPS_PER_BEAT = 4;
/** Intervalo del temporizador y ventana de anticipación (s). */
export const SCHED_TICK_MS = 25;
export const SCHED_LOOKAHEAD = 0.1;

export function createSequencer(clock: BeatClockEx, onStep: (step: number, t: number) => void) {
  let next = -1;

  const resync = (now: number) => {
    next = Math.ceil(clock.beatAt(now) * STEPS_PER_BEAT - 1e-9) + 0; // + 0 evita -0
  };

  return {
    /** Programa los pasos con tiempo < horizon. Si se quedó atrás (pestaña dormida), salta sin ráfagas. */
    tick(now: number, horizon: number) {
      if (next < 0) resync(now);
      let t = clock.timeOfBeat(next / STEPS_PER_BEAT);
      if (t < now - 0.05) {
        resync(now);
        t = clock.timeOfBeat(next / STEPS_PER_BEAT);
      }
      let guard = 0;
      while (t < horizon && guard++ < 64) {
        onStep(next, t);
        next++;
        t = clock.timeOfBeat(next / STEPS_PER_BEAT);
      }
    },
    /** Próximo paso sin programar (-1 si aún no arrancó). */
    nextStep: () => next,
    reset() {
      next = -1;
    },
  };
}

export type Sequencer = ReturnType<typeof createSequencer>;
