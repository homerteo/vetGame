/**
 * Dobles de prueba para la herida y la escena (dev pages y pruebas).
 * Implementaciones mínimas pero coherentes de BoneAPI, BleedingAPI, BloodPoolAPI y CharacterFactory,
 * más una anatomía y un caso de ejemplo (fractura de radio y cúbito).
 */
import * as THREE from 'three';
import type {
  AnatomyDef,
  AnimalModelId,
  BleedType,
  Bleeder,
  BleedingAPI,
  BloodPoolAPI,
  BoneAPI,
  CaseDef,
  CharacterAnim,
  CharacterFactory,
  CharacterRig,
  Emote,
  FragmentState,
  HumanId,
  ImplantState,
  Pose2,
  Settings,
  Vec2,
} from '../../core/contracts';
import { WOUND_H_MM, WOUND_W_MM } from '../../core/constants';
import { angleDiff, applyPosePoly, clamp, dist, pointInPolygon, rectPoly } from '../../core/math';
import { createRng } from '../../core/rng';

// ───────────── Anatomías de ejemplo ─────────────

/** Óvalo redondeado (ventana) como polígono. */
export function roundedWindow(cx: number, cy: number, w: number, h: number, n = 40): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    // Superelipse: bordes rectos y esquinas suaves.
    const c = Math.cos(a);
    const s = Math.sin(a);
    const e = 0.35;
    out.push({ x: cx + (w / 2) * Math.sign(c) * Math.pow(Math.abs(c), e), y: cy + (h / 2) * Math.sign(s) * Math.pow(Math.abs(s), e) });
  }
  return out;
}

/** Diáfisis ósea con extremos redondeados y ligera curvatura. */
export function boneShaft(x0: number, x1: number, cy: number, thick: number, bow = 1.2, n = 14): Vec2[] {
  const top: Vec2[] = [];
  const bot: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    const b = Math.sin(Math.PI * t) * bow;
    const flare = 1 + 0.25 * Math.pow(Math.abs(t - 0.5) * 2, 3);
    top.push({ x, y: cy - (thick / 2) * flare - b });
    bot.push({ x, y: cy + (thick / 2) * flare - b });
  }
  return [...top, ...bot.reverse()];
}

export function sampleAnatomy(): AnatomyDef {
  const distal = boneShaft(-22, 22, 0, 10, 0.6);
  return {
    region: 'Radio distal',
    boneStatic: [boneShaft(22, 84, 50, 10.5, 1.1)],
    fragments: [
      {
        id: 'distal',
        label: 'Fragmento distal',
        polygon: distal,
        start: { pos: { x: 110, y: 55 }, angleDeg: 13 },
        target: { pos: { x: 106.5, y: 49.4 }, angleDeg: 0 },
        kind: 'bone',
      },
      {
        id: 'esquirla',
        label: 'Esquirla',
        polygon: [
          { x: -4, y: -2 },
          { x: 3.5, y: -2.6 },
          { x: 4.2, y: 1.8 },
          { x: -2.5, y: 2.4 },
        ],
        start: { pos: { x: 86, y: 59 }, angleDeg: -18 },
        noTouch: true,
        kind: 'bone',
      },
    ],
    window: roundedWindow(80, 50, 104, 32),
    skinTone: '#f3b9b2',
    furColor: '#d9a066',
  };
}

export function sampleSpineAnatomy(): AnatomyDef {
  return {
    region: 'Columna T13–L1',
    boneStatic: [rectPoly(56, 44, 44, 16, 0), rectPoly(104, 44, 44, 16, 0)],
    fragments: [
      {
        id: 'disco',
        label: 'Material discal',
        polygon: roundedWindow(0, 0, 9, 5, 16),
        start: { pos: { x: 80, y: 58 }, angleDeg: 0 },
        kind: 'disc',
      },
    ],
    cord: roundedWindow(80, 57, 110, 9, 30),
    window: roundedWindow(80, 50, 110, 34),
    skinTone: '#e9b8a4',
    furColor: '#7a4a2a',
  };
}

export function sampleClosedAnatomy(): AnatomyDef {
  return {
    region: 'Tibia',
    boneStatic: [boneShaft(24, 78, 50, 7, 0.8)],
    fragments: [
      {
        id: 'distal',
        label: 'Tibia distal',
        polygon: boneShaft(-26, 26, 0, 6.5, 0.5),
        start: { pos: { x: 106, y: 54 }, angleDeg: 10 },
        target: { pos: { x: 104, y: 49.6 }, angleDeg: 0 },
      },
    ],
    window: roundedWindow(80, 50, 110, 30),
    skinTone: '#f7cfd0',
    furColor: '#f4f1ee',
    closed: true,
  };
}

export const SAMPLE_INCISION: Vec2[] = [
  { x: 28, y: 50 },
  { x: 55, y: 49 },
  { x: 80, y: 50 },
  { x: 105, y: 51 },
  { x: 132, y: 50 },
];

export function fakeSettings(over: Partial<Settings> = {}): Settings {
  return {
    difficulty: 'especialista',
    goreLevel: 70,
    pastelMode: false,
    tremorScale: 1,
    rhythmWindowScale: 1,
    reduceFlashes: false,
    subtitles: true,
    tts: false,
    masterVolume: 1,
    musicVolume: 0.7,
    sfxVolume: 1,
    asmrVolume: 1,
    immersive: false,
    adaptiveDirector: true,
    colorblind: 'none',
    ...over,
  };
}

/** Caso mínimo válido para la escena (solo usa paciente, anatomía y flags). */
export function sampleCase(anatomy: AnatomyDef = sampleAnatomy(), over: Partial<CaseDef> = {}): CaseDef {
  return {
    id: 'demo',
    index: 0,
    week: 0,
    patient: { name: 'Panchito', species: 'dog', animal: 'chihuahua', breed: 'Chihuahua', weightKg: 2.1, ageText: '3 años' },
    owner: { name: 'Don Braulio', human: 'braulio' },
    diagnosis: 'Fractura distal de radio y cúbito',
    procedure: 'Miniplaca bloqueada',
    difficulty: 1,
    feeHC: 100,
    requiredReputation: 0,
    newMechanic: 'Demo',
    targetTimeSec: 600,
    anatomy,
    phases: [],
    clinic: {
      complaint: '',
      tests: ['xray'],
      keyTest: 'xray',
      xrayLesion: { u: 0.5, v: 0.5, radius: 0.1 },
      diagnosisOptions: ['a', 'b', 'c'],
      correctDiagnosis: 0,
      explanations: { absurd: '', technical: '', evasive: '' },
      minorCases: 0,
      ownerTemper: 'paranoid',
    },
    chaos: [],
    valerioChallenges: [],
    education: { title: '', facts: [], disclaimer: '' },
    flags: {},
    intro: [],
    outro: [],
    ...over,
  };
}

// ───────────── Hueso ─────────────

export function createFakeBone(anatomy: AnatomyDef): BoneAPI & { setHighlight(id: string, on: boolean): void } {
  const frags: FragmentState[] = anatomy.fragments.map((def) => ({
    id: def.id,
    def,
    pose: { pos: { ...def.start.pos }, angleDeg: def.start.angleDeg },
    locked: !!def.locked,
    removed: false,
    highlighted: false,
  }));
  const implants: ImplantState = { plate: null, screws: [], pins: [], wires: [], bars: [] };
  const byId = (id: string) => frags.find((f) => f.id === id);
  const api = {
    fragments: () => frags,
    fragment: byId,
    worldPolygon(id: string) {
      const f = byId(id);
      return f ? applyPosePoly(f.def.polygon, f.pose) : [];
    },
    targetPolygon(id: string) {
      const f = byId(id);
      return f?.def.target ? applyPosePoly(f.def.polygon, f.def.target) : null;
    },
    staticPolygons: () => anatomy.boneStatic,
    hitTest(p: Vec2, includeLocked = false) {
      for (let i = frags.length - 1; i >= 0; i--) {
        const f = frags[i];
        if (f.removed || (f.locked && !includeLocked)) continue;
        if (pointInPolygon(p, applyPosePoly(f.def.polygon, f.pose))) return f.id;
      }
      return null;
    },
    setPose(id: string, pose: Pose2) {
      const f = byId(id);
      if (f) f.pose = { pos: { ...pose.pos }, angleDeg: pose.angleDeg };
    },
    release(id: string) {
      const f = byId(id);
      if (f) f.locked = false;
    },
    remove(id: string) {
      const f = byId(id);
      if (f) f.removed = true;
    },
    alignmentError(id: string) {
      const f = byId(id);
      if (!f?.def.target) return { mm: 0, deg: 0 };
      return { mm: dist(f.pose.pos, f.def.target.pos), deg: Math.abs(angleDiff(f.pose.angleDeg, f.def.target.angleDeg)) };
    },
    cord: () => anatomy.cord ?? null,
    isOnBone(p: Vec2) {
      if (anatomy.boneStatic.some((poly) => pointInPolygon(p, poly))) return true;
      return frags.some((f) => !f.removed && pointInPolygon(p, applyPosePoly(f.def.polygon, f.pose)));
    },
    plateHolesWorld() {
      const pl = implants.plate;
      if (!pl) return [];
      return applyPosePoly(pl.holesLocal, pl.pose);
    },
    implants,
    setHighlight(id: string, on: boolean) {
      const f = byId(id);
      if (f) f.highlighted = on;
    },
  };
  return api;
}

// ───────────── Sangrado ─────────────

export function createFakeBleeding(): BleedingAPI {
  const list: Bleeder[] = [];
  let next = 1;
  const RATE: Record<BleedType, number> = { capillary: 0.02, venous: 0.06, arterial: 0.15 };
  return {
    spawn(pos, kind, t) {
      const b: Bleeder = { id: next++, pos: { ...pos }, kind, active: true, bornAt: t };
      list.push(b);
      return b;
    },
    seal(id, t, charred) {
      const b = list.find((x) => x.id === id);
      if (b && b.active) {
        b.active = false;
        b.sealedAt = t;
        b.charred = charred;
      }
    },
    list: () => list,
    active: () => list.filter((b) => b.active),
    nearest(p, maxMm) {
      let best: Bleeder | null = null;
      let bd = maxMm;
      for (const b of list) {
        if (!b.active) continue;
        const d = dist(p, b.pos);
        if (d <= bd) {
          bd = d;
          best = b;
        }
      }
      return best;
    },
    emit(dt, t, hr) {
      return list
        .filter((b) => b.active)
        .map((b) => {
          const pulse = b.kind === 'arterial' ? 0.4 + 1.2 * Math.max(0, Math.sin(t * (hr / 60) * Math.PI * 2)) : 1;
          return { bleeder: b, amount: RATE[b.kind] * pulse * dt };
        });
    },
    totalRatePctPerSec: () => list.reduce((s, b) => s + (b.active ? RATE[b.kind] : 0), 0),
  };
}

// ───────────── Charco ─────────────

export interface FakeBloodPool extends BloodPoolAPI {
  /** Rellena la ventana hasta un nivel dado (0..100) con forma orgánica. */
  fillTo(levelPct: number, seed?: number): void;
}

export function createFakeBloodPool(opts: { cols?: number; rows?: number; capacityPctBV?: number; window?: Vec2[] } = {}): FakeBloodPool {
  const cols = opts.cols ?? 64;
  const rows = opts.rows ?? 40;
  const capacity = opts.capacityPctBV ?? 5;
  const grid = new Float32Array(cols * rows);
  const tmp = new Float32Array(cols * rows);
  const win = opts.window ?? null;
  const cellW = WOUND_W_MM / cols;
  const cellH = WOUND_H_MM / rows;
  const inWin = new Uint8Array(cols * rows);
  let winCells = 0;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const p = { x: (i + 0.5) * cellW, y: (j + 0.5) * cellH };
      const inside = win ? pointInPolygon(p, win) : true;
      inWin[j * cols + i] = inside ? 1 : 0;
      if (inside) winCells++;
    }
  // 1 unidad de altura por celda de la ventana llena = capacidad completa.
  const unitsPerPct = winCells / capacity;
  const total = () => {
    let s = 0;
    for (let i = 0; i < grid.length; i++) s += grid[i];
    return s;
  };
  const api: FakeBloodPool = {
    cols,
    rows,
    grid,
    capacityPctBV: capacity,
    add(pos, amount) {
      const ci = clamp(Math.floor(pos.x / cellW), 0, cols - 1);
      const cj = clamp(Math.floor(pos.y / cellH), 0, rows - 1);
      const units = amount * unitsPerPct;
      // Reparto gaussiano 5×5.
      let wsum = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) wsum += Math.exp(-(di * di + dj * dj) / 2);
      for (let dj = -2; dj <= 2; dj++)
        for (let di = -2; di <= 2; di++) {
          const i = ci + di;
          const j = cj + dj;
          if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
          grid[j * cols + i] += (units * Math.exp(-(di * di + dj * dj) / 2)) / wsum;
        }
    },
    suction(pos, radiusMm, maxRate, dt) {
      let removed = 0;
      const budget = maxRate * dt * unitsPerPct;
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++) {
          const d = Math.hypot((i + 0.5) * cellW - pos.x, (j + 0.5) * cellH - pos.y);
          if (d > radiusMm) continue;
          const k = j * cols + i;
          const take = Math.min(grid[k], budget - removed);
          if (take <= 0) continue;
          grid[k] -= take;
          removed += take;
        }
      return removed / unitsPerPct;
    },
    step(dt) {
      // Difusión simple y escurrido fuera de la ventana.
      const k = clamp(dt * 6, 0, 0.24);
      tmp.set(grid);
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++) {
          const c = j * cols + i;
          const l = i > 0 ? tmp[c - 1] : tmp[c];
          const r = i < cols - 1 ? tmp[c + 1] : tmp[c];
          const u = j > 0 ? tmp[c - cols] : tmp[c];
          const d = j < rows - 1 ? tmp[c + cols] : tmp[c];
          grid[c] = tmp[c] + k * (l + r + u + d - 4 * tmp[c]);
          if (!inWin[c]) grid[c] *= 1 - clamp(dt * 1.5, 0, 1);
        }
    },
    levelPct: () => clamp((total() / unitsPerPct / capacity) * 100, 0, 100),
    totalPctBV: () => total() / unitsPerPct,
    clear: () => grid.fill(0),
    fillTo(levelPct, seed = 7) {
      const rng = createRng(seed);
      grid.fill(0);
      const cx = cols * 0.52;
      const cy = rows * 0.52;
      // Manchas orgánicas: varias gaussianas dentro de la ventana, más en el centro (gravedad).
      const blobs = Array.from({ length: 7 }, () => ({
        x: cx + (rng() - 0.5) * cols * 0.5,
        y: cy + (rng() - 0.5) * rows * 0.18,
        r: 3 + rng() * 6,
        a: 0.5 + rng() * 0.8,
      }));
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++) {
          const c = j * cols + i;
          if (!inWin[c]) continue;
          let h = 0;
          for (const b of blobs) h += b.a * Math.exp(-((i - b.x) ** 2 + ((j - b.y) * 1.6) ** 2) / (2 * b.r * b.r));
          grid[c] = h;
        }
      const want = (levelPct / 100) * capacity * unitsPerPct;
      const have = total();
      if (have > 0) for (let i = 0; i < grid.length; i++) grid[i] *= want / have;
    },
  };
  return api;
}

// ───────────── Personajes falsos (cápsulas) ─────────────

const HUMAN_COLORS: Record<HumanId, [string, string]> = {
  emiliana: ['#ff2e93', '#f2c1a0'],
  valerio: ['#f4f4f8', '#e6c4a8'],
  rodrigo: ['#5fb87a', '#c89276'],
  fritz: ['#9fd6f0', '#f7e2d6'],
  gigi: ['#ffb3d9', '#f5d2bb'],
  hortensia: ['#9a6fb0', '#f0cdb6'],
  braulio: ['#8a8f5a', '#d9a988'],
  ownerA: ['#7fa8e0', '#e8c0a0'],
  ownerB: ['#e0b27f', '#c99a7a'],
  ownerC: ['#a0e0c0', '#f0d0b8'],
};

function makeRig(root: THREE.Group, height: number): CharacterRig {
  let anim: CharacterAnim = 'idle';
  let t = Math.random() * 10;
  const body = root.children[0];
  const base = body?.position.y ?? 0;
  return {
    root,
    height,
    setAnim(a) {
      anim = a;
    },
    update(dt) {
      t += dt;
      if (body) body.position.y = base + Math.sin(t * (anim === 'walk' ? 9 : 2)) * 0.01 * height;
    },
    setBlush(_v: number) {},
    setEmote(_e: Emote) {},
    faceTowards(p) {
      const w = new THREE.Vector3();
      root.getWorldPosition(w);
      root.rotation.y = Math.atan2(p.x - w.x, p.z - w.z);
    },
    dispose() {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
      });
    },
  };
}

export function createFakeCharacterFactory(): CharacterFactory {
  const mat = (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45 });
  return {
    human(id) {
      const [c, skin] = HUMAN_COLORS[id];
      const h = id === 'valerio' ? 1.88 : id === 'emiliana' ? 1.62 : 1.72;
      const g = new THREE.Group();
      g.name = `fake-${id}`;
      const r = id === 'emiliana' || id === 'rodrigo' ? 0.17 : 0.14;
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(r, h - 0.62, 6, 16), mat(c));
      body.position.y = (h - 0.62) / 2 + r;
      body.castShadow = true;
      g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), mat(skin));
      head.position.y = h - 0.14;
      head.castShadow = true;
      g.add(head);
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), mat(skin));
      nose.position.set(0, h - 0.14, 0.13);
      g.add(nose);
      return makeRig(g, h);
    },
    animal(id: AnimalModelId, opts?: { cone?: boolean; shaved?: boolean }) {
      const big = id === 'pitbull' || id === 'bordercollie' || id === 'bulldog';
      const s = big ? 1.4 : id === 'chihuahua' || id === 'rabbit' ? 0.8 : 1;
      const fur = id === 'cat' ? '#9a9aa8' : id === 'rabbit' ? '#f4f1ee' : id === 'poodle' ? '#fff4f0' : '#d9a066';
      const g = new THREE.Group();
      g.name = `fake-${id}`;
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.08 * s, 0.22 * s, 6, 14), mat(fur));
      body.rotation.x = Math.PI / 2;
      body.position.y = 0.16 * s;
      g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.075 * s, 18, 14), mat(fur));
      head.position.set(0, 0.22 * s, 0.2 * s);
      g.add(head);
      const snout = new THREE.Mesh(new THREE.SphereGeometry(0.04 * s, 12, 10), mat(opts?.shaved ? '#f3b9b2' : fur));
      snout.position.set(0, 0.2 * s, 0.27 * s);
      g.add(snout);
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.014 * s, 8, 6), mat('#2a1a1f'));
      nose.position.set(0, 0.21 * s, 0.305 * s);
      g.add(nose);
      for (const side of [-1, 1]) {
        const ear = new THREE.Mesh(
          id === 'rabbit' ? new THREE.CapsuleGeometry(0.018 * s, 0.1 * s, 4, 8) : new THREE.ConeGeometry(0.035 * s, 0.07 * s, 10),
          mat(fur),
        );
        ear.position.set(side * 0.045 * s, 0.3 * s, 0.18 * s);
        ear.rotation.z = -side * 0.35;
        g.add(ear);
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.011 * s, 8, 6), mat('#1a1020'));
        eye.position.set(side * 0.03 * s, 0.24 * s, 0.26 * s);
        eye.scale.y = 0.35; // ojos cerrados (anestesia)
        g.add(eye);
      }
      return makeRig(g, 0.32 * s);
    },
  };
}
