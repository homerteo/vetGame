import { describe, expect, it } from 'vitest';
import { BOUTIQUE_ITEMS } from './boutique';
import { DIALOGUE } from './dialogue';
import { ASSISTANT_IDS, CHAOS_KINDS, COMMAND_TONES, FAULT_KINDS, INSTRUMENT_IDS, RANKS, STEP_TYPES } from './enums';
import { INSTRUMENTS } from './instruments';
import { CASES } from './cases';

// ───────────────────────────── Instrumental ─────────────────────────────

describe('INSTRUMENTS', () => {
  it('cubre cada InstrumentId con nombre, etiqueta corta y descripción', () => {
    expect(Object.keys(INSTRUMENTS).sort()).toEqual([...INSTRUMENT_IDS].sort());
    for (const id of INSTRUMENT_IDS) {
      const info = INSTRUMENTS[id];
      expect(info.id).toBe(id);
      expect(info.name.length).toBeGreaterThan(2);
      expect(info.short.length).toBeGreaterThan(0);
      expect([...info.short].length).toBeLessThanOrEqual(10);
      expect(info.description.length).toBeGreaterThan(20);
    }
    expect(new Set(Object.values(INSTRUMENTS).map((i) => i.short)).size).toBe(INSTRUMENT_IDS.length);
  });
});

// ───────────────────────────── Boutique ─────────────────────────────

describe('BOUTIQUE_ITEMS', () => {
  it('tiene exactamente los ids y precios del GDD §5', () => {
    const expected: Record<string, number> = {
      'gargantilla-estrella': 150,
      'botas-antideslizantes': 200,
      'anillas-oro-rosa': 250,
      'fusta-pompon': 300,
      'esposas-arcoiris': 350,
      'arnes-menta': 400,
      'skin-bisturi-gatito': 120,
      'skin-taladro-conejo': 200,
      'gorros-corazones': 180,
    };
    expect(BOUTIQUE_ITEMS.map((i) => i.id).sort()).toEqual(Object.keys(expected).sort());
    for (const it of BOUTIQUE_ITEMS) expect(it.priceHC).toBe(expected[it.id]);
  });

  it('textos, categorías y colores pastel válidos', () => {
    for (const it of BOUTIQUE_ITEMS) {
      expect(it.name.length).toBeGreaterThan(5);
      expect(it.description.length).toBeGreaterThan(20);
      expect(it.effectText.length).toBeGreaterThan(3);
      expect(['accesorio', 'instrumental', 'equipo']).toContain(it.category);
      expect(it.color).toMatch(/^#[0-9a-f]{6}$/i);
      // Pastel: todos los canales altos.
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(it.color.slice(i, i + 2), 16));
      expect(Math.min(r, g, b)).toBeGreaterThan(0xa0);
    }
    const byId = Object.fromEntries(BOUTIQUE_ITEMS.map((i) => [i.id, i]));
    expect(byId['skin-bisturi-gatito'].effectText).toBe('Cosmético');
    expect(byId['skin-taladro-conejo'].effectText).toBe('Cosmético');
    expect(byId['fusta-pompon'].effectText).toContain('12');
    expect(byId['gargantilla-estrella'].effectText).toContain('30 s');
    expect(byId['esposas-arcoiris'].effectText).toContain('H');
  });
});

// ───────────────────────────── Diálogo ─────────────────────────────

/** Recorre todas las listas de frases del banco con su ruta. */
function allLists(): Array<{ path: string; lines: string[] }> {
  const out: Array<{ path: string; lines: string[] }> = [];
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) out.push({ path, lines: v as string[] });
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
  };
  const { tutorialHints, ...rest } = DIALOGUE;
  walk(rest, '');
  return out;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

describe('DIALOGUE', () => {
  it('todas las listas tienen al menos 4 frases no vacías y sin duplicados', () => {
    const lists = allLists();
    expect(lists.length).toBeGreaterThan(50);
    for (const { path, lines } of lists) {
      expect(lines.length, path).toBeGreaterThanOrEqual(path.startsWith('valerio.fault') ? 3 : 4);
      for (const l of lines) expect(l.trim().length, path).toBeGreaterThan(0);
      expect(new Set(lines).size, `${path} repetida`).toBe(lines.length);
    }
  });

  it('frases cortas: ≤ 90 caracteres', () => {
    for (const { path, lines } of allLists()) for (const l of lines) expect([...l].length, `${path}: ${l}`).toBeLessThanOrEqual(90);
  });

  it('órdenes y respuestas: todas las claves y 8+ variantes', () => {
    for (const a of ASSISTANT_IDS) {
      for (const t of COMMAND_TONES) {
        expect(DIALOGUE.commands[a][t].length, `${a}.${t}`).toBeGreaterThanOrEqual(8);
        expect(DIALOGUE.replies[a][t].length, `${a}.${t}`).toBeGreaterThanOrEqual(8);
      }
      expect(DIALOGUE.replies[a].ignored.length).toBeGreaterThanOrEqual(8);
    }
  });

  it('la Orden de Dómina lleva chasquido y un "perdón" susurrado', () => {
    for (const a of ASSISTANT_IDS) {
      for (const l of DIALOGUE.commands[a].domina) {
        expect(l).toContain('¡CHAS!');
        expect(norm(l)).toMatch(/perdon/);
      }
    }
  });

  it('caos: todas las interferencias con hablante correcto y 8+ frases de inicio', () => {
    const speakers: Record<string, string> = {
      rodrigoSolo: 'rodrigo',
      gigiSelfie: 'gigi',
      fritzTremorSpike: 'fritz',
      panchitoIntrusion: 'panchito',
      valerioGaze: 'valerio',
      braulioFoil: 'braulio',
      hortensiaCall: 'hortensia',
    };
    expect(Object.keys(DIALOGUE.chaos).sort()).toEqual([...CHAOS_KINDS].sort());
    for (const k of CHAOS_KINDS) {
      expect(DIALOGUE.chaos[k].speaker).toBe(speakers[k]);
      expect(DIALOGUE.chaos[k].start.length).toBeGreaterThanOrEqual(8);
      expect(DIALOGUE.chaos[k].end.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('Valerio: faltas (3+ por tipo), auditoría (4+ por rango), componentes y respeto final', () => {
    expect(Object.keys(DIALOGUE.valerio.fault).sort()).toEqual([...FAULT_KINDS].sort());
    for (const f of FAULT_KINDS) expect(DIALOGUE.valerio.fault[f].length, f).toBeGreaterThanOrEqual(3);
    expect(Object.keys(DIALOGUE.valerio.audit).sort()).toEqual([...RANKS].sort());
    for (const r of RANKS) expect(DIALOGUE.valerio.audit[r].length, r).toBeGreaterThanOrEqual(4);
    for (const k of ['T', 'E', 'H', 'S', 'L', 't'] as const) expect(DIALOGUE.valerio.component[k].length).toBeGreaterThanOrEqual(4);
    expect(DIALOGUE.valerio.gaze.length).toBeGreaterThanOrEqual(8);
    expect(DIALOGUE.valerio.praise.length).toBeGreaterThanOrEqual(8);
    expect(DIALOGUE.valerio.finalRespect).toBe('Buen trabajo, doctora.');
    // Valerio usa latín (al menos unas cuantas frases).
    const latin = /(primum|tempus|ars longa|errare|nulla dies|ignis|vis maior|magna cum laude|aurea|festina|ne quid)/i;
    const valerioLines = allLists()
      .filter((l) => l.path.startsWith('valerio') || l.path === 'chaos.valerioGaze.start')
      .flatMap((l) => l.lines);
    expect(valerioLines.filter((l) => latin.test(l)).length).toBeGreaterThanOrEqual(5);
  });

  it('"Buena niña/chica" solo aparece en los mensajes de la pareja', () => {
    const re = /buena (nina|chica)/;
    for (const { path, lines } of allLists()) {
      if (path === 'partnerMessages') continue;
      for (const l of lines) expect(re.test(norm(l)), `${path}: ${l}`).toBe(false);
    }
    for (const c of CASES) {
      for (const t of [...c.intro, ...c.outro, ...c.valerioChallenges.map((v) => v.text)]) expect(re.test(norm(t)), t).toBe(false);
    }
    expect(re.test(norm(DIALOGUE.valerio.finalRespect))).toBe(false);
  });

  it('mensajes de la pareja: 12+, cariñosos, con "Buena niña/chica" y {nombre}, sin nada degradante', () => {
    const msgs = DIALOGUE.partnerMessages;
    expect(msgs.length).toBeGreaterThanOrEqual(12);
    expect(msgs.filter((m) => /buena (nina|chica)/.test(norm(m))).length).toBeGreaterThanOrEqual(6);
    expect(msgs.filter((m) => m.includes('{nombre}')).length).toBeGreaterThanOrEqual(10);
    const blacklist = [
      'perra',
      'zorra',
      'puta',
      'estupida',
      'tonta',
      'idiota',
      'inutil',
      'gorda',
      'fea',
      'esclava',
      'sumisa',
      'castigo',
      'obedece',
      'sexy',
      'desnuda',
      'cama',
      'nalga',
      'culo',
      'mala nina',
      'basura',
    ];
    for (const m of msgs) {
      const words = norm(m);
      for (const bad of blacklist) expect(new RegExp(`\\b${bad}\\b`).test(words), `"${bad}" en: ${m}`).toBe(false);
      // Solo se admite el marcador {nombre}.
      expect(m.replace(/\{nombre\}/g, '')).not.toMatch(/[{}]/);
    }
  });

  it('pistas del tutorial para cada tipo de paso (≤ 90 caracteres: caben en la pista del HUD) y mencionan las teclas', () => {
    for (const t of STEP_TYPES) {
      const h = DIALOGUE.tutorialHints[t];
      expect(h, t).toBeDefined();
      expect(h!.length).toBeGreaterThan(20);
      expect([...h!].length, `${t}: ${h}`).toBeLessThanOrEqual(90);
    }
    const all = Object.values(DIALOGUE.tutorialHints).join(' ');
    for (const key of ['Rueda', 'Q/E', ' I ', ' R ', 'Espacio', '1-3', 'Z ', 'X ', 'C:', 'F ', 'B ', ' L', 'Shift']) {
      expect(all.includes(key) || all.toLowerCase().includes(key.toLowerCase()), key).toBe(true);
    }
  });

  it('los dueños tienen las tres voces y la RCP no insinúa muertes', () => {
    for (const o of ['hortensia', 'braulio', 'generic'] as const) {
      for (const k of ['waiting', 'calm', 'upset'] as const) expect(DIALOGUE.owners[o][k].length).toBeGreaterThanOrEqual(4);
    }
    for (const l of [...DIALOGUE.cpr.fail, ...DIALOGUE.valerio.takeover, ...DIALOGUE.valerio.audit.F]) {
      expect(norm(l)).not.toMatch(/\b(muri|muerto|muerte|fallecio)/);
    }
  });
});
