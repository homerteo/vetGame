/* Conductor de punteros simulados para probar pasos (y el cauterio) con el contexto falso. */
import type { InstrumentId, StepController, UniversalTool, Vec2, WoundPointer } from '../../../../core/contracts';
import type { FakeCtx } from './fakeContext';

type Target = Pick<StepController, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'update'> | UniversalTool;

export class PointerDriver {
  pressure = 3;
  instrument: InstrumentId;
  private buttons = 0;
  private last: Vec2 = { x: 0, y: 0 };

  constructor(
    readonly target: Target,
    readonly f: FakeCtx,
    instrument: InstrumentId,
    readonly frameDt = 1 / 60,
  ) {
    this.instrument = instrument;
  }

  private ptr(mm: Vec2, button: number): WoundPointer {
    return {
      mm: { x: mm.x, y: mm.y },
      onWound: true,
      button,
      buttons: this.buttons,
      pressure: this.pressure,
      shift: false,
      t: this.f.clock.t,
      instrument: this.instrument,
    };
  }

  /** Avanza el reloj un tiempo llamando a update() por fotogramas. */
  tick(sec: number): this {
    let left = sec;
    while (left > 1e-9) {
      const dt = Math.min(this.frameDt, left);
      this.f.clock.t += dt;
      this.target.update(dt);
      left -= dt;
    }
    return this;
  }

  down(x: number, y: number, button = 0): this {
    this.buttons |= 1 << (button === 1 ? 2 : button === 2 ? 1 : 0);
    this.last = { x, y };
    this.target.onPointerDown(this.ptr(this.last, button));
    return this;
  }

  move(x: number, y: number): this {
    this.last = { x, y };
    this.target.onPointerMove(this.ptr(this.last, 0));
    return this;
  }

  up(button = 0): this {
    this.buttons &= ~(1 << (button === 1 ? 2 : button === 2 ? 1 : 0));
    this.target.onPointerUp(this.ptr(this.last, button));
    return this;
  }

  /** Clic rápido (bajar y subir en el mismo fotograma). */
  click(x: number, y: number, button = 0): this {
    return this.down(x, y, button).up(button).tick(this.frameDt);
  }

  /** Arrastre a velocidad constante (mm/s) a lo largo de puntos, un 'move' por fotograma. */
  drag(points: Vec2[], speedMmS = 60): this {
    if (points.length === 0) return this;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.ceil(L / (speedMmS * this.frameDt)));
      for (let k = 1; k <= steps; k++) {
        this.tick(this.frameDt);
        this.move(a.x + ((b.x - a.x) * k) / steps, a.y + ((b.y - a.y) * k) / steps);
      }
    }
    return this;
  }

  /** Trazo completo: bajar en el primero, arrastrar y soltar. */
  stroke(points: Vec2[], speedMmS = 60): this {
    this.down(points[0].x, points[0].y);
    this.drag(points, speedMmS);
    return this.up();
  }

  /** Mantener pulsado en un punto durante sec segundos. */
  hold(x: number, y: number, sec: number): this {
    this.down(x, y);
    this.tick(sec);
    return this.up();
  }

  /** Círculos alrededor de un centro a vueltas/s dadas. */
  circle(center: Vec2, r: number, turns: number, revPerSec: number, startDeg = 0): this {
    const total = turns * 360;
    const degPerFrame = revPerSec * 360 * this.frameDt;
    const a0 = (startDeg * Math.PI) / 180;
    this.down(center.x + Math.cos(a0) * r, center.y + Math.sin(a0) * r);
    for (let d = degPerFrame; d <= total + degPerFrame; d += degPerFrame) {
      this.tick(this.frameDt);
      const a = a0 + (d * Math.PI) / 180;
      this.move(center.x + Math.cos(a) * r, center.y + Math.sin(a) * r);
    }
    return this.up();
  }
}
