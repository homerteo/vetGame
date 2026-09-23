/** Formatos de números y tiempos para la interfaz (coma decimal, es-419). */

/** 75 → "1:15"; negativos se tratan como 0. */
export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

/** Número con coma decimal: fmtDec(78.44, 1) → "78,4". */
export function fmtDec(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return '--';
  return v.toFixed(digits).replace('.', ',');
}

/** Entero con separador de miles: 1250 → "1.250". */
export function fmtInt(v: number): string {
  if (!Number.isFinite(v)) return '--';
  const n = Math.round(v);
  const sign = n < 0 ? '−' : '';
  const s = String(Math.abs(n));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += '.';
    out += s[i];
  }
  return sign + out;
}

/** Valor de constante o "--" si no hay señal. */
export function fmtVital(v: number, digits = 0): string {
  return Number.isFinite(v) ? fmtDec(v, digits) : '--';
}

/** Recorta un texto a n caracteres con elipsis. */
export function ellipsize(text: string, n: number): string {
  return text.length <= n ? text : text.slice(0, Math.max(0, n - 1)).trimEnd() + '…';
}

/** Duración razonable de un subtítulo según su longitud (s). */
export function readingSeconds(text: string): number {
  return Math.min(7, Math.max(2.2, 1.2 + text.length * 0.055));
}
