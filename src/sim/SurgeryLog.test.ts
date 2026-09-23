import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/EventBus';
import type { FaultKind, GameEvents } from '../core/contracts';
import { createSurgeryLog, FAULT_EXITO, FAULT_LABEL, perfectBonus } from './SurgeryLog';

function setup() {
  const deltas: Array<[number, string]> = [];
  const bus = new EventBus<GameEvents>();
  const events: string[] = [];
  bus.on('gesture', (g) => events.push(`gesture:${g.label}:${g.perfect}`));
  bus.on('fault', (f) => events.push(`fault:${f.kind}:${f.detail ?? ''}`));
  bus.on('bonus', (b) => events.push(`bonus:${b.label}:${b.exitoDelta}`));
  const log = createSurgeryLog((d, r) => deltas.push([d, r]), bus);
  return { log, deltas, events };
}

describe('SurgeryLog', () => {
  it('penalizaciones del GDD exactas y las menores negativas', () => {
    expect(FAULT_EXITO.vesselCut).toBe(-5);
    expect(FAULT_EXITO.thermalNecrosis).toBe(-8);
    expect(FAULT_EXITO.plunge).toBe(-10);
    expect(FAULT_EXITO.contaminatedImplant).toBe(-10);
    expect(FAULT_EXITO.iatrogenicFissure).toBe(-12);
    for (const k of Object.keys(FAULT_EXITO) as FaultKind[]) {
      expect(FAULT_EXITO[k]).toBeLessThan(0);
      expect(FAULT_LABEL[k].length).toBeGreaterThan(3);
    }
    expect(Object.keys(FAULT_LABEL).sort()).toEqual(Object.keys(FAULT_EXITO).sort());
  });

  it('bonus de gesto perfecto de +1 a +3', () => {
    expect(perfectBonus(0.9)).toBe(1);
    expect(perfectBonus(0.95)).toBe(2);
    expect(perfectBonus(1)).toBe(3);
  });

  it('gesture: perfecto suma Éxito, normal no; emite en el bus y guarda tiempo', () => {
    const { log, deltas, events } = setup();
    log.setTime(12.5);
    log.gesture('Incisión de piel', 0.95);
    log.setTime(20);
    log.gesture('Sutura', 0.6);
    log.gesture('Raro', 7);
    expect(deltas).toEqual([
      [2, '¡Perfecto! Incisión de piel'],
      [3, '¡Perfecto! Raro'],
    ]);
    const g = log.gestures();
    expect(g[0]).toEqual({ t: 12.5, label: 'Incisión de piel', quality: 0.95, perfect: true });
    expect(g[1]).toMatchObject({ t: 20, perfect: false, quality: 0.6 });
    expect(g[2].quality).toBe(1);
    expect(events).toEqual(['gesture:Incisión de piel:true', 'gesture:Sutura:false', 'gesture:Raro:true']);
  });

  it('fault: aplica la penalización, registra el tipo y emite', () => {
    const { log, deltas, events } = setup();
    log.setTime(3);
    log.fault('plunge', 'segunda cortical');
    log.fault('char');
    expect(deltas).toEqual([
      [-10, FAULT_LABEL.plunge],
      [-3, FAULT_LABEL.char],
    ]);
    expect(log.faults()).toEqual(['plunge', 'char']);
    expect(events).toEqual(['fault:plunge:segunda cortical', 'fault:char:']);
    const r = log.records();
    expect(r[0]).toMatchObject({ t: 3, kind: 'fault', value: -10 });
    expect(r[0].label).toContain('segunda cortical');
  });

  it('multiplicador de faltas (mirada de Valerio)', () => {
    const { log, deltas } = setup();
    log.setFaultMultiplier(2);
    log.fault('vesselCut');
    log.setFaultMultiplier(0);
    log.fault('vesselCut');
    expect(deltas.map((d) => d[0])).toEqual([-10, -5]);
  });

  it('bonus y note', () => {
    const { log, deltas, events } = setup();
    log.bonus('Hemorragia arterial controlada', 4);
    log.note('fase', { id: 'f1' });
    expect(deltas).toEqual([[4, 'Hemorragia arterial controlada']]);
    expect(events).toEqual(['bonus:Hemorragia arterial controlada:4']);
    const r = log.records();
    expect(r.map((x) => x.kind)).toEqual(['bonus', 'note']);
    expect(r[1].data).toEqual({ id: 'f1' });
  });

  it('funciona sin bus y devuelve copias', () => {
    const deltas: number[] = [];
    const log = createSurgeryLog((d) => deltas.push(d));
    log.gesture('x', 1);
    log.fault('offPath');
    log.records().push({ t: 0, kind: 'note', label: 'intruso' });
    log.faults().push('plunge');
    expect(log.records().length).toBe(2);
    expect(log.faults()).toEqual(['offPath']);
    expect(deltas).toEqual([3, -2]);
  });
});
