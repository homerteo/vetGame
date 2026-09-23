import { describe, expect, it } from 'vitest';
import { createBeatClock } from './BeatClock';
import { createSequencer, SCHED_LOOKAHEAD } from './Sequencer';

describe('Sequencer', () => {
  it('programa cada semicorchea una sola vez, alineada con el reloj', () => {
    let now = 0;
    const clock = createBeatClock(() => now, 110);
    const got: Array<[number, number]> = [];
    const seq = createSequencer(clock, (s, t) => got.push([s, t]));
    for (; now < 4; now += 0.025) seq.tick(now, now + SCHED_LOOKAHEAD);
    const steps = got.map((g) => g[0]);
    expect(steps[0]).toBe(0);
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBe(steps[i - 1] + 1);
    for (const [s, t] of got) expect(t).toBeCloseTo(clock.timeOfBeat(s / 4), 9);
    // 4 s a 110 BPM ≈ 29,3 corcheas… 7,33 pulsos → ~29 semicorcheas + anticipación
    expect(steps.length).toBeGreaterThan(29);
    expect(steps.length).toBeLessThan(32);
    // todo lo programado cae dentro de la ventana de anticipación
    for (const [, t] of got) expect(t).toBeLessThan(4 + SCHED_LOOKAHEAD);
  });

  it('respeta un cambio de tempo en un pulso futuro', () => {
    let now = 0;
    const clock = createBeatClock(() => now, 100);
    const got: Array<[number, number]> = [];
    const seq = createSequencer(clock, (s, t) => got.push([s, t]));
    for (; now < 1; now += 0.025) seq.tick(now, now + SCHED_LOOKAHEAD);
    clock.setTempo(120, Math.ceil(seq.nextStep() / 4));
    for (; now < 5; now += 0.025) seq.tick(now, now + SCHED_LOOKAHEAD);
    const late = got.filter(([s]) => s >= 16);
    for (let i = 1; i < late.length; i++) expect(late[i][1] - late[i - 1][1]).toBeCloseTo(0.125, 9);
  });

  it('si se queda atrás (pestaña dormida) salta sin ráfaga', () => {
    let now = 0;
    const clock = createBeatClock(() => now, 110);
    let count = 0;
    const seq = createSequencer(clock, () => count++);
    seq.tick(0, 0.1);
    const before = count;
    now = 30;
    seq.tick(now, now + 0.1);
    expect(count - before).toBeLessThanOrEqual(2);
  });
});
