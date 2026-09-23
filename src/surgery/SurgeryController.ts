import type * as THREE from 'three';
import type {
  AssistantId,
  AudioAPI,
  AuditResult,
  BoutiqueEffects,
  CaseDef,
  CharacterFactory,
  ChaosEvent,
  ChecklistItem,
  ClinicOutcome,
  CommandTone,
  DialogueBank,
  FaultKind,
  Gauge,
  GameEvents,
  GuideLevel,
  HudModel,
  InputAPI,
  InstrumentId,
  MusicState,
  SaveData,
  ScreensAPI,
  Settings,
  SpeakerId,
  StepController,
  SurgeryContext,
  UniversalTool,
  ValerioChallenge,
  Vec2,
  VitalsSnapshot,
  WoundPointer,
} from '../core/contracts';
import { EventBus } from '../core/EventBus';
import { createRng, createSmoothNoise, pick } from '../core/rng';
import { FLOOD_THRESHOLD_PCT, WOUND_H_MM, WOUND_W_MM } from '../core/constants';
import { clamp, closestOnPolyline, lerpV } from '../core/math';
import { createVitals } from '../sim/Vitals';
import { createBleeding } from '../sim/Bleeding';
import { createBloodPool } from '../sim/BloodPool';
import { createBone } from '../sim/Bone';
import { createEmiliana } from '../sim/Emiliana';
import { createChaosDirector } from '../sim/ChaosDirector';
import { createSurgeryLog, FAULT_EXITO, FAULT_LABEL } from '../sim/SurgeryLog';
import { computeAudit, evaluateChallenge, provisionalRank } from '../sim/Scoring';
import { firmSweetUnlocked, guideLevelFor } from '../sim/Progression';
import { createSurgeryScene } from './SurgeryScene';
import { createCrew } from './assistants/Crew';
import { createCauteryTool, stepFactory } from './steps/registry';
import { createSurgeryHud } from '../ui/SurgeryHud';
import { createCPROverlay } from '../ui/CPROverlay';
import { createBreathingOverlay } from '../ui/BreathingOverlay';
import { INSTRUMENTS } from '../data/instruments';

export interface SurgeryControllerDeps {
  renderer: THREE.WebGLRenderer;
  uiRoot: HTMLElement;
  input: InputAPI;
  audio: AudioAPI;
  factory: CharacterFactory;
  screens: ScreensAPI;
  caseDef: CaseDef;
  save: SaveData;
  settings: Settings;
  effects: BoutiqueEffects;
  dialogue: DialogueBank;
  clinic: ClinicOutcome;
  challenge: ValerioChallenge | null;
  seed: number;
  onFinish(result: AuditResult, extras: { viralClips: number; valerioLines: string[] }): void;
}

export interface SurgeryControllerAPI {
  update(dt: number): void;
  render(): void;
  resize(w: number, h: number): void;
  dispose(): void;
  /** Suelta puntero y teclas mantenidas (pausa, pérdida de foco): ningún paso queda con una tecla «pegada». */
  releaseInputs(): void;
  /** Aplica ajustes cambiados a mitad de cirugía (la dificultad se mantiene hasta el siguiente caso). */
  applySettings(s: Settings): void;
  /** Ganchos de depuración para pruebas automáticas. */
  debug: {
    forceCompleteStep(): void;
    state(): Record<string, unknown>;
    setExito(v: number): void;
    /** Contexto completo de la cirugía (solo lectura en pruebas). */
    ctx(): SurgeryContext;
    /** mm de herida → píxeles de pantalla (para apuntar con el ratón en pruebas). */
    project(mm: Vec2): { x: number; y: number };
    /** Parámetros del paso actual. */
    stepParams(): unknown;
  };
}

const ASSISTANT_KEYS: Record<string, AssistantId> = { KeyZ: 'rodrigo', KeyX: 'fritz', KeyC: 'gigi' };
const ASSISTANT_NAMES: Record<AssistantId, string> = { rodrigo: 'Rodrigo', fritz: 'Fritz', gigi: 'Gigi' };
const HOLD_DOMINA_SEC = 0.4;
const DOUBLE_TAP_SEC = 0.28;
const MESSAGE_HANDS_OFF_SEC = 2;
const LAMP_HOLD_SEC = 1.5;

/** Controlador de la fase de quirófano: une simulación, pasos, equipo, HUD y audio. */
export function createSurgeryController(deps: SurgeryControllerDeps): SurgeryControllerAPI {
  const { caseDef, settings, effects, dialogue, clinic, audio, input } = deps;
  const rng = createRng(deps.seed);
  const bus = new EventBus<GameEvents>();
  const week = caseDef.week;

  // ── Simulación ──
  const diffBleed = settings.difficulty === 'residente' ? 0.6 : settings.difficulty === 'jefe' ? 1.25 : 1;
  const bleeding = createBleeding({ rateScale: diffBleed });
  const blood = createBloodPool({ window: caseDef.anatomy.window });
  const bone = createBone(caseDef.anatomy);
  const startExito = clamp(
    60 + (clinic.diagnosisCorrect && clinic.xrayMarked ? 10 : clinic.diagnosisCorrect ? 5 : -10),
    30,
    80,
  );
  const vitals = createVitals(
    {
      species: caseDef.patient.species,
      weightKg: caseDef.patient.weightKg,
      startExito,
      hypothermiaRisk: !!caseDef.flags.hypothermia,
    },
    { difficulty: settings.difficulty },
  );
  const maxMessages = week === 0 ? 0 : week <= 4 ? 2 : 3;
  const emiliana = createEmiliana({
    concentration: clinic.emilianaStart.concentration,
    reserve: clinic.emilianaStart.reserve,
    effects,
    firmSweetUnlocked: firmSweetUnlocked(deps.save),
    partner: deps.save.partner,
    messagePool: dialogue.partnerMessages,
    maxMessages,
    tremorScale: settings.tremorScale,
    microMode: !!caseDef.flags.microMode,
  });
  const rankValue = { S: 80, A: 70, B: 55, C: 40, F: 20 } as const;
  const director = createChaosDirector({
    allowed: caseDef.chaos,
    difficulty: settings.difficulty,
    adaptive: settings.adaptiveDirector,
    recentMinExito: deps.save.lastRanks.slice(-3).map((r) => rankValue[r]),
    seed: deps.seed + 17,
    tutorial: !!caseDef.flags.tutorial,
  });
  // El Éxito puede tocar 0 por un error y regenerarse antes de la comprobación del paro: se anota el cruce.
  let exitoZeroHit = false;
  function applyExito(delta: number, reason: string) {
    vitals.applyExito(delta, reason);
    if (vitals.snapshot().exito <= 0) exitoZeroHit = true;
  }
  const log = createSurgeryLog((delta, reason) => applyExito(delta, reason), bus);

  // Guías: un diagnóstico erróneo (o sin diagnóstico) solo baja las guías a "inicio y fin":
  // quitarlas del todo obligaba a adivinar dónde usar cada instrumento.
  const baseGuide: GuideLevel = guideLevelFor(caseDef, settings.difficulty);
  const guideLevel: GuideLevel = !clinic.diagnosisCorrect && baseGuide === 'full' ? 'endpoints' : baseGuide;

  // ── Escena, equipo, interfaz ──
  const scene = createSurgeryScene({
    renderer: deps.renderer,
    caseDef,
    factory: deps.factory,
    bone,
    bleeding,
    blood,
    settings,
  });
  const crew = createCrew({
    scene,
    factory: deps.factory,
    bus,
    caseDef,
    settings,
    effects,
    dialogue,
    morale: clinic.morale,
  });
  crew.setResolver((id) => director.resolve(id));

  const hudRoot = document.createElement('div');
  hudRoot.className = 'surgery-root';
  hudRoot.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
  deps.uiRoot.appendChild(hudRoot);
  const hud = createSurgeryHud(hudRoot, settings);
  // Cosméticos de la Boutique (solo si están comprados y equipados).
  const wears = (id: string) => deps.save.owned.includes(id) && deps.save.equipped.includes(id);
  (scene as { setInstrumentCosmetics?(o: { kittenScalpel?: boolean; bunnyDrill?: boolean }): void }).setInstrumentCosmetics?.({
    kittenScalpel: wears('skin-bisturi-gatito'),
    bunnyDrill: wears('skin-taladro-conejo'),
  });
  // El temblor de Emiliana se escala en vivo si se cambia el ajuste en la pausa.
  const initialTremorScale = clamp(settings.tremorScale, 0, 1);
  const cpr = createCPROverlay(hudRoot);
  const breathing = createBreathingOverlay(hudRoot);

  // ── Estado ──
  let t = 0;
  let finished = false;
  let disposed = false;
  let phaseIdx = 0;
  let stepIdx = 0;
  let step: StepController | null = null;
  let phaseFaults = 0;
  let costsHC = 0;
  let screwDrops = 0;
  let carmUsed = 0;
  let viralClips = 0;
  let maxField = 0;
  let arrests = 0;
  let arrestActive = false;
  let valerioTookOver = false;
  let warming = false;
  let handsOffUntil = 0;
  let autoSuctionUntil = -1;
  let autoSuctionUsed = false;
  let lampHold = 0;
  let pressure = 3;
  let activeInstrument: InstrumentId = 'hand';
  let interstitialUntil = 0;
  let introUntil = 2.5;
  let cameraOverview = true;
  let valerioLine: string | null = null;
  let valerioLineUntil = 0;
  let provisional: HudModel['valerio']['provisionalRank'] = null;
  let provisionalTimer = 0;
  let lastMessagePending = false;
  let lastMusic: MusicState | null = null;
  let fullestCell: Vec2 = { x: WOUND_W_MM / 2, y: WOUND_H_MM / 2 };
  let fullestTimer = 0;
  let finishTimer = -1;
  let bleedAccum = 0;
  const worst: Array<{ t: number; label: string; weight: number }> = [];
  const valerioLines: string[] = [];
  const completedSteps: string[] = [];
  const carmPlanned = caseDef.phases
    .flatMap((p) => p.steps)
    .reduce((s, st) => s + (st.params.type === 'reduction' ? st.params.carmShots : 0), 0);
  let carmLeft: number | null = null;

  // ── Puntero ──
  const noiseX = createSmoothNoise(deps.seed + 3);
  const noiseY = createSmoothNoise(deps.seed + 7);
  let screen = { x: 0, y: 0 };
  let rawMm: Vec2 | null = null;
  let virtMm: Vec2 = { x: WOUND_W_MM / 2, y: WOUND_H_MM / 2 };
  let onWound = false;
  let buttons = 0;
  let lastButton = 0;

  // El cauterio universal necesita el contexto: se crea justo después.
  let cauteryTool!: UniversalTool;

  const ctx: SurgeryContext = {
    caseDef,
    bus,
    wound: scene.wound,
    scene,
    bone,
    bleeding,
    blood,
    vitals,
    emiliana,
    log,
    crew,
    audio,
    hud,
    beat: audio.beat,
    settings,
    effects,
    guideLevel,
    dialogue,
    rng,
    now: () => t,
    selectInstrument: (id) => selectInstrument(id),
    addCost: (hc, reason) => {
      costsHC += hc;
      hud.toast(`−${hc} HC · ${reason}`, 'bad');
    },
  };
  cauteryTool = createCauteryTool(ctx);

  // ── Bus → interfaz/audio ──
  const offs: Array<() => void> = [];
  offs.push(
    bus.on('say', (e) => {
      hud.subtitle(e.speaker, e.text, e.durationSec);
      if (settings.tts) audio.voice(e.speaker, e.text);
      if (e.speaker === 'valerio') {
        valerioLine = e.text;
        valerioLineUntil = t + 4.5;
        valerioLines.push(e.text);
      }
    }),
    bus.on('toast', (e) => hud.toast(e.text, e.kind)),
    bus.on('sfx', (e) => audio.play(e.name, { volume: e.volume, pitch: e.pitch })),
    bus.on('fault', (e) => {
      phaseFaults++;
      const w = -(FAULT_EXITO[e.kind] ?? -2);
      worst.push({ t, label: FAULT_LABEL[e.kind] ?? e.kind, weight: w });
      emiliana.stress(4, e.kind);
      // Mirada de Auditor: los errores cuentan doble.
      if (crew.valerio.isGazing()) {
        applyExito(FAULT_EXITO[e.kind] ?? -2, 'Mirada de Auditor');
        hud.toast('Valerio lo vio todo: el error cuenta doble', 'valerio');
      }
      if (e.kind === 'thermalNecrosis') hud.alert('boneHeat', '¡Hueso sobrecalentado!');
    }),
    bus.on('bleeder:spawn', (e) => {
      if (e.kind !== 'arterial') return;
      const k = slots().indexOf('cautery') + 1;
      hud.alert('arterial', k > 0 ? `¡Sangrado arterial! Cauteriza (${k})` : '¡Sangrado arterial! Cauteriza');
    }),
    bus.on('screw:dropped', () => screwDrops++),
    bus.on('carm:shot', (e) => {
      carmUsed++;
      carmLeft = e.left;
    }),
    bus.on('viral:clip', () => {
      if (week >= 3) viralClips++;
    }),
    bus.on('gesture', (e) => {
      if (e.perfect && rng() < 0.18) say('emiliana', pick(rng, dialogue.emiliana.perfect));
    }),
  );

  /** Cambia la cámara; en vista de herida Emiliana se oculta (su mano es el instrumento). */
  function setCamera(mode: 'overview' | 'wound' | 'micro') {
    scene.setCameraMode(mode);
    crew.emiliana.root.visible = mode === 'overview';
  }

  function say(speaker: SpeakerId, text: string, durationSec?: number) {
    bus.emit('say', { speaker, text, durationSec });
  }

  // ── Pasos ──
  function currentPhase() {
    return caseDef.phases[phaseIdx];
  }

  function beginStep() {
    const phase = currentPhase();
    if (!phase) return;
    const def = phase.steps[stepIdx];
    stepKeys.clear();
    step = stepFactory(def.params.type)(def);
    step.begin(ctx);
    selectInstrument(step.instruments[0] ?? 'hand');
    if (def.params.type === 'reduction') carmLeft = def.params.carmShots;
    bus.emit('step:begin', { stepId: def.id, type: def.params.type });
    if (caseDef.flags.tutorial) {
      const hint = dialogue.tutorialHints[def.params.type];
      if (hint) say('sistema', hint, 7);
    }
  }

  function advanceStep() {
    if (!step) return;
    const phase = currentPhase();
    try {
      step.end();
    } catch (err) {
      console.error('[quirófano] error al cerrar el paso', err);
    }
    completedSteps.push(step.def.id);
    step = null;
    stepIdx++;
    if (stepIdx >= phase.steps.length) {
      bus.emit('phase:complete', { phaseId: phase.id });
      // Hito: fase sin errores → mensaje de la pareja (lo anuncia el detector de update()).
      if (phaseFaults === 0) emiliana.offerMessage();
      phaseFaults = 0;
      phaseIdx++;
      stepIdx = 0;
      // Mensaje guardado: se lee en la pausa entre fases (mitad de efecto).
      if (emiliana.snapshot().message.stored > 0) {
        const m = emiliana.readMessage(true);
        if (m) {
          audio.play('praise');
          say('pareja', m.text, 5);
        }
      }
      if (phaseIdx >= caseDef.phases.length) {
        beginFinish();
        return;
      }
      const next = currentPhase();
      interstitialUntil = t + 1.6;
      deps.screens.showInterstitial({
        title: `Fase ${phaseIdx + 1}: ${next.label}`,
        subtitle: next.steps.map((s) => s.label).join(' · '),
        seconds: 1.6,
        // El telón debe desmontarse: si no, tapa el lienzo y se come todos los clics.
        onDone: () => {
          if (!disposed) deps.screens.hideAll();
        },
      });
    }
    beginStep();
  }

  function beginFinish() {
    finishTimer = 3.2;
    setCamera('overview');
    cameraOverview = true;
    crew.emiliana.setAnim('cheer');
    crew.emiliana.setEmote('hearts');
    say('emiliana', pick(rng, dialogue.emiliana.win));
    if (caseDef.flags.final) setTimeout(() => !disposed && say('valerio', dialogue.valerio.finalRespect, 5), 1200);
    audio.play('praise');
  }

  function finish() {
    if (finished) return;
    finished = true;
    const snap = vitals.snapshot();
    const stats = emiliana.stats();
    const challengeMet = deps.challenge
      ? evaluateChallenge(deps.challenge.kind, {
          screwDrops,
          elapsedSec: t,
          targetSec: caseDef.targetTimeSec * (settings.difficulty === 'jefe' ? 0.8 : 1),
          dominaCount: stats.commands.domina,
          arrest: arrests > 0,
          maxFieldPct: maxField,
          carmShotsUsed: carmUsed,
          carmShotsPlanned: carmPlanned,
        })
      : false;
    const faults = log.faults();
    const contaminated = faults.filter((f) => f === 'contaminatedImplant').length;
    const sterility = clamp(
      100 *
        (0.5 * clinic.prepQuality + 0.3 * (1 - clinic.contamination) + 0.2 * (clinic.sterileSets > 0 ? 1 : 0.5)) -
        15 * contaminated -
        2 * screwDrops,
      0,
      100,
    );
    const result = computeAudit({
      caseDef,
      difficulty: settings.difficulty,
      gestures: log.gestures(),
      faults,
      exitoSamples: vitals.exitoHistory(),
      bloodLostPct: snap.bloodLostPct,
      elapsedSec: t,
      sterility,
      leadership: {
        kind: stats.commands.kind,
        domina: stats.commands.domina,
        firmSweet: stats.commands.firmSweet,
        crises: stats.crises,
        neglectSeconds: crew.neglectSeconds(),
      },
      arrestHappened: arrests > 0,
      valerioTookOver,
      challenge: deps.challenge,
      challengeMet,
      tipHC: clinic.tipHC + clinic.minorCasesHC,
      costsHC,
      worstMoments: [...worst]
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 3)
        .map(({ t: tt, label }) => ({ t: tt, label })),
    });
    const auditLines = [
      pick(rng, dialogue.valerio.audit[result.rank]),
      pick(rng, dialogue.valerio.component[result.weakest]),
    ];
    if (caseDef.flags.final && result.rank !== 'F') auditLines.push(dialogue.valerio.finalRespect);
    deps.onFinish(result, { viralClips, valerioLines: auditLines });
  }

  function valerioTakeover() {
    valerioTookOver = true;
    worst.push({ t, label: 'Valerio tomó el control', weight: 40 });
    say('valerio', pick(rng, dialogue.valerio.takeover), 5);
    hud.toast('Valerio toma el control. El paciente sobrevive.', 'valerio');
    vitals.resolveArrest(true);
    arrestActive = false;
    step?.end();
    step = null;
    finishTimer = 3;
    setCamera('overview');
  }

  // ── Instrumental ──
  function slots(): InstrumentId[] {
    const base = step ? [...step.instruments] : ['hand' as InstrumentId];
    if (!base.includes('cautery')) base.push('cautery');
    const max = effects.extraSlot ? 7 : 6;
    return base.slice(0, max);
  }

  function selectInstrument(id: InstrumentId) {
    activeInstrument = id;
    scene.showInstrument(id);
  }

  function cauteryActive() {
    return activeInstrument === 'cautery' && !!step && !step.instruments.includes('cautery');
  }

  // ── Mensajes, órdenes ──
  function announceMessage() {
    audio.play('tick');
    hud.toast('Tu reloj vibra: mensaje nuevo (F)', 'good');
  }

  function readMessage() {
    const m = emiliana.readMessage(false);
    if (!m) return;
    handsOffUntil = t + MESSAGE_HANDS_OFF_SEC;
    releaseAllInputs();
    audio.play('praise');
    setTimeout(() => !disposed && audio.play('heartFlutter'), 400);
    crew.emiliana.setEmote('hearts');
    say('pareja', m.text, 5);
    setTimeout(() => !disposed && say('emiliana', pick(rng, dialogue.emiliana.relief)), 2200);
  }

  const keyDownAt: Partial<Record<AssistantId, number>> = {};
  const dominaFired: Partial<Record<AssistantId, boolean>> = {};
  const pendingTap: Partial<Record<AssistantId, number>> = {};

  function issueCommand(target: AssistantId, tone: CommandTone) {
    const r = emiliana.command(tone);
    if (!r.allowed) {
      hud.toast('Emiliana necesita un respiro: no puede mandar ahora', 'bad');
      return;
    }
    if (tone === 'domina') {
      audio.play('whip');
      crew.emiliana.setAnim('point');
      setTimeout(() => !disposed && crew.emiliana.setAnim('work'), 700);
    }
    // La tripulación emite la frase de Emiliana, la respuesta y el evento 'command'.
    const out = crew.command(target, tone);
    log.note('command', { target, tone, ignored: out.ignored });
    // Hipotermia: cualquier orden a Gigi con el paciente frío coloca la manta.
    if (target === 'gigi' && caseDef.flags.hypothermia && !warming && vitals.snapshot().tempC < 38) {
      warming = true;
      hud.toast('Gigi coloca la manta de aire caliente', 'good');
    }
    if (r.crisis) {
      crew.emiliana.setAnim('crack');
      say('emiliana', pick(rng, dialogue.emiliana.crisis));
      setTimeout(() => !disposed && crew.emiliana.setAnim('work'), 3000);
    }
  }

  // ── Entrada ──
  /** Teclas que el paso actual aceptó al pulsarse: su liberación siempre le llega. */
  const stepKeys = new Set<string>();

  function releaseAllInputs() {
    releasePointer();
    const held = [...stepKeys];
    stepKeys.clear();
    for (const code of held) step?.onKey(code, false);
    // Una orden a medio mantener no debe dispararse como Domina al volver.
    for (const a of ['rodrigo', 'fritz', 'gigi'] as AssistantId[]) {
      keyDownAt[a] = undefined;
      dominaFired[a] = false;
    }
    lampHold = 0;
  }

  function releasePointer() {
    if (buttons !== 0) {
      const p = makePointer(lastButton);
      if (cauteryActive()) cauteryTool.onPointerUp(p);
      else step?.onPointerUp(p);
      buttons = 0;
    }
  }

  function inputBlocked() {
    return finished || finishTimer >= 0 || arrestActive || breathing.isActive() || t < handsOffUntil || interstitialUntil > t || lampHold > 0;
  }

  function makePointer(button: number): WoundPointer {
    return {
      mm: { ...virtMm },
      onWound,
      button,
      buttons,
      pressure,
      shift: input.isDown('ShiftLeft') || input.isDown('ShiftRight'),
      t,
      instrument: activeInstrument,
    };
  }

  function updateVirtualPointer() {
    const picked = scene.pick(screen.x, screen.y);
    onWound = picked.onWound;
    const prev = rawMm;
    rawMm = picked.mm;
    const precision = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    emiliana.setPrecision(precision);
    if (precision && prev) {
      virtMm = { x: virtMm.x + (rawMm.x - prev.x) * 0.4, y: virtMm.y + (rawMm.y - prev.y) * 0.4 };
    } else {
      virtMm = { ...rawMm };
    }
    // Residente: imán suave (30%) hacia la trayectoria del paso.
    const params = step?.def.params as { path?: Vec2[] } | undefined;
    if (settings.difficulty === 'residente' && params?.path && params.path.length > 1) {
      const c = closestOnPolyline(virtMm, params.path);
      if (c.dist < 8) virtMm = lerpV(virtMm, c.point, 0.3);
    }
  }

  function tremoredPointer(button: number): WoundPointer {
    const p = makePointer(button);
    const amp = initialTremorScale > 0 ? (emiliana.tremorMm() * clamp(settings.tremorScale, 0, 1)) / initialTremorScale : 0;
    if (amp > 0) p.mm = { x: p.mm.x + noiseX(t) * amp, y: p.mm.y + noiseY(t) * amp };
    return p;
  }

  offs.push(
    input.onPointer((e) => {
      screen = { x: e.x, y: e.y };
      updateVirtualPointer();
      if (e.type === 'down') {
        buttons = e.buttons;
        lastButton = e.button;
        audio.unlock();
      } else if (e.type === 'up') {
        buttons = e.buttons;
      } else {
        buttons = e.buttons;
      }
      if (inputBlocked()) return;
      const p = tremoredPointer(e.button);
      // Mano izquierda: empujar la manguera de Rodrigo.
      if (e.button === 2 && e.type === 'down' && crew.rodrigo.isSoloing()) crew.rodrigo.pushHose(p.mm);
      if (e.type === 'move' && (e.buttons & 2) && crew.rodrigo.isSoloing()) crew.rodrigo.pushHose(p.mm);
      const target: { onPointerDown(p: WoundPointer): void; onPointerMove(p: WoundPointer): void; onPointerUp(p: WoundPointer): void } | null =
        cauteryActive() ? cauteryTool : step;
      if (!target) return;
      if (e.type === 'down') target.onPointerDown(p);
      else if (e.type === 'move') target.onPointerMove(p);
      else target.onPointerUp(p);
    }),
    input.onWheel((dy) => {
      const prev = pressure;
      pressure = clamp(pressure + (dy < 0 ? 1 : -1), 1, 5);
      // Con el botón pulsado y el ratón quieto, el paso (taladro, bisturí…) debe enterarse ya de la nueva presión.
      if (pressure !== prev && buttons !== 0 && !inputBlocked()) {
        const p = tremoredPointer(lastButton);
        if (cauteryActive()) cauteryTool.onPointerMove(p);
        else step?.onPointerMove(p);
      }
    }),
    input.onKey((code, down, repeat) => {
      if (finished) return;
      // Esc (pausa) lo gestiona solo GameFlow: aquí se abriría y cerraría en la misma pulsación.
      if (code === 'Escape') return;
      // Una tecla soltada siempre llega al paso que recibió su pulsación, aunque la entrada esté bloqueada.
      let upSent = false;
      if (!down && stepKeys.has(code)) {
        stepKeys.delete(code);
        upSent = true;
        if (step?.onKey(code, false)) return;
      }
      const asst = ASSISTANT_KEYS[code];
      if (cpr.isActive() || breathing.isActive()) {
        if (!down && asst) keyDownAt[asst] = undefined;
        if (cpr.isActive()) cpr.onKey(code, down);
        else breathing.onKey(code, down);
        return;
      }
      if (repeat) return;
      if (!inputBlocked() && step && !upSent && step.onKey(code, down)) {
        if (down) stepKeys.add(code);
        return;
      }
      if (asst) {
        handleCommandKey(asst, down);
        return;
      }
      if (!down) {
        if (code === 'KeyL') lampHold = 0;
        return;
      }
      if (code.startsWith('Digit')) {
        const n = Number(code.slice(5)) - 1;
        const s = slots();
        if (n >= 0 && n < s.length) {
          releasePointer();
          selectInstrument(s[n]);
          audio.play('uiClick');
        }
      } else if (code === 'KeyF') {
        readMessage();
      } else if (code === 'KeyB') {
        startBreathing();
      } else if (code === 'KeyL') {
        if (crew.gigi.lightLevel() < 0.95) {
          lampHold = 0.0001;
          releasePointer();
        }
      } else if (code === 'KeyH') {
        if (effects.handcuffsAutoSuction && !autoSuctionUsed) {
          autoSuctionUsed = true;
          autoSuctionUntil = t + 10;
          hud.toast('Esposas arcoíris: la cánula aspira sola 10 s', 'good');
        }
      } else if (code === 'Tab') {
        cameraOverview = !cameraOverview;
        setCamera(cameraOverview ? 'overview' : caseDef.flags.microMode ? 'micro' : 'wound');
      }
    }),
  );

  function handleCommandKey(target: AssistantId, down: boolean) {
    if (down) {
      keyDownAt[target] = t;
      dominaFired[target] = false;
      return;
    }
    const start = keyDownAt[target];
    if (start === undefined || dominaFired[target]) return;
    keyDownAt[target] = undefined;
    // Sin Voz Firme y Dulce no hay doble toque que esperar: la orden amable sale ya.
    if (!firmSweetUnlocked(deps.save)) {
      issueCommand(target, 'kind');
      return;
    }
    // Toque corto: amable, o Voz Firme y Dulce si hay doble toque.
    if (pendingTap[target] !== undefined && firmSweetUnlocked(deps.save)) {
      pendingTap[target] = undefined;
      issueCommand(target, 'firmSweet');
    } else {
      pendingTap[target] = t + DOUBLE_TAP_SEC;
    }
  }

  function updateCommandKeys() {
    for (const target of ['rodrigo', 'fritz', 'gigi'] as AssistantId[]) {
      const start = keyDownAt[target];
      if (start !== undefined && !dominaFired[target] && t - start >= HOLD_DOMINA_SEC) {
        dominaFired[target] = true;
        pendingTap[target] = undefined;
        issueCommand(target, 'domina');
      }
      const tap = pendingTap[target];
      if (tap !== undefined && t >= tap) {
        pendingTap[target] = undefined;
        issueCommand(target, 'kind');
      }
    }
  }

  function startBreathing() {
    if (week < 2) {
      hud.toast('La respiración cuadrada se desbloquea en la semana 2', 'info');
      return;
    }
    const v = vitals.snapshot();
    if (v.exito < 50 || blood.levelPct() >= 50 || v.arrest) {
      hud.toast('Ahora no: estabiliza primero al paciente', 'bad');
      return;
    }
    releaseAllInputs();
    say('emiliana', pick(rng, dialogue.emiliana.breathing));
    breathing.start({
      rhythmWindowScale: settings.rhythmWindowScale,
      audio,
      onDone: (q) => {
        emiliana.breathingDone(q);
        hud.toast(`Respiración: +${Math.round(20 * q)} de Concentración`, 'good');
      },
    });
  }

  // ── Paro ──
  function startArrest() {
    arrestActive = true;
    exitoZeroHit = false;
    arrests++;
    worst.push({ t, label: 'Paro cardiorrespiratorio', weight: 30 });
    vitals.triggerArrest();
    bus.emit('arrest:start', {});
    releaseAllInputs();
    audio.play('alarm');
    hud.alert('arrest', '¡PARO! Reanimación: Espacio al ritmo');
    setCamera('overview');
    crew.emiliana.setAnim('compress');
    const allowed = settings.difficulty === 'residente' ? 2 : 1;
    if (arrests > allowed) {
      valerioTakeover();
      return;
    }
    say('emiliana', pick(rng, dialogue.cpr.start));
    cpr.start({
      beat: audio.beat,
      rhythmWindowScale: settings.rhythmWindowScale,
      reduceFlashes: settings.reduceFlashes,
      isClear: () => crew.gigi.isClear(),
      dialogue,
      audio,
      onDone: (r) => {
        arrestActive = false;
        bus.emit('arrest:end', { success: r.success });
        if (r.success) {
          vitals.resolveArrest(true);
          say('emiliana', pick(rng, dialogue.cpr.rosc));
          hud.toast('¡Circulación espontánea! Rango máximo: B', 'good');
          crew.emiliana.setAnim('work');
          setCamera(caseDef.flags.microMode ? 'micro' : 'wound');
          cameraOverview = false;
        } else {
          say('emiliana', pick(rng, dialogue.cpr.fail));
          valerioTakeover();
        }
      },
    });
  }

  // ── HUD ──
  const instrumentNames: Record<string, string> = {};
  for (const [id, info] of Object.entries(INSTRUMENTS)) instrumentNames[id] = info.short;

  function checklist(): ChecklistItem[] {
    const phase = currentPhase();
    if (!phase) return [];
    const items: ChecklistItem[] = [];
    phase.steps.forEach((s, i) => {
      if (i < stepIdx) items.push({ label: s.label, done: true });
      else if (i === stepIdx && step) items.push(...step.checklist());
      else items.push({ label: s.label, done: false });
    });
    return items;
  }

  function totalProgress(): number {
    let pct = 0;
    caseDef.phases.forEach((p, i) => {
      if (i < phaseIdx) pct += p.weight;
      else if (i === phaseIdx) {
        const per = p.weight / Math.max(1, p.steps.length);
        pct += per * stepIdx + (step ? per * clamp(step.progress(), 0, 1) : 0);
      }
    });
    return finished || finishTimer >= 0 ? 100 : clamp(pct, 0, 100);
  }

  function hudVitals(): VitalsSnapshot {
    const v = vitals.snapshot();
    const foil = director.active().some((e) => e.kind === 'braulioFoil');
    if (!foil) return v;
    return { ...v, hr: NaN, spo2: NaN, map: NaN, etco2: NaN, tempC: NaN };
  }

  function buildHud(): HudModel {
    const v = hudVitals();
    const phase = currentPhase();
    const gauges: Gauge[] = [];
    if (step) gauges.push(...step.gauges());
    if (cauteryActive()) gauges.push(...cauteryTool.gauges());
    const s = slots();
    return {
      caseName: `${caseDef.patient.name} · ${caseDef.procedure}`,
      vitals: v,
      progress: {
        phases: caseDef.phases.map((p, i) => ({
          label: p.label,
          weight: p.weight,
          done: i < phaseIdx || finishTimer >= 0,
          active: i === phaseIdx && finishTimer < 0,
        })),
        totalPct: totalProgress(),
        phaseLabel: phase?.label ?? 'Terminado',
        stepLabel: step?.def.label ?? '',
        checklist: checklist(),
        hint: step?.hint() ?? '',
      },
      field: {
        levelPct: blood.levelPct(),
        floodThresholdPct: FLOOD_THRESHOLD_PCT,
        rodrigoSuctioning: crew.rodrigo.suctionRate() > 0 || t < autoSuctionUntil,
      },
      emiliana: emiliana.snapshot(),
      crew: crew.visualStates().map((c) => ({ ...c, name: ASSISTANT_NAMES[c.id] })),
      instruments: {
        slots: s,
        active: activeInstrument,
        contaminated: [],
        names: instrumentNames,
      },
      valerio: {
        gazing: crew.valerio.isGazing(),
        provisionalRank: provisional,
        hidden: settings.difficulty === 'jefe',
        line: t < valerioLineUntil ? valerioLine : null,
      },
      timer: { elapsedSec: t, targetSec: caseDef.targetTimeSec * (settings.difficulty === 'jefe' ? 0.8 : 1) },
      gauges,
      pressure,
      lightLevel: crew.gigi.lightLevel(),
      immersive: settings.immersive,
      microMode: !!caseDef.flags.microMode,
      challenge: deps.challenge?.text ?? null,
      carmShotsLeft: step?.def.params.type === 'reduction' ? carmLeft : null,
    };
  }

  function updateProvisional(dt: number) {
    provisionalTimer -= dt;
    if (provisionalTimer > 0) return;
    provisionalTimer = 1;
    const hist = vitals.exitoHistory();
    const g = log.gestures();
    provisional = provisionalRank({
      exitoAvg: hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : vitals.snapshot().exito,
      exitoMin: hist.length ? Math.min(...hist) : vitals.snapshot().exito,
      techniqueAvg: g.length ? (g.reduce((a, b) => a + b.quality, 0) / g.length) * 100 : 70,
      faults: log.faults(),
    });
  }

  function musicState(): MusicState {
    if (arrestActive) return 'arrest';
    const v = vitals.snapshot();
    if (v.exito < 35 || blood.levelPct() >= FLOOD_THRESHOLD_PCT) return 'orTension';
    if (crew.rodrigo.grooveActive()) return 'orGroove';
    return 'orStable';
  }

  function findFullestCell(): Vec2 {
    const { grid, cols, rows } = blood;
    let best = -1;
    let bi = 0;
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] > best) {
        best = grid[i];
        bi = i;
      }
    }
    const cx = bi % cols;
    const cy = Math.floor(bi / cols);
    return { x: ((cx + 0.5) / cols) * WOUND_W_MM, y: ((cy + 0.5) / rows) * WOUND_H_MM };
  }

  // Mira del puntero sobre la herida: marca el punto exacto donde actúa el instrumento.
  scene.wound.addOverlay({
    id: 'pointer-reticle',
    z: 90,
    draw: (g, px) => {
      if (!onWound || finished || arrestActive) return;
      const c = px(virtMm);
      g.save();
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(59,33,70,0.75)';
      g.beginPath();
      g.arc(c.x, c.y, 6, 0, Math.PI * 2);
      g.stroke();
      g.lineWidth = 2;
      g.strokeStyle = buttons !== 0 ? '#ff2e93' : '#ffffff';
      g.beginPath();
      g.arc(c.x, c.y, 6, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#ff2e93';
      g.beginPath();
      g.arc(c.x, c.y, 1.8, 0, Math.PI * 2);
      g.fill();
      g.restore();
    },
  });

  // ── Arranque ──
  setCamera('overview');
  audio.setMusic('orStable');
  say('emiliana', pick(rng, dialogue.emiliana.start));
  if (deps.challenge) setTimeout(() => !disposed && say('valerio', deps.challenge!.text, 5), 900);
  if (!clinic.diagnosisCorrect) {
    hud.toast(
      baseGuide === 'full'
        ? 'Diagnóstico equivocado en la clínica: solo verás el inicio y el fin de cada guía (−10 de Éxito)'
        : 'Diagnóstico equivocado en la clínica: −10 de Éxito',
      'bad',
    );
    setTimeout(() => !disposed && say('valerio', 'Diagnóstico creativo, doctora. Le quito media guía, por si acaso.', 5), 2600);
  }
  beginStep();
  const suctionLoop = audio.loop('suction');

  function update(dt: number) {
    if (disposed) return;
    if (finished) {
      scene.update(dt, t);
      return;
    }
    if (interstitialUntil > t + dt) {
      // Pausa breve entre fases: el mundo se congela.
      interstitialUntil -= dt;
      scene.update(dt, t);
      return;
    }
    t += dt;
    log.setTime(t);

    if (introUntil > 0) {
      introUntil -= dt;
      if (introUntil <= 0) {
        cameraOverview = false;
        setCamera(caseDef.flags.microMode ? 'micro' : 'wound');
      }
    }

    if (finishTimer >= 0) {
      finishTimer -= dt;
      crew.update(dt, { t, fieldLevelPct: blood.levelPct(), stepType: null, arrest: false, exito: vitals.snapshot().exito });
      scene.update(dt, t);
      hud.update(buildHud());
      if (finishTimer < 0) finish();
      return;
    }

    updateCommandKeys();

    // Lámpara a mano (L mantenida 1,5 s).
    if (lampHold > 0) {
      if (!input.isDown('KeyL')) lampHold = 0;
      else {
        lampHold += dt;
        if (lampHold >= LAMP_HOLD_SEC) {
          lampHold = 0;
          crew.gigi.fixLampByHand();
          hud.toast('Reorientaste la lámpara tú misma', 'info');
        }
      }
    }

    // Paso actual y cauterio universal. Un paso que lanza una excepción se omite: el bucle no debe morir.
    if (step && !arrestActive) {
      try {
        step.update(dt);
        cauteryTool.update(dt);
        if (step.isComplete()) advanceStep();
      } catch (err) {
        skipBrokenStep(err);
      }
    }

    // Sangre: sangrados → charco; aspiración → fuera.
    const hr = vitals.snapshot().hr;
    let emitted = 0;
    for (const e of bleeding.emit(dt, t, hr)) {
      blood.add(e.bleeder.pos, e.amount);
      emitted += e.amount;
    }
    bleedAccum = emitted;
    fullestTimer -= dt;
    if (fullestTimer <= 0) {
      fullestTimer = 0.25;
      fullestCell = findFullestCell();
    }
    const focus = crew.rodrigo.focus() ?? fullestCell;
    const rate = crew.rodrigo.suctionRate();
    let removed = 0;
    if (rate > 0) removed += blood.suction(focus, 10, rate, dt);
    if (t < autoSuctionUntil) removed += blood.suction(fullestCell, 10, 0.12, dt);
    suctionLoop.set('intensity', rate > 0 || t < autoSuctionUntil ? 0.7 : 0);
    suctionLoop.set('wet', clamp(blood.levelPct() / 60, 0, 1));
    if (removed > 0 && blood.totalPctBV() < 0.02 && rng() < 0.01) audio.play('slurpFinish');
    blood.step(dt);
    const field = blood.levelPct();
    maxField = Math.max(maxField, field);

    vitals.update(dt, { bleedPctPerSec: dt > 0 ? bleedAccum / dt : 0, fieldLevelPct: field, warming });
    const lowLight = crew.gigi.lightLevel() < 0.5;
    emiliana.update(dt, { fieldLevelPct: field, valerioGazing: crew.valerio.isGazing(), lowLight });

    // Director de Caos.
    const snap = vitals.snapshot();
    const res = director.update(dt, {
      exito: snap.exito,
      fieldLevelPct: field,
      arrest: arrestActive,
      stepType: step?.def.params.type ?? null,
    });
    for (const ev of res.started) onChaosStart(ev);
    for (const ev of res.ended) {
      crew.onChaosEnd(ev);
      bus.emit('chaos:end', ev);
    }

    crew.update(dt, { t, fieldLevelPct: field, stepType: step?.def.params.type ?? null, arrest: arrestActive, exito: snap.exito });

    // Mensaje nuevo pendiente.
    const pending = emiliana.snapshot().message.pending;
    if (pending && !lastMessagePending) announceMessage();
    lastMessagePending = pending;
    crew.emiliana.setBlush(emiliana.snapshot().blush);

    // Escena.
    const light = crew.gigi.lightLevel();
    scene.setLamp(light, light < 0.5 ? { x: 40, y: 360 } : { x: 0, y: 0 });
    scene.setPatientBreathing(arrestActive ? 0 : 12);
    scene.setMonitorVitals(hudVitals());
    const heatGauge = step?.gauges().find((g) => /temp|calor/i.test(g.id) || /Temperatura/i.test(g.label));
    const heat = heatGauge ? clamp((heatGauge.value - 37) / 20, 0, 1) : 0;
    scene.poseInstrument(virtMm, { active: buttons !== 0 && t >= handsOffUntil, heat });
    scene.update(dt, t);

    // Paro: Éxito a 0 (aunque la regeneración ya lo haya subido una décima en este fotograma).
    if (!arrestActive && !valerioTookOver && (exitoZeroHit || vitals.snapshot().exito <= 0)) startArrest();
    exitoZeroHit = false;
    if (cpr.isActive()) cpr.update(dt);
    if (breathing.isActive()) breathing.update(dt);

    // Audio y HUD.
    const foil = director.active().some((e) => e.kind === 'braulioFoil');
    audio.setVitals(foil ? null : vitals.snapshot());
    const ms = musicState();
    if (ms !== lastMusic) {
      lastMusic = ms;
      audio.setMusic(ms);
    }
    if (field >= FLOOD_THRESHOLD_PCT && rng() < dt * 0.2) hud.alert('flood', 'Campo inundado: ¡Rodrigo, aspira! (Z)');
    updateProvisional(dt);
    hud.update(buildHud());
  }

  function onChaosStart(ev: ChaosEvent) {
    crew.onChaosStart(ev);
    bus.emit('chaos:start', ev);
    const strong = ev.kind === 'rodrigoSolo' || ev.kind === 'gigiSelfie' || ev.kind === 'panchitoIntrusion';
    emiliana.stress(strong ? 8 : 4, ev.kind);
    const names: Record<ChaosEvent['kind'], string> = {
      rodrigoSolo: 'Rodrigo se marca un solo (Z o clic derecho)',
      gigiSelfie: 'Gigi se lleva la lámpara (mantén C o L)',
      fritzTremorSpike: 'A Fritz le tiemblan las manos',
      panchitoIntrusion: '¡Panchito entró al quirófano! (X)',
      valerioGaze: 'Valerio te está mirando',
      braulioFoil: 'El monitor pierde la señal: aluminio de Don Braulio',
      hortensiaCall: 'Doña Hortensia llama al móvil de Gigi',
    };
    hud.alert(ev.kind === 'valerioGaze' ? 'comment' : 'crew', names[ev.kind]);
  }

  function skipBrokenStep(err: unknown) {
    console.error('[quirófano] el paso falló y se omite', err);
    hud.toast('Fallo técnico en este paso: se omite', 'bad');
    try {
      advanceStep();
    } catch (err2) {
      // Si el siguiente paso tampoco arranca, se reintentará en el próximo fotograma.
      console.error('[quirófano] no se pudo avanzar de paso', err2);
    }
  }

  function applySettings(s: Settings) {
    // La dificultad cambia la puntuación y los sangrados: se respeta la del inicio del caso.
    Object.assign(settings, { ...s, difficulty: settings.difficulty });
    const el = hudRoot.querySelector<HTMLElement>('.emi-hud');
    if (el) {
      el.classList.toggle('reduce-flashes', settings.reduceFlashes);
      el.classList.toggle('pastel', settings.pastelMode);
      for (const c of ['deuter', 'protan', 'tritan']) el.classList.toggle(`cb-${c}`, settings.colorblind === c);
    }
  }

  const onBlur = () => releaseAllInputs();
  window.addEventListener('blur', onBlur);
  offs.push(() => window.removeEventListener('blur', onBlur));

  return {
    update,
    releaseInputs: releaseAllInputs,
    applySettings,
    render() {
      scene.render();
    },
    resize(w, h) {
      scene.resize(w, h);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      step?.end();
      (cauteryTool as UniversalTool & { dispose?: () => void }).dispose?.();
      suctionLoop.stop();
      cpr.stop();
      breathing.stop();
      for (const off of offs) off();
      bus.clear();
      crew.dispose();
      hud.dispose();
      scene.dispose();
      audio.setVitals(null);
      hudRoot.remove();
    },
    debug: {
      forceCompleteStep() {
        if (!step) return;
        advanceStep();
      },
      state() {
        const v = vitals.snapshot();
        return {
          t,
          phase: currentPhase()?.label ?? null,
          step: step?.def.label ?? null,
          stepType: step?.def.params.type ?? null,
          progress: totalProgress(),
          exito: v.exito,
          field: blood.levelPct(),
          arrest: arrestActive,
          finished,
          instrument: activeInstrument,
          chaos: director.active().map((e) => e.kind),
          completedSteps: [...completedSteps],
        };
      },
      setExito(v: number) {
        applyExito(v - vitals.snapshot().exito, 'debug');
      },
      ctx: () => ctx,
      project: (mm: Vec2) => scene.project(mm),
      stepParams: () => step?.def.params ?? null,
    },
  };
}
