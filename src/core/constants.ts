/** Tamaño del espacio de herida (mm) y resolución del lienzo. */
export const WOUND_W_MM = 160;
export const WOUND_H_MM = 100;
export const PX_PER_MM = 6.4; // lienzo de 1024 × 640 px
export const WOUND_CANVAS_W = Math.round(WOUND_W_MM * PX_PER_MM);
export const WOUND_CANVAS_H = Math.round(WOUND_H_MM * PX_PER_MM);

/** Umbral de necrosis térmica ósea (°C mantenidos). */
export const BONE_NECROSIS_C = 47;
/** Nivel de Campo a partir del cual la herida se inunda (%). */
export const FLOOD_THRESHOLD_PCT = 70;

/** Paleta kawaii compartida (también en src/ui/theme.css). */
export const PALETTE = {
  lilac: '#c8a2e8',
  lavender: '#b79cf2',
  mint: '#9ff0d0',
  bubblegum: '#ff8fc7',
  fuchsia: '#ff2e93',
  cream: '#fff6fb',
  ink: '#3b2146',
  gold: '#f5c542',
  blood: '#9e0b17',
  bloodBright: '#d8152a',
  pastelBlood: '#ff5c9a',
} as const;
