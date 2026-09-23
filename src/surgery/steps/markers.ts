import type { GuideLevel, Vec2 } from '../../core/contracts';

const INK = 'rgba(59,33,70,0.8)';
const FUCHSIA = '#ff2e93';

/**
 * Marcador de "aquí se actúa" (agujero, aguja, punta de separador...).
 * Alto contraste sobre hueso claro y sobre músculo oscuro: halo de tinta, anillo blanco o fucsia,
 * cruz con hueco central y un pulso tipo radar que llama la atención.
 * Siempre visible: con nivel de guía 'none' (Jefe de Servicio, caso final) sale más tenue,
 * sin número ni pulso. Las guías de trayectoria sí desaparecen; el "dónde actuar" nunca.
 */
export function drawTargetMarker(
  g: CanvasRenderingContext2D,
  c: Vec2,
  pxPerMm: number,
  t: number,
  opts: { level: GuideLevel; label?: string; active?: boolean; done?: boolean; near?: boolean },
): void {
  g.save();
  g.lineCap = 'round';
  if (opts.done) {
    g.fillStyle = INK;
    g.beginPath();
    g.arc(c.x, c.y, 6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#3fcf9c';
    g.beginPath();
    g.arc(c.x, c.y, 4, 0, Math.PI * 2);
    g.fill();
    g.restore();
    return;
  }
  if (opts.level === 'none') g.globalAlpha = opts.near ? 0.85 : 0.6;
  const r = Math.max(12, pxPerMm * 3);
  const pulse = 1 + 0.12 * Math.sin(t * 6);
  const ring = opts.active ? FUCHSIA : '#ffffff';

  // Pulso tipo radar (solo con guías).
  if (opts.level !== 'none') {
    const k = (t * 0.9) % 1;
    g.strokeStyle = opts.active ? `rgba(255,46,147,${0.7 * (1 - k)})` : `rgba(255,255,255,${0.6 * (1 - k)})`;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(c.x, c.y, r * (1 + k * 0.9), 0, Math.PI * 2);
    g.stroke();
  }

  // Anillo: halo de tinta + color.
  for (const [col, w] of [
    [INK, 7],
    [ring, 3.5],
  ] as const) {
    g.strokeStyle = col;
    g.lineWidth = w;
    g.beginPath();
    g.arc(c.x, c.y, r * pulse, 0, Math.PI * 2);
    g.stroke();
  }

  // Cruz con hueco central para ver el punto exacto.
  const a0 = r * 0.3;
  const a1 = r * 0.8;
  for (const [col, w] of [
    [INK, 5],
    ['#ffffff', 2],
  ] as const) {
    g.strokeStyle = col;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(c.x - a1, c.y);
    g.lineTo(c.x - a0, c.y);
    g.moveTo(c.x + a0, c.y);
    g.lineTo(c.x + a1, c.y);
    g.moveTo(c.x, c.y - a1);
    g.lineTo(c.x, c.y - a0);
    g.moveTo(c.x, c.y + a0);
    g.lineTo(c.x, c.y + a1);
    g.stroke();
  }
  g.fillStyle = FUCHSIA;
  g.beginPath();
  g.arc(c.x, c.y, 2.5, 0, Math.PI * 2);
  g.fill();

  // Etiqueta en píldora (número de orden).
  if (opts.label && opts.level !== 'none') {
    g.font = '800 13px Nunito, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const y = c.y - r * pulse - 13;
    const w = Math.max(20, g.measureText(opts.label).width + 12);
    g.fillStyle = opts.active ? FUCHSIA : 'rgba(59,33,70,0.9)';
    g.beginPath();
    g.roundRect(c.x - w / 2, y - 10, w, 20, 10);
    g.fill();
    g.fillStyle = '#ffffff';
    g.fillText(opts.label, c.x, y + 0.5);
  }
  g.restore();
}
