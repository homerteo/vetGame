/** Diálogos modales de la clínica: panel de exploración, diagnóstico al dueño y elecciones rápidas. */
import type { DiagnosticTest } from '../../core/contracts';
import { TEST_INFO } from '../logic/diagnosis';
import type { ExplanationKind } from '../logic/owners';
import { esc } from './Hud';

export interface Dialog {
  /** Teclas (Digit1..3, KeyE, Enter). Devuelve true si la consumió. */
  onKey(code: string): boolean;
  close(): void;
}

export interface Note {
  test: DiagnosticTest;
  stamp: string;
  positive: boolean;
  text: string;
}

const digit = (code: string): number => {
  const m = /^(?:Digit|Numpad)(\d)$/.exec(code);
  return m ? Number(m[1]) : -1;
};

function modal(layer: HTMLElement, html: string): HTMLDivElement {
  const m = document.createElement('div');
  m.className = 'cl-modal';
  m.innerHTML = html;
  layer.appendChild(m);
  return m;
}

export function renderNotes(notes: Note[]): string {
  if (!notes.length) return '<div class="empty">Aún no hay hallazgos: haz alguna prueba.</div>';
  return notes
    .map(
      (n) =>
        `<div class="cl-note"><span class="cl-stamp ${n.positive ? 'pos' : 'neg'}">${esc(n.stamp)}</span><b>${esc(TEST_INFO[n.test].label)}</b>${esc(n.text)}</div>`,
    )
    .join('');
}

export interface ExamPanelState {
  done: ReadonlySet<DiagnosticTest>;
  taken: ReadonlySet<DiagnosticTest>;
  required: readonly DiagnosticTest[];
  notes: Note[];
  busy: boolean;
}

/** Panel de la camilla: pruebas disponibles y libreta de hallazgos. */
export function openExamPanel(
  layer: HTMLElement,
  o: {
    petName: string;
    patientLine: string;
    complaint: string;
    tests: DiagnosticTest[];
    state(): ExamPanelState;
    onPick(test: DiagnosticTest): void;
    onClose(): void;
  },
): Dialog & { refresh(): void; setVisible(v: boolean): void } {
  const m = modal(
    layer,
    `<div class="cl-card">
      <button class="k-btn ghost close" data-act="close">Listo <span class="k-key">E</span></button>
      <h2>Exploración de ${esc(o.petName)}</h2>
      <div class="cl-patient"><div><div class="big">${esc(o.petName)}</div>${esc(o.patientLine)}</div></div>
      <div class="cl-quote">“${esc(o.complaint)}”</div>
      <div class="cl-grid"><div class="cl-tests"></div><div class="cl-notes"></div></div>
    </div>`,
  );
  const testsEl = m.querySelector('.cl-tests') as HTMLElement;
  const notesEl = m.querySelector('.cl-notes') as HTMLElement;
  let lastNotes = -1;
  let lastSig = '';
  const refresh = () => {
    const s = o.state();
    // solo re-renderiza si algo cambió (rehacer los botones cada fotograma rompería los clics)
    const sig = `${s.busy ? 1 : 0}|${o.tests.map((t) => `${s.done.has(t) ? 1 : 0}${s.taken.has(t) ? 1 : 0}`).join('')}`;
    if (sig !== lastSig) {
      lastSig = sig;
      testsEl.innerHTML = o.tests
      .map((t, i) => {
        const inf = TEST_INFO[t];
        const done = s.done.has(t);
        const taken = s.taken.has(t);
        const req = s.required.includes(t);
        let sub = inf.gesture;
        if (inf.atLightbox) sub = done ? 'Leída en el negatoscopio' : taken ? 'Placa lista: ve al negatoscopio' : 'Tomar placa (luego léela en el negatoscopio)';
        else if (done) sub = 'Hecha';
        const disabled = s.busy || done || (inf.atLightbox && taken);
        return `<button class="cl-test ${done ? 'done' : ''} ${req && !done ? 'req' : ''}" data-test="${t}" ${disabled ? 'disabled' : ''}>
          <span class="g">${done ? '✓' : inf.glyph}</span>
          <span class="d"><span>${esc(inf.label)}${req ? ' <span class="cl-tag">OBLIGATORIA</span>' : ''}</span><small>${esc(sub)}</small></span>
          <span class="k"><span class="k-key">${i + 1}</span></span></button>`;
      })
      .join('');
    }
    if (s.notes.length !== lastNotes) {
      lastNotes = s.notes.length;
      notesEl.innerHTML = renderNotes(s.notes);
    }
  };
  refresh();
  const pick = (t: DiagnosticTest) => {
    const s = o.state();
    if (s.busy || s.done.has(t) || (TEST_INFO[t].atLightbox && s.taken.has(t))) return;
    o.onPick(t);
  };
  m.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const b = target.closest('[data-test]') as HTMLElement | null;
    if (b && !(b as HTMLButtonElement).disabled) pick(b.dataset.test as DiagnosticTest);
    if (target.closest('[data-act="close"]')) o.onClose();
  });
  return {
    refresh,
    setVisible(v) {
      m.style.display = v ? '' : 'none';
    },
    onKey(code) {
      const d = digit(code);
      if (d >= 1 && d <= o.tests.length) {
        pick(o.tests[d - 1]);
        return true;
      }
      if (code === 'KeyE' || code === 'Enter') {
        o.onClose();
        return true;
      }
      return false;
    },
    close() {
      m.remove();
    },
  };
}

/** Diálogo de diagnóstico: 1 de 3 diagnósticos y luego 1 de 3 explicaciones. */
export function openDiagnosisDialog(
  layer: HTMLElement,
  o: {
    ownerName: string;
    petName: string;
    notes: Note[];
    options: string[];
    explanations: Record<ExplanationKind, string>;
    warning: string | null;
    onPick(diagnosis: number, explanation: ExplanationKind): void;
    onCancel(): void;
  },
): Dialog {
  let step = 0;
  let dx = -1;
  const m = modal(layer, `<div class="cl-card"><button class="k-btn ghost close" data-act="cancel">Todavía no</button><div class="inner"></div></div>`);
  const inner = m.querySelector('.inner') as HTMLElement;
  const order: ExplanationKind[] = ['absurd', 'technical', 'evasive'];
  const EXPL_LABEL: Record<ExplanationKind, [string, string]> = {
    absurd: ['Absurda pero educativa', 'Calma y enseña (+Educación)'],
    technical: ['Técnica', 'Precisa... y aterradora para algunos'],
    evasive: ['Evasiva', 'Calma ahora, queja después'],
  };
  const render = () => {
    if (step === 0) {
      inner.innerHTML = `<div class="cl-steps"><span class="on">1 · Diagnóstico</span><span>2 · Explicación</span></div>
        <h2>¿Qué tiene ${esc(o.petName)}?</h2>
        <p class="lead">Revisa tu libreta antes de hablar con ${esc(o.ownerName)}.</p>
        ${o.warning ? `<p class="lead" style="color:#c4136c">${esc(o.warning)}</p>` : ''}
        <div class="cl-notes" style="min-height:0;margin-bottom:6px">${renderNotes(o.notes)}</div>
        <div class="cl-choices">${o.options
          .map((t, i) => `<button class="cl-choice" data-i="${i}"><span class="num">${i + 1}</span><span class="body"><b>${esc(t)}</b></span></button>`)
          .join('')}</div>`;
    } else {
      inner.innerHTML = `<div class="cl-steps"><span>1 · Diagnóstico</span><span class="on">2 · Explicación</span></div>
        <h2>¿Cómo se lo explicas a ${esc(o.ownerName)}?</h2>
        <p class="lead">Diagnóstico: <b>${esc(o.options[dx])}</b></p>
        <div class="cl-choices">${order
          .map(
            (k, i) =>
              `<button class="cl-choice" data-i="${i}"><span class="num">${i + 1}</span><span class="body"><b>${EXPL_LABEL[k][0]}</b>“${esc(o.explanations[k])}”<small>${EXPL_LABEL[k][1]}</small></span></button>`,
          )
          .join('')}</div>`;
    }
  };
  render();
  const choose = (i: number) => {
    if (step === 0) {
      if (i < 0 || i >= o.options.length) return;
      dx = i;
      step = 1;
      render();
    } else {
      if (i < 0 || i >= 3) return;
      o.onPick(dx, order[i]);
    }
  };
  m.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const b = t.closest('[data-i]') as HTMLElement | null;
    if (b) choose(Number(b.dataset.i));
    else if (t.closest('[data-act="cancel"]')) o.onCancel();
  });
  return {
    onKey(code) {
      const d = digit(code);
      if (d >= 1 && d <= 3) {
        choose(d - 1);
        return true;
      }
      return code === 'KeyE';
    },
    close() {
      m.remove();
    },
  };
}

export interface ChoiceItem {
  title: string;
  sub?: string;
  tag?: string;
  kind?: 'domina' | 'normal';
}

/** Elección rápida (asignar con cariño o con Orden de Dómina, confirmar ir al quirófano...). */
export function openChoice(
  layer: HTMLElement,
  o: { title: string; lead?: string; items: ChoiceItem[]; onPick(i: number): void; onCancel?(): void },
): Dialog {
  const m = modal(
    layer,
    `<div class="cl-card" style="width:min(560px,92vw)">
      ${o.onCancel ? '<button class="k-btn ghost close" data-act="cancel">Cancelar</button>' : ''}
      <h2>${esc(o.title)}</h2>${o.lead ? `<p class="lead">${esc(o.lead)}</p>` : ''}
      <div class="cl-choices">${o.items
        .map(
          (it, i) =>
            `<button class="cl-choice ${it.kind === 'domina' ? 'domina' : ''}" data-i="${i}"><span class="num">${i + 1}</span><span class="body"><b>${esc(it.title)}</b>${it.sub ? esc(it.sub) : ''}${it.tag ? `<br><span class="tag">${esc(it.tag)}</span>` : ''}</span></button>`,
        )
        .join('')}</div></div>`,
  );
  m.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const b = t.closest('[data-i]') as HTMLElement | null;
    if (b) o.onPick(Number(b.dataset.i));
    else if (t.closest('[data-act="cancel"]')) o.onCancel?.();
  });
  return {
    onKey(code) {
      const d = digit(code);
      if (d >= 1 && d <= o.items.length) {
        o.onPick(d - 1);
        return true;
      }
      if (code === 'KeyE' && o.onCancel) {
        o.onCancel();
        return true;
      }
      return false;
    },
    close() {
      m.remove();
    },
  };
}
