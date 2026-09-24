/** 採点 A（幾何学ストローク採点）の共通型。 */

export interface StrokePoint {
  x: number;
  y: number;
  /** 筆圧 0..1 */
  p: number;
  /** 時刻 ms */
  t: number;
}

export type Stroke = StrokePoint[];
export type Drawing = Stroke[];

export interface Vec2 {
  x: number;
  y: number;
}

export interface ScoreResult {
  /** 0..100 の整数 */
  score: number;
  /** 指標ごとの点数 0..100 */
  sub: Record<string, number>;
  /** 日本語 1 文の助言 */
  hint: string;
  /** stroke ごと・点ごとのズレ 0..1（ヒートマップ用） */
  heat: number[][];
  /** 生の誤差など（デバッグ用） */
  raw: Record<string, number>;
}
