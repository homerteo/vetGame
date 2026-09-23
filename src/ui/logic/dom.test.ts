// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { AttrCell, ClassCell, EnumClassCell, NumCell, StyleCell, TextCell, VarCell, fromHtml, h } from './dom';

/** Cuenta mutaciones DOM tras ejecutar fn. */
async function mutations(target: Node, fn: () => void): Promise<number> {
  let n = 0;
  const mo = new MutationObserver((recs) => {
    n += recs.length;
  });
  mo.observe(target, { subtree: true, childList: true, attributes: true, characterData: true });
  fn();
  await Promise.resolve();
  n += mo.takeRecords().length;
  mo.disconnect();
  return n;
}

describe('celdas DOM', () => {
  it('h crea y cuelga elementos', () => {
    const root = h('div', 'root');
    const s = h('span', 'a b', root, 'hola');
    expect(root.firstChild).toBe(s);
    expect(s.className).toBe('a b');
    expect(s.textContent).toBe('hola');
    const f = fromHtml('<b>x</b>', 'ic', root);
    expect(f.querySelector('b')?.textContent).toBe('x');
  });

  it('TextCell solo escribe si cambia', async () => {
    const el = h('span');
    const c = new TextCell(el);
    expect(c.set('a')).toBe(true);
    expect(c.set('a')).toBe(false);
    expect(await mutations(el, () => c.set('a'))).toBe(0);
    expect(await mutations(el, () => c.set('b'))).toBeGreaterThan(0);
    expect(el.textContent).toBe('b');
  });

  it('NumCell cuantiza y maneja NaN', async () => {
    const el = h('span');
    const c = new NumCell(el, (v) => (Number.isFinite(v) ? v.toFixed(0) : '--'), 1);
    expect(c.set(98.2)).toBe(true);
    expect(el.textContent).toBe('98');
    expect(c.set(98.4)).toBe(false);
    expect(c.set(98.6)).toBe(true);
    expect(el.textContent).toBe('99');
    expect(c.set(Number.NaN)).toBe(true);
    expect(el.textContent).toBe('--');
    expect(c.set(Number.NaN)).toBe(false);
    expect(await mutations(el, () => c.set(Number.NaN))).toBe(0);
  });

  it('StyleCell, VarCell, ClassCell, AttrCell y EnumClassCell', async () => {
    const el = h('div');
    const s = new StyleCell(el, 'width');
    s.set('10px');
    expect(el.style.width).toBe('10px');
    expect(s.set('10px')).toBe(false);
    const v = new VarCell(el, '--fill', 0.01);
    v.set(0.423);
    expect(el.style.getPropertyValue('--fill')).toBe('0.42');
    expect(v.set(0.4249)).toBe(false);
    expect(await mutations(el, () => v.set(0.421))).toBe(0);
    const c = new ClassCell(el, 'on');
    c.set(true);
    expect(el.classList.contains('on')).toBe(true);
    expect(c.set(true)).toBe(false);
    c.set(false);
    expect(el.classList.contains('on')).toBe(false);
    const a = new AttrCell(el, 'data-x');
    a.set('1');
    expect(el.getAttribute('data-x')).toBe('1');
    a.set(null);
    expect(el.hasAttribute('data-x')).toBe(false);
    const e = new EnumClassCell<'ok' | 'bad'>(el, 's-');
    e.set('ok');
    e.set('bad');
    expect(el.classList.contains('s-ok')).toBe(false);
    expect(el.classList.contains('s-bad')).toBe(true);
  });
});
