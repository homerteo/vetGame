import { drawTargetMarker } from './markers';
import type { ChecklistItem, Gauge, InstrumentId, SutureParams, Vec2, WoundPointer } from '../../core/contracts';
import { clamp, pointAtLength, polylineLength } from '../../core/math';
import { LAYER_NAME, type SignedHit, StepA, guideAlpha, sayLine, scoreGesture, signedDistToPolyline } from './CauteryTool';
import { RETRACTOR_OVERLAY_ID } from './Retract';

/** Afinado de la sutura. */
export const SUTURE = {
  minBiteMm: 3,
  minStitches: 3,
  goodMinSec: 0.3,
  goodMaxSec: 1.2,
  tightSec: 0.2,
  knotDelaySec: 0.22,
} as const;

const TRAIL = 48;

/** Lado de la incisión (0 cuenta como positivo para no perder cruces exactos). */
const side = (d: number) => (d >= 0 ? 1 : -1);

/** Suturar por capas: trazos que cruzan la incisión junto al punto marcado. */
export class SutureStep extends StepA<SutureParams> {
  readonly instruments: InstrumentId[] = ['needleHolder'];

  private pathLen = 0;
  private perLayer = 3;
  private layerIdx = 0;
  private inLayer = 0;
  private doneTotal = 0;
  private lastErr = 0;
  private knotIn = -1;
  private list: ChecklistItem[] = [];
  // Trazo en curso
  private stroking = false;
  private start = { x: 0, y: 0 };
  private startD = 0;
  private startT = 0;
  private prevD = 0;
  private prevPt = { x: 0, y: 0 };
  private crossed = false;
  private cross = { x: 0, y: 0 };
  private crossS = 0;
  private travel = 0;
  private hit: SignedHit = { d: 0, s: 0, x: 0, y: 0 };
  private trail = new Float32Array(TRAIL * 2);
  private trailN = 0;
  private gSpacing: Gauge = { id: 'suture-spacing', label: 'Espaciado', value: 0, min: 0, max: 1, unit: 'mm', zones: [] };
  private gaugeList: Gauge[] = [this.gSpacing];

  protected onBegin(): void {
    const p = this.params;
    // Antes de cerrar se retira el separador que quedó puesto desde la exposición.
    this.ctx.wound.removeOverlay(RETRACTOR_OVERLAY_ID);
    this.ctx.wound.setRetraction(0);
    this.pathLen = polylineLength(p.path);
    this.perLayer = Math.max(SUTURE.minStitches, Math.floor(this.pathLen / Math.max(0.1, p.spacingMm)));
    this.list = p.layers.map((l) => ({ label: `Sutura de ${LAYER_NAME[l]} (0/${this.perLayer})`, done: false }));
    const tolMm = this.tolMm;
    this.gSpacing.max = p.spacingMm;
    this.gSpacing.zones = [
      { from: 0, to: tolMm * 0.5, kind: 'good' },
      { from: tolMm * 0.5, to: Math.min(tolMm, p.spacingMm), kind: 'warn' },
      { from: Math.min(tolMm, p.spacingMm), to: p.spacingMm, kind: 'bad' },
    ];
    this.overlay({ id: `${this.def.id}:suture`, z: 44, draw: (g, px, ppm, t) => this.draw(g, px, ppm, t) });
  }

  /** Tolerancia de posición del punto (mm). */
  private get tolMm(): number {
    return this.params.spacingMm * 0.5 * this.tol;
  }

  /** Longitud de arco del punto esperado. */
  private expectedS(): number {
    return (this.pathLen * (this.inLayer + 0.5)) / this.perLayer;
  }

  get total(): number {
    return this.perLayer * this.params.layers.length;
  }

  onPointerDown(p: WoundPointer): void {
    if (this.done || p.button !== 0) return;
    if (p.instrument !== 'needleHolder') {
      this.pop('Toma el porta-agujas', p.mm, 'miss', 'tool', 2);
      return;
    }
    signedDistToPolyline(p.mm, this.params.path, this.hit);
    this.stroking = true;
    this.start.x = this.prevPt.x = p.mm.x;
    this.start.y = this.prevPt.y = p.mm.y;
    this.startD = this.prevD = this.hit.d;
    this.startT = p.t;
    this.crossed = false;
    this.travel = 0;
    this.trailN = 0;
    this.pushTrail(p.mm);
  }

  onPointerMove(p: WoundPointer): void {
    if (!this.stroking) return;
    if (this.advance(p.mm)) this.ctx.audio.play('suturePull', { volume: 0.35, pitch: 1.2 });
    this.pushTrail(p.mm);
  }

  onPointerUp(p: WoundPointer): void {
    if (!this.stroking || p.button !== 0) return;
    this.stroking = false;
    if (this.done) return;
    // Movimiento final (por si no hubo 'move' en el último punto).
    if (p.mm.x !== this.prevPt.x || p.mm.y !== this.prevPt.y) this.advance(p.mm);
    const end = p.mm;
    const endD = signedDistToPolyline(end, this.params.path, this.hit).d;
    const dur = p.t - this.startT;
    if (this.travel < 2) {
      this.pop('Arrastra cruzando la incisión', end, 'miss', 'short', 1.5);
      return;
    }
    if (!this.crossed || side(endD) === side(this.startD)) {
      this.pop('Cruza la incisión de lado a lado', end, 'miss');
      return;
    }
    if (Math.abs(this.startD) < SUTURE.minBiteMm || Math.abs(endD) < SUTURE.minBiteMm) {
      this.pop('Muerde más: entra y sal a ≥ 3 mm del borde', end, 'miss');
      return;
    }
    const err = Math.abs(this.crossS - this.expectedS());
    this.lastErr = err;
    this.gSpacing.value = Math.min(this.params.spacingMm, err);
    if (err > this.tolMm) {
      this.pop(err > this.params.spacingMm ? 'Aquí no: busca el punto marcado' : 'Espaciado irregular', this.cross, 'miss');
      return;
    }
    // Punto válido: calidad por posición, duración y simetría del mordisco.
    const posQ = 1 - (err / this.tolMm) * 0.5;
    let durQ = 1;
    if (dur < SUTURE.tightSec) {
      durQ = 0.55;
      this.pop('Tensión excesiva', end, 'bad');
    } else if (dur < SUTURE.goodMinSec) durQ = 0.85;
    else if (dur > SUTURE.goodMaxSec) durQ = dur > 2.5 ? 0.7 : 0.85;
    const sym = 1 - Math.min(0.3, Math.abs(Math.abs(this.startD) - Math.abs(endD)) / 20);
    const q = clamp(posQ * durQ * sym, 0, 1);
    const ang = (Math.atan2(end.y - this.start.y, end.x - this.start.x) * 180) / Math.PI;
    this.ctx.wound.addDecal('stitch', { x: this.cross.x, y: this.cross.y }, { to: { x: end.x, y: end.y }, angleDeg: ang });
    this.ctx.audio.play('suturePull');
    this.knotIn = SUTURE.knotDelaySec;
    const layer = this.params.layers[this.layerIdx];
    scoreGesture(this.ctx, `Punto de sutura (${LAYER_NAME[layer]})`, q, this.cross);
    this.inLayer++;
    this.doneTotal++;
    this.ctx.wound.setClosure(this.doneTotal / this.total);
    this.list[this.layerIdx].label = `Sutura de ${LAYER_NAME[layer]} (${this.inLayer}/${this.perLayer})`;
    if (this.inLayer >= this.perLayer) {
      this.list[this.layerIdx].done = true;
      this.layerIdx++;
      this.inLayer = 0;
      if (this.layerIdx >= this.params.layers.length) {
        this.knotIn = -1;
        this.ctx.audio.play('knot');
        sayLine(this.ctx, 'gigi', this.ctx.dialogue.gigi.filming, 0.4);
        this.complete();
      } else {
        this.pop(`Capa cerrada. Ahora: ${LAYER_NAME[this.params.layers[this.layerIdx]]}`, this.cross, 'good');
      }
    }
  }

  /** Avanza el trazo hasta mm; devuelve true si acaba de cruzar la incisión. */
  private advance(mm: Vec2): boolean {
    const d = signedDistToPolyline(mm, this.params.path, this.hit).d;
    this.travel += Math.hypot(mm.x - this.prevPt.x, mm.y - this.prevPt.y);
    let crossedNow = false;
    if (!this.crossed && side(d) !== side(this.prevD)) {
      // Punto de cruce interpolado sobre el segmento del trazo.
      const k = this.prevD / (this.prevD - d);
      this.cross.x = this.prevPt.x + (mm.x - this.prevPt.x) * k;
      this.cross.y = this.prevPt.y + (mm.y - this.prevPt.y) * k;
      this.crossS = signedDistToPolyline(this.cross, this.params.path, this.hit).s;
      this.crossed = true;
      crossedNow = true;
    }
    this.prevD = d;
    this.prevPt.x = mm.x;
    this.prevPt.y = mm.y;
    return crossedNow;
  }

  update(dt: number): void {
    if (this.knotIn > 0) {
      this.knotIn -= dt;
      if (this.knotIn <= 0) this.ctx.audio.play('knot');
    }
  }

  private pushTrail(mm: Vec2): void {
    if (this.trailN >= TRAIL) {
      this.trail.copyWithin(0, 2);
      this.trailN = TRAIL - 1;
    }
    this.trail[this.trailN * 2] = mm.x;
    this.trail[this.trailN * 2 + 1] = mm.y;
    this.trailN++;
  }

  private draw(g: CanvasRenderingContext2D, px: (p: Vec2) => Vec2, ppm: number, t: number): void {
    // Hilo del trazo en curso (lila, como la venda).
    if (this.stroking && this.trailN > 1) {
      g.strokeStyle = 'rgba(183,156,242,0.95)';
      g.lineWidth = Math.max(1.5, ppm * 0.4);
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      const tmp = { x: this.trail[0], y: this.trail[1] };
      let c = px(tmp);
      g.moveTo(c.x, c.y);
      for (let i = 1; i < this.trailN; i++) {
        tmp.x = this.trail[i * 2];
        tmp.y = this.trail[i * 2 + 1];
        c = px(tmp);
        g.lineTo(c.x, c.y);
      }
      g.stroke();
      // Aguja curva en la punta.
      g.strokeStyle = '#dfe7ef';
      g.lineWidth = Math.max(1, ppm * 0.35);
      g.beginPath();
      g.arc(c.x, c.y, ppm * 2, Math.PI * 0.9, Math.PI * 1.9);
      g.stroke();
    }
    if (this.done) return;
    // Marcador del siguiente punto: entrada y salida a cada lado y arco sugerido.
    const lvl = this.ctx.guideLevel;
    const alpha = guideAlpha(lvl, 1, 0.8, 0.28);
    const s = this.expectedS();
    const path = this.params.path;
    const at = pointAtLength(path, s);
    const ahead = pointAtLength(path, Math.min(this.pathLen, s + 0.5));
    const behind = pointAtLength(path, Math.max(0, s - 0.5));
    let tx = ahead.x - behind.x;
    let ty = ahead.y - behind.y;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    const bite = 4.5;
    const e1 = px({ x: at.x - ty * bite, y: at.y + tx * bite });
    const e2 = px({ x: at.x + ty * bite, y: at.y - tx * bite });
    const C = px(at);
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);
    if (lvl === 'full') {
      g.strokeStyle = `rgba(159,240,208,${0.5 + 0.3 * pulse})`;
      g.lineWidth = Math.max(1, ppm * 0.35);
      g.setLineDash([ppm * 0.9, ppm * 0.7]);
      g.beginPath();
      g.moveTo(e1.x, e1.y);
      g.quadraticCurveTo(C.x + tx * ppm * 3.5, C.y + ty * ppm * 3.5, e2.x, e2.y);
      g.stroke();
      g.setLineDash([]);
      // Tolerancia a lo largo de la incisión.
      g.strokeStyle = 'rgba(159,240,208,0.25)';
      g.lineWidth = ppm * 1.2;
      const a0 = pointAtLength(path, Math.max(0, s - this.tolMm));
      const a1 = pointAtLength(path, Math.min(this.pathLen, s + this.tolMm));
      const A0 = px(a0);
      const A1 = px(a1);
      g.beginPath();
      g.moveTo(A0.x, A0.y);
      g.lineTo(A1.x, A1.y);
      g.stroke();
    }
    if (lvl === 'endpoints') {
      // Arco sugerido también con guías reducidas (sin la franja de tolerancia).
      g.strokeStyle = `rgba(255,255,255,${0.55 + 0.3 * pulse})`;
      g.lineWidth = Math.max(1.5, ppm * 0.35);
      g.setLineDash([ppm * 0.9, ppm * 0.7]);
      g.beginPath();
      g.moveTo(e1.x, e1.y);
      g.quadraticCurveTo(C.x + tx * ppm * 3.5, C.y + ty * ppm * 3.5, e2.x, e2.y);
      g.stroke();
      g.setLineDash([]);
    }
    // Entrada (1, fucsia) y salida (2) del punto: siempre visibles, con alto contraste.
    drawTargetMarker(g, e1, ppm * 0.8, t, { level: lvl, label: '1', active: true });
    drawTargetMarker(g, e2, ppm * 0.8, t + 0.5, { level: lvl, label: '2' });
  }

  checklist(): ChecklistItem[] {
    return this.list;
  }

  progress(): number {
    if (this.done) return 1;
    return clamp(this.doneTotal / Math.max(1, this.total), 0, 1);
  }

  protected baseHint(): string {
    if (this.done) return 'Sutura cerrada. Qué costura tan mona.';
    const layer = LAYER_NAME[this.params.layers[this.layerIdx]];
    const cap = layer[0].toUpperCase() + layer.slice(1);
    return `${cap} ${this.inLayer + 1}/${this.perLayer}: arrastra con clic izq. cruzando la incisión por el punto marcado.`;
  }

  gauges(): Gauge[] {
    return this.gaugeList;
  }

  protected onEnd(): void {
    this.stroking = false;
  }
}
