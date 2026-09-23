/** IA de Panchito: sale del transportín, corretea, da vueltas y se cuela en zonas estériles. Lógica pura. */
import { ROOMS, STATIONS, ZONE_IDS, roomAt, zoneOfRoom, type P2, type RoomId, type ZoneId } from './layout';
import { findPath, randomPointInRoom } from './nav';
import { TUNING } from './tuning';

export type PanchitoMode = 'off' | 'carrier' | 'roam' | 'zoom' | 'dart' | 'sniff' | 'held';
export type PanchitoEvent = 'escape' | 'bark' | 'enterZone' | 'wriggle';

export interface PanchitoState {
  mode: PanchitoMode;
  x: number;
  z: number;
  /** Dirección de marcha (para orientar el modelo). */
  hx: number;
  hz: number;
  speed: number;
  timer: number;
  path: P2[];
  pathIdx: number;
  zoomCx: number;
  zoomCz: number;
  zoomAng: number;
  barkTimer: number;
  targetZone: ZoneId | null;
  escapes: number;
  catches: number;
}

const between = (rng: () => number, r: readonly [number, number]) => r[0] + rng() * (r[1] - r[0]);

export function createPanchito(enabled: boolean, rng: () => number): PanchitoState {
  const c = STATIONS.carrier.pos;
  return {
    mode: enabled ? 'carrier' : 'off',
    x: c.x,
    z: c.z,
    hx: 1,
    hz: 0,
    speed: 0,
    timer: TUNING.panchito.firstEscapeSec,
    path: [],
    pathIdx: 0,
    zoomCx: 0,
    zoomCz: 0,
    zoomAng: 0,
    barkTimer: between(rng, TUNING.panchito.barkEverySec),
    targetZone: null,
    escapes: 0,
    catches: 0,
  };
}

function goTo(p: PanchitoState, to: P2): void {
  p.path = findPath({ x: p.x, z: p.z }, to, 0.6);
  p.pathIdx = 0;
}

function currentRoom(p: PanchitoState): RoomId {
  return roomAt(p.x, p.z) ?? 'waiting';
}

function startRoam(p: PanchitoState, rng: () => number): void {
  p.mode = 'roam';
  // vuelve a salas "civiles": sala de espera casi siempre, a veces exploración o pasillo
  const r = rng();
  const room: RoomId = r < 0.65 ? 'waiting' : r < 0.82 ? 'exam' : 'corridor';
  goTo(p, randomPointInRoom(room, rng, 1.1));
}

function startDart(p: PanchitoState, rng: () => number): void {
  const here = zoneOfRoom(roomAt(p.x, p.z));
  const options = ZONE_IDS.filter((z) => z !== here);
  const zone = options[Math.floor(rng() * options.length) % options.length];
  p.mode = 'dart';
  p.targetZone = zone;
  goTo(p, randomPointInRoom(zone, rng, 1.2));
}

function startZoom(p: PanchitoState, rng: () => number): void {
  const room = ROOMS[currentRoom(p)];
  const R = TUNING.panchito.zoomRadius + 0.3;
  p.mode = 'zoom';
  p.zoomCx = Math.min(Math.max(p.x, room.minX + R + 0.3), room.maxX - R - 0.3);
  p.zoomCz = Math.min(Math.max(p.z, room.minZ + R + 0.3), room.maxZ - R - 0.3);
  p.zoomAng = Math.atan2(p.z - p.zoomCz, p.x - p.zoomCx);
  p.timer = between(rng, TUNING.panchito.zoomSec);
}

function decideNext(p: PanchitoState, rng: () => number): void {
  const r = rng();
  if (r < 0.38) startRoam(p, rng);
  else if (r < 0.62) startZoom(p, rng);
  else startDart(p, rng);
}

/** Sigue la ruta; devuelve true al llegar al final. */
function followPath(p: PanchitoState, dt: number, speed: number): boolean {
  let budget = speed * dt;
  while (budget > 0 && p.pathIdx < p.path.length) {
    const t = p.path[p.pathIdx];
    const dx = t.x - p.x;
    const dz = t.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d <= budget) {
      p.x = t.x;
      p.z = t.z;
      budget -= d;
      p.pathIdx++;
    } else {
      p.x += (dx / d) * budget;
      p.z += (dz / d) * budget;
      p.hx = dx / d;
      p.hz = dz / d;
      budget = 0;
    }
  }
  p.speed = speed;
  return p.pathIdx >= p.path.length;
}

/** Avanza a Panchito. Añade eventos a `out`. */
export function tickPanchito(p: PanchitoState, dt: number, rng: () => number, out: PanchitoEvent[]): void {
  const T = TUNING.panchito;
  if (p.mode === 'off') return;
  if (p.mode === 'carrier') {
    p.speed = 0;
    p.timer -= dt;
    if (p.timer <= 0) {
      p.escapes++;
      const c = STATIONS.carrier.pos;
      p.x = c.x + 0.9;
      p.z = c.z + 0.4;
      out.push('escape', 'bark');
      p.barkTimer = between(rng, T.barkEverySec);
      startZoom(p, rng);
    }
    return;
  }
  if (p.mode === 'held') {
    p.speed = 0;
    p.timer -= dt;
    if (p.timer <= 0) out.push('wriggle');
    return;
  }

  p.barkTimer -= dt;
  if (p.barkTimer <= 0) {
    p.barkTimer = between(rng, T.barkEverySec);
    out.push('bark');
  }

  const zoneBefore = zoneOfRoom(roomAt(p.x, p.z));
  switch (p.mode) {
    case 'roam':
      if (followPath(p, dt, T.runSpeed)) decideNext(p, rng);
      break;
    case 'dart':
      if (followPath(p, dt, T.runSpeed * 1.1)) {
        p.mode = 'sniff';
        p.timer = between(rng, T.sniffSec);
        goTo(p, randomPointInRoom(p.targetZone ?? 'prep', rng, 1.2));
      }
      break;
    case 'sniff':
      p.timer -= dt;
      if (followPath(p, dt, T.sniffSpeed)) goTo(p, randomPointInRoom(p.targetZone ?? 'prep', rng, 1.2));
      if (p.timer <= 0) {
        p.targetZone = null;
        startRoam(p, rng);
      }
      break;
    case 'zoom': {
      p.timer -= dt;
      const w = (T.runSpeed * 1.15) / T.zoomRadius;
      p.zoomAng += w * dt;
      const nx = p.zoomCx + Math.cos(p.zoomAng) * T.zoomRadius;
      const nz = p.zoomCz + Math.sin(p.zoomAng) * T.zoomRadius;
      const dx = nx - p.x;
      const dz = nz - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-6) {
        p.hx = dx / d;
        p.hz = dz / d;
      }
      // se acerca suavemente a la circunferencia si empezó fuera
      const k = Math.min(1, dt * 6);
      p.x += dx * k;
      p.z += dz * k;
      p.speed = T.runSpeed * 1.15;
      if (p.timer <= 0) decideNext(p, rng);
      break;
    }
  }
  const zoneAfter = zoneOfRoom(roomAt(p.x, p.z));
  if (zoneAfter && zoneAfter !== zoneBefore) out.push('enterZone');
}

export function isLoose(p: PanchitoState): boolean {
  return p.mode === 'roam' || p.mode === 'zoom' || p.mode === 'dart' || p.mode === 'sniff';
}

export function isZooming(p: PanchitoState): boolean {
  return p.mode === 'zoom';
}

export function panchitoZone(p: PanchitoState): ZoneId | null {
  return isLoose(p) ? zoneOfRoom(roomAt(p.x, p.z)) : null;
}

/** ¿El placaje desde (x, z) atrapa a Panchito? */
export function tackleHits(x: number, z: number, p: PanchitoState, range: number = TUNING.panchito.tackleRange): boolean {
  if (!isLoose(p)) return false;
  return Math.hypot(p.x - x, p.z - z) <= range;
}

export function catchPanchito(p: PanchitoState): void {
  p.mode = 'held';
  p.catches++;
  p.timer = TUNING.panchito.wriggleSec;
  p.path = [];
  p.targetZone = null;
}

export function putInCarrier(p: PanchitoState, rng: () => number): void {
  const c = STATIONS.carrier.pos;
  p.mode = 'carrier';
  p.x = c.x;
  p.z = c.z;
  p.timer = between(rng, TUNING.panchito.carrierSec);
}

/** Se escurre de los brazos de Emiliana. */
export function wriggleFree(p: PanchitoState, x: number, z: number, rng: () => number): void {
  p.x = x;
  p.z = z;
  startZoom(p, rng);
}
