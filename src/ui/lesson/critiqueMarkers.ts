/**
 * 批評の番号マーカーの置き場所（純ロジック）。
 *
 * CritiqueIssue.pos は「保存した絵（toWebp で余白を切り詰めた後の画像）の左上原点 0..1」。
 * 画面では絵と同じ大きさの枠の中に % で置く。
 */
export interface MarkerPos {
  x: number;
  y: number;
}

/**
 * pos が有効（有限の数）なら絵の上のその位置（0..1 に丸める）、
 * 無ければ null（従来どおり右上に縦に並べる）。
 */
export function markerPlacement(pos: MarkerPos | undefined | null): MarkerPos | null {
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return null;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { x: clamp(pos.x), y: clamp(pos.y) };
}
