/**
 * Lienzo 2D de la herida quirúrgica (se proyecta sobre un plano 3D en la escena).
 *
 * Estructura por capas (todo lo estático se cachea):
 *  - `under`: lecho profundo + ventana oscura + médula (pintado una vez).
 *  - `boneLayer`: hueso estático + fragmentos + fresado + calcomanías óseas (se rehace si cambian las poses).
 *  - implantes (cada fotograma; son pocos).
 *  - `stack`: músculo, fascia, subcutáneo y piel con sus máscaras de corte, sombra de profundidad y borde
 *    de color. Se rehace solo al cortar (en un rectángulo sucio) o al separar/cerrar (entera).
 *  - `inWound`: calcomanías internas, puntos sellados y charco, recortados por la apertura de la piel.
 *  - dinámico: calcomanías de piel, chorros de sangre, guía, fantasmas, overlays, rayos X, luz y destello.
 */
import type {
  AnatomyDef,
  BleedingAPI,
  BloodPoolAPI,
  BoneAPI,
  DecalKind,
  GuideLevel,
  Settings,
  TissueLayer,
  Vec2,
  WoundAPI,
  WoundOverlay,
} from '../core/contracts';
import { FLOOD_THRESHOLD_PCT, PALETTE, PX_PER_MM, WOUND_CANVAS_H, WOUND_CANVAS_W, WOUND_H_MM, WOUND_W_MM } from '../core/constants';
import { clamp, polygonCentroid, smoothstep } from '../core/math';
import { makeCanvas, makeSparkle, traceSmoothPoly } from './scene/canvasUtil';
import {
  incisionAngleDeg,
  makeTrabecularPattern,
  makeXrayGrain,
  paintDeep,
  paintFascia,
  paintMuscle,
  paintSkin,
  paintSubcut,
} from './scene/tissueTextures';
import {
  drawBleeder,
  drawBonePoly,
  drawDecal,
  drawFragments,
  drawGhost,
  drawGuide,
  drawImplants,
  drawSealed,
  drawXrayBone,
  drawXrayImplants,
} from './scene/woundDraw';
import {
  bloodLook,
  boneSignature,
  buildCutStrokes,
  clampRect,
  createPoolScratch,
  decalLevel,
  gridSamplesInPolygon,
  hashId,
  implantsSignature,
  insertByZ,
  maskOpenFraction,
  muscleParting,
  rasterizePool,
  poolLevelCap,
  sampleAlpha,
  scalePolygon,
  SOFT_LAYERS,
  strokeWidthAt,
  unionRect,
  type CutStroke,
  type DirtyRect,
  type SoftLayer,
} from './scene/woundMath';

export interface WoundSurfaceDeps {
  anatomy: AnatomyDef;
  incisionPath: Vec2[];
  bone: BoneAPI;
  bleeding: BleedingAPI;
  blood: BloodPoolAPI;
  settings: Settings;
}

/** Extras de depuración (no forman parte del contrato). */
export interface WoundSurfaceDebug {
  /** Tiempos del último update en ms. */
  stats(): { updateMs: number; stackMs: number; stackRebuilds: number };
  readonly retraction: number;
  readonly closure: number;
}

/** Capas de tejido en orden de profundidad (útil para pasos y HUD). */
export const TISSUE_ORDER: readonly TissueLayer[] = ['skin', 'subcut', 'fascia', 'muscle', 'bone'];

/** Orden de dibujo de la pila: del más profundo al más externo. */
const DRAW_ORDER: readonly SoftLayer[] = ['muscle', 'fascia', 'subcut', 'skin'];
/** Resolución de las máscaras respecto al lienzo (bordes suaves y lectura rápida). */
const MASK_SCALE = 0.5;
/** Resolución de las sombras de profundidad (se desenfocan barato y se escalan). */
const SHADOW_SCALE = 0.25;
/** Truco de sombra: se dibuja fuera del lienzo y solo la sombra cae dentro. */
const OFF = 4096;

interface LayerState {
  id: SoftLayer;
  tex: HTMLCanvasElement;
  mask: HTMLCanvasElement;
  mg: CanvasRenderingContext2D;
  comp: HTMLCanvasElement;
  cg: CanvasRenderingContext2D;
  /** Sombra de profundidad (¼) y borde de color (½) generados desde la máscara. */
  depth: HTMLCanvasElement;
  dg: CanvasRenderingContext2D;
  rimC: HTMLCanvasElement;
  rg: CanvasRenderingContext2D;
  strokes: CutStroke[];
  erases: Array<{ c: Vec2; r: number }>;
  img: ImageData | null;
  shadowsDirty: boolean;
  rim: string;
  depthAlpha: number;
}

export function createWoundSurface(deps: WoundSurfaceDeps): WoundAPI & WoundSurfaceDebug {
  const { anatomy, bone, bleeding, blood, settings } = deps;
  const incision = deps.incisionPath.length >= 2 ? deps.incisionPath : [{ x: 30, y: 50 }, { x: 130, y: 50 }];
  const W = WOUND_CANVAS_W;
  const H = WOUND_CANVAS_H;
  const s = PX_PER_MM;
  const mW = Math.round(W * MASK_SCALE);
  const mH = Math.round(H * MASK_SCALE);
  const ms = s * MASK_SCALE;
  const qW = Math.round(W * SHADOW_SCALE);
  const qH = Math.round(H * SHADOW_SCALE);
  const closed = !!anatomy.closed;

  const { c: canvas, g: o } = makeCanvas(W, H);
  canvas.dataset.role = 'wound';

  // ───────────── Texturas estáticas ─────────────
  const angle = incisionAngleDeg(incision);
  const texOf = (paint: (g: CanvasRenderingContext2D) => void) => {
    const t = makeCanvas(W, H);
    paint(t.g);
    return t.c;
  };
  const under = texOf((g) => paintDeep(g, W, H, s, anatomy));
  const TEX: Record<SoftLayer, HTMLCanvasElement> = {
    muscle: texOf((g) => paintMuscle(g, W, H, s, angle)),
    fascia: texOf((g) => paintFascia(g, W, H, s, angle)),
    subcut: texOf((g) => paintSubcut(g, W, H, s)),
    skin: texOf((g) => paintSkin(g, W, H, s, anatomy, incision)),
  };
  const RIM: Record<SoftLayer, string> = {
    skin: 'rgba(200,52,66,1)',
    subcut: 'rgba(226,160,62,1)',
    fascia: 'rgba(246,238,250,1)',
    muscle: 'rgba(120,12,24,1)',
  };
  const DEPTH_ALPHA: Record<SoftLayer, number> = { skin: 0.7, subcut: 0.55, fascia: 0.5, muscle: 0.75 };
  const layers = {} as Record<SoftLayer, LayerState>;
  for (const id of SOFT_LAYERS) {
    const m = makeCanvas(mW, mH, true);
    const cp = makeCanvas(W, H);
    const dp = makeCanvas(qW, qH);
    const rc = makeCanvas(mW, mH);
    m.g.fillStyle = '#fff';
    layers[id] = {
      id,
      tex: TEX[id],
      mask: m.c,
      mg: m.g,
      comp: cp.c,
      cg: cp.g,
      depth: dp.c,
      dg: dp.g,
      rimC: rc.c,
      rg: rc.g,
      strokes: [],
      erases: [],
      img: null,
      shadowsDirty: true,
      rim: RIM[id],
      depthAlpha: DEPTH_ALPHA[id],
    };
  }
  // Auxiliares para las sombras (alfa del tejido a ¼ y ½).
  const tmpQ = makeCanvas(qW, qH);
  const tmpM = makeCanvas(mW, mH);

  const trabecular = makeTrabecularPattern();
  const bonePattern = o.createPattern(trabecular, 'repeat');
  const sparkle = makeSparkle(24);
  const grain = makeXrayGrain(W / 2, H / 2);

  // Pila de tejidos blandos compuesta.
  const { c: stack, g: sg } = makeCanvas(W, H);
  let stackFull = true;
  let dirty: DirtyRect | null = null;

  // Hueso.
  const { c: boneLayer, g: bg } = makeCanvas(W, H);
  const boneErase = makeCanvas(mW, mH, true);
  boneErase.g.fillStyle = '#fff';
  const boneTint = makeCanvas(W, H);
  const boneTintPattern = boneTint.g.createPattern(trabecular, 'repeat');
  let boneEraseImg: ImageData | null = null;
  let boneSig = NaN;
  let boneDirty = true;

  // Calcomanías acumuladas por nivel.
  const boneDecals = makeCanvas(W, H);
  const woundDecals = makeCanvas(W, H);
  const skinDecals = makeCanvas(W, H);
  let decalSeed = 1;
  let hasWoundDecals = false;
  let hasSkinDecals = false;

  // Contenido interno de la herida (a ½), recortado por la apertura de la piel.
  const inWound = makeCanvas(mW, mH);
  const floodC = makeCanvas(mW, mH);
  // Fondo + hueso precompuestos (se rehace solo si cambia el hueso).
  const base = makeCanvas(W, H);
  // Todo lo estático junto (fondo, hueso, implantes, tejidos y calcomanías de piel).
  const staticC = makeCanvas(W, H);
  let staticDirty = true;
  let implantsSig = NaN;

  // Charco (rasterizado a 4× la rejilla y escalado con suavizado).
  const pw = Math.min(512, blood.cols * 4);
  const ph = Math.min(320, blood.rows * 4);
  const poolC = makeCanvas(pw, ph);
  const poolImg = poolC.g.createImageData(pw, ph);
  const poolScratch = createPoolScratch(blood.cols, blood.rows);
  const look = bloodLook(settings.goreLevel, settings.pastelMode);
  // Puntos fijos para destellos del Modo Pastel.
  const sparkPts = Array.from({ length: 64 }, (_, i) => {
    const x = hashId(i, 21) * WOUND_W_MM;
    const y = hashId(i, 22) * WOUND_H_MM;
    const ci = Math.min(blood.cols - 1, Math.floor((x / WOUND_W_MM) * blood.cols));
    const cj = Math.min(blood.rows - 1, Math.floor((y / WOUND_H_MM) * blood.rows));
    return { x: x * s, y: y * s, idx: cj * blood.cols + ci, ph: hashId(i, 23) * 6.28 };
  });

  const winC = anatomy.window.length ? polygonCentroid(anatomy.window) : { x: 80, y: 50 };

  // Tejido blando en rayos X (densidad suave del miembro).
  const xraySoft = makeCanvas(W, H);
  {
    const g = xraySoft.g;
    g.fillStyle = '#060a14';
    g.fillRect(0, 0, W, H);
    g.save();
    g.translate(winC.x * s, winC.y * s);
    g.rotate((angle * Math.PI) / 180);
    const lg = g.createLinearGradient(0, -42 * s, 0, 42 * s);
    lg.addColorStop(0, 'rgba(90,110,140,0)');
    lg.addColorStop(0.3, 'rgba(90,110,140,0.35)');
    lg.addColorStop(0.5, 'rgba(110,130,160,0.45)');
    lg.addColorStop(0.7, 'rgba(90,110,140,0.35)');
    lg.addColorStop(1, 'rgba(90,110,140,0)');
    g.fillStyle = lg;
    g.fillRect(-W, -42 * s, W * 2, 84 * s);
    g.restore();
  }

  // Viñeta de luz (se regenera al cambiar el nivel cuantizado).
  const vig = makeCanvas(256, 160);
  let vigLevel = -1;

  // ───────────── Estado ─────────────
  let retraction = 0;
  let closure = 0;
  let appliedR = 0;
  let appliedC = 0;
  let masksStale = false;
  let guide: Vec2[] | null = null;
  let guideLevel: GuideLevel = 'none';
  let xray = false;
  let ghosts = false;
  let light = 1;
  let flashColor = '#fff';
  let flashMs = 0;
  let flashLeft = 0;
  const overlays: WoundOverlay[] = [];
  const pxFn = (p: Vec2): Vec2 => ({ x: p.x * s, y: p.y * s });
  const sampleCache = new WeakMap<Vec2[], Vec2[]>();
  let tNow = 0;
  let lastUpdateMs = 0;
  let lastStackMs = 0;
  let stackRebuilds = 0;

  // ───────────── Máscaras ─────────────
  function drawStrokeOnMask(L: LayerState, st: CutStroke): void {
    const wa = (strokeWidthAt(st, 'a', L.id, appliedR, appliedC) * ms) / 2;
    const wb = (strokeWidthAt(st, 'b', L.id, appliedR, appliedC) * ms) / 2;
    if (wa < 0.2 && wb < 0.2) return;
    const g = L.mg;
    const ax = st.a.x * ms;
    const ay = st.a.y * ms;
    const bx = st.b.x * ms;
    const by = st.b.y * ms;
    const dx = bx - ax;
    const dy = by - ay;
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l;
    const ny = dx / l;
    g.beginPath();
    g.moveTo(ax + nx * wa, ay + ny * wa);
    g.lineTo(bx + nx * wb, by + ny * wb);
    g.lineTo(bx - nx * wb, by - ny * wb);
    g.lineTo(ax - nx * wa, ay - ny * wa);
    g.closePath();
    g.fill();
    g.beginPath();
    g.arc(ax, ay, Math.max(0.1, wa), 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(bx, by, Math.max(0.1, wb), 0, Math.PI * 2);
    g.fill();
  }

  function drawEraseOnMask(g: CanvasRenderingContext2D, c: Vec2, r: number): void {
    g.beginPath();
    g.arc(c.x * ms, c.y * ms, Math.max(0.3, r * ms), 0, Math.PI * 2);
    g.fill();
  }

  function renderMask(L: LayerState): void {
    const g = L.mg;
    g.clearRect(0, 0, mW, mH);
    for (const st of L.strokes) drawStrokeOnMask(L, st);
    for (const e of L.erases) drawEraseOnMask(g, e.c, e.r);
    if (L.id === 'muscle' && !closed) {
      const p = muscleParting(appliedR, appliedC);
      if (p > 0.01 && anatomy.window.length >= 3) {
        traceSmoothPoly(g, scalePolygon(anatomy.window, winC, 0.62 + 0.38 * p, p), ms);
        g.fill();
      }
    }
    L.img = null;
    L.shadowsDirty = true;
  }

  function layerImg(L: LayerState): ImageData {
    if (!L.img) L.img = L.mg.getImageData(0, 0, mW, mH);
    return L.img;
  }
  function boneImg(): ImageData {
    if (!boneEraseImg) boneEraseImg = boneErase.g.getImageData(0, 0, mW, mH);
    return boneEraseImg;
  }

  function hasHoles(L: LayerState): boolean {
    if (L.strokes.length || L.erases.length) return true;
    return L.id === 'muscle' && !closed && muscleParting(appliedR, appliedC) > 0.01;
  }

  /** Sombra de profundidad y borde de color a partir de la máscara (a baja resolución). */
  function renderShadows(L: LayerState): void {
    // Alfa del tejido (inverso de la máscara) a ¼.
    const q = tmpQ.g;
    q.globalCompositeOperation = 'copy';
    q.fillStyle = '#1e000a';
    q.fillRect(0, 0, qW, qH);
    q.globalCompositeOperation = 'destination-out';
    q.drawImage(L.mask, 0, 0, qW, qH);
    q.globalCompositeOperation = 'source-over';
    const d = L.dg;
    d.clearRect(0, 0, qW, qH);
    d.save();
    d.shadowColor = `rgba(30,0,10,${L.depthAlpha})`;
    d.shadowBlur = L.id === 'skin' ? 5 : 3.5;
    d.shadowOffsetX = OFF;
    d.shadowOffsetY = 1;
    d.drawImage(tmpQ.c, -OFF, 0);
    d.restore();
    // Borde de color a ½.
    const m = tmpM.g;
    m.globalCompositeOperation = 'copy';
    m.fillStyle = '#000';
    m.fillRect(0, 0, mW, mH);
    m.globalCompositeOperation = 'destination-out';
    m.drawImage(L.mask, 0, 0);
    m.globalCompositeOperation = 'source-over';
    const r = L.rg;
    r.clearRect(0, 0, mW, mH);
    r.save();
    r.shadowColor = L.rim;
    r.shadowBlur = 2;
    r.shadowOffsetX = OFF;
    r.drawImage(tmpM.c, -OFF, 0);
    r.restore();
    L.shadowsDirty = false;
  }

  function rebuildStack(): void {
    const t0 = performance.now();
    if (masksStale) {
      appliedR = retraction;
      appliedC = closure;
      for (const id of SOFT_LAYERS) renderMask(layers[id]);
      masksStale = false;
      stackFull = true;
    }
    const r = stackFull || !dirty ? { x0: 0, y0: 0, x1: W, y1: H } : clampRect(dirty, W, H, 8);
    const rw = r.x1 - r.x0;
    const rh = r.y1 - r.y0;
    dirty = null;
    stackFull = false;
    if (rw <= 0 || rh <= 0) return;
    // Del más profundo al más externo, empezando por la capa sin agujeros más externa (lo de debajo no se ve).
    let firstIdx = 0;
    for (let k = DRAW_ORDER.length - 1; k >= 0; k--) {
      if (!hasHoles(layers[DRAW_ORDER[k]])) {
        firstIdx = k;
        break;
      }
    }
    sg.clearRect(r.x0, r.y0, rw, rh);
    for (let k = firstIdx; k < DRAW_ORDER.length; k++) {
      const L = layers[DRAW_ORDER[k]];
      if (!hasHoles(L)) {
        sg.drawImage(L.tex, r.x0, r.y0, rw, rh, r.x0, r.y0, rw, rh);
        continue;
      }
      if (L.shadowsDirty) renderShadows(L);
      // Capa recortada (solo en el rectángulo sucio).
      const cg = L.cg;
      cg.globalCompositeOperation = 'copy';
      cg.drawImage(L.tex, r.x0, r.y0, rw, rh, r.x0, r.y0, rw, rh);
      cg.globalCompositeOperation = 'destination-out';
      cg.drawImage(L.mask, r.x0 * MASK_SCALE, r.y0 * MASK_SCALE, rw * MASK_SCALE, rh * MASK_SCALE, r.x0, r.y0, rw, rh);
      cg.globalCompositeOperation = 'source-over';
      sg.imageSmoothingEnabled = true;
      sg.drawImage(L.depth, r.x0 * SHADOW_SCALE, r.y0 * SHADOW_SCALE, rw * SHADOW_SCALE, rh * SHADOW_SCALE, r.x0, r.y0, rw, rh);
      sg.drawImage(L.rimC, r.x0 * MASK_SCALE, r.y0 * MASK_SCALE, rw * MASK_SCALE, rh * MASK_SCALE, r.x0, r.y0, rw, rh);
      sg.drawImage(L.comp, r.x0, r.y0, rw, rh, r.x0, r.y0, rw, rh);
    }
    stackRebuilds++;
    staticDirty = true;
    lastStackMs = performance.now() - t0;
  }

  function markDirtyStroke(a: Vec2, b: Vec2, widthMm: number, layer: SoftLayer): void {
    const L = layers[layer];
    L.img = null;
    L.shadowsDirty = true;
    // Margen: ancho abierto + desenfoque de la sombra.
    const pad = (widthMm + 4 + appliedR * 20) * s + 28;
    dirty = unionRect(dirty, Math.min(a.x, b.x) * s - pad, Math.min(a.y, b.y) * s - pad, Math.max(a.x, b.x) * s + pad, Math.max(a.y, b.y) * s + pad);
  }

  function rebuildBone(): void {
    bg.clearRect(0, 0, W, H);
    for (const poly of bone.staticPolygons()) drawBonePoly(bg, poly, s, bonePattern, 'bone');
    drawFragments(bg, bone.fragments(), (id) => bone.worldPolygon(id), s, bonePattern);
    // Hueso fresado: trabéculas expuestas alrededor y hueco.
    bg.save();
    bg.globalCompositeOperation = 'source-atop';
    bg.drawImage(boneTint.c, 0, 0);
    bg.globalCompositeOperation = 'destination-out';
    bg.drawImage(boneErase.c, 0, 0, W, H);
    bg.restore();
    bg.drawImage(boneDecals.c, 0, 0);
    base.g.drawImage(under, 0, 0);
    base.g.drawImage(boneLayer, 0, 0);
    boneDirty = false;
    staticDirty = true;
  }

  /** Composición estática: fondo + hueso + implantes + tejidos + calcomanías de piel (cambia poco). */
  function rebuildStatic(): void {
    const g = staticC.g;
    g.globalCompositeOperation = 'copy';
    g.drawImage(base.c, 0, 0);
    g.globalCompositeOperation = 'source-over';
    if (!closed) drawImplants(g, bone.implants, s);
    g.drawImage(stack, 0, 0);
    if (closed) {
      // Reducción cerrada: el hueso se intuye a través de la piel.
      g.globalAlpha = 0.15;
      g.drawImage(boneLayer, 0, 0);
      g.globalAlpha = 1;
      drawImplants(g, bone.implants, s);
    }
    // Puntos sellados y carbonizado dentro de la herida, recortados por la apertura de la piel.
    const list = bleeding.list();
    let anySealed = false;
    for (let i = 0; i < list.length; i++) if (!list[i].active) anySealed = true;
    if (!closed && (anySealed || hasWoundDecals)) {
      const m = inWound.g;
      m.globalCompositeOperation = 'source-over';
      m.clearRect(0, 0, mW, mH);
      m.save();
      m.scale(MASK_SCALE, MASK_SCALE);
      if (hasWoundDecals) m.drawImage(woundDecals.c, 0, 0);
      for (let i = 0; i < list.length; i++) if (!list[i].active) drawSealed(m, list[i], s);
      m.restore();
      m.globalCompositeOperation = 'destination-in';
      m.drawImage(layers.skin.mask, 0, 0);
      m.globalCompositeOperation = 'source-over';
      g.imageSmoothingEnabled = true;
      g.drawImage(inWound.c, 0, 0, W, H);
    }
    if (hasSkinDecals) g.drawImage(skinDecals.c, 0, 0);
    staticDirty = false;
  }

  function regenVignette(level: number): void {
    const g = vig.g;
    const w = 256;
    const h = 160;
    g.clearRect(0, 0, w, h);
    const dark = 1 - level;
    const grd = g.createRadialGradient(w / 2, h / 2, w * 0.12, w / 2, h / 2, w * 0.62);
    grd.addColorStop(0, `rgba(14,4,22,${dark * 0.72})`);
    grd.addColorStop(0.55, `rgba(14,4,22,${0.08 + dark * 0.85})`);
    grd.addColorStop(1, `rgba(10,2,16,${Math.min(0.97, 0.28 + dark * 0.7)})`);
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    vigLevel = level;
  }

  // ───────────── Dibujo dinámico ─────────────

  /** Firma de los puntos sellados (van en la composición estática). */
  function sealedSignature(): number {
    const list = bleeding.list();
    let h = 0;
    for (let i = 0; i < list.length; i++) if (!list[i].active) h += (list[i].charred ? 1000 : 1) + list[i].pos.x * 0.013 + list[i].pos.y * 0.0071;
    return h;
  }

  /**
   * Charco (rasterizado en JS y recortado por la apertura de la piel en el mismo paso) e inundación
   * (recortada por la fascia). Los puntos sellados y el carbonizado van en la composición estática.
   */
  function drawInWound(): void {
    const skin = layerImg(layers.skin);
    const max = rasterizePool(blood.grid, blood.cols, blood.rows, poolImg.data, pw, ph, look, poolScratch, skin.data, mW, mH, poolLevelCap(blood.levelPct()));
    if (max > 0.015) {
      poolC.g.putImageData(poolImg, 0, 0);
      o.imageSmoothingEnabled = true;
      o.drawImage(poolC.c, 0, 0, W, H);
      if (look.pastel) {
        for (let i = 0; i < sparkPts.length; i++) {
          const sp = sparkPts[i];
          if (blood.grid[sp.idx] < 0.08) continue;
          if (sampleAlpha(skin.data, mW, mH, sp.x * MASK_SCALE, sp.y * MASK_SCALE) < 0.5) continue;
          const a = 0.5 + 0.5 * Math.sin(tNow * 5 + sp.ph);
          if (a < 0.25) continue;
          o.globalAlpha = a;
          const z = 10 + a * 12;
          o.drawImage(sparkle, sp.x - z / 2, sp.y - z / 2, z, z);
        }
        o.globalAlpha = 1;
      }
    }
    if (blood.levelPct() >= FLOOD_THRESHOLD_PCT) {
      // La sangre llena la cavidad hasta el borde de la fascia.
      const f = floodC.g;
      f.globalCompositeOperation = 'source-over';
      f.clearRect(0, 0, mW, mH);
      f.save();
      f.scale(MASK_SCALE, MASK_SCALE);
      drawFlood(f);
      f.restore();
      f.globalCompositeOperation = 'destination-in';
      f.drawImage(layers.fascia.mask, 0, 0);
      f.globalCompositeOperation = 'source-over';
      o.imageSmoothingEnabled = true;
      o.drawImage(floodC.c, 0, 0, W, H);
    }
  }

  function drawFlood(g: CanvasRenderingContext2D): void {
    const lvl = blood.levelPct();
    const a = smoothstep(FLOOD_THRESHOLD_PCT, FLOOD_THRESHOLD_PCT + 12, lvl);
    const cx = winC.x * s;
    const cy = winC.y * s;
    g.save();
    const grd = g.createRadialGradient(cx - 20 * s, cy - 6 * s, 2 * s, cx, cy, 60 * s);
    if (look.pastel) {
      grd.addColorStop(0, '#ff9cc6');
      grd.addColorStop(0.6, '#ff5c9a');
      grd.addColorStop(1, '#c42a78');
    } else {
      grd.addColorStop(0, `rgb(${look.r},${look.g + 8},${look.b + 8})`);
      grd.addColorStop(0.5, `rgb(${look.dr},${look.dg},${look.db})`);
      grd.addColorStop(1, `rgb(${Math.round(look.dr * 0.55)},${Math.round(look.dg * 0.5)},${Math.round(look.db * 0.5)})`);
    }
    g.globalAlpha = a * (0.9 + 0.1 * look.alpha);
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    g.globalAlpha = a;
    // Ondas concéntricas.
    for (let k = 0; k < 5; k++) {
      const ph = (tNow * 0.45 + k * 0.2) % 1;
      const ox = (hashId(k, 3) - 0.5) * 60 * s;
      const oy = (hashId(k, 4) - 0.5) * 10 * s;
      g.strokeStyle = `rgba(255,${look.pastel ? 230 : 170},${look.pastel ? 240 : 170},${0.22 * (1 - ph)})`;
      g.lineWidth = 0.35 * s;
      g.beginPath();
      g.ellipse(cx + ox, cy + oy, (2 + ph * 16) * s, (1 + ph * 6) * s, 0, 0, Math.PI * 2);
      g.stroke();
    }
    // Reflejo de la lámpara.
    const hx = cx - 22 * s;
    const hy = cy - 6 * s;
    const hg = g.createRadialGradient(hx, hy, 0, hx, hy, 16 * s);
    hg.addColorStop(0, 'rgba(255,255,255,0.6)');
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = hg;
    g.beginPath();
    g.ellipse(hx, hy, 16 * s, 4.5 * s, -0.06, 0, Math.PI * 2);
    g.fill();
    if (look.pastel) {
      for (let i = 0; i < 18; i++) {
        const al = 0.5 + 0.5 * Math.sin(tNow * 4 + i * 1.7);
        g.globalAlpha = al * a;
        const x = cx + (hashId(i, 40) - 0.5) * 90 * s;
        const y = cy + (hashId(i, 41) - 0.5) * 22 * s;
        g.drawImage(sparkle, x - 8, y - 8, 16, 16);
      }
    }
    g.restore();
  }

  function drawXray(): void {
    o.drawImage(xraySoft.c, 0, 0);
    for (const poly of bone.staticPolygons()) drawXrayBone(o, poly, s);
    for (const f of bone.fragments()) if (!f.removed) drawXrayBone(o, bone.worldPolygon(f.id), s);
    drawXrayImplants(o, bone.implants, s);
    o.drawImage(grain, 0, 0, W, H);
    o.save();
    o.font = `700 ${Math.round(4.2 * s)}px "Baloo 2", "Nunito", system-ui, sans-serif`;
    o.fillStyle = PALETTE.mint;
    o.globalAlpha = 0.85;
    o.fillText('RX · ARCO EN C', 9 * s, 13 * s);
    o.restore();
  }

  // ───────────── API ─────────────
  const api: WoundAPI & WoundSurfaceDebug = {
    widthMm: WOUND_W_MM,
    heightMm: WOUND_H_MM,
    pxPerMm: s,
    canvas,

    cut(layer, a, b, widthMm) {
      if (closed && layer === 'skin') return; // reducción cerrada: la piel queda intacta
      const L = layers[layer];
      const w = Math.max(0.2, widthMm);
      const strokes = buildCutStrokes(a, b, w, incision);
      for (const st of strokes) {
        L.strokes.push(st);
        if (!masksStale) drawStrokeOnMask(L, st);
      }
      markDirtyStroke(a, b, w, layer);
    },

    erase(layer, center, radiusMm) {
      if (layer === 'bone') {
        drawEraseOnMask(boneErase.g, center, radiusMm);
        const tg = boneTint.g;
        tg.save();
        tg.fillStyle = boneTintPattern ?? '#e0c9a0';
        tg.globalAlpha = 0.85;
        tg.beginPath();
        tg.arc(center.x * s, center.y * s, radiusMm * 1.45 * s, 0, Math.PI * 2);
        tg.fill();
        tg.globalAlpha = 0.25;
        tg.fillStyle = '#b3202c';
        tg.beginPath();
        tg.arc(center.x * s, center.y * s, radiusMm * 1.15 * s, 0, Math.PI * 2);
        tg.fill();
        tg.restore();
        boneEraseImg = null;
        boneDirty = true;
        return;
      }
      if (closed && layer === 'skin') return;
      const L = layers[layer];
      L.erases.push({ c: { ...center }, r: radiusMm });
      if (!masksStale) drawEraseOnMask(L.mg, center, radiusMm);
      markDirtyStroke(center, center, radiusMm * 2, layer);
    },

    openFraction(layer, samples, radiusMm = 0) {
      const img = layer === 'bone' ? boneImg() : layerImg(layers[layer]);
      return maskOpenFraction(img.data, mW, mH, ms, samples, radiusMm);
    },

    removedFraction(layer, polygon) {
      let pts = sampleCache.get(polygon);
      if (!pts) {
        pts = gridSamplesInPolygon(polygon, 400);
        sampleCache.set(polygon, pts);
      }
      return api.openFraction(layer, pts);
    },

    topLayerAt(p) {
      if (closed) return 'skin';
      const x = p.x * ms;
      const y = p.y * ms;
      for (const id of SOFT_LAYERS) {
        const img = layerImg(layers[id]);
        if (sampleAlpha(img.data, mW, mH, x, y) < 0.5) return id;
      }
      if (bone.isOnBone(p) && sampleAlpha(boneImg().data, mW, mH, x, y) < 0.5) return 'bone';
      return 'muscle';
    },

    setRetraction(amount) {
      retraction = clamp(amount, 0, 1);
      if (Math.abs(retraction - appliedR) > 0.002) masksStale = true;
    },

    setClosure(amount) {
      closure = clamp(amount, 0, 1);
      if (Math.abs(closure - appliedC) > 0.002) masksStale = true;
    },

    setGuide(path, level) {
      guide = path ? path.map((p) => ({ ...p })) : null;
      guideLevel = level;
    },

    addDecal(kind: DecalKind, pos: Vec2, opts = {}) {
      const lvl = decalLevel(kind, closed);
      const target = lvl === 'bone' ? boneDecals.g : lvl === 'wound' ? woundDecals.g : skinDecals.g;
      drawDecal(target, kind, pos, opts, s, decalSeed++);
      if (lvl === 'bone') boneDirty = true;
      else if (lvl === 'wound') hasWoundDecals = true;
      else hasSkinDecals = true;
      staticDirty = true;
    },

    addOverlay(ov) {
      insertByZ(overlays, ov);
    },

    removeOverlay(id) {
      const i = overlays.findIndex((x) => x.id === id);
      if (i >= 0) overlays.splice(i, 1);
    },

    setXray(on) {
      xray = on;
    },
    setGhosts(on) {
      ghosts = on;
    },
    setLight(level) {
      light = clamp(level, 0, 1);
    },
    flash(color, msDur) {
      flashColor = color;
      flashMs = Math.max(1, msDur);
      flashLeft = flashMs;
    },

    update(dt, t) {
      const t0 = performance.now();
      tNow = t;
      bloodLook(settings.goreLevel, settings.pastelMode, look);
      if (masksStale || stackFull || dirty) rebuildStack();
      const sig = boneSignature(bone.fragments());
      if (boneDirty || sig !== boneSig) {
        boneSig = sig;
        rebuildBone();
      }

      o.globalCompositeOperation = 'source-over';
      o.globalAlpha = 1;
      if (xray) {
        drawXray();
      } else {
        const isig = implantsSignature(bone.implants) + sealedSignature() * 7.31;
        if (isig !== implantsSig) {
          implantsSig = isig;
          staticDirty = true;
        }
        if (staticDirty) rebuildStatic();
        o.drawImage(staticC.c, 0, 0);
        if (!closed) drawInWound();
        const list = bleeding.list();
        for (let i = 0; i < list.length; i++) if (list[i].active) drawBleeder(o, list[i], t, s, look, sparkle);
      }
      if (guide && guideLevel !== 'none') drawGuide(o, guide, guideLevel, s, t);
      if (ghosts) {
        for (const f of bone.fragments()) {
          if (f.removed || !f.def.target) continue;
          const tp = bone.targetPolygon(f.id);
          if (tp) drawGhost(o, tp, s, t);
        }
      }
      for (let i = 0; i < overlays.length; i++) {
        o.save();
        overlays[i].draw(o, pxFn, s, t);
        o.restore();
      }
      // Luz: viñeta tipo foco (más cerrada y oscura con poca luz).
      const q = Math.round(light * 50) / 50;
      if (q !== vigLevel) regenVignette(q);
      o.imageSmoothingEnabled = true;
      o.drawImage(vig.c, 0, 0, W, H);
      if (flashLeft > 0) {
        flashLeft -= dt * 1000;
        const k = clamp(flashLeft / flashMs, 0, 1);
        o.globalAlpha = k * (settings.reduceFlashes ? 0.22 : 0.65);
        o.fillStyle = flashColor;
        o.fillRect(0, 0, W, H);
        o.globalAlpha = 1;
      }
      lastUpdateMs = performance.now() - t0;
    },

    stats: () => ({ updateMs: lastUpdateMs, stackMs: lastStackMs, stackRebuilds }),
    get retraction() {
      return retraction;
    },
    get closure() {
      return closure;
    },
  };
  return api;
}
