import type {
  BleedType,
  HemostasisParams,
  IncisionParams,
  PhaseDef,
  RetractParams,
  StepDef,
  SutureParams,
  Vec2,
} from '../../core/contracts';
import { P, roundedRect } from '../geometry';

/** Aviso de rigor común a todas las fichas educativas. */
export const EDU_DISCLAIMER = 'Datos aproximados, pendientes de revisión por un veterinario ortopedista.';

/** Ventana profunda estándar: 116 × 32 mm centrada en la incisión. */
export const STD_WINDOW: Vec2[] = roundedRect(22, 34, 138, 66, 8);

/** Incisión estándar: casi horizontal por el centro, con una ondulación leve de piel real. */
export function incisionPath(x0 = 30, x1 = 130, y = 50, wave = 0.6): Vec2[] {
  const out: Vec2[] = [];
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(P(Math.round((x0 + (x1 - x0) * t) * 100) / 100, Math.round((y + Math.sin(t * Math.PI * 2) * wave) * 100) / 100));
  }
  return out;
}

export interface IncisionOpts {
  weight: number;
  path: Vec2[];
  /** Presión objetivo por capa: piel, subcutáneo, fascia. */
  pressures: [number, number, number];
  instrument?: 'scalpel10' | 'scalpel15';
  hazards?: Vec2[];
  label?: string;
}

export function incisionPhase(o: IncisionOpts): PhaseDef {
  const params: IncisionParams = {
    type: 'incision',
    path: o.path,
    layers: [
      { layer: 'skin', targetPressure: o.pressures[0] },
      { layer: 'subcut', targetPressure: o.pressures[1] },
      { layer: 'fascia', targetPressure: o.pressures[2] },
    ],
    instrument: o.instrument ?? 'scalpel10',
    vesselHazards: o.hazards ?? [],
  };
  return {
    id: 'incision',
    label: o.label ?? 'Incisión',
    weight: o.weight,
    steps: [{ id: 'incision-layers', label: 'Abrir piel, subcutáneo y fascia', params }],
  };
}

export interface HemostasisOpts {
  weight: number;
  bleeders: Array<[number, number, BleedType]>;
  targetFieldPct?: number;
  retract?: { instrument: 'gelpi' | 'weitlaner'; pairs: Array<[Vec2, Vec2]>; ideal?: number; max?: number };
  id?: string;
  label?: string;
  stepLabel?: string;
}

export function hemostasisPhase(o: HemostasisOpts): PhaseDef {
  const id = o.id ?? 'hemostasis';
  const hemo: HemostasisParams = {
    type: 'hemostasis',
    bleeders: o.bleeders.map(([x, y, kind]) => ({ pos: P(x, y), kind })),
    targetFieldPct: o.targetFieldPct ?? 40,
  };
  const steps: StepDef[] = [{ id: `${id}-cautery`, label: o.stepLabel ?? 'Cauterizar los sangrados', params: hemo }];
  if (o.retract) {
    const r: RetractParams = {
      type: 'retract',
      instrument: o.retract.instrument,
      pairs: o.retract.pairs.map(([a, b]) => ({ a, b })),
      idealClicks: o.retract.ideal ?? 3,
      maxClicks: o.retract.max ?? 5,
    };
    const name = o.retract.instrument === 'gelpi' ? 'Gelpi' : 'Weitlaner';
    steps.push({ id: `${id}-retract`, label: `Colocar y abrir el separador ${name}`, params: r });
  }
  return { id, label: o.label ?? 'Hemostasia', weight: o.weight, steps };
}

export interface ClosureOpts {
  weight: number;
  path: Vec2[];
  layers: SutureParams['layers'];
  spacingMm?: number;
  bandage?: { center: Vec2; radiusMm: number; turns: number };
  label?: string;
}

export function closurePhase(o: ClosureOpts): PhaseDef {
  const steps: StepDef[] = [
    {
      id: 'closure-suture',
      label: o.layers.length > 1 ? 'Suturar por capas' : 'Suturar la piel',
      params: { type: 'suture', path: o.path, layers: o.layers, spacingMm: o.spacingMm ?? 8 },
    },
  ];
  if (o.bandage) {
    steps.push({
      id: 'closure-bandage',
      label: 'Vendaje con tensión pareja',
      params: { type: 'bandage', center: o.bandage.center, radiusMm: o.bandage.radiusMm, turns: o.bandage.turns },
    });
  }
  return { id: 'closure', label: o.label ?? 'Cierre', weight: o.weight, steps };
}

/** Coordenadas normalizadas de la lesión en la radiografía a partir de un punto de la herida. */
export function lesionAt(p: Vec2, radius = 0.08): { u: number; v: number; radius: number } {
  return { u: Math.round((p.x / 160) * 1000) / 1000, v: Math.round((p.y / 100) * 1000) / 1000, radius };
}
