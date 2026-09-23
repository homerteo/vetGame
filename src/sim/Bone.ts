import type { AnatomyDef, BoneAPI, FragmentState, ImplantState, Pose2, Vec2 } from '../core/contracts';
import { angleDiff, applyPose, applyPosePoly, dist, pointInPolygon } from '../core/math';

/** Estado mutable del hueso: fragmentos con pose, bloqueos, retirados e implantes. */

const clonePose = (p: Pose2): Pose2 => ({ pos: { x: p.pos.x, y: p.pos.y }, angleDeg: p.angleDeg });

interface PolyCache {
  x: number;
  y: number;
  a: number;
  poly: Vec2[];
}

export function createBone(anatomy: AnatomyDef): BoneAPI {
  const states: FragmentState[] = anatomy.fragments.map((def) => ({
    id: def.id,
    def,
    pose: clonePose(def.start),
    locked: !!def.locked,
    removed: false,
    highlighted: false,
  }));
  const byId = new Map<string, FragmentState>();
  for (const s of states) byId.set(s.id, s);

  // Caché del polígono en mundo (se recalcula solo si cambia la pose).
  const cache = new Map<string, PolyCache>();
  const targetCache = new Map<string, Vec2[] | null>();

  const implants: ImplantState = { plate: null, screws: [], pins: [], wires: [], bars: [] };

  function worldPolygon(id: string): Vec2[] {
    const s = byId.get(id);
    if (!s) return [];
    const c = cache.get(id);
    if (c && c.x === s.pose.pos.x && c.y === s.pose.pos.y && c.a === s.pose.angleDeg) return c.poly;
    const poly = applyPosePoly(s.def.polygon, s.pose);
    cache.set(id, { x: s.pose.pos.x, y: s.pose.pos.y, a: s.pose.angleDeg, poly });
    return poly;
  }

  return {
    fragments: () => states,
    fragment: (id) => byId.get(id),
    worldPolygon,

    targetPolygon(id) {
      if (targetCache.has(id)) return targetCache.get(id) ?? null;
      const s = byId.get(id);
      const poly = s?.def.target ? applyPosePoly(s.def.polygon, s.def.target) : null;
      targetCache.set(id, poly);
      return poly;
    },

    staticPolygons: () => anatomy.boneStatic,

    hitTest(p, includeLocked = false) {
      for (let i = states.length - 1; i >= 0; i--) {
        const s = states[i];
        if (s.removed) continue;
        if (s.locked && !includeLocked) continue;
        if (pointInPolygon(p, worldPolygon(s.id))) return s.id;
      }
      return null;
    },

    setPose(id, pose) {
      const s = byId.get(id);
      if (!s) return;
      s.pose.pos.x = pose.pos.x;
      s.pose.pos.y = pose.pos.y;
      s.pose.angleDeg = pose.angleDeg;
    },

    release(id) {
      const s = byId.get(id);
      if (s) s.locked = false;
    },

    remove(id) {
      const s = byId.get(id);
      if (s) {
        s.removed = true;
        s.highlighted = false;
      }
    },

    alignmentError(id) {
      const s = byId.get(id);
      if (!s || !s.def.target) return { mm: 0, deg: 0 };
      return { mm: dist(s.pose.pos, s.def.target.pos), deg: Math.abs(angleDiff(s.pose.angleDeg, s.def.target.angleDeg)) };
    },

    cord: () => anatomy.cord ?? null,

    isOnBone(p) {
      for (const poly of anatomy.boneStatic) if (pointInPolygon(p, poly)) return true;
      for (const s of states) if (!s.removed && pointInPolygon(p, worldPolygon(s.id))) return true;
      return false;
    },

    plateHolesWorld() {
      const pl = implants.plate;
      if (!pl) return [];
      return pl.holesLocal.map((h) => applyPose(h, pl.pose));
    },

    implants,
  };
}
