/** Bucle de juego con dt limitado (máx. 1/20 s) y pausa. */
export function createLoop(tick: (dt: number, t: number) => void) {
  let last = 0;
  let t = 0;
  let raf = 0;
  let running = false;
  let paused = false;
  const frame = (now: number) => {
    if (!running) return;
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
    last = now;
    // El siguiente fotograma se pide antes del tick: una excepción no debe matar el bucle.
    raf = requestAnimationFrame(frame);
    if (!paused) {
      t += dt;
      tick(dt, t);
    }
  };
  return {
    start() {
      if (running) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    setPaused(p: boolean) {
      paused = p;
      last = 0;
    },
    get paused() {
      return paused;
    },
    get time() {
      return t;
    },
  };
}
