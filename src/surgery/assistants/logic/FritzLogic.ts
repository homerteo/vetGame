/** Fritz: temblor, pico de nervios, entrega de material y persecución de Panchito. Estado puro. */
import type { CommandTone } from '../../../core/contracts';
import { clamp } from '../../../core/math';
import { CREW_TUNING } from './tuning';

const T = CREW_TUNING.fritz;

export type FritzReaction = 'none' | 'offer' | 'drop' | 'catch';
/** loose = Panchito suelto; chase = Fritz lo persigue; caught = lo lleva en brazos a la puerta; fled = se fue solo. */
export type PanchitoState = 'none' | 'loose' | 'chase' | 'caught' | 'fled';

export class FritzLogic {
  morale = 50;
  readonly base: number;
  spikeEventId: number | null = null;
  modMult = 1;
  modLeft = 0;
  slipLeft = 0;
  reaction: FritzReaction = 'none';
  reactionLeft = 0;
  panchito: PanchitoState = 'none';
  panchitoEventId: number | null = null;
  panchitoLeft = 0; // tiempo del estado actual (persecución / en brazos / huida)
  presented: 'screw' | 'plate' | 'pin' | null = null;

  constructor(noTremor: boolean) {
    this.base = noTremor ? T.noTremor : T.base;
  }

  get spiking(): boolean {
    return this.spikeEventId !== null;
  }

  tremor(): number {
    let v = this.spiking ? T.spike : this.base;
    if (this.modLeft > 0) v *= this.modMult;
    if (this.slipLeft > 0) v += T.slipAdd;
    return clamp(v, 0, T.max);
  }

  startSpike(eventId: number): void {
    this.spikeEventId = eventId;
  }

  /** Termina el pico; devuelve su id (o null). */
  endSpike(): number | null {
    const id = this.spikeEventId;
    this.spikeEventId = null;
    return id;
  }

  startPanchito(eventId: number): void {
    this.panchito = 'loose';
    this.panchitoEventId = eventId;
    this.panchitoLeft = 0;
  }

  /** Panchito se va solo al terminar el evento sin atraparlo. */
  panchitoFlees(): void {
    if (this.panchito === 'loose' || this.panchito === 'chase') {
      this.panchito = 'fled';
      this.panchitoLeft = T.carrySec;
      this.panchitoEventId = null;
    }
  }

  /** Efecto de una orden (tras el retardo). Devuelve ids de eventos resueltos al instante. */
  applyCommand(tone: CommandTone): number[] {
    const resolved: number[] = [];
    const spike = this.endSpike();
    if (spike !== null) resolved.push(spike);
    this.modMult = T.mult[tone];
    this.modLeft = T.modSec;
    if (this.panchito === 'loose') {
      const chase = T.chaseSec[tone];
      if (chase <= 0) {
        const id = this.catchPanchito();
        if (id !== null) resolved.push(id);
      } else {
        this.panchito = 'chase';
        this.panchitoLeft = chase;
      }
    }
    return resolved;
  }

  private catchPanchito(): number | null {
    const id = this.panchitoEventId;
    this.panchito = 'caught';
    this.panchitoLeft = T.carrySec;
    this.panchitoEventId = null;
    return id;
  }

  presentItem(kind: 'screw' | 'plate' | 'pin'): void {
    this.presented = kind;
    this.reaction = 'offer';
    this.reactionLeft = T.reactionSec.offer;
  }

  dropped(): void {
    this.reaction = 'drop';
    this.reactionLeft = T.reactionSec.drop;
    this.presented = null;
  }

  caught(): void {
    this.reaction = 'catch';
    this.reactionLeft = T.reactionSec.catch;
    this.presented = null;
  }

  slip(): void {
    this.slipLeft = T.slipSec;
  }

  /** Avanza temporizadores. Devuelve el id de Panchito si se atrapó en este paso. */
  update(dt: number): { caughtPanchito: number | null } {
    let caughtPanchito: number | null = null;
    this.modLeft = Math.max(0, this.modLeft - dt);
    this.slipLeft = Math.max(0, this.slipLeft - dt);
    if (this.reactionLeft > 0) {
      this.reactionLeft -= dt;
      if (this.reactionLeft <= 0) {
        this.reactionLeft = 0;
        this.reaction = 'none';
      }
    }
    if (this.panchito === 'chase') {
      this.panchitoLeft -= dt;
      if (this.panchitoLeft <= 0) caughtPanchito = this.catchPanchito();
    } else if (this.panchito === 'caught' || this.panchito === 'fled') {
      this.panchitoLeft -= dt;
      if (this.panchitoLeft <= 0) {
        this.panchito = 'none';
        this.panchitoLeft = 0;
      }
    }
    return { caughtPanchito };
  }
}
