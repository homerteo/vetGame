/**
 * Coordinador puro del equipo quirúrgico: órdenes con retardo, reacciones al caos, moral,
 * descuidos (neglect), frases y eventos del bus. Sin Three.js: se prueba en node.
 */
import type {
  AssistantId, AssistantVisualState, CaseFlags, ChaosEvent, ChaosEventKind, CommandOutcome, CommandTone,
  CrewWorld, DialogueBank, FaultKind, GameEvents, SpeakerId, Vec2,
} from '../../../core/contracts';
import type { EventBus } from '../../../core/EventBus';
import { clamp } from '../../../core/math';
import { createRng } from '../../../core/rng';
import { FritzLogic } from './FritzLogic';
import { GigiLogic } from './GigiLogic';
import { LinePicker } from './lines';
import { RodrigoLogic } from './RodrigoLogic';
import { CREW_TUNING, responseDelay, slipChancePerSec } from './tuning';
import { ValerioLogic } from './ValerioLogic';

export interface CrewLogicDeps {
  bus: EventBus<GameEvents>;
  dialogue: DialogueBank;
  flags: CaseFlags;
  morale: Record<AssistantId, number>;
  moraleBonus?: number;
  seed: number;
}

export interface CrewVisualState {
  id: AssistantId;
  state: AssistantVisualState;
  morale: number;
  problem: boolean;
}

/** Frases propias de Rodrigo cuando el caso no le deja hacer solos (Chorizo es su perro). */
export const RODRIGO_CRY_LINES = [
  'Aguanta, Chorizo… (snif)',
  'No lloro, doctora, es el antiséptico… (snif)',
  'Papá está aquí, Chorizo. Papá aspira por ti.',
  'Tú puedes, salchichita valiente… (snif)',
];

/** Aviso del sistema cuando Braulio envuelve el monitor en aluminio. */
export const FOIL_SYSTEM_LINES = [
  'Monitor: señal perdida. ¿Eso es… papel de aluminio?',
  'Sin señal: alguien le puso un gorrito de aluminio al monitor.',
  'Error de lectura. El monitor está "protegido contra el 5G".',
  'Señal bloqueada por aluminio de cocina. Constantes ocultas.',
];

/** Qué asistente resuelve cada tipo de interferencia. */
export const CHAOS_OWNER: Partial<Record<ChaosEventKind, AssistantId>> = {
  rodrigoSolo: 'rodrigo',
  gigiSelfie: 'gigi',
  hortensiaCall: 'gigi',
  fritzTremorSpike: 'fritz',
  panchitoIntrusion: 'fritz',
};

interface Pending {
  at: number;
  run: () => void;
}

export interface LastCommand {
  target: AssistantId;
  tone: CommandTone;
  at: number;
  ignored: boolean;
}

export class CrewLogic {
  readonly rodrigo: RodrigoLogic;
  readonly fritz: FritzLogic;
  readonly gigi: GigiLogic;
  readonly valerio: ValerioLogic;
  readonly lines: LinePicker;
  now = 0;
  lastCommand: LastCommand | null = null;
  arrest = false;
  private rng: () => number;
  private morale: Record<AssistantId, number>;
  private pending: Pending[] = [];
  private active = new Map<number, ChaosEvent>();
  private resolved = new Set<number>();
  private resolver: ((id: number) => void) | null = null;
  private problemAge: Record<AssistantId, number> = { rodrigo: 0, fritz: 0, gigi: 0 };
  private neglect = 0;
  private unsub: Array<() => void> = [];
  private states: CrewVisualState[];
  private tutorial: boolean;

  constructor(private deps: CrewLogicDeps) {
    this.rng = createRng(deps.seed >>> 0);
    this.lines = new LinePicker(createRng((deps.seed ^ 0x9e3779b9) >>> 0));
    const bonus = deps.moraleBonus ?? 0;
    this.morale = {
      rodrigo: clamp(deps.morale.rodrigo + bonus, 0, 100),
      fritz: clamp(deps.morale.fritz + bonus, 0, 100),
      gigi: clamp(deps.morale.gigi + bonus, 0, 100),
    };
    this.tutorial = !!deps.flags.tutorial;
    this.rodrigo = new RodrigoLogic(createRng((deps.seed + 11) >>> 0));
    this.fritz = new FritzLogic(!!deps.flags.fritzNoTremor);
    this.gigi = new GigiLogic(createRng((deps.seed + 23) >>> 0), !!deps.flags.gigiSelfieBoost, !this.tutorial);
    this.valerio = new ValerioLogic();
    this.syncMorale();
    this.states = (['rodrigo', 'fritz', 'gigi'] as AssistantId[]).map((id) => ({ id, state: 'ok' as AssistantVisualState, morale: this.morale[id], problem: false }));
    const bus = deps.bus;
    this.unsub.push(
      bus.on('gesture', (g) => this.gigi.onGesture(g.perfect)),
      bus.on('fault', (f) => this.onFault(f.kind)),
      bus.on('phase:complete', () => this.onPhaseComplete()),
    );
  }

  private syncMorale() {
    this.rodrigo.morale = this.morale.rodrigo;
    this.fritz.morale = this.morale.fritz;
    this.gigi.morale = this.morale.gigi;
  }

  moraleOf(id: AssistantId): number {
    return this.morale[id];
  }

  setResolver(fn: (id: number) => void): void {
    this.resolver = fn;
  }

  activeEvents(): ChaosEvent[] {
    return [...this.active.values()];
  }

  // ───────────── habla y sonido ─────────────

  say(speaker: SpeakerId, text: string, durationSec: number = CREW_TUNING.sayDurationSec): void {
    if (!text) return;
    this.deps.bus.emit('say', { speaker, text, durationSec });
  }

  /** Frase ambiental con enfriamiento mínimo por personaje. */
  sayAmbient(speaker: SpeakerId, list: readonly string[] | undefined, cooldown: number = CREW_TUNING.ambientCooldownSec): void {
    if (!this.lines.ready(speaker, this.now)) return;
    const text = this.lines.pick(list);
    if (!text) return;
    this.lines.hold(speaker, this.now, cooldown);
    this.say(speaker, text);
  }

  private schedule(delay: number, run: () => void) {
    this.pending.push({ at: this.now + delay, run });
  }

  private resolve(id: number | null) {
    if (id === null || id === undefined) return;
    if (!this.active.has(id) || this.resolved.has(id)) return;
    this.resolved.add(id);
    this.active.delete(id);
    this.resolver?.(id);
  }

  // ───────────── órdenes ─────────────

  command(target: AssistantId, tone: CommandTone): CommandOutcome {
    const d = this.deps.dialogue;
    // Emiliana da la orden (frase inmediata)
    this.say('emiliana', this.lines.pick(d.commands?.[target]?.[tone]), 2.2);
    const ignored = target === 'gigi' && this.gigi.ignores(tone);
    if (target === 'gigi') this.gigi.onCommanded();
    const delay = responseDelay(tone, this.rng);
    const perfectFor = ignored ? 0 : CREW_TUNING.perfectFor[tone];
    const reply = this.lines.pick(ignored ? d.replies?.[target]?.ignored : d.replies?.[target]?.[tone]);
    // moral
    this.morale[target] = clamp(this.morale[target] + CREW_TUNING.morale[tone], 0, 100);
    this.syncMorale();
    this.lastCommand = { target, tone, at: this.now, ignored };
    this.deps.bus.emit('command', { target, tone, accepted: !ignored });
    this.schedule(delay, () => {
      this.say(target, reply);
      if (!ignored) this.applyEffect(target, tone);
    });
    return { ignored, responseDelaySec: delay, perfectForSec: perfectFor, reply };
  }

  private applyEffect(target: AssistantId, tone: CommandTone) {
    if (target === 'rodrigo') {
      const solo = this.rodrigo.soloEventId;
      const groove = this.rodrigo.applyCommand(tone);
      this.resolve(solo);
      if (groove) this.sayAmbient('rodrigo', this.deps.dialogue.rodrigo?.groove, 4);
    } else if (target === 'fritz') {
      for (const id of this.fritz.applyCommand(tone)) this.resolve(id);
    } else {
      for (const id of this.gigi.applyCommand()) this.resolve(id);
    }
  }

  // ───────────── APIs directas ─────────────

  pushHose(mm: Vec2): void {
    this.resolve(this.rodrigo.pushHose(mm));
  }

  fixLampByHand(): void {
    for (const id of this.gigi.fixLamp(false)) this.resolve(id);
  }

  leaveRoomFor(sec: number): void {
    for (const id of this.gigi.leaveRoom(sec)) this.resolve(id);
    this.sayAmbient('gigi', this.deps.dialogue.gigi?.leave, 3);
  }

  presentItem(kind: 'screw' | 'plate' | 'pin'): void {
    this.fritz.presentItem(kind);
  }

  dropped(): void {
    this.fritz.dropped();
    this.sayAmbient('fritz', this.deps.dialogue.fritz?.drop, 3);
  }

  caught(): void {
    this.fritz.caught();
    this.sayAmbient('fritz', this.deps.dialogue.fritz?.catch, 3);
  }

  valerioSay(text: string): void {
    this.valerio.spoke();
    this.say('valerio', text, 3.2);
  }

  // ───────────── caos ─────────────

  onChaosStart(ev: ChaosEvent): void {
    this.active.set(ev.id, ev);
    const d = this.deps.dialogue;
    const bank = d.chaos?.[ev.kind];
    const bus = this.deps.bus;
    const sayStart = () => bank && this.say(bank.speaker, this.lines.pick(bank.start));
    switch (ev.kind) {
      case 'rodrigoSolo': {
        const solo = this.rodrigo.startSolo(ev.id, !!this.deps.flags.rodrigoNoSolos, ev.duration);
        if (solo) {
          sayStart();
          bus.emit('sfx', { name: 'guitarRiff', volume: 0.9 });
        } else {
          // no hay solo: llora bajito y sigue aspirando; la interferencia queda resuelta
          this.say('rodrigo', this.lines.pick(RODRIGO_CRY_LINES));
          this.resolve(ev.id);
        }
        break;
      }
      case 'gigiSelfie':
        this.gigi.startSelfie(ev.id);
        sayStart();
        bus.emit('sfx', { name: 'camera' });
        break;
      case 'hortensiaCall':
        this.gigi.startCall(ev.id);
        bus.emit('sfx', { name: 'phone' });
        sayStart();
        break;
      case 'fritzTremorSpike':
        this.fritz.startSpike(ev.id);
        sayStart();
        break;
      case 'panchitoIntrusion':
        this.fritz.startPanchito(ev.id);
        bus.emit('sfx', { name: 'panchitoBark' });
        sayStart();
        break;
      case 'valerioGaze':
        this.valerio.startGaze(ev.id);
        this.valerio.spoke();
        if (bank?.start?.length) sayStart();
        else this.say('valerio', this.lines.pick(d.valerio?.gaze));
        break;
      case 'braulioFoil':
        sayStart();
        this.schedule(0.6, () => this.say('sistema', this.lines.pick(FOIL_SYSTEM_LINES), 3.5));
        break;
    }
  }

  onChaosEnd(ev: ChaosEvent): void {
    const wasResolved = this.resolved.has(ev.id);
    this.active.delete(ev.id);
    this.resolved.delete(ev.id);
    switch (ev.kind) {
      case 'rodrigoSolo':
        if (this.rodrigo.soloEventId === ev.id) this.rodrigo.endSolo();
        break;
      case 'gigiSelfie':
        if (this.gigi.selfieEventId === ev.id) this.gigi.selfieEventEnded();
        break;
      case 'hortensiaCall':
        if (this.gigi.callEventId === ev.id) this.gigi.callEnded();
        break;
      case 'fritzTremorSpike':
        if (this.fritz.spikeEventId === ev.id) this.fritz.endSpike();
        break;
      case 'panchitoIntrusion':
        if (this.fritz.panchitoEventId === ev.id) this.fritz.panchitoFlees();
        break;
      case 'valerioGaze':
        if (this.valerio.gazeEventId === ev.id) this.valerio.endGaze();
        break;
      case 'braulioFoil':
        break;
    }
    if (!wasResolved) {
      const bank = this.deps.dialogue.chaos?.[ev.kind];
      if (bank && !(ev.kind === 'rodrigoSolo' && this.deps.flags.rodrigoNoSolos)) this.say(bank.speaker, this.lines.pick(bank.end));
    }
  }

  private onFault(kind: FaultKind) {
    if (!this.valerio.wantsFaultComment()) return;
    this.valerioSay(this.lines.pick(this.deps.dialogue.valerio?.fault?.[kind]));
  }

  private onPhaseComplete() {
    if (!this.valerio.wantsPhaseComment()) return;
    this.valerioSay(this.lines.pick(this.deps.dialogue.valerio?.phaseDone));
  }

  // ───────────── actualización ─────────────

  update(dt: number, world: CrewWorld): void {
    this.now += dt;
    this.arrest = world.arrest;
    // órdenes pendientes (en orden de llegada)
    if (this.pending.length) {
      for (let i = 0; i < this.pending.length; ) {
        const p = this.pending[i];
        if (p.at <= this.now) {
          this.pending.splice(i, 1);
          p.run();
        } else i++;
      }
    }
    // despistes pequeños según la moral (nunca en tutorial ni en paro)
    if (!this.tutorial && !world.arrest && dt > 0) {
      if (this.rng() < slipChancePerSec(this.morale.rodrigo) * dt) this.rodrigo.slip();
      if (this.rng() < slipChancePerSec(this.morale.fritz) * dt) this.fritz.slip();
      if (this.rng() < slipChancePerSec(this.morale.gigi) * dt) this.gigi.slip();
    }
    const r = this.rodrigo.update(dt, !this.tutorial && !world.arrest);
    if (r.riff) this.deps.bus.emit('sfx', { name: 'guitarRiff', volume: 0.7 });
    if (r.tempoGroove) this.sayAmbient('rodrigo', this.deps.dialogue.rodrigo?.groove);
    const f = this.fritz.update(dt);
    if (f.caughtPanchito !== null) this.resolve(f.caughtPanchito);
    const g = this.gigi.update(dt, world.arrest);
    if (g.startedFilming) this.sayAmbient('gigi', this.deps.dialogue.gigi?.filming);
    if (g.viral) {
      this.deps.bus.emit('viral:clip', {});
      this.deps.bus.emit('toast', { text: '¡Clip viral!', kind: 'good' });
      this.say('gigi', this.lines.pick(this.deps.dialogue.gigi?.viral));
    }
    this.valerio.update(dt);
    // descuidos: tiempo con un problema activo más allá de 5 s (una vez por fotograma)
    let neglecting = false;
    for (const s of this.states) {
      const problem = this.hasProblem(s.id);
      this.problemAge[s.id] = problem ? this.problemAge[s.id] + dt : 0;
      if (this.problemAge[s.id] > CREW_TUNING.neglectGraceSec) neglecting = true;
    }
    if (neglecting) this.neglect += dt;
  }

  hasProblem(id: AssistantId): boolean {
    if (id === 'rodrigo') return this.rodrigo.soloing;
    if (id === 'gigi') return this.gigi.mode === 'selfie';
    return this.fritz.spiking || this.fritz.panchito === 'loose' || this.fritz.panchito === 'chase';
  }

  neglectSeconds(): number {
    return this.neglect;
  }

  /** Estados para el HUD (el array se reutiliza entre llamadas). */
  visualStates(): CrewVisualState[] {
    for (const s of this.states) {
      s.morale = this.morale[s.id];
      s.problem = this.hasProblem(s.id);
      s.state = this.stateOf(s.id);
    }
    return this.states;
  }

  private stateOf(id: AssistantId): AssistantVisualState {
    if (id === 'rodrigo') {
      const r = this.rodrigo;
      if (r.soloing) return 'distracted';
      if (r.cryLeft > 0 || r.slipLeft > 0) return 'distracted';
      return 'working';
    }
    if (id === 'fritz') {
      const f = this.fritz;
      if (f.panchito === 'loose' || f.panchito === 'chase' || f.reaction === 'drop') return 'panic';
      if (f.panchito === 'caught') return 'out';
      if (f.spiking || f.tremor() > 1.3) return 'trembling';
      if (f.reaction === 'offer') return 'working';
      return 'ok';
    }
    const g = this.gigi;
    if (g.mode === 'out' || g.isClear()) return 'out';
    if (g.mode === 'selfie' || g.mode === 'call') return 'distracted';
    if (g.filming) return 'filming';
    return 'ok';
  }

  dispose(): void {
    for (const u of this.unsub) u();
    this.unsub.length = 0;
    this.pending.length = 0;
    this.active.clear();
  }
}
