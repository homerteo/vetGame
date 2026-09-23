/** Selección de frases sin repetir la misma dos veces seguidas + enfriamiento por hablante. */
import type { SpeakerId } from '../../../core/contracts';

export class LinePicker {
  private last = new Map<readonly string[], number>();
  private cooldown = new Map<SpeakerId, number>();

  constructor(private rng: () => number) {}

  pick(list: readonly string[] | undefined | null): string {
    if (!list || list.length === 0) return '';
    if (list.length === 1) return list[0];
    const prev = this.last.get(list) ?? -1;
    let i = Math.floor(this.rng() * list.length) % list.length;
    if (i === prev) i = (i + 1) % list.length;
    this.last.set(list, i);
    return list[i];
  }

  /** ¿Puede hablar ya este personaje (frases ambientales)? */
  ready(speaker: SpeakerId, now: number): boolean {
    return (this.cooldown.get(speaker) ?? -Infinity) <= now;
  }

  hold(speaker: SpeakerId, now: number, sec: number): void {
    this.cooldown.set(speaker, now + sec);
  }
}
