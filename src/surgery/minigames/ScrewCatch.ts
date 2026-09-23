import type { AudioAPI, BeatClock } from '../../core/contracts';
import './screwcatch.css';

export type CatchResult = 'perfect' | 'good' | 'miss';

export interface ScrewCatchOptions {
  layer: HTMLElement;
  beat: BeatClock;
  tremor: () => number;
  windowScale: number;
  audio: AudioAPI;
  /**
   * Veces que Fritz vuelve a ofrecer el tornillo si el anillo pasa sin ninguna
   * pulsación (por defecto 1). Pulsar a destiempo sí lo tira siempre.
   */
  reoffers?: number;
  /** Aviso cuando Fritz vuelve a ofrecer el tornillo. */
  onReoffer?(): void;
  onResult(r: CatchResult): void;
}

export interface ScrewCatchAPI {
  update(dt: number): void;
  press(): void;
  dispose(): void;
}

/** Ventanas de tiempo (s) antes de escalar. */
export const CATCH_PERFECT_SEC = 0.06;
export const CATCH_GOOD_SEC = 0.14;
/** Sin pulsar hasta este tiempo tras la llegada → fallo (o nueva oferta). */
export const CATCH_TIMEOUT_SEC = 0.25;
/**
 * Margen mínimo entre que aparece la bandeja y la llegada del anillo: se cuenta
 * con pulsos (3·2·1) y así da tiempo a ver el mini-juego tras un telón o un pop-up.
 */
export const CATCH_MIN_LEAD_SEC = 1.5;
/** Margen mínimo cuando Fritz vuelve a ofrecer el tornillo. */
export const CATCH_REOFFER_LEAD_SEC = 1;
/** El anillo se cierra durante los últimos N pulsos; antes late en su tamaño máximo. */
export const CATCH_APPROACH_BEATS = 2;

/** Primer pulso (en segundos desde ahora) que deja al menos `minLead` de margen. */
export function catchArrival(timeToNextBeat: number, period: number, minLead = CATCH_MIN_LEAD_SEC): number {
  let t = Math.max(0, timeToNextBeat);
  if (period <= 0) return Math.max(t, minLead);
  while (t < minLead - 1e-9) t += period;
  return t;
}

/** Clasifica una pulsación según su desfase respecto a la llegada del anillo. */
export function classifyCatch(offsetSec: number, windowScale: number): CatchResult {
  const d = Math.abs(offsetSec);
  if (d <= CATCH_PERFECT_SEC * windowScale) return 'perfect';
  if (d <= CATCH_GOOD_SEC * windowScale) return 'good';
  return 'miss';
}

const SCREW_SVG = `
<svg viewBox="0 0 40 90" width="34" height="76" aria-hidden="true">
  <defs>
    <linearGradient id="scTi" x1="0" x2="1">
      <stop offset="0" stop-color="#8f8fb0"/><stop offset=".45" stop-color="#f4f2ff"/><stop offset="1" stop-color="#9d99c4"/>
    </linearGradient>
  </defs>
  <rect x="14" y="20" width="12" height="60" rx="3" fill="url(#scTi)" stroke="#5b4a7a" stroke-width="1.5"/>
  <g stroke="#6d5c8f" stroke-width="1.6" stroke-linecap="round">
    <line x1="13" y1="28" x2="27" y2="24"/><line x1="13" y1="36" x2="27" y2="32"/><line x1="13" y1="44" x2="27" y2="40"/>
    <line x1="13" y1="52" x2="27" y2="48"/><line x1="13" y1="60" x2="27" y2="56"/><line x1="13" y1="68" x2="27" y2="64"/>
    <line x1="14" y1="76" x2="26" y2="72"/>
  </g>
  <path d="M20 88 L14 80 H26 Z" fill="#9d99c4" stroke="#5b4a7a" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M6 12 L12 3 H28 L34 12 L28 21 H12 Z" fill="url(#scTi)" stroke="#5b4a7a" stroke-width="2" stroke-linejoin="round"/>
  <path d="M15 12 H25 M20 7 V17" stroke="#ff2e93" stroke-width="2.6" stroke-linecap="round"/>
</svg>`;

/**
 * Mini-juego de atrapar el tornillo que ofrece Fritz: un anillo rosa se cierra
 * hasta llegar justo en el siguiente pulso de la música. Espacio/clic lo atrapa.
 */
export function createScrewCatch(o: ScrewCatchOptions): ScrewCatchAPI {
  const ws = o.windowScale > 0 ? o.windowScale : 1;
  const period = 60 / Math.max(30, o.beat.bpm || 110);
  let arriveAt = catchArrival(o.beat.timeToNextBeat(), period);
  const approach = CATCH_APPROACH_BEATS * period;
  const timeout = Math.max(CATCH_TIMEOUT_SEC, CATCH_GOOD_SEC * ws + 0.02);
  let reoffers = Math.max(0, o.reoffers ?? 1);
  let elapsed = 0;
  let resolved = false;
  let disposed = false;

  const root = document.createElement('div');
  root.className = 'sc-root';
  root.innerHTML = `
    <div class="sc-card">
      <div class="sc-title">Fritz te pasa un tornillo <span class="sc-key">Espacio</span></div>
      <div class="sc-stage">
        <div class="sc-tray"><i></i><i></i><i></i></div>
        <div class="sc-target"></div>
        <div class="sc-ring"></div>
        <div class="sc-screw">${SCREW_SVG}</div>
        <div class="sc-count"></div>
      </div>
      <div class="sc-pop"></div>
    </div>`;
  o.layer.appendChild(root);
  const title = root.querySelector('.sc-title') as HTMLElement;
  const ring = root.querySelector('.sc-ring') as HTMLElement;
  const target = root.querySelector('.sc-target') as HTMLElement;
  const screw = root.querySelector('.sc-screw') as HTMLElement;
  const count = root.querySelector('.sc-count') as HTMLElement;
  const pop = root.querySelector('.sc-pop') as HTMLElement;

  const render = () => {
    const remaining = arriveAt - elapsed;
    // Cuenta atrás en pulsos; el anillo solo se cierra en los últimos pulsos.
    const k = approach > 0 ? Math.min(1, Math.max(0, remaining / approach)) : 0;
    const beatsLeft = Math.ceil(remaining / period - 1e-6);
    const sincePulse = remaining > 0 ? period - (((remaining % period) + period) % period || period) : 0;
    const beatPulse = !resolved && remaining > approach ? Math.exp(-sincePulse * 9) : 0;
    const sc = 1 + 2.2 * k + 0.25 * beatPulse;
    ring.style.transform = `translate(-50%, -50%) scale(${sc.toFixed(3)})`;
    ring.style.opacity = resolved ? '0' : String(remaining > approach ? 0.4 + 0.3 * beatPulse : 0.45 + 0.55 * (1 - k));
    const tpulse = !resolved && remaining > 0 ? Math.exp(-sincePulse * 9) : 0;
    target.style.transform = `translate(-50%, -50%) scale(${(1 + 0.08 * tpulse).toFixed(3)})`;
    count.textContent = !resolved && beatsLeft >= 1 && beatsLeft <= 4 ? String(beatsLeft) : '';
    if (!resolved) {
      const tr = Math.max(0, o.tremor());
      const amp = 3 + 9 * tr;
      const rot = Math.sin(elapsed * 9.1) * amp * 0.7 + Math.sin(elapsed * 17.3 + 1.3) * amp * 0.3;
      const dx = Math.sin(elapsed * 11.7 + 0.4) * amp * 0.45;
      screw.style.transform = `translate(calc(-50% + ${dx.toFixed(2)}px), -50%) rotate(${rot.toFixed(2)}deg)`;
    }
  };

  const resolve = (r: CatchResult) => {
    if (resolved) return;
    resolved = true;
    root.classList.remove('sc-again');
    root.classList.add(`sc-${r}`);
    pop.textContent = r === 'perfect' ? '¡Perfecto!' : r === 'good' ? '¡Bien!' : '¡Se cayó!';
    o.audio.play(r);
    screw.style.transform = '';
    render();
    o.onResult(r);
  };

  /** El anillo pasó sin pulsación: Fritz insiste en el siguiente compás. */
  const reoffer = () => {
    reoffers--;
    while (arriveAt < elapsed + CATCH_REOFFER_LEAD_SEC - 1e-9) arriveAt += period;
    title.innerHTML = 'Fritz insiste… ¡atrápalo! <span class="sc-key">Espacio</span>';
    root.classList.remove('sc-again');
    void root.offsetWidth; // reinicia la animación
    root.classList.add('sc-again');
    o.audio.play('uiClick', { volume: 0.5 });
    o.onReoffer?.();
  };

  render();

  return {
    update(dt) {
      if (disposed) return;
      elapsed += dt;
      if (!resolved && elapsed > arriveAt + timeout) {
        if (reoffers > 0) reoffer();
        else resolve('miss');
      }
      render();
    },
    press() {
      if (disposed || resolved) return;
      resolve(classifyCatch(elapsed - arriveAt, ws));
    },
    dispose() {
      disposed = true;
      root.remove();
    },
  };
}
