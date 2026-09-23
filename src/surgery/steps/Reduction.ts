import type {
  ChecklistItem,
  Gauge,
  InstrumentId,
  ReductionParams,
  StepDef,
  Vec2,
  WoundPointer,
} from '../../core/contracts';
import { PALETTE } from '../../core/constants';
import { clamp, dist, polygonCentroid, sub } from '../../core/math';
import { BoneStep, drawSpotMarker, drawTag, fmt, polygonsOverlap } from './drilling';

/** Velocidad de arrastre (mm/s) a partir de la cual forzar contra hueso fisura. */
export const FORCE_SPEED_MM_S = 120;
/** Giro con Q/E (°/s). */
export const KEY_ROT_DEG_S = 60;
/** Duración de la imagen de rayos X (s). */
export const XRAY_SEC = 1.8;
const KWIRE_TOL_MM = 3;

interface Grab {
  id: string;
  offset: Vec2;
  lastT: number;
  lastPos: Vec2;
}

/**
 * Reducción/colocación con pinzas Kern: arrastrar fragmentos hasta su silueta,
 * girar con Q/E, arco en C con R, y fijar agujas de Kirschner temporales.
 */
export class ReductionStep extends BoneStep<ReductionParams> {
  readonly instruments: InstrumentId[];
  private grab: Grab | null = null;
  /** Último fragmento tocado (recibe Q/E aunque no esté agarrado). */
  private active: string | null = null;
  private reduced = new Set<string>();
  private pinsDone: boolean[] = [];
  private shotsLeft = 0;
  private shotsUsed = 0;
  private xrayLeft = 0;
  private qHeld = false;
  private eHeld = false;
  private pathMm = new Map<string, number>();
  private rotMoved = new Map<string, number>();
  private idealMm = new Map<string, number>();
  private idealDeg = new Map<string, number>();
  private crunchAt = -1;
  private hover: Vec2 = { x: 0, y: 0 };
  private snapFx: Array<{ at: Vec2; t: number }> = [];
  private clock = 0;

  constructor(def: StepDef) {
    super(def);
    const p = def.params as ReductionParams;
    const inst: InstrumentId[] = ['kern'];
    if (p.kwireSpots?.length) inst.push('kwire');
    if (p.carmShots > 0) inst.push('carm');
    this.instruments = inst;
  }

  protected onBegin(): void {
    const p = this.params;
    this.shotsLeft = p.carmShots;
    this.pinsDone = (p.kwireSpots ?? []).map(() => false);
    for (const id of p.fragmentIds) {
      const err = this.ctx.bone.alignmentError(id);
      this.idealMm.set(id, err.mm);
      this.idealDeg.set(id, err.deg);
      this.pathMm.set(id, 0);
      this.rotMoved.set(id, 0);
    }
    this.active = p.fragmentIds[0] ?? null;
    this.hover = polygonCentroid(this.ctx.caseDef.anatomy.window);
    this.syncGhosts();
    this.overlay({ id: `reduction:${this.def.id}`, z: 45, draw: (g, px, s, t) => this.draw(g, px, s, t) });
  }

  /**
   * Silueta fantasma según la guía. En una reducción cerrada (a ciegas) solo se ve
   * durante el disparo de rayos X: si no, se reduciría mirando la silueta.
   */
  private syncGhosts(): void {
    const p = this.params;
    const closed = !!this.ctx.caseDef.anatomy.closed;
    this.ctx.wound.setGhosts(p.showGhost && this.ctx.guideLevel !== 'none' && (!closed || this.xrayLeft > 0));
  }

  // ── Consultas ──

  private tolMm() {
    return this.params.tolMm * this.tolScale;
  }
  private tolDeg() {
    return this.params.tolDeg * this.tolScale;
  }
  private allReduced() {
    return this.params.fragmentIds.every((id) => this.reduced.has(id));
  }
  private pinsLeft() {
    return this.pinsDone.filter((d) => !d).length;
  }
  private get isPlace() {
    return this.params.mode === 'place';
  }

  // ── Entrada ──

  onPointerDown(p: WoundPointer): void {
    this.hover = p.mm;
    if (this.done || p.button !== 0) return;
    this.interacted = true;
    if (p.instrument === 'carm') {
      this.carmShot();
      return;
    }
    if (this.allReduced()) {
      this.tryKwire(p);
      return;
    }
    if (p.instrument === 'kwire') {
      this.pop('Primero reduce: usa las pinzas Kern', p.mm, 'miss');
      return;
    }
    const bone = this.ctx.bone;
    const any = bone.hitTest(p.mm, true);
    if (any && this.params.avoidIds?.includes(any)) {
      this.touchForbidden(p.mm);
      return;
    }
    let id = bone.hitTest(p.mm);
    if (id && this.params.avoidIds?.includes(id)) {
      this.touchForbidden(p.mm);
      return;
    }
    if (!id || !this.params.fragmentIds.includes(id) || this.reduced.has(id)) {
      // Tolerancia de agarre: el fragmento pendiente más cercano a ≤ 4 mm de su contorno/centro.
      id = this.nearestPending(p.mm, 5);
    }
    if (!id) return;
    const f = bone.fragment(id);
    if (!f) return;
    this.grab = { id, offset: sub(p.mm, f.pose.pos), lastT: p.t, lastPos: { ...f.pose.pos } };
    this.active = id;
    f.highlighted = true;
    this.ctx.audio.play('crunch', { volume: 0.25, pitch: 1.3 });
  }

  onPointerMove(p: WoundPointer): void {
    this.hover = p.mm;
    const gr = this.grab;
    if (!gr || this.done) return;
    if (!(p.buttons & 1)) {
      this.dropGrab();
      return;
    }
    const bone = this.ctx.bone;
    const f = bone.fragment(gr.id);
    if (!f) return;
    const pos = sub(p.mm, gr.offset);
    const d = dist(pos, f.pose.pos);
    const dt = p.t - gr.lastT;
    bone.setPose(gr.id, { pos, angleDeg: f.pose.angleDeg });
    this.pathMm.set(gr.id, (this.pathMm.get(gr.id) ?? 0) + d);
    // Velocidad a partir de la distancia acumulada desde la última muestra con tiempo.
    if (dt > 1e-4) {
      const speed = dist(pos, gr.lastPos) / Math.max(dt, 1 / 240);
      gr.lastT = p.t;
      gr.lastPos = { ...pos };
      if (speed > 8) this.crunch(clamp(speed / FORCE_SPEED_MM_S, 0.2, 1));
      if (speed > FORCE_SPEED_MM_S) this.checkForcing(gr.id, p.mm);
    }
    this.checkAligned(gr.id);
  }

  onPointerUp(p: WoundPointer): void {
    this.hover = p.mm;
    if (this.grab) this.dropGrab();
  }

  onKey(key: string, down: boolean): boolean {
    if (key === 'KeyQ') {
      this.qHeld = down;
      return true;
    }
    if (key === 'KeyE') {
      this.eHeld = down;
      return true;
    }
    if (key === 'KeyR') {
      if (down) this.carmShot();
      return true;
    }
    return false;
  }

  update(dt: number): void {
    this.clock += dt;
    if (this.xrayLeft > 0) {
      this.xrayLeft -= dt;
      if (this.xrayLeft <= 0) {
        this.ctx.wound.setXray(false);
        this.syncGhosts();
      }
    }
    for (let i = this.snapFx.length - 1; i >= 0; i--) if (this.clock - this.snapFx[i].t > 0.8) this.snapFx.splice(i, 1);
    if (this.done) return;
    const dir = (this.eHeld ? 1 : 0) - (this.qHeld ? 1 : 0);
    const id = this.grab?.id ?? this.active;
    if (dir !== 0 && id && !this.reduced.has(id)) {
      const f = this.ctx.bone.fragment(id);
      if (f) {
        const dDeg = dir * KEY_ROT_DEG_S * dt;
        this.ctx.bone.setPose(id, { pos: f.pose.pos, angleDeg: f.pose.angleDeg + dDeg });
        this.rotMoved.set(id, (this.rotMoved.get(id) ?? 0) + Math.abs(dDeg));
        this.interacted = true;
        this.checkAligned(id);
      }
    }
  }

  // ── Lógica ──

  private nearestPending(p: Vec2, maxMm: number): string | null {
    let best: string | null = null;
    let bestD = maxMm;
    for (const id of this.params.fragmentIds) {
      if (this.reduced.has(id)) continue;
      const poly = this.ctx.bone.worldPolygon(id);
      if (!poly.length) continue;
      for (const v of poly) {
        const d = dist(p, v);
        if (d < bestD) {
          bestD = d;
          best = id;
        }
      }
      const c = polygonCentroid(poly);
      if (dist(p, c) < bestD) {
        bestD = dist(p, c);
        best = id;
      }
    }
    return best;
  }

  private touchForbidden(at: Vec2): void {
    if (this.faultLimited('noTouchViolation', 2, 'Tocó una esquirla que no se debe manipular')) {
      this.pop('¡Esa esquirla no se toca!', at, 'bad');
      this.ctx.audio.play('uiError');
      this.valerioOn('noTouchViolation');
    }
  }

  private crunch(intensity: number): void {
    const now = this.ctx.now();
    if (now - this.crunchAt < 0.28) return;
    this.crunchAt = now;
    this.ctx.audio.play('crunch', { volume: 0.25 + intensity * 0.5, intensity, pitch: 0.9 + this.ctx.rng() * 0.3 });
  }

  private checkForcing(id: string, at: Vec2): void {
    if (this.isPlace || this.tutorial) return;
    const bone = this.ctx.bone;
    const poly = bone.worldPolygon(id);
    let hit = false;
    for (const st of bone.staticPolygons()) {
      if (polygonsOverlap(poly, st)) {
        hit = true;
        break;
      }
    }
    if (!hit) {
      for (const f of bone.fragments()) {
        if (f.id === id || f.removed) continue;
        if (polygonsOverlap(poly, bone.worldPolygon(f.id))) {
          hit = true;
          break;
        }
      }
    }
    if (!hit) return;
    if (this.faultLimited('iatrogenicFissure', 3, 'Forzó el fragmento contra el hueso')) {
      this.ctx.wound.addDecal('fissure', at, { angleDeg: this.ctx.rng() * 180, sizeMm: 7 });
      this.ctx.audio.play('crunch', { volume: 1, intensity: 1, pitch: 0.6 });
      this.pop('¡Crack! Fisura por forzar', at, 'bad');
      this.valerioOn('iatrogenicFissure');
    }
  }

  private checkAligned(id: string): void {
    if (this.reduced.has(id)) return;
    const err = this.ctx.bone.alignmentError(id);
    if (err.mm > this.tolMm() || err.deg > this.tolDeg()) return;
    const f = this.ctx.bone.fragment(id);
    if (!f?.def.target) return;
    this.ctx.bone.setPose(id, { pos: { ...f.def.target.pos }, angleDeg: f.def.target.angleDeg });
    f.highlighted = true;
    this.reduced.add(id);
    if (this.grab?.id === id) this.grab = null;
    this.ctx.audio.play('boneClonk', { volume: 1 });
    // Calidad: eficiencia del recorrido + giro + uso del arco en C.
    const ideal = this.idealMm.get(id) ?? 0;
    const path = this.pathMm.get(id) ?? 0;
    const eff = ideal <= 0.5 ? 1 : clamp(ideal / Math.max(path, ideal), 0, 1);
    const idealRot = this.idealDeg.get(id) ?? 0;
    const rot = this.rotMoved.get(id) ?? 0;
    const rotEff = idealRot <= 1 ? 1 : clamp(idealRot / Math.max(rot, idealRot), 0, 1);
    const allowed = this.ctx.caseDef.anatomy.closed ? 2 : 1;
    const carm = clamp(1 - Math.max(0, this.shotsUsed - allowed) * 0.25, 0, 1);
    const q = clamp(0.25 + 0.45 * eff + 0.15 * rotEff + 0.15 * carm, 0, 1);
    const verb = this.isPlace ? 'Colocación' : 'Reducción';
    this.ctx.log.gesture(`${verb}: ${f.def.label}`, q);
    const c = polygonCentroid(this.ctx.bone.worldPolygon(id));
    this.snapFx.push({ at: c, t: this.clock });
    this.pop(q >= 0.9 ? '¡Clonk! Perfecto' : '¡Clonk! Encajado', c, q >= 0.9 ? 'perfect' : 'good');
    this.active = this.params.fragmentIds.find((x) => !this.reduced.has(x)) ?? null;
    if (this.allReduced()) {
      if (this.pinsDone.length) this.ctx.selectInstrument('kwire');
      else this.complete();
    }
  }

  private dropGrab(): void {
    const gr = this.grab;
    this.grab = null;
    if (!gr) return;
    const f = this.ctx.bone.fragment(gr.id);
    if (f && !this.reduced.has(gr.id)) f.highlighted = false;
  }

  private carmShot(): void {
    if (this.done) return;
    this.interacted = true;
    if (this.shotsLeft <= 0) {
      this.ctx.audio.play('uiError');
      this.pop('Sin disparos de rayos X', this.hover, 'miss');
      return;
    }
    this.shotsLeft--;
    this.shotsUsed++;
    this.xrayLeft = XRAY_SEC;
    this.ctx.wound.setXray(true);
    this.syncGhosts();
    this.ctx.crew.gigi.leaveRoomFor(4);
    this.ctx.bus.emit('carm:shot', { left: this.shotsLeft });
    this.ctx.audio.play('xray');
    this.ctx.log.note('carm', { left: this.shotsLeft });
  }

  private tryKwire(p: WoundPointer): void {
    const spots = this.params.kwireSpots ?? [];
    if (p.instrument !== 'kwire') {
      this.pop('Elige la aguja K', p.mm, 'miss');
      return;
    }
    const tol = KWIRE_TOL_MM * this.tolScale;
    let best = -1;
    let bestD = tol;
    spots.forEach((s, i) => {
      const d = dist(p.mm, s);
      if (!this.pinsDone[i] && d <= bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0) {
      this.pop('Fuera del punto de fijación', p.mm, 'miss');
      this.ctx.audio.play('uiError', { volume: 0.5 });
      return;
    }
    const spot = spots[best];
    this.pinsDone[best] = true;
    this.ctx.bone.implants.pins.push({ pos: { ...spot }, kind: 'kwire' });
    this.ctx.wound.addDecal('kwire', spot, { angleDeg: -30, sizeMm: 6 });
    this.ctx.audio.play('kwire');
    const q = clamp(1 - (bestD / tol) * 0.5, 0, 1);
    this.ctx.log.gesture('Aguja de Kirschner temporal', q);
    this.pop(q >= 0.9 ? '¡Aguja perfecta!' : 'Aguja fijada', spot, q >= 0.9 ? 'perfect' : 'good');
    if (this.pinsLeft() === 0) this.complete();
  }

  // ── Interfaz del paso ──

  checklist(): ChecklistItem[] {
    const verb = this.isPlace ? 'Colocar' : 'Reducir';
    const items: ChecklistItem[] = this.params.fragmentIds.map((id) => ({
      label: `${verb}: ${this.ctx?.bone.fragment(id)?.def.label ?? id}`,
      done: this.reduced.has(id),
    }));
    const n = this.pinsDone.length;
    if (n) items.push({ label: `Agujas K temporales (${n - this.pinsLeft()}/${n})`, done: this.pinsLeft() === 0 });
    return items;
  }

  progress(): number {
    if (this.done) return 1;
    const frags = this.params.fragmentIds.length;
    const pins = this.pinsDone.length;
    const total = frags + pins * 0.5;
    let partial = 0;
    if (this.active && !this.reduced.has(this.active)) {
      const ideal = this.idealMm.get(this.active) ?? 0;
      if (ideal > 0.5) partial = clamp(1 - this.ctx.bone.alignmentError(this.active).mm / ideal, 0, 0.9);
    }
    const doneUnits = this.reduced.size + partial + (pins - this.pinsLeft()) * 0.5;
    return total > 0 ? clamp(doneUnits / total, 0, 1) : 1;
  }

  hint(): string {
    if (this.allReduced()) return this.hintText('Aguja K: clic en los puntos marcados para fijar la reducción');
    if (this.ctx.caseDef.anatomy.closed && this.xrayLeft <= 0) {
      return this.hintText(`Reducción cerrada: pulsa R para rayos X (${this.shotsLeft}), arrastra y gira con Q/E`);
    }
    if (this.grab) return this.hintText('Lleva el fragmento a la silueta menta; Q/E para girar. ¡Sin forzar!');
    return this.isPlace
      ? this.hintText('Pinzas Kern: agarra la pieza y colócala en su sitio (Q/E giran, R rayos X)')
      : this.hintText('Pinzas Kern: agarra el fragmento y alinéalo con la silueta (Q/E giran, R rayos X)');
  }

  gauges(): Gauge[] {
    const id = this.active;
    const err = id ? this.ctx.bone.alignmentError(id) : { mm: 0, deg: 0 };
    const tm = this.tolMm();
    const td = this.tolDeg();
    return [
      {
        id: 'displacement',
        label: 'Desplazamiento',
        value: Math.min(err.mm, 20),
        min: 0,
        max: 20,
        unit: 'mm',
        zones: [
          { from: 0, to: tm, kind: 'good' },
          { from: tm, to: tm * 4, kind: 'warn' },
          { from: tm * 4, to: 20, kind: 'bad' },
        ],
      },
      {
        id: 'angle',
        label: 'Ángulo',
        value: Math.min(err.deg, 30),
        min: 0,
        max: 30,
        unit: '°',
        zones: [
          { from: 0, to: td, kind: 'good' },
          { from: td, to: td * 3, kind: 'warn' },
          { from: td * 3, to: 30, kind: 'bad' },
        ],
      },
      { id: 'carm', label: 'Rayos X restantes', value: this.shotsLeft, min: 0, max: Math.max(1, this.params.carmShots) },
    ];
  }

  protected onEnd(): void {
    this.dropGrab();
    this.ctx.wound.setXray(false);
    this.ctx.wound.setGhosts(false);
  }

  // ── Overlay ──

  private draw(g: CanvasRenderingContext2D, px: (p: Vec2) => Vec2, s: number, t: number): void {
    const bone = this.ctx.bone;
    const closedDark = !!this.ctx.caseDef.anatomy.closed && this.xrayLeft <= 0;
    // Fragmento agarrado: contorno rosa con brillo.
    const id = this.grab?.id ?? null;
    if (id && !closedDark) {
      const poly = bone.worldPolygon(id);
      g.save();
      g.shadowColor = PALETTE.bubblegum;
      g.shadowBlur = 14;
      g.strokeStyle = PALETTE.fuchsia;
      g.lineWidth = 3;
      g.beginPath();
      poly.forEach((v, i) => {
        const q = px(v);
        if (i === 0) g.moveTo(q.x, q.y);
        else g.lineTo(q.x, q.y);
      });
      g.closePath();
      g.stroke();
      g.restore();
      // Puntas de la pinza en el punto de agarre.
      const f = bone.fragment(id);
      if (f) {
        const c = px({ x: f.pose.pos.x + this.grab!.offset.x, y: f.pose.pos.y + this.grab!.offset.y });
        g.save();
        g.fillStyle = '#e8e8f0';
        g.strokeStyle = PALETTE.ink;
        g.lineWidth = 1.5;
        for (const sgn of [-1, 1]) {
          g.beginPath();
          g.arc(c.x + sgn * s * 1.4, c.y, s * 0.9, 0, Math.PI * 2);
          g.fill();
          g.stroke();
        }
        g.restore();
      }
    }
    // Flechas de giro mientras Q/E.
    const rotId = id ?? this.active;
    if ((this.qHeld || this.eHeld) && rotId && !this.reduced.has(rotId)) {
      const c = px(polygonCentroid(bone.worldPolygon(rotId)));
      const r = s * 9;
      const dir = this.eHeld ? 1 : -1;
      g.save();
      g.strokeStyle = PALETTE.mint;
      g.lineWidth = 3;
      g.setLineDash([6, 5]);
      g.lineDashOffset = -t * 40 * dir;
      g.beginPath();
      g.arc(c.x, c.y, r, 0, Math.PI * 1.6);
      g.stroke();
      g.restore();
    }
    // Rayos X: contador del disparo.
    if (this.xrayLeft > 0) {
      const c = px({ x: 30, y: 36 });
      drawTag(g, `RX ${fmt(this.xrayLeft)} s`, c.x, c.y, PALETTE.mint, 15);
    }
    // Agujas K tras reducir.
    if (this.allReduced()) {
      const spots = this.params.kwireSpots ?? [];
      spots.forEach((sp, i) => {
        const c = px(sp);
        drawSpotMarker(g, c, s, t, {
          level: this.ctx.guideLevel,
          label: `K${i + 1}`,
          done: this.pinsDone[i],
          active: !this.pinsDone[i],
          near: dist(this.hover, sp) < 9,
        });
      });
    }
    // Destello al encajar.
    for (const fx of this.snapFx) {
      const k = (this.clock - fx.t) / 0.8;
      const c = px(fx.at);
      g.save();
      g.globalAlpha = 1 - k;
      g.strokeStyle = PALETTE.mint;
      g.lineWidth = 4;
      g.beginPath();
      g.arc(c.x, c.y, s * (4 + k * 14), 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
  }
}

export const createReductionStep = (def: StepDef) => new ReductionStep(def);
