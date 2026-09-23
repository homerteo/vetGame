import type {
  FaultKind,
  LoopHandle,
  SpeakerId,
  StepParams,
  SurgeryContext,
  Vec2,
  WoundPointer,
} from '../../core/contracts';
import { BONE_NECROSIS_C, PALETTE } from '../../core/constants';
import { clamp, dist, distToSegment, pointInPolygon } from '../../core/math';
import { StepBase } from './StepBase';
import { drawTargetMarker } from './markers';

// ───────────────────────────── Utilidades comunes de los pasos B ─────────────────────────────

/** Temperatura corporal de partida del hueso (°C). */
export const BODY_C = 37;
/** Segundos por encima de 47 °C antes de la necrosis térmica. */
export const NECROSIS_HOLD_SEC = 1.5;
/** Techo físico de la temperatura del modelo (°C). */
export const HEAT_MAX_C = 75;
/** Longitud máxima de una pista. */
export const HINT_MAX = 90;

/** Recorta un texto a la longitud máxima de pista. */
export function clampHint(s: string): string {
  return s.length <= HINT_MAX ? s : s.slice(0, HINT_MAX - 1) + '…';
}

/** Formatea un número con coma decimal (es). */
export function fmt(v: number, decimals = 1): string {
  return v.toFixed(decimals).replace('.', ',');
}

/** Distancia de un punto al contorno de un polígono cerrado. */
export function distToPolygonEdge(p: Vec2, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const d = distToSegment(p, poly[j], poly[i]);
    if (d < best) best = d;
  }
  return best;
}

/** ¿Está el punto dentro del polígono o a menos de `margin` mm de su borde? */
export function nearPolygon(p: Vec2, poly: Vec2[], margin: number): boolean {
  if (poly.length < 3) return false;
  return pointInPolygon(p, poly) || distToPolygonEdge(p, poly) <= margin;
}

/** ¿Se solapan dos polígonos? (vértice dentro del otro, en ambos sentidos) */
export function polygonsOverlap(a: Vec2[], b: Vec2[]): boolean {
  for (const v of a) if (pointInPolygon(v, b)) return true;
  for (const v of b) if (pointInPolygon(v, a)) return true;
  return false;
}

/**
 * Base de los pasos óseos: tolerancias de tutorial, pistas, frases con enfriamiento,
 * faltas con límite de frecuencia y feedback flotante.
 */
export abstract class BoneStep<P extends StepParams> extends StepBase<P> {
  /** ×1,5 en el tutorial. */
  protected tolScale = 1;
  protected tutorial = false;
  /** El jugador ya tocó algo (oculta la pista de tutorial). */
  protected interacted = false;
  private sayAt = new Map<SpeakerId, number>();
  private faultAt = new Map<string, number>();

  begin(ctx: SurgeryContext): void {
    this.tutorial = !!ctx.caseDef.flags.tutorial;
    this.tolScale = this.tutorial ? 1.5 : 1;
    super.begin(ctx);
  }

  /** Texto flotante sobre un punto de la herida. */
  protected pop(text: string, mm: Vec2, kind: 'perfect' | 'good' | 'miss' | 'bad'): void {
    this.ctx.hud.popText(text, this.ctx.scene.project(mm), kind);
  }

  /** Frase de un personaje con enfriamiento por hablante (por defecto 8 s, GDD §9). */
  protected say(speaker: SpeakerId, lines: readonly string[] | string | undefined, minGapSec = 8, durationSec?: number): boolean {
    if (!lines || (Array.isArray(lines) && lines.length === 0)) return false;
    const now = this.ctx.now();
    const last = this.sayAt.get(speaker);
    if (last !== undefined && now - last < minGapSec) return false;
    const text = typeof lines === 'string' ? lines : lines[Math.floor(this.ctx.rng() * lines.length) % lines.length];
    if (!text) return false;
    this.sayAt.set(speaker, now);
    this.ctx.bus.emit('say', { speaker, text, durationSec });
    return true;
  }

  /** Comentario de Valerio para una falta (con enfriamiento). */
  protected valerioOn(kind: FaultKind): void {
    this.say('valerio', this.ctx.dialogue.valerio.fault[kind]);
  }

  /** Registra una falta si no se registró otra igual en los últimos `gapSec` segundos. */
  protected faultLimited(kind: FaultKind, gapSec: number, detail?: string, key: string = kind): boolean {
    const now = this.ctx.now();
    const last = this.faultAt.get(key);
    if (last !== undefined && now - last < gapSec) return false;
    this.faultAt.set(key, now);
    this.ctx.log.fault(kind, detail);
    return true;
  }

  /** Pista del tutorial hasta el primer gesto; luego la contextual. */
  protected hintText(contextual: string): string {
    if (this.tutorial && !this.interacted) {
      const h = this.ctx.dialogue.tutorialHints[this.def.params.type];
      if (h && h.length <= HINT_MAX) return h;
    }
    return clampHint(contextual);
  }
}

// ───────────────────────────── Calor óseo ─────────────────────────────

/** Modelo de temperatura del hueso con acumulación de tiempo sobre 47 °C. */
export class BoneHeat {
  c = BODY_C;
  peak = BODY_C;
  hotSec = 0;
  necrosis = false;

  /**
   * Integra `rise` (°C/s, puede ser negativo). Enfría hacia 37 °C con `cool` si rise ≤ 0.
   * Devuelve true el fotograma en que se produce la necrosis (una sola vez).
   */
  step(dt: number, rise: number, cool = 4): boolean {
    if (rise > 0) this.c = Math.min(HEAT_MAX_C, this.c + rise * dt);
    else this.c = Math.max(BODY_C, this.c - (cool - rise) * dt);
    if (this.c > this.peak) this.peak = this.c;
    if (this.c > BONE_NECROSIS_C) this.hotSec += dt;
    else this.hotSec = Math.max(0, this.hotSec - dt * 0.5);
    if (!this.necrosis && this.hotSec >= NECROSIS_HOLD_SEC) {
      this.necrosis = true;
      return true;
    }
    return false;
  }
}

/** Zonas del medidor de temperatura (30–70 °C). */
export const HEAT_ZONES: Array<{ from: number; to: number; kind: 'good' | 'warn' | 'bad' }> = [
  { from: 30, to: 42, kind: 'good' },
  { from: 42, to: 47, kind: 'warn' },
  { from: 47, to: 70, kind: 'bad' },
];

export function heatColor(c: number): string {
  return c < 42 ? '#3fcf9c' : c <= BONE_NECROSIS_C ? '#ffb347' : '#ff4d6d';
}

// ───────────────────────────── Taladro: un orificio ─────────────────────────────

export type DrillPhase = 'idle' | 'drilling' | 'breakthrough' | 'done';
export type DrillLayer = 'cis' | 'medulla' | 'trans' | 'out';

/** Resistencia por capa (multiplica la velocidad de avance). */
export const LAYER_FACTOR: Record<DrillLayer, number> = { cis: 0.35, medulla: 1.6, trans: 0.35, out: 1 };
/** °C por mm avanzado en cortical. */
const HEAT_PER_MM = 4.6;
/**
 * Calor que el hueso disipa incluso mientras se taladra cortical (°C/s). Hace que la
 * presión importe: con poca presión se avanza despacio y apenas se calienta; con mucha,
 * rápido y caliente.
 */
export const CORTEX_SINK_C_S = 2;
/** Enfriamiento cuando no se taladra cortical (°C/s). */
const DRILL_COOL = 5;
/** Hueso frágil: segundos seguidos en cortical con presión 3 antes de fisurar. */
export const FRAGILE_STRESS_SEC = 0.45;

export interface DrillHoleOptions {
  ctx: SurgeryContext;
  pos: Vec2;
  /** Tolerancia ya escalada (tutorial ×1,5). */
  tolMm: number;
  /** Grosor en mm de [cortical cis, médula, cortical trans]. */
  profileMm: [number, number, number];
  fragile?: boolean;
  tutorial?: boolean;
  onDone?(r: DrillHoleResult): void;
}

export interface DrillHoleResult {
  quality: number;
  plunged: boolean;
  necrosis: boolean;
  fissure: boolean;
  deviations: number;
  peakHeat: number;
  /** Segundos entre la salida y soltar (NaN si hubo plunge). */
  reactionSec: number;
}

export interface DrillHole {
  readonly pos: Vec2;
  readonly totalMm: number;
  readonly profileMm: [number, number, number];
  depth(): number;
  heat(): number;
  phase(): DrillPhase;
  layer(): DrillLayer;
  holding(): boolean;
  /** Empieza/continúa a taladrar. false si el puntero está lejos del orificio. */
  press(p: WoundPointer): boolean;
  move(p: WoundPointer): void;
  release(): void;
  update(dt: number): void;
  result(): DrillHoleResult | null;
  dispose(): void;
}

/** Ventana para soltar tras la salida por la segunda cortical. */
export function breakthroughWindow(tutorial: boolean): number {
  return tutorial ? 0.6 : 0.4;
}

/**
 * Máquina de estados de un orificio: avance por capas, calor, salida ("¡Salida!"),
 * plunge si no se suelta a tiempo, fisura en hueso frágil y broca desviada.
 */
export function createDrillHole(o: DrillHoleOptions): DrillHole {
  const { ctx } = o;
  const profile = o.profileMm;
  const total = profile[0] + profile[1] + profile[2];
  const window = breakthroughWindow(!!o.tutorial);
  const heat = new BoneHeat();
  let depth = 0;
  let phase: DrillPhase = 'idle';
  let isHolding = false;
  let pressure = 3;
  let bt = 0; // tiempo desde la salida
  let fissure = false;
  let deviations = 0;
  let plunged = false;
  let stress = 0; // hueso frágil: tiempo seguido en cortical con presión 3
  let creaked = false;
  let loop: LoopHandle | null = null;
  let res: DrillHoleResult | null = null;

  const layerAt = (d: number): DrillLayer =>
    d < profile[0] ? 'cis' : d < profile[0] + profile[1] ? 'medulla' : d < total ? 'trans' : 'out';

  const stopLoop = () => {
    loop?.stop();
    loop = null;
  };

  const finish = (plunge: boolean) => {
    phase = 'done';
    isHolding = false;
    plunged = plunge;
    stopLoop();
    let q = 1;
    if (plunge) q -= 0.5;
    if (heat.necrosis) q -= 0.35;
    if (fissure) q -= 0.3;
    q -= 0.12 * deviations;
    if (heat.peak > 42) q -= (Math.min(heat.peak, BONE_NECROSIS_C) - 42) / 5 * 0.15;
    if (!plunge && bt > window * 0.5) q -= 0.05;
    res = {
      quality: clamp(q, 0.05, 1),
      plunged: plunge,
      necrosis: heat.necrosis,
      fissure,
      deviations,
      peakHeat: heat.peak,
      reactionSec: plunge ? NaN : bt,
    };
    o.onDone?.(res);
  };

  return {
    pos: o.pos,
    totalMm: total,
    profileMm: profile,
    depth: () => depth,
    heat: () => heat.c,
    phase: () => phase,
    layer: () => layerAt(depth),
    holding: () => isHolding,
    press(p) {
      if (phase === 'done') return false;
      if (dist(p.mm, o.pos) > o.tolMm) return false;
      isHolding = true;
      pressure = clamp(p.pressure, 1, 5);
      if (phase === 'idle') phase = 'drilling';
      if (!loop) loop = ctx.audio.loop('drill');
      return true;
    },
    move(p) {
      pressure = clamp(p.pressure, 1, 5);
      if (!isHolding) return;
      if (dist(p.mm, o.pos) > 2 * o.tolMm) {
        if (phase === 'breakthrough') {
          // Sacar la broca tras la salida equivale a soltar.
          isHolding = false;
          finish(false);
          return;
        }
        isHolding = false;
        deviations++;
        stopLoop();
        phase = depth > 0 ? 'drilling' : 'idle';
        ctx.wound.addDecal('scratch', p.mm, { angleDeg: ctx.rng() * 180, sizeMm: 3 });
        ctx.audio.play('crunch', { volume: 0.4, pitch: 1.4 });
        ctx.hud.popText('Broca desviada', ctx.scene.project(p.mm), 'miss');
      }
    },
    release() {
      if (!isHolding) return;
      isHolding = false;
      stress = 0;
      creaked = false;
      if (phase === 'breakthrough') finish(false);
      else stopLoop();
    },
    update(dt) {
      if (phase === 'done') return;
      let rise = 0;
      let cool = DRILL_COOL;
      if (isHolding && phase === 'drilling') {
        const layer = layerAt(depth);
        const rate = (0.8 + 0.6 * pressure) * LAYER_FACTOR[layer];
        depth += rate * dt;
        if (layer === 'cis' || layer === 'trans') {
          rise = rate * HEAT_PER_MM * (pressure >= 4 ? 1.8 : 1) - CORTEX_SINK_C_S;
          cool = 0; // si el balance es negativo, enfría solo a ese ritmo (sin saltos)
          // Hueso frágil: presión ≥ 4 fisura al instante; presión 3 aguanta un momento
          // (cruje como aviso). Con 1–2 o a pulsos cortos no pasa nada.
          if (o.fragile && !fissure) {
            stress = pressure >= 3 ? stress + dt : 0;
            if (pressure >= 3 && !creaked && stress >= FRAGILE_STRESS_SEC * 0.5) {
              creaked = true;
              ctx.audio.play('crunch', { volume: 0.3, pitch: 2 });
              ctx.hud.popText('Cruje…', ctx.scene.project(o.pos), 'miss');
            }
            if (pressure >= 4 || stress >= FRAGILE_STRESS_SEC) {
              fissure = true;
              ctx.log.fault('iatrogenicFissure', 'Taladro con demasiada presión en hueso frágil');
              ctx.wound.addDecal('fissure', o.pos, { angleDeg: 90 + (ctx.rng() - 0.5) * 60, sizeMm: 6 });
              ctx.audio.play('crunch', { volume: 1, pitch: 0.7 });
              ctx.hud.popText('¡Fisura! Hueso frágil', ctx.scene.project(o.pos), 'bad');
            }
          }
        } else {
          rise = -1.5;
          stress = 0;
        }
        if (loop) {
          const cortex = layer !== 'medulla';
          loop.set('rate', cortex ? 0.55 + pressure * 0.04 : 0.85 + pressure * 0.03);
          loop.set('load', cortex ? 0.9 : 0.3);
        }
        if (depth >= total) {
          depth = total;
          phase = 'breakthrough';
          bt = 0;
          if (loop) {
            // Caída seca del tono al atravesar la segunda cortical.
            loop.set('rate', 0.25);
            loop.set('load', 0.05);
          }
          ctx.hud.popText('¡Salida!', ctx.scene.project(o.pos), 'good');
        }
      } else if (phase === 'breakthrough') {
        bt += dt;
        if (isHolding && bt > window) {
          ctx.log.fault('plunge', 'La broca atravesó de más');
          ctx.audio.play('crunch', { volume: 0.8, pitch: 0.6 });
          ctx.hud.popText('¡Plunge!', ctx.scene.project(o.pos), 'bad');
          finish(true);
          return;
        }
      }
      const necro = heat.step(dt, rise, cool);
      if (loop) loop.set('intensity', clamp((heat.c - 42) / 8, 0, 1));
      if (necro) {
        ctx.log.fault('thermalNecrosis', 'Broca a más de 47 °C');
        ctx.wound.addDecal('necrosis', o.pos, { sizeMm: 5 });
        ctx.hud.popText('¡Necrosis térmica!', ctx.scene.project(o.pos), 'bad');
      }
    },
    result: () => res,
    dispose() {
      stopLoop();
      isHolding = false;
    },
  };
}

// ───────────────────────────── Dibujo compartido de overlays ─────────────────────────────

type Px = (p: Vec2) => Vec2;

/** Anillo de calor (verde/ámbar/rojo) con marca en 47 °C (GDD §8). */
export function drawHeatRing(g: CanvasRenderingContext2D, c: Vec2, r: number, heatC: number): void {
  const lo = BODY_C;
  const hi = 60;
  const a0 = -Math.PI * 0.75;
  const span = Math.PI * 1.5;
  const f = clamp((heatC - lo) / (hi - lo), 0, 1);
  g.save();
  g.lineCap = 'round';
  g.lineWidth = Math.max(3, r * 0.22);
  g.strokeStyle = 'rgba(59,33,70,0.45)';
  g.beginPath();
  g.arc(c.x, c.y, r, a0, a0 + span);
  g.stroke();
  if (f > 0.001) {
    g.strokeStyle = heatColor(heatC);
    g.beginPath();
    g.arc(c.x, c.y, r, a0, a0 + span * f);
    g.stroke();
  }
  // Marca de 47 °C.
  const am = a0 + span * ((BONE_NECROSIS_C - lo) / (hi - lo));
  g.strokeStyle = '#fff';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(c.x + Math.cos(am) * (r - 6), c.y + Math.sin(am) * (r - 6));
  g.lineTo(c.x + Math.cos(am) * (r + 6), c.y + Math.sin(am) * (r + 6));
  g.stroke();
  g.font = `800 ${Math.round(Math.max(10, r * 0.55))}px Nunito, system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(59,33,70,0.8)';
  const label = `${Math.round(heatC)}°`;
  g.strokeText(label, c.x, c.y + r + 12);
  g.fillStyle = heatColor(heatC);
  g.fillText(label, c.x, c.y + r + 12);
  g.restore();
}

/** Barra vertical de profundidad con las corticales y la médula, junto a un orificio. */
export function drawDepthBar(g: CanvasRenderingContext2D, px: Px, pxPerMm: number, hole: DrillHole, t: number): void {
  const c = px(hole.pos);
  const h = 70;
  const w = 12;
  const x = c.x + Math.max(22, pxPerMm * 4);
  const y = c.y - h / 2;
  const [a, m] = hole.profileMm;
  const total = hole.totalMm;
  g.save();
  g.fillStyle = 'rgba(255,246,251,0.92)';
  g.strokeStyle = PALETTE.lilac;
  g.lineWidth = 2;
  roundRect(g, x - 4, y - 16, w + 8, h + 32, 8);
  g.fill();
  g.stroke();
  const cy = (d: number) => y + (d / total) * h;
  g.fillStyle = '#f3e6c8';
  g.fillRect(x, y, w, cy(a) - y);
  g.fillStyle = '#c96a6a';
  g.fillRect(x, cy(a), w, cy(a + m) - cy(a));
  g.fillStyle = '#f3e6c8';
  g.fillRect(x, cy(a + m), w, y + h - cy(a + m));
  // Avance de la broca.
  const dy = cy(hole.depth());
  g.fillStyle = 'rgba(255,46,147,0.35)';
  g.fillRect(x, y, w, dy - y);
  g.strokeStyle = PALETTE.fuchsia;
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(x - 4, dy);
  g.lineTo(x + w + 4, dy);
  g.stroke();
  // Marca de salida.
  const blink = hole.phase() === 'breakthrough' ? 0.5 + 0.5 * Math.sin(t * 30) : 1;
  g.fillStyle = `rgba(255,77,109,${blink})`;
  g.font = '800 10px Nunito, system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText('SALIDA', x + w / 2, y + h + 12);
  g.fillStyle = PALETTE.ink;
  g.fillText(`${fmt(hole.depth())}`, x + w / 2, y - 6);
  g.restore();
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

/** Marcador de objetivo: delega en el marcador común de alto contraste (markers.ts). */
export function drawSpotMarker(
  g: CanvasRenderingContext2D,
  c: Vec2,
  pxPerMm: number,
  t: number,
  opts: { level: 'full' | 'endpoints' | 'none'; label?: string; active?: boolean; done?: boolean; near?: boolean },
): void {
  drawTargetMarker(g, c, pxPerMm, t, opts);
}

/** Texto con contorno para overlays. */
export function drawTag(g: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, size = 13): void {
  g.save();
  g.font = `800 ${size}px Nunito, system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 4;
  g.strokeStyle = 'rgba(59,33,70,0.85)';
  g.strokeText(text, x, y);
  g.fillStyle = color;
  g.fillText(text, x, y);
  g.restore();
}
