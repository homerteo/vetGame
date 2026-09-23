import { expect, test, type Page } from '@playwright/test';

/*
 * playtest-B — casos 3 (Sir Winston), 4 (Chorizo) y 5 (Tanque) jugados con entradas reales, sin forceCompleteStep.
 *
 * Uso: PORT=5322 npx playwright test -c tests/playtest/playwright.playtest.config.ts playB
 *
 * El piloto (tests/playtest/playB-driver.js) se inyecta en la página y genera PointerEvent/WheelEvent/KeyboardEvent
 * sobre el canvas #gl y la ventana: el mismo camino que el ratón (src/core/Input.ts → SurgeryController).
 * Se comprobó con page.mouse que el ratón real produce los mismos eventos (ver prueba "ratón real").
 * En una máquina cargada, cada ida y vuelta CDP cuesta segundos; por eso el grueso va dentro de la página y el
 * render se hace solo bajo demanda (compuerta de requestAnimationFrame, window.__pump).
 *
 * Las pruebas "problema conocido" afirman el comportamiento CORRECTO: fallan mientras el fallo siga vivo.
 */

const DRIVER = 'tests/playtest/playB-driver.js';

type Result = { finished?: boolean; stopped?: boolean; stuck?: boolean; error?: string };

async function boot(page: Page, caseIdx: number) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${e.message}\n${e.stack ?? ''}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('dra-emiliana-save-v1');
    } catch {
      /* sin almacenamiento */
    }
  });
  await page.addInitScript({ path: DRIVER });
  await page.goto(`/?case=${caseIdx}&skip=clinic&seed=7`, { waitUntil: 'domcontentloaded', timeout: 240_000 });
  await page.waitForFunction(() => (window as any).__game?.mode === 'surgery', null, { timeout: 240_000 });
  await page.evaluate(() => (window as any).__game.advance(5.7));
  return errors;
}

/** Arranca el piloto y espera su resultado; vuelca el diario del piloto a la salida. */
async function play(page: Page, opts: Record<string, unknown>, tag: string): Promise<Result> {
  await page.evaluate((o) => {
    const T = (window as any).__pt;
    T.result = null;
    T.opts = o;
    T.chaosPolicy = (o as any).chaos ?? 'respond';
    T.play(40).catch((e: Error) => (T.result = { error: String(e) }));
  }, opts);
  let seen = 0;
  for (;;) {
    const r = await page.evaluate((s) => {
      const T = (window as any).__pt;
      return { logs: T.logs.slice(s) as string[], shot: T.shotReq as string | null, result: T.result as Result | null };
    }, seen);
    seen += r.logs.length;
    for (const l of r.logs) console.log(`[${tag}] ${l}`);
    if (r.shot) {
      await page.evaluate(() => (window as any).__pump(2));
      await page.screenshot({ path: `screenshots/polish/playtest-B/spec-${tag}-${r.shot}.png`, timeout: 240_000 });
      await page.evaluate(() => ((window as any).__pt.shotReq = null));
    }
    if (r.result) return r.result;
    await page.waitForTimeout(700);
  }
}

for (const c of [3, 4, 5]) {
  test(`caso ${c}: cirugía completa con entradas reales y caos atendido`, async ({ page }) => {
    const errors = await boot(page, c);
    const res = await play(page, { chaos: 'respond' }, `c${c}`);
    expect(res.error ?? null).toBeNull();
    expect(res.stuck ?? false).toBe(false);
    expect(res.finished).toBe(true);
    const chaos = await page.evaluate(() => (window as any).__pt.chaosLog);
    console.log(`[c${c}] caos`, JSON.stringify(chaos));
    for (const ev of chaos) if (ev.actions && !ev.actions.includes('nada')) expect(ev.stillActive, `${ev.kind} sin resolver`).toBe(false);
    await page.evaluate(() => (window as any).__game.advance(6));
    expect(await page.evaluate(() => (window as any).__game.mode)).toBe('menu');
    expect(errors).toEqual([]);
  });
}

test('ratón real: un trazo de bisturí con page.mouse abre la piel (caso 3)', async ({ page }) => {
  await boot(page, 3);
  const path = await page.evaluate(() => (window as any).__pt.densify((window as any).__game.surgery().stepParams().path, 3));
  const px = await page.evaluate((pts) => pts.map((p: any) => (window as any).__game.surgery().project(p)), path);
  await page.mouse.move(px[0].x, px[0].y);
  await page.mouse.wheel(0, -100); // presión 3 → 4
  await page.mouse.down();
  for (let i = 1; i < px.length; i++) {
    await page.mouse.move(px[i].x, px[i].y);
    await page.evaluate(() => (window as any).__game.advance(0.06));
  }
  await page.mouse.up();
  await page.evaluate(() => (window as any).__game.advance(0.1));
  const check = await page.evaluate(() => (window as any).__pt.check());
  expect(check).toContain('[x] Incisión: piel');
});

test('problema conocido: tras el intersticial de fase, el ratón real debe llegar al canvas (caso 3)', async ({ page }) => {
  await boot(page, 3);
  await page.evaluate(async () => {
    const T = (window as any).__pt;
    await T.P.incision(T.prm()); // fase 1 completa → intersticial "Fase 2: Hemostasia"
  });
  await page.waitForTimeout(4000); // tiempo real: el intersticial dura 1,6 s
  await page.evaluate(() => (window as any).__game.advance(2));
  const top = await page.evaluate(() => {
    const p = (window as any).__game.surgery().project({ x: 80, y: 50 });
    const el = document.elementFromPoint(p.x, p.y);
    return el ? `${el.tagName}.${el.className}` : null;
  });
  console.log('[curtain] elemento bajo la herida:', top);
  expect(top).toBe('CANVAS.');
});

test('problema conocido: sierra — pulsar primero el derecho (irrigar) y luego el izquierdo debe cortar (caso 5)', async ({ page }) => {
  await boot(page, 5);
  const r = await play(page, { chaos: 'ignore', stopAt: 'saw' }, 'c5-chord');
  expect(r.stopped).toBe(true);
  // Acorde con la misma secuencia de eventos que produce Chromium con el ratón real
  // (derecho: pointerdown button=2; luego izquierdo: pointermove button=0 buttons=3).
  const pct = await page.evaluate(() => {
    const T = (window as any).__pt;
    T.adv(2); // fin del intersticial
    const arc = T.densify(T.prm().path, 1);
    T.move(arc[0]);
    T.down(arc[0], 2);
    T.adv(0.05);
    T.down(arc[0], 0);
    for (let i = 1; i <= 10; i++) {
      T.move(arc[i]);
      T.adv(0.1);
    }
    const v = Number(document.querySelector('.prog-check')?.textContent?.match(/\((\d+)%\)/)?.[1] ?? 0);
    T.up(null, 0);
    T.up(null, 2);
    return v;
  });
  expect(pct).toBeGreaterThan(0);
});

test('problema conocido: tornillos — el primer tornillo no debe caer antes de 1,5 s tras asentar la placa (caso 5)', async ({ page }) => {
  await boot(page, 5);
  const r = await play(page, { chaos: 'ignore', stopAt: 'plate' }, 'c5-screw');
  expect(r.stopped).toBe(true);
  const dropped = await page.evaluate(async () => {
    const T = (window as any).__pt;
    T.adv(2);
    await T.P.plate(T.prm());
    const t0 = T.st().t;
    for (let i = 0; i < 80; i++) {
      if (/Se cayó/.test(T.hint())) return T.st().t - t0;
      T.adv(0.05);
    }
    return 99;
  });
  console.log('[c5-screw] cae a los', dropped, 's');
  expect(dropped).toBeGreaterThan(1.5);
});
