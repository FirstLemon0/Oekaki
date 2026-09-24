// なぞりテンプレート生成スクリプト
// 実行: node content/templates/_gen/gen.mjs
// 出力: content/templates/<id>.json （Drawing 形式: [[{x,y,p,t},...], ...]、x,y は 0..1）
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

/** パラメトリック曲線 f(t), t∈[t0,t1] を細かくサンプル */
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

const poly = (...pts) => pts;

function toStroke(pts, n) {
  const r = (v) => Math.round(v * 10000) / 10000;
  return resample(pts, n).map(([x, y], i) => ({ x: r(x), y: r(y), p: 0.6, t: i * 16 }));
}

function save(id, strokes) {
  for (const s of strokes) if (s.length < 40 || s.length > 120) throw new Error(`${id}: 点数 ${s.length}`);
  writeFileSync(join(OUT, `${id}.json`), JSON.stringify(strokes) + '\n');
  console.log(id, strokes.length, 'strokes');
}

// simple-shapes → fix-2026-09.mjs で生成（2026-09 絵の先生レビューで作り直し。ここで再生成すると古い版に戻るので外した）

// ---- leaf-silhouette: 葉の輪郭（左右の弧）＋葉脈＋葉柄
save('leaf-silhouette', [
  toStroke(quad([0.5, 0.12], [0.22, 0.45], [0.5, 0.82]), 90),
  toStroke(quad([0.5, 0.12], [0.78, 0.45], [0.5, 0.82]), 90),
  toStroke(poly([0.5, 0.2], [0.5, 0.94]), 60),
  toStroke(quad([0.5, 0.4], [0.42, 0.33], [0.37, 0.3]), 40),
  toStroke(quad([0.5, 0.52], [0.58, 0.45], [0.63, 0.42]), 40),
  toStroke(quad([0.5, 0.64], [0.42, 0.57], [0.39, 0.54]), 40),
]);

// ---- flower-silhouette: 5枚の花びら＋中心＋茎＋葉
{
  const cx = 0.5;
  const cy = 0.4;
  const strokes = [];
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + (k * TAU) / 5;
    const w = (TAU / 10) * 0.9;
    const R = 0.26;
    const r0 = 0.07;
    const p0 = [cx + r0 * Math.cos(a - w), cy + r0 * Math.sin(a - w)];
    const p1 = [cx + r0 * Math.cos(a + w), cy + r0 * Math.sin(a + w)];
    const tip = [cx + R * Math.cos(a), cy + R * Math.sin(a)];
    const c0 = [cx + R * 0.9 * Math.cos(a - w * 1.1), cy + R * 0.9 * Math.sin(a - w * 1.1)];
    const c1 = [cx + R * 0.9 * Math.cos(a + w * 1.1), cy + R * 0.9 * Math.sin(a + w * 1.1)];
    strokes.push(toStroke([...quad(p0, c0, tip), ...quad(tip, c1, p1)], 80));
  }
  strokes.push(toStroke(ellipse(cx, cy, 0.06, 0.06), 48));
  strokes.push(toStroke(quad([0.5, 0.63], [0.47, 0.8], [0.5, 0.97]), 50));
  strokes.push(toStroke(quad([0.49, 0.84], [0.4, 0.76], [0.33, 0.78]), 40));
  save('flower-silhouette', strokes);
}

// ---- 顔の共通寸法（正面顔）
const F = { cx: 0.5, top: 0.1, eyeY: 0.52, chin: 0.9, hw: 0.24 };
function faceOutline() {
  const cy = 0.46;
  const ry = cy - F.top;
  const upper = ellipse(F.cx, cy, F.hw, ry, Math.PI, TAU); // 左→頭頂→右
  const rightJaw = quad([F.cx + F.hw, cy], [F.cx + F.hw * 0.95, 0.78], [F.cx, F.chin]);
  const leftJaw = quad([F.cx, F.chin], [F.cx - F.hw * 0.95, 0.78], [F.cx - F.hw, cy]);
  return [...upper, ...rightJaw, ...leftJaw];
}

// face-outline-cross → fix-2026-09.mjs で生成（2026-09 絵の先生レビューで作り直し。頭頂から左右 2 本の C カーブで描く順に変更）

// ---- anime-eye-pair: 左右の目（上まぶた・下まぶた・虹彩・瞳孔・ハイライト）
{
  const strokes = [];
  for (const side of [-1, 1]) {
    const ex = 0.5 + side * 0.2;
    const ey = 0.5;
    const outer = ex + side * 0.12;
    const inner = ex - side * 0.1;
    strokes.push(
      toStroke(
        [
          ...quad([inner, ey - 0.06], [ex, ey - 0.2], [outer, ey - 0.08]),
          ...quad([outer, ey - 0.08], [outer + side * 0.02, ey - 0.06], [outer + side * 0.025, ey - 0.03]),
        ],
        90,
      ),
    );
    strokes.push(toStroke(quad([ex - side * 0.05, ey + 0.15], [ex + side * 0.03, ey + 0.17], [outer - side * 0.02, ey + 0.12]), 44));
    strokes.push(toStroke(ellipse(ex, ey + 0.03, 0.065, 0.11), 90));
    strokes.push(toStroke(ellipse(ex, ey + 0.05, 0.028, 0.05), 50));
    strokes.push(toStroke(ellipse(ex - 0.025, ey - 0.02, 0.018, 0.024), 40));
  }
  save('anime-eye-pair', strokes);
}

// ---- nose-mouth-brow: 眉2本・鼻（くの字）・口
save('nose-mouth-brow', [
  toStroke(quad([0.26, 0.24], [0.33, 0.17], [0.42, 0.21]), 56),
  toStroke(quad([0.74, 0.24], [0.67, 0.17], [0.58, 0.21]), 56),
  toStroke(poly([0.505, 0.44], [0.485, 0.56], [0.51, 0.575]), 44),
  toStroke(quad([0.42, 0.76], [0.5, 0.8], [0.58, 0.76]), 56),
]);

// ---- hair-mass: 頭の外形・前髪の塊・サイドの塊
{
  const strokes = [];
  strokes.push(
    toStroke(
      [
        ...quad([0.22, 0.82], [0.14, 0.45], [0.3, 0.2]),
        ...quad([0.3, 0.2], [0.5, 0.02], [0.7, 0.2]),
        ...quad([0.7, 0.2], [0.86, 0.45], [0.78, 0.82]),
      ],
      120,
    ),
  );
  strokes.push(toStroke([...quad([0.3, 0.3], [0.33, 0.42], [0.36, 0.5]), ...quad([0.36, 0.5], [0.41, 0.4], [0.45, 0.33])], 70));
  strokes.push(toStroke([...quad([0.45, 0.33], [0.48, 0.44], [0.52, 0.52]), ...quad([0.52, 0.52], [0.56, 0.42], [0.59, 0.33])], 70));
  strokes.push(toStroke([...quad([0.59, 0.33], [0.62, 0.43], [0.65, 0.49]), ...quad([0.65, 0.49], [0.68, 0.4], [0.7, 0.3])], 70));
  strokes.push(toStroke(quad([0.3, 0.42], [0.27, 0.62], [0.3, 0.8]), 50));
  strokes.push(toStroke(quad([0.7, 0.42], [0.73, 0.62], [0.7, 0.8]), 50));
  save('hair-mass', strokes);
}
