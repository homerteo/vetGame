/** Rodrigo en escena: aspira, entra en groove, se marca solos de bajo con la cánula o llora por Chorizo. */
import * as THREE from 'three';
import type { RodrigoAPI, Vec2 } from '../../core/contracts';
import { Actor } from './Actor';
import type { CrewCtx, CrewMemberView } from './context';

export function createRodrigo(ctx: CrewCtx, actor: Actor): { api: RodrigoAPI; view: CrewMemberView } {
  const r = ctx.logic.rodrigo;
  const api: RodrigoAPI = {
    suctionRate: () => r.suctionRate(),
    focus: () => r.focus(),
    pushHose: (mm: Vec2) => ctx.logic.pushHose(mm),
    isSoloing: () => r.soloing,
    grooveActive: () => r.grooveActive(),
  };
  const soloSpot = new THREE.Vector3();
  const view: CrewMemberView = {
    update(dt) {
      if (r.soloing) {
        // un pasito atrás y de cara a la sala: ¡concierto!
        soloSpot.copy(actor.home).sub(ctx.center).setY(0).normalize().multiplyScalar(0.35).add(actor.home);
        if (actor.distTo(soloSpot) > 0.05 && !actor.moving) actor.moveTo(soloSpot, 1.4);
        actor.lookAt(ctx.center, Math.PI * 0.75);
        actor.setAnim('guitar');
        actor.setEmote('music');
      } else {
        if (!actor.atHome() && !actor.moving) actor.goHome(1.4);
        actor.lookAt(ctx.center);
        if (r.cryLeft > 0) {
          actor.setAnim('suction');
          actor.setEmote('sweat');
        } else if (r.slipLeft > 0) {
          actor.setAnim('think');
          actor.setEmote(null);
        } else {
          actor.setAnim(actor.moving ? 'walk' : 'suction');
          actor.setEmote(r.grooveActive() ? 'music' : null);
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
