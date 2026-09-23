import { describe, expect, it } from 'vitest';
import type { CaseDef, PlateParams, Pose2, StepParams, Vec2 } from '../core/contracts';
import { angleDiff, applyPose, applyPosePoly, dist, distToSegment, pointInPolygon } from '../core/math';
import { CASES, getCase } from './cases';
import { CHAOS_KINDS, CHALLENGE_KINDS } from './enums';
import { areaCentroid, isSimplePolygon } from './geometry';

// ───────────────────────────── Utilidades de prueba ─────────────────────────────

const allSteps = (c: CaseDef) => c.phases.flatMap((ph) => ph.steps);
const paramsOf = <T extends StepParams['type']>(c: CaseDef, type: T) =>
  allSteps(c)
    .map((s) => s.params)
    .filter((p): p is Extract<StepParams, { type: T }> => p.type === type);

const fragPoly = (c: CaseDef, id: string, pose: Pose2) => {
  const f = c.anatomy.fragments.find((k) => k.id === id)!;
  return applyPosePoly(f.polygon, pose);
};

/** Polígonos óseos en la configuración final (estáticos + fragmentos en su pose objetivo). */
function finalBone(c: CaseDef): Vec2[][] {
  return [
    ...c.anatomy.boneStatic,
    ...c.anatomy.fragments.filter((f) => !f.noTouch).map((f) => applyPosePoly(f.polygon, f.target ?? f.start)),
  ];
}
const onBone = (c: CaseDef, p: Vec2) => finalBone(c).some((poly) => pointInPolygon(p, poly));

/** Agujeros de tornillo en espacio de herida ('plate' se resuelve con la última placa anterior). */
function resolveScrewHoles(c: CaseDef): Array<{ holes: Vec2[]; depths: number[] }> {
  const out: Array<{ holes: Vec2[]; depths: number[] }> = [];
  let plate: PlateParams | null = null;
  for (const s of allSteps(c)) {
    if (s.params.type === 'plate') plate = s.params;
    if (s.params.type === 'screws') {
      const p = s.params;
      if (p.holes === 'plate') {
        expect(plate, `${c.id}: tornillos 'plate' sin placa previa`).not.toBeNull();
        out.push({ holes: plate!.holes.map((h) => applyPose(h, plate!.target)), depths: p.depthsMm });
      } else out.push({ holes: p.holes, depths: p.depthsMm });
    }
  }
  return out;
}

/** Todos los puntos absolutos del caso (para comprobar límites). */
function absolutePoints(c: CaseDef): Array<{ where: string; p: Vec2 }> {
  const pts: Array<{ where: string; p: Vec2 }> = [];
  const add = (where: string, list: Vec2[]) => list.forEach((p) => pts.push({ where, p }));
  add('window', c.anatomy.window);
  c.anatomy.boneStatic.forEach((b, i) => add(`boneStatic[${i}]`, b));
  if (c.anatomy.cord) add('cord', c.anatomy.cord);
  for (const f of c.anatomy.fragments) {
    add(`${f.id}.start`, applyPosePoly(f.polygon, f.start));
    if (f.target) add(`${f.id}.target`, applyPosePoly(f.polygon, f.target));
  }
  for (const s of allSteps(c)) {
    const p = s.params;
    const w = `${s.id}`;
    switch (p.type) {
      case 'incision':
        add(w, p.path);
        add(w, p.vesselHazards ?? []);
        break;
      case 'hemostasis':
        add(w, p.bleeders.map((b) => b.pos));
        break;
      case 'retract':
        add(w, p.pairs.flatMap((pr) => [pr.a, pr.b]));
        break;
      case 'reduction':
        add(w, p.kwireSpots ?? []);
        break;
      case 'rotate':
        add(w, [p.pivot, ...(p.pinSpot ? [p.pinSpot] : [])]);
        break;
      case 'saw':
        add(w, p.path);
        break;
      case 'burr':
        add(w, [...p.area, ...(p.forbidden ?? [])]);
        break;
      case 'drillPins':
        add(w, p.spots);
        break;
      case 'plate': {
        const hw = p.lengthMm / 2;
        const hh = p.widthMm / 2;
        add(w, applyPosePoly([{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }], p.target));
        add(w, p.holes.map((h) => applyPose(h, p.target)));
        break;
      }
      case 'screws':
        if (p.holes !== 'plate') add(w, p.holes);
        break;
      case 'pick':
        add(w, p.items.map((i) => i.pos));
        add(w, p.forbidden ?? []);
        break;
      case 'clickTargets':
        add(w, p.targets.map((t) => t.pos));
        break;
      case 'suture':
        add(w, p.path);
        break;
      case 'bandage':
        add(w, [p.center]);
        break;
    }
  }
  return pts;
}

/** Elementos profundos que deben caer dentro de la ventana. */
function deepPoints(c: CaseDef): Array<{ where: string; p: Vec2 }> {
  const pts: Array<{ where: string; p: Vec2 }> = [];
  const add = (where: string, list: Vec2[]) => list.forEach((p) => pts.push({ where, p }));
  c.anatomy.boneStatic.forEach((b, i) => add(`boneStatic[${i}]`, b));
  if (c.anatomy.cord) add('cord', c.anatomy.cord);
  for (const f of c.anatomy.fragments) {
    add(`${f.id}.start`, applyPosePoly(f.polygon, f.start));
    if (f.target) add(`${f.id}.target`, applyPosePoly(f.polygon, f.target));
  }
  for (const s of allSteps(c)) {
    const p = s.params;
    switch (p.type) {
      case 'hemostasis':
        add(s.id, p.bleeders.map((b) => b.pos));
        break;
      case 'retract':
        add(s.id, p.pairs.flatMap((pr) => [pr.a, pr.b]));
        break;
      case 'reduction':
        add(s.id, p.kwireSpots ?? []);
        break;
      case 'rotate':
        add(s.id, [p.pivot, ...(p.pinSpot ? [p.pinSpot] : [])]);
        break;
      case 'saw':
        add(s.id, p.path);
        break;
      case 'burr':
        add(s.id, p.area);
        break;
      case 'drillPins':
        add(s.id, p.spots);
        break;
      case 'plate':
        add(s.id, p.holes.map((h) => applyPose(h, p.target)));
        break;
      case 'screws':
        if (p.holes !== 'plate') add(s.id, p.holes);
        break;
      case 'pick':
        add(s.id, p.items.map((i) => i.pos));
        break;
      case 'clickTargets':
        add(s.id, p.targets.map((t) => t.pos));
        break;
    }
  }
  return pts;
}

// ───────────────────────────── Estructura de la campaña ─────────────────────────────

describe('CASES — campaña', () => {
  it('tiene 8 casos con index y semana 0..7 únicos y en orden', () => {
    expect(CASES).toHaveLength(8);
    CASES.forEach((c, i) => {
      expect(c.index).toBe(i);
      expect(c.week).toBe(i);
    });
    expect(new Set(CASES.map((c) => c.id)).size).toBe(8);
  });

  it('getCase devuelve cada caso y lanza con ids desconocidos', () => {
    for (const c of CASES) expect(getCase(c.id)).toBe(c);
    expect(() => getCase('no-existe')).toThrow();
  });

  it('respeta pacientes, dueños, tarifas, dificultad y reputación del GDD', () => {
    const table: Array<[string, string, string, number, number, number]> = [
      ['Panchito', 'braulio', 'Don Braulio', 100, 1, 0],
      ['Duquesa', 'ownerA', 'Marisol, vecina de Gigi', 250, 2, 0],
      ['Merengue', 'hortensia', 'Doña Hortensia', 250, 2, 0],
      ['Sir Winston', 'ownerB', 'Lord Pardo', 400, 3, 1],
      ['Chorizo', 'rodrigo', 'Rodrigo', 600, 4, 3],
      ['Tanque', 'ownerC', 'Yeni, entrenadora de canicross', 600, 4, 3],
      ['Copito', 'ownerA', 'Profesor Anselmo', 600, 4, 3],
      ['Rayo', 'valerio', 'Dr. Valerio Sterling', 900, 5, 3],
    ];
    CASES.forEach((c, i) => {
      const [name, human, owner, fee, diff, rep] = table[i];
      expect(c.patient.name).toBe(name);
      expect(c.owner.human).toBe(human);
      expect(c.owner.name).toBe(owner);
      expect(c.feeHC).toBe(fee);
      expect(c.difficulty).toBe(diff);
      expect(c.requiredReputation).toBe(rep);
    });
    expect(CASES.map((c) => c.targetTimeSec)).toEqual([420, 540, 480, 600, 600, 660, 540, 780]);
    expect(CASES.map((c) => c.patient.weightKg)).toEqual([2.1, 4, 3.5, 24, 7, 32, 1.3, 19]);
  });

  it('especie y modelo 3D son coherentes', () => {
    for (const c of CASES) {
      if (c.patient.animal === 'cat') expect(c.patient.species).toBe('cat');
      else if (c.patient.animal === 'rabbit') expect(c.patient.species).toBe('rabbit');
      else expect(c.patient.species).toBe('dog');
    }
  });

  it('solo el caso 0 es tutorial y solo el 7 es el final', () => {
    expect(CASES.filter((c) => c.flags.tutorial).map((c) => c.index)).toEqual([0]);
    expect(CASES.filter((c) => c.flags.final).map((c) => c.index)).toEqual([7]);
  });

  it('banderas especiales de cada caso', () => {
    expect(getCase('panchito').flags.fritzNoTremor).toBe(true);
    expect(getCase('sir-winston').flags.gigiSelfieBoost).toBe(true);
    expect(getCase('chorizo').flags.rodrigoNoSolos).toBe(true);
    const copito = getCase('copito');
    expect(copito.flags.microMode && copito.flags.hypothermia).toBe(true);
    expect(copito.anatomy.closed).toBe(true);
    const rayo = getCase('rayo');
    expect(rayo.flags.noGuides && rayo.flags.valerioInRoom).toBe(true);
    expect(CASES.filter((c) => c.anatomy.closed).map((c) => c.id)).toEqual(['copito']);
  });

  it('caos: válido, sin repetir; nada en el tutorial y todo en el final', () => {
    for (const c of CASES) {
      expect(new Set(c.chaos).size).toBe(c.chaos.length);
      for (const k of c.chaos) expect(CHAOS_KINDS).toContain(k);
      if (c.flags.rodrigoNoSolos) expect(c.chaos).not.toContain('rodrigoSolo');
    }
    expect(getCase('panchito').chaos).toEqual([]);
    expect([...getCase('rayo').chaos].sort()).toEqual([...CHAOS_KINDS].sort());
  });
});

// ───────────────────────────── Fases y pasos ─────────────────────────────

describe.each(CASES.map((c) => [c.id, c] as const))('caso %s', (_id, c) => {
  it('los pesos de las fases suman exactamente 100 y cada fase tiene pasos', () => {
    expect(c.phases.reduce((s, ph) => s + ph.weight, 0)).toBe(100);
    for (const ph of c.phases) {
      expect(ph.weight).toBeGreaterThan(0);
      expect(ph.steps.length).toBeGreaterThanOrEqual(1);
      expect(ph.steps.length).toBeLessThanOrEqual(4);
      expect(ph.label.length).toBeGreaterThan(0);
    }
  });

  it('ids de fases y pasos únicos, etiquetas no vacías', () => {
    expect(new Set(c.phases.map((p) => p.id)).size).toBe(c.phases.length);
    const steps = allSteps(c);
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    for (const s of steps) expect(s.label.trim().length).toBeGreaterThan(0);
  });

  it('toda la geometría absoluta cae dentro de 0..160 × 0..100', () => {
    for (const { where, p } of absolutePoints(c)) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y), where).toBe(true);
      expect(p.x >= 0 && p.x <= 160 && p.y >= 0 && p.y <= 100, `${where} (${p.x}, ${p.y})`).toBe(true);
    }
  });

  it('todo lo profundo cae dentro de la ventana', () => {
    for (const { where, p } of deepPoints(c)) {
      expect(pointInPolygon(p, c.anatomy.window), `${where} (${p.x}, ${p.y}) fuera de la ventana`).toBe(true);
    }
  });

  it('la ventana mide 26–34 mm de alto y la incisión es casi horizontal por el centro', () => {
    const ys = c.anatomy.window.map((p) => p.y);
    const h = Math.max(...ys) - Math.min(...ys);
    expect(h).toBeGreaterThanOrEqual(26);
    expect(h).toBeLessThanOrEqual(34);
    for (const inc of paramsOf(c, 'incision')) {
      for (const p of inc.path) expect(Math.abs(p.y - 50)).toBeLessThan(5);
      expect(inc.path[inc.path.length - 1].x - inc.path[0].x).toBeGreaterThan(60);
      expect(inc.layers.map((l) => l.layer)).toEqual(['skin', 'subcut', 'fascia']);
      for (const l of inc.layers) expect(l.targetPressure >= 1 && l.targetPressure <= 5).toBe(true);
    }
  });

  it('polígonos simples y fragmentos centrados en su origen', () => {
    const polys = [c.anatomy.window, ...c.anatomy.boneStatic, ...(c.anatomy.cord ? [c.anatomy.cord] : [])];
    for (const poly of polys) {
      expect(poly.length).toBeGreaterThanOrEqual(3);
      expect(isSimplePolygon(poly)).toBe(true);
    }
    for (const f of c.anatomy.fragments) {
      expect(isSimplePolygon(f.polygon), f.id).toBe(true);
      const cen = areaCentroid(f.polygon);
      expect(Math.hypot(cen.x, cen.y), `${f.id} descentrado`).toBeLessThan(1);
    }
    for (const b of paramsOf(c, 'burr')) expect(isSimplePolygon(b.area)).toBe(true);
  });

  it('las referencias a fragmentos existen y son coherentes', () => {
    const ids = new Set(c.anatomy.fragments.map((f) => f.id));
    expect(ids.size).toBe(c.anatomy.fragments.length);
    const frag = (id: string) => c.anatomy.fragments.find((f) => f.id === id)!;
    for (const r of paramsOf(c, 'reduction')) {
      expect(r.fragmentIds.length).toBeGreaterThan(0);
      for (const id of r.fragmentIds) {
        expect(ids.has(id), id).toBe(true);
        expect(frag(id).target, `${id} sin objetivo`).toBeDefined();
        expect(frag(id).noTouch).toBeFalsy();
      }
      for (const id of r.avoidIds ?? []) {
        expect(ids.has(id), id).toBe(true);
        expect(frag(id).noTouch).toBe(true);
      }
      expect(r.carmShots).toBeGreaterThanOrEqual(1);
    }
    const released = new Set<string>();
    for (const s of allSteps(c)) {
      const p = s.params;
      if (p.type === 'saw') {
        for (const id of p.releases ?? []) {
          expect(ids.has(id), id).toBe(true);
          expect(frag(id).locked).toBe(true);
          released.add(id);
        }
      }
      // Un fragmento bloqueado solo se mueve o retira después de que una sierra lo libere.
      const moved =
        p.type === 'reduction' ? p.fragmentIds : p.type === 'rotate' ? [p.fragmentId] : p.type === 'pick' ? (p.removeFragmentIds ?? []) : [];
      for (const id of moved) {
        expect(ids.has(id), id).toBe(true);
        if (frag(id).locked) expect(released.has(id), `${id} se usa antes de liberarse`).toBe(true);
      }
    }
    // Todo fragmento bloqueado se libera en algún momento.
    for (const f of c.anatomy.fragments) if (f.locked) expect(released.has(f.id), f.id).toBe(true);
  });

  it('las fracturas empiezan desplazadas (5–15 mm, 8–25°) y el resto en su sitio', () => {
    for (const r of paramsOf(c, 'reduction')) {
      if (r.mode !== 'reduce') continue;
      for (const id of r.fragmentIds) {
        const f = c.anatomy.fragments.find((k) => k.id === id)!;
        const d = dist(f.start.pos, f.target!.pos);
        const a = Math.abs(angleDiff(f.start.angleDeg, f.target!.angleDeg));
        expect(d, `${id} desplazamiento`).toBeGreaterThanOrEqual(5);
        expect(d).toBeLessThanOrEqual(15);
        expect(a, `${id} giro`).toBeGreaterThanOrEqual(8);
        expect(a).toBeLessThanOrEqual(25);
      }
    }
    for (const f of c.anatomy.fragments) {
      if (f.noTouch) {
        expect(f.target ? dist(f.start.pos, f.target.pos) : 0).toBe(0);
      }
    }
  });

  it('placas: opción correcta existe, agujeros = opción, dentro de la placa y sobre hueso', () => {
    for (const p of paramsOf(c, 'plate')) {
      expect(new Set(p.options.map((o) => o.id)).size).toBe(p.options.length);
      expect(p.options.length).toBeGreaterThanOrEqual(3);
      const correct = p.options.find((o) => o.id === p.correctId);
      expect(correct).toBeDefined();
      expect(correct!.holes).toBe(p.holes.length);
      expect(correct!.lengthMm).toBe(p.lengthMm);
      expect(p.bendsRequired).toBeGreaterThanOrEqual(1);
      expect(p.bendsRequired).toBeLessThanOrEqual(3);
      for (const h of p.holes) {
        expect(Math.abs(h.x)).toBeLessThanOrEqual(p.lengthMm / 2);
        expect(Math.abs(h.y)).toBeLessThanOrEqual(p.widthMm / 2 + 0.01);
      }
      for (const h of p.holes) {
        const w = applyPose(h, p.target);
        // En el puente de Duquesa los agujeros centrales quedan sobre las esquirlas: se permite.
        if (c.id !== 'duquesa') expect(onBone(c, w), `agujero (${w.x.toFixed(1)}, ${w.y.toFixed(1)}) fuera del hueso`).toBe(true);
      }
    }
  });

  it('tornillos: una profundidad por agujero, sobre hueso y con longitud disponible', () => {
    for (const s of paramsOf(c, 'screws')) {
      expect(s.torqueWindow[0]).toBeGreaterThan(0);
      expect(s.torqueWindow[0]).toBeLessThan(s.torqueWindow[1]);
      expect(s.torqueWindow[1]).toBeLessThanOrEqual(1);
      expect(s.lengthOptionsMm).toHaveLength(3);
      expect([...s.lengthOptionsMm].sort((a, b) => a - b)).toEqual(s.lengthOptionsMm);
    }
    for (const { holes, depths } of resolveScrewHoles(c)) {
      expect(depths.length).toBe(holes.length);
      for (const h of holes) expect(onBone(c, h), `tornillo (${h.x}, ${h.y}) fuera del hueso`).toBe(true);
    }
    const lengthOpts = paramsOf(c, 'screws').map((s) => s.lengthOptionsMm);
    paramsOf(c, 'screws').forEach((s, i) => {
      for (const d of s.depthsMm) {
        expect(d).toBeGreaterThan(0);
        expect(Math.max(...lengthOpts[i])).toBeGreaterThanOrEqual(d);
      }
    });
  });

  it('agujas, clavos y abrazaderas caen sobre hueso', () => {
    for (const d of paramsOf(c, 'drillPins')) {
      expect(d.spots.length).toBeGreaterThan(0);
      for (const sp of d.spots) expect(onBone(c, sp), `(${sp.x}, ${sp.y})`).toBe(true);
      expect(d.cortexProfileMm.every((v) => v > 0)).toBe(true);
    }
    for (const r of paramsOf(c, 'reduction')) for (const k of r.kwireSpots ?? []) expect(onBone(c, k)).toBe(true);
    for (const r of paramsOf(c, 'rotate')) if (r.pinSpot) expect(onBone(c, r.pinSpot)).toBe(true);
  });

  it('parámetros de pasos en rango', () => {
    for (const h of paramsOf(c, 'hemostasis')) {
      expect(h.bleeders.length).toBeGreaterThanOrEqual(2);
      expect(h.targetFieldPct).toBeGreaterThan(0);
      expect(h.targetFieldPct).toBeLessThan(70);
    }
    for (const r of paramsOf(c, 'retract')) {
      expect(r.pairs.length).toBeGreaterThan(0);
      expect(r.idealClicks).toBeLessThan(r.maxClicks);
    }
    for (const b of paramsOf(c, 'burr')) {
      expect(b.requiredPct > 0 && b.requiredPct <= 1).toBe(true);
      expect(b.brushMm).toBeGreaterThan(0);
      expect(b.label.length).toBeGreaterThan(0);
    }
    for (const s of paramsOf(c, 'saw')) expect(s.path.length).toBeGreaterThanOrEqual(2);
    for (const s of paramsOf(c, 'suture')) {
      expect(s.layers.length).toBeGreaterThan(0);
      expect(s.spacingMm).toBeGreaterThan(0);
    }
    for (const b of paramsOf(c, 'bandage')) expect(b.turns).toBeGreaterThanOrEqual(2);
    for (const k of paramsOf(c, 'clickTargets')) {
      expect(k.targets.length).toBeGreaterThan(0);
      for (const t of k.targets) expect(t.label.length).toBeGreaterThan(0);
    }
    for (const p of paramsOf(c, 'pick')) {
      expect(p.items.length + (p.removeFragmentIds?.length ?? 0)).toBeGreaterThan(0);
      expect(new Set(p.items.map((i) => i.id)).size).toBe(p.items.length);
    }
  });

  it('clínica: diagnóstico, pruebas, radiografía y explicaciones', () => {
    const k = c.clinic;
    expect(k.diagnosisOptions).toHaveLength(3);
    expect(k.correctDiagnosis >= 0 && k.correctDiagnosis < 3).toBe(true);
    expect(new Set(k.diagnosisOptions).size).toBe(3);
    expect(k.tests).toContain(k.keyTest);
    for (const t of k.requiredTests ?? []) expect(k.tests).toContain(t);
    expect(k.xrayLesion.u > 0 && k.xrayLesion.u < 1 && k.xrayLesion.v > 0 && k.xrayLesion.v < 1).toBe(true);
    expect(k.xrayLesion.radius > 0 && k.xrayLesion.radius < 0.3).toBe(true);
    for (const e of [k.explanations.absurd, k.explanations.technical, k.explanations.evasive]) expect(e.length).toBeGreaterThan(30);
    expect(k.complaint.length).toBeGreaterThan(20);
    expect(k.minorCases).toBeGreaterThanOrEqual(1);
    expect(k.minorCases).toBeLessThanOrEqual(3);
  });

  it('retos de Valerio, ficha educativa y textos de briefing', () => {
    expect(c.valerioChallenges).toHaveLength(2);
    expect(new Set(c.valerioChallenges.map((v) => v.kind)).size).toBe(2);
    for (const v of c.valerioChallenges) {
      expect(CHALLENGE_KINDS).toContain(v.kind);
      expect(v.text.length).toBeGreaterThan(10);
      expect(v.text.length).toBeLessThanOrEqual(90);
    }
    expect(c.education.facts.length).toBeGreaterThanOrEqual(2);
    expect(c.education.disclaimer).toBe('Datos aproximados, pendientes de revisión por un veterinario ortopedista.');
    expect(c.intro.length >= 3 && c.intro.length <= 5).toBe(true);
    expect(c.outro.length >= 3 && c.outro.length <= 5).toBe(true);
    for (const t of [...c.intro, ...c.outro, c.newMechanic, c.diagnosis, c.procedure, c.patient.breed, c.patient.ageText]) {
      expect(t.trim().length).toBeGreaterThan(0);
    }
    expect(c.newMechanic.length).toBeLessThanOrEqual(130);
  });
});

// ───────────────────────────── Casos concretos ─────────────────────────────

describe('casos concretos', () => {
  it('Chorizo: médula definida, prohibida en fresa y pinzas, y la ventana de fresado a ~1 mm', () => {
    const c = getCase('chorizo');
    const cord = c.anatomy.cord!;
    expect(cord).toBeDefined();
    const burr = paramsOf(c, 'burr')[0];
    expect(burr.forbidden).toBe(cord);
    expect(burr.requiredPct).toBe(0.9);
    expect(burr.brushMm).toBe(2.5);
    // Todo el área se puede fresar sin acercar el puntero a menos de un radio de fresa de la
    // médula (BurrStep marca falta con el puntero a ≤ brushMm), pero sin margen de sobra:
    // el hueso retirado llega a ~1 mm de la médula.
    let minGap = Infinity;
    for (const p of burr.area) {
      expect(pointInPolygon(p, cord)).toBe(false);
      for (let i = 0; i < cord.length; i++) minGap = Math.min(minGap, distToSegment(p, cord[i], cord[(i + 1) % cord.length]));
    }
    expect(minGap).toBeGreaterThan(burr.brushMm);
    expect(minGap).toBeLessThan(burr.brushMm + 1);
    const pick = paramsOf(c, 'pick')[0];
    expect(pick.items).toHaveLength(4);
    expect(pick.forbidden).toBe(cord);
    expect(pick.tool).toBe('forceps');
    for (const it of pick.items) {
      expect(pointInPolygon(it.pos, burr.area), it.id).toBe(true);
      // PickStep avisa a ≤ 1 mm de la médula: cada pieza se puede agarrar sin rozarla.
      for (let i = 0; i < cord.length; i++) expect(distToSegment(it.pos, cord[i], cord[(i + 1) % cord.length])).toBeGreaterThan(it.radiusMm + 1);
    }
    expect(c.anatomy.boneStatic.length).toBeGreaterThanOrEqual(2);
  });

  it('Tanque: la rotación de la meseta es coherente con degPerUnit y el pivote', () => {
    const c = getCase('tanque');
    const r = paramsOf(c, 'rotate')[0];
    const f = c.anatomy.fragments.find((k) => k.id === r.fragmentId)!;
    expect(r.startValue).toBe(28);
    expect(r.targetValue).toBe(5);
    expect(r.tolValue).toBe(1);
    expect(r.degPerUnit).toBe(1);
    // Convención de RotateStep: valor = inicial − giro / degPerUnit ⇒ giro = (inicial − objetivo) × degPerUnit.
    expect(f.target!.angleDeg - f.start.angleDeg).toBeCloseTo((r.startValue - r.targetValue) * r.degPerUnit, 6);
    // El pivote no se mueve: su distancia al origen del fragmento se conserva.
    expect(dist(f.start.pos, r.pivot)).toBeCloseTo(dist(f.target!.pos, r.pivot), 1);
    const saw = paramsOf(c, 'saw')[0];
    expect(saw.kind).toBe('biradial');
    for (const p of saw.path) expect(dist(p, r.pivot)).toBeCloseTo(15, 1);
    // La pendiente de la meseta (borde craneal → caudal) queda casi perpendicular al eje tras girar.
    const start = fragPoly(c, f.id, f.start);
    const end = fragPoly(c, f.id, f.target!);
    // Márgenes craneal (arriba) y caudal (abajo) de la meseta: los vértices más a la izquierda
    // por encima y por debajo del pivote. La recta que los une forma ~28° con la perpendicular
    // al eje antes de girar y ~5° después.
    const margins = (poly: Vec2[]) => {
      const pick = (above: boolean) =>
        poly.filter((p) => (above ? p.y < r.pivot.y - 4 : p.y > r.pivot.y + 4)).reduce((a, b) => (b.x < a.x ? b : a));
      return [pick(true), pick(false)] as const;
    };
    const slope = (poly: Vec2[]) => {
      const [cr, ca] = margins(poly);
      return (Math.atan2(ca.x - cr.x, ca.y - cr.y) * 180) / Math.PI; // 0 = perpendicular al eje
    };
    // En la pose final se miden los mismos vértices (índices) que al inicio.
    const [cr0, ca0] = margins(start);
    const endSlope = (Math.atan2(end[start.indexOf(ca0)].x - end[start.indexOf(cr0)].x, end[start.indexOf(ca0)].y - end[start.indexOf(cr0)].y) * 180) / Math.PI;
    expect(slope(start)).toBeGreaterThan(20);
    expect(slope(start)).toBeLessThan(36);
    expect(Math.abs(endSlope)).toBeLessThan(12);
  });

  it('Duquesa: placa en puente de 8 con tornillos solo en los extremos', () => {
    const c = getCase('duquesa');
    const plate = paramsOf(c, 'plate')[0];
    expect(plate.holes).toHaveLength(8);
    const screws = paramsOf(c, 'screws')[0];
    const holes = screws.holes as Vec2[];
    expect(holes).toHaveLength(4);
    const world = plate.holes.map((h) => applyPose(h, plate.target));
    for (const i of [0, 1, 6, 7]) expect(holes.some((h) => dist(h, world[i]) < 0.01)).toBe(true);
    expect(paramsOf(c, 'drillPins')[0].item).toBe('rod');
    expect(c.clinic.requiredTests).toEqual(['thoracicXray']);
    expect(c.anatomy.fragments.filter((f) => f.noTouch)).toHaveLength(3);
  });

  it('Merengue: la sierra libera la cabeza femoral, que luego se extrae y se alisa el borde', () => {
    const c = getCase('merengue');
    expect(paramsOf(c, 'saw')[0].releases).toEqual(['femoralHead']);
    expect(paramsOf(c, 'saw')[0].irrigationRequired).toBe(true);
    expect(paramsOf(c, 'pick')[0].removeFragmentIds).toEqual(['femoralHead']);
    const rasp = paramsOf(c, 'burr')[0];
    expect(rasp.instrument).toBe('rasp');
    expect(paramsOf(c, 'clickTargets')[0].targets.map((t) => t.label)).toEqual(['Cápsula articular', 'Ligamento redondo']);
    expect(paramsOf(c, 'plate')).toHaveLength(0);
  });

  it('Sir Winston: bloque troclear más hondo y tuberosidad transpuesta', () => {
    const c = getCase('sir-winston');
    const block = c.anatomy.fragments.find((f) => f.id === 'trochlearBlock')!;
    expect(block.target!.pos.y).toBeGreaterThan(block.start.pos.y + 1.5);
    const saws = paramsOf(c, 'saw');
    expect(saws.map((s) => s.kind)).toEqual(['fine', 'fine', 'fine']);
    expect(saws[1].releases).toEqual(['trochlearBlock']);
    expect(saws[2].releases).toEqual(['tibialTuberosity']);
    expect(paramsOf(c, 'reduction').every((r) => r.mode === 'place')).toBe(true);
    expect(paramsOf(c, 'drillPins')[0].spots).toHaveLength(2);
    const wire = paramsOf(c, 'clickTargets')[0];
    expect(wire.decal).toBe('wire');
    expect(wire.targets).toHaveLength(2);
  });

  it('Copito: cerrado, sin incisión; 4 agujas finas (2 por fragmento) y abrazaderas sobre ellas', () => {
    const c = getCase('copito');
    expect(paramsOf(c, 'incision')).toHaveLength(0);
    const red = paramsOf(c, 'reduction')[0];
    expect(red.carmShots).toBe(4);
    const pins = paramsOf(c, 'drillPins')[0];
    expect(pins.spots).toHaveLength(4);
    expect(pins.fragile).toBe(true);
    expect(pins.item).toBe('pin');
    const distal = fragPoly(c, 'distalTibia', c.anatomy.fragments[0].target!);
    expect(pins.spots.filter((p) => pointInPolygon(p, distal))).toHaveLength(2);
    expect(pins.spots.filter((p) => pointInPolygon(p, c.anatomy.boneStatic[0]))).toHaveLength(2);
    const clamps = paramsOf(c, 'clickTargets')[0];
    expect(clamps.decal).toBe('clamp');
    expect(clamps.targets.map((t) => t.pos)).toEqual(pins.spots);
    expect(paramsOf(c, 'bandage')[0].turns).toBe(3);
  });

  it('Rayo: 3 injertos a las 3 articulaciones, placa híbrida de 9 y 6 tornillos', () => {
    const c = getCase('rayo');
    const grafts = c.anatomy.fragments.filter((f) => f.kind === 'graft');
    expect(grafts).toHaveLength(3);
    const place = paramsOf(c, 'reduction')[0];
    expect(place.mode).toBe('place');
    expect([...place.fragmentIds].sort()).toEqual(grafts.map((g) => g.id).sort());
    expect(place.tolMm).toBe(3);
    expect(place.tolDeg).toBe(15);
    const plate = paramsOf(c, 'plate')[0];
    expect(plate.hybrid).toBe(true);
    expect(plate.holes).toHaveLength(9);
    expect((paramsOf(c, 'screws')[0].holes as Vec2[]).length).toBe(6);
    const burr = paramsOf(c, 'burr')[0];
    expect(burr.requiredPct).toBe(0.85);
    // Cada injerto termina dentro del área desbridada.
    for (const g of grafts) expect(pointInPolygon(g.target!.pos, burr.area), g.id).toBe(true);
  });

  it('Panchito: tutorial con la miniplaca de 4 agujeros como opción correcta', () => {
    const c = getCase('panchito');
    const plate = paramsOf(c, 'plate')[0];
    expect(plate.correctId).toBe('mini4');
    expect(plate.bendsRequired).toBe(2);
    const screws = paramsOf(c, 'screws')[0];
    expect(screws.holes).toBe('plate');
    expect(screws.lengthOptionsMm).toEqual([6, 8, 10]);
    expect(screws.torqueWindow).toEqual([0.75, 0.92]);
    for (const d of screws.depthsMm) expect(d >= 5 && d <= 7).toBe(true);
    expect(paramsOf(c, 'bandage')[0].turns).toBe(2);
  });
});
