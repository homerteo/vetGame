import type {
  ChecklistItem,
  Gauge,
  InstrumentId,
  Pose2,
  RotateParams,
  StepDef,
  Vec2,
  WoundPointer,
} from '../../core/contracts';
import { PALETTE } from '../../core/constants';
import { add, angleDiff, clamp, dist, rad2deg, rotate, sub } from '../../core/math';
import { BoneStep, drawSpotMarker, drawTag, fmt, roundRect } from './drilling';

/** Giro fino con Q/E (°/s). */
export const ROTATE_KEY_DEG_S = 20;
/** Pasarse del objetivo más de estas unidades → falta de mala alineación. */
export const OVERSHOOT_UNITS = 5;
const PIN_TOL_MM = 3;

/** Abreviatura del valor para la lectura grande ("TPA 14°"). */
export function valueAbbrev(label: string): string {
  if (/meseta/i.test(label)) return 'TPA';
  if (label.length <= 6) return label;
  const words = label.split(/\s+/).filter((w) => w.length > 2);
  return words.map((w) => w[0].toUpperCase()).join('').slice(0, 4) || label.slice(0, 4);
}

/**
 * Rotación de un fragmento alrededor de un pivote (TPLO): arrastrar alrededor del pivote
 * o Q/E; el valor mostrado baja con el giro hasta el objetivo. Luego aguja antirrotacional.
 */
export class RotateStep extends BoneStep<RotateParams> {
  readonly instruments: InstrumentId[];
  private initPose: Pose2 = { pos: { x: 0, y: 0 }, angleDeg: 0 };
  private rotatedDeg = 0;
  private dragging = false;
  private lastAngle = 0;
  private qHeld = false;
  private eHeld = false;
  private locked = false;
  private overshot = false;
  private releases = 0;
  private travelDeg = 0;
  private pinDone = false;
  private hover: Vec2 = { x: 0, y: 0 };
  private lockFx = -1;
  private clock = 0;

  constructor(def: StepDef) {
    super(def);
    const p = def.params as RotateParams;
    this.instruments = p.pinSpot ? ['kern', 'kwire'] : ['kern'];
  }

  protected onBegin(): void {
    const f = this.ctx.bone.fragment(this.params.fragmentId);
    if (f) this.initPose = { pos: { ...f.pose.pos }, angleDeg: f.pose.angleDeg };
    this.hover = { ...this.params.pivot };
    this.overlay({ id: `rotate:${this.def.id}`, z: 46, draw: (g, px, s, t) => this.draw(g, px, s, t) });
  }

  /** Valor actual mostrado (p. ej. ángulo de meseta). */
  value(): number {
    const p = this.params;
    return p.startValue - this.rotatedDeg / p.degPerUnit;
  }

  private tol() {
    return this.params.tolValue * this.tolScale;
  }

  /** Límites razonables: no más de 12 unidades más allá del objetivo ni 8 hacia atrás. */
  private valueRange(): { vMin: number; vMax: number } {
    const p = this.params;
    const dirSign = Math.sign(p.startValue - p.targetValue) || 1;
    return {
      vMin: dirSign > 0 ? p.targetValue - 12 : p.startValue - 8,
      vMax: dirSign > 0 ? p.startValue + 8 : p.targetValue + 12,
    };
  }

  private setRotation(deg: number): void {
    const p = this.params;
    const dirSign = Math.sign(p.startValue - p.targetValue) || 1;
    const { vMin, vMax } = this.valueRange();
    const rMin = (p.startValue - vMax) * p.degPerUnit;
    const rMax = (p.startValue - vMin) * p.degPerUnit;
    const next = clamp(deg, Math.min(rMin, rMax), Math.max(rMin, rMax));
    this.travelDeg += Math.abs(next - this.rotatedDeg);
    this.rotatedDeg = next;
    const pos = add(p.pivot, rotate(sub(this.initPose.pos, p.pivot), next));
    this.ctx.bone.setPose(p.fragmentId, { pos, angleDeg: this.initPose.angleDeg + next });
    // Pasarse del objetivo.
    const past = (p.targetValue - this.value()) * dirSign;
    if (!this.overshot && past > OVERSHOOT_UNITS) {
      this.overshot = true;
      this.ctx.log.fault('malalignment', 'Rotación más allá del objetivo');
      this.pop('¡Te pasaste de rotación!', this.hover, 'bad');
      this.ctx.audio.play('crunch', { volume: 0.7, pitch: 0.8 });
      this.valerioOn('malalignment');
    }
  }

  private tryLock(): void {
    if (this.locked) return;
    this.releases++;
    const p = this.params;
    const err = Math.abs(this.value() - p.targetValue);
    if (err <= this.tol()) {
      this.locked = true;
      this.lockFx = this.clock;
      const f = this.ctx.bone.fragment(p.fragmentId);
      if (f) f.highlighted = true;
      const q = clamp(1 - (err / this.tol()) * 0.3 - (this.overshot ? 0.3 : 0) - Math.max(0, this.releases - 3) * 0.05, 0.1, 1);
      this.ctx.log.gesture(`Rotación: ${p.valueLabel}`, q);
      this.ctx.audio.play('boneClonk');
      this.pop(`¡${valueAbbrev(p.valueLabel)} ${fmt(this.value(), 0)}°! Bloqueada`, p.pivot, q >= 0.9 ? 'perfect' : 'good');
      if (p.pinSpot) this.ctx.selectInstrument('kwire');
      else this.complete();
    } else if (this.travelDeg > 0.5) {
      const left = this.value() - p.targetValue;
      const txt = Math.sign(left) === Math.sign(p.startValue - p.targetValue) ? `Faltan ${fmt(Math.abs(left), 1)}` : `Sobran ${fmt(Math.abs(left), 1)}`;
      this.pop(txt, this.hover, 'miss');
    }
  }

  onPointerDown(p: WoundPointer): void {
    this.hover = p.mm;
    if (this.done || p.button !== 0) return;
    this.interacted = true;
    if (this.locked) {
      this.tryPin(p);
      return;
    }
    if (dist(p.mm, this.params.pivot) < 3) return;
    this.dragging = true;
    this.lastAngle = rad2deg(Math.atan2(p.mm.y - this.params.pivot.y, p.mm.x - this.params.pivot.x));
    this.ctx.audio.play('crunch', { volume: 0.2, pitch: 1.2 });
  }

  onPointerMove(p: WoundPointer): void {
    this.hover = p.mm;
    if (!this.dragging || this.locked) return;
    if (!(p.buttons & 1)) {
      this.dragging = false;
      this.tryLock();
      return;
    }
    if (dist(p.mm, this.params.pivot) < 2) return;
    const a = rad2deg(Math.atan2(p.mm.y - this.params.pivot.y, p.mm.x - this.params.pivot.x));
    const d = angleDiff(a, this.lastAngle);
    this.lastAngle = a;
    this.setRotation(this.rotatedDeg + d);
    if (Math.abs(d) > 0.4 && this.ctx.rng() < 0.15) this.ctx.audio.play('crunch', { volume: 0.2, pitch: 1.1 });
  }

  onPointerUp(p: WoundPointer): void {
    this.hover = p.mm;
    if (this.dragging) {
      this.dragging = false;
      this.tryLock();
    }
  }

  onKey(key: string, down: boolean): boolean {
    if (key !== 'KeyQ' && key !== 'KeyE') return false;
    if (key === 'KeyQ') this.qHeld = down;
    else this.eHeld = down;
    if (down) this.interacted = true;
    else if (!this.qHeld && !this.eHeld && !this.dragging) this.tryLock();
    return true;
  }

  update(dt: number): void {
    this.clock += dt;
    if (this.done || this.locked) return;
    const dir = (this.eHeld ? 1 : 0) - (this.qHeld ? 1 : 0);
    if (dir !== 0) this.setRotation(this.rotatedDeg + dir * ROTATE_KEY_DEG_S * dt);
  }

  private tryPin(p: WoundPointer): void {
    const spot = this.params.pinSpot;
    if (!spot || this.pinDone) return;
    if (p.instrument !== 'kwire') {
      this.pop('Elige la aguja K', p.mm, 'miss');
      return;
    }
    const tol = PIN_TOL_MM * this.tolScale;
    const d = dist(p.mm, spot);
    if (d > tol) {
      this.pop('Fuera del punto de la aguja', p.mm, 'miss');
      return;
    }
    this.pinDone = true;
    this.ctx.bone.implants.pins.push({ pos: { ...spot }, kind: 'kwire' });
    this.ctx.wound.addDecal('kwire', spot, { angleDeg: -35, sizeMm: 6 });
    this.ctx.audio.play('kwire');
    const q = clamp(1 - (d / tol) * 0.5, 0, 1);
    this.ctx.log.gesture('Aguja antirrotacional', q);
    this.pop(q >= 0.9 ? '¡Aguja perfecta!' : 'Aguja colocada', spot, q >= 0.9 ? 'perfect' : 'good');
    this.complete();
  }

  checklist(): ChecklistItem[] {
    const items: ChecklistItem[] = [{ label: this.def.label, done: this.locked }];
    if (this.params.pinSpot) items.push({ label: 'Aguja antirrotacional', done: this.pinDone });
    return items;
  }

  progress(): number {
    if (this.done) return 1;
    const p = this.params;
    const span = Math.abs(p.startValue - p.targetValue) || 1;
    const rot = this.locked ? 1 : clamp(1 - Math.abs(this.value() - p.targetValue) / span, 0, 0.95);
    return p.pinSpot ? rot * 0.8 + (this.pinDone ? 0.2 : 0) : rot;
  }

  hint(): string {
    const p = this.params;
    if (this.locked) return this.hintText('Aguja K: clic en el punto marcado para bloquear la rotación');
    return this.hintText(`Arrastra alrededor del pivote (o Q/E fino) hasta ${fmt(p.targetValue, 0)}° y suelta`);
  }

  gauges(): Gauge[] {
    const p = this.params;
    // Mismo rango que los límites de setRotation: el medidor no se queda clavado al pasarse.
    const { vMin: lo, vMax: hi } = this.valueRange();
    const tol = this.tol();
    return [
      {
        id: 'rotateValue',
        label: p.valueLabel,
        value: clamp(this.value(), lo, hi),
        min: lo,
        max: hi,
        unit: '°',
        zones: [
          { from: lo, to: p.targetValue - tol, kind: 'warn' },
          { from: p.targetValue - tol, to: p.targetValue + tol, kind: 'good' },
          { from: p.targetValue + tol, to: hi, kind: 'warn' },
        ],
      },
    ];
  }

  protected onEnd(): void {
    this.dragging = false;
    this.qHeld = this.eHeld = false;
  }

  // ── Transportador ──

  private draw(g: CanvasRenderingContext2D, px: (p: Vec2) => Vec2, s: number, t: number): void {
    const p = this.params;
    const c = px(p.pivot);
    // Pivote.
    g.save();
    g.fillStyle = PALETTE.fuchsia;
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(c.x, c.y, 5, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    if (this.dragging) {
      const h = px(this.hover);
      g.strokeStyle = 'rgba(255,255,255,0.8)';
      g.setLineDash([4, 4]);
      g.beginPath();
      g.moveTo(c.x, c.y);
      g.lineTo(h.x, h.y);
      g.stroke();
      g.setLineDash([]);
    }
    g.restore();

    // Transportador semicircular sobre el pivote: mapea el rango de valores a 180°.
    const { vMin: lo, vMax: hi } = this.valueRange();
    const R = s * 16;
    const cx = c.x;
    const cy = c.y - s * 20;
    const ang = (v: number) => Math.PI + ((v - lo) / (hi - lo)) * Math.PI;
    g.save();
    g.fillStyle = 'rgba(255,246,251,0.86)';
    g.strokeStyle = PALETTE.lilac;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, R + 10, Math.PI, 2 * Math.PI);
    g.closePath();
    g.fill();
    g.stroke();
    // Zona objetivo.
    const tol = this.tol();
    g.strokeStyle = 'rgba(63,207,156,0.85)';
    g.lineWidth = 10;
    g.beginPath();
    g.arc(cx, cy, R - 2, ang(p.targetValue - tol), ang(p.targetValue + tol));
    g.stroke();
    // Marcas.
    g.strokeStyle = PALETTE.ink;
    for (let v = Math.ceil(lo); v <= hi; v++) {
      const a = ang(v);
      const big = v % 5 === 0;
      g.lineWidth = big ? 2 : 1;
      const r0 = R - (big ? 9 : 5);
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      g.stroke();
      if (big) {
        g.font = '700 9px Nunito, system-ui, sans-serif';
        g.fillStyle = PALETTE.ink;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(v), cx + Math.cos(a) * (R - 16), cy + Math.sin(a) * (R - 16));
      }
    }
    // Aguja.
    const v = clamp(this.value(), lo, hi);
    const a = ang(v);
    const ok = Math.abs(this.value() - p.targetValue) <= tol;
    g.strokeStyle = ok ? '#3fcf9c' : PALETTE.fuchsia;
    g.lineWidth = 3;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * (R + 4), cy + Math.sin(a) * (R + 4));
    g.stroke();
    g.fillStyle = PALETTE.ink;
    g.beginPath();
    g.arc(cx, cy, 4, 0, Math.PI * 2);
    g.fill();
    g.restore();
    // Lectura grande.
    const label = `${valueAbbrev(p.valueLabel)} ${fmt(this.value(), this.locked ? 0 : 1)}°`;
    g.save();
    g.font = '800 22px "Baloo 2", Nunito, system-ui, sans-serif';
    const w = g.measureText(label).width + 22;
    g.fillStyle = ok ? 'rgba(63,207,156,0.95)' : 'rgba(59,33,70,0.9)';
    roundRect(g, cx - w / 2, cy - R - 46, w, 30, 15);
    g.fill();
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, cx, cy - R - 30);
    g.restore();
    drawTag(g, `objetivo ${fmt(p.targetValue, 0)}°`, cx, cy + 12, PALETTE.mint, 11);

    if (this.locked && p.pinSpot) {
      drawSpotMarker(g, px(p.pinSpot), s, t, {
        level: this.ctx.guideLevel,
        label: 'Aguja',
        done: this.pinDone,
        active: !this.pinDone,
        near: dist(this.hover, p.pinSpot) < 9,
      });
    }
    if (this.lockFx >= 0 && this.clock - this.lockFx < 0.8) {
      const k = (this.clock - this.lockFx) / 0.8;
      g.save();
      g.globalAlpha = 1 - k;
      g.strokeStyle = PALETTE.mint;
      g.lineWidth = 4;
      g.beginPath();
      g.arc(c.x, c.y, s * (5 + 16 * k), 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
  }
}

export const createRotateStep = (def: StepDef) => new RotateStep(def);
