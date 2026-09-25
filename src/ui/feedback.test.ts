/**
 * 実機フィードバック（3 回目）のテスト:
 * 戻る警告（navGuard）・下書き（draft）・10 回タップの開放（unlockTaps）・ドリルの薄表示（drillVisibility）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StrokeHistory } from '@/canvas';
import type { ScoreResult, Stroke } from '@/scoring';
import { registerLockTap, unlockHint, UNLOCK_TAPS, UNLOCK_WINDOW_MS } from './unlockTaps';
import { drillVisibility, fadeAlphaOf, type DrillEntry } from './lesson/drillEntries';
import { strokeKey } from './lesson/drillEntries';
import { clearDraft, draftKey, loadDraft, saveDraft } from './draft';
import { armLeaveGuard, isLeaveGuarded, navigateAfterGuard, requestLeave, resetLeaveGuardForTest } from './navGuard';

// ---------------------------------------------------------------------------
// 10 回タップで開放
// ---------------------------------------------------------------------------

describe('registerLockTap（3 秒以内に 10 回で開放）', () => {
  it('10 回目で開放。3 回目から「あと n 回」', () => {
    let last = registerLockTap([], 0);
    let times = last.times;
    for (let i = 1; i < UNLOCK_TAPS; i++) {
      last = registerLockTap(times, i * 100);
      if (!last.unlocked) {
        times = last.times;
        if (i + 1 < 3) expect(unlockHint(last)).toBeNull();
        else expect(unlockHint(last)).toBe(`あと${UNLOCK_TAPS - (i + 1)}回で開放`);
      }
    }
    expect(last.unlocked).toBe(true);
    expect(last.times).toEqual([]);
  });

  it('3 秒より前のタップは数えない（ゆっくり叩いても開かない）', () => {
    let r = registerLockTap([], 0);
    let times = r.times;
    for (let i = 1; i < 30; i++) {
      r = registerLockTap(times, i * 400);
      times = r.times;
      expect(r.unlocked).toBe(false);
    }
    expect(times.length).toBeLessThanOrEqual(Math.ceil(UNLOCK_WINDOW_MS / 400));
  });
});

// ---------------------------------------------------------------------------
// ドリルの薄表示
// ---------------------------------------------------------------------------

const st = (x: number, t: number): Stroke => [
  { x, y: 10, p: 0.5, t },
  { x: x + 50, y: 10, p: 0.5, t: t + 10 },
];
const result: ScoreResult = { score: 70, sub: {}, hint: '', heat: [], raw: {} };
const entryOf = (s: Stroke): DrillEntry => ({ keys: [strokeKey(s)], strokes: [s], result, target: null });

describe('drillVisibility', () => {
  it('fadeAlphaOf: 最新 1、その前 3 本は 0.3、それより古いのは 0', () => {
    expect([0, 1, 2, 3, 4, 5].map(fadeAlphaOf)).toEqual([1, 0.3, 0.3, 0.3, 0, 0]);
  });

  it('採点済みの本だけ薄くする。補助線はそのまま、消しゴムの値は使われない', () => {
    const strokes = [st(0, 0), st(10, 100), st(20, 200), st(30, 300), st(40, 400), st(50, 500)];
    const guide = st(99, 999);
    const h: StrokeHistory = {
      strokes: [...strokes, guide],
      styles: [...strokes.map(() => undefined), { preset: 'guide', size: 1.5, opacity: 0.35 }],
    };
    const v = drillVisibility(h, strokes.map(entryOf));
    expect(v.entries).toEqual([0, 0, 0.3, 0.3, 0.3, 1]);
    expect(v.strokes).toEqual([0, 0, 0.3, 0.3, 0.3, 1, 1]);
  });

  it('紙を替えた位置より前は全部出さない。後の本から数え直す', () => {
    const strokes = [st(0, 0), st(10, 100), st(20, 200)];
    const h: StrokeHistory = { strokes, styles: strokes.map(() => undefined) };
    const v = drillVisibility(h, strokes.map(entryOf), 2);
    expect(v.strokes).toEqual([0, 0, 1]);
    expect(v.entries).toEqual([0, 0, 1]);
    // 紙を替えた直後（まだ描いていない）は何も出さない
    expect(drillVisibility(h, strokes.map(entryOf), 3).strokes).toEqual([0, 0, 0]);
  });
});

// ---------------------------------------------------------------------------
// 下書き（sessionStorage）
// ---------------------------------------------------------------------------

function memoryStorage(limit = Infinity): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => {
      if (v.length > limit) throw new Error('QuotaExceededError');
      m.set(k, v);
    },
  };
}

describe('draft', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('キーの形', () => {
    expect(draftKey('s0-u1-l1', 2)).toBe('seichotsu.draft.s0-u1-l1.2');
    expect(draftKey(null)).toBe('seichotsu.draft.free');
  });

  it('保存 → 読み込み → 消す（消しゴム・補助線のスタイルも戻る）', () => {
    vi.stubGlobal('sessionStorage', memoryStorage());
    const key = draftKey('L', 1);
    const h: StrokeHistory = {
      strokes: [st(0, 0), st(10, 100)],
      styles: [undefined, { preset: 'eraser', size: 12, opacity: 1 }],
    };
    saveDraft(key, h, { width: 800, height: 600 });
    const d = loadDraft(key);
    expect(d?.size).toEqual({ width: 800, height: 600 });
    expect(d?.history.strokes).toEqual(h.strokes);
    expect(d?.history.styles[1]).toEqual({ preset: 'eraser', size: 12, opacity: 1 });
    clearDraft(key);
    expect(loadDraft(key)).toBeNull();
  });

  it('線が 0 本なら消す。容量不足・壊れたデータは静かに諦める', () => {
    vi.stubGlobal('sessionStorage', memoryStorage(10));
    const key = draftKey('L', 1);
    expect(() => saveDraft(key, { strokes: [st(0, 0)], styles: [undefined] }, { width: 1, height: 1 })).not.toThrow();
    expect(loadDraft(key)).toBeNull();
    vi.stubGlobal('sessionStorage', memoryStorage());
    sessionStorage.setItem(key, '{broken');
    expect(loadDraft(key)).toBeNull();
    saveDraft(key, { strokes: [], styles: [] }, { width: 1, height: 1 });
    expect(sessionStorage.getItem(key)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 離脱ガード（history の 1 段）
// ---------------------------------------------------------------------------

/** 最小の history / location / window（back は非同期に popstate を出す） */
function fakeBrowser() {
  const entries: { state: unknown; url: string }[] = [{ state: null, url: 'http://x/#/free' }];
  let index = 0;
  const listeners = new Map<string, Set<(e: Event) => void>>();
  const fire = (type: string, e: Event) => listeners.get(type)?.forEach((cb) => cb(e));
  const hist = {
    get state() {
      return entries[index]!.state;
    },
    get length() {
      return entries.length;
    },
    pushState(state: unknown, _t: string, url: string) {
      entries.splice(index + 1);
      entries.push({ state, url });
      index += 1;
    },
    replaceState(state: unknown, _t: string, url: string) {
      entries[index] = { state, url };
    },
    back() {
      if (index === 0) return;
      index -= 1;
      queueMicrotask(() => fire('popstate', new Event('popstate')));
    },
  };
  vi.stubGlobal('history', hist);
  vi.stubGlobal('location', {
    get href() {
      return entries[index]!.url;
    },
  });
  vi.stubGlobal('window', {
    addEventListener: (t: string, cb: (e: Event) => void) => {
      if (!listeners.has(t)) listeners.set(t, new Set());
      listeners.get(t)!.add(cb);
    },
    removeEventListener: (t: string, cb: (e: Event) => void) => listeners.get(t)?.delete(cb),
  });
  return { entries, getIndex: () => index, fire, hist };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('navGuard', () => {
  beforeEach(() => resetLeaveGuardForTest());
  afterEach(() => {
    resetLeaveGuardForTest();
    vi.unstubAllGlobals();
  });

  it('ガード中は 1 段積み、端末の戻るで積み直して確認を出す（「戻る」で既定の戻り先）', async () => {
    const b = fakeBrowser();
    const asked: (() => void)[] = [];
    const fallback = vi.fn();
    const disarm = armLeaveGuard((p) => asked.push(p), fallback);
    expect(b.entries.length).toBe(2);
    expect(isLeaveGuarded()).toBe(true);
    b.hist.back(); // 端末の戻る
    await flush();
    expect(asked.length).toBe(1);
    expect(b.getIndex()).toBe(1); // 積み直した
    asked[0]!();
    expect(fallback).toHaveBeenCalledTimes(1);
    disarm();
    await flush();
    expect(b.getIndex()).toBe(0);
  });

  it('requestLeave: ガードが無ければすぐ、あれば確認を通す', () => {
    fakeBrowser();
    const go = vi.fn();
    requestLeave(go);
    expect(go).toHaveBeenCalledTimes(1);
    const asked: (() => void)[] = [];
    armLeaveGuard((p) => asked.push(p), () => undefined);
    requestLeave(go);
    expect(go).toHaveBeenCalledTimes(1);
    asked[0]!();
    expect(go).toHaveBeenCalledTimes(2);
  });

  it('アプリ内の移動は積んだ段を戻してから行う（確認は出さない）', async () => {
    const b = fakeBrowser();
    const ask = vi.fn();
    armLeaveGuard(ask, () => undefined);
    const go = vi.fn();
    navigateAfterGuard(go);
    expect(go).not.toHaveBeenCalled();
    await flush();
    expect(go).toHaveBeenCalledTimes(1);
    expect(ask).not.toHaveBeenCalled();
    expect(b.getIndex()).toBe(0);
    expect(isLeaveGuarded()).toBe(false);
  });

  it('ガードを外すと段を戻す。戻したあとの popstate では確認を出さない', async () => {
    const b = fakeBrowser();
    const ask = vi.fn();
    const disarm = armLeaveGuard(ask, () => undefined);
    disarm();
    await flush();
    expect(ask).not.toHaveBeenCalled();
    expect(b.getIndex()).toBe(0);
    // ガードが無ければそのまま移動する
    const go = vi.fn();
    navigateAfterGuard(go);
    expect(go).toHaveBeenCalledTimes(1);
  });
});
