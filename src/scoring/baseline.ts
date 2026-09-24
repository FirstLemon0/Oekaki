/**
 * 生の誤差 → 0..100 の変換定数。
 *
 * score = 100 * exp(-k * normalizedError)
 * normalizedError = err ^ gamma（err は描画サイズで正規化済みの誤差）
 *
 * gamma を 1 にすると「平均誤差で 60 点 → 半分の誤差で 77 点」にしかならないため、
 * 「平均誤差で 60 点・半分で 85 点程度」を満たすよう gamma = log2(ln0.6/ln0.85) ≈ 1.65 とする。
 * k は「この誤差で 60 点」となる参照誤差 ref から k = ln(1/0.6) / ref^gamma で求める。
 */

export const METRIC_KEYS = [
  'line.rmse',
  'line.p90',
  'line.endpoint',
  'line.direction',
  'curve.chamfer',
  'curve.smooth',
  'circle.fit',
  'circle.closure',
  'ellipse.fit',
  'ellipse.degree',
  'ellipse.angle',
  'pressure',
  'hatch.spacing',
  'hatch.angle',
  'hatch.straight',
  'trace.chamfer',
  'trace.iou',
  'jitter',
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

export interface Baseline {
  gamma: number;
  k: Record<MetricKey, number>;
}

/** 参照誤差で取る点数 */
export const REF_SCORE = 60;
export const DEFAULT_GAMMA = Math.log2(Math.log(0.6) / Math.log(0.85));

/**
 * 既定の参照誤差（＝この誤差で 60 点。入門者の平均的な誤差を想定）。
 * 単位は各指標の正規化誤差（長さ・半径・対角線に対する比、角度は度など）。
 */
export const DEFAULT_REF: Record<MetricKey, number> = {
  /** 直線: RMSE / 全長 */
  'line.rmse': 0.015,
  /** 直線: 90 パーセンタイル誤差 / 全長 */
  'line.p90': 0.03,
  /** 直線: 始点終点の到達誤差（target 有: ズレ/目標長、無: 始終点の直線性） */
  'line.endpoint': 0.05,
  /** 直線: 進行方向の円周分散 1-R */
  'line.direction': 0.03,
  /** 曲線: Chamfer / 目標の対角線長 */
  'curve.chamfer': 0.03,
  /** 曲線: 曲率変化量の標準偏差の超過分（ラジアン） */
  'curve.smooth': 0.6,
  /** 円: 半径方向 RMSE / 半径 */
  'circle.fit': 0.05,
  /** 円: 始点と終点の距離 / 半径 */
  'circle.closure': 0.2,
  /** 楕円: 近似距離 RMSE / 平均半径 */
  'ellipse.fit': 0.05,
  /** 楕円: 度合い（短径/長径）の差 */
  'ellipse.degree': 0.08,
  /** 楕円: 軸角の差（度） */
  'ellipse.angle': 8,
  /** 筆圧: 目標プロファイルとの RMSE（筆圧 0..1） */
  pressure: 0.12,
  /** ハッチング: 線間隔の変動係数（＋目標間隔との相対差） */
  'hatch.spacing': 0.2,
  /** ハッチング: 角度の標準偏差（＋目標角との差）（度） */
  'hatch.angle': 5,
  /** ハッチング: 各線の RMSE / 線の長さ の平均 */
  'hatch.straight': 0.02,
  /** なぞり: Chamfer（両方向平均）/ お手本の対角線長 */
  'trace.chamfer': 0.02,
  /** なぞり: 1 - IoU */
  'trace.iou': 0.6,
  /** ブレ: 高周波回転角の RMS（ラジアン） */
  jitter: 0.55,
};

export function refToK(ref: number, gamma = DEFAULT_GAMMA): number {
  return Math.log(100 / REF_SCORE) / Math.pow(Math.max(ref, 1e-9), gamma);
}

export function kToRef(k: number, gamma = DEFAULT_GAMMA): number {
  return Math.pow(Math.log(100 / REF_SCORE) / k, 1 / gamma);
}

export function baselineFromRefs(refs: Record<MetricKey, number>, gamma = DEFAULT_GAMMA): Baseline {
  const k = {} as Record<MetricKey, number>;
  for (const key of METRIC_KEYS) k[key] = refToK(refs[key], gamma);
  return { gamma, k };
}

export const defaultBaseline: Baseline = baselineFromRefs(DEFAULT_REF);

/** 誤差 → 点数（0..100 の実数） */
export function toScore(err: number, key: MetricKey, baseline: Baseline = defaultBaseline): number {
  if (!Number.isFinite(err)) return 0;
  const e = Math.max(err, 0);
  return 100 * Math.exp(-baseline.k[key] * Math.pow(e, baseline.gamma));
}
