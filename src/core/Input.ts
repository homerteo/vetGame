import type { InputAPI } from './contracts';

/** Entrada de teclado, puntero y rueda sobre un elemento. */
export function createInput(target: HTMLElement): InputAPI & { dispose(): void } {
  const down = new Set<string>();
  const keyCbs = new Set<(code: string, down: boolean, repeat: boolean) => void>();
  const ptrCbs = new Set<(e: { type: 'down' | 'move' | 'up'; x: number; y: number; button: number; buttons: number }) => void>();
  const wheelCbs = new Set<(dy: number) => void>();
  const pointer = { x: 0, y: 0, buttons: 0 };
  let enabled = true;

  const isTyping = (e: Event) => {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (isTyping(e)) return;
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    const repeat = down.has(e.code);
    down.add(e.code);
    if (enabled) for (const cb of keyCbs) cb(e.code, true, repeat);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    down.delete(e.code);
    if (isTyping(e)) return;
    if (enabled) for (const cb of keyCbs) cb(e.code, false, false);
  };
  const emitPtr = (type: 'down' | 'move' | 'up', e: PointerEvent) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.buttons = e.buttons;
    if (enabled) for (const cb of ptrCbs) cb({ type, x: e.clientX, y: e.clientY, button: e.button, buttons: e.buttons });
  };
  const onDown = (e: PointerEvent) => {
    target.setPointerCapture?.(e.pointerId);
    emitPtr('down', e);
  };
  const onMove = (e: PointerEvent) => emitPtr('move', e);
  const onUp = (e: PointerEvent) => emitPtr('up', e);
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (enabled) for (const cb of wheelCbs) cb(e.deltaY);
  };
  const onContext = (e: Event) => e.preventDefault();
  const onBlur = () => down.clear();

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  target.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  target.addEventListener('wheel', onWheel, { passive: false });
  target.addEventListener('contextmenu', onContext);

  return {
    isDown: (code) => down.has(code),
    onKey(cb) {
      keyCbs.add(cb);
      return () => keyCbs.delete(cb);
    },
    onPointer(cb) {
      ptrCbs.add(cb);
      return () => ptrCbs.delete(cb);
    },
    onWheel(cb) {
      wheelCbs.add(cb);
      return () => wheelCbs.delete(cb);
    },
    pointer,
    setEnabled(v) {
      enabled = v;
      if (!v) down.clear();
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      target.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      target.removeEventListener('wheel', onWheel);
      target.removeEventListener('contextmenu', onContext);
      keyCbs.clear();
      ptrCbs.clear();
      wheelCbs.clear();
    },
  };
}
