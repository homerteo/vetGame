import type {
  ChecklistItem,
  Gauge,
  InstrumentId,
  PlateOption,
  PlateParams,
  Pose2,
  StepDef,
  Vec2,
  WoundPointer,
} from '../../core/contracts';
import { PALETTE } from '../../core/constants';
import { angleDiff, applyPose, clamp, dist } from '../../core/math';
import { BoneStep, drawTag, fmt } from './drilling';
import '../minigames/screwcatch.css';

export type PlatePhase = 'choose' | 'contour' | 'position' | 'done';

/** Coste de una placa desperdiciada (HC). */
export const WRONG_PLATE_HC = 60;
/** Giro de la placa con Q/E (°/s). */
export const PLATE_ROT_DEG_S = 45;
/** Ancho base de la zona verde del contorneado (fracción de la barra). */
export const BEND_ZONE = 0.16;

/** Onda triangular 0..1..0. */
const tri = (x: number) => {
  const f = x - Math.floor(x);
  return f < 0.5 ? f * 2 : 2 - f * 2;
};

/**
 * ¿La opción es una placa híbrida (agujeros de dos tamaños)? Se deduce de la propia
 * opción, nunca de la respuesta correcta, para que el dibujo no delate cuál es.
 */
export function isHybridOption(opt: PlateOption): boolean {
  return /h[ií]brida|\d,\d\/\d,\d/i.test(opt.label);
}

/** SVG de una placa para las tarjetas de elección. */
function plateSvg(opt: PlateOption, hybrid: boolean): string {
  const w = Math.round(clamp(46 + opt.lengthMm * 1.7, 60, 156));
  const h = 22;
  const n = Math.max(1, opt.holes);
  const holes: string[] = [];
  for (let i = 0; i < n; i++) {
    const x = 10 + ((w - 20) * (n === 1 ? 0.5 : i / (n - 1)));
    const r = hybrid && i >= n / 2 ? 3 : 4;
    holes.push(`<circle cx="${x.toFixed(1)}" cy="${h / 2 + 4}" r="${r}" fill="#4a3d63" stroke="#d8d4ee" stroke-width="1.5"/>`);
  }
  return `<svg width="${w + 8}" height="${h + 12}" viewBox="-4 0 ${w + 8} ${h + 12}" aria-hidden="true">
    <defs><linearGradient id="sbSteel${opt.id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f7f6ff"/><stop offset=".5" stop-color="#b9b6cf"/><stop offset="1" stop-color="#e9e7f5"/>
    </linearGradient></defs>
    <rect x="0" y="4" width="${w}" height="${h}" rx="${h / 2}" fill="url(#sbSteel${opt.id})" stroke="#6d5c8f" stroke-width="2"/>
    ${holes.join('')}
  </svg>`;
}

/**
 * Placa bloqueada: elegir la opción correcta (tarjetas DOM), contornearla con la dobladora
 * (indicador oscilante) y posicionarla sobre el hueso (Q/E giran, clic coloca).
 */
export class PlateStep extends BoneStep<PlateParams> {
  readonly instruments: InstrumentId[] = ['plate'];
  private phase: PlatePhase = 'choose';
  private panel: HTMLElement | null = null;
  private wasted = new Set<string>();
  private wrongPicks = 0;
  private switchIn = -1;
  // Contorneado.
  private bends = 0;
  private misses = 0;
  private osc = 0;
  private zoneC = 0.5;
  private lastAttempt = -10;
  private needleEl: HTMLElement | null = null;
  private zoneEl: HTMLElement | null = null;
  private gaugeEl: HTMLElement | null = null;
  // Posicionado.
  private hover: Vec2 = { x: 0, y: 0 };
  private angle = 0;
  private qHeld = false;
  private eHeld = false;
  private attempts = 0;
  private clock = 0;
  private placedFx = -1;

  protected onBegin(): void {
    const p = this.params;
    this.hover = { x: p.target.pos.x + 18, y: p.target.pos.y - 10 };
    this.angle = p.target.angleDeg + (this.ctx.rng() < 0.5 ? -1 : 1) * (18 + this.ctx.rng() * 14);
    this.overlay({ id: `plate:${this.def.id}`, z: 42, draw: (g, px, s, t) => this.draw(g, px, s, t) });
    this.buildChoose();
  }

  /** Fase actual (para pruebas y la página dev). */
  currentPhase(): PlatePhase {
    return this.phase;
  }

  /** Posición del indicador 0..1 y la zona verde (para pruebas). */
  bendState(): { needle: number; zoneCenter: number; zoneWidth: number; bends: number; misses: number } {
    return { needle: tri(this.osc), zoneCenter: this.zoneC, zoneWidth: this.zoneWidth(), bends: this.bends, misses: this.misses };
  }

  /** Pose de la placa que sigue al puntero (fase de posicionado). */
  previewPose(): Pose2 {
    return { pos: { ...this.hover }, angleDeg: this.angle };
  }

  private zoneWidth() {
    return BEND_ZONE * this.tolScale;
  }

  // ── (1) Elegir ──

  private layer(): HTMLElement {
    return this.ctx.hud.minigameLayer();
  }

  private clearPanel(): void {
    this.panel?.remove();
    this.panel = null;
    this.needleEl = this.zoneEl = this.gaugeEl = null;
  }

  private buildChoose(): void {
    const p = this.params;
    const panel = document.createElement('div');
    panel.className = 'sb-panel sb-plate-choose';
    const n = p.options.length;
    panel.innerHTML = `<div class="sb-title">Fritz trae ${n === 3 ? 'tres' : n} placas</div>
      <div class="sb-sub">¿Cuál encaja en el hueso? Clic o teclas <span class="sb-key">1</span>–<span class="sb-key">${n}</span></div>
      <div class="sb-cards"></div>`;
    const cards = panel.querySelector('.sb-cards') as HTMLElement;
    p.options.forEach((opt, i) => {
      const card = document.createElement('div');
      card.className = 'sb-card';
      card.dataset.id = opt.id;
      card.innerHTML = `<span class="sb-key">${i + 1}</span>${plateSvg(opt, isHybridOption(opt))}
        <b>${opt.label}</b><small>${opt.holes} agujeros · ${fmt(opt.lengthMm, 0)} mm</small>`;
      card.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.choose(opt.id);
      });
      cards.appendChild(card);
    });
    this.layer().appendChild(panel);
    this.panel = panel;
  }

  /** Elige una opción de placa (clic o tecla). */
  choose(id: string): void {
    if (this.phase !== 'choose' || this.switchIn >= 0 || this.wasted.has(id)) return;
    const p = this.params;
    this.interacted = true;
    const card = this.panel?.querySelector(`.sb-card[data-id="${id}"]`) as HTMLElement | null;
    if (id !== p.correctId) {
      this.wasted.add(id);
      this.wrongPicks++;
      this.ctx.log.fault('wrongPlate', `Placa equivocada: ${id}`);
      this.ctx.addCost(WRONG_PLATE_HC, 'Placa desperdiciada');
      this.ctx.audio.play('uiError');
      this.pop('Placa equivocada', p.target.pos, 'bad');
      this.valerioOn('wrongPlate');
      if (card) {
        card.classList.add('sb-wasted', 'sb-shake');
        const st = document.createElement('div');
        st.className = 'sb-stamp';
        st.textContent = `DESPERDICIADA −${WRONG_PLATE_HC} HC`;
        card.appendChild(st);
      }
      return;
    }
    card?.classList.add('sb-picked');
    this.ctx.crew.fritz.presentItem('plate');
    this.ctx.audio.play('good');
    this.ctx.log.gesture('Elección de placa', this.wrongPicks === 0 ? 1 : clamp(0.7 - 0.2 * (this.wrongPicks - 1), 0.2, 1));
    this.pop('¡Esa es!', p.target.pos, 'good');
    this.switchIn = 0.45;
  }

  // ── (2) Contornear ──

  private buildContour(): void {
    this.clearPanel();
    this.phase = 'contour';
    const need = this.params.bendsRequired;
    const panel = document.createElement('div');
    panel.className = 'sb-panel sb-plate-contour';
    panel.innerHTML = `<div class="sb-title">Contornea la placa</div>
      <div class="sb-sub"><span class="sb-key">Espacio</span> o clic cuando el corazón esté en la zona verde</div>
      <svg class="sb-bendplate" width="300" height="46" viewBox="0 0 300 46" aria-hidden="true">
        <path d="M20 26 Q150 26 280 26" fill="none" stroke="#6d5c8f" stroke-width="16" stroke-linecap="round"/>
        <path d="M20 26 Q150 26 280 26" fill="none" stroke="#dcd9ee" stroke-width="11" stroke-linecap="round"/>
      </svg>
      <div class="sb-gauge"><div class="sb-zone"></div><div class="sb-needle"></div></div>
      <div class="sb-beads">${'<span></span>'.repeat(need)}</div>`;
    this.gaugeEl = panel.querySelector('.sb-gauge');
    this.zoneEl = panel.querySelector('.sb-zone');
    this.needleEl = panel.querySelector('.sb-needle');
    this.gaugeEl?.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.attemptBend();
    });
    this.layer().appendChild(panel);
    this.panel = panel;
    this.newZone();
  }

  private newZone(): void {
    const w = this.zoneWidth();
    this.zoneC = clamp(0.2 + this.ctx.rng() * 0.6, w / 2 + 0.02, 1 - w / 2 - 0.02);
    if (this.zoneEl) {
      this.zoneEl.style.left = `${((this.zoneC - w / 2) * 100).toFixed(1)}%`;
      this.zoneEl.style.width = `${(w * 100).toFixed(1)}%`;
    }
  }

  private renderContour(): void {
    if (this.needleEl) this.needleEl.style.left = `${(tri(this.osc) * 100).toFixed(2)}%`;
  }

  private renderBend(): void {
    if (!this.panel) return;
    const need = this.params.bendsRequired;
    const beads = this.panel.querySelectorAll('.sb-beads span');
    beads.forEach((b, i) => b.classList.toggle('on', i < this.bends));
    const sag = (this.bends / Math.max(1, need)) * 16;
    const d = `M20 ${26 - sag * 0.2} Q150 ${26 + sag} 280 ${26 - sag * 0.2}`;
    this.panel.querySelectorAll('.sb-bendplate path').forEach((el) => el.setAttribute('d', d));
  }

  /** Intento de doblez (Espacio o clic). */
  attemptBend(): void {
    if (this.phase !== 'contour') return;
    if (this.clock - this.lastAttempt < 0.15) return;
    this.lastAttempt = this.clock;
    this.interacted = true;
    const x = tri(this.osc);
    const ok = Math.abs(x - this.zoneC) <= this.zoneWidth() / 2;
    const at = this.params.target.pos;
    if (ok) {
      this.bends++;
      this.ctx.audio.play('bendPlate');
      this.pop(this.bends >= this.params.bendsRequired ? '¡Contorno perfecto!' : '¡Doblez!', at, 'good');
      this.gaugeEl?.classList.remove('sb-flash-good');
      void this.gaugeEl?.offsetWidth;
      this.gaugeEl?.classList.add('sb-flash-good');
    } else {
      this.misses++;
      this.ctx.audio.play('miss');
      this.pop('Doblez torcido', at, 'miss');
      this.gaugeEl?.classList.remove('sb-flash-bad');
      void this.gaugeEl?.offsetWidth;
      this.gaugeEl?.classList.add('sb-flash-bad');
    }
    this.renderBend();
    if (this.bends >= this.params.bendsRequired) {
      const q = clamp(1 - this.misses * 0.15, 0.2, 1);
      this.ctx.log.gesture('Contorneado de placa', q);
      this.clearPanel();
      this.phase = 'position';
      this.ctx.selectInstrument('plate');
    } else {
      this.newZone();
    }
  }

  // ── (3) Posicionar ──

  private tolMm() {
    return this.params.tolMm * this.tolScale;
  }
  private tolDeg() {
    return this.params.tolDeg * this.tolScale;
  }

  private errors(): { mm: number; deg: number } {
    const t = this.params.target;
    return { mm: dist(this.hover, t.pos), deg: Math.abs(angleDiff(this.angle, t.angleDeg)) };
  }

  private place(): void {
    const p = this.params;
    this.attempts++;
    const err = this.errors();
    if (err.mm <= this.tolMm() && err.deg <= this.tolDeg()) {
      this.ctx.bone.implants.plate = {
        optionId: p.correctId,
        pose: { pos: { ...p.target.pos }, angleDeg: p.target.angleDeg },
        holesLocal: p.holes.map((h) => ({ ...h })),
        lengthMm: p.lengthMm,
        widthMm: p.widthMm,
        bend: clamp(1 - this.misses * 0.1, 0.5, 1),
        hybrid: p.hybrid,
      };
      this.ctx.audio.play('plateSet');
      const q = clamp(1 - 0.35 * (err.mm / this.tolMm()) - 0.25 * (err.deg / this.tolDeg()) - 0.1 * (this.attempts - 1), 0.1, 1);
      this.ctx.log.gesture('Posicionado de placa', q);
      this.pop(q >= 0.9 ? '¡Placa asentada perfecta!' : '¡Placa asentada!', p.target.pos, q >= 0.9 ? 'perfect' : 'good');
      this.placedFx = this.clock;
      this.phase = 'done';
      this.complete();
    } else {
      this.ctx.audio.play('uiError', { volume: 0.6 });
      const why = err.mm > this.tolMm() ? 'Desalineada' : 'Desalineada: gira con Q/E';
      this.pop(why, this.hover, 'miss');
    }
  }

  // ── Entrada ──

  onPointerDown(p: WoundPointer): void {
    this.hover = p.mm;
    if (this.done || p.button !== 0) return;
    if (this.phase === 'contour') this.attemptBend();
    else if (this.phase === 'position') {
      this.interacted = true;
      this.place();
    }
  }

  onPointerMove(p: WoundPointer): void {
    this.hover = p.mm;
  }

  onPointerUp(p: WoundPointer): void {
    this.hover = p.mm;
  }

  onKey(key: string, down: boolean): boolean {
    if (this.phase === 'choose' && key.startsWith('Digit')) {
      const i = Number(key.slice(5)) - 1;
      const opt = this.params.options[i];
      if (!opt) return false;
      if (down) this.choose(opt.id);
      return true;
    }
    if (this.phase === 'contour' && key === 'Space') {
      if (down) this.attemptBend();
      return true;
    }
    if (this.phase === 'position' && (key === 'KeyQ' || key === 'KeyE')) {
      if (down) this.interacted = true;
      if (key === 'KeyQ') this.qHeld = down;
      else this.eHeld = down;
      return true;
    }
    return false;
  }

  update(dt: number): void {
    this.clock += dt;
    if (this.switchIn >= 0) {
      this.switchIn -= dt;
      if (this.switchIn < 0) this.buildContour();
    }
    if (this.phase === 'contour') {
      this.osc += dt * (0.55 + 0.12 * this.bends);
      this.renderContour();
    } else if (this.phase === 'position') {
      const dir = (this.eHeld ? 1 : 0) - (this.qHeld ? 1 : 0);
      if (dir) this.angle += dir * PLATE_ROT_DEG_S * dt;
    }
  }

  // ── Interfaz ──

  checklist(): ChecklistItem[] {
    const need = this.params.bendsRequired;
    return [
      { label: 'Elegir la placa', done: this.phase !== 'choose' },
      { label: `Contornear (${Math.min(this.bends, need)}/${need})`, done: this.phase === 'position' || this.phase === 'done' },
      { label: 'Posicionar la placa', done: this.phase === 'done' },
    ];
  }

  progress(): number {
    if (this.done) return 1;
    if (this.phase === 'choose') return this.switchIn >= 0 ? 0.25 : 0;
    if (this.phase === 'contour') return 0.25 + 0.4 * (this.bends / Math.max(1, this.params.bendsRequired));
    const err = this.errors();
    return 0.65 + 0.3 * clamp(1 - err.mm / 20, 0, 1);
  }

  hint(): string {
    if (this.phase === 'choose') return this.hintText(`Elige la placa adecuada para este hueso: clic en la tarjeta o 1–${this.params.options.length}`);
    if (this.phase === 'contour') return this.hintText('Espacio o clic cuando el corazón pase por la zona verde');
    return this.hintText('Lleva la placa sobre el hueso, gira con Q/E y haz clic para asentarla');
  }

  gauges(): Gauge[] {
    if (this.phase === 'contour' || this.phase === 'choose') {
      const need = this.params.bendsRequired;
      return [{ id: 'bends', label: 'Dobleces', value: this.bends, min: 0, max: need }];
    }
    const e = this.errors();
    const tm = this.tolMm();
    const td = this.tolDeg();
    return [
      {
        id: 'plateMm',
        label: 'Desalineación',
        value: Math.min(e.mm, 20),
        min: 0,
        max: 20,
        unit: 'mm',
        zones: [
          { from: 0, to: tm, kind: 'good' },
          { from: tm, to: tm * 3, kind: 'warn' },
          { from: tm * 3, to: 20, kind: 'bad' },
        ],
      },
      {
        id: 'plateDeg',
        label: 'Ángulo',
        value: Math.min(e.deg, 45),
        min: 0,
        max: 45,
        unit: '°',
        zones: [
          { from: 0, to: td, kind: 'good' },
          { from: td, to: td * 3, kind: 'warn' },
          { from: td * 3, to: 45, kind: 'bad' },
        ],
      },
    ];
  }

  protected onEnd(): void {
    this.clearPanel();
    this.qHeld = this.eHeld = false;
  }

  // ── Overlay ──

  private drawPlate(g: CanvasRenderingContext2D, px: (p: Vec2) => Vec2, s: number, pose: Pose2, alpha: number, good: boolean): void {
    const p = this.params;
    const c = px(pose.pos);
    const L = p.lengthMm * s;
    const W = p.widthMm * s;
    g.save();
    g.globalAlpha = alpha;
    g.translate(c.x, c.y);
    g.rotate((pose.angleDeg * Math.PI) / 180);
    g.shadowColor = 'rgba(30,10,40,0.45)';
    g.shadowBlur = 8;
    g.shadowOffsetY = 3;
    const grad = g.createLinearGradient(0, -W / 2, 0, W / 2);
    grad.addColorStop(0, '#f7f6ff');
    grad.addColorStop(0.45, good ? '#c9f3e2' : '#bdb9d3');
    grad.addColorStop(1, '#e6e3f3');
    g.fillStyle = grad;
    g.beginPath();
    g.roundRect(-L / 2, -W / 2, L, W, W / 2);
    g.fill();
    g.shadowColor = 'transparent';
    g.strokeStyle = good ? PALETTE.mint : '#6d5c8f';
    g.lineWidth = 2;
    g.stroke();
    for (let i = 0; i < p.holes.length; i++) {
      const h = p.holes[i];
      const r = (p.hybrid && h.x > 0 ? 1.1 : 1.4) * s;
      g.fillStyle = '#3b2e52';
      g.beginPath();
      g.arc(h.x * s, h.y * s, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#d8d4ee';
      g.lineWidth = 1.5;
      g.stroke();
    }
    g.restore();
  }

  private draw(g: CanvasRenderingContext2D, px: (p: Vec2) => Vec2, s: number, t: number): void {
    const p = this.params;
    const level = this.ctx.guideLevel;
    if (this.phase === 'done') {
      if (this.placedFx >= 0 && this.clock - this.placedFx < 0.8) {
        const k = (this.clock - this.placedFx) / 0.8;
        const c = px(p.target.pos);
        g.save();
        g.globalAlpha = 1 - k;
        g.strokeStyle = PALETTE.mint;
        g.lineWidth = 4;
        g.beginPath();
        g.ellipse(c.x, c.y, (p.lengthMm / 2 + 4 + k * 10) * s, (p.widthMm / 2 + 4 + k * 6) * s, (p.target.angleDeg * Math.PI) / 180, 0, Math.PI * 2);
        g.stroke();
        g.restore();
      }
      return;
    }
    // Silueta objetivo según guía.
    const ends = [applyPose({ x: -p.lengthMm / 2, y: 0 }, p.target), applyPose({ x: p.lengthMm / 2, y: 0 }, p.target)];
    if (level === 'full') {
      const c = px(p.target.pos);
      g.save();
      g.translate(c.x, c.y);
      g.rotate((p.target.angleDeg * Math.PI) / 180);
      g.strokeStyle = PALETTE.mint;
      g.lineWidth = 2;
      g.setLineDash([6, 5]);
      g.lineDashOffset = -t * 10;
      g.beginPath();
      g.roundRect((-p.lengthMm / 2) * s, (-p.widthMm / 2) * s, p.lengthMm * s, p.widthMm * s, (p.widthMm / 2) * s);
      g.stroke();
      g.restore();
      if (this.phase !== 'position') drawTag(g, `zona de placa ≈ ${fmt(p.lengthMm, 0)} mm`, c.x, c.y - (p.widthMm / 2 + 4) * s, PALETTE.mint, 12);
    } else if (level === 'endpoints') {
      g.save();
      g.strokeStyle = PALETTE.mint;
      g.lineWidth = 3;
      for (const e of ends) {
        const q = px(e);
        g.beginPath();
        g.moveTo(q.x, q.y - p.widthMm * s * 0.8);
        g.lineTo(q.x, q.y + p.widthMm * s * 0.8);
        g.stroke();
      }
      g.restore();
    }
    if (this.phase === 'position') {
      const e = this.errors();
      const good = e.mm <= this.tolMm() && e.deg <= this.tolDeg();
      this.drawPlate(g, px, s, { pos: this.hover, angleDeg: this.angle }, 0.9, good);
      if (this.qHeld || this.eHeld) {
        const c = px(this.hover);
        drawTag(g, this.eHeld ? '↻' : '↺', c.x, c.y - p.widthMm * s - 6, PALETTE.mint, 18);
      }
    }
  }
}

export const createPlateStep = (def: StepDef) => new PlateStep(def);
