/** テスト用の合成ストローク生成（シード固定の乱数） */
import type { Drawing, Stroke, StrokePoint } from './types';

/** mulberry32 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller による標準正規乱数 */
export function gauss(r: () => number): () => number {
  return () => {
    const u = Math.max(r(), 1e-12);
    const v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

export function pt(x: number, y: number, t: number, p = 0.5): StrokePoint {
  return { x, y, p, t };
}

export function line(x0: number, y0: number, x1: number, y1: number, n = 80, dt = 10): Stroke {
  return Array.from({ length: n }, (_, i) => {
    const f = i / (n - 1);
    return pt(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, i * dt);
  });
}

export function ellipse(cx: number, cy: number, a: number, b: number, angleDeg = 0, n = 120, sweep = 2 * Math.PI): Stroke {
  const ang = (angleDeg * Math.PI) / 180;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return Array.from({ length: n }, (_, i) => {
    const th = (sweep * i) / (n - 1);
    const u = a * Math.cos(th);
    const v = b * Math.sin(th);
    return pt(cx + u * c - v * s, cy + u * s + v * c, i * 10);
  });
}

export function circle(cx: number, cy: number, r: number, n = 120, sweep = 2 * Math.PI): Stroke {
  return ellipse(cx, cy, r, r, 0, n, sweep);
}

/** 各点に等方ガウスノイズ（標準偏差 sigma）を加える */
export function noisy(s: Stroke, sigma: number, seed = 1): Stroke {
  const g = gauss(rng(seed));
  return s.map((q) => ({ ...q, x: q.x + g() * sigma, y: q.y + g() * sigma }));
}

export function scaleStroke(s: Stroke, k: number): Stroke {
  return s.map((q) => ({ ...q, x: q.x * k, y: q.y * k }));
}

export function translate(d: Drawing, dx: number, dy: number): Drawing {
  return d.map((s) => s.map((q) => ({ ...q, x: q.x + dx, y: q.y + dy })));
}
