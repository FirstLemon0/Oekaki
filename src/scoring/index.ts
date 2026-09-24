export type { Drawing, ScoreResult, Stroke, StrokePoint, Vec2 } from './types';
export {
  scoreLine,
  scoreCurve,
  scoreCircle,
  scoreEllipse,
  scorePressure,
  scoreHatching,
  scoreTrace,
  jitterScore,
  type LineTarget,
  type EllipseTarget,
  type HatchingTarget,
  type PressureProfile,
} from './scores';
export { calibrate, makeScorers, defaultBaseline, baselineRefs, type CalibrationSamples, type Scorers } from './calibration';
export { toScore, METRIC_KEYS, DEFAULT_REF, type Baseline, type MetricKey } from './baseline';
