import { defineConfig } from '@playwright/test';

// Configuración propia de playtest-A (casos 0, 1 y 2 jugados con entradas reales).
// Uso: PORT=5321 npx playwright test -c tests/playtest/playA.config.ts
// Reutiliza un vite ya levantado en PORT o lo arranca.
const PORT = Number(process.env.PORT ?? 5321);

export default defineConfig({
  testDir: '.',
  testMatch: /playA\.spec\.ts$/,
  timeout: 40 * 60_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    navigationTimeout: 120_000,
    actionTimeout: 15_000,
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
