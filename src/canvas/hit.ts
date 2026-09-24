/** 消しゴムの当たり判定（純関数）。 */
import type { Drawing, Stroke, Vec2 } from '@/scoring/types';
import { lineWidth } from './smooth';

/** 点 p と線分 ab の距離。 */
export function distPointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let u = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  u = Math.max(0, Math.min(1, u));
  return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy));
}

/** 消しゴムの余白（線幅に足す px）。 */
export const ERASER_MARGIN = 8;

/**
 * ストロークが点 pt に当たるか。いずれかの線分との距離が「その線分の線幅 + margin」以下ならヒット。
 * 1 点ストロークは点との距離で判定する。
 */
export function strokeHit(stroke: Stroke, pt: Vec2, baseWidth: number, margin = ERASER_MARGIN): boolean {
  const first = stroke[0];
  if (!first) return false;
  if (stroke.length === 1) {
    return Math.hypot(pt.x - first.x, pt.y - first.y) <= lineWidth(baseWidth, first.p) + margin;
  }
  // 境界ボックスで早期除外
  const maxW = lineWidth(baseWidth, 1) + margin;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const q of stroke) {
    if (q.x < minX) minX = q.x;
    if (q.y < minY) minY = q.y;
    if (q.x > maxX) maxX = q.x;
    if (q.y > maxY) maxY = q.y;
  }
  if (pt.x < minX - maxW || pt.x > maxX + maxW || pt.y < minY - maxW || pt.y > maxY + maxW) return false;
  for (let i = 1; i < stroke.length; i++) {
    const a = stroke[i - 1]!;
    const b = stroke[i]!;
    const w = lineWidth(baseWidth, (a.p + b.p) / 2);
    if (distPointToSegment(pt, a, b) <= w + margin) return true;
  }
  return false;
}

/** 点に当たるストロークのインデックス（昇順）。 */
export function findHitStrokes(drawing: Drawing, pt: Vec2, baseWidth: number, margin = ERASER_MARGIN): number[] {
  const out: number[] = [];
  drawing.forEach((s, i) => {
    if (strokeHit(s, pt, baseWidth, margin)) out.push(i);
  });
  return out;
}
