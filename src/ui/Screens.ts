/**
 * Pantallas y menús: título, selección de caso, briefing, auditoría de Valerio,
 * Boutique, ajustes, pausa e intersticial entre fases. Una pantalla visible a la vez.
 */
import './theme.css';
import './screens.css';
import type {
  AudioAPI,
  AuditResult,
  BoutiqueItem,
  CaseDef,
  PartnerProfile,
  Rank,
  SaveData,
  ScreensAPI,
  Settings,
  SfxName,
} from '../core/contracts';
import { clamp } from '../core/math';
import { createRng } from '../core/rng';
import { fromHtml, h } from './logic/dom';
import { fmtDec, fmtInt, fmtTime } from './logic/format';
import { ICONS, heartPadlockSvg, instrumentIcon, speciesIcon, type IconName } from './icons';
import { createPortrait } from './portraits';
import { COMPONENT_LABEL, COMPONENT_WEIGHT, RANK_WORD } from './speakers';

type CompKey = 'T' | 'E' | 'H' | 'S' | 'L' | 't';
const COMP_ORDER: CompKey[] = ['T', 'E', 'H', 'S', 'L', 't'];
const RANK_SHAPE: Record<Rank, IconName> = { S: 'star', A: 'heart', B: 'diamond', C: 'triangle', F: 'cross' };
const DIFF_LABEL: Record<Settings['difficulty'], string> = { residente: 'Residente', especialista: 'Especialista', jefe: 'Jefe de Servicio' };

/** Estado interno de la pantalla activa (temporizadores y cuadros a cancelar). */
interface Active {
  /** Capa a pantalla completa (fondo, atenuado). */
  root: HTMLElement;
  /** Escenario lógico de 1280×720 escalado uniformemente. */
  el: HTMLElement;
  timers: number[];
  rafs: number[];
  cleanup: Array<() => void>;
}

export function createScreens(root: HTMLElement, audio: AudioAPI | null): ScreensAPI {
  const host = h('div', 'emi-screens', root);
  host.style.display = 'none';
  const applyScale = () => {
    const w = host.clientWidth || window.innerWidth;
    const hh = host.clientHeight || window.innerHeight;
    host.style.setProperty('--s', clamp(Math.min(w / 1280, hh / 720), 0.5, 2).toFixed(4));
  };
  let ro: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(applyScale);
    ro.observe(host);
  } else window.addEventListener('resize', applyScale);
  void ro;
  let active: Active | null = null;
  let lastHover = 0;
  /** Reto mostrado en el último briefing de cada caso (para no hablar de un reto que no hubo). */
  const introChallenge = new Map<string, boolean>();

  const sfx = (name: SfxName, volume?: number) => {
    try {
      audio?.play(name, volume !== undefined ? { volume } : undefined);
    } catch {
      /* el audio nunca debe romper la interfaz */
    }
  };

  /**
   * ¿Hubo reto de Valerio en esta partida? AuditResult no lo dice: se usa el briefing del caso
   * y, si se saltó (?skip=clinic), la misma regla que GameFlow (sin reto en tutorial ni antes de la
   * semana 5 salvo en Jefe de Servicio).
   */
  function hadChallenge(c: CaseDef, save: SaveData): boolean {
    const seen = introChallenge.get(c.id);
    if (seen !== undefined) return seen;
    if (c.flags.tutorial || c.valerioChallenges.length === 0) return false;
    return c.week >= 5 || save.settings.difficulty === 'jefe';
  }

  function unmount() {
    if (!active) return;
    for (const t of active.timers) clearTimeout(t);
    for (const r of active.rafs) cancelAnimationFrame(r);
    for (const c of active.cleanup) c();
    active.root.remove();
    active = null;
  }

  function mount(cls: string): Active {
    unmount();
    host.style.display = '';
    const scr = h('div', `scr ${cls}`, host);
    const el = h('div', 'scr-stage', scr);
    active = { root: scr, el, timers: [], rafs: [], cleanup: [] };
    applyScale();
    return active;
  }

  const later = (a: Active, ms: number, fn: () => void) => {
    a.timers.push(window.setTimeout(fn, ms));
  };

  /** Animación por fotogramas ligada a la pantalla activa. */
  function animate(a: Active, durMs: number, fn: (k: number) => void, delayMs = 0, done?: () => void) {
    const startAt = performance.now() + delayMs;
    const tick = (now: number) => {
      if (active !== a) return;
      const k = clamp((now - startAt) / durMs, 0, 1);
      fn(k);
      if (k < 1) a.rafs.push(requestAnimationFrame(tick));
      else done?.();
    };
    a.rafs.push(requestAnimationFrame(tick));
  }

  function button(parent: HTMLElement, label: string, cls: string, onClick: () => void, icon?: IconName): HTMLButtonElement {
    const b = h('button', `k-btn scr-btn ${cls}`, parent);
    b.type = 'button';
    if (icon) fromHtml(ICONS[icon], 'btn-ic', b);
    h('span', '', b, label);
    b.addEventListener('click', () => {
      if (b.disabled) return;
      sfx('uiClick');
      onClick();
    });
    b.addEventListener('pointerenter', () => {
      const t = performance.now();
      if (!b.disabled && t - lastHover > 90) {
        lastHover = t;
        sfx('uiHover', 0.5);
      }
    });
    return b;
  }

  /** Fondo pastel animado con corazones y huesitos flotando (posiciones deterministas). */
  function background(parent: HTMLElement, seed: number, count = 16) {
    const bg = h('div', 'scr-bg');
    parent.prepend(bg);
    const layer = h('div', 'floaters', bg);
    const rng = createRng(seed);
    for (let i = 0; i < count; i++) {
      const kind = rng() < 0.55 ? 'heart' : rng() < 0.6 ? 'bone' : 'sparkle';
      const f = fromHtml(ICONS[kind], `floater f-${kind}`, layer);
      f.style.left = `${(rng() * 100).toFixed(1)}%`;
      f.style.setProperty('--sz', `${Math.round(14 + rng() * 26)}px`);
      f.style.setProperty('--dur', `${(14 + rng() * 16).toFixed(1)}s`);
      f.style.setProperty('--delay', `${(-rng() * 30).toFixed(1)}s`);
      f.style.setProperty('--rot', `${Math.round(rng() * 360)}deg`);
      f.style.setProperty('--sway', `${Math.round(10 + rng() * 40)}px`);
    }
    return bg;
  }

  function parentDim(a: Active) {
    const d = h('div', 'scr-dim');
    a.root.prepend(d);
  }

  function coinsChip(parent: HTMLElement, coins: number) {
    const c = h('div', 'coins-chip', parent);
    fromHtml(ICONS.coin, 'cc-ic', c);
    const v = h('b', '', c, fmtInt(coins));
    h('span', 'cc-unit', c, 'HC');
    return v;
  }

  function starsEl(parent: HTMLElement, rep: number) {
    const w = h('div', 'rep-stars', parent);
    w.setAttribute('aria-label', `Reputación ${fmtDec(rep, 1)} de 5`);
    const row = h('div', 'stars', w);
    for (let i = 0; i < 5; i++) {
      const s = h('span', 'star', row);
      s.innerHTML = ICONS.star + ICONS.star;
      s.style.setProperty('--fill', String(clamp(rep - i, 0, 1)));
    }
    h('b', 'rep-num', w, fmtDec(rep, 1));
    return w;
  }

  function bones(parent: HTMLElement, n: number) {
    const w = h('div', 'bones', parent);
    w.setAttribute('aria-label', `Dificultad ${n} de 5`);
    for (let i = 0; i < 5; i++) fromHtml(ICONS.bone, `bone${i < n ? ' on' : ''}`, w);
    return w;
  }

  function rankStamp(parent: HTMLElement, rank: Rank, cls = '') {
    const s = h('div', `rank-stamp rk-${rank} ${cls}`, parent);
    fromHtml(ICONS[RANK_SHAPE[rank]], 'rs-shape', s);
    h('b', 'rs-letter', s, rank);
    return s;
  }

  function header(a: Active, title: string, sub: string, onBack: (() => void) | null) {
    const hd = h('header', 'scr-head', a.el);
    if (onBack) button(hd, 'Volver', 'ghost back', onBack, 'back');
    const tt = h('div', 'sh-titles', hd);
    h('h1', 'sh-title', tt, title);
    if (sub) h('p', 'sh-sub', tt, sub);
    const right = h('div', 'sh-right', hd);
    return right;
  }

  const api: ScreensAPI = {
    // ═════════════ Título ═════════════
    showTitle(o) {
      const a = mount('scr-title');
      background(a.root, 7, 22);
      const wrap = h('div', 'title-wrap', a.el);
      const left = h('div', 'title-left', wrap);
      const logo = h('div', 'logo', left);
      h('div', 'logo-pre', logo, 'Dra.');
      const main = h('div', 'logo-main', logo);
      main.setAttribute('data-text', 'Emiliana');
      main.textContent = 'Emiliana';
      const ribbon = h('div', 'logo-sub', logo);
      h('i', 'k-dring rb-l', ribbon);
      h('span', '', ribbon, 'Kinky-Kawaii Ortho-Gore');
      h('i', 'k-dring rb-r', ribbon);
      fromHtml(heartPadlockSvg('padlock title-lock'), 'logo-lock', logo);
      const menu = h('nav', 'title-menu', left);
      const play = button(menu, 'Jugar', 'big', o.onPlay, 'play');
      const cont = button(menu, 'Continuar', 'mint', o.onContinue, 'retry');
      cont.disabled = !o.hasSave;
      if (!o.hasSave) cont.title = 'Aún no hay partida guardada';
      button(menu, 'Boutique', 'ghost', o.onBoutique, 'bag2');
      button(menu, 'Ajustes', 'ghost', o.onSettings, 'settings');
      const cw = h('aside', 'cw-box', left);
      const cwh = h('div', 'cw-head', cw);
      fromHtml(ICONS.alert, 'cw-ic', cwh);
      h('b', '', cwh, 'Aviso de contenido');
      const ul = h('ul', 'cw-list', cw);
      const items: Array<[IconName, string]> = [
        ['speech', 'Humor negro de quirófano, con cariño.'],
        ['drop', 'Sangre regulable: nivel de gore 0–100 y Modo Pastel.'],
        ['heart', 'Estética fetish de moda. Sin desnudos ni contenido sexual.'],
        ['paw', 'Ningún animal muere. Jamás. Palabra de cirujana.'],
      ];
      for (const [ic, txt] of items) {
        const li = h('li', '', ul);
        fromHtml(ICONS[ic], 'cwl-ic', li);
        h('span', '', li, txt);
      }
      const right = h('div', 'title-right', wrap);
      const halo = h('div', 'mascot', right);
      h('i', 'mascot-halo', halo);
      createPortrait('emiliana', halo, 'mascot-pt');
      const bubble = h('div', 'mascot-bubble', right, '¡Bisturí, cielo! Hoy salvamos patitas.');
      bubble.setAttribute('aria-hidden', 'true');
      const tag = h('div', 'mascot-tag', right);
      h('b', '', tag, 'Dra. Emiliana');
      h('span', '', tag, 'Cirujana ortopédica veterinaria');
      h('footer', 'title-foot', a.el, 'Todos los humanos son adultos · Datos veterinarios aproximados, pendientes de revisión profesional');
      play.focus({ preventScroll: true });
    },

    // ═════════════ Selección de caso ═════════════
    showCaseSelect(o) {
      const a = mount('scr-cases');
      background(a.root, 11, 12);
      const right = header(a, 'Agenda de casos', 'Ocho pacientes, una cirujana y un equipo que lo complica todo.', o.onBack);
      starsEl(right, o.save.reputation);
      coinsChip(right, o.save.coins);
      button(right, 'Boutique', 'ghost small', o.onBoutique, 'bag2');
      const grid = h('div', 'case-grid', a.el);
      const sorted = [...o.cases].sort((x, y) => x.index - y.index);
      sorted.forEach((c, i) => {
        const unlocked = o.isUnlocked(c);
        const card = h('button', `case-card${unlocked ? '' : ' locked'}`, grid);
        card.type = 'button';
        card.style.setProperty('--i', String(i));
        card.style.setProperty('--tint', ['#ffd6ec', '#d9fff0', '#eadcff', '#fff0c2'][i % 4]);
        const band = h('div', 'cc-band', card);
        h('span', 'cc-week', band, `Semana ${c.week}`);
        if (c.flags.tutorial) h('span', 'cc-flag', band, 'Tutorial');
        if (c.flags.final) h('span', 'cc-flag final', band, 'Final');
        fromHtml(speciesIcon(c.patient.species), 'cc-species', card);
        h('div', 'cc-name', card, c.patient.name);
        h('div', 'cc-breed', card, `${c.patient.breed} · ${fmtDec(c.patient.weightKg, 1)} kg`);
        h('div', 'cc-proc', card, c.procedure);
        // Motivo de consulta, no el diagnóstico: descubrirlo es trabajo de la clínica
        h('div', 'cc-dx', card, `«${c.clinic.complaint}»`);
        h('div', 'cc-owner', card, `Dueño/a: ${c.owner.name}`);
        const foot = h('div', 'cc-foot', card);
        bones(foot, c.difficulty);
        const fee = h('span', 'cc-fee', foot);
        fromHtml(ICONS.coin, 'fee-ic', fee);
        h('b', '', fee, fmtInt(c.feeHC));
        const best = o.save.completed[c.id];
        if (best) rankStamp(card, best, 'cc-best');
        if (!unlocked) {
          card.disabled = true;
          const lock = h('div', 'cc-lock', card);
          fromHtml(heartPadlockSvg('padlock lock-big'), 'lock-ic', lock);
          const req =
            o.save.unlockedWeek < c.week
              ? `Completa la semana ${Math.max(0, c.week - 1)}`
              : `Requiere ${fmtDec(c.requiredReputation, c.requiredReputation % 1 ? 1 : 0)} ★ de reputación`;
          h('span', 'lock-txt', lock, req);
          card.setAttribute('aria-label', `${c.patient.name}: bloqueado. ${req}`);
        } else {
          card.setAttribute('aria-label', `${c.patient.name}, ${c.procedure}, dificultad ${c.difficulty}`);
          card.addEventListener('click', () => {
            sfx('uiClick');
            o.onPick(c.id);
          });
          card.addEventListener('pointerenter', () => sfx('uiHover', 0.4));
        }
      });
      (grid.querySelector('.case-card:not(.locked)') as HTMLElement | null)?.focus({ preventScroll: true });
    },

    // ═════════════ Briefing ═════════════
    showCaseIntro(o) {
      const a = mount('scr-intro');
      background(a.root, 23, 10);
      const c = o.caseDef;
      introChallenge.set(c.id, o.challenge !== null);
      header(a, `Semana ${c.week}: ${c.patient.name}`, c.procedure, null);
      const body = h('div', 'intro-body', a.el);
      // Expediente
      const dossier = h('section', 'dossier', body);
      h('i', 'clip', dossier);
      const dh = h('div', 'dos-head', dossier);
      fromHtml(speciesIcon(c.patient.species), 'dos-species', dh);
      const dn = h('div', '', dh);
      h('div', 'dos-name', dn, c.patient.name);
      h('div', 'dos-breed', dn, `${c.patient.breed} · ${fmtDec(c.patient.weightKg, 1)} kg · ${c.patient.ageText}`);
      const dl = h('dl', 'dos-list', dossier);
      const row = (k: string, v: string | HTMLElement) => {
        h('dt', '', dl, k);
        const dd = h('dd', '', dl);
        if (typeof v === 'string') dd.textContent = v;
        else dd.appendChild(v);
      };
      row('Dueño/a', c.owner.name);
      row('Motivo', c.clinic.complaint);
      row('Procedimiento', c.procedure);
      const bw = document.createElement('div');
      bones(bw, c.difficulty);
      row('Dificultad', bw);
      row('Tiempo objetivo', fmtTime(o.settings.difficulty === 'jefe' ? c.targetTimeSec * 0.8 : c.targetTimeSec));
      const feeEl = document.createElement('span');
      feeEl.className = 'dos-fee';
      feeEl.innerHTML = `${ICONS.coin}<b>${fmtInt(c.feeHC)} HC</b>`;
      row('Tarifa', feeEl);
      row('Modo', DIFF_LABEL[o.settings.difficulty]);
      // Negatoscopio sin marcar: la lesión se descubre en la clínica (exploración y rayos X)
      const xr = h('div', 'xray pending', dossier);
      fromHtml(ICONS.bone, 'xr-bone', xr);
      h('span', 'xr-lbl', xr, `Rx · ${c.patient.name} · pendiente`);
      h('span', 'xr-tag', xr, '¿?');
      // Columna derecha
      const col = h('div', 'intro-col', body);
      const mech = h('section', 'mech-card', col);
      const mh = h('div', 'mech-head', mech);
      fromHtml(ICONS.sparkle, 'mech-ic', mh);
      h('b', '', mh, 'Mecánica nueva');
      h('p', 'mech-txt', mech, c.newMechanic);
      const brief = h('section', 'brief-card', col);
      const bh = h('div', 'brief-head', brief);
      createPortrait('emiliana', bh, 'brief-pt');
      h('b', '', bh, 'Informe previo');
      const lines = h('div', 'brief-lines', brief);
      const lineEls = c.intro.map((t) => {
        const p = h('p', 'brief-line', lines);
        p.dataset.full = t;
        return p;
      });
      // Máquina de escribir: una línea tras otra; clic para completar.
      let skip = false;
      brief.addEventListener('click', () => (skip = true));
      let li = 0;
      let ci = 0;
      let acc = 0;
      let last = performance.now();
      const typeTick = (now: number) => {
        if (active !== a) return;
        const dt = Math.min(0.25, (now - last) / 1000);
        last = now;
        if (skip) {
          for (const p of lineEls) {
            p.textContent = p.dataset.full ?? '';
            p.classList.add('done');
          }
          return;
        }
        acc += dt * 48;
        while (acc >= 1 && li < lineEls.length) {
          acc -= 1;
          const full = lineEls[li].dataset.full ?? '';
          ci++;
          lineEls[li].textContent = full.slice(0, ci);
          lineEls[li].classList.add('typing');
          if (ci % 5 === 0) sfx('tick', 0.12);
          if (ci >= full.length) {
            lineEls[li].classList.remove('typing');
            lineEls[li].classList.add('done');
            li++;
            ci = 0;
            acc -= 10; // pausa breve entre líneas
          }
        }
        if (li < lineEls.length) a.rafs.push(requestAnimationFrame(typeTick));
      };
      a.rafs.push(requestAnimationFrame(typeTick));
      // Reto de Valerio
      const ch = h('section', `chal-card${o.challenge ? '' : ' none'}`, col);
      createPortrait('valerio', ch, 'chal-pt');
      const ct = h('div', 'chal-txt', ch);
      h('b', '', ct, 'Reto del Dr. Valerio');
      h('p', '', ct, o.challenge ? o.challenge.text : 'Hoy no hay reto. Valerio «solo observa». Claro.');
      if (o.challenge) h('span', 'chal-bonus', ct, '+3 a la nota si lo cumples');
      // Aviso de contenido del caso
      const note = h('aside', 'intro-note', col);
      fromHtml(ICONS.alert, 'note-ic', note);
      const gore = o.settings.pastelMode ? 'Modo Pastel activado' : `gore al ${Math.round(o.settings.goreLevel)} %`;
      h('span', '', note, `Aviso: humor negro y cirugía con sangre (${gore}). Moda fetish sin contenido sexual. El paciente siempre sobrevive.`);
      const foot = h('footer', 'scr-foot', a.el);
      button(foot, 'Volver', 'ghost', o.onBack, 'back');
      const start = button(foot, 'Empezar', 'big', o.onStart, 'play');
      start.focus({ preventScroll: true });
    },

    // ═════════════ Auditoría de Valerio ═════════════
    showAudit(o) {
      const a = mount('scr-audit');
      background(a.root, 31, 10);
      const r = o.result;
      const c = o.caseDef;
      header(a, 'Auditoría del Dr. Valerio', `${c.patient.name} · ${c.procedure}`, null);
      const body = h('div', 'audit-body', a.el);
      // Boletín
      const card = h('section', 'report', body);
      h('i', 'report-clip', card);
      const rh = h('div', 'report-head', card);
      h('b', '', rh, 'Boletín de desempeño');
      h('span', '', rh, 'Clínica Veterinaria · Servicio de Ortopedia');
      const comps = h('div', 'comps', card);
      const bars: Array<{ fill: HTMLElement; val: HTMLElement; v: number }> = [];
      for (const k of COMP_ORDER) {
        const v = clamp(r.components[k], 0, 100);
        const row = h('div', `comp${r.weakest === k ? ' weakest' : ''}`, comps);
        const lbl = h('div', 'comp-lbl', row);
        h('b', 'comp-key', lbl, k);
        h('span', '', lbl, COMPONENT_LABEL[k]);
        h('span', 'comp-w', lbl, `${COMPONENT_WEIGHT[k]} %`);
        const track = h('div', 'comp-track', row);
        const fill = h('i', 'comp-fill', track);
        for (const m of [50, 65, 80, 92]) h('i', 'comp-tick', track).style.left = `${m}%`;
        const val = h('b', 'comp-val', row, '0');
        if (r.weakest === k) h('span', 'comp-weak', row, 'más débil');
        fill.classList.add(v >= 80 ? 'hi' : v >= 50 ? 'mid' : 'lo');
        bars.push({ fill, val, v });
      }
      const res = h('div', 'report-result', card);
      const notaBox = h('div', 'nota-box', res);
      h('span', 'nota-lbl', notaBox, 'Nota final');
      const notaVal = h('b', 'nota-val', notaBox, '0');
      if (r.challengeMet || hadChallenge(c, o.save)) {
        const chal = h('span', `chal-line${r.challengeMet ? ' met' : ''}`, notaBox);
        fromHtml(ICONS[r.challengeMet ? 'check' : 'cross'], 'cl-ic', chal);
        h('span', '', chal, r.challengeMet ? 'Reto cumplido: +3' : 'Reto no cumplido');
      }
      if (r.cap) {
        const cap = h('span', 'cap-line', notaBox);
        fromHtml(ICONS.lock, 'cap-ic', cap);
        h('span', '', cap, `Tope ${r.cap.rank}: ${r.cap.reason}`);
      }
      const stampWrap = h('div', 'stamp-wrap', res);
      const stamp = rankStamp(stampWrap, r.rank, 'big');
      h('span', 'rs-word', stamp, RANK_WORD[r.rank]);
      h('div', 'report-sign', card, 'V. Sterling');
      // Barras escalonadas y nota
      bars.forEach((b, i) => {
        animate(a, 650, (k) => {
          const e = 1 - Math.pow(1 - k, 3);
          b.fill.style.transform = `scaleX(${(b.v / 100) * e})`;
          b.val.textContent = String(Math.round(b.v * e));
        }, 250 + i * 260, () => sfx('tick', 0.25));
      });
      const barsEnd = 250 + bars.length * 260 + 450;
      animate(a, 700, (k) => (notaVal.textContent = fmtDec(r.nota * (1 - Math.pow(1 - k, 2)), 1)), barsEnd - 300);
      later(a, barsEnd + 450, () => {
        stamp.classList.add('in');
        sfx('rankReveal');
      });
      // Columna central: monedas, peores momentos, Valerio
      const mid = h('div', 'audit-mid', body);
      const coins = h('section', 'coins-card', mid);
      const ch = h('div', 'card-head', coins);
      fromHtml(ICONS.coin, 'ch-ic', ch);
      h('b', '', ch, 'HuesoCoins');
      const tbl = h('div', 'coin-rows', coins);
      const crow = (k: string, v: string, cls = '') => {
        const rr = h('div', `coin-row ${cls}`, tbl);
        h('span', '', rr, k);
        return h('b', '', rr, v);
      };
      crow('Tarifa', `${fmtInt(r.coins.fee)} HC`);
      crow(`Multiplicador (${r.rank})`, `×${fmtDec(r.coins.multiplier, 1)}`);
      crow('Propina', `+${fmtInt(r.coins.tip)} HC`, 'good');
      crow('Costes', `−${fmtInt(Math.abs(r.coins.costs))} HC`, r.coins.costs ? 'bad' : '');
      const totalEl = crow('Total', '0 HC', 'total');
      later(a, barsEnd + 900, () => {
        animate(a, 900, (k) => (totalEl.textContent = `${fmtInt(r.coins.total * k)} HC`), 0, () => sfx('coins'));
      });
      const worst = h('section', 'worst-card', mid);
      const wh = h('div', 'card-head', worst);
      fromHtml(ICONS.alert, 'ch-ic', wh);
      h('b', '', wh, 'Peores momentos');
      const wl = h('ol', 'worst-list', worst);
      const wm = r.worstMoments.slice(0, 3);
      if (wm.length === 0) h('li', 'empty', wl, 'Ninguno. Valerio lo encuentra sospechoso.');
      for (const m of wm) {
        const li = h('li', '', wl);
        h('span', 'wt', li, fmtTime(m.t));
        h('span', '', li, m.label);
      }
      const vbox = h('section', 'vlines', mid);
      createPortrait('valerio', vbox, 'vl-pt');
      const vb = h('div', 'vl-bubbles', vbox);
      for (const line of o.valerioLines.slice(0, 3)) h('p', 'vl-bubble', vb, line);
      // Ficha educativa
      const edu = h('section', 'edu-card', body);
      const eh = h('div', 'card-head', edu);
      fromHtml(ICONS.lens, 'ch-ic', eh);
      h('b', '', eh, 'Ficha educativa');
      h('h3', 'edu-title', edu, c.education.title);
      const fl = h('ul', 'edu-facts', edu);
      for (const f of c.education.facts) {
        const li = h('li', '', fl);
        fromHtml(ICONS.bone, 'ef-ic', li);
        h('span', '', li, f);
      }
      h('p', 'edu-disc', edu, c.education.disclaimer);
      const foot = h('footer', 'scr-foot', a.el);
      button(foot, 'Reintentar', 'ghost', o.onRetry, 'retry');
      const cont = button(foot, 'Continuar', 'big', o.onContinue, 'play');
      cont.focus({ preventScroll: true });
    },

    // ═════════════ Boutique ═════════════
    showBoutique(o) {
      const a = mount('scr-boutique');
      background(a.root, 41, 12);
      let coins = o.save.coins;
      const owned = new Set(o.save.owned);
      const equipped = new Set(o.save.equipped);
      const right = header(a, 'Boutique', 'Solo HuesoCoins ganadas con sudor quirúrgico. Ventajas pequeñas, estilo enorme.', o.onBack);
      const coinsVal = coinsChip(right, coins);
      const grid = h('div', 'shop-grid', a.el);
      const refreshers: Array<() => void> = [];
      // Icono por artículo (ids del GDD §5); si no se reconoce, por categoría.
      const ITEM_ICON: Array<[string, IconName]> = [
        ['gargantilla', 'lock'], ['botas', 'boot'], ['anillas', 'dring'], ['fusta', 'whip'],
        ['esposas', 'cuffs'], ['arnes', 'knot'], ['gorros', 'cap'],
      ];
      const catIcon = (it: BoutiqueItem): string => {
        if (it.category === 'instrumental') return instrumentIcon(it.id.includes('taladro') ? 'drill' : 'scalpel10');
        const hit = ITEM_ICON.find(([k]) => it.id.includes(k));
        return ICONS[hit ? hit[1] : it.category === 'equipo' ? 'sparkle' : 'heart'];
      };
      o.items.forEach((it, i) => {
        const card = h('article', 'shop-card', grid);
        card.style.setProperty('--i', String(i));
        card.style.setProperty('--item', it.color);
        const sw = h('div', 'shop-swatch', card);
        fromHtml(catIcon(it), 'sw-ic', sw);
        h('i', 'k-dring sw-ring', sw);
        const info = h('div', 'shop-info', card);
        const top = h('div', 'shop-top', info);
        h('b', 'shop-name', top, it.name);
        h('span', `shop-cat c-${it.category}`, top, it.category === 'accesorio' ? 'Accesorio' : it.category === 'instrumental' ? 'Instrumental' : 'Equipo');
        h('p', 'shop-desc', info, it.description);
        const eff = h('div', 'shop-eff', info);
        fromHtml(ICONS.sparkle, 'eff-ic', eff);
        h('span', '', eff, it.effectText);
        const buy = h('div', 'shop-buy', info);
        const price = h('span', 'shop-price', buy);
        fromHtml(ICONS.coin, 'pr-ic', price);
        h('b', '', price, fmtInt(it.priceHC));
        const btn = h('button', 'k-btn shop-btn', buy);
        btn.type = 'button';
        const btnTxt = h('span', '', btn);
        const status = h('span', 'shop-status', buy);
        const refresh = () => {
          const isOwned = owned.has(it.id);
          const isEq = equipped.has(it.id);
          card.classList.toggle('owned', isOwned);
          card.classList.toggle('equipped', isEq);
          btn.classList.toggle('mint', isOwned && !isEq);
          btn.classList.toggle('ghost', isEq);
          if (isOwned) {
            btn.disabled = false;
            btnTxt.textContent = isEq ? 'Quitar' : 'Equipar';
            status.textContent = isEq ? 'Equipado' : 'En tu armario';
          } else {
            const missing = it.priceHC - coins;
            btn.disabled = missing > 0;
            btnTxt.textContent = 'Comprar';
            status.textContent = missing > 0 ? `Faltan ${fmtInt(missing)} HC` : '';
          }
        };
        refreshers.push(refresh);
        btn.addEventListener('click', () => {
          if (!owned.has(it.id)) {
            if (it.priceHC > coins) return;
            if (o.onBuy(it.id)) {
              owned.add(it.id);
              coins -= it.priceHC;
              coinsVal.textContent = fmtInt(coins);
              sfx('uiBuy');
              later(a, 180, () => sfx('coins', 0.6));
              card.classList.remove('bought');
              void card.offsetWidth;
              card.classList.add('bought');
              for (const f of refreshers) f();
            } else {
              sfx('uiError');
              card.classList.remove('shake');
              void card.offsetWidth;
              card.classList.add('shake');
            }
          } else {
            sfx('uiClick');
            o.onToggleEquip(it.id);
            if (equipped.has(it.id)) equipped.delete(it.id);
            else equipped.add(it.id);
            refresh();
          }
        });
        refresh();
      });
    },

    // ═════════════ Ajustes ═════════════
    showSettings(o) {
      const a = mount('scr-settings');
      parentDim(a);
      const panel = h('div', 'settings-panel', a.el);
      const hd = h('div', 'set-head', panel);
      fromHtml(ICONS.settings, 'set-ic', hd);
      h('h1', '', hd, 'Ajustes');
      const s: Settings = { ...o.settings };
      const p: PartnerProfile = { ...o.partner };
      const emit = () => o.onChange({ ...s }, { ...p });
      const cols = h('div', 'set-cols', panel);
      const section = (title: string, icon: IconName) => {
        const sec = h('section', 'set-sec', cols);
        const sh = h('div', 'set-sec-head', sec);
        fromHtml(ICONS[icon], 'ssh-ic', sh);
        h('b', '', sh, title);
        return sec;
      };
      let uid = 0;
      const field = (sec: HTMLElement, label: string, hint?: string) => {
        const f = h('div', 'set-field', sec);
        const l = h('label', 'set-lbl', f, label);
        const id = `set-${++uid}`;
        l.htmlFor = id;
        if (hint) h('span', 'set-hint', f, hint);
        return { f, id };
      };
      const toggle = (sec: HTMLElement, label: string, get: () => boolean, set: (v: boolean) => void, hint?: string) => {
        const { f, id } = field(sec, label, hint);
        f.classList.add('row');
        const sw = h('input', 'k-switch', f);
        sw.type = 'checkbox';
        sw.id = id;
        sw.checked = get();
        sw.addEventListener('change', () => {
          set(sw.checked);
          sfx('uiClick', 0.6);
          emit();
        });
        return sw;
      };
      const slider = (sec: HTMLElement, label: string, get: () => number, set: (v: number) => void, fmt: (v: number) => string, max = 100) => {
        const { f, id } = field(sec, label);
        const row = h('div', 'set-slider', f);
        const r = h('input', 'k-range', row);
        r.type = 'range';
        r.id = id;
        r.min = '0';
        r.max = String(max);
        r.step = '1';
        r.value = String(Math.round(get()));
        const out = h('output', 'set-out', row, fmt(get()));
        const paint = () => r.style.setProperty('--p', `${(Number(r.value) / max) * 100}%`);
        paint();
        r.addEventListener('input', () => {
          set(Number(r.value));
          out.textContent = fmt(Number(r.value));
          paint();
          emit();
        });
        return r;
      };
      const segmented = <T extends string | number>(sec: HTMLElement, label: string, opts: Array<[T, string]>, get: () => T, set: (v: T) => void) => {
        const { f } = field(sec, label);
        const seg = h('div', 'k-seg', f);
        seg.setAttribute('role', 'radiogroup');
        const btns = opts.map(([v, txt]) => {
          const b = h('button', 'seg-opt', seg, txt);
          b.type = 'button';
          b.setAttribute('role', 'radio');
          const sync = () => {
            const on = get() === v;
            b.classList.toggle('on', on);
            b.setAttribute('aria-checked', String(on));
          };
          b.addEventListener('click', () => {
            set(v);
            sfx('uiClick', 0.6);
            btns.forEach((x) => x());
            emit();
          });
          sync();
          return sync;
        });
      };
      const select = <T extends string>(sec: HTMLElement, label: string, opts: Array<[T, string]>, get: () => T, set: (v: T) => void) => {
        const { f, id } = field(sec, label);
        const sel = h('select', 'k-select', f);
        sel.id = id;
        for (const [v, txt] of opts) {
          const op = h('option', '', sel, txt);
          op.value = v;
        }
        sel.value = get();
        sel.addEventListener('change', () => {
          set(sel.value as T);
          sfx('uiClick', 0.6);
          emit();
        });
        return sel;
      };
      const pct = (v: number) => `${Math.round(v)} %`;

      const game = section('Juego', 'play');
      segmented(game, 'Dificultad', [['residente', 'Residente'], ['especialista', 'Especialista'], ['jefe', 'Jefe de Servicio']], () => s.difficulty, (v) => (s.difficulty = v));
      segmented(game, 'Ventana rítmica', [[1, '×1'], [1.5, '×1,5'], [2, '×2']], () => s.rhythmWindowScale, (v) => (s.rhythmWindowScale = v as 1 | 1.5 | 2));
      slider(game, 'Temblor de manos', () => s.tremorScale * 100, (v) => (s.tremorScale = v / 100), pct);
      toggle(game, 'Director de caos adaptativo', () => s.adaptiveDirector, (v) => (s.adaptiveDirector = v), 'Ajusta el caos ±30 % según tus resultados');
      toggle(game, 'Modo inmersivo', () => s.immersive, (v) => (s.immersive = v), 'Oculta casi toda la interfaz');

      const vis = section('Sangre y accesibilidad', 'drop');
      slider(vis, 'Nivel de gore', () => s.goreLevel, (v) => (s.goreLevel = v), (v) => (v < 20 ? `${v} · suavecito` : v > 80 ? `${v} · sin filtro` : `${v}`));
      toggle(vis, 'Modo Pastel', () => s.pastelMode, (v) => (s.pastelMode = v), 'La sangre se vuelve jarabe de fresa');
      toggle(vis, 'Reducir destellos', () => s.reduceFlashes, (v) => (s.reduceFlashes = v));
      select(vis, 'Daltonismo', [['none', 'Ninguno'], ['deuter', 'Deuteranopia'], ['protan', 'Protanopia'], ['tritan', 'Tritanopia']], () => s.colorblind, (v) => (s.colorblind = v));
      toggle(vis, 'Subtítulos', () => s.subtitles, (v) => (s.subtitles = v));
      toggle(vis, 'Voces sintetizadas', () => s.tts, (v) => (s.tts = v), 'Usa la voz del navegador');

      const snd = section('Sonido', 'wave');
      slider(snd, 'Volumen general', () => s.masterVolume * 100, (v) => (s.masterVolume = v / 100), pct);
      slider(snd, 'Música', () => s.musicVolume * 100, (v) => (s.musicVolume = v / 100), pct);
      slider(snd, 'Efectos', () => s.sfxVolume * 100, (v) => (s.sfxVolume = v / 100), pct);
      slider(snd, 'ASMR del instrumental', () => s.asmrVolume * 100, (v) => (s.asmrVolume = v / 100), pct);
      const par = section('Tu pareja', 'heart');
      par.classList.add('set-partner');
      h('p', 'set-hint', par, 'Nunca aparece en pantalla: solo te escribe mensajes cariñosos al reloj.');
      const { f: nf, id: nid } = field(par, 'Nombre');
      const name = h('input', 'k-input', nf);
      name.id = nid;
      name.type = 'text';
      name.maxLength = 20;
      name.placeholder = 'p. ej., Sam';
      name.value = p.name;
      name.autocomplete = 'off';
      select(par, 'Pronombres', [['ella', 'ella'], ['él', 'él'], ['elle', 'elle']], () => p.pronoun, (v) => {
        p.pronoun = v;
        updPreview();
      });
      const preview = h('p', 'partner-preview', par);
      const updPreview = () => {
        const nm = p.name.trim() || 'tu pareja';
        const art = p.pronoun === 'ella' ? 'Ella' : p.pronoun === 'él' ? 'Él' : 'Elle';
        preview.textContent = `${art} te escribirá durante las cirugías: «Buena niña. Estoy orgullose de ti.» — ${nm}`.replace(
          'orgullose',
          p.pronoun === 'ella' ? 'orgullosa' : p.pronoun === 'él' ? 'orgulloso' : 'orgullose',
        );
      };
      name.addEventListener('input', () => {
        p.name = name.value;
        updPreview();
        emit();
      });
      updPreview();
      const foot = h('footer', 'set-foot', panel);
      const done = button(foot, 'Listo', 'big', o.onBack, 'check');
      done.focus({ preventScroll: true });
    },

    // ═════════════ Pausa ═════════════
    showPause(o) {
      const a = mount('scr-pause');
      parentDim(a);
      const card = h('div', 'pause-card', a.el);
      fromHtml(heartPadlockSvg('padlock pause-lock'), 'pause-lock-wrap', card);
      h('h1', 'pause-title', card, 'Pausa');
      const quips = ['El paciente duerme. Tú respira.', 'Rodrigo aprovecha para afinar la guitarra.', 'Fritz cuenta tornillos. Otra vez.', 'Valerio anota que has pausado. Obviamente.'];
      h('p', 'pause-sub', card, quips[Math.floor(Math.random() * quips.length)]);
      const menu = h('nav', 'pause-menu', card);
      const resume = button(menu, 'Reanudar', 'big', o.onResume, 'play');
      button(menu, 'Ajustes', 'ghost', o.onSettings, 'settings');
      button(menu, 'Salir al menú', 'ghost danger', o.onQuit, 'door');
      resume.focus({ preventScroll: true });
    },

    // ═════════════ Intersticial ═════════════
    showInterstitial(o) {
      const a = mount('scr-inter');
      const curtain = a.root;
      curtain.classList.add('inter-curtain');
      background(curtain, 53, 10);
      const box = h('div', 'inter-box', a.el);
      const fl = h('div', 'inter-flourish', box);
      h('i', 'rope-l', fl);
      fromHtml(ICONS.heart, 'fl-heart', fl);
      h('i', 'rope-r', fl);
      h('h1', 'inter-title', box, o.title);
      if (o.subtitle) h('p', 'inter-sub', box, o.subtitle);
      const bar = h('div', 'inter-bar', box);
      const fill = h('i', '', bar);
      const secs = Math.max(0.3, o.seconds);
      fill.style.animationDuration = `${secs}s`;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        // Retira la cortina: si se quedara montada, capturaría clics y rueda durante el resto de la cirugía
        if (active === a) {
          unmount();
          host.style.display = 'none';
        }
        o.onDone();
      };
      later(a, Math.max(0, secs * 1000 - 350), () => curtain.classList.add('out'));
      later(a, secs * 1000, finish);
    },

    hideAll() {
      unmount();
      host.style.display = 'none';
    },
  };
  return api;
}
