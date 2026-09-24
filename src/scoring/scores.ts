/**
 * ドリル種別ごとのスコア関数（DESIGN.md §5.1）。
 * 誤差はすべてストロークの全長・半径・対角線などで正規化するため、描画サイズに対してスケール不変。
 * 最後の引数 baseline で個人校正済みの定数を差し替えられる（makeScorers 参照）。
 */
import { defaultBaseline, kToRef, toScore, type Baseline, type MetricKey } from './baseline';
import {
  arcFractions,
  axialStats,
  axisAngleDiff,
  bbox,
  chamfer,
  clamp01,
  closureRatio,
  directionVariance,
  dist,
  distToDrawing,
  distToLine,
  distToSegment,
  ellipseDistance,
  fitCircle,
  fitEllipse,
  flatten,
  jitterMetric,
  jitterResiduals,
  lineAngleDeg,
  lineErrors,
  mean,
  pathLength,
  radialError,
  rasterIoU,
  resample,
  rms,
  smoothnessMetric,
  std,
} from './geometry';
import {
  closureIssue,
  ellipseIssues,
  HINT_TOO_SHORT,
  pickHint,
  pressureIssues,
  strokeIssues,
  traceOffsetIssues,
  type Issue,
} from './hints';
import type { Drawing, ScoreResult, Stroke, Vec2 } from './types';

export type PressureProfile = 'ramp-up' | 'ramp-down' | 'flat';

export interface LineTarget {
  from: Vec2;
  to: Vec2;
}

export interface EllipseTarget {
  degree?: number;
  axisAngleDeg?: number;
}

export interface HatchingTarget {
  spacing?: number;
  angleDeg?: number;
}

// ---------------------------------------------------------------- 共通

type Part = [key: MetricKey, err: number, weight: number];

function isUsable(s: Stroke): boolean {
  return s.length >= 2 && pathLength(s) > 0;
}

function emptyResult(strokes: Drawing): ScoreResult {
  return { score: 0, sub: {}, hint: HINT_TOO_SHORT, heat: strokes.map((s) => s.map(() => 0)), raw: {} };
}

/** 各指標を点数化し、重み付き平均で総合点を出す */
function compose(parts: Part[], baseline: Baseline): { score: number; sub: Record<string, number> } {
  const sub: Record<string, number> = {};
  let wsum = 0;
  let acc = 0;
  for (const [key, err, w] of parts) {
    const s = toScore(err, key, baseline);
    sub[key] = Math.round(s);
    acc += s * w;
    wsum += w;
  }
  return { score: Math.round(wsum > 0 ? acc / wsum : 0), sub };
}

/** 複数ストロークのブレ（長さ加重平均） */
function drawingJitter(strokes: Drawing): number {
  let acc = 0;
  let wsum = 0;
  for (const s of strokes) {
    if (s.length < 3 || !isUsable(s)) continue;
    const L = pathLength(s);
    acc += jitterMetric(s) * L;
    wsum += L;
  }
  return wsum > 0 ? acc / wsum : 0;
}

function withJitter(
  sub: Record<string, number>,
  raw: Record<string, number>,
  jitterErr: number,
  baseline: Baseline,
): number {
  const js = toScore(jitterErr, 'jitter', baseline);
  sub.jitter = Math.round(js);
  raw.jitter = jitterErr;
  return js;
}

// ---------------------------------------------------------------- 直線

export function scoreLine(stroke: Stroke, target?: LineTarget, baseline: Baseline = defaultBaseline): ScoreResult {
  if (!isUsable(stroke)) return emptyResult([stroke]);
  const le = lineErrors(stroke);
  // 正規化の長さはフィット直線方向の幅（ノイズで膨らむ弧長は使わない）
  const L = le.extent > 0 ? le.extent : pathLength(stroke);
  const start = stroke[0]!;
  const end = stroke[stroke.length - 1]!;

  let endpointErr: number;
  let heat: number[];
  if (target) {
    const T = dist(target.from, target.to) || L;
    const fwd = (dist(start, target.from) + dist(end, target.to)) / 2;
    const rev = (dist(start, target.to) + dist(end, target.from)) / 2;
    endpointErr = Math.min(fwd, rev) / T;
    heat = stroke.map((p) => clamp01(distToSegment(p, target.from, target.to) / T / 0.05));
  } else {
    // 目標が無いときは「始点・終点がフィット直線に乗っているか」で代替
    endpointErr = (distToLine(start, le.fit) + distToLine(end, le.fit)) / 2 / L;
    heat = stroke.map((p) => clamp01(distToLine(p, le.fit) / L / 0.05));
  }
  const raw: Record<string, number> = {
    'line.rmse': le.rmse / L,
    'line.p90': le.p90 / L,
    'line.endpoint': endpointErr,
    'line.direction': directionVariance(stroke),
    length: L,
    angleDeg: lineAngleDeg(le.fit),
  };
  const { score, sub } = compose(
    [
      ['line.rmse', raw['line.rmse']!, 0.55],
      ['line.p90', raw['line.p90']!, 0.25],
      ['line.endpoint', endpointErr, 0.12],
      ['line.direction', raw['line.direction']!, 0.08],
    ],
    baseline,
  );
  const js = withJitter(sub, raw, jitterMetric(stroke), baseline);
  const hint = pickHint(strokeIssues(stroke, heat, js), sub);
  return { score, sub, hint, heat: [heat], raw };
}

// ---------------------------------------------------------------- 曲線

export function scoreCurve(stroke: Stroke, target: Stroke, baseline: Baseline = defaultBaseline): ScoreResult {
  if (!isUsable(stroke) || !isUsable(target)) return emptyResult([stroke]);
  const diag = bbox(target).diag || pathLength(target);
  const ch = chamfer([stroke], [target]);
  const smoothUser = smoothnessMetric(stroke);
  const smoothTarget = smoothnessMetric(target);
  const raw: Record<string, number> = {
    'curve.chamfer': ch.mean / diag,
    'curve.smooth': Math.max(0, smoothUser - smoothTarget),
    chamferUserToTarget: ch.ab / diag,
    chamferTargetToUser: ch.ba / diag,
    smoothUser,
    smoothTarget,
  };
  const { score, sub } = compose(
    [
      ['curve.chamfer', raw['curve.chamfer']!, 0.75],
      ['curve.smooth', raw['curve.smooth']!, 0.25],
    ],
    baseline,
  );
  const heat = stroke.map((p) => clamp01(distToDrawing(p, [target]) / diag / 0.06));
  const js = withJitter(sub, raw, jitterMetric(stroke), baseline);
  const hint = pickHint(strokeIssues(stroke, heat, js), sub);
  return { score, sub, hint, heat: [heat], raw };
}

// ---------------------------------------------------------------- 円

export function scoreCircle(stroke: Stroke, baseline: Baseline = defaultBaseline): ScoreResult {
  if (!isUsable(stroke) || stroke.length < 3) return emptyResult([stroke]);
  const rs = resample(stroke, 64);
  const c = fitCircle(rs);
  if (!(c.r > 0)) return emptyResult([stroke]);
  const fitErr = rms(rs.map((p) => radialError(p, c))) / c.r;
  const closure = closureRatio(stroke, c.r);
  const raw: Record<string, number> = {
    'circle.fit': fitErr,
    'circle.closure': closure,
    cx: c.cx,
    cy: c.cy,
    r: c.r,
  };
  const { score, sub } = compose(
    [
      ['circle.fit', fitErr, 0.7],
      ['circle.closure', closure, 0.3],
    ],
    baseline,
  );
  const heat = stroke.map((p) => clamp01(Math.abs(radialError(p, c)) / c.r / 0.1));
  const js = withJitter(sub, raw, jitterMetric(stroke), baseline);
  const hint = pickHint([...strokeIssues(stroke, heat, js), ...closureIssue(sub['circle.closure']!)], sub);
  return { score, sub, hint, heat: [heat], raw };
}

// ---------------------------------------------------------------- 楕円

export function scoreEllipse(
  stroke: Stroke,
  target: EllipseTarget = {},
  baseline: Baseline = defaultBaseline,
): ScoreResult {
  if (!isUsable(stroke) || stroke.length < 5) return emptyResult([stroke]);
  const rs = resample(stroke, 64);
  const e = fitEllipse(rs);
  const meanR = (e.a + e.b) / 2;
  if (!(meanR > 0)) return emptyResult([stroke]);
  const fitErr = rms(rs.map((p) => ellipseDistance(p, e))) / meanR;
  const parts: Part[] = [['ellipse.fit', fitErr, 0.6]];
  const raw: Record<string, number> = {
    'ellipse.fit': fitErr,
    degree: e.degree,
    axisAngleDeg: e.axisAngleDeg,
    a: e.a,
    b: e.b,
    cx: e.cx,
    cy: e.cy,
    closure: closureRatio(stroke, meanR),
  };
  if (target.degree !== undefined) {
    const d = Math.abs(e.degree - target.degree);
    raw['ellipse.degree'] = d;
    parts.push(['ellipse.degree', d, 0.25]);
  }
  let angleDiff = 0;
  if (target.axisAngleDeg !== undefined) {
    angleDiff = axisAngleDiff(e.axisAngleDeg, target.axisAngleDeg);
    // 円に近いほど軸角は定まらないので、度合いが 1 に近いときは軽く扱う
    const refDeg = Math.min(e.degree, target.degree ?? e.degree);
    const w = clamp01((1 - refDeg) / 0.3);
    raw['ellipse.angle'] = angleDiff * w;
    parts.push(['ellipse.angle', angleDiff * w, 0.15]);
  }
  const { score, sub } = compose(parts, baseline);
  const heat = stroke.map((p) => clamp01(ellipseDistance(p, e) / meanR / 0.1));
  const js = withJitter(sub, raw, jitterMetric(stroke), baseline);
  const closureSub = toScore(raw.closure!, 'circle.closure', baseline);
  const issues: Issue[] = [
    ...strokeIssues(stroke, heat, js),
    ...closureIssue(closureSub),
    ...ellipseIssues(e, target, angleDiff),
  ];
  return { score, sub, hint: pickHint(issues, sub), heat: [heat], raw };
}

// ---------------------------------------------------------------- 筆圧

export function scorePressure(
  stroke: Stroke,
  profile: PressureProfile,
  baseline: Baseline = defaultBaseline,
): ScoreResult {
  if (stroke.length < 2) return emptyResult([stroke]);
  const u = arcFractions(stroke);
  const p = stroke.map((q) => q.p);
  // 最小二乗で p ≈ a + b·u
  const mu = mean(u);
  const mp = mean(p);
  let suu = 0;
  let sup = 0;
  u.forEach((ui, i) => {
    suu += (ui - mu) ** 2;
    sup += (ui - mu) * (p[i]! - mp);
  });
  const slope = suu > 0 ? sup / suu : 0;
  const icpt = mp - slope * mu;
  /** ramp で必要な最低限の変化量（全長で筆圧 0.3 以上の変化） */
  const MIN_SLOPE = 0.3;
  let model: (x: number) => number;
  let err: number;
  let slopePenalty = 0;
  if (profile === 'flat') {
    model = () => mp;
    err = std(p);
  } else {
    model = (x) => icpt + slope * x;
    const dirSlope = profile === 'ramp-up' ? slope : -slope;
    slopePenalty = Math.max(0, MIN_SLOPE - dirSlope);
    err = rms(p.map((v, i) => v - model(u[i]!))) + slopePenalty;
  }
  const raw: Record<string, number> = { pressure: err, slope, slopePenalty, meanPressure: mp };
  const { score, sub } = compose([['pressure', err, 1]], baseline);
  const heat = p.map((v, i) => clamp01((Math.abs(v - model(u[i]!)) + slopePenalty) / 0.3));
  const js = isUsable(stroke) ? withJitter(sub, raw, jitterMetric(stroke), baseline) : 100;
  const issues = [...pressureIssues(profile, slopePenalty, sub.pressure!), ...(isUsable(stroke) ? strokeIssues(stroke, heat, js) : [])];
  return { score, sub, hint: pickHint(issues, sub), heat: [heat], raw };
}

// ---------------------------------------------------------------- ハッチング

export function scoreHatching(
  strokes: Drawing,
  target: HatchingTarget = {},
  baseline: Baseline = defaultBaseline,
): ScoreResult {
  const usable = strokes.filter(isUsable);
  if (usable.length === 0) return emptyResult(strokes);
  const infos = usable.map((s) => {
    const le = lineErrors(s);
    const L = le.extent > 0 ? le.extent : pathLength(s);
    const cx = mean(s.map((q) => q.x));
    const cy = mean(s.map((q) => q.y));
    return { s, le, L, cx, cy, angle: lineAngleDeg(le.fit), straight: le.rmse / L };
  });
  const ang = axialStats(infos.map((i) => i.angle));
  let angleErr = ang.std;
  if (target.angleDeg !== undefined) angleErr += axisAngleDiff(ang.mean, target.angleDeg);

  // 線間隔: 各線の重心を平均方向の法線へ射影して並べる
  const rad = (ang.mean * Math.PI) / 180;
  const nx = -Math.sin(rad);
  const ny = Math.cos(rad);
  const proj = infos.map((i) => i.cx * nx + i.cy * ny).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < proj.length; i++) gaps.push(proj[i]! - proj[i - 1]!);
  const meanGap = mean(gaps);
  let spacingErr = 0;
  if (gaps.length >= 2) spacingErr = meanGap > 0 ? std(gaps) / meanGap : 1;
  if (target.spacing !== undefined && target.spacing > 0 && gaps.length >= 1) {
    spacingErr += Math.abs(meanGap - target.spacing) / target.spacing;
  }
  const straightErr = mean(infos.map((i) => i.straight));
  const raw: Record<string, number> = {
    'hatch.spacing': spacingErr,
    'hatch.angle': angleErr,
    'hatch.straight': straightErr,
    meanAngleDeg: ang.mean,
    angleStdDeg: ang.std,
    meanGap,
    lines: usable.length,
  };
  const { score, sub } = compose(
    [
      ['hatch.spacing', spacingErr, 0.4],
      ['hatch.angle', angleErr, 0.3],
      ['hatch.straight', straightErr, 0.3],
    ],
    baseline,
  );
  withJitter(sub, raw, drawingJitter(usable), baseline);
  const heat = strokes.map((s) => {
    const info = infos.find((i) => i.s === s);
    if (!info) return s.map(() => 0);
    return s.map((p) => clamp01(distToLine(p, info.le.fit) / info.L / 0.05));
  });
  return { score, sub, hint: pickHint([], sub), heat, raw };
}

// ---------------------------------------------------------------- なぞり

export function scoreTrace(
  strokes: Drawing,
  template: Drawing,
  lineWidth: number,
  baseline: Baseline = defaultBaseline,
): ScoreResult {
  const usable = strokes.filter(isUsable);
  const tpl = template.filter((s) => s.length > 0);
  if (usable.length === 0 || tpl.length === 0) return emptyResult(strokes);
  const tplPts = flatten(tpl);
  const diag = bbox(tplPts).diag || 1;
  const ch = chamfer(usable, tpl);
  const width = lineWidth * 1.5;
  const iou = rasterIoU(usable, tpl, width);
  const raw: Record<string, number> = {
    'trace.chamfer': ch.mean / diag,
    'trace.iou': 1 - iou,
    iou,
    chamferUserToTemplate: ch.ab / diag,
    chamferTemplateToUser: ch.ba / diag,
  };
  const { score, sub } = compose(
    [
      ['trace.chamfer', raw['trace.chamfer']!, 0.6],
      ['trace.iou', raw['trace.iou']!, 0.4],
    ],
    baseline,
  );
  const js = withJitter(sub, raw, drawingJitter(usable), baseline);
  const heat = strokes.map((s) => s.map((p) => clamp01(distToDrawing(p, tpl) / diag / 0.05)));

  // 全体の平行移動（重心のずれ）
  const userPts = flatten(usable);
  const off = {
    x: mean(userPts.map((p) => p.x)) - mean(tplPts.map((p) => p.x)),
    y: mean(userPts.map((p) => p.y)) - mean(tplPts.map((p) => p.y)),
  };
  raw.offsetX = off.x / diag;
  raw.offsetY = off.y / diag;
  const issues: Issue[] = [...traceOffsetIssues(off, diag, sub['trace.chamfer']!)];
  const longest = usable.reduce((a, b) => (pathLength(b) > pathLength(a) ? b : a));
  const idx = strokes.indexOf(longest);
  if (idx >= 0) issues.push(...strokeIssues(longest, heat[idx]!, js));
  return { score, sub, hint: pickHint(issues, sub), heat, raw };
}

// ---------------------------------------------------------------- ブレ

/** ブレ単体の採点（全ドリルの sub.jitter と同じ指標） */
export function jitterScore(stroke: Stroke, baseline: Baseline = defaultBaseline): ScoreResult {
  if (!isUsable(stroke) || stroke.length < 3) return emptyResult([stroke]);
  const err = jitterMetric(stroke);
  const raw: Record<string, number> = { jitter: err };
  const { score, sub } = compose([['jitter', err, 1]], baseline);
  // 再サンプル点の残差を元の点へ弧長比で対応づける
  const res = jitterResiduals(stroke);
  const u = arcFractions(stroke);
  const ref = kToRef(baseline.k.jitter, baseline.gamma);
  const heat = u.map((ui) => {
    const i = Math.min(res.length - 1, Math.max(0, Math.round(ui * (res.length + 1)) - 1));
    return clamp01(Math.abs(res[i] ?? 0) / (2 * ref));
  });
  const hint = pickHint(strokeIssues(stroke, heat, sub.jitter!), sub);
  return { score, sub, hint, heat: [heat], raw };
}
