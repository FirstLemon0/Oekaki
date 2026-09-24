import { describe, expect, it } from 'vitest';
import { dueReviews } from './review';
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
      history: [{ at: '2026-01-01T00:00:00.000Z', score: 50 }],
    });
    const result = dueReviews([s], '2026-01-20');
    expect(result[0]?.reasons.sort()).toEqual(['scoreDrop', 'stale']);
  });
});
