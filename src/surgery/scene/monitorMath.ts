/** Formas de onda del monitor (puras, probadas). */
import type { VitalsSnapshot } from '../../core/contracts';

const gauss = (x: number, mu: number, s: number) => Math.exp(-((x - mu) * (x - mu)) / (2 * s * s));

/** ECG sinusal normalizado (−0.35..1) en función de la fase del latido 0..1. */
export function ecgSinus(p: number): number {
  return (
    0.12 * gauss(p, 0.12, 0.025) - // P
    0.14 * gauss(p, 0.235, 0.008) + // Q
    1.0 * gauss(p, 0.25, 0.009) - // R
    0.3 * gauss(p, 0.268, 0.01) + // S
    0.26 * gauss(p, 0.46, 0.045) // T
  );
}

/** Onda del pulsioxímetro 0..1 con muesca dícrota. */
export function pleth(p: number): number {
  return 0.95 * gauss(p, 0.32, 0.075) + 0.28 * gauss(p, 0.55, 0.06) + 0.05;
}

/** Muestra de ECG según el ritmo. `t` en segundos para el ruido de la fibrilación. */
export function ecgSample(rhythm: VitalsSnapshot['rhythm'], phase: number, t: number): number {
  switch (rhythm) {
    case 'asystole':
      return 0.02 * Math.sin(t * 7.1) * Math.sin(t * 2.3);
    case 'vfib':
      return 0.35 * Math.sin(t * 31) + 0.25 * Math.sin(t * 19.7 + 1.3) + 0.15 * Math.sin(t * 47.2 + 0.4);
    default:
      return ecgSinus(phase - Math.floor(phase));
  }
}

/** Texto de la constante con su unidad (español). */
export function vitalsLabel(k: 'hr' | 'spo2' | 'map' | 'etco2' | 'temp'): { name: string; unit: string } {
  switch (k) {
    case 'hr':
      return { name: 'FC', unit: 'lpm' };
    case 'spo2':
      return { name: 'SpO₂', unit: '%' };
    case 'map':
      return { name: 'PAM', unit: 'mmHg' };
    case 'etco2':
      return { name: 'EtCO₂', unit: 'mmHg' };
    case 'temp':
      return { name: 'T', unit: '°C' };
  }
}
