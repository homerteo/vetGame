/**
 * Dobles para desarrollar la clínica sin depender de otros módulos:
 * personajes de cápsulas animadas, audio mudo, banco de diálogo mínimo y casos de ejemplo.
 */
import * as THREE from 'three';
import type {
  AnatomyDef,
  AnimalModelId,
  AudioAPI,
  BoutiqueEffects,
  CaseDef,
  CharacterAnim,
  CharacterFactory,
  CharacterRig,
  ChaosEventKind,
  DialogueBank,
  Emote,
  FaultKind,
  HumanId,
  SaveData,
  Settings,
} from '../../core/contracts';

// ───────────────────────── personajes de cápsulas ─────────────────────────

interface HumanLook {
  body: string;
  head: string;
  height: number;
  width: number;
  extra?: (g: THREE.Group, mk: MeshMaker) => void;
}
type MeshMaker = (geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number, o?: { metal?: number; rough?: number }) => THREE.Mesh;

const SKIN = '#f6d2bd';
const HUMANS: Record<HumanId, HumanLook> = {
  emiliana: {
    body: '#ff2e93',
    head: SKIN,
    height: 1.68,
    width: 0.3,
    extra: (g, mk) => {
      mk(new THREE.TorusGeometry(0.1, 0.022, 8, 16), '#3b2146', 0, 1.36, 0.03).rotation.x = Math.PI / 2; // gargantilla
      mk(new THREE.SphereGeometry(0.03, 8, 6), '#f5c542', 0, 1.3, 0.12, { metal: 0.8 }); // candado
      mk(new THREE.CylinderGeometry(0.26, 0.3, 0.3, 16), '#c8a2e8', 0, 1.05, 0); // arnés
      const whip = mk(new THREE.CylinderGeometry(0.012, 0.02, 0.6, 6), '#ff8fc7', -0.3, 0.85, 0.08);
      whip.rotation.z = 0.5;
      mk(new THREE.CylinderGeometry(0.12, 0.13, 0.22, 12), '#3b2146', -0.11, 0.11, 0); // botas
      mk(new THREE.CylinderGeometry(0.12, 0.13, 0.22, 12), '#3b2146', 0.11, 0.11, 0);
      mk(new THREE.SphereGeometry(0.2, 14, 10), '#6b2a4a', 0, 1.62, -0.05); // pelo
    },
  },
  valerio: { body: '#f4f7fb', head: SKIN, height: 1.88, width: 0.24 },
  rodrigo: {
    body: '#3fcf9c',
    head: '#e8b894',
    height: 1.78,
    width: 0.34,
    extra: (g, mk) => {
      mk(new THREE.TorusGeometry(0.17, 0.03, 6, 16), '#3b2146', 0, 1.68, 0).rotation.y = Math.PI / 2; // auriculares
      for (let i = 0; i < 5; i++) mk(new THREE.CylinderGeometry(0.018, 0.018, 0.45, 5), '#5a3a22', -0.1 + i * 0.05, 1.45, -0.14);
    },
  },
  fritz: { body: '#b8e1ff', head: '#fbe6dc', height: 1.74, width: 0.22, extra: (g, mk) => void mk(new THREE.BoxGeometry(0.16, 0.06, 0.04), '#8fd3ff', 0, 1.46, 0.14) },
  gigi: {
    body: '#ffe066',
    head: SKIN,
    height: 1.66,
    width: 0.24,
    extra: (g, mk) => {
      mk(new THREE.SphereGeometry(0.19, 14, 10), '#ffe9a0', 0, 1.6, -0.05);
      mk(new THREE.CylinderGeometry(0.05, 0.02, 0.35, 8), '#ffe9a0', 0, 1.62, -0.24).rotation.x = 1.1;
      mk(new THREE.BoxGeometry(0.08, 0.14, 0.015), '#3b2146', 0.25, 1.05, 0.14);
    },
  },
  hortensia: {
    body: '#e58bbd',
    head: SKIN,
    height: 1.6,
    width: 0.34,
    extra: (g, mk) => {
      mk(new THREE.TorusGeometry(0.2, 0.08, 8, 18), '#fff0f7', 0, 1.22, 0).rotation.x = Math.PI / 2; // estola
      for (let i = 0; i < 9; i++) mk(new THREE.SphereGeometry(0.02, 6, 5), '#ffffff', Math.cos(i / 3) * 0.1, 1.28 - Math.abs(i - 4) * 0.012, 0.12, { metal: 0.3, rough: 0.2 });
      mk(new THREE.SphereGeometry(0.19, 14, 10), '#b0b0c8', 0, 1.56, -0.03);
    },
  },
  braulio: {
    body: '#8a9a6a',
    head: SKIN,
    height: 1.72,
    width: 0.3,
    extra: (g, mk) => void mk(new THREE.ConeGeometry(0.17, 0.32, 10), '#d9dde6', 0, 1.86, 0, { metal: 0.8, rough: 0.3 }),
  },
  ownerA: { body: '#b79cf2', head: SKIN, height: 1.64, width: 0.26 },
  ownerB: { body: '#3fcf9c', head: '#d9a47e', height: 1.76, width: 0.3 },
  ownerC: { body: '#ffb347', head: '#c98f6b', height: 1.62, width: 0.26 },
};

const ANIMALS: Record<AnimalModelId, { color: string; len: number; h: number; ear: 'up' | 'flop' | 'long' }> = {
  chihuahua: { color: '#e0b27a', len: 0.26, h: 0.26, ear: 'up' },
  poodle: { color: '#fff4f8', len: 0.32, h: 0.34, ear: 'flop' },
  bulldog: { color: '#d9b48c', len: 0.46, h: 0.38, ear: 'flop' },
  dachshund: { color: '#8a4b2a', len: 0.56, h: 0.26, ear: 'flop' },
  pitbull: { color: '#a0a4b0', len: 0.6, h: 0.5, ear: 'up' },
  bordercollie: { color: '#2b2b33', len: 0.6, h: 0.52, ear: 'up' },
  cat: { color: '#f2a65a', len: 0.4, h: 0.3, ear: 'up' },
  rabbit: { color: '#f4f0ea', len: 0.26, h: 0.24, ear: 'long' },
};

function makeRig(root: THREE.Group, height: number, parts: { arms?: THREE.Object3D[]; torso: THREE.Object3D; legs?: THREE.Object3D[] }, materials: THREE.Material[], geos: THREE.BufferGeometry[]): CharacterRig {
  let anim: CharacterAnim = 'idle';
  let t = Math.random() * 10;
  let blend = 0;
  const emoteSprite = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const tex = new THREE.CanvasTexture(c);
    const m = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const s = new THREE.Sprite(m);
    s.scale.set(0.35, 0.35, 1);
    s.position.y = height + 0.35;
    s.visible = false;
    root.add(s);
    materials.push(m);
    return { s, c, tex };
  })();
  return {
    root,
    height,
    setAnim(a) {
      if (a !== anim) {
        anim = a;
        blend = 0;
      }
    },
    update(dt) {
      t += dt;
      blend = Math.min(1, blend + dt * 3);
      const torso = parts.torso;
      torso.position.y = 0;
      torso.rotation.set(0, 0, 0);
      torso.position.z = 0;
      const arms = parts.arms ?? [];
      const legs = parts.legs ?? [];
      arms.forEach((a, i) => a.rotation.set(0, 0, i ? -0.12 : 0.12));
      legs.forEach((l) => l.rotation.set(0, 0, 0));
      const s = (i: number) => (i ? -1 : 1);
      switch (anim) {
        case 'walk':
        case 'run': {
          const f = anim === 'run' ? 14 : 9;
          const a = anim === 'run' ? 0.9 : 0.55;
          torso.position.y = Math.abs(Math.sin(t * f)) * 0.05;
          arms.forEach((ar, i) => (ar.rotation.x = Math.sin(t * f + i * Math.PI) * a));
          legs.forEach((l, i) => (l.rotation.x = Math.sin(t * f + i * Math.PI + Math.PI) * a));
          if (anim === 'run') torso.rotation.x = 0.15;
          break;
        }
        case 'sit':
          torso.position.y = -height * 0.26;
          legs.forEach((l) => (l.rotation.x = -1.45));
          break;
        case 'faint':
          torso.rotation.x = -1.35 * blend;
          torso.position.y = 0.15 * blend;
          arms.forEach((a, i) => (a.rotation.z = s(i) * 1.2));
          break;
        case 'panic':
          torso.position.y = Math.abs(Math.sin(t * 18)) * 0.06;
          arms.forEach((a, i) => (a.rotation.z = s(i) * (2.4 + Math.sin(t * 20 + i) * 0.4)));
          break;
        case 'tremble':
          torso.rotation.z = Math.sin(t * 40) * 0.02;
          arms.forEach((a) => (a.rotation.x = -0.3 + Math.sin(t * 35) * 0.08));
          break;
        case 'work':
        case 'suction':
        case 'compress':
          arms.forEach((a, i) => (a.rotation.x = -1.1 + Math.sin(t * 8 + i) * 0.25));
          torso.rotation.x = 0.12;
          break;
        case 'selfie':
          arms[1] && (arms[1].rotation.x = -2.6);
          torso.rotation.z = Math.sin(t * 3) * 0.05;
          break;
        case 'guitar':
          arms.forEach((a, i) => (a.rotation.x = -0.9 + (i ? Math.sin(t * 16) * 0.5 : 0)));
          torso.rotation.x = Math.sin(t * 8) * 0.1;
          torso.position.y = Math.abs(Math.sin(t * 8)) * 0.04;
          break;
        case 'point':
        case 'crack':
          arms[1] && (arms[1].rotation.x = -1.6 + (anim === 'crack' ? Math.sin(t * 20) * 0.5 : 0));
          break;
        case 'cheer':
          torso.position.y = Math.abs(Math.sin(t * 8)) * 0.15;
          arms.forEach((a, i) => (a.rotation.z = s(i) * 2.8));
          break;
        case 'offer':
          arms.forEach((a) => (a.rotation.x = -1.3));
          break;
        case 'think':
          arms[1] && (arms[1].rotation.x = -2.2);
          break;
        default:
          torso.position.y = Math.sin(t * 2) * 0.01;
      }
    },
    setBlush() {},
    setEmote(e: Emote) {
      const g = emoteSprite.c.getContext('2d')!;
      g.clearRect(0, 0, 64, 64);
      emoteSprite.s.visible = !!e;
      if (!e) return;
      g.font = '900 44px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = e === 'anger' ? '#ff2e2e' : e === 'hearts' ? '#ff4fa8' : '#3b2146';
      g.fillText(e === 'anger' ? '#' : e === 'hearts' ? '♥' : e === 'sweat' ? '~' : e === 'music' ? '♪' : e === 'stars' ? '*' : 'z', 32, 34);
      emoteSprite.tex.needsUpdate = true;
    },
    faceTowards(p) {
      root.rotation.y = Math.atan2(p.x - root.position.x, p.z - root.position.z);
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of materials) m.dispose();
      root.removeFromParent();
    },
  };
}

export function createFakeFactory(): CharacterFactory {
  return {
    human(id: HumanId): CharacterRig {
      const look = HUMANS[id];
      const root = new THREE.Group();
      const torso = new THREE.Group();
      root.add(torso);
      const materials: THREE.Material[] = [];
      const geos: THREE.BufferGeometry[] = [];
      const mk: MeshMaker = (geo, color, x, y, z, o = {}) => {
        const m = new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.45, metalness: o.metal ?? 0 });
        materials.push(m);
        geos.push(geo);
        const mesh = new THREE.Mesh(geo, m);
        mesh.position.set(x, y, z);
        mesh.castShadow = true;
        torso.add(mesh);
        return mesh;
      };
      const H = look.height;
      const w = look.width;
      mk(new THREE.CapsuleGeometry(w, H * 0.42, 6, 14), look.body, 0, H * 0.5, 0);
      mk(new THREE.SphereGeometry(0.17, 18, 14), look.head, 0, H - 0.17, 0);
      // ojos (para ver la orientación)
      mk(new THREE.SphereGeometry(0.025, 8, 6), '#3b2146', -0.06, H - 0.15, 0.15);
      mk(new THREE.SphereGeometry(0.025, 8, 6), '#3b2146', 0.06, H - 0.15, 0.15);
      mk(new THREE.SphereGeometry(0.03, 8, 6), '#ff9eb8', -0.1, H - 0.21, 0.13);
      mk(new THREE.SphereGeometry(0.03, 8, 6), '#ff9eb8', 0.1, H - 0.21, 0.13);
      const arms: THREE.Object3D[] = [];
      for (const sx of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(sx * (w + 0.06), H * 0.72, 0);
        torso.add(pivot);
        const m = new THREE.MeshStandardMaterial({ color: look.body, roughness: 0.45 });
        const g = new THREE.CapsuleGeometry(0.06, H * 0.26, 4, 8);
        materials.push(m);
        geos.push(g);
        const arm = new THREE.Mesh(g, m);
        arm.position.y = -H * 0.16;
        arm.castShadow = true;
        pivot.add(arm);
        arms.push(pivot);
      }
      const legs: THREE.Object3D[] = [];
      for (const sx of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(sx * w * 0.45, H * 0.3, 0);
        torso.add(pivot);
        legs.push(pivot);
      }
      look.extra?.(torso, mk);
      return makeRig(root, H, { arms, torso, legs }, materials, geos);
    },
    animal(id: AnimalModelId, opts?: { cone?: boolean; shaved?: boolean }): CharacterRig {
      const a = ANIMALS[id];
      const root = new THREE.Group();
      const torso = new THREE.Group();
      root.add(torso);
      const materials: THREE.Material[] = [];
      const geos: THREE.BufferGeometry[] = [];
      const mk = (geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number, o: { opacity?: number } = {}) => {
        const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, transparent: o.opacity !== undefined, opacity: o.opacity ?? 1 });
        materials.push(m);
        geos.push(geo);
        const mesh = new THREE.Mesh(geo, m);
        mesh.position.set(x, y, z);
        mesh.castShadow = true;
        torso.add(mesh);
        return mesh;
      };
      const r = a.h * 0.32;
      const body = mk(new THREE.CapsuleGeometry(r, a.len, 6, 12), a.color, 0, a.h * 0.62, 0);
      body.rotation.x = Math.PI / 2;
      const hz = a.len / 2 + r * 0.9;
      const hr = r * 1.05;
      mk(new THREE.SphereGeometry(hr, 14, 10), a.color, 0, a.h * 0.82, hz);
      mk(new THREE.SphereGeometry(hr * 0.18, 8, 6), '#3b2146', -hr * 0.4, a.h * 0.88, hz + hr * 0.85);
      mk(new THREE.SphereGeometry(hr * 0.18, 8, 6), '#3b2146', hr * 0.4, a.h * 0.88, hz + hr * 0.85);
      mk(new THREE.SphereGeometry(hr * 0.2, 8, 6), '#3b2146', 0, a.h * 0.78, hz + hr);
      for (const sx of [-1, 1]) {
        if (a.ear === 'up') mk(new THREE.ConeGeometry(hr * 0.4, hr * 0.9, 6), a.color, sx * hr * 0.55, a.h * 0.82 + hr, hz);
        else if (a.ear === 'long') mk(new THREE.CapsuleGeometry(hr * 0.18, hr * 1.4, 4, 6), a.color, sx * hr * 0.3, a.h * 0.82 + hr * 1.3, hz - 0.02);
        else mk(new THREE.SphereGeometry(hr * 0.45, 8, 6), a.color, sx * hr * 0.9, a.h * 0.78, hz);
      }
      const legs: THREE.Object3D[] = [];
      for (const [lx, lz] of [
        [-1, 1],
        [1, 1],
        [-1, -1],
        [1, -1],
      ]) {
        const pivot = new THREE.Group();
        pivot.position.set(lx * r * 0.6, a.h * 0.45, lz * a.len * 0.4);
        torso.add(pivot);
        const g = new THREE.CapsuleGeometry(r * 0.28, a.h * 0.3, 4, 6);
        const m = new THREE.MeshStandardMaterial({ color: a.color, roughness: 0.6 });
        geos.push(g);
        materials.push(m);
        const leg = new THREE.Mesh(g, m);
        leg.position.y = -a.h * 0.25;
        leg.castShadow = true;
        pivot.add(leg);
        legs.push(pivot);
      }
      mk(new THREE.CapsuleGeometry(r * 0.15, a.len * 0.4, 4, 6), a.color, 0, a.h * 0.8, -a.len / 2 - r * 0.6).rotation.x = -0.8;
      if (opts?.cone) {
        const c = mk(new THREE.CylinderGeometry(hr * 2.1, hr * 1.1, hr * 1.4, 16, 1, true), '#ffffff', 0, a.h * 0.82, hz - hr * 0.1, { opacity: 0.7 });
        c.rotation.x = Math.PI / 2;
        (c.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      }
      return makeRig(root, a.h + hr, { torso, legs }, materials, geos);
    },
  };
}

// ───────────────────────── audio mudo ─────────────────────────

export function createFakeAudio(log = false): AudioAPI {
  let t0 = performance.now();
  return {
    unlock: async () => {},
    play: (name) => log && console.log('[sfx]', name),
    loop: (name) => {
      if (log) console.log('[loop]', name);
      return { set() {}, stop() {} };
    },
    setMusic: () => {},
    beat: {
      bpm: 110,
      phase: () => (((performance.now() - t0) / 1000) * (110 / 60)) % 1,
      timeToNextBeat: () => 0.3,
      beatIndex: () => Math.floor(((performance.now() - t0) / 1000) * (110 / 60)),
    },
    setVitals: () => {},
    voice: () => {},
    applySettings: () => {},
    dispose: () => {
      t0 = 0;
    },
  };
}

// ───────────────────────── diálogo mínimo ─────────────────────────

const FAULTS: FaultKind[] = ['vesselCut', 'thermalNecrosis', 'plunge', 'contaminatedImplant', 'iatrogenicFissure', 'char', 'overRetraction', 'strippedScrew', 'cordTouch', 'noTouchViolation', 'screwDropped', 'tightBandage', 'wrongPlate', 'malalignment', 'offPath'];
const CHAOS: ChaosEventKind[] = ['rodrigoSolo', 'gigiSelfie', 'fritzTremorSpike', 'panchitoIntrusion', 'valerioGaze', 'braulioFoil', 'hortensiaCall'];

export function createFakeDialogue(): DialogueBank {
  const tone = (kind: string[], domina: string[], firm: string[]) => ({ kind, domina, firmSweet: firm });
  return {
    commands: {
      rodrigo: tone(['Rodrigo, cielo, ¿me rasuras al paciente?'], ['Rodrigo. Máquina. Ahora.'], ['Rodrigo, rasura, por favor.']),
      fritz: tone(['Fritz, ¿esterilizas un juego? Tú puedes.'], ['Fritz. Autoclave. Ya.'], ['Fritz, al autoclave.']),
      gigi: tone(['Gigi, ¿me ayudas con los consentimientos?'], ['Gigi. Suelta el móvil. Mostrador.'], ['Gigi, mostrador, gracias.']),
    },
    replies: {
      rodrigo: { kind: ['¡Rasurado en re menor, jefa!'], domina: ['¡Sí, señora!'], firmSweet: ['Voy.'], ignored: ['¿Ahora?'] },
      fritz: { kind: ['C-claro, doctora. Con cuidadito.'], domina: ['¡S-sí! ¡Ya voy! ¡Ay!'], firmSweet: ['Voy.'], ignored: ['¿Eh?'] },
      gigi: { kind: ['Sí, sí, ya voy'], domina: ['¡Uy, qué intensa! Voy.'], firmSweet: ['Okey.'], ignored: ['Espérame que termino este TikTok, ¿sí?'] },
    },
    chaos: Object.fromEntries(CHAOS.map((k) => [k, { speaker: 'sistema', start: ['¡Caos!'], end: ['Fin del caos.'] }])) as DialogueBank['chaos'],
    valerio: {
      gaze: ['Le observo.'],
      praise: ['Correcto.'],
      fault: Object.fromEntries(FAULTS.map((f) => [f, ['Mal.']])) as DialogueBank['valerio']['fault'],
      phaseDone: ['Siguiente.'],
      audit: { S: ['Bien.'], A: ['Bien.'], B: ['Aceptable.'], C: ['Mejorable.'], F: ['No.'] },
      component: { T: ['T'], E: ['E'], H: ['H'], S: ['S'], L: ['L'], t: ['t'] },
      takeover: ['Me encargo yo.'],
      finalRespect: 'Buen trabajo, doctora.',
    },
    emiliana: { crisis: ['Perdón...'], relief: ['Gracias, amor.'], perfect: ['¡Perfecto!'], fault: ['Uy.'], start: ['Vamos.'], win: ['¡Lo logramos!'], breathing: ['Respira.'] },
    partnerMessages: ['Buena niña. Te quiero, {nombre}.'],
    rodrigo: { idle: ['¿Alguien quiere oír mi solo nuevo?', 'Esta clínica necesita más distorsión.'], groove: ['¡Groove!'] },
    fritz: { drop: ['¡No!'], catch: ['¡Lo tengo!'], nervous: ['¿Y si el autoclave explota? No explota, ¿verdad?', 'Tengo las manos tranquilas. Casi.'] },
    gigi: { filming: ['¡Hola, mis huesitos! Hoy en la clínica...', 'Día en la vida de una vet influencer.'], viral: ['¡Viral!'], leave: ['Me salgo.'] },
    owners: {
      hortensia: { waiting: ['¿Por qué tarda tanto? ¡Merengue sufre!', '¡Es lo único que me queda, doctora!'], calm: ['Ay, gracias, doctora. Ya respiro.'], upset: ['¡Exijo hablar con el Dr. Valerio!'] },
      braulio: { waiting: ['Este wifi me está leyendo la mente.'], calm: ['Usted sí es de confianza, doctora.'], upset: ['¡Esto es una conspiración!'] },
      generic: { waiting: ['¿Falta mucho?', 'Mi perrito se está impacientando.'], calm: ['¡Gracias, doctora!'], upset: ['Llevo una hora aquí...'] },
    },
    cpr: { start: ['¡RCP!'], clear: ['¡Despejen!'], rosc: ['¡Pulso!'], fail: ['No...'] },
    tutorialHints: {},
  };
}

// ───────────────────────── ajustes, guardado y efectos ─────────────────────────

export function fakeSettings(): Settings {
  return {
    difficulty: 'especialista',
    goreLevel: 60,
    pastelMode: false,
    tremorScale: 1,
    rhythmWindowScale: 1,
    reduceFlashes: false,
    subtitles: true,
    tts: false,
    masterVolume: 1,
    musicVolume: 0.7,
    sfxVolume: 1,
    asmrVolume: 0.8,
    immersive: false,
    adaptiveDirector: true,
    colorblind: 'none',
  };
}

export function fakeEffects(o: Partial<BoutiqueEffects> = {}): BoutiqueEffects {
  return { messageDurationSec: 20, noSlip: false, extraSlot: false, dominaCost: 15, handcuffsAutoSuction: false, lowConcTremorMult: 1, teamMoraleBonus: 0, ...o };
}

export function fakeSave(): SaveData {
  return {
    version: 1,
    coins: 0,
    reputation: 0,
    lastRanks: [],
    completed: {},
    owned: [],
    equipped: [],
    settings: fakeSettings(),
    partner: { name: 'Sol', pronoun: 'ella' },
    viralClips: 0,
    unlockedWeek: 7,
    seenIntro: true,
  };
}

// ───────────────────────── casos de ejemplo ─────────────────────────

const ANATOMY: AnatomyDef = {
  region: 'antebrazo',
  boneStatic: [
    [
      { x: 18, y: 42 },
      { x: 30, y: 45 },
      { x: 88, y: 46 },
      { x: 91, y: 49 },
      { x: 89, y: 53 },
      { x: 30, y: 54 },
      { x: 18, y: 58 },
    ],
    [
      { x: 22, y: 60 },
      { x: 88, y: 58 },
      { x: 90, y: 61 },
      { x: 22, y: 64 },
    ],
  ],
  fragments: [
    {
      id: 'distal',
      label: 'Fragmento distal',
      polygon: [
        { x: -20, y: -5 },
        { x: 18, y: -4 },
        { x: 26, y: -8 },
        { x: 26, y: 9 },
        { x: 18, y: 5 },
        { x: -20, y: 4 },
      ],
      start: { pos: { x: 116, y: 53 }, angleDeg: 9 },
      target: { pos: { x: 112, y: 50 }, angleDeg: 0 },
    },
  ],
  window: [
    { x: 20, y: 34 },
    { x: 140, y: 34 },
    { x: 140, y: 66 },
    { x: 20, y: 66 },
  ],
  skinTone: '#f3c9b6',
  furColor: '#e0b27a',
};

function baseCase(): CaseDef {
  return {
    id: 'dev-panchito',
    index: 0,
    week: 0,
    patient: { name: 'Panchito', species: 'dog', animal: 'chihuahua', breed: 'Chihuahua', weightKg: 2.1, ageText: '3 años' },
    owner: { name: 'Don Braulio', human: 'braulio' },
    diagnosis: 'Fractura distal de radio y cúbito',
    procedure: 'Miniplaca bloqueada',
    difficulty: 1,
    feeHC: 100,
    requiredReputation: 0,
    newMechanic: 'Tutorial',
    targetTimeSec: 600,
    anatomy: ANATOMY,
    phases: [],
    clinic: {
      complaint: 'Saltó del sofá persiguiendo un dron del gobierno y ya no apoya la patita. El dron sigue ahí, doctora.',
      tests: ['crepitus', 'xray'],
      keyTest: 'xray',
      xrayLesion: { u: 0.575, v: 0.5, radius: 0.07 },
      diagnosisOptions: ['Fractura distal de radio y cúbito', 'Luxación de codo', 'Esguince leve de carpo'],
      correctDiagnosis: 0,
      explanations: {
        absurd: 'Don Braulio, el radio de Panchito es un fideo seco: con yeso solo no pega. Le pondremos una placa del tamaño de un clip. Sin antena, lo juro.',
        technical: 'Fractura transversa distal de radio y cúbito; en razas toy la coaptación sola conlleva alto riesgo de no unión: miniplaca bloqueada de 1,5 mm.',
        evasive: 'Se torció la patita, nada grave. Usted tranquilo. ¿Un cafecito?',
      },
      minorCases: 1,
      ownerTemper: 'paranoid',
    },
    chaos: [],
    valerioChallenges: [],
    education: { title: 'Radio', facts: ['Dato'], disclaimer: 'Aproximado' },
    flags: { tutorial: true, fritzNoTremor: true },
    intro: [],
    outro: [],
  };
}

/** Variantes para probar: 0 tutorial (Braulio), 1 gata con tórax obligatorio, 2 Hortensia histérica, 4 Rodrigo dueño + aluminio. */
export function fakeCase(variant: number): CaseDef {
  const c = baseCase();
  if (variant === 1) {
    return {
      ...c,
      id: 'dev-duquesa',
      index: 1,
      week: 1,
      patient: { name: 'Duquesa', species: 'cat', animal: 'cat', breed: 'Gata común', weightKg: 4, ageText: '5 años' },
      owner: { name: 'Marisol, vecina de Gigi', human: 'ownerA' },
      anatomy: { ...ANATOMY, furColor: '#f2a65a' },
      clinic: {
        ...c.clinic,
        complaint: 'Se tiró del sexto piso persiguiendo una paloma. Cayó de pie, como en las películas, pero ya no se para.',
        tests: ['thoracicXray', 'xray', 'crepitus'],
        requiredTests: ['thoracicXray'],
        diagnosisOptions: ['Fractura conminuta de fémur (gato paracaidista)', 'Luxación de cadera', 'Contusión muscular sin fractura'],
        minorCases: 2,
        ownerTemper: 'anxious',
      },
      chaos: ['rodrigoSolo', 'panchitoIntrusion'],
      flags: {},
    };
  }
  if (variant === 2) {
    return {
      ...c,
      id: 'dev-merengue',
      index: 2,
      week: 2,
      patient: { name: 'Merengue', species: 'dog', animal: 'poodle', breed: 'Caniche toy', weightKg: 3.5, ageText: '9 meses' },
      owner: { name: 'Doña Hortensia', human: 'hortensia' },
      anatomy: { ...ANATOMY, furColor: '#fff4f8' },
      clinic: {
        ...c.clinic,
        complaint: '¡Merengue cojea de la patita de atrás y llora si le toco la cadera! ¡Es lo único que me queda, doctora!',
        tests: ['hipPalpation', 'xray', 'crepitus'],
        keyTest: 'xray',
        xrayLesion: { u: 0.2, v: 0.48, radius: 0.07 },
        diagnosisOptions: ['Enfermedad de Legg-Calvé-Perthes', 'Luxación patelar medial', 'Displasia de cadera del adulto'],
        explanations: {
          absurd: 'A Merengue se le quedó sin riego la cabeza del fémur, como una maceta olvidada. Se la quitamos y su cuerpo arma una articulación nueva. Moño incluido.',
          technical: 'Necrosis avascular de la cabeza femoral. Indicamos ostectomía de cabeza y cuello femoral; se formará una pseudoartrosis fibrosa.',
          evasive: 'Es cosa de la edad, de la cadera y un poquito de la vida. Tómese esta tila.',
        },
        minorCases: 2,
        ownerTemper: 'hysterical',
      },
      chaos: ['rodrigoSolo', 'hortensiaCall'],
      flags: {},
    };
  }
  if (variant === 4) {
    return {
      ...c,
      id: 'dev-chorizo',
      index: 4,
      week: 4,
      patient: { name: 'Chorizo', species: 'dog', animal: 'dachshund', breed: 'Teckel', weightKg: 7, ageText: '5 años' },
      owner: { name: 'Rodrigo', human: 'rodrigo' },
      anatomy: { ...ANATOMY, furColor: '#8a4b2a' },
      clinic: {
        ...c.clinic,
        complaint: 'Jefa... Chorizo no mueve las patas de atrás. No puedo ni tocar la guitarra.',
        tests: ['deepPain', 'xray', 'drawer', 'patella', 'carpusStress'],
        keyTest: 'deepPain',
        diagnosisOptions: ['Hernia discal Hansen tipo I (T13–L1)', 'Fractura de pelvis', 'Embolia fibrocartilaginosa'],
        minorCases: 2,
        ownerTemper: 'anxious',
      },
      chaos: ['braulioFoil', 'panchitoIntrusion'],
      flags: { rodrigoNoSolos: true },
    };
  }
  return c;
}
