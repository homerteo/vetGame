/**
 * Mini-juegos de exploración (3–6 s cada uno) con gestos reales sobre un lienzo:
 * cajón, rótula, dolor profundo, crepitación, cadera, carpo, radiografía (marcar) y tórax (barrer).
 */
import type { AudioAPI, DiagnosticTest } from '../../core/contracts';
import { clamp, lerp } from '../../core/math';
import { TEST_INFO, xrayHit } from '../logic/diagnosis';
import { createAngleAccumulator, createCoverage, createSmallCircleDetector, createStrokeCounter } from '../logic/gestures';
import { drawHeart, roundRect } from '../world/textures';
import { lungMask } from '../world/xrayImage';
import { esc } from './Hud';

export interface Minigame {
  update(dt: number): void;
  dispose(): void;
  readonly finished: boolean;
}

export interface MinigameOpts {
  layer: HTMLElement;
  test: DiagnosticTest;
  positive: boolean;
  petName: string;
  furColor: string;
  audio: AudioAPI;
  /** Tolerancia (tutorial 1,5). */
  leniency: number;
  /** Imagen de la placa ya dibujada (xray / thoracicXray). */
  plate?: HTMLCanvasElement;
  lesion?: { u: number; v: number; radius: number };
  /** Resultado para mostrar al terminar (texto del hallazgo). */
  resultText: string;
  /** completed=false si se cancela o no se termina; hit solo para xray. */
  onFinish(r: { completed: boolean; hit?: boolean }): void;
}

const W = 640;
const H = 360;
const TIME_LIMIT = 9;

function darker(hex: string, k: number): string {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${r},${g},${b})`;
}

/** Extremidad peluda: trazo grueso con contorno. */
function limb(g: CanvasRenderingContext2D, pts: Array<[number, number]>, width: number, fur: string): void {
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = darker(fur, 0.62);
  g.lineWidth = width + 8;
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
  g.strokeStyle = fur;
  g.lineWidth = width;
  g.stroke();
  // mechones
  g.strokeStyle = darker(fur, 0.85);
  g.lineWidth = 2;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    for (let k = 1; k < 5; k++) {
      const t = k / 5;
      const x = lerp(x0, x1, t);
      const y = lerp(y0, y1, t);
      g.beginPath();
      g.moveTo(x - 4, y - width * 0.3);
      g.quadraticCurveTo(x, y - width * 0.42, x + 3, y - width * 0.3);
      g.stroke();
    }
  }
}

/** Hueso de caricatura (marfil) entre dos puntos. */
function bone(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w: number): void {
  g.save();
  g.translate(x0, y0);
  g.rotate(Math.atan2(y1 - y0, x1 - x0));
  const L = Math.hypot(x1 - x0, y1 - y0);
  g.fillStyle = '#fff6e0';
  g.strokeStyle = '#d8c39a';
  g.lineWidth = 2;
  roundRect(g, 0, -w / 2, L, w, w / 2);
  g.fill();
  g.stroke();
  for (const x of [0, L]) {
    g.beginPath();
    g.arc(x, -w * 0.45, w * 0.5, 0, Math.PI * 2);
    g.arc(x, w * 0.45, w * 0.5, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

function glove(g: CanvasRenderingContext2D, x: number, y: number, s = 1, angle = 0): void {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.scale(s, s);
  g.fillStyle = '#ff8fc7';
  g.strokeStyle = '#c4136c';
  g.lineWidth = 2.5;
  roundRect(g, -20, -16, 40, 32, 14);
  g.fill();
  g.stroke();
  for (let i = 0; i < 4; i++) {
    roundRect(g, -18 + i * 10, -32, 9, 22, 4.5);
    g.fill();
    g.stroke();
  }
  roundRect(g, 16, -8, 18, 10, 5);
  g.fill();
  g.stroke();
  g.restore();
}

/** Carita de la mascota (arriba a la derecha) para las reacciones. */
function petFace(g: CanvasRenderingContext2D, x: number, y: number, fur: string, mood: 'calm' | 'ouch' | 'angry' | 'happy', turn = 0): void {
  g.save();
  g.translate(x + turn * 16, y);
  g.rotate(turn * 0.25);
  g.fillStyle = darker(fur, 0.8);
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(s * 18, -24);
    g.lineTo(s * 40, -58);
    g.lineTo(s * 42, -16);
    g.closePath();
    g.fill();
  }
  g.fillStyle = fur;
  g.strokeStyle = darker(fur, 0.6);
  g.lineWidth = 3;
  g.beginPath();
  g.ellipse(0, 0, 44, 38, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = '#3b2146';
  if (mood === 'angry' || mood === 'ouch') {
    g.lineWidth = 4;
    g.strokeStyle = '#3b2146';
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(s * 22, -10);
      g.lineTo(s * 10, -4);
      g.stroke();
    }
    g.beginPath();
    g.ellipse(0, 18, 9, mood === 'ouch' ? 9 : 4, 0, 0, Math.PI * 2);
    g.fill();
  } else {
    for (const s of [-1, 1]) {
      g.beginPath();
      g.arc(s * 15, -4, 6, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(s * 15 + 2, -6, 2, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#3b2146';
    }
    g.lineWidth = 3;
    g.strokeStyle = '#3b2146';
    g.beginPath();
    g.arc(0, 12, 8, 0.2, Math.PI - 0.2);
    g.stroke();
  }
  g.fillStyle = '#3b2146';
  g.beginPath();
  g.ellipse(0, 6, 6, 4, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,120,170,0.45)';
  g.beginPath();
  g.ellipse(-26, 10, 8, 5, 0, 0, Math.PI * 2);
  g.ellipse(26, 10, 8, 5, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function bubble(g: CanvasRenderingContext2D, x: number, y: number, text: string, color = '#ff2e93'): void {
  g.save();
  g.font = '900 24px "Baloo 2", sans-serif';
  const w = g.measureText(text).width + 26;
  g.fillStyle = '#fff';
  g.strokeStyle = color;
  g.lineWidth = 3;
  roundRect(g, x - w / 2, y - 22, w, 40, 18);
  g.fill();
  g.stroke();
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x, y - 1);
  g.restore();
}

function bg(g: CanvasRenderingContext2D, t: number): void {
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, '#fff6fb');
  gr.addColorStop(1, '#ffe1f0');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  g.globalAlpha = 0.18;
  for (let i = 0; i < 9; i++) {
    g.save();
    g.translate(40 + i * 72, 30 + ((i * 53) % 300) + Math.sin(t + i) * 4);
    drawHeart(g, 10, '#ff8fc7');
    g.restore();
  }
  g.globalAlpha = 1;
}

export function startMinigame(o: MinigameOpts): Minigame {
  const info = TEST_INFO[o.test];
  const modal = document.createElement('div');
  modal.className = 'cl-modal';
  const isPlate = o.test === 'xray' || o.test === 'thoracicXray';
  modal.innerHTML = `<div class="cl-card cl-mg">
      <button class="k-btn ghost close" data-act="cancel">Cancelar</button>
      <h2>${esc(info.label)}</h2>
      <div class="instr">${esc(info.gesture)}</div>
      <canvas width="${W}" height="${H}" class="${o.test === 'xray' ? 'whip' : ''}"></canvas>
      <div class="meta"><span>Progreso</span><div class="k-meter"><i style="width:0%"></i></div><span class="tl"></span></div>
      <div class="result"></div>
    </div>`;
  o.layer.appendChild(modal);
  const canvas = modal.querySelector('canvas') as HTMLCanvasElement;
  const g = canvas.getContext('2d')!;
  const meter = modal.querySelector('.k-meter i') as HTMLElement;
  const tl = modal.querySelector('.tl') as HTMLElement;
  const result = modal.querySelector('.result') as HTMLElement;

  let finished = false;
  let t = 0;
  let progress = 0;
  let done = false;
  let doneTimer = 0;
  let outcome: { completed: boolean; hit?: boolean } = { completed: false };
  let down = false;
  let px = W / 2;
  let py = H / 2;
  let lastSfx = 0;
  const pops: Array<{ x: number; y: number; text: string; life: number; color: string }> = [];

  // estado por prueba
  const stroke = createStrokeCounter(55 / o.leniency);
  const hipStroke = createStrokeCounter(60 / o.leniency);
  const angle = createAngleAccumulator(320, 190, 40, 200);
  const circles = createSmallCircleDetector(2);
  const cover = createCoverage(24, 14, W, H, lungMask);
  let startX = 0;
  let startY = 0;
  let offset = 0; // desplazamiento/ángulo visual
  let hold = 0;
  let load = 0;
  let loadHeld = 0;
  let misses = 0;
  const marks: Array<{ u: number; v: number; hit: boolean }> = [];
  let crackAcc = 0;
  let yelped = false;

  const toCanvas = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const pop = (x: number, y: number, text: string, color = '#ff2e93') => pops.push({ x, y, text, life: 0.9, color });

  const finish = (completed: boolean, hit?: boolean) => {
    if (done) return;
    done = true;
    outcome = { completed, hit };
    doneTimer = completed ? 1.3 : 0.9;
    if (completed) {
      result.textContent = o.resultText;
      o.audio.play(o.positive || o.test === 'thoracicXray' ? 'good' : 'uiClick');
    } else result.textContent = 'Inconcluso. Inténtalo otra vez con más ganas.';
  };

  const onDown = (e: PointerEvent) => {
    if (done) return;
    canvas.setPointerCapture(e.pointerId);
    down = true;
    const p = toCanvas(e);
    px = p.x;
    py = p.y;
    startX = p.x;
    startY = p.y;
    angle.lift();
    circles.lift();
    if (o.test === 'xray' && o.lesion) {
      const u = p.x / W;
      const v = p.y / H;
      const hit = xrayHit({ u, v }, o.lesion, 1.25 * o.leniency);
      marks.push({ u, v, hit });
      o.audio.play('whip', { volume: 0.7 });
      if (hit) {
        pop(p.x, p.y - 30, '¡Lesión!', '#3fcf9c');
        progress = 1;
        finish(true, true);
      } else {
        misses++;
        pop(p.x, p.y - 30, misses === 1 ? 'Eso es una mancha de café' : misses === 2 ? 'Mmm... no.' : 'Valerio suspira', '#ff4d6d');
        o.audio.play('miss');
        if (misses >= 3) finish(true, false);
      }
    }
  };
  const onMove = (e: PointerEvent) => {
    const p = toCanvas(e);
    px = p.x;
    py = p.y;
    if (!down || done) return;
    switch (o.test) {
      case 'drawer': {
        stroke.feed(p.x);
        const lim = o.positive ? 36 : 7;
        offset = clamp((p.x - startX) * 0.35, -lim, lim);
        progress = Math.min(1, stroke.strokes / 4);
        if (o.positive && Math.abs(offset) >= lim - 1 && t - lastSfx > 0.35) {
          lastSfx = t;
          o.audio.play('boneClonk', { volume: 0.5, pitch: 1.3 });
          pop(360, 150, '¡clonc!');
        }
        break;
      }
      case 'patella': {
        const before = angle.total;
        angle.feed(p.x, p.y);
        offset = Math.atan2(p.y - 190, p.x - 320);
        progress = Math.min(1, angle.total / (Math.PI * 2 * 1.4 / o.leniency));
        if (o.positive && Math.floor(before / Math.PI) !== Math.floor(angle.total / Math.PI)) {
          o.audio.play('boneClonk', { volume: 0.6 });
          pop(320, 110, '¡PLOP!');
        }
        break;
      }
      case 'crepitus': {
        const before = circles.total;
        circles.feed(p.x, p.y);
        crackAcc += circles.total - before;
        progress = Math.min(1, circles.total / (Math.PI * 2 * 3 / o.leniency));
        if (crackAcc > Math.PI * 0.9) {
          crackAcc = 0;
          if (o.positive) {
            o.audio.play('crunch', { volume: 0.55, pitch: 0.9 + Math.random() * 0.4 });
            pop(p.x + 20, p.y - 20, 'crk', '#c4136c');
          } else pop(p.x + 20, p.y - 20, '...', '#9d8aa6');
        }
        break;
      }
      case 'hipPalpation': {
        hipStroke.feed(p.y);
        offset = clamp((p.y - startY) / 120, -1, 1);
        progress = Math.min(1, hipStroke.strokes / 4);
        if (o.positive && offset < -0.8 && t - lastSfx > 0.6) {
          lastSfx = t;
          pop(520, 70, '¡auch!', '#ff4d6d');
        }
        break;
      }
      case 'carpusStress':
        load = clamp((p.y - startY) / 110, 0, 1);
        break;
      case 'thoracicXray':
        cover.mark(p.x, p.y, 34 * o.leniency);
        progress = Math.min(1, cover.fraction / 0.7);
        break;
    }
  };
  const onUp = () => {
    down = false;
    angle.lift();
    circles.lift();
    if (o.test === 'carpusStress') load = 0;
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  const onClick = (e: Event) => {
    const act = (e.target as HTMLElement).closest('[data-act]')?.getAttribute('data-act');
    if (act === 'cancel' && !done) {
      done = true;
      outcome = { completed: false };
      doneTimer = 0;
    }
  };
  modal.addEventListener('click', onClick);

  // ── dibujo ──
  function draw(): void {
    const fur = o.furColor;
    if (isPlate && o.plate) {
      g.drawImage(o.plate, 0, 0, W, H);
    } else bg(g, t);
    switch (o.test) {
      case 'drawer': {
        // vista lateral de la rodilla: fémur fijo, tibia deslizable
        const kx = 320;
        const ky = 175;
        limb(g, [[150, 70], [kx, ky]], 70, fur);
        limb(g, [[kx + offset, ky], [480 + offset, 300]], 58, fur);
        bone(g, 165, 80, kx - 12, ky - 6, 20);
        bone(g, kx + 10 + offset, ky + 8, 470 + offset, 292, 17);
        glove(g, 230, 112, 1.1, -0.5);
        glove(g, 400 + offset, 236, 1.1, 0.7);
        g.fillStyle = 'rgba(59,33,70,0.5)';
        g.font = '800 15px Nunito, sans-serif';
        g.fillText('fémur (sujeta)', 330, 80);
        g.fillText('tibia (desliza ⇆)', 150, 300);
        break;
      }
      case 'patella': {
        // vista frontal: surco troclear y rótula
        const cx = 320;
        const cy = 190;
        limb(g, [[cx, 20], [cx, 340]], 190, fur);
        g.fillStyle = '#fff6e0';
        g.strokeStyle = '#d8c39a';
        g.lineWidth = 3;
        roundRect(g, cx - 70, 40, 140, 280, 60);
        g.fill();
        g.stroke();
        g.fillStyle = '#efdcb8';
        roundRect(g, cx - 22, 70, 44, 220, 22);
        g.fill();
        let pxOff = Math.sin(offset * 2) * 6;
        if (o.positive) {
          const s = Math.sin(offset);
          if (s > 0.55) pxOff = -58 * Math.min(1, (s - 0.55) * 4);
        }
        g.fillStyle = '#fffaf0';
        g.strokeStyle = '#c9ab78';
        g.beginPath();
        g.ellipse(cx + pxOff, cy, 26, 36, 0, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        // guía circular
        g.setLineDash([8, 10]);
        g.strokeStyle = 'rgba(255,46,147,0.5)';
        g.lineWidth = 3;
        g.beginPath();
        g.arc(cx, cy, 120, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
        glove(g, cx + Math.cos(offset) * 120, cy + Math.sin(offset) * 120, 0.8, offset + Math.PI / 2);
        break;
      }
      case 'deepPain': {
        // patita con deditos y carita que reacciona
        limb(g, [[200, 20], [220, 230]], 80, fur);
        g.fillStyle = fur;
        g.strokeStyle = darker(fur, 0.6);
        g.lineWidth = 4;
        g.beginPath();
        g.ellipse(225, 260, 70, 48, 0, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        const toes: Array<[number, number]> = [
          [170, 300],
          [205, 318],
          [245, 318],
          [280, 300],
        ];
        g.fillStyle = '#ffb3c7';
        for (const [x, y] of toes) {
          g.beginPath();
          g.ellipse(x, y, 16, 13, 0, 0, Math.PI * 2);
          g.fill();
        }
        // pinzas
        const pinch = hold / 2.2;
        g.save();
        g.translate(245, 318);
        g.strokeStyle = '#9aa8b8';
        g.lineWidth = 8;
        g.lineCap = 'round';
        const open = 0.35 * (1 - (down ? Math.min(1, pinch + 0.3) : 0));
        for (const s of [-1, 1]) {
          g.beginPath();
          g.moveTo(0, 0);
          g.lineTo(150 * Math.cos(-0.5 + s * open), 150 * Math.sin(-0.5 + s * open));
          g.stroke();
        }
        g.restore();
        const react = pinch > 0.7;
        petFace(g, 500, 120, fur, react ? 'angry' : pinch > 0.35 ? 'ouch' : 'calm', react ? -1 : 0);
        if (react) bubble(g, 500, 40, '¡¿PERDÓN?!');
        // manómetro de presión
        g.fillStyle = 'rgba(59,33,70,0.15)';
        roundRect(g, 380, 300, 220, 22, 11);
        g.fill();
        g.fillStyle = '#ff2e93';
        roundRect(g, 380, 300, 220 * Math.min(1, pinch), 22, 11);
        g.fill();
        g.fillStyle = '#3b2146';
        g.font = '800 14px Nunito, sans-serif';
        g.fillText('presión de las pinzas', 392, 290);
        break;
      }
      case 'crepitus': {
        limb(g, [[40, 190], [600, 170]], 120, fur);
        bone(g, 70, 186, 300, 180, 30);
        bone(g, 312, 184, 570, 172, 30);
        g.strokeStyle = 'rgba(255,46,147,0.35)';
        g.setLineDash([6, 8]);
        g.lineWidth = 3;
        g.beginPath();
        g.arc(306, 182, 60, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
        glove(g, px, py, 0.9, Math.sin(t * 12) * 0.2);
        break;
      }
      case 'hipPalpation': {
        // pelvis a la izquierda, fémur que rota con la mano
        g.fillStyle = darker(fur, 0.95);
        g.beginPath();
        g.ellipse(150, 160, 120, 90, 0, 0, Math.PI * 2);
        g.fill();
        const a = 0.35 + offset * 0.6;
        const hx = 190;
        const hy = 160;
        const ex = hx + Math.cos(a) * 210;
        const ey = hy + Math.sin(a) * 210;
        limb(g, [[hx, hy], [ex, ey]], 70, fur);
        bone(g, hx + 10, hy, ex - 10, ey - 6, 20);
        g.fillStyle = '#fff6e0';
        g.beginPath();
        g.arc(hx, hy, 26, 0, Math.PI * 2);
        g.fill();
        glove(g, (hx + ex) / 2 + 20, (hy + ey) / 2, 1, a);
        petFace(g, 540, 110, fur, o.positive && offset < -0.8 ? 'ouch' : 'calm');
        g.fillStyle = 'rgba(59,33,70,0.5)';
        g.font = '800 15px Nunito, sans-serif';
        g.fillText('flexiona ↕ extiende', 300, 340);
        break;
      }
      case 'carpusStress': {
        const maxBend = o.positive ? 1.35 : 0.35;
        const bend = load * maxBend;
        const cx = 320;
        const cy = 210;
        limb(g, [[cx, 10], [cx, cy]], 64, fur);
        const px2 = cx + Math.sin(bend) * 110;
        const py2 = cy + Math.cos(bend) * 110;
        limb(g, [[cx, cy], [px2, py2]], 56, fur);
        bone(g, cx, 20, cx, cy - 6, 18);
        g.fillStyle = '#e8d9ff';
        g.fillRect(0, 330, W, 30);
        glove(g, cx + 70, cy - 60 + load * 30, 1.1, Math.PI);
        g.fillStyle = '#3b2146';
        g.font = '800 18px "Baloo 2", sans-serif';
        g.fillText(`carpo: ${Math.round(bend * 57)}°`, 450, 80);
        if (o.positive && load > 0.85) bubble(g, 470, 140, '¡se aplana!');
        break;
      }
      case 'thoracicXray': {
        // celdas ya barridas
        g.fillStyle = 'rgba(159,240,208,0.28)';
        const cw = W / 24;
        const ch = H / 14;
        for (let j = 0; j < 14; j++)
          for (let i = 0; i < 24; i++) if (cover.isHit(i, j)) g.fillRect(i * cw, j * ch, cw, ch);
        // lupa
        g.strokeStyle = '#ff8fc7';
        g.lineWidth = 5;
        g.beginPath();
        g.arc(px, py, 34 * o.leniency, 0, Math.PI * 2);
        g.stroke();
        g.lineWidth = 8;
        g.beginPath();
        g.moveTo(px + 26 * o.leniency, py + 26 * o.leniency);
        g.lineTo(px + 50 * o.leniency, py + 50 * o.leniency);
        g.stroke();
        break;
      }
      case 'xray': {
        for (const m of marks) {
          const x = m.u * W;
          const y = m.v * H;
          g.lineWidth = 4;
          g.strokeStyle = m.hit ? '#3fcf9c' : '#ff4d6d';
          if (m.hit) {
            g.beginPath();
            g.arc(x, y, 26, 0, Math.PI * 2);
            g.stroke();
          } else {
            g.beginPath();
            g.moveTo(x - 12, y - 12);
            g.lineTo(x + 12, y + 12);
            g.moveTo(x + 12, y - 12);
            g.lineTo(x - 12, y + 12);
            g.stroke();
          }
        }
        if (misses >= 2 && o.lesion && !marks.some((m) => m.hit)) {
          // pista suave tras dos fallos
          g.strokeStyle = `rgba(255,216,77,${0.4 + Math.sin(t * 6) * 0.3})`;
          g.lineWidth = 3;
          g.setLineDash([6, 6]);
          g.beginPath();
          g.arc(o.lesion.u * W, o.lesion.v * H, o.lesion.radius * W * 1.6, 0, Math.PI * 2);
          g.stroke();
          g.setLineDash([]);
        }
        // fusta como puntero
        g.save();
        g.translate(px, py);
        g.rotate(-0.7);
        g.fillStyle = '#ff8fc7';
        g.strokeStyle = '#c4136c';
        g.lineWidth = 2;
        roundRect(g, -3, 6, 6, 70, 3);
        g.fill();
        g.stroke();
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(-9, 10);
        g.lineTo(9, 10);
        g.closePath();
        g.fill();
        g.restore();
        break;
      }
    }
    // textos emergentes
    for (const p of pops) {
      g.globalAlpha = Math.min(1, p.life * 2);
      bubble(g, p.x, p.y - (0.9 - p.life) * 40, p.text, p.color);
    }
    g.globalAlpha = 1;
  }

  return {
    get finished() {
      return finished;
    },
    update(dt: number) {
      if (finished) return;
      t += dt;
      for (let i = pops.length - 1; i >= 0; i--) {
        pops[i].life -= dt;
        if (pops[i].life <= 0) pops.splice(i, 1);
      }
      if (!done) {
        if (o.test === 'deepPain') {
          if (down) {
            hold += dt;
            if (t - lastSfx > 0.5) {
              lastSfx = t;
              o.audio.play('tick', { volume: 0.4, pitch: 0.8 + hold * 0.3 });
            }
          } else hold = Math.max(0, hold - dt * 0.45);
          progress = Math.min(1, hold / (2.2 / o.leniency));
          if (progress >= 0.75 && !yelped) {
            yelped = true;
            o.audio.play('miss', { volume: 0.5, pitch: 1.6 });
          }
        }
        if (o.test === 'carpusStress') {
          if (load > 0.8) loadHeld += dt;
          progress = Math.min(1, loadHeld / (1.5 / o.leniency));
        }
        if (progress >= 1) finish(true, o.test === 'xray' ? true : undefined);
        else if (!isPlate && t > TIME_LIMIT) finish(progress >= 0.5);
      } else {
        doneTimer -= dt;
        if (doneTimer <= 0) {
          finished = true;
          o.onFinish(outcome);
          return;
        }
      }
      meter.style.width = `${(progress * 100).toFixed(0)}%`;
      tl.textContent = isPlate ? '' : `${Math.max(0, TIME_LIMIT - t).toFixed(1)} s`;
      draw();
    },
    dispose() {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      modal.removeEventListener('click', onClick);
      modal.remove();
    },
  };
}
