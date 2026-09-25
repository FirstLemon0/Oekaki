/**
 * ストローク 1 本を Canvas 2D に描く部品（engine / raster から使う）。ctx の変換は各関数が設定する。
 */
import type { StrokePoint } from '@/scoring/types';
import {
  cumulativeLength,
  jitterPoints,
  maxPenWidth,
  needsLayer,
  penAlpha,
  penWidth,
  taperFactor,
  taperLength,
  type ResolvedPen,
} from './pen';
import { quadSegmentAt, tailSegment } from './smooth';

export type Ctx = CanvasRenderingContext2D;

/** 描画用に解決済みの見た目。 */
export interface Paint {
  color: string;
  pen: ResolvedPen;
}

/** CSS px → デバイス px の変換（dev = css × k + o）。 */
export interface Xf {
  k: number;
  ox: number;
  oy: number;
}

export interface Layer {
  canvas: HTMLCanvasElement;
  ctx: Ctx;
}

/**
 * 透明な作業用 canvas。cpu: true は getImageData を多用する用途（塗りつぶしの領域計算）で、
 * `willReadFrequently` を付けて CPU 側に置く（GPU からの読み戻しを避ける）。
 */
export function makeLayer(w: number, h: number, opts?: { cpu?: boolean }): Layer | null {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = (opts?.cpu ? cv.getContext('2d', { willReadFrequently: true }) : cv.getContext('2d')) as Ctx | null;
  return c ? { canvas: cv, ctx: c } : null;
}

/** canvas のメモリを明示的に手放す（大きさ 0 にする）。以後その Layer は使わない。 */
export function freeLayer(l: Layer | null | undefined): void {
  if (!l) return;
  l.canvas.width = 0;
  l.canvas.height = 0;
}

/** 大きさを変える。keep: 今の中身を左上そろえで残す（紙が広がったとき）。 */
export function resizeLayer(l: Layer, w: number, h: number, keep: boolean): void {
  if (l.canvas.width === w && l.canvas.height === h) return;
  if (!keep || l.canvas.width === 0 || l.canvas.height === 0) {
    l.canvas.width = w;
    l.canvas.height = h;
    return;
  }
  const tmp = makeLayer(l.canvas.width, l.canvas.height);
  if (tmp) tmp.ctx.drawImage(l.canvas, 0, 0);
  l.canvas.width = w;
  l.canvas.height = h;
  if (tmp) {
    l.ctx.setTransform(1, 0, 0, 1, 0, 0);
    l.ctx.drawImage(tmp.canvas, 0, 0);
    freeLayer(tmp);
  }
}

export function clearLayer(l: Layer | null): void {
  if (!l) return;
  l.ctx.setTransform(1, 0, 0, 1, 0, 0);
  l.ctx.globalAlpha = 1;
  l.ctx.globalCompositeOperation = 'source-over';
  l.ctx.clearRect(0, 0, l.canvas.width, l.canvas.height);
}

/* ------------------------------------------------------------------ */
/* ストロークの描画（ctx の変換は呼び出し側で設定済み）                    */
/* ------------------------------------------------------------------ */

/** 描画用に前処理した点列（ざらつき適用後）と入り抜き用の弧長。 */
export interface Geom {
  pts: readonly StrokePoint[];
  cum: number[] | null;
  total: number | null;
  len: number;
}

/** final: 終点が確定している（完了ストローク）。false なら始点側だけ入り抜きを掛ける。 */
export function geom(pts: readonly StrokePoint[], rp: ResolvedPen, final: boolean): Geom {
  const jp = jitterPoints(pts, rp.grain);
  if (!rp.taper) return { pts: jp, cum: null, total: null, len: 0 };
  const cum = cumulativeLength(jp);
  const L = cum[cum.length - 1] ?? 0;
  return { pts: jp, cum, total: final ? L : null, len: final ? taperLength(rp, L) : rp.size * 6 };
}

export function prep(c: Ctx, color: string): void {
  c.strokeStyle = color;
  c.fillStyle = color;
  c.lineCap = 'round';
  c.lineJoin = 'round';
}

export function setAlpha(c: Ctx, rp: ResolvedPen, p: number, mul: number): void {
  if (rp.pressureOpacity[0] !== rp.pressureOpacity[1]) c.globalAlpha = mul * penAlpha(rp, p);
}

/** 制御点 (from, to] の区間を描く。 */
export function drawRange(c: Ctx, g: Geom, rp: ResolvedPen, from: number, to: number, mul: number): void {
  if (to <= from) return;
  for (let k = Math.max(1, from + 1); k <= to; k++) {
    const seg = quadSegmentAt(g.pts, k);
    if (!seg) continue;
    const f = g.cum ? taperFactor(rp, g.cum[k] ?? 0, g.total, g.len) : 1;
    setAlpha(c, rp, seg.p, mul);
    c.beginPath();
    c.moveTo(seg.from.x, seg.from.y);
    c.quadraticCurveTo(seg.ctrl.x, seg.ctrl.y, seg.to.x, seg.to.y);
    c.lineWidth = penWidth(rp, seg.p) * f;
    c.stroke();
  }
}

/** 末尾区間（1 点なら点）を描く。 */
export function drawTail(c: Ctx, g: Geom, rp: ResolvedPen, mul: number): void {
  const pts = g.pts;
  const only = pts.length === 1 ? pts[0] : undefined;
  if (only) {
    setAlpha(c, rp, only.p, mul);
    c.beginPath();
    c.arc(only.x, only.y, penWidth(rp, only.p) / 2, 0, Math.PI * 2);
    c.fill();
    return;
  }
  const tail = tailSegment(pts);
  if (!tail) return;
  const n = pts.length;
  const s = g.cum ? ((g.cum[n - 2] ?? 0) + (g.cum[n - 1] ?? 0)) / 2 : 0;
  const f = g.cum ? taperFactor(rp, s, g.total, g.len) : 1;
  setAlpha(c, rp, tail.p, mul);
  c.beginPath();
  c.moveTo(tail.from.x, tail.from.y);
  c.quadraticCurveTo(tail.ctrl.x, tail.ctrl.y, tail.to.x, tail.to.y);
  c.lineWidth = penWidth(rp, tail.p) * f;
  c.stroke();
}

/**
 * 消しゴムストロークの点 [from, to) を c から消す（destination-out・半径 radius の丸い線）。
 * from > 0 なら点 from-1 からつなぐ。点が 1 個だけなら円。c は変換なし（デバイス px）を前提に xf で CSS px を写す。
 * 終わると c の変換・globalAlpha・合成方法は既定に戻っている。
 */
export function paintEraser(c: Ctx, pts: readonly StrokePoint[], radius: number, xf: Xf, from = 0, to = pts.length): void {
  const end = Math.min(to, pts.length);
  if (end <= from || end === 0) return;
  c.setTransform(xf.k, 0, 0, xf.k, xf.ox, xf.oy);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'destination-out';
  prep(c, '#000');
  const start = Math.max(0, from - 1);
  const first = pts[start]!;
  if (end - start === 1) {
    c.beginPath();
    c.arc(first.x, first.y, radius, 0, Math.PI * 2);
    c.fill();
  } else {
    c.lineWidth = radius * 2;
    c.beginPath();
    c.moveTo(first.x, first.y);
    for (let i = start + 1; i < end; i++) c.lineTo(pts[i]!.x, pts[i]!.y);
    c.stroke();
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-over';
}

/**
 * 完了ストローク 1 本を c に描く。c は変換なし（デバイス px）を前提に xf で CSS px を写す。
 * 重なりを避けたいペンは scratch（c と同じ大きさ以上）に描いてから opacity と blend で合成する。
 * 終わると c の変換・globalAlpha・合成方法は既定（恒等・1・source-over）に戻っている。
 */
export function paintStroke(c: Ctx, pts: readonly StrokePoint[], paint: Paint, xf: Xf, scratch: Layer | null, size: { w: number; h: number }): void {
  if (pts.length === 0) return;
  const rp = paint.pen;
  const g = geom(pts, rp, true);
  if (!needsLayer(rp) || !scratch) {
    c.setTransform(xf.k, 0, 0, xf.k, xf.ox, xf.oy);
    c.globalAlpha = rp.opacity;
    if (rp.blend !== 'source-over') c.globalCompositeOperation = rp.blend;
    prep(c, paint.color);
    drawRange(c, g, rp, 0, g.pts.length - 2, rp.opacity);
    drawTail(c, g, rp, rp.opacity);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    if (rp.blend !== 'source-over') c.globalCompositeOperation = 'source-over';
    return;
  }
  // 範囲（デバイス px）
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const q of g.pts) {
    if (q.x < minX) minX = q.x;
    if (q.y < minY) minY = q.y;
    if (q.x > maxX) maxX = q.x;
    if (q.y > maxY) maxY = q.y;
  }
  const pad = maxPenWidth(rp) / 2 + 2;
  const bx = Math.max(0, Math.floor((minX - pad) * xf.k + xf.ox));
  const by = Math.max(0, Math.floor((minY - pad) * xf.k + xf.oy));
  const ex = Math.min(size.w, Math.ceil((maxX + pad) * xf.k + xf.ox));
  const ey = Math.min(size.h, Math.ceil((maxY + pad) * xf.k + xf.oy));
  if (!(ex > bx && ey > by)) return;
  const sc = scratch.ctx;
  sc.setTransform(1, 0, 0, 1, 0, 0);
  sc.globalAlpha = 1;
  sc.globalCompositeOperation = 'source-over';
  sc.clearRect(bx, by, ex - bx, ey - by);
  sc.setTransform(xf.k, 0, 0, xf.k, xf.ox, xf.oy);
  prep(sc, paint.color);
  drawRange(sc, g, rp, 0, g.pts.length - 2, 1);
  drawTail(sc, g, rp, 1);
  sc.globalAlpha = 1;
  sc.setTransform(1, 0, 0, 1, 0, 0);
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = rp.opacity;
  c.globalCompositeOperation = rp.blend;
  c.drawImage(scratch.canvas, bx, by, ex - bx, ey - by, bx, by, ex - bx, ey - by);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
}
