import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ command }) => ({
  // Rutas relativas en producción para servir desde GitHub Pages (/vetGame/).
  base: command === 'build' ? './' : '/',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { host: '127.0.0.1' },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
}));
