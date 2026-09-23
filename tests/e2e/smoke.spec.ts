import { expect, test, type Page } from '@playwright/test';

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

test('pantalla de título sin errores', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'screenshots/e2e/title.png' });
  expect(errors.filter((e) => !/fonts\.g/.test(e))).toEqual([]);
});

for (const index of [0, 1, 2, 3, 4, 5, 6, 7]) {
  test(`caso ${index}: quirófano completo con pasos forzados`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(`/?case=${index}&skip=clinic&seed=7`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (window as any).__game?.mode === 'surgery', null, { timeout: 60000, polling: 500 });
    await page.evaluate(() => (window as any).__game.advance(3));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `screenshots/e2e/case${index}-start.png` });
    // Juega un poco con el ratón sobre la herida.
    await page.mouse.move(640, 360);
    await page.mouse.down();
    for (let i = 0; i < 20; i++) await page.mouse.move(560 + i * 8, 360 + Math.sin(i) * 4);
    await page.mouse.up();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `screenshots/e2e/case${index}-play.png` });
    // Fuerza el avance de todos los pasos.
    for (let i = 0; i < 40; i++) {
      const done = await page.evaluate(() => {
        const d = (window as any).__game.surgery() as Dbg | null;
        if (!d) return true;
        const s = d.state();
        if (s.finished || s.step === null) return true;
        d.forceCompleteStep();
        (window as any).__game.advance(2);
        return false;
      });
      if (done) break;
      await page.waitForTimeout(200);
    }
    await page.evaluate(() => (window as any).__game.advance(5));
    await page.waitForFunction(() => (window as any).__game?.mode === 'menu', null, { timeout: 60000, polling: 500 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `screenshots/e2e/case${index}-audit.png` });
    expect(errors.filter((e) => !/fonts\.g/.test(e))).toEqual([]);
  });
}

test('clínica del tutorial arranca y se puede caminar', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?case=0&go=clinic&seed=3');
  await page.waitForFunction(() => (window as any).__game?.mode === 'clinic', null, { timeout: 60000, polling: 500 });
  await page.waitForTimeout(2000);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(900);
  await page.keyboard.up('KeyW');
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(600);
  await page.keyboard.up('KeyD');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/e2e/clinic.png' });
  expect(errors.filter((e) => !/fonts\.g/.test(e))).toEqual([]);
});
