// ステージ2・3 のなぞりテンプレート生成スクリプト
// 実行: node content/templates/_gen/gen-s2s3.mjs
// 出力: content/templates/<id>.json （Drawing 形式: [[{x,y,p,t},...], ...]、x,y は 0..1）
// 形式は gen.mjs と同じ（p 0.6、t 16ms 刻み、各ストローク 40〜120 点）。
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TAU = Math.PI * 2;

/** 折れ線を弧長で等間隔に n 点へリサンプル */
function resample(pts, n) {
  const d = [0];
  for (let i = 1; i < pts.length; i++) d.push(d[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = d[d.length - 1];
  const out = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const s = (L * k) / (n - 1);
    while (j < pts.length - 2 && d[j + 1] < s) j++;
    const seg = d[j + 1] - d[j] || 1;
    const u = Math.min(1, Math.max(0, (s - d[j]) / seg));
    out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * u, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * u]);
  }
  return out;
}

function param(f, t0, t1, fine = 400) {
  const pts = [];
  for (let i = 0; i <= fine; i++) pts.push(f(t0 + ((t1 - t0) * i) / fine));
  return pts;
}

const ellipse = (cx, cy, rx, ry, a0 = -Math.PI / 2, a1 = a0 + TAU) =>
  param((a) => [cx + rx * Math.cos(a), cy + ry * Math.sin(a)], a0, a1);

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
function inter(p1, p2, p3, p4) {
  const d = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0]);
  const a = p1[0] * p2[1] - p1[1] * p2[0];
  const b = p3[0] * p4[1] - p3[1] * p4[0];
  return [(a * (p3[0] - p4[0]) - (p1[0] - p2[0]) * b) / d, (a * (p3[1] - p4[1]) - (p1[1] - p2[1]) * b) / d];
}
const atX = (p, vp, X) => [X, p[1] + ((vp[1] - p[1]) * (X - p[0])) / (vp[0] - p[0])];

function toStroke(pts, n) {
  const r = (v) => Math.round(v * 10000) / 10000;
  return resample(pts, n).map(([x, y], i) => ({ x: r(x), y: r(y), p: 0.6, t: i * 16 }));
}

function save(id, strokes) {
  for (const s of strokes) {
    if (s.length < 40 || s.length > 120) throw new Error(`${id}: 点数 ${s.length}`);
    for (const q of s) if (q.x < 0 || q.x > 1 || q.y < 0 || q.y > 1) throw new Error(`${id}: 範囲外 ${q.x},${q.y}`);
  }
  writeFileSync(join(OUT, `${id}.json`), JSON.stringify(strokes) + '\n');
  console.log(id, strokes.length, 'strokes');
}

// cube-1pt → fix-2026-09.mjs で生成（2026-09 絵の先生レビューで作り直し。正面を正方形に。ここで再生成すると古い版に戻るので外した）

// ---- cube-2pt: 2点透視の立方体（手前の縦線 → 左右の縦線 → 上下の辺 → 奥の角）
{
  const vpL = [-0.4, 0.2], vpR = [1.4, 0.2];
  const ft = [0.5, 0.38], fb = [0.5, 0.9];
  const lt = atX(ft, vpL, 0.24), lb = atX(fb, vpL, 0.24);
  const rt = atX(ft, vpR, 0.78), rb = atX(fb, vpR, 0.78);
  const bt = inter(lt, vpR, rt, vpL);
  save('cube-2pt', [
    toStroke([ft, fb], 60),
    toStroke([lt, lb], 50),
    toStroke([rt, rb], 50),
    toStroke([lb, fb, rb], 80),
    toStroke([lt, ft, rt], 80),
    toStroke([lt, bt, rt], 80),
  ]);
}

// ---- cylinder: 中心の軸・上の楕円・左右の側面・底の楕円（手前半分）
save('cylinder', [
  toStroke([[0.5, 0.06], [0.5, 0.94]], 60),
  toStroke(ellipse(0.5, 0.22, 0.2, 0.06), 100),
  toStroke([[0.3, 0.22], [0.3, 0.8]], 50),
  toStroke([[0.7, 0.22], [0.7, 0.8]], 50),
  toStroke(ellipse(0.5, 0.8, 0.2, 0.075, Math.PI, 0), 70),
]);

// ---- sphere-guides: 円・赤道・子午線
save('sphere-guides', [
  toStroke(ellipse(0.5, 0.5, 0.3, 0.4), 120),
  toStroke(ellipse(0.5, 0.5, 0.3, 0.12, Math.PI, 0), 70),
  toStroke(ellipse(0.5, 0.5, 0.12, 0.4, -Math.PI / 2, Math.PI / 2), 80),
]);

// ---- perspective-grid-1pt: 地平線・床のマス目（消失点へ向かう線＋横線）
{
  const vp = [0.5, 0.2];
  const s = [toStroke([[0.04, 0.2], [0.96, 0.2]], 80)];
  for (const x of [0.04, 0.27, 0.5, 0.73, 0.96]) s.push(toStroke([[x, 0.96], lerp([x, 0.96], vp, 0.62)], 50));
  for (const t of [0, 0.3, 0.5, 0.62]) {
    const a = lerp([0.04, 0.96], vp, t), b = lerp([0.96, 0.96], vp, t);
    s.push(toStroke([a, b], 60));
  }
  save('perspective-grid-1pt', s);
}

// ---- bean-torso: 胸郭の卵・骨盤の卵・くびれの2本・中心線
save('bean-torso', [
  toStroke(ellipse(0.5, 0.3, 0.17, 0.22), 110),
  toStroke(ellipse(0.5, 0.72, 0.15, 0.13), 90),
  toStroke(param((t) => [0.38 + 0.02 * Math.sin(t * Math.PI) - 0.03 * t, 0.43 + 0.2 * t], 0, 1), 40),
  toStroke(param((t) => [0.62 - 0.02 * Math.sin(t * Math.PI) + 0.03 * t, 0.43 + 0.2 * t], 0, 1), 40),
  toStroke([[0.5, 0.06], [0.5, 0.88]], 60),
]);
