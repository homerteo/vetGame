// Dos toques rápidos de Z sin Voz Firme desbloqueada: ¿cuántas órdenes salen?
// Uso: PORT=5325 node tests/playtest/review-doubletap.mjs
import { chromium } from '@playwright/test';
const BASE = `http://127.0.0.1:${process.env.PORT ?? '5325'}`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.addInitScript(() => { try { localStorage.removeItem('dra-emiliana-save-v1'); } catch {} });
await page.goto(`${BASE}/?case=1&skip=clinic&seed=7`, { waitUntil: 'domcontentloaded', timeout: 240000 });
await page.waitForFunction(() => !!window.__game, null, { timeout: 240000, polling: 1000 });
const E = (f, a) => page.evaluate(f, a);
await E(() => window.__game.advance(3));
await E(() => { window.__cmds = []; window.__game.surgery().ctx().bus.on('command', (c) => window.__cmds.push(c.tone)); });
const tap = async () => { await page.keyboard.down('KeyZ'); await E(() => window.__game.advance(0.05)); await page.keyboard.up('KeyZ'); };
await tap(); await E(() => window.__game.advance(0.1)); await tap();
await E(() => window.__game.advance(1));
console.log('firmSweet unlocked?', await E(() => window.__game.save.unlockedWeek >= 4), 'two taps 0.15 s apart -> commands:', JSON.stringify(await E(() => window.__cmds)));
await E(() => { window.__cmds = []; });
await tap(); await E(() => window.__game.advance(1)); await tap(); await E(() => window.__game.advance(1));
console.log('two taps 1 s apart -> commands:', JSON.stringify(await E(() => window.__cmds)));
await browser.close();
