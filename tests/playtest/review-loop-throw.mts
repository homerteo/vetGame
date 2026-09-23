// @ts-nocheck -- guion de Node: importa el .ts directamente (node --experimental-strip-types).
// Una excepción dentro del tick mata el bucle para siempre. Uso: node tests/playtest/review-loop-throw.mts
import { createLoop } from '../../src/core/Loop.ts';
const q: Array<(t: number) => void> = [];
(globalThis as any).requestAnimationFrame = (f: (t: number) => void) => (q.push(f), q.length);
(globalThis as any).cancelAnimationFrame = () => {};
let ticks = 0;
let throwOnce = true;
const loop = createLoop(() => {
  ticks++;
  if (ticks === 3 && throwOnce) { throwOnce = false; throw new Error('paso roto'); }
});
loop.start();
let now = 0;
for (let i = 0; i < 20; i++) {
  const f = q.shift();
  if (!f) { console.log(`frame ${i}: no rAF scheduled -> loop dead, ticks=${ticks}`); break; }
  now += 16;
  try { f(now); } catch (e) { console.log(`frame ${i}: tick threw: ${(e as Error).message}`); }
}
console.log('total ticks', ticks);
