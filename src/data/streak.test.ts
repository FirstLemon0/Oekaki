import { describe, expect, it } from 'vitest';
import { applyActivity, createInitialStreak, earnFreeze, freezeCheck } from './streak';

const T = '2026-01-01T00:00:00.000Z';

describe('streak', () => {
  it('連続した日に活動すると current が積み上がる', () => {
    let s = createInitialStreak(T);
    s = applyActivity(s, '2026-01-01');
    expect(s.current).toBe(1);
    s = applyActivity(s, '2026-01-02');
    expect(s.current).toBe(2);
    s = applyActivity(s, '2026-01-03');
    expect(s.current).toBe(3);
    expect(s.longest).toBe(3);
  });

  it('同日に何度記録しても current は変わらない', () => {
    let s = createInitialStreak(T);
    s = applyActivity(s, '2026-01-01');
    const afterFirst = s;
    s = applyActivity(s, '2026-01-01');
    expect(s).toBe(afterFirst);
    expect(s.current).toBe(1);
  });

  it('フリーズが無い状態で2日以上飛ぶとリセットされる', () => {
    let s = createInitialStreak(T);
    s = applyActivity(s, '2026-01-01');
    s = applyActivity(s, '2026-01-02');
    expect(s.freezes).toBe(0);
    // 1/3 を飛ばして 1/4 に活動 -> 2日空いた
    s = applyActivity(s, '2026-01-04');
    expect(s.current).toBe(1);
    expect(s.longest).toBe(2); // 最長記録は保持される
  });

  it('フリーズを持っていれば2日以上飛んでも継続し、フリーズを1個消費する', () => {
    let s = createInitialStreak(T);
    // 7日連続でフリーズを1個獲得させる
    const days = ['01', '02', '03', '04', '05', '06', '07'];
    for (const d of days) {
      s = applyActivity(s, `2026-01-${d}`);
    }
    expect(s.current).toBe(7);
    expect(s.freezes).toBe(1);

    // 1/8 を飛ばして 1/9 に活動 -> 2日空いたが freeze を消費して継続
    s = applyActivity(s, '2026-01-09');
    expect(s.current).toBe(8);
    expect(s.freezes).toBe(0);
  });

  it('7日ごとにフリーズを1個獲得し、最大2個まで保持する', () => {
    let s = createInitialStreak(T);
    const day = (n: number) => {
      const d = new Date(Date.UTC(2026, 0, n));
      return d.toISOString().slice(0, 10);
    };
    for (let n = 1; n <= 21; n += 1) {
      s = applyActivity(s, day(n));
    }
    // 7,14,21 日目で3回獲得の機会があるが上限2で頭打ち
    expect(s.current).toBe(21);
    expect(s.freezes).toBe(2);
  });

  it('earnFreeze は current が閾値未満なら何もしない', () => {
    const s = { ...createInitialStreak(T), current: 3 };
    const result = earnFreeze(s);
    expect(result.freezes).toBe(0);
    expect(result.nextFreezeAt).toBe(7);
  });

  it('earnFreeze は一気に複数の7日区切りを跨いでも上限2でクリップする', () => {
    const s = { ...createInitialStreak(T), current: 30 };
    const result = earnFreeze(s);
    expect(result.freezes).toBe(2);
  });

  describe('freezeCheck', () => {
    it('未活動なら危機ではない', () => {
      const s = createInitialStreak(T);
      const result = freezeCheck(s, '2026-01-01');
      expect(result.atRisk).toBe(false);
      expect(result.daysSinceActive).toBeNull();
    });

    it('今日まだ活動していなければ危機と判定する', () => {
      let s = createInitialStreak(T);
      s = applyActivity(s, '2026-01-01');
      const result = freezeCheck(s, '2026-01-02');
      expect(result.atRisk).toBe(true);
      expect(result.daysSinceActive).toBe(1);
    });

    it('今日すでに活動していれば危機ではない', () => {
      let s = createInitialStreak(T);
      s = applyActivity(s, '2026-01-01');
      const result = freezeCheck(s, '2026-01-01');
      expect(result.atRisk).toBe(false);
      expect(result.daysSinceActive).toBe(0);
    });
  });
});
