/** Rodrigo: aspiración al ritmo de su música, solos de guitarra y groove. Estado puro. */
import type { CommandTone, Vec2 } from '../../../core/contracts';
import { CREW_TUNING, moraleSuctionScale } from './tuning';

const T = CREW_TUNING.rodrigo;

export class RodrigoLogic {
  morale = 50;
  soloing = false;
  soloEventId: number | null = null;
  cryLeft = 0;
  grooveLeft = 0;
  perfectLeft = 0;
  perfectMult = 1;
  slipLeft = 0;
  riffIn = 0;
  private pushed: Vec2 = { x: 0, y: 0 };
  private pushedLeft = 0;
  private tempoIn: number;

  constructor(private rng: () => number) {
    this.tempoIn = this.nextTempo();
  }

  private nextTempo(): number {
    const [a, b] = T.tempoGrooveEvery;
    return a + (b - a) * this.rng();
  }

  suctionRate(): number {
    if (this.soloing) return 0;
    let mult = 1;
    if (this.grooveLeft > 0) mult = Math.max(mult, T.grooveMult);
    if (this.perfectLeft > 0) mult = Math.max(mult, this.perfectMult);
    let r = T.baseRate * moraleSuctionScale(this.morale) * mult;
    if (this.cryLeft > 0) r *= T.cryMult;
    if (this.slipLeft > 0) r *= T.slipMult;
    return r;
  }

  focus(): Vec2 | null {
    return this.pushedLeft > 0 ? this.pushed : null;
  }

  grooveActive(): boolean {
    return !this.soloing && (this.grooveLeft > 0 || this.perfectLeft > 0);
  }

  /** Empuja la manguera: fija el foco 6 s. Devuelve el id del solo que termina (si había). */
  pushHose(mm: Vec2): number | null {
    this.pushed = { x: mm.x, y: mm.y };
    this.pushedLeft = T.pushValidSec;
    return this.endSolo();
  }

  /** Empieza un solo (o llora bajito si el caso lo prohíbe). Devuelve true si hay solo. */
  startSolo(eventId: number, noSolos: boolean, duration: number): boolean {
    if (noSolos) {
      this.cryLeft = Math.max(T.cryMinSec, Math.min(duration, 6));
      return false;
    }
    this.soloing = true;
    this.soloEventId = eventId;
    this.riffIn = 0;
    return true;
  }

  /** Termina el solo; devuelve su id de evento (o null). */
  endSolo(): number | null {
    if (!this.soloing) return null;
    const id = this.soloEventId;
    this.soloing = false;
    this.soloEventId = null;
    return id;
  }

  /** Efecto de una orden (tras el retardo). Devuelve true si arrancó un groove "¡Eso es rock!". */
  applyCommand(tone: CommandTone): boolean {
    this.endSolo();
    this.cryLeft = 0;
    if (tone === 'domina') {
      this.perfectLeft = CREW_TUNING.perfectFor.domina;
      this.perfectMult = T.dominaMult;
      return false;
    }
    if (tone === 'firmSweet') {
      this.perfectLeft = CREW_TUNING.perfectFor.firmSweet;
      this.perfectMult = T.firmMult;
      this.grooveLeft = T.grooveSec;
      return true;
    }
    if (this.morale >= T.grooveMorale) {
      this.grooveLeft = T.grooveSec;
      return true;
    }
    return false;
  }

  slip(): void {
    this.slipLeft = T.slipSec;
  }

  /** Avanza temporizadores. Devuelve eventos útiles para el coordinador. */
  update(dt: number, allowTempoGroove: boolean): { riff: boolean; tempoGroove: boolean } {
    let riff = false;
    let tempoGroove = false;
    this.grooveLeft = Math.max(0, this.grooveLeft - dt);
    this.perfectLeft = Math.max(0, this.perfectLeft - dt);
    this.pushedLeft = Math.max(0, this.pushedLeft - dt);
    this.cryLeft = Math.max(0, this.cryLeft - dt);
    this.slipLeft = Math.max(0, this.slipLeft - dt);
    if (this.soloing) {
      this.riffIn -= dt;
      if (this.riffIn <= 0) {
        riff = true;
        this.riffIn += T.riffEverySec;
      }
    } else if (allowTempoGroove) {
      this.tempoIn -= dt;
      if (this.tempoIn <= 0) {
        this.tempoIn = this.nextTempo();
        if (this.morale >= T.tempoGrooveMinMorale && this.grooveLeft <= 0) {
          this.grooveLeft = T.tempoGrooveSec;
          tempoGroove = true;
        }
      }
    }
    return { riff, tempoGroove };
  }
}
