/**
 * Plano de la clínica (metros, plano XZ; norte = −Z, la cámara mira desde el sur).
 * Datos puros compartidos por la lógica (navegación, zonas) y el nivel 3D.
 */

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type RoomId = 'waiting' | 'corridor' | 'autoclave' | 'exam' | 'prep' | 'or';
export type ZoneId = 'or' | 'prep' | 'autoclave';
export type StationId = 'exam' | 'lightbox' | 'prep' | 'autoclave' | 'consent' | 'cooler' | 'carrier' | 'orDoor';

export interface P2 {
  x: number;
  z: number;
}

export const BOUNDS: Rect = { minX: -13, maxX: 13, minZ: -8, maxZ: 8 };

export const ROOMS: Record<RoomId, Rect & { label: string }> = {
  waiting: { minX: -13, maxX: 5, minZ: -2, maxZ: 8, label: 'Sala de espera' },
  corridor: { minX: 5, maxX: 13, minZ: -2, maxZ: 1, label: 'Pasillo' },
  autoclave: { minX: 5, maxX: 13, minZ: 1, maxZ: 8, label: 'Autoclave' },
  exam: { minX: -13, maxX: -4.5, minZ: -8, maxZ: -2, label: 'Exploración' },
  prep: { minX: -4.5, maxX: 3.5, minZ: -8, maxZ: -2, label: 'Preparación' },
  or: { minX: 3.5, maxX: 13, minZ: -8, maxZ: -2, label: 'Antesala del quirófano' },
};

export const ROOM_IDS = Object.keys(ROOMS) as RoomId[];
export const ZONE_IDS: ZoneId[] = ['or', 'prep', 'autoclave'];
export const ZONE_LABEL: Record<ZoneId, string> = { or: 'Quirófano', prep: 'Preparación', autoclave: 'Autoclave' };

/** Pasos entre salas (punto central del hueco de la puerta). */
export interface Portal {
  a: RoomId;
  b: RoomId;
  x: number;
  z: number;
}

export const PORTALS: Portal[] = [
  { a: 'exam', b: 'waiting', x: -9, z: -2 },
  { a: 'prep', b: 'waiting', x: -0.5, z: -2 },
  { a: 'or', b: 'corridor', x: 8.5, z: -2 },
  { a: 'corridor', b: 'waiting', x: 5, z: -0.5 },
  { a: 'autoclave', b: 'waiting', x: 5, z: 4.5 },
];

/** Tabiques: segmentos alineados a ejes con huecos de puerta. */
export interface WallSeg {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  h: number;
  /** Cara que mira a cámara (para carteles): true si es un muro este-oeste. */
  outer?: boolean;
}

const WALL_H = 1.6;
const DOOR_W = 2;

function splitWall(axis: 'x' | 'z', fixed: number, from: number, to: number, gaps: number[], h = WALL_H): WallSeg[] {
  const out: WallSeg[] = [];
  let cur = from;
  const sorted = [...gaps].sort((a, b) => a - b);
  for (const g of sorted) {
    const a = g - DOOR_W / 2;
    if (a > cur) out.push(axis === 'z' ? { x1: cur, z1: fixed, x2: a, z2: fixed, h } : { x1: fixed, z1: cur, x2: fixed, z2: a, h });
    cur = g + DOOR_W / 2;
  }
  if (to > cur) out.push(axis === 'z' ? { x1: cur, z1: fixed, x2: to, z2: fixed, h } : { x1: fixed, z1: cur, x2: fixed, z2: to, h });
  return out;
}

export const WALLS: WallSeg[] = [
  // exteriores: norte alto (carteles), laterales medios, sur bajito (maqueta)
  { x1: -13, z1: -8, x2: 13, z2: -8, h: 3.1, outer: true },
  { x1: -13, z1: -8, x2: -13, z2: 8, h: WALL_H, outer: true },
  { x1: 13, z1: -8, x2: 13, z2: 8, h: WALL_H, outer: true },
  ...splitWall('z', 8, -13, 13, [-6.5], 0.45).map((w) => ({ ...w, outer: true })),
  // tabique norte/sur con tres puertas
  ...splitWall('z', -2, -13, 13, [-9, -0.5, 8.5]),
  // tabiques de las salas del norte
  { x1: -4.5, z1: -8, x2: -4.5, z2: -2, h: WALL_H },
  { x1: 3.5, z1: -8, x2: 3.5, z2: -2, h: WALL_H },
  // sala del autoclave
  ...splitWall('x', 5, 1, 8, [4.5]),
  { x1: 5, z1: 1, x2: 13, z2: 1, h: WALL_H },
];

export const WALL_THICK = 0.22;

/** Estaciones: punto de interacción y centro del mueble. */
export const STATIONS: Record<StationId, { pos: P2; radius: number; label: string }> = {
  exam: { pos: { x: -9, z: -5.3 }, radius: 1.9, label: 'Camilla de exploración' },
  lightbox: { pos: { x: -6.2, z: -7.3 }, radius: 1.7, label: 'Negatoscopio' },
  prep: { pos: { x: -0.5, z: -5.6 }, radius: 1.9, label: 'Estación de rasurado' },
  autoclave: { pos: { x: 12.1, z: 5.2 }, radius: 2.0, label: 'Autoclave' },
  consent: { pos: { x: 2.2, z: 5.2 }, radius: 1.8, label: 'Mostrador de consentimiento' },
  cooler: { pos: { x: -3.6, z: 7.35 }, radius: 1.5, label: 'Garrafón de tila' },
  carrier: { pos: { x: -12.1, z: 0.1 }, radius: 1.6, label: 'Transportín de Panchito' },
  orDoor: { pos: { x: 8.5, z: -7.4 }, radius: 2.1, label: 'Puerta del quirófano' },
};

/** Charcos fijos (el garrafón gotea; el trapeador de Rodrigo nunca escurre). */
export const PUDDLES: Array<P2 & { r: number }> = [
  { x: -3.6, z: 6.3, r: 0.75 },
  { x: 4.1, z: 0.6, r: 0.62 },
];

export const SPAWN: P2 = { x: -6.5, z: 5.2 };
export const EXIT: P2 = { x: -6.5, z: 9.2 };

/** Sillas de espera: posición y orientación (yaw, 0 = mira a +Z). */
export const SEATS: Array<P2 & { yaw: number }> = [
  { x: -7.2, z: -1.35, yaw: 0 },
  { x: -5.8, z: -1.35, yaw: 0 },
  { x: -4.4, z: -1.35, yaw: 0 },
  { x: -12.35, z: 2.4, yaw: Math.PI / 2 },
  { x: -12.35, z: 3.8, yaw: Math.PI / 2 },
  { x: -3.0, z: -1.35, yaw: 0 },
];

/** Dónde esperan los asistentes sin asignar y dónde trabajan. */
export const TEAM_IDLE: Record<'fritz' | 'rodrigo' | 'gigi', P2> = {
  fritz: { x: -2.2, z: 2.6 },
  rodrigo: { x: -0.4, z: 1.9 },
  gigi: { x: 1.4, z: 2.9 },
};
export const TEAM_WORK: Record<'fritz' | 'rodrigo' | 'gigi', P2 & { yaw: number }> = {
  fritz: { x: 10.9, z: 5.2, yaw: Math.PI / 2 },
  rodrigo: { x: 0.85, z: -5.6, yaw: -Math.PI / 2 },
  gigi: { x: 2.2, z: 4.35, yaw: 0 },
};

export function inRect(r: Rect, x: number, z: number, pad = 0): boolean {
  return x >= r.minX + pad && x <= r.maxX - pad && z >= r.minZ + pad && z <= r.maxZ - pad;
}

/** Sala que contiene el punto (null fuera de la clínica). */
export function roomAt(x: number, z: number): RoomId | null {
  for (const id of ROOM_IDS) if (inRect(ROOMS[id], x, z)) return id;
  return null;
}

export function zoneOfRoom(room: RoomId | null): ZoneId | null {
  return room === 'or' || room === 'prep' || room === 'autoclave' ? room : null;
}
