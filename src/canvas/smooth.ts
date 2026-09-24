/** ストローク平滑化・線幅の純関数。DOM 非依存。 */
import type { StrokePoint, Vec2 } from '@/scoring/types';

/** 筆圧の正規化。0（未対応端末・一部タッチ）は 0.5 とみなし、0..1 に丸める。 */
export function normalizePressure(pressure: number | undefined): number {
  if (pressure === undefined || !Number.isFinite(pressure) || pressure <= 0) return 0.5;
  return Math.min(1, pressure);
}

/** 線幅 = baseWidth × (0.5 + 1.1 × p)。p=0 で 0.5x、p=1 で 1.6x。 */
export function lineWidth(baseWidth: number, p: number): number {
  const pp = Math.min(1, Math.max(0, p));
  return baseWidth * (0.5 + 1.1 * pp);
}

/** 直前の点から minDist 未満しか動いていない点は捨てる（同一点の連打を減らす）。 */
export function shouldAppend(prev: Vec2 | undefined, next: Vec2, minDist = 0.3): boolean {
  if (!prev) return true;
  return Math.hypot(next.x - prev.x, next.y - prev.y) >= minDist;
}

/**
 * 座標の移動平均（中心窓）。端点は動かさない。p と t はそのまま。
 * window は奇数に丸める（1 以下なら入力をコピーして返す）。
 */
export function movingAverage(points: readonly StrokePoint[], window = 3): StrokePoint[] {
  const half = Math.floor(Math.max(1, window) / 2);
  if (half === 0 || points.length < 3) return points.map((p) => ({ ...p }));
  const out: StrokePoint[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const src = points[i]!;
    if (i === 0 || i === n - 1) {
      out.push({ ...src });
      continue;
    }
    const h = Math.min(half, i, n - 1 - i);
    let sx = 0;
    let sy = 0;
    for (let k = i - h; k <= i + h; k++) {
      const q = points[k]!;
      sx += q.x;
      sy += q.y;
    }
    const c = 2 * h + 1;
    out.push({ x: sx / c, y: sy / c, p: src.p, t: src.t });
  }
  return out;
}

/** 1 本の二次ベジェ区間（from → to、制御点 ctrl）。p はこの区間の線幅に使う筆圧。 */
export interface QuadSegment {
  from: Vec2;
  ctrl: Vec2;
  to: Vec2;
  p: number;
}

function mid(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * 中点法: 点 k（1..n-2）を制御点に、mid(k-1,k) → mid(k,k+1) の二次ベジェを作る。
 * k=1 の始点は点 0 そのもの。
 * 点 k の区間は点 k+1 が来た時点で確定するので、進行中ストロークの差分描画に使える。
 */
export function quadSegmentAt(points: readonly StrokePoint[], k: number): QuadSegment | null {
  if (k < 1) return null;
  const prev = points[k - 1];
  const cur = points[k];
  const next = points[k + 1];
  if (!prev || !cur || !next) return null;
  return {
    from: k === 1 ? { x: prev.x, y: prev.y } : mid(prev, cur),
    ctrl: { x: cur.x, y: cur.y },
    to: mid(cur, next),
    p: cur.p,
  };
}

/**
 * 末尾区間: 最後の中点 → 最後の点（直線を退化ベジェで表す）。ストローク確定時に描く。
 * 点が 2 つなら点 0 → 点 1 の直線。
 */
export function tailSegment(points: readonly StrokePoint[]): QuadSegment | null {
  const n = points.length;
  const last = points[n - 1];
  const before = points[n - 2];
  if (!last || !before) return null;
  const from = n === 2 ? { x: before.x, y: before.y } : mid(before, last);
  const to = { x: last.x, y: last.y };
  return { from, ctrl: mid(from, to), to, p: (before.p + last.p) / 2 };
}

/** 確定済みストローク全体の区間列（描画・書き出し用）。1 点ストロークは空配列（呼び出し側で点を打つ）。 */
export function quadSegments(points: readonly StrokePoint[]): QuadSegment[] {
  const out: QuadSegment[] = [];
  for (let k = 1; k <= points.length - 2; k++) {
    const s = quadSegmentAt(points, k);
    if (s) out.push(s);
  }
  const tail = tailSegment(points);
  if (tail) out.push(tail);
  return out;
}
