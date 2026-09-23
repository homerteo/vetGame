import type {
  ChecklistItem,
  Gauge,
  InstrumentId,
  ScrewsParams,
  StepDef,
  Vec2,
  WoundPointer,
} from '../../core/contracts';
import { PALETTE } from '../../core/constants';
import { clamp, dist } from '../../core/math';
import { createScrewCatch, type CatchResult, type ScrewCatchAPI } from '../minigames/ScrewCatch';
import {
  BoneStep,
  HEAT_ZONES,
  createDrillHole,
  drawDepthBar,
  drawHeatRing,
  drawSpotMarker,
  drawTag,
  fmt,
  type DrillHole,
  type DrillHoleResult,
} from './drilling';
import '../minigames/screwcatch.css';

export type ScrewPhase = 'catch' | 'dropped' | 'waitSpare' | 'pilot' | 'measure' | 'tighten' | 'done';

/** Coste de un tornillo caído (HC). */
export const SCREW_DROP_HC = 15;
/** Espera por un repuesto estéril (s). */
export const SPARE_WAIT_SEC = 5;
/** Segundos para llevar el torque de 0 a 1. */
export const TORQUE_RAMP_SEC = 1.4;
/** Tiempo que el mini-juego sigue visible tras el resultado. */
const CATCH_LINGER_SEC = 0.7;
/** Tras una caída, pulsaciones antes de esto se consideran rebote del intento de atrapar. */
const DROP_DEBOUNCE_SEC = 0.2;
const PILOT_TOL_MM = 2;
/** Fracción de la profundidad que es cortical en cada lado del piloto (el resto, médula). */
export const PILOT_CORTEX_FRAC = 0.12;
/** Temperatura a partir de la cual la pista del piloto avisa de soltar. */
const PILOT_HOT_C = 44;

/** Longitud ideal: la menor opción ≥ profundidad (o la mayor si ninguna alcanza). */
export function idealLength(depthMm: number, options: number[]): number {
  const sorted = [...options].sort((a, b) => a - b);
  return sorted.find((o) => o >= depthMm) ?? sorted[sorted.length - 1];
}

/** Calidad y veredicto de una longitud elegida. */
export function judgeLength(lengthMm: number, depthMm: number, options: number[]): { quality: number; text: string; kind: 'perfect' | 'good' | 'miss' } {
  if (lengthMm < depthMm) return { quality: 0.3, text: 'No muerde la segunda cortical', kind: 'miss' };
  if (lengthMm === idealLength(depthMm, options)) return { quality: 1, text: '¡Medida exacta!', kind: 'perfect' };
  if (lengthMm - depthMm > 2) return { quality: 0.55, text: 'Sobresale', kind: 'miss' };
  return { quality: 0.8, text: 'Un pelín largo', kind: 'good' };
}

/**
 * Tornillos: por cada agujero, taladrar el piloto, medir y elegir longitud (1..n),
 * atrapar a ritmo el tornillo de esa longitud que ofrece Fritz (ScrewCatch) y apretar
 * hasta el clic del limitador. Siempre se perfora antes de pedir el tornillo.
 */
export class ScrewsStep extends BoneStep<ScrewsParams> {
  readonly instruments: InstrumentId[] = ['drill', 'screwdriver'];
  private holes: Vec2[] = [];
  private idx = 0;
  private phase: ScrewPhase = 'pilot';
  private catcher: ScrewCatchAPI | null = null;
  private lingerIn = -1;
  private afterLinger: (() => void) | null = null;
  private panel: HTMLElement | null = null;
  private spareLeft = 0;
  private contaminated = false;
  private pilot: DrillHole | null = null;
  private lengthMm = 0;
  private torque = 0;
  private turning = false;
  private tickAcc = 0;
  private q = { catch: 1, pilot: 1, length: 1, torque: 1 };
  private hover: Vec2 = { x: 0, y: 0 };
  private clock = 0;
  private placedFx = -1;
  private waitingPlate = false;
  private droppedAt = -1;

  protected onBegin(): void {
    this.resolveHoles();
    this.overlay({ id: `screws:${this.def.id}`, z: 46, draw: (g, px, s, t) => this.draw(g, px, s, t) });
    if (this.holes.length) this.startPilot();
    else this.waitingPlate = true;
  }

  private resolveHoles(): void {
    const h = this.params.holes;
    this.holes = h === 'plate' ? this.ctx.bone.plateHolesWorld().map((p) => ({ ...p })) : h.map((p) => ({ ...p }));
    if (this.holes.length) this.hover = { ...this.holes[0] };
  }

  /** Estado para pruebas y la página dev. */
  state(): { phase: ScrewPhase; index: number; total: number; torque: number; contaminated: boolean } {
    return { phase: this.phase, index: this.idx, total: this.holes.length, torque: this.torque, contaminated: this.contaminated };
  }

  private hole(): Vec2 {
    return this.holes[this.idx];
  }

  private depth(): number {
    const d = this.params.depthsMm;
    return d[Math.min(this.idx, d.length - 1)] ?? 8;
  }

  private tolMm() {
    return PILOT_TOL_MM * this.tolScale;
  }

  private layer(): HTMLElement {
    return this.ctx.hud.minigameLayer();
  }

  private clearPanel(): void {
    this.panel?.remove();
    this.panel = null;
  }

  private disposeCatcher(): void {
    this.catcher?.dispose();
    this.catcher = null;
  }

  // ── (a) Atrapar ──

  private startCatch(): void {
    this.clearPanel();
    this.disposeCatcher();
    this.lingerIn = -1;
    this.afterLinger = null;
    this.phase = 'catch';
    this.ctx.crew.fritz.presentItem('screw');
    this.catcher = createScrewCatch({
      layer: this.layer(),
      beat: this.ctx.beat,
      tremor: () => this.ctx.crew.fritz.tremor(),
      windowScale: this.ctx.settings.rhythmWindowScale * this.tolScale,
      audio: this.ctx.audio,
      // En el tutorial Fritz espera lo que haga falta; si no, insiste una vez.
      reoffers: this.tutorial ? Number.POSITIVE_INFINITY : 1,
      onResult: (r) => this.onCatch(r),
    });
  }

  private onCatch(r: CatchResult): void {
    const at = this.hole();
    if (r === 'miss') {
      this.ctx.crew.fritz.dropped();
      this.ctx.bus.emit('screw:dropped', {});
      this.ctx.log.fault('screwDropped', 'Tornillo al suelo');
      this.ctx.addCost(SCREW_DROP_HC, 'Tornillo caído');
      this.ctx.audio.play('screwDrop');
      this.ctx.audio.play('contaminated');
      this.pop('¡CONTAMINADO!', at, 'bad');
      this.say('fritz', this.ctx.dialogue.fritz.drop, 4);
      this.linger(() => this.showDropPrompt());
      this.phase = 'dropped';
      this.droppedAt = this.clock;
      return;
    }
    this.ctx.crew.fritz.caught(r);
    this.ctx.bus.emit('screw:caught', { quality: r });
    this.q.catch = r === 'perfect' ? 1 : 0.8;
    if (r === 'perfect') this.ctx.log.bonus('Tornillo atrapado a tempo', 1);
    if (this.ctx.rng() < 0.35) this.say('fritz', this.ctx.dialogue.fritz.catch, 6);
    this.linger(null);
    this.contaminated = false;
    this.startTighten();
  }

  private linger(then: (() => void) | null): void {
    this.lingerIn = CATCH_LINGER_SEC;
    this.afterLinger = then;
  }

  private showDropPrompt(): void {
    const panel = document.createElement('div');
    panel.className = 'sb-panel sb-drop';
    panel.innerHTML = `<div class="sb-title">¡Se cayó el tornillo!</div>
      <div class="sb-sub">Fritz tiembla. ¿Qué hacemos, doctora?</div>
      <div class="sb-choices">
        <div class="sb-choice sb-risky" data-c="use"><span class="sb-key">U</span> Usar el del suelo<br><small>contaminado, rápido</small></div>
        <div class="sb-choice" data-c="wait"><span class="sb-key">Espacio</span> Esperar repuesto<br><small>${SPARE_WAIT_SEC} s, estéril</small></div>
      </div>`;
    panel.querySelectorAll<HTMLElement>('.sb-choice').forEach((el) =>
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (el.dataset.c === 'use') this.useFloorScrew();
        else this.waitSpare();
      }),
    );
    this.layer().appendChild(panel);
    this.panel = panel;
  }

  /**
   * ¿Se acepta ya la elección tras la caída? Vale también antes de que aparezca el
   * panel (durante la animación), salvo el rebote inmediato del intento de atrapar.
   */
  private canChooseAfterDrop(): boolean {
    return this.phase === 'dropped' && (!!this.panel || this.clock - this.droppedAt >= DROP_DEBOUNCE_SEC);
  }

  /** [U] Usar el tornillo del suelo: rápido pero contaminado. */
  useFloorScrew(): void {
    if (!this.canChooseAfterDrop()) return;
    this.afterLinger = null;
    this.disposeCatcher();
    this.lingerIn = -1;
    this.clearPanel();
    this.contaminated = true;
    this.q.catch = 0.3;
    this.ctx.audio.play('uiClick');
    this.pop('Tornillo del suelo… ¡uf!', this.hole(), 'miss');
    this.startTighten();
  }

  /** [Espacio] Esperar un repuesto estéril. */
  waitSpare(): void {
    if (!this.canChooseAfterDrop()) return;
    this.afterLinger = null;
    this.disposeCatcher();
    this.lingerIn = -1;
    this.clearPanel();
    this.phase = 'waitSpare';
    this.spareLeft = SPARE_WAIT_SEC;
    this.q.catch = 0.6;
    const panel = document.createElement('div');
    panel.className = 'sb-panel sb-spare';
    panel.innerHTML = `<div class="sb-title">Repuesto en camino</div><div class="sb-sub">Fritz corre a la autoclave…</div><div class="sb-wait">${SPARE_WAIT_SEC} s</div>`;
    this.layer().appendChild(panel);
    this.panel = panel;
  }

  // ── (b) Piloto ──

  private startPilot(): void {
    this.phase = 'pilot';
    const d = this.depth();
    const c = d * PILOT_CORTEX_FRAC;
    const profile: [number, number, number] = [c, d - 2 * c, c];
    this.pilot?.dispose();
    this.pilot = createDrillHole({
      ctx: this.ctx,
      pos: { ...this.hole() },
      tolMm: this.tolMm(),
      profileMm: profile,
      tutorial: this.tutorial,
      onDone: (r) => this.onPilotDone(r),
    });
    this.ctx.selectInstrument('drill');
  }

  private onPilotDone(r: DrillHoleResult): void {
    this.q.pilot = r.quality;
    // Agujero hecho: se cambia solo al tornillo (el jugador no tiene que tocar la barra).
    this.ctx.selectInstrument('screwdriver');
    if (!r.plunged) this.pop(r.quality >= 0.9 ? '¡Piloto limpio!' : 'Piloto listo', this.hole(), r.quality >= 0.9 ? 'perfect' : 'good');
    this.showMeasure();
  }

  // ── (c) Medir ──

  private showMeasure(): void {
    this.phase = 'measure';
    this.clearPanel();
    const opts = this.params.lengthOptionsMm;
    const panel = document.createElement('div');
    panel.className = 'sb-panel sb-measure';
    panel.innerHTML = `<div class="sb-title">Tornillo ${this.idx + 1}/${this.holes.length} · agujero de ${fmt(this.depth())} mm</div>
      <div class="sb-measure-val">${fmt(this.depth())} <small>mm</small></div>
      <div class="sb-sub">Elige la longitud del tornillo (clic o teclas 1–${opts.length})</div>
      <div class="sb-opts"></div>`;
    const box = panel.querySelector('.sb-opts') as HTMLElement;
    opts.forEach((mm, i) => {
      const b = document.createElement('div');
      b.className = 'sb-opt';
      b.innerHTML = `<span class="sb-key">${i + 1}</span>${fmt(mm, mm % 1 ? 1 : 0)} mm`;
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.chooseLength(i);
      });
      box.appendChild(b);
    });
    this.layer().appendChild(panel);
    this.panel = panel;
  }

  /** Elige la opción de longitud i (tecla i+1). */
  chooseLength(i: number): void {
    if (this.phase !== 'measure') return;
    const opts = this.params.lengthOptionsMm;
    const len = opts[i];
    if (len === undefined) return;
    const j = judgeLength(len, this.depth(), opts);
    this.lengthMm = len;
    this.q.length = j.quality;
    this.ctx.audio.play(j.kind === 'miss' ? 'uiError' : 'uiClick');
    this.pop(j.text, this.hole(), j.kind);
    this.clearPanel();
    // Con el agujero medido, Fritz trae el tornillo de esa longitud.
    this.startCatch();
  }

  // ── (d) Apretar ──

  private startTighten(): void {
    this.phase = 'tighten';
    this.torque = 0;
    this.turning = false;
    this.ctx.selectInstrument('screwdriver');
  }

  private releaseTorque(): void {
    if (!this.turning) return;
    this.turning = false;
    const [lo, hi] = this.params.torqueWindow;
    const at = this.hole();
    if (this.torque < lo) {
      this.q.torque = 0.5;
      this.ctx.audio.play('miss', { volume: 0.6 });
      this.pop('Flojo', at, 'miss');
    } else if (this.torque <= hi) {
      this.q.torque = 1;
      this.ctx.audio.play('torqueClick');
      this.pop('¡Clic!', at, 'perfect');
    } else {
      this.q.torque = 0.65;
      this.ctx.audio.play('torqueClick', { pitch: 0.8 });
      this.pop('Apretado de más', at, 'good');
    }
    this.finishScrew(false);
  }

  private finishScrew(stripped: boolean): void {
    const at = { ...this.hole() };
    this.ctx.bone.implants.screws.push({ pos: at, lengthMm: this.lengthMm, contaminated: this.contaminated, stripped });
    if (this.contaminated) {
      this.ctx.log.fault('contaminatedImplant', 'Tornillo del suelo implantado');
      this.valerioOn('contaminatedImplant');
    }
    const q = clamp(0.2 * this.q.catch + 0.3 * this.q.pilot + 0.25 * this.q.length + 0.25 * this.q.torque, 0.05, 1);
    this.ctx.log.gesture(`Tornillo ${this.idx + 1}/${this.holes.length}`, q);
    this.placedFx = this.clock;
    this.pilot?.dispose();
    this.pilot = null;
    this.contaminated = false;
    this.q = { catch: 1, pilot: 1, length: 1, torque: 1 };
    this.idx++;
    if (this.idx >= this.holes.length) {
      this.phase = 'done';
      this.complete();
    } else {
      this.hover = { ...this.hole() };
      // Siguiente agujero: vuelta automática al taladro.
      this.pop(`Agujero ${this.idx + 1}/${this.holes.length}: ¡a taladrar!`, this.hole(), 'good');
      this.startPilot();
    }
  }

  // ── Entrada ──

  onPointerDown(p: WoundPointer): void {
    this.hover = p.mm;
    if (this.done || p.button !== 0) return;
    this.interacted = true;
    switch (this.phase) {
      case 'catch':
        this.catcher?.press();
        break;
      case 'pilot':
        if (this.pilot && !this.pilot.press(p)) this.pop('Taladra en la marca fucsia', p.mm, 'miss');
        break;
      case 'measure':
        this.pop(`Elige la longitud del tornillo (1–${this.params.lengthOptionsMm.length})`, p.mm, 'miss');
        break;
      case 'tighten':
        if (dist(p.mm, this.hole()) > this.tolMm() * 2) {
          this.pop('El destornillador va en el agujero', p.mm, 'miss');
          break;
        }
        this.turning = true;
        this.tickAcc = 0;
        break;
      default:
        break;
    }
  }

  onPointerMove(p: WoundPointer): void {
    this.hover = p.mm;
    if (this.phase === 'pilot' && this.pilot) {
      this.pilot.move(p);
      if (this.pilot && this.pilot.holding() && !(p.buttons & 1)) this.pilot.release();
    } else if (this.phase === 'tighten' && this.turning && !(p.buttons & 1)) {
      this.releaseTorque();
    }
  }

  onPointerUp(p: WoundPointer): void {
    this.hover = p.mm;
    if (p.buttons & 1) return;
    if (this.phase === 'pilot') this.pilot?.release();
    else if (this.phase === 'tighten') this.releaseTorque();
  }

  onKey(key: string, down: boolean): boolean {
    if (down && (key === 'Space' || key === 'KeyU' || key.startsWith('Digit'))) this.interacted = true;
    if (key === 'Space') {
      if (!down) return this.phase === 'catch' || this.phase === 'dropped';
      if (this.phase === 'catch') {
        this.catcher?.press();
        return true;
      }
      if (this.phase === 'dropped') {
        this.waitSpare();
        return true;
      }
      return false;
    }
    if (key === 'KeyU' && this.phase === 'dropped') {
      if (down) this.useFloorScrew();
      return true;
    }
    if (this.phase === 'measure' && key.startsWith('Digit')) {
      const i = Number(key.slice(5)) - 1;
      if (i < 0 || i >= this.params.lengthOptionsMm.length) return false;
      if (down) this.chooseLength(i);
      return true;
    }
    return false;
  }

  update(dt: number): void {
    this.clock += dt;
    if (this.waitingPlate) {
      this.resolveHoles();
      if (this.holes.length) {
        this.waitingPlate = false;
        this.startPilot();
      }
      return;
    }
    this.catcher?.update(dt);
    if (this.lingerIn >= 0) {
      this.lingerIn -= dt;
      if (this.lingerIn < 0) {
        const then = this.afterLinger;
        this.afterLinger = null;
        if (this.phase !== 'catch') this.disposeCatcher();
        then?.();
      }
    }
    switch (this.phase) {
      case 'waitSpare':
        this.spareLeft -= dt;
        if (this.panel) {
          const el = this.panel.querySelector('.sb-wait');
          if (el) el.textContent = `${Math.max(0, Math.ceil(this.spareLeft))} s`;
        }
        if (this.spareLeft <= 0) this.startCatch();
        break;
      case 'pilot':
        this.pilot?.update(dt);
        break;
      case 'tighten':
        if (this.turning) {
          this.torque = Math.min(1, this.torque + dt / TORQUE_RAMP_SEC);
          this.tickAcc += dt;
          if (this.tickAcc >= 0.11) {
            this.tickAcc = 0;
            this.ctx.audio.play('screwThread', { pitch: 0.8 + this.torque * 0.6, volume: 0.5 + this.torque * 0.4 });
          }
          if (this.torque >= 1) {
            this.turning = false;
            this.q.torque = 0.2;
            this.ctx.log.fault('strippedScrew', 'Torque excesivo');
            this.ctx.audio.play('crunch', { volume: 0.7, pitch: 1.6 });
            this.pop('¡Rosca pasada!', this.hole(), 'bad');
            this.valerioOn('strippedScrew');
            this.finishScrew(true);
          }
        }
        break;
      default:
        break;
    }
  }

  // ── Interfaz ──

  checklist(): ChecklistItem[] {
    const n = this.holes.length;
    return [{ label: `Tornillos (${Math.min(this.idx, n)}/${n})`, done: this.done }];
  }

  progress(): number {
    const n = this.holes.length;
    if (this.done) return 1;
    if (!n) return 0;
    let sub = 0;
    switch (this.phase) {
      case 'pilot':
        sub = this.pilot ? 0.4 * clamp(this.pilot.depth() / this.pilot.totalMm, 0, 1) : 0;
        break;
      case 'measure':
        sub = 0.45;
        break;
      case 'catch':
      case 'dropped':
      case 'waitSpare':
        sub = 0.55;
        break;
      case 'tighten':
        sub = 0.7 + 0.25 * this.torque;
        break;
      default:
        break;
    }
    return clamp((this.idx + sub) / n, 0, 1);
  }

  hint(): string {
    const n = this.holes.length;
    switch (this.phase) {
      case 'catch':
        return this.hintText(`Tornillo de ${fmt(this.lengthMm, this.lengthMm % 1 ? 1 : 0)} mm: Espacio o clic cuando el anillo toque el tornillo`);
      case 'dropped':
        return this.hintText('¡Se cayó! U: usar el del suelo (contaminado) · Espacio: esperar repuesto');
      case 'waitSpare':
        return this.hintText(`Esperando repuesto estéril… ${Math.max(0, Math.ceil(this.spareLeft))} s`);
      case 'pilot':
        if (this.waitingPlate) return this.hintText('Primero hay que colocar la placa');
        if (this.pilot?.phase() === 'breakthrough') return this.hintText('¡Salida! ¡Suelta ya!');
        if (this.pilot && this.pilot.heat() > PILOT_HOT_C) return this.hintText('¡Broca caliente! Suelta un momento para enfriar (rueda: menos presión)');
        return this.hintText(`Agujero ${this.idx + 1}/${n}: clic y mantén el taladro en la marca; suelta al sentir la salida`);
      case 'measure':
        return this.hintText(`Mide ${fmt(this.depth())} mm: elige la longitud con 1–${this.params.lengthOptionsMm.length}`);
      case 'tighten':
        return this.hintText('Mantén clic para atornillar y suelta en la zona verde del torque');
      default:
        return this.hintText('¡Tornillos listos!');
    }
  }

  gauges(): Gauge[] {
    const [lo, hi] = this.params.torqueWindow;
    switch (this.phase) {
      case 'pilot': {
        const h = this.pilot;
        const total = h?.totalMm ?? this.depth();
        return [
          { id: 'depth', label: 'Profundidad', value: h ? h.depth() : 0, min: 0, max: total, unit: 'mm' },
          { id: 'heat', label: 'Temperatura', value: clamp(h ? h.heat() : 37, 30, 70), min: 30, max: 70, unit: '°C', zones: HEAT_ZONES },
        ];
      }
      case 'measure':
        return [{ id: 'depth', label: 'Profundidad', value: this.depth(), min: 0, max: Math.max(...this.params.lengthOptionsMm, this.depth()), unit: 'mm' }];
      case 'tighten':
        return [
          {
            id: 'torque',
            label: 'Torque',
            value: this.torque,
            min: 0,
            max: 1,
            zones: [
              { from: 0, to: lo, kind: 'warn' },
              { from: lo, to: hi, kind: 'good' },
              { from: hi, to: 1, kind: 'bad' },
            ],
          },
        ];
      case 'catch':
        return [{ id: 'fritz', label: 'Temblor de Fritz', value: clamp(this.ctx.crew.fritz.tremor(), 0, 2), min: 0, max: 2 }];
      default:
        return [];
    }
  }

  protected onEnd(): void {
    this.disposeCatcher();
    this.clearPanel();
    this.pilot?.dispose();
    this.pilot = null;
    this.turning = false;
  }

  // ── Overlay ──

  private draw(g: CanvasRenderingContext2D, px: (p: Vec2) => Vec2, s: number, t: number): void {
    const level = this.ctx.guideLevel;
    this.holes.forEach((h, i) => {
      if (i < this.idx) return;
      drawSpotMarker(g, px(h), s, t, {
        level: i === this.idx ? (level === 'none' ? 'endpoints' : level) : level,
        active: i === this.idx,
        label: i === this.idx ? `T${i + 1}` : undefined,
        near: dist(this.hover, h) < 8,
      });
    });
    if (this.done || !this.holes.length) return;
    const c = px(this.hole());
    if (this.phase === 'pilot' && this.pilot) {
      drawDepthBar(g, px, s, this.pilot, t);
      drawHeatRing(g, c, Math.max(14, s * 3), this.pilot.heat());
    } else if (this.phase === 'tighten') {
      const [lo, hi] = this.params.torqueWindow;
      const r = Math.max(28, s * 5);
      const a0 = -Math.PI / 2;
      g.save();
      g.lineCap = 'round';
      g.lineWidth = 7;
      g.strokeStyle = 'rgba(59,33,70,0.45)';
      g.beginPath();
      g.arc(c.x, c.y, r, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = 'rgba(63,207,156,0.9)';
      g.beginPath();
      g.arc(c.x, c.y, r, a0 + lo * Math.PI * 2, a0 + hi * Math.PI * 2);
      g.stroke();
      g.lineWidth = 4;
      g.strokeStyle = this.torque > hi ? '#ff4d6d' : this.torque >= lo ? '#fff' : PALETTE.bubblegum;
      g.beginPath();
      g.arc(c.x, c.y, r - 7, a0, a0 + this.torque * Math.PI * 2);
      g.stroke();
      g.restore();
      drawTag(g, `${fmt(this.lengthMm, this.lengthMm % 1 ? 1 : 0)} mm · torque ${Math.round(this.torque * 100)}%`, c.x, c.y + r + 14, PALETTE.cream, 12);
    } else if (this.phase === 'dropped' || this.phase === 'waitSpare') {
      drawTag(g, this.phase === 'dropped' ? '¡Tornillo al suelo!' : 'Esperando repuesto…', c.x, c.y - s * 5, '#ff8fa3', 13);
    }
    if (this.placedFx >= 0 && this.clock - this.placedFx < 0.6 && this.idx > 0) {
      const k = (this.clock - this.placedFx) / 0.6;
      const q = px(this.holes[this.idx - 1]);
      g.save();
      g.globalAlpha = 1 - k;
      g.strokeStyle = PALETTE.gold;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(q.x, q.y, s * (2 + 6 * k), 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
  }
}

export const createScrewsStep = (def: StepDef) => new ScrewsStep(def);
