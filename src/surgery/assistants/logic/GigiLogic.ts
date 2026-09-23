/** Gigi: lámpara, Selfie Cialítica, llamadas de Hortensia, grabaciones, salidas y clip viral. Estado puro. */
import { clamp } from '../../../core/math';
import { CREW_TUNING } from './tuning';

const T = CREW_TUNING.gigi;

export type GigiMode = 'lamp' | 'selfie' | 'call' | 'out';

export class GigiLogic {
  morale = 50;
  light = 1;
  mode: GigiMode = 'lamp';
  selfieEventId: number | null = null;
  callEventId: number | null = null;
  /** Prórroga de la selfie tras el fin del evento (gigiSelfieBoost). */
  selfieExtraLeft = 0;
  filming = false;
  filmLeft = 0;
  outLeft = 0;
  outTotal = 0;
  slipLeft = 0;
  viralLeft = 0; // ventana de 3 s pendiente
  viralClips = 0;
  arrestT = -1; // tiempo en paro (−1 = sin paro)
  clearDelay = 2;
  private filmIn: number;

  constructor(private rng: () => number, private boost: boolean, private canFilm: boolean) {
    this.filmIn = this.nextFilm();
  }

  private nextFilm(): number {
    const [a, b] = T.filmEvery;
    return a + (b - a) * this.rng();
  }

  get inSelfie(): boolean {
    return this.mode === 'selfie';
  }

  lightLevel(): number {
    return this.light;
  }

  isFilming(): boolean {
    return this.filming;
  }

  isClear(): boolean {
    return this.arrestT >= 0 && this.arrestT >= this.clearDelay;
  }

  /** ¿Ignora esta orden? (amable mientras graba o se hace selfies; cualquiera si está fuera). */
  ignores(tone: 'kind' | 'domina' | 'firmSweet'): boolean {
    if (this.mode === 'out') return true;
    return tone === 'kind' && (this.filming || this.mode === 'selfie');
  }

  targetLight(): number {
    if (this.mode === 'selfie') return this.boost ? T.boostLight : T.selfieLight;
    if (this.mode === 'call') return T.callLight;
    if (this.slipLeft > 0) return T.slipLight;
    return 1;
  }

  startSelfie(eventId: number): void {
    this.mode = 'selfie';
    this.selfieEventId = eventId;
    this.selfieExtraLeft = 0;
    this.filming = false;
  }

  /** Fin natural del evento de selfie. Con gigiSelfieBoost se alarga unos segundos. */
  selfieEventEnded(): void {
    if (this.mode !== 'selfie') return;
    this.selfieEventId = null;
    if (this.boost) this.selfieExtraLeft = T.boostExtraSec;
    else this.backToLamp();
  }

  startCall(eventId: number): void {
    if (this.mode === 'out') return;
    if (this.mode === 'selfie') return; // ya está distraída con el móvil
    this.mode = 'call';
    this.callEventId = eventId;
    this.filming = false;
  }

  callEnded(): void {
    if (this.mode === 'call') this.backToLamp();
    this.callEventId = null;
  }

  private backToLamp(): void {
    this.mode = 'lamp';
    this.selfieEventId = null;
    this.callEventId = null;
    this.selfieExtraLeft = 0;
  }

  /** Arregla la lámpara (orden o tecla L). Devuelve ids de eventos resueltos. */
  fixLamp(stopFilming: boolean): number[] {
    const ids: number[] = [];
    if (this.selfieEventId !== null) ids.push(this.selfieEventId);
    if (this.callEventId !== null) ids.push(this.callEventId);
    if (this.mode === 'selfie' || this.mode === 'call') this.backToLamp();
    if (stopFilming) this.filming = false;
    this.light = 1;
    return ids;
  }

  /** Efecto de una orden a Gigi tras el retardo. */
  applyCommand(): number[] {
    return this.fixLamp(true);
  }

  leaveRoom(sec: number): number[] {
    const ids = this.fixLamp(true);
    this.mode = 'out';
    this.outLeft = Math.max(0.5, sec);
    this.outTotal = this.outLeft;
    return ids;
  }

  /** Gesto técnico: si es perfecto y está grabando, abre la ventana del clip viral. */
  onGesture(perfect: boolean): void {
    if (perfect && this.filming && this.viralLeft <= 0) this.viralLeft = T.viralWindowSec;
  }

  /** Una orden a Gigi dentro de la ventana corta el clip. */
  onCommanded(): void {
    this.viralLeft = 0;
  }

  slip(): void {
    this.slipLeft = T.slipSec;
  }

  update(dt: number, arrest: boolean): { viral: boolean; startedFilming: boolean; back: boolean } {
    let viral = false;
    let startedFilming = false;
    let back = false;
    // paro: se aparta de la camilla tras 1–3 s
    if (arrest) {
      if (this.arrestT < 0) {
        this.arrestT = 0;
        const [a, b] = T.clearDelay;
        this.clearDelay = a + (b - a) * this.rng();
        this.filming = false;
      } else this.arrestT += dt;
    } else this.arrestT = -1;
    this.slipLeft = Math.max(0, this.slipLeft - dt);
    if (this.mode === 'selfie' && this.selfieEventId === null && this.selfieExtraLeft > 0) {
      this.selfieExtraLeft -= dt;
      if (this.selfieExtraLeft <= 0) this.backToLamp();
    }
    if (this.mode === 'out') {
      this.outLeft -= dt;
      if (this.outLeft <= 0) {
        this.mode = 'lamp';
        this.outLeft = 0;
        back = true;
      }
    }
    // grabaciones espontáneas (inofensivas)
    if (this.filming) {
      this.filmLeft -= dt;
      if (this.filmLeft <= 0) this.filming = false;
    } else if (this.canFilm && this.mode === 'lamp' && !arrest) {
      this.filmIn -= dt;
      if (this.filmIn <= 0) {
        this.filmIn = this.nextFilm();
        const [a, b] = T.filmSec;
        this.filmLeft = a + (b - a) * this.rng();
        this.filming = true;
        startedFilming = true;
      }
    }
    if (this.viralLeft > 0) {
      this.viralLeft -= dt;
      if (this.viralLeft <= 0) {
        this.viralLeft = 0;
        viral = true;
        this.viralClips++;
      }
    }
    // luz: rampa hacia el objetivo (0,85 en 1 s al bajar; sube rápido)
    const target = this.targetLight();
    const rate = (1 - T.selfieLight) / T.rampSec;
    if (this.light > target) this.light = Math.max(target, this.light - rate * dt);
    else this.light = Math.min(target, this.light + rate * 2 * dt);
    this.light = clamp(this.light, 0, 1);
    return { viral, startedFilming, back };
  }
}
