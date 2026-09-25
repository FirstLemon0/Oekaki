/**
 * 選択範囲の変形（移動・拡縮・回転・反転）の行列計算（純関数）。
 *
 * 変形は「選択範囲の外接矩形の中心 c」を基準に、拡縮 → 回転 → 平行移動の順で掛ける:
 *   M = T(c + t) · R(θ) · S(sx, sy) · T(-c)
 * 行列は CSS の matrix(a, b, c, d, e, f) と同じ並び（x' = a·x + c·y + e, y' = b·x + d·y + f）。
 * 座標はキャンバス座標（CSS px、ビューに依存しない）。
 */
import type { Mat, SelectionMask } from './types';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TransformState {
  tx: number;
  ty: number;
  /** 拡縮（正の値。反転は flipX / flipY） */
  sx: number;
  sy: number;
  /** 回転（度） */
  rot: number;
  flipX: boolean;
  flipY: boolean;
}

export const IDENTITY_STATE: TransformState = { tx: 0, ty: 0, sx: 1, sy: 1, rot: 0, flipX: false, flipY: false };
/** 拡縮の下限（つぶれて戻せなくならないように） */
export const MIN_SCALE = 0.05;

export function isIdentityState(s: TransformState): boolean {
  return s.tx === 0 && s.ty === 0 && s.sx === 1 && s.sy === 1 && s.rot === 0 && !s.flipX && !s.flipY;
}

/** 選択範囲の外接矩形 */
export function maskBounds(mask: SelectionMask): Box {
  if (mask.kind === 'rect') {
    const x = Math.min(mask.x, mask.x + mask.w);
    const y = Math.min(mask.y, mask.y + mask.h);
    return { x, y, w: Math.abs(mask.w), h: Math.abs(mask.h) };
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of mask.points) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** A·B（B を先に掛ける） */
export function multiply(a: Mat, b: Mat): Mat {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export function apply(m: Mat, p: { x: number; y: number }): { x: number; y: number } {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/** 状態 → 行列（box は変形前の外接矩形） */
export function matrixOf(box: Box, s: TransformState): Mat {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const sx = s.sx * (s.flipX ? -1 : 1);
  const sy = s.sy * (s.flipY ? -1 : 1);
  const r = (s.rot * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const toOrigin: Mat = [1, 0, 0, 1, -cx, -cy];
  const scale: Mat = [sx, 0, 0, sy, 0, 0];
  const rotate: Mat = [cos, sin, -sin, cos, 0, 0];
  const back: Mat = [1, 0, 0, 1, cx + s.tx, cy + s.ty];
  return multiply(back, multiply(rotate, multiply(scale, toOrigin)));
}

/** 変形後の外接矩形の四隅（左上・右上・右下・左下の順。反転していても元の角の順） */
export function corners(box: Box, s: TransformState): { x: number; y: number }[] {
  const m = matrixOf(box, s);
  return [
    { x: box.x, y: box.y },
    { x: box.x + box.w, y: box.y },
    { x: box.x + box.w, y: box.y + box.h },
    { x: box.x, y: box.y + box.h },
  ].map((p) => apply(m, p));
}

/** 変形後の中心 */
export function centerOf(box: Box, s: TransformState): { x: number; y: number } {
  return { x: box.x + box.w / 2 + s.tx, y: box.y + box.h / 2 + s.ty };
}

/**
 * ハンドルのドラッグ → 新しい拡縮。
 * handle は外接矩形の中心から見た向き（-1 / 0 / 1）。角（両方 ≠ 0）は縦横比を保つ、辺は片方だけ。
 * p はキャンバス座標のポインター。
 */
export function scaleFromHandle(
  box: Box,
  s: TransformState,
  handle: { hx: -1 | 0 | 1; hy: -1 | 0 | 1 },
  p: { x: number; y: number },
): TransformState {
  const c = centerOf(box, s);
  const r = (-s.rot * Math.PI) / 180;
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  // 回転を戻した座標（反転は符号に出るので絶対値で見る）
  const lx = Math.abs(dx * Math.cos(r) - dy * Math.sin(r));
  const ly = Math.abs(dx * Math.sin(r) + dy * Math.cos(r));
  const halfW = Math.max(box.w / 2, 0.5);
  const halfH = Math.max(box.h / 2, 0.5);
  let sx = s.sx;
  let sy = s.sy;
  if (handle.hx !== 0 && handle.hy !== 0) {
    // 角: 中心からの距離の比で縦横比を保って拡縮
    const k = Math.hypot(lx, ly) / Math.hypot(halfW * s.sx, halfH * s.sy);
    sx = s.sx * k;
    sy = s.sy * k;
  } else if (handle.hx !== 0) sx = lx / halfW;
  else if (handle.hy !== 0) sy = ly / halfH;
  return { ...s, sx: Math.max(MIN_SCALE, sx), sy: Math.max(MIN_SCALE, sy) };
}

/**
 * 回転ハンドルの位置（キャンバス座標）。反転に関係なく「見た目の上辺」の中央から gap だけ外。
 * gap はキャンバス座標（画面で一定の距離にしたいときは呼び出し側がズームで割る）。
 */
export function rotateHandlePos(box: Box, s: TransformState, gap: number): { x: number; y: number } {
  const c = centerOf(box, s);
  const d = (box.h / 2) * s.sy + gap;
  const r = (s.rot * Math.PI) / 180;
  return { x: c.x + d * Math.sin(r), y: c.y - d * Math.cos(r) };
}

/** 回転ハンドルのドラッグ → 角度（度、-180..180）。ハンドルは上辺の中央の上にあるので、真上が 0°。15° に吸着（±3°） */
export function rotationFromPointer(box: Box, s: TransformState, p: { x: number; y: number }): number {
  const c = centerOf(box, s);
  let deg = (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI + 90;
  deg = ((deg % 360) + 360) % 360;
  if (deg > 180) deg -= 360;
  const snap = Math.round(deg / 15) * 15;
  return Math.abs(deg - snap) <= 3 ? (snap === -180 ? 180 : snap) : Math.round(deg * 10) / 10;
}
