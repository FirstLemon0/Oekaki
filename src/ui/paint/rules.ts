/**
 * キャンバス画面の小さな判定（純関数。CanvasScreen から使う）。
 */
import type { CanvasDocument } from './types';

/** 描いた内容になる op（戻るときの確認・保存の要否に使う）。レイヤー操作だけでは数えない */
const DRAW_OPS = new Set(['stroke', 'fill', 'transform', 'delete']);

/** 文書に描画 op（線・塗り・変形・削除）が 1 つでもあるか（塗りだけの絵も true） */
export function hasDrawOps(doc: Pick<CanvasDocument, 'ops'>): boolean {
  return doc.ops.some((op) => DRAW_OPS.has(op.kind));
}

/** 幅の変化がこの割合以上なら線を写し直す */
export const RESCALE_WIDTH_RATIO = 0.2;

/**
 * 紙の大きさが変わったとき、描いた線を写し直すか。
 * 縦横が入れ替わった（画面の回転）か、幅が 20% 以上変わったときだけ。
 * ソフトキーボードなどで高さだけ変わったときは写さない（loadDocument で Undo 履歴が消えるため）。
 */
export function shouldRescale(prev: { width: number; height: number }, next: { width: number; height: number }): boolean {
  if (prev.width <= 0 || prev.height <= 0 || next.width <= 0 || next.height <= 0) return false;
  if (prev.width === next.width && prev.height === next.height) return false;
  const wasPortrait = prev.height > prev.width;
  const isPortrait = next.height > next.width;
  if (wasPortrait !== isPortrait) return true;
  return Math.abs(next.width - prev.width) / prev.width >= RESCALE_WIDTH_RATIO;
}
