/**
 * Cola de alertas del HUD: máx. N visibles a la vez, con prioridad
 * paro > arterial > calor óseo > equipo/inundación > comentario > info.
 */
import type { AlertKind } from '../../core/contracts';

export const ALERT_PRIORITY: Record<AlertKind, number> = {
  arrest: 0,
  arterial: 1,
  boneHeat: 2,
  crew: 3,
  flood: 3,
  comment: 4,
  info: 5,
};

export const ALERT_DURATION: Record<AlertKind, number> = {
  arrest: 6,
  arterial: 4.5,
  boneHeat: 3.5,
  crew: 4,
  flood: 4,
  comment: 3.5,
  info: 3,
};

export interface AlertItem {
  id: number;
  kind: AlertKind;
  text: string;
  bornAt: number;
  expiresAt: number;
  /** Ligada a un evento en curso (ver `hold`): no caduca mientras dure y se retira al acabar. */
  linked?: boolean;
}

export interface AlertQueue {
  push(kind: AlertKind, text: string, now: number): void;
  /** Caduca y promueve alertas. Devuelve true si cambió lo visible. */
  update(now: number): boolean;
  /** Visibles ordenadas por prioridad (más importante primero). */
  visible(): readonly AlertItem[];
  pending(): readonly AlertItem[];
  /** Aumenta cada vez que cambia lo visible (para redibujar solo entonces). */
  readonly version: number;
  /**
   * Liga la alerta de `kind` (visible o en espera) a una condición: mientras `active` sea true no
   * caduca; cuando pasa a false, una alerta ya ligada se retira en el siguiente `update`.
   * Las alertas que nunca vieron la condición activa conservan su temporizador normal.
   */
  hold(kind: AlertKind, active: boolean, now: number): void;
  clear(): void;
}

export function createAlertQueue(opts: { max?: number; pendingTtlSec?: number; durations?: Partial<Record<AlertKind, number>> } = {}): AlertQueue {
  const max = opts.max ?? 2;
  const pendingTtl = opts.pendingTtlSec ?? 6;
  const dur = { ...ALERT_DURATION, ...opts.durations };
  const vis: AlertItem[] = [];
  const pend: AlertItem[] = [];
  let nextId = 1;
  let version = 0;

  const byPriority = (a: AlertItem, b: AlertItem) => ALERT_PRIORITY[a.kind] - ALERT_PRIORITY[b.kind] || a.bornAt - b.bornAt;

  /** Índice de la visible menos importante (la más reciente si empatan). */
  const weakestIdx = () => {
    let wi = -1;
    for (let i = 0; i < vis.length; i++) {
      if (wi < 0) wi = i;
      else {
        const pa = ALERT_PRIORITY[vis[i].kind];
        const pb = ALERT_PRIORITY[vis[wi].kind];
        if (pa > pb || (pa === pb && vis[i].bornAt < vis[wi].bornAt)) wi = i;
      }
    }
    return wi;
  };

  const addPending = (item: AlertItem) => {
    const i = pend.findIndex((p) => p.kind === item.kind);
    if (i >= 0) pend.splice(i, 1);
    pend.push(item);
  };

  const changed = () => {
    vis.sort(byPriority);
    version++;
  };

  return {
    push(kind, text, now) {
      const expiresAt = now + dur[kind];
      // Una alerta por tipo: se refresca en lugar de duplicarse.
      const same = vis.find((v) => v.kind === kind);
      if (same) {
        const textChanged = same.text !== text;
        same.text = text;
        same.expiresAt = expiresAt;
        if (textChanged) changed();
        return;
      }
      const item: AlertItem = { id: nextId++, kind, text, bornAt: now, expiresAt };
      if (vis.length < max) {
        vis.push(item);
        changed();
        return;
      }
      const wi = weakestIdx();
      if (wi >= 0 && ALERT_PRIORITY[kind] < ALERT_PRIORITY[vis[wi].kind]) {
        const [evicted] = vis.splice(wi, 1);
        if (evicted.expiresAt > now + 0.5) addPending(evicted);
        vis.push(item);
        changed();
      } else {
        addPending(item);
      }
    },
    update(now) {
      let did = false;
      for (let i = vis.length - 1; i >= 0; i--) {
        if (vis[i].expiresAt <= now) {
          vis.splice(i, 1);
          did = true;
        }
      }
      for (let i = pend.length - 1; i >= 0; i--) {
        if (now - pend[i].bornAt > pendingTtl) pend.splice(i, 1);
      }
      while (vis.length < max && pend.length > 0) {
        pend.sort(byPriority);
        const next = pend.shift()!;
        // La que entra tarde recibe su duración completa desde ahora.
        next.expiresAt = Math.max(next.expiresAt, now + Math.min(dur[next.kind], 2.5));
        vis.push(next);
        did = true;
      }
      if (did) changed();
      return did;
    },
    hold(kind, active, now) {
      const item = vis.find((v) => v.kind === kind) ?? pend.find((p) => p.kind === kind);
      if (!item) return;
      if (active) {
        item.linked = true;
        item.expiresAt = Math.max(item.expiresAt, now + 0.6);
      } else if (item.linked) {
        item.linked = false;
        item.expiresAt = Math.min(item.expiresAt, now);
        if (pend.includes(item)) pend.splice(pend.indexOf(item), 1);
      }
    },
    visible: () => vis,
    pending: () => pend,
    get version() {
      return version;
    },
    clear() {
      vis.length = 0;
      pend.length = 0;
      version++;
    },
  };
}
