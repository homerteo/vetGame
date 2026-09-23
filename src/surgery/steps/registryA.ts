import type { StepFactory, StepType } from '../../core/contracts';
import { BandageStep } from './Bandage';
import { ClickTargetsStep } from './ClickTargets';
import { HemostasisStep } from './Hemostasis';
import { IncisionStep } from './Incision';
import { PickStep } from './Pick';
import { RetractStep } from './Retract';
import { SutureStep } from './Suture';

/** Pasos quirúrgicos de la parte A. */
export const STEPS_A: Partial<Record<StepType, StepFactory>> = {
  incision: (def) => new IncisionStep(def),
  hemostasis: (def) => new HemostasisStep(def),
  retract: (def) => new RetractStep(def),
  suture: (def) => new SutureStep(def),
  bandage: (def) => new BandageStep(def),
  clickTargets: (def) => new ClickTargetsStep(def),
  pick: (def) => new PickStep(def),
};

export { createCauteryTool } from './CauteryTool';
