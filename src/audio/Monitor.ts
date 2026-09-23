/**
 * Lógica del monitor de constantes: pitido al ritmo de la FC con el tono ligado a la SpO₂
 * (como un pulsioxímetro), alarma con ritmo limitado y tono plano en asistolia.
 * No toca WebAudio: emite órdenes a `MonitorOut` (así se prueba en node).
 */
import type { VitalsSnapshot } from '../core/contracts';

/** SpO₂ → frecuencia del pitido: 880 Hz al 100%, 440 Hz al 80% (una octava cada 20 puntos), suelo en 70%. */
export function spo2ToPitch(spo2: number): number {
  const s = Number.isFinite(spo2) ? Math.min(100, Math.max(70, spo2)) : 100;
  return 440 * Math.pow(2, (s - 80) / 20);
}

export interface MonitorOut {
  beep(t: number, hz: number): void;
  /** high = prioridad alta (paro). */
  alarm(t: number, high: boolean): void;
  /** Tono continuo (asistolia): encender/apagar en `t`. */
  flat(on: boolean, hz: number, t: number): void;
}

/** Periodos mínimos entre alarmas (s). */
export const ALARM_PERIOD_HIGH = 2.6;
export const ALARM_PERIOD_MEDIUM = 7;

export type MonitorMode = 'off' | 'beat' | 'flat' | 'vfib';

export function monitorMode(v: VitalsSnapshot | null): MonitorMode {
  if (!v) return 'off';
  if (v.arrest || v.rhythm === 'asystole' || v.rhythm === 'vfib') {
    if (v.rhythm === 'asystole') return 'flat';
    return 'vfib';
  }
  return v.hr > 0 ? 'beat' : 'flat';
}

export function createMonitor(out: MonitorOut) {
  let v: VitalsSnapshot | null = null;
  let mode: MonitorMode = 'off';
  let flatOn = false;
  let nextBeep = -1;
  let lastBeep = -1;
  let nextAlarm = -1;
  let alarmHigh = false;

  function setFlat(on: boolean, t: number) {
    if (on === flatOn) return;
    flatOn = on;
    out.flat(on, spo2ToPitch(v?.spo2 ?? 100), t);
  }

  return {
    /** Actualiza las constantes (el ritmo no se reinicia: el siguiente pitido se adelanta si la FC sube). */
    set(next: VitalsSnapshot | null, now: number) {
      v = next;
      const m = monitorMode(next);
      mode = m;
      setFlat(m === 'flat', now);
      if (m !== 'beat') nextBeep = -1;
      else if (nextBeep >= 0 && lastBeep >= 0) {
        const interval = 60 / Math.min(300, Math.max(20, next!.hr));
        if (nextBeep > lastBeep + interval) nextBeep = Math.max(now, lastBeep + interval);
      }
      const wantAlarm = m === 'flat' || m === 'vfib' || (m === 'beat' && next!.alarms.length > 0);
      const high = m === 'flat' || m === 'vfib';
      if (!wantAlarm) nextAlarm = -1;
      else if (nextAlarm < 0 || (high && !alarmHigh)) nextAlarm = now + 0.25;
      alarmHigh = high;
    },
    /** Programa lo que caiga antes de `horizon`. */
    tick(now: number, horizon: number) {
      if (!v) return;
      if (mode === 'beat') {
        const interval = 60 / Math.min(300, Math.max(20, v.hr));
        if (nextBeep < 0 || nextBeep < now - 0.25) nextBeep = now + 0.05;
        let guard = 0;
        while (nextBeep < horizon && guard++ < 8) {
          out.beep(nextBeep, spo2ToPitch(v.spo2));
          lastBeep = nextBeep;
          nextBeep += interval;
        }
      }
      if (nextAlarm >= 0) {
        if (nextAlarm < now - 0.5) nextAlarm = now;
        if (nextAlarm < horizon) {
          out.alarm(nextAlarm, alarmHigh);
          nextAlarm += alarmHigh ? ALARM_PERIOD_HIGH : ALARM_PERIOD_MEDIUM;
        }
      }
    },
    mode: () => mode,
    reset(now: number) {
      v = null;
      mode = 'off';
      setFlat(false, now);
      nextBeep = -1;
      nextAlarm = -1;
    },
  };
}

export type MonitorLogic = ReturnType<typeof createMonitor>;
