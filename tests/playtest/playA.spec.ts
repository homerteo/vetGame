/*
 * playtest-A: juega los casos 0 (Panchito), 1 (Duquesa) y 2 (Merengue) de principio a fin
 * con eventos reales de ratón/teclado, sin forceCompleteStep (salvo atasco, que hace fallar la prueba).
 *   PORT=5321 npx playwright test -c tests/playtest/playA.config.ts
 *   PLAY_CASES=0 PORT=5321 npx playwright test -c tests/playtest/playA.config.ts   (solo un caso)
 * Capturas e informe JSON en screenshots/polish/playtest-A/.
 */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { Player } from './playA-lib';

// Con PLAY_SKIP (solo exploración) las capturas van a una subcarpeta para no pisar las de la partida completa.
const OUT = process.env.PLAY_SKIP ? `screenshots/polish/playtest-A/explore-skip${process.env.PLAY_SKIP}` : 'screenshots/polish/playtest-A';
const CASES = (process.env.PLAY_CASES ?? '0,1,2').split(',').map(Number);

for (const idx of CASES) {
  test(`caso ${idx}: cirugía completa con entradas reales`, async ({ page }) => {
    const pl = new Player(page, idx, OUT);
    await page.goto(`/?case=${idx}&skip=clinic&seed=7`, { waitUntil: 'domcontentloaded' });
    const reports = await pl.playSurgery({ commandsDemo: true });
    const save = await page.evaluate(() => (window as any).__game.save);
    const summary = {
      case: idx,
      mode: await page.evaluate(() => (window as any).__game.mode),
      steps: reports.map((r) => ({ label: r.label, type: r.type, ok: r.ok, stuck: r.stuck, gameSec: +(r.endT - r.startT).toFixed(1), faults: r.faults, gestures: r.gestures })),
      lastRanks: save?.lastRanks,
      errors: pl.errors,
      observations: pl.observations,
    };
    fs.writeFileSync(`${OUT}/case${idx}-report.json`, JSON.stringify(summary, null, 1));
    expect(pl.errors, 'errores de página').toEqual([]);
    expect(reports.filter((r) => r.stuck).map((r) => r.label), 'pasos atascados').toEqual([]);
  });
}
