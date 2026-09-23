import { expect, test, type Page } from '@playwright/test';

// Regresiones de integración encontradas en el primer playtest con entradas reales.

type Dbg = {
  forceCompleteStep(): void;
  state(): Record<string, unknown>;
  setExito(v: number): void;
};

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${e.message}\n${e.stack ?? ''}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

async function openSurgery(page: Page, index: number) {
  await page.goto(`/?case=${index}&skip=clinic&seed=7`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__game?.mode === 'surgery', null, { timeout: 90000, polling: 500 });
  await page.evaluate(() => (window as any).__game.advance(4));
}

test('el telón entre fases se desmonta y los clics vuelven a llegar al lienzo', async ({ page }) => {
  const errors = collectErrors(page);
  await openSurgery(page, 0);
  await page.evaluate(() => {
    (window as any).__downs = 0;
    document.getElementById('gl')!.addEventListener('pointerdown', () => (window as any).__downs++);
    const d = (window as any).__game.surgery() as Dbg;
    d.forceCompleteStep();
  });
  // El telón aparece…
  await expect(page.locator('.scr-inter')).toHaveCount(1);
  // …y se retira solo al terminar sus segundos.
  await expect(page.locator('.scr-inter')).toHaveCount(0, { timeout: 8000 });
  await page.evaluate(() => (window as any).__game.advance(2));
  const at = await page.evaluate(() => document.elementFromPoint(640, 400)?.tagName);
  expect(at).toBe('CANVAS');
  await page.mouse.click(640, 400);
  expect(await page.evaluate(() => (window as any).__downs)).toBe(1);
  expect(errors.filter((e) => !/fonts\.g/.test(e))).toEqual([]);
});

test('Esc pausa el quirófano (y congela el tiempo); un segundo Esc reanuda', async ({ page }) => {
  const errors = collectErrors(page);
  await openSurgery(page, 0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.pause-card')).toBeVisible();
  const t0 = await page.evaluate(() => ((window as any).__game.surgery() as Dbg).state().t as number);
  await page.waitForTimeout(1200);
  const t1 = await page.evaluate(() => ((window as any).__game.surgery() as Dbg).state().t as number);
  expect(t1).toBe(t0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.pause-card')).toHaveCount(0);
  expect(errors.filter((e) => !/fonts\.g/.test(e))).toEqual([]);
});

test('Éxito a 0 con constantes estables provoca el paro', async ({ page }) => {
  const errors = collectErrors(page);
  await openSurgery(page, 0);
  const s = await page.evaluate(() => {
    const d = (window as any).__game.surgery() as Dbg;
    d.setExito(0);
    (window as any).__game.advance(0.3);
    return d.state();
  });
  expect(s.arrest).toBe(true);
  expect(errors.filter((e) => !/fonts\.g/.test(e))).toEqual([]);
});
