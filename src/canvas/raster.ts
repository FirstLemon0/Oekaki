/**
 * op 1 手をレイヤーの画像（オフスクリーン canvas）に描く部品。表示・再生・書き出しで共通に使う。
 * 解像度は env.xf（CSS px → デバイス px）で決まる。
 */
import type { StrokePoint } from '@/scoring/types';
import type { BlendMode, LayerInfo, Mat, SelectionMask, StrokeStyle } from './types';
import { clearLayer, freeLayer, paintEraser, paintStroke, type Layer, type Paint, type Xf } from './paint';
import { isEraserStyle } from './pen';
import { bakeOnPaper, parseHex, stampMask, type FillMask } from './fill';
import { traceMask } from './selection';
import { invert, mul } from './matrix';

export interface RasterEnv {
  xf: Xf;
  /** レイヤー画像の大きさ（デバイス px） */
  w: number;
  h: number;
  /** 見た目（null なら描かない） */
  paint(style: StrokeStyle | undefined): Paint | null;
  /** 塗りつぶしの色（'ink' をテーマ・書き出しの墨に解決する） */
  fillColor(color: string): string;
  /** 1 本ずつ合成する作業用 */
  scratch: Layer | null;
  /** w×h の透明な作業用レイヤー */
  make(): Layer | null;
  /** 塗りつぶしの領域（固定解像度 CSS px × 1 で計算済み）。null は塗らない */
  mask(op: FillOp, j: number): FillMask | null;
  /** op（添字 j）に掛ける表示だけの透明度（書き出しは常に 1） */
  alpha(j: number): number;
  /** 結合で乗算・スクリーン・不透明度を焼き込むときの紙色 */
  paper: readonly [number, number, number];
  /** 塗りの型押しに使う CPU canvas（w×h 以上） */
  stamp(w: number, h: number): Layer | null;
}

export type FillOp = { kind: 'fill'; layer: string; x: number; y: number; color: string; tolerance: number; reference: 'layer' | 'all' };

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
 * 塗りつぶし。領域 m（キャンバス座標 × 1 の画素）を xf の倍率に拡大して、色を既存の画素の**下に敷く**
 * （destination-over。線の縁のアンチエイリアスを残したまま隙間を埋める）。GPU の合成だけで、レイヤーの読み戻しはしない。
 */
export function drawFillOp(target: Layer, m: FillMask | null, color: string, env: RasterEnv): void {
  if (!m) return;
  const rgb = parseHex(color);
  if (!rgb) return;
  const bw = m.box.x1 - m.box.x0 + 1;
  const bh = m.box.y1 - m.box.y0 + 1;
  // 周囲に 1px の透明な縁を付けて型を作る（拡大の補間で外の画素を拾わない）
  const sw = bw + 2;
  const sh = bh + 2;
  const st = env.stamp(sw, sh);
  if (!st) return;
  let img: ImageData | undefined;
  try {
    img = st.ctx.createImageData(sw, sh) as ImageData | undefined;
  } catch {
    img = undefined;
  }
  if (!img || !img.data) return;
  stampMask(m, rgb, img.data, sw);
  st.ctx.putImageData(img, 0, 0);
  const k = env.xf.k;
  const c = target.ctx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'destination-over';
  c.imageSmoothingEnabled = k !== 1;
  c.drawImage(st.canvas, 0, 0, sw, sh, env.xf.ox + (m.box.x0 - 1) * k, env.xf.oy + (m.box.y0 - 1) * k, sw * k, sh * k);
  c.imageSmoothingEnabled = true;
  c.globalCompositeOperation = 'source-over';
}

function clipMask(l: Layer, mask: SelectionMask, xf: Xf): void {
  const c = l.ctx;
  c.setTransform(xf.k, 0, 0, xf.k, xf.ox, xf.oy);
  c.beginPath();
  traceMask(c, mask);
  // 当たり判定（pointInMask）・点列の切り分けと同じ偶奇規則
  c.clip('evenodd');
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
  freeLayer(cut);
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

type BlendInfo = Pick<LayerInfo, 'opacity' | 'blend' | 'visible'>;

/**
 * 下のレイヤー（target）に上のレイヤー（up）を結合する。結果は「不透明度 1・通常」のレイヤーとして、
 * 結合前に紙の上で見えていた見た目（下の不透明度・合成、上の不透明度・合成）を焼き込む。
 * どちらも通常の合成なら GPU だけで正確に。乗算・スクリーンを含むときは画素で紙色の上の見た目を焼き込む。
 */
export function mergeInto(target: Layer, up: Layer | null, below: BlendInfo, upInfo: BlendInfo, env: RasterEnv): void {
  const upOn = !!up && upInfo.visible && upInfo.opacity > 0;
  const plain = below.blend === 'normal' && (!upOn || upInfo.blend === 'normal');
  if (!plain) {
    const a = readPixels(target);
    const b = upOn ? readPixels(up!) : null;
    if (a && (b || !upOn)) {
      const layers = [{ data: new Uint8ClampedArray(a.data), opacity: below.opacity, blend: below.blend }];
      if (b) layers.push({ data: b.data, opacity: upInfo.opacity, blend: upInfo.blend });
      bakeOnPaper(a.data, layers, env.paper);
      target.ctx.setTransform(1, 0, 0, 1, 0, 0);
      target.ctx.putImageData(a, 0, 0);
      return;
    }
    // 画素を読めない環境: 合成だけで近似
  }
  if (below.opacity < 1) {
    // 下の不透明度を焼き込む
    const tmp = env.make();
    if (tmp) {
      tmp.ctx.drawImage(target.canvas, 0, 0);
      clearLayer(target);
      target.ctx.globalAlpha = below.opacity;
      target.ctx.drawImage(tmp.canvas, 0, 0);
      target.ctx.globalAlpha = 1;
      freeLayer(tmp);
    }
  }
  if (upOn) drawLayerOnto(target, up!, upInfo);
}

export function copyLayer(dst: Layer, src: Layer): void {
  clearLayer(dst);
  dst.ctx.drawImage(src.canvas, 0, 0);
}
