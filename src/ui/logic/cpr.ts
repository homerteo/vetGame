/**
 * Máquina de estados de la RCP (GDD §5), sin DOM ni azar:
 *  compresiones (asistolia) → FV tras ~3 s de compresiones → cargar (mantener D 2 s)
 *  → "¡Despejen!" (esperar a que Gigi se aparte) → soltar D = descarga → resultado.
 * Calidad = 65 % adherencia al ritmo 100–120/min (× volumen de compresiones)
 *         + 35 % rapidez de la descarga desde el inicio de la FV − penalizaciones.
 * Éxito si calidad ≥ 0,55 (determinista).
 */
import { clamp } from '../../core/math';
import { createRateMeter, type RateMeter } from './rateMeter';

export type CPRPhase = 'compress' | 'vf' | 'charging' | 'charged' | 'result' | 'done';
export type CPRRhythm = 'asystole' | 'vfib' | 'sinus';
export type CompressionJudgement = 'first' | 'slow' | 'fast' | 'good';

export type CPREvent =
  | 'vent' // Fritz ventila (ambú)
  | 'vfOnset' // aparece la FV
  | 'chargeStart'
  | 'chargeAbort' // soltó D antes de completar la carga
  | 'charged' // "¡Despejen!"
  | 'unsafeRelease' // soltó D con Gigi tocando la camilla: la descarga se cancela
  | 'shock'
  | 'timeout'
  | 'done';

export interface CPRConfig {
  windowScale?: number; // 1 | 1.5 | 2: ensancha la zona de ritmo válida
  vfAfterSec?: number; // segundos de compresiones activas hasta la FV
  chargeSec?: number;
  ventEverySec?: number;
  timeoutSec?: number; // sin descarga en este tiempo → fracaso
  resultHoldSec?: number; // tiempo mostrando el resultado antes de 'done'
  compressionsForFullVolume?: number;
  successThreshold?: number;
  /**
   * Reloj del ritmo (s) para medir las pulsaciones. Por defecto, el tiempo del juego.
   * La interfaz pasa el reloj real: un tirón de fotogramas no debe falsear el ritmo del jugador.
   */
  rhythmClock?: () => number;
}

export const CPR_RATE_MIN = 100;
export const CPR_RATE_MAX = 120;

export interface CPRMachine {
  readonly phase: CPRPhase;
  readonly rhythm: CPRRhythm;
  readonly t: number;
  /** Carga del desfibrilador 0..1. */
  readonly charge: number;
  readonly meter: RateMeter;
  /** Ritmo actual (compresiones/min). */
  rate(): number;
  /** Zona de ritmo válida (con la ventana de accesibilidad aplicada). */
  readonly zone: { min: number; max: number };
  /** Registra una compresión (Espacio). */
  compress(): CompressionJudgement;
  /** Avanza el tiempo. Los eventos de este paso quedan en `events` (array reutilizado). */
  update(dt: number, input: { dHeld: boolean; clear: boolean }): readonly CPREvent[];
  readonly events: readonly CPREvent[];
  readonly compressions: { judged: number; good: number; total: number };
  /** Instante (s) del inicio de la FV o null. */
  readonly vfOnsetAt: number | null;
  readonly shockAt: number | null;
  readonly penalty: number;
  /** Calidad actual 0..1 (definitiva tras la descarga o el tiempo agotado). */
  quality(): number;
  readonly success: boolean;
  /** Tiempo de compresión activa acumulado (s). */
  readonly activeCompressionSec: number;
  /** Segundos hasta la próxima ventilación. */
  readonly nextVentIn: number;
}

export function createCPRMachine(cfg: CPRConfig = {}): CPRMachine {
  const ws = cfg.windowScale ?? 1;
  const vfAfter = cfg.vfAfterSec ?? 3;
  const chargeSec = cfg.chargeSec ?? 2;
  const ventEvery = cfg.ventEverySec ?? 6;
  const timeout = cfg.timeoutSec ?? 45;
  const hold = cfg.resultHoldSec ?? 2.4;
  const fullVolume = cfg.compressionsForFullVolume ?? 12;
  const threshold = cfg.successThreshold ?? 0.55;
  const tol = (ws - 1) * 10;
  const zone = { min: CPR_RATE_MIN - tol, max: CPR_RATE_MAX + tol };

  const meter = createRateMeter(4, 16);
  const rt = () => (cfg.rhythmClock ? cfg.rhythmClock() : t);
  const events: CPREvent[] = [];
  const comp = { judged: 0, good: 0, total: 0 };
  let phase: CPRPhase = 'compress';
  let rhythm: CPRRhythm = 'asystole';
  let t = 0;
  let charge = 0;
  let active = 0;
  let ventT = ventEvery;
  let vfOnsetAt: number | null = null;
  let shockAt: number | null = null;
  let penalty = 0;
  let resultT = 0;
  let finalQuality: number | null = null;
  let success = false;

  const rateScore = () => {
    if (comp.judged === 0) return 0;
    const adherence = comp.good / comp.judged;
    const volume = Math.min(1, comp.total / fullVolume);
    return adherence * volume;
  };
  const timingScore = () => {
    if (vfOnsetAt === null || shockAt === null) return 0;
    const d = shockAt - vfOnsetAt;
    return clamp(1 - (d - 8) / 17, 0, 1); // ≤ 8 s perfecto, 25 s = 0
  };
  const computeQuality = () => clamp(0.65 * rateScore() + 0.35 * timingScore() - penalty, 0, 1);

  const finish = (shocked: boolean) => {
    finalQuality = computeQuality();
    success = shocked && finalQuality >= threshold;
    rhythm = success ? 'sinus' : shocked ? 'asystole' : rhythm;
    phase = 'result';
    resultT = 0;
  };

  return {
    get phase() {
      return phase;
    },
    get rhythm() {
      return rhythm;
    },
    get t() {
      return t;
    },
    get charge() {
      return charge;
    },
    meter,
    rate: () => meter.rate(rt()),
    zone,
    compress() {
      if (phase === 'result' || phase === 'done') return 'first';
      comp.total++;
      const r = meter.press(rt());
      // Se juzga desde la 3.ª compresión (ritmo estable con ≥ 2 intervalos).
      if (meter.count < 3 || r <= 0) return 'first';
      comp.judged++;
      if (r < zone.min) return 'slow';
      if (r > zone.max) return 'fast';
      comp.good++;
      return 'good';
    },
    update(dt, input) {
      events.length = 0;
      if (phase === 'done') return events;
      t += dt;
      if (phase === 'result') {
        resultT += dt;
        if (resultT >= hold) {
          phase = 'done';
          events.push('done');
        }
        return events;
      }
      // Compresión activa: última pulsación hace < 1,2 s.
      if (meter.sinceLast(rt()) < 1.2) active += dt;
      ventT -= dt;
      if (ventT <= 0) {
        ventT += ventEvery;
        events.push('vent');
      }
      if (phase === 'compress' && active >= vfAfter) {
        phase = 'vf';
        rhythm = 'vfib';
        vfOnsetAt = t;
        events.push('vfOnset');
      }
      if (phase === 'vf' && input.dHeld) {
        phase = 'charging';
        charge = 0;
        events.push('chargeStart');
      }
      if (phase === 'charging') {
        if (!input.dHeld) {
          phase = 'vf';
          charge = 0;
          events.push('chargeAbort');
        } else {
          charge = Math.min(1, charge + dt / chargeSec);
          if (charge >= 1) {
            phase = 'charged';
            events.push('charged');
          }
        }
      }
      if (phase === 'charged' && !input.dHeld) {
        if (input.clear) {
          shockAt = t;
          charge = 0;
          events.push('shock');
          finish(true);
        } else {
          // Seguridad: el equipo no descarga si alguien toca la camilla.
          penalty += 0.08;
          charge = 0;
          phase = 'vf';
          events.push('unsafeRelease');
        }
      }
      if ((phase === 'compress' || phase === 'vf' || phase === 'charging' || phase === 'charged') && t >= timeout) {
        events.push('timeout');
        finish(false);
      }
      return events;
    },
    events,
    compressions: comp,
    get vfOnsetAt() {
      return vfOnsetAt;
    },
    get shockAt() {
      return shockAt;
    },
    get penalty() {
      return penalty;
    },
    quality: () => finalQuality ?? computeQuality(),
    get success() {
      return success;
    },
    get activeCompressionSec() {
      return active;
    },
    get nextVentIn() {
      return ventT;
    },
  };
}
