/**
 * Utilidades DOM mínimas para la interfaz: creación de nodos y "celdas" que
 * solo tocan el DOM cuando el valor cambia (el HUD se actualiza cada fotograma).
 */

/** Crea un elemento con clase, lo cuelga del padre y le pone texto. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  parent?: HTMLElement | null,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  if (parent) parent.appendChild(el);
  return el;
}

/** Crea un elemento a partir de HTML fijo (iconos SVG, decoraciones). */
export function fromHtml(html: string, cls?: string, parent?: HTMLElement | null, tag: 'span' | 'div' = 'span'): HTMLElement {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  el.innerHTML = html;
  if (parent) parent.appendChild(el);
  return el;
}

/** Texto que solo se escribe si cambia. */
export class TextCell {
  private last: string | null = null;
  constructor(readonly el: HTMLElement | SVGElement) {}
  set(v: string): boolean {
    if (v === this.last) return false;
    this.last = v;
    this.el.textContent = v;
    return true;
  }
}

/** Número formateado: cuantiza antes de formatear para no crear cadenas cada fotograma. */
export class NumCell {
  private key = Number.NaN;
  private init = false;
  constructor(
    readonly el: HTMLElement | SVGElement,
    private fmt: (v: number) => string,
    private quantum = 1,
  ) {}
  set(v: number): boolean {
    const k = Number.isFinite(v) ? Math.round(v / this.quantum) : v;
    if (this.init && Object.is(k, this.key)) return false;
    this.init = true;
    this.key = k;
    this.el.textContent = this.fmt(Number.isFinite(v) ? k * this.quantum : v);
    return true;
  }
}

/** Propiedad de estilo (o variable CSS si empieza por "--"). */
export class StyleCell {
  private last: string | null = null;
  constructor(
    readonly el: HTMLElement | SVGElement,
    private prop: string,
  ) {}
  set(v: string): boolean {
    if (v === this.last) return false;
    this.last = v;
    (this.el as HTMLElement).style.setProperty(this.prop, v);
    return true;
  }
}

/** Variable CSS numérica cuantizada (p. ej. --fill: 0.42). */
export class VarCell {
  private key = Number.NaN;
  private init = false;
  constructor(
    readonly el: HTMLElement | SVGElement,
    private prop: string,
    private quantum = 0.001,
    private suffix = '',
  ) {}
  set(v: number): boolean {
    const k = Math.round((Number.isFinite(v) ? v : 0) / this.quantum);
    if (this.init && k === this.key) return false;
    this.init = true;
    this.key = k;
    (this.el as HTMLElement).style.setProperty(this.prop, `${+(k * this.quantum).toFixed(4)}${this.suffix}`);
    return true;
  }
}

/** Clase que se activa/desactiva. */
export class ClassCell {
  private last: boolean | null = null;
  constructor(
    readonly el: Element,
    private cls: string,
  ) {}
  set(on: boolean): boolean {
    if (on === this.last) return false;
    this.last = on;
    this.el.classList.toggle(this.cls, on);
    return true;
  }
}

/** Atributo que solo se escribe si cambia (null = quitar). */
export class AttrCell {
  private last: string | null | undefined = undefined;
  constructor(
    readonly el: Element,
    private attr: string,
  ) {}
  set(v: string | null): boolean {
    if (v === this.last) return false;
    this.last = v;
    if (v === null) this.el.removeAttribute(this.attr);
    else this.el.setAttribute(this.attr, v);
    return true;
  }
}

/** Una de varias clases mutuamente excluyentes (p. ej. estado de un asistente). */
export class EnumClassCell<T extends string> {
  private last: T | null = null;
  constructor(
    readonly el: Element,
    private prefix: string,
  ) {}
  set(v: T): boolean {
    if (v === this.last) return false;
    if (this.last !== null) this.el.classList.remove(this.prefix + this.last);
    this.el.classList.add(this.prefix + v);
    this.last = v;
    return true;
  }
}
