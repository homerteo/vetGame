import type { BleedType, Bleeder, BleedingAPI, Vec2 } from '../core/contracts';

/** Tasas medias en %BV/s (antes de rateScale). */
export const BLEED_RATE: Record<BleedType, number> = { capillary: 0.02, venous: 0.06, arterial: 0.15 };

/**
 * Onda de pulso arterial con media 1 a lo largo de un latido (fase 0..1):
 * base 0,25 + pico sistólico agudo (sin² en el primer 30 % del ciclo).
 */
const PULSE_BASE = 0.25;
const SYSTOLE = 0.3;
const PULSE_GAIN = (1 - PULSE_BASE) / (SYSTOLE * 0.5); // ∫ sin² = SYSTOLE/2

export function pulseWave(phase: number): number {
  const f = phase - Math.floor(phase);
  if (f >= SYSTOLE) return PULSE_BASE;
  const s = Math.sin((Math.PI * f) / SYSTOLE);
  return PULSE_BASE + PULSE_GAIN * s * s;
}

/** Integral acumulada de pulseWave desde 0 hasta phase (en unidades de latido). */
function pulseIntegral(phase: number): number {
  const n = Math.floor(phase);
  const f = phase - n;
  const sys = Math.min(f, SYSTOLE);
  // ∫0^x sin²(πu/S) du = x/2 − S/(4π)·sin(2πx/S)
  const sinPart = sys / 2 - (SYSTOLE / (4 * Math.PI)) * Math.sin((2 * Math.PI * sys) / SYSTOLE);
  return n + PULSE_BASE * f + PULSE_GAIN * sinPart;
}

/** En paro (FC 0) el sangrado arterial se reduce a un rezumado. */
const ARREST_ARTERIAL_FACTOR = 0.1;

type EmitEntry = { bleeder: Bleeder; amount: number };

export function createBleeding(opts: { rateScale?: number } = {}): BleedingAPI {
  const rateScale = opts.rateScale ?? 1;
  const all: Bleeder[] = [];
  const activeCache: Bleeder[] = [];
  let activeDirty = true;
  let nextId = 1;
  let beatPhase = 0;

  // Salida reutilizada de emit() (válida hasta la siguiente llamada).
  const out: EmitEntry[] = [];
  const entryPool: EmitEntry[] = [];

  const rateOf = (b: Bleeder) => BLEED_RATE[b.kind] * rateScale;

  function refreshActive() {
    if (!activeDirty) return;
    activeCache.length = 0;
    for (const b of all) if (b.active) activeCache.push(b);
    activeDirty = false;
  }

  return {
    spawn(pos: Vec2, kind: BleedType, t: number): Bleeder {
      const b: Bleeder = { id: nextId++, pos: { x: pos.x, y: pos.y }, kind, active: true, bornAt: t };
      all.push(b);
      activeDirty = true;
      return b;
    },

    seal(id, t, charred) {
      const b = all.find((x) => x.id === id);
      if (!b || !b.active) return;
      b.active = false;
      b.sealedAt = t;
      if (charred) b.charred = true;
      activeDirty = true;
    },

    list() {
      return all;
    },

    active() {
      refreshActive();
      return activeCache;
    },

    nearest(p, maxMm) {
      let best: Bleeder | null = null;
      let bestD = maxMm;
      for (const b of all) {
        if (!b.active) continue;
        const d = Math.hypot(b.pos.x - p.x, b.pos.y - p.y);
        if (d <= bestD) {
          bestD = d;
          best = b;
        }
      }
      return best;
    },

    emit(dt, _t, hr) {
      out.length = 0;
      if (dt <= 0) return out;
      const beatsPerSec = Math.max(0, hr) / 60;
      const p0 = beatPhase;
      const p1 = p0 + beatsPerSec * dt;
      beatPhase = p1 > 1e6 ? p1 - Math.floor(p1) : p1;
      // Factor arterial medio en este tick (integral exacta de la onda).
      const arterialFactor = beatsPerSec > 0 ? (pulseIntegral(p1) - pulseIntegral(p0)) / (beatsPerSec * dt) : ARREST_ARTERIAL_FACTOR;
      refreshActive();
      for (let i = 0; i < activeCache.length; i++) {
        const b = activeCache[i];
        let amount = rateOf(b) * dt;
        if (b.kind === 'arterial') amount *= arterialFactor;
        let e = entryPool[i];
        if (!e) {
          e = { bleeder: b, amount: 0 };
          entryPool[i] = e;
        }
        e.bleeder = b;
        e.amount = amount;
        out.push(e);
      }
      return out;
    },

    totalRatePctPerSec() {
      refreshActive();
      let s = 0;
      for (const b of activeCache) s += rateOf(b);
      return s;
    },
  };
}
