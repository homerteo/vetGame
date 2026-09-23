import { defineConfig } from '@playwright/test';

// Configuración de las sesiones de playtest (tests/playtest/*.spec.ts).
// Uso: PORT=5323 npx playwright test -c tests/playtest/playwright.playtest.config.ts [playC]
// Reutiliza un vite ya levantado en PORT (más rápido al iterar) o lo arranca.
const PORT = Number(process.env.PORT ?? 5323);

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  timeout: 3_600_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    navigationTimeout: 120_000,
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
