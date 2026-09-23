import { describe, expect, it } from 'vitest';
import { baselineHr, createVitals, EBV_ML_PER_KG } from './Vitals';
import type { VitalsAPI } from '../core/contracts';

const calm = { bleedPctPerSec: 0, fieldLevelPct: 0, warming: false };
function run(v: VitalsAPI, seconds: number, inputs = calm, dt = 1 / 30) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) v.update(dt, inputs);
}

describe('Vitals', () => {
  it('usa los volúmenes sanguíneos por especie', () => {
    expect(EBV_ML_PER_KG).toEqual({ dog: 85, cat: 60, rabbit: 60 });
  });

  it('FC basal por especie y tamaño', () => {
    expect(baselineHr('dog', 2.1)).toBeCloseTo(120, 0);
    expect(baselineHr('dog', 32)).toBeCloseTo(90, 0);
    expect(baselineHr('dog', 19)).toBeGreaterThan(90);
    expect(baselineHr('dog', 19)).toBeLessThan(120);
    expect(baselineHr('cat', 4)).toBe(160);
    expect(baselineHr('rabbit', 1.3)).toBe(200);
  });

  it('arranca estable con constantes normales', () => {
    const v = createVitals({ species: 'dog', weightKg: 24, startExito: 60, hypothermiaRisk: false });
    const s = v.snapshot();
    expect(s.spo2).toBeCloseTo(98, 0);
    expect(s.map).toBe(80);
    expect(s.etco2).toBe(40);
    expect(s.tempC).toBeCloseTo(38.3, 1);
    expect(s.bloodVolumePct).toBe(100);
    expect(s.bloodLostPct).toBe(0);
    expect(s.alarms).toEqual([]);
    expect(s.rhythm).toBe('sinus');
    expect(s.exito).toBe(60);
  });

  it('conejo a 39 °C', () => {
    const v = createVitals({ species: 'rabbit', weightKg: 1.3, startExito: 60, hypothermiaRisk: false });
    expect(v.snapshot().tempC).toBe(39);
  });

  it('Éxito sube +0,1/s estable y se detiene en 90', () => {
    const v = createVitals({ species: 'dog', weightKg: 10, startExito: 60, hypothermiaRisk: false });
    run(v, 10);
    expect(v.snapshot().exito).toBeCloseTo(61, 1);
    run(v, 400);
    expect(v.snapshot().exito).toBe(90);
  });

  it('los gestos pueden superar 90, la regeneración no lo baja', () => {
    const v = createVitals({ species: 'dog', weightKg: 10, startExito: 89, hypothermiaRisk: false });
    v.applyExito(8, 'gesto');
    expect(v.snapshot().exito).toBe(97);
    run(v, 5);
    expect(v.snapshot().exito).toBe(97);
  });

  it('applyExito limita a 0..100', () => {
    const v = createVitals({ species: 'dog', weightKg: 10, startExito: 50, hypothermiaRisk: false });
    v.applyExito(500, 'x');
    expect(v.snapshot().exito).toBe(100);
    v.applyExito(-500, 'x');
    expect(v.snapshot().exito).toBe(0);
    v.applyExito(NaN, 'x');
    expect(v.snapshot().exito).toBe(0);
  });

  it('pérdida > 15 %BV produce taquicardia compensatoria', () => {
    const v = createVitals({ species: 'dog', weightKg: 20, startExito: 60, hypothermiaRisk: false });
    const base = v.snapshot().hr;
    run(v, 10, { ...calm, bleedPctPerSec: 2.2 }); // 22 %
    run(v, 15);
    const s = v.snapshot();
    expect(s.bloodLostPct).toBeCloseTo(22, 0);
    expect(s.hr).toBeGreaterThan(base * 1.1);
    expect(s.map).toBeGreaterThanOrEqual(60);
  });

  it('pérdida > 30 %BV: PAM < 60 y caída rápida del Éxito', () => {
    const v = createVitals({ species: 'dog', weightKg: 20, startExito: 70, hypothermiaRisk: false });
    run(v, 7, { ...calm, bleedPctPerSec: 5 }); // 35 %
    const before = v.snapshot().exito;
    run(v, 10);
    const s = v.snapshot();
    expect(s.map).toBeLessThan(60);
    expect(s.alarms).toContain('map');
    expect(before - s.exito).toBeGreaterThanOrEqual(10); // ≥ 1/s
    expect(before - s.exito).toBeLessThanOrEqual(20.5); // ≤ 2/s
  });

  it('la dificultad escala la caída (Jefe > Especialista > Residente)', () => {
    const drop = (difficulty: 'residente' | 'especialista' | 'jefe') => {
      const v = createVitals({ species: 'dog', weightKg: 20, startExito: 80, hypothermiaRisk: false }, { difficulty });
      run(v, 8, { ...calm, bleedPctPerSec: 5 });
      const a = v.snapshot().exito;
      run(v, 10);
      return a - v.snapshot().exito;
    };
    const r = drop('residente');
    const e = drop('especialista');
    const j = drop('jefe');
    expect(r).toBeLessThan(e);
    expect(j).toBeGreaterThan(e);
    expect(j / e).toBeCloseTo(1.2, 1);
    expect(r / e).toBeCloseTo(0.7, 1);
  });

  it('campo inundado (> 70 %) frena la recuperación sin tocar constantes', () => {
    const v = createVitals({ species: 'dog', weightKg: 20, startExito: 60, hypothermiaRisk: false });
    run(v, 10, { ...calm, fieldLevelPct: 85 });
    const s = v.snapshot();
    expect(s.exito).toBeLessThan(60);
    expect(s.exito).toBeGreaterThan(57);
    expect(s.alarms).toEqual([]);
  });

  it('hipotermia: −0,02 °C/s con riesgo, alarma < 36,5, manta +0,03 °C/s hasta la basal', () => {
    const v = createVitals({ species: 'rabbit', weightKg: 1.3, startExito: 60, hypothermiaRisk: true });
    run(v, 50);
    expect(v.snapshot().tempC).toBeCloseTo(38, 1);
    run(v, 80); // 39 − 2,6 = 36,4
    expect(v.snapshot().tempC).toBeLessThan(36.5);
    expect(v.snapshot().alarms).toContain('temp');
    run(v, 30, { ...calm, warming: true }); // +0,9
    expect(v.snapshot().tempC).toBeCloseTo(37.3, 1);
    run(v, 200, { ...calm, warming: true });
    expect(v.snapshot().tempC).toBe(39);
  });

  it('sin riesgo de hipotermia la temperatura no baja', () => {
    const v = createVitals({ species: 'dog', weightKg: 30, startExito: 60, hypothermiaRisk: false });
    run(v, 100);
    expect(v.snapshot().tempC).toBeCloseTo(38.3, 1);
  });

  it('paro: FV, FC 0, PAM ~15, asistolia a los 20 s y reanimación al 25 %', () => {
    const v = createVitals({ species: 'dog', weightKg: 20, startExito: 5, hypothermiaRisk: false });
    v.triggerArrest();
    let s = v.snapshot();
    expect(s.arrest).toBe(true);
    expect(s.rhythm).toBe('vfib');
    expect(s.hr).toBe(0);
    expect(s.exito).toBe(0);
    run(v, 5);
    s = v.snapshot();
    expect(s.map).toBeLessThan(20);
    expect(s.alarms).toEqual(expect.arrayContaining(['hr', 'map']));
    v.applyExito(20, 'ignorado en paro');
    expect(v.snapshot().exito).toBe(0);
    run(v, 16);
    expect(v.snapshot().rhythm).toBe('asystole');
    v.resolveArrest(true);
    s = v.snapshot();
    expect(s.arrest).toBe(false);
    expect(s.rhythm).toBe('sinus');
    expect(s.exito).toBe(25);
    expect(s.hr).toBeGreaterThan(60);
  });

  it('reanimación fallida: nadie muere, el paro termina', () => {
    const v = createVitals({ species: 'cat', weightKg: 4, startExito: 0, hypothermiaRisk: false });
    v.triggerArrest();
    v.resolveArrest(false);
    const s = v.snapshot();
    expect(s.arrest).toBe(false);
    expect(s.exito).toBeGreaterThan(0);
  });

  it('transfusión repone volumen (sin borrar la pérdida acumulada)', () => {
    const v = createVitals({ species: 'dog', weightKg: 10, startExito: 60, hypothermiaRisk: false });
    run(v, 10, { ...calm, bleedPctPerSec: 2 });
    v.transfuse(15);
    const s = v.snapshot();
    expect(s.bloodVolumePct).toBeCloseTo(95, 0);
    expect(s.bloodLostPct).toBeCloseTo(20, 0);
    v.transfuse(50);
    expect(v.snapshot().bloodVolumePct).toBe(100);
  });

  it('historial de Éxito a 1 Hz', () => {
    const v = createVitals({ species: 'dog', weightKg: 10, startExito: 60, hypothermiaRisk: false });
    run(v, 5.5, calm, 0.05);
    const h = v.exitoHistory();
    expect(h.length).toBe(5);
    expect(h[0]).toBeCloseTo(60.1, 2);
    h.push(1); // copia defensiva
    expect(v.exitoHistory().length).toBe(5);
  });

  it('ignora dt ≤ 0 y sangrado negativo', () => {
    const v = createVitals({ species: 'dog', weightKg: 10, startExito: 60, hypothermiaRisk: false });
    v.update(0, calm);
    v.update(-1, calm);
    v.update(1, { ...calm, bleedPctPerSec: -5 });
    expect(v.snapshot().bloodLostPct).toBe(0);
  });
});
