/**
 * Respiración cuadrada (tecla B): 16 s — inhala 4 · retén 4 · exhala 4 · retén 4.
 * Mantener Espacio al inhalar y retener; soltar al exhalar. onDone(calidad 0..1).
 */
import './theme.css';
import './overlays.css';
import type { BreathingOverlayAPI, SfxName } from '../core/contracts';
import { BOX_PHASES, BOX_SIDE_SEC, BOX_TOTAL_SEC, createBreathingScorer, phaseIndexAt, squarePoint, wantHeld, type BreathingScorer } from './logic/breathing';
import { ClassCell, EnumClassCell, NumCell, TextCell, VarCell, fromHtml, h } from './logic/dom';
import { ICONS } from './icons';
import { createPortrait } from './portraits';
import { attachStageScale } from './stage';

const SUMMARY_SEC = 1.6;

export function createBreathingOverlay(root: HTMLElement): BreathingOverlayAPI {
  let el: HTMLElement | null = null;
  let detach: (() => void) | null = null;
  let scorer: BreathingScorer | null = null;
  let opts: Parameters<BreathingOverlayAPI['start']>[0] | null = null;
  let t = 0;
  let held = false;
  let lastPhase = -1;
  let summaryT = -1;
  let done = false;
  const pt = { x: 0, y: 0 };
  let v: ReturnType<typeof build> | null = null;

  const sfx = (name: SfxName, volume?: number) => {
    try {
      opts?.audio.play(name, volume !== undefined ? { volume } : undefined);
    } catch {
      /* opcional */
    }
  };

  function build(host: HTMLElement) {
    h('div', 'ov-dim br-dim', host);
    const stage = h('div', 'ov-stage br-stage', host);
    const head = h('div', 'br-head', stage);
    createPortrait('emiliana', head, 'br-pt');
    const ht = h('div', 'br-titles', head);
    h('b', 'br-title', ht, 'Respiración cuadrada');
    h('span', 'br-sub', ht, 'Mantén ESPACIO al inhalar y al retener · suéltalo al exhalar');
    const box = h('div', 'br-box', stage);
    box.innerHTML = `<svg viewBox="-10 -10 320 320" class="br-svg" aria-hidden="true">
      <rect x="0" y="0" width="300" height="300" rx="34" class="br-track"/>
      <rect x="0" y="0" width="300" height="300" rx="34" class="br-prog" pathLength="100"/>
    </svg>`;
    const labels: Array<[string, string]> = [
      ['left', 'Inhala'],
      ['top', 'Retén'],
      ['right', 'Exhala'],
      ['bottom', 'Retén'],
    ];
    const sideEls = labels.map(([pos, txt], i) => {
      const s = h('span', `br-side s-${pos}`, box, txt);
      s.dataset.i = String(i);
      return new ClassCell(s, 'on');
    });
    const dot = h('i', 'br-dot', box);
    const dotX = new VarCell(dot, '--x', 0.002);
    const dotY = new VarCell(dot, '--y', 0.002);
    const lungs = h('div', 'br-lungs', box);
    const lungVar = new VarCell(lungs, '--l', 0.005);
    const phaseTxt = new TextCell(h('b', 'br-phase', lungs));
    const countTxt = new NumCell(h('span', 'br-count', lungs), (n) => String(Math.max(1, Math.ceil(n))), 1);
    const progVar = new VarCell(box, '--p', 0.05);
    const instr = h('div', 'br-instr', stage);
    const instrIc = h('span', 'bi-ic', instr);
    const instrTxt = new TextCell(h('span', 'bi-txt', instr));
    h('span', 'k-key big', instr, 'ESPACIO');
    const stateCls = new EnumClassCell<string>(instr, 'st-');
    const want = new ClassCell(instr, 'want-hold');
    const qual = h('div', 'br-qual', stage);
    h('span', '', qual, 'Calma');
    const qbar = h('div', 'bq-bar', qual);
    const qVar = new VarCell(h('i', '', qbar), '--q', 0.01);
    const qTxt = new NumCell(h('b', '', qual), (n) => `${Math.round(n * 100)} %`, 0.01);
    const summary = h('div', 'br-summary', stage);
    fromHtml(ICONS.heart, 'bs-ic', summary);
    const sumTitle = new TextCell(h('b', '', summary));
    const sumSub = new TextCell(h('span', '', summary));
    const sumOn = new ClassCell(summary, 'show');
    return { sideEls, dotX, dotY, lungVar, phaseTxt, countTxt, progVar, instrIc, instrTxt, stateCls, want, qVar, qTxt, sumTitle, sumSub, sumOn, lastIcon: '' };
  }

  function teardown() {
    detach?.();
    detach = null;
    el?.remove();
    el = null;
    v = null;
    scorer = null;
  }

  return {
    start(o) {
      teardown();
      opts = o;
      t = 0;
      held = false;
      lastPhase = -1;
      summaryT = -1;
      done = false;
      scorer = createBreathingScorer({ windowScale: o.rhythmWindowScale });
      el = h('div', 'emi-overlay emi-breath', root);
      detach = attachStageScale(el);
      v = build(el);
      sfx('heartFlutter', 0.5);
    },

    update(dt) {
      if (!scorer || !v || !opts) return;
      if (summaryT >= 0) {
        summaryT += dt;
        if (summaryT >= SUMMARY_SEC && !done) {
          done = true;
          const q = scorer.quality();
          const cb = opts.onDone;
          teardown();
          cb(q);
        }
        return;
      }
      t = Math.min(BOX_TOTAL_SEC, t + dt);
      const ok = scorer.sample(t, dt, held);
      const i = phaseIndexAt(t);
      const phase = BOX_PHASES[i];
      if (i !== lastPhase) {
        lastPhase = i;
        sfx('tick', 0.35);
        for (let k = 0; k < 4; k++) v.sideEls[k].set(k === i);
      }
      squarePoint(t, pt);
      v.dotX.set(pt.x);
      v.dotY.set(pt.y);
      v.progVar.set((t / BOX_TOTAL_SEC) * 100);
      const within = (t - i * BOX_SIDE_SEC) / BOX_SIDE_SEC;
      const lung = phase.id === 'inhale' ? within : phase.id === 'holdIn' ? 1 : phase.id === 'exhale' ? 1 - within : 0;
      v.lungVar.set(lung);
      v.phaseTxt.set(phase.label);
      v.countTxt.set(Math.ceil(BOX_SIDE_SEC - (t - i * BOX_SIDE_SEC)));
      const wantHold = wantHeld(t);
      v.want.set(wantHold);
      v.instrTxt.set(wantHold ? 'Mantén' : 'Suelta');
      v.stateCls.set(ok ? 'ok' : 'bad');
      const icon = ok ? 'check' : 'cross';
      if (v.lastIcon !== icon) {
        v.lastIcon = icon;
        v.instrIc.innerHTML = ICONS[icon];
      }
      const q = scorer.quality();
      v.qVar.set(q);
      v.qTxt.set(q);
      if (t >= BOX_TOTAL_SEC) {
        summaryT = 0;
        v.sumOn.set(true);
        v.sumTitle.set(q >= 0.8 ? '¡Calma recuperada!' : q >= 0.5 ? 'Un poco mejor' : 'Respira… lo intentaste');
        v.sumSub.set(`Calidad de la respiración: ${Math.round(q * 100)} %`);
        sfx(q >= 0.8 ? 'praise' : 'heartFlutter', 0.6);
      }
    },

    onKey(key, down) {
      if (!scorer) return false;
      if (key === 'Space') {
        held = down;
        return true;
      }
      return false;
    },

    stop() {
      teardown();
      opts = null;
    },

    isActive() {
      return !!scorer;
    },
  };
}
