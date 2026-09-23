/** Números del equipo quirúrgico (GDD §2 y ARCHITECTURE §crew). */
import type { CommandTone } from '../../../core/contracts';

export const CREW_TUNING = {
  /** Retardo de respuesta por tono (s). kind es aleatorio en el rango. */
  delay: { kind: [1.5, 3] as [number, number], domina: 0.3, firmSweet: 0.8 },
  /** Ventana de ejecución perfecta tras la orden (s). */
  perfectFor: { kind: 0, domina: 8, firmSweet: 4 } as Record<CommandTone, number>,
  /** Cambio de moral por orden. */
  morale: { kind: 1, firmSweet: 2, domina: -3 } as Record<CommandTone, number>,
  /** Segundos que un problema puede durar antes de contar como descuido. */
  neglectGraceSec: 5,
  /** Probabilidad máxima por segundo de un pequeño despiste (moral 0). */
  slipMaxPerSec: 0.02,
  ambientCooldownSec: 8,
  sayDurationSec: 2.8,
  rodrigo: {
    baseRate: 0.12, // %BV/s
    grooveMult: 1.25,
    grooveSec: 10,
    grooveMorale: 70, // "¡Eso es rock!": petición amable con moral alta
    dominaMult: 1.5,
    firmMult: 1.25,
    pushValidSec: 6,
    cryMult: 0.85,
    cryMinSec: 4,
    slipMult: 0.5,
    slipSec: 2,
    riffEverySec: 2.2,
    tempoGrooveEvery: [22, 34] as [number, number], // el tempo de la música "se alinea"
    tempoGrooveSec: 8,
    tempoGrooveMinMorale: 50,
  },
  fritz: {
    base: 1,
    noTremor: 0.2,
    spike: 1.8,
    max: 2.2,
    modSec: 10,
    mult: { kind: 0.7, firmSweet: 0.6, domina: 1.5 } as Record<CommandTone, number>,
    chaseSec: { kind: 2.5, firmSweet: 1.2, domina: 0 } as Record<CommandTone, number>,
    carrySec: 4,
    slipAdd: 0.3,
    slipSec: 2,
    reactionSec: { offer: 1.6, drop: 1.6, catch: 1.2 },
  },
  gigi: {
    selfieLight: 0.15,
    boostLight: 0.1,
    rampSec: 1,
    callLight: 0.6,
    boostExtraSec: 4,
    viralWindowSec: 3,
    filmEvery: [18, 35] as [number, number],
    filmSec: [5, 9] as [number, number],
    clearDelay: [1, 3] as [number, number],
    slipLight: 0.85,
    slipSec: 1.5,
  },
  valerio: { faultCooldownSec: 8, gazeFaultCooldownSec: 4, phaseCooldownSec: 12 },
} as const;

/** Escala de aspiración por moral: 0 → 0.85, 100 → 1.1. */
export function moraleSuctionScale(morale: number): number {
  const m = Math.max(0, Math.min(100, morale)) / 100;
  return 0.85 + 0.25 * m;
}

/** Probabilidad por segundo de un despiste según la moral. */
export function slipChancePerSec(morale: number): number {
  const m = 1 - Math.max(0, Math.min(100, morale)) / 100;
  return CREW_TUNING.slipMaxPerSec * m * m;
}

/** Retardo de respuesta determinista (rng 0..1). */
export function responseDelay(tone: CommandTone, rng: () => number): number {
  const d = CREW_TUNING.delay;
  if (tone === 'domina') return d.domina;
  if (tone === 'firmSweet') return d.firmSweet;
  return d.kind[0] + (d.kind[1] - d.kind[0]) * rng();
}
