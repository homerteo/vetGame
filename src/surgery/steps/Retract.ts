import type { ChecklistItem, Gauge, InstrumentId, RetractParams, StepDef, Vec2, WoundPointer } from '../../core/contracts';
import { drawTargetMarker } from './markers';
import { clamp, dist } from '../../core/math';
import { StepA, guideAlpha, sayLine, scoreFault, scoreGesture } from './CauteryTool';

/** Radio de colocación de cada punta (mm). */
export const RETRACT_TIP_MM = 5;
/**
 * Overlay del separador que sigue puesto tras el paso (la herida sigue abierta).
 * Lo retira la sutura al empezar el cierre.
 */
export const RETRACTOR_OVERLAY_ID = 'retractor:persist';

const NAME = { gelpi: 'Gelpi', weitlaner: 'Weitlaner' } as const;

interface PairState {
  aPlaced: boolean;
  bPlaced: boolean;
  aErr: number;
  bErr: number;
  clicks: number;
  scored: boolean;
}

/** Separadores autoestáticos: dos puntas por par y apertura por clics de trinquete. */
export class RetractStep extends StepA<RetractParams> {
  readonly instruments: InstrumentId[];

  private pairs: PairState[] = [];
  private overFaulted = false;
  private hover = { x: -999, y: -999 };
  private list: ChecklistItem[] = [];
  private gOpen: Gauge = { id: 'retract-open', label: 'Apertura', value: 0, min: 0, max: 1, unit: 'clics', zones: [] };
  private gaugeList: Gauge[] = [this.gOpen];
  /** Animación de "mordida" del trinquete (s restantes). */
  private snap = 0;

  constructor(def: StepDef) {
    super(def);
    this.instruments = [(def.params as RetractParams).instrument];
  }

  protected onBegin(): void {
    const p = this.params;
    this.pairs = p.pairs.map(() => ({ aPlaced: false, bPlaced: false, aErr: 0, bErr: 0, clicks: 0, scored: false }));
    this.list = p.pairs.map((_, i) => ({
      label: p.pairs.length > 1 ? `Separador ${NAME[p.instrument]} ${i + 1}` : `Colocar ${NAME[p.instrument]} y abrir`,
      done: false,
    }));
    const max = p.maxClicks + 2;
    this.gOpen.max = max;
    this.gOpen.zones = [
      { from: 0, to: p.idealClicks, kind: 'warn' },
      { from: p.idealClicks, to: p.maxClicks, kind: 'good' },
      { from: p.maxClicks, to: max, kind: 'bad' },
    ];
    if (p.idealClicks === p.maxClicks) this.gOpen.zones[1] = { from: p.idealClicks - 0.5, to: p.maxClicks + 0.5, kind: 'good' };
    this.overlay({ id: `${this.def.id}:retract`, z: 42, draw: (g, px, ppm, t) => this.draw(g, px, ppm, t) });
  }

  private get tipTol(): number {
    return RETRACT_TIP_MM * this.tol;
  }

  /** Primer par sin las dos puntas colocadas (−1 si todos). */
  private placingIdx(): number {
    for (let i = 0; i < this.pairs.length; i++) if (!(this.pairs[i].aPlaced && this.pairs[i].bPlaced)) return i;
    return -1;
  }

  /** Último par ya colocado (−1 si ninguno). */
  private ratchetIdx(): number {
    let r = -1;
    for (let i = 0; i < this.pairs.length; i++) if (this.pairs[i].aPlaced && this.pairs[i].bPlaced) r = i;
    return r;
  }

  onPointerMove(p: WoundPointer): void {
    this.hover.x = p.mm.x;
    this.hover.y = p.mm.y;
  }

  onPointerDown(p: WoundPointer): void {
    if (this.done) return;
    this.hover.x = p.mm.x;
    this.hover.y = p.mm.y;
    const r = this.ratchetIdx();
    // Clic de rueda: siempre trinquete.
    if (p.button === 1) {
      if (r >= 0) this.ratchet(r, p.mm);
      return;
    }
    if (p.button !== 0) return;
    if (p.instrument !== this.params.instrument) {
      this.pop(`Usa el separador de ${NAME[this.params.instrument]}`, p.mm, 'miss', 'tool', 2);
      return;
    }
    const i = this.placingIdx();
    if (i >= 0 && this.tryPlace(i, p.mm)) return;
    // Trinquete sobre el último par colocado, salvo que ya esté listo y falte colocar otro.
    if (r >= 0 && (i < 0 || this.pairs[r].clicks < this.params.idealClicks)) {
      this.ratchet(r, p.mm);
      return;
    }
    if (i >= 0) {
      const any = this.pairs[i].aPlaced || this.pairs[i].bPlaced;
      this.pop(any ? 'Ahora la otra punta, en el borde opuesto' : 'Apoya la punta en el borde marcado', p.mm, 'miss', 'place', 1);
    }
  }

  private tryPlace(i: number, mm: Vec2): boolean {
    const pair = this.params.pairs[i];
    const st = this.pairs[i];
    const da = st.aPlaced ? Infinity : dist(mm, pair.a);
    const db = st.bPlaced ? Infinity : dist(mm, pair.b);
    const tol = this.tipTol;
    if (da > tol && db > tol) return false;
    if (da <= db) {
      st.aPlaced = true;
      st.aErr = da;
    } else {
      st.bPlaced = true;
      st.bErr = db;
    }
    this.ctx.audio.play('retractorClick', { volume: 0.6, pitch: 0.8 });
    this.ctx.audio.play('squelch', { volume: 0.35 });
    const both = st.aPlaced && st.bPlaced;
    this.pop(both ? '¡Separador puesto! Ahora abre (clic)' : 'Punta apoyada', mm, 'good');
    this.snap = 0.18;
    return true;
  }

  private ratchet(i: number, mm: Vec2): void {
    const st = this.pairs[i];
    const p = this.params;
    st.clicks++;
    this.snap = 0.18;
    this.ctx.audio.play('retractorClick', { pitch: 1 + 0.04 * st.clicks });
    this.ctx.audio.play('squelch', { volume: clamp(0.25 + 0.1 * st.clicks, 0, 1) });
    this.applyRetraction();
    const mid = { x: (p.pairs[i].a.x + p.pairs[i].b.x) / 2, y: (p.pairs[i].a.y + p.pairs[i].b.y) / 2 };
    if (st.clicks > p.maxClicks) {
      if (!this.overFaulted) {
        this.overFaulted = true;
        this.ctx.emiliana.stress(10, 'Separó de más');
        scoreFault(this.ctx, 'overRetraction', mid, '¡Sufrimiento muscular!');
      } else {
        this.pop('¡Basta de abrir!', mm, 'bad', 'over', 1);
      }
    } else if (st.clicks === p.idealClicks) {
      this.pop(`Clic ${st.clicks}/${p.idealClicks}: ¡exposición ideal!`, mm, 'good');
    } else {
      this.pop(`Clic ${st.clicks}/${p.idealClicks}`, mm, st.clicks > p.idealClicks ? 'miss' : 'good');
    }
    if (st.clicks >= p.idealClicks && !st.scored) {
      st.scored = true;
      this.list[i].done = true;
      // Calidad por precisión de colocación de las puntas.
      const meanErr = (st.aErr + st.bErr) / 2;
      const q = clamp(1 - (meanErr / this.tipTol) * 0.6, 0, 1);
      scoreGesture(this.ctx, `Separador ${NAME[p.instrument]}`, q, mid);
      if (this.pairs.every((s) => s.clicks >= p.idealClicks)) {
        sayLine(this.ctx, 'rodrigo', this.ctx.dialogue.rodrigo.groove, 0.35);
        this.complete();
      }
    }
  }

  private applyRetraction(): void {
    const ideal = Math.max(1, this.params.idealClicks);
    let s = 0;
    for (const st of this.pairs) s += st.clicks / ideal;
    this.ctx.wound.setRetraction(clamp(s / Math.max(1, this.pairs.length), 0, 1));
  }

  update(dt: number): void {
    if (this.snap > 0) this.snap = Math.max(0, this.snap - dt);
    const r = this.ratchetIdx();
    const i = r >= 0 ? r : 0;
    this.gOpen.value = this.pairs[i]?.clicks ?? 0;
  }

  private draw(g: CanvasRenderingContext2D, px: (p: Vec2) => Vec2, ppm: number, t: number): void {
    const p = this.params;
    const placing = this.placingIdx();
    for (let i = 0; i < p.pairs.length; i++) {
      const pair = p.pairs[i];
      const st = this.pairs[i];
      if (st.aPlaced && st.bPlaced) {
        this.drawRetractor(g, px, ppm, pair.a, pair.b, st.clicks, t);
        continue;
      }
      // Marcadores de dónde apoyar las puntas.
      if (i !== placing || this.done) continue;
      const lvl = this.ctx.guideLevel;
      for (const which of ['a', 'b'] as const) {
        const placed = which === 'a' ? st.aPlaced : st.bPlaced;
        const tipPos = pair[which];
        if (placed) {
          this.drawTip(g, tipPos, which === 'a' ? pair.b : pair.a, ppm, px);
          continue;
        }
        // La punta que toca ahora va en fucsia y numerada; la otra, en blanco.
        const next = which === 'a' ? true : st.aPlaced;
        drawTargetMarker(g, px(tipPos), ppm, t + (which === 'a' ? 0 : 0.5), {
          level: lvl,
          label: which === 'a' ? '1' : '2',
          active: next,
          near: dist(this.hover, tipPos) < 8,
        });
      }
      if (this.ctx.guideLevel === 'full') {
        const a = px(pair.a);
        const b = px(pair.b);
        g.strokeStyle = 'rgba(159,240,208,0.5)';
        g.setLineDash([ppm, ppm]);
        g.lineWidth = Math.max(1, ppm * 0.25);
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.stroke();
        g.setLineDash([]);
      }
    }
  }

  /** Ejes del separador para un par: u (a→b), n (perpendicular hacia arriba) y pivote. */
  private frame(a: Vec2, b: Vec2) {
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ux = (b.x - a.x) / l;
    const uy = (b.y - a.y) / l;
    let nx = -uy;
    let ny = ux;
    if (ny > 0 || (ny === 0 && nx > 0)) {
      nx = -nx;
      ny = -ny;
    }
    const pivot = { x: (a.x + b.x) / 2 + nx * 16, y: (a.y + b.y) / 2 + ny * 16 };
    return { l, ux, uy, nx, ny, pivot };
  }

  /** Brazo suelto apoyado (antes de tener el par completo): de la punta hacia el pivote. */
  private drawTip(g: CanvasRenderingContext2D, tip: Vec2, other: Vec2, ppm: number, px: (p: Vec2) => Vec2): void {
    const fr = this.frame(tip, other);
    const T = px(tip);
    const P = px(fr.pivot);
    g.lineCap = 'round';
    for (const [col, w] of [
      ['rgba(93,105,117,0.85)', 1.5],
      ['rgba(223,231,239,0.9)', 0.8],
    ] as const) {
      g.strokeStyle = col;
      g.lineWidth = ppm * w;
      g.beginPath();
      g.moveTo(T.x, T.y);
      g.quadraticCurveTo((T.x + P.x) / 2 + fr.nx * ppm * 3, (T.y + P.y) / 2 + fr.ny * ppm * 3, P.x, P.y);
      g.stroke();
    }
  }

  /** Dibuja el separador: dos brazos, pivote, trinquete y anillas rosas. */
  private drawRetractor(
    g: CanvasRenderingContext2D,
    px: (p: Vec2) => Vec2,
    ppm: number,
    a: Vec2,
    b: Vec2,
    clicks: number,
    t: number,
  ): void {
    const { l, ux, uy, nx, ny, pivot } = this.frame(a, b);
    const spread = Math.min(clicks, this.params.maxClicks + 2) * 0.55;
    const snapK = this.snap > 0 ? Math.sin((this.snap / 0.18) * Math.PI) * 0.25 : 0;
    const ta = { x: a.x - ux * (spread + snapK), y: a.y - uy * (spread + snapK) };
    const tb = { x: b.x + ux * (spread + snapK), y: b.y + uy * (spread + snapK) };
    const handleLen = 13;
    // Los brazos se cruzan en el pivote (tijera): la punta A acaba en el mango del lado B.
    const ha = { x: pivot.x + nx * handleLen + ux * (l * 0.35 + spread), y: pivot.y + ny * handleLen + uy * (l * 0.35 + spread) };
    const hb = { x: pivot.x + nx * handleLen - ux * (l * 0.35 + spread), y: pivot.y + ny * handleLen - uy * (l * 0.35 + spread) };
    const P = px(pivot);
    const A = px(ta);
    const B = px(tb);
    const HA = px(ha);
    const HB = px(hb);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const arm = (from: Vec2, to: Vec2) => {
      g.beginPath();
      g.moveTo(from.x, from.y);
      g.quadraticCurveTo((from.x + P.x) / 2 + nx * ppm * 3, (from.y + P.y) / 2 + ny * ppm * 3, P.x, P.y);
      g.lineTo(to.x, to.y);
    };
    // Sombra suave.
    g.strokeStyle = 'rgba(40,20,50,0.28)';
    g.lineWidth = ppm * 1.9;
    g.save();
    g.translate(ppm * 0.6, ppm * 0.8);
    arm(A, HA);
    g.stroke();
    arm(B, HB);
    g.stroke();
    g.restore();
    // Acero.
    for (const [from, to] of [
      [A, HA],
      [B, HB],
    ] as const) {
      g.strokeStyle = '#5d6975';
      g.lineWidth = ppm * 1.5;
      arm(from, to);
      g.stroke();
      g.strokeStyle = '#dfe7ef';
      g.lineWidth = ppm * 0.9;
      arm(from, to);
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.8)';
      g.lineWidth = ppm * 0.3;
      arm(from, to);
      g.stroke();
    }
    // Puntas: Gelpi (gancho único), Weitlaner (rastrillo de 3 dientes).
    const rake = this.params.instrument === 'weitlaner';
    for (const [T, sgn] of [
      [A, -1],
      [B, 1],
    ] as const) {
      g.strokeStyle = '#5d6975';
      g.lineWidth = ppm * 0.55;
      const n = rake ? 3 : 1;
      for (let k = 0; k < n; k++) {
        const off = rake ? (k - 1) * ppm * 1.6 : 0;
        const bx = T.x - uy * off;
        const by = T.y + ux * off;
        g.beginPath();
        g.moveTo(bx, by);
        g.lineTo(bx + ux * sgn * ppm * 2.2 - nx * ppm * 1.4, by + uy * sgn * ppm * 2.2 - ny * ppm * 1.4);
        g.stroke();
      }
    }
    // Trinquete: barra dentada entre los mangos, con los clics marcados.
    const q0x = P.x + (HA.x - P.x) * 0.72;
    const q0y = P.y + (HA.y - P.y) * 0.72;
    const q2x = P.x + (HB.x - P.x) * 0.72;
    const q2y = P.y + (HB.y - P.y) * 0.72;
    const cx = (q0x + q2x) / 2 + nx * ppm * 2.5;
    const cy = (q0y + q2y) / 2 + ny * ppm * 2.5;
    for (const [col, w] of [
      ['#5d6975', 1.3],
      ['#c7d0da', 0.6],
    ] as const) {
      g.strokeStyle = col;
      g.lineWidth = ppm * w;
      g.beginPath();
      g.moveTo(q0x, q0y);
      g.quadraticCurveTo(cx, cy, q2x, q2y);
      g.stroke();
    }
    const teeth = this.params.maxClicks + 2;
    for (let k = 0; k < teeth; k++) {
      const f = (k + 0.5) / teeth;
      const x = (1 - f) * (1 - f) * q0x + 2 * (1 - f) * f * cx + f * f * q2x;
      const y = (1 - f) * (1 - f) * q0y + 2 * (1 - f) * f * cy + f * f * q2y;
      const lit = k < clicks;
      const over = k >= this.params.maxClicks;
      g.fillStyle = lit ? (over ? '#ff4d6d' : k >= this.params.idealClicks - 1 ? '#3fcf9c' : '#f5c542') : '#7a8692';
      g.beginPath();
      g.arc(x, y, ppm * (lit ? 0.85 : 0.6), 0, Math.PI * 2);
      g.fill();
    }
    // Pivote con tornillo.
    g.fillStyle = '#b8c3cf';
    g.beginPath();
    g.arc(P.x, P.y, ppm * 1.3, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#5d6975';
    g.lineWidth = ppm * 0.3;
    g.stroke();
    // Anillas rosa chicle (kawaii) en los mangos.
    const glow = 0.5 + 0.5 * Math.sin(t * 3);
    for (const H of [HA, HB]) {
      g.strokeStyle = '#ff8fc7';
      g.lineWidth = ppm * 0.9;
      g.beginPath();
      g.ellipse(H.x + nx * ppm * 2.4, H.y + ny * ppm * 2.4, ppm * 2.2, ppm * 1.7, Math.atan2(uy, ux), 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = `rgba(255,255,255,${0.35 + 0.3 * glow})`;
      g.lineWidth = ppm * 0.3;
      g.stroke();
    }
  }

  /** El separador se queda puesto (y la herida abierta) hasta el cierre. */
  protected onEnd(): void {
    this.snap = 0;
    if (!this.pairs.some((st) => st.aPlaced && st.bPlaced)) return;
    this.ctx.wound.removeOverlay(RETRACTOR_OVERLAY_ID);
    this.ctx.wound.addOverlay({
      id: RETRACTOR_OVERLAY_ID,
      z: 42,
      draw: (g, px, ppm, t) => {
        const p = this.params;
        for (let i = 0; i < p.pairs.length; i++) {
          const st = this.pairs[i];
          if (st.aPlaced && st.bPlaced) this.drawRetractor(g, px, ppm, p.pairs[i].a, p.pairs[i].b, st.clicks, t);
        }
      },
    });
  }

  checklist(): ChecklistItem[] {
    return this.list;
  }

  progress(): number {
    if (this.done) return 1;
    const ideal = Math.max(1, this.params.idealClicks);
    let s = 0;
    for (const st of this.pairs) s += ((st.aPlaced ? 1 : 0) + (st.bPlaced ? 1 : 0)) * 0.15 + Math.min(1, st.clicks / ideal) * 0.7;
    return clamp(s / Math.max(1, this.pairs.length), 0, 1);
  }

  protected baseHint(): string {
    const name = NAME[this.params.instrument];
    const i = this.placingIdx();
    const r = this.ratchetIdx();
    if (r >= 0 && this.pairs[r].clicks < this.params.idealClicks && (i < 0 || i > r)) {
      const c = this.pairs[r].clicks;
      return `Abre el ${name}: clic izq. o clic de rueda (${c}/${this.params.idealClicks}). ¡Sin pasarte!`;
    }
    if (i >= 0) {
      const st = this.pairs[i];
      if (st.aPlaced || st.bPlaced) return `Clic izq. en el borde opuesto para la otra punta del ${name}.`;
      return `Clic izq. en un borde marcado para apoyar la punta del ${name}.`;
    }
    return 'Exposición lista. Nada de abrir más: el músculo también tiene sentimientos.';
  }

  gauges(): Gauge[] {
    return this.gaugeList;
  }
}
