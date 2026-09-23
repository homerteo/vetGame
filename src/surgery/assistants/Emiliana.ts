/**
 * Emiliana en escena: opera ('work'), señala con la fusta al mandar y hace RCP en el paro.
 * Solo cambia de animación en transiciones, así la integración puede usar rig.setAnim/setBlush/setEmote libremente.
 */
import type { CharacterAnim } from '../../core/contracts';
import { Actor } from './Actor';
import type { CrewCtx, CrewMemberView } from './context';

export function createEmilianaView(ctx: CrewCtx, actor: Actor): CrewMemberView {
  let lastCmdAt = -1;
  let pointLeft = 0;
  let wasArrest = false;
  let current: CharacterAnim = 'work';
  actor.rig.setAnim('work');
  const set = (a: CharacterAnim) => {
    if (a === current) return;
    current = a;
    actor.rig.setAnim(a);
  };
  return {
    update(dt) {
      const cmd = ctx.logic.lastCommand;
      if (cmd && cmd.at !== lastCmdAt) {
        lastCmdAt = cmd.at;
        pointLeft = cmd.tone === 'domina' ? 1.1 : 0.8;
        set('point');
      }
      if (ctx.logic.arrest !== wasArrest) {
        wasArrest = ctx.logic.arrest;
        set(wasArrest ? 'compress' : 'work');
      }
      if (pointLeft > 0) {
        pointLeft -= dt;
        if (pointLeft <= 0) set(ctx.logic.arrest ? 'compress' : 'work');
      }
      actor.lookAt(ctx.center);
      actor.update(dt);
    },
    dispose() {
      actor.dispose();
    },
  };
}
