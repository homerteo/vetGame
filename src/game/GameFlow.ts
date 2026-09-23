import * as THREE from 'three';
import type {
  AuditResult,
  CaseDef,
  ClinicAPI,
  ClinicOutcome,
  GameEvents,
  SaveData,
  ValerioChallenge,
} from '../core/contracts';
import { EventBus } from '../core/EventBus';
import { createInput } from '../core/Input';
import { createLoop } from '../core/Loop';
import { createAudio } from '../audio/AudioEngine';
import { createCharacterFactory } from '../characters/factory';
import { createScreens } from '../ui/Screens';
import { createClinic } from '../clinic/Clinic';
import { CASES, getCase } from '../data/cases';
import { DIALOGUE } from '../data/dialogue';
import { BOUTIQUE_ITEMS } from '../data/boutique';
import {
  applyAudit,
  buyItem,
  computeEffects,
  isCaseUnlocked,
  loadSave,
  persistSave,
  toggleEquip,
} from '../sim/Progression';
import { createSurgeryController, type SurgeryControllerAPI } from '../surgery/SurgeryController';
import { createFrameGuard, escapeAction, type FlowMode } from './flowLogic';

type Mode = FlowMode;

/** Resultado de clínica por defecto (para saltar la clínica en pruebas: ?skip=clinic). */
export const DEFAULT_CLINIC_OUTCOME: ClinicOutcome = {
  diagnosisCorrect: true,
  xrayMarked: true,
  requiredTestsDone: true,
  sterileSets: 2,
  prepQuality: 0.8,
  contamination: 0.1,
  ownerCalm: 0.8,
  tipHC: 20,
  minorCasesHC: 0,
  educationPoints: 1,
  emilianaStart: { concentration: 85, reserve: 100 },
  morale: { rodrigo: 70, fritz: 60, gigi: 65 },
};

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function createGameFlow(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
  const params = new URLSearchParams(window.location.search);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor('#1c0f24');

  const input = createInput(canvas);
  const audio = createAudio();
  const factory = createCharacterFactory();
  const screens = createScreens(uiRoot, audio);
  const storage = safeStorage();
  let save: SaveData = loadSave(storage);
  audio.applySettings(save.settings);

  let mode: Mode = 'menu';
  let clinic: ClinicAPI | null = null;
  let clinicBus: EventBus<GameEvents> | null = null;
  let surgery: SurgeryControllerAPI | null = null;
  let pending: (() => void) | null = null;
  let paused = false;
  const attempts = new Map<string, number>();

  const persist = () => persistSave(save, storage);
  const nextSeed = () => (params.has('seed') ? Number(params.get('seed')) : (Date.now() & 0x7fffffff) >>> 0);

  const unlockAudio = () => void audio.unlock();
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('keydown', unlockAudio, { once: true });

  // ── Menús ──
  function toTitle() {
    mode = 'menu';
    audio.setMusic('title');
    screens.showTitle({
      hasSave: Object.keys(save.completed).length > 0 || save.coins > 0,
      onPlay: toCaseSelect,
      onContinue: toCaseSelect,
      onBoutique: () => toBoutique(toTitle),
      onSettings: () => toSettings(toTitle),
    });
  }

  function toCaseSelect() {
    mode = 'menu';
    audio.setMusic('title');
    screens.showCaseSelect({
      cases: CASES,
      save,
      isUnlocked: (c) => isCaseUnlocked(save, c, CASES),
      onPick: (id) => toCaseIntro(getCase(id)),
      onBack: toTitle,
      onBoutique: () => toBoutique(toCaseSelect),
    });
  }

  function pickChallenge(c: CaseDef): ValerioChallenge | null {
    if (c.flags.tutorial || c.valerioChallenges.length === 0) return null;
    if (c.week < 5 && save.settings.difficulty !== 'jefe') return null;
    const n = attempts.get(c.id) ?? 0;
    return c.valerioChallenges[n % c.valerioChallenges.length];
  }

  function toCaseIntro(c: CaseDef) {
    mode = 'menu';
    const challenge = pickChallenge(c);
    screens.showCaseIntro({
      caseDef: c,
      challenge,
      settings: save.settings,
      onStart: () => {
        attempts.set(c.id, (attempts.get(c.id) ?? 0) + 1);
        pending = () => startClinic(c, challenge);
      },
      onBack: toCaseSelect,
    });
  }

  function toBoutique(back: () => void) {
    mode = 'menu';
    audio.setMusic('boutique');
    const show = () =>
      screens.showBoutique({
        save,
        items: BOUTIQUE_ITEMS,
        onBuy: (id) => {
          const item = BOUTIQUE_ITEMS.find((i) => i.id === id);
          if (!item) return false;
          const next = buyItem(save, item);
          if (!next) {
            audio.play('uiError');
            return false;
          }
          save = next;
          persist();
          audio.play('uiBuy');
          show();
          return true;
        },
        onToggleEquip: (id) => {
          save = toggleEquip(save, id);
          persist();
          show();
        },
        onBack: back,
      });
    show();
  }

  function toSettings(back: () => void) {
    screens.showSettings({
      settings: save.settings,
      partner: save.partner,
      onChange: (s, p) => {
        save = { ...save, settings: s, partner: p };
        persist();
        audio.applySettings(s);
        // Los ajustes cambiados desde la pausa llegan a la partida en curso.
        surgery?.applySettings(s);
        (clinic as { applySettings?(x: typeof s): void } | null)?.applySettings?.(s);
      },
      onBack: back,
    });
  }

  // ── Clínica ──
  function startClinic(c: CaseDef, challenge: ValerioChallenge | null) {
    screens.hideAll();
    disposeGameplay();
    if (params.get('skip') === 'clinic') {
      startSurgery(c, challenge, DEFAULT_CLINIC_OUTCOME);
      return;
    }
    mode = 'clinic';
    audio.setMusic('clinic');
    clinicBus = new EventBus<GameEvents>();
    let done = false;
    clinic = createClinic({
      renderer,
      uiRoot,
      factory,
      audio,
      bus: clinicBus,
      input,
      caseDef: c,
      save,
      effects: computeEffects(save),
      dialogue: DIALOGUE,
      settings: save.settings,
      onComplete: (outcome) => {
        if (done) return;
        done = true;
        pending = () => startSurgery(c, challenge, outcome);
      },
    });
    clinic.resize(window.innerWidth, window.innerHeight);
  }

  // ── Quirófano ──
  function startSurgery(c: CaseDef, challenge: ValerioChallenge | null, outcome: ClinicOutcome) {
    disposeGameplay();
    screens.hideAll();
    mode = 'surgery';
    surgery = createSurgeryController({
      renderer,
      uiRoot,
      input,
      audio,
      factory,
      screens,
      caseDef: c,
      save,
      settings: save.settings,
      effects: computeEffects(save),
      dialogue: DIALOGUE,
      clinic: outcome,
      challenge,
      seed: nextSeed(),
      onFinish: (result, extras) => {
        pending = () => endSurgery(c, result, extras);
      },
    });
    surgery.resize(window.innerWidth, window.innerHeight);
  }

  function endSurgery(c: CaseDef, result: AuditResult, extras: { viralClips: number; valerioLines: string[] }) {
    disposeGameplay();
    mode = 'menu';
    save = applyAudit(save, c, result, { viralClips: extras.viralClips });
    persist();
    audio.setMusic(result.rank === 'S' ? 'rankS' : 'audit');
    screens.showAudit({
      caseDef: c,
      result,
      valerioLines: extras.valerioLines,
      save,
      onContinue: toCaseSelect,
      onRetry: () => toCaseIntro(c),
    });
  }

  function disposeGameplay() {
    clinic?.dispose();
    clinic = null;
    clinicBus?.clear();
    clinicBus = null;
    surgery?.dispose();
    surgery = null;
    audio.setVitals(null);
  }

  // ── Pausa ──
  function pause() {
    if (paused || mode === 'menu') return;
    paused = true;
    loop.setPaused(true);
    // Suelta lo mantenido antes de desactivar la entrada: sus liberaciones ya no llegarían.
    surgery?.releaseInputs();
    input.setEnabled(false);
    showPause();
  }

  function showPause() {
    screens.showPause({
      onResume: resume,
      onSettings: () => toSettings(showPause),
      onQuit: () => {
        resume();
        disposeGameplay();
        toCaseSelect();
      },
    });
  }

  function resume() {
    if (!paused) return;
    paused = false;
    screens.hideAll();
    input.setEnabled(true);
    loop.setPaused(false);
  }

  // Esc se decide solo aquí (el quirófano no lo escucha): abrir y cerrar en la misma pulsación era el fallo.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || e.repeat) return;
    const action = escapeAction(paused, mode);
    if (action === 'resume') resume();
    else if (action === 'pause') pause();
  });

  // ── Bucle ──
  // Un error en un fotograma no puede matar el bucle; si se repite sin parar, se vuelve al menú.
  const frameGuard = createFrameGuard({
    maxConsecutive: 90,
    onError: (err, n) => {
      if (n === 1) console.error('[juego] error en el fotograma', err);
    },
    onGiveUp: () => {
      try {
        disposeGameplay();
      } catch (err) {
        console.error('[juego] error al cerrar la partida', err);
      }
      surgery = null;
      clinic = null;
      pending = null;
      toCaseSelect();
    },
  });
  const loop = createLoop((dt) => {
    frameGuard.run(() => {
      if (pending) {
        const p = pending;
        pending = null;
        p();
      }
      if (mode === 'clinic' && clinic) {
        clinic.update(dt);
        clinic.render();
      } else if (mode === 'surgery' && surgery) {
        surgery.update(dt);
        surgery.render();
      } else {
        renderer.clear();
      }
    });
  });

  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    clinic?.resize(w, h);
    surgery?.resize(w, h);
  });

  // Ganchos para pruebas automáticas y depuración.
  (window as unknown as { __game: unknown }).__game = {
    get mode() {
      return mode;
    },
    get save() {
      return save;
    },
    surgery: () => surgery?.debug ?? null,
    /** Depuración de la clínica en curso (state(): objetivo, diagnóstico, correctDxKey…), o null. */
    clinic: () => (clinic as (ClinicAPI & { debug?: unknown }) | null)?.debug ?? null,
    /** Adelanta el tiempo de juego sin renderizar (pruebas en navegadores lentos). */
    advance: (sec: number) => {
      const steps = Math.ceil(sec / 0.05);
      for (let i = 0; i < steps; i++) {
        if (pending) {
          const p = pending;
          pending = null;
          p();
        }
        if (mode === 'clinic' && clinic) clinic.update(0.05);
        else if (mode === 'surgery' && surgery) surgery.update(0.05);
        else break;
      }
      return mode;
    },
    startCase: (index: number, skipClinic = true) => {
      const c = CASES.find((x) => x.index === index);
      if (!c) return false;
      pending = () => (skipClinic ? startSurgery(c, pickChallenge(c), DEFAULT_CLINIC_OUTCOME) : startClinic(c, pickChallenge(c)));
      return true;
    },
  };

  return {
    start() {
      loop.start();
      const caseParam = params.get('case');
      if (caseParam !== null) {
        const c = CASES.find((x) => x.index === Number(caseParam));
        if (c) {
          if (params.get('skip') === 'clinic') pending = () => startSurgery(c, pickChallenge(c), DEFAULT_CLINIC_OUTCOME);
          else if (params.get('go') === 'clinic') pending = () => startClinic(c, pickChallenge(c));
          else toCaseIntro(c);
          return;
        }
      }
      toTitle();
    },
  };
}
