/** Piezas compartidas de vestuario y peinados para los humanos. */
import * as THREE from 'three';
import type { HumanRig } from '../HumanRig';
import type { Finish } from '../kit';

export function heartShape(s: number): THREE.Shape {
  const h = new THREE.Shape();
  h.moveTo(0, -s * 0.9);
  h.bezierCurveTo(-s * 1.3, -s * 0.1, -s * 0.9, s * 0.9, 0, s * 0.3);
  h.bezierCurveTo(s * 0.9, s * 0.9, s * 1.3, -s * 0.1, 0, -s * 0.9);
  return h;
}

export function heartGeo(rig: HumanRig, s: number, depth: number): THREE.BufferGeometry {
  return rig.kit.geo(`heart${s}_${depth}`, () => {
    const g = new THREE.ExtrudeGeometry(heartShape(s), { depth, bevelEnabled: true, bevelThickness: depth * 0.4, bevelSize: s * 0.15, bevelSegments: 2, curveSegments: 10 });
    g.center();
    return g;
  });
}

/**
 * Casquete de pelo: esfera parcial inclinada hacia atrás (la línea del pelo queda en la frente).
 * theta = ángulo polar cubierto; tilt = inclinación hacia atrás.
 */
export function hairCap(rig: HumanRig, color: string, o: { theta?: number; tilt?: number; scale?: number; y?: number; z?: number; finish?: Finish; sx?: number } = {}): THREE.Mesh {
  const R = rig.headR;
  const hs = rig.headScale;
  const th = o.theta ?? 1.75;
  const g = rig.kit.geo(`haircap${th}`, () => new THREE.SphereGeometry(1, 30, 18, 0, Math.PI * 2, 0, th));
  const sc = o.scale ?? 1.07;
  const m = rig.kit.mesh(g, rig.mat(color, { finish: o.finish ?? 'vinyl', side: THREE.DoubleSide }), rig.headCenter, [0, o.y ?? R * 0.02, o.z ?? -R * 0.02], [R * hs[0] * sc * (o.sx ?? 1), R * hs[1] * sc, R * hs[2] * sc], [-(o.tilt ?? 0.5), 0, 0]);
  m.name = 'hair';
  return m;
}

/** Gafas: dos aros (redondos o rectangulares), puente y patillas. Grupo llamado "glasses". */
export function glasses(rig: HumanRig, color: string, o: { rect?: boolean; lensR?: number; spacing?: number; y?: number; lens?: string } = {}): THREE.Group {
  const R = rig.headR;
  const g = new THREE.Group();
  g.name = 'glasses';
  const lr = (o.lensR ?? 0.16) * R;
  const sp = o.spacing ?? 0.36;
  const y = o.y ?? -0.08;
  const mat = rig.mat(color, { finish: 'metal' });
  const p = rig.surf(0, y, R * 0.12);
  g.position.copy(p);
  rig.headCenter.add(g);
  const ex = Math.sin(sp) * R * rig.headScale[0];
  for (const side of [1, -1]) {
    const ring = rig.kit.mesh(rig.kit.torusGeo(lr, R * 0.018, Math.PI * 2, 24), mat, g, [side * ex, 0, -R * 0.02]);
    if (o.rect) ring.scale.set(1.25, 0.85, 1);
    if (o.lens) {
      const lens = rig.kit.mesh(rig.kit.circleGeo(24), rig.mat(o.lens, { finish: 'glass', opacity: 0.25 }), g, [side * ex, 0, -R * 0.022], [lr * (o.rect ? 1.25 : 1), lr * (o.rect ? 0.85 : 1), 1]);
      lens.name = side > 0 ? 'lensL' : 'lensR';
    }
    // patilla hacia la oreja
    const a = new THREE.Vector3(side * (ex + lr * (o.rect ? 1.25 : 1)), 0, -R * 0.02);
    const b = new THREE.Vector3(side * R * rig.headScale[0] * 1.0, R * 0.02, -p.z - R * 0.1);
    rig.kit.limb(color, g, a, b, R * 0.014, { finish: 'metal' });
  }
  rig.kit.mesh(rig.kit.torusGeo(ex * 0.45, R * 0.016, Math.PI, 12), mat, g, [0, lr * 0.2, -R * 0.02]);
  return g;
}

/** Uniforme quirúrgico: casaca con cuello en V y bolsillo, pantalón y mangas cortas. */
export function scrubs(rig: HumanRig, color: string, o: { trim?: string; pocket?: boolean; skinArms?: boolean } = {}) {
  const cloth = rig.mat(color, { finish: 'cloth' });
  rig.torsoLayer(color, { offset: 0.004, from: 0, to: 0.97, capTop: true });
  rig.pelvisLayer(color, { offset: 0.006 });
  // bajo de la casaca
  rig.flare(rig.torso, color, 0.06, -0.09, interpR(rig, 0.02) + 0.01, interpR(rig, 0.02) + 0.028);
  // cuello en V
  const v = new THREE.Group();
  rig.torso.add(v);
  const top = rig.torsoPt(0, 0.93, 0.006);
  const mid = rig.torsoPt(0, 0.8, 0.008);
  const trim = o.trim ?? shade(color, -0.12);
  rig.kit.tube(trim, v, [rig.torsoPt(0.55, 0.96, 0.006), mid, rig.torsoPt(-0.55, 0.96, 0.006)], 0.008, { finish: 'cloth' });
  rig.kit.mesh(rig.kit.sphereGeo(), rig.mat(rig.spec.skin, { finish: 'skin' }), v, [0, (top.y + mid.y) / 2 + 0.01, top.z - 0.004], [0.05, 0.045, 0.012]);
  if (o.pocket !== false) {
    const pp = rig.torsoPt(0.45, 0.7, 0.008);
    rig.kit.mesh(rig.kit.boxGeo(0.07, 0.06, 0.008), rig.mat(trim, { finish: 'cloth' }), rig.torso, [pp.x, pp.y, pp.z], 1, [0, 0.45, 0]);
  }
  const skin = rig.mat(rig.spec.skin, { finish: 'skin' });
  // manga corta sobre el brazo
  rig.buildArms(skin, skin, skin);
  for (const sh of [rig.shoulderL, rig.shoulderR]) rig.kit.mesh(rig.kit.capsuleGeo(rig.spec.armR * 1.3, rig.upperArm * 0.35), cloth, sh, [0, -rig.upperArm * 0.22, 0]);
  rig.buildLegs(cloth, cloth, { thighR: rig.spec.thighR * 1.08, shinR: rig.spec.shinR * 1.2 });
}

export function interpR(rig: HumanRig, frac: number): number {
  const p = rig.torsoPt(0, frac);
  return p.z / rig.spec.depth;
}

/** Aclara/oscurece un color CSS (delta de luminosidad −1..1). */
export function shade(color: string, dl: number): string {
  const c = new THREE.Color(color);
  c.offsetHSL(0, 0, dl);
  return `#${c.getHexString()}`;
}

/** Peinado de flequillo: varias gotas aplastadas sobre la frente. */
export function bangs(rig: HumanRig, color: string, n: number, o: { from?: number; to?: number; pitch?: number; size?: number; sweep?: number } = {}) {
  const R = rig.headR;
  const from = o.from ?? -0.7;
  const to = o.to ?? 0.7;
  for (let i = 0; i < n; i++) {
    const yaw = from + ((to - from) * i) / Math.max(1, n - 1);
    const pitch = (o.pitch ?? 0.42) - Math.abs(yaw) * 0.12;
    const b = rig.kit.ball(color, rig.headCenter, [0, 0, 0], [R * (o.size ?? 0.3), R * (o.size ?? 0.3) * 1.2, R * 0.16], { finish: 'vinyl' });
    rig.onFace(b, yaw, pitch, -R * 0.05);
    b.rotateZ((o.sweep ?? 0.4) + yaw * 0.3);
  }
}
