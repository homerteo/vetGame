/**
 * Texturas procedurales (Canvas 2D) para personajes: rejilla de medias, estampado de camiseta,
 * atigrado de gato y emotes. Las de emotes se comparten entre rigs (no se liberan por rig).
 */
import * as THREE from 'three';
import type { Emote } from '../core/contracts';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('Canvas 2D no disponible');
  return [c, g];
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

/** Medias de rejilla: rombos oscuros sobre el tono de piel. */
export function fishnetTexture(skin: string, net = '#241226', repeat: [number, number] = [7, 5]): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = skin;
  g.fillRect(0, 0, 128, 128);
  // leve tinte oscuro de la media
  g.fillStyle = 'rgba(40,10,40,0.12)';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = net;
  g.lineWidth = 7;
  g.lineCap = 'round';
  for (let k = -2; k <= 2; k++) {
    g.beginPath();
    g.moveTo(k * 128, 0);
    g.lineTo(k * 128 + 128, 128);
    g.stroke();
    g.beginPath();
    g.moveTo(k * 128 + 128, 0);
    g.lineTo(k * 128, 128);
    g.stroke();
  }
  // nudos
  g.fillStyle = net;
  for (const [x, y] of [[0, 0], [128, 0], [0, 128], [128, 128], [64, 64]]) {
    g.beginPath();
    g.arc(x, y, 6, 0, Math.PI * 2);
    g.fill();
  }
  return tex(c, repeat);
}

/** Estampado de camiseta de rock (relámpago y letras), fondo transparente. */
export function rockTeeTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.clearRect(0, 0, 256, 256);
  g.fillStyle = '#f5c542';
  g.strokeStyle = '#ff2e93';
  g.lineWidth = 8;
  g.beginPath();
  g.moveTo(140, 24);
  g.lineTo(84, 132);
  g.lineTo(124, 132);
  g.lineTo(104, 232);
  g.lineTo(176, 108);
  g.lineTo(134, 108);
  g.lineTo(162, 24);
  g.closePath();
  g.stroke();
  g.fill();
  g.font = 'bold 54px "Baloo 2", system-ui, sans-serif';
  g.textAlign = 'center';
  g.lineWidth = 6;
  g.strokeStyle = '#1a1420';
  g.strokeText('ROCK', 128, 150);
  g.fillStyle = '#ffffff';
  g.fillText('ROCK', 128, 150);
  return tex(c);
}

/** Pelaje atigrado (gato): rayas onduladas. */
export function tabbyTexture(base: string, stripe: string): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = stripe;
  g.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const x0 = i * 21.3 + 4;
    g.lineWidth = 7 - (i % 2) * 2;
    g.beginPath();
    for (let y = 0; y <= 128; y += 8) {
      const x = x0 + Math.sin(y * 0.09 + i) * 5;
      if (y === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  return tex(c, [2, 1]);
}

/** Pelo de abrigo (moteado suave) para la piel sintética de Hortensia. */
export function furTexture(base: string, dark: string): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 128);
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.strokeStyle = dark;
  g.globalAlpha = 0.35;
  g.lineWidth = 2;
  for (let i = 0; i < 260; i++) {
    const x = rnd() * 128;
    const y = rnd() * 128;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 6, y + 5 + rnd() * 6);
    g.stroke();
  }
  g.globalAlpha = 1;
  return tex(c, [3, 3]);
}

// ───────────── Emotes (compartidas) ─────────────

const emoteCache = new Map<string, THREE.Texture>();

function heart(g: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  g.beginPath();
  g.moveTo(cx, cy + s * 0.9);
  g.bezierCurveTo(cx - s * 1.3, cy + s * 0.1, cx - s * 0.9, cy - s * 0.9, cx, cy - s * 0.3);
  g.bezierCurveTo(cx + s * 0.9, cy - s * 0.9, cx + s * 1.3, cy + s * 0.1, cx, cy + s * 0.9);
  g.closePath();
}

function star(g: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.closePath();
}

function outlined(g: CanvasRenderingContext2D, fill: string) {
  g.lineJoin = 'round';
  g.lineWidth = 10;
  g.strokeStyle = '#ffffff';
  g.stroke();
  g.lineWidth = 4;
  g.strokeStyle = '#3b2146';
  g.stroke();
  g.fillStyle = fill;
  g.fill();
}

/** Textura de un emote (una sola figura centrada, 128×128). */
export function emoteTexture(kind: Exclude<Emote, null>): THREE.Texture {
  const hit = emoteCache.get(kind);
  if (hit) return hit;
  const [c, g] = canvas(128, 128);
  switch (kind) {
    case 'hearts':
      heart(g, 64, 60, 40);
      outlined(g, '#ff5ca8');
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.beginPath();
      g.ellipse(46, 44, 9, 6, -0.6, 0, Math.PI * 2);
      g.fill();
      break;
    case 'sweat':
      g.beginPath();
      g.moveTo(64, 14);
      g.bezierCurveTo(90, 56, 100, 76, 90, 96);
      g.bezierCurveTo(80, 118, 48, 118, 38, 96);
      g.bezierCurveTo(28, 76, 38, 56, 64, 14);
      g.closePath();
      outlined(g, '#8fd8ff');
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.beginPath();
      g.ellipse(52, 84, 6, 11, 0.3, 0, Math.PI * 2);
      g.fill();
      break;
    case 'anger': {
      // marca de enfado: cuatro "venas" curvas
      g.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        g.save();
        g.translate(64, 64);
        g.rotate((i * Math.PI) / 2 + Math.PI / 4);
        g.beginPath();
        g.moveTo(10, -26);
        g.quadraticCurveTo(8, -8, 26, -10);
        g.lineWidth = 22;
        g.strokeStyle = '#ffffff';
        g.stroke();
        g.lineWidth = 12;
        g.strokeStyle = '#ff2e4d';
        g.stroke();
        g.restore();
      }
      break;
    }
    case 'music': {
      // corchea doble
      g.beginPath();
      g.ellipse(40, 96, 17, 13, -0.4, 0, Math.PI * 2);
      g.ellipse(92, 84, 17, 13, -0.4, 0, Math.PI * 2);
      outlined(g, '#b079ff');
      g.beginPath();
      g.moveTo(52, 94);
      g.lineTo(52, 26);
      g.lineTo(104, 14);
      g.lineTo(104, 82);
      g.lineWidth = 16;
      g.strokeStyle = '#ffffff';
      g.stroke();
      g.lineWidth = 8;
      g.strokeStyle = '#6f3fd1';
      g.stroke();
      break;
    }
    case 'stars':
      star(g, 64, 66, 52);
      outlined(g, '#ffd84a');
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.beginPath();
      g.arc(52, 54, 7, 0, Math.PI * 2);
      g.fill();
      break;
    case 'zzz':
      g.font = 'bold 96px "Baloo 2", system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 12;
      g.strokeStyle = '#ffffff';
      g.strokeText('Z', 64, 68);
      g.fillStyle = '#7d8cff';
      g.fillText('Z', 64, 68);
      break;
  }
  const t = tex(c);
  emoteCache.set(kind, t);
  return t;
}

/** Destello suave radial (brillo de gafas, ojos del auditor). */
export function glowTexture(): THREE.Texture {
  const hit = emoteCache.get('glow');
  if (hit) return hit;
  const [c, g] = canvas(64, 64);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,220,240,0.9)');
  grd.addColorStop(1, 'rgba(255,60,140,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = tex(c);
  emoteCache.set('glow', t);
  return t;
}

/** Tela a cuadros (camisa de franela). */
export function plaidTexture(base: string, line: string, repeat: [number, number] = [4, 4]): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  g.fillStyle = base;
  g.fillRect(0, 0, 64, 64);
  g.globalAlpha = 0.45;
  g.fillStyle = line;
  g.fillRect(0, 22, 64, 14);
  g.fillRect(22, 0, 14, 64);
  g.globalAlpha = 0.8;
  g.fillRect(0, 28, 64, 3);
  g.fillRect(28, 0, 3, 64);
  g.globalAlpha = 1;
  return tex(c, repeat);
}
