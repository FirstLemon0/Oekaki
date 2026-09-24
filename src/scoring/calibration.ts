/**
 * 校正モード: 本人の直線・円・楕円のサンプルから、「今の平均誤差で 60 点、その半分で 85 点程度」
 * になるように k を決め直す。
 */
import {
  baselineFromRefs,
  DEFAULT_GAMMA,
  DEFAULT_REF,
  defaultBaseline,
  kToRef,
  METRIC_KEYS,
  type Baseline,
  type MetricKey,
} from './baseline';
import {
  scoreCircle,
  scoreCurve,
  scoreEllipse,
  scoreHatching,
  scoreLine,
  scorePressure,
  scoreTrace,
  jitterScore,
  type EllipseTarget,
  type HatchingTarget,
  type LineTarget,
  type PressureProfile,
} from './scores';
import type { Drawing, ScoreResult, Stroke } from './types';

export { defaultBaseline };
export type { Baseline };

export interface CalibrationSamples {
  lines?: Stroke[];
  circles?: Stroke[];
  ellipses?: Stroke[];
}

/** 参照誤差を既定値の何倍まで動かしてよいか（極端なサンプルで採点が壊れないように） */
const MIN_RATIO = 0.25;
const MAX_RATIO = 4;

/** 各サンプルから直接校正できる指標 */
const DIRECT: Partial<Record<MetricKey, 'lines' | 'circles' | 'ellipses'>> = {
  'line.rmse': 'lines',
  'line.p90': 'lines',
  'line.endpoint': 'lines',
  'line.direction': 'lines',
  'circle.fit': 'circles',
  'circle.closure': 'circles',
  'ellipse.fit': 'ellipses',
};

function clampRatio(r: number): number {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, r));
}

/**
 * 校正サンプルから個人ベースラインを作る。
 * - 直線・円・楕円の各誤差の平均を「60 点の参照誤差」にする（既定値の 0.25〜4 倍に制限）。
 * - サンプルの無い指標（曲線・なぞり・ハッチング等）は、校正できた指標の倍率の幾何平均で一律に調整する。
 * - ブレは全サンプルの平均で校正する。
 */
export function calibrate(samples: CalibrationSamples, base: Baseline = defaultBaseline): Baseline {
  const results: Record<'lines' | 'circles' | 'ellipses', ScoreResult[]> = {
    lines: (samples.lines ?? []).map((s) => scoreLine(s, undefined, base)),
    circles: (samples.circles ?? []).map((s) => scoreCircle(s, base)),
    ellipses: (samples.ellipses ?? []).map((s) => scoreEllipse(s, {}, base)),
  };
  const baseRef = {} as Record<MetricKey, number>;
  for (const key of METRIC_KEYS) baseRef[key] = kToRef(base.k[key], base.gamma);

  const refs: Record<MetricKey, number> = { ...baseRef };
  const logRatios: number[] = [];
  for (const [key, group] of Object.entries(DIRECT) as [MetricKey, 'lines' | 'circles' | 'ellipses'][]) {
    const errs = results[group].map((r) => r.raw[key]).filter((v): v is number => Number.isFinite(v));
    if (errs.length === 0) continue;
    const m = errs.reduce((a, b) => a + b, 0) / errs.length;
    const ratio = clampRatio(m / baseRef[key]);
    refs[key] = baseRef[key] * ratio;
    logRatios.push(Math.log(ratio));
  }
  const jit = [...results.lines, ...results.circles, ...results.ellipses]
    .map((r) => r.raw.jitter)
    .filter((v): v is number => Number.isFinite(v));
  if (jit.length > 0) {
    const m = jit.reduce((a, b) => a + b, 0) / jit.length;
    refs.jitter = baseRef.jitter * clampRatio(m / baseRef.jitter);
  }
  if (logRatios.length > 0) {
    const g = Math.exp(logRatios.reduce((a, b) => a + b, 0) / logRatios.length);
    for (const key of METRIC_KEYS) {
      if (DIRECT[key] || key === 'jitter') continue;
      refs[key] = baseRef[key] * clampRatio(g);
    }
  }
  return baselineFromRefs(refs, base.gamma);
}

/** 既定の参照誤差（表示・デバッグ用） */
export function baselineRefs(b: Baseline = defaultBaseline): Record<MetricKey, number> {
  const out = {} as Record<MetricKey, number>;
  for (const key of METRIC_KEYS) out[key] = kToRef(b.k[key], b.gamma);
  return out;
}

export { DEFAULT_REF, DEFAULT_GAMMA };

export interface Scorers {
  scoreLine(stroke: Stroke, target?: LineTarget): ScoreResult;
  scoreCurve(stroke: Stroke, target: Stroke): ScoreResult;
  scoreCircle(stroke: Stroke): ScoreResult;
  scoreEllipse(stroke: Stroke, target?: EllipseTarget): ScoreResult;
  scorePressure(stroke: Stroke, profile: PressureProfile): ScoreResult;
  scoreHatching(strokes: Drawing, target?: HatchingTarget): ScoreResult;
  scoreTrace(strokes: Drawing, template: Drawing, lineWidth: number): ScoreResult;
  jitterScore(stroke: Stroke): ScoreResult;
}

/** ベースライン適用済みのスコア関数群 */
export function makeScorers(baseline: Baseline = defaultBaseline): Scorers {
  return {
    scoreLine: (s, t) => scoreLine(s, t, baseline),
    scoreCurve: (s, t) => scoreCurve(s, t, baseline),
    scoreCircle: (s) => scoreCircle(s, baseline),
    scoreEllipse: (s, t) => scoreEllipse(s, t, baseline),
    scorePressure: (s, p) => scorePressure(s, p, baseline),
    scoreHatching: (d, t) => scoreHatching(d, t, baseline),
    scoreTrace: (d, tpl, w) => scoreTrace(d, tpl, w, baseline),
    jitterScore: (s) => jitterScore(s, baseline),
  };
}
