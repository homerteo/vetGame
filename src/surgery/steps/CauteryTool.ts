import type {
  Bleeder,
  BleedType,
  FaultKind,
  Gauge,
  InstrumentId,
  LoopHandle,
  LoopSfxName,
  SpeakerId,
  StepParams,
  SurgeryContext,
  TissueLayer,
  UniversalTool,
  Vec2,
  WoundOverlay,
  WoundPointer,
} from '../../core/contracts';
import { clamp, dist } from '../../core/math';
import { StepBase } from './StepBase';

/*
 * CauteryTool.ts — electrocauterio universal + utilidades comunes de los pasos A.
 * Las utilidades viven aquí porque el cauterio es la pieza que comparten todos los pasos
 * (y así no dependemos de archivos ajenos).
 */

// ───────────────────────────── Utilidades comunes ─────────────────────────────

export const LAYER_NAME: Record<TissueLayer, string> = {
  skin: 'piel',
  subcut: 'tejido subcutáneo',
  fascia: 'fascia',
  muscle: 'músculo',
  bone: 'hueso',
};

export const BLEED_NAME: Record<BleedType, string> = {
  capillary: 'capilar',
  venous: 'venoso',
  arterial: 'arterial',
};

/** Instrumentos con filo o punta: fallar con ellos raya el tejido. */
export const SHARP_INSTRUMENTS: ReadonlySet<InstrumentId> = new Set<InstrumentId>([
  'scalpel10',
  'scalpel15',
  'kwire',
  'drill',
  'saw',
  'burr',
  'rasp',
]);

export const MAX_HINT = 90;

/** Recorta un texto a 90 caracteres (límite del HUD). */
export function clipHint(s: string): string {
  return s.length <= MAX_HINT ? s : s.slice(0, MAX_HINT - 1).trimEnd() + '…';
}

/** Resultado reutilizable de signedDistToPolyline (evita asignaciones por movimiento). */
export interface SignedHit {
  /** Distancia con signo (positiva a la izquierda del sentido del trazado). */
  d: number;
  /** Longitud recorrida hasta el punto más cercano (mm). */
  s: number;
  x: number;
  y: number;
}

/** Distancia con signo a una polilínea y longitud de arco del punto más cercano. */
export function signedDistToPolyline(p: Vec2, path: Vec2[], out: SignedHit): SignedHit {
  let best = Infinity;
  let acc = 0;
  out.d = 0;
  out.s = 0;
  out.x = path[0]?.x ?? 0;
  out.y = path[0]?.y ?? 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const l2 = abx * abx + aby * aby;
    const segLen = Math.sqrt(l2);
    const t = l2 < 1e-12 ? 0 : clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / l2, 0, 1);
    const qx = a.x + abx * t;
    const qy = a.y + aby * t;
    const d = Math.hypot(p.x - qx, p.y - qy);
    if (d < best) {
      best = d;
      const cross = abx * (p.y - a.y) - aby * (p.x - a.x);
      out.d = cross >= 0 ? d : -d;
      out.s = acc + segLen * t;
      out.x = qx;
      out.y = qy;
    }
    acc += segLen;
  }
  return out;
}

/** Limitador de frecuencia por clave (tiempo de cirugía). */
export class RateLimiter {
  private last = new Map<string, number>();
  ok(key: string, now: number, gapSec: number): boolean {
    const l = this.last.get(key);
    if (l !== undefined && now - l < gapSec) return false;
    this.last.set(key, now);
    return true;
  }
}

/** Memoria de frases por contexto (enfriamiento mínimo por hablante, sin repetir). */
const sayMemo = new WeakMap<SurgeryContext, { last: Map<SpeakerId, number>; lastLine: string }>();

/** Frase cómica ocasional con enfriamiento (≥ 8 s por hablante) y probabilidad. */
export function sayLine(
  ctx: SurgeryContext,
  speaker: SpeakerId,
  list: readonly string[] | undefined,
  chance = 1,
  minGapSec = 8,
): boolean {
  if (!list || list.length === 0) return false;
  let memo = sayMemo.get(ctx);
  if (!memo) {
    memo = { last: new Map(), lastLine: '' };
    sayMemo.set(ctx, memo);
  }
  const now = ctx.now();
  const l = memo.last.get(speaker);
  if (l !== undefined && now - l < minGapSec) return false;
  if (ctx.rng() > chance) return false;
  let text = list[Math.floor(ctx.rng() * list.length) % list.length];
  if (text === memo.lastLine && list.length > 1) text = list[(list.indexOf(text) + 1) % list.length];
  memo.last.set(speaker, now);
  memo.lastLine = text;
  ctx.bus.emit('say', { speaker, text });
  return true;
}

/** Texto flotante sobre un punto de la herida. */
export function popAt(ctx: SurgeryContext, text: string, mm: Vec2, kind: 'perfect' | 'good' | 'miss' | 'bad'): void {
  ctx.hud.popText(text, ctx.scene.project(mm), kind);
}

/** Registra un gesto con feedback visual/sonoro. Devuelve la calidad acotada. */
export function scoreGesture(ctx: SurgeryContext, label: string, quality: number, mm: Vec2): number {
  const q = clamp(quality, 0, 1);
  ctx.log.gesture(label, q);
  if (q >= 0.9) {
    popAt(ctx, '¡Perfecto!', mm, 'perfect');
    ctx.audio.play('perfect');
    sayLine(ctx, 'emiliana', ctx.dialogue.emiliana.perfect, 0.3);
  } else if (q >= 0.65) {
    popAt(ctx, '¡Bien!', mm, 'good');
    ctx.audio.play('good');
  } else {
    popAt(ctx, 'Regular…', mm, 'miss');
    ctx.audio.play('miss', { volume: 0.5 });
  }
  return q;
}

/** Registra una falta con texto flotante y, a veces, un lamento de Emiliana. */
export function scoreFault(ctx: SurgeryContext, kind: FaultKind, mm: Vec2, text: string, detail?: string): void {
  ctx.log.fault(kind, detail);
  popAt(ctx, text, mm, 'bad');
  ctx.audio.play('miss');
  sayLine(ctx, 'emiliana', ctx.dialogue.emiliana.fault, 0.5);
}

/** Nivel de guía efectivo: el caso puede desactivarlas. */
export function guideAlpha(level: SurgeryContext['guideLevel'], full: number, endpoints: number, none: number): number {
  return level === 'full' ? full : level === 'endpoints' ? endpoints : none;
}

/**
 * Base de los pasos A: tolerancias de tutorial, frases, bucles de sonido y pistas.
 */
export abstract class StepA<P extends StepParams> extends StepBase<P> {
  /** Multiplicador de tolerancias (×1,5 en el tutorial). */
  protected tol = 1;
  protected tutorial = false;
  protected rl = new RateLimiter();
  private loopHandle: LoopHandle | null = null;
  private loopName: LoopSfxName | null = null;
  private beganAt = 0;

  begin(ctx: Parameters<StepBase<P>['begin']>[0]): void {
    this.tutorial = !!ctx.caseDef.flags?.tutorial;
    this.tol = this.tutorial ? 1.5 : 1;
    this.beganAt = ctx.now();
    super.begin(ctx);
  }

  /** Pista dinámica del paso (sin recortar). */
  protected abstract baseHint(): string;

  hint(): string {
    // Tutorial: la pista de los datos durante los primeros 8 s o mientras no haya avance.
    if (this.tutorial && !this.done && (this.ctx.now() - this.beganAt < 8 || this.progress() <= 0)) {
      const th = this.ctx.dialogue.tutorialHints?.[this.def.params.type];
      if (th) return clipHint(th);
    }
    return clipHint(this.baseHint());
  }

  protected pop(text: string, mm: Vec2, kind: 'perfect' | 'good' | 'miss' | 'bad', key?: string, gapSec = 1.2): void {
    if (key && !this.rl.ok(key, this.ctx.now(), gapSec)) return;
    popAt(this.ctx, text, mm, kind);
  }

  protected startLoop(name: LoopSfxName): LoopHandle {
    if (this.loopHandle && this.loopName === name) return this.loopHandle;
    this.stopLoop();
    this.loopHandle = this.ctx.audio.loop(name);
    this.loopName = name;
    return this.loopHandle;
  }

  protected get loop(): LoopHandle | null {
    return this.loopHandle;
  }

  protected stopLoop(): void {
    if (this.loopHandle) this.loopHandle.stop();
    this.loopHandle = null;
    this.loopName = null;
  }

  end(): void {
    this.stopLoop();
    super.end();
  }
}

/** Rectángulo redondeado como trazado. */
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

/** Corazoncito (centro, tamaño en px). */
export function heartPath(g: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const s = size / 2;
  g.beginPath();
  g.moveTo(x, y + s * 0.9);
  g.bezierCurveTo(x - s * 1.3, y + s * 0.1, x - s * 0.9, y - s * 1.1, x, y - s * 0.35);
  g.bezierCurveTo(x + s * 0.9, y - s * 1.1, x + s * 1.3, y + s * 0.1, x, y + s * 0.9);
  g.closePath();
}

// ───────────────────────────── Electrocauterio ─────────────────────────────

/** Ventanas de contacto (s) del GDD: < 0,5 no sella; 1–2 perfecto; > 3 carboniza. */
export const CAUTERY = {
  noSeal: 0.5,
  goodFrom: 1,
  goodTo: 2,
  overFrom: 2,
  charAt: 3,
  radiusMm: 4,
  arterialBonusSec: 5,
  tissueCharDecalSec: 1,
} as const;

export type CauteryOutcome = 'noSeal' | 'good' | 'perfect' | 'over' | 'char';

/** Clasifica un tiempo de contacto en su ventana y calidad. */
export function classifyCautery(seconds: number): { outcome: CauteryOutcome; quality: number } {
  if (seconds < CAUTERY.noSeal) return { outcome: 'noSeal', quality: 0 };
  if (seconds < CAUTERY.goodFrom) return { outcome: 'good', quality: 0.7 };
  if (seconds <= CAUTERY.goodTo) return { outcome: 'perfect', quality: 1 };
  if (seconds < CAUTERY.charAt) return { outcome: 'over', quality: 0.75 };
  return { outcome: 'char', quality: 0.3 };
}

export interface CauteryToolAPI extends UniversalTool {
  /** Segundos de contacto actuales (0 si no hay contacto). */
  contactSeconds(): number;
  /** ¿Hay contacto sobre un sangrado? */
  onBleeder(): boolean;
  /** Quita overlays y bucles (llamar al terminar la cirugía o el paso). */
  dispose(): void;
}

const SMOKE_MAX = 40;

/** Crea el cauterio bipolar universal (sella cualquier sangrado activo a ≤ 4 mm). */
export function createCauteryTool(ctx: SurgeryContext): CauteryToolAPI {
  const tutorial = !!ctx.caseDef.flags?.tutorial;
  const radius = CAUTERY.radiusMm * (tutorial ? 1.5 : 1);
  const overlayId = 'cautery-tool';
  const rl = new RateLimiter();

  let holding = false;
  let locked = false; // tras auto-soltar por carbonización, espera a soltar el botón
  let contact = 0;
  let bleeder: Bleeder | null = null;
  let tissueCharDecal = false;
  let tissueFault = false;
  const tip = { x: 0, y: 0 };
  const anchor = { x: 0, y: 0 };
  let loop: LoopHandle | null = null;
  let overlayOn = false;
  let smokeAcc = 0;

  // Humo: pool fijo sin asignaciones por fotograma.
  const sx = new Float32Array(SMOKE_MAX);
  const sy = new Float32Array(SMOKE_MAX);
  const sAge = new Float32Array(SMOKE_MAX);
  const sLife = new Float32Array(SMOKE_MAX);
  const sSize = new Float32Array(SMOKE_MAX);
  const sDrift = new Float32Array(SMOKE_MAX);
  let sNext = 0;
  let live = 0;
  let seed = 1234567;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const puff = (x: number, y: number, size: number, life: number) => {
    const i = sNext;
    sNext = (sNext + 1) % SMOKE_MAX;
    if (sLife[i] <= 0 || sAge[i] >= sLife[i]) live++;
    sx[i] = x + (rnd() - 0.5) * 1.5;
    sy[i] = y + (rnd() - 0.5) * 1.5;
    sAge[i] = 0;
    sLife[i] = life;
    sSize[i] = size;
    sDrift[i] = (rnd() - 0.5) * 4;
  };

  const overlay: WoundOverlay = {
    id: overlayId,
    z: 46,
    draw(g, px, ppm, t) {
      // Chispa del contacto.
      if (holding && !locked) {
        const c = px(tip);
        const heat = clamp(contact / CAUTERY.charAt, 0, 1);
        const r = ppm * (1.4 + heat * 1.6);
        const grad = g.createRadialGradient(c.x, c.y, 0, c.x, c.y, r * 2.2);
        grad.addColorStop(0, 'rgba(255,255,255,0.95)');
        grad.addColorStop(0.35, heat > 0.66 ? 'rgba(255,170,90,0.7)' : 'rgba(170,220,255,0.7)');
        grad.addColorStop(1, 'rgba(120,160,255,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(c.x, c.y, r * 2.2, 0, Math.PI * 2);
        g.fill();
        // Pequeños arcos eléctricos.
        g.strokeStyle = heat > 0.66 ? 'rgba(255,220,160,0.9)' : 'rgba(220,240,255,0.9)';
        g.lineWidth = Math.max(1, ppm * 0.18);
        for (let k = 0; k < 3; k++) {
          const a = t * 23 + k * 2.1;
          g.beginPath();
          g.moveTo(c.x, c.y);
          g.lineTo(c.x + Math.cos(a) * r * 1.2, c.y + Math.sin(a * 1.3) * r * 1.2);
          g.lineTo(c.x + Math.cos(a + 0.6) * r * 1.9, c.y + Math.sin(a * 1.1 + 0.4) * r * 1.9);
          g.stroke();
        }
        // Anillo de tiempo de contacto alrededor de la punta.
        const ringR = ppm * 5.5;
        g.lineWidth = Math.max(2, ppm * 0.55);
        g.strokeStyle = 'rgba(59,33,70,0.35)';
        g.beginPath();
        g.arc(c.x, c.y, ringR, 0, Math.PI * 2);
        g.stroke();
        const frac = clamp(contact / CAUTERY.charAt, 0, 1);
        g.strokeStyle =
          contact < CAUTERY.noSeal ? '#ffb347' : contact < CAUTERY.goodFrom ? '#ffe066' : contact <= CAUTERY.goodTo ? '#3fcf9c' : '#ff4d6d';
        g.beginPath();
        g.arc(c.x, c.y, ringR, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        g.stroke();
        // Marca de la ventana perfecta (1–2 s).
        g.strokeStyle = 'rgba(159,240,208,0.55)';
        g.lineWidth = Math.max(1, ppm * 0.25);
        g.beginPath();
        g.arc(c.x, c.y, ringR + ppm * 0.9, -Math.PI / 2 + (1 / 3) * Math.PI * 2, -Math.PI / 2 + (2 / 3) * Math.PI * 2);
        g.stroke();
      }
      // Humo.
      for (let i = 0; i < SMOKE_MAX; i++) {
        if (sLife[i] <= 0 || sAge[i] >= sLife[i]) continue;
        const k = sAge[i] / sLife[i];
        const x = sx[i] + sDrift[i] * k;
        const y = sy[i] - k * 9;
        const c = px({ x, y });
        const r = ppm * sSize[i] * (0.6 + k * 1.6);
        g.fillStyle = `rgba(236,230,240,${(0.42 * (1 - k)).toFixed(3)})`;
        g.beginPath();
        g.arc(c.x, c.y, r, 0, Math.PI * 2);
        g.fill();
      }
    },
  };

  const ensureOverlay = () => {
    if (overlayOn) return;
    ctx.wound.addOverlay(overlay);
    overlayOn = true;
  };

  const stopLoop = () => {
    loop?.stop();
    loop = null;
  };

  const releaseContact = () => {
    holding = false;
    bleeder = null;
    contact = 0;
    tissueCharDecal = false;
    tissueFault = false;
    stopLoop();
  };

  const seal = (b: Bleeder, quality: number, charred: boolean) => {
    const now = ctx.now();
    ctx.bleeding.seal(b.id, now, charred);
    const openSec = Math.max(0, now - b.bornAt);
    ctx.bus.emit('bleeder:sealed', { id: b.id, kind: b.kind, secondsOpen: openSec });
    if (charred) {
      ctx.log.fault('char', 'Sangrado sellado con carbonización');
    } else {
      scoreGesture(ctx, `Cauterio: sangrado ${BLEED_NAME[b.kind]}`, quality, b.pos);
      if (b.kind === 'arterial' && openSec <= CAUTERY.arterialBonusSec) {
        ctx.log.bonus('Hemorragia arterial controlada', 4);
        popAt(ctx, '¡Arteria controlada! +4', { x: b.pos.x, y: b.pos.y - 6 }, 'perfect');
        ctx.emiliana.offerMessage();
      }
    }
  };

  /** Evalúa el contacto al soltar (o al apartarse del sangrado). */
  const evaluateRelease = () => {
    if (bleeder && bleeder.active) {
      const { outcome, quality } = classifyCautery(contact);
      if (outcome === 'noSeal') {
        popAt(ctx, 'No selló', bleeder.pos, 'miss');
        ctx.audio.play('miss', { volume: 0.6 });
      } else {
        seal(bleeder, quality, false);
      }
    }
    releaseContact();
  };

  const acquire = (p: Vec2) => {
    const b = ctx.bleeding.nearest(p, radius);
    if (b && b.active) {
      bleeder = b;
      anchor.x = b.pos.x;
      anchor.y = b.pos.y;
    } else {
      bleeder = null;
      anchor.x = p.x;
      anchor.y = p.y;
    }
    contact = 0;
    tissueCharDecal = false;
    tissueFault = false;
  };

  const charNow = () => {
    // Mantener > 3 s sobre un sangrado: sella pero carbonizado.
    const b = bleeder!;
    seal(b, 0.3, true);
    ctx.wound.addDecal('char', b.pos, { sizeMm: 5, angleDeg: rnd() * 360 });
    for (let k = 0; k < 12; k++) puff(b.pos.x, b.pos.y, 2.2 + rnd() * 1.6, 1.6 + rnd() * 0.8);
    popAt(ctx, '¡Carbonizado! Huele a chicharrón', b.pos, 'bad');
    ctx.audio.play('miss');
    sayLine(ctx, 'emiliana', ctx.dialogue.emiliana.fault, 0.5);
    releaseContact();
    locked = true;
  };

  const gauge: Gauge = {
    id: 'cautery-contact',
    label: 'Contacto',
    value: 0,
    min: 0,
    max: 3.5,
    unit: 's',
    zones: [
      { from: 0.5, to: 1, kind: 'warn' },
      { from: 1, to: 2, kind: 'good' },
      { from: 2, to: 3, kind: 'warn' },
      { from: 3, to: 3.5, kind: 'bad' },
    ],
  };
  const gaugeList: Gauge[] = [gauge];

  return {
    instrument: 'cautery',
    onPointerDown(p: WoundPointer) {
      if (p.button !== 0) return;
      locked = false;
      holding = true;
      tip.x = p.mm.x;
      tip.y = p.mm.y;
      acquire(p.mm);
      ensureOverlay();
      loop = ctx.audio.loop('cautery');
      loop.set('intensity', 0.35);
      loop.set('load', bleeder ? 0.8 : 0.3);
    },
    onPointerMove(p: WoundPointer) {
      tip.x = p.mm.x;
      tip.y = p.mm.y;
      if (!holding || locked) return;
      if (bleeder) {
        // Apartarse del vaso cuenta como soltar.
        if (dist(p.mm, bleeder.pos) > radius + 1.5) evaluateRelease();
        return;
      }
      // Sobre tejido: si aparece un sangrado cerca, se engancha; si barre, reinicia el reloj.
      const b = ctx.bleeding.nearest(p.mm, radius);
      if (b && b.active) {
        acquire(p.mm);
        loop?.set('load', 0.8);
      } else if (Math.hypot(p.mm.x - anchor.x, p.mm.y - anchor.y) > 3) {
        acquire(p.mm);
      }
    },
    onPointerUp(p: WoundPointer) {
      if (p.button !== 0) return;
      if (locked) {
        locked = false;
        releaseContact();
        return;
      }
      if (!holding) return;
      evaluateRelease();
    },
    update(dt: number) {
      if (holding && !locked) {
        contact += dt;
        if (bleeder && !bleeder.active) {
          // Otro lo selló (o desapareció): soltar sin puntuar.
          releaseContact();
        } else {
          loop?.set('intensity', clamp(0.35 + contact / CAUTERY.charAt, 0, 1));
          smokeAcc += dt;
          const every = contact > 2 ? 0.05 : 0.1;
          while (smokeAcc >= every) {
            smokeAcc -= every;
            puff(tip.x, tip.y, 0.9 + rnd() * 0.8 + contact * 0.3, 0.9 + rnd() * 0.5);
          }
          if (bleeder && contact >= CAUTERY.charAt) {
            charNow();
          } else if (!bleeder) {
            if (contact > CAUTERY.tissueCharDecalSec && !tissueCharDecal) {
              tissueCharDecal = true;
              ctx.wound.addDecal('char', { x: anchor.x, y: anchor.y }, { sizeMm: 3, angleDeg: rnd() * 360 });
              if (rl.ok('tissue', ctx.now(), 2)) popAt(ctx, 'Ahí no sangra nada…', anchor, 'miss');
            }
            if (contact > CAUTERY.charAt && !tissueFault) {
              tissueFault = true;
              ctx.log.fault('char', 'Tejido sano carbonizado');
              ctx.wound.addDecal('char', { x: anchor.x, y: anchor.y }, { sizeMm: 5, angleDeg: rnd() * 360 });
              for (let k = 0; k < 8; k++) puff(anchor.x, anchor.y, 2 + rnd(), 1.4);
              popAt(ctx, '¡Carbonizado!', anchor, 'bad');
            }
          }
        }
      }
      // Envejecer humo.
      if (live > 0) {
        let alive = 0;
        for (let i = 0; i < SMOKE_MAX; i++) {
          if (sLife[i] <= 0 || sAge[i] >= sLife[i]) continue;
          sAge[i] += dt;
          if (sAge[i] < sLife[i]) alive++;
        }
        live = alive;
      }
      gauge.value = holding && !locked ? contact : 0;
      if (overlayOn && !holding && live === 0) {
        ctx.wound.removeOverlay(overlayId);
        overlayOn = false;
      }
    },
    gauges() {
      gauge.value = holding && !locked ? contact : 0;
      return gaugeList;
    },
    contactSeconds() {
      return holding && !locked ? contact : 0;
    },
    onBleeder() {
      return !!bleeder;
    },
    dispose() {
      releaseContact();
      locked = false;
      if (overlayOn) ctx.wound.removeOverlay(overlayId);
      overlayOn = false;
      for (let i = 0; i < SMOKE_MAX; i++) sLife[i] = 0;
      live = 0;
    },
  };
}
