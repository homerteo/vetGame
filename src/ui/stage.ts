/** Escala uniforme de un escenario lógico de 1280×720 al tamaño del contenedor (--s). */
import { clamp } from '../core/math';

export function attachStageScale(host: HTMLElement): () => void {
  const apply = () => {
    const w = host.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1280);
    const hh = host.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 720);
    host.style.setProperty('--s', clamp(Math.min(w / 1280, hh / 720), 0.5, 2).toFixed(4));
  };
  apply();
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(apply);
    ro.observe(host);
    return () => ro.disconnect();
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }
  return () => {};
}
