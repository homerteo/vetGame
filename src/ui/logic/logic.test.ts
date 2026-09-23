import { describe, expect, it } from 'vitest';
import { ALERT_PRIORITY, createAlertQueue } from './alerts';
import { createRateMeter } from './rateMeter';
import { createCPRMachine, type CPREvent } from './cpr';
import { BOX_TOTAL_SEC, createBreathingScorer, phaseIndexAt, squarePoint, wantHeld } from './breathing';
import { beatSample, createEcgTrace, vfibSample } from './ecg';
import { ellipsize, fmtDec, fmtInt, fmtTime, fmtVital, readingSeconds } from './format';

describe('format', () => {
  it('formatea tiempo, decimales y enteros en español', () => {
    expect(fmtTime(0)).toBe('0:00');
    expect(fmtTime(75.9)).toBe('1:15');
    expect(fmtTime(-3)).toBe('0:00');
    expect(fmtDec(78.44, 1)).toBe('78,4');
    expect(fmtInt(1250)).toBe('1.250');
    expect(fmtInt(-45)).toBe('−45');
    expect(fmtInt(999)).toBe('999');
    expect(fmtVital(Number.NaN)).toBe('--');
    expect(fmtVital(37.24, 1)).toBe('37,2');
    expect(ellipsize('Hola mundo cruel', 8)).toBe('Hola mu…');
    expect(readingSeconds('corto')).toBeGreaterThanOrEqual(2.2);
    expect(readingSeconds('x'.repeat(500))).toBe(7);
  });
});

describe('cola de alertas', () => {
  it('muestra como máximo 2 y respeta la prioridad', () => {
    const q = createAlertQueue();
    q.push('info', 'a', 0);
    q.push('comment', 'b', 0);
    expect(q.visible().map((v) => v.kind)).toEqual(['comment', 'info']);
    q.push('arrest', '¡Paro!', 0.1);
    expect(q.visible().map((v) => v.kind)).toEqual(['arrest', 'comment']);
    expect(q.pending().map((v) => v.kind)).toEqual(['info']);
    q.push('arterial', 'chorro', 0.2);
    expect(q.visible().map((v) => v.kind)).toEqual(['arrest', 'arterial']);
  });

  it('una alerta de menor prioridad espera y entra cuando hay hueco', () => {
    const q = createAlertQueue();
    q.push('arrest', 'p', 0);
    q.push('arterial', 'a', 0);
    q.push('crew', 'Gigi graba', 0.5);
    expect(q.visible().length).toBe(2);
    expect(q.pending()[0].kind).toBe('crew');
    // arterial caduca a 4,5 s: crew entra si no superó su vida en espera (4 s)
    const changed = q.update(4.4);
    expect(changed).toBe(false);
    q.update(4.6);
    expect(q.visible().map((v) => v.kind)).toEqual(['arrest', 'crew']);
  });

  it('refresca en vez de duplicar el mismo tipo y cuenta versiones', () => {
    const q = createAlertQueue();
    q.push('flood', 'Campo inundado', 0);
    const v0 = q.version;
    q.push('flood', 'Campo inundado', 1);
    expect(q.visible().length).toBe(1);
    expect(q.version).toBe(v0);
    expect(q.visible()[0].expiresAt).toBeCloseTo(5);
    q.push('flood', 'Campo al 90 %', 1.2);
    expect(q.version).toBe(v0 + 1);
    expect(q.visible()[0].text).toBe('Campo al 90 %');
  });

  it('una alerta ligada a un evento dura lo que el evento', () => {
    const q = createAlertQueue();
    // Selfie largo: sigue visible más allá de los 4 s del temporizador
    q.push('crew', 'Gigi se lleva la lámpara', 0);
    for (let t = 0; t <= 12; t += 0.5) {
      q.hold('crew', true, t);
      q.update(t);
    }
    expect(q.visible().map((v) => v.kind)).toEqual(['crew']);
    // Resuelto: se retira enseguida
    q.hold('crew', false, 12.2);
    q.update(12.2);
    expect(q.visible().length).toBe(0);
  });

  it('una alerta sin evento ligado conserva su temporizador', () => {
    const q = createAlertQueue();
    q.push('crew', 'Doña Hortensia llama', 0);
    q.hold('crew', false, 0.5);
    q.update(0.5);
    expect(q.visible().length).toBe(1);
    q.update(4.1);
    expect(q.visible().length).toBe(0);
  });

  it('descarta las pendientes viejas', () => {
    const q = createAlertQueue({ pendingTtlSec: 1 });
    q.push('arrest', 'p', 0);
    q.push('arterial', 'a', 0);
    q.push('info', 'viejo', 0);
    q.update(2);
    expect(q.pending().length).toBe(0);
  });

  it('prioridades del GDD', () => {
    expect(ALERT_PRIORITY.arrest).toBeLessThan(ALERT_PRIORITY.arterial);
    expect(ALERT_PRIORITY.arterial).toBeLessThan(ALERT_PRIORITY.boneHeat);
    expect(ALERT_PRIORITY.boneHeat).toBeLessThan(ALERT_PRIORITY.crew);
    expect(ALERT_PRIORITY.crew).toBe(ALERT_PRIORITY.flood);
    expect(ALERT_PRIORITY.crew).toBeLessThan(ALERT_PRIORITY.comment);
    expect(ALERT_PRIORITY.comment).toBeLessThan(ALERT_PRIORITY.info);
  });
});

describe('medidor de ritmo', () => {
  it('mide 110/min con pulsaciones regulares', () => {
    const m = createRateMeter();
    let r = 0;
    for (let i = 0; i < 12; i++) r = m.press(i * (60 / 110));
    expect(r).toBeCloseTo(110, 0);
    expect(m.count).toBe(12);
  });

  it('solo usa la ventana reciente', () => {
    const m = createRateMeter(3);
    for (let i = 0; i < 10; i++) m.press(i * 1.0); // 60/min
    let t = 10;
    let r = 0;
    for (let i = 0; i < 8; i++) r = m.press((t += 0.5)); // 120/min
    expect(r).toBeCloseTo(120, 0);
  });

  it('decae cuando se deja de pulsar', () => {
    const m = createRateMeter();
    for (let i = 0; i < 8; i++) m.press(i * 0.5);
    expect(m.rate(3.5)).toBeCloseTo(120, 0);
    expect(m.rate(3.5 + 2)).toBeCloseTo(30, 0);
    expect(m.sinceLast(4.5)).toBeCloseTo(1);
  });

  it('0 con menos de dos pulsaciones', () => {
    const m = createRateMeter();
    expect(m.rate(0)).toBe(0);
    expect(m.press(1)).toBe(0);
    m.reset();
    expect(m.count).toBe(0);
    expect(m.sinceLast(5)).toBe(Infinity);
  });
});

/** Simula una RCP: compresiones al ritmo dado; mantiene D desde chargeAt; suelta en releaseAt. */
function runCPR(opts: {
  bpm: number;
  chargeAt?: number;
  releaseAt?: number;
  clearAt?: number;
  until?: number;
  windowScale?: number;
}) {
  const m = createCPRMachine({ windowScale: opts.windowScale ?? 1 });
  const dt = 1 / 60;
  const interval = 60 / opts.bpm;
  let nextPress = 0;
  const log: Array<{ t: number; e: CPREvent }> = [];
  for (let i = 0; i < 60 * (opts.until ?? 60); i++) {
    const t = m.t;
    if (opts.bpm > 0 && t >= nextPress && m.phase !== 'result' && m.phase !== 'done') {
      m.compress();
      nextPress += interval;
    }
    const dHeld = opts.chargeAt !== undefined && t >= opts.chargeAt && (opts.releaseAt === undefined || t < opts.releaseAt);
    const clear = opts.clearAt === undefined ? true : t >= opts.clearAt;
    for (const e of m.update(dt, { dHeld, clear })) log.push({ t: m.t, e });
    if (m.phase === 'done') break;
  }
  return { m, log };
}

describe('máquina de RCP', () => {
  it('aparece la FV tras ~3 s de compresiones', () => {
    const { log } = runCPR({ bpm: 110, until: 6 });
    const vf = log.find((l) => l.e === 'vfOnset');
    expect(vf).toBeDefined();
    expect(vf!.t).toBeGreaterThan(2.9);
    expect(vf!.t).toBeLessThan(3.6);
  });

  it('sin compresiones no hay FV', () => {
    const { log, m } = runCPR({ bpm: 0, until: 10 });
    expect(log.some((l) => l.e === 'vfOnset')).toBe(false);
    expect(m.rhythm).toBe('asystole');
  });

  it('Fritz ventila cada 6 s', () => {
    const { log } = runCPR({ bpm: 110, until: 13 });
    const vents = log.filter((l) => l.e === 'vent').map((l) => l.t);
    expect(vents.length).toBe(2);
    expect(vents[0]).toBeCloseTo(6, 1);
    expect(vents[1]).toBeCloseTo(12, 1);
  });

  it('RCP correcta: ritmo 110, carga, despejen y descarga → éxito', () => {
    const { m, log } = runCPR({ bpm: 110, chargeAt: 4, releaseAt: 6.5 });
    const kinds = log.map((l) => l.e);
    expect(kinds).toContain('chargeStart');
    expect(kinds).toContain('charged');
    expect(kinds).toContain('shock');
    expect(kinds[kinds.length - 1]).toBe('done');
    expect(m.success).toBe(true);
    expect(m.quality()).toBeGreaterThanOrEqual(0.55);
    expect(m.rhythm).toBe('sinus');
    expect(kinds.filter((k) => k === 'done').length).toBe(1);
  });

  it('ritmo demasiado lento → fracaso aunque descargue', () => {
    const { m } = runCPR({ bpm: 70, chargeAt: 4.5, releaseAt: 7 });
    expect(m.shockAt).not.toBeNull();
    expect(m.success).toBe(false);
    expect(m.quality()).toBeLessThan(0.55);
  });

  it('ritmo demasiado rápido → fracaso', () => {
    const { m } = runCPR({ bpm: 170, chargeAt: 4, releaseAt: 6.5 });
    expect(m.success).toBe(false);
  });

  it('la ventana ×2 acepta 128/min', () => {
    const strict = runCPR({ bpm: 128, chargeAt: 4, releaseAt: 6.5 });
    const wide = runCPR({ bpm: 128, chargeAt: 4, releaseAt: 6.5, windowScale: 2 });
    expect(strict.m.success).toBe(false);
    expect(wide.m.success).toBe(true);
  });

  it('soltar D antes de cargar aborta la carga', () => {
    const { log } = runCPR({ bpm: 110, chargeAt: 4, releaseAt: 5, until: 8 });
    expect(log.some((l) => l.e === 'chargeAbort')).toBe(true);
    expect(log.some((l) => l.e === 'shock')).toBe(false);
  });

  it('no descarga si Gigi toca la camilla: penaliza y vuelve a FV', () => {
    const { log, m } = runCPR({ bpm: 110, chargeAt: 4, releaseAt: 6.5, clearAt: 99, until: 10 });
    expect(log.some((l) => l.e === 'unsafeRelease')).toBe(true);
    expect(log.some((l) => l.e === 'shock')).toBe(false);
    expect(m.penalty).toBeGreaterThan(0);
    expect(m.phase).toBe('vf');
  });

  it('espera a que Gigi se aparte manteniendo D', () => {
    const { log, m } = runCPR({ bpm: 110, chargeAt: 4, releaseAt: 9, clearAt: 8 });
    expect(log.some((l) => l.e === 'shock')).toBe(true);
    expect(m.success).toBe(true);
  });

  it('descarga tardía baja la calidad', () => {
    const fast = runCPR({ bpm: 110, chargeAt: 4, releaseAt: 6.5 });
    const slow = runCPR({ bpm: 110, chargeAt: 25, releaseAt: 27.5 });
    expect(slow.m.quality()).toBeLessThan(fast.m.quality());
  });

  it('se agota el tiempo sin descarga → fracaso y done una vez', () => {
    const { log, m } = runCPR({ bpm: 110, until: 60 });
    expect(log.some((l) => l.e === 'timeout')).toBe(true);
    expect(log.filter((l) => l.e === 'done').length).toBe(1);
    expect(m.success).toBe(false);
  });

  it('con reloj de ritmo real, los tirones de fotogramas no falsean el ritmo', () => {
    let real = 0;
    const m = createCPRMachine({ rhythmClock: () => real });
    // El jugador pulsa a 110/min en tiempo real, pero el juego solo avanza la mitad (tirones).
    for (let i = 0; i < 12; i++) {
      m.compress();
      real += 60 / 110;
      m.update(60 / 110 / 2, { dHeld: false, clear: true });
    }
    expect(m.compressions.good).toBe(m.compressions.judged);
    expect(m.rate()).toBeCloseTo(110, -1);
  });

  it('es determinista', () => {
    const a = runCPR({ bpm: 113, chargeAt: 5, releaseAt: 8 });
    const b = runCPR({ bpm: 113, chargeAt: 5, releaseAt: 8 });
    expect(a.m.quality()).toBe(b.m.quality());
  });
});

describe('respiración cuadrada', () => {
  it('fases y consigna', () => {
    expect(phaseIndexAt(0)).toBe(0);
    expect(phaseIndexAt(5)).toBe(1);
    expect(phaseIndexAt(9)).toBe(2);
    expect(phaseIndexAt(15.9)).toBe(3);
    expect(phaseIndexAt(40)).toBe(3);
    expect(wantHeld(2)).toBe(true);
    expect(wantHeld(6)).toBe(true);
    expect(wantHeld(10)).toBe(false);
    expect(wantHeld(14)).toBe(true);
  });

  it('el punto recorre el cuadrado', () => {
    const p = { x: 0, y: 0 };
    expect(squarePoint(0, p)).toEqual({ x: 0, y: 1 });
    expect(squarePoint(4, p)).toEqual({ x: 0, y: 0 });
    expect(squarePoint(8, p)).toEqual({ x: 1, y: 0 });
    expect(squarePoint(12, p)).toEqual({ x: 1, y: 1 });
    expect(squarePoint(2, p).y).toBeCloseTo(0.5);
  });

  const simulate = (policy: (t: number) => boolean, ws = 1) => {
    const s = createBreathingScorer({ windowScale: ws });
    const dt = 1 / 60;
    for (let t = dt; t <= BOX_TOTAL_SEC + 1e-9; t += dt) s.sample(t, dt, policy(t));
    return s.quality();
  };

  it('perfecta = 1', () => {
    expect(simulate(wantHeld)).toBeCloseTo(1, 2);
  });

  it('reacción tardía de 0,3 s sigue siendo casi perfecta', () => {
    expect(simulate((t) => wantHeld(Math.max(0, t - 0.3)))).toBeGreaterThan(0.97);
  });

  it('nunca pulsar ≈ solo la fase de exhalar', () => {
    const q = simulate(() => false);
    expect(q).toBeGreaterThan(0.25);
    expect(q).toBeLessThan(0.35);
  });

  it('siempre pulsado ≈ 0,76', () => {
    const q = simulate(() => true);
    expect(q).toBeGreaterThan(0.72);
    expect(q).toBeLessThan(0.8);
  });

  it('la ventana amplia tolera más', () => {
    const late = (t: number) => wantHeld(Math.max(0, t - 0.6));
    expect(simulate(late, 2)).toBeGreaterThan(simulate(late, 1));
  });
});

describe('ECG', () => {
  it('el pico R domina el latido', () => {
    let maxV = -Infinity;
    let maxAt = 0;
    for (let tb = 0; tb < 0.6; tb += 0.001) {
      const v = beatSample(tb, 0.6);
      if (v > maxV) {
        maxV = v;
        maxAt = tb;
      }
    }
    expect(maxV).toBeGreaterThan(0.9);
    expect(maxAt).toBeGreaterThan(0.2);
    expect(maxAt).toBeLessThan(0.24);
  });

  it('cuenta latidos a la FC real', () => {
    const tr = createEcgTrace();
    for (let i = 0; i < 600; i++) tr.step(0.01, 120, 'sinus'); // 6 s a 120 lpm
    expect(tr.beats).toBe(12);
  });

  it('asistolia plana y FV irregular', () => {
    const tr = createEcgTrace();
    let maxFlat = 0;
    for (let i = 0; i < 300; i++) maxFlat = Math.max(maxFlat, Math.abs(tr.step(0.01, 0, 'asystole')));
    expect(maxFlat).toBeLessThan(0.05);
    let maxVf = 0;
    for (let t = 0; t < 3; t += 0.01) maxVf = Math.max(maxVf, Math.abs(vfibSample(t)));
    expect(maxVf).toBeGreaterThan(0.2);
    expect(maxVf).toBeLessThan(1.2);
  });
});

describe('ritmo del monitor durante un paro', () => {
  it('el HUD copia el ritmo de la RCP y nunca contradice a la superposición', async () => {
    const { monitorRhythm } = await import('./cprDisplay');
    expect(monitorRhythm('sinus', false, null)).toBe('sinus');
    // Las constantes dicen FV, pero la RCP arranca en asistolia: manda la RCP
    expect(monitorRhythm('vfib', true, null)).toBe('asystole');
    expect(monitorRhythm('vfib', true, 'asystole')).toBe('asystole');
    expect(monitorRhythm('vfib', true, 'vfib')).toBe('vfib');
    expect(monitorRhythm('vfib', true, 'sinus')).toBe('sinus');
  });
});
