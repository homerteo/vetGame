import type { StepFactory, StepType } from '../../core/contracts';
import { BurrStep } from './Burr';
import { DrillPinsStep } from './DrillPins';
import { PlateStep } from './Plate';
import { ReductionStep } from './Reduction';
import { RotateStep } from './Rotate';
import { SawStep } from './Saw';
import { ScrewsStep } from './Screws';

/** Pasos quirúrgicos de hueso (parte B). */
export const STEPS_B: Partial<Record<StepType, StepFactory>> = {
  reduction: (def) => new ReductionStep(def),
  rotate: (def) => new RotateStep(def),
  saw: (def) => new SawStep(def),
  burr: (def) => new BurrStep(def),
  drillPins: (def) => new DrillPinsStep(def),
  plate: (def) => new PlateStep(def),
  screws: (def) => new ScrewsStep(def),
};
