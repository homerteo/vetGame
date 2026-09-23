/* Utilidades de prueba: crear un paso A con su contexto falso y un lienzo 2D que registra llamadas. */
import type { GuideLevel, StepController, StepDef, StepType } from '../../../../core/contracts';
import { STEPS_A } from '../../registryA';
import { PointerDriver } from './driver';
import { type FakeCtx, createFakeContext } from './fakeContext';
import { STEP_DEFS, anatomyFor } from './scenarios';

export interface StepHarness {
  f: FakeCtx;
  step: StepController;
  d: PointerDriver;
}

export function setupStep(
  type: keyof typeof STEP_DEFS,
  o: { tutorial?: boolean; guideLevel?: GuideLevel; def?: StepDef; anatomy?: ReturnType<typeof anatomyFor> } = {},
): StepHarness {
  const f = createFakeContext({ anatomy: o.anatomy ?? anatomyFor(type as StepType), tutorial: o.tutorial, guideLevel: o.guideLevel });
  const def = o.def ?? STEP_DEFS[type];
  const factory = STEPS_A[def.params.type];
  if (!factory) throw new Error(`Sin fábrica: ${def.params.type}`);
  const step = factory(def);
  step.begin(f.ctx);
  const d = new PointerDriver(step, f, step.instruments[0]);
  return { f, step, d };
}

/** Contexto 2D falso que acepta cualquier llamada y cuenta los métodos usados. */
export function createRecordingCanvas(): { g: CanvasRenderingContext2D; calls: Map<string, number> } {
  const calls = new Map<string, number>();
  const props: Record<string, unknown> = {};
  const gradient = { addColorStop() {} };
  const g = new Proxy(props, {
    get(target, key: string) {
      if (key in target) return target[key];
      return (..._args: unknown[]) => {
        calls.set(key, (calls.get(key) ?? 0) + 1);
        if (key === 'measureText') return { width: 40 };
        if (key === 'createRadialGradient' || key === 'createLinearGradient') return gradient;
        return undefined;
      };
    },
    set(target, key: string, value) {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { g, calls };
}

/** Dibuja todos los overlays registrados en la herida falsa. */
export function drawOverlays(f: FakeCtx, t = 1): Map<string, number> {
  const { g, calls } = createRecordingCanvas();
  const px = (p: { x: number; y: number }) => ({ x: p.x * 6.4, y: p.y * 6.4 });
  for (const o of [...f.wound.overlays.values()].sort((a, b) => a.z - b.z)) o.draw(g, px, 6.4, t);
  return calls;
}
