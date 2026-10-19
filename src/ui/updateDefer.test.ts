import { describe, expect, it } from 'vitest';
import { createReloadController, RELOAD_AFTER_RELEASE_MS, UPDATE_DEFERRED_MESSAGE, type ReloadDeps } from './updateDefer';

function harness(init: { free: boolean; guarded: boolean }) {
  const state = { ...init };
  const listeners = new Set<(g: boolean) => void>();
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const log: string[] = [];
  const deps: ReloadDeps = {
    isFreeDraw: () => state.free,
    isGuarded: () => state.guarded,
    onGuardChange: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    reload: () => log.push('reload'),
    notify: (m) => log.push(`notify:${m}`),
    setTimer: (fn, ms) => timers.push({ fn, ms }),
  };
  const setGuard = (g: boolean) => {
    state.guarded = g;
    for (const cb of [...listeners]) cb(g);
  };
  const flush = () => {
    while (timers.length) timers.shift()!.fn();
  };
  return { state, deps, log, timers, listeners, setGuard, flush };
}

describe('createReloadController（ilust-update-defer）', () => {
  it('#/free 以外ではすぐ再読み込みする（今のまま）', () => {
    const h = harness({ free: false, guarded: true });
    expect(createReloadController(h.deps).needReload()).toBe('reloaded');
    expect(h.log).toEqual(['reload']);
  });

  it('#/free でも未保存の線が無ければすぐ再読み込みする', () => {
    const h = harness({ free: true, guarded: false });
    expect(createReloadController(h.deps).needReload()).toBe('reloaded');
    expect(h.log).toEqual(['reload']);
  });

  it('#/free に未保存の線があるあいだは保留して知らせ、保存（ガードが外れる）の後に再読み込みする', () => {
    const h = harness({ free: true, guarded: true });
    const c = createReloadController(h.deps);
    expect(c.needReload()).toBe('deferred');
    expect(c.needReload()).toBe('deferred');
    expect(h.log).toEqual([`notify:${UPDATE_DEFERRED_MESSAGE}`]);
    expect(c.isPending()).toBe(true);
    h.state.free = false;
    h.setGuard(false);
    expect(h.timers[0]?.ms).toBe(RELOAD_AFTER_RELEASE_MS);
    expect(h.log).not.toContain('reload');
    h.flush();
    expect(h.log).toEqual([`notify:${UPDATE_DEFERRED_MESSAGE}`, 'reload']);
    expect(c.isPending()).toBe(false);
    expect(h.listeners.size).toBe(0);
  });

  it('ガードが外れた直後にまた描き始めたら、次に外れるまで待つ', () => {
    const h = harness({ free: true, guarded: true });
    const c = createReloadController(h.deps);
    c.needReload();
    h.setGuard(false);
    h.state.guarded = true; // 待ちの間にまた描いた
    h.flush();
    expect(h.log).not.toContain('reload');
    h.setGuard(false);
    h.flush();
    expect(h.log.filter((l) => l === 'reload')).toHaveLength(1);
  });
});
