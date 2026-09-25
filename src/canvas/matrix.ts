/** 2D アフィン行列（CSS matrix(a,b,c,d,e,f) と同じ並び）とビューの計算（純関数）。 */
import type { Mat, ViewState } from './types';

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export const ZOOM_RANGE: [number, number] = [0.25, 8];

export const DEFAULT_VIEW: ViewState = { zoom: 1, panX: 0, panY: 0, rotationDeg: 0 };

/** A × B（B を先に掛けてから A）。canvas の transform(B) は「今の変換 × B」。 */
export function mul(A: Mat, B: Mat): Mat {
  return [
    A[0] * B[0] + A[2] * B[1],
    A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3],
    A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4],
    A[1] * B[4] + A[3] * B[5] + A[5],
  ];
}

/** 逆行列。特異なら恒等を返す。 */
export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return [...IDENTITY];
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

export function apply(m: Mat, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export function translate(tx: number, ty: number): Mat {
  return [1, 0, 0, 1, tx, ty];
}

export function scale(sx: number, sy = sx): Mat {
  return [sx, 0, 0, sy, 0, 0];
}

export function rotate(deg: number): Mat {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, s, -s, c, 0, 0];
}

export function isIdentity(m: Mat, eps = 1e-9): boolean {
  return m.every((v, i) => Math.abs(v - IDENTITY[i]!) <= eps);
}

export function isFiniteMat(m: unknown): m is Mat {
  return Array.isArray(m) && m.length === 6 && m.every((v) => typeof v === 'number' && Number.isFinite(v));
}

/** 角度を (-180, 180] にそろえる */
export function normalizeDeg(d: number): number {
  if (!Number.isFinite(d)) return 0;
  let r = d % 360;
  if (r <= -180) r += 360;
  if (r > 180) r -= 360;
  return r;
}

export function clampZoom(z: number): number {
  if (!Number.isFinite(z) || z <= 0) return 1;
  return Math.min(ZOOM_RANGE[1], Math.max(ZOOM_RANGE[0], z));
}

/** キャンバス座標 → 反転前の画面座標（CSS px） */
export function viewMatrix(v: ViewState): Mat {
  return mul(translate(v.panX, v.panY), mul(rotate(v.rotationDeg), scale(v.zoom)));
}

export function isIdentityView(v: ViewState): boolean {
  return v.zoom === 1 && v.panX === 0 && v.panY === 0 && normalizeDeg(v.rotationDeg) === 0;
}

/**
 * 2 本指のジェスチャー: 触れた瞬間のキャンバス上の点 c1,c2 が、今の画面上の点 s1,s2（反転前）の下に来るビュー。
 * rotate=false なら回転は base のまま（ズームとパンだけ）。ズームは ZOOM_RANGE に丸め、2 点の中点を合わせる。
 */
export function gestureView(
  base: ViewState,
  c1: { x: number; y: number },
  c2: { x: number; y: number },
  s1: { x: number; y: number },
  s2: { x: number; y: number },
  rotateOn: boolean,
): ViewState {
  const cdx = c2.x - c1.x;
  const cdy = c2.y - c1.y;
  const sdx = s2.x - s1.x;
  const sdy = s2.y - s1.y;
  const cl = Math.hypot(cdx, cdy);
  const sl = Math.hypot(sdx, sdy);
  let zoom = base.zoom;
  let rot = base.rotationDeg;
  if (cl > 1e-6 && sl > 1e-6) {
    zoom = clampZoom(sl / cl);
    if (rotateOn) rot = normalizeDeg(((Math.atan2(sdy, sdx) - Math.atan2(cdy, cdx)) * 180) / Math.PI);
  }
  const cm = { x: (c1.x + c2.x) / 2, y: (c1.y + c2.y) / 2 };
  const sm = { x: (s1.x + s2.x) / 2, y: (s1.y + s2.y) / 2 };
  const m = mul(rotate(rot), scale(zoom));
  const p = apply(m, cm.x, cm.y);
  return { zoom, panX: sm.x - p.x, panY: sm.y - p.y, rotationDeg: rot };
}

/** 2 本指の向きの変化（度）。ひねりの判定用 */
export function twistDeg(
  c1: { x: number; y: number },
  c2: { x: number; y: number },
  s1: { x: number; y: number },
  s2: { x: number; y: number },
): number {
  const a0 = Math.atan2(c2.y - c1.y, c2.x - c1.x);
  const a1 = Math.atan2(s2.y - s1.y, s2.x - s1.x);
  return normalizeDeg(((a1 - a0) * 180) / Math.PI);
}

/** 紙（w×h）を画面（W×H）の中央に収めるビュー（回転 0、余白 4%）。 */
export function fitViewFor(w: number, h: number, W: number, H: number): ViewState {
  if (!(w > 0 && h > 0 && W > 0 && H > 0)) return { ...DEFAULT_VIEW };
  const zoom = clampZoom(Math.min(W / w, H / h) * 0.96);
  return { zoom, panX: (W - w * zoom) / 2, panY: (H - h * zoom) / 2, rotationDeg: 0 };
}
