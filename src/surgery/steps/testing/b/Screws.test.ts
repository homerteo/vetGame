// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ScrewsStep, SCREW_DROP_HC, SPARE_WAIT_SEC, idealLength, judgeLength } from '../../Screws';
import { createFakeContext, type FakeHarness } from './fakeContext';
import { DEMO_PLATE_HOLES, screwsScenario } from './scenarios';
import type { ScrewsParams } from '../../../../core/contracts';

const DT = 1 / 60;

function setup(holes: 'plate' | 'two' = 'two', tutorial = false, depths?: number[]) {
  const sc = screwsScenario();
  const p = sc.def.params as ScrewsParams;
  if (holes === 'two') {
    p.holes = [
      { x: 70, y: 50 },
      { x: 90, y: 50 },
    ];
    p.depthsMm = depths ?? [7.4, 8.2];
  }
  const h = createFakeContext({ anatomy: sc.anatomy, tutorial });
  h.bone.implants.plate = {
    optionId: 'p6',
    pose: { pos: { x: 79, y: 50 }, angleDeg: 0 },
    holesLocal: DEMO_PLATE_HOLES,
    lengthMm: 42,
    widthMm: 7,
    bend: 1,
  };
  const step = new ScrewsStep(sc.def);
  step.begin(h.ctx);
  const layer = h.hud.minigameLayer();
  return { h, step, layer, p };
}

/** Segundos hasta la llegada del anillo: primer pulso con ≥ 1,5 s de margen (110 bpm). */
function leadFor(h: FakeHarness) {
  const period = 60 / 110;
  let t = period - (h.beat.time % period);
  while (t < 1.5) t += period;
  return t;
}

/** Avanza hasta la llegada del anillo y atrapa con Espacio. */
function catchOnBeat(h: FakeHarness, step: ScrewsStep) {
  h.run(step, Math.round(leadFor(h) / DT) * DT);
  step.onKey('Space', true);
  step.onKey('Space', false);
}

/** Deja pasar el anillo sin pulsar (dos veces: Fritz insiste una) hasta que se cae. */
function letItDrop(h: FakeHarness, step: ScrewsStep) {
  for (let i = 0; i < 600 && step.state().phase === 'catch'; i++) h.run(step, DT);
}

function drillPilot(h: FakeHarness, step: ScrewsStep, at: { x: number; y: number }) {
  h.instrument = 'drill';
  step.onPointerDown(h.ptr(at.x, at.y));
  for (let i = 0; i < 1200 && step.state().phase === 'pilot'; i++) {
    h.run(step, DT);
    if (step.hint().includes('¡Salida!')) {
      h.run(step, 0.1);
      step.onPointerUp(h.ptr(at.x, at.y, { buttons: 0 }));
    }
  }
}

/** Piloto + elección de longitud: deja el paso en 'catch' con Fritz ofreciendo el tornillo. */
function drillAndMeasure(h: FakeHarness, step: ScrewsStep, at: { x: number; y: number }, digit = 'Digit2') {
  drillPilot(h, step, at);
  step.onKey(digit, true);
}

describe('ScrewsStep', () => {
  it('flujo completo: piloto, medir, atrapar a tempo, apretar; caída con tornillo contaminado y rosca pasada', () => {
    const { h, step, layer } = setup();
    expect(step.checklist()[0].label).toBe('Tornillos (0/2)');
    // Siempre se perfora primero: aún no hay tornillo en juego.
    expect(step.state().phase).toBe('pilot');
    expect(h.selected.at(-1)).toBe('drill');
    expect(layer.querySelector('.sc-root')).toBeNull();
    expect(h.crewCalls.fritz).toEqual([]);
    expect(step.gauges().map((g) => g.label)).toEqual(['Profundidad', 'Temperatura']);

    // ── Tornillo 1 ──
    drillPilot(h, step, { x: 70, y: 50 });
    expect(step.state().phase).toBe('measure');
    // Agujero hecho: se cambia solo al tornillo.
    expect(h.selected.at(-1)).toBe('screwdriver');
    expect(layer.querySelector('.sb-measure-val')!.textContent).toContain('7,4');
    // 8 mm es la ideal para 7,4.
    expect(step.onKey('Digit2', true)).toBe(true);
    expect(h.hud.pops.at(-1)!.text).toBe('¡Medida exacta!');
    // Con la medida, Fritz trae ese tornillo.
    expect(step.state().phase).toBe('catch');
    expect(h.crewCalls.fritz).toEqual(['present:screw']);
    expect(layer.querySelector('.sc-root')).not.toBeNull();
    catchOnBeat(h, step);
    expect(h.crewCalls.fritz).toContain('caught:perfect');
    expect(h.events.find((e) => e.type === 'screw:caught')!.payload).toEqual({ quality: 'perfect' });
    expect(step.state().phase).toBe('tighten');
    expect(h.selected.at(-1)).toBe('screwdriver');
    h.run(step, 0.8);
    expect(layer.querySelector('.sc-root')).toBeNull();
    h.instrument = 'screwdriver';
    step.onPointerDown(h.ptr(70, 50));
    h.run(step, 1.1);
    expect(step.state().torque).toBeGreaterThan(0.72);
    expect(h.audio.count('screwThread')).toBeGreaterThan(5);
    step.onPointerUp(h.ptr(70, 50, { buttons: 0 }));
    expect(h.audio.count('torqueClick')).toBe(1);
    expect(h.bone.implants.screws[0]).toEqual({ pos: { x: 70, y: 50 }, lengthMm: 8, contaminated: false, stripped: false });
    expect(h.log.gestures().at(-1)!.label).toBe('Tornillo 1/2');
    expect(h.log.gestures().at(-1)!.quality).toBeGreaterThan(0.9);
    expect(step.checklist()[0].label).toBe('Tornillos (1/2)');

    // ── Tornillo 2: piloto, medida y se cae ──
    expect(step.state().phase).toBe('pilot');
    expect(h.selected.at(-1)).toBe('drill');
    drillPilot(h, step, { x: 90, y: 50 });
    // 10 mm es la ideal para 8,2.
    step.onKey('Digit3', true);
    expect(h.hud.pops.at(-1)!.text).toBe('¡Medida exacta!');
    expect(step.state().phase).toBe('catch');
    // Sin pulsar: el anillo llega con ≥ 1,5 s de margen y Fritz insiste una vez.
    h.run(step, 1.5);
    expect(step.state().phase).toBe('catch');
    letItDrop(h, step);
    expect(step.state().phase).toBe('dropped');
    expect(h.log.faultCount('screwDropped')).toBe(1);
    expect(h.costs).toEqual([{ hc: SCREW_DROP_HC, reason: 'Tornillo caído' }]);
    expect(h.events.some((e) => e.type === 'screw:dropped')).toBe(true);
    expect(h.crewCalls.fritz).toContain('dropped');
    expect(h.audio.count('screwDrop')).toBe(1);
    expect(h.audio.count('contaminated')).toBe(1);
    expect(h.says.some((s) => s.speaker === 'fritz')).toBe(true);
    h.run(step, 0.8);
    expect(layer.querySelector('.sb-drop')).not.toBeNull();
    expect(step.hint().length).toBeLessThanOrEqual(90);
    // [U] usar el del suelo: directo a atornillar (el agujero ya está hecho).
    expect(step.onKey('KeyU', true)).toBe(true);
    expect(step.state().contaminated).toBe(true);
    expect(step.state().phase).toBe('tighten');
    h.instrument = 'screwdriver';
    step.onPointerDown(h.ptr(90, 50));
    h.run(step, 1.6);
    expect(h.log.faultCount('strippedScrew')).toBe(1);
    expect(h.bone.implants.screws[1]).toEqual({ pos: { x: 90, y: 50 }, lengthMm: 10, contaminated: true, stripped: true });
    expect(h.log.faultCount('contaminatedImplant')).toBe(1);
    expect(step.isComplete()).toBe(true);
    expect(step.progress()).toBe(1);
    step.end();
    expect(layer.children).toHaveLength(0);
    expect(h.audio.activeLoops()).toHaveLength(0);
  });

  it('esperar repuesto (Espacio) tarda 5 s y vuelve a ofrecer tornillo estéril', () => {
    const { h, step, layer } = setup();
    drillAndMeasure(h, step, { x: 70, y: 50 });
    letItDrop(h, step);
    expect(step.state().phase).toBe('dropped');
    h.run(step, 0.8);
    step.onKey('Space', true);
    expect(step.state().phase).toBe('waitSpare');
    expect(layer.querySelector('.sb-wait')!.textContent).toBe('5 s');
    h.run(step, SPARE_WAIT_SEC - 0.2);
    expect(step.state().phase).toBe('waitSpare');
    h.run(step, 0.3);
    expect(step.state().phase).toBe('catch');
    expect(step.state().contaminated).toBe(false);
    expect(layer.querySelector('.sc-root')).not.toBeNull();
    expect(h.crewCalls.fritz.filter((c) => c === 'present:screw')).toHaveLength(2);
  });

  it('clic izquierdo también atrapa; soltar antes de tiempo deja el tornillo flojo', () => {
    const { h, step } = setup();
    drillPilot(h, step, { x: 70, y: 50 });
    step.onKey('Digit1', true); // 6 mm < 7,4 → no muerde
    expect(h.hud.pops.at(-1)!.text).toBe('No muerde la segunda cortical');
    h.run(step, Math.round(leadFor(h) / DT) * DT - 0.1);
    step.onPointerDown(h.ptr(10, 10));
    expect(h.crewCalls.fritz).toContain('caught:good');
    expect(step.state().phase).toBe('tighten');
    step.onPointerDown(h.ptr(70, 50));
    h.run(step, 0.3);
    step.onPointerUp(h.ptr(70, 50, { buttons: 0 }));
    expect(h.hud.pops.map((x) => x.text)).toContain('Flojo');
    expect(h.log.gestures().at(-1)!.quality).toBeLessThan(0.7);
    // Tornillo puesto: vuelta automática al taladro para el siguiente agujero.
    expect(h.selected.at(-1)).toBe('drill');
    expect(h.hud.pops.at(-1)!.text).toBe('Agujero 2/2: ¡a taladrar!');
  });

  it('Espacio justo tras la caída (antes del panel) ya pide repuesto; el rebote inmediato no', () => {
    const { h, step, layer } = setup();
    drillAndMeasure(h, step, { x: 70, y: 50 });
    letItDrop(h, step);
    expect(step.state().phase).toBe('dropped');
    // Rebote del intento de atrapar: se ignora.
    step.onKey('Space', true);
    step.onKey('Space', false);
    expect(step.state().phase).toBe('dropped');
    h.run(step, 0.25);
    expect(layer.querySelector('.sb-drop')).toBeNull();
    step.onKey('Space', true);
    expect(step.state().phase).toBe('waitSpare');
    expect(layer.querySelector('.sb-spare')).not.toBeNull();
    // El panel de elección ya no aparece al acabar la animación.
    h.run(step, 1);
    expect(layer.querySelector('.sb-drop')).toBeNull();
    expect(layer.querySelector('.sc-root')).toBeNull();
    expect(step.state().phase).toBe('waitSpare');
  });

  it('U durante la animación de caída usa el tornillo del suelo', () => {
    const { h, step, layer } = setup();
    drillAndMeasure(h, step, { x: 70, y: 50 });
    letItDrop(h, step);
    h.run(step, 0.3);
    expect(step.onKey('KeyU', true)).toBe(true);
    expect(step.state().phase).toBe('tighten');
    expect(step.state().contaminated).toBe(true);
    h.run(step, 1);
    expect(layer.querySelector('.sb-drop')).toBeNull();
  });

  it('en el tutorial Fritz espera: sin pulsar no se cae nunca', () => {
    const { h, step } = setup('two', true);
    drillAndMeasure(h, step, { x: 70, y: 50 });
    h.run(step, 12);
    expect(step.state().phase).toBe('catch');
    expect(h.log.faultCount('screwDropped')).toBe(0);
  });

  it('piloto: perfil de cortical fino; mantener a presión 3 hasta la salida no necrosa y avisa si calienta', () => {
    const { h, step } = setup('two', false, [29, 29]);
    expect(step.state().phase).toBe('pilot');
    h.instrument = 'drill';
    step.onPointerDown(h.ptr(70, 50, { pressure: 3 }));
    let peak = 0;
    let hotHint = false;
    for (let i = 0; i < 3000 && step.state().phase === 'pilot'; i++) {
      h.run(step, DT);
      const heat = step.gauges().find((g) => g.id === 'heat');
      if (heat) peak = Math.max(peak, heat.value);
      if (step.hint().includes('Broca caliente')) hotHint = true;
      if (step.hint().includes('¡Salida!')) {
        h.run(step, 0.1);
        step.onPointerUp(h.ptr(70, 50, { buttons: 0 }));
      }
    }
    expect(step.state().phase).toBe('measure');
    expect(h.log.faultCount('thermalNecrosis')).toBe(0);
    expect(peak).toBeGreaterThan(44);
    expect(peak).toBeLessThan(47.5);
    expect(hotHint).toBe(true);
  });

  it('piloto a presión 5 sí sobrecalienta (necrosis) en un tornillo largo', () => {
    const { h, step } = setup('two', false, [25, 25]);
    h.instrument = 'drill';
    step.onPointerDown(h.ptr(70, 50, { pressure: 5 }));
    for (let i = 0; i < 3000 && step.state().phase === 'pilot'; i++) {
      h.run(step, DT);
      if (step.hint().includes('¡Salida!')) step.onPointerUp(h.ptr(70, 50, { buttons: 0 }));
    }
    expect(h.log.faultCount('thermalNecrosis')).toBe(1);
  });

  it('con holes "plate" usa los agujeros de la placa', () => {
    const { step } = setup('plate');
    expect(step.state().total).toBe(6);
  });

  it('longitud ideal y veredictos', () => {
    expect(idealLength(7.4, [10, 6, 8])).toBe(8);
    expect(idealLength(12, [6, 8, 10])).toBe(10);
    expect(judgeLength(8, 7.4, [6, 8, 10]).quality).toBe(1);
    expect(judgeLength(6, 7.4, [6, 8, 10]).text).toBe('No muerde la segunda cortical');
    expect(judgeLength(12, 7.4, [6, 8, 10, 12]).text).toBe('Sobresale');
    expect(judgeLength(10, 8.2, [6, 8, 10, 12]).quality).toBe(1);
    expect(judgeLength(10, 7.4, [6, 8, 10]).text).toBe('Sobresale');
    expect(judgeLength(9, 7.4, [6, 8, 9]).text).toBe('Un pelín largo');
  });
});
