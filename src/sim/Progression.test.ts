import { describe, expect, it } from 'vitest';
import type { AuditResult, Rank } from '../core/contracts';
import {
  applyAudit,
  buyItem,
  computeEffects,
  defaultSave,
  defaultSettings,
  firmSweetUnlocked,
  guideLevelFor,
  isCaseUnlocked,
  loadSave,
  persistSave,
  reputationFrom,
  SAVE_KEY,
  toggleEquip,
} from './Progression';
import { makeCase, makeItem, memoryStorage } from './testing/fixtures';

function result(rank: Rank, total: number): AuditResult {
  return {
    components: { T: 80, E: 80, H: 80, S: 80, L: 80, t: 80 },
    nota: 80,
    rank,
    cap: null,
    coins: { fee: 100, multiplier: 1, tip: 0, costs: 0, total },
    worstMoments: [],
    weakest: 'T',
    challengeMet: false,
  };
}

describe('Progression — valores por defecto', () => {
  it('ajustes por defecto', () => {
    expect(defaultSettings()).toEqual({
      difficulty: 'especialista',
      goreLevel: 70,
      pastelMode: false,
      tremorScale: 1,
      rhythmWindowScale: 1,
      reduceFlashes: false,
      subtitles: true,
      tts: false,
      masterVolume: 0.8,
      musicVolume: 0.6,
      sfxVolume: 0.8,
      asmrVolume: 0.8,
      immersive: false,
      adaptiveDirector: true,
      colorblind: 'none',
    });
  });

  it('guardado por defecto', () => {
    const s = defaultSave();
    expect(s.version).toBe(1);
    expect(s.coins).toBe(0);
    expect(s.reputation).toBe(0);
    expect(s.partner).toEqual({ name: 'Sam', pronoun: 'elle' });
    expect(s.unlockedWeek).toBe(0);
    expect(s.completed).toEqual({});
    // Instancias independientes.
    s.owned.push('x');
    expect(defaultSave().owned).toEqual([]);
  });
});

describe('Progression — guardar y cargar', () => {
  it('ida y vuelta', () => {
    const st = memoryStorage();
    const s = { ...defaultSave(), coins: 420, owned: ['fusta-pompon'], equipped: ['fusta-pompon'] };
    s.partner = { name: 'Luz', pronoun: 'ella' };
    persistSave(s, st);
    expect(st.getItem(SAVE_KEY)).toBeTruthy();
    expect(loadSave(st)).toEqual(s);
  });

  it('sin almacenamiento o vacío → por defecto', () => {
    expect(loadSave(null)).toEqual(defaultSave());
    expect(loadSave(memoryStorage())).toEqual(defaultSave());
    expect(loadSave()).toEqual(defaultSave()); // node: no hay localStorage
    expect(() => persistSave(defaultSave(), null)).not.toThrow();
  });

  it('JSON corrupto o de otra versión → por defecto', () => {
    expect(loadSave(memoryStorage({ [SAVE_KEY]: '{no es json' }))).toEqual(defaultSave());
    expect(loadSave(memoryStorage({ [SAVE_KEY]: '"texto"' }))).toEqual(defaultSave());
    expect(loadSave(memoryStorage({ [SAVE_KEY]: '[1,2]' }))).toEqual(defaultSave());
    expect(loadSave(memoryStorage({ [SAVE_KEY]: JSON.stringify({ version: 2, coins: 50 }) }))).toEqual(defaultSave());
  });

  it('campos inválidos se sanean campo a campo', () => {
    const raw = {
      version: 1,
      coins: -50,
      reputation: 9,
      lastRanks: ['S', 'Z', 'A', 3],
      completed: { a: 'A', b: 'Q' },
      owned: ['x', 'x', 5, 'y'],
      equipped: ['y', 'z'],
      settings: { difficulty: 'dios', goreLevel: 500, tremorScale: 0.4, rhythmWindowScale: 3, colorblind: 'protan', tts: 'sí' },
      partner: { name: '   ', pronoun: 'ellx' },
      viralClips: 'muchos',
      unlockedWeek: 99,
      seenIntro: true,
    };
    const s = loadSave(memoryStorage({ [SAVE_KEY]: JSON.stringify(raw) }));
    expect(s.coins).toBe(0);
    expect(s.reputation).toBe(5);
    expect(s.lastRanks).toEqual(['S', 'A']);
    expect(s.completed).toEqual({ a: 'A' });
    expect(s.owned).toEqual(['x', 'y']);
    expect(s.equipped).toEqual(['y']);
    expect(s.settings.difficulty).toBe('especialista');
    expect(s.settings.goreLevel).toBe(100);
    expect(s.settings.tremorScale).toBe(0.4);
    expect(s.settings.rhythmWindowScale).toBe(1);
    expect(s.settings.colorblind).toBe('protan');
    expect(s.settings.tts).toBe(false);
    expect(s.partner).toEqual({ name: 'Sam', pronoun: 'elle' });
    expect(s.viralClips).toBe(0);
    expect(s.unlockedWeek).toBe(8);
    expect(s.seenIntro).toBe(true);
  });

  it('almacenamiento que lanza excepciones no rompe el juego', () => {
    const bad = memoryStorage();
    bad.getItem = () => {
      throw new Error('bloqueado');
    };
    bad.setItem = () => {
      throw new Error('lleno');
    };
    expect(loadSave(bad)).toEqual(defaultSave());
    expect(() => persistSave(defaultSave(), bad)).not.toThrow();
  });
});

describe('Progression — reputación y auditoría', () => {
  it('reputationFrom: media de los últimos 3 + clips virales (máx +0,5)', () => {
    expect(reputationFrom([], 10)).toBe(0);
    expect(reputationFrom(['S'], 0)).toBe(5);
    expect(reputationFrom(['F', 'F', 'S', 'A', 'B'], 0)).toBeCloseTo(4, 6);
    expect(reputationFrom(['C', 'F'], 0)).toBeCloseTo(1.25, 6);
    expect(reputationFrom(['B', 'B', 'B'], 2)).toBeCloseTo(3.2, 6);
    expect(reputationFrom(['B', 'B', 'B'], 50)).toBeCloseTo(3.5, 6);
    expect(reputationFrom(['S', 'S', 'S'], 50)).toBe(5);
  });

  it('applyAudit: monedas, rangos (5), mejor rango, semana y reputación; inmutable', () => {
    const c = makeCase({ id: 'duquesa', week: 1 });
    let s = defaultSave();
    const s0 = s;
    s = applyAudit(s, c, result('B', 250), { viralClips: 1 });
    expect(s0.coins).toBe(0);
    expect(s0.lastRanks).toEqual([]);
    expect(s.coins).toBe(250);
    expect(s.lastRanks).toEqual(['B']);
    expect(s.completed.duquesa).toBe('B');
    expect(s.unlockedWeek).toBe(2);
    expect(s.viralClips).toBe(1);
    expect(s.reputation).toBeCloseTo(3.1, 6);
    s = applyAudit(s, c, result('A', 100), { viralClips: 0 });
    s = applyAudit(s, c, result('C', 10), { viralClips: 0 });
    expect(s.completed.duquesa).toBe('A'); // conserva el mejor
    for (const r of ['F', 'S', 'S'] as Rank[]) s = applyAudit(s, c, result(r, 0), { viralClips: 0 });
    expect(s.lastRanks).toEqual(['A', 'C', 'F', 'S', 'S']);
    expect(s.completed.duquesa).toBe('S');
    // unlockedWeek no retrocede
    s = applyAudit(s, makeCase({ id: 'panchito', week: 0 }), result('B', 0), { viralClips: 0 });
    expect(s.unlockedWeek).toBe(2);
  });
});

describe('Progression — desbloqueos', () => {
  const c0 = makeCase({ id: 'panchito', index: 0, week: 0 });
  const c1 = makeCase({ id: 'duquesa', index: 1, week: 1 });
  const c4 = makeCase({ id: 'chorizo', index: 4, week: 4, requiredReputation: 3 });
  const c3 = makeCase({ id: 'winston', index: 3, week: 3 });

  it('el caso 0 siempre está abierto', () => {
    expect(isCaseUnlocked(defaultSave(), c0)).toBe(true);
  });

  it('requiere el anterior (semana desbloqueada) y la reputación', () => {
    const s = defaultSave();
    expect(isCaseUnlocked(s, c1)).toBe(false);
    const s1 = applyAudit(s, c0, result('C', 0), { viralClips: 0 });
    expect(isCaseUnlocked(s1, c1)).toBe(true);
    const s4 = { ...s1, unlockedWeek: 4, reputation: 2.5 };
    expect(isCaseUnlocked(s4, c4)).toBe(false);
    expect(isCaseUnlocked({ ...s4, reputation: 3 }, c4)).toBe(true);
  });

  it('con la lista de casos comprueba el anterior por id', () => {
    const all = [c0, c1, c3, c4];
    const s = { ...defaultSave(), unlockedWeek: 4, reputation: 4, completed: { panchito: 'A' as Rank } };
    expect(isCaseUnlocked(s, c4, all)).toBe(false); // falta winston
    expect(isCaseUnlocked({ ...s, completed: { ...s.completed, winston: 'B' } }, c4, all)).toBe(true);
    expect(isCaseUnlocked(s, c1, all)).toBe(true);
  });

  it('un caso ya completado sigue abierto aunque baje la reputación', () => {
    const s = { ...defaultSave(), unlockedWeek: 5, reputation: 1, completed: { chorizo: 'B' as Rank } };
    expect(isCaseUnlocked(s, c4)).toBe(true);
  });

  it('Voz Firme y Dulce desde la semana 4', () => {
    expect(firmSweetUnlocked({ ...defaultSave(), unlockedWeek: 3 })).toBe(false);
    expect(firmSweetUnlocked({ ...defaultSave(), unlockedWeek: 4 })).toBe(true);
  });
});

describe('Progression — Boutique', () => {
  it('efectos base y por id equipado', () => {
    expect(computeEffects(defaultSave())).toEqual({
      messageDurationSec: 20,
      noSlip: false,
      extraSlot: false,
      dominaCost: 15,
      handcuffsAutoSuction: false,
      lowConcTremorMult: 1,
      teamMoraleBonus: 0,
    });
    const ids = [
      'gargantilla-estrella',
      'botas-antideslizantes',
      'anillas-oro-rosa',
      'fusta-pompon',
      'esposas-arcoiris',
      'arnes-menta',
      'gorros-corazones',
      'skin-bisturi-gatito',
    ];
    expect(computeEffects({ ...defaultSave(), owned: ids, equipped: ids })).toEqual({
      messageDurationSec: 30,
      noSlip: true,
      extraSlot: true,
      dominaCost: 12,
      handcuffsAutoSuction: true,
      lowConcTremorMult: 0.9,
      teamMoraleBonus: 5,
    });
    // Equipado sin poseer no cuenta.
    expect(computeEffects({ ...defaultSave(), equipped: ['fusta-pompon'] }).dominaCost).toBe(15);
  });

  it('comprar: descuenta, añade y equipa; null si no alcanza o ya lo tiene', () => {
    const item = makeItem('fusta-pompon', 300);
    expect(buyItem({ ...defaultSave(), coins: 299 }, item)).toBeNull();
    const s0 = { ...defaultSave(), coins: 350 };
    const s = buyItem(s0, item)!;
    expect(s.coins).toBe(50);
    expect(s.owned).toEqual(['fusta-pompon']);
    expect(s.equipped).toEqual(['fusta-pompon']);
    expect(s0.owned).toEqual([]);
    expect(buyItem({ ...s, coins: 999 }, item)).toBeNull();
  });

  it('equipar/desequipar solo lo que se posee', () => {
    const s = { ...defaultSave(), owned: ['arnes-menta'], equipped: [] as string[] };
    const on = toggleEquip(s, 'arnes-menta');
    expect(on.equipped).toEqual(['arnes-menta']);
    expect(s.equipped).toEqual([]);
    expect(toggleEquip(on, 'arnes-menta').equipped).toEqual([]);
    expect(toggleEquip(s, 'fusta-pompon').equipped).toEqual([]);
  });
});

describe('Progression — guías', () => {
  it('según dificultad, bandera y semana', () => {
    expect(guideLevelFor(makeCase({ week: 7 }), 'residente')).toBe('full');
    expect(guideLevelFor(makeCase({ week: 0 }), 'jefe')).toBe('none');
    expect(guideLevelFor(makeCase({ week: 1, flags: { noGuides: true } }), 'especialista')).toBe('none');
    expect(guideLevelFor(makeCase({ week: 0 }), 'especialista')).toBe('full');
    expect(guideLevelFor(makeCase({ week: 2 }), 'especialista')).toBe('full');
    expect(guideLevelFor(makeCase({ week: 3 }), 'especialista')).toBe('endpoints');
    expect(guideLevelFor(makeCase({ week: 6 }), 'especialista')).toBe('endpoints');
    expect(guideLevelFor(makeCase({ week: 7 }), 'especialista')).toBe('none');
  });
});
