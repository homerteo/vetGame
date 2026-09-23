import { describe, expect, it, vi } from 'vitest';
import { createFrameGuard, escapeAction } from './flowLogic';

describe('escapeAction', () => {
  it('pausa en clínica y en quirófano', () => {
    expect(escapeAction(false, 'clinic')).toBe('pause');
    expect(escapeAction(false, 'surgery')).toBe('pause');
  });
  it('reanuda si ya estaba en pausa', () => {
    expect(escapeAction(true, 'surgery')).toBe('resume');
    expect(escapeAction(true, 'clinic')).toBe('resume');
  });
  it('no hace nada en los menús', () => {
    expect(escapeAction(false, 'menu')).toBeNull();
  });
});

describe('createFrameGuard', () => {
  it('un error aislado no detiene los fotogramas siguientes', () => {
    const onError = vi.fn();
    const onGiveUp = vi.fn();
    const g = createFrameGuard({ maxConsecutive: 3, onError, onGiveUp });
    let ticks = 0;
    expect(g.run(() => ticks++)).toBe(true);
    expect(
      g.run(() => {
        throw new Error('paso roto');
      }),
    ).toBe(false);
    expect(g.run(() => ticks++)).toBe(true);
    expect(ticks).toBe(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onGiveUp).not.toHaveBeenCalled();
    expect(g.consecutive).toBe(0);
  });

  it('se rinde tras N errores seguidos y vuelve a contar', () => {
    const onGiveUp = vi.fn();
    const g = createFrameGuard({ maxConsecutive: 3, onError: () => undefined, onGiveUp });
    const boom = () => {
      throw new Error('x');
    };
    g.run(boom);
    g.run(boom);
    expect(onGiveUp).not.toHaveBeenCalled();
    g.run(boom);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    expect(g.consecutive).toBe(0);
  });
});
