import type {
  ChecklistItem,
  DecalKind,
  DrillPinsParams,
  Gauge,
  InstrumentId,
  StepDef,
  Vec2,
  WoundPointer,
} from '../../core/contracts';
import { clamp, dist } from '../../core/math';
import {
  BoneStep,
  HEAT_ZONES,
  createDrillHole,
  drawDepthBar,
  drawHeatRing,
  drawSpotMarker,
  type DrillHole,
  type DrillHoleResult,
} from './drilling';

const ITEM_NAME: Record<DrillPinsParams['item'], string> = {
  pin: 'Aguja',
  kwire: 'Aguja K',
  rod: 'Clavo',
  hole: 'Orificio',
};

const ITEM_DECAL: Record<DrillPinsParams['item'], DecalKind> = {
  pin: 'pin',
  kwire: 'kwire',
  rod: 'pin',
  hole: 'hole',
};

/**
 * Taladrar orificios o insertar agujas en puntos dados: calor en cortical,
 * salida por la segunda cortical (soltar a tiempo) y fisuras en hueso frágil.
 */
export class DrillPinsStep extends BoneStep<DrillPinsParams> {
  readonly instruments: InstrumentId[] = ['drill'];
  private doneSpots: boolean[] = [];
  private hole: DrillHole | null = null;
  private holeIdx = -1;
  private hover: Vec2 = { x: 0, y: 0 };
  private lastHeat = 37;
  /** Última presión vista en el puntero (para las pistas de hueso frágil). */
  private pressure = 3;

  protected onBegin(): void {
    this.doneSpots = this.params.spots.map(() => false);
    this.hover = { ...(this.params.spots[0] ?? { x: 80, y: 50 }) };
    this.overlay({ id: `drillPins:${this.def.id}`, z: 44, draw: (g, px, s, t) => this.draw(g, px, s, t) });
  }

  private tol() {
    return this.params.tolMm * this.tolScale;
  }

  private count() {
    return this.doneSpots.filter(Boolean).length;
  }

  /** Orificio en curso (para pruebas y overlay). */
  current(): DrillHole | null {
    return this.hole;
  }

  onPointerDown(p: WoundPointer): void {
    this.hover = p.mm;
    this.pressure = p.pressure;
    if (this.done || p.button !== 0) return;
    this.interacted = true;
    if (this.hole && this.hole.phase() !== 'done') {
      if (!this.hole.press(p)) this.pop('Vuelve al orificio empezado', this.hole.pos, 'miss');
      return;
    }
    // Elegir el punto pendiente más cercano dentro de la tolerancia.
    const tol = this.tol();
    let best = -1;
    let bestD = tol;
    this.params.spots.forEach((s, i) => {
      const d = dist(p.mm, s);
      if (!this.doneSpots[i] && d <= bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0) {
      this.pop('Apunta a la marca', p.mm, 'miss');
      this.ctx.audio.play('uiError', { volume: 0.4 });
      return;
    }
    const spot = this.params.spots[best];
    this.holeIdx = best;
    this.hole = createDrillHole({
      ctx: this.ctx,
      pos: { ...spot },
      tolMm: tol,
      profileMm: this.params.cortexProfileMm,
      fragile: this.params.fragile,
      tutorial: this.tutorial,
      onDone: (r) => this.onHoleDone(best, spot, r),
    });
    this.hole.press(p);
  }

  onPointerMove(p: WoundPointer): void {
    this.hover = p.mm;
    this.pressure = p.pressure;
    this.hole?.move(p);
    if (this.hole && this.hole.holding() && !(p.buttons & 1)) this.hole.release();
  }

  onPointerUp(p: WoundPointer): void {
    this.hover = p.mm;
    if (!(p.buttons & 1)) this.hole?.release();
  }

  update(dt: number): void {
    const h = this.hole;
    if (h) {
      // update puede terminar el orificio (onDone lo suelta).
      h.update(dt);
      this.lastHeat = h.heat();
    } else {
      this.lastHeat = Math.max(37, this.lastHeat - 5 * dt);
    }
  }

  private onHoleDone(i: number, spot: Vec2, r: DrillHoleResult): void {
    this.doneSpots[i] = true;
    const item = this.params.item;
    this.ctx.bone.implants.pins.push({ pos: { ...spot }, kind: item });
    this.ctx.wound.addDecal(ITEM_DECAL[item], spot, { sizeMm: item === 'hole' ? 2 : 3 });
    if (item !== 'hole') this.ctx.audio.play('kwire');
    const n = this.params.spots.length;
    this.ctx.log.gesture(`${ITEM_NAME[item]} ${this.count()}/${n}`, r.quality);
    if (!r.plunged) this.pop(r.quality >= 0.9 ? '¡Salida limpia!' : `${ITEM_NAME[item]} colocada`, spot, r.quality >= 0.9 ? 'perfect' : 'good');
    this.hole?.dispose();
    this.hole = null;
    this.holeIdx = -1;
    if (this.count() === n) this.complete();
  }

  checklist(): ChecklistItem[] {
    const n = this.params.spots.length;
    return [{ label: `${this.def.label} (${this.count()}/${n})`, done: this.count() === n }];
  }

  progress(): number {
    const n = this.params.spots.length || 1;
    const partial = this.hole ? clamp(this.hole.depth() / this.hole.totalMm, 0, 1) * 0.95 : 0;
    return this.done ? 1 : clamp((this.count() + partial) / n, 0, 1);
  }

  hint(): string {
    const h = this.hole;
    if (h?.phase() === 'breakthrough') return this.hintText('¡Salida! ¡Suelta ya!');
    if (h && h.heat() > 44) return this.hintText('Broca caliente: suelta un momento para enfriar (rueda: menos presión)');
    if (this.params.fragile && this.pressure >= 3) {
      if (h?.holding() && h.layer() !== 'medulla') return this.hintText('¡Cruje! Hueso frágil: suelta o baja la presión con la rueda');
      return this.hintText('Hueso frágil: baja la presión a 1–2 con la rueda o taladra a pulsos cortos');
    }
    if (h && h.layer() === 'trans') return this.hintText('Segunda cortical: atento a la salida y suelta en cuanto la sientas');
    if (h) return this.hintText('Mantén clic para taladrar; dosifica la presión con la rueda');
    return this.hintText(`Clic y mantén sobre una marca para taladrar (${this.count()}/${this.params.spots.length})`);
  }

  gauges(): Gauge[] {
    const h = this.hole;
    const total = h?.totalMm ?? this.params.cortexProfileMm.reduce((a, b) => a + b, 0);
    const [a, m] = this.params.cortexProfileMm;
    return [
      {
        id: 'depth',
        label: 'Profundidad',
        value: h ? h.depth() : 0,
        min: 0,
        max: total,
        unit: 'mm',
        zones: [
          { from: 0, to: a, kind: 'warn' },
          { from: a, to: a + m, kind: 'good' },
          { from: a + m, to: total, kind: 'warn' },
        ],
      },
      { id: 'heat', label: 'Temperatura', value: clamp(this.lastHeat, 30, 70), min: 30, max: 70, unit: '°C', zones: HEAT_ZONES },
    ];
  }

  protected onEnd(): void {
    this.hole?.dispose();
    this.hole = null;
  }

  private draw(g: CanvasRenderingContext2D, px: (p: Vec2) => Vec2, s: number, t: number): void {
    const level = this.ctx.guideLevel;
    // Resalta el agujero en curso o, si no hay ninguno, el siguiente pendiente.
    const next = this.holeIdx >= 0 ? this.holeIdx : this.doneSpots.findIndex((d) => !d);
    this.params.spots.forEach((sp, i) => {
      drawSpotMarker(g, px(sp), s, t, {
        level,
        label: String(i + 1),
        done: this.doneSpots[i],
        active: i === next,
        near: dist(this.hover, sp) < this.tol() * 3,
      });
    });
    const h = this.hole;
    if (h) {
      drawDepthBar(g, px, s, h, t);
      const c = px(h.pos);
      drawHeatRing(g, c, Math.max(14, s * 3), h.heat());
    }
  }
}

export const createDrillPinsStep = (def: StepDef) => new DrillPinsStep(def);
