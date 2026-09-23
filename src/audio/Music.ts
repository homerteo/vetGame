/**
 * Gestor de música: un secuenciador sobre el reloj de pulso y un reproductor por tema
 * con fundidos cruzados. Los cambios de tempo se aplican en el siguiente pulso libre.
 */
import type { MusicState } from '../core/contracts';
import type { BeatClockEx } from './BeatClock';
import { createKit, type Kit } from './instruments';
import { STEPS_PER_BEAT, createSequencer } from './Sequencer';
import { SONGS, type Song, type StepCtx } from './songs';
import { gain, holdParam, type Synth } from './synth';

interface Player {
  state: MusicState;
  song: Song;
  kit: Kit;
  out: GainNode;
  startStep: number;
  endStep: number;
  /** Instante (tiempo de contexto) a partir del cual se puede desconectar. */
  disposeAt: number;
}

const FADE_OUT = 1.4;
const TAIL = 3;

export function createMusic(o: { synth: Synth; bus: AudioNode; clock: BeatClockEx; toCtx: (clockT: number) => number }) {
  const { synth: s, clock, toCtx } = o;
  const players: Player[] = [];
  let state: MusicState = 'silent';
  const sc: StepCtx = { kit: null as unknown as Kit, t: 0, step: 0, bar: 0, s16: 0, spb: 0.5, rand: s.rand };

  const seq = createSequencer(clock, (step, tClock) => {
    const tc = toCtx(tClock);
    const spb = 60 / clock.bpmAt(tClock);
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (step < p.startStep || step >= p.endStep) continue;
      const local = step - p.startStep;
      sc.kit = p.kit;
      sc.t = tc;
      sc.step = local;
      sc.bar = Math.floor(local / 16);
      sc.s16 = local % 16;
      sc.spb = spb;
      try {
        p.song.step(sc);
      } catch {
        // una nota inválida no debe tumbar la música
      }
    }
  });

  return {
    state: () => state,
    /** Cambia de tema con fundido cruzado; el nuevo tempo entra en el siguiente pulso libre. */
    set(next: MusicState, nowClock: number) {
      if (next === state) return;
      state = next;
      const song = SONGS[next];
      const ns = seq.nextStep();
      const minBeat = Math.floor(clock.beatAt(nowClock)) + 1;
      const beat = Math.max(minBeat, ns >= 0 ? Math.ceil(ns / STEPS_PER_BEAT) : minBeat);
      clock.setTempo(song.bpm, beat);
      const startStep = beat * STEPS_PER_BEAT;
      const tSwitch = toCtx(clock.timeOfBeat(beat));
      const fadeSteps = Math.ceil((FADE_OUT * song.bpm) / 60) * STEPS_PER_BEAT;
      for (const p of players) {
        if (p.endStep <= startStep) continue;
        holdParam(p.out.gain, tSwitch);
        p.out.gain.setTargetAtTime(0, tSwitch, FADE_OUT / 4);
        p.endStep = startStep + fadeSteps;
        p.disposeAt = tSwitch + FADE_OUT + TAIL;
      }
      if (next === 'silent') return;
      const out = gain(s, 0);
      out.gain.setValueAtTime(0, tSwitch);
      out.gain.linearRampToValueAtTime(song.level, tSwitch + song.fadeIn);
      out.connect(o.bus);
      players.push({ state: next, song, kit: createKit(s, out), out, startStep, endStep: Infinity, disposeAt: Infinity });
    },
    tick(nowClock: number, horizonClock: number, nowCtx: number) {
      seq.tick(nowClock, horizonClock);
      for (let i = players.length - 1; i >= 0; i--) {
        if (players[i].disposeAt < nowCtx) {
          try {
            players[i].out.disconnect();
          } catch {
            // ya desconectado
          }
          players.splice(i, 1);
        }
      }
    },
    activePlayers: () => players.length,
    dispose() {
      for (const p of players) {
        try {
          p.out.disconnect();
        } catch {
          // nada
        }
      }
      players.length = 0;
    },
  };
}

export type MusicManager = ReturnType<typeof createMusic>;
