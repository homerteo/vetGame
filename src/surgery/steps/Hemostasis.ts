import type { ChecklistItem, Gauge, HemostasisParams, InstrumentId, Vec2, WoundPointer } from '../../core/contracts';
import { clamp } from '../../core/math';
import { type CauteryToolAPI, StepA, createCauteryTool, guideAlpha, popAt, roundRect, sayLine } from './CauteryTool';

/** Intervalo entre sangrados al empezar la fase (s). */
export const HEMOSTASIS_STAGGER_SEC = 1.5;

/** Sellar los sangrados del paso con el cauterio y dejar el campo por debajo del objetivo. */
export class HemostasisStep extends StepA<HemostasisParams> {
  readonly instruments: InstrumentId[] = ['cautery'];

  private tool!: CauteryToolAPI;
  private elapsed = 0;
  private spawned = 0;
  private ids: number[] = [];
  private sealedCount = 0;
  private list: ChecklistItem[] = [];
  private fieldLabelPct = 0;

  protected onBegin(): void {
    const p = this.params;
    this.tool = createCauteryTool(this.ctx);
    this.fieldLabelPct = Math.round(p.targetFieldPct);
    this.list = [
      { label: `Sellar sangrados (0/${p.bleeders.length})`, done: p.bleeders.length === 0 },
      { label: `Campo por debajo de ${this.fieldLabelPct}%`, done: false },
    ];
    this.spawnDue();
    this.overlay({ id: `${this.def.id}:hemo`, z: 43, draw: (g, px, ppm, t) => this.draw(g, px, ppm, t) });
  }

  private spawnDue(): void {
    const bl = this.params.bleeders;
    while (this.spawned < bl.length && this.elapsed >= this.spawned * HEMOSTASIS_STAGGER_SEC) {
      const def = bl[this.spawned++];
      const b = this.ctx.bleeding.spawn({ x: def.pos.x, y: def.pos.y }, def.kind, this.ctx.now());
      this.ids.push(b.id);
      this.ctx.bus.emit('bleeder:spawn', { id: b.id, kind: b.kind, pos: b.pos });
      if (b.kind === 'arterial') {
        popAt(this.ctx, '¡Arterial!', b.pos, 'bad');
        this.ctx.hud.alert('arterial', '¡Sangrado arterial! Cauteriza ya');
        sayLine(this.ctx, 'rodrigo', this.ctx.dialogue.rodrigo.idle, 0.3);
      }
    }
  }

  onPointerDown(p: WoundPointer): void {
    if (this.done) return;
    if (p.instrument !== 'cautery') {
      if (p.button === 0) this.pop('Toma el cauterio para sellar', p.mm, 'miss', 'tool', 2);
      return;
    }
    this.tool.onPointerDown(p);
  }

  onPointerMove(p: WoundPointer): void {
    this.tool.onPointerMove(p);
  }

  onPointerUp(p: WoundPointer): void {
    this.tool.onPointerUp(p);
  }

  update(dt: number): void {
    this.elapsed += dt;
    this.spawnDue();
    this.tool.update(dt);
    if (this.done) return;
    // Recuento de sellados propios.
    let sealed = 0;
    const all = this.ctx.bleeding.list();
    for (let i = 0; i < this.ids.length; i++) {
      const id = this.ids[i];
      for (let k = 0; k < all.length; k++) {
        if (all[k].id === id) {
          if (!all[k].active) sealed++;
          break;
        }
      }
    }
    if (sealed !== this.sealedCount) {
      this.sealedCount = sealed;
      this.list[0].label = `Sellar sangrados (${sealed}/${this.params.bleeders.length})`;
    }
    const allSpawned = this.spawned >= this.params.bleeders.length;
    this.list[0].done = allSpawned && sealed >= this.params.bleeders.length;
    const fieldOk = this.ctx.blood.levelPct() < this.params.targetFieldPct;
    this.list[1].done = fieldOk;
    if (allSpawned && this.ctx.bleeding.active().length === 0 && fieldOk) {
      popAt(this.ctx, '¡Campo seco!', this.center(), 'perfect');
      this.complete();
    }
  }

  private center(): Vec2 {
    const b = this.params.bleeders;
    if (b.length === 0) return { x: 80, y: 50 };
    let x = 0;
    let y = 0;
    for (const q of b) {
      x += q.pos.x;
      y += q.pos.y;
    }
    return { x: x / b.length, y: y / b.length };
  }

  private draw(g: CanvasRenderingContext2D, px: (p: Vec2) => Vec2, ppm: number, t: number): void {
    // Marca de prioridad sobre sangrados arteriales activos (según guías).
    const alpha = guideAlpha(this.ctx.guideLevel, 1, 0.8, 0);
    if (alpha <= 0 || this.done) return;
    const act = this.ctx.bleeding.active();
    g.font = `800 ${Math.round(ppm * 2.2)}px Nunito, system-ui, sans-serif`;
    g.textBaseline = 'middle';
    for (let i = 0; i < act.length; i++) {
      const b = act[i];
      const c = px(b.pos);
      const pulse = 0.5 + 0.5 * Math.sin(t * 7 + b.id);
      g.strokeStyle = b.kind === 'arterial' ? `rgba(255,46,147,${(0.5 + 0.4 * pulse) * alpha})` : `rgba(255,143,199,${0.45 * alpha})`;
      g.lineWidth = Math.max(1.5, ppm * 0.35);
      g.setLineDash([ppm * 1.2, ppm * 0.8]);
      g.beginPath();
      g.arc(c.x, c.y, ppm * (4 + pulse * (b.kind === 'arterial' ? 1.2 : 0.4)), 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      if (b.kind === 'arterial') {
        const text = '¡ARTERIAL!';
        const w = g.measureText(text).width + ppm * 2;
        const h = ppm * 3;
        g.fillStyle = `rgba(255,46,147,${0.9 * alpha})`;
        roundRect(g, c.x - w / 2, c.y - ppm * 9.5, w, h, h / 2);
        g.fill();
        g.fillStyle = '#fff';
        g.fillText(text, c.x - w / 2 + ppm, c.y - ppm * 8);
      }
    }
  }

  checklist(): ChecklistItem[] {
    return this.list;
  }

  progress(): number {
    if (this.done) return 1;
    const n = this.params.bleeders.length;
    const sealedFrac = n > 0 ? this.sealedCount / n : 1;
    const level = this.ctx.blood.levelPct();
    const target = this.params.targetFieldPct;
    const fieldFrac = level < target ? 1 : clamp((100 - level) / Math.max(1, 100 - target), 0, 1) * 0.5;
    return clamp(0.8 * sealedFrac + 0.2 * fieldFrac, 0, 0.99);
  }

  protected baseHint(): string {
    if (this.done) return 'Campo seco. Rodrigo, ¡eso fue un solo de aspiración!';
    const act = this.ctx.bleeding.active();
    const level = Math.round(this.ctx.blood.levelPct());
    let arterial = false;
    for (let i = 0; i < act.length; i++) if (act[i].kind === 'arterial') arterial = true;
    if (arterial) {
      return '¡Arterial primero! Mantén clic izq. 1–2 s sobre el chorro pulsátil.';
    }
    if (level >= this.params.targetFieldPct && (act.length === 0 || level >= 50)) {
      return `Campo al ${level}%: pide aspiración a Rodrigo (Z) antes de seguir.`;
    }
    if (act.length > 0) return `Cauterio: mantén clic izq. 1–2 s sobre cada sangrado (${act.length} activos).`;
    return 'Esperando más sangrados… ten el cauterio a mano.';
  }

  gauges(): Gauge[] {
    return this.tool ? this.tool.gauges() : [];
  }

  protected onEnd(): void {
    this.tool?.dispose();
  }
}
