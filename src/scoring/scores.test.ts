import { describe, expect, it } from 'vitest';
import { HINT_GOOD } from './hints';
import {
  jitterScore,
  scoreCircle,
  scoreCurve,
  scoreEllipse,
  scoreHatching,
  scoreLine,
  scorePressure,
  scoreTrace,
} from './scores';
import { circle, ellipse, line, noisy, pt, scaleStroke, translate } from './test-helpers';
import type { Drawing, Stroke } from './types';

/** 直進したあと終点付近で減速しつつ上へ曲がる線 */
function bentEndLine(): Stroke {
  const s: Stroke = [];
  let t = 0;
  for (let i = 0; i < 80; i++) {
    s.push(pt(i * 3, 0, t));
    t += 10;
  }
  for (let i = 1; i <= 20; i++) {
    const th = (i / 20) * (Math.PI / 3);
    const R = 40;
    s.push(pt(237 + R * Math.sin(th), -(R - R * Math.cos(th)), t));
    t += 30;
  }
  return s;
}

/** 描き始めに逆方向の引っかかりがある線 */
function hookedLine(): Stroke {
  const hook = [pt(12, 6, 0), pt(8, 4, 10), pt(4, 2, 20)];
  return [...hook, ...line(0, 0, 300, 0, 100).map((q) => ({ ...q, t: q.t + 30 }))];
}

function sCurve(scale = 1): Stroke {
  return Array.from({ length: 120 }, (_, i) => {
    const x = (i / 119) * 300;
    return pt(x * scale, 40 * Math.sin((x / 300) * 2 * Math.PI) * scale, i * 10);
  });
}

describe('scoreLine', () => {
  it('完璧な直線は 95 以上で褒める', () => {
    const r = scoreLine(line(20, 30, 320, 130));
    expect(r.score).toBeGreaterThanOrEqual(95);
    expect(r.hint).toBe(HINT_GOOD);
    expect(r.heat[0]).toHaveLength(80);
    expect(r.sub.jitter).toBeGreaterThanOrEqual(95);
  });

  it('target 付きでも完璧なら 95 以上', () => {
    const r = scoreLine(line(0, 0, 300, 0), { from: { x: 0, y: 0 }, to: { x: 300, y: 0 } });
    expect(r.score).toBeGreaterThanOrEqual(95);
  });

  it('ガウスノイズ付きの直線は明確に低い', () => {
    const perfect = scoreLine(line(0, 0, 300, 0, 100)).score;
    const r = scoreLine(noisy(line(0, 0, 300, 0, 100), 4, 42));
    expect(r.score).toBeLessThan(perfect - 15);
    expect(r.hint).not.toBe(HINT_GOOD);
  });

  it('終点で曲がる直線 → hint に「終点」', () => {
    const r = scoreLine(bentEndLine());
    expect(r.score).toBeLessThan(90);
    expect(r.hint).toContain('終点');
    expect(r.hint).toContain('速度');
  });

  it('始点のフック → 描き始めの助言', () => {
    const r = scoreLine(hookedLine());
    expect(r.hint).toContain('描き始め');
  });

  it('目標の始点終点に届かないと到達点が下がる', () => {
    const r = scoreLine(line(30, 0, 270, 0), { from: { x: 0, y: 0 }, to: { x: 300, y: 0 } });
    expect(r.sub['line.endpoint']).toBeLessThan(80);
  });

  it('スケール不変: 2 倍サイズでも ±2 以内', () => {
    const s = noisy(line(0, 0, 200, 50, 100), 2.5, 3);
    const a = scoreLine(s).score;
    const b = scoreLine(scaleStroke(s, 2)).score;
    expect(Math.abs(a - b)).toBeLessThanOrEqual(2);
  });

  it('点が足りないと 0 点', () => {
    expect(scoreLine([pt(0, 0, 0)]).score).toBe(0);
  });
});

describe('scoreCircle', () => {
  it('完璧な円は 95 以上', () => {
    const r = scoreCircle(circle(100, 100, 60));
    expect(r.score).toBeGreaterThanOrEqual(95);
    expect(r.hint).toBe(HINT_GOOD);
  });

  it('閉じていない円 → 始点と終点の助言', () => {
    const r = scoreCircle(circle(100, 100, 60, 100, Math.PI * 1.6));
    expect(r.sub['circle.closure']).toBeLessThan(40);
    expect(r.hint).toContain('始点と終点');
  });

  it('ゆがんだ円は低い', () => {
    const r = scoreCircle(ellipse(0, 0, 80, 50));
    expect(r.score).toBeLessThan(70);
  });

  it('スケール不変: 2 倍サイズでも ±2 以内', () => {
    const s = noisy(circle(0, 0, 50), 2, 11);
    const a = scoreCircle(s).score;
    const b = scoreCircle(scaleStroke(s, 2)).score;
    expect(Math.abs(a - b)).toBeLessThanOrEqual(2);
  });
});

describe('scoreEllipse', () => {
  it('度合い 0.5 の楕円 → 推定度合いが ±0.05 以内、軸角も一致', () => {
    const r = scoreEllipse(ellipse(0, 0, 100, 50, 20), { degree: 0.5, axisAngleDeg: 20 });
    expect(Math.abs(r.raw.degree! - 0.5)).toBeLessThanOrEqual(0.05);
    expect(r.score).toBeGreaterThanOrEqual(95);
  });

  it('軽いノイズがあっても度合い ±0.05 以内', () => {
    const r = scoreEllipse(noisy(ellipse(0, 0, 100, 50, -35), 1.5, 5));
    expect(Math.abs(r.raw.degree! - 0.5)).toBeLessThanOrEqual(0.05);
  });

  it('指定より丸い → 丸いと助言', () => {
    const r = scoreEllipse(ellipse(0, 0, 100, 75), { degree: 0.5 });
    expect(r.sub['ellipse.degree']).toBeLessThan(40);
    expect(r.hint).toContain('丸く');
  });

  it('指定より細い → 細いと助言', () => {
    const r = scoreEllipse(ellipse(0, 0, 100, 25), { degree: 0.5 });
    expect(r.hint).toContain('細く');
  });

  it('軸が傾いている → 軸の助言', () => {
    const r = scoreEllipse(ellipse(0, 0, 100, 50, 25), { degree: 0.5, axisAngleDeg: 0 });
    expect(r.hint).toContain('軸');
    expect(r.sub['ellipse.angle']).toBeLessThan(40);
  });
});

describe('scoreCurve', () => {
  it('お手本どおりなら 95 以上、ずらすと下がる', () => {
    const tgt = sCurve();
    expect(scoreCurve(tgt, tgt).score).toBeGreaterThanOrEqual(95);
    const off = translate([tgt], 0, 20)[0]!;
    expect(scoreCurve(off, tgt).score).toBeLessThan(80);
  });

  it('ガタつく曲線は滑らかさの点が下がる', () => {
    const tgt = sCurve();
    const r = scoreCurve(noisy(tgt, 2.5, 13), tgt);
    expect(r.sub['curve.smooth']).toBeLessThan(50);
    expect(r.sub['curve.chamfer']).toBeGreaterThan(80);
  });

  it('スケール不変', () => {
    const tgt = sCurve();
    const u = noisy(tgt, 2, 9);
    const a = scoreCurve(u, tgt).score;
    const b = scoreCurve(scaleStroke(u, 2), sCurve(2)).score;
    expect(Math.abs(a - b)).toBeLessThanOrEqual(2);
  });
});

describe('scoreTrace', () => {
  const template: Drawing = [circle(150, 150, 80), line(70, 150, 230, 150), line(150, 70, 150, 230)];

  it('同一テンプレートのなぞりは 95 以上', () => {
    const r = scoreTrace(template, template, 4);
    expect(r.score).toBeGreaterThanOrEqual(95);
    expect(r.raw.iou).toBeCloseTo(1, 6);
  });

  it('平行移動したなぞりは明確に低い、ずれの向きを助言', () => {
    const r = scoreTrace(translate(template, 12, 0), template, 4);
    expect(r.score).toBeLessThan(75);
    expect(r.hint).toContain('右');
  });
});

describe('scorePressure', () => {
  const withP = (s: Stroke, f: (u: number) => number) => s.map((q, i) => ({ ...q, p: f(i / (s.length - 1)) }));

  it('ramp-up の理想プロファイルは 95 以上', () => {
    const r = scorePressure(withP(line(0, 0, 300, 0), (u) => 0.1 + 0.8 * u), 'ramp-up');
    expect(r.score).toBeGreaterThanOrEqual(95);
  });

  it('ramp-up なのに一定 → 低く、強くする助言', () => {
    const r = scorePressure(withP(line(0, 0, 300, 0), () => 0.5), 'ramp-up');
    expect(r.score).toBeLessThan(40);
    expect(r.hint).toContain('筆圧');
  });

  it('flat と ramp-down', () => {
    expect(scorePressure(withP(line(0, 0, 300, 0), () => 0.4), 'flat').score).toBeGreaterThanOrEqual(95);
    expect(scorePressure(withP(line(0, 0, 300, 0), (u) => 0.9 - 0.7 * u), 'ramp-down').score).toBeGreaterThanOrEqual(95);
  });
});

describe('scoreHatching', () => {
  const hatch = (offsets: number[], angleDeg = 45) => {
    const a = (angleDeg * Math.PI) / 180;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    return offsets.map((o) => {
      const ox = -dy * o;
      const oy = dx * o;
      return line(ox, oy, ox + dx * 120, oy + dy * 120, 40);
    });
  };

  it('等間隔・同角度は高い', () => {
    const r = scoreHatching(hatch([0, 15, 30, 45, 60, 75, 90]), { spacing: 15, angleDeg: 45 });
    expect(r.score).toBeGreaterThanOrEqual(95);
    expect(r.heat).toHaveLength(7);
  });

  it('間隔がばらつくと低い', () => {
    const r = scoreHatching(hatch([0, 8, 30, 36, 62, 70, 95]));
    expect(r.score).toBeLessThan(75);
    expect(r.sub['hatch.spacing']).toBeLessThan(40);
    expect(r.hint).toContain('間隔');
  });

  it('角度がばらつくと角度の点が下がる', () => {
    const d = hatch([0, 15, 30, 45, 60]).map((s, i) => {
      const rot = ((i % 2 ? 8 : -8) * Math.PI) / 180;
      const c = Math.cos(rot);
      const sn = Math.sin(rot);
      const s0 = s[0]!;
      return s.map((q) => ({ ...q, x: s0.x + (q.x - s0.x) * c - (q.y - s0.y) * sn, y: s0.y + (q.x - s0.x) * sn + (q.y - s0.y) * c }));
    });
    expect(scoreHatching(d).sub['hatch.angle']).toBeLessThan(40);
  });
});

describe('jitterScore', () => {
  it('滑らかな線は高く、震える線は低い（中盤のブレ助言）', () => {
    expect(jitterScore(line(0, 0, 300, 0, 100)).score).toBeGreaterThanOrEqual(95);
    const r = jitterScore(noisy(line(0, 0, 300, 0, 100), 3, 21));
    expect(r.score).toBeLessThan(60);
    expect(r.hint).toContain('震えて');
  });
});
