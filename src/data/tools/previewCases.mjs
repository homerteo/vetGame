// Vista previa de los casos: imprime el resumen de cada caso y genera una página HTML
// con el dibujo SVG de la anatomía y los objetivos (pose inicial y final).
// Uso: node src/data/tools/previewCases.mjs [carpeta=screenshots/data]
// Escribe <carpeta>/cases.html (todos) y <carpeta>/case-<n>.html (uno por caso, a 1280 px).
// No abre puertos: carga los módulos TS con el cargador SSR de Vite en modo middleware.
import { createServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] ?? 'screenshots/data';
const css = '<style>body{margin:0;background:#222;color:#eee;font:12px sans-serif}section{padding:4px 8px}h2{margin:2px 0;font-size:13px}.row{display:flex;gap:8px}</style>';
const server = await createServer({
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const { CASES } = await server.ssrLoadModule('/src/data/cases.ts');
  const { caseSummary, caseSvg } = await server.ssrLoadModule('/src/data/summary.ts');
  const blocks = [];
  for (const c of CASES) {
    console.log(caseSummary(c));
    console.log('');
    const row = `<section><h2>${c.index}. ${c.patient.name} — inicio | final</h2><div class="row">${caseSvg(c, { mode: 'start', widthPx: 620 })}${caseSvg(c, { mode: 'target', widthPx: 620 })}</div></section>`;
    blocks.push(row);
    // Página individual: detalle ampliado de la ventana (inicio arriba, final abajo).
    const zoom = (mode) => caseSvg(c, { mode, widthPx: 1260 }).replace('viewBox="0 0 160 100"', 'viewBox="20 32 120 36"').replace(/height="\d+"/, 'height="378"');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `case-${c.index}.html`), `<!doctype html><meta charset="utf-8">${css}${zoom('start')}${zoom('target')}`);
  }
  fs.writeFileSync(path.join(dir, 'cases.html'), `<!doctype html><meta charset="utf-8"><title>Casos</title>${css}${blocks.join('')}`);
  console.log(`Vista previa escrita en ${dir}`);
} finally {
  await server.close();
}
