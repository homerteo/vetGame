/** Texturas procedurales (Canvas 2D) de la clínica: suelos, carteles, letreros, charcos e iconos de partículas. */
import * as THREE from 'three';
import { createRng } from '../../core/rng';

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function tex(c: HTMLCanvasElement, repeat?: [number, number]): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

/** Baldosas pastel con junta y un brillo sutil. `pattern`: 'checker' | 'plain' | 'dots'. */
export function floorTexture(a: string, b: string, pattern: 'checker' | 'plain' | 'dots', grout = 'rgba(59,33,70,0.12)', seed = 1): THREE.CanvasTexture {
  const S = 256;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d')!;
  const n = 4;
  const cs = S / n;
  const rng = createRng(seed);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      g.fillStyle = pattern === 'checker' && (i + j) % 2 ? b : a;
      g.fillRect(i * cs, j * cs, cs, cs);
      // leve variación por baldosa
      g.fillStyle = `rgba(255,255,255,${0.05 + rng() * 0.07})`;
      g.fillRect(i * cs + 3, j * cs + 3, cs - 6, cs * 0.35);
      if (pattern === 'dots') {
        g.fillStyle = b;
        g.beginPath();
        g.arc(i * cs + cs / 2, j * cs + cs / 2, cs * 0.12, 0, Math.PI * 2);
        g.fill();
      }
    }
  g.strokeStyle = grout;
  g.lineWidth = 3;
  for (let k = 0; k <= n; k++) {
    g.beginPath();
    g.moveTo(k * cs, 0);
    g.lineTo(k * cs, S);
    g.moveTo(0, k * cs);
    g.lineTo(S, k * cs);
    g.stroke();
  }
  return tex(c);
}

/** Franjas de aviso de zona estéril (rosa/amarillo). */
export function hazardTexture(): THREE.CanvasTexture {
  const c = makeCanvas(256, 32);
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffe066';
  g.fillRect(0, 0, 256, 32);
  g.fillStyle = '#ff2e93';
  for (let x = -32; x < 288; x += 32) {
    g.beginPath();
    g.moveTo(x, 32);
    g.lineTo(x + 16, 32);
    g.lineTo(x + 32, 0);
    g.lineTo(x + 16, 0);
    g.closePath();
    g.fill();
  }
  return tex(c, [1, 1]);
}

/** Cartel con chiste: marco redondeado, título, cuerpo y un garabato (pata, hueso o corazón). */
export function posterTexture(p: { title: string; body: string; bg: string; fg: string }, doodle: number): THREE.CanvasTexture {
  const W = 256;
  const H = 340;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  roundRect(g, 0, 0, W, H, 22);
  g.fill();
  g.fillStyle = p.bg;
  roundRect(g, 10, 10, W - 20, H - 20, 16);
  g.fill();
  g.fillStyle = p.fg;
  g.textAlign = 'center';
  g.textBaseline = 'top';
  g.font = '800 26px "Baloo 2", "Nunito", sans-serif';
  const tl = p.title.split('\n');
  tl.forEach((l, i) => fitText(g, l, W / 2, 26 + i * 30, W - 40));
  // garabato
  const cy = 160 + (tl.length - 1) * 10;
  g.save();
  g.translate(W / 2, cy);
  g.fillStyle = p.fg;
  g.globalAlpha = 0.85;
  if (doodle % 3 === 0) drawPaw(g, 34);
  else if (doodle % 3 === 1) drawBone(g, 46);
  else drawHeart(g, 36, '#ff2e93');
  g.restore();
  g.globalAlpha = 1;
  g.fillStyle = p.fg;
  g.font = '700 21px "Nunito", sans-serif';
  p.body.split('\n').forEach((l, i) => fitText(g, l, W / 2, 225 + i * 26 + (tl.length - 1) * 8, W - 36));
  // cinta adhesiva
  g.fillStyle = 'rgba(255,255,255,0.65)';
  g.save();
  g.translate(W / 2, 8);
  g.rotate(-0.06);
  g.fillRect(-36, -9, 72, 18);
  g.restore();
  return tex(c);
}

function fitText(g: CanvasRenderingContext2D, t: string, x: number, y: number, maxW: number): void {
  const w = g.measureText(t).width;
  if (w > maxW) {
    g.save();
    g.translate(x, y);
    g.scale(maxW / w, 1);
    g.fillText(t, 0, 0);
    g.restore();
  } else g.fillText(t, x, y);
}

export function drawPaw(g: CanvasRenderingContext2D, s: number): void {
  g.beginPath();
  g.ellipse(0, s * 0.35, s * 0.55, s * 0.45, 0, 0, Math.PI * 2);
  g.fill();
  const toes: Array<[number, number]> = [
    [-0.62, -0.25],
    [-0.22, -0.62],
    [0.22, -0.62],
    [0.62, -0.25],
  ];
  for (const [x, y] of toes) {
    g.beginPath();
    g.ellipse(x * s, y * s, s * 0.2, s * 0.26, 0, 0, Math.PI * 2);
    g.fill();
  }
}

export function drawBone(g: CanvasRenderingContext2D, s: number): void {
  g.fillRect(-s * 0.7, -s * 0.12, s * 1.4, s * 0.24);
  for (const x of [-0.7, 0.7])
    for (const y of [-0.16, 0.16]) {
      g.beginPath();
      g.arc(x * s, y * s, s * 0.2, 0, Math.PI * 2);
      g.fill();
    }
}

export function drawHeart(g: CanvasRenderingContext2D, s: number, color: string): void {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(0, s * 0.35);
  g.bezierCurveTo(-s * 1.1, -s * 0.35, -s * 0.45, -s * 1.05, 0, -s * 0.45);
  g.bezierCurveTo(s * 0.45, -s * 1.05, s * 1.1, -s * 0.35, 0, s * 0.35);
  g.fill();
}

/** Letrero de puerta: píldora con texto. */
export function signTexture(text: string, bg: string, fg: string, sub?: string): THREE.CanvasTexture {
  const W = 512;
  const H = 128;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  roundRect(g, 0, 0, W, H, 60);
  g.fill();
  g.fillStyle = bg;
  roundRect(g, 8, 8, W - 16, H - 16, 52);
  g.fill();
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '800 52px "Baloo 2", "Nunito", sans-serif';
  fitText(g, text, W / 2, sub ? 52 : 66, W - 60);
  if (sub) {
    g.font = '700 26px "Nunito", sans-serif';
    fitText(g, sub, W / 2, 96, W - 80);
  }
  return tex(c);
}

/** Charco: disco translúcido con reflejos. */
export function puddleTexture(): THREE.CanvasTexture {
  const S = 128;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d')!;
  const rng = createRng(9);
  g.fillStyle = 'rgba(160,220,255,0.55)';
  g.beginPath();
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const r = S * 0.42 * (0.85 + rng() * 0.15);
    const x = S / 2 + Math.cos(a) * r;
    const y = S / 2 + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.beginPath();
  g.ellipse(S * 0.4, S * 0.38, S * 0.14, S * 0.05, -0.5, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(S * 0.62, S * 0.62, S * 0.06, S * 0.025, -0.5, 0, Math.PI * 2);
  g.fill();
  return tex(c);
}

export type ParticleKind = 'heart' | 'star' | 'steam' | 'sparkle' | 'drop' | 'note' | 'fur' | 'bang';

/** Atlas de iconos de partículas (un lienzo por tipo). */
export function particleTextures(): Record<ParticleKind, THREE.CanvasTexture> {
  const mk = (draw: (g: CanvasRenderingContext2D) => void) => {
    const c = makeCanvas(64, 64);
    const g = c.getContext('2d')!;
    g.translate(32, 32);
    draw(g);
    return tex(c);
  };
  return {
    heart: mk((g) => {
      drawHeart(g, 26, '#ff4fa8');
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.beginPath();
      g.ellipse(-9, -10, 5, 3, -0.6, 0, Math.PI * 2);
      g.fill();
    }),
    star: mk((g) => {
      g.fillStyle = '#ffd84d';
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 11 : 27;
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
      g.strokeStyle = '#fff6c2';
      g.lineWidth = 3;
      g.stroke();
    }),
    steam: mk((g) => {
      const gr = g.createRadialGradient(0, 0, 2, 0, 0, 30);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(0, 0, 30, 0, Math.PI * 2);
      g.fill();
    }),
    sparkle: mk((g) => {
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(0, -30);
      g.quadraticCurveTo(4, -4, 30, 0);
      g.quadraticCurveTo(4, 4, 0, 30);
      g.quadraticCurveTo(-4, 4, -30, 0);
      g.quadraticCurveTo(-4, -4, 0, -30);
      g.fill();
    }),
    drop: mk((g) => {
      g.fillStyle = '#8fd3ff';
      g.beginPath();
      g.moveTo(0, -24);
      g.quadraticCurveTo(18, 4, 0, 22);
      g.quadraticCurveTo(-18, 4, 0, -24);
      g.fill();
    }),
    note: mk((g) => {
      g.fillStyle = '#b79cf2';
      g.beginPath();
      g.ellipse(-8, 14, 10, 7, -0.4, 0, Math.PI * 2);
      g.fill();
      g.fillRect(0, -24, 5, 38);
      g.fillRect(0, -24, 18, 6);
    }),
    fur: mk((g) => {
      g.strokeStyle = '#e8c9a0';
      g.lineWidth = 4;
      g.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        g.beginPath();
        g.moveTo(-18 + i * 10, 18);
        g.quadraticCurveTo(-10 + i * 10, 0, -14 + i * 10, -18);
        g.stroke();
      }
    }),
    bang: mk((g) => {
      g.fillStyle = '#ff2e93';
      g.beginPath();
      g.arc(0, 0, 28, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.font = '900 40px "Baloo 2", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('!', 0, 3);
    }),
  };
}

/** Papel de aluminio arrugado (textura de rugosidad/color). */
export function foilTexture(): THREE.CanvasTexture {
  const S = 128;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d')!;
  const rng = createRng(55);
  g.fillStyle = '#c9ced8';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 70; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const s = 8 + rng() * 22;
    const l = 150 + rng() * 105;
    g.fillStyle = `rgb(${l},${l + 3},${l + 10})`;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + s, y + rng() * s * 0.6);
    g.lineTo(x + rng() * s * 0.5, y + s);
    g.closePath();
    g.fill();
  }
  return tex(c);
}

/** Etiqueta de texto sobre fondo transparente (nombre en el transportín, "5G", etc.). */
export function labelTexture(text: string, color: string, font = '800 64px "Baloo 2", sans-serif', w = 256, h = 96): THREE.CanvasTexture {
  const c = makeCanvas(w, h);
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  fitText(g, text, w / 2, h / 2, w - 12);
  return tex(c);
}
