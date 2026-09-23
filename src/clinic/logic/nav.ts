/** Navegación mínima entre salas convexas a través de puertas (BFS sobre el grafo de salas). */
import { PORTALS, ROOMS, roomAt, type P2, type Portal, type RoomId } from './layout';

/** Normal de la puerta (eje que atraviesa) y signo hacia la sala b. */
function portalAxis(p: Portal): { axis: 'x' | 'z'; signToB: number } {
  const a = ROOMS[p.a];
  const b = ROOMS[p.b];
  if (Math.abs(a.maxZ - b.minZ) < 1e-6) return { axis: 'z', signToB: 1 };
  if (Math.abs(a.minZ - b.maxZ) < 1e-6) return { axis: 'z', signToB: -1 };
  if (Math.abs(a.maxX - b.minX) < 1e-6) return { axis: 'x', signToB: 1 };
  return { axis: 'x', signToB: -1 };
}

/** Secuencia de salas de a a b (incluidas). */
export function roomRoute(a: RoomId, b: RoomId): RoomId[] {
  if (a === b) return [a];
  const prev = new Map<RoomId, RoomId | null>([[a, null]]);
  const queue: RoomId[] = [a];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === b) break;
    for (const p of PORTALS) {
      const next = p.a === cur ? p.b : p.b === cur ? p.a : null;
      if (next && !prev.has(next)) {
        prev.set(next, cur);
        queue.push(next);
      }
    }
  }
  if (!prev.has(b)) return [a];
  const route: RoomId[] = [];
  for (let r: RoomId | null = b; r; r = prev.get(r) ?? null) route.unshift(r);
  return route;
}

function portalBetween(a: RoomId, b: RoomId): Portal | undefined {
  return PORTALS.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
}

/**
 * Lista de puntos de paso desde `from` hasta `to` (el último es `to`).
 * En cada puerta añade un punto a cada lado para cruzar derecho y no rozar el marco.
 */
export function findPath(from: P2, to: P2, doorStep = 0.7): P2[] {
  const ra = roomAt(from.x, from.z);
  const rb = roomAt(to.x, to.z);
  if (!ra || !rb || ra === rb) return [{ x: to.x, z: to.z }];
  const route = roomRoute(ra, rb);
  const out: P2[] = [];
  for (let i = 0; i < route.length - 1; i++) {
    const p = portalBetween(route[i], route[i + 1]);
    if (!p) continue;
    const { axis, signToB } = portalAxis(p);
    // signo desde route[i] hacia route[i+1]
    const s = p.a === route[i] ? signToB : -signToB;
    if (axis === 'z') {
      out.push({ x: p.x, z: p.z - s * doorStep }, { x: p.x, z: p.z + s * doorStep });
    } else {
      out.push({ x: p.x - s * doorStep, z: p.z }, { x: p.x + s * doorStep, z: p.z });
    }
  }
  out.push({ x: to.x, z: to.z });
  return out;
}

/** Punto aleatorio dentro de una sala, con margen a las paredes. */
export function randomPointInRoom(room: RoomId, rng: () => number, pad = 1): P2 {
  const r = ROOMS[room];
  return {
    x: r.minX + pad + rng() * Math.max(0.01, r.maxX - r.minX - pad * 2),
    z: r.minZ + pad + rng() * Math.max(0.01, r.maxZ - r.minZ - pad * 2),
  };
}
