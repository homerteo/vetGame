// playtest-B — piloto dentro de la página (se inyecta con addInitScript).
// Genera eventos de puntero/rueda/teclado reales del DOM (PointerEvent/WheelEvent/KeyboardEvent)
// sobre el canvas y la ventana, que recorren exactamente el mismo camino que el ratón
// (src/core/Input.ts → SurgeryController). Solo lee los ganchos de depuración para apuntar
// (project/stepParams/ctx) y mueve el tiempo con __game.advance. NUNCA usa forceCompleteStep.
// Motivo: la máquina está muy cargada y cada ida y vuelta CDP (page.mouse) cuesta segundos.
(() => {
  // ── compuerta de requestAnimationFrame (render solo bajo demanda) ──
  const origRaf = window.requestAnimationFrame.bind(window);
  let rafQ = [];
  window.requestAnimationFrame = (cb) => {
    rafQ.push(cb);
    return rafQ.length;
  };
  window.__pump = (n = 1) =>
    new Promise((res) => {
      let k = 0;
      const step = () => {
        const q = rafQ;
        rafQ = [];
        const now = performance.now();
        for (const cb of q) cb(now);
        if (++k < n) origRaf(step);
        else res(true);
      };
      origRaf(step);
    });
  setInterval(() => window.__pump(1), 1500);

  const sleep0 = () => new Promise((r) => setTimeout(r, 0));
  const densify = (path, step = 2) => {
    const out = [{ ...path[0] }];
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
      for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    }
    return out;
  };

  const T = {
    logs: [],
    shotReq: null,
    done: false,
    result: null,
    buttons: 0,
    pressure: 3,
    last: { x: 640, y: 360 },
    chaosPolicy: 'respond',
    chaosLog: [],
    seenChaos: new Set(),
    keysDown: new Set(),
    densify,
    log(...a) {
      const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
      const st = window.__game?.surgery?.()?.state?.();
      T.logs.push(`[t=${st ? st.t.toFixed(1) : '-'}] ${s}`);
    },
    g: () => window.__game,
    s: () => window.__game.surgery(),
    st: () => window.__game.surgery()?.state() ?? null,
    prm: () => window.__game.surgery()?.stepParams() ?? null,
    ctx: () => window.__game.surgery().ctx(),
    adv(sec) {
      return window.__game.advance(sec);
    },
    px(mm) {
      return window.__game.surgery().project(mm);
    },
    cv() {
      const c = document.getElementById('gl');
      if (!c.__noCapture) {
        c.setPointerCapture = () => {};
        c.__noCapture = true;
      }
      return c;
    },
    pe(type, x, y, button) {
      const target = type === 'pointerdown' ? T.cv() : window;
      target.dispatchEvent(
        new PointerEvent(type, { clientX: x, clientY: y, button, buttons: T.buttons, bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true }),
      );
    },
    /** Pulsa un botón (0 izq., 2 der.). Si ya hay otro pulsado, el navegador emite pointermove (acorde). */
    down(mm, button = 0) {
      const p = mm ? T.px(mm) : T.last;
      T.last = p;
      const chord = T.buttons !== 0;
      T.buttons |= button === 2 ? 2 : button === 1 ? 4 : 1;
      T.pe(chord ? 'pointermove' : 'pointerdown', p.x, p.y, button);
    },
    move(mm) {
      const p = T.px(mm);
      T.last = p;
      T.pe('pointermove', p.x, p.y, -1);
    },
    moveScreen(p) {
      T.last = p;
      T.pe('pointermove', p.x, p.y, -1);
    },
    up(mm, button = 0) {
      const p = mm ? T.px(mm) : T.last;
      T.last = p;
      T.buttons &= ~(button === 2 ? 2 : button === 1 ? 4 : 1);
      T.pe(T.buttons === 0 ? 'pointerup' : 'pointermove', p.x, p.y, button);
    },
    keyDown(code) {
      T.keysDown.add(code);
      window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code.replace(/^Key|^Digit/, ''), bubbles: true, cancelable: true }));
    },
    keyUp(code) {
      T.keysDown.delete(code);
      window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code.replace(/^Key|^Digit/, ''), bubbles: true, cancelable: true }));
    },
    key(code, hold = 0.03) {
      T.keyDown(code);
      T.adv(hold);
      T.keyUp(code);
      T.adv(0.02);
    },
    wheel(dy) {
      T.cv().dispatchEvent(new WheelEvent('wheel', { deltaY: dy, clientX: T.last.x, clientY: T.last.y, bubbles: true, cancelable: true }));
    },
    setPressure(n) {
      while (T.pressure < n) {
        T.wheel(-100);
        T.pressure++;
      }
      while (T.pressure > n) {
        T.wheel(100);
        T.pressure--;
      }
    },
    drag(pts, dt = 0.03, button = 0, beforeUp) {
      T.down(pts[0], button);
      T.adv(dt);
      for (let i = 1; i < pts.length; i++) {
        T.move(pts[i]);
        T.adv(dt);
      }
      if (beforeUp) beforeUp();
      T.up(pts[pts.length - 1], button);
      T.adv(0.02);
    },
    click(mm, hold = 0.03, button = 0) {
      T.move(mm);
      T.down(mm, button);
      T.adv(hold);
      T.up(mm, button);
      T.adv(0.02);
    },
    // ── lectura del HUD como jugador ──
    hint: () => document.querySelector('.prog-hint')?.textContent.trim() ?? '',
    check: () => [...document.querySelectorAll('.prog-check > *')].map((e) => (e.className.includes('done') ? '[x] ' : '[ ] ') + e.textContent.trim()).join(' · '),
    gauges() {
      const out = {};
      for (const g of document.querySelectorAll('.hud-gauges .gauge')) {
        const t = g.textContent.trim();
        const m = t.match(/^(.*?)(-?\d+(?:,\d+)?)\s*(?:°C|°|mm|%|s|clics)?\s*$/);
        if (m) out[m[1].trim()] = Number(m[2].replace(',', '.'));
      }
      return out;
    },
    hud() {
      const q = (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.trim()).filter(Boolean);
      return { alerts: q('.hud-alerts > .show'), subs: q('.hud-subs > *'), toasts: q('.hud-toasts > *'), pops: q('.hud-pops > *').slice(-4) };
    },
    async shot(name) {
      const want = T.opts.shots ?? [];
      if (!want.some((w) => name.includes(w))) return;
      T.shotReq = name;
      while (T.shotReq) await new Promise((r) => setTimeout(r, 200));
    },

    // ── caos ──
    /** Responde a interferencias activas (llamar entre gestos, sin botones pulsados). */
    async tick() {
      const s = T.st();
      if (!s) return;
      for (const kind of s.chaos) {
        const key = `${kind}`;
        if (T.handlingChaos) return;
        const firstSeen = !T.seenChaos.has(key + ':' + T.chaosEpoch(kind));
        if (!firstSeen) continue;
        T.seenChaos.add(key + ':' + T.chaosEpoch(kind));
        if (T.chaosPolicy === 'ignore') {
          T.chaosLog.push({ kind, t: s.t, hud: T.hud(), handled: 'ignored' });
          T.log(`CAOS ${kind} (ignorado)`, T.hud());
          continue;
        }
        T.handlingChaos = true;
        try {
          await T.handleChaos(kind);
        } finally {
          T.handlingChaos = false;
        }
      }
    },
    chaosEpochs: {},
    chaosEpoch(kind) {
      return T.chaosEpochs[kind] ?? 0;
    },
    async handleChaos(kind) {
      const t0 = T.st().t;
      const hud0 = T.hud();
      const light0 = T.ctx().crew.gigi.lightLevel();
      T.log(`CAOS empieza: ${kind}`, hud0);
      await T.shot(`chaos-${kind}-${Math.round(t0)}`);
      const active = () => T.st().chaos.includes(kind);
      const rec = { kind, t: t0, hud: hud0, actions: [] };
      if (kind === 'rodrigoSolo') {
        const suction0 = T.ctx().crew.rodrigo.suctionRate();
        rec.suctionDuring = suction0;
        if ((T.chaosCount.rodrigoSolo = (T.chaosCount.rodrigoSolo ?? 0) + 1) % 2 === 1) {
          // mano izquierda: clic derecho + arrastrar sobre la herida
          const pool = T.ctx().blood;
          const c = { x: 80, y: 52 };
          T.drag([c, { x: 84, y: 53 }, { x: 88, y: 54 }], 0.05, 2);
          rec.actions.push('clic derecho + arrastrar');
        } else {
          T.key('KeyZ');
          rec.actions.push('Z (petición amable)');
        }
      } else if ((kind === 'gigiSelfie' || kind === 'hortensiaCall') && T.opts.gigiDomina) {
        T.key('KeyC', 0.5);
        rec.actions.push('mantener C 0,5 s (Dómina)');
        T.adv(1);
        await T.shot(`chaos-${kind}-after-domina`);
      } else if (kind === 'gigiSelfie' || kind === 'hortensiaCall') {
        T.key('KeyC');
        rec.actions.push('C (amable)');
        T.adv(3.2);
        rec.afterKind = { active: active(), light: T.ctx().crew.gigi.lightLevel(), subs: T.hud().subs };
        if (active()) {
          T.keyDown('KeyL');
          T.adv(1.7);
          T.keyUp('KeyL');
          T.adv(0.05);
          rec.actions.push('mantener L 1,7 s');
        }
      } else if (kind === 'panchitoIntrusion') {
        T.key('KeyX');
        rec.actions.push('X (amable)');
      } else if (kind === 'fritzTremorSpike') {
        T.key('KeyX');
        rec.actions.push('X (amable)');
      } else {
        rec.actions.push('nada');
      }
      for (let i = 0; i < 60 && active(); i++) T.adv(0.25);
      rec.resolvedAfter = +(T.st().t - t0).toFixed(2);
      rec.stillActive = active();
      rec.light0 = light0;
      rec.lightEnd = T.ctx().crew.gigi.lightLevel();
      rec.hudEnd = T.hud();
      T.chaosLog.push(rec);
      T.chaosEpochs[kind] = (T.chaosEpochs[kind] ?? 0) + 1;
      T.log(`CAOS fin: ${kind}`, rec);
    },
    chaosCount: {},

    // ── jugadores de cada paso ──
    P: {},
    opts: {},
  };

  const P = T.P;

  P.incision = async (prm) => {
    const pts = densify(prm.path, 1.5);
    for (let pass = 0; pass < 14; pass++) {
      if (T.st().stepType !== 'incision') return;
      const h = T.hint();
      const m = h.match(/presión (\d)|hasta (\d)|rueda a (\d)/);
      const target = m ? Number(m[1] ?? m[2] ?? m[3]) : 3;
      T.setPressure(target);
      T.drag(pass % 2 ? [...pts].reverse() : pts, 0.03);
      T.adv(0.1);
      T.log(`incisión pasada ${pass + 1} presión ${target} → ${T.check()} | pista: ${T.hint()}`);
      await T.tick();
      await sleep0();
    }
  };

  P.hemostasis = async (prm) => {
    for (let i = 0; i < 80; i++) {
      const s = T.st();
      if (s.stepType !== 'hemostasis') return;
      const act = T.ctx()
        .bleeding.active()
        .map((b) => ({ x: b.pos.x, y: b.pos.y, kind: b.kind }));
      if (act.length) {
        act.sort((a, b) => (b.kind === 'arterial') - (a.kind === 'arterial'));
        const b = act[0];
        T.click(b, 1.4);
        T.log(`cauterio sobre ${b.kind} (${b.x},${b.y}) → ${T.hud().pops.slice(-1)} | campo ${T.st().field.toFixed(0)}%`);
      } else {
        if (s.field >= prm.targetFieldPct) {
          T.key('KeyZ');
          T.log(`campo ${s.field.toFixed(0)}% ≥ ${prm.targetFieldPct}%: Z a Rodrigo | pista: ${T.hint()}`);
        }
        T.adv(1);
      }
      await T.tick();
      await sleep0();
    }
  };

  P.retract = async (prm) => {
    for (const pr of prm.pairs) {
      T.click(pr.a);
      T.click(pr.b);
      const mid = { x: (pr.a.x + pr.b.x) / 2, y: (pr.a.y + pr.b.y) / 2 };
      for (let k = 0; k < prm.idealClicks; k++) T.click(mid);
      T.log(`separador: ${T.check()} | ${T.hud().pops}`);
      await T.tick();
    }
  };

  P.saw = async (prm) => {
    const o = T.opts.saw ?? {};
    const irrigate = o.irrigate ?? 'key';
    const speed = o.speed ?? 10;
    const pauseAt = o.pauseAt ?? 44;
    const pts = densify(prm.path, 0.5);
    const dt = 0.5 / speed;
    let maxT = 0;
    for (let pass = 0; pass < (o.maxPasses ?? 6); pass++) {
      if (T.st().stepType !== 'saw') return;
      const path = pass % 2 ? [...pts].reverse() : pts;
      if (irrigate === 'key') T.keyDown('KeyI');
      T.move(path[0]);
      if (irrigate === 'right') T.down(path[0], 2);
      if (irrigate === 'rightAfter') {
        T.down(path[0], 0);
      } else T.down(path[0], 0);
      if (irrigate === 'rightAfter') T.down(path[0], 2);
      for (let i = 1; i < path.length; i++) {
        T.move(path[i]);
        T.adv(dt);
        if (i % 4 === 0) {
          const g = T.gauges();
          maxT = Math.max(maxT, g['Temperatura'] ?? 0);
          if (pauseAt && (g['Temperatura'] ?? 0) > pauseAt) {
            T.up(path[i], 0);
            T.adv(2.5);
            T.down(path[i], 0);
          }
          if (T.st().stepType !== 'saw') break;
        }
      }
      if (T.buttons & 1) T.up(null, 0);
      if (T.buttons & 2) T.up(null, 2);
      if (irrigate === 'key') T.keyUp('KeyI');
      T.adv(0.1);
      T.log(`sierra (${irrigate}) pasada ${pass + 1} → ${T.st().stepType === 'saw' ? T.check() : 'hecha'} · T máx ${maxT} · ${T.hud().pops}`);
      await T.tick();
      await sleep0();
    }
    return maxT;
  };

  P.burr = async (prm) => {
    const o = T.opts.burr ?? {};
    const irrigate = o.irrigate ?? true;
    const speed = o.speed ?? 15;
    const pauseAt = o.pauseAt ?? 44;
    const xs = prm.area.map((p) => p.x);
    const ys = prm.area.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const r = prm.brushMm;
    const forb = prm.forbidden ?? T.ctx().bone.cord() ?? null;
    const minY = forb ? Math.max(...forb.map((p) => p.y)) + r + (o.margin ?? 0.4) : -1e9;
    const rows = [];
    for (let y = y0 + r * 0.4; y <= y1 - r * 0.2 + 0.01; y += r * 0.8) rows.push(Math.max(y, minY));
    let heatMax = 0;
    let movingSec = 0;
    for (let rep = 0; rep < (o.reps ?? 5); rep++) {
      for (let ri = 0; ri < rows.length; ri++) {
        if (T.st().stepType !== 'burr') return heatMax;
        const y = rows[ri];
        const a = { x: x0 + r * 0.3, y };
        const b = { x: x1 - r * 0.3, y };
        const line = densify(ri % 2 ? [b, a] : [a, b], 0.6);
        if (irrigate) T.keyDown('KeyI');
        T.move(line[0]);
        T.down(line[0]);
        for (let i = 1; i < line.length; i++) {
          T.move(line[i]);
          T.adv(0.6 / speed);
          movingSec += 0.6 / speed;
          if (i % 4 === 0) {
            const g = T.gauges();
            heatMax = Math.max(heatMax, g['Temperatura'] ?? 0);
            if (pauseAt && (g['Temperatura'] ?? 0) > pauseAt) {
              T.log(`fresa: ${g['Temperatura']} °C tras ${movingSec.toFixed(1)} s fresando (irrigando=${irrigate}); pista: ${T.hint()}`);
              T.up(line[i]);
              T.adv(2.5);
              T.down(line[i]);
            }
          }
        }
        T.up(null);
        if (irrigate) T.keyUp('KeyI');
        T.adv(0.3);
        await sleep0();
      }
      T.log(`fresa barrido ${rep + 1} → ${T.check()} · T máx ${heatMax} · ${T.hud().pops}`);
      await T.tick();
    }
    return heatMax;
  };

  P.reduction = async (prm) => {
    for (const id of prm.fragmentIds) {
      for (let attempt = 0; attempt < 4; attempt++) {
        if (T.st().stepType !== 'reduction') return;
        const c = T.ctx();
        const fr = c.bone.fragment(id);
        if (T.st().stepType !== 'reduction' || !fr) return;
        const poly = c.bone.worldPolygon(id);
        const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
        const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
        const err = c.bone.alignmentError(id);
        if (err.mm < 0.01 && err.deg < 0.01) break;
        const tgt = fr.def.target;
        const dx = tgt.pos.x - fr.pose.pos.x;
        const dy = tgt.pos.y - fr.pose.pos.y;
        const n = Math.max(4, Math.ceil(Math.hypot(dx, dy) / 0.4));
        const pts = [];
        for (let k = 0; k <= n; k++) pts.push({ x: cx + (dx * k) / n, y: cy + (dy * k) / n });
        const dAng = tgt.angleDeg - fr.pose.angleDeg;
        T.log(`reducción ${id}: error ${err.mm.toFixed(2)} mm / ${err.deg.toFixed(1)}°, locked=${fr.locked}; arrastro ${Math.hypot(dx, dy).toFixed(1)} mm y giro ${dAng.toFixed(1)}°`);
        T.drag(pts, 0.05, 0, () => {
          if (Math.abs(dAng) > 0.5) {
            const k = dAng > 0 ? 'KeyE' : 'KeyQ';
            T.keyDown(k);
            T.adv(Math.abs(dAng) / 60);
            T.keyUp(k);
            T.adv(0.05);
          }
        });
        T.adv(0.2);
        T.log(`  → ${T.check()} · ${T.hud().pops}`);
        await T.tick();
      }
    }
    // agujas K si las hubiera
    const prm2 = T.prm();
    if (T.st().stepType === 'reduction' && prm2?.kwireSpots) for (const k of prm2.kwireSpots) T.click(k);
  };

  T.drillAt = async (spot, stepType) => {
    const maxHeat = T.opts.drillMaxHeat ?? 44.5;
    T.move(spot);
    let holding = false;
    let peak = 0;
    let presses = 0;
    let sawSalida = false;
    for (let i = 0; i < 1200; i++) {
      const h = T.hint();
      const g = T.gauges();
      const Tc = g['Temperatura'] ?? 37;
      peak = Math.max(peak, Tc);
      if (/Salida/.test(h)) {
        sawSalida = true;
        if (holding) {
          T.up(spot);
          holding = false;
        }
        T.adv(0.05);
        break;
      }
      if (i > 3 && !holding && !/Mantén clic para taladrar|Segunda cortical|Broca caliente|Piloto: clic|clic y mantén el taladro/.test(h)) break;
      if (!holding && Tc < 40) {
        T.down(spot);
        holding = true;
        presses++;
      } else if (holding && Tc > maxHeat) {
        T.up(spot);
        holding = false;
      }
      T.adv(0.05);
      if (T.st().stepType !== stepType) break;
    }
    if (holding) T.up(spot);
    T.adv(0.1);
    T.log(`taladro (${spot.x.toFixed(1)},${spot.y.toFixed(1)}): T pico ${peak}, pulsaciones ${presses}, salida vista=${sawSalida} → ${T.hud().pops}`);
    await sleep0();
    return peak;
  };

  P.drillPins = async (prm) => {
    for (const sp of prm.spots) {
      if (T.st().stepType !== 'drillPins') return;
      await T.drillAt(sp, 'drillPins');
      await T.tick();
    }
  };

  P.clickTargets = async (prm) => {
    for (const t of prm.targets) {
      T.click(t.pos);
      T.log(`objetivo ${t.label} → ${T.hud().pops}`);
    }
    await T.tick();
  };

  P.suture = async (prm) => {
    const pts = densify(prm.path, 0.25);
    const len = [0];
    for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const L = len[len.length - 1];
    const per = Math.max(3, Math.floor(L / prm.spacingMm));
    const at = (s) => pts[len.findIndex((v) => v >= s)] ?? pts[pts.length - 1];
    for (let li = 0; li < prm.layers.length; li++) {
      for (let i = 0; i < per; i++) {
        if (T.st().stepType !== 'suture') return;
        const c = at((L * (i + 0.5)) / per);
        T.drag(densify([{ x: c.x - 1, y: c.y - 5 }, { x: c.x + 1, y: c.y + 5 }], 1), 0.06);
        T.adv(0.25);
        await T.tick();
      }
      T.log(`sutura capa ${prm.layers[li]} → ${T.check()}`);
      await sleep0();
    }
  };

  P.pick = async (prm) => {
    for (const it of prm.items) {
      T.click(it.pos, 0.75);
      T.log(`pinzas ${it.id} → ${T.check()} · ${T.hud().pops}`);
      await T.tick();
    }
  };

  P.rotate = async (prm) => {
    const need = (prm.startValue - prm.targetValue) * prm.degPerUnit;
    const R = 12;
    const a0 = 200;
    const pts = [];
    const n = Math.ceil(Math.abs(need));
    for (let k = 0; k <= n; k++) {
      const a = ((a0 + (need * k) / n) * Math.PI) / 180;
      pts.push({ x: prm.pivot.x + R * Math.cos(a), y: prm.pivot.y + R * Math.sin(a) });
    }
    T.drag(pts, 0.04);
    T.adv(0.2);
    T.log(`rotación → medidores ${JSON.stringify(T.gauges())} · ${T.hud().pops} · pista: ${T.hint()}`);
    if (prm.pinSpot && T.st().stepType === 'rotate') {
      T.click(prm.pinSpot);
      T.log(`aguja antirrotacional → ${T.hud().pops}`);
    }
    await T.tick();
  };

  P.plate = async (prm) => {
    const idx = prm.options.findIndex((o) => o.id === prm.correctId);
    T.key(`Digit${idx + 1}`);
    T.adv(0.6);
    for (let i = 0; i < 800; i++) {
      const n = document.querySelector('.sb-needle');
      const z = document.querySelector('.sb-zone');
      if (!n || !z) break;
      const l = parseFloat(n.style.left);
      const zl = parseFloat(z.style.left);
      const zw = parseFloat(z.style.width);
      if (l > zl + zw * 0.3 && l < zl + zw * 0.7) {
        T.key('Space');
        T.log(`doblez con la aguja en ${l.toFixed(1)}% (zona ${zl.toFixed(1)}–${(zl + zw).toFixed(1)}%) → ${T.hud().pops}`);
        T.adv(0.2);
      } else T.adv(0.02);
    }
    T.move(prm.target.pos);
    T.adv(0.05);
    let g = T.gauges();
    T.log(`placa en el objetivo: ${JSON.stringify(g)}`);
    for (let it = 0; it < 30 && (g['Ángulo'] ?? 0) > 1; it++) {
      const before = g['Ángulo'];
      T.key('KeyE', Math.max(0.03, Math.min(0.5, before / 45)));
      g = T.gauges();
      if (g['Ángulo'] > before) {
        T.key('KeyQ', Math.max(0.03, Math.min(1, g['Ángulo'] / 45)));
        g = T.gauges();
      }
    }
    T.log(`placa tras Q/E: ${JSON.stringify(g)}`);
    T.click(prm.target.pos);
    T.log(`asentar placa → ${T.hud().pops} · ${T.check()}`);
    await T.tick();
  };

  // Tornillos, guiado por la pista del paso (orden actual: piloto → medir → atrapar → atornillar;
  // también vale si el anillo aparece antes del piloto).
  P.screws = async (prm) => {
    const holeNow = () => {
      const m0 = T.check().match(/Tornillos \((\d+)\//);
      const idx = m0 ? Number(m0[1]) : 0;
      const holes = prm.holes === 'plate' ? T.ctx().bone.plateHolesWorld() : prm.holes;
      return { idx, hole: holes[Math.min(idx, holes.length - 1)] };
    };
    let screwN = 0;
    for (let guard = 0; guard < 120; guard++) {
      if (T.st().stepType !== 'screws') return;
      const h = T.hint();
      const { idx, hole } = holeNow();
      const ring = document.querySelector('.sc-root:not(.sc-perfect):not(.sc-good):not(.sc-miss) .sc-ring');
      if (ring || /Espacio o clic cuando el anillo/.test(h)) {
        let scale = null;
        for (let i = 0; i < 400; i++) {
          const r = document.querySelector('.sc-root:not(.sc-perfect):not(.sc-good):not(.sc-miss) .sc-ring');
          const m = r?.style.transform.match(/scale\(([\d.]+)\)/);
          const sc = m ? Number(m[1]) : null;
          if (sc !== null && sc <= (T.opts.catchAt ?? 1.04)) {
            scale = sc;
            T.key('Space');
            break;
          }
          T.adv(sc === null ? 0.05 : 0.02);
        }
        T.adv(0.8);
        T.log(`tornillo ${++screwN}: Espacio con anillo a escala ${scale} → pista: ${T.hint()} · ${T.hud().pops}`);
      } else if (/U: usar|Se cayó/.test(h)) {
        T.key('Space');
        T.adv(5.5);
      } else if (/Esperando repuesto/.test(h)) {
        T.adv(1);
      } else if (/clic y mantén el taladro|Broca caliente|Salida/.test(h)) {
        await T.drillAt(hole, 'screws');
        T.adv(0.2);
      } else if (/Mide ([\d,]+) mm/.test(h)) {
        const depth = Number(h.match(/Mide ([\d,]+) mm/)[1].replace(',', '.'));
        const sorted = [...prm.lengthOptionsMm].sort((a, b) => a - b);
        const ideal = sorted.find((o) => o >= depth) ?? sorted[sorted.length - 1];
        T.key(`Digit${prm.lengthOptionsMm.indexOf(ideal) + 1}`);
        T.adv(0.3);
        T.log(`  agujero ${idx + 1}: medida ${depth} mm → elijo ${ideal} mm · ${T.hud().pops}`);
      } else if (/Mantén clic para atornillar/.test(h)) {
        T.move(hole);
        T.down(hole);
        let tq = 0;
        for (let i = 0; i < 60; i++) {
          T.adv(0.05);
          tq = T.gauges()['Torque'] ?? 0;
          if (tq >= (prm.torqueWindow[0] + prm.torqueWindow[1]) / 2) break;
        }
        T.up(hole);
        T.adv(0.1);
        T.log(`  torque ${tq} → ${T.check()} · ${T.hud().pops}`);
        await T.tick();
      } else {
        T.adv(0.3);
      }
    }
  };

  /** Juega la cirugía completa. */
  T.play = async (maxSteps = 40) => {
    let lastKey = '';
    let stuck = 0;
    let n = 0;
    for (let k = 0; k < maxSteps; k++) {
      const s = T.st();
      if (!s || s.finished) return (T.result = { finished: true, s });
      if (s.step === null) {
        T.adv(1);
        await sleep0();
        if (window.__game.mode !== 'surgery') return (T.result = { finished: true, mode: window.__game.mode });
        continue;
      }
      const key = `${s.phase}/${s.step}`;
      stuck = key === lastKey ? stuck + 1 : 0;
      lastKey = key;
      if (stuck >= 2) {
        T.log('ATASCADO en', key, T.hint(), T.check());
        await T.shot(`stuck-${s.stepType}`);
        return (T.result = { stuck: true, s });
      }
      const prm = T.prm();
      if (T.opts.stopAt && prm.type === T.opts.stopAt && (!T.opts.stopAtStep || s.step.includes(T.opts.stopAtStep))) {
        T.log(`STOP en ${key}`);
        return (T.result = { stopped: true, s });
      }
      T.log(`── PASO ${key} (${prm.type}) éxito=${s.exito.toFixed(0)} campo=${s.field.toFixed(0)}% caos=${s.chaos}`);
      await T.shot(`s${String(n++).padStart(2, '0')}-${prm.type}`);
      await (T.hooks?.[prm.type] ?? P[prm.type])(prm);
      T.adv(0.3);
      await T.tick();
      if (T.st()?.stepType !== prm.type || T.st()?.step !== s.step) await T.shot(`s${String(n - 1).padStart(2, '0')}-${prm.type}-done`);
      T.adv(1.8);
    }
    return (T.result = { finished: false, s: T.st() });
  };

  window.__pt = T;
})();
