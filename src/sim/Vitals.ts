import type { Difficulty, Species, VitalsAPI, VitalsInit, VitalsSnapshot } from '../core/contracts';
import { clamp, lerp } from '../core/math';

/**
 * Modelo fisiológico simplificado del paciente anestesiado.
 * Internamente trabaja en mL; la API expone %BV (volumen sanguíneo estimado).
 *
 * Afinado:
 *  - Pérdida ≤ 15 %BV: compensada (PAM baja un poco).
 *  - 15–30 %BV: taquicardia compensatoria (+2 % de FC por punto), PAM hasta 60.
 *  - > 30 %BV: PAM < 60, SpO₂ y EtCO₂ caen, el Éxito cae rápido.
 *  - Campo > 70 % (inundado): no altera constantes, pero frena la recuperación y resta 0,2/s.
 */

export const EBV_ML_PER_KG: Record<Species, number> = { dog: 85, cat: 60, rabbit: 60 };
export const BASE_TEMP_C: Record<Species, number> = { dog: 38.3, cat: 38.3, rabbit: 39 };

/** Multiplicador de la caída de Éxito por dificultad. */
export const DIFFICULTY_SEVERITY: Record<Difficulty, number> = { residente: 0.7, especialista: 1, jefe: 1.2 };

/** Rangos normales (fuera de ellos: alarma). */
export const RANGES = {
  hrLowFactor: 0.6,
  hrHighFactor: 1.35,
  spo2Low: 94,
  mapLow: 60,
  mapHigh: 120,
  etco2Low: 30,
  etco2High: 50,
  tempLow: 36.5,
  tempHigh: 40,
} as const;

const EXITO_REGEN_PER_SEC = 0.1;
const EXITO_REGEN_CAP = 90;
const FLOOD_DRAIN_PER_SEC = 0.2;
const HYPO_COOL_PER_SEC = 0.02;
const WARM_PER_SEC = 0.03;
const VFIB_TO_ASYSTOLE_SEC = 20;
const SMOOTH_TAU = 2; // s, suavizado de las constantes visibles

/** FC basal por especie y tamaño (perro toy ~120, grande ~90, gato ~160, conejo ~200). */
export function baselineHr(species: Species, weightKg: number): number {
  if (species === 'cat') return 160;
  if (species === 'rabbit') return 200;
  const t = clamp((Math.log(Math.max(0.5, weightKg)) - Math.log(3)) / (Math.log(30) - Math.log(3)), 0, 1);
  return 120 - 30 * t;
}

type AlarmKey = VitalsSnapshot['alarms'][number];

export function createVitals(init: VitalsInit, opts: { difficulty?: Difficulty } = {}): VitalsAPI {
  const severityMult = DIFFICULTY_SEVERITY[opts.difficulty ?? 'especialista'];
  const ebvMl = EBV_ML_PER_KG[init.species] * Math.max(0.1, init.weightKg);
  const baseHr = baselineHr(init.species, init.weightKg);
  const baseTemp = BASE_TEMP_C[init.species];

  let volumeMl = ebvMl;
  let lostMl = 0;
  let exito = clamp(init.startExito, 0, 100);
  let arrest = false;
  let arrestTime = 0;
  let rhythm: VitalsSnapshot['rhythm'] = 'sinus';

  // Valores visibles (suavizados) y objetivos.
  let hr = baseHr;
  let spo2 = 98;
  let map = 80;
  let etco2 = 40;
  let tempC = baseTemp;

  const alarms: AlarmKey[] = [];
  const history: number[] = [];
  let sampleAcc = 0;

  const deficitPct = () => clamp(100 - (100 * volumeMl) / ebvMl, 0, 100);

  // Objetivos fisiológicos (escritos en variables para no asignar objetos por fotograma).
  let tHr = hr;
  let tMap = map;
  let tSpo2 = spo2;
  let tEtco2 = etco2;
  function computeTargets() {
    const d = deficitPct();
    if (arrest) {
      tHr = 0;
      tMap = 15;
      tSpo2 = 70;
      tEtco2 = 10;
      return;
    }
    // Presión arterial media según pérdida.
    if (d <= 15) tMap = 80 - 0.3 * d;
    else if (d <= 30) tMap = 75.5 - ((d - 15) * 15.5) / 15;
    else tMap = Math.max(30, 60 - (d - 30) * 1.5 - 0.01);
    // FC: taquicardia compensatoria por encima del 15 %.
    let f = 1;
    if (d > 15) f += 0.02 * (Math.min(d, 30) - 15);
    if (d > 30) f += 0.015 * Math.min(20, d - 30);
    // Hipotermia: bradicardia leve.
    if (tempC < RANGES.tempLow) f *= Math.max(0.7, 1 - 0.08 * (RANGES.tempLow - tempC));
    tHr = baseHr * f;
    tSpo2 = 98 - Math.max(0, d - 30) * 0.35 - (tempC < 35 ? (35 - tempC) * 1 : 0);
    tEtco2 = 40 - Math.max(0, 65 - tMap) * 0.5;
  }

  function severityOf(): number {
    let max = 0;
    for (let i = 0; i < alarms.length; i++) {
      let s = 0;
      switch (alarms[i]) {
        case 'map':
          s = map < RANGES.mapLow ? (RANGES.mapLow - map) / 30 : (map - RANGES.mapHigh) / 40;
          break;
        case 'hr': {
          const hi = baseHr * RANGES.hrHighFactor;
          const lo = baseHr * RANGES.hrLowFactor;
          s = hr > hi ? (hr - hi) / (baseHr * 0.4) : (lo - hr) / (baseHr * 0.3);
          break;
        }
        case 'spo2':
          s = (RANGES.spo2Low - spo2) / 10;
          break;
        case 'etco2':
          s = etco2 < RANGES.etco2Low ? (RANGES.etco2Low - etco2) / 15 : (etco2 - RANGES.etco2High) / 15;
          break;
        case 'temp':
          s = tempC < RANGES.tempLow ? (RANGES.tempLow - tempC) / 2 : (tempC - RANGES.tempHigh) / 1.5;
          break;
      }
      if (s > max) max = s;
    }
    let sev = clamp(max + 0.25 * Math.max(0, alarms.length - 1), 0, 1);
    const d = deficitPct();
    if (d > 30) sev = Math.max(sev, clamp(0.5 + (d - 30) / 20, 0, 1));
    return sev;
  }

  function refreshAlarms() {
    alarms.length = 0;
    if (hr > baseHr * RANGES.hrHighFactor || hr < baseHr * RANGES.hrLowFactor) alarms.push('hr');
    if (spo2 < RANGES.spo2Low) alarms.push('spo2');
    if (map < RANGES.mapLow || map > RANGES.mapHigh) alarms.push('map');
    if (etco2 < RANGES.etco2Low || etco2 > RANGES.etco2High) alarms.push('etco2');
    if (tempC < RANGES.tempLow || tempC > RANGES.tempHigh) alarms.push('temp');
  }

  function snapToTargets() {
    computeTargets();
    hr = tHr;
    map = tMap;
    spo2 = tSpo2;
    etco2 = tEtco2;
    refreshAlarms();
  }

  function rhythmFor(): VitalsSnapshot['rhythm'] {
    if (arrest) return arrestTime >= VFIB_TO_ASYSTOLE_SEC ? 'asystole' : 'vfib';
    if (hr > baseHr * RANGES.hrHighFactor) return 'tachy';
    if (hr < baseHr * RANGES.hrLowFactor) return 'brady';
    return 'sinus';
  }

  snapToTargets();

  return {
    snapshot(): VitalsSnapshot {
      return {
        hr: Math.round(hr),
        spo2: Math.round(spo2 * 10) / 10,
        map: Math.round(map),
        etco2: Math.round(etco2),
        tempC: Math.round(tempC * 10) / 10,
        bloodVolumePct: (100 * volumeMl) / ebvMl,
        bloodLostPct: (100 * lostMl) / ebvMl,
        exito,
        arrest,
        rhythm,
        alarms: alarms.slice(),
      };
    },

    update(dt, inputs) {
      if (dt <= 0) return;
      // Pérdida de sangre.
      const lossMl = (Math.max(0, inputs.bleedPctPerSec) * dt * ebvMl) / 100;
      const realLoss = Math.min(lossMl, volumeMl);
      volumeMl -= realLoss;
      lostMl += realLoss;

      // Temperatura.
      if (inputs.warming) tempC = Math.min(baseTemp, tempC + WARM_PER_SEC * dt);
      else if (init.hypothermiaRisk) tempC -= HYPO_COOL_PER_SEC * dt;

      if (arrest) arrestTime += dt;
      computeTargets();
      const k = arrest ? 1 - Math.exp(-dt / 0.6) : 1 - Math.exp(-dt / SMOOTH_TAU);
      hr = arrest ? 0 : lerp(hr, tHr, k);
      map = lerp(map, tMap, k);
      spo2 = lerp(spo2, tSpo2, arrest ? 1 - Math.exp(-dt / 8) : k);
      etco2 = lerp(etco2, tEtco2, k);
      refreshAlarms();
      rhythm = rhythmFor();

      // Éxito.
      if (!arrest) {
        const flooded = inputs.fieldLevelPct > 70;
        if (alarms.length > 0 || deficitPct() > 30) {
          const rate = (0.5 + 1.5 * severityOf()) * severityMult;
          exito = clamp(exito - rate * dt, 0, 100);
        } else if (flooded) {
          exito = clamp(exito - FLOOD_DRAIN_PER_SEC * dt, 0, 100);
        } else if (exito < EXITO_REGEN_CAP) {
          exito = Math.min(EXITO_REGEN_CAP, exito + EXITO_REGEN_PER_SEC * dt);
        }
      }

      // Historial a 1 Hz.
      sampleAcc += dt;
      while (sampleAcc >= 1) {
        sampleAcc -= 1;
        history.push(exito);
      }
    },

    applyExito(delta, _reason) {
      if (arrest || !Number.isFinite(delta)) return;
      exito = clamp(exito + delta, 0, 100);
    },

    triggerArrest() {
      if (arrest) return;
      arrest = true;
      arrestTime = 0;
      exito = 0;
      hr = 0;
      rhythm = 'vfib';
      computeTargets();
      refreshAlarms();
    },

    resolveArrest(success) {
      if (!arrest) return;
      arrest = false;
      arrestTime = 0;
      // Éxito: circulación espontánea al 25 %. Si falla, Valerio estabiliza (nadie muere).
      exito = success ? 25 : 15;
      snapToTargets();
      rhythm = 'sinus';
    },

    transfuse(pctBV) {
      if (!(pctBV > 0)) return;
      volumeMl = Math.min(ebvMl, volumeMl + (pctBV * ebvMl) / 100);
    },

    exitoHistory() {
      return history.slice();
    },
  };
}
