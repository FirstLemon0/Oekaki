// なぞりテンプレート生成スクリプト（ステージ4・5・6）
// 実行: node content/templates/_gen/gen-s4s5s6.mjs
// 出力: content/templates/<id>.json （Drawing 形式: [[{x,y,p,t},...], ...]、x,y は 0..1）
// 形式・ヘルパーは gen.mjs と同じ（gen.mjs は import 時に全出力するため、ここへ複製している）。
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
  for (const s of strokes) {
    if (s.length < 40 || s.length > 120) throw new Error(`${id}: 点数 ${s.length}`);
    for (const { x, y } of s) if (x < 0 || x > 1 || y < 0 || y > 1) throw new Error(`${id}: 範囲外 ${x},${y}`);
  }
  writeFileSync(join(OUT, `${id}.json`), JSON.stringify(strokes) + '\n');
  console.log(id, strokes.length, 'strokes');
}

/* ================================================================== */
/* ステージ4 顔と頭部                                                   */
/* ================================================================== */

// ---- s4-loomis-head-front: 球 → 眉の線 → 縦の中心線 → 鼻の線 → あご（左右）
{
  const cx = 0.5;
  const cy = 0.38;
  const r = 0.26;
  save('s4-loomis-head-front', [
    toStroke(ellipse(cx, cy, r, r), 120),
    toStroke(quad([cx - r, cy], [cx, cy + 0.03], [cx + r, cy]), 60),
    toStroke(poly([cx, cy - r - 0.02], [cx, 0.93]), 70),
    toStroke(poly([cx - 0.09, cy + r], [cx + 0.09, cy + r]), 40),
    toStroke(quad([cx - r * 0.82, cy + 0.14], [cx - r * 0.72, 0.82], [cx, 0.9]), 60),
    toStroke(quad([cx + r * 0.82, cy + 0.14], [cx + r * 0.72, 0.82], [cx, 0.9]), 60),
  ]);
}

// ---- s4-loomis-head-34: 球 → 側面の切り落とし → 曲面に沿う中心線 → 眉の線 → 鼻の線 → あご（奥・手前）
{
  const cx = 0.48;
  const cy = 0.38;
  const r = 0.26;
  save('s4-loomis-head-34', [
    toStroke(ellipse(cx, cy, r, r), 120),
    toStroke(ellipse(0.62, 0.4, 0.085, 0.17), 80),
    toStroke([...quad([0.43, cy - r + 0.005], [0.31, 0.38], [0.39, cy + r]), ...quad([0.39, cy + r], [0.4, 0.8], [0.42, 0.9])], 90),
    toStroke(quad([cx - r + 0.01, 0.35], [0.38, 0.43], [0.62, 0.4]), 60),
    toStroke(quad([0.33, cy + r], [0.39, cy + r + 0.012], [0.45, cy + r]), 40),
    toStroke(quad([0.66, 0.56], [0.63, 0.84], [0.42, 0.9]), 60),
    toStroke(quad([0.26, 0.5], [0.28, 0.8], [0.42, 0.9]), 56),
  ]);
}

// ---- s4-eye-pair-34: 3/4 向きの両目（手前は幅広、遠い目は幅が狭い）＋顔の中心線
{
  const strokes = [];
  const eyes = [
    { ex: 0.33, w: 0.15, iw: 0.065 }, // 手前の目
    { ex: 0.72, w: 0.085, iw: 0.04 }, // 遠い目（幅が狭い）
  ];
  const ey = 0.5;
  for (const [i, { ex, w, iw }] of eyes.entries()) {
    // 手前の目は目頭が右（中心線側）、遠い目は目頭が左（中心線側）
    const s = i === 0 ? 1 : -1;
    const inner = ex + s * w * 0.8;
    const outer = ex - s * w;
    strokes.push(
      toStroke(
        [
          ...quad([inner, ey - 0.06], [ex, ey - 0.19], [outer, ey - 0.08]),
          ...quad([outer, ey - 0.08], [outer - s * 0.02, ey - 0.06], [outer - s * 0.025, ey - 0.03]),
        ],
        90,
      ),
    );
    strokes.push(toStroke(quad([ex + s * w * 0.4, ey + 0.15], [ex - s * w * 0.3, ey + 0.17], [outer + s * 0.02, ey + 0.12]), 44));
    strokes.push(toStroke(ellipse(ex, ey + 0.03, iw, 0.11), 80));
    strokes.push(toStroke(ellipse(ex - iw * 0.35, ey - 0.02, 0.016, 0.024), 40));
  }
  // 顔の中心線（両目の間。遠い目の側に寄る）
  strokes.push(toStroke(quad([0.6, 0.15], [0.56, 0.5], [0.6, 0.85]), 60));
  save('s4-eye-pair-34', strokes);
}

// ---- s4-expressions-3: 喜び・怒り・驚き の簡略顔3つ
{
  const strokes = [];
  const R = 0.13;
  const faces = [
    { cx: 0.18, kind: 'joy' },
    { cx: 0.5, kind: 'anger' },
    { cx: 0.82, kind: 'surprise' },
  ];
  const cy = 0.5;
  for (const { cx, kind } of faces) {
    strokes.push(toStroke(ellipse(cx, cy, R, R * 1.15), 100));
    for (const s of [-1, 1]) {
      const bx = cx + s * 0.055;
      const by = cy - 0.06;
      // 眉
      if (kind === 'joy') strokes.push(toStroke(quad([bx - 0.025, by], [bx, by - 0.02], [bx + 0.025, by]), 40));
      if (kind === 'anger') strokes.push(toStroke(poly([bx + s * 0.03, by - 0.025], [bx - s * 0.025, by + 0.01]), 40));
      if (kind === 'surprise') strokes.push(toStroke(quad([bx - 0.025, by - 0.02], [bx, by - 0.05], [bx + 0.025, by - 0.02]), 40));
      // 目
      const ey = cy + 0.005;
      if (kind === 'joy') strokes.push(toStroke(quad([bx - 0.022, ey + 0.008], [bx, ey - 0.02], [bx + 0.022, ey + 0.008]), 40));
      if (kind === 'anger') strokes.push(toStroke(ellipse(bx, ey + 0.005, 0.014, 0.018), 40));
      if (kind === 'surprise') strokes.push(toStroke(ellipse(bx, ey, 0.018, 0.026), 40));
    }
    // 口
    const my = cy + 0.075;
    if (kind === 'joy') strokes.push(toStroke(quad([cx - 0.045, my - 0.01], [cx, my + 0.05], [cx + 0.045, my - 0.01]), 50));
    if (kind === 'anger') strokes.push(toStroke(quad([cx - 0.035, my + 0.015], [cx, my - 0.015], [cx + 0.035, my + 0.015]), 44));
    if (kind === 'surprise') strokes.push(toStroke(ellipse(cx, my + 0.01, 0.018, 0.026), 44));
  }
  save('s4-expressions-3', strokes);
}

/* ================================================================== */
/* ステージ5 体と手足                                                   */
/* ================================================================== */

// ---- s5-hand-open: 開いた手（手のひらの箱 → 指の付け根の弧 → 指4本の円柱 → 親指）
{
  const strokes = [];
  strokes.push(toStroke(poly([0.36, 0.52], [0.66, 0.5], [0.66, 0.82], [0.4, 0.86], [0.36, 0.52]), 110));
  strokes.push(toStroke(quad([0.36, 0.52], [0.51, 0.44], [0.66, 0.5]), 50));
  // 付け根の弧上の点（2次ベジェを t で評価）
  const knuckle = (t) => [
    (1 - t) ** 2 * 0.36 + 2 * (1 - t) * t * 0.51 + t * t * 0.66,
    (1 - t) ** 2 * 0.52 + 2 * (1 - t) * t * 0.44 + t * t * 0.5,
  ];
  const fingers = [
    { t: 0.12, len: 0.22, ang: -0.2 },
    { t: 0.38, len: 0.29, ang: -0.06 },
    { t: 0.63, len: 0.27, ang: 0.06 },
    { t: 0.88, len: 0.2, ang: 0.2 },
  ];
  for (const { t, len, ang } of fingers) {
    const [x, by] = knuckle(t);
    const w = 0.03;
    const dx = Math.sin(ang);
    const dy = -Math.cos(ang);
    const nx = Math.cos(ang);
    const ny = Math.sin(ang);
    const a = [x - nx * w, by - ny * w];
    const b = [x - nx * w + dx * len, by - ny * w + dy * len];
    const c = [x + nx * w + dx * len, by + ny * w + dy * len];
    const d = [x + nx * w, by + ny * w];
    const tip = [x + dx * (len + w * 1.3), by + dy * (len + w * 1.3)];
    strokes.push(toStroke([...poly(a, b), ...quad(b, tip, c), ...poly(c, d)], 90));
  }
  strokes.push(
    toStroke(
      [...quad([0.4, 0.84], [0.28, 0.76], [0.2, 0.62]), ...quad([0.2, 0.62], [0.18, 0.55], [0.24, 0.56]), ...quad([0.24, 0.56], [0.3, 0.62], [0.37, 0.64])],
      100,
    ),
  );
  save('s5-hand-open', strokes);
}

// ---- s5-foot-side: 横から見た足（すね → かかと〜足裏〜つま先〜甲 → くさびのアタリ → くるぶし）
save('s5-foot-side', [
  toStroke(poly([0.42, 0.08], [0.42, 0.55]), 50),
  toStroke(poly([0.28, 0.08], [0.3, 0.58]), 50),
  toStroke(
    [
      ...quad([0.3, 0.58], [0.2, 0.66], [0.24, 0.8]),
      ...poly([0.24, 0.8], [0.8, 0.82]),
      ...quad([0.8, 0.82], [0.86, 0.8], [0.84, 0.75]),
      ...quad([0.84, 0.75], [0.62, 0.68], [0.42, 0.55]),
    ],
    120,
  ),
  toStroke(poly([0.34, 0.6], [0.24, 0.8], [0.82, 0.8], [0.34, 0.6]), 100),
  toStroke(ellipse(0.36, 0.57, 0.025, 0.03), 40),
]);

// ---- s5-torso-box: 胸郭の箱 → 骨盤の箱 → 背骨のS字
{
  const box = (x, y, w, h, dx, dy) => [
    toStroke(poly([x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]), 100),
    toStroke(poly([x + w, y], [x + w + dx, y - dy], [x + w + dx, y + h - dy], [x + w, y + h]), 80),
    toStroke(poly([x, y], [x + dx, y - dy], [x + w + dx, y - dy]), 70),
  ];
  save('s5-torso-box', [
    ...box(0.3, 0.14, 0.32, 0.3, 0.1, 0.06),
    ...box(0.33, 0.62, 0.28, 0.2, 0.09, 0.05),
    toStroke([...quad([0.47, 0.44], [0.43, 0.5], [0.46, 0.55]), ...quad([0.46, 0.55], [0.49, 0.59], [0.47, 0.62])], 50),
  ]);
}

/* ================================================================== */
/* ステージ6 服と小物                                                   */
/* ================================================================== */

// ---- s6-fold-tshirt: Tシャツの外形 → 脇・袖の付け根から出るシワ → 裾のたるみ
save('s6-fold-tshirt', [
  toStroke(quad([0.41, 0.14], [0.5, 0.24], [0.59, 0.14]), 50),
  toStroke(
    poly(
      [0.41, 0.14],
      [0.28, 0.18],
      [0.12, 0.34],
      [0.2, 0.44],
      [0.3, 0.38],
      [0.31, 0.86],
      [0.69, 0.86],
      [0.7, 0.38],
      [0.8, 0.44],
      [0.88, 0.34],
      [0.72, 0.18],
      [0.59, 0.14],
    ),
    120,
  ),
  toStroke(quad([0.31, 0.4], [0.37, 0.46], [0.43, 0.48]), 40),
  toStroke(quad([0.31, 0.46], [0.36, 0.54], [0.41, 0.58]), 40),
  toStroke(quad([0.69, 0.4], [0.63, 0.46], [0.57, 0.48]), 40),
  toStroke(quad([0.69, 0.46], [0.64, 0.54], [0.59, 0.58]), 40),
  toStroke(quad([0.26, 0.24], [0.24, 0.31], [0.26, 0.38]), 40),
  toStroke(quad([0.74, 0.24], [0.76, 0.31], [0.74, 0.38]), 40),
  toStroke(quad([0.4, 0.86], [0.43, 0.78], [0.47, 0.74]), 40),
]);
