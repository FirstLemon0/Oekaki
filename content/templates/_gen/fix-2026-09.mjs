// なぞりテンプレート生成スクリプト（2026-09 絵の先生レビューで作り直した分）
// 実行: node content/templates/_gen/fix-2026-09.mjs
// 出力: content/templates/<id>.json （Drawing 形式: [[{x,y,p,t},...], ...]、x,y は 0..1）
// 形式は gen.mjs と同じ（p 0.6、t 16ms 刻み、各ストローク 40〜120 点）。
// テンプレートは正方形の紙に等倍で置かれる（fitTemplate: x・y とも短辺×0.82 倍）ので、
// x と y の長さをそろえれば、画面でも正方形・真円になる。
//
// ここで作るテンプレート（simple-shapes / cube-1pt / face-outline-cross）は gen.mjs・gen-s2s3.mjs の
// 対象から外してある（あちらを再実行しても古い版に戻らないように）。
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

/** 2次ベジェ */
const quad = (p0, c, p1) =>
  param(
    (t) => [
      (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0],
      (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1],
    ],
    0,
    1,
  );

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

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

// ---- simple-shapes: 正方形（縦横同じ）・三角形・円（真円）
{
  const S = 0.24; // 正方形の一辺
  const x0 = 0.05;
  const y0 = 0.38;
  // 三角形：底辺 0.26、高さ 0.225（ほぼ正三角形）
  const tb = 0.26;
  const th = (tb * Math.sqrt(3)) / 2;
  const tcx = 0.5;
  const tyb = 0.5 + th / 2;
  save('simple-shapes', [
    toStroke([[x0, y0], [x0 + S, y0], [x0 + S, y0 + S], [x0, y0 + S], [x0, y0]], 96),
    toStroke([[tcx, tyb - th], [tcx + tb / 2, tyb], [tcx - tb / 2, tyb], [tcx, tyb - th]], 90),
    toStroke(ellipse(0.82, 0.5, 0.125, 0.125), 100),
  ]);
}

// ---- cube-1pt: 1点透視の立方体（正面の正方形 → 奥行き 3 本 → 奥の辺）
{
  // 正面は正方形。奥行きは消失点へ 0.3（正面の一辺の半分ほどの長さ）で、立方体らしい比率にする
  const vp = [0.86, 0.12];
  const S = 0.34;
  const F = [[0.14, 0.44], [0.14 + S, 0.44], [0.14 + S, 0.44 + S], [0.14, 0.44 + S]];
  const B = F.map((p) => lerp(p, vp, 0.3));
  const s = [toStroke([...F, F[0]], 120)];
  for (const i of [0, 1, 2]) s.push(toStroke([F[i], B[i]], 40));
  s.push(toStroke([B[0], B[1], B[2]], 80));
  save('cube-1pt', s);
}

// ---- face-outline-cross: 頭頂から左右 2 本の C カーブで輪郭 → 縦の中心線 → 目の高さの横線
{
  const F = { cx: 0.5, top: 0.1, eyeY: 0.52, chin: 0.9, hw: 0.24 };
  const cy = 0.46;
  const ry = cy - F.top;
  // 左の C：頭頂 → 左の頬 → あご先
  const left = [...ellipse(F.cx, cy, F.hw, ry, -Math.PI / 2, -Math.PI), ...quad([F.cx - F.hw, cy], [F.cx - F.hw * 0.95, 0.78], [F.cx, F.chin])];
  // 右の C：頭頂 → 右の頬 → あご先
  const right = [...ellipse(F.cx, cy, F.hw, ry, -Math.PI / 2, 0), ...quad([F.cx + F.hw, cy], [F.cx + F.hw * 0.95, 0.78], [F.cx, F.chin])];
  save('face-outline-cross', [
    toStroke(left, 100),
    toStroke(right, 100),
    toStroke([[F.cx, F.top - 0.02], [F.cx, F.chin + 0.03]], 60),
    toStroke(quad([F.cx - F.hw, F.eyeY], [F.cx, F.eyeY + 0.03], [F.cx + F.hw, F.eyeY]), 60),
  ]);
}
