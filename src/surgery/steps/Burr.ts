import type {
  BurrParams,
  ChecklistItem,
  Gauge,
  InstrumentId,
  LoopHandle,
  StepDef,
  Vec2,
  WoundPointer,
} from '../../core/contracts';
import { PALETTE } from '../../core/constants';
import { clamp, dist, pointInPolygon, polygonBounds, polygonCentroid } from '../../core/math';
import { BoneHeat, BoneStep, HEAT_ZONES, distToPolygonEdge, drawHeatRing, drawTag, fmt, nearPolygon } from './drilling';

/** Intervalo entre pasadas de borrado (s). */
export const BURR_ERASE_SEC = 0.016;
/** Muestreo del área retirada (s). */
export const BURR_POLL_SEC = 0.25;
/** °C/s de la fresa: seca, irrigada; enfriamiento. */
export const BURR_HEAT = { dry: 3, wet: 0.8, cool: 4 } as const;
/** Estrés de Emiliana al rozar la médula. */
export const CORD_STRESS = 20;

/**
 * Fresa/raspa: retirar un área (lámina, cartílago) manteniendo el clic y moviendo,
 * sin acercarse a la zona prohibida (médula). La fresa se calienta; la raspa no.
 */
export class BurrStep extends BoneStep<BurrParams> {
  readonly instruments: InstrumentId[];
  private pointer: Vec2 = { x: 0, y: 0 };
  private held = false;
  private keyIrrigate = false;
  private lastMoveT = -10;
  private eraseAcc = 0;
  private pollAcc = 0;
  private removed = 0;
  private heat = new BoneHeat();
  private contacts = 0;
  private erasesIn = 0;
  private erasesOut = 0;
  private forbidden: Vec2[] | null = null;
  private loop: LoopHandle | null = null;
  private dangerFx = -10;
  private clock = 0;

  constructor(def: StepDef) {
    super(def);
    this.instruments = [(def.params as BurrParams).instrument];
  }

  protected onBegin(): void {
    const p = this.params;
    this.forbidden = p.forbidden && p.forbidden.length >= 3 ? p.forbidden : this.ctx.bone.cord();
    this.pointer = polygonCentroid(p.area);
    this.removed = this.ctx.wound.removedFraction(p.layer, p.area);
    this.overlay({ id: `burr:${this.def.id}`, z: 44, draw: (g, px, s, t) => this.draw(g, px, s, t) });
  }

  private get isBurr() {
    return this.params.instrument === 'burr';
  }

  removedFraction(): number {
    return this.removed;
  }

  temperature(): number {
    return this.heat.c;
  }

  onPointerDown(p: WoundPointer): void {
    this.pointer = p.mm;
    if (this.done || p.button !== 0) return;
    this.interacted = true;
    this.held = true;
    this.lastMoveT = this.clock;
    this.eraseAcc = BURR_ERASE_SEC; // borra en el primer fotograma
    if (!this.loop) {
      this.loop = this.ctx.audio.loop('burr');
      this.loop.set('rate', this.isBurr ? 1 : 0.35);
      this.loop.set('intensity', this.isBurr ? 1 : 0.45);
    }
  }

  onPointerMove(p: WoundPointer): void {
    if (dist(p.mm, this.pointer) > 0.02) this.lastMoveT = this.clock;
    this.pointer = p.mm;
    if (this.held && !(p.buttons & 1)) this.release();
  }

  onPointerUp(p: WoundPointer): void {
    this.pointer = p.mm;
    if (!(p.buttons & 1)) this.release();
  }

  onKey(key: string, down: boolean): boolean {
    if (key === 'KeyI' && this.isBurr) {
      this.keyIrrigate = down;
      return true;
    }
    return false;
  }

  private release(): void {
    this.held = false;
    this.loop?.stop();
    this.loop = null;
  }

  update(dt: number): void {
    this.clock += dt;
    if (this.done) return;
    const p = this.params;
    const moving = this.held && this.clock - this.lastMoveT < 0.12;
    // Calor (solo la fresa).
    if (this.isBurr) {
      const rise = moving ? (this.keyIrrigate ? BURR_HEAT.wet : BURR_HEAT.dry) : 0;
      if (this.heat.step(dt, rise, this.keyIrrigate ? BURR_HEAT.cool + 2 : BURR_HEAT.cool)) {
        this.ctx.log.fault('thermalNecrosis', 'Fresa sin irrigar por encima de 47 °C');
        this.ctx.wound.addDecal('necrosis', this.pointer, { sizeMm: 5 });
        this.pop('¡Necrosis térmica! Irriga (I)', this.pointer, 'bad');
      }
    }
    if (moving) {
      this.eraseAcc += dt;
      while (this.eraseAcc >= BURR_ERASE_SEC) {
        this.eraseAcc -= BURR_ERASE_SEC;
        this.ctx.wound.erase(p.layer, this.pointer, p.brushMm);
        if (pointInPolygon(this.pointer, p.area) || distToPolygonEdge(this.pointer, p.area) <= p.brushMm * 0.5) this.erasesIn++;
        else this.erasesOut++;
      }
      if (this.forbidden && nearPolygon(this.pointer, this.forbidden, p.brushMm)) this.touchForbidden();
    }
    if (this.loop) {
      this.loop.set('load', moving ? 0.8 : 0.15);
      this.loop.set('wet', this.keyIrrigate ? 1 : 0);
    }
    this.pollAcc += dt;
    if (this.pollAcc >= BURR_POLL_SEC) {
      this.pollAcc = 0;
      this.removed = this.ctx.wound.removedFraction(p.layer, p.area);
      if (this.removed >= p.requiredPct) this.finish();
    }
  }

  private touchForbidden(): void {
    if (!this.faultLimited('cordTouch', 1.5, 'Instrumento sobre la médula')) return;
    this.contacts++;
    this.dangerFx = this.clock;
    this.ctx.emiliana.stress(CORD_STRESS, 'Casi toca la médula');
    this.ctx.wound.flash(this.ctx.settings.reduceFlashes ? 'rgba(255,46,147,0.25)' : 'rgba(255,46,147,0.55)', this.ctx.settings.reduceFlashes ? 120 : 220);
    this.ctx.audio.play('alarm', { volume: 0.4 });
    this.pop('¡A 1 mm de la médula!', this.pointer, 'bad');
    this.valerioOn('cordTouch');
  }

  private finish(): void {
    const total = this.erasesIn + this.erasesOut;
    const outside = total ? this.erasesOut / total : 0;
    const q = clamp(1 - this.contacts * 0.25 - outside * 0.6 - (this.heat.necrosis ? 0.3 : 0), 0.05, 1);
    this.ctx.log.gesture(this.params.label, q);
    this.pop(q >= 0.9 ? '¡Fresado impecable!' : '¡Área lista!', polygonCentroid(this.params.area), q >= 0.9 ? 'perfect' : 'good');
    this.ctx.audio.play('crunch', { volume: 0.5, pitch: 1.2 });
    this.release();
    this.complete();
  }

  checklist(): ChecklistItem[] {
    const pct = Math.round(clamp(this.removed / this.params.requiredPct, 0, 1) * 100);
    return [{ label: `${this.params.label} (${pct}%)`, done: this.done }];
  }

  progress(): number {
    return this.done ? 1 : clamp(this.removed / this.params.requiredPct, 0, 1);
  }

  hint(): string {
    const k = this.isBurr ? 'fresa' : 'raspa';
    if (this.isBurr && this.heat.c > 44) return this.hintText('¡Caliente! Mantén I para irrigar mientras fresas');
    if (this.clock - this.dangerFx < 2) return this.hintText('¡Lejos de la zona prohibida! La médula no perdona');
    const irr = this.isBurr ? '; I irriga' : '';
    // Sin guía el área no se dibuja: se nombra la estructura en vez de "el área marcada".
    if (this.ctx.guideLevel === 'none') return this.hintText(`${this.params.label}: mantén clic y pasa la ${k} por encima${irr}`);
    return this.hintText(`Mantén clic y mueve la ${k} sobre el área marcada${irr}`);
  }

  gauges(): Gauge[] {
    const req = this.params.requiredPct * 100;
    const g: Gauge[] = [
      {
        id: 'removed',
        label: 'Retirado',
        value: clamp(this.removed * 100, 0, 100),
        min: 0,
        max: 100,
        unit: '%',
        zones: [
          { from: 0, to: req, kind: 'warn' },
          { from: req, to: 100, kind: 'good' },
        ],
      },
    ];
    if (this.isBurr) g.push({ id: 'heat', label: 'Temperatura', value: clamp(this.heat.c, 30, 70), min: 30, max: 70, unit: '°C', zones: HEAT_ZONES });
    return g;
  }

  protected onEnd(): void {
    this.release();
  }

  // ── Overlay ──

  private path(g: CanvasRenderingContext2D, px: (p: Vec2) => Vec2, poly: Vec2[]): void {
    g.beginPath();
    poly.forEach((v, i) => {
      const q = px(v);
      if (i === 0) g.moveTo(q.x, q.y);
      else g.lineTo(q.x, q.y);
    });
    g.closePath();
  }

  private draw(g: CanvasRenderingContext2D, px: (p: Vec2) => Vec2, s: number, t: number): void {
    const p = this.params;
    const level = this.ctx.guideLevel;
    // Área objetivo según guía.
    if (level === 'full') {
      g.save();
      this.path(g, px, p.area);
      g.fillStyle = 'rgba(159,240,208,0.12)';
      g.fill();
      g.strokeStyle = PALETTE.mint;
      g.lineWidth = 2;
      g.setLineDash([7, 5]);
      g.lineDashOffset = -t * 12;
      g.stroke();
      g.restore();
      const b = polygonBounds(p.area);
      const top = px({ x: (b.minX + b.maxX) / 2, y: b.minY });
      drawTag(g, `${p.label} · ${fmt(this.removed * 100, 0)}%`, top.x, top.y - 12, PALETTE.mint, 12);
    } else if (level === 'endpoints') {
      g.save();
      g.fillStyle = PALETTE.mint;
      for (const v of p.area) {
        const q = px(v);
        g.beginPath();
        g.arc(q.x, q.y, 3.5, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }
    // Zona prohibida: siempre visible (es anatomía, no guía).
    if (this.forbidden) {
      const danger = this.clock - this.dangerFx < 0.6;
      g.save();
      this.path(g, px, this.forbidden);
      g.fillStyle = danger ? 'rgba(255,77,109,0.28)' : 'rgba(255,77,109,0.08)';
      g.fill();
      g.strokeStyle = '#ff4d6d';
      g.lineWidth = danger ? 3.5 : 2.5;
      g.setLineDash([8, 6]);
      g.stroke();
      g.restore();
      const b = polygonBounds(this.forbidden);
      const lab = px({ x: b.maxX - 6, y: b.maxY });
      drawTag(g, 'zona prohibida', lab.x - 30, lab.y + 10, '#ff8fa3', 12);
    }
    // Cabezal de la fresa/raspa.
    const c = px(this.pointer);
    const close = this.forbidden ? nearPolygon(this.pointer, this.forbidden, p.brushMm * 2.2) : false;
    g.save();
    g.strokeStyle = close ? '#ff4d6d' : 'rgba(255,255,255,0.9)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(c.x, c.y, p.brushMm * s, 0, Math.PI * 2);
    g.stroke();
    if (this.held) {
      // Chispitas giratorias.
      g.fillStyle = 'rgba(255,248,230,0.95)';
      for (let i = 0; i < 4; i++) {
        const a = t * (this.isBurr ? 40 : 14) + (i * Math.PI) / 2;
        g.fillRect(c.x + Math.cos(a) * p.brushMm * s * 1.3 - 1.5, c.y + Math.sin(a) * p.brushMm * s * 1.3 - 1.5, 3, 3);
      }
    }
    g.restore();
    if (this.isBurr && (this.held || this.heat.c > 38.5)) drawHeatRing(g, { x: c.x + s * 7, y: c.y - s * 7 }, 15, this.heat.c);
  }
}

export const createBurrStep = (def: StepDef) => new BurrStep(def);
