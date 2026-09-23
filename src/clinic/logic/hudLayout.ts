/** Colocación del HUD de la clínica según el tamaño de la ventana. Lógica pura (tamaños en px de pantalla). */

export interface HudBoxes {
  /** Tamaño del contenedor del HUD. */
  w: number;
  h: number;
  /** Tamaños SIN escalar (offsetWidth/offsetHeight) de cada panel. */
  queue: { w: number; h: number };
  map: { w: number; h: number };
  clock: { h: number };
  objective: { h: number };
  team: { w: number; h: number };
  emi: { w: number; h: number };
  /** Ancho sin escalar de lo más ancho de la franja central de abajo (aviso E, leyenda de controles). */
  bottomCenterW: number;
}

export interface HudLayout {
  /** Escala común de todos los paneles (como --hud-s del quirófano). */
  s: number;
  /** Objetivo bajo el reloj (false) o bajo la cola/minimapa por falta de ancho (true). */
  narrowTop: boolean;
  objTop: number;
  /** Ancho máximo del objetivo, en px sin escalar. */
  objMaxW: number;
  toastTop: number;
  /** Distancia al borde inferior de la leyenda de controles (base de la pila central de abajo). */
  bottomBase: number;
  /** La pila central de abajo sube por encima de las tarjetas del equipo por falta de ancho. */
  narrowBottom: boolean;
}

export const HUD_MARGIN = 12;
const OBJ_MAX = 560;
/** Por debajo de este ancho (sin escalar) el objetivo se lee mal entre la cola y el minimapa. */
const OBJ_MIN = 480;

export const hudScale = (w: number, h: number) => Math.min(1.6, Math.max(0.7, Math.min(w / 1280, h / 720)));

export function computeHudLayout(b: HudBoxes): HudLayout {
  const s = hudScale(b.w, b.h);
  const m = HUD_MARGIN;
  // ── arriba: reloj al centro, cola a la izquierda, minimapa a la derecha ──
  const gapTop = b.w - 2 * m - (b.queue.w + b.map.w) * s - 16;
  const narrowTop = gapTop / s < OBJ_MIN;
  let objTop: number;
  let objMaxW: number;
  if (!narrowTop) {
    objTop = 10 + (b.clock.h + 6) * s;
    objMaxW = Math.min(OBJ_MAX, gapTop / s);
  } else {
    objTop = m + Math.max(b.queue.h, b.map.h) * s + 8;
    objMaxW = Math.min(OBJ_MAX, (b.w - 2 * m) / s);
  }
  const toastTop = objTop + b.objective.h * s + 8;
  // ── abajo: equipo a la izquierda, Emiliana a la derecha, avisos al centro ──
  const gapBottom = b.w - 2 * m - (b.team.w + b.emi.w) * s - 16;
  const narrowBottom = gapBottom < b.bottomCenterW * s;
  const bottomBase = narrowBottom ? m + Math.max(b.team.h, b.emi.h) * s + 10 : 60 * s;
  return { s, narrowTop, objTop, objMaxW, toastTop, bottomBase, narrowBottom };
}
