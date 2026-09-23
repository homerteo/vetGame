/**
 * Traza de ECG en canvas con barrido (como un monitor real): cada fotograma
 * solo borra y dibuja el tramo nuevo. Sin asignaciones por fotograma.
 */
import { createEcgTrace, type EcgRhythm } from './logic/ecg';

export class EcgCanvas {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private trace = createEcgTrace();
  private x = 0;
  private y: number;
  private dpr: number;
  color = '#7dffc4';
  glow = 'rgba(125,255,196,0.28)';
  /** Señal extra sumada a la traza (artefactos de compresión en RCP). */
  extra: ((t: number) => number) | null = null;

  constructor(
    parent: HTMLElement,
    readonly w: number,
    readonly h: number,
    private speed = 78, // px/s
    private amp = 0.36, // fracción de la altura por unidad de señal
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ecg-canvas';
    this.dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    parent.appendChild(this.canvas);
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = this.canvas.getContext('2d');
    } catch {
      ctx = null;
    }
    this.ctx = ctx;
    if (ctx) {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
    }
    this.y = h * 0.6;
  }

  get beats(): number {
    return this.trace.beats;
  }

  /** Reloj interno de la traza (s). */
  get time(): number {
    return this.trace.time;
  }

  setColors(color: string, glow: string): void {
    this.color = color;
    this.glow = glow;
  }

  private pending = 0;
  private primed = false;

  /** Avanza dt segundos a la FC y ritmo dados (dibuja a ~30 Hz, acumulando el tiempo). */
  step(dtIn: number, hr: number, rhythm: EcgRhythm): void {
    if (!this.primed) {
      // El monitor ya "estaba encendido": rellena una pantalla completa de traza.
      this.primed = true;
      const chunks = Math.ceil((this.w / this.speed) * 30) - 2;
      for (let i = 0; i < chunks; i++) {
        this.pending = 1 / 30;
        this.step(0, hr, rhythm);
      }
    }
    this.pending += dtIn;
    if (this.pending < 1 / 30) return;
    const dt = Math.min(this.pending, 0.25);
    this.pending = 0;
    const ctx = this.ctx;
    const dist = Math.min(this.w, this.speed * dt);
    const n = Math.max(1, Math.ceil(dist));
    const sub = dt / n;
    const mid = this.h * 0.6;
    const ampPx = this.h * this.amp;
    if (!ctx) {
      for (let i = 0; i < n; i++) this.trace.step(sub, hr, rhythm);
      return;
    }
    // Borra el tramo que se va a dibujar más un hueco por delante del cursor.
    const gap = 14;
    const x0 = this.x;
    const clearW = dist + gap;
    ctx.clearRect(x0 + 0.5, 0, clearW, this.h);
    if (x0 + clearW > this.w) ctx.clearRect(0, 0, x0 + clearW - this.w, this.h);

    let px = this.x;
    let py = this.y;
    ctx.beginPath();
    ctx.moveTo(px, py);
    const stepPx = dist / n;
    for (let i = 0; i < n; i++) {
      let v = this.trace.step(sub, hr, rhythm);
      if (this.extra) v += this.extra(this.trace.time);
      const nx = px + stepPx;
      const ny = mid - v * ampPx;
      if (nx >= this.w) {
        // Vuelta al principio sin trazar la línea que cruza la pantalla.
        ctx.lineTo(this.w, ny);
        px = nx - this.w;
        ctx.moveTo(px, ny);
      } else {
        ctx.lineTo(nx, ny);
        px = nx;
      }
      py = ny;
    }
    ctx.strokeStyle = this.glow;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    this.x = px;
    this.y = py;
  }

  clear(): void {
    this.ctx?.clearRect(0, 0, this.w, this.h);
    this.x = 0;
  }
}
