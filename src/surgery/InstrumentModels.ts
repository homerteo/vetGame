/**
 * Modelos 3D procedurales del instrumental (estilizados, "juguete de vinilo" + acero).
 * Convención: la punta de trabajo está en el origen y el instrumento se extiende hacia +Y
 * (es decir, apunta a -Y). Unidades en metros, tamaño real aproximado.
 * Las mallas de la punta llevan `userData.tip = true` (la escena las pone incandescentes con el calor).
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { InstrumentId } from '../core/contracts';

export interface InstrumentModelOptions {
  /** Cosmético de la Boutique: orejas de conejo en el taladro. */
  bunnyDrill?: boolean;
  /** Cosmético de la Boutique: mango de gatito en el bisturí. */
  kittenScalpel?: boolean;
}

/** Inclinación (grados respecto a la normal de la herida) con la que se sostiene cada instrumento. */
export const INSTRUMENT_TILT_DEG: Record<InstrumentId, number> = {
  scalpel10: 56,
  scalpel15: 58,
  cautery: 38,
  gelpi: 46,
  weitlaner: 46,
  kern: 36,
  drill: 30,
  saw: 32,
  burr: 32,
  plate: 0,
  screwdriver: 14,
  needleHolder: 40,
  bandage: 25,
  kwire: 40,
  forceps: 40,
  rasp: 40,
  carm: 0,
  hand: 42,
};

/**
 * Escala relativa al mostrarlo en el puntero (los aparatos grandes se reducen para no tapar la herida;
 * la placa se muestra a la misma escala que la herida para coincidir con su dibujo).
 */
export const INSTRUMENT_POINTER_SCALE: Partial<Record<InstrumentId, number>> = {
  // Mangos largos: más pequeños y más verticales (ver INSTRUMENT_TILT_DEG) para no tapar el campo.
  drill: 0.45,
  saw: 0.45,
  burr: 0.55,
  kern: 0.6,
  rasp: 0.72,
  forceps: 0.8,
  needleHolder: 0.85,
  cautery: 0.85,
  kwire: 0.85,
  carm: 0.7,
  hand: 0.62,
  bandage: 0.8,
  plate: 1.25,
};

// ───────────── Materiales ─────────────

function mats() {
  return {
    steel: new THREE.MeshStandardMaterial({ color: '#d7dce6', metalness: 1, roughness: 0.22 }),
    brushed: new THREE.MeshStandardMaterial({ color: '#b9c0cc', metalness: 1, roughness: 0.38 }),
    dark: new THREE.MeshStandardMaterial({ color: '#4a4f5c', metalness: 0.8, roughness: 0.35 }),
    gold: new THREE.MeshStandardMaterial({ color: '#e8c46a', metalness: 1, roughness: 0.25 }),
    titanium: new THREE.MeshStandardMaterial({ color: '#c3c6e6', metalness: 1, roughness: 0.3 }),
    pink: new THREE.MeshPhysicalMaterial({ color: '#ff8fc7', roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.15 }),
    fuchsia: new THREE.MeshPhysicalMaterial({ color: '#ff2e93', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12 }),
    lilac: new THREE.MeshPhysicalMaterial({ color: '#c8a2e8', roughness: 0.35, clearcoat: 0.9, clearcoatRoughness: 0.2 }),
    mint: new THREE.MeshPhysicalMaterial({ color: '#9ff0d0', roughness: 0.33, clearcoat: 1, clearcoatRoughness: 0.15 }),
    cream: new THREE.MeshPhysicalMaterial({ color: '#fff6fb', roughness: 0.4, clearcoat: 0.6 }),
    glove: new THREE.MeshPhysicalMaterial({ color: '#b79cf2', roughness: 0.55, sheen: 0.6, sheenColor: new THREE.Color('#ffffff') }),
    cable: new THREE.MeshStandardMaterial({ color: '#f4f0fa', roughness: 0.6 }),
    thread: new THREE.MeshStandardMaterial({ color: '#7b4df0', roughness: 0.5 }),
    fabric: new THREE.MeshStandardMaterial({ color: '#e7d4fb', roughness: 0.9 }),
    ink: new THREE.MeshStandardMaterial({ color: '#3b2146', roughness: 0.5 }),
  };
}
type Mats = ReturnType<typeof mats>;

/** Material de punta propio (para poder calentarlo sin afectar a otros). */
function tipMat(base: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const m = base.clone();
  m.emissive = new THREE.Color('#000000');
  m.userData.tip = true;
  return m;
}

// ───────────── Primitivas ─────────────

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  if ((mat as THREE.MeshStandardMaterial).userData?.tip) m.userData.tip = true;
  return m;
}

/** Cilindro a lo largo de Y entre y0 e y1. */
function cylY(r0: number, r1: number, y0: number, y1: number, mat: THREE.Material, seg = 16): THREE.Mesh {
  return mesh(new THREE.CylinderGeometry(r1, r0, y1 - y0, seg), mat, 0, (y0 + y1) / 2, 0);
}

/** Cilindro entre dos puntos. */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material, seg = 10): THREE.Mesh {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = mesh(new THREE.CylinderGeometry(r, r, d.length(), seg), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

function rbox(w: number, h: number, d: number, r: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  return mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2)), mat, x, y, z);
}

function tube(points: THREE.Vector3[], r: number, mat: THREE.Material, seg = 48): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points);
  return mesh(new THREE.TubeGeometry(curve, seg, r, 8, false), mat);
}

/** Anilla para los dedos (tijeras, pinzas con cremallera). */
function ring(x: number, y: number, r: number, t: number, mat: THREE.Material): THREE.Mesh {
  const m = mesh(new THREE.TorusGeometry(r, t, 10, 24), mat, x, y, 0);
  return m;
}

/** Brazo articulado (pinzas tipo tijera) desde la punta hasta la anilla pasando por el pivote. */
function scissorArm(tip: THREE.Vector3, pivot: THREE.Vector3, ringC: THREE.Vector3, r: number, m: Mats, handle: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.add(rod(tip, pivot, r * 0.8, m.steel));
  g.add(rod(pivot, ringC, r, handle === m.steel ? m.steel : m.brushed));
  const rg = ring(ringC.x, ringC.y, 0.0085, r * 0.9, handle);
  rg.position.z = ringC.z;
  g.add(rg);
  return g;
}

function heartShape(size: number): THREE.Shape {
  const s = new THREE.Shape();
  const k = size;
  s.moveTo(0, -0.9 * k);
  s.bezierCurveTo(0.9 * k, -0.1 * k, 0.9 * k, 0.8 * k, 0, 0.35 * k);
  s.bezierCurveTo(-0.9 * k, 0.8 * k, -0.9 * k, -0.1 * k, 0, -0.9 * k);
  return s;
}

// ───────────── Constructores por instrumento ─────────────

function scalpel(m: Mats, small: boolean, kitten: boolean): THREE.Group {
  const g = new THREE.Group();
  // Hoja: #10 panzuda, #15 pequeña y fina. Punta en el origen, lomo recto.
  const L = small ? 0.024 : 0.034;
  const belly = small ? 0.0045 : 0.0085;
  const sh = new THREE.Shape();
  sh.moveTo(0, 0);
  sh.quadraticCurveTo(belly * 1.35, L * 0.25, belly, L * 0.75);
  sh.lineTo(belly * 0.55, L);
  sh.lineTo(-0.0012, L);
  sh.lineTo(-0.0014, L * 0.35);
  sh.quadraticCurveTo(-0.0012, L * 0.1, 0, 0);
  const blade = mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.0004, bevelEnabled: false }), tipMat(m.steel));
  blade.position.z = -0.0002;
  g.add(blade);
  // Mango n.º 3 con ranuras de agarre.
  const hb = L + 0.012;
  g.add(rbox(0.0026, 0.012, 0.0022, 0.0008, m.brushed, 0, L + 0.004, 0));
  const handle = rbox(0.0085, 0.11, 0.0032, 0.0014, m.steel, 0, hb + 0.055, 0);
  g.add(handle);
  for (let i = 0; i < 6; i++) g.add(rbox(0.009, 0.0012, 0.0036, 0.0004, m.dark, 0, hb + 0.006 + i * 0.0035, 0));
  // Incrustación rosa con corazón (kawaii).
  g.add(rbox(0.0056, 0.06, 0.0036, 0.0012, kitten ? m.lilac : m.pink, 0, hb + 0.068, 0));
  const heart = mesh(new THREE.ExtrudeGeometry(heartShape(0.0022), { depth: 0.0008, bevelEnabled: false }), m.fuchsia, 0, hb + 0.045, 0.0016);
  g.add(heart);
  if (kitten) {
    // Mango de gatito: orejitas y cara al final.
    const top = hb + 0.11;
    for (const sx of [-1, 1]) {
      const ear = mesh(new THREE.ConeGeometry(0.0022, 0.005, 8), m.lilac, sx * 0.0026, top + 0.002, 0);
      ear.rotation.z = -sx * 0.3;
      g.add(ear);
    }
  }
  return g;
}

function bipolar(m: Mats): THREE.Group {
  const g = new THREE.Group();
  const coat = m.lilac;
  for (const sx of [-1, 1]) {
    const tipA = new THREE.Vector3(sx * 0.0009, 0, 0);
    const mid = new THREE.Vector3(sx * 0.0035, 0.012, 0);
    const back = new THREE.Vector3(sx * 0.0025, 0.12, 0);
    g.add(rod(tipA, mid, 0.0007, tipMat(m.steel)));
    g.add(rod(mid, new THREE.Vector3(sx * 0.0055, 0.06, 0), 0.0016, coat));
    g.add(rod(new THREE.Vector3(sx * 0.0055, 0.06, 0), back, 0.0016, coat));
    // Almohadillas de agarre.
    g.add(rbox(0.0035, 0.02, 0.004, 0.001, m.pink, sx * 0.006, 0.055, 0));
  }
  g.add(rbox(0.008, 0.014, 0.006, 0.002, m.fuchsia, 0, 0.125, 0));
  g.add(tube([new THREE.Vector3(0, 0.13, 0), new THREE.Vector3(0.004, 0.16, 0.01), new THREE.Vector3(0.02, 0.19, 0.03), new THREE.Vector3(0.05, 0.22, 0.02)], 0.0018, m.cable));
  return g;
}

function selfRetainer(m: Mats, rake: boolean): THREE.Group {
  const g = new THREE.Group();
  const pivot = new THREE.Vector3(0, 0.05, 0);
  // En el puntero se muestra cerrado: las dos puntas se juntan en el origen (el punto real del clic).
  // Con las puntas abiertas el jugador apoyaba una de ellas sobre la marca y el clic caía ~10 mm al lado.
  for (const sx of [-1, 1]) {
    const tip = new THREE.Vector3(sx * 0.0014, 0.004, 0);
    const ringC = new THREE.Vector3(-sx * 0.02, 0.1, 0);
    g.add(scissorArm(tip, pivot, ringC, 0.0017, m, m.pink));
    if (rake) {
      // Rastrillo de 3 puntas hacia abajo, convergiendo en la punta.
      for (let k = -1; k <= 1; k++) {
        const base = new THREE.Vector3(sx * 0.0014, 0.004, k * 0.0012);
        g.add(rod(base, new THREE.Vector3(sx * 0.0016, -0.001, k * 0.0012), 0.0006, tipMat(m.steel)));
      }
    } else {
      g.add(rod(tip, new THREE.Vector3(sx * 0.0016, -0.001, 0), 0.0008, tipMat(m.steel)));
    }
  }
  g.add(mesh(new THREE.CylinderGeometry(0.0028, 0.0028, 0.005, 16), m.gold, 0, 0.05, 0).rotateX(Math.PI / 2));
  // Cremallera (trinquete) entre los brazos.
  const bar = rbox(0.036, 0.0022, 0.0022, 0.0008, m.brushed, 0, 0.083, 0);
  g.add(bar);
  for (let i = 0; i < 9; i++) g.add(rbox(0.0012, 0.0016, 0.0024, 0.0003, m.dark, -0.016 + i * 0.004, 0.0845, 0));
  return g;
}

function kern(m: Mats): THREE.Group {
  const g = new THREE.Group();
  const pivot = new THREE.Vector3(0, 0.045, 0);
  for (const sx of [-1, 1]) {
    // Mandíbula curva y dentada.
    const pts = [new THREE.Vector3(sx * 0.001, 0, 0), new THREE.Vector3(sx * 0.009, 0.01, 0), new THREE.Vector3(sx * 0.008, 0.028, 0), new THREE.Vector3(sx * 0.002, 0.045, 0)];
    g.add(tube(pts, 0.0024, tipMat(m.steel), 24));
    for (let k = 0; k < 4; k++) {
      const t = 0.2 + k * 0.17;
      const p = new THREE.CatmullRomCurve3(pts).getPoint(t);
      g.add(mesh(new THREE.ConeGeometry(0.0012, 0.003, 6), m.steel, p.x - sx * 0.002, p.y, 0).rotateZ(sx * Math.PI / 2));
    }
    g.add(rod(pivot, new THREE.Vector3(-sx * 0.016, 0.14, 0), 0.0028, m.brushed));
    g.add(rbox(0.009, 0.05, 0.007, 0.003, m.fuchsia, -sx * 0.014, 0.115, 0).rotateZ(sx * 0.12));
  }
  g.add(mesh(new THREE.CylinderGeometry(0.0038, 0.0038, 0.008, 16), m.gold, 0, 0.045, 0).rotateX(Math.PI / 2));
  // Cremallera.
  g.add(rbox(0.03, 0.003, 0.003, 0.001, m.brushed, 0, 0.13, 0));
  return g;
}

function drill(m: Mats, bunny: boolean): THREE.Group {
  const g = new THREE.Group();
  // Broca canulada con espiral.
  const bitLen = 0.05;
  g.add(cylY(0.0008, 0.0008, 0, bitLen, tipMat(m.steel), 12));
  const helix: THREE.Vector3[] = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    helix.push(new THREE.Vector3(Math.cos(t * 46) * 0.0008, 0.002 + t * bitLen * 0.55, Math.sin(t * 46) * 0.0008));
  }
  g.add(tube(helix, 0.00016, m.dark, 160));
  // Portabrocas.
  g.add(cylY(0.0035, 0.006, bitLen, bitLen + 0.016, m.steel, 20));
  g.add(cylY(0.0065, 0.0065, bitLen + 0.016, bitLen + 0.024, m.dark, 20));
  // Cuerpo del motor y empuñadura de pistola.
  const body = rbox(0.03, 0.085, 0.034, 0.012, m.mint, 0, bitLen + 0.066, 0);
  g.add(body);
  const grip = rbox(0.024, 0.075, 0.03, 0.01, m.mint, 0.038, bitLen + 0.08, 0);
  grip.rotation.z = -1.2;
  g.add(grip);
  g.add(rbox(0.01, 0.018, 0.012, 0.004, m.fuchsia, 0.022, bitLen + 0.05, 0)); // gatillo
  g.add(rbox(0.032, 0.012, 0.036, 0.004, m.pink, 0, bitLen + 0.11, 0)); // batería
  const heart = mesh(new THREE.ExtrudeGeometry(heartShape(0.005), { depth: 0.001, bevelEnabled: false }), m.fuchsia, 0, bitLen + 0.072, 0.017);
  g.add(heart);
  if (bunny) {
    for (const sx of [-1, 1]) {
      const ear = mesh(new THREE.CapsuleGeometry(0.004, 0.022, 4, 10), m.cream, sx * 0.008, bitLen + 0.13, 0);
      ear.rotation.z = -sx * 0.25;
      g.add(ear);
      const inner = mesh(new THREE.CapsuleGeometry(0.0022, 0.016, 4, 8), m.pink, sx * 0.0085, bitLen + 0.131, 0.0022);
      inner.rotation.z = -sx * 0.25;
      g.add(inner);
    }
  }
  return g;
}

function saw(m: Mats): THREE.Group {
  const g = new THREE.Group();
  // Hoja en abanico con dientes.
  const sh = new THREE.Shape();
  const w = 0.011;
  sh.moveTo(-0.0025, 0.022);
  sh.lineTo(-w / 2, 0.0015);
  const teeth = 9;
  for (let i = 0; i <= teeth; i++) {
    const x = -w / 2 + (i / teeth) * w;
    sh.lineTo(x, i % 2 ? 0 : 0.0016);
  }
  sh.lineTo(0.0025, 0.022);
  sh.closePath();
  g.add(mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.0005, bevelEnabled: false }), tipMat(m.steel), 0, 0, -0.00025));
  g.add(cylY(0.004, 0.004, 0.02, 0.026, m.gold, 16));
  // Pieza de mano.
  g.add(cylY(0.007, 0.011, 0.026, 0.05, m.steel, 24));
  g.add(cylY(0.013, 0.013, 0.05, 0.15, m.lilac, 24));
  for (let i = 0; i < 5; i++) g.add(cylY(0.0138, 0.0138, 0.07 + i * 0.012, 0.074 + i * 0.012, m.pink, 24));
  g.add(cylY(0.013, 0.006, 0.15, 0.165, m.dark, 20));
  g.add(tube([new THREE.Vector3(0, 0.165, 0), new THREE.Vector3(0, 0.2, 0.01), new THREE.Vector3(0.02, 0.24, 0.03)], 0.003, m.cable));
  return g;
}

function burr(m: Mats): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.SphereGeometry(0.0022, 16, 12), tipMat(m.gold), 0, 0.0018, 0));
  g.add(cylY(0.0007, 0.0007, 0.002, 0.024, m.steel, 10));
  g.add(cylY(0.0035, 0.006, 0.024, 0.04, m.steel, 20));
  g.add(cylY(0.0065, 0.0075, 0.04, 0.13, m.mint, 24));
  g.add(cylY(0.0076, 0.0076, 0.07, 0.085, m.pink, 24));
  g.add(cylY(0.0075, 0.004, 0.13, 0.14, m.dark, 16));
  g.add(tube([new THREE.Vector3(0, 0.14, 0), new THREE.Vector3(0, 0.18, 0.01), new THREE.Vector3(0.015, 0.22, 0.03)], 0.0025, m.cable));
  return g;
}

/** Placa ósea plana (en el plano XZ, normal +Y) con agujeros. */
function plate(m: Mats): THREE.Group {
  const g = new THREE.Group();
  const L = 0.058;
  const W = 0.0075;
  const sh = new THREE.Shape();
  sh.moveTo(-L / 2 + W / 2, -W / 2);
  sh.lineTo(L / 2 - W / 2, -W / 2);
  sh.absarc(L / 2 - W / 2, 0, W / 2, -Math.PI / 2, Math.PI / 2, false);
  sh.lineTo(-L / 2 + W / 2, W / 2);
  sh.absarc(-L / 2 + W / 2, 0, W / 2, Math.PI / 2, (3 * Math.PI) / 2, false);
  for (const x of [-0.024, -0.015, -0.006, 0.006, 0.015, 0.024]) {
    const h = new THREE.Path();
    h.absellipse(x, 0, 0.0017, 0.0014, 0, Math.PI * 2, false, 0);
    sh.holes.push(h);
  }
  const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.0014, bevelEnabled: true, bevelSize: 0.0004, bevelThickness: 0.0003, bevelSegments: 2 });
  const pm = mesh(geo, m.titanium);
  pm.rotation.x = -Math.PI / 2;
  pm.position.y = 0.0003;
  g.add(pm);
  // Pinza portaplacas corta (se lee como "sostenida" sin tapar la herida).
  g.add(rod(new THREE.Vector3(-0.003, 0.0015, 0), new THREE.Vector3(-0.004, 0.012, 0), 0.0009, m.steel));
  g.add(rod(new THREE.Vector3(0.003, 0.0015, 0), new THREE.Vector3(0.004, 0.012, 0), 0.0009, m.steel));
  g.add(mesh(new THREE.SphereGeometry(0.0022, 12, 8), m.pink, 0, 0.013, 0));
  return g;
}

function screwdriver(m: Mats): THREE.Group {
  const g = new THREE.Group();
  // Tornillo dorado en la punta (rosca insinuada).
  g.add(cylY(0.0004, 0.0013, 0, 0.004, m.gold, 12));
  g.add(cylY(0.0013, 0.0013, 0.004, 0.014, m.gold, 12));
  for (let i = 0; i < 6; i++) g.add(mesh(new THREE.TorusGeometry(0.00135, 0.00028, 6, 16), m.gold, 0, 0.005 + i * 0.0015, 0).rotateX(Math.PI / 2));
  g.add(cylY(0.0026, 0.0016, 0.014, 0.0165, m.gold, 16));
  g.add(cylY(0.0011, 0.0011, 0.0165, 0.07, tipMat(m.steel), 6)); // eje hexagonal
  g.add(cylY(0.0028, 0.005, 0.07, 0.08, m.steel, 18));
  const pts: THREE.Vector2[] = [];
  const prof = [
    [0.005, 0],
    [0.0085, 0.01],
    [0.0095, 0.05],
    [0.0088, 0.075],
    [0.0065, 0.085],
    [0, 0.087],
  ];
  for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
  const handle = mesh(new THREE.LatheGeometry(pts, 24), m.pink, 0, 0.08, 0);
  g.add(handle);
  // Limitador de torque (anillo menta).
  g.add(cylY(0.0098, 0.0098, 0.09, 0.098, m.mint, 24));
  return g;
}

function needleHolder(m: Mats): THREE.Group {
  const g = new THREE.Group();
  const pivot = new THREE.Vector3(0.012, 0.038, 0);
  for (const sx of [-1, 1]) {
    const jaw = new THREE.Vector3(0.012 + sx * 0.0012, 0.018, 0);
    g.add(rod(jaw, pivot, 0.0017, m.steel));
    g.add(rod(pivot, new THREE.Vector3(0.012 - sx * 0.013, 0.13, 0), 0.0019, m.brushed));
    g.add(ring(0.012 - sx * 0.015, 0.14, 0.0085, 0.0017, m.lilac));
  }
  g.add(mesh(new THREE.CylinderGeometry(0.0024, 0.0024, 0.005, 14), m.gold, 0.012, 0.038, 0).rotateX(Math.PI / 2));
  // Aguja curva (3/8 de círculo) con la punta en el origen.
  const needle = mesh(new THREE.TorusGeometry(0.009, 0.00045, 6, 24, Math.PI * 0.75), tipMat(m.steel));
  needle.position.set(0.009, 0.004, 0);
  needle.rotation.z = Math.PI * 0.9;
  g.add(needle);
  // Hilo de sutura violeta.
  // Hilo de sutura violeta: sale del ojo de la aguja y sube pegado a la rama (antes flotaba lejos).
  g.add(
    tube(
      [
        new THREE.Vector3(0.0132, -0.0038, 0),
        new THREE.Vector3(0.0172, 0.004, 0.001),
        new THREE.Vector3(0.0165, 0.02, 0.0025),
        new THREE.Vector3(0.0155, 0.04, 0.003),
        new THREE.Vector3(0.019, 0.062, 0.002),
      ],
      0.00035,
      m.thread,
      60,
    ),
  );
  return g;
}

function bandageRoll(m: Mats): THREE.Group {
  const g = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 32;
  const cg = c.getContext('2d');
  if (cg) {
    cg.fillStyle = '#e7d4fb';
    cg.fillRect(0, 0, 128, 32);
    cg.fillStyle = '#ff8fc7';
    for (let x = 0; x < 128; x += 16) {
      cg.beginPath();
      cg.arc(x + 8, 16, 4, 0, Math.PI * 2);
      cg.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(3, 1);
  const fab = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
  const roll = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.05, 28), fab, 0, 0.04, 0);
  roll.rotation.z = Math.PI / 2;
  g.add(roll);
  g.add(mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.0505, 20), m.cream, 0, 0.04, 0).rotateZ(Math.PI / 2));
  // Tira que cuelga hasta la punta.
  const strip = mesh(new THREE.PlaneGeometry(0.05, 0.028, 1, 6), fab, 0, 0.015, 0.016);
  strip.rotation.x = -0.4;
  g.add(strip);
  return g;
}

function kwireDriver(m: Mats): THREE.Group {
  const g = new THREE.Group();
  g.add(cylY(0.0006, 0.0006, 0, 0.075, tipMat(m.steel), 8));
  g.add(cylY(0.003, 0.005, 0.075, 0.088, m.steel, 18));
  const body = rbox(0.022, 0.07, 0.026, 0.009, m.lilac, 0, 0.12, 0);
  g.add(body);
  const grip = rbox(0.02, 0.06, 0.024, 0.008, m.lilac, 0.03, 0.13, 0);
  grip.rotation.z = -1.15;
  g.add(grip);
  g.add(rbox(0.008, 0.014, 0.01, 0.003, m.mint, 0.018, 0.1, 0));
  return g;
}

function thumbForceps(m: Mats): THREE.Group {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) {
    g.add(rod(new THREE.Vector3(sx * 0.0006, 0, 0), new THREE.Vector3(sx * 0.0025, 0.03, 0), 0.0007, tipMat(m.steel)));
    g.add(rod(new THREE.Vector3(sx * 0.0025, 0.03, 0), new THREE.Vector3(sx * 0.005, 0.1, 0), 0.0012, m.steel));
    g.add(rbox(0.003, 0.03, 0.004, 0.0012, m.pink, sx * 0.0048, 0.07, 0));
  }
  g.add(rbox(0.012, 0.012, 0.004, 0.002, m.brushed, 0, 0.107, 0));
  return g;
}

function rasp(m: Mats): THREE.Group {
  const g = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const cg = c.getContext('2d');
  if (cg) {
    cg.fillStyle = '#b9c0cc';
    cg.fillRect(0, 0, 64, 64);
    cg.strokeStyle = '#5a606c';
    cg.lineWidth = 2;
    for (let i = -64; i < 128; i += 6) {
      cg.beginPath();
      cg.moveTo(i, 0);
      cg.lineTo(i + 64, 64);
      cg.moveTo(i + 64, 0);
      cg.lineTo(i, 64);
      cg.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const teeth = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.9, roughness: 0.45 });
  teeth.userData.tip = true;
  teeth.emissive = new THREE.Color('#000000');
  g.add(rbox(0.008, 0.022, 0.004, 0.001, teeth, 0, 0.011, 0));
  g.add(cylY(0.0018, 0.0018, 0.022, 0.07, m.steel, 12));
  g.add(rbox(0.012, 0.075, 0.012, 0.005, m.mint, 0, 0.11, 0));
  for (let i = 0; i < 4; i++) g.add(rbox(0.0125, 0.003, 0.0125, 0.001, m.pink, 0, 0.085 + i * 0.012, 0));
  return g;
}

function carm(m: Mats): THREE.Group {
  const g = new THREE.Group();
  // Arco en C en miniatura: el haz pasa por el origen (emisor bajo el plano, detector encima).
  const R = 0.06;
  const arc = mesh(new THREE.TorusGeometry(R, 0.0065, 12, 48, Math.PI), m.cream);
  arc.rotation.z = Math.PI / 2; // la C se abre hacia +X
  g.add(arc);
  // Detector (arriba) y emisor (abajo).
  g.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.014, 32), m.lilac, 0, R, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.015, 32), m.mint, 0, R - 0.001, 0));
  g.add(rbox(0.03, 0.02, 0.03, 0.006, m.lilac, 0, -R, 0));
  // Soporte trasero del arco.
  g.add(rbox(0.02, 0.03, 0.02, 0.006, m.pink, -R - 0.01, 0, 0));
  g.add(rod(new THREE.Vector3(-R - 0.02, 0, 0), new THREE.Vector3(-R - 0.06, 0.02, 0), 0.005, m.brushed));
  const sticker = mesh(new THREE.ExtrudeGeometry(heartShape(0.007), { depth: 0.002, bevelEnabled: false }), m.fuchsia, -R - 0.003, 0.03, 0.006);
  g.add(sticker);
  // Haz tenue.
  const beam = mesh(
    new THREE.CylinderGeometry(0.016, 0.01, R * 2 - 0.02, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: '#9ff0d0', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
  );
  beam.castShadow = false;
  g.add(beam);
  return g;
}

function glovedHand(m: Mats): THREE.Group {
  const g = new THREE.Group();
  // Índice extendido con la yema en el origen.
  const finger = (x: number, y0: number, len: number, bend: number, r = 0.0078) => {
    const f = mesh(new THREE.CapsuleGeometry(r, len, 6, 12), m.glove, x, y0 + len / 2 + r, 0);
    f.rotation.x = bend;
    return f;
  };
  g.add(finger(0, 0, 0.05, 0));
  g.add(finger(0.019, 0.035, 0.03, -0.9, 0.0082));
  g.add(finger(0.036, 0.04, 0.026, -1.1, 0.0078));
  g.add(finger(0.05, 0.045, 0.02, -1.2, 0.007));
  const palm = rbox(0.07, 0.07, 0.03, 0.013, m.glove, 0.024, 0.098, -0.004);
  g.add(palm);
  const thumb = mesh(new THREE.CapsuleGeometry(0.0085, 0.032, 6, 12), m.glove, -0.017, 0.085, 0.008);
  thumb.rotation.z = 0.9;
  g.add(thumb);
  // Puño del guante con ribete rosa.
  g.add(rbox(0.074, 0.03, 0.036, 0.012, m.glove, 0.024, 0.15, -0.004));
  g.add(rbox(0.078, 0.006, 0.04, 0.003, m.pink, 0.024, 0.165, -0.004));
  return g;
}

/**
 * Crea el modelo 3D de un instrumento con la punta en el origen apuntando a -Y.
 * `opts` permite los cosméticos de la Boutique (opcional).
 */
export function createInstrumentModel(id: InstrumentId, opts: InstrumentModelOptions = {}): THREE.Object3D {
  const m = mats();
  let g: THREE.Group;
  switch (id) {
    case 'scalpel10':
      g = scalpel(m, false, !!opts.kittenScalpel);
      break;
    case 'scalpel15':
      g = scalpel(m, true, !!opts.kittenScalpel);
      break;
    case 'cautery':
      g = bipolar(m);
      break;
    case 'gelpi':
      g = selfRetainer(m, false);
      break;
    case 'weitlaner':
      g = selfRetainer(m, true);
      break;
    case 'kern':
      g = kern(m);
      break;
    case 'drill':
      g = drill(m, !!opts.bunnyDrill);
      break;
    case 'saw':
      g = saw(m);
      break;
    case 'burr':
      g = burr(m);
      break;
    case 'plate':
      g = plate(m);
      break;
    case 'screwdriver':
      g = screwdriver(m);
      break;
    case 'needleHolder':
      g = needleHolder(m);
      break;
    case 'bandage':
      g = bandageRoll(m);
      break;
    case 'kwire':
      g = kwireDriver(m);
      break;
    case 'forceps':
      g = thumbForceps(m);
      break;
    case 'rasp':
      g = rasp(m);
      break;
    case 'carm':
      g = carm(m);
      break;
    case 'hand':
    default:
      g = glovedHand(m);
      break;
  }
  g.name = `instrument:${id}`;
  g.userData.instrument = id;
  return g;
}

/** Materiales de punta del modelo (para el brillo por calor). */
export function instrumentTipMaterials(model: THREE.Object3D): THREE.MeshStandardMaterial[] {
  const out = new Set<THREE.MeshStandardMaterial>();
  model.traverse((o) => {
    const mm = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if ((o as THREE.Mesh).isMesh && mm?.userData?.tip) out.add(mm);
  });
  return [...out];
}

/** Libera geometrías, materiales y texturas de un modelo. */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const me = o as THREE.Mesh;
    if (!me.isMesh) return;
    me.geometry?.dispose();
    const list = Array.isArray(me.material) ? me.material : [me.material];
    for (const mat of list) {
      if (!mat) continue;
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
      mat.dispose();
    }
  });
}
