/**
 * op 1 手をレイヤーの画像（オフスクリーン canvas）に描く部品。表示・再生・書き出しで共通に使う。
 * 解像度は env.xf（CSS px → デバイス px）で決まる。
 */
import type { StrokePoint } from '@/scoring/types';
import type { BlendMode, LayerInfo, Mat, SelectionMask, StrokeStyle } from './types';
import { clearLayer, paintEraser, paintStroke, type Layer, type Paint, type Xf } from './paint';
import { isEraserStyle } from './pen';
import { dilateMask, floodFillMask, paintBehind, parseHex } from './fill';
import { traceMask } from './selection';
import { invert, mul } from './matrix';

export interface RasterEnv {
  xf: Xf;
  /** レイヤー画像の大きさ（デバイス px） */
  w: number;
  h: number;
  /** 見た目（null なら描かない。シルエット中の補助線など） */
  paint(style: StrokeStyle | undefined): Paint | null;
  /** 塗りつぶしの色（シルエット中は黒に置き換えるなど） */
  fillColor(hex: string): string;
  /** 1 本ずつ合成する作業用 */
  scratch: Layer | null;
  /** w×h の透明な作業用レイヤー */
  make(): Layer | null;
  /** 塗りつぶしの膨張（デバイス px） */
  dilate: number;
}

export function compositeOp(b: BlendMode): GlobalCompositeOperation {
  return b === 'multiply' ? 'multiply' : b === 'screen' ? 'screen' : 'source-over';
}

/** ストローク 1 本（消しゴムは destination-out）。alpha は表示だけの透明度（消しゴムには掛けない）。 */
export function drawStrokeOp(l: Layer, points: readonly StrokePoint[], style: StrokeStyle | undefined, env: RasterEnv, alpha = 1): void {
  if (isEraserStyle(style)) {
    paintEraser(l.ctx, points, style.size, env.xf);
    return;
  }
  const paint = env.paint(style);
  if (!paint || alpha <= 0) return;
  const shown = alpha < 1 ? { ...paint, pen: { ...paint.pen, opacity: paint.pen.opacity * alpha } } : paint;
  paintStroke(l.ctx, points, shown, env.xf, env.scratch, { w: env.w, h: env.h });
}

/** getImageData（使えない環境・失敗は null） */
export function readPixels(l: Layer, x = 0, y = 0, w = l.canvas.width, h = l.canvas.height): ImageData | null {
  if (w <= 0 || h <= 0) return null;
  try {
    const d = l.ctx.getImageData(x, y, w, h) as ImageData | undefined;
    return d && d.data && d.data.length >= w * h * 4 ? d : null;
  } catch {
    return null;
  }
}

/**
 * 塗りつぶし。ref は境界判定に使う画素（null なら target 自身）。塗った画素数を返す（何もしなければ 0）。
 * 色は既存の画素の下に敷く（線の縁のアンチエイリアスを残したまま隙間を埋める）。
 */
export function drawFillOp(
  target: Layer,
  ref: Uint8ClampedArray | null,
  op: { x: number; y: number; color: string; tolerance: number },
  env: RasterEnv,
): number {
  const img = readPixels(target);
  if (!img) return 0;
  const w = img.width;
  const h = img.height;
  const sx = Math.floor(op.x * env.xf.k + env.xf.ox);
  const sy = Math.floor(op.y * env.xf.k + env.xf.oy);
  const rgb = parseHex(env.fillColor(op.color));
  if (!rgb) return 0;
  let mask = floodFillMask(ref ?? img.data, w, h, sx, sy, op.tolerance);
  if (!mask) return 0;
  if (env.dilate > 0) mask = dilateMask(mask, w, h, env.dilate);
  paintBehind(img.data, mask, rgb);
  target.ctx.setTransform(1, 0, 0, 1, 0, 0);
  target.ctx.putImageData(img, 0, 0);
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i]!;
  return n;
}

function clipMask(l: Layer, mask: SelectionMask, xf: Xf): void {
  const c = l.ctx;
  c.setTransform(xf.k, 0, 0, xf.k, xf.ox, xf.oy);
  c.beginPath();
  traceMask(c, mask);
  c.clip();
  c.setTransform(1, 0, 0, 1, 0, 0);
}

/** 選択範囲を透明にする */
export function drawDeleteOp(l: Layer, mask: SelectionMask, env: RasterEnv): void {
  const c = l.ctx;
  c.save();
  clipMask(l, mask, env.xf);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
  c.clearRect(0, 0, l.canvas.width, l.canvas.height);
  c.restore();
}

/** 選択範囲の画素を切り出した透明な作業用レイヤー */
export function cutMask(src: Layer, mask: SelectionMask, env: RasterEnv): Layer | null {
  const t = env.make();
  if (!t) return null;
  t.ctx.save();
  clipMask(t, mask, env.xf);
  t.ctx.drawImage(src.canvas, 0, 0);
  t.ctx.restore();
  return t;
}

/** キャンバス座標の行列 → デバイス px の行列（D × M × D⁻¹） */
export function deviceMatrix(m: Mat, xf: Xf): Mat {
  const D: Mat = [xf.k, 0, 0, xf.k, xf.ox, xf.oy];
  return mul(mul(D, m), invert(D));
}

/** 切り出した画像を行列で描く */
export function drawCut(dst: Layer, cut: Layer, matrix: Mat, xf: Xf): void {
  const c = dst.ctx;
  const d = deviceMatrix(matrix, xf);
  c.setTransform(d[0], d[1], d[2], d[3], d[4], d[5]);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
  c.imageSmoothingEnabled = true;
  c.drawImage(cut.canvas, 0, 0);
  c.setTransform(1, 0, 0, 1, 0, 0);
}

/** 選択範囲の移動・拡縮・回転・反転（元の場所は透明に） */
export function drawTransformOp(l: Layer, mask: SelectionMask, matrix: Mat, env: RasterEnv): void {
  const cut = cutMask(l, mask, env);
  if (!cut) return;
  drawDeleteOp(l, mask, env);
  drawCut(l, cut, matrix, env.xf);
}

/** 上のレイヤー（info の不透明度・合成で）を dst に重ねる */
export function drawLayerOnto(dst: Layer, src: Layer, info: Pick<LayerInfo, 'opacity' | 'blend' | 'visible'>): void {
  if (!info.visible || info.opacity <= 0) return;
  const c = dst.ctx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = info.opacity;
  c.globalCompositeOperation = compositeOp(info.blend);
  c.drawImage(src.canvas, 0, 0);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
}

export function copyLayer(dst: Layer, src: Layer): void {
  clearLayer(dst);
  dst.ctx.drawImage(src.canvas, 0, 0);
}
