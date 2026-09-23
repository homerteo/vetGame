/**
 * Retratos dibujados solo con CSS (sin imágenes): Emiliana, Valerio y los asistentes.
 * El tamaño lo marca la variable CSS --ps del contenedor; todo lo demás va en %.
 */
import './portraits.css';
import { h } from './logic/dom';
import { HEART_PATH } from './icons';

export type PortraitKind = 'emiliana' | 'valerio' | 'rodrigo' | 'fritz' | 'gigi';

const PARTS: Record<PortraitKind, string[]> = {
  emiliana: [
    'bg',
    'hair-back',
    'bun',
    'bun-tie',
    'body',
    'rope rope-l',
    'rope rope-r',
    'rope rope-x',
    'steth',
    'neck',
    'face',
    'bangs',
    'bang-side l',
    'bang-side r',
    'brow l',
    'brow r',
    'eye l',
    'eye r',
    'lash l',
    'lash r',
    'blush l',
    'blush r',
    'mouth',
    'sweat',
    'choker',
    'dring l',
    'dring r',
  ],
  valerio: [
    'bg',
    'coat',
    'shirt',
    'tie',
    'lapel l',
    'lapel r',
    'neck',
    'ear l',
    'ear r',
    'face',
    'hair',
    'hair-sweep',
    'brow l',
    'brow r',
    'eye l',
    'eye r',
    'lens l',
    'lens r',
    'bridge',
    'nose',
    'mouth',
  ],
  rodrigo: ['bg', 'dreads l', 'dreads r', 'body', 'neck', 'face', 'crown', 'eye l', 'eye r', 'beard', 'mouth', 'phones', 'cup l', 'cup r'],
  fritz: ['bg', 'body', 'neck', 'face', 'hair', 'eye l', 'eye r', 'bags l', 'bags r', 'mouth', 'mask'],
  gigi: ['bg', 'tail', 'body', 'neck', 'face', 'hair', 'pony', 'eye l', 'eye r', 'lash l', 'lash r', 'blush l', 'blush r', 'mouth'],
};

export function createPortrait(kind: PortraitKind, parent?: HTMLElement, extraCls = ''): HTMLElement {
  const root = h('div', `pt pt-${kind} ${extraCls}`.trim(), parent);
  root.setAttribute('role', 'img');
  root.setAttribute(
    'aria-label',
    { emiliana: 'Dra. Emiliana', valerio: 'Dr. Valerio Sterling', rodrigo: 'Rodrigo', fritz: 'Fritz', gigi: 'Gigi' }[kind],
  );
  for (const p of PARTS[kind]) h('i', 'p-' + p, root);
  if (kind === 'emiliana') {
    // Candadito de corazón dorado de la gargantilla.
    const lock = h('span', 'p-lock', root);
    lock.innerHTML = `<svg viewBox="0 0 24 30" aria-hidden="true"><path d="M8.5 12V8a3.5 3.5 0 0 1 7 0v4" fill="none" stroke="#e0a91f" stroke-width="2.6"/><path d="${HEART_PATH}" transform="translate(0 7)" fill="#f5c542" stroke="#b9860f" stroke-width="1"/><circle cx="12" cy="17.5" r="1.6" fill="#7a5208"/></svg>`;
  }
  return root;
}
