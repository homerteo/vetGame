/**
 * Texturas procedurales de las capas de tejido (se pintan una sola vez al crear la herida).
 * Todas trabajan en píxeles del lienzo de herida; `s` = px por mm.
 */
import type { AnatomyDef, Vec2 } from '../../core/contracts';
import { clamp, pointInPolygon, polygonCentroid } from '../../core/math';
import { createRng } from '../../core/rng';
import { hash2, scalePolygon } from './woundMath';
import { makeCanvas, shade, tracePoly, traceSmoothPoly } from './canvasUtil';

type Ctx = CanvasRenderingContext2D;

/** Ángulo principal (grados) de la incisión: las fibras musculares la siguen. */
export function incisionAngleDeg(path: Vec2[]): number {
  if (path.length < 2) return 0;
  const a = path[0];
  const b = path[path.length - 1];
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

/** Zona rasurada: superelipse irregular centrada en la herida. */
function shavedShape(W: number, H: number, s: number): Vec2[] {
  const out: Vec2[] = [];
  const cx = W / 2;
  const cy = H / 2;
  const rx = 67 * s;
  const ry = 39 * s;
  const n = 140;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const e = 0.42;
    const jag = 1 + (hash2(i * 3.1, 7.7) - 0.5) * 0.05 + Math.sin(a * 9) * 0.012;
    out.push({ x: (cx + rx * Math.sign(c) * Math.pow(Math.abs(c), e) * jag) / s, y: (cy + ry * Math.sign(sn) * Math.pow(Math.abs(sn), e) * jag) / s });
  }
  return out;
}

export function paintSkin(g: Ctx, W: number, H: number, s: number, anatomy: AnatomyDef, incision: Vec2[]): void {
  const rng = createRng(1234);
  const tone = anatomy.skinTone;
  g.fillStyle = tone;
  g.fillRect(0, 0, W, H);

  // Moteado suave de la piel.
  for (let i = 0; i < 70; i++) {
    const x = rng() * W;
    const y = rng() * H;
    const r = 20 + rng() * 90;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const c = rng() < 0.5 ? shade(tone, -0.12, 0.18) : shade(tone, 0.18, 0.16);
    grd.addColorStop(0, c);
    grd.addColorStop(1, shade(tone, 0, 0));
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Pliegues finos.
  g.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const x = rng() * W;
    const y = rng() * H;
    g.strokeStyle = shade(tone, -0.25, 0.09);
    g.lineWidth = 0.8 + rng();
    g.beginPath();
    g.moveTo(x, y);
    g.bezierCurveTo(x + 30 + rng() * 40, y + (rng() - 0.5) * 20, x + 60 + rng() * 40, y + (rng() - 0.5) * 20, x + 90 + rng() * 60, y + (rng() - 0.5) * 16);
    g.stroke();
  }
  // Poros, folículos y cañones de pelo rasurado.
  const stub = shade(anatomy.furColor, -0.55, 0.45);
  for (let i = 0; i < 11000; i++) {
    const x = rng() * W;
    const y = rng() * H;
    const k = rng();
    if (k < 0.45) {
      g.fillStyle = shade(tone, -0.35, 0.28);
      g.fillRect(x, y, 1.1, 1.1);
    } else if (k < 0.7) {
      g.fillStyle = shade(tone, 0.35, 0.35);
      g.fillRect(x, y, 1, 1);
    } else {
      g.strokeStyle = stub;
      g.lineWidth = 0.9;
      const a = 0.6 + rng() * 0.5;
      const l = 1.2 + rng() * 1.6;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
  }

  // Mancha de antiséptico azulada alrededor de la incisión (clorhexidina teñida).
  const { c: stainC, g: sg } = makeCanvas(W, H);
  const pts = incision.length >= 2 ? incision : [{ x: 30, y: 50 }, { x: 130, y: 50 }];
  sg.fillStyle = '#000';
  for (let i = 0; i < pts.length - 1; i++) {
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      const x = (pts[i].x + (pts[i + 1].x - pts[i].x) * t) * s + (rng() - 0.5) * 30;
      const y = (pts[i].y + (pts[i + 1].y - pts[i].y) * t) * s + (rng() - 0.5) * 24;
      sg.beginPath();
      sg.ellipse(x, y, (16 + rng() * 8) * s, (14 + rng() * 6) * s, rng() * 0.5, 0, Math.PI * 2);
      sg.fill();
    }
  }
  // Borde algo más intenso (la solución se acumula al secar).
  sg.globalCompositeOperation = 'source-in';
  const sgr = sg.createRadialGradient(W / 2, H / 2, 40 * s, W / 2, H / 2, 70 * s);
  sgr.addColorStop(0, 'rgba(100,150,245,0.3)');
  sgr.addColorStop(0.8, 'rgba(90,140,240,0.38)');
  sgr.addColorStop(1, 'rgba(70,110,225,0.55)');
  sg.fillStyle = sgr;
  sg.fillRect(0, 0, W, H);
  sg.globalCompositeOperation = 'source-over';
  // Pasadas de gasa.
  sg.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 30; i++) {
    sg.strokeStyle = `rgba(70,90,220,${0.05 + rng() * 0.07})`;
    sg.lineWidth = 6 + rng() * 14;
    sg.beginPath();
    const x = W * 0.2 + rng() * W * 0.6;
    const y = H * 0.25 + rng() * H * 0.5;
    sg.arc(x, y, 20 + rng() * 60, rng() * 6, rng() * 6 + 1.5);
    sg.stroke();
  }
  sg.globalCompositeOperation = 'source-over';
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.filter = 'blur(5px)';
  g.drawImage(stainC, 0, 0);
  g.restore();

  // Pelaje en el borde (zona no rasurada).
  const shaved = shavedShape(W, H, s);
  const { c: furC, g: fg } = makeCanvas(W, H);
  const fur = anatomy.furColor;
  fg.fillStyle = shade(fur, -0.1);
  fg.fillRect(0, 0, W, H);
  fg.lineCap = 'round';
  const cx = W / 2;
  const cy = H / 2;
  const inner = scalePolygon(shaved, { x: cx / s, y: cy / s }, 0.96, 0.93);
  for (let i = 0; i < 26000; i++) {
    const x = rng() * W;
    const y = rng() * H;
    if (pointInPolygon({ x: x / s, y: y / s }, inner)) continue;
    const out = Math.atan2(y - cy, (x - cx) * 0.6);
    const a = out + (hash2(x * 0.01, y * 0.013) - 0.5) * 1.3;
    const l = 4 + rng() * 7;
    const k = rng();
    fg.strokeStyle = k < 0.35 ? shade(fur, 0.28, 0.9) : k < 0.75 ? shade(fur, -0.05, 0.85) : shade(fur, -0.35, 0.8);
    fg.lineWidth = 0.9 + rng() * 1.1;
    fg.beginPath();
    fg.moveTo(x, y);
    fg.quadraticCurveTo(x + Math.cos(a) * l * 0.6 + 1, y + Math.sin(a) * l * 0.6, x + Math.cos(a) * l, y + Math.sin(a) * l);
    fg.stroke();
  }
  fg.globalCompositeOperation = 'destination-out';
  tracePoly(fg, shaved, s);
  fg.fill();
  fg.globalCompositeOperation = 'source-over';
  // Mechones que invaden un poco la zona rasurada.
  for (let i = 0; i < 1400; i++) {
    const p = shaved[Math.floor(rng() * shaved.length)];
    const x = p.x * s + (rng() - 0.5) * 6;
    const y = p.y * s + (rng() - 0.5) * 6;
    const a = Math.atan2(cy - y, (cx - x) * 0.6) + (rng() - 0.5) * 1.2;
    const l = 2 + rng() * 5;
    fg.strokeStyle = rng() < 0.5 ? shade(fur, 0.2, 0.8) : shade(fur, -0.2, 0.8);
    fg.lineWidth = 0.8 + rng() * 0.8;
    fg.beginPath();
    fg.moveTo(x, y);
    fg.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    fg.stroke();
  }
  // Borde irritado por la rasuradora (rosado sutil).
  g.save();
  g.strokeStyle = shade(tone, -0.15, 0.25);
  g.lineWidth = 3 * s;
  g.filter = 'blur(6px)';
  tracePoly(g, shaved, s);
  g.stroke();
  g.filter = 'none';
  g.restore();
  g.save();
  g.shadowColor = 'rgba(40,10,20,0.35)';
  g.shadowBlur = 7;
  g.shadowOffsetY = 2;
  g.drawImage(furC, 0, 0);
  g.restore();

  paintDrapeEdge(g, W, H, s);
}

/** Borde del paño estéril lila (tejido con trama) con sombra hacia dentro. */
export function paintDrapeEdge(g: Ctx, W: number, H: number, s: number): void {
  const rng = createRng(99);
  const band = 5.5 * s;
  const { c, g: dg } = makeCanvas(W, H);
  dg.fillStyle = '#c8a2e8';
  dg.fillRect(0, 0, W, H);
  // Trama del tejido.
  dg.lineWidth = 1;
  for (let x = 0; x < W; x += 3) {
    dg.strokeStyle = `rgba(255,255,255,${0.05 + rng() * 0.05})`;
    dg.beginPath();
    dg.moveTo(x, 0);
    dg.lineTo(x, H);
    dg.stroke();
  }
  for (let y = 0; y < H; y += 3) {
    dg.strokeStyle = `rgba(90,50,130,${0.05 + rng() * 0.04})`;
    dg.beginPath();
    dg.moveTo(0, y);
    dg.lineTo(W, y);
    dg.stroke();
  }
  // Recorta la ventana (borde ligeramente ondulado).
  dg.globalCompositeOperation = 'destination-out';
  dg.beginPath();
  const n = 60;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) pts.push([band + (i / n) * (W - 2 * band), band + Math.sin(i * 1.3) * 1.5]);
  for (let i = 0; i <= n; i++) pts.push([W - band + Math.sin(i * 1.1) * 1.5, band + (i / n) * (H - 2 * band)]);
  for (let i = 0; i <= n; i++) pts.push([W - band - (i / n) * (W - 2 * band), H - band + Math.sin(i * 1.7) * 1.5]);
  for (let i = 0; i <= n; i++) pts.push([band + Math.sin(i * 1.2) * 1.5, H - band - (i / n) * (H - 2 * band)]);
  dg.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts) dg.lineTo(p[0], p[1]);
  dg.closePath();
  dg.fill();
  dg.globalCompositeOperation = 'source-over';
  // Pliegue claro en el borde interior.
  dg.globalCompositeOperation = 'source-atop';
  dg.strokeStyle = 'rgba(255,240,255,0.5)';
  dg.lineWidth = 2;
  dg.strokeRect(band - 1, band - 1, W - 2 * band + 2, H - 2 * band + 2);
  dg.globalCompositeOperation = 'source-over';
  g.save();
  g.shadowColor = 'rgba(40,10,50,0.55)';
  g.shadowBlur = 14;
  g.drawImage(c, 0, 0);
  g.restore();
}

export function paintSubcut(g: Ctx, W: number, H: number, s: number): void {
  const rng = createRng(4321);
  g.fillStyle = '#e9b95a';
  g.fillRect(0, 0, W, H);
  // Lóbulos de grasa (empedrado).
  const n = Math.round((W * H) / 150);
  for (let i = 0; i < n; i++) {
    const x = rng() * W;
    const y = rng() * H;
    const r = 5 + rng() * 11;
    const grd = g.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
    grd.addColorStop(0, 'rgba(255,244,190,1)');
    grd.addColorStop(0.45, 'rgba(249,214,112,1)');
    grd.addColorStop(0.85, 'rgba(228,170,72,0.95)');
    grd.addColorStop(1, 'rgba(196,128,60,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.ellipse(x, y, r, r * (0.8 + rng() * 0.35), rng() * 3, 0, Math.PI * 2);
    g.fill();
  }
  // Tabiques rosados y capilares.
  g.lineCap = 'round';
  for (let i = 0; i < 90; i++) {
    g.strokeStyle = `rgba(${170 + rng() * 40},${40 + rng() * 30},${50},${0.25 + rng() * 0.3})`;
    g.lineWidth = 0.6 + rng() * 0.9;
    let x = rng() * W;
    let y = rng() * H;
    g.beginPath();
    g.moveTo(x, y);
    const steps = 6 + Math.floor(rng() * 10);
    let a = rng() * Math.PI * 2;
    for (let k = 0; k < steps; k++) {
      a += (rng() - 0.5) * 1.2;
      x += Math.cos(a) * 9;
      y += Math.sin(a) * 9;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // Brillo húmedo.
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(255,255,240,${0.25 + rng() * 0.4})`;
    g.beginPath();
    g.arc(rng() * W, rng() * H, 0.6 + rng() * 1.4, 0, Math.PI * 2);
    g.fill();
  }
}

export function paintFascia(g: Ctx, W: number, H: number, s: number, angleDeg: number): void {
  const rng = createRng(777);
  const lg = g.createLinearGradient(0, 0, W, H);
  lg.addColorStop(0, '#f6f0f5');
  lg.addColorStop(0.5, '#e6e1f0');
  lg.addColorStop(1, '#f3edf2');
  g.fillStyle = lg;
  g.fillRect(0, 0, W, H);
  // Irisación nacarada.
  const tints = ['rgba(159,240,208,0.10)', 'rgba(255,143,199,0.08)', 'rgba(183,156,242,0.10)'];
  for (let i = 0; i < 24; i++) {
    const x = rng() * W;
    const y = rng() * H;
    const r = 60 + rng() * 120;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, tints[i % 3]);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.save();
  g.translate(W / 2, H / 2);
  g.rotate(((angleDeg + 9) * Math.PI) / 180);
  const D = Math.hypot(W, H);
  g.lineCap = 'round';
  for (let i = 0; i < 2600; i++) {
    const y = (rng() - 0.5) * D;
    const x = (rng() - 0.5) * D;
    const l = 30 + rng() * 110;
    g.strokeStyle = rng() < 0.6 ? `rgba(255,255,255,${0.2 + rng() * 0.3})` : `rgba(170,160,200,${0.1 + rng() * 0.15})`;
    g.lineWidth = 0.5 + rng() * 1.1;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + l / 2, y + (rng() - 0.5) * 3, x + l, y + (rng() - 0.5) * 2);
    g.stroke();
  }
  // Vetas de brillo.
  for (let i = 0; i < 8; i++) {
    const y = (rng() - 0.5) * D * 0.6;
    const grd = g.createLinearGradient(0, y - 18, 0, y + 18);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.5, `rgba(255,255,255,${0.18 + rng() * 0.15})`);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(-D / 2, y - 18, D, 36);
  }
  g.restore();
}

export function paintMuscle(g: Ctx, W: number, H: number, s: number, angleDeg: number): void {
  const rng = createRng(5555);
  g.fillStyle = '#8f1822';
  g.fillRect(0, 0, W, H);
  g.save();
  g.translate(W / 2, H / 2);
  g.rotate((angleDeg * Math.PI) / 180);
  const D = Math.hypot(W, H);
  const cols = ['#7a1019', '#a52632', '#bb3440', '#8c1822', '#c9424c', '#96202b'];
  g.lineCap = 'round';
  // Fibras paralelas a la incisión, ligeramente onduladas.
  let y = -D / 2;
  while (y < D / 2) {
    const w = 1.6 + rng() * 3.2;
    g.strokeStyle = cols[Math.floor(rng() * cols.length)];
    g.globalAlpha = 0.55 + rng() * 0.45;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(-D / 2, y);
    for (let x = -D / 2; x <= D / 2; x += 80) g.quadraticCurveTo(x + 40, y + (rng() - 0.5) * 2.4, x + 80, y + (rng() - 0.5) * 1.2);
    g.stroke();
    y += w * (0.55 + rng() * 0.4);
  }
  g.globalAlpha = 1;
  // Estriación fina transversal (sutil).
  for (let x = -D / 2; x < D / 2; x += 2.2) {
    g.strokeStyle = `rgba(60,0,10,${0.04 + rng() * 0.05})`;
    g.lineWidth = 0.7;
    g.beginPath();
    g.moveTo(x, -D / 2);
    g.lineTo(x + (rng() - 0.5) * 2, D / 2);
    g.stroke();
  }
  // Perimisio: separaciones claras entre fascículos.
  for (let yy = -D / 2; yy < D / 2; yy += 16 + rng() * 22) {
    g.strokeStyle = `rgba(255,215,220,${0.12 + rng() * 0.12})`;
    g.lineWidth = 0.8 + rng() * 0.8;
    g.beginPath();
    g.moveTo(-D / 2, yy);
    for (let x = -D / 2; x <= D / 2; x += 60) g.quadraticCurveTo(x + 30, yy + (rng() - 0.5) * 5, x + 60, yy + (rng() - 0.5) * 3);
    g.stroke();
    g.strokeStyle = 'rgba(50,0,8,0.25)';
    g.lineWidth = 1.4;
    g.stroke();
  }
  // Brillo húmedo en bandas.
  for (let i = 0; i < 10; i++) {
    const yy = (rng() - 0.5) * D * 0.7;
    const grd = g.createLinearGradient(0, yy - 14, 0, yy + 14);
    grd.addColorStop(0, 'rgba(255,190,200,0)');
    grd.addColorStop(0.5, `rgba(255,200,210,${0.08 + rng() * 0.1})`);
    grd.addColorStop(1, 'rgba(255,190,200,0)');
    g.fillStyle = grd;
    g.fillRect(-D / 2, yy - 14, D, 28);
  }
  g.restore();
  // Vasos pequeños.
  for (let i = 0; i < 14; i++) {
    g.strokeStyle = 'rgba(70,0,20,0.35)';
    g.lineWidth = 1 + rng();
    let x = rng() * W;
    let yy = rng() * H;
    g.beginPath();
    g.moveTo(x, yy);
    let a = rng() * 6.28;
    for (let k = 0; k < 8; k++) {
      a += (rng() - 0.5) * 0.9;
      x += Math.cos(a) * 12;
      yy += Math.sin(a) * 12;
      g.lineTo(x, yy);
    }
    g.stroke();
  }
}

/** Fondo profundo: lecho muscular y cavidad oscura de la ventana; médula si la hay. */
export function paintDeep(g: Ctx, W: number, H: number, s: number, anatomy: AnatomyDef): void {
  const rng = createRng(2468);
  g.fillStyle = '#4a0c13';
  g.fillRect(0, 0, W, H);
  const win = anatomy.window;
  if (win.length >= 3) {
    const c = polygonCentroid(win);
    const big = scalePolygon(win, c, 1.12, 1.25);
    const grd = g.createRadialGradient(c.x * s, c.y * s, 4 * s, c.x * s, c.y * s, 62 * s);
    grd.addColorStop(0, '#7a1620');
    grd.addColorStop(0.45, '#4d0a12');
    grd.addColorStop(1, '#1c0205');
    g.save();
    g.fillStyle = grd;
    g.filter = 'blur(6px)';
    traceSmoothPoly(g, big, s);
    g.fill();
    g.filter = 'none';
    g.restore();
    // Fibras de tejido conectivo.
    g.save();
    traceSmoothPoly(g, big, s);
    g.clip();
    g.lineCap = 'round';
    for (let i = 0; i < 180; i++) {
      const x = (c.x + (rng() - 0.5) * 120) * s;
      const y = (c.y + (rng() - 0.5) * 40) * s;
      g.strokeStyle = rng() < 0.5 ? `rgba(160,50,60,${0.12 + rng() * 0.15})` : `rgba(20,0,4,${0.2 + rng() * 0.2})`;
      g.lineWidth = 0.8 + rng() * 2;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + 20 + rng() * 20, y + (rng() - 0.5) * 12, x + 40 + rng() * 40, y + (rng() - 0.5) * 8);
      g.stroke();
    }
    // Brillos húmedos puntuales.
    for (let i = 0; i < 220; i++) {
      g.fillStyle = `rgba(255,190,190,${0.15 + rng() * 0.3})`;
      g.beginPath();
      g.arc((c.x + (rng() - 0.5) * 110) * s, (c.y + (rng() - 0.5) * 34) * s, 0.5 + rng() * 1.2, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }
  if (anatomy.cord && anatomy.cord.length >= 3) paintCord(g, s, anatomy.cord, rng);
}

function paintCord(g: Ctx, s: number, cord: Vec2[], rng: () => number): void {
  const c = polygonCentroid(cord);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of cord) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.5)';
  g.shadowBlur = 10;
  const lg = g.createLinearGradient(0, minY * s, 0, maxY * s);
  lg.addColorStop(0, '#d8c09c');
  lg.addColorStop(0.3, '#fbf0dc');
  lg.addColorStop(0.55, '#f4e4c6');
  lg.addColorStop(1, '#c9a980');
  g.fillStyle = lg;
  traceSmoothPoly(g, cord, s);
  g.fill();
  g.restore();
  g.save();
  traceSmoothPoly(g, cord, s);
  g.clip();
  // Vasos sanguíneos (arteria espinal dorsal y ramas).
  g.lineCap = 'round';
  for (let v = 0; v < 2; v++) {
    const yy = c.y + (v === 0 ? -1.2 : 1.6);
    g.strokeStyle = v === 0 ? 'rgba(190,30,40,0.75)' : 'rgba(120,20,60,0.6)';
    g.lineWidth = v === 0 ? 1.8 : 1.3;
    g.beginPath();
    let x = 0;
    g.moveTo(x, yy * s);
    while (x < 1100) {
      x += 30;
      g.quadraticCurveTo(x - 15, (yy + (rng() - 0.5) * 1.6) * s, x, (yy + (rng() - 0.5) * 0.8) * s);
    }
    g.stroke();
  }
  for (let i = 0; i < 40; i++) {
    const x = rng() * 1024;
    const y0 = (c.y - 1) * s;
    g.strokeStyle = `rgba(180,40,50,${0.3 + rng() * 0.3})`;
    g.lineWidth = 0.7;
    g.beginPath();
    g.moveTo(x, y0);
    g.quadraticCurveTo(x + (rng() - 0.5) * 20, y0 + (rng() - 0.5) * 20, x + (rng() - 0.5) * 30, y0 + (rng() < 0.5 ? -1 : 1) * 18);
    g.stroke();
  }
  // Brillo de la duramadre.
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, (c.y - 2.4) * s);
  g.lineTo(1024, (c.y - 2.2) * s);
  g.stroke();
  g.restore();
}

/** Patrón trabecular (hueso esponjoso), repetible. */
export function makeTrabecularPattern(size = 96): HTMLCanvasElement {
  const rng = createRng(31337);
  const { c, g } = makeCanvas(size, size);
  g.fillStyle = '#f1e4c8';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 46; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const rx = 2 + rng() * 4.5;
    const ry = rx * (0.5 + rng() * 0.6);
    const rot = rng() * 3;
    for (const ox of [-size, 0, size])
      for (const oy of [-size, 0, size]) {
        g.fillStyle = 'rgba(196,160,112,0.8)';
        g.beginPath();
        g.ellipse(x + ox, y + oy, rx, ry, rot, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(150,100,70,0.45)';
        g.beginPath();
        g.ellipse(x + ox + 0.6, y + oy + 0.6, rx * 0.6, ry * 0.6, rot, 0, Math.PI * 2);
        g.fill();
      }
  }
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(255,252,240,${0.4 + rng() * 0.5})`;
    g.fillRect(rng() * size, rng() * size, 1, 1);
  }
  return c;
}

/** Ruido/grano para los rayos X. */
export function makeXrayGrain(W: number, H: number): HTMLCanvasElement {
  const rng = createRng(4242);
  const { c, g } = makeCanvas(W, H);
  const img = g.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const v = 128 + (rng() - 0.5) * 90;
    const o = i * 4;
    img.data[o] = v;
    img.data[o + 1] = v;
    img.data[o + 2] = clamp(v + 12, 0, 255);
    img.data[o + 3] = 22;
  }
  g.putImageData(img, 0, 0);
  // Líneas de barrido.
  g.fillStyle = 'rgba(160,200,255,0.035)';
  for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
  return c;
}
