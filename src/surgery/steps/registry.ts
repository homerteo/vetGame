import type { StepFactory, StepType } from '../../core/contracts';
import { STEPS_A, createCauteryTool } from './registryA';
import { STEPS_B } from './registryB';

/** Registro unificado de pasos quirúrgicos (A + B). */
export const STEP_FACTORIES: Partial<Record<StepType, StepFactory>> = { ...STEPS_A, ...STEPS_B };

export function stepFactory(type: StepType): StepFactory {
  const f = STEP_FACTORIES[type];
  if (!f) throw new Error(`Paso quirúrgico sin implementar: ${type}`);
  return f;
}

export { createCauteryTool };
