import type { ChecklistItem, ClickTargetsParams, Gauge, InstrumentId, StepDef, Vec2, WoundPointer } from '../../core/contracts';
import { clamp, dist } from '../../core/math';
import { SHARP_INSTRUMENTS, StepA, roundRect, scoreGesture } from './CauteryTool';

/** Radio de "revelado" de objetivos sin guía (mm). */
export const CLICK_HOVER_REVEAL_MM = 6;

/** Clicar objetivos con precisión (agujas, cerclajes, abrazaderas, marcas). */
export class ClickTargetsStep extends StepA<ClickTargetsParams> {
  readonly instruments: InstrumentId[];

  private hit: boolean[] = [];
  private hits = 0;
  private hover = { x: -999, y: -999 };
  private flashAt: number[] = [];
  private clock = 0;
  private list: ChecklistItem[] = [];
  private gDist: Gauge = { id: 'click-dist', label: 'Precisión', value: 0, min: 0, max: 1, unit: 'mm', zones: [] };
  private gaugeList: Gauge[] = [this.gDist];

  constructor(def: StepDef) {
    super(def);
    this.instruments = [(def.params as ClickTargetsParams).instrument];
  }

  protected onBegin(): void {
    const p = this.params;
    this.hit = p.targets.map(() => false);
    this.flashAt = p.targets.map(() => -99);
    this.list = [{ label: `${p.label} (0/${p.targets.length})`, done: p.targets.length === 0 }];
    const tol = this.tolMm;
    this.gDist.max = tol * 2;
    this.gDist.zones = [
      { from: 0, to: tol * 0.5, kind: 'good' },
      { from: tol * 0.5, to: tol, kind: 'warn' },
      { from: tol, to: tol * 2, kind: 'bad' },
    ];
    this.overlay({ id: `${this.def.id}:targets`, z: 45, draw: (g, px, ppm, t) => this.draw(g, px, ppm, t) });
  }

  private get tolMm(): number {
    return this.params.tolMm * this.tol;
  }

  /** Índice del siguiente objetivo (ordenado) o −1. */
  private nextIdx(): number {
    for (let i = 0; i < this.hit.length; i++) if (!this.hit[i]) return i;
    return -1;
  }

  /** Objetivo válido más cercano al punto (según orden). */
  private candidate(mm: Vec2): { i: number; d: number } {
    if (this.params.ordered) {
      const i = this.nextIdx();
      return { i, d: i >= 0 ? dist(mm, this.params.targets[i].pos) : Infinity };
    }
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < this.hit.length; i++) {
      if (this.hit[i]) continue;
      const d = dist(mm, this.params.targets[i].pos);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return { i: best, d: bd };
  }

  onPointerMove(p: WoundPointer): void {
    this.hover.x = p.mm.x;
    this.hover.y = p.mm.y;
  }

  onPointerDown(p: WoundPointer): void {
    if (this.done || p.button !== 0) return;
    this.hover.x = p.mm.x;
    this.hover.y = p.mm.y;
    const inst = this.params.instrument;
    if (p.instrument !== inst) {
      this.pop('Ese no es el instrumento de este paso', p.mm, 'miss', 'tool', 2);
      return;
    }
    const { i, d } = this.candidate(p.mm);
    if (i < 0) return;
    this.gDist.value = Math.min(this.gDist.max, d);
    const tol = this.tolMm;
    if (d > tol) {
      this.pop('Casi…', p.mm, 'miss');
      this.ctx.audio.play('miss', { volume: 0.4 });
      if (SHARP_INSTRUMENTS.has(inst)) {
        const ang = (Math.atan2(p.mm.y - this.params.targets[i].pos.y, p.mm.x - this.params.targets[i].pos.x) * 180) / Math.PI;
        this.ctx.wound.addDecal('scratch', { x: p.mm.x, y: p.mm.y }, { angleDeg: ang, sizeMm: 3 });
      }
      return;
    }
    this.place(i, d);
  }

  private place(i: number, d: number): void {
    const p = this.params;
    const target = p.targets[i];
    this.hit[i] = true;
    this.hits++;
    this.flashAt[i] = this.clock;
    const pos = { x: target.pos.x, y: target.pos.y };
    // Efecto en el mundo según el tipo de calcomanía/implante.
    if (p.decal === 'kwire' || p.decal === 'pin') {
      this.ctx.bone.implants.pins.push({ pos, kind: p.decal });
    } else if (p.decal === 'wire') {
      this.ctx.wound.addDecal('hole', pos, { sizeMm: 1.2 });
    } else {
      this.ctx.wound.addDecal(p.decal, pos, { sizeMm: 3 });
    }
    const metal = p.decal === 'kwire' || p.decal === 'pin' || p.decal === 'wire' || p.decal === 'hole';
    this.ctx.audio.play(metal ? 'kwire' : 'retractorClick');
    scoreGesture(this.ctx, `${p.label}: ${target.label}`, 1 - 0.5 * clamp(d / this.tolMm, 0, 1), pos);
    this.list[0].label = `${p.label} (${this.hits}/${p.targets.length})`;
    if (this.hits >= p.targets.length) this.finish();
  }

  private finish(): void {
    const p = this.params;
    const pts = p.targets.map((t) => ({ x: t.pos.x, y: t.pos.y }));
    if (p.decal === 'wire') {
      // Cerclajes: pares consecutivos (0-1, 2-3…); si sobra uno, se une al anterior.
      for (let i = 0; i + 1 < pts.length; i += 2) this.ctx.bone.implants.wires.push({ a: pts[i], b: pts[i + 1] });
      if (pts.length % 2 === 1 && pts.length > 1) {
        this.ctx.bone.implants.wires.push({ a: pts[pts.length - 2], b: pts[pts.length - 1] });
      }
    } else if (p.decal === 'clamp' && pts.length >= 2) {
      this.ctx.bone.implants.bars.push({ a: pts[0], b: pts[pts.length - 1] });
    }
    this.list[0].done = true;
    this.complete();
  }

  update(dt: number): void {
    this.clock += dt;
  }

  private draw(g: CanvasRenderingContext2D, px: (p: Vec2) => Vec2, ppm: number, t: number): void {
    const p = this.params;
    const lvl = this.ctx.guideLevel;
    const next = p.ordered ? this.nextIdx() : -1;
    const tol = this.tolMm;
    g.font = `800 ${Math.round(ppm * 2.1)}px Nunito, system-ui, sans-serif`;
    g.textBaseline = 'middle';
    // Cerclajes/barras pendientes: línea punteada entre puntos colocados.
    if ((p.decal === 'wire' || p.decal === 'clamp') && !this.done) {
      g.strokeStyle = 'rgba(223,231,239,0.8)';
      g.lineWidth = Math.max(1, ppm * 0.45);
      g.setLineDash([ppm, ppm * 0.8]);
      let prev: Vec2 | null = null;
      for (let i = 0; i < p.targets.length; i++) {
        if (!this.hit[i]) continue;
        const c = px(p.targets[i].pos);
        const linkable = p.decal === 'clamp' || i % 2 === 1;
        if (prev && linkable) {
          g.beginPath();
          g.moveTo(prev.x, prev.y);
          g.lineTo(c.x, c.y);
          g.stroke();
        }
        prev = c;
      }
      g.setLineDash([]);
    }
    for (let i = 0; i < p.targets.length; i++) {
      const tg = p.targets[i];
      const c = px(tg.pos);
      if (this.hit[i]) {
        // Colocado: puntito menta con destello breve.
        const age = this.clock - this.flashAt[i];
        if (age < 0.5) {
          g.strokeStyle = `rgba(159,240,208,${(1 - age / 0.5).toFixed(3)})`;
          g.lineWidth = ppm * 0.6;
          g.beginPath();
          g.arc(c.x, c.y, ppm * (2 + age * 10), 0, Math.PI * 2);
          g.stroke();
        }
        if (p.decal !== 'kwire' && p.decal !== 'pin') {
          g.fillStyle = '#9ff0d0';
          g.beginPath();
          g.arc(c.x, c.y, ppm * 0.8, 0, Math.PI * 2);
          g.fill();
        }
        continue;
      }
      const isNext = !p.ordered || i === next;
      // El objetivo siempre se ve (más tenue sin guías); solo cambian etiquetas y ayudas.
      let alpha = lvl === 'full' ? 1 : lvl === 'endpoints' ? 0.85 : 0.55;
      if (lvl === 'none' && isNext && dist(this.hover, tg.pos) <= CLICK_HOVER_REVEAL_MM) alpha = 0.8;
      if (alpha <= 0) continue;
      const pulse = isNext ? 0.5 + 0.5 * Math.sin(t * 6) : 0;
      const col = isNext ? '255,46,147' : '200,162,232';
      g.strokeStyle = `rgba(${col},${(isNext ? 0.75 + 0.25 * pulse : 0.45) * alpha})`;
      g.lineWidth = Math.max(1.5, ppm * (isNext ? 0.45 : 0.3));
      g.beginPath();
      g.arc(c.x, c.y, ppm * tol * (isNext ? 1 + 0.08 * pulse : 1), 0, Math.PI * 2);
      g.stroke();
      // Mira central.
      g.strokeStyle = `rgba(${col},${0.8 * alpha})`;
      g.lineWidth = Math.max(1, ppm * 0.22);
      g.beginPath();
      g.moveTo(c.x - ppm * 1.2, c.y);
      g.lineTo(c.x + ppm * 1.2, c.y);
      g.moveTo(c.x, c.y - ppm * 1.2);
      g.lineTo(c.x, c.y + ppm * 1.2);
      g.stroke();
      if (lvl === 'full') {
        const text = p.ordered ? `${i + 1}. ${tg.label}` : tg.label;
        const w = g.measureText(text).width + ppm * 1.8;
        const h = ppm * 3;
        const ly = c.y - ppm * tol - h - ppm * 0.6;
        g.fillStyle = isNext ? 'rgba(255,46,147,0.9)' : 'rgba(59,33,70,0.6)';
        roundRect(g, c.x - w / 2, ly, w, h, h / 2);
        g.fill();
        g.fillStyle = '#fff6fb';
        g.fillText(text, c.x - w / 2 + ppm * 0.9, ly + h / 2 + 1);
      }
    }
  }

  checklist(): ChecklistItem[] {
    return this.list;
  }

  progress(): number {
    if (this.done) return 1;
    return this.params.targets.length > 0 ? this.hits / this.params.targets.length : 1;
  }

  protected baseHint(): string {
    const p = this.params;
    const n = p.targets.length;
    if (p.ordered) {
      const i = this.nextIdx();
      if (i < 0) return `${p.label}: listo.`;
      return `Clic izq. justo en «${p.targets[i].label}» (${i + 1}/${n}). Apunta con calma.`;
    }
    return `${p.label}: clic izq. en cada objetivo (${this.hits}/${n}), sin prisas.`;
  }

  gauges(): Gauge[] {
    return this.gaugeList;
  }
}
