/** Texturas procedurales (Canvas) del quirófano kawaii. */
import * as THREE from 'three';
import { createRng } from '../../core/rng';
import { makeCanvas, shade } from './canvasUtil';

function toTex(c: HTMLCanvasElement, repeatX = 1, repeatY = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 4;
  return t;
}

function heartPath(g: CanvasRenderingContext2D, x: number, y: number, k: number): void {
  g.beginPath();
  g.moveTo(x, y + 0.9 * k);
  g.bezierCurveTo(x + 1.1 * k, y + 0.1 * k, x + 0.9 * k, y - 0.9 * k, x, y - 0.35 * k);
  g.bezierCurveTo(x - 0.9 * k, y - 0.9 * k, x - 1.1 * k, y + 0.1 * k, x, y + 0.9 * k);
  g.closePath();
}

/** Azulejos de pared: lila abajo, cenefa de corazones, menta arriba. Cubre 1,6 m × 3,2 m. */
export function wallTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 1024;
  const { c, g } = makeCanvas(W, H);
  const rng = createRng(11);
  const tile = 64; // 0,2 m
  const split = H - Math.round(H * (1.25 / 3.2));
  const drawTiles = (y0: number, y1: number, base: string) => {
    for (let y = y0; y < y1; y += tile) {
      for (let x = 0; x < W; x += tile) {
        const v = (rng() - 0.5) * 0.08;
        g.fillStyle = shade(base, v);
        g.fillRect(x, y, tile, tile);
        // Brillo esmaltado.
        const grd = g.createLinearGradient(x, y, x + tile, y + tile);
        grd.addColorStop(0, 'rgba(255,255,255,0.28)');
        grd.addColorStop(0.5, 'rgba(255,255,255,0)');
        grd.addColorStop(1, 'rgba(0,0,0,0.05)');
        g.fillStyle = grd;
        g.fillRect(x, y, tile, tile);
      }
    }
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 3;
    for (let y = y0; y <= y1; y += tile) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
    }
    for (let x = 0; x <= W; x += tile) {
      g.beginPath();
      g.moveTo(x, y0);
      g.lineTo(x, y1);
      g.stroke();
    }
  };
  drawTiles(0, split, '#bff5e2');
  drawTiles(split, H, '#d4b6ef');
  // Cenefa de corazones.
  g.fillStyle = '#fff6fb';
  g.fillRect(0, split - 14, W, 28);
  g.fillStyle = '#ff8fc7';
  g.fillRect(0, split - 16, W, 3);
  g.fillRect(0, split + 13, W, 3);
  for (let x = 16; x < W; x += 32) {
    g.fillStyle = (x / 32) % 2 < 1 ? '#ff8fc7' : '#b79cf2';
    heartPath(g, x, split, 7);
    g.fill();
  }
  // Zócalo.
  g.fillStyle = '#9d7ec4';
  g.fillRect(0, H - 20, W, 20);
  return toTex(c);
}

/** Suelo de baldosas menta y blancas con una estrellita en las juntas. */
export function floorTexture(): THREE.CanvasTexture {
  const S = 512;
  const { c, g } = makeCanvas(S, S);
  const rng = createRng(22);
  const n = 4;
  const t = S / n;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const base = (i + j) % 2 ? '#e9fbf4' : '#b8efdc';
      g.fillStyle = shade(base, (rng() - 0.5) * 0.05);
      g.fillRect(i * t, j * t, t, t);
      // Motas del terrazo.
      for (let k = 0; k < 40; k++) {
        g.fillStyle = rng() < 0.5 ? 'rgba(200,162,232,0.35)' : 'rgba(255,143,199,0.25)';
        g.fillRect(i * t + rng() * t, j * t + rng() * t, 2, 2);
      }
    }
  g.strokeStyle = 'rgba(160,140,190,0.6)';
  g.lineWidth = 3;
  for (let k = 0; k <= n; k++) {
    g.beginPath();
    g.moveTo(k * t, 0);
    g.lineTo(k * t, S);
    g.moveTo(0, k * t);
    g.lineTo(S, k * t);
    g.stroke();
  }
  g.fillStyle = '#ff8fc7';
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      heartPath(g, i * t, j * t, 5);
      g.fill();
    }
  return toTex(c);
}

/** Tela del paño quirúrgico lila con trama y corazoncitos tenues. */
export function drapeTexture(): THREE.CanvasTexture {
  const S = 256;
  const { c, g } = makeCanvas(S, S);
  const rng = createRng(33);
  g.fillStyle = '#c8a2e8';
  g.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 2) {
    g.fillStyle = `rgba(255,255,255,${0.03 + rng() * 0.04})`;
    g.fillRect(0, y, S, 1);
  }
  for (let x = 0; x < S; x += 2) {
    g.fillStyle = `rgba(80,40,120,${0.03 + rng() * 0.03})`;
    g.fillRect(x, 0, 1, S);
  }
  g.fillStyle = 'rgba(255,255,255,0.13)';
  for (let y = 16; y < S; y += 64)
    for (let x = 16 + ((y / 64) % 2) * 32; x < S; x += 64) {
      heartPath(g, x, y, 6);
      g.fill();
    }
  return toTex(c, 4, 4);
}

/** Cartel con texto (español) y un personaje hueso kawaii. */
export function posterTexture(title: string, lines: string[]): THREE.CanvasTexture {
  const { c, g } = makeCanvas(384, 512);
  const grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, '#fff6fb');
  grd.addColorStop(1, '#ffe0f0');
  g.fillStyle = grd;
  g.fillRect(0, 0, 384, 512);
  g.strokeStyle = '#ff8fc7';
  g.lineWidth = 14;
  g.strokeRect(7, 7, 370, 498);
  g.fillStyle = '#3b2146';
  g.textAlign = 'center';
  g.font = '800 40px "Baloo 2", "Nunito", system-ui, sans-serif';
  g.fillText(title, 192, 70);
  // Huesito con cara.
  g.save();
  g.translate(192, 215);
  g.fillStyle = '#fffaf0';
  g.strokeStyle = '#c9ae82';
  g.lineWidth = 5;
  g.beginPath();
  g.roundRect(-90, -22, 180, 44, 22);
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      g.moveTo(sx * 92 + 26, sy * 24);
      g.arc(sx * 92, sy * 24, 26, 0, Math.PI * 2);
    }
  g.fill();
  g.stroke();
  g.fillStyle = '#3b2146';
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.arc(sx * 24, -4, 6, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#ff8fc7';
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.ellipse(sx * 40, 8, 10, 6, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = '#3b2146';
  g.lineWidth = 4;
  g.beginPath();
  g.arc(0, 4, 9, 0.2, Math.PI - 0.2);
  g.stroke();
  g.restore();
  g.fillStyle = '#3b2146';
  g.font = '700 27px "Nunito", system-ui, sans-serif';
  lines.forEach((l, i) => g.fillText(l, 192, 340 + i * 40));
  return toTex(c);
}

/** Letrero luminoso de la puerta. */
export function signTexture(text: string): THREE.CanvasTexture {
  const { c, g } = makeCanvas(512, 128);
  g.fillStyle = '#3b2146';
  g.beginPath();
  g.roundRect(0, 0, 512, 128, 28);
  g.fill();
  g.fillStyle = '#ff8fc7';
  heartPath(g, 64, 64, 26);
  g.fill();
  g.fillStyle = '#fff6fb';
  g.font = '800 64px "Baloo 2", "Nunito", system-ui, sans-serif';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(text, 110, 70);
  return toTex(c);
}

/** Esfera de reloj de pared con orejitas. */
export function clockTexture(): { tex: THREE.CanvasTexture; draw(h: number, m: number): void } {
  const { c, g } = makeCanvas(256, 256);
  const tex = toTex(c);
  const draw = (h: number, m: number) => {
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = '#fff6fb';
    g.beginPath();
    g.arc(128, 128, 120, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#b79cf2';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath();
      g.arc(128 + Math.sin(a) * 96, 128 - Math.cos(a) * 96, i % 3 ? 5 : 9, 0, Math.PI * 2);
      g.fill();
    }
    g.lineCap = 'round';
    g.strokeStyle = '#3b2146';
    g.lineWidth = 10;
    const ah = ((h % 12) / 12 + m / 720) * Math.PI * 2;
    g.beginPath();
    g.moveTo(128, 128);
    g.lineTo(128 + Math.sin(ah) * 55, 128 - Math.cos(ah) * 55);
    g.stroke();
    g.strokeStyle = '#ff2e93';
    g.lineWidth = 6;
    const am = (m / 60) * Math.PI * 2;
    g.beginPath();
    g.moveTo(128, 128);
    g.lineTo(128 + Math.sin(am) * 82, 128 - Math.cos(am) * 82);
    g.stroke();
    g.fillStyle = '#ff2e93';
    heartPath(g, 128, 128, 10);
    g.fill();
    tex.needsUpdate = true;
  };
  draw(10, 10);
  return { tex, draw };
}

/** Gradiente vertical para el haz visible de la lámpara. */
export function beamTexture(): THREE.CanvasTexture {
  const { c, g } = makeCanvas(4, 256);
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
