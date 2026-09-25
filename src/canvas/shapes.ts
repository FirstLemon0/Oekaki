/** 図形ツール（直線・四角・楕円）を点列のストロークに展開する（純関数）。 */
import type { Stroke, StrokePoint } from '@/scoring/types';

export type ShapeKind = 'line' | 'rect' | 'ellipse';

/** 図形の筆圧（固定） */
export const SHAPE_PRESSURE = 0.6;
export const LINE_POINTS = 32;
export const RECT_SIDE_POINTS = 8;
export const ELLIPSE_POINTS = 64;
/** 点と点の時刻の間隔（ms）。再生で図形が少しずつ描かれるように */
const DT = 6;

function seg(a: { x: number; y: number }, b: { x: number; y: number }, n: number, t0: number): Stroke {
  const out: StrokePoint[] = [];
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0 : i / (n - 1);
    out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, p: SHAPE_PRESSURE, t: t0 + i * DT });
  }
  return out;
}

/**
 * a（押した所）→ b（離した所）の図形。
 * line: 32 点の 1 本 / rect: 角で分けた 4 本（各 8 点） / ellipse: a,b を外接矩形とする 64 点の閉じた 1 本（始点を最後にも置く）。
 * 大きさがほぼ 0 なら空。
 */
export function shapeStrokes(kind: ShapeKind, a: { x: number; y: number }, b: { x: number; y: number }, t0 = 0): Stroke[] {
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  if (kind === 'line') {
    if (Math.hypot(w, h) < 1) return [];
    return [seg(a, b, LINE_POINTS, t0)];
  }
  if (w < 1 && h < 1) return [];
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  if (kind === 'rect') {
    const c = [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ];
    return c.map((p, i) => seg(p, c[(i + 1) % 4]!, RECT_SIDE_POINTS, t0 + i * RECT_SIDE_POINTS * DT));
  }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2;
  const ry = (y1 - y0) / 2;
  const out: StrokePoint[] = [];
  for (let i = 0; i <= ELLIPSE_POINTS; i++) {
    // 真上から時計回り
    const th = -Math.PI / 2 + (i / ELLIPSE_POINTS) * Math.PI * 2;
    out.push({ x: cx + rx * Math.cos(th), y: cy + ry * Math.sin(th), p: SHAPE_PRESSURE, t: t0 + i * DT });
  }
  return [out];
}
