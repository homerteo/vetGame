/**
 * Tripulación del quirófano: coloca a Emiliana, Rodrigo, Fritz, Gigi y Valerio en los puntos de la
 * escena mirando a la camilla, anima sus bucles y reacciona a órdenes e interferencias (GDD §2).
 * La lógica vive en ./logic (pura y probada); aquí solo se orquesta y se dibuja.
 */
import * as THREE from 'three';
import type { AssistantId, CrewAPI, CrewDeps, CrewWorld, StepParams } from '../../core/contracts';
import { Actor } from './Actor';
import type { CrewCtx, CrewMemberView } from './context';
import { createEmilianaView } from './Emiliana';
import { createFritz } from './Fritz';
import { createGigi } from './Gigi';
import { CrewLogic } from './logic/CrewLogic';
import { createRodrigo } from './Rodrigo';
import { createValerio } from './Valerio';

/** Semilla estable a partir del id del caso (FNV-1a). */
export function seedFromCase(id: string, index: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h ^ (index * 0x9e3779b1)) >>> 0;
}

export function createCrew(deps: CrewDeps): CrewAPI {
  const { scene, factory, bus, caseDef, settings, effects, dialogue } = deps;
  const logic = new CrewLogic({
    bus,
    dialogue,
    flags: caseDef.flags ?? {},
    morale: deps.morale,
    moraleBonus: effects?.teamMoraleBonus ?? 0,
    seed: seedFromCase(caseDef.id ?? 'caso', caseDef.index ?? 0),
  });

  // posiciones de mundo de los puntos de la sala
  scene.scene.updateMatrixWorld(true);
  const spot = (k: keyof typeof scene.spots) => {
    const o = scene.spots[k];
    const v = new THREE.Vector3();
    if (o) o.getWorldPosition(v);
    return v;
  };
  const pE = spot('emiliana');
  const pR = spot('rodrigo');
  const pF = spot('fritz');
  const pG = spot('gigi');
  const pV = spot('valerio');
  const center = new THREE.Vector3().add(pE).add(pR).add(pF).add(pG).multiplyScalar(0.25);
  center.y = Math.min(pE.y, pR.y, pF.y, pG.y);
  let ringR = 0;
  for (const p of [pE, pR, pF, pG]) ringR += Math.hypot(p.x - center.x, p.z - center.z);
  ringR = Math.max(0.6, ringR / 4);
  const door = scene.spots.door ? spot('door') : center.clone().add(new THREE.Vector3(0, 0, ringR * 3));
  door.y = center.y;

  const stage = new THREE.Group();
  stage.name = 'crew';
  scene.scene.add(stage);

  const ctx: CrewCtx = { logic, factory, bus, settings, stage, center, door, ringR };
  const mk = (id: 'emiliana' | AssistantId | 'valerio', p: THREE.Vector3) => new Actor(factory.human(id), stage, p, center);
  const emiliana = mk('emiliana', pE);
  const rodrigo = createRodrigo(ctx, mk('rodrigo', pR));
  const fritz = createFritz(ctx, mk('fritz', pF));
  const gigi = createGigi(ctx, mk('gigi', pG));
  const valerio = createValerio(ctx, mk('valerio', pV));
  const views: CrewMemberView[] = [createEmilianaView(ctx, emiliana), rodrigo.view, fritz.view, gigi.view, valerio.view];
  let disposed = false;

  // Puente con la escena: el encuadre de 'micro' sigue la zona de trabajo de cada paso
  // (la escena no recibe el bus; Crew sí, y ya conoce el caso). Es opcional: si la escena no
  // ofrece `focusStep`, no pasa nada.
  const sceneFocus = scene as { focusStep?(params: StepParams | null): void };
  const offStep = bus.on('step:begin', (e) => {
    let params: StepParams | null = null;
    for (const ph of caseDef.phases ?? []) for (const st of ph.steps) if (st.id === e.stepId) params = st.params;
    sceneFocus.focusStep?.(params);
  });

  return {
    rodrigo: rodrigo.api,
    fritz: fritz.api,
    gigi: gigi.api,
    valerio: valerio.api,
    emiliana: emiliana.rig,
    command: (target, tone) => logic.command(target, tone),
    onChaosStart: (ev) => logic.onChaosStart(ev),
    onChaosEnd: (ev) => logic.onChaosEnd(ev),
    setResolver: (fn) => logic.setResolver(fn),
    update(dt: number, world: CrewWorld) {
      if (disposed) return;
      logic.update(dt, world);
      for (const v of views) v.update(dt);
    },
    visualStates: () => logic.visualStates(),
    neglectSeconds: () => logic.neglectSeconds(),
    dispose() {
      if (disposed) return;
      disposed = true;
      offStep();
      logic.dispose();
      for (const v of views) v.dispose();
      stage.removeFromParent();
    },
  };
}
