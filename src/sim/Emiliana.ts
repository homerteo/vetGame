import type { CommandTone, EmilianaAPI, EmilianaInit, EmilianaSnapshot } from '../core/contracts';
import { clamp } from '../core/math';

/**
 * Medidores de Emiliana (GDD §2): Concentración (manos) y Reserva Emocional (mandar).
 * - Dómina: −dominaCost (15, 12 con fusta de pompón). Voz Firme y Dulce: −5. Amable: gratis.
 * - Reserva a 0 → micro-crisis 3 s: no puede mandar y −15 Concentración. Nunca game over.
 *   Con la reserva ya en 0 las órdenes con coste no salen (sin nueva crisis) hasta recuperarla.
 * - Mensaje de la pareja: +35 Reserva, +25 Concentración, 10 s de Pulso Sereno; caduca a los
 *   effects.messageDurationSec y se guarda para la pausa entre fases con la mitad de efecto.
 */

export const FIRM_SWEET_COST = 5;
export const CRISIS_SEC = 3;
export const CRISIS_CONCENTRATION_HIT = 15;
export const MESSAGE_RESERVE = 35;
export const MESSAGE_CONCENTRATION = 25;
export const SERENO_SEC = 10;
export const BREATHING_CONCENTRATION = 20;
export const PRECISION_DRAIN_PER_SEC = 5;
export const TREMOR_BASE_MM = 0.15;
export const TREMOR_MAX_MM = 1.6;
export const LOW_CONCENTRATION = 40;
/** Segundos que se muestra la tarjeta del mensaje leído. */
const MESSAGE_SHOW_SEC = 5;
/** Decaimiento del rubor por segundo. */
const BLUSH_DECAY_PER_SEC = 0.12;

/** Mensajes de reserva si el banco de diálogo llega vacío (cariñosos, nunca degradantes). */
const FALLBACK_MESSAGES = [
  'Buena niña. Qué orgullo me das. — {nombre}',
  'Respira hondo, doctora. Tú puedes con todo. — {nombre}',
  'Te guardé el último pastelito. Buena chica. — {nombre}',
];

export function createEmiliana(init: EmilianaInit): EmilianaAPI {
  let concentration = clamp(init.concentration, 0, 100);
  let reserve = clamp(init.reserve, 0, 100);
  let crisis = false;
  let crisisLeft = 0;
  let serenoLeft = 0;
  let precision = false;
  let blush = 0;

  const pool = init.messagePool.length > 0 ? init.messagePool : FALLBACK_MESSAGES;
  const maxMessages = clamp(Math.floor(init.maxMessages), 0, 3);
  let messageCursor = 0;
  let offered = 0;
  let pending = false;
  let pendingText = '';
  let secondsLeft = 0;
  const storedTexts: string[] = [];
  let showingText: string | null = null;
  let showLeft = 0;

  const commands: Record<CommandTone, number> = { kind: 0, domina: 0, firmSweet: 0 };
  let crises = 0;
  let messagesRead = 0;

  function nextMessageText(): string {
    const raw = pool[messageCursor % pool.length];
    messageCursor++;
    return raw.split('{nombre}').join(init.partner.name);
  }

  function startCrisis() {
    crisis = true;
    crisisLeft = CRISIS_SEC;
    crises++;
    concentration = clamp(concentration - CRISIS_CONCENTRATION_HIT, 0, 100);
  }

  function applyMessage(text: string, factor: number) {
    reserve = clamp(reserve + MESSAGE_RESERVE * factor, 0, 100);
    concentration = clamp(concentration + MESSAGE_CONCENTRATION * factor, 0, 100);
    serenoLeft = Math.max(serenoLeft, SERENO_SEC * factor);
    blush = Math.max(blush, factor >= 1 ? 1 : 0.6);
    showingText = text;
    showLeft = MESSAGE_SHOW_SEC;
    messagesRead++;
  }

  return {
    snapshot(): EmilianaSnapshot {
      return {
        concentration,
        reserve,
        crisis,
        crisisLeft,
        serenoLeft,
        precision,
        blush,
        message: {
          pending,
          secondsLeft: pending ? secondsLeft : 0,
          text: showingText,
          showing: showingText !== null,
          stored: storedTexts.length,
        },
      };
    },

    update(dt, s) {
      if (dt <= 0) return;
      // Temporizadores.
      if (crisis) {
        crisisLeft -= dt;
        if (crisisLeft <= 0) {
          crisis = false;
          crisisLeft = 0;
        }
      }
      if (serenoLeft > 0) serenoLeft = Math.max(0, serenoLeft - dt);
      if (blush > 0) blush = Math.max(0, blush - BLUSH_DECAY_PER_SEC * dt);
      if (showingText !== null) {
        showLeft -= dt;
        if (showLeft <= 0) showingText = null;
      }
      if (pending) {
        secondsLeft -= dt;
        if (secondsLeft <= 0) {
          // Caducó: se guarda para la pausa entre fases.
          pending = false;
          secondsLeft = 0;
          storedTexts.push(pendingText);
        }
      }

      // Concentración.
      let drain = 0;
      if (s.fieldLevelPct > 50) drain += 1.5 * clamp((s.fieldLevelPct - 50) / 30, 0, 1);
      if (s.valerioGazing) drain += 0.8;
      if (s.lowLight) drain += 1;
      if (precision) drain += PRECISION_DRAIN_PER_SEC;
      const calm = drain === 0 && !crisis;
      concentration = clamp(concentration - drain * dt + (calm ? 0.4 * dt : 0), 0, 100);
    },

    stress(amount, _reason) {
      if (!Number.isFinite(amount)) return;
      concentration = clamp(concentration - amount, 0, 100);
    },

    command(tone) {
      if (crisis) return { allowed: false, reserveCost: 0, crisis: true };
      if (tone === 'kind') {
        commands.kind++;
        return { allowed: true, reserveCost: 0, crisis: false };
      }
      if (tone === 'firmSweet' && !init.firmSweetUnlocked) return { allowed: false, reserveCost: 0, crisis: false };
      const cost = tone === 'domina' ? init.effects.dominaCost : FIRM_SWEET_COST;
      // Sin reserva no sale la voz (la crisis solo se repite tras recuperar y volver a 0).
      if (reserve <= 0) return { allowed: false, reserveCost: 0, crisis: false };
      const paid = Math.min(reserve, cost);
      reserve = clamp(reserve - cost, 0, 100);
      commands[tone]++;
      if (reserve <= 0) {
        startCrisis();
        return { allowed: true, reserveCost: paid, crisis: true };
      }
      return { allowed: true, reserveCost: paid, crisis: false };
    },

    setPrecision(on) {
      precision = on;
    },

    tremorMm() {
      if (serenoLeft > 0) return 0;
      let t = TREMOR_BASE_MM;
      if (concentration < LOW_CONCENTRATION) {
        const k = (LOW_CONCENTRATION - concentration) / LOW_CONCENTRATION;
        t = TREMOR_BASE_MM + (TREMOR_MAX_MM - TREMOR_BASE_MM) * Math.pow(k, 1.3);
        t *= init.effects.lowConcTremorMult;
      }
      if (init.microMode) t *= 2;
      return t * clamp(init.tremorScale, 0, 1);
    },

    offerMessage() {
      if (pending || offered >= maxMessages) return false;
      offered++;
      pending = true;
      pendingText = nextMessageText();
      secondsLeft = init.effects.messageDurationSec;
      return true;
    },

    readMessage(betweenPhases = false) {
      if (pending) {
        pending = false;
        secondsLeft = 0;
        applyMessage(pendingText, 1);
        return { text: pendingText };
      }
      if (betweenPhases && storedTexts.length > 0) {
        const text = storedTexts.shift() as string;
        applyMessage(text, 0.5);
        return { text };
      }
      return null;
    },

    breathingDone(quality) {
      const q = clamp(Number.isFinite(quality) ? quality : 0, 0, 1);
      concentration = clamp(concentration + BREATHING_CONCENTRATION * q, 0, 100);
    },

    stats() {
      return { commands: { ...commands }, crises, messagesRead };
    },
  };
}
