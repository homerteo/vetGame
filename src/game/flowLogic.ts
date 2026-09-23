/** Lógica pura del flujo de juego (sin DOM), separada para poder probarla. */

export type FlowMode = 'menu' | 'clinic' | 'surgery';

/**
 * Qué hace Esc. Es el ÚNICO sitio que decide la pausa: si otro oyente también
 * reaccionara, la pausa se abriría y cerraría en la misma pulsación.
 */
export function escapeAction(paused: boolean, mode: FlowMode): 'pause' | 'resume' | null {
  if (paused) return 'resume';
  if (mode === 'clinic' || mode === 'surgery') return 'pause';
  return null;
}

/**
 * Protege el bucle: un error en un fotograma se registra y el juego sigue.
 * Si falla `maxConsecutive` fotogramas seguidos, llama a `onGiveUp` (p. ej. volver al menú).
 */
export function createFrameGuard(opts: {
  maxConsecutive: number;
  onError(err: unknown, consecutive: number): void;
  onGiveUp(err: unknown): void;
}) {
  let consecutive = 0;
  return {
    run(fn: () => void): boolean {
      try {
        fn();
        consecutive = 0;
        return true;
      } catch (err) {
        consecutive++;
        opts.onError(err, consecutive);
        if (consecutive >= opts.maxConsecutive) {
          consecutive = 0;
          opts.onGiveUp(err);
        }
        return false;
      }
    },
    get consecutive() {
      return consecutive;
    },
  };
}
