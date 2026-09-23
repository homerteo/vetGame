/**
 * Superposición de RCP (GDD §5): compresiones con Espacio a 100–120/min, ambú de Fritz
 * cada 6 s, ritmo en el monitor, FV → mantener D para cargar → "¡Despejen!" (esperar a Gigi)
 * → soltar D para descargar. Resultado determinista por calidad (≥ 0,55 = éxito).
 */
import './theme.css';
import './overlays.css';
import type { CPROverlayAPI, CPRResult, SfxName } from '../core/contracts';
import { clamp } from '../core/math';
import { createCPRMachine, type CPRMachine, type CompressionJudgement } from './logic/cpr';
import { ClassCell, EnumClassCell, NumCell, TextCell, VarCell, fromHtml, h } from './logic/dom';
import { compressionArtifact } from './logic/ecg';
import { cprDisplay } from './logic/cprDisplay';
import { EcgCanvas } from './EcgCanvas';
import { ICONS } from './icons';
import { createPortrait } from './portraits';
import { attachStageScale } from './stage';

const GAUGE_MIN = 60;
const GAUGE_MAX = 160;
/** Ángulo de la aguja (-90..90°) para un ritmo dado. */
export const rateToAngle = (r: number) => -90 + (clamp(r, GAUGE_MIN, GAUGE_MAX) - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN) * 180;

/** Arco SVG de un semicírculo entre dos ritmos (centro 100,100, radio 80). */
function arcPath(from: number, to: number, r = 80): string {
  const a0 = ((rateToAngle(from) - 90) * Math.PI) / 180;
  const a1 = ((rateToAngle(to) - 90) * Math.PI) / 180;
  const x0 = 100 + Math.cos(a0) * r;
  const y0 = 100 + Math.sin(a0) * r;
  const x1 = 100 + Math.cos(a1) * r;
  const y1 = 100 + Math.sin(a1) * r;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export function createCPROverlay(root: HTMLElement): CPROverlayAPI {
  let el: HTMLElement | null = null;
  let detachScale: (() => void) | null = null;
  let m: CPRMachine | null = null;
  let opts: Parameters<CPROverlayAPI['start']>[0] | null = null;
  let spaceDown = false;
  let dHeld = false;
  let doneCalled = false;
  let lineIdx = 0;
  let lastCompressAt = -10;
  let feedbackUntil = 0;
  let puffUntil = 0;
  let squishUntil = 0;

  // Vistas (se crean en start)
  let v: ReturnType<typeof build> | null = null;

  const sfx = (name: SfxName, volume?: number) => {
    try {
      opts?.audio.play(name, volume !== undefined ? { volume } : undefined);
    } catch {
      /* sin audio no pasa nada */
    }
  };
  const pickLine = (list: string[] | undefined) => (list && list.length ? list[lineIdx++ % list.length] : '');

  function build(host: HTMLElement, zone: { min: number; max: number }) {
    h('div', 'ov-dim cpr-dim', host);
    const flash = h('div', 'cpr-flash', host);
    const stage = h('div', 'ov-stage cpr-stage', host);
    // Cabecera
    const head = h('div', 'cpr-head', stage);
    const banner = h('div', 'cpr-banner', head);
    const bannerIc = fromHtml(ICONS.brokenHeart, 'cb-ic', banner);
    const bannerTxt = new TextCell(h('b', '', banner, '¡PARO! RCP'));
    const bannerOk = new ClassCell(banner, 'ok');
    const line = new TextCell(h('div', 'cpr-line', head));
    // Columna izquierda: monitor y ventilación
    const left = h('div', 'cpr-left', stage);
    const mon = h('div', 'cpr-monitor', left);
    const monHead = h('div', 'cm-head', mon);
    const rhythmTxt = new TextCell(h('b', 'cm-rhythm', monHead));
    const rhythmCls = new EnumClassCell<string>(mon, 'r-');
    const screen = h('div', 'cm-screen', mon);
    const ecg = new EcgCanvas(screen, 360, 96, 110, 0.34);
    const fritz = h('div', 'cpr-fritz', left);
    createPortrait('fritz', fritz, 'cf-pt');
    const fInfo = h('div', 'cf-info', fritz);
    h('b', '', fInfo, 'Fritz ventila');
    const ventTxt = new NumCell(h('span', 'cf-next', fInfo), (s) => `Próximo ambú en ${Math.ceil(s)} s`, 1);
    const bag = fromHtml(ICONS.bag, 'cf-bag', fritz);
    const puff = new ClassCell(fritz, 'puff');
    void bag;
    // Centro: tórax y metrónomo
    const center = h('div', 'cpr-center', stage);
    const target = h('div', 'cpr-target', center);
    const ring = h('div', 'cpr-ring', target);
    const ringVar = new VarCell(ring, '--k', 0.01);
    h('div', 'cpr-ring2', target);
    const chest = h('div', 'cpr-chest', target);
    fromHtml(ICONS.heart, 'ch-heart', chest);
    fromHtml(ICONS.hand, 'ch-hand', chest);
    const squish = new ClassCell(chest, 'squish');
    const key = h('div', 'cpr-key', center);
    key.innerHTML = '<span class="k-key big">ESPACIO</span> al ritmo del riff de Rodrigo';
    const fb = h('div', 'cpr-feedback', center);
    const fbTxt = new TextCell(fb);
    const fbCls = new EnumClassCell<string>(fb, 'fb-');
    // Derecha: medidor de ritmo
    const right = h('div', 'cpr-right', stage);
    const gauge = h('div', 'cpr-gauge', right);
    gauge.innerHTML = `<svg viewBox="0 0 200 118" class="cg-svg" aria-hidden="true">
      <path d="${arcPath(GAUGE_MIN, GAUGE_MAX)}" class="cg-track"/>
      <path d="${arcPath(GAUGE_MIN, zone.min)}" class="cg-slow"/>
      <path d="${arcPath(zone.max, GAUGE_MAX)}" class="cg-fast"/>
      <path d="${arcPath(zone.min, zone.max)}" class="cg-good"/>
      <text x="16" y="114" class="cg-lbl">60</text><text x="184" y="114" class="cg-lbl" text-anchor="end">160</text>
      <text x="100" y="12" class="cg-lbl" text-anchor="middle">${zone.min}–${zone.max}</text>
    </svg><div class="cg-needle"><i></i></div><div class="cg-hub"></div>`;
    const needle = gauge.querySelector('.cg-needle') as HTMLElement;
    const needleVar = new VarCell(needle, '--a', 0.5, 'deg');
    const rateRow = h('div', 'cg-rate', right);
    const rateVal = new NumCell(h('b', '', rateRow), (r) => (r > 0 ? String(Math.round(r)) : '--'), 1);
    h('span', '', rateRow, 'compresiones/min');
    const zoneCls = new EnumClassCell<string>(right, 'z-');
    const compCount = new NumCell(h('div', 'cg-count', right), (n) => `${Math.round(n)} compresiones`, 1);
    const qual = h('div', 'cg-qual', right);
    h('span', '', qual, 'Calidad');
    const qBar = h('div', 'cg-qbar', qual);
    const qVar = new VarCell(h('i', '', qBar), '--q', 0.01);
    // Abajo: desfibrilador
    const defib = h('div', 'cpr-defib', stage);
    const dHead = h('div', 'cd-head', defib);
    fromHtml(ICONS.bolt, 'cd-ic', dHead);
    h('b', '', dHead, 'Desfibrilador');
    const dState = new TextCell(h('span', 'cd-state', dHead));
    const dBar = h('div', 'cd-bar', defib);
    const chargeVar = new VarCell(h('i', '', dBar), '--c', 0.01);
    for (let i = 1; i < 4; i++) h('b', 'cd-tick', dBar).style.left = `${i * 25}%`;
    const dKey = h('div', 'cd-key', defib);
    const dKeyTxt = new TextCell(h('span', '', dKey));
    const dKeyCap = h('span', 'k-key big', dKey, 'D');
    void dKeyCap;
    const defibCls = new EnumClassCell<string>(defib, 'ph-');
    const gigi = h('div', 'cpr-gigi', defib);
    createPortrait('gigi', gigi, 'cg-pt');
    fromHtml(ICONS.hand, 'cgi-hand', gigi);
    const gigiTxt = new TextCell(h('span', 'cgi-txt', gigi));
    const gigiClear = new ClassCell(gigi, 'clear');
    const gigiShow = new ClassCell(gigi, 'show');
    // Resultado
    const result = h('div', 'cpr-result', stage);
    const resIc = h('span', 'cr-ic', result);
    const resTitle = new TextCell(h('b', 'cr-title', result));
    const resSub = new TextCell(h('span', 'cr-sub', result));
    const resOn = new ClassCell(result, 'show');
    const resCls = new EnumClassCell<string>(result, 'res-');
    return {
      bannerIc, bannerTxt, bannerOk,
      flash, line, rhythmTxt, rhythmCls, ecg, ventTxt, puff, ringVar, squish, fbTxt, fbCls, needleVar, rateVal, zoneCls,
      compCount, qVar, dState, chargeVar, dKeyTxt, defibCls, gigiTxt, gigiClear, gigiShow, resIc, resTitle, resSub, resOn, resCls,
    };
  }

  function feedback(j: CompressionJudgement) {
    if (!v || !m) return;
    const t = m.t;
    feedbackUntil = t + 0.9;
    if (j === 'good') {
      v.fbTxt.set('¡Así! Sigue el ritmo');
      v.fbCls.set('good');
    } else if (j === 'slow') {
      v.fbTxt.set('Más rápido');
      v.fbCls.set('slow');
    } else if (j === 'fast') {
      v.fbTxt.set('Más despacio');
      v.fbCls.set('fast');
    } else {
      v.fbTxt.set('Comprime fuerte y al centro');
      v.fbCls.set('info');
    }
  }

  function teardown() {
    detachScale?.();
    detachScale = null;
    el?.remove();
    el = null;
    v = null;
    m = null;
    cprDisplay.rhythm = null;
  }

  const api: CPROverlayAPI = {
    start(o) {
      teardown();
      opts = o;
      doneCalled = false;
      spaceDown = false;
      dHeld = false;
      lastCompressAt = -10;
      feedbackUntil = 0;
      puffUntil = 0;
      squishUntil = 0;
      m = createCPRMachine({ windowScale: o.rhythmWindowScale, rhythmClock: () => performance.now() / 1000 });
      cprDisplay.rhythm = m.rhythm;
      el = h('div', 'emi-overlay emi-cpr', root);
      if (o.reduceFlashes) el.classList.add('reduce-flashes');
      detachScale = attachStageScale(el);
      v = build(el, m.zone);
      v.line.set(pickLine(o.dialogue.cpr.start));
      v.ecg.extra = (t) => compressionArtifact(t - lastCompressAt);
      try {
        o.audio.setMusic('arrest');
      } catch {
        /* opcional */
      }
      sfx('alarm', 0.7);
    },

    update(dt) {
      if (!m || !v || !opts) return;
      const o = opts;
      const clear = (() => {
        try {
          return o.isClear();
        } catch {
          return true;
        }
      })();
      const evs = m.update(dt, { dHeld, clear });
      for (const e of evs) {
        switch (e) {
          case 'vent':
            sfx('bag');
            puffUntil = m.t + 0.9;
            break;
          case 'vfOnset':
            sfx('alarm');
            v.line.set('¡Fibrilación ventricular! ¡Carga el desfibrilador!');
            break;
          case 'chargeStart':
            sfx('defibCharge');
            break;
          case 'chargeAbort':
            v.line.set('Carga perdida: mantén D los 2 segundos completos.');
            break;
          case 'charged':
            v.line.set(pickLine(o.dialogue.cpr.clear) || '¡Despejen!');
            break;
          case 'unsafeRelease':
            sfx('uiError');
            v.line.set('¡No! Gigi seguía tocando la camilla. Descarga cancelada.');
            break;
          case 'shock':
            sfx('defibShock');
            if (v.flash) {
              v.flash.classList.remove('go');
              void v.flash.offsetWidth;
              v.flash.classList.add('go');
            }
            break;
          case 'timeout':
            break;
          case 'done':
            if (!doneCalled) {
              doneCalled = true;
              const r: CPRResult = { success: m.success, quality: m.quality() };
              const cb = o.onDone;
              teardown();
              cb(r);
              return;
            }
            break;
        }
      }
      // Resultado (fase 'result')
      if (m.phase === 'result') {
        const ok = m.success;
        v.resOn.set(true);
        v.resCls.set(ok ? 'ok' : 'fail');
        if (v.resTitle.set(ok ? '¡Circulación espontánea!' : 'Sin pulso…')) {
          v.resIc.innerHTML = ok ? ICONS.heart : ICONS.brokenHeart;
          if (ok) {
            v.bannerTxt.set('¡PULSO!');
            v.bannerOk.set(true);
            v.bannerIc.innerHTML = ICONS.heart;
          }
          v.line.set(ok ? pickLine(o.dialogue.cpr.rosc) : pickLine(o.dialogue.cpr.fail));
          if (ok) sfx('praise');
        }
        v.resSub.set(`Calidad de la RCP: ${Math.round(m.quality() * 100)} %${ok ? '' : ' · Valerio toma el control'}`);
      }
      // Monitor
      const rhythm = m.rhythm;
      cprDisplay.rhythm = rhythm;
      v.rhythmCls.set(rhythm);
      v.rhythmTxt.set(rhythm === 'vfib' ? '¡FV!  Fibrilación ventricular' : rhythm === 'sinus' ? 'Ritmo sinusal · 96 lpm' : 'Asistolia · sin pulso');
      v.ecg.step(dt, rhythm === 'sinus' ? 96 : 0, rhythm);
      // Ventilación
      v.ventTxt.set(Math.ceil(Math.max(0, m.nextVentIn)));
      v.puff.set(m.t < puffUntil);
      // Metrónomo: pulso al ritmo de la música
      let ph = 0;
      try {
        ph = o.beat.phase();
      } catch {
        ph = 0;
      }
      v.ringVar.set(1 - ph);
      v.squish.set(m.t < squishUntil);
      // Medidor (congelado al mostrar el resultado)
      if (m.phase !== 'result') {
        const rate = m.rate();
        v.needleVar.set(rateToAngle(rate || GAUGE_MIN));
        v.rateVal.set(rate);
        v.zoneCls.set(rate <= 0 ? 'none' : rate < m.zone.min ? 'slow' : rate > m.zone.max ? 'fast' : 'good');
        v.compCount.set(m.compressions.total);
      }
      v.qVar.set(m.quality());
      if (m.phase === 'result') v.fbTxt.set('');
      else if (m.t > feedbackUntil) {
        v.fbTxt.set(m.compressions.total === 0 ? 'Pulsa ESPACIO para comprimir' : '');
        v.fbCls.set('info');
      }
      // Desfibrilador
      v.defibCls.set(m.phase);
      v.chargeVar.set(m.phase === 'charged' ? 1 : m.charge);
      const phase = m.phase;
      v.gigiShow.set(phase === 'charged' || phase === 'charging' || phase === 'vf');
      v.gigiClear.set(clear);
      v.gigiTxt.set(clear ? 'Gigi se apartó' : 'Gigi sigue tocando la camilla…');
      if (phase === 'compress') {
        v.dState.set('Esperando ritmo desfibrilable');
        v.dKeyTxt.set('Sigue comprimiendo');
      } else if (phase === 'vf') {
        v.dState.set('¡FV! Ritmo desfibrilable');
        v.dKeyTxt.set('Mantén para cargar');
      } else if (phase === 'charging') {
        v.dState.set(`Cargando… ${Math.round(m.charge * 100)} %`);
        v.dKeyTxt.set('No sueltes');
      } else if (phase === 'charged') {
        v.dState.set('¡Despejen!');
        v.dKeyTxt.set(clear ? 'Suelta para descargar' : 'Espera a Gigi, mantén');
      } else {
        v.dState.set('Descarga administrada');
        v.dKeyTxt.set('');
      }
    },

    onKey(key, down) {
      if (!m || !v) return false;
      if (key === 'Space') {
        if (down && !spaceDown && m.phase !== 'result' && m.phase !== 'done') {
          const j = m.compress();
          // La traza usa su propio reloj: el artefacto se coloca en tiempo del ECG.
          lastCompressAt = v.ecg.time;
          squishUntil = m.t + 0.14;
          sfx('compress', 0.8);
          feedback(j);
        }
        spaceDown = down;
        return true;
      }
      if (key === 'KeyD') {
        dHeld = down;
        return true;
      }
      return false;
    },

    stop() {
      teardown();
      opts = null;
    },

    isActive() {
      return !!m;
    },
  };

  return api;
}
