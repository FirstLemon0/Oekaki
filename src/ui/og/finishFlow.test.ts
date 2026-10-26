/**
 * 新しいお絵描きの「保存して終わる」の流れ（src/ui/og/finishFlow.ts、受け入れ ilust-mark-retry = ilust-sup-followup-05）。
 *
 * - 保存は成功したのに Before / After の印が 1 回目だけ失敗（reject）→ 失敗の文言。もう一度押すと保存は飛ばし（2 回保存しない）、
 *   印を付け直して leave へ進む
 * - 印は付いたら 2 度付けない。続きから描いた絵・?save= の無い自由お絵描きは印を付けない
 * - 保存の失敗（容量不足）は retry を持ち、次に押したときは retry で書き直す
 * - 記録と下書きの掃除（finalize）が投げても失敗として返す（投げない）
 */
import { describe, expect, it, vi } from 'vitest';
import type { Drawing } from '@/data/types';
import type { OgSaveOutcome } from './freeSession';
import { runOgFinish, type OgFinishDeps, type OgFinishRefs } from './finishFlow';

const drawing = { id: 'drawing-1' } as unknown as Drawing;

function refs(): OgFinishRefs {
  return { savedDrawing: { current: null }, retry: { current: null }, marked: { current: false } };
}

function deps(over: Partial<OgFinishDeps> = {}) {
  const calls: string[] = [];
  const d: OgFinishDeps = {
    save: vi.fn(async (): Promise<OgSaveOutcome> => {
      calls.push('save');
      return { status: 'saved', drawing };
    }),
    markBeforeAfter: vi.fn(async (id: string, save: 'before' | 'after') => {
      calls.push(`mark:${id}:${save}`);
    }),
    finalize: vi.fn(async () => {
      calls.push('finalize');
    }),
    leave: vi.fn(() => {
      calls.push('leave');
    }),
    ...over,
  };
  return { d, calls };
}

describe('ilust-mark-retry: Before / After の印は保存の枝の外で、付くまで毎回（ilust-sup-followup-05）', () => {
  it('1 回目だけ印が reject → 失敗。2 回目の finish では保存を飛ばして印を付け直し、leave へ', async () => {
    const r = refs();
    let attempt = 0;
    const { d, calls } = deps({
      markBeforeAfter: vi.fn(async (id: string, save: 'before' | 'after') => {
        attempt += 1;
        calls.push(`mark:${id}:${save}#${attempt}`);
        if (attempt === 1) throw new DOMException('transient', 'AbortError');
      }),
    });
    const first = await runOgFinish({ save: 'after', continuing: false, refs: r, deps: d });
    expect(first).toEqual({ status: 'failed', reason: 'other' });
    expect(r.savedDrawing.current).toBe(drawing);
    expect(r.marked.current).toBe(false);
    expect(d.leave).not.toHaveBeenCalled();

    const second = await runOgFinish({ save: 'after', continuing: false, refs: r, deps: d });
    expect(second).toEqual({ status: 'left' });
    expect(d.save).toHaveBeenCalledTimes(1); // 2 回保存しない（絵は 1 枚）
    expect(d.markBeforeAfter).toHaveBeenCalledTimes(2);
    expect(d.markBeforeAfter).toHaveBeenLastCalledWith('drawing-1', 'after');
    expect(r.marked.current).toBe(true);
    expect(calls).toEqual(['save', 'mark:drawing-1:after#1', 'mark:drawing-1:after#2', 'finalize', 'leave']);
  });

  it('印が付いた後に finalize が失敗して押し直しても、印は 2 度付けない', async () => {
    const r = refs();
    let fin = 0;
    const { d } = deps({
      finalize: vi.fn(async () => {
        fin += 1;
        if (fin === 1) throw new Error('streak write failed');
      }),
    });
    expect(await runOgFinish({ save: 'before', continuing: false, refs: r, deps: d })).toEqual({ status: 'failed', reason: 'other' });
    expect(await runOgFinish({ save: 'before', continuing: false, refs: r, deps: d })).toEqual({ status: 'left' });
    expect(d.markBeforeAfter).toHaveBeenCalledTimes(1);
    expect(d.markBeforeAfter).toHaveBeenCalledWith('drawing-1', 'before');
    expect(d.save).toHaveBeenCalledTimes(1);
  });

  it('続きから描いた絵と ?save= の無い自由お絵描きは印を付けない', async () => {
    const a = deps();
    expect(await runOgFinish({ save: 'after', continuing: true, refs: refs(), deps: a.d })).toEqual({ status: 'left' });
    expect(a.d.markBeforeAfter).not.toHaveBeenCalled();
    const b = deps();
    expect(await runOgFinish({ continuing: false, refs: refs(), deps: b.d })).toEqual({ status: 'left' });
    expect(b.d.markBeforeAfter).not.toHaveBeenCalled();
    expect(b.calls).toEqual(['save', 'finalize', 'leave']);
  });

  it('何も描いていない（empty）なら保存も印も無しで finalize → leave', async () => {
    const { d, calls } = deps({ save: vi.fn(async (): Promise<OgSaveOutcome> => ({ status: 'empty' })) });
    expect(await runOgFinish({ save: 'after', continuing: false, refs: refs(), deps: d })).toEqual({ status: 'left' });
    expect(d.markBeforeAfter).not.toHaveBeenCalled();
    expect(calls).toEqual(['finalize', 'leave']);
  });
});

describe('保存の失敗と書き直し（ilust-quota の流れを変えない）', () => {
  it('容量不足 → quota の失敗で retry を持ち、次は retry で書き直して印・leave へ', async () => {
    const r = refs();
    const retry = vi.fn(async (): Promise<OgSaveOutcome> => ({ status: 'saved', drawing }));
    const { d, calls } = deps({
      save: vi.fn(async (): Promise<OgSaveOutcome> => ({ status: 'failed', reason: 'quota', error: new DOMException('full', 'QuotaExceededError'), retry })),
    });
    expect(await runOgFinish({ save: 'after', continuing: false, refs: r, deps: d })).toEqual({ status: 'failed', reason: 'quota' });
    expect(r.retry.current).toBe(retry);
    expect(d.markBeforeAfter).not.toHaveBeenCalled();
    expect(await runOgFinish({ save: 'after', continuing: false, refs: r, deps: d })).toEqual({ status: 'left' });
    expect(d.save).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(r.retry.current).toBeNull();
    expect(calls).toEqual(['mark:drawing-1:after', 'finalize', 'leave']);
  });

  it('保存が投げても失敗として返す（投げない）', async () => {
    const { d } = deps({ save: vi.fn(() => Promise.reject(new Error('boom'))) });
    expect(await runOgFinish({ save: 'after', continuing: false, refs: refs(), deps: d })).toEqual({ status: 'failed', reason: 'other' });
    expect(d.leave).not.toHaveBeenCalled();
  });
});
