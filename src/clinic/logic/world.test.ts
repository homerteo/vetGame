import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/rng';
import { contaminationOutcome, createContamination, peakContamination, tickContamination } from './contamination';
import { PORTALS, ROOMS, STATIONS, roomAt, zoneOfRoom } from './layout';
import { inPuddle, resolveCollisions, stepBody, wallColliders, type Body } from './movement';
import { findPath, roomRoute } from './nav';
import { catchPanchito, createPanchito, isLoose, panchitoZone, putInCarrier, tackleHits, tickPanchito, type PanchitoEvent } from './panchito';
import { TUNING } from './tuning';

describe('plano y navegación', () => {
  it('cada estación está dentro de una sala', () => {
    for (const s of Object.values(STATIONS)) expect(roomAt(s.pos.x, s.pos.z)).not.toBeNull();
  });

  it('las zonas estériles son quirófano, preparación y autoclave', () => {
    expect(zoneOfRoom('or')).toBe('or');
    expect(zoneOfRoom('waiting')).toBeNull();
    expect(zoneOfRoom(roomAt(STATIONS.orDoor.pos.x, STATIONS.orDoor.pos.z))).toBe('or');
  });

  it('todas las salas se conectan', () => {
    for (const a of Object.keys(ROOMS) as Array<keyof typeof ROOMS>)
      for (const b of Object.keys(ROOMS) as Array<keyof typeof ROOMS>) {
        const r = roomRoute(a, b);
        expect(r[0]).toBe(a);
        expect(r[r.length - 1]).toBe(b);
      }
  });

  it('la ruta del examen al quirófano cruza las puertas correctas', () => {
    const path = findPath({ x: -9, z: -5 }, { x: 8, z: -5 });
    expect(path.length).toBe(7); // 3 puertas × 2 + destino
    expect(path[path.length - 1]).toEqual({ x: 8, z: -5 });
    const doorsX = PORTALS.map((p) => p.x);
    expect(doorsX).toContain(path[0].x);
  });

  it('los puntos de ruta alternan sala sin atravesar tabiques', () => {
    const walls = wallColliders();
    const path = findPath({ x: -9, z: -5 }, { x: 11, z: 6 });
    for (const p of path) {
      const b: Body = { x: p.x, z: p.z, vx: 0, vz: 0, r: 0.2 };
      expect(resolveCollisions(b, walls)).toBe(false);
    }
  });
});

describe('movimiento', () => {
  const opts = {
    maxSpeed: TUNING.player.maxSpeed,
    accel: TUNING.player.accel,
    decel: TUNING.player.decel,
    slipAccelMult: TUNING.player.slipAccelMult,
    slipDecelMult: TUNING.player.slipDecelMult,
    slippery: false,
  };

  it('acelera hasta la velocidad máxima y frena con inercia', () => {
    const b: Body = { x: 0, z: 0, vx: 0, vz: 0, r: 0.3 };
    stepBody(b, 1, 0, 0.1, opts);
    expect(b.vx).toBeCloseTo(TUNING.player.accel * 0.1, 5);
    for (let i = 0; i < 20; i++) stepBody(b, 1, 0, 0.1, opts);
    expect(b.vx).toBeCloseTo(TUNING.player.maxSpeed, 5);
    stepBody(b, 0, 0, 0.1, opts);
    expect(b.vx).toBeGreaterThan(0);
    expect(b.vx).toBeLessThan(TUNING.player.maxSpeed);
  });

  it('en un charco resbala: tarda mucho más en frenar', () => {
    const a: Body = { x: 0, z: 0, vx: 3, vz: 0, r: 0.3 };
    const b: Body = { x: 0, z: 0, vx: 3, vz: 0, r: 0.3 };
    for (let i = 0; i < 5; i++) {
      stepBody(a, 0, 0, 0.1, opts);
      stepBody(b, 0, 0, 0.1, { ...opts, slippery: true });
    }
    expect(a.vx).toBeLessThan(b.vx);
    expect(b.vx).toBeGreaterThan(2.3);
    expect(inPuddle(0, 0, [{ x: 0.2, z: 0, r: 0.5 }])).toBe(true);
    expect(inPuddle(2, 0, [{ x: 0.2, z: 0, r: 0.5 }])).toBe(false);
  });

  it('las paredes empujan hacia fuera y anulan la velocidad contra ellas', () => {
    const b: Body = { x: 0, z: -2.05, vx: 0, vz: 3, r: 0.34 };
    b.x = -6; // tabique norte, lejos de las puertas
    const hit = resolveCollisions(b, wallColliders());
    expect(hit).toBe(true);
    expect(Math.abs(b.z + 2)).toBeGreaterThan(0.34);
    expect(b.vz).toBeLessThanOrEqual(0);
  });

  it('círculos y cajas', () => {
    const b: Body = { x: 0.5, z: 0, vx: -1, vz: 0, r: 0.4 };
    resolveCollisions(b, [{ kind: 'circle', x: 0, z: 0, r: 0.5 }]);
    expect(b.x).toBeCloseTo(0.9, 5);
    expect(b.vx).toBe(0);
    const c: Body = { x: 0.1, z: 0.05, vx: 0, vz: 0, r: 0.3 };
    resolveCollisions(c, [{ kind: 'box', minX: -1, maxX: 1, minZ: -0.2, maxZ: 0.2 }]);
    expect(c.z).toBeCloseTo(0.5, 5);
  });
});

describe('contaminación', () => {
  it('sube con Panchito dentro, más si da vueltas, y baja despacio', () => {
    const s = createContamination();
    for (let i = 0; i < 10; i++) tickContamination(s, 1, 'prep', false, {});
    expect(s.values.prep).toBeCloseTo(TUNING.contamination.rise * 10, 5);
    const z = createContamination();
    for (let i = 0; i < 10; i++) tickContamination(z, 1, 'prep', true, {});
    expect(z.values.prep).toBeGreaterThan(s.values.prep);
    const peak = s.values.prep;
    for (let i = 0; i < 10; i++) tickContamination(s, 1, null, false, {});
    expect(s.values.prep).toBeCloseTo(peak - TUNING.contamination.decay * 10, 5);
    expect(peakContamination(s)).toBeCloseTo(peak, 5);
    expect(contaminationOutcome(s)).toBeCloseTo(s.values.prep, 5);
  });

  it('un asistente trabajando limpia más rápido y avisa al cruzar el 50%', () => {
    const a = createContamination();
    const b = createContamination();
    a.values.autoclave = b.values.autoclave = 0.5;
    tickContamination(a, 10, null, false, {});
    tickContamination(b, 10, null, false, { autoclave: true });
    expect(b.values.autoclave).toBeLessThan(a.values.autoclave);
    const c = createContamination();
    c.values.or = 0.49;
    expect(tickContamination(c, 1, 'or', false, {})).toBe('or');
  });
});

describe('Panchito', () => {
  it('se escapa del transportín y acaba colándose en una zona estéril', () => {
    const rng = createRng(7);
    const p = createPanchito(true, rng);
    const out: PanchitoEvent[] = [];
    const events: PanchitoEvent[] = [];
    let visitedZone = false;
    for (let t = 0; t < 120; t += 0.05) {
      out.length = 0;
      tickPanchito(p, 0.05, rng, out);
      events.push(...out);
      if (panchitoZone(p)) visitedZone = true;
    }
    expect(events).toContain('escape');
    expect(events).toContain('bark');
    expect(visitedZone).toBe(true);
    expect(roomAt(p.x, p.z)).not.toBeNull();
  });

  it('desactivado (tutorial) no se mueve', () => {
    const p = createPanchito(false, createRng(1));
    tickPanchito(p, 100, createRng(1), []);
    expect(p.mode).toBe('off');
    expect(isLoose(p)).toBe(false);
  });

  it('el placaje atrapa dentro del alcance; al transportín vuelve 30–45 s', () => {
    const rng = createRng(2);
    const p = createPanchito(true, rng);
    tickPanchito(p, TUNING.panchito.firstEscapeSec + 0.1, rng, []);
    expect(isLoose(p)).toBe(true);
    expect(tackleHits(p.x + 1.1, p.z, p)).toBe(true);
    expect(tackleHits(p.x + 1.5, p.z, p)).toBe(false);
    catchPanchito(p);
    expect(tackleHits(p.x, p.z, p)).toBe(false);
    const out: PanchitoEvent[] = [];
    tickPanchito(p, TUNING.panchito.wriggleSec + 0.1, rng, out);
    expect(out).toContain('wriggle');
    putInCarrier(p, rng);
    expect(p.timer).toBeGreaterThanOrEqual(30);
    expect(p.timer).toBeLessThanOrEqual(45);
  });
});
