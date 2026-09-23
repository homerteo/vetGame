/** Dr. Valerio en escena: observa con las manos a la espalda; durante la Mirada de Auditor le brillan las gafas. */
import * as THREE from 'three';
import type { ValerioAPI } from '../../core/contracts';
import { glowTexture } from '../../characters/textures';
import { Actor } from './Actor';
import type { CrewCtx, CrewMemberView } from './context';

export function createValerio(ctx: CrewCtx, actor: Actor): { api: ValerioAPI; view: CrewMemberView } {
  const v = ctx.logic.valerio;
  const api: ValerioAPI = {
    isGazing: () => v.isGazing(),
    say: (text: string) => ctx.logic.valerioSay(text),
  };
  // destellos de "ojos de auditor" (sprites aditivos sobre las lentes o los ojos)
  const glowMat = new THREE.SpriteMaterial({
    map: glowTexture(),
    color: '#ff4fa0',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const glows: THREE.Sprite[] = [];
  const anchors = ['lensL', 'lensR'].map((n) => actor.rig.root.getObjectByName(n)).filter(Boolean) as THREE.Object3D[];
  if (anchors.length < 2) {
    anchors.length = 0;
    for (const n of ['eyeL', 'eyeR']) {
      const o = actor.rig.root.getObjectByName(n);
      if (o) anchors.push(o);
    }
  }
  if (anchors.length === 0) {
    // rig ajeno sin nodos con nombre: un destello frente a la cabeza
    const head = actor.rig.root.getObjectByName('head');
    const holder = new THREE.Object3D();
    if (head) {
      holder.position.set(0, 0, 0.16);
      head.add(holder);
    } else {
      holder.position.set(0, actor.rig.height * 0.9, 0.16);
      actor.rig.root.add(holder);
    }
    anchors.push(holder);
  }
  for (const a of anchors) {
    // los sprites cuelgan del padre de la lente/ojo (sin escala) en su misma posición
    const s = new THREE.Sprite(glowMat);
    s.scale.setScalar(0.09);
    s.renderOrder = 20;
    const parent = a.parent ?? a;
    if (parent !== a) s.position.copy(a.position);
    s.position.z += 0.012;
    parent.add(s);
    glows.push(s);
  }
  let t = 0;
  let glow = 0;
  const view: CrewMemberView = {
    update(dt) {
      t += dt;
      const gazing = v.isGazing();
      glow += ((gazing ? 1 : 0) - glow) * (1 - Math.exp(-dt * 6));
      const flash = ctx.settings.reduceFlashes ? 0.75 : 0.65 + 0.35 * Math.sin(t * 7);
      glowMat.opacity = glow * flash;
      for (const s of glows) s.scale.setScalar(0.06 + glow * 0.07 * (ctx.settings.reduceFlashes ? 1 : 0.8 + 0.2 * Math.sin(t * 5)));
      actor.lookAt(ctx.center);
      if (v.speakingLeft > 0) actor.setAnim('point');
      else if (gazing) actor.setAnim(Math.floor(t / 1.6) % 2 === 0 ? 'think' : 'point');
      else actor.setAnim(ctx.logic.arrest ? 'think' : 'idle');
      actor.setEmote(v.annoyedLeft > 0 ? 'anger' : null);
      actor.update(dt);
    },
    dispose() {
      for (const s of glows) s.removeFromParent();
      glowMat.dispose();
      actor.dispose();
    },
  };
  return { api, view };
}
