import type { ChecklistItem, Gauge, IncisionParams, InstrumentId, StepDef, Vec2, WoundPointer } from '../../core/contracts';
import { clamp, closestOnPolyline, distToSegment, samplePolyline } from '../../core/math';
import { LAYER_NAME, StepA, roundRect, sayLine, scoreFault, scoreGesture } from './CauteryTool';

/** Parámetros de afinado de la incisión. */
export const INCISION = {
  tolMm: 6,
  cutWidthMm: 1.2,
  deepCutWidthMm: 1.6,
  openRadiusMm: 1.5,
  openTarget: 0.9,
  hazardMm: 4,
  offPathFaultMm: 15,
  samples: 40,
} as const;

const TRAIL = 72;
/** Estados del rastro: 0 bien, 1 superficial, 2 hondo, 3 fuera. */
const TRAIL_COLORS = ['rgba(255,246,251,', 'rgba(183,156,242,', 'rgba(255,77,109,', 'rgba(255,179,71,'];

/** Bisturí por capas a lo largo de la guía, con presión (rueda) y vasos peligrosos. */
export class IncisionStep extends StepA<IncisionParams> {
  readonly instruments: InstrumentId[];

  private layerIdx = 0;
  private samples: Vec2[] = [];
  private openFrac = 0;
  private hazardHit: boolean[] = [];
  // Trazo actual
  private drawing = false;
  private prev = { x: 0, y: 0 };
  private prevT = 0;
  private offTravel = 0;
  private offFaulted = false;
  private strokeCounted = -1;
  private pressure = 3;
  private lastDev = 0;
  // Estadísticas de la capa actual
  private devSum = 0;
  private lenSum = 0;
  private passes = 0;
  private speedEma = 0;
  private spN = 0;
  private spMean = 0;
  private spM2 = 0;
  // Rastro visual (anillo fijo)
  private trail = new Float32Array(TRAIL * 4);
  private trailHead = 0;
  private trailCount = 0;
  private clock = 0;

  private list: ChecklistItem[] = [];
  private gPressure: Gauge = { id: 'incision-pressure', label: 'Presión', value: 3, min: 1, max: 5, zones: [] };
  private gDev: Gauge = { id: 'incision-dev', label: 'Desviación', value: 0, min: 0, max: 15, unit: 'mm', zones: [] };
  private gaugeList: Gauge[] = [this.gPressure, this.gDev];

  constructor(def: StepDef) {
    super(def);
    this.instruments = [(def.params as IncisionParams).instrument];
  }

  private get tolMm(): number {
    return INCISION.tolMm * this.tol;
  }

  protected onBegin(): void {
    const p = this.params;
    this.samples = samplePolyline(p.path, INCISION.samples);
    this.hazardHit = (p.vesselHazards ?? []).map(() => false);
    this.list = p.layers.map((l) => ({ label: `Incisión: ${LAYER_NAME[l.layer]}`, done: false }));
    this.ctx.wound.setGuide(p.path, this.ctx.guideLevel);
    this.refreshZones();
    this.overlay({ id: `${this.def.id}:incision`, z: 44, draw: (g, px, ppm, t) => this.draw(g, px, ppm, t) });
  }

  private get target(): number {
    const l = this.params.layers[Math.min(this.layerIdx, this.params.layers.length - 1)];
    return l?.targetPressure ?? 3;
  }

  private refreshZones(): void {
    const t = this.target;
    this.gPressure.zones = [
      { from: 1, to: Math.max(1, t - 1), kind: t - 1 > 1 ? 'bad' : 'warn' },
      { from: Math.max(1, t - 1), to: Math.min(5, t + 1), kind: 'good' },
      { from: Math.min(5, t + 1), to: 5, kind: 'bad' },
    ].filter((z) => z.to > z.from) as Gauge['zones'];
    const tol = this.tolMm;
    this.gDev.zones = [
      { from: 0, to: tol * 0.5, kind: 'good' },
      { from: tol * 0.5, to: tol, kind: 'warn' },
      { from: tol, to: 15, kind: 'bad' },
    ];
  }

  onPointerDown(p: WoundPointer): void {
    if (this.done || p.button !== 0) return;
    if (!p.instrument.startsWith('scalpel')) {
      this.pop('Esto se corta con bisturí', p.mm, 'miss', 'tool', 2);
      return;
    }
    this.drawing = true;
    this.prev.x = p.mm.x;
    this.prev.y = p.mm.y;
    this.prevT = p.t;
    this.offTravel = 0;
    this.offFaulted = false;
    this.strokeCounted = -1;
    this.pressure = p.pressure;
    this.gPressure.value = p.pressure;
    const loop = this.startLoop('scalpel');
    loop.set('rate', 0);
    loop.set('load', clamp(p.pressure / 5, 0, 1));
  }

  onPointerMove(p: WoundPointer): void {
    this.pressure = p.pressure;
    this.gPressure.value = p.pressure;
    if (!this.drawing || this.done) return;
    const cur = p.mm;
    const segLen = Math.hypot(cur.x - this.prev.x, cur.y - this.prev.y);
    if (segLen < 0.05) return;
    const dtMove = p.t - this.prevT;
    const dev = closestOnPolyline(cur, this.params.path).dist;
    this.lastDev = dev;
    this.gDev.value = Math.min(15, dev);
    const layer = this.params.layers[this.layerIdx];
    const target = layer.targetPressure;
    const pr = p.pressure;

    // Sonido: velocidad del trazo.
    if (dtMove > 0) {
      const speed = segLen / dtMove;
      this.speedEma = this.speedEma === 0 ? speed : this.speedEma * 0.7 + speed * 0.3;
      this.loop?.set('rate', clamp(this.speedEma / 90, 0, 1));
      this.loop?.set('load', clamp(pr / 5, 0, 1));
      this.loop?.set('wet', this.layerIdx / Math.max(1, this.params.layers.length));
    }

    let state = 0;
    if (dev <= this.tolMm) {
      if (pr <= target - 2) {
        state = 1;
        this.pop('Muy superficial', cur, 'miss', 'shallow', 1.2);
      } else {
        const deep = pr >= target + 2;
        state = deep ? 2 : 0;
        this.ctx.wound.cut(layer.layer, this.prev, cur, deep ? INCISION.deepCutWidthMm : INCISION.cutWidthMm);
        if (this.strokeCounted !== this.layerIdx) {
          this.strokeCounted = this.layerIdx;
          this.passes++;
        }
        this.devSum += dev * segLen;
        this.lenSum += segLen;
        if (dtMove > 0) this.addSpeed(this.speedEma);
        if (deep) this.checkHazards(this.prev, cur);
        this.checkLayer(cur);
      }
    } else {
      state = 3;
      this.offTravel += segLen;
      if (this.offTravel > INCISION.offPathFaultMm && !this.offFaulted) {
        this.offFaulted = true;
        const ang = (Math.atan2(cur.y - this.prev.y, cur.x - this.prev.x) * 180) / Math.PI;
        this.ctx.wound.addDecal('scratch', { x: cur.x, y: cur.y }, { angleDeg: ang, sizeMm: 6 });
        scoreFault(this.ctx, 'offPath', cur, '¡Fuera de la guía!');
      }
    }
    this.pushTrail(cur.x, cur.y, state);
    this.prev.x = cur.x;
    this.prev.y = cur.y;
    this.prevT = p.t;
  }

  onPointerUp(p: WoundPointer): void {
    if (p.button !== 0) return;
    this.drawing = false;
    this.speedEma = 0;
    this.stopLoop();
  }

  update(dt: number): void {
    this.clock += dt;
  }

  private addSpeed(v: number): void {
    this.spN++;
    const d = v - this.spMean;
    this.spMean += d / this.spN;
    this.spM2 += d * (v - this.spMean);
  }

  private checkHazards(a: Vec2, b: Vec2): void {
    const hz = this.params.vesselHazards;
    if (!hz) return;
    for (let i = 0; i < hz.length; i++) {
      if (this.hazardHit[i]) continue;
      if (distToSegment(hz[i], a, b) > INCISION.hazardMm) continue;
      this.hazardHit[i] = true;
      const kind = this.ctx.rng() < 0.5 ? 'arterial' : 'venous';
      const bl = this.ctx.bleeding.spawn({ x: hz[i].x, y: hz[i].y }, kind, this.ctx.now());
      this.ctx.bus.emit('bleeder:spawn', { id: bl.id, kind, pos: bl.pos });
      this.ctx.audio.play('splash');
      scoreFault(this.ctx, 'vesselCut', hz[i], kind === 'arterial' ? '¡Arteria cortada!' : '¡Vena cortada!');
    }
    this.pop('¡Muy hondo! Baja la presión', b, 'bad', 'deep', 2);
  }

  private checkLayer(at: Vec2): void {
    const layer = this.params.layers[this.layerIdx];
    this.openFrac = this.ctx.wound.openFraction(layer.layer, this.samples, INCISION.openRadiusMm);
    if (this.openFrac < INCISION.openTarget) return;
    // Capa terminada: calidad por desviación media, regularidad y número de pasadas.
    const meanDev = this.lenSum > 0 ? this.devSum / this.lenSum : 0;
    const devQ = clamp(1 - meanDev * 0.1, 0, 1);
    const std = this.spN > 1 ? Math.sqrt(this.spM2 / (this.spN - 1)) : 0;
    const cv = this.spMean > 1e-6 ? std / this.spMean : 0;
    const steadyQ = clamp(1.15 - cv, 0.4, 1);
    const passQ = this.passes <= 1 ? 1 : this.passes === 2 ? 0.9 : Math.max(0.5, 0.9 - 0.1 * (this.passes - 2));
    const q = 0.6 * devQ + 0.25 * steadyQ + 0.15 * passQ;
    scoreGesture(this.ctx, `Incisión: ${LAYER_NAME[layer.layer]}`, q, at);
    this.list[this.layerIdx].done = true;
    this.layerIdx++;
    this.openFrac = 0;
    this.devSum = this.lenSum = 0;
    this.passes = 0;
    this.spN = 0;
    this.spMean = this.spM2 = 0;
    if (this.layerIdx >= this.params.layers.length) {
      this.drawing = false;
      this.stopLoop();
      this.ctx.wound.setGuide(null, this.ctx.guideLevel);
      this.complete();
      return;
    }
    this.refreshZones();
    const next = this.params.layers[this.layerIdx];
    this.pop(`Ahora: ${LAYER_NAME[next.layer]} (presión ${next.targetPressure})`, at, 'good');
    this.strokeCounted = -1;
    if (this.layerIdx === 1) sayLine(this.ctx, 'rodrigo', this.ctx.dialogue.rodrigo.idle, 0.35);
  }

  private pushTrail(x: number, y: number, state: number): void {
    const i = this.trailHead * 4;
    this.trail[i] = x;
    this.trail[i + 1] = y;
    this.trail[i + 2] = this.clock;
    this.trail[i + 3] = state;
    this.trailHead = (this.trailHead + 1) % TRAIL;
    if (this.trailCount < TRAIL) this.trailCount++;
  }

  private draw(g: CanvasRenderingContext2D, px: (p: Vec2) => Vec2, ppm: number, t: number): void {
    // Rastro del bisturí (se desvanece en 1,2 s), color según estado.
    const tmp = { x: 0, y: 0 };
    g.lineCap = 'round';
    g.lineWidth = Math.max(1.5, ppm * 0.5);
    for (let k = 1; k < this.trailCount; k++) {
      const i1 = ((this.trailHead - k + TRAIL) % TRAIL) * 4;
      const i0 = ((this.trailHead - k - 1 + TRAIL) % TRAIL) * 4;
      const age = this.clock - this.trail[i1 + 2];
      if (age > 1.2) break;
      if (this.trail[i1 + 2] - this.trail[i0 + 2] > 0.25) continue;
      tmp.x = this.trail[i0];
      tmp.y = this.trail[i0 + 1];
      const a = px(tmp);
      tmp.x = this.trail[i1];
      tmp.y = this.trail[i1 + 1];
      const b = px(tmp);
      g.strokeStyle = TRAIL_COLORS[this.trail[i1 + 3]] + (0.75 * (1 - age / 1.2)).toFixed(3) + ')';
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
    }
    if (this.done) return;
    // Etiqueta de capa actual junto al inicio de la guía.
    const layer = this.params.layers[this.layerIdx];
    const start = this.params.path[0];
    const c = px({ x: start.x, y: start.y - 7 });
    const text = `${LAYER_NAME[layer.layer]} · presión ${layer.targetPressure}`;
    g.font = `700 ${Math.round(ppm * 2.3)}px Nunito, system-ui, sans-serif`;
    const w = g.measureText(text).width + ppm * 4.2;
    const h = ppm * 3.8;
    g.fillStyle = 'rgba(59,33,70,0.78)';
    roundRect(g, c.x - ppm, c.y - h / 2, w, h, h / 2);
    g.fill();
    g.fillStyle = this.pressureColor();
    g.beginPath();
    g.arc(c.x + ppm * 0.6, c.y, ppm * 0.8, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff6fb';
    g.textBaseline = 'middle';
    g.fillText(text, c.x + ppm * 2, c.y + 1);
    // Barra de progreso de la capa bajo la etiqueta.
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(c.x, c.y + h / 2 + ppm * 0.4, w - ppm * 2, ppm * 0.6);
    g.fillStyle = '#9ff0d0';
    g.fillRect(c.x, c.y + h / 2 + ppm * 0.4, (w - ppm * 2) * clamp(this.openFrac / INCISION.openTarget, 0, 1), ppm * 0.6);
    // Vasos peligrosos: aviso sutil que late cuando la presión es excesiva.
    const hz = this.params.vesselHazards;
    if (hz && this.pressure >= this.target + 2 && this.ctx.guideLevel !== 'none') {
      g.strokeStyle = `rgba(255,77,109,${(0.4 + 0.3 * Math.sin(t * 8)).toFixed(3)})`;
      g.lineWidth = Math.max(1, ppm * 0.3);
      for (let i = 0; i < hz.length; i++) {
        if (this.hazardHit[i]) continue;
        const q = px(hz[i]);
        g.beginPath();
        g.arc(q.x, q.y, ppm * INCISION.hazardMm, 0, Math.PI * 2);
        g.stroke();
      }
    }
  }

  private pressureColor(): string {
    const d = this.pressure - this.target;
    return d <= -2 ? '#b79cf2' : d >= 2 ? '#ff4d6d' : '#3fcf9c';
  }

  checklist(): ChecklistItem[] {
    return this.list;
  }

  progress(): number {
    if (this.done) return 1;
    const n = this.params.layers.length;
    return clamp((this.layerIdx + clamp(this.openFrac / INCISION.openTarget, 0, 1)) / n, 0, 1);
  }

  protected baseHint(): string {
    if (this.done) return 'Incisión completa. ¡Qué pulso, doctora!';
    const l = this.params.layers[this.layerIdx];
    const t = l.targetPressure;
    const d = this.pressure - t;
    if (d <= -2) return `Muy suave: sube la presión con la rueda hasta ${t} para cortar ${LAYER_NAME[l.layer]}.`;
    if (d >= 2) return `¡Demasiada presión! Baja la rueda a ${t}: hay vasos debajo.`;
    return `Capa ${LAYER_NAME[l.layer]}: arrastra con clic izq. sobre la guía (rueda: presión ${t}).`;
  }

  gauges(): Gauge[] {
    return this.gaugeList;
  }

  protected onEnd(): void {
    this.drawing = false;
    this.ctx.wound.setGuide(null, this.ctx.guideLevel);
  }
}
