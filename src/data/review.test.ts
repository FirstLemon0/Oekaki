import { describe, expect, it } from 'vitest';
import { dueReviews, isReviewSnoozed } from './review';
import type { DrillStats } from './types';

function stat(overrides: Partial<DrillStats>): DrillStats {
  return {
    drillType: 'line',
    history: [],
    bestScore: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('dueReviews', () => {
  it('履歴が無いドリルは対象外', () => {
    const result = dueReviews([stat({ history: [] })], '2026-02-01');
    expect(result).toEqual([]);
  });

  it('直近3回の平均が自己ベストの80%未満なら scoreDrop で対象になる', () => {
    const s = stat({
      bestScore: 100,
      history: [
        { at: '2026-01-01T00:00:00.000Z', score: 100 },
        { at: '2026-01-20T00:00:00.000Z', score: 60 },
        { at: '2026-01-21T00:00:00.000Z', score: 65 },
        { at: '2026-01-22T00:00:00.000Z', score: 70 }, // 直近3回平均 = 65 < 80
      ],
    });
    const result = dueReviews([s], '2026-01-23');
    expect(result).toHaveLength(1);
    expect(result[0]?.reasons).toContain('scoreDrop');
    expect(result[0]?.reasons).not.toContain('stale');
  });

  it('平均が80%以上かつ14日未満なら対象にならない', () => {
    const s = stat({
      bestScore: 100,
      history: [
        { at: '2026-01-20T00:00:00.000Z', score: 90 },
        { at: '2026-01-21T00:00:00.000Z', score: 85 },
        { at: '2026-01-22T00:00:00.000Z', score: 88 },
      ],
    });
    const result = dueReviews([s], '2026-01-23');
    expect(result).toEqual([]);
  });

  it('最終実施から14日以上経つと stale で対象になる', () => {
    const s = stat({
      bestScore: 100,
      history: [{ at: '2026-01-01T00:00:00.000Z', score: 100 }],
    });
    const result = dueReviews([s], '2026-01-15'); // ちょうど14日後
    expect(result).toHaveLength(1);
    expect(result[0]?.reasons).toEqual(['stale']);
  });

  it('13日しか経っていなければ stale にはならない', () => {
    const s = stat({
      bestScore: 100,
      history: [{ at: '2026-01-01T00:00:00.000Z', score: 100 }],
    });
    const result = dueReviews([s], '2026-01-14');
    expect(result).toEqual([]);
  });

  it('両方の条件を満たせば両方の理由が入る', () => {
    const s = stat({
      bestScore: 100,
      history: [
        { at: '2025-12-30T03:00:00.000Z', score: 50 },
        { at: '2025-12-31T03:00:00.000Z', score: 50 },
        { at: '2026-01-01T03:00:00.000Z', score: 50 },
      ],
    });
    const result = dueReviews([s], '2026-01-20');
    expect(result[0]?.reasons.sort()).toEqual(['scoreDrop', 'stale']);
  });

  it('履歴が 3 件未満なら scoreDrop は判定しない', () => {
    const s = stat({
      bestScore: 100,
      history: [
        { at: '2026-01-10T03:00:00.000Z', score: 100 },
        { at: '2026-01-11T03:00:00.000Z', score: 20 },
      ],
    });
    expect(dueReviews([s], '2026-01-12')).toEqual([]);
    // 3 件目がそろえば判定する（(100+20+30)/3 = 50 < 80）
    const s3 = stat({ ...s, history: [...s.history, { at: '2026-01-12T03:00:00.000Z', score: 30 }] });
    expect(dueReviews([s3], '2026-01-12')[0]?.reasons).toEqual(['scoreDrop']);
  });

  it('最終実施日は UTC ではなく端末ローカルの暦日で数える', () => {
    // 端末ローカルで 1/2 00:30 に記録（UTC より東のタイムゾーンでは ISO の先頭が 1/1 になる）
    const at = new Date(2026, 0, 2, 0, 30).toISOString();
    const s = stat({ bestScore: 50, history: [{ at, score: 50 }] });
    // ローカル 1/2 → 1/16 はちょうど 14 日
    const r = dueReviews([s], '2026-01-16');
    expect(r[0]?.daysSinceLast).toBe(14);
    // 1/15 なら 13 日で、まだ stale ではない
    expect(dueReviews([s], '2026-01-15')).toEqual([]);
  });
});

describe('復習のスキップ（期限を 1 日だけ延ばす）', () => {
  const stale = stat({ bestScore: 80, history: [{ at: '2026-01-01T12:00:00.000Z', score: 80 }] });

  it('スキップした日と翌日は出ない。2 日後からまた出る', () => {
    const skipped = { line: '2026-02-01' };
    expect(dueReviews([stale], '2026-02-01', skipped)).toEqual([]);
    expect(dueReviews([stale], '2026-02-02', skipped)).toEqual([]);
    expect(dueReviews([stale], '2026-02-03', skipped)).toHaveLength(1);
  });

  it('ほかの種別のスキップは関係しない', () => {
    expect(dueReviews([stale], '2026-02-01', { circle: '2026-02-01' })).toHaveLength(1);
  });

  it('isReviewSnoozed: 無し・未来日・2 日以上前は延ばさない', () => {
    expect(isReviewSnoozed(null, '2026-02-01')).toBe(false);
    expect(isReviewSnoozed('2026-02-05', '2026-02-01')).toBe(false);
    expect(isReviewSnoozed('2026-01-30', '2026-02-01')).toBe(false);
    expect(isReviewSnoozed('2026-01-31', '2026-02-01')).toBe(true);
  });
});
