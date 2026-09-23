/*
 * playA-lib.ts — "jugador" automático que opera como un humano: solo eventos reales de ratón
 * (page.mouse) y teclado (page.keyboard). Usa los ganchos de depuración únicamente para LEER
 * (dónde está la guía, qué sangra, qué pide la pista) y para adelantar el tiempo de juego
 * (__game.advance) porque Chromium headless renderiza a ~4 fps.
 * Nunca llama a forceCompleteStep salvo que un paso quede atascado (se registra como "stuck").
 */
import type { Page } from '@playwright/test';
import fs from 'node:fs';

export type Mm = { x: number; y: number };
export interface HudRead {
  head: string;
  checklist: Array<{ label: string; done: boolean }>;
  hint: string;
  gauges: Array<{ label: string; val: string; zone: string }>;
  toasts: string[];
  subs: string[];
  pops: string[];
  alerts: string[];
  pressurePips: number;
}
export interface StepReport {
  label: string;
  type: string;
  startT: number;
  endT: number;
  realMs: number;
  ok: boolean;
  stuck: boolean;
  faults: string[];
  gestures: Array<{ label: string; q: number }>;
  notes: string[];
}

const dist = (a: Mm, b: Mm) => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a: Mm, b: Mm, k: number): Mm => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
const angleDiff = (a: number, b: number) => {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
};

/** Remuestrea una polilínea cada `stepMm`. */
export function resample(path: Mm[], stepMm: number): Mm[] {
  const out: Mm[] = [path[0]];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const n = Math.max(1, Math.ceil(dist(a, b) / stepMm));
    for (let k = 1; k <= n; k++) out.push(lerp(a, b, k / n));
  }
  return out;
}

function pathLen(path: Mm[]) {
  let s = 0;
  for (let i = 0; i < path.length - 1; i++) s += dist(path[i], path[i + 1]);
  return s;
}

/** Punto y normal a una longitud de arco dada. */
function pointAt(path: Mm[], s: number): { p: Mm; n: Mm } {
  let acc = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const l = dist(a, b);
    if (acc + l >= s || i === path.length - 2) {
      const k = Math.max(0, Math.min(1, (s - acc) / (l || 1)));
      const ux = (b.x - a.x) / (l || 1);
      const uy = (b.y - a.y) / (l || 1);
      return { p: lerp(a, b, k), n: { x: -uy, y: ux } };
    }
    acc += l;
  }
  return { p: path[0], n: { x: 0, y: 1 } };
}

function centroid(poly: Mm[]): Mm {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}

export class Player {
  pressure = 3;
  reports: StepReport[] = [];
  observations: string[] = [];
  errors: string[] = [];
  shotN = 0;
  private cur: StepReport | null = null;

  constructor(
    public page: Page,
    public caseIdx: number,
    public outDir: string,
  ) {
    fs.mkdirSync(outDir, { recursive: true });
    page.on('pageerror', (e) => this.errors.push(`pageerror: ${e.message}\n${e.stack ?? ''}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/fonts\.g/.test(m.text())) this.errors.push(`console.error: ${m.text()}`);
    });
  }

  note(s: string) {
    const line = `[case${this.caseIdx} t=${this.lastT.toFixed(1)}] ${s}`;
    this.observations.push(line);
    this.cur?.notes.push(s);
    console.log(line);
  }

  lastT = 0;

  // ── Tiempo y lectura ──
  async adv(sec: number) {
    await this.page.evaluate((s) => (window as any).__game.advance(s), sec);
  }
  /** Espera a que se pinte al menos un fotograma (para que la cámara/proyección estén al día). */
  async frame() {
    await this.page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  }
  async state(): Promise<any> {
    const s = await this.page.evaluate(() => {
      const d = (window as any).__game.surgery();
      return d ? d.state() : { finished: true, step: null, mode: (window as any).__game.mode };
    });
    if (typeof s.t === 'number') this.lastT = s.t;
    return s;
  }
  async params(): Promise<any> {
    return this.page.evaluate(() => JSON.parse(JSON.stringify((window as any).__game.surgery()?.stepParams() ?? null)));
  }
  async eval<T>(fn: string): Promise<T> {
    return this.page.evaluate(fn) as Promise<T>;
  }
  async projMany(mms: Mm[]): Promise<Mm[]> {
    await this.frame();
    return this.page.evaluate((list) => {
      const d = (window as any).__game.surgery();
      return list.map((m: Mm) => d.project(m));
    }, mms);
  }
  async proj(mm: Mm): Promise<Mm> {
    return (await this.projMany([mm]))[0];
  }
  async hud(): Promise<HudRead> {
    return this.page.evaluate(() => {
      const q = (s: string) => Array.from(document.querySelectorAll(s)) as HTMLElement[];
      const t = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
      return {
        head: t(document.querySelector('.prog-head')),
        checklist: q('.prog-check > *').map((e) => ({ label: t(e), done: /done|on|checked/.test(e.className) })),
        hint: t(document.querySelector('.hint-txt')),
        gauges: q('.hud-gauges .gauge').map((e) => ({
          label: t(e.querySelector('.g-lbl')),
          val: t(e.querySelector('.g-val')),
          zone: (e.className.match(/z-(\w+)/) ?? [])[1] ?? '',
        })),
        toasts: q('.hud-toast').map(t),
        subs: q('.hud-sub').map(t),
        pops: q('.hud-pop').map(t),
        alerts: q('.hud-alert').map(t),
        pressurePips: q('.pr-pips .on').length,
      };
    });
  }
  async gauge(label: RegExp): Promise<{ label: string; value: number; zone: string } | null> {
    const h = await this.hud();
    const g = h.gauges.find((x) => label.test(x.label));
    if (!g) return null;
    return { label: g.label, value: Number(g.val.replace(/[^\d,.-]/g, '').replace(',', '.')), zone: g.zone };
  }
  async shot(name: string) {
    await this.frame();
    const p = `${this.outDir}/case${this.caseIdx}-${String(++this.shotN).padStart(2, '0')}-${name}.png`;
    await this.page.screenshot({ path: p, timeout: 90_000 }).catch((e) => this.note(`captura fallida ${p}: ${String(e).slice(0, 80)}`));
    return p;
  }

  // ── Entradas humanas ──
  async moveMm(mm: Mm, steps = 1) {
    const p = await this.proj(mm);
    await this.page.mouse.move(p.x, p.y, { steps });
    return p;
  }
  async clickMm(mm: Mm, button: 'left' | 'right' | 'middle' = 'left') {
    const p = await this.moveMm(mm);
    await this.page.mouse.down({ button });
    await this.adv(0.05);
    await this.page.mouse.up({ button });
    return p;
  }
  async tap(code: string, holdSec = 0) {
    await this.page.keyboard.down(code);
    if (holdSec > 0) await this.adv(holdSec);
    await this.page.keyboard.up(code);
  }
  /** Ajusta la presión con la rueda (sobre el lienzo). Devuelve la lectura del HUD. */
  async setPressure(target: number) {
    let guard = 0;
    while (this.pressure !== target && guard++ < 10) {
      const up = target > this.pressure;
      await this.page.mouse.wheel(0, up ? -100 : 100);
      this.pressure = Math.max(1, Math.min(5, this.pressure + (up ? 1 : -1)));
      await this.adv(0.05);
    }
  }
  /**
   * Arrastre humano: baja el botón en el primer punto y recorre los demás, dejando pasar
   * `dtPerMove` segundos de juego entre movimientos.
   */
  async drag(mms: Mm[], dtPerMove = 0.05, opts: { button?: 'left' | 'right'; keepDown?: boolean; beforeUp?: () => Promise<void> } = {}) {
    const px = await this.projMany(mms);
    await this.page.mouse.move(px[0].x, px[0].y);
    await this.page.mouse.down({ button: opts.button ?? 'left' });
    for (let i = 1; i < px.length; i++) {
      await this.page.mouse.move(px[i].x, px[i].y);
      if (dtPerMove > 0) await this.adv(dtPerMove);
    }
    if (opts.beforeUp) await opts.beforeUp();
    if (!opts.keepDown) await this.page.mouse.up({ button: opts.button ?? 'left' });
  }

  // ── Registro por paso ──
  async logSnapshot(): Promise<{ faults: string[]; gestures: Array<{ label: string; q: number }> }> {
    return this.page.evaluate(() => {
      const c = (window as any).__game.surgery()?.ctx();
      if (!c) return { faults: [], gestures: [] };
      return {
        faults: c.log.faults().slice(),
        gestures: c.log.gestures().map((g: any) => ({ label: g.label, q: Math.round(g.quality * 100) / 100 })),
      };
    });
  }

  blockedCount = 0;
  /**
   * BLOQUEO (arreglado en la ronda de fixes): el intersticial entre fases quedaba montado y se comía los
   * clics sobre la herida. Ahora se espera a que el telón termine; si tras ~4 s sigue encima es BLOQUEO,
   * se registra y se prueba Esc (que ahora abre la pausa; se reanuda con el botón).
   */
  async ensureCanvasClickable() {
    const at = await this.page.evaluate(() => {
      const e = document.elementFromPoint(640, 420);
      return e ? `${e.tagName}.${e.className}` : 'null';
    });
    if (at.startsWith('CANVAS')) return;
    // El telón entre fases es legítimo durante sus segundos: un jugador espera a que se vaya.
    // Solo es BLOQUEO si sigue encima tras ~4 s (de juego y de reloj).
    let still = at;
    for (let i = 0; i < 16 && !still.startsWith('CANVAS'); i++) {
      await this.adv(0.25);
      await this.page.waitForTimeout(250);
      still = await this.page.evaluate(() => {
        const e = document.elementFromPoint(640, 420);
        return e ? `${e.tagName}.${e.className}` : 'null';
      });
    }
    if (still.startsWith('CANVAS')) {
      this.note(`telón entre fases sobre la herida ("${at}"): se fue solo, el canvas vuelve a recibir clics`);
      return;
    }
    this.blockedCount++;
    this.note(`BLOQUEO: el clic en el centro de la herida lo recibe "${at}" (no el canvas). Pulso Esc como salida.`);
    if (this.blockedCount === 1) await this.shot('BLOQUEO-intersticial');
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(300);
    const after = await this.page.evaluate(() => {
      const e = document.elementFromPoint(640, 420);
      const pause = !!document.querySelector('.scr-pause');
      return { at: e ? `${e.tagName}.${e.className}` : 'null', pause };
    });
    this.note(`tras Esc: elemento=${after.at}, pantalla de pausa visible=${after.pause}`);
    if (after.pause) {
      const b = this.page.getByText('Reanudar');
      await b.click();
    }
  }

  /** Reacciona a caos y mensajes como un humano (entre gestos). */
  async housekeeping() {
    await this.ensureCanvasClickable();
    const info = await this.page.evaluate(() => {
      const d = (window as any).__game.surgery();
      if (!d) return null;
      const c = d.ctx();
      return {
        chaos: d.state().chaos as string[],
        pending: c.emiliana.snapshot().message.pending as boolean,
        field: c.blood.levelPct() as number,
        rodSolo: c.crew.rodrigo.isSoloing() as boolean,
      };
    });
    if (!info) return;
    if (info.chaos.length) this.note(`caos activo: ${info.chaos.join(',')}`);
    if (info.chaos.includes('rodrigoSolo')) {
      await this.tap('KeyZ');
      await this.adv(0.4);
    }
    if (info.chaos.includes('gigiSelfie')) {
      await this.tap('KeyC');
      await this.adv(0.4);
    }
    if (info.chaos.includes('panchitoIntrusion')) {
      await this.tap('KeyX');
      await this.adv(0.4);
    }
    if (info.pending) {
      this.note('mensaje pendiente en el reloj: pulso F');
      await this.tap('KeyF');
      await this.adv(0.3);
      const h = await this.hud();
      this.note(`tras F, subtítulos: ${h.subs.join(' | ')}`);
      await this.shot('mensaje-F');
      await this.adv(2.2);
    }
    if (info.field >= 45) {
      await this.tap('KeyZ');
      await this.adv(0.4);
    }
  }

  // ───────────────────────── Pasos ─────────────────────────

  async incision() {
    const p = await this.params();
    const pts = resample(p.path, 2.5);
    for (let pass = 0; pass < 8; pass++) {
      const s = await this.state();
      if (s.stepType !== 'incision') return;
      const h = await this.hud();
      const layerIdx = h.checklist.findIndex((c) => !c.done);
      const target = p.layers[Math.max(0, Math.min(layerIdx, p.layers.length - 1))]?.targetPressure ?? 3;
      // Un humano se pone encima del inicio y ajusta la rueda.
      await this.moveMm(pts[0]);
      await this.setPressure(target);
      const h2 = await this.hud();
      if (pass === 0) this.note(`HUD presión tras rueda a ${target}: pips=${h2.pressurePips}; gauges=${JSON.stringify(h2.gauges)}`);
      const dir = pass % 2 === 0 ? pts : [...pts].reverse();
      await this.drag(dir, 0.05);
      await this.adv(0.2);
      const h3 = await this.hud();
      this.note(`incisión pasada ${pass + 1} (presión ${target}): checklist=${h3.checklist.map((c) => (c.done ? '[x]' : '[ ]') + c.label).join(' ')} | pista="${h3.hint}"`);
      if (pass === 0) await this.shot('incision-pasada1');
    }
  }

  async hemostasis() {
    let shotTaken = false;
    let zTapped = false;
    for (let i = 0; i < 60; i++) {
      const s = await this.state();
      if (s.stepType !== 'hemostasis') return;
      const act: Array<{ id: number; kind: string; pos: Mm }> = await this.eval(
        `__game.surgery().ctx().bleeding.active().map(b => ({id:b.id, kind:b.kind, pos:{x:b.pos.x,y:b.pos.y}}))`,
      );
      if (act.length) {
        act.sort((a, b) => (a.kind === 'arterial' ? -1 : 0) - (b.kind === 'arterial' ? -1 : 0));
        const b = act[0];
        if (!shotTaken) {
          await this.shot('hemostasia-sangrados');
          shotTaken = true;
        }
        await this.moveMm(b.pos);
        await this.page.mouse.down();
        await this.adv(0.7);
        const g = await this.gauge(/Contacto/);
        await this.adv(0.7);
        await this.page.mouse.up();
        await this.adv(0.1);
        const h = await this.hud();
        this.note(`cauterio sobre ${b.kind}#${b.id} 1.4 s; gauge a 0.7 s=${JSON.stringify(g)}; pops=${h.pops.slice(-2).join('|')}`);
      } else {
        const h = await this.hud();
        const field = await this.eval<number>('__game.surgery().ctx().blood.levelPct()');
        if (field >= (await this.params()).targetFieldPct || (!zTapped && field > 5)) {
          this.note(`campo ${field.toFixed(1)}%: toco Z (orden amable a Rodrigo). pista="${h.hint}"`);
          await this.tap('KeyZ');
          zTapped = true;
          await this.adv(1.5);
        } else await this.adv(0.5);
      }
    }
  }

  async retract() {
    const p = await this.params();
    for (const pair of p.pairs) {
      await this.clickMm(pair.a);
      await this.adv(0.2);
      await this.clickMm(pair.b);
      await this.adv(0.2);
      const mid = lerp(pair.a, pair.b, 0.5);
      for (let k = 0; k < p.idealClicks; k++) {
        await this.clickMm(mid);
        await this.adv(0.25);
        const g = await this.gauge(/Apertura/);
        this.note(`trinquete clic ${k + 1}: gauge=${JSON.stringify(g)}`);
        if ((await this.state()).stepType !== 'retract') break;
      }
    }
    await this.shot('separador');
  }

  async reduction() {
    const p = await this.params();
    for (const id of p.fragmentIds) {
      const info: any = await this.eval(`(() => { const b = __game.surgery().ctx().bone; const f = b.fragment(${JSON.stringify(id)});
        return { pose: f.pose, target: f.def.target, poly: b.worldPolygon(${JSON.stringify(id)}), err: b.alignmentError(${JSON.stringify(id)}) }; })()`);
      this.note(`fragmento ${id}: error inicial ${info.err.mm.toFixed(1)} mm / ${info.err.deg.toFixed(1)}°`);
      // Agarra por el centro (un humano agarra el cuerpo del fragmento).
      const c = centroid(info.poly);
      const hit = await this.eval<string | null>(`__game.surgery().ctx().bone.hitTest(${JSON.stringify(c)})`);
      const grabAt = hit === id ? c : lerp(c, info.pose.pos, 0.5);
      const dx = info.target.pos.x - info.pose.pos.x;
      const dy = info.target.pos.y - info.pose.pos.y;
      const end = { x: grabAt.x + dx, y: grabAt.y + dy };
      const n = Math.max(4, Math.ceil(dist(grabAt, end) / 0.8));
      const path: Mm[] = [];
      for (let k = 0; k <= n; k++) path.push(lerp(grabAt, end, k / n));
      await this.drag(path, 0.05, {
        keepDown: true,
        beforeUp: async () => {
          // Con el fragmento agarrado, gira con Q/E hasta la silueta.
          const cur: any = await this.eval(`__game.surgery().ctx().bone.fragment(${JSON.stringify(id)}).pose`);
          const d = angleDiff(info.target.angleDeg, cur.angleDeg);
          const key = d > 0 ? 'KeyE' : 'KeyQ';
          if (Math.abs(d) > 0.5) {
            await this.page.keyboard.down(key);
            await this.adv(Math.abs(d) / 60);
            await this.page.keyboard.up(key);
          }
          await this.adv(0.1);
        },
      });
      await this.page.mouse.up();
      await this.adv(0.2);
      const after: any = await this.eval(`(() => { const b = __game.surgery().ctx().bone; return b.alignmentError(${JSON.stringify(id)}); })()`);
      const h = await this.hud();
      this.note(`tras arrastre+giro: error ${after.mm.toFixed(2)} mm / ${after.deg.toFixed(2)}°; checklist=${JSON.stringify(h.checklist)} gauges=${JSON.stringify(h.gauges)}`);
      if ((await this.state()).stepType !== 'reduction') return;
    }
    // Arco en C para comprobar (R), como haría un humano antes de fijar.
    await this.tap('KeyR');
    await this.adv(0.3);
    await this.shot('rayosX');
    await this.adv(2);
    for (const spot of p.kwireSpots ?? []) {
      const st = await this.state();
      this.note(`agujas K: instrumento activo=${st.instrument}`);
      await this.clickMm(spot);
      await this.adv(0.3);
    }
  }

  async plate() {
    const p = await this.params();
    await this.adv(0.3);
    await this.shot('placa-elegir');
    const card = this.page.locator(`.sb-card[data-id="${p.correctId}"]`);
    if ((await card.count()) > 0) {
      const box = await card.boundingBox({ timeout: 5000 });
      if (box) {
        await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await this.adv(0.6);
      }
    } else this.note('no hay tarjetas de placa (ya elegida)');
    let bends = 0;
    let contourShot = false;
    for (let i = 0; i < 400 && bends < p.bendsRequired; i++) {
      const st = await this.page.evaluate(() => {
        const n = document.querySelector('.sb-needle') as HTMLElement | null;
        const z = document.querySelector('.sb-zone') as HTMLElement | null;
        if (!n || !z) return null;
        return { needle: parseFloat(n.style.left), zl: parseFloat(z.style.left), zw: parseFloat(z.style.width) };
      });
      if (!st) {
        if (i < 40) {
          await this.adv(0.1);
          continue;
        }
        break;
      }
      if (bends === 0 && !contourShot) {
        contourShot = true;
        await this.shot('placa-contornear');
      }
      const margin = st.zw * 0.25;
      if (st.needle >= st.zl + margin && st.needle <= st.zl + st.zw - margin) {
        await this.tap('Space');
        bends++;
        await this.adv(0.05);
      } else await this.adv(0.05);
    }
    // Posicionar: llevar la placa al hueso y girarla con Q/E.
    await this.moveMm(p.target.pos);
    await this.adv(0.1);
    let g = await this.gauge(/Ángulo/);
    this.note(`placa en posición; gauges=${JSON.stringify((await this.hud()).gauges)}`);
    let key = 'KeyE';
    for (let i = 0; i < 40 && g && g.value > p.tolDeg * 0.4; i++) {
      await this.page.keyboard.down(key);
      await this.adv(Math.min(0.3, g.value / 45));
      await this.page.keyboard.up(key);
      const g2 = await this.gauge(/Ángulo/);
      if (g2 && g2.value > g.value) key = key === 'KeyE' ? 'KeyQ' : 'KeyE';
      g = g2;
    }
    await this.shot('placa-posicion');
    await this.clickMm(p.target.pos);
    await this.adv(0.3);
  }

  async screws() {
    const p = await this.params();
    let lastIdx = -1;
    let catchShot = false;
    for (let i = 0; i < 2500; i++) {
      const s = await this.state();
      if (s.stepType !== 'screws') return;
      const ui = await this.page.evaluate(() => {
        const ring = document.querySelector('.sc-root:not(.sc-perfect):not(.sc-good):not(.sc-miss) .sc-ring') as HTMLElement | null;
        const m = ring?.style.transform.match(/scale\(([\d.]+)\)/);
        return {
          ring: m ? Number(m[1]) : null,
          drop: !!document.querySelector('.sb-drop'),
          measure: (document.querySelector('.sb-measure-val')?.textContent ?? '').trim(),
        };
      });
      const h = await this.hud();
      const idx = Number((h.checklist[0]?.label.match(/\((\d+)\//) ?? [])[1] ?? 0);
      const holes: Mm[] = p.holes === 'plate' ? await this.eval('__game.surgery().ctx().bone.plateHolesWorld()') : p.holes;
      const hole = holes[idx];
      if (idx !== lastIdx) {
        lastIdx = idx;
        this.note(`tornillo ${idx + 1}/${holes.length}`);
      }
      if (ui.ring !== null) {
        if (!catchShot) {
          await this.shot('tornillo-atrapar');
          catchShot = true;
        }
        if (ui.ring <= 1.001) {
          await this.tap('Space');
          await this.adv(0.05);
          const h2 = await this.hud();
          this.note(`Espacio al llegar el anillo: pops=${h2.pops.slice(-2).join('|')}`);
        } else await this.adv(0.05);
        continue;
      }
      if (ui.drop) {
        this.note('tornillo caído: pulso Espacio (esperar repuesto)');
        await this.tap('Space');
        await this.adv(0.2);
        continue;
      }
      if (ui.measure) {
        const depth = Number(ui.measure.replace(/[^\d,]/g, '').replace(',', '.'));
        const opts: number[] = p.lengthOptionsMm;
        const sorted = opts.map((o, j) => ({ o, j })).sort((a, b) => a.o - b.o);
        const pick = sorted.find((x) => x.o >= depth) ?? sorted[sorted.length - 1];
        this.note(`medidor ${depth} mm → elijo ${pick.o} mm (tecla ${pick.j + 1})`);
        await this.tap(`Digit${pick.j + 1}`);
        await this.adv(0.1);
        continue;
      }
      const gl = h.gauges.map((g) => g.label).join(',');
      if (/Profundidad/.test(gl) && /Temperatura/.test(gl)) {
        // Piloto: mantener y soltar al notar la salida.
        await this.moveMm(hole);
        await this.page.mouse.down();
        let out = false;
        let maxHeat = 0;
        for (let k = 0; k < 200; k++) {
          await this.adv(0.05);
          const h3 = await this.hud();
          const heat = h3.gauges.find((g) => /Temperatura/.test(g.label));
          if (heat) maxHeat = Math.max(maxHeat, Number(heat.val.replace(/[^\d,]/g, '').replace(',', '.')));
          if (/^¡Salida!/.test(h3.hint) || h3.pops.some((x) => /¡Salida!/.test(x))) {
            out = true;
            break;
          }
          if (!h3.gauges.some((g) => /Temperatura/.test(g.label))) break;
        }
        await this.page.mouse.up();
        await this.adv(0.1);
        this.note(`piloto: salida detectada=${out}, pico ${maxHeat} °C`);
        continue;
      }
      if (/Torque/.test(gl)) {
        await this.moveMm(hole);
        await this.page.mouse.down();
        let z = '';
        for (let k = 0; k < 60; k++) {
          await this.adv(0.05);
          const g = await this.gauge(/Torque/);
          if (!g) break;
          z = `${g.value}/${g.zone}`;
          if (g.zone === 'good') break;
        }
        await this.page.mouse.up();
        await this.adv(0.1);
        const h4 = await this.hud();
        this.note(`torque soltado en ${z}; pops=${h4.pops.slice(-2).join('|')}`);
        continue;
      }
      await this.adv(0.1);
    }
  }

  async suture() {
    const p = await this.params();
    const L = pathLen(p.path);
    let shot = false;
    for (let i = 0; i < 120; i++) {
      const s = await this.state();
      if (s.stepType !== 'suture') return;
      if (i % 6 === 0) await this.housekeeping();
      const h = await this.hud();
      const cur = h.checklist.find((c) => !c.done);
      const m = cur?.label.match(/\((\d+)\/(\d+)\)/);
      if (!m) {
        this.note(`sutura: checklist ilegible ${JSON.stringify(h.checklist)}`);
        await this.adv(0.2);
        continue;
      }
      const k = Number(m[1]);
      const per = Number(m[2]);
      const { p: c, n } = pointAt(p.path, (L * (k + 0.5)) / per);
      const a = { x: c.x + n.x * 5, y: c.y + n.y * 5 };
      const b = { x: c.x - n.x * 5, y: c.y - n.y * 5 };
      const pts = [0, 0.25, 0.5, 0.75, 1].map((t) => lerp(a, b, t));
      await this.drag(pts, 0.12);
      await this.adv(0.15);
      if (!shot && k >= 3) {
        await this.shot('sutura');
        shot = true;
      }
      const h2 = await this.hud();
      const cur2 = h2.checklist.find((c) => !c.done);
      if (cur2?.label === cur?.label) this.note(`punto de sutura no contado; pops=${h2.pops.slice(-2).join('|')}`);
    }
  }

  async bandage() {
    const p = await this.params();
    const R = p.radiusMm;
    // El bucle real también avanza el tiempo: se gira a velocidad angular constante respecto al t de juego.
    const omega = 0.8; // vueltas/s (banda buena 0,45–1,2)
    const at = (turns: number): Mm => ({ x: p.center.x + Math.cos(turns * Math.PI * 2) * R, y: p.center.y + Math.sin(turns * Math.PI * 2) * R });
    await this.shot('vendaje-inicio');
    const ring: Mm[] = [];
    for (let k = 0; k <= 72; k++) ring.push(at(k / 72));
    const px = await this.projMany(ring);
    const pxAt = (turns: number) => {
      const f = ((turns % 1) + 1) % 1;
      const i = Math.floor(f * 72);
      const k = f * 72 - i;
      return { x: px[i].x + (px[i + 1].x - px[i].x) * k, y: px[i].y + (px[i + 1].y - px[i].y) * k };
    };
    await this.page.mouse.move(px[0].x, px[0].y);
    await this.page.mouse.down();
    const t0 = (await this.state()).t;
    const samples: string[] = [];
    for (let i = 1; i < 400; i++) {
      const t = await this.eval<number>('__game.surgery().state().t');
      const turns = omega * (t - t0);
      const q = pxAt(turns);
      await this.page.mouse.move(q.x, q.y);
      await this.adv(0.03);
      if (i % 4 === 0) {
        const h = await this.hud();
        const g = h.gauges.find((x) => /Tensi/.test(x.label));
        samples.push(g ? `${g.val}/${g.zone}` : '-');
        if (i === 12) await this.shot('vendaje-girando');
        if ((await this.state()).stepType !== 'bandage') break;
      }
      if (turns > p.turns + 1.5) break;
    }
    await this.page.mouse.up();
    await this.adv(0.2);
    const h = await this.hud();
    this.note(`vendaje a ${omega} vueltas/s (tiempo de juego): tensión muestreada = ${samples.join(' ')}; pops=${h.pops.join('|')}`);
  }

  async drillPins() {
    const p = await this.params();
    for (const spot of p.spots) {
      await this.moveMm(spot);
      await this.page.mouse.down();
      let out = false;
      let peak = 0;
      for (let k = 0; k < 300; k++) {
        await this.adv(0.05);
        const h = await this.hud();
        const heat = h.gauges.find((g) => /Temp|Calor/i.test(g.label));
        if (heat) peak = Math.max(peak, Number(heat.val.replace(/[^\d,]/g, '').replace(',', '.')));
        if (h.pops.some((x) => /¡Salida!/.test(x)) || /^¡Salida!/.test(h.hint)) {
          out = true;
          break;
        }
        if (/Broca caliente/.test(h.hint)) {
          // Un humano suelta para enfriar y vuelve a apretar.
          this.note(`broca caliente (${heat?.val}): suelto 1 s para enfriar`);
          await this.page.mouse.up();
          await this.adv(1);
          await this.moveMm(spot);
          await this.page.mouse.down();
        }
        if ((await this.state()).stepType !== 'drillPins') break;
      }
      await this.page.mouse.up();
      await this.adv(0.2);
      this.note(`taladro en (${spot.x},${spot.y}): salida=${out}, pico=${peak}; gauges=${JSON.stringify((await this.hud()).gauges)}`);
    }
  }

  async clickTargets() {
    const p = await this.params();
    for (const t of p.targets) {
      await this.clickMm(t.pos);
      await this.adv(0.3);
      const h = await this.hud();
      this.note(`clic en ${t.label}: checklist=${JSON.stringify(h.checklist)} pops=${h.pops.slice(-1)}`);
    }
  }

  async saw() {
    const p = await this.params();
    const pts = resample(p.path, 0.6);
    await this.page.keyboard.down('KeyI');
    for (let pass = 0; pass < 6; pass++) {
      if ((await this.state()).stepType !== 'saw') break;
      const dir = pass % 2 === 0 ? pts : [...pts].reverse();
      await this.drag(dir, 0.05, {
        beforeUp: async () => {
          const h = await this.hud();
          this.note(`sierra pasada ${pass + 1}: ${h.checklist.map((c) => c.label).join(' / ')} gauges=${JSON.stringify(h.gauges)} pista="${h.hint}"`);
          if (pass === 0) await this.shot('sierra');
        },
      });
      await this.adv(0.1);
    }
    await this.page.keyboard.up('KeyI');
  }

  async pick() {
    const p = await this.params();
    for (const id of p.removeFragmentIds ?? []) {
      const info: any = await this.eval(`(() => { const b = __game.surgery().ctx().bone; const f = b.fragment(${JSON.stringify(id)});
        return { pose: f.pose, locked: f.locked, poly: b.worldPolygon(${JSON.stringify(id)}) }; })()`);
      let c = centroid(info.poly);
      const hit = await this.eval<string | null>(`__game.surgery().ctx().bone.hitTest(${JSON.stringify(c)})`);
      this.note(`extraer ${id}: locked=${info.locked}, hitTest(centro)=${hit}`);
      if (hit !== id) c = info.pose.pos;
      // Sacarlo hacia el borde izquierdo de la herida.
      const end = { x: 6, y: c.y };
      const n = Math.ceil(dist(c, end) / 1.5);
      const path: Mm[] = [];
      for (let k = 0; k <= n; k++) path.push(lerp(c, end, k / n));
      await this.drag(path, 0.05);
      await this.adv(0.2);
      const h = await this.hud();
      this.note(`tras arrastrar ${id}: checklist=${JSON.stringify(h.checklist)} pops=${h.pops.slice(-2).join('|')}`);
    }
    for (const it of p.items ?? []) {
      await this.moveMm(it.pos);
      await this.page.mouse.down();
      await this.adv(0.8);
      const end = { x: it.pos.x, y: 20 };
      await this.moveMm(end);
      await this.adv(0.1);
      await this.page.mouse.up();
    }
  }

  async burr() {
    const p = await this.params();
    const xs = p.area.map((q: Mm) => q.x);
    const ys = p.area.map((q: Mm) => q.y);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    const step = Math.max(0.6, p.brushMm * 0.8);
    for (let pass = 0; pass < 6; pass++) {
      if ((await this.state()).stepType !== 'burr') return;
      // Zigzag horizontal (solo dentro del polígono aproximado: se recorta por el trapecio).
      const pts: Mm[] = [];
      let flip = false;
      for (let y = y0 + step / 2; y <= y1; y += step) {
        const row: Mm[] = [];
        for (let x = x0; x <= x1; x += 0.7) if (inPoly({ x, y }, p.area)) row.push({ x, y });
        if (flip) row.reverse();
        flip = !flip;
        pts.push(...row);
      }
      await this.drag(pts, 0.05, {
        beforeUp: async () => {
          const h = await this.hud();
          this.note(`raspa pasada ${pass + 1}: gauges=${JSON.stringify(h.gauges)} checklist=${JSON.stringify(h.checklist)}`);
          if (pass === 0) await this.shot('raspa');
        },
      });
      await this.adv(0.4);
    }
  }

  // ───────────────────────── Bucle principal ─────────────────────────

  async playSurgery(opts: { commandsDemo?: boolean } = {}) {
    await this.page.waitForFunction(() => (window as any).__game?.mode === 'surgery', null, { timeout: 120_000 });
    // Deja que la cámara termine de pasar de la vista general a la herida (se amortigua en tiempo de juego).
    await this.adv(3);
    await this.frame();
    const c1 = await this.proj({ x: 80, y: 50 });
    await this.adv(3);
    await this.frame();
    const c2 = await this.proj({ x: 80, y: 50 });
    this.note(`cámara: centro de la herida en t≈3 s → (${c1.x.toFixed(0)},${c1.y.toFixed(0)}), en t≈6 s → (${c2.x.toFixed(0)},${c2.y.toFixed(0)})`);
    await this.shot('inicio');
    // Solo para iterar más rápido en la exploración: PLAY_SKIP=n salta los n primeros pasos (forzados).
    const skip = Number(process.env.PLAY_SKIP ?? 0);
    for (let i = 0; i < skip; i++) {
      await this.page.evaluate(() => (window as any).__game.surgery().forceCompleteStep());
      await this.adv(2);
      this.note(`(exploración) paso ${i + 1} saltado con forceCompleteStep`);
    }
    let lastStep = '';
    let tries = 0;
    let demoDone = false;
    for (let guard = 0; guard < 60; guard++) {
      const s = await this.state();
      if (s.finished || s.step === null) break;
      if (s.step !== lastStep) {
        if (this.cur) await this.closeStep(true);
        lastStep = s.step;
        tries = 0;
        const snap = await this.logSnapshot();
        this.cur = { label: s.step, type: s.stepType, startT: s.t, endT: s.t, realMs: Date.now(), ok: false, stuck: false, faults: snap.faults, gestures: snap.gestures, notes: [] };
        // El intersticial entre fases congela el mundo 1,6 s: un humano espera a que se levante el telón.
        await this.adv(1.8);
        const h = await this.hud();
        this.note(`== PASO "${s.step}" (${s.stepType}) fase "${s.phase}" · progreso ${s.progress.toFixed(1)}% · pista="${h.hint}" · checklist=${h.checklist.map((c) => c.label).join(' / ')}`);
      }
      await this.housekeeping();
      if (opts.commandsDemo && !demoDone && s.stepType === 'retract') {
        demoDone = true;
        await this.commandsDemo();
      }
      const fn = (this as any)[s.stepType] as (() => Promise<void>) | undefined;
      if (!fn) {
        this.note(`sin conductor para ${s.stepType}`);
        break;
      }
      await fn.call(this);
      await this.adv(0.3);
      const s2 = await this.state();
      if (s2.step === s.step && !s2.finished) {
        tries++;
        if (tries >= 3) {
          const p = await this.shot(`ATASCADO-${s.stepType}`);
          const h = await this.hud();
          this.note(`!!! ATASCADO en "${s.step}" tras ${tries} intentos. pista="${h.hint}" checklist=${JSON.stringify(h.checklist)} gauges=${JSON.stringify(h.gauges)} captura=${p}`);
          if (this.cur) this.cur.stuck = true;
          await this.page.evaluate(() => (window as any).__game.surgery().forceCompleteStep());
          await this.adv(2);
        }
      }
    }
    if (this.cur) await this.closeStep(true);
    await this.adv(1);
    await this.shot('final-quirofano');
    await this.adv(5);
    await this.page.waitForFunction(() => (window as any).__game?.mode !== 'surgery', null, { timeout: 60_000 }).catch(() => undefined);
    await this.page.waitForTimeout(1500);
    await this.shot('auditoria');
    return this.reports;
  }

  private async closeStep(ok: boolean) {
    const c = this.cur!;
    const snap = await this.logSnapshot().catch(() => ({ faults: [] as string[], gestures: [] as Array<{ label: string; q: number }> }));
    c.faults = snap.faults.slice(c.faults.length);
    c.gestures = snap.gestures.slice(c.gestures.length);
    c.endT = this.lastT;
    c.realMs = Date.now() - c.realMs;
    c.ok = ok && !c.stuck;
    this.reports.push(c);
    this.note(`== FIN "${c.label}": ${c.stuck ? 'ATASCADO' : 'ok'} en ${(c.endT - c.startT).toFixed(1)} s de juego; faltas=${JSON.stringify(c.faults)} gestos=${JSON.stringify(c.gestures)}`);
    this.cur = null;
  }

  /** Órdenes Z/X/C: toque (amable) y mantener (Dómina). */
  async commandsDemo() {
    const before = await this.eval<any>('__game.surgery().ctx().emiliana.snapshot()');
    await this.tap('KeyC');
    await this.adv(0.5);
    let h = await this.hud();
    this.note(`toque C (amable a Gigi): subs=${h.subs.join(' | ')} toasts=${h.toasts.join(' | ')}`);
    await this.page.keyboard.down('KeyX');
    await this.adv(0.6);
    await this.page.keyboard.up('KeyX');
    await this.adv(0.3);
    h = await this.hud();
    this.note(`mantener X (Dómina a Fritz): subs=${h.subs.join(' | ')} toasts=${h.toasts.join(' | ')}`);
    await this.shot('orden-domina');
    const after = await this.eval<any>('__game.surgery().ctx().emiliana.snapshot()');
    // Pausa con Esc: ¿se queda la pantalla de pausa?
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(600);
    const pz = await this.page.evaluate(() => ({ pause: !!document.querySelector('.scr-pause'), t0: (window as any).__game.surgery().state().t }));
    await this.page.waitForTimeout(1500);
    const t1 = await this.eval<number>('__game.surgery().state().t');
    this.note(`Esc en quirófano: pantalla de pausa=${pz.pause}; t de juego ${pz.t0.toFixed(2)} → ${t1.toFixed(2)} tras 1,5 s reales`);
    if (pz.pause) await this.page.getByText('Reanudar').click().catch(() => undefined);
    this.note(`Emiliana antes conc=${before.concentration.toFixed(1)} res=${before.reserve.toFixed(1)} → después conc=${after.concentration.toFixed(1)} res=${after.reserve.toFixed(1)}`);
  }
}

function inPoly(p: Mm, poly: Mm[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
