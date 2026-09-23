/** Contexto compartido por las vistas de la tripulación. */
import type * as THREE from 'three';
import type { CharacterFactory, GameEvents, Settings } from '../../core/contracts';
import type { EventBus } from '../../core/EventBus';
import type { CrewLogic } from './logic/CrewLogic';

export interface CrewCtx {
  logic: CrewLogic;
  factory: CharacterFactory;
  bus: EventBus<GameEvents>;
  settings: Settings;
  /** Grupo raíz de la tripulación dentro de la escena. */
  stage: THREE.Object3D;
  /** Centro de la camilla (suelo). */
  center: THREE.Vector3;
  /** Puerta del quirófano (suelo). */
  door: THREE.Vector3;
  /** Radio medio del corro alrededor de la camilla. */
  ringR: number;
}

export interface CrewMemberView {
  update(dt: number): void;
  dispose(): void;
}

export const WALK_SPEED = 1.15;
export const RUN_SPEED = 2.6;
