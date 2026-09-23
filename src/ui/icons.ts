/**
 * Iconos SVG en línea (24×24, currentColor). La forma lleva el significado;
 * el color solo acompaña (accesibilidad para daltonismo).
 */
import type { AssistantVisualState, InstrumentId, Species } from '../core/contracts';

const svg = (body: string, cls = 'ic', vb = '0 0 24 24') =>
  `<svg class="${cls}" viewBox="${vb}" aria-hidden="true" focusable="false">${body}</svg>`;
const st = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

export const HEART_PATH = 'M12 21s-7.5-4.6-9.6-9.3C.9 8.2 3 4.5 6.6 4.5c2.1 0 3.9 1.3 5.4 3.2 1.5-1.9 3.3-3.2 5.4-3.2 3.6 0 5.7 3.7 4.2 7.2C19.5 16.4 12 21 12 21z';

export const ICONS = {
  heart: svg(`<path d="${HEART_PATH}" fill="currentColor"/>`),
  heartLine: svg(`<path d="${HEART_PATH}" ${st}/>`),
  drop: svg(`<path d="M12 2.5C9 7 5.5 10.6 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 10.6 15 7 12 2.5z" fill="currentColor"/><circle cx="10" cy="14.5" r="2.2" fill="#fff" opacity=".55"/>`),
  triangle: svg(`<path d="M12 3 22 20H2z" fill="currentColor"/><path d="M12 9v5" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17" r="1.2" fill="#fff"/>`),
  cloud: svg(`<path d="M7 18h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.1 4.5 4.5 0 0 0 7 18z" fill="currentColor"/>`),
  thermo: svg(`<path d="M10 4a2 2 0 0 1 4 0v9.3a4.5 4.5 0 1 1-4 0z" ${st}/><circle cx="12" cy="17" r="2.2" fill="currentColor"/><path d="M12 15V8" stroke="currentColor" stroke-width="2"/>`),
  square: svg(`<rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor"/>`),
  diamond: svg(`<path d="M12 2 22 12 12 22 2 12z" fill="currentColor"/>`),
  clock: svg(`<circle cx="12" cy="12" r="9" ${st}/><path d="M12 7v5l3.5 2" ${st}/>`),
  hourglass: svg(`<path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9" ${st}/>`),
  check: svg(`<path d="M5 12.5l4.5 4.5L19 7.5" ${st} stroke-width="3"/>`),
  cross: svg(`<path d="M6 6l12 12M18 6 6 18" ${st} stroke-width="3"/>`),
  gear: svg(`<circle cx="12" cy="12" r="3.2" ${st}/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" ${st}/>`),
  spiral: svg(`<path d="M12 12a1.5 1.5 0 1 1 1.5 1.5A3 3 0 1 1 16.5 10.5 4.5 4.5 0 1 1 12 6a6 6 0 1 1-6 6" ${st}/>`),
  zigzag: svg(`<path d="M2 12l3-5 3 10 3-10 3 10 3-10 3 10 2-5" ${st}/>`),
  camera: svg(`<path d="M4 8h3l1.5-2.5h7L17 8h3v11H4z" ${st}/><circle cx="12" cy="13.5" r="3.2" ${st}/><circle cx="18.5" cy="4.5" r="1.6" fill="currentColor"/>`),
  door: svg(`<path d="M5 21V3h9v18M14 5h5v16M10.5 12h.01" ${st}/><path d="M17 12h5m-2-2 2 2-2 2" ${st}/>`),
  alert: svg(`<path d="M12 3 22 20H2z" ${st}/><path d="M12 9.5v4.5M12 17v.01" ${st} stroke-width="2.6"/>`),
  bag: svg(`<path d="M7 9a5 5 0 0 1 10 0v6a5 5 0 0 1-10 0z" fill="currentColor"/><path d="M12 4V1.5M9 1.5h6" ${st}/><path d="M9.5 10.5h5" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>`),
  bolt: svg(`<path d="M13.5 2 4.5 13.5H11L9.5 22l9-11.5H12z" fill="currentColor"/>`),
  hand: svg(`<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-6.5a1.5 1.5 0 0 1 3 0V11m0-5a1.5 1.5 0 0 1 3 0v6m0-3a1.5 1.5 0 0 1 3 0v5.5c0 4-3 7.5-7.5 7.5S5 19.5 3.5 16l-1-2.5a1.5 1.5 0 0 1 2.7-1.3L8 16" ${st}/>`),
  bulb: svg(`<path d="M9 18h6M10 21h4M8.5 14.5A6 6 0 1 1 15.5 14.5c-.8.7-1.5 1.6-1.5 2.5h-4c0-.9-.7-1.8-1.5-2.5z" ${st}/>`),
  lens: svg(`<circle cx="10.5" cy="10.5" r="6.5" ${st}/><path d="M15.5 15.5 21 21" ${st} stroke-width="3"/><path d="M8 10.5h5M10.5 8v5" ${st}/>`),
  xray: svg(`<path d="M5 4h10a4 4 0 0 1 4 4v1M5 4v16M3 20h6M17 12l2-3" ${st}/><path d="M16 15v5M14 17.5h4" ${st}/>`),
  bone: svg(`<path d="M7.2 9.3 14.7 16.8a2.6 2.6 0 1 0 3.7 1.4 2.6 2.6 0 1 0 1.4-3.7L6.3 7.2A2.6 2.6 0 1 0 5.6 3.5a2.6 2.6 0 1 0-1.4 3.7" fill="currentColor"/>`),
  coin: svg(`<circle cx="12" cy="12" r="10" fill="#f5c542"/><circle cx="12" cy="12" r="7.6" fill="#ffd96a" stroke="#c9961b" stroke-width="1.2"/><path d="M9.2 10.2 14.8 13.8a1.4 1.4 0 1 0 1.8.9 1.4 1.4 0 1 0 .9-1.8L10.3 9.1a1.4 1.4 0 1 0-.4-1.9 1.4 1.4 0 1 0-1.9.4" fill="#c9961b"/>`, 'ic coin'),
  star: svg(`<path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.5 1.3 6.6L12 17.2l-5.9 3.3 1.3-6.6-4.9-4.5 6.6-.8z" fill="currentColor"/>`),
  lock: svg(`<rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="currentColor"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" ${st} stroke-width="2.4"/><circle cx="12" cy="15.5" r="1.6" fill="#fff"/>`),
  speech: svg(`<path d="M4 5h16v10H10l-4 4v-4H4z" ${st}/>`),
  wave: svg(`<path d="M2 9c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2" ${st}/>`),
  flame: svg(`<path d="M12 22c-4 0-7-2.7-7-6.6C5 11 9.5 9 9 3c3.5 2 6 5.2 5.5 8.6 1-.6 1.7-1.7 2-3C18 10 19 12.4 19 15.4 19 19.3 16 22 12 22z" fill="currentColor"/>`),
  info: svg(`<circle cx="12" cy="12" r="9.5" fill="currentColor"/><path d="M12 11v6M12 7.5v.01" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>`),
  brokenHeart: svg(`<path d="${HEART_PATH}" fill="currentColor"/><path d="M12 7.7 10 11l3 2-2 3.5" stroke="#fff" stroke-width="1.8" fill="none" stroke-linejoin="round"/>`),
  pulse: svg(`<path d="M2 12h4l2-5 3 10 3-7 2 2h6" ${st}/>`),
  sparkle: svg(`<path d="M12 2c.8 4.8 2.2 6.2 7 7-4.8.8-6.2 2.2-7 7-.8-4.8-2.2-6.2-7-7 4.8-.8 6.2-2.2 7-7z" fill="currentColor"/>`),
  whip: svg(`<path d="M4 20 11 13M11 13c3-3 6-4 9-3M20 10c-2 1-2 3 0 4" ${st}/><circle cx="4" cy="20" r="1.6" fill="currentColor"/>`),
  suction: svg(`<path d="M3 4c5 0 6 4 8 8s3 7 7 7h3" ${st}/><path d="M18 16.5v5" ${st}/><circle cx="7" cy="17" r="1.3" fill="currentColor"/><circle cx="4.5" cy="13.5" r="1" fill="currentColor"/>`),
  paw: svg(`<ellipse cx="12" cy="16" rx="5" ry="4.2" fill="currentColor"/><circle cx="6" cy="10" r="2" fill="currentColor"/><circle cx="9.5" cy="6.5" r="2" fill="currentColor"/><circle cx="14.5" cy="6.5" r="2" fill="currentColor"/><circle cx="18" cy="10" r="2" fill="currentColor"/>`),
  watch: svg(`<rect x="6" y="6" width="12" height="12" rx="3" ${st}/><path d="M9 6V2.5h6V6M9 18v3.5h6V18" ${st}/>`),
  back: svg(`<path d="M15 5 8 12l7 7" ${st} stroke-width="3"/>`),
  play: svg(`<path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/>`),
  pause: svg(`<rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor"/><rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor"/>`),
  retry: svg(`<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5" ${st}/>`),
  bag2: svg(`<path d="M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2" ${st}/>`),
  settings: svg(`<circle cx="12" cy="12" r="3" ${st}/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" ${st} stroke-width="1.6"/>`),
  boot: svg(`<path d="M8 2.5h6.5v9.5l5 2.8V18H6.5v-4.2l1.5-1.3z" fill="currentColor"/><rect x="5" y="18.5" width="15.5" height="3.5" rx="1.2" fill="currentColor" opacity=".7"/><path d="M9.5 6h3.5M9.5 9h3.5" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity=".8"/>`),
  dring: svg(`<path d="M5.5 6.5h13v4a6.5 6.5 0 0 1-13 0z" ${st} stroke-width="2.8"/><path d="M12 3v3.5" ${st} stroke-width="2.8"/>`),
  cuffs: svg(`<circle cx="7" cy="14" r="4.5" ${st} stroke-width="2.6"/><circle cx="17" cy="14" r="4.5" ${st} stroke-width="2.6"/><path d="M11.5 12.5h1M9.5 9.5 11 8h2l1.5 1.5" ${st}/>`),
  knot: svg(`<path d="M3 8c4.5 0 4.5 8 9 8s4.5-8 9-8M3 16c4.5 0 4.5-8 9-8s4.5 8 9 8" ${st} stroke-width="2.4"/><circle cx="12" cy="12" r="2" fill="currentColor"/>`),
  cap: svg(`<path d="M4 15.5c0-5.2 3.6-9.5 8-9.5s8 4.3 8 9.5z" fill="currentColor"/><rect x="3" y="15.5" width="18" height="3.5" rx="1.7" fill="currentColor" opacity=".75"/><path d="M9.5 10.5c-.9-.9-2.3.2-1.2 1.3l1.2 1.1 1.2-1.1c1.1-1.1-.3-2.2-1.2-1.3zM14.8 9.3c-.9-.9-2.3.2-1.2 1.3l1.2 1.1 1.2-1.1c1.1-1.1-.3-2.2-1.2-1.3z" fill="#fff"/>`),
} as const;

export type IconName = keyof typeof ICONS;

/** Candado de corazón con grilletes; la cerradura se rellena con --fill (0..1) por CSS. */
export function heartPadlockSvg(cls = 'padlock'): string {
  return svg(
    `<path d="M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11" fill="none" stroke="#f5c542" stroke-width="2.4" stroke-linecap="round"/>
     <defs><clipPath id="plk-clip"><path d="M12 29s-9-5.3-10-11.5C1.3 13.6 4 10.5 7.5 10.5c2 0 3.4 1 4.5 2.4 1.1-1.4 2.5-2.4 4.5-2.4 3.5 0 6.2 3.1 5.5 7C21 23.7 12 29 12 29z"/></clipPath></defs>
     <path class="plk-bg" d="M12 29s-9-5.3-10-11.5C1.3 13.6 4 10.5 7.5 10.5c2 0 3.4 1 4.5 2.4 1.1-1.4 2.5-2.4 4.5-2.4 3.5 0 6.2 3.1 5.5 7C21 23.7 12 29 12 29z"/>
     <g clip-path="url(#plk-clip)"><rect class="plk-fill" x="0" y="10" width="24" height="20"/></g>
     <path class="plk-outline" d="M12 29s-9-5.3-10-11.5C1.3 13.6 4 10.5 7.5 10.5c2 0 3.4 1 4.5 2.4 1.1-1.4 2.5-2.4 4.5-2.4 3.5 0 6.2 3.1 5.5 7C21 23.7 12 29 12 29z" fill="none"/>
     <circle cx="12" cy="18.2" r="1.7" fill="#3b2146"/><path d="M12 19v3" stroke="#3b2146" stroke-width="1.6" stroke-linecap="round"/>
     <path class="plk-crack" d="M9 12.5 11 16.5 8.5 19 11 23M15.5 12.5 14 15.5 16.5 18" fill="none" stroke="#3b2146" stroke-width="1.2" stroke-linejoin="round"/>`,
    cls,
    '0 0 24 30',
  );
}

/** Corazón-batería de Éxito: relleno recortado desde abajo por --fill. */
export function heartBatterySvg(): string {
  return svg(
    `<defs><clipPath id="hb-clip"><path d="${HEART_PATH}"/></clipPath>
       <linearGradient id="hb-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8fc7"/><stop offset="1" stop-color="#ff2e93"/></linearGradient></defs>
     <path d="${HEART_PATH}" class="hb-bg"/>
     <g clip-path="url(#hb-clip)"><rect class="hb-fill" x="0" y="0" width="24" height="24" fill="url(#hb-grad)"/>
       <rect class="hb-shine" x="4" y="5" width="4" height="7" rx="2" fill="#fff" opacity=".45"/></g>
     <path d="${HEART_PATH}" class="hb-outline" fill="none"/>
     <path class="hb-crack" d="M12 7.7 10.2 10.8 13 13 10.8 16.2 12 18.5M6 9.5l2 2.2-1 2" fill="none" stroke-linejoin="round"/>`,
    'hb',
  );
}

export const STATE_ICON: Record<AssistantVisualState, IconName> = {
  ok: 'check',
  working: 'gear',
  distracted: 'spiral',
  trembling: 'zigzag',
  filming: 'camera',
  out: 'door',
  panic: 'alert',
};

export const STATE_LABEL: Record<AssistantVisualState, string> = {
  ok: 'Listo',
  working: 'Trabajando',
  distracted: 'Distraído',
  trembling: 'Temblando',
  filming: 'Grabando',
  out: 'Fuera',
  panic: 'Pánico',
};

/** Siluetas de instrumental (24×24). */
const INSTR: Record<InstrumentId, string> = {
  scalpel10: `<path d="M3 21 12 12" ${st} stroke-width="3"/><path d="M12 12c3-4 6-7 9-8-1 4-4 7-8 9.5z" fill="currentColor"/>`,
  scalpel15: `<path d="M3 21 12.5 11.5" ${st} stroke-width="3"/><path d="M12.5 11.5c2.5-3.5 5-5.5 7.5-6.5-.5 3-3 5.8-6.4 7.8z" fill="currentColor"/>`,
  cautery: `<path d="M4 20 14 10" ${st} stroke-width="3"/><path d="M14 10 17 7" ${st}/><path d="M18.5 2.5 16 7h3l-2.5 4.5" ${st} stroke-width="1.6"/>`,
  gelpi: `<path d="M6 21V11l-3-7M18 21V11l3-7M6 14h12" ${st}/><circle cx="12" cy="14" r="2" fill="currentColor"/>`,
  weitlaner: `<path d="M5 21V12M19 21V12M5 12l-2-5m2 5 2-5M19 12l-2-5m2 5 2-5M5 15h14" ${st}/>`,
  kern: `<path d="M5 21 10 12M19 21 14 12M10 12l-1-9 3 4 3-4-1 9" ${st}/><circle cx="12" cy="13" r="1.6" fill="currentColor"/>`,
  drill: `<path d="M3 10h11v6H3zM14 12h4M18 13h4" ${st}/><path d="M6 16l-1 5h4l1-5" ${st}/>`,
  saw: `<path d="M3 17h13v3H3zM16 18.5h3" ${st}/><path d="M4 17l1.5-4L7 17l1.5-4L10 17l1.5-4L13 17l1.5-4L16 17" ${st} stroke-width="1.5"/>`,
  burr: `<path d="M3 21 13 11" ${st} stroke-width="3"/><circle cx="16" cy="8" r="4" fill="currentColor"/><path d="M14 6l4 4M18 6l-4 4" stroke="#fff" stroke-width="1" opacity=".7"/>`,
  plate: `<rect x="2.5" y="8.5" width="19" height="7" rx="3.5" ${st}/><circle cx="7" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="17" cy="12" r="1.4" fill="currentColor"/>`,
  screwdriver: `<path d="M9 3h6v7H9z" fill="currentColor"/><path d="M12 10v8M10.5 18h3l-1.5 3z" ${st}/>`,
  needleHolder: `<path d="M4 20l7-7M20 20l-7-7M11 13l2-2M13 13l-2-2" ${st}/><circle cx="4" cy="20" r="1.8" ${st}/><circle cx="20" cy="20" r="1.8" ${st}/><path d="M12 11C9 9 9 4 13 3" ${st} stroke-width="1.5"/>`,
  bandage: `<rect x="3" y="8" width="18" height="8" rx="4" fill="currentColor"/><rect x="9" y="8" width="6" height="8" fill="#fff" opacity=".6"/><circle cx="11" cy="11" r=".7" fill="currentColor"/><circle cx="13" cy="13" r=".7" fill="currentColor"/>`,
  kwire: `<path d="M3 21 21 3" ${st} stroke-width="1.8"/><path d="M18 3h3v3" ${st}/>`,
  forceps: `<path d="M6 21 12 4l6 17M9 12h6" ${st}/>`,
  rasp: `<path d="M3 21 11 13" ${st} stroke-width="3"/><rect x="10" y="4" width="10" height="9" rx="2" transform="rotate(45 15 8.5)" fill="currentColor"/>`,
  carm: `<path d="M18 4a9 9 0 0 0 0 16" ${st} stroke-width="3"/><path d="M18 4h3M18 20h3M9 12h6" ${st}/>`,
  hand: `<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-6.5a1.5 1.5 0 0 1 3 0V11m0-5a1.5 1.5 0 0 1 3 0v6m0-3a1.5 1.5 0 0 1 3 0v5.5c0 4-3 7.5-7.5 7.5S5 19.5 3.5 16l-1-2.5a1.5 1.5 0 0 1 2.7-1.3L8 16" ${st}/>`,
};

export function instrumentIcon(id: InstrumentId): string {
  return svg(INSTR[id] ?? INSTR.hand, 'ic instr');
}

/** Cabecitas por especie (tarjetas de caso). */
export function speciesIcon(s: Species): string {
  if (s === 'cat')
    return svg(
      `<path d="M4 3l4 5h8l4-5v9a8 8 0 0 1-16 0z" fill="currentColor"/><circle cx="9" cy="12" r="1.3" fill="#fff"/><circle cx="15" cy="12" r="1.3" fill="#fff"/><path d="M11 15h2l-1 1z" fill="#fff"/>`,
      'ic species',
    );
  if (s === 'rabbit')
    return svg(
      `<ellipse cx="9" cy="6" rx="2" ry="5" fill="currentColor"/><ellipse cx="15" cy="6" rx="2" ry="5" fill="currentColor"/><circle cx="12" cy="15" r="7" fill="currentColor"/><circle cx="9.5" cy="14" r="1.2" fill="#fff"/><circle cx="14.5" cy="14" r="1.2" fill="#fff"/><path d="M11 17h2l-1 1z" fill="#fff"/>`,
      'ic species',
    );
  return svg(
    `<ellipse cx="5.2" cy="10.5" rx="2.8" ry="5.6" transform="rotate(18 5.2 10.5)" fill="currentColor" opacity=".75"/><ellipse cx="18.8" cy="10.5" rx="2.8" ry="5.6" transform="rotate(-18 18.8 10.5)" fill="currentColor" opacity=".75"/><circle cx="12" cy="12.5" r="7" fill="currentColor"/><circle cx="9.4" cy="11.5" r="1.3" fill="#fff"/><circle cx="14.6" cy="11.5" r="1.3" fill="#fff"/><ellipse cx="12" cy="15.6" rx="2.6" ry="1.9" fill="#fff" opacity=".9"/><ellipse cx="12" cy="14.9" rx="1.1" ry=".8" fill="currentColor"/>`,
    'ic species',
  );
}

export function icon(name: IconName): string {
  return ICONS[name];
}
