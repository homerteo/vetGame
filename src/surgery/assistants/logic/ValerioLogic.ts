/** Valerio: Mirada de Auditor y comentarios con enfriamiento. Estado puro. */
import { CREW_TUNING } from './tuning';

const T = CREW_TUNING.valerio;

export class ValerioLogic {
  gazeEventId: number | null = null;
  faultCd = 0;
  phaseCd = 0;
  speakingLeft = 0;
  annoyedLeft = 0;

  isGazing(): boolean {
    return this.gazeEventId !== null;
  }

  startGaze(id: number): void {
    this.gazeEventId = id;
  }

  endGaze(): void {
    this.gazeEventId = null;
  }

  /** ¿Comenta esta falta? Aplica el enfriamiento (la mitad si está mirando: doble fastidio). */
  wantsFaultComment(): boolean {
    if (this.faultCd > 0) return false;
    this.faultCd = this.isGazing() ? T.gazeFaultCooldownSec : T.faultCooldownSec;
    this.annoyedLeft = this.isGazing() ? 3 : 1.5;
    return true;
  }

  wantsPhaseComment(): boolean {
    if (this.phaseCd > 0) return false;
    this.phaseCd = T.phaseCooldownSec;
    return true;
  }

  spoke(): void {
    this.speakingLeft = 2;
  }

  update(dt: number): void {
    this.faultCd = Math.max(0, this.faultCd - dt);
    this.phaseCd = Math.max(0, this.phaseCd - dt);
    this.speakingLeft = Math.max(0, this.speakingLeft - dt);
    this.annoyedLeft = Math.max(0, this.annoyedLeft - dt);
  }
}
