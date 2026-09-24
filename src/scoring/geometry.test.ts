import { describe, expect, it } from 'vitest';
import {
  axialStats,
  chamfer,
  closureRatio,
  directionVariance,
  fitCircle,
  fitEllipse,
  fitLine,
  jitterMetric,
  lineErrors,
  pathLength,
  rasterIoU,
  resample,
} from './geometry';
import { circle, ellipse, line, noisy, translate } from './test-helpers';

describe('geometry', () => {
  it('再サンプリングは等間隔で全長を保つ', () => {
    const s = line(0, 0, 100, 0, 7);
    const r = resample(s, 11);
    expect(r).toHaveLength(11);
    expect(r[5]!.x).toBeCloseTo(50, 6);
    expect(pathLength(r)).toBeCloseTo(100, 6);
  });

  it('直線フィット: 完璧な直線は誤差 0、向きは始点→終点', () => {
    const e = lineErrors(line(10, 10, 110, 60));
    expect(e.rmse).toBeLessThan(1e-9);
    const f = fitLine(line(100, 0, 0, 0));
    expect(f.dx).toBeCloseTo(-1, 6);
  });

  it('円フィット（Kasa）', () => {
    const c = fitCircle(circle(50, -20, 30));
    expect(c.cx).toBeCloseTo(50, 4);
    expect(c.cy).toBeCloseTo(-20, 4);
    expect(c.r).toBeCloseTo(30, 4);
    expect(closureRatio(circle(0, 0, 30), 30)).toBeLessThan(1e-6);
    expect(closureRatio(circle(0, 0, 30, 100, Math.PI * 1.5), 30)).toBeGreaterThan(1);
  });

  it('楕円フィット: 度合い・軸角を復元', () => {
    const e = fitEllipse(resample(ellipse(0, 0, 80, 40, 30), 64));
    expect(e.degree).toBeCloseTo(0.5, 3);
    expect(e.axisAngleDeg).toBeCloseTo(30, 2);
    expect(e.a).toBeCloseTo(80, 1);
  });

  it('Chamfer と IoU: 同一なら 0 / 1、ずらすと悪化', () => {
    const d = [line(0, 0, 100, 0), line(0, 20, 100, 20)];
    expect(chamfer(d, d).mean).toBeLessThan(1e-9);
    expect(rasterIoU(d, d, 4)).toBeCloseTo(1, 6);
    const moved = translate(d, 0, 5);
    expect(chamfer(d, moved).mean).toBeGreaterThan(3);
    expect(rasterIoU(d, moved, 4)).toBeLessThan(0.3);
  });

  it('ブレ・方向一貫性: ノイズで増える', () => {
    const s = line(0, 0, 300, 0, 100);
    expect(jitterMetric(s)).toBeLessThan(1e-9);
    expect(directionVariance(s)).toBeLessThan(1e-9);
    const n = noisy(s, 3, 7);
    expect(jitterMetric(n)).toBeGreaterThan(0.05);
    expect(directionVariance(n)).toBeGreaterThan(0.001);
  });

  it('軸の統計は 180 度周期', () => {
    const st = axialStats([178, 2]);
    expect(Math.min(st.mean, 180 - st.mean)).toBeLessThan(1e-6);
    expect(st.std).toBeLessThan(3);
  });
});
