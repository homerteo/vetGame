import type { BandageParams, ChecklistItem, Gauge, InstrumentId, Vec2, WoundPointer } from '../../core/contracts';
import { clamp } from '../../core/math';
import { StepA, guideAlpha, heartPath, sayLine, scoreFault, scoreGesture } from './CauteryTool';

/** Afinado del vendaje. */
export const BANDAGE = {
  minR: 0.5,
  maxR: 1.6,
  bandLo: 0.45, // vueltas/s
  bandHi: 1.2,
  decayAfterSec: 0.08,
} as const;

const TAU = Math.PI * 2;

/** Vendaje cohesivo: círculos alrededor de la pata con velocidad (tensión) pareja. */
export class BandageStep extends StepA<BandageParams> {
  readonly instruments: InstrumentId[] = ['bandage'];

  private holding = false;
  private prevAng: number | null = null;
  private dir = 0; // +1 / −1 sentido establecido
  private accDeg = 0;
  private omega = 0; // vueltas/s suavizado
  private lastMoveT = 0; // tiempo de cirugía de la última muestra de velocidad
  private pendingDeg = 0;
  private timeIn = 0; // tiempo girando dentro del anillo
  private timeBand = 0; // tiempo con tensión buena
  private turnsShown = 0;
  private pointer = { x: 0, y: 0 };
  private startAngle = 0;
  private list: ChecklistItem[] = [];
  private gTension: Gauge = {
    id: 'bandage-tension',
    label: 'Tensión',
    value: 0,
    min: 0,
    max: 2,
    unit: 'v/s',
    zones: [
      { from: 0, to: BANDAGE.bandLo, kind: 'warn' },
      { from: BANDAGE.bandLo, to: BANDAGE.bandHi, kind: 'good' },
      { from: BANDAGE.bandHi, to: 2, kind: 'bad' },
    ],
  };
  private gaugeList: Gauge[] = [this.gTension];

  protected onBegin(): void {
    this.list = [{ label: `${this.def.label} (0/${this.params.turns} vueltas)`, done: false }];
    this.overlay({ id: `${this.def.id}:bandage`, z: 36, draw: (g, px, ppm, t) => this.draw(g, px, ppm, t) });
  }

  /** Calidad de tensión: fracción del tiempo dentro de la banda buena. */
  tensionQuality(): number {
    return this.timeIn > 0 ? clamp(this.timeBand / this.timeIn, 0, 1) : 0;
  }

  private inRing(mm: Vec2): { ok: boolean; ang: number } {
    const c = this.params.center;
    const dx = mm.x - c.x;
    const dy = mm.y - c.y;
    const r = Math.hypot(dx, dy);
    const R = this.params.radiusMm;
    return { ok: r >= BANDAGE.minR * R && r <= BANDAGE.maxR * R, ang: Math.atan2(dy, dx) };
  }

  onPointerDown(p: WoundPointer): void {
    if (this.done || p.button !== 0) return;
    if (p.instrument !== 'bandage') {
      this.pop('Toma la venda cohesiva', p.mm, 'miss', 'tool', 2);
      return;
    }
    this.holding = true;
    this.pointer.x = p.mm.x;
    this.pointer.y = p.mm.y;
    const r = this.inRing(p.mm);
    this.prevAng = r.ok ? r.ang : null;
    if (this.accDeg === 0 && r.ok) this.startAngle = r.ang;
    this.lastMoveT = p.t;
    this.pendingDeg = 0;
    this.startLoop('bandage').set('rate', 0);
  }

  onPointerMove(p: WoundPointer): void {
    this.pointer.x = p.mm.x;
    this.pointer.y = p.mm.y;
    if (!this.holding || this.done) return;
    const r = this.inRing(p.mm);
    if (!r.ok) {
      this.prevAng = null;
      this.pop('Gira alrededor de la pata, sin alejarte', p.mm, 'miss', 'ring', 2);
      return;
    }
    if (this.prevAng === null) {
      this.prevAng = r.ang;
      if (this.accDeg === 0) this.startAngle = r.ang;
      return;
    }
    let d = r.ang - this.prevAng;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    this.prevAng = r.ang;
    const deg = (d * 180) / Math.PI;
    if (this.dir === 0 && Math.abs(deg) > 0.5) this.dir = Math.sign(deg);
    const signed = deg * (this.dir || 1);
    this.accDeg = Math.max(0, this.accDeg + signed);
    // Velocidad angular: se acumulan movimientos del mismo fotograma y se suaviza por tiempo.
    this.pendingDeg += Math.abs(deg);
    const dt = p.t - this.lastMoveT;
    if (dt >= 0.008) {
      const inst = this.pendingDeg / 360 / dt;
      const k = clamp(dt * 8, 0.05, 1);
      this.omega += (Math.min(inst, 4) - this.omega) * k;
      this.lastMoveT = p.t;
      this.pendingDeg = 0;
      this.loop?.set('rate', clamp(this.omega / 1.6, 0, 1));
      this.loop?.set('load', clamp(this.omega / BANDAGE.bandHi, 0, 1));
    }
    const turns = Math.floor(this.accDeg / 360);
    if (turns > this.turnsShown) {
      this.turnsShown = turns;
      this.list[0].label = `${this.def.label} (${Math.min(turns, this.params.turns)}/${this.params.turns} vueltas)`;
      this.ctx.audio.play('tick', { pitch: 1 + turns * 0.1 });
      if (turns < this.params.turns) this.pop(`Vuelta ${turns}/${this.params.turns}`, p.mm, 'good');
    }
    if (this.accDeg >= 360 * this.params.turns) this.finish(p.mm);
  }

  onPointerUp(p: WoundPointer): void {
    if (p.button !== 0) return;
    this.holding = false;
    this.prevAng = null;
    this.stopLoop();
  }

  update(dt: number): void {
    if (!this.holding || this.done) {
      this.omega *= Math.exp(-dt * 6);
      this.gTension.value = this.omega;
      return;
    }
    if (this.ctx.now() - this.lastMoveT > BANDAGE.decayAfterSec) this.omega *= Math.exp(-dt * 6);
    this.gTension.value = Math.min(2, this.omega);
    if (this.prevAng !== null) {
      this.timeIn += dt;
      if (this.omega >= BANDAGE.bandLo && this.omega <= BANDAGE.bandHi) this.timeBand += dt;
      else if (this.omega > BANDAGE.bandHi) this.pop('¡Más despacio, que aprieta!', this.pointer, 'bad', 'fast', 2.5);
      else if (this.timeIn > 0.6) this.pop('Más ritmo, que se afloja', this.pointer, 'miss', 'slow', 2.5);
    }
  }

  private finish(at: Vec2): void {
    const q = this.tensionQuality();
    const revs = this.accDeg / 360;
    const avg = this.timeIn > 0 ? revs / this.timeIn : 0;
    scoreGesture(this.ctx, 'Vendaje cohesivo', q, at);
    if (avg > BANDAGE.bandHi && q < 0.5) {
      scoreFault(this.ctx, 'tightBandage', this.params.center, '¡Muy apretado! Deditos de salchicha');
    } else {
      sayLine(this.ctx, 'gigi', this.ctx.dialogue.gigi.viral, 0.4);
    }
    this.list[0].label = `${this.def.label} (${this.params.turns}/${this.params.turns} vueltas)`;
    this.list[0].done = true;
    this.holding = false;
    this.stopLoop();
    this.complete();
  }

  private draw(g: CanvasRenderingContext2D, px: (p: Vec2) => Vec2, ppm: number, t: number): void {
    const { center, radiusMm: R, turns } = this.params;
    const C = px(center);
    const lvl = this.ctx.guideLevel;
    // Guía: anillo de trabajo y círculo a trazar.
    const ga = guideAlpha(lvl, 1, 0.6, 0);
    if (ga > 0 && !this.done) {
      g.fillStyle = `rgba(159,240,208,${0.08 * ga})`;
      g.beginPath();
      g.arc(C.x, C.y, R * BANDAGE.maxR * ppm, 0, TAU);
      g.arc(C.x, C.y, R * BANDAGE.minR * ppm, 0, TAU, true);
      g.fill();
      g.strokeStyle = `rgba(159,240,208,${0.7 * ga})`;
      g.lineWidth = Math.max(1, ppm * 0.35);
      g.setLineDash([ppm * 1.4, ppm * 1]);
      g.beginPath();
      g.arc(C.x, C.y, R * ppm, 0, TAU);
      g.stroke();
      g.setLineDash([]);
      if (lvl === 'full') {
        // Flecha de sentido que gira lentamente.
        const a = t * 1.2;
        const ax = C.x + Math.cos(a) * R * ppm;
        const ay = C.y + Math.sin(a) * R * ppm;
        g.fillStyle = 'rgba(159,240,208,0.9)';
        g.beginPath();
        g.moveTo(ax + -Math.sin(a) * ppm * 2.2, ay + Math.cos(a) * ppm * 2.2);
        g.lineTo(ax + Math.cos(a) * ppm * 1.3, ay + Math.sin(a) * ppm * 1.3);
        g.lineTo(ax - Math.cos(a) * ppm * 1.3, ay - Math.sin(a) * ppm * 1.3);
        g.closePath();
        g.fill();
      }
    }
    // Vueltas de venda cohesiva lila, de fuera hacia dentro.
    const totalTurns = this.accDeg / 360;
    const full = Math.floor(totalTurns);
    const frac = totalTurns - full;
    const bandW = R * 0.55 * ppm;
    const dirSign = this.dir || 1;
    for (let i = 0; i <= Math.min(full, turns - 1); i++) {
      const span = i < full ? TAU : frac * TAU;
      if (span <= 0.01) continue;
      const rr = R * ppm * (1.12 - (0.62 * i) / Math.max(1, turns - 1));
      const a0 = this.startAngle;
      const a1 = a0 + span * dirSign;
      const ccw = dirSign < 0;
      // Sombra
      g.strokeStyle = 'rgba(59,33,70,0.22)';
      g.lineWidth = bandW + ppm * 0.6;
      g.beginPath();
      g.arc(C.x + ppm * 0.4, C.y + ppm * 0.6, rr, a0, a1, ccw);
      g.stroke();
      // Venda
      g.strokeStyle = i % 2 === 0 ? '#c8a2e8' : '#bb93e0';
      g.lineWidth = bandW;
      g.beginPath();
      g.arc(C.x, C.y, rr, a0, a1, ccw);
      g.stroke();
      // Bordes claros (textura cohesiva)
      g.strokeStyle = 'rgba(255,246,251,0.55)';
      g.lineWidth = Math.max(1, ppm * 0.3);
      g.beginPath();
      g.arc(C.x, C.y, rr + bandW / 2 - ppm * 0.3, a0, a1, ccw);
      g.stroke();
      g.beginPath();
      g.arc(C.x, C.y, rr - bandW / 2 + ppm * 0.3, a0, a1, ccw);
      g.stroke();
      // Corazoncitos a lo largo de la vuelta.
      const n = Math.max(3, Math.floor((rr * Math.abs(span)) / (ppm * 9)));
      g.fillStyle = '#ff8fc7';
      for (let k = 0; k < n; k++) {
        const aa = a0 + ((k + 0.5) / n) * span * dirSign;
        heartPath(g, C.x + Math.cos(aa) * rr, C.y + Math.sin(aa) * rr, ppm * 2.2);
        g.fill();
      }
    }
    if (this.done) {
      // Centro acolchado con un corazón grande.
      const inner = R * ppm * (1.12 - 0.62) - bandW / 2 + ppm;
      if (inner > 0) {
        g.fillStyle = '#d7b8f0';
        g.beginPath();
        g.arc(C.x, C.y, inner, 0, TAU);
        g.fill();
      }
      g.fillStyle = '#ff2e93';
      heartPath(g, C.x, C.y, ppm * 7 * (1 + 0.05 * Math.sin(t * 4)));
      g.fill();
      return;
    }
    // Rollo de venda en la mano con la tira hasta la última vuelta.
    if (this.holding) {
      const P = px(this.pointer);
      const i = Math.min(full, turns - 1);
      const rr = R * ppm * (1.12 - (0.62 * i) / Math.max(1, turns - 1));
      const aEnd = this.startAngle + frac * TAU * dirSign;
      const ex = C.x + Math.cos(aEnd) * rr;
      const ey = C.y + Math.sin(aEnd) * rr;
      g.strokeStyle = 'rgba(200,162,232,0.85)';
      g.lineWidth = bandW * 0.8;
      g.lineCap = 'butt';
      g.beginPath();
      g.moveTo(ex, ey);
      g.lineTo(P.x, P.y);
      g.stroke();
      g.fillStyle = '#b79cf2';
      g.beginPath();
      g.arc(P.x, P.y, ppm * 3.4, 0, TAU);
      g.fill();
      g.strokeStyle = '#fff6fb';
      g.lineWidth = Math.max(1, ppm * 0.3);
      g.beginPath();
      for (let k = 0; k < 3; k++) g.arc(P.x, P.y, ppm * (0.8 + k * 0.9), 0, TAU);
      g.stroke();
    }
  }

  checklist(): ChecklistItem[] {
    return this.list;
  }

  progress(): number {
    if (this.done) return 1;
    return clamp(this.accDeg / (360 * this.params.turns), 0, 1);
  }

  protected baseHint(): string {
    if (this.done) return '¡Vendaje listo! Lila, parejito y con corazones.';
    const turn = Math.min(this.params.turns, Math.floor(this.accDeg / 360) + 1);
    if (this.holding && this.omega > BANDAGE.bandHi) return '¡Más despacio! Una vuelta por segundo, parejita.';
    return `Mantén clic izq. y gira alrededor de la pata, ~1 vuelta/s (vuelta ${turn}/${this.params.turns}).`;
  }

  gauges(): Gauge[] {
    return this.gaugeList;
  }

  protected onEnd(): void {
    this.holding = false;
  }
}
