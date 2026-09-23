import { describe, expect, it } from 'vitest';
import type { ChaosEvent, ChaosEventKind, CrewWorld, GameEvents } from '../../../core/contracts';
import { EventBus } from '../../../core/EventBus';
import { CrewLogic, FOIL_SYSTEM_LINES, RODRIGO_CRY_LINES } from './CrewLogic';
import { FritzLogic } from './FritzLogic';
import { fakeDialogue } from './testing/fakeDialogue';
import { moraleSuctionScale, slipChancePerSec } from './tuning';

const WORLD: CrewWorld = { t: 0, fieldLevelPct: 20, stepType: null, arrest: false, exito: 60 };

function setup(opts: { flags?: Record<string, boolean>; morale?: number; bonus?: number; seed?: number } = {}) {
  const bus = new EventBus<GameEvents>();
  const log: Array<{ type: keyof GameEvents; payload: unknown }> = [];
  for (const type of ['say', 'toast', 'sfx', 'command', 'viral:clip'] as const) bus.on(type, (payload) => log.push({ type, payload }));
  const m = opts.morale ?? 50;
  // tutorial evita despistes y grabaciones aleatorias para que las pruebas sean exactas
  const crew = new CrewLogic({
    bus,
    dialogue: fakeDialogue(),
    flags: { tutorial: true, ...opts.flags },
    morale: { rodrigo: m, fritz: m, gigi: m },
    moraleBonus: opts.bonus ?? 0,
    seed: opts.seed ?? 42,
  });
  const resolved: number[] = [];
  crew.setResolver((id) => resolved.push(id));
  const step = (sec: number, world: Partial<CrewWorld> = {}) => {
    const n = Math.round(sec / 0.05);
    for (let i = 0; i < n; i++) crew.update(0.05, { ...WORLD, ...world });
  };
  return { bus, log, crew, resolved, step };
}

let nextId = 1;
const ev = (kind: ChaosEventKind, duration = 10): ChaosEvent => ({ id: nextId++, kind, start: 0, duration, intensity: 1 });
const says = (log: Array<{ type: string; payload: unknown }>) => log.filter((l) => l.type === 'say').map((l) => l.payload as GameEvents['say']);

describe('órdenes: retardos, ventanas perfectas y respuestas', () => {
  it('amable 1,5–3 s sin ventana; Dómina 0,3 s y 8 s; Voz Firme 0,8 s y 4 s', () => {
    const { crew } = setup();
    for (let i = 0; i < 20; i++) {
      const o = crew.command('rodrigo', 'kind');
      expect(o.responseDelaySec).toBeGreaterThanOrEqual(1.5);
      expect(o.responseDelaySec).toBeLessThanOrEqual(3);
      expect(o.perfectForSec).toBe(0);
    }
    const d = crew.command('fritz', 'domina');
    expect(d.responseDelaySec).toBeCloseTo(0.3);
    expect(d.perfectForSec).toBe(8);
    const f = crew.command('gigi', 'firmSweet');
    expect(f.responseDelaySec).toBeCloseTo(0.8);
    expect(f.perfectForSec).toBe(4);
  });

  it('el retardo amable es determinista con la misma semilla', () => {
    const a = setup({ seed: 7 }).crew.command('rodrigo', 'kind').responseDelaySec;
    const b = setup({ seed: 7 }).crew.command('rodrigo', 'kind').responseDelaySec;
    expect(a).toBe(b);
  });

  it('emite "command" al instante y la respuesta con "say" solo tras el retardo', () => {
    const { crew, log, step } = setup();
    const o = crew.command('rodrigo', 'domina');
    expect(log.find((l) => l.type === 'command')?.payload).toEqual({ target: 'rodrigo', tone: 'domina', accepted: true });
    expect(says(log).map((s) => s.speaker)).toEqual(['emiliana']);
    expect(fakeDialogue().replies.rodrigo.domina).toContain(o.reply);
    step(0.25);
    expect(says(log).some((s) => s.speaker === 'rodrigo')).toBe(false);
    step(0.1);
    expect(says(log).some((s) => s.speaker === 'rodrigo' && s.text === o.reply)).toBe(true);
  });

  it('moral: amable +1, firme y dulce +2, Dómina −3, con bonus inicial y límites', () => {
    const { crew } = setup({ morale: 98, bonus: 5 });
    expect(crew.moraleOf('rodrigo')).toBe(100);
    crew.command('rodrigo', 'domina');
    expect(crew.moraleOf('rodrigo')).toBe(97);
    crew.command('rodrigo', 'firmSweet');
    expect(crew.moraleOf('rodrigo')).toBe(99);
    crew.command('rodrigo', 'kind');
    crew.command('rodrigo', 'kind');
    expect(crew.moraleOf('rodrigo')).toBe(100);
    const low = setup({ morale: 1 }).crew;
    low.command('fritz', 'domina');
    expect(low.moraleOf('fritz')).toBe(0);
  });
});

describe('Gigi: reglas para ignorar', () => {
  it('ignora la petición amable mientras graba o se hace selfies, pero no la Dómina', () => {
    const { crew, log, step } = setup();
    crew.gigi.filming = true;
    crew.gigi.filmLeft = 30;
    const o = crew.command('gigi', 'kind');
    expect(o.ignored).toBe(true);
    expect(o.perfectForSec).toBe(0);
    expect(fakeDialogue().replies.gigi.ignored).toContain(o.reply);
    expect(log.find((l) => l.type === 'command')?.payload).toMatchObject({ accepted: false });
    step(3.1);
    expect(crew.gigi.isFilming()).toBe(true);
    const d = crew.command('gigi', 'domina');
    expect(d.ignored).toBe(false);
    step(0.4);
    expect(crew.gigi.isFilming()).toBe(false);
  });

  it('durante la selfie la amable se ignora y la luz sigue baja', () => {
    const { crew, step, resolved } = setup();
    const e = ev('gigiSelfie');
    crew.onChaosStart(e);
    step(1.2);
    expect(crew.gigi.lightLevel()).toBeCloseTo(0.15, 2);
    expect(crew.command('gigi', 'kind').ignored).toBe(true);
    step(3.1);
    expect(crew.gigi.lightLevel()).toBeCloseTo(0.15, 2);
    expect(resolved).toEqual([]);
    crew.command('gigi', 'firmSweet');
    step(0.85);
    expect(crew.gigi.lightLevel()).toBe(1);
    expect(resolved).toEqual([e.id]);
  });

  it('fuera de la sala ignora cualquier orden y vuelve sola', () => {
    const { crew, step } = setup();
    crew.leaveRoomFor(3);
    expect(crew.command('gigi', 'domina').ignored).toBe(true);
    expect(crew.gigi.lightLevel()).toBe(1);
    step(3.1);
    expect(crew.gigi.mode).toBe('lamp');
  });
});

describe('Rodrigo: solo de guitarra y aspiración', () => {
  it('el solo corta la aspiración, suena el riff y se resuelve con una orden amable', () => {
    const { crew, log, step, resolved } = setup();
    const e = ev('rodrigoSolo');
    crew.onChaosStart(e);
    expect(crew.rodrigo.soloing).toBe(true);
    expect(crew.rodrigo.suctionRate()).toBe(0);
    expect(log.some((l) => l.type === 'sfx' && (l.payload as GameEvents['sfx']).name === 'guitarRiff')).toBe(true);
    expect(crew.visualStates().find((s) => s.id === 'rodrigo')).toMatchObject({ problem: true, state: 'distracted' });
    const o = crew.command('rodrigo', 'kind');
    step(o.responseDelaySec - 0.1);
    expect(crew.rodrigo.soloing).toBe(true);
    step(0.2);
    expect(crew.rodrigo.soloing).toBe(false);
    expect(resolved).toEqual([e.id]);
    expect(crew.rodrigo.suctionRate()).toBeGreaterThan(0);
  });

  it('empujar la manguera termina el solo al instante y fija el foco 6 s', () => {
    const { crew, step, resolved } = setup();
    const e = ev('rodrigoSolo');
    crew.onChaosStart(e);
    crew.pushHose({ x: 80, y: 50 });
    expect(crew.rodrigo.soloing).toBe(false);
    expect(resolved).toEqual([e.id]);
    expect(crew.rodrigo.focus()).toEqual({ x: 80, y: 50 });
    step(5.9);
    expect(crew.rodrigo.focus()).not.toBeNull();
    step(0.2);
    expect(crew.rodrigo.focus()).toBeNull();
  });

  it('Dómina da ×1,5 durante 8 s; Voz Firme ×1,25 (groove) y la moral escala 0,85–1,1', () => {
    const { crew, step } = setup({ morale: 100 });
    const base = crew.rodrigo.suctionRate();
    expect(base).toBeCloseTo(0.12 * 1.1, 5);
    crew.command('rodrigo', 'domina');
    step(0.35);
    const m = crew.moraleOf('rodrigo');
    expect(crew.rodrigo.suctionRate()).toBeCloseTo(0.12 * moraleSuctionScale(m) * 1.5, 5);
    step(8.2);
    // tras la ventana perfecta no queda boost (la Dómina no da groove)
    expect(crew.rodrigo.suctionRate()).toBeCloseTo(0.12 * moraleSuctionScale(m), 5);
    crew.command('rodrigo', 'firmSweet');
    step(0.85);
    expect(crew.rodrigo.grooveActive()).toBe(true);
    expect(crew.rodrigo.suctionRate()).toBeCloseTo(0.12 * moraleSuctionScale(crew.moraleOf('rodrigo')) * 1.25, 5);
    expect(moraleSuctionScale(0)).toBeCloseTo(0.85);
    expect(moraleSuctionScale(100)).toBeCloseTo(1.1);
    expect(slipChancePerSec(100)).toBe(0);
    expect(slipChancePerSec(0)).toBeGreaterThan(slipChancePerSec(50));
  });

  it('con rodrigoNoSolos no toca: llora bajito, sigue aspirando y la interferencia queda resuelta', () => {
    const { crew, log, resolved } = setup({ flags: { rodrigoNoSolos: true } });
    const e = ev('rodrigoSolo');
    crew.onChaosStart(e);
    expect(crew.rodrigo.soloing).toBe(false);
    expect(crew.rodrigo.suctionRate()).toBeGreaterThan(0);
    expect(resolved).toEqual([e.id]);
    expect(says(log).some((s) => s.speaker === 'rodrigo' && RODRIGO_CRY_LINES.includes(s.text))).toBe(true);
    expect(crew.visualStates().find((s) => s.id === 'rodrigo')?.problem).toBe(false);
  });
});

describe('Fritz: temblor y modificadores', () => {
  it('temblor base 1 (0,2 con fritzNoTremor), pico 1,8 y límite 2,2', () => {
    expect(new FritzLogic(false).tremor()).toBe(1);
    expect(new FritzLogic(true).tremor()).toBeCloseTo(0.2);
    const f = new FritzLogic(false);
    f.startSpike(1);
    expect(f.tremor()).toBeCloseTo(1.8);
    f.modMult = 1.5;
    f.modLeft = 5;
    expect(f.tremor()).toBeCloseTo(2.2);
  });

  it('amable −30 % y firme −40 % durante 10 s; Dómina +50 % pero resuelve el pico', () => {
    const { crew, step, resolved } = setup();
    crew.command('fritz', 'kind');
    step(3.05);
    expect(crew.fritz.tremor()).toBeCloseTo(0.7);
    step(10);
    expect(crew.fritz.tremor()).toBe(1);
    crew.command('fritz', 'firmSweet');
    step(0.85);
    expect(crew.fritz.tremor()).toBeCloseTo(0.6);
    step(10.3);
    const e = ev('fritzTremorSpike');
    crew.onChaosStart(e);
    expect(crew.fritz.tremor()).toBeCloseTo(1.8);
    expect(crew.visualStates().find((s) => s.id === 'fritz')).toMatchObject({ problem: true, state: 'trembling' });
    crew.command('fritz', 'domina');
    step(0.35);
    expect(resolved).toEqual([e.id]);
    expect(crew.fritz.tremor()).toBeCloseTo(1.5);
    step(10.3);
    expect(crew.fritz.tremor()).toBe(1);
  });

  it('Panchito: la Dómina lo atrapa al instante; la amable tras perseguirlo; si nadie lo atrapa, se va', () => {
    const a = setup();
    const e1 = ev('panchitoIntrusion');
    a.crew.onChaosStart(e1);
    expect(a.crew.fritz.panchito).toBe('loose');
    a.crew.command('fritz', 'domina');
    a.step(0.35);
    expect(a.crew.fritz.panchito).toBe('caught');
    expect(a.resolved).toEqual([e1.id]);

    const b = setup();
    const e2 = ev('panchitoIntrusion');
    b.crew.onChaosStart(e2);
    const o = b.crew.command('fritz', 'kind');
    b.step(o.responseDelaySec + 0.05);
    expect(b.crew.fritz.panchito).toBe('chase');
    expect(b.resolved).toEqual([]);
    b.step(2.6);
    expect(b.crew.fritz.panchito).toBe('caught');
    expect(b.resolved).toEqual([e2.id]);

    const c = setup();
    const e3 = ev('panchitoIntrusion');
    c.crew.onChaosStart(e3);
    c.crew.onChaosEnd(e3);
    expect(c.crew.fritz.panchito).toBe('fled');
    c.step(4.1);
    expect(c.crew.fritz.panchito).toBe('none');
  });

  it('presentar, caer y atrapar cambian la reacción y dicen frases de Fritz', () => {
    const { crew, log, step } = setup();
    crew.presentItem('screw');
    expect(crew.fritz.reaction).toBe('offer');
    crew.dropped();
    expect(crew.fritz.reaction).toBe('drop');
    expect(crew.visualStates().find((s) => s.id === 'fritz')?.state).toBe('panic');
    expect(says(log).some((s) => s.speaker === 'fritz' && fakeDialogue().fritz.drop.includes(s.text))).toBe(true);
    step(3.1);
    crew.caught();
    expect(crew.fritz.reaction).toBe('catch');
    step(1.3);
    expect(crew.fritz.reaction).toBe('none');
  });
});

describe('descuidos (neglect)', () => {
  it('cuenta solo el tiempo por encima de 5 s y una vez aunque haya dos problemas', () => {
    const { crew, step } = setup();
    crew.onChaosStart(ev('rodrigoSolo', 20));
    step(4);
    expect(crew.neglectSeconds()).toBe(0);
    crew.onChaosStart(ev('fritzTremorSpike', 20));
    step(4);
    // solo lleva 8 s (3 s de descuido); el pico lleva 4 s y no suma aparte
    expect(crew.neglectSeconds()).toBeCloseTo(3, 1);
    step(2);
    // ambos por encima de 5 s: sigue sumando 1 s por segundo
    expect(crew.neglectSeconds()).toBeCloseTo(5, 1);
  });

  it('al resolver el problema deja de sumar y el contador del asistente se reinicia', () => {
    const { crew, step } = setup();
    crew.onChaosStart(ev('rodrigoSolo', 30));
    step(7);
    crew.pushHose({ x: 50, y: 50 });
    const n = crew.neglectSeconds();
    expect(n).toBeCloseTo(2, 1);
    step(5);
    expect(crew.neglectSeconds()).toBeCloseTo(n, 5);
    crew.onChaosStart(ev('rodrigoSolo', 30));
    step(4.9);
    expect(crew.neglectSeconds()).toBeCloseTo(n, 5);
  });
});

describe('clip viral', () => {
  it('gesto perfecto mientras graba y sin órdenes a Gigi en 3 s → viral:clip + aviso', () => {
    const { crew, bus, log, step } = setup();
    crew.gigi.filming = true;
    crew.gigi.filmLeft = 20;
    bus.emit('gesture', { label: 'Tornillo', quality: 0.95, perfect: true });
    step(2.9);
    expect(log.some((l) => l.type === 'viral:clip')).toBe(false);
    step(0.2);
    expect(log.filter((l) => l.type === 'viral:clip').length).toBe(1);
    expect(log.some((l) => l.type === 'toast' && (l.payload as GameEvents['toast']).text === '¡Clip viral!')).toBe(true);
    expect(says(log).some((s) => s.speaker === 'gigi' && fakeDialogue().gigi.viral.includes(s.text))).toBe(true);
  });

  it('una orden a Gigi dentro de la ventana corta el clip; sin grabar no hay clip', () => {
    const a = setup();
    a.crew.gigi.filming = true;
    a.crew.gigi.filmLeft = 20;
    a.bus.emit('gesture', { label: 'x', quality: 0.95, perfect: true });
    a.step(1);
    a.crew.command('gigi', 'domina');
    a.step(4);
    expect(a.log.some((l) => l.type === 'viral:clip')).toBe(false);

    const b = setup();
    b.bus.emit('gesture', { label: 'x', quality: 0.95, perfect: true });
    b.step(4);
    expect(b.log.some((l) => l.type === 'viral:clip')).toBe(false);

    const c = setup();
    c.crew.gigi.filming = true;
    c.crew.gigi.filmLeft = 20;
    c.bus.emit('gesture', { label: 'x', quality: 0.6, perfect: false });
    c.step(4);
    expect(c.log.some((l) => l.type === 'viral:clip')).toBe(false);
  });
});

describe('Gigi: luz, llamadas y paro', () => {
  it('con gigiSelfieBoost baja a 0,1 y la selfie dura 4 s más tras el fin del evento', () => {
    const { crew, step } = setup({ flags: { gigiSelfieBoost: true } });
    const e = ev('gigiSelfie');
    crew.onChaosStart(e);
    step(1.5);
    expect(crew.gigi.lightLevel()).toBeCloseTo(0.1, 2);
    crew.onChaosEnd(e);
    step(3.5);
    expect(crew.gigi.mode).toBe('selfie');
    step(0.6);
    expect(crew.gigi.mode).toBe('lamp');
    step(1);
    expect(crew.gigi.lightLevel()).toBe(1);
  });

  it('la llamada de Hortensia deja la luz al 0,6 y la lámpara a mano resuelve la selfie', () => {
    const { crew, step, resolved } = setup();
    const call = ev('hortensiaCall');
    crew.onChaosStart(call);
    step(1);
    expect(crew.gigi.lightLevel()).toBeCloseTo(0.6, 2);
    crew.onChaosEnd(call);
    const s = ev('gigiSelfie');
    crew.onChaosStart(s);
    step(1);
    crew.fixLampByHand();
    expect(crew.gigi.lightLevel()).toBe(1);
    expect(resolved).toEqual([s.id]);
  });

  it('isClear solo durante el paro y tras 1–3 s', () => {
    const { crew, step } = setup();
    expect(crew.gigi.isClear()).toBe(false);
    step(0.95, { arrest: true });
    expect(crew.gigi.isClear()).toBe(false);
    step(3, { arrest: true });
    expect(crew.gigi.isClear()).toBe(true);
    step(0.1, { arrest: false });
    expect(crew.gigi.isClear()).toBe(false);
  });
});

describe('Valerio y aluminio de Braulio', () => {
  it('comenta faltas con 8 s de enfriamiento (4 s mientras mira) y fases con 12 s', () => {
    const { crew, bus, log, step } = setup();
    const valerio = () => says(log).filter((s) => s.speaker === 'valerio').length;
    bus.emit('fault', { kind: 'char' });
    bus.emit('fault', { kind: 'char' });
    expect(valerio()).toBe(1);
    step(8.05);
    bus.emit('fault', { kind: 'plunge' });
    expect(valerio()).toBe(2);
    const g = ev('valerioGaze');
    crew.onChaosStart(g);
    expect(crew.valerio.isGazing()).toBe(true);
    const afterGaze = valerio();
    step(8.05);
    bus.emit('fault', { kind: 'char' });
    step(4.05);
    bus.emit('fault', { kind: 'char' });
    expect(valerio()).toBe(afterGaze + 2);
    crew.onChaosEnd(g);
    expect(crew.valerio.isGazing()).toBe(false);
    bus.emit('phase:complete', { phaseId: 'a' });
    step(5);
    bus.emit('phase:complete', { phaseId: 'b' });
    const n = valerio();
    step(7.1);
    bus.emit('phase:complete', { phaseId: 'c' });
    expect(valerio()).toBe(n + 1);
  });

  it('el aluminio hace hablar al "sistema" sobre el monitor', () => {
    const { crew, log, step } = setup();
    crew.onChaosStart(ev('braulioFoil'));
    step(0.7);
    expect(says(log).some((s) => s.speaker === 'sistema' && FOIL_SYSTEM_LINES.includes(s.text))).toBe(true);
  });

  it('no dice la frase de fin si la interferencia ya se resolvió', () => {
    const { crew, log } = setup();
    const e = ev('rodrigoSolo');
    crew.onChaosStart(e);
    crew.pushHose({ x: 1, y: 1 });
    const before = says(log).length;
    crew.onChaosEnd(e);
    expect(says(log).length).toBe(before);
  });
});
