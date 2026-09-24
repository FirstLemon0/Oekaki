import { describe, expect, it } from 'vitest';
import { loadCurriculum, flattenPath } from '@/content';
import type { Lesson } from '@/content/schema';
import type { DueReview } from '@/data/review';
import { defaultBaseline, METRIC_KEYS } from '@/scoring';
import { href, parseHash } from '../router';

describe('ルート', () => {
  it('レッスン・復習・批評・自由・校正', () => {
    expect(parseHash('#/lesson/s1-u1-l1')).toEqual({ name: 'lesson', id: 's1-u1-l1' });
    expect(parseHash('#/lesson/s1-u1-l1/step/3')).toEqual({ name: 'lessonStep', id: 's1-u1-l1', step: 3 });
    expect(parseHash('#/review/ellipse')).toEqual({ name: 'review', drillType: 'ellipse' });
    expect(parseHash('#/critique/drawing-1')).toEqual({ name: 'critique', id: 'drawing-1' });
    expect(parseHash('#/free')).toEqual({ name: 'free' });
    expect(parseHash('#/calibrate')).toEqual({ name: 'calibrate' });
    expect(parseHash('#/?justDone=s1-u1-l1')).toEqual({ name: 'home' });
    expect(href.review('line')).toBe('#/review/line');
    expect(href.critique('d')).toBe('#/critique/d');
  });
});
import { circle, line as lineStroke } from '@/scoring/test-helpers';
import {
  average,
  buildPlaySteps,
  clampStep,
  counterKindOf,
  drawingKindForStep,
  drillAgain,
  drillCounterLabel,
  drillDone,
  drillNext,
  drillScored,
  nextStepIndex,
  pressureProfileOf,
  progressSegments,
  reviewDrillStep,
  startDrill,
} from './steps';
import {
  applyStrictness,
  baselineToRecord,
  critiqueGate,
  critiquesToday,
  effectiveBaseline,
  recordToBaseline,
  scorersFor,
} from './limits';
import { catmullRom, drillSetup, fitTemplate, heatBand, scoreDrill } from './drillSetup';

const lesson: Lesson = {
  id: 's1-u1-l1',
  title: 't',
  minutes: 15,
  kind: 'lesson',
  summary: 's',
  steps: [
    { type: 'read', title: 'a', body: 'b' },
    { type: 'drill', drill: 'line', count: 3, instruction: 'i', counter: 'lines' },
  ],
};

function due(drillType: string): DueReview {
  return { drillType, reasons: ['stale'], recentAverage: 50, bestScore: 80, daysSinceLast: 20 };
}

describe('ステップ進行', () => {
  it('復習が無ければレッスンのステップだけ', () => {
    const s = buildPlaySteps(lesson, []);
    expect(s.map((x) => x.step.type)).toEqual(['read', 'drill']);
    expect(s.every((x) => !x.warmup)).toBe(true);
  });

  it('復習があれば先頭に該当ドリル 10 本を差し込む', () => {
    const s = buildPlaySteps(lesson, [due('ellipse')]);
    expect(s).toHaveLength(3);
    expect(s[0]!.warmup).toBe(true);
    const st = s[0]!.step;
    expect(st.type).toBe('drill');
    if (st.type === 'drill') {
      expect(st.drill).toBe('ellipse');
      expect(st.count).toBe(10);
      expect(st.counter).toBe('ellipses');
    }
  });

  it('ドリル以外の種別や withWarmup=false では差し込まない', () => {
    expect(buildPlaySteps(lesson, [due('trace')])).toHaveLength(2);
    expect(buildPlaySteps(lesson, [due('line')], false)).toHaveLength(2);
  });

  it('次のステップ番号と範囲外の丸め', () => {
    expect(nextStepIndex(0, 3)).toBe(1);
    expect(nextStepIndex(2, 3)).toBeNull();
    expect(clampStep(9, 3)).toBe(2);
    expect(clampStep(-1, 3)).toBe(0);
    expect(clampStep(Number.NaN, 3)).toBe(0);
    expect(progressSegments(1, 3)).toEqual(['done', 'current', 'todo']);
  });

  it('対応表', () => {
    expect(counterKindOf('lines')).toBe('line');
    expect(counterKindOf('boxes')).toBe('box');
    expect(counterKindOf(undefined)).toBeNull();
    expect(drawingKindForStep('drill')).toBe('drill');
    expect(drawingKindForStep('critique')).toBe('submit');
    expect(drawingKindForStep('free')).toBe('free');
    expect(drawingKindForStep('copy')).toBe('lesson');
    expect(pressureProfileOf('increasing')).toBe('ramp-up');
    expect(pressureProfileOf('ramp-down')).toBe('ramp-down');
    expect(pressureProfileOf('flat')).toBe('flat');
    expect(reviewDrillStep('hatching').instruction).toContain('10本');
    expect(reviewDrillStep('circle').instruction).toContain('10個');
  });

  it('実教材の全ステップ型を扱える（未知の型が無い）', () => {
    const known = new Set(['read', 'drill', 'trace', 'copy', 'construct', 'gesture', 'quiz', 'mosha', 'critique', 'submit', 'free']);
    for (const n of flattenPath(loadCurriculum())) {
      for (const s of n.lesson.steps) expect(known.has(s.type)).toBe(true);
    }
  });
});

describe('ドリルの完了判定', () => {
  it('採点 → 次へ を count 回で完了', () => {
    let p = startDrill(3);
    expect(drillCounterLabel(p)).toBe('1/3');
    for (let i = 0; i < 3; i++) {
      expect(drillDone(p)).toBe(false);
      p = drillNext(drillScored(p, 60 + i));
    }
    expect(drillDone(p)).toBe(true);
    expect(p.scores).toEqual([60, 61, 62]);
    expect(drillCounterLabel(p)).toBe('3/3');
    expect(average(p.scores)).toBe(61);
  });

  it('もう一回は同じ番号のまま、点数は確定しない', () => {
    let p = drillScored(startDrill(2), 40);
    p = drillAgain(p);
    expect(p.index).toBe(0);
    expect(p.pending).toBeNull();
    expect(p.scores).toEqual([]);
    p = drillNext(p); // 未採点の「次へ」は無視
    expect(p.index).toBe(0);
  });

  it('完了後の採点は無視', () => {
    const p = drillNext(drillScored(startDrill(1), 70));
    expect(drillScored(p, 10)).toBe(p);
    expect(average([])).toBeNull();
  });
});

describe('批評の上限判定', () => {
  const today = '2026-09-24';
  const at = (d: string) => ({ createdAt: new Date(`${d}T12:00:00`).toISOString() });

  it('今日の件数を数える', () => {
    expect(critiquesToday([at('2026-09-24'), at('2026-09-23'), at('2026-09-24')], today)).toBe(2);
  });

  it('上限に達したら送れない', () => {
    expect(critiqueGate('sk-ant-x', 3, 2)).toEqual({ ok: true, remaining: 1 });
    expect(critiqueGate('sk-ant-x', 3, 3)).toEqual({ ok: false, reason: 'daily_limit' });
    expect(critiqueGate('sk-ant-x', 0, 0)).toEqual({ ok: false, reason: 'daily_limit' });
  });

  it('キー未設定は上限より先に案内する', () => {
    expect(critiqueGate(null, 3, 5)).toEqual({ ok: false, reason: 'no_api_key' });
    expect(critiqueGate('  ', 3, 0)).toEqual({ ok: false, reason: 'no_api_key' });
  });
});

describe('校正の適用', () => {
  it('Baseline を記録に入れて戻せる', () => {
    const rec = baselineToRecord(defaultBaseline);
    const back = recordToBaseline(rec);
    expect(back).not.toBeNull();
    expect(back!.gamma).toBeCloseTo(defaultBaseline.gamma);
    for (const k of METRIC_KEYS) expect(back!.k[k]).toBeCloseTo(defaultBaseline.k[k]);
  });

  it('欠けた記録は採用しない（既定に戻る）', () => {
    expect(recordToBaseline({ 'line.rmse': 1 })).toBeNull();
    expect(recordToBaseline(null)).toBeNull();
    expect(effectiveBaseline({ calibratedAt: 'x', baselines: { foo: 1 } }, 'normal')).toBe(defaultBaseline);
  });

  it('やさしめは k を 0.8 倍し、同じ線で点数が上がる', () => {
    const easy = applyStrictness(defaultBaseline, 'easy');
    expect(easy.k['line.rmse']).toBeCloseTo(defaultBaseline.k['line.rmse'] * 0.8);
    expect(applyStrictness(defaultBaseline, 'normal')).toBe(defaultBaseline);
    const wobbly = circle(200, 200, 80).map((p, i) => ({ ...p, x: p.x + (i % 7) - 3 }));
    const normal = scorersFor(null, 'normal').scoreCircle(wobbly).score;
    const soft = scorersFor(null, 'easy').scoreCircle(wobbly).score;
    expect(soft).toBeGreaterThanOrEqual(normal);
  });

  it('校正した基準で採点が変わる', () => {
    const cal = { calibratedAt: 'x', baselines: baselineToRecord(applyStrictness(defaultBaseline, 'easy')) };
    const s = lineStroke(0, 0, 300, 10);
    expect(scorersFor(cal, 'normal').scoreLine(s).score).toBe(scorersFor(null, 'easy').scoreLine(s).score);
  });
});

describe('ドリルの目標', () => {
  const size = { width: 1200, height: 800 };

  it('2 点を結ぶ直線は目標点を返し、採点に使う', () => {
    const st = drillSetup('line', { mode: 'two-points', orientation: 'h' }, size, 0);
    expect(st.line).toBeDefined();
    expect(st.guide.points).toHaveLength(2);
    const { from, to } = st.line!;
    const r = scoreDrill(scorersFor(null, 'normal'), 'line', st, [lineStroke(from.x, from.y, to.x, to.y)]);
    expect(r!.score).toBeGreaterThan(80);
  });

  it('曲線は形ごとに目標線を作る', () => {
    for (const shape of ['c', 's', 'wave', 'spiral', 'through-points']) {
      const st = drillSetup('curve', { shape, points: 4 }, size, 1);
      expect(st.curve!.length).toBeGreaterThan(10);
      const r = scoreDrill(scorersFor(null, 'normal'), 'curve', st, [st.curve!]);
      expect(r!.score).toBeGreaterThan(90);
    }
  });

  it('番号で位置が変わる・同じ番号なら同じ', () => {
    const a = drillSetup('line', { mode: 'two-points' }, size, 1).line!;
    const b = drillSetup('line', { mode: 'two-points' }, size, 2).line!;
    const a2 = drillSetup('line', { mode: 'two-points' }, size, 1).line!;
    expect(a).toEqual(a2);
    expect(a).not.toEqual(b);
  });

  it('楕円とハッチングの目標', () => {
    const e = drillSetup('ellipse', { degree: 0.6, axisAngleDeg: 30 }, size, 0);
    expect(e.ellipse).toEqual({ degree: 0.6, axisAngleDeg: 30 });
    const h = drillSetup('hatching', { spacing: 16, angleDeg: -45 }, size, 0);
    expect(h.hatching).toEqual({ spacing: 16, angleDeg: 135 });
    expect(h.guide.area).not.toBeNull();
    const p = drillSetup('pressure', { profile: 'increasing' }, size, 0);
    expect(p.pressure).toBe('ramp-up');
  });

  it('空のストロークは採点しない', () => {
    expect(scoreDrill(scorersFor(null, 'normal'), 'circle', { guide: { points: [], path: null, area: null, sample: null } }, [])).toBeNull();
  });

  it('テンプレートを中央に収める・補間・色段階', () => {
    const t = fitTemplate([[{ x: 0, y: 0, p: 0.5, t: 0 }, { x: 1, y: 1, p: 0.5, t: 1 }]], size);
    expect(t[0]![0]!.x).toBeCloseTo((1200 - 800 * 0.82) / 2);
    expect(t[0]![1]!.y).toBeCloseTo(400 + (800 * 0.82) / 2);
    expect(catmullRom([{ x: 0, y: 0 }, { x: 10, y: 0 }], 4)).toHaveLength(5);
    expect(heatBand(0.1)).toBe('good');
    expect(heatBand(0.5)).toBe('mid');
    expect(heatBand(0.9)).toBe('bad');
  });
});
