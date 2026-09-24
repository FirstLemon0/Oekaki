/**
 * 幾何ユーティリティ（純関数・DOM 非依存）。
 * 点列は StrokePoint でも Vec2 でも扱えるよう、位置は {x, y} だけを見る。
 */
import type { Drawing, Stroke, StrokePoint, Vec2 } from './types';

// ---------------------------------------------------------------- 基本

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 角度を (-π, π] に正規化 */
export function wrapAngle(a: number): number {
  let r = a % (2 * Math.PI);
  if (r > Math.PI) r -= 2 * Math.PI;
  if (r <= -Math.PI) r += 2 * Math.PI;
  return r;
}

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function std(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return Math.sqrt(s / xs.length);
}

export function rms(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x * x;
  return Math.sqrt(s / xs.length);
}

/** 線形補間によるパーセンタイル（q: 0..1） */
export function percentile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = Math.min(Math.max(q, 0), 1) * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const f = pos - lo;
  return s[lo]! * (1 - f) + s[hi]! * f;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ---------------------------------------------------------------- 長さ・サイズ・再サンプリング

export function pathLength(pts: readonly Vec2[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1]!, pts[i]!);
  return L;
}

/** 各点までの累積弧長 */
export function cumulativeLength(pts: readonly Vec2[]): number[] {
  const c: number[] = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1]! + dist(pts[i - 1]!, pts[i]!));
  return c;
}

/** 各点の弧長比 0..1（全長 0 のときは添字比） */
export function arcFractions(pts: readonly Vec2[]): number[] {
  const c = cumulativeLength(pts);
  const L = c[c.length - 1] ?? 0;
  if (L <= 0) return pts.map((_, i) => (pts.length > 1 ? i / (pts.length - 1) : 0));
  return c.map((v) => v / L);
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  /** 対角線長（スケール正規化に使う） */
  diag: number;
}

export function bbox(pts: readonly Vec2[]): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (pts.length === 0) {
    minX = minY = maxX = maxY = 0;
  }
  const width = maxX - minX;
  const height = maxY - minY;
  return { minX, minY, maxX, maxY, width, height, diag: Math.hypot(width, height) };
}

/** バウンディングボックスの対角線長 */
export function boundingSize(pts: readonly Vec2[]): number {
  return bbox(pts).diag;
}

/**
 * 弧長で等間隔に n 点へ再サンプリングする。筆圧・時刻も線形補間する。
 * 全長 0 や 1 点しかない場合は先頭点を n 個返す。
 */
export function resample(stroke: Stroke, n: number): Stroke {
  const count = Math.max(2, Math.floor(n));
  if (stroke.length === 0) return [];
  const first = stroke[0]!;
  const c = cumulativeLength(stroke);
  const L = c[c.length - 1]!;
  if (stroke.length === 1 || L <= 0) return Array.from({ length: count }, () => ({ ...first }));
  const out: Stroke = [];
  let j = 0;
  for (let i = 0; i < count; i++) {
    const target = (L * i) / (count - 1);
    while (j < stroke.length - 2 && c[j + 1]! < target) j++;
    const a = stroke[j]!;
    const b = stroke[j + 1]!;
    const seg = c[j + 1]! - c[j]!;
    const f = seg > 0 ? clamp01((target - c[j]!) / seg) : 0;
    out.push({
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
      p: a.p + (b.p - a.p) * f,
      t: a.t + (b.t - a.t) * f,
    });
  }
  return out;
}

/** 描画全体を合計 total 点程度に（各ストロークの長さに比例して）再サンプリング */
export function resampleDrawing(d: Drawing, total: number): Drawing {
  const lens = d.map((s) => pathLength(s));
  const L = lens.reduce((a, b) => a + b, 0);
  return d
    .filter((s) => s.length > 0)
    .map((s) => {
      const len = pathLength(s);
      const n = L > 0 ? Math.max(2, Math.round((total * len) / L)) : 2;
      return resample(s, n);
    });
}

export function flatten(d: Drawing): StrokePoint[] {
  const out: StrokePoint[] = [];
  for (const s of d) for (const p of s) out.push(p);
  return out;
}

// ---------------------------------------------------------------- 線形代数（小さな連立方程式）

/** 部分ピボット付きガウス消去。特異なら null */
export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    }
    if (Math.abs(M[piv]![col]!) < 1e-12) return null;
    const tmp = M[col]!;
    M[col] = M[piv]!;
    M[piv] = tmp;
    const pr = M[col]!;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const row = M[r]!;
      const f = row[col]! / pr[col]!;
      if (f === 0) continue;
      for (let k = col; k <= n; k++) row[k] = row[k]! - f * pr[k]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

/** 最小二乗: rows·x ≈ rhs を正規方程式で解く */
function leastSquares(rows: number[][], rhs: number[]): number[] | null {
  const m = rows[0]?.length ?? 0;
  const A = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  const b = new Array<number>(m).fill(0);
  rows.forEach((r, i) => {
    for (let a = 0; a < m; a++) {
      b[a] = b[a]! + r[a]! * rhs[i]!;
      const Aa = A[a]!;
      for (let c = 0; c < m; c++) Aa[c] = Aa[c]! + r[a]! * r[c]!;
    }
  });
  return solveLinear(A, b);
}

// ---------------------------------------------------------------- 直線フィット

export interface LineFit {
  /** 重心 */
  cx: number;
  cy: number;
  /** 単位方向ベクトル */
  dx: number;
  dy: number;
}

/** 全最小二乗（PCA）による直線フィット。点→直線の垂直距離を最小化する */
export function fitLine(pts: readonly Vec2[]): LineFit {
  const n = pts.length;
  if (n === 0) return { cx: 0, cy: 0, dx: 1, dy: 0 };
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    const x = p.x - cx;
    const y = p.y - cy;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let dx = Math.cos(theta);
  let dy = Math.sin(theta);
  // 向きは始点→終点に揃える
  const a = pts[0]!;
  const b = pts[n - 1]!;
  if ((b.x - a.x) * dx + (b.y - a.y) * dy < 0) {
    dx = -dx;
    dy = -dy;
  }
  return { cx, cy, dx, dy };
}

/** 点から直線への符号なし垂直距離 */
export function distToLine(p: Vec2, l: LineFit): number {
  return Math.abs((p.x - l.cx) * -l.dy + (p.y - l.cy) * l.dx);
}

/** 直線の向き（度, 0..180） */
export function lineAngleDeg(l: LineFit): number {
  let a = (Math.atan2(l.dy, l.dx) * 180) / Math.PI;
  a = ((a % 180) + 180) % 180;
  return a;
}

export interface LineErrors {
  fit: LineFit;
  distances: number[];
  rmse: number;
  p90: number;
  /** フィット直線方向への射影の幅（ノイズで膨らまない「線の長さ」） */
  extent: number;
}

/** 直線方向への射影の幅 */
export function lineExtent(pts: readonly Vec2[], l: LineFit): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    const s = (p.x - l.cx) * l.dx + (p.y - l.cy) * l.dy;
    if (s < lo) lo = s;
    if (s > hi) hi = s;
  }
  return pts.length > 0 ? hi - lo : 0;
}

/** 直線フィットとその誤差（弧長で等間隔に再サンプリングしてから評価） */
export function lineErrors(stroke: Stroke, samples = 64): LineErrors {
  const rs = resample(stroke, samples);
  const fit = fitLine(rs);
  const distances = rs.map((p) => distToLine(p, fit));
  return { fit, distances, rmse: rms(distances), p90: percentile(distances, 0.9), extent: lineExtent(stroke, fit) };
}

// ---------------------------------------------------------------- 円フィット

export interface CircleFit {
  cx: number;
  cy: number;
  r: number;
}

/** 代数的円フィット（Kasa 法） */
export function fitCircle(pts: readonly Vec2[]): CircleFit {
  const n = pts.length;
  if (n < 3) return { cx: pts[0]?.x ?? 0, cy: pts[0]?.y ?? 0, r: 0 };
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;
  const s = Math.sqrt(mean(pts.map((p) => (p.x - mx) ** 2 + (p.y - my) ** 2))) || 1;
  const rows: number[][] = [];
  const rhs: number[] = [];
  for (const p of pts) {
    const x = (p.x - mx) / s;
    const y = (p.y - my) / s;
    rows.push([x, y, 1]);
    rhs.push(-(x * x + y * y));
  }
  const sol = leastSquares(rows, rhs);
  if (!sol) return { cx: mx, cy: my, r: s };
  const [D, E, F] = sol as [number, number, number];
  const cx = -D / 2;
  const cy = -E / 2;
  const r2 = cx * cx + cy * cy - F;
  return { cx: cx * s + mx, cy: cy * s + my, r: Math.sqrt(Math.max(r2, 0)) * s };
}

export function radialError(p: Vec2, c: CircleFit): number {
  return Math.hypot(p.x - c.cx, p.y - c.cy) - c.r;
}

/**
 * 閉じ精度: 始点と終点の距離 / 半径。
 * 行き過ぎ（始点を越えて重ね描き）を減点しないよう、終点と「冒頭 15% 区間の点」との最短距離を使う。
 */
export function closureRatio(stroke: Stroke, radius: number): number {
  if (stroke.length < 2 || radius <= 0) return 1;
  const end = stroke[stroke.length - 1]!;
  const u = arcFractions(stroke);
  let best = Infinity;
  for (let i = 0; i < stroke.length - 1; i++) {
    if (u[i]! > 0.15) break;
    best = Math.min(best, dist(stroke[i]!, end));
  }
  return best / radius;
}

// ---------------------------------------------------------------- 楕円フィット

export interface EllipseFit {
  cx: number;
  cy: number;
  /** 長半径 */
  a: number;
  /** 短半径 */
  b: number;
  /** 長軸の向き（ラジアン） */
  angle: number;
  /** 度合い＝短径/長径 0..1 */
  degree: number;
  /** 長軸角（度, 0..180） */
  axisAngleDeg: number;
}

function makeEllipse(cx: number, cy: number, r1: number, r2: number, ang1: number): EllipseFit {
  let a = r1;
  let b = r2;
  let angle = ang1;
  if (b > a) {
    a = r2;
    b = r1;
    angle = ang1 + Math.PI / 2;
  }
  let deg = (angle * 180) / Math.PI;
  deg = ((deg % 180) + 180) % 180;
  return { cx, cy, a, b, angle: (deg * Math.PI) / 180, degree: a > 0 ? b / a : 0, axisAngleDeg: deg };
}

/** PCA による近似楕円（代数フィットが楕円にならない場合のフォールバック） */
function ellipseByPca(pts: readonly Vec2[]): EllipseFit {
  const n = pts.length || 1;
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    sxx += (p.x - cx) ** 2;
    syy += (p.y - cy) ** 2;
    sxy += (p.x - cx) * (p.y - cy);
  }
  sxx /= n;
  syy /= n;
  sxy /= n;
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(tr * tr / 4 - det, 0));
  const l1 = tr / 2 + disc;
  const l2 = Math.max(tr / 2 - disc, 0);
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  // 楕円周上に一様分布した点の分散は 半径²/2
  return makeEllipse(cx, cy, Math.sqrt(2 * l1), Math.sqrt(2 * l2), theta);
}

/**
 * 楕円フィット。一般二次曲線 Ax²+Bxy+Cy²+Dx+Ey+F=0 を制約 A+C=1（回転・平行移動に不変）の
 * 線形最小二乗で解く（Fitzgibbon の代わりの近似）。楕円条件を満たさなければ PCA 近似。
 */
export function fitEllipse(pts: readonly Vec2[]): EllipseFit {
  const n = pts.length;
  if (n < 5) return ellipseByPca(pts);
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;
  const s = Math.sqrt(mean(pts.map((p) => (p.x - mx) ** 2 + (p.y - my) ** 2))) || 1;
  const rows: number[][] = [];
  const rhs: number[] = [];
  for (const p of pts) {
    const x = (p.x - mx) / s;
    const y = (p.y - my) / s;
    rows.push([x * x - y * y, x * y, x, y, 1]);
    rhs.push(-y * y);
  }
  const sol = leastSquares(rows, rhs);
  if (!sol) return ellipseByPca(pts);
  const [A, B, D, E, F] = sol as [number, number, number, number, number];
  const C = 1 - A;
  if (4 * A * C - B * B <= 1e-9) return ellipseByPca(pts);
  const center = solveLinear(
    [
      [2 * A, B],
      [B, 2 * C],
    ],
    [-D, -E],
  );
  if (!center) return ellipseByPca(pts);
  const [x0, y0] = center as [number, number];
  const F0 = F + (D * x0 + E * y0) / 2;
  const phi = 0.5 * Math.atan2(B, A - C);
  const c = Math.cos(phi);
  const sn = Math.sin(phi);
  const lam1 = A * c * c + B * c * sn + C * sn * sn;
  const lam2 = A * sn * sn - B * c * sn + C * c * c;
  if (!(-F0 / lam1 > 0) || !(-F0 / lam2 > 0)) return ellipseByPca(pts);
  const r1 = Math.sqrt(-F0 / lam1) * s;
  const r2 = Math.sqrt(-F0 / lam2) * s;
  return makeEllipse(x0 * s + mx, y0 * s + my, r1, r2, phi);
}

/** 点から楕円までの近似距離（Sampson 距離: 一次近似の幾何距離） */
export function ellipseDistance(p: Vec2, e: EllipseFit): number {
  const c = Math.cos(e.angle);
  const s = Math.sin(e.angle);
  const x = p.x - e.cx;
  const y = p.y - e.cy;
  const u = x * c + y * s;
  const v = -x * s + y * c;
  const a2 = e.a * e.a || 1e-12;
  const b2 = e.b * e.b || 1e-12;
  const f = (u * u) / a2 + (v * v) / b2 - 1;
  const g = 2 * Math.sqrt((u * u) / (a2 * a2) + (v * v) / (b2 * b2));
  if (g < 1e-12) return Math.min(e.a, e.b);
  return Math.abs(f) / g;
}

/** 軸角度（0..180 度）どうしの差（0..90） */
export function axisAngleDiff(a: number, b: number): number {
  const d = Math.abs((((a - b) % 180) + 180) % 180);
  return Math.min(d, 180 - d);
}

// ---------------------------------------------------------------- 距離（Chamfer）

/** 点から線分への距離 */
export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const l2 = vx * vx + vy * vy;
  if (l2 === 0) return dist(p, a);
  const t = clamp01(((p.x - a.x) * vx + (p.y - a.y) * vy) / l2);
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
}

/** 点から描画（折れ線群）までの最短距離 */
export function distToDrawing(p: Vec2, d: Drawing): number {
  let best = Infinity;
  for (const s of d) {
    if (s.length === 1) best = Math.min(best, dist(p, s[0]!));
    for (let i = 1; i < s.length; i++) {
      const v = distToSegment(p, s[i - 1]!, s[i]!);
      if (v < best) best = v;
    }
  }
  return best;
}

export interface ChamferResult {
  /** a の各点 → b への平均距離 */
  ab: number;
  /** b の各点 → a への平均距離 */
  ba: number;
  /** 両方向の平均 */
  mean: number;
}

/**
 * Chamfer 距離（両方向平均）。両描画を合計 samples 点程度にダウンサンプルし、
 * 点→相手の折れ線（線分）距離で評価する。O(n·m)。
 */
export function chamfer(a: Drawing, b: Drawing, samples = 200): ChamferResult {
  const ra = resampleDrawing(a, samples);
  const rb = resampleDrawing(b, samples);
  const pa = flatten(ra);
  const pb = flatten(rb);
  if (pa.length === 0 || pb.length === 0) return { ab: Infinity, ba: Infinity, mean: Infinity };
  const ab = mean(pa.map((p) => distToDrawing(p, rb)));
  const ba = mean(pb.map((p) => distToDrawing(p, ra)));
  return { ab, ba, mean: (ab + ba) / 2 };
}

// ---------------------------------------------------------------- ラスタ化 IoU

export interface Grid {
  x0: number;
  y0: number;
  cell: number;
  w: number;
  h: number;
}

export function makeGrid(drawings: readonly Drawing[], lineWidth: number, maxCells = 320): Grid {
  const pts: Vec2[] = [];
  for (const d of drawings) for (const s of d) for (const p of s) pts.push(p);
  const bb = bbox(pts);
  const pad = lineWidth;
  const W = bb.width + 2 * pad;
  const H = bb.height + 2 * pad;
  const cell = Math.max(lineWidth / 3, Math.max(W, H) / maxCells, 1e-9);
  return {
    x0: bb.minX - pad,
    y0: bb.minY - pad,
    cell,
    w: Math.max(1, Math.ceil(W / cell)),
    h: Math.max(1, Math.ceil(H / cell)),
  };
}

/** 自前のブール格子にラスタ化。セル中心が線から lineWidth/2 以内なら塗る */
export function rasterize(d: Drawing, lineWidth: number, g: Grid): Uint8Array {
  const out = new Uint8Array(g.w * g.h);
  const r = lineWidth / 2;
  const paint = (a: Vec2, b: Vec2) => {
    const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - r - g.x0) / g.cell));
    const i1 = Math.min(g.w - 1, Math.ceil((Math.max(a.x, b.x) + r - g.x0) / g.cell));
    const j0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - r - g.y0) / g.cell));
    const j1 = Math.min(g.h - 1, Math.ceil((Math.max(a.y, b.y) + r - g.y0) / g.cell));
    for (let j = j0; j <= j1; j++) {
      const cy = g.y0 + (j + 0.5) * g.cell;
      for (let i = i0; i <= i1; i++) {
        const idx = j * g.w + i;
        if (out[idx]) continue;
        const cx = g.x0 + (i + 0.5) * g.cell;
        if (distToSegment({ x: cx, y: cy }, a, b) <= r) out[idx] = 1;
      }
    }
  };
  for (const s of d) {
    if (s.length === 1) paint(s[0]!, s[0]!);
    for (let i = 1; i < s.length; i++) paint(s[i - 1]!, s[i]!);
  }
  return out;
}

/** 2 つの描画を同じ線幅で太らせてラスタ化した IoU */
export function rasterIoU(a: Drawing, b: Drawing, lineWidth: number): number {
  const g = makeGrid([a, b], lineWidth);
  const ra = rasterize(a, lineWidth, g);
  const rb = rasterize(b, lineWidth, g);
  let inter = 0;
  let uni = 0;
  for (let i = 0; i < ra.length; i++) {
    const x = ra[i]!;
    const y = rb[i]!;
    if (x && y) inter++;
    if (x || y) uni++;
  }
  return uni === 0 ? 0 : inter / uni;
}

// ---------------------------------------------------------------- 角度・滑らかさ・ブレ

/** 等間隔点列の進行方向（ラジアン）。n 点から n-1 個 */
export function headings(pts: readonly Vec2[]): number[] {
  const h: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    h.push(Math.atan2(pts[i]!.y - pts[i - 1]!.y, pts[i]!.x - pts[i - 1]!.x));
  }
  return h;
}

/** 回転角（進行方向の変化量）。n 点から n-2 個 */
export function turningAngles(pts: readonly Vec2[]): number[] {
  const h = headings(pts);
  const out: number[] = [];
  for (let i = 1; i < h.length; i++) out.push(wrapAngle(h[i]! - h[i - 1]!));
  return out;
}

function movingAverage(xs: readonly number[], win: number): number[] {
  const half = Math.floor(win / 2);
  return xs.map((_, i) => {
    let s = 0;
    let c = 0;
    for (let k = i - half; k <= i + half; k++) {
      if (k >= 0 && k < xs.length) {
        s += xs[k]!;
        c++;
      }
    }
    return s / c;
  });
}

/**
 * ブレ（手ブレの代理指標）: 等間隔再サンプリング後の回転角から移動平均（低周波＝意図した曲がり）を
 * 引いた高周波成分。点ごとの残差（ラジアン）を返す。再サンプル点数固定なのでスケール不変。
 */
export function jitterResiduals(stroke: Stroke, samples = 48): number[] {
  const rs = resample(stroke, samples);
  const ta = turningAngles(rs);
  const lo = movingAverage(ta, 7);
  return ta.map((v, i) => v - lo[i]!);
}

/** ブレの大きさ（高周波成分の RMS, ラジアン） */
export function jitterMetric(stroke: Stroke, samples = 48): number {
  return rms(jitterResiduals(stroke, samples));
}

/** 滑らかさ: 曲率変化量（回転角の差分）の標準偏差。小さいほど滑らか */
export function smoothnessMetric(stroke: Stroke, samples = 32): number {
  const ta = turningAngles(resample(stroke, samples));
  const d: number[] = [];
  for (let i = 1; i < ta.length; i++) d.push(ta[i]! - ta[i - 1]!);
  return std(d);
}

/**
 * 方向一貫性: 進行方向の円周分散 1-R（0=完全に一定, 1=ばらばら）。
 * 逆走・引っかかりも大きく効く。
 */
export function directionVariance(stroke: Stroke, samples = 16): number {
  const h = headings(resample(stroke, samples));
  if (h.length === 0) return 1;
  let sx = 0;
  let sy = 0;
  for (const a of h) {
    sx += Math.cos(a);
    sy += Math.sin(a);
  }
  return 1 - Math.hypot(sx, sy) / h.length;
}

/** 軸（180 度周期）の平均と標準偏差（度）。角度を倍にして円周統計を取る */
export function axialStats(anglesDeg: readonly number[]): { mean: number; std: number } {
  if (anglesDeg.length === 0) return { mean: 0, std: 0 };
  let sx = 0;
  let sy = 0;
  for (const a of anglesDeg) {
    const r = (a * Math.PI) / 90;
    sx += Math.cos(r);
    sy += Math.sin(r);
  }
  const R = Math.min(Math.hypot(sx, sy) / anglesDeg.length, 1);
  let m = (Math.atan2(sy, sx) * 90) / Math.PI;
  m = ((m % 180) + 180) % 180;
  const sd = R > 0 ? (Math.sqrt(-2 * Math.log(R)) * 90) / Math.PI : 90;
  return { mean: m, std: sd };
}
