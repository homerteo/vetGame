/** Bus de eventos tipado y síncrono. */
export class EventBus<E extends object> {
  private handlers = new Map<keyof E, Set<(payload: never) => void>>();

  on<K extends keyof E>(type: K, handler: (payload: E[K]) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as (payload: never) => void);
    return () => this.off(type, handler);
  }

  once<K extends keyof E>(type: K, handler: (payload: E[K]) => void): () => void {
    const off = this.on(type, (p) => {
      off();
      handler(p);
    });
    return off;
  }

  off<K extends keyof E>(type: K, handler: (payload: E[K]) => void): void {
    this.handlers.get(type)?.delete(handler as (payload: never) => void);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const h of [...set]) (h as (p: E[K]) => void)(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
