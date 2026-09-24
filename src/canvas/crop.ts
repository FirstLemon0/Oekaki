/** 書き出し範囲の計算（純関数）。toWebp の切り詰め用。 */
import type { Drawing } from '@/scoring/types';
import type { StrokeStyle } from './types';
import { penWidth, resolvePen } from './pen';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 余白の割合（内容の長辺に対して） */
export const CROP_MARGIN_RATIO = 0.08;
/** 余白の最低値（CSS px） */
export const CROP_MARGIN_MIN = 24;

/**
 * ストロークが実際に塗る範囲（線幅の半分ぶん外側まで含む）。ストロークが無ければ null。
 * 座標が非数の点は無視する。styles（getStyles() と同じ並び）を渡すとペンごとの幅で計算する（省略時は baseWidth のペン）。
 */
export function inkBounds(drawing: Drawing, baseWidth: number, styles?: readonly (StrokeStyle | undefined)[]): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  drawing.forEach((s, i) => {
    const rp = resolvePen(styles?.[i], baseWidth);
    for (const p of s) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const r = penWidth(rp, Number.isFinite(p.p) ? p.p : 0.5) / 2 + rp.grain;
      if (p.x - r < minX) minX = p.x - r;
      if (p.y - r < minY) minY = p.y - r;
      if (p.x + r > maxX) maxX = p.x + r;
      if (p.y + r > maxY) maxY = p.y + r;
    }
  });
  if (minX === Infinity) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * 切り詰め後の書き出し範囲（CSS px）。
 * 塗り範囲 + 余白（長辺 × 8%、最低 24px）を四方に足し、整数 px に広げる。
 * 縦横比は内容のまま（正方形にしない）。ストロークが無ければ null（呼び出し側で紙全体にする）。
 */
export function cropRect(drawing: Drawing, baseWidth: number, styles?: readonly (StrokeStyle | undefined)[]): Rect | null {
  const b = inkBounds(drawing, baseWidth, styles);
  if (!b) return null;
  const m = Math.max(CROP_MARGIN_MIN, Math.max(b.width, b.height) * CROP_MARGIN_RATIO);
  const x = Math.floor(b.x - m);
  const y = Math.floor(b.y - m);
  return {
    x,
    y,
    width: Math.max(1, Math.ceil(b.x + b.width + m) - x),
    height: Math.max(1, Math.ceil(b.y + b.height + m) - y),
  };
}

/**
 * 書き出し倍率。長辺が maxEdge を超えないようにする。
 * - 切り詰め時: 小さな絵は最大 maxUpscale 倍まで拡大して maxEdge に近づける（線はベクタから描き直すので劣化しない）
 * - 紙全体: 従来どおり min(DPR, maxEdge / 長辺)（1 未満の DPR は 1）
 */
export function exportScale(
  rect: { width: number; height: number },
  maxEdge: number,
  dpr: number,
  cropped: boolean,
  maxUpscale = 4,
): number {
  const fit = maxEdge / Math.max(1, rect.width, rect.height);
  return cropped ? Math.min(fit, Math.max(1, dpr, maxUpscale)) : Math.min(Math.max(1, dpr), fit);
}
