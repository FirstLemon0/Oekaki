import { describe, expect, it } from 'vitest';
import { defaultBaseline, toScore } from './baseline';
import { baselineRefs, calibrate, makeScorers } from './calibration';
import { circle, ellipse, line, noisy } from './test-helpers';

describe('baseline', () => {
  it('参照誤差で 60 点、その半分で 85 点程度', () => {
    const ref = baselineRefs(defaultBaseline)['line.rmse'];
    expect(toScore(ref, 'line.rmse')).toBeCloseTo(60, 6);
    expect(toScore(ref / 2, 'line.rmse')).toBeGreaterThan(83);
    expect(toScore(ref / 2, 'line.rmse')).toBeLessThan(87);
    expect(toScore(0, 'line.rmse')).toBe(100);
  });
});

describe('calibrate', () => {
  const lines = [1, 2, 3, 4].map((s) => noisy(line(0, 0, 300, 20 * s, 100), 8, s));
  const circles = [5, 6].map((s) => noisy(circle(0, 0, 80, 100, Math.PI * 1.8), 5, s));
  const ellipses = [7, 8].map((s) => noisy(ellipse(0, 0, 100, 50, 10), 5, s));

  it('誤差の大きいサンプルで校正すると同じ入力の点数が上がる', () => {
    const b = calibrate({ lines, circles, ellipses });
    const probe = noisy(line(0, 0, 300, 0, 100), 4, 99);
    const before = makeScorers().scoreLine(probe).score;
    const after = makeScorers(b).scoreLine(probe).score;
    expect(after).toBeGreaterThan(before);

    const c = noisy(circle(0, 0, 80), 3, 77);
    expect(makeScorers(b).scoreCircle(c).score).toBeGreaterThan(makeScorers().scoreCircle(c).score);
  });

  it('校正後は本人の平均誤差でおよそ 60 点', () => {
    const b = calibrate({ lines });
    const s = makeScorers(b);
    const avg = lines.map((l) => s.scoreLine(l).sub['line.rmse']!).reduce((a, c) => a + c, 0) / lines.length;
    expect(avg).toBeGreaterThan(50);
    expect(avg).toBeLessThan(70);
  });

  it('サンプルが無い指標も全体の倍率で調整され、空サンプルなら既定のまま', () => {
    const b = calibrate({ lines });
    expect(b.k['trace.chamfer']).toBeLessThan(defaultBaseline.k['trace.chamfer']);
    const same = calibrate({});
    expect(same.k['line.rmse']).toBeCloseTo(defaultBaseline.k['line.rmse'], 9);
  });
});
