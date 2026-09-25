/** 選択範囲（矩形・投げ縄）の計算（純関数）。座標はキャンバス座標（CSS px）。 */
import type { Stroke, StrokePoint } from '@/scoring/types';
import type { Mat, SelectionMask, StrokeStyle } from './types';
import { apply, isFiniteMat } from './matrix';
import { MIN_PIECE_LENGTH, flattenHistory } from './erase';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** パスを描ける最小限のインターフェース（CanvasRenderingContext2D / Path2D） */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  closePath(): void;
}

/** 壊れた値を落とす。面積のない矩形・3 点未満の投げ縄は null。矩形は w,h を正にそろえる。 */
export function sanitizeMask(m: unknown): SelectionMask | null {
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  if (o.kind === 'rect') {
    let x = Number(o.x);
    let y = Number(o.y);
    let w = Number(o.w);
    let h = Number(o.h);
    if (![x, y, w, h].every(Number.isFinite)) return null;
    if (w < 0) {
      x += w;
      w = -w;
    }
    if (h < 0) {
      y += h;
      h = -h;
    }
    if (w <= 0 || h <= 0) return null;
    return { kind: 'rect', x, y, w, h };
  }
  if (o.kind === 'lasso' && Array.isArray(o.points)) {
    const points = (o.points as unknown[])
      .map((p) => (p && typeof p === 'object' ? { x: Number((p as { x: unknown }).x), y: Number((p as { y: unknown }).y) } : null))
      .filter((p): p is { x: number; y: number } => !!p && Number.isFinite(p.x) && Number.isFinite(p.y));
    if (points.length < 3) return null;
    const b = polyBox(points);
    if (b.w <= 0 || b.h <= 0) return null;
    return { kind: 'lasso', points };
  }
  return null;
}

export function copyMask(m: SelectionMask): SelectionMask {
  return m.kind === 'rect' ? { ...m } : { kind: 'lasso', points: m.points.map((p) => ({ x: p.x, y: p.y })) };
}

function polyBox(pts: readonly { x: number; y: number }[]): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return x0 === Infinity ? { x: 0, y: 0, w: 0, h: 0 } : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function maskBox(m: SelectionMask): Box {
  return m.kind === 'rect' ? { x: m.x, y: m.y, w: m.w, h: m.h } : polyBox(m.points);
}

/** 多角形の頂点（矩形は 4 隅） */
export function maskPolygon(m: SelectionMask): { x: number; y: number }[] {
  if (m.kind === 'lasso') return m.points;
  return [
    { x: m.x, y: m.y },
    { x: m.x + m.w, y: m.y },
    { x: m.x + m.w, y: m.y + m.h },
    { x: m.x, y: m.y + m.h },
  ];
}

/** 点が選択範囲の中か（投げ縄は偶奇規則）。 */
export function pointInMask(m: SelectionMask, x: number, y: number): boolean {
  if (m.kind === 'rect') return x >= m.x && x <= m.x + m.w && y >= m.y && y <= m.y + m.h;
  const pts = m.points;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** パスを sink に描く（beginPath は呼び出し側）。 */
export function traceMask(sink: PathSink, m: SelectionMask): void {
  if (m.kind === 'rect') {
    sink.rect(m.x, m.y, m.w, m.h);
    return;
  }
  const [first, ...rest] = m.points;
  if (!first) return;
  sink.moveTo(first.x, first.y);
  for (const p of rest) sink.lineTo(p.x, p.y);
  sink.closePath();
}

/** 行列を掛けた選択範囲。拡大縮小と平行移動だけなら矩形のまま、それ以外は投げ縄（4 隅）になる。 */
export function transformMask(m: SelectionMask, t: Mat): SelectionMask {
  if (!isFiniteMat(t)) return copyMask(m);
  if (m.kind === 'rect' && t[1] === 0 && t[2] === 0) {
    const a = apply(t, m.x, m.y);
    const b = apply(t, m.x + m.w, m.y + m.h);
    return { kind: 'rect', x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
  }
  return { kind: 'lasso', points: maskPolygon(m).map((p) => apply(t, p.x, p.y)) };
}

function pathLength(pts: readonly StrokePoint[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  return L;
}

const lerp = (a: StrokePoint, b: StrokePoint, u: number): StrokePoint => ({
  x: a.x + (b.x - a.x) * u,
  y: a.y + (b.y - a.y) * u,
  p: a.p + (b.p - a.p) * u,
  t: a.t + (b.t - a.t) * u,
});

/**
 * ストロークを選択範囲の内と外の区間に切り分ける（境界は 2 分探索で近似）。
 * 採点・保存用の点列（getStrokes）を delete / transform に追従させるための近似。
 */
export function splitByMask(s: Stroke, m: SelectionMask): { inside: boolean; pts: Stroke }[] {
  const out: { inside: boolean; pts: Stroke }[] = [];
  if (s.length === 0) return out;
  let cur: { inside: boolean; pts: StrokePoint[] } = { inside: pointInMask(m, s[0]!.x, s[0]!.y), pts: [s[0]!] };
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1]!;
    const b = s[i]!;
    const bin = pointInMask(m, b.x, b.y);
    if (bin === cur.inside) {
      cur.pts.push(b);
      continue;
    }
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 12; k++) {
      const mid = (lo + hi) / 2;
      const q = lerp(a, b, mid);
      if (pointInMask(m, q.x, q.y) === cur.inside) lo = mid;
      else hi = mid;
    }
    const edge = lerp(a, b, (lo + hi) / 2);
    cur.pts.push(edge);
    out.push(cur);
    cur = { inside: bin, pts: [{ ...edge }, b] };
  }
  out.push(cur);
  return out;
}

/**
 * 生の履歴（消しゴム込み）に delete / transform を掛けた後の履歴（ペンだけ・消しゴム適用済み）。
 * matrix が null なら範囲内を捨てる（delete）、行列なら範囲内の点を動かす（transform）。
 */
export function cutStrokes(
  strokes: Stroke[],
  styles: (StrokeStyle | undefined)[],
  m: SelectionMask,
  matrix: Mat | null,
): { strokes: Stroke[]; styles: (StrokeStyle | undefined)[] } {
  const flat = flattenHistory(strokes, styles);
  const outS: Stroke[] = [];
  const outT: (StrokeStyle | undefined)[] = [];
  flat.strokes.forEach((s, i) => {
    const st = flat.styles[i];
    const pieces = splitByMask(s, m);
    for (const piece of pieces) {
      // 境界で切ったときにできるごく短いかけら（境界の近似誤差）は捨てる
      if (pieces.length > 1 && pathLength(piece.pts) < MIN_PIECE_LENGTH) continue;
      if (!piece.inside) {
        if (piece.pts.length > 0) {
          outS.push(piece.pts);
          outT.push(st);
        }
        continue;
      }
      if (!matrix) continue;
      outS.push(piece.pts.map((p) => ({ ...apply(matrix, p.x, p.y), p: p.p, t: p.t })));
      outT.push(st);
    }
  });
  return { strokes: outS, styles: outT };
}
