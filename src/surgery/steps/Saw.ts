import type {
  ChecklistItem,
  Gauge,
  InstrumentId,
  LoopHandle,
  SawParams,
  StepDef,
  Vec2,
  WoundPointer,
} from '../../core/contracts';
import { BONE_NECROSIS_C, PALETTE } from '../../core/constants';
import { clamp, closestOnPolyline, dist, polylineLength, samplePolyline } from '../../core/math';
import { BoneHeat, BoneStep, HEAT_ZONES, drawHeatRing, fmt } from './drilling';

/** Número de tramos en que se divide la trayectoria de corte. */
export const SAW_BINS = 40;
/** °C/s cortando sin irrigar (con irrigación obligatoria / opcional) y con irrigación. */
export const SAW_HEAT = { dryRequired: 6, dry: 2.5, wet: 1.5, cool: 4 } as const;
/** Velocidad mínima (mm/s) para considerar que la hoja avanza. */
const MOVING_MM_S = 2;

interface Dust {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

/**
 * Sierra (oscilante, birradial, fina): mantener clic y recorrer la trayectoria,
 * irrigando (I o clic derecho) para no sobrecalentar. Libera fragmentos al terminar.
 */
export class SawStep extends BoneStep<SawParams> {
  readonly instruments: InstrumentId[] = ['saw'];
  private bins = new Uint8Array(SAW_BINS);
  private filled = 0;
  private heat = new BoneHeat();
  private pointer: Vec2 = { x: 0, y: 0 };
  private prevPointer: Vec2 = { x: 0, y: 0 };
  private held = false;
  private rightHeld = false;
  private keyIrrigate = false;
  private cutting = false;
  private irrigating = false;
  private deviation = 0;
  private devSum = 0;
  private devN = 0;
  private lastBin = -1;
  private scratchAt = -1;
  private hortensiaAt = -1;
  private sawSec = 0;
  private loop: LoopHandle | null = null;
  private samples: Vec2[] = [];
  private dust: Dust[] = [];
  private clock = 0;

  protected onBegin(): void {
    const p = this.params;
    this.samples = samplePolyline(p.path, SAW_BINS + 1);
    this.pointer = { ...p.path[0] };
    this.prevPointer = { ...p.path[0] };
    for (let i = 0; i < 48; i++) this.dust.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0 });
    this.ctx.wound.setGuide(p.path, this.ctx.guideLevel);
    this.overlay({ id: `saw:${this.def.id}`, z: 44, draw: (g, px, s, t) => this.draw(g, px, s, t) });
  }

  private tol() {
    return this.params.tolMm * this.tolScale;
  }

  /** Temperatura actual del hueso (°C). */
  temperature(): number {
    return this.heat.c;
  }

  cutFraction(): number {
    return this.filled / SAW_BINS;
  }

  onPointerDown(p: WoundPointer): void {
    this.pointer = p.mm;
    this.prevPointer = p.mm;
    if (this.done) return;
    this.interacted = true;
    if (p.button === 2 || p.buttons & 2) this.rightHeld = true;
    if (p.button === 0) this.startHold();
  }

  private startHold(): void {
    this.held = true;
    if (!this.loop) this.loop = this.ctx.audio.loop('saw');
  }

  onPointerMove(p: WoundPointer): void {
    this.pointer = p.mm;
    // Acorde derecho→izquierdo: el navegador no manda pointerdown para el segundo
    // botón, solo un pointermove con el bit 1 encendido. Se empieza a serrar igual.
    if (p.buttons & 1 && !this.held && !this.done) {
      this.interacted = true;
      this.startHold();
    }
    this.held = !!(p.buttons & 1) && this.held;
    this.rightHeld = !!(p.buttons & 2);
    if (!this.held) this.stopLoop();
  }

  onPointerUp(p: WoundPointer): void {
    this.pointer = p.mm;
    if (!(p.buttons & 1)) {
      this.held = false;
      this.stopLoop();
    }
    this.rightHeld = !!(p.buttons & 2);
  }

  onKey(key: string, down: boolean): boolean {
    if (key === 'KeyI') {
      this.keyIrrigate = down;
      return true;
    }
    return false;
  }

  private stopLoop(): void {
    this.loop?.stop();
    this.loop = null;
  }

  update(dt: number): void {
    this.clock += dt;
    this.updateDust(dt);
    if (this.done || dt <= 0) return;
    const p = this.params;
    const moved = dist(this.pointer, this.prevPointer);
    const speed = moved / dt;
    const moving = speed > MOVING_MM_S;
    const near = closestOnPolyline(this.pointer, p.path);
    this.deviation = near.dist;
    this.irrigating = this.keyIrrigate || this.rightHeld;
    const onBone = this.ctx.bone.isOnBone(this.pointer) || near.dist <= this.tol();
    this.cutting = this.held && onBone;

    // Calor.
    let rise = 0;
    if (this.cutting) rise = this.irrigating ? SAW_HEAT.wet : p.irrigationRequired ? SAW_HEAT.dryRequired : SAW_HEAT.dry;
    const necro = this.heat.step(dt, rise, this.irrigating ? SAW_HEAT.cool + 2 : SAW_HEAT.cool);
    if (necro) {
      this.ctx.log.fault('thermalNecrosis', 'Sierra sin irrigar por encima de 47 °C');
      this.ctx.wound.addDecal('necrosis', near.point, { sizeMm: 6 });
      this.pop('¡Necrosis térmica! Irriga (I)', near.point, 'bad');
      this.valerioOn('thermalNecrosis');
    }

    const bin = Math.min(SAW_BINS - 1, Math.floor(near.t * SAW_BINS));
    if (this.cutting && moving) {
      this.sawSec += dt;
      if (near.dist <= this.tol()) {
        this.fillBin(bin);
        // Rellena los tramos intermedios desde la muestra anterior (incluida la del
        // inicio del trazo, que aún no se movía) si el salto a lo largo de la línea
        // cuadra con lo que se movió la hoja: pasadas rápidas o a pocos fps.
        if (this.lastBin >= 0 && this.canBridge(bin, moved)) {
          const a = Math.min(bin, this.lastBin);
          const b = Math.max(bin, this.lastBin);
          for (let i = a; i <= b; i++) this.fillBin(i);
        }
        this.lastBin = bin;
        this.devSum += near.dist;
        this.devN++;
        this.spawnDust(near.point, 2);
      } else {
        this.lastBin = -1;
        this.devSum += near.dist;
        this.devN++;
        this.offPath(near.point);
      }
      this.maybeHortensia();
    } else if (this.cutting && near.dist <= this.tol()) {
      // Hoja apoyada en la línea pero quieta: ancla el tramo sin cortarlo todavía.
      this.lastBin = bin;
    } else if (!this.held) {
      this.lastBin = -1;
    }

    if (this.loop) {
      this.loop.set('rate', this.cutting ? (moving ? 1 : 0.75) : 0.55);
      this.loop.set('load', this.cutting ? clamp(0.5 + speed / 60, 0, 1) : 0.1);
      this.loop.set('wet', this.irrigating ? 1 : 0);
      this.loop.set('intensity', clamp((this.heat.c - 42) / 8, 0, 1));
    }
    this.prevPointer = this.pointer;

    if (this.filled >= SAW_BINS) this.finish();
  }

  /** ¿Se puede unir el tramo anterior con `bin` sin saltarse trozos de línea? */
  private canBridge(bin: number, movedMm: number): boolean {
    const gap = Math.abs(bin - this.lastBin);
    if (gap <= 4) return true;
    const binMm = polylineLength(this.params.path) / SAW_BINS;
    return gap * binMm <= movedMm + this.tol() + binMm;
  }

  private fillBin(i: number): void {
    if (this.bins[i]) return;
    this.bins[i] = 1;
    this.filled++;
  }

  private offPath(at: Vec2): void {
    const now = this.ctx.now();
    if (now - this.scratchAt > 0.3) {
      this.scratchAt = now;
      this.ctx.wound.addDecal('scratch', this.pointer, { angleDeg: this.ctx.rng() * 180, sizeMm: 4 });
    }
    if (this.faultLimited('offPath', 2, 'Sierra fuera de la trayectoria')) {
      this.pop('¡Fuera de la línea!', at, 'bad');
      this.ctx.audio.play('crunch', { volume: 0.5, pitch: 1.5 });
    }
  }

  private maybeHortensia(): void {
    if (this.ctx.caseDef.owner.human !== 'hortensia') return;
    if (this.sawSec < 1.2) return;
    const now = this.ctx.now();
    if (this.hortensiaAt >= 0 && now - this.hortensiaAt < 10) return;
    this.hortensiaAt = now;
    if (this.say('hortensia', this.ctx.dialogue.owners.hortensia.upset, 10)) {
      this.ctx.audio.play('hortensiaScream', { volume: 0.6 });
    }
  }

  private finish(): void {
    const p = this.params;
    for (const id of p.releases ?? []) this.ctx.bone.release(id);
    const meanDev = this.devN ? this.devSum / this.devN : 0;
    const qDev = 1 - clamp(meanDev / this.tol(), 0, 1.5) * 0.4;
    const peak = this.heat.peak;
    const qHeat = peak < 42 ? 1 : peak <= BONE_NECROSIS_C ? 0.85 : 0.55;
    const q = clamp(qDev * qHeat, 0.05, 1);
    const kindLabel = p.kind === 'biradial' ? 'Osteotomía birradial' : p.kind === 'fine' ? 'Corte fino' : 'Osteotomía';
    this.ctx.log.gesture(kindLabel, q);
    this.ctx.audio.play('crunch', { volume: 1, pitch: 0.8 });
    const end = p.path[p.path.length - 1];
    this.pop(q >= 0.9 ? '¡Corte perfecto!' : '¡Corte completo!', end, q >= 0.9 ? 'perfect' : 'good');
    this.stopLoop();
    this.held = false;
    this.complete();
  }

  // ── Partículas de polvo óseo (preasignadas) ──

  private spawnDust(at: Vec2, n: number): void {
    for (const d of this.dust) {
      if (n <= 0) break;
      if (d.life > 0) continue;
      const a = this.ctx.rng() * Math.PI * 2;
      const sp = 6 + this.ctx.rng() * 14;
      d.x = at.x;
      d.y = at.y;
      d.vx = Math.cos(a) * sp;
      d.vy = Math.sin(a) * sp;
      d.life = 0.35 + this.ctx.rng() * 0.3;
      n--;
    }
  }

  private updateDust(dt: number): void {
    for (const d of this.dust) {
      if (d.life <= 0) continue;
      d.life -= dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.vx *= 0.9;
      d.vy *= 0.9;
    }
  }

  // ── Interfaz ──

  checklist(): ChecklistItem[] {
    return [{ label: `${this.def.label} (${Math.round(this.cutFraction() * 100)}%)`, done: this.done }];
  }

  progress(): number {
    return this.done ? 1 : this.cutFraction();
  }

  hint(): string {
    if (this.heat.c > 44 && this.irrigating) return this.hintText('Sigue caliente aun irrigando: suelta un momento para que enfríe');
    if (this.heat.c > 44) return this.hintText('¡Hueso caliente! Mantén I o clic derecho para irrigar, o pausa');
    if (this.cutting && this.deviation > this.tol()) return this.hintText('Vuelve a la línea de corte: pasadas cortas y rectas');
    return this.params.irrigationRequired
      ? this.hintText('Mantén clic y recorre la línea con la sierra; irriga con I o clic derecho')
      : this.hintText('Mantén clic y recorre la línea de corte con pasadas cortas');
  }

  gauges(): Gauge[] {
    const tol = this.tol();
    return [
      { id: 'heat', label: 'Temperatura', value: clamp(this.heat.c, 30, 70), min: 30, max: 70, unit: '°C', zones: HEAT_ZONES },
      {
        id: 'deviation',
        label: 'Desviación',
        value: clamp(this.cutting ? this.deviation : 0, 0, tol * 4),
        min: 0,
        max: tol * 4,
        unit: 'mm',
        zones: [
          { from: 0, to: tol, kind: 'good' },
          { from: tol, to: tol * 2, kind: 'warn' },
          { from: tol * 2, to: tol * 4, kind: 'bad' },
        ],
      },
    ];
  }

  protected onEnd(): void {
    this.stopLoop();
    this.ctx.wound.setGuide(null, this.ctx.guideLevel);
  }

  private draw(g: CanvasRenderingContext2D, px: (p: Vec2) => Vec2, s: number, t: number): void {
    const pts = this.samples;
    // Surco (kerf) de los tramos cortados.
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (let pass = 0; pass < 2; pass++) {
      g.strokeStyle = pass === 0 ? 'rgba(90,20,24,0.9)' : 'rgba(40,6,10,0.95)';
      g.lineWidth = pass === 0 ? s * 1.3 : s * 0.55;
      g.beginPath();
      let open = false;
      for (let i = 0; i < SAW_BINS; i++) {
        if (!this.bins[i]) {
          open = false;
          continue;
        }
        const a = px(pts[i]);
        const b = px(pts[i + 1]);
        if (!open) g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        open = true;
      }
      g.stroke();
    }
    g.restore();
    // Polvo óseo.
    g.save();
    g.fillStyle = 'rgba(255,248,230,0.9)';
    for (const d of this.dust) {
      if (d.life <= 0) continue;
      const q = px(d);
      g.globalAlpha = clamp(d.life * 2.5, 0, 1);
      g.fillRect(q.x - 1.5, q.y - 1.5, 3, 3);
    }
    g.restore();
    // Agua de irrigación.
    if (this.irrigating && this.held) {
      const q = px(this.pointer);
      g.save();
      g.fillStyle = 'rgba(160,220,255,0.55)';
      for (let i = 0; i < 6; i++) {
        const a = t * 7 + i;
        g.beginPath();
        g.arc(q.x + Math.cos(a) * s * 3, q.y + Math.sin(a * 1.3) * s * 3, 3, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }
    // Anillo de calor junto a la hoja.
    if (this.held || this.heat.c > 38.5) {
      const q = px(this.pointer);
      drawHeatRing(g, { x: q.x + s * 7, y: q.y - s * 6 }, 16, this.heat.c);
    }
    // Porcentaje de corte cerca del final de la trayectoria.
    const end = px(this.params.path[this.params.path.length - 1]);
    g.save();
    g.font = '800 12px Nunito, system-ui, sans-serif';
    g.textAlign = 'center';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(59,33,70,0.85)';
    const txt = `corte ${fmt(this.cutFraction() * 100, 0)}%`;
    g.strokeText(txt, end.x, end.y + 18);
    g.fillStyle = PALETTE.mint;
    g.fillText(txt, end.x, end.y + 18);
    g.restore();
  }
}

export const createSawStep = (def: StepDef) => new SawStep(def);
