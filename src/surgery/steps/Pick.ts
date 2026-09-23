import type { ChecklistItem, Gauge, InstrumentId, PickParams, StepDef, Vec2, WoundPointer } from '../../core/contracts';
import { clamp, distToSegment, pointInPolygon } from '../../core/math';
import { createRng } from '../../core/rng';
import { StepA, guideAlpha, sayLine, scoreGesture } from './CauteryTool';

/** Afinado de la extracción. */
export const PICK = {
  holdSec: 0.6,
  grabExtraMm: 2,
  slipExtraMm: 4,
  forbiddenMarginMm: 1,
  cordFaultGapSec: 2,
  edgeMarginMm: 5,
} as const;

const BLOB_N = 10;

interface ItemState {
  extracted: boolean;
  /** Tiempo (reloj del paso) en que se soltó el material extraído, para el "plop". */
  droppedAt: number;
  held: boolean;
  blob: Float32Array; // radios relativos
  phase: number;
}

/** Distancia de un punto al borde de un polígono. */
function distToPolygonEdge(p: Vec2, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const d = distToSegment(p, poly[j], poly[i]);
    if (d < best) best = d;
  }
  return best;
}

/** ¿Mismo polígono (misma referencia o mismos vértices)? */
function samePoly(a: Vec2[], b: Vec2[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i].x - b[i].x) > 1e-6 || Math.abs(a[i].y - b[i].y) > 1e-6) return false;
  return true;
}

/** Extraer material (disco, esquirlas) con pinzas y retirar fragmentos liberados sin tocar la médula. */
export class PickStep extends StepA<PickParams> {
  readonly instruments: InstrumentId[];

  private items: ItemState[] = [];
  private extractedCount = 0;
  private fragIds: string[] = [];
  private fragsRemoved = 0;
  private forbidden: Vec2[][] = [];
  private clock = 0;
  private down = false;
  private ptr = { x: 0, y: 0 };
  // Agarre de material
  private grab = -1;
  private grabT = 0;
  private grabDist = 0;
  private touchesDuringGrab = 0;
  // Arrastre de fragmento
  private dragId: string | null = null;
  private dragOff = { x: 0, y: 0 };
  private dragTouches = 0;
  private minForbidden = 99;
  private list: ChecklistItem[] = [];
  private gGrip: Gauge = { id: 'pick-grip', label: 'Agarre', value: 0, min: 0, max: PICK.holdSec, unit: 's', zones: [] };
  private gCord: Gauge = {
    id: 'pick-cord',
    label: 'Distancia a la médula',
    value: 10,
    min: 0,
    max: 10,
    unit: 'mm',
    zones: [
      { from: 0, to: 1, kind: 'bad' },
      { from: 1, to: 3, kind: 'warn' },
      { from: 3, to: 10, kind: 'good' },
    ],
  };
  private gaugeList: Gauge[] = [this.gGrip];

  constructor(def: StepDef) {
    super(def);
    this.instruments = [(def.params as PickParams).tool];
  }

  protected onBegin(): void {
    const p = this.params;
    this.items = p.items.map((it) => {
      // Forma de pepita irregular, determinista por id.
      let seed = 7;
      for (let i = 0; i < it.id.length; i++) seed = (seed * 31 + it.id.charCodeAt(i)) >>> 0;
      const r = createRng(seed);
      const blob = new Float32Array(BLOB_N);
      for (let k = 0; k < BLOB_N; k++) blob[k] = 0.78 + r() * 0.34;
      return { extracted: false, droppedAt: -99, held: false, blob, phase: r() * 6.28 };
    });
    this.fragIds = (p.removeFragmentIds ?? []).slice();
    if (p.forbidden && p.forbidden.length >= 3) this.forbidden.push(p.forbidden);
    const cord = this.ctx.bone.cord();
    if (cord && cord.length >= 3 && !this.forbidden.some((q) => samePoly(q, cord))) this.forbidden.push(cord);
    if (this.forbidden.length > 0) this.gaugeList.push(this.gCord);
    this.gGrip.zones = [{ from: PICK.holdSec * 0.8, to: PICK.holdSec, kind: 'good' }];
    this.list = [];
    if (p.items.length > 0) this.list.push({ label: `${p.label} (0/${p.items.length})`, done: false });
    if (this.fragIds.length > 0) this.list.push({ label: `Retirar fragmentos (0/${this.fragIds.length})`, done: false });
    if (this.list.length === 0) this.list.push({ label: p.label, done: false });
    this.overlay({ id: `${this.def.id}:pick`, z: 38, draw: (g, px, ppm, t) => this.draw(g, px, ppm, t) });
  }

  /** Distancia mínima a una zona prohibida (0 si dentro). */
  private forbiddenDist(p: Vec2): number {
    let best = 99;
    for (const poly of this.forbidden) {
      if (pointInPolygon(p, poly)) return 0;
      const d = distToPolygonEdge(p, poly);
      if (d < best) best = d;
    }
    return best;
  }

  private checkForbidden(p: Vec2): void {
    if (this.forbidden.length === 0) return;
    const d = this.forbiddenDist(p);
    this.minForbidden = d;
    this.gCord.value = Math.min(10, d);
    if (d > PICK.forbiddenMarginMm) return;
    if (this.grab >= 0) this.touchesDuringGrab++;
    if (this.dragId) this.dragTouches++;
    if (!this.rl.ok('cord', this.ctx.now(), PICK.cordFaultGapSec)) return;
    this.ctx.log.fault('cordTouch');
    this.ctx.emiliana.stress(15, 'Tocó la médula');
    this.ctx.wound.flash('#ff4d6d', 150);
    this.pop('¡La médula!', p, 'bad');
    this.ctx.audio.play('miss');
    sayLine(this.ctx, 'emiliana', this.ctx.dialogue.emiliana.fault, 0.5);
  }

  onPointerDown(p: WoundPointer): void {
    if (this.done || p.button !== 0) return;
    this.down = true;
    this.ptr.x = p.mm.x;
    this.ptr.y = p.mm.y;
    if (p.instrument !== this.params.tool) {
      this.pop(this.params.tool === 'kern' ? 'Usa las pinzas Kern' : 'Usa las pinzas', p.mm, 'miss', 'tool', 2);
      this.down = false;
      return;
    }
    this.checkForbidden(p.mm);
    // ¿Material cerca?
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].extracted) continue;
      const it = this.params.items[i];
      const d = Math.hypot(p.mm.x - it.pos.x, p.mm.y - it.pos.y);
      if (d <= it.radiusMm + PICK.grabExtraMm * this.tol && d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best >= 0) {
      this.grab = best;
      this.grabT = 0;
      this.grabDist = bd;
      this.touchesDuringGrab = 0;
      this.ctx.audio.play('squelch', { volume: 0.4, pitch: 1.3 });
      return;
    }
    // ¿Fragmento liberado para retirar?
    const id = this.ctx.bone.hitTest(p.mm);
    if (id && this.fragIds.includes(id)) {
      const f = this.ctx.bone.fragment(id);
      if (f) {
        this.dragId = id;
        this.dragOff.x = f.pose.pos.x - p.mm.x;
        this.dragOff.y = f.pose.pos.y - p.mm.y;
        this.dragTouches = 0;
        f.highlighted = true;
        this.ctx.audio.play('crunch', { volume: 0.5 });
        return;
      }
    }
    const locked = this.ctx.bone.hitTest(p.mm, true);
    if (locked && this.fragIds.includes(locked)) {
      this.pop('Aún está unido: libéralo primero', p.mm, 'miss', 'locked', 2);
      return;
    }
    this.pop('Ahí no hay nada que sacar', p.mm, 'miss', 'nothing', 1.5);
  }

  onPointerMove(p: WoundPointer): void {
    this.ptr.x = p.mm.x;
    this.ptr.y = p.mm.y;
    if (this.forbidden.length > 0 && !this.down) this.gCord.value = Math.min(10, this.forbiddenDist(p.mm));
    if (!this.down || this.done) return;
    this.checkForbidden(p.mm);
    if (this.grab >= 0) {
      const it = this.params.items[this.grab];
      const d = Math.hypot(p.mm.x - it.pos.x, p.mm.y - it.pos.y);
      if (d > it.radiusMm + PICK.slipExtraMm * this.tol) {
        this.pop('Se resbaló…', p.mm, 'miss');
        this.grab = -1;
        this.grabT = 0;
      }
    }
    if (this.dragId) {
      const f = this.ctx.bone.fragment(this.dragId);
      if (!f) return;
      this.ctx.bone.setPose(this.dragId, { pos: { x: p.mm.x + this.dragOff.x, y: p.mm.y + this.dragOff.y }, angleDeg: f.pose.angleDeg });
      if (this.outOfWindow(p.mm)) this.removeFragment(this.dragId, p.mm);
    }
  }

  private outOfWindow(p: Vec2): boolean {
    const w = this.ctx.caseDef.anatomy.window;
    const m = PICK.edgeMarginMm;
    if (p.x < m || p.y < m || p.x > this.ctx.wound.widthMm - m || p.y > this.ctx.wound.heightMm - m) return true;
    return w && w.length >= 3 ? !pointInPolygon(p, w) : false;
  }

  private removeFragment(id: string, at: Vec2): void {
    const f = this.ctx.bone.fragment(id);
    const label = f?.def.label ?? 'fragmento';
    if (f) f.highlighted = false;
    this.ctx.bone.remove(id);
    this.dragId = null;
    this.fragsRemoved++;
    this.ctx.audio.play('boneClonk');
    scoreGesture(this.ctx, `Retirar ${label}`, 1 - 0.3 * this.dragTouches, at);
    this.refreshList();
    this.checkDone();
  }

  onPointerUp(p: WoundPointer): void {
    if (p.button !== 0) return;
    this.down = false;
    for (const it of this.items) {
      if (it.held) {
        it.held = false;
        it.droppedAt = this.clock;
      }
    }
    if (this.grab >= 0) {
      this.pop('Mantén el agarre un poquito más', p.mm, 'miss', 'short', 1.5);
      this.grab = -1;
      this.grabT = 0;
    }
    if (this.dragId) {
      const f = this.ctx.bone.fragment(this.dragId);
      if (f) f.highlighted = false;
      this.pop('Sácalo del todo de la herida', p.mm, 'miss');
      this.dragId = null;
    }
    this.gGrip.value = 0;
  }

  update(dt: number): void {
    this.clock += dt;
    if (this.grab < 0 || !this.down || this.done) return;
    this.grabT += dt;
    this.gGrip.value = Math.min(PICK.holdSec, this.grabT);
    if (this.grabT < PICK.holdSec) return;
    // Extraído.
    const i = this.grab;
    const it = this.params.items[i];
    const st = this.items[i];
    st.extracted = true;
    st.held = true;
    this.grab = -1;
    this.grabT = 0;
    this.extractedCount++;
    this.ctx.audio.play('crunch', { volume: 0.7 });
    this.ctx.audio.play('squelch', { volume: 0.6 });
    const q = clamp(1 - 0.4 * (this.grabDist / (it.radiusMm + PICK.grabExtraMm * this.tol)) - 0.3 * this.touchesDuringGrab, 0, 1);
    scoreGesture(this.ctx, `${this.params.label}: extracción`, q, it.pos);
    if (this.extractedCount === 1) sayLine(this.ctx, 'rodrigo', this.ctx.dialogue.rodrigo.idle, 0.3);
    this.refreshList();
    this.checkDone();
  }

  private refreshList(): void {
    const p = this.params;
    let k = 0;
    if (p.items.length > 0) {
      this.list[k].label = `${p.label} (${this.extractedCount}/${p.items.length})`;
      this.list[k].done = this.extractedCount >= p.items.length;
      k++;
    }
    if (this.fragIds.length > 0) {
      this.list[k].label = `Retirar fragmentos (${this.fragsRemoved}/${this.fragIds.length})`;
      this.list[k].done = this.fragsRemoved >= this.fragIds.length;
    }
  }

  private checkDone(): void {
    if (this.extractedCount < this.params.items.length) return;
    for (const id of this.fragIds) {
      const f = this.ctx.bone.fragment(id);
      if (f && !f.removed) return;
    }
    for (const l of this.list) l.done = true;
    this.complete();
  }

  private draw(g: CanvasRenderingContext2D, px: (p: Vec2) => Vec2, ppm: number, t: number): void {
    const lvl = this.ctx.guideLevel;
    // Zona prohibida (médula): contorno de aviso según guías.
    const fa = guideAlpha(lvl, 1, 0.6, 0);
    if (fa > 0 && !this.done) {
      const warn = this.minForbidden < 3 ? 0.35 + 0.35 * Math.sin(t * 10) : 0;
      for (const poly of this.forbidden) {
        g.strokeStyle = `rgba(255,77,109,${(0.55 + warn) * fa})`;
        g.lineWidth = Math.max(1.5, ppm * 0.4);
        g.setLineDash([ppm * 1.2, ppm * 0.9]);
        g.beginPath();
        for (let i = 0; i < poly.length; i++) {
          const c = px(poly[i]);
          if (i === 0) g.moveTo(c.x, c.y);
          else g.lineTo(c.x, c.y);
        }
        g.closePath();
        g.stroke();
        g.setLineDash([]);
        if (lvl === 'full') {
          // Etiqueta centrada dentro de la propia médula.
          let cx = 0;
          let cy = 0;
          for (const q of poly) {
            cx += q.x;
            cy += q.y;
          }
          const c = px({ x: cx / poly.length, y: cy / poly.length });
          g.font = `800 ${Math.round(ppm * 2)}px Nunito, system-ui, sans-serif`;
          g.textBaseline = 'middle';
          g.fillStyle = `rgba(255,77,109,${0.9 * fa})`;
          const text = 'MÉDULA · ¡no tocar!';
          g.fillText(text, c.x - g.measureText(text).width / 2, c.y);
        }
      }
    }
    // Material: pepitas brillantes blanco hueso/amarillo.
    for (let i = 0; i < this.items.length; i++) {
      const st = this.items[i];
      const it = this.params.items[i];
      let pos: Vec2 = it.pos;
      let scale = 1;
      let alpha = 1;
      if (st.extracted) {
        if (st.held) {
          pos = this.ptr;
          scale = 0.85;
        } else {
          const age = this.clock - st.droppedAt;
          if (age > 0.4) continue;
          pos = this.ptr;
          scale = 0.85 + age * 1.2;
          alpha = 1 - age / 0.4;
        }
      }
      const c = px(pos);
      const wob = 1 + 0.03 * Math.sin(t * 2.3 + st.phase);
      const r = it.radiusMm * ppm * scale * wob;
      g.globalAlpha = alpha;
      g.beginPath();
      for (let k = 0; k <= BLOB_N; k++) {
        const kk = k % BLOB_N;
        const a = (kk / BLOB_N) * Math.PI * 2 + st.phase;
        const rr = r * st.blob[kk];
        const x = c.x + Math.cos(a) * rr;
        const y = c.y + Math.sin(a) * rr;
        if (k === 0) g.moveTo(x, y);
        else {
          const am = ((kk - 0.5) / BLOB_N) * Math.PI * 2 + st.phase;
          const rm = r * (st.blob[kk] + st.blob[(kk + BLOB_N - 1) % BLOB_N]) * 0.55;
          g.quadraticCurveTo(c.x + Math.cos(am) * rm, c.y + Math.sin(am) * rm, x, y);
        }
      }
      g.closePath();
      const grad = g.createRadialGradient(c.x - r * 0.3, c.y - r * 0.35, r * 0.1, c.x, c.y, r * 1.1);
      grad.addColorStop(0, '#fffdf2');
      grad.addColorStop(0.45, '#f6e6a8');
      grad.addColorStop(1, '#d4b35c');
      g.fillStyle = grad;
      g.fill();
      g.strokeStyle = 'rgba(120,90,30,0.55)';
      g.lineWidth = Math.max(1, ppm * 0.2);
      g.stroke();
      // Brillo húmedo.
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.beginPath();
      g.ellipse(c.x - r * 0.3, c.y - r * 0.35, r * 0.28, r * 0.16, -0.5, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      // Anillo de agarre.
      if (i === this.grab) {
        const f = clamp(this.grabT / PICK.holdSec, 0, 1);
        g.strokeStyle = '#3fcf9c';
        g.lineWidth = Math.max(2, ppm * 0.6);
        g.beginPath();
        g.arc(c.x, c.y, r + ppm * 1.6, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2);
        g.stroke();
      } else if (!st.extracted && lvl === 'full') {
        g.strokeStyle = `rgba(159,240,208,${0.35 + 0.25 * Math.sin(t * 3 + st.phase)})`;
        g.lineWidth = Math.max(1, ppm * 0.25);
        g.beginPath();
        g.arc(c.x, c.y, r + ppm * PICK.grabExtraMm * this.tol, 0, Math.PI * 2);
        g.stroke();
      }
    }
    // Pinzas en la mano mientras se sostiene algo.
    if (this.down && (this.grab >= 0 || this.dragId || this.items.some((s) => s.held))) {
      const c = px(this.ptr);
      const close = this.grab >= 0 ? clamp(this.grabT / PICK.holdSec, 0, 1) : 1;
      const open = ppm * (2.2 - 1.6 * close);
      g.strokeStyle = '#5d6975';
      g.lineWidth = Math.max(2, ppm * 0.7);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(c.x - open, c.y);
      g.lineTo(c.x - ppm * 1.2, c.y - ppm * 12);
      g.moveTo(c.x + open, c.y);
      g.lineTo(c.x + ppm * 1.2, c.y - ppm * 12);
      g.stroke();
      g.strokeStyle = '#e6edf5';
      g.lineWidth = Math.max(1, ppm * 0.3);
      g.stroke();
    }
  }

  checklist(): ChecklistItem[] {
    return this.list;
  }

  progress(): number {
    if (this.done) return 1;
    const total = this.params.items.length + this.fragIds.length;
    if (total === 0) return 0;
    const partial = this.grab >= 0 ? clamp(this.grabT / PICK.holdSec, 0, 1) * 0.5 : 0;
    return clamp((this.extractedCount + this.fragsRemoved + partial) / total, 0, 1);
  }

  protected baseHint(): string {
    const p = this.params;
    if (this.dragId) return 'Arrastra el fragmento fuera de la herida sin rozar la médula.';
    if (this.extractedCount < p.items.length) {
      const cord = this.forbidden.length > 0 ? ' ¡Lejos de la médula!' : '';
      return `Mantén clic izq. 0,6 s sobre cada pepita para sacarla (${this.extractedCount}/${p.items.length}).${cord}`;
    }
    if (this.fragsRemoved < this.fragIds.length) return 'Agarra el fragmento suelto (clic izq.) y arrástralo fuera de la herida.';
    return 'Todo fuera. Qué limpieza, doctora.';
  }

  gauges(): Gauge[] {
    return this.gaugeList;
  }

  protected onEnd(): void {
    if (this.dragId) {
      const f = this.ctx.bone.fragment(this.dragId);
      if (f) f.highlighted = false;
    }
    this.dragId = null;
    this.grab = -1;
    this.down = false;
  }
}
