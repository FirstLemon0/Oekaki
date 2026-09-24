/**
 * 消しゴムの点列側の処理（純関数）。DOM 非依存。
 * 見た目の消しゴムはラスター（engine の destination-out）。ここは採点・保存用の点列から消えた部分を取り除くだけ。
 */
import type { Drawing, Stroke, StrokePoint, Vec2 } from '@/scoring/types';
import type { StrokeStyle } from './types';
import { distPointToSegment } from './hit';
import { isEraserStyle } from './pen';

/** 消した後に残る区間がこれより短ければ捨てる（px） */
export const MIN_PIECE_LENGTH = 0.5;

export interface EraseResult {
  strokes: Drawing;
  styles: (StrokeStyle | undefined)[];
  /** 何か消えたか（false なら strokes/styles は入力と同じ参照） */
  changed: boolean;
}

interface Capsule {
  a: Vec2;
  b: Vec2;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function capsules(path: readonly Vec2[], r: number): Capsule[] {
  const out: Capsule[] = [];
  const pts = path.filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y));
  const push = (a: Vec2, b: Vec2) =>
    out.push({
      a,
      b,
      minX: Math.min(a.x, b.x) - r,
      minY: Math.min(a.y, b.y) - r,
      maxX: Math.max(a.x, b.x) + r,
      maxY: Math.max(a.y, b.y) + r,
    });
  if (pts.length === 1) push(pts[0]!, pts[0]!);
  for (let i = 1; i < pts.length; i++) push(pts[i - 1]!, pts[i]!);
  return out;
}

const lerpPt = (a: StrokePoint, b: StrokePoint, u: number): StrokePoint => ({
  x: a.x + (b.x - a.x) * u,
  y: a.y + (b.y - a.y) * u,
  p: a.p + (b.p - a.p) * u,
  t: a.t + (b.t - a.t) * u,
});

/**
 * 線分 a→b（u∈[0,1]）のうち、カプセル c（半径 r）に入る範囲。入らなければ null。
 * 距離関数は u について凸なので、最小点を三分探索で求め、両側の境界を二分探索する。
 */
function segmentInterval(a: StrokePoint, b: StrokePoint, c: Capsule, r: number): [number, number] | null {
  const f = (u: number) => distPointToSegment({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }, c.a, c.b) - r;
  const f0 = f(0);
  const f1 = f(1);
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 40; k++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (f(m1) <= f(m2)) hi = m2;
    else lo = m1;
  }
  let um = (lo + hi) / 2;
  let fm = f(um);
  if (f0 <= fm) {
    um = 0;
    fm = f0;
  }
  if (f1 < fm) {
    um = 1;
    fm = f1;
  }
  if (fm > 0) return null;
  let s = 0;
  if (f0 > 0) {
    let l = 0;
    let h = um;
    for (let k = 0; k < 40; k++) {
      const m = (l + h) / 2;
      if (f(m) <= 0) h = m;
      else l = m;
    }
    s = h;
  }
  let e = 1;
  if (f1 > 0) {
    let l = um;
    let h = 1;
    for (let k = 0; k < 40; k++) {
      const m = (l + h) / 2;
      if (f(m) <= 0) l = m;
      else h = m;
    }
    e = l;
  }
  return [s, e];
}

function mergeIntervals(iv: [number, number][]): [number, number][] {
  if (iv.length <= 1) return iv;
  iv.sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [[iv[0]![0], iv[0]![1]]];
  for (let i = 1; i < iv.length; i++) {
    const last = out[out.length - 1]!;
    const cur = iv[i]!;
    if (cur[0] <= last[1]) last[1] = Math.max(last[1], cur[1]);
    else out.push([cur[0], cur[1]]);
  }
  return out;
}

function polyLength(s: Stroke): number {
  let L = 0;
  for (let i = 1; i < s.length; i++) L += Math.hypot(s[i]!.x - s[i - 1]!.x, s[i]!.y - s[i - 1]!.y);
  return L;
}

function inside(q: Vec2, caps: Capsule[], r: number): boolean {
  for (const c of caps) {
    if (q.x < c.minX || q.x > c.maxX || q.y < c.minY || q.y > c.maxY) continue;
    if (distPointToSegment(q, c.a, c.b) <= r) return true;
  }
  return false;
}

/**
 * 1 本のストロークから消しゴム範囲を取り除いた残りの区間列。消えなければ null。
 * 範囲の中の点は取り除き、線分の途中で範囲に出入りする所には境界点（x,y,p,t を線形補間）を足す。
 * 元の点の p と t はそのまま。点が 2 個未満・長さ MIN_PIECE_LENGTH 未満の区間は捨てる。
 */
export function eraseStroke(stroke: Stroke, path: readonly Vec2[], radius: number): Stroke[] | null {
  const r = Math.max(0, radius);
  const caps = capsules(path, r);
  if (caps.length === 0 || stroke.length === 0) return null;
  // 全体の境界ボックスで早期除外
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
  if (!caps.some((c) => !(maxX < c.minX || minX > c.maxX || maxY < c.minY || minY > c.maxY))) return null;

  if (stroke.length === 1) return inside(stroke[0]!, caps, r) ? [] : null;

  const pieces: Stroke[] = [];
  let cur: StrokePoint[] = [];
  let changed = false;
  const flush = () => {
    if (cur.length >= 2 && polyLength(cur) >= MIN_PIECE_LENGTH) pieces.push(cur);
    cur = [];
  };
  const first = stroke[0]!;
  if (inside(first, caps, r)) changed = true;
  else cur.push(first);
  for (let i = 1; i < stroke.length; i++) {
    const a = stroke[i - 1]!;
    const b = stroke[i]!;
    const sMinX = Math.min(a.x, b.x);
    const sMaxX = Math.max(a.x, b.x);
    const sMinY = Math.min(a.y, b.y);
    const sMaxY = Math.max(a.y, b.y);
    const raw: [number, number][] = [];
    for (const c of caps) {
      if (sMaxX < c.minX || sMinX > c.maxX || sMaxY < c.minY || sMinY > c.maxY) continue;
      const iv = segmentInterval(a, b, c, r);
      if (iv) raw.push(iv);
    }
    const ivs = mergeIntervals(raw);
    if (ivs.length > 0) changed = true;
    for (const [s, e] of ivs) {
      if (s > 0) cur.push(lerpPt(a, b, s));
      flush();
      if (e < 1) cur.push(lerpPt(a, b, e));
    }
    const endsInside = ivs.length > 0 && ivs[ivs.length - 1]![1] >= 1;
    if (!endsInside) cur.push(b);
  }
  flush();
  return changed ? pieces : null;
}

/**
 * 部分消し。消しゴムの軌跡 path（1 点なら円、2 点以上なら折れ線を半径 radius で太らせた範囲）に入る部分を
 * 各ストロークから取り除き、残った連続区間を新しいストロークに分ける。
 * 分けた区間は元の位置に順に並べる（strokes と styles の対応は保つ）。style は元を引き継ぐ。
 */
export function eraseSegments(
  strokes: Drawing,
  styles: readonly (StrokeStyle | undefined)[],
  path: readonly Vec2[],
  radius: number,
): EraseResult {
  const outS: Drawing = [];
  const outT: (StrokeStyle | undefined)[] = [];
  let changed = false;
  strokes.forEach((s, i) => {
    const res = eraseStroke(s, path, radius);
    if (res === null) {
      outS.push(s);
      outT.push(styles[i]);
      return;
    }
    changed = true;
    for (const piece of res) {
      outS.push(piece);
      outT.push(styles[i]);
    }
  });
  if (!changed) return { strokes, styles: styles as (StrokeStyle | undefined)[], changed: false };
  return { strokes: outS, styles: outT, changed: true };
}

/**
 * 消しゴムを含む生の履歴 → ペンのストロークだけの点列（getStrokes() / getStyles() の中身）。
 * 消しゴムストロークに出会うたびに、それまでのペンの線から軌跡（半径 = style.size）に入る部分を取り除く
 * （eraseSegments。残った連続区間は別のストロークに分ける）。消しゴムより後に描いた線は消えない。
 */
export function flattenHistory(
  strokes: Drawing,
  styles: readonly (StrokeStyle | undefined)[],
): { strokes: Drawing; styles: (StrokeStyle | undefined)[] } {
  let outS: Drawing = [];
  let outT: (StrokeStyle | undefined)[] = [];
  strokes.forEach((s, i) => {
    const st = styles[i];
    if (isEraserStyle(st)) {
      if (outS.length === 0 || s.length === 0) return;
      const r = eraseSegments(outS, outT, s, st.size);
      if (r.changed) {
        outS = r.strokes;
        outT = r.styles;
      }
      return;
    }
    outS.push(s);
    outT.push(st);
  });
  return { strokes: outS, styles: outT };
}
