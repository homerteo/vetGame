// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { PlateStep, WRONG_PLATE_HC } from '../../Plate';
import { createFakeContext } from './fakeContext';
import { plateScenario } from './scenarios';

const DT = 1 / 60;

function setup(tutorial = false) {
  const sc = plateScenario();
  const h = createFakeContext({ anatomy: sc.anatomy, tutorial });
  const step = new PlateStep(sc.def);
  step.begin(h.ctx);
  h.instrument = 'plate';
  const layer = h.hud.minigameLayer();
  /** Espera a que el corazón esté dentro (o fuera) de la zona y pulsa Espacio. */
  const bend = (hit: boolean) => {
    for (let i = 0; i < 600; i++) {
      const b = step.bendState();
      const inside = Math.abs(b.needle - b.zoneCenter) <= b.zoneWidth / 2 - 0.01;
      const far = Math.abs(b.needle - b.zoneCenter) > b.zoneWidth;
      if ((hit && inside) || (!hit && far)) break;
      h.run(step, DT);
    }
    step.onKey('Space', true);
    step.onKey('Space', false);
    h.run(step, 0.2);
  };
  return { h, step, layer, bend, sc };
}

describe('PlateStep', () => {
  it('elegir: tarjetas DOM; la equivocada cuesta 60 HC y falta; la correcta la trae Fritz', () => {
    const { h, step, layer } = setup();
    const cards = layer.querySelectorAll('.sb-card');
    expect(cards).toHaveLength(3);
    expect(layer.textContent).toContain('Fritz trae tres placas');
    expect(step.hint().length).toBeLessThanOrEqual(90);
    // Tecla 1 = placa corta (incorrecta).
    expect(step.onKey('Digit1', true)).toBe(true);
    expect(h.log.faultCount('wrongPlate')).toBe(1);
    expect(h.costs).toEqual([{ hc: WRONG_PLATE_HC, reason: 'Placa desperdiciada' }]);
    expect(cards[0].classList.contains('sb-wasted')).toBe(true);
    expect(cards[0].textContent).toContain('DESPERDICIADA');
    // Repetir la misma no cuenta dos veces.
    step.onKey('Digit1', true);
    expect(h.log.faultCount('wrongPlate')).toBe(1);
    // Clic en la correcta.
    cards[1].dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(h.crewCalls.fritz).toEqual(['present:plate']);
    expect(step.currentPhase()).toBe('choose');
    h.run(step, 0.5);
    expect(step.currentPhase()).toBe('contour');
    expect(layer.querySelector('.sb-gauge')).not.toBeNull();
    expect(step.checklist()[0].done).toBe(true);
  });

  it('contornear: aciertos en la zona verde (Espacio), fallos bajan la calidad', () => {
    const { h, step, bend } = setup();
    step.onKey('Digit2', true);
    h.run(step, 0.5);
    bend(true);
    expect(step.bendState().bends).toBe(1);
    expect(h.audio.count('bendPlate')).toBe(1);
    bend(false);
    expect(step.bendState().misses).toBe(1);
    bend(true);
    bend(true);
    expect(step.currentPhase()).toBe('position');
    const g = h.log.gestures().find((x) => x.label === 'Contorneado de placa')!;
    expect(g.quality).toBeCloseTo(0.85, 5);
    expect(h.hud.layerEl!.querySelector('.sb-panel')).toBeNull();
  });

  it('posicionar: desalineada no se asienta; alineada con Q/E se ajusta y se coloca', () => {
    const { h, step, bend, sc } = setup();
    step.onKey('Digit2', true);
    h.run(step, 0.5);
    for (let i = 0; i < 3; i++) bend(true);
    expect(step.currentPhase()).toBe('position');
    const target = (sc.def.params as { target: { pos: { x: number; y: number }; angleDeg: number } }).target;
    step.onPointerMove(h.ptr(target.pos.x + 8, target.pos.y, { buttons: 0 }));
    step.onPointerDown(h.ptr(target.pos.x + 8, target.pos.y));
    expect(h.bone.implants.plate).toBeNull();
    expect(h.hud.pops.at(-1)!.text).toMatch(/Desalineada/);
    // Girar hasta el ángulo objetivo.
    const diff = target.angleDeg - step.previewPose().angleDeg;
    const key = diff > 0 ? 'KeyE' : 'KeyQ';
    step.onKey(key, true);
    h.run(step, Math.abs(diff) / 45);
    step.onKey(key, false);
    expect(Math.abs(step.previewPose().angleDeg - target.angleDeg)).toBeLessThan(2);
    step.onPointerMove(h.ptr(target.pos.x + 0.5, target.pos.y, { buttons: 0 }));
    step.onPointerDown(h.ptr(target.pos.x + 0.5, target.pos.y));
    const plate = h.bone.implants.plate!;
    expect(plate.optionId).toBe('p6');
    expect(plate.pose).toEqual(target);
    expect(plate.holesLocal).toHaveLength(6);
    expect(plate.bend).toBe(1);
    expect(h.audio.count('plateSet')).toBe(1);
    expect(step.isComplete()).toBe(true);
    expect(h.bone.plateHolesWorld()[0]).toEqual({ x: target.pos.x - 17.5, y: target.pos.y });
    step.end();
    expect(h.hud.layerEl!.children).toHaveLength(0);
    expect(h.wound.overlays.size).toBe(0);
  });

  it('el tutorial ensancha la zona verde ×1,5', () => {
    const a = setup(false);
    const b = setup(true);
    expect(b.step.bendState().zoneWidth).toBeCloseTo(a.step.bendState().zoneWidth * 1.5);
  });
});
