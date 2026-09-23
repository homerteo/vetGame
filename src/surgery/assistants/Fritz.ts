/**
 * Fritz en escena: temblores, bandeja con material, pánico al caer un tornillo y la
 * persecución de Panchito (chihuahua con cono) que entra por la puerta y corre en círculos.
 */
import * as THREE from 'three';
import type { CharacterRig, FritzAPI } from '../../core/contracts';
import { Actor } from './Actor';
import { RUN_SPEED, WALK_SPEED, type CrewCtx, type CrewMemberView } from './context';

const DOG_ANG_SPEED = 1.7; // rad/s alrededor de la camilla

export function createFritz(ctx: CrewCtx, actor: Actor): { api: FritzAPI; view: CrewMemberView } {
  const f = ctx.logic.fritz;
  const api: FritzAPI = {
    tremor: () => f.tremor(),
    presentItem: (kind) => ctx.logic.presentItem(kind),
    dropped: () => ctx.logic.dropped(),
    caught: (_q) => ctx.logic.caught(),
  };

  let dog: CharacterRig | null = null;
  let dogPhase: 'enter' | 'circle' | 'carried' | 'exit' = 'enter';
  let dogAngle = 0;
  let barkIn = 2.5;
  let carryDone = false;
  const dogPos = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const chaseTarget = new THREE.Vector3();
  const dogR = ctx.ringR + 0.45;

  const spawnDog = () => {
    dog = ctx.factory.animal('chihuahua', { cone: true });
    ctx.stage.add(dog.root);
    dogPos.copy(ctx.door);
    dog.root.position.copy(dogPos);
    dogPhase = 'enter';
    dogAngle = Math.atan2(ctx.door.x - ctx.center.x, ctx.door.z - ctx.center.z);
    dog.setAnim('run');
    carryDone = false;
  };
  const removeDog = () => {
    if (!dog) return;
    dog.root.removeFromParent();
    dog.dispose();
    dog = null;
  };
  const ringPoint = (ang: number, r: number, out: THREE.Vector3) => out.set(ctx.center.x + Math.sin(ang) * r, ctx.center.y, ctx.center.z + Math.cos(ang) * r);

  const moveDog = (dt: number, to: THREE.Vector3, speed: number): boolean => {
    if (!dog) return true;
    tmp.subVectors(to, dogPos).setY(0);
    const d = tmp.length();
    if (d < 0.05) return true;
    dogPos.addScaledVector(tmp, Math.min(1, (speed * dt) / d));
    dog.root.position.copy(dogPos);
    dog.root.rotation.y = Math.atan2(tmp.x, tmp.z);
    return false;
  };

  const updateDog = (dt: number) => {
    const state = f.panchito;
    if ((state === 'loose' || state === 'chase') && !dog) spawnDog();
    if (!dog) return;
    if (state === 'caught' && dogPhase !== 'carried') {
      // salta a los brazos de Fritz
      dogPhase = 'carried';
      actor.rig.root.add(dog.root);
      dog.root.position.set(0, actor.rig.height * 0.52, 0.28);
      dog.root.rotation.set(0, Math.PI / 2, 0);
      dog.setAnim('cheer');
      dog.setEmote('hearts');
    }
    if (state === 'fled' && dogPhase !== 'exit' && dogPhase !== 'carried') {
      dogPhase = 'exit';
      dog.setEmote(null);
    }
    if (state === 'none' && dogPhase === 'carried' && !carryDone) {
      carryDone = true;
      removeDog();
      return;
    }
    switch (dogPhase) {
      case 'enter':
        ringPoint(dogAngle, dogR, tmp);
        chaseTarget.copy(tmp);
        if (moveDog(dt, chaseTarget, 2.6)) dogPhase = 'circle';
        break;
      case 'circle': {
        dogAngle += DOG_ANG_SPEED * dt;
        ringPoint(dogAngle, dogR, chaseTarget);
        moveDog(dt, chaseTarget, 3.5);
        barkIn -= dt;
        if (barkIn <= 0) {
          barkIn = 2.2 + Math.abs(Math.sin(dogAngle * 3.1)) * 1.5;
          ctx.bus.emit('sfx', { name: 'panchitoBark', volume: 0.6 });
        }
        break;
      }
      case 'exit':
        dog.setAnim('run');
        if (moveDog(dt, ctx.door, 3.2)) removeDog();
        break;
      case 'carried':
        break;
    }
    dog?.update(dt);
  };

  const view: CrewMemberView = {
    update(dt) {
      updateDog(dt);
      const st = f.panchito;
      if (st === 'chase' && dog) {
        // corre detrás de Panchito por el corro
        ringPoint(dogAngle - 0.55, dogR, chaseTarget);
        actor.moveTo(chaseTarget, RUN_SPEED);
        actor.setAnim('run');
        actor.setEmote('sweat');
      } else if (st === 'caught') {
        if (actor.distTo(ctx.door) > 0.3) actor.moveTo(ctx.door, WALK_SPEED);
        actor.setAnim(actor.moving ? 'walk' : 'offer');
        actor.setEmote('stars');
      } else if (st === 'loose') {
        if (!actor.atHome() && !actor.moving) actor.goHome(WALK_SPEED);
        actor.lookAt(dogPos);
        actor.setAnim(actor.moving ? 'walk' : 'panic');
        actor.setEmote('sweat');
      } else {
        if (!actor.atHome() && !actor.moving) actor.goHome(WALK_SPEED);
        actor.lookAt(ctx.center);
        if (actor.moving) {
          actor.setAnim('walk');
          actor.setEmote(null);
        } else if (f.reaction === 'drop') {
          actor.setAnim('panic');
          actor.setEmote('sweat');
        } else if (f.reaction === 'catch') {
          actor.setAnim('cheer');
          actor.setEmote('stars');
        } else if (f.reaction === 'offer') {
          actor.setAnim('offer');
          actor.setEmote(null);
        } else if (ctx.logic.arrest) {
          actor.setAnim('work');
          actor.setEmote('sweat');
        } else if (f.spiking || f.tremor() > 1.3) {
          actor.setAnim('tremble');
          actor.setEmote('sweat');
        } else {
          actor.setAnim('work');
          actor.setEmote(null);
        }
      }
      actor.update(dt);
    },
    dispose() {
      removeDog();
      actor.dispose();
    },
  };
  return { api, view };
}
