/** Gigi en escena: sostiene la lámpara, graba, se hace selfies, atiende llamadas, sale por los rayos X y se aparta en el paro. */
import * as THREE from 'three';
import type { GigiAPI } from '../../core/contracts';
import { Actor } from './Actor';
import { WALK_SPEED, type CrewCtx, type CrewMemberView } from './context';

export function createGigi(ctx: CrewCtx, actor: Actor): { api: GigiAPI; view: CrewMemberView } {
  const g = ctx.logic.gigi;
  const api: GigiAPI = {
    lightLevel: () => g.lightLevel(),
    isFilming: () => g.isFilming(),
    leaveRoomFor: (sec) => ctx.logic.leaveRoomFor(sec),
    isClear: () => g.isClear(),
    fixLampByHand: () => ctx.logic.fixLampByHand(),
  };
  const clearSpot = new THREE.Vector3();
  let viralShown = g.viralClips;
  let happyLeft = 0;
  let wasOut = false;

  const view: CrewMemberView = {
    update(dt) {
      if (g.viralClips !== viralShown) {
        viralShown = g.viralClips;
        happyLeft = 2.2;
      }
      happyLeft = Math.max(0, happyLeft - dt);
      if (g.mode === 'out') {
        // camina a la puerta y vuelve a tiempo
        const back = actor.distTo(ctx.door) / WALK_SPEED + 0.2;
        if (!wasOut) {
          wasOut = true;
          actor.moveTo(ctx.door, WALK_SPEED);
        } else if (g.outLeft <= back && !actor.moving && actor.distTo(ctx.door) < 0.1) actor.goHome(WALK_SPEED);
        actor.lookAt(ctx.door);
        actor.setAnim(actor.moving ? 'walk' : 'think');
        actor.setEmote(null);
      } else if (ctx.logic.arrest) {
        wasOut = false;
        if (g.isClear()) {
          clearSpot.copy(actor.home).sub(ctx.center).setY(0).normalize().multiplyScalar(1.1).add(actor.home);
          if (actor.distTo(clearSpot) > 0.08 && !actor.moving) actor.moveTo(clearSpot, WALK_SPEED * 1.4);
          actor.setAnim(actor.moving ? 'walk' : 'panic');
        } else actor.setAnim('work');
        actor.lookAt(ctx.center);
        actor.setEmote('sweat');
      } else {
        wasOut = false;
        if (!actor.atHome() && !actor.moving) actor.goHome(WALK_SPEED);
        if (actor.moving) {
          actor.setAnim('walk');
          actor.lookAt(ctx.center);
        } else if (happyLeft > 0) {
          actor.setAnim('cheer');
          actor.setEmote('hearts');
          actor.lookAt(ctx.center);
        } else if (g.mode === 'selfie') {
          // gira la lámpara hacia su cara y posa de espaldas a la camilla
          actor.setAnim('selfie');
          actor.setEmote('stars');
          actor.lookAt(ctx.center, Math.PI * 0.85);
        } else if (g.mode === 'call') {
          actor.setAnim('think');
          actor.setEmote(null);
          actor.lookAt(ctx.door);
        } else if (g.filming) {
          actor.setAnim('point');
          actor.setEmote(null);
          actor.lookAt(ctx.center);
        } else {
          actor.setAnim('work');
          actor.setEmote(null);
          actor.lookAt(ctx.center);
        }
      }
      actor.update(dt);
    },
    dispose() {
      actor.dispose();
    },
  };
  return { api, view };
}
