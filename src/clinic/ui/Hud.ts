/** HUD DOM de la clínica: reloj, objetivo, cola de dueños, minimapa, equipo, Emiliana, aviso E, subtítulos y etiquetas. */
import type { AssistantId, SpeakerId } from '../../core/contracts';
import { clamp } from '../../core/math';
import { computeHudLayout } from '../logic/hudLayout';
import { ROOMS, STATIONS, ZONE_IDS, ZONE_LABEL, type RoomId, type ZoneId } from '../logic/layout';
import type { OwnerState } from '../logic/owners';

export const SPEAKER_NAME: Record<SpeakerId, string> = {
  emiliana: 'Emiliana',
  valerio: 'Dr. Valerio',
  rodrigo: 'Rodrigo',
  fritz: 'Fritz',
  gigi: 'Gigi',
  hortensia: 'Doña Hortensia',
  braulio: 'Don Braulio',
  ownerA: 'Dueña',
  ownerB: 'Dueño',
  ownerC: 'Dueña',
  panchito: 'Panchito',
  sistema: 'Sistema',
  pareja: 'Pareja',
};
export const SPEAKER_COLOR: Record<SpeakerId, string> = {
  emiliana: '#ff5fae',
  valerio: '#b8c7d9',
  rodrigo: '#7de0a6',
  fritz: '#b8e1ff',
  gigi: '#ffe066',
  hortensia: '#ffb3d9',
  braulio: '#d9dde6',
  ownerA: '#c8a2e8',
  ownerB: '#9ff0d0',
  ownerC: '#ffd6a5',
  panchito: '#e8c9a0',
  sistema: '#ffffff',
  pareja: '#ff8fc7',
};
const AVATAR: Partial<Record<string, string>> = {
  hortensia: '#e58bbd',
  braulio: '#9aa3b5',
  ownerA: '#b79cf2',
  ownerB: '#3fcf9c',
  ownerC: '#ffb347',
  rodrigo: '#3fcf9c',
  valerio: '#7d8da3',
  gigi: '#f5c542',
  fritz: '#8fb8de',
};
export const ASSISTANT_NAME: Record<AssistantId, string> = { fritz: 'Fritz', rodrigo: 'Rodrigo', gigi: 'Gigi' };
const ASSISTANT_COLOR: Record<AssistantId, string> = { fritz: '#8fb8de', rodrigo: '#3fcf9c', gigi: '#f5c542' };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', parent?: HTMLElement, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  parent?.appendChild(e);
  return e;
}

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface TeamChipView {
  id: AssistantId;
  status: string;
  level: 'idle' | 'ok' | 'warn' | 'bad';
  morale: number;
}

export interface MapView {
  player: { x: number; z: number };
  panchito: { x: number; z: number } | null;
  owners: Array<{ x: number; z: number; case: boolean }>;
  team: Array<{ x: number; z: number; color: string }>;
  contamination: Record<ZoneId, number>;
  target: { x: number; z: number } | null;
  foiled: Array<'lightbox' | 'autoclave'>;
}

export interface WorldLabel {
  root: HTMLDivElement;
  setVisible(v: boolean): void;
  setPos(x: number, y: number): void;
}

export function createHud(uiRoot: HTMLElement, o: { tutorial: boolean; shiftSec: number }) {
  const root = el('div', 'cl-root', uiRoot);
  // etiquetas del mundo primero: quedan por debajo de los paneles del HUD
  const labels = el('div', 'cl-labels', root);
  const top = el('div', 'cl-top', root);
  const clock = el('div', 'cl-clock', top);
  clock.innerHTML = `<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="none" stroke="rgba(59,33,70,.15)" stroke-width="5"/><circle class="arc" cx="20" cy="20" r="16" fill="none" stroke="#ff2e93" stroke-width="5" stroke-linecap="round" stroke-dasharray="100.5" stroke-dashoffset="0"/></svg><div><div class="lbl">${o.tutorial ? 'Tutorial · sin prisa' : 'Turno de clínica'}</div><div class="t">05:00</div></div>`;
  const clockT = clock.querySelector('.t') as HTMLElement;
  const clockArc = clock.querySelector('.arc') as SVGCircleElement;
  // el objetivo va en su propia capa: en ventanas estrechas baja por debajo de la cola y el minimapa
  const objWrap = el('div', 'cl-obj', root);
  const objective = el('div', 'cl-objective', objWrap, '<span class="arrow">➜</span><span class="tx"></span>');
  const objectiveTx = objective.querySelector('.tx') as HTMLElement;
  const toasts = el('div', 'cl-toasts', root);

  const queue = el('div', 'cl-queue', root);
  el('h3', '', queue, 'Sala de espera');
  const queueList = el('div', '', queue);
  queueList.style.cssText = 'display:flex;flex-direction:column;gap:8px';

  const map = el('div', 'cl-map', root);
  const mapCanvas = el('canvas', '', map);
  mapCanvas.width = 480;
  mapCanvas.height = 296;
  const legend = el('div', 'legend', map);
  const legendBars = {} as Record<ZoneId, HTMLElement>;
  for (const z of ZONE_IDS) {
    const d = el('div', '', legend, `<span>${ZONE_LABEL[z]}</span><div class="cl-bar"><i style="width:0%"></i></div>`);
    legendBars[z] = d.querySelector('i') as HTMLElement;
  }

  const team = el('div', 'cl-team', root);
  const chips = {} as Record<AssistantId, { root: HTMLElement; st: HTMLElement; mor: HTMLElement }>;
  for (const id of ['fritz', 'rodrigo', 'gigi'] as AssistantId[]) {
    const c = el('div', 'cl-chip', team);
    c.innerHTML = `<div class="top"><span class="dot" style="background:${ASSISTANT_COLOR[id]}"></span>${ASSISTANT_NAME[id]}</div><div class="st"></div><div class="mor">Moral<div class="cl-bar"><i></i></div></div>`;
    chips[id] = { root: c, st: c.querySelector('.st') as HTMLElement, mor: c.querySelector('.mor i') as HTMLElement };
  }

  const emi = el('div', 'cl-emi', root);
  emi.innerHTML = `<div class="nm">Dra. Emiliana <span class="hc">0 HC</span></div>
    <div class="row"><span>Concentración</span><div class="cl-bar conc"><i></i></div></div>
    <div class="row"><span>Reserva emocional</span><div class="cl-bar res"><i></i></div></div>
    <div class="carry"></div>`;
  const emiHc = emi.querySelector('.hc') as HTMLElement;
  const emiConc = emi.querySelector('.conc i') as HTMLElement;
  const emiRes = emi.querySelector('.res i') as HTMLElement;
  const emiCarry = emi.querySelector('.carry') as HTMLElement;

  const subs = el('div', 'cl-subs', root);
  const prompt = el('div', 'cl-prompt', root);
  prompt.innerHTML = `<span class="key"><svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="19" fill="none" stroke="#3fcf9c" stroke-width="4" stroke-linecap="round" stroke-dasharray="119.4" stroke-dashoffset="119.4"/></svg><span class="kl">E</span></span><span class="tx"></span>`;
  const promptTx = prompt.querySelector('.tx') as HTMLElement;
  const promptKey = prompt.querySelector('.kl') as HTMLElement;
  const promptRing = prompt.querySelector('circle') as SVGCircleElement;
  const hint = el('div', 'cl-hint', root, '<span><span class="k-key">WASD</span> moverse</span><span><span class="k-key">E</span> interactuar</span><span><span class="k-key">Espacio</span> placaje</span>');
  const modal = el('div', '', root);
  modal.style.cssText = 'position:absolute;inset:0;pointer-events:none';
  const fade = el('div', 'cl-fade', root, '<span>¡Al quirófano!</span>');

  // ── estado para evitar escrituras DOM innecesarias ──
  let lastClock = '';
  let lastObjective = '';
  let lastUrgent = false;
  let lastPrompt = '';
  let lastPromptKey = '';
  const ownerRows = new Map<string, { root: HTMLElement; pat: HTMLElement; patBar: HTMLElement; hist: HTMLElement | null; histBar: HTMLElement | null; tag: HTMLElement }>();

  function setClock(secLeft: number, total: number, hurry: boolean, countUp: number | null): void {
    const v = countUp !== null ? countUp : secLeft;
    const m = Math.floor(Math.max(0, v) / 60);
    const s = Math.floor(Math.max(0, v) % 60);
    const txt = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    if (txt !== lastClock) {
      clockT.textContent = txt;
      lastClock = txt;
      const frac = countUp !== null ? 1 : clamp(secLeft / total, 0, 1);
      clockArc.setAttribute('stroke-dashoffset', String(100.5 * (1 - frac)));
      clockArc.setAttribute('stroke', frac < 0.2 ? '#ff4d6d' : frac < 0.5 ? '#ffb347' : '#ff2e93');
      clock.classList.toggle('hurry', hurry);
    }
  }

  // ── escala y colocación según el tamaño (como --hud-s del quirófano) ──
  let lastLayoutKey = '';
  function layout(force = false): void {
    const w = root.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1280);
    const h = root.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 720);
    const key = `${w}x${h}|${queueList.childElementCount}|${lastObjective}`;
    if (!force && key === lastLayoutKey) return;
    lastLayoutKey = key;
    const objH = objective.offsetHeight;
    const l = computeHudLayout({
      w,
      h,
      queue: { w: queue.offsetWidth, h: queue.offsetHeight },
      map: { w: map.offsetWidth, h: map.offsetHeight },
      clock: { h: clock.offsetHeight },
      objective: { h: objH },
      team: { w: team.offsetWidth, h: team.offsetHeight },
      emi: { w: emi.offsetWidth, h: emi.offsetHeight },
      // el aviso E cambia de ancho; se reserva uno típico
      bottomCenterW: Math.max(hint.offsetWidth, 440),
    });
    const st = root.style;
    st.setProperty('--cl-s', l.s.toFixed(3));
    st.setProperty('--cl-obj-top', `${l.objTop.toFixed(1)}px`);
    st.setProperty('--cl-obj-max', `${Math.floor(l.objMaxW)}px`);
    st.setProperty('--cl-bb', `${l.bottomBase.toFixed(1)}px`);
    root.classList.toggle('narrow-top', l.narrowTop);
    root.classList.toggle('narrow-bottom', l.narrowBottom);
    // el alto del objetivo depende del ancho máximo recién puesto: se mide otra vez para los avisos
    const toastTop = l.toastTop + (objective.offsetHeight - objH) * l.s;
    st.setProperty('--cl-toast-top', `${toastTop.toFixed(1)}px`);
  }
  let ro: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => layout(true));
    ro.observe(root);
  } else if (typeof window !== 'undefined') window.addEventListener('resize', onWinResize);
  function onWinResize(): void {
    layout(true);
  }

  function setObjective(text: string, urgent: boolean): void {
    if (text === lastObjective && urgent === lastUrgent) return;
    lastObjective = text;
    lastUrgent = urgent;
    objectiveTx.textContent = text;
    layout();
    objective.classList.remove('urgent');
    if (urgent) {
      void objective.offsetWidth;
      objective.classList.add('urgent');
    }
  }

  function setQueue(owners: OwnerState[], targetId: string | null): void {
    for (const o of owners) {
      let row = ownerRows.get(o.id);
      if (!row) {
        const r = el('div', `cl-owner ${o.kind}`, queueList);
        const initial = o.name.replace(/^(Doña|Don|Sra\.|Sr\.|Dr\.|Profesor)\s+/i, '').charAt(0);
        const hasHist = o.histeria !== null;
        r.innerHTML = `<div class="cl-avatar" style="background:${AVATAR[o.human] ?? '#c8a2e8'}">${esc(initial)}</div>
          <div class="nm">${esc(o.name)}<span class="cl-tag ${o.kind === 'case' ? '' : 'mint'}">${o.kind === 'case' ? 'CASO' : 'MENOR'}</span></div>
          <div class="sub">${esc(o.petName)} · ${esc(o.kind === 'case' ? 'caso de la semana' : o.errand)}</div>
          <div class="cl-bar-row"><span class="ic">♥</span><div class="cl-bar pat"><i></i></div></div>
          ${hasHist ? '<div class="cl-bar-row"><span class="ic">↯</span><div class="cl-bar hist"><i></i></div></div>' : ''}`;
        row = {
          root: r,
          pat: r.querySelector('.pat') as HTMLElement,
          patBar: r.querySelector('.pat i') as HTMLElement,
          hist: r.querySelector('.hist') as HTMLElement | null,
          histBar: r.querySelector('.hist i') as HTMLElement | null,
          tag: r.querySelector('.cl-tag') as HTMLElement,
        };
        ownerRows.set(o.id, row);
        layout();
      }
      row.patBar.style.width = `${o.patience.toFixed(1)}%`;
      row.pat.classList.toggle('low', o.patience < 30);
      row.pat.classList.toggle('crit', o.patience < 15 && o.status === 'waiting');
      if (row.histBar && o.histeria !== null) {
        row.histBar.style.width = `${o.histeria.toFixed(1)}%`;
        row.hist!.classList.toggle('crit', o.histeria > 80);
      }
      const gone = o.status !== 'waiting';
      row.root.classList.toggle('gone', gone);
      row.root.classList.toggle('target', o.id === targetId);
      const tagText = o.status === 'served' ? '✓ LISTO' : o.status === 'left' ? 'SE FUE' : o.faintLeft > 0 ? 'DESMAYADA' : o.kind === 'case' ? 'CASO' : 'MENOR';
      if (row.tag.textContent !== tagText) {
        row.tag.textContent = tagText;
        row.tag.className = `cl-tag ${o.status === 'served' ? 'mint' : o.status === 'left' ? 'gray' : o.kind === 'case' ? '' : 'mint'}`;
      }
    }
  }

  function setTeam(views: TeamChipView[]): void {
    for (const v of views) {
      const c = chips[v.id];
      if (c.st.textContent !== v.status) c.st.textContent = v.status;
      c.root.classList.toggle('assigned', v.level === 'ok');
      c.root.classList.toggle('warn', v.level === 'warn');
      c.root.classList.toggle('bad', v.level === 'bad');
      c.mor.style.width = `${v.morale}%`;
    }
  }

  function setEmiliana(conc: number, reserve: number, hc: number, carry: string): void {
    emiConc.style.width = `${clamp(conc, 0, 100)}%`;
    emiRes.style.width = `${clamp(reserve, 0, 100)}%`;
    const t = `${Math.round(hc)} HC`;
    if (emiHc.textContent !== t) emiHc.textContent = t;
    if (emiCarry.textContent !== carry) emiCarry.textContent = carry;
  }

  // ── minimapa ──
  const mg = mapCanvas.getContext('2d')!;
  const MW = mapCanvas.width;
  const MH = mapCanvas.height;
  const mx = (x: number) => ((x + 13.4) / 26.8) * MW;
  const mz = (z: number) => ((z + 8.4) / 16.8) * MH;
  const zoneColor = (v: number) => {
    const a = v < 0.5 ? v / 0.5 : 1;
    const b = v < 0.5 ? 0 : (v - 0.5) / 0.5;
    const r = Math.round(159 + (255 - 159) * a);
    const gC = Math.round(240 + (216 - 240) * a + (77 - 216) * b);
    const bl = Math.round(208 + (77 - 208) * a + (109 - 77) * b);
    return `rgb(${r},${gC},${bl})`;
  };
  function drawMap(v: MapView, t: number): void {
    mg.clearRect(0, 0, MW, MH);
    for (const id of Object.keys(ROOMS) as RoomId[]) {
      const r = ROOMS[id];
      const zone = id === 'or' || id === 'prep' || id === 'autoclave' ? (id as ZoneId) : null;
      mg.fillStyle = zone ? zoneColor(v.contamination[zone]) : id === 'waiting' ? '#ffe3f1' : id === 'exam' ? '#d7fbef' : '#fff1e0';
      mg.fillRect(mx(r.minX) + 2, mz(r.minZ) + 2, mx(r.maxX) - mx(r.minX) - 4, mz(r.maxZ) - mz(r.minZ) - 4);
      if (zone && v.contamination[zone] > 0.5 && Math.sin(t * 8) > 0) {
        mg.strokeStyle = '#ff2e93';
        mg.lineWidth = 4;
        mg.strokeRect(mx(r.minX) + 3, mz(r.minZ) + 3, mx(r.maxX) - mx(r.minX) - 6, mz(r.maxZ) - mz(r.minZ) - 6);
      }
    }
    mg.fillStyle = 'rgba(59,33,70,0.55)';
    mg.font = '800 17px Nunito, sans-serif';
    mg.textAlign = 'center';
    const lbl: Array<[string, number, number]> = [
      ['EXPLORACIÓN', -8.7, -7.1],
      ['PREPARACIÓN', -0.5, -7.1],
      ['QUIRÓFANO', 8.2, -3.1],
      ['AUTOCLAVE', 9, 7.4],
      ['SALA DE ESPERA', -4, 7.4],
    ];
    for (const [s, x, z] of lbl) mg.fillText(s, mx(x), mz(z));
    // estaciones
    mg.fillStyle = 'rgba(59,33,70,0.35)';
    for (const s of Object.values(STATIONS)) {
      mg.beginPath();
      mg.arc(mx(s.pos.x), mz(s.pos.z), 5, 0, Math.PI * 2);
      mg.fill();
    }
    for (const f of v.foiled) {
      const s = STATIONS[f].pos;
      mg.fillStyle = Math.sin(t * 10) > 0 ? '#c9ced8' : '#ff2e93';
      mg.fillRect(mx(s.x) - 8, mz(s.z) - 8, 16, 16);
    }
    if (v.target) {
      mg.strokeStyle = '#ff2e93';
      mg.lineWidth = 3;
      mg.beginPath();
      mg.arc(mx(v.target.x), mz(v.target.z), 11 + Math.sin(t * 5) * 3, 0, Math.PI * 2);
      mg.stroke();
    }
    for (const o of v.owners) {
      mg.fillStyle = o.case ? '#ff2e93' : '#b79cf2';
      mg.beginPath();
      mg.arc(mx(o.x), mz(o.z), 6, 0, Math.PI * 2);
      mg.fill();
    }
    for (const a of v.team) {
      mg.fillStyle = a.color;
      mg.strokeStyle = '#3b2146';
      mg.lineWidth = 2;
      mg.beginPath();
      mg.arc(mx(a.x), mz(a.z), 6, 0, Math.PI * 2);
      mg.fill();
      mg.stroke();
    }
    if (v.panchito) {
      mg.fillStyle = '#c98a4b';
      mg.strokeStyle = '#ffffff';
      mg.lineWidth = 3;
      mg.beginPath();
      mg.arc(mx(v.panchito.x), mz(v.panchito.z), 7, 0, Math.PI * 2);
      mg.fill();
      mg.stroke();
    }
    // Emiliana: corazón fucsia
    const px = mx(v.player.x);
    const pz = mz(v.player.z);
    mg.fillStyle = '#ff2e93';
    mg.strokeStyle = '#fff';
    mg.lineWidth = 3;
    mg.beginPath();
    mg.moveTo(px, pz + 8);
    mg.bezierCurveTo(px - 13, pz - 2, px - 6, pz - 13, px, pz - 5);
    mg.bezierCurveTo(px + 6, pz - 13, px + 13, pz - 2, px, pz + 8);
    mg.stroke();
    mg.fill();
    for (const z of ZONE_IDS) legendBars[z].style.width = `${(v.contamination[z] * 100).toFixed(0)}%`;
  }

  function setPrompt(text: string | null, hold: number | null, key = 'E', disabled = false): void {
    const sig = text ?? '';
    if (sig !== lastPrompt) {
      lastPrompt = sig;
      if (text) {
        promptTx.textContent = text;
        prompt.classList.add('show');
      } else prompt.classList.remove('show');
    }
    if (key !== lastPromptKey) {
      lastPromptKey = key;
      promptKey.textContent = key;
    }
    prompt.classList.toggle('disabled', disabled);
    promptRing.setAttribute('stroke-dashoffset', String(119.4 * (1 - clamp(hold ?? 0, 0, 1))));
  }

  function subtitle(speaker: SpeakerId, text: string, dur = 3.2, displayName?: string): void {
    const s = el('div', 'cl-sub', subs, `<b style="color:${SPEAKER_COLOR[speaker] ?? '#fff'}">${esc(displayName ?? SPEAKER_NAME[speaker] ?? speaker)}:</b>${esc(text)}`);
    while (subs.children.length > 3) subs.firstElementChild?.remove();
    window.setTimeout(() => s.classList.add('out'), Math.max(1200, dur * 1000));
    window.setTimeout(() => s.remove(), Math.max(1200, dur * 1000) + 450);
  }

  function toast(text: string, kind: 'info' | 'good' | 'bad' = 'info'): void {
    const t = el('div', `cl-toast ${kind === 'info' ? '' : kind}`, toasts);
    t.textContent = text;
    while (toasts.children.length > 3) toasts.firstElementChild?.remove();
    window.setTimeout(() => t.classList.add('out'), 2600);
    window.setTimeout(() => t.remove(), 3100);
  }

  function addLabel(html: string): WorldLabel {
    const r = el('div', 'cl-wl', labels, html);
    let vis = true;
    return {
      root: r,
      setVisible(v) {
        if (v !== vis) {
          vis = v;
          r.style.display = v ? '' : 'none';
        }
      },
      setPos(x, y) {
        r.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      },
    };
  }

  return {
    root,
    modalLayer: modal,
    setClock,
    setObjective,
    setQueue,
    setTeam,
    setEmiliana,
    drawMap,
    setPrompt,
    subtitle,
    toast,
    addLabel,
    fade(on: boolean) {
      fade.classList.toggle('on', on);
    },
    dispose() {
      ro?.disconnect();
      if (typeof window !== 'undefined') window.removeEventListener('resize', onWinResize);
      root.remove();
    },
  };
}
export type ClinicHud = ReturnType<typeof createHud>;
