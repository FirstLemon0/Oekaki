// ステージ7〜10 用の生成スクリプト（なぞりテンプレート＋図解 SVG）
// 実行: node content/templates/_gen/gen-s7s10.mjs
// 出力:
//   content/templates/s7-*.json, s8-*.json（Drawing 形式: [[{x,y,p,t},...], ...]、x,y は 0..1）
//   content/figures/s7-*.svg 〜 s10-*.svg（viewBox 800×500、線は currentColor、強調は #7BB661。色の図解のみ実色 fill）
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TPL_OUT = join(HERE, '..');
const FIG_OUT = join(HERE, '..', '..', 'figures');
const TAU = Math.PI * 2;

/* ================================================================== */
/* なぞりテンプレート                                                   */
/* ================================================================== */

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
function param(fn, t0, t1, fine = 400) {
  const pts = [];
  for (let i = 0; i <= fine; i++) pts.push(fn(t0 + ((t1 - t0) * i) / fine));
  return pts;
}
const ellipseT = (cx, cy, rx, ry, a0 = -Math.PI / 2, a1 = a0 + TAU) => param((a) => [cx + rx * Math.cos(a), cy + ry * Math.sin(a)], a0, a1);
const quadT = (p0, c, p1) =>
  param((t) => [(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1]], 0, 1);
const poly = (...pts) => pts;

/** p は入り抜き（両端 0.2 → 中央 0.9）を持たせる。線の強弱のお手本用 */
function toStroke(pts, n, taper = false) {
  const r = (v) => Math.round(v * 10000) / 10000;
  return resample(pts, n).map(([x, y], i) => ({
    x: r(x),
    y: r(y),
    p: taper ? r(0.2 + 0.7 * Math.sin((Math.PI * i) / (n - 1))) : 0.6,
    t: i * 16,
  }));
}
function saveTpl(id, strokes) {
  if (!/^s(7|8|9|10)-/.test(id)) throw new Error(`接頭辞: ${id}`);
  for (const s of strokes) if (s.length < 40 || s.length > 120) throw new Error(`${id}: 点数 ${s.length}`);
  writeFileSync(join(TPL_OUT, `${id}.json`), JSON.stringify(strokes) + '\n');
  console.log('template', id, strokes.length, 'strokes');
}

// ---- s7-line-weight-sample: バストアップの簡単な線画（輪郭・髪・首・肩＋内側の線）
{
  const cx = 0.5;
  const face = [
    ...quadT([cx - 0.17, 0.4], [cx - 0.18, 0.13], [cx, 0.12]),
    ...quadT([cx, 0.12], [cx + 0.18, 0.13], [cx + 0.17, 0.4]),
    ...quadT([cx + 0.17, 0.4], [cx + 0.15, 0.56], [cx, 0.64]),
    ...quadT([cx, 0.64], [cx - 0.15, 0.56], [cx - 0.17, 0.4]),
  ];
  saveTpl('s7-line-weight-sample', [
    toStroke(face, 120, true),
    toStroke(quadT([cx - 0.2, 0.44], [cx - 0.24, 0.04], [cx, 0.05]), 80, true),
    toStroke(quadT([cx, 0.05], [cx + 0.24, 0.04], [cx + 0.2, 0.44]), 80, true),
    toStroke(poly([cx - 0.12, 0.2], [cx - 0.07, 0.31], [cx - 0.02, 0.19], [cx + 0.04, 0.31], [cx + 0.1, 0.2]), 70, true),
    toStroke(poly([cx - 0.05, 0.62], [cx - 0.06, 0.74]), 40, true),
    toStroke(poly([cx + 0.05, 0.62], [cx + 0.06, 0.74]), 40, true),
    toStroke(quadT([cx - 0.06, 0.74], [cx - 0.3, 0.76], [cx - 0.38, 0.95]), 70, true),
    toStroke(quadT([cx + 0.06, 0.74], [cx + 0.3, 0.76], [cx + 0.38, 0.95]), 70, true),
    toStroke(quadT([cx - 0.1, 0.8], [cx, 0.86], [cx + 0.1, 0.8]), 50, true),
  ]);
}

// ---- s7-clean-curves: 一筆で引く長めの曲線（C・S・髪の毛束）
saveTpl('s7-clean-curves', [
  toStroke(quadT([0.1, 0.25], [0.5, 0.02], [0.9, 0.25]), 100, true),
  toStroke([...quadT([0.1, 0.55], [0.3, 0.35], [0.5, 0.55]), ...quadT([0.5, 0.55], [0.7, 0.75], [0.9, 0.55])], 110, true),
  toStroke(quadT([0.2, 0.95], [0.25, 0.7], [0.45, 0.68]), 70, true),
  toStroke(quadT([0.55, 0.95], [0.6, 0.72], [0.8, 0.7]), 70, true),
]);

// ---- s8-thumbnail-frames: 小さな枠 10 個（2 段 × 5 列）
{
  const strokes = [];
  const w = 0.16;
  const h = 0.36;
  for (let k = 0; k < 10; k++) {
    const x = 0.03 + (k % 5) * 0.195;
    const y = 0.06 + Math.floor(k / 5) * 0.48;
    strokes.push(toStroke(poly([x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]), 60));
  }
  saveTpl('s8-thumbnail-frames', strokes);
}

// ---- s8-room-corner-guide: 室内の一角（部屋の角・床と壁の境目・窓）
// s8-room-corner-guide（2点透視） → tools/gen-review-figures.mjs で生成（2026-09 教材レビューで作り直し。ここで再生成すると古い版に戻るので外した）

/* ================================================================== */
/* 図解 SVG                                                            */
/* ================================================================== */

const G = '#7BB661';
const f = (n) => Math.round(n * 10) / 10;
const made = [];
function svg(id, body) {
  if (!/^s(7|8|9|10)-/.test(id)) throw new Error(`接頭辞: ${id}`);
  const s =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" font-family="Zen Kaku Gothic New, sans-serif">\n` +
    body.flat(Infinity).filter(Boolean).map((l) => '  ' + l).join('\n') +
    '\n</svg>\n';
  writeFileSync(join(FIG_OUT, `${id}.svg`), s);
  made.push(id);
}
const flat = (x) => [x].flat(Infinity).filter(Boolean).join('');
const attrs = (o = {}) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('');
const line = (x1, y1, x2, y2, o) => `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"${attrs(o)}/>`;
const path = (d, o) => `<path d="${d}"${attrs(o)}/>`;
const circle = (cx, cy, r, o) => `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}"${attrs(o)}/>`;
const ell = (cx, cy, rx, ry, o) => `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}"${attrs(o)}/>`;
const rect = (x, y, w, h, o) => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"${attrs(o)}/>`;
const text = (x, y, s, o = {}) =>
  `<text x="${f(x)}" y="${f(y)}" font-size="${o.size ?? 20}" fill="${o.color ?? 'currentColor'}" stroke="none" text-anchor="${o.anchor ?? 'middle'}"${o.weight ? ` font-weight="${o.weight}"` : ''}>${s}</text>`;
function arrow(x1, y1, x2, y2, o = {}) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const h = o.head ?? 14;
  const p1 = [x2 - h * Math.cos(a - 0.45), y2 - h * Math.sin(a - 0.45)];
  const p2 = [x2 - h * Math.cos(a + 0.45), y2 - h * Math.sin(a + 0.45)];
  return [
    line(x1, y1, x2, y2, { stroke: o.color, 'stroke-width': o.width, 'stroke-dasharray': o.dash }),
    path(`M${f(p1[0])},${f(p1[1])} L${f(x2)},${f(y2)} L${f(p2[0])},${f(p2[1])}`, { stroke: o.color, 'stroke-width': o.width }),
  ];
}
const num = (x, y, n, color = 'currentColor') => [
  circle(x, y, 15, { stroke: color, 'stroke-width': 2 }),
  text(x, y + 7, String(n), { size: 18, color }),
];
const title = (s) => text(400, 482, s, { size: 19 });

/** 入り抜きのある線（塗りつぶしの帯）。shape(t) で幅を指定、既定は細→太→細 */
function taper(pts, w0, w1, o = {}) {
  const n = pts.length;
  const L = [];
  const R = [];
  for (let i = 0; i < n; i++) {
    const p = pts[Math.max(0, i - 1)];
    const q = pts[Math.min(n - 1, i + 1)];
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const d = Math.hypot(dx, dy) || 1;
    const t = i / (n - 1);
    const w = (o.shape ? o.shape(t) : w0 + (w1 - w0) * Math.sin(Math.PI * t)) / 2;
    L.push([pts[i][0] - (dy / d) * w, pts[i][1] + (dx / d) * w]);
    R.push([pts[i][0] + (dy / d) * w, pts[i][1] - (dx / d) * w]);
  }
  const all = [...L, ...R.reverse()];
  return path('M' + all.map(([x, y]) => `${f(x)},${f(y)}`).join(' L') + ' Z', { fill: o.color ?? 'currentColor', stroke: 'none' });
}
const qpts = (p0, c, p1, n = 30) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    return [(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1]];
  });
const arcPts = (cx, cy, r, a0, a1, n = 40) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });

/** 簡易バストアップ（線画）。cx,cy=頭の中心, s=倍率 */
function bust(cx, cy, s = 1, o = {}) {
  const st = { stroke: o.color, 'stroke-width': o.width, opacity: o.opacity, 'stroke-dasharray': o.dash };
  const X = (v) => f(cx + v * s);
  const Y = (v) => f(cy + v * s);
  return [
    path(`M${X(-38)},${Y(-8)} Q${X(-40)},${Y(-52)} ${X(0)},${Y(-54)} Q${X(40)},${Y(-52)} ${X(38)},${Y(-8)} Q${X(34)},${Y(28)} ${X(0)},${Y(44)} Q${X(-34)},${Y(28)} ${X(-38)},${Y(-8)} Z`, st),
    path(
      `M${X(-42)},${Y(-4)} Q${X(-50)},${Y(-62)} ${X(0)},${Y(-66)} Q${X(50)},${Y(-62)} ${X(42)},${Y(-4)} M${X(-30)},${Y(-40)} L${X(-18)},${Y(-18)} L${X(-8)},${Y(-36)} L${X(4)},${Y(-16)} L${X(14)},${Y(-38)} L${X(24)},${Y(-18)} L${X(32)},${Y(-36)}`,
      st,
    ),
    path(
      `M${X(-12)},${Y(40)} L${X(-14)},${Y(62)} M${X(12)},${Y(40)} L${X(14)},${Y(62)} M${X(-14)},${Y(62)} Q${X(-60)},${Y(66)} ${X(-80)},${Y(100)} M${X(14)},${Y(62)} Q${X(60)},${Y(66)} ${X(80)},${Y(100)}`,
      st,
    ),
    o.face === false ? null : path(`M${X(-20)},${Y(0)} l${f(10 * s)},0 M${X(10)},${Y(0)} l${f(10 * s)},0 M${X(-5)},${Y(24)} l${f(10 * s)},0`, st),
  ];
}
/** 塗りつきバスト（色の図解用） */
function colorBust(cx, cy, s, c) {
  const X = (v) => f(cx + v * s);
  const Y = (v) => f(cy + v * s);
  return [
    path(`M${X(-85)},${Y(110)} Q${X(-70)},${Y(64)} ${X(-14)},${Y(58)} L${X(14)},${Y(58)} Q${X(70)},${Y(64)} ${X(85)},${Y(110)} Z`, { fill: c.cloth, stroke: 'none' }),
    path(`M${X(-12)},${Y(36)} L${X(-14)},${Y(62)} L${X(14)},${Y(62)} L${X(12)},${Y(36)} Z`, { fill: c.skin, stroke: 'none' }),
    path(
      `M${X(-38)},${Y(-8)} Q${X(-40)},${Y(-52)} ${X(0)},${Y(-54)} Q${X(40)},${Y(-52)} ${X(38)},${Y(-8)} Q${X(34)},${Y(28)} ${X(0)},${Y(44)} Q${X(-34)},${Y(28)} ${X(-38)},${Y(-8)} Z`,
      { fill: c.skin, stroke: 'none' },
    ),
    path(
      `M${X(-44)},${Y(30)} Q${X(-54)},${Y(-64)} ${X(0)},${Y(-68)} Q${X(54)},${Y(-64)} ${X(44)},${Y(30)} L${X(36)},${Y(-10)} L${X(28)},${Y(-36)} L${X(18)},${Y(-18)} L${X(6)},${Y(-38)} L${X(-6)},${Y(-16)} L${X(-18)},${Y(-38)} L${X(-28)},${Y(-14)} L${X(-36)},${Y(-10)} Z`,
      { fill: c.hair, stroke: 'none' },
    ),
    c.eye
      ? [ell(cx - 16 * s, cy + 2 * s, 5 * s, 7 * s, { fill: c.eye, stroke: 'none' }), ell(cx + 16 * s, cy + 2 * s, 5 * s, 7 * s, { fill: c.eye, stroke: 'none' })]
      : null,
  ];
}
const inkBust = (cx, cy, s, c) => [colorBust(cx, cy, s, c), bust(cx, cy, s, { face: false })];
const panel = (x, y, w, h, label, o = {}) => [
  rect(x, y, w, h, { rx: 6, stroke: o.color, 'stroke-width': o.width ?? 2 }),
  label ? text(x + w / 2, y + h + 28, label, { size: o.size ?? 19, color: o.labelColor }) : null,
];
const frame = (x, y, w, h, o = {}) => rect(x, y, w, h, { rx: 4, 'stroke-width': o.width ?? 2.5, stroke: o.color });
const hsl = (h, s, l) => `hsl(${h},${s}%,${l}%)`;
const BASE = { skin: '#F6D7C3', hair: '#5A4A78', cloth: '#4F7FB8', eye: '#3A6EA5' };
const sun = (x, y, c = G) => [
  circle(x, y, 22, { stroke: c, 'stroke-width': 3 }),
  [0, 1, 2, 3, 4, 5, 6, 7].map((k) => {
    const a = (k * Math.PI) / 4;
    return line(x + 30 * Math.cos(a), y + 30 * Math.sin(a), x + 42 * Math.cos(a), y + 42 * Math.sin(a), { stroke: c, 'stroke-width': 3 });
  }),
];

/** 左上光源の球。colors=[ベタ, 1影, 2影?]。clipPath で影を「欠けた円」として描く */
let ballSeq = 0;
function shadedBall(cx, cy, r, colors, o = {}) {
  const id = `${o.idPrefix}-ball${++ballSeq}`;
  const [base, s1, s2] = colors;
  const inner = [
    circle(cx, cy, r, { fill: s2 ?? s1 ?? base, stroke: 'none' }),
    s2 ? circle(cx - r * 0.12, cy - r * 0.12, r * 1.02, { fill: s1, stroke: 'none' }) : null,
    s1 ? circle(cx - r * 0.34, cy - r * 0.34, r * 1.05, { fill: base, stroke: 'none' }) : null,
  ];
  return [
    `<clipPath id="${id}"><circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}"/></clipPath>`,
    `<g clip-path="url(#${id})"${o.filter ? ` filter="${o.filter}"` : ''}${o.opacity ? ` opacity="${o.opacity}"` : ''}>${flat(inner)}</g>`,
  ];
}

// ============================================================ ステージ7
svg('s7-app-choice', [
  [
    ['ibisPaint X', '無料（広告あり）', 'タブレットで軽い', 'はじめてでも迷いにくい'],
    ['CLIP STUDIO PAINT', '有料（無料期間あり）', '3Dデッサン人形', '線画・漫画に強い'],
    ['Krita', '無料', 'PC・Android', '厚塗りに強い'],
  ].map((a, i) => {
    const x = 40 + i * 250;
    return [
      panel(x, 70, 220, 290, null),
      text(x + 110, 115, a[0], { size: 21, weight: 700 }),
      line(x + 20, 135, x + 200, 135, { opacity: 0.4 }),
      a.slice(1).map((t, k) => text(x + 110, 185 + k * 50, t, { size: 18 })),
    ];
  }),
  text(400, 410, 'どれを選んでも、ステージ7〜10は同じ手順で進められます', { size: 20, color: G }),
  title('迷ったら「今の端末に入れやすいもの」を1つ'),
]);
svg('s7-layers', [
  [['線画', G], ['下描き'], ['ラフ'], ['用紙（白）']].map(([n, c], i) => {
    const y = 60 + i * 95;
    return [
      path(`M220,${y + 60} L320,${y} L620,${y} L520,${y + 60} Z`, { stroke: c, 'stroke-width': c ? 3 : 2, opacity: i === 3 ? 0.6 : undefined }),
      text(660, y + 38, n, { size: 21, anchor: 'start', color: c }),
    ];
  }),
  arrow(120, 360, 120, 70, { width: 2 }),
  text(120, 390, '上ほど手前', { size: 17 }),
  title('透明なシートを重ねるイメージ。上のレイヤーが手前に見える'),
]);
{
  const wob = [];
  const smooth = [];
  for (let i = 0; i <= 60; i++) {
    const x = 80 + i * 5;
    const jit = i % 2 ? 7 : -6;
    wob.push(`${f(x)},${f(170 - 50 * Math.sin((i / 60) * Math.PI) + jit * (i % 3 ? 1 : 0.4))}`);
    smooth.push(`${f(x + 360)},${f(170 - 50 * Math.sin((i / 60) * Math.PI))}`);
  }
  svg('s7-brush-stabilizer', [
    path('M' + wob.join(' L')),
    text(230, 250, '補正なし：手の震えがそのまま', { size: 18 }),
    arrow(385, 150, 425, 150, { color: G, width: 3 }),
    path('M' + smooth.join(' L'), { stroke: G, 'stroke-width': 3 }),
    text(590, 250, '補正あり：なめらかに', { size: 18, color: G }),
    line(80, 320, 720, 320, { opacity: 0.4 }),
    [0, 1, 2].map((k) => circle(160 + k * 240, 320, 9, { fill: k === 1 ? G : 'none', stroke: k === 1 ? G : undefined })),
    text(160, 360, '弱：線が素直', { size: 17 }),
    text(400, 360, '中：まずはここから', { size: 17, color: G }),
    text(640, 360, '強：線が遅れてついてくる', { size: 17 }),
    text(400, 420, '例：ibisPaint・CLIP STUDIO「手ブレ補正」／Krita「ブラシのスムージング」', { size: 16 }),
    title('手ブレ補正は「補助輪」。遠慮なく使ってOK'),
  ]);
}
{
  const mann = (cx, top, s, o = {}) => {
    const P = (x, y) => [cx + x * s, top + y * s];
    const j = {
      head: P(0, 20), neck: P(0, 44), chest: P(0, 80), hip: P(0, 140), ls: P(-30, 56), rs: P(30, 56), le: P(-44, 104), re: P(38, 100),
      lh: P(-46, 150), rh: P(58, 70), lk: P(-18, 200), rk: P(20, 200), lf: P(-24, 260), rf: P(28, 260), lhip: P(-16, 146), rhip: P(16, 146),
    };
    const b = [['neck', 'chest'], ['chest', 'hip'], ['ls', 'rs'], ['ls', 'le'], ['le', 'lh'], ['rs', 're'], ['re', 'rh'], ['lhip', 'rhip'], ['lhip', 'lk'], ['lk', 'lf'], ['rhip', 'rk'], ['rk', 'rf']];
    return [
      circle(j.head[0], j.head[1], 20 * s, { opacity: o.opacity }),
      b.map(([a, c]) => line(j[a][0], j[a][1], j[c][0], j[c][1], { opacity: o.opacity, 'stroke-width': 3 })),
      ['ls', 'rs', 'le', 're', 'lk', 'rk', 'lhip', 'rhip'].map((k) => circle(j[k][0], j[k][1], 5 * s, { fill: 'currentColor', stroke: 'none', opacity: o.opacity })),
    ];
  };
  svg('s7-3d-doll', [
    text(220, 60, '3Dデッサン人形（CLIP STUDIO）', { size: 19, color: G }),
    mann(220, 90, 1.1),
    ell(220, 385, 90, 18, { stroke: G, 'stroke-dasharray': '6 6' }),
    arrow(300, 390, 312, 380, { color: G }),
    text(220, 440, 'ポーズと角度を自由に変えられる', { size: 17 }),
    text(590, 60, 'または写真参照（どのアプリでも）', { size: 19, color: G }),
    rect(470, 90, 240, 300, { rx: 6 }),
    mann(590, 110, 0.9, { opacity: 0.35 }),
    line(470, 190, 710, 190, { stroke: G, 'stroke-dasharray': '6 6' }),
    line(590, 90, 590, 390, { stroke: G, 'stroke-dasharray': '6 6' }),
    text(590, 430, '別レイヤーに置いて不透明度を下げる', { size: 17 }),
    title('どちらも「形の下敷き」。上に新しいレイヤーで自分の線を描く'),
  ]);
}
{
  const rough = [];
  for (let k = 0; k < 5; k++) rough.push(bust(150 + (k - 2) * 1.8, 210 + ((k % 3) - 1) * 2.4, 1 + (k - 2) * 0.03, { opacity: 0.35 }));
  svg('s7-rough-to-lineart', [
    rough,
    text(150, 360, 'ラフ', { size: 21 }),
    text(150, 390, '雑でOK・線は何本でも', { size: 16 }),
    arrow(255, 220, 290, 220, { color: G }),
    bust(400, 210, 1, { opacity: 0.55, dash: '4 5' }),
    text(400, 360, '下描き', { size: 21 }),
    text(400, 390, 'ラフを薄くして形を整理', { size: 16 }),
    arrow(505, 220, 540, 220, { color: G }),
    bust(650, 210, 1, { color: G, width: 3 }),
    text(650, 360, '線画', { size: 21, color: G }),
    text(650, 390, '新しいレイヤーに清書', { size: 16 }),
    title('1工程＝1レイヤー。前の工程は消さずに不透明度を下げて残す'),
  ]);
}
{
  const hairy = [];
  for (let k = 0; k < 7; k++) hairy.push(path(`M${f(80 + k * 38)},${f(250 - k * 3 + (k % 2) * 6)} q20,${f(-20 - (k % 3) * 4)} 48,${f(-8 + (k % 2) * 10)}`));
  svg('s7-clean-line', [
    hairy,
    text(230, 330, '短い線の継ぎ足し', { size: 20 }),
    text(230, 360, 'ギザギザ・毛羽立ちに見える', { size: 16 }),
    arrow(385, 230, 425, 230, { color: G }),
    taper(qpts([450, 260], [590, 120], [730, 240]), 1, 7, { color: G }),
    text(590, 330, '1本で引く', { size: 20, color: G }),
    text(590, 360, '失敗したら「取り消し」してもう1本', { size: 16 }),
    title('ゴースティング → 一気に引く → 気に入らなければ取り消し'),
  ]);
}
{
  const outer = arcPts(230, 260, 130, 0, 360, 90);
  svg('s7-line-weight-rules', [
    taper(outer, 3, 3, {
      shape: (t) => {
        const a = t * 360;
        const shade = Math.cos(((a - 45) * Math.PI) / 180);
        return 3 + 6 * Math.max(0, shade);
      },
    }),
    path('M160,250 Q220,310 300,280', { 'stroke-width': 1.3 }),
    path('M185,195 Q205,205 215,222', { 'stroke-width': 1.2 }),
    sun(70, 70),
    text(70, 135, '光', { size: 18, color: G }),
    text(450, 130, '① 外側（輪郭）は太く', { size: 19, anchor: 'start', color: G }),
    text(450, 230, '② 内側（しわ・模様）は細く', { size: 19, anchor: 'start' }),
    text(450, 330, '③ 影側（光の反対）は太く', { size: 19, anchor: 'start', color: G }),
    arrow(440, 125, 345, 185, { color: G, width: 2 }),
    arrow(440, 225, 300, 272, { width: 2 }),
    arrow(440, 325, 345, 345, { color: G, width: 2 }),
    title('3つのルールだけで、線画に立体感と手前・奥が出る'),
  ]);
}
svg('s7-line-breaks', [
  line(40, 150, 160, 150),
  line(170, 160, 170, 260),
  circle(166, 154, 16, { stroke: G, 'stroke-dasharray': '4 4' }),
  text(110, 300, 'すき間', { size: 20 }),
  text(110, 328, '塗りがもれる原因', { size: 15 }),
  line(230, 150, 370, 150),
  line(350, 130, 350, 260),
  circle(350, 150, 16, { stroke: G, 'stroke-dasharray': '4 4' }),
  text(300, 300, 'はみ出し', { size: 20 }),
  text(300, 328, '消しゴムで整える', { size: 15 }),
  path('M430,150 L550,150 L550,260', { stroke: G, 'stroke-width': 3.5 }),
  text(490, 300, 'ぴったり', { size: 20, color: G }),
  text(490, 328, '輪郭は閉じる', { size: 15 }),
  path('M620,270 Q630,200 645,185'),
  path('M672,158 Q690,138 720,128'),
  text(675, 300, 'あえて切る', { size: 20 }),
  text(675, 328, '光が当たる所・髪の先', { size: 15 }),
  title('輪郭はつなげる。光の当たる所は切ってもよい'),
]);
svg('s7-finishing', [
  bust(230, 220, 1.3),
  path('M300,160 l14,-6 M150,300 l-8,12 M320,280 l10,4', { 'stroke-width': 1.5, opacity: 0.8 }),
  [[306, 157], [146, 306], [325, 282]].map(([x, y]) => circle(x, y, 16, { stroke: G, 'stroke-dasharray': '4 4' })),
  text(230, 420, '消し残し・ヒゲ線を探す', { size: 19 }),
  rect(470, 110, 90, 110, { rx: 4 }),
  bust(515, 160, 0.45),
  text(515, 255, '縮小して全体', { size: 16 }),
  rect(600, 110, 110, 110, { rx: 4 }),
  line(655, 110, 655, 220, { stroke: G, 'stroke-dasharray': '4 4' }),
  arrow(630, 165, 680, 165, {}),
  arrow(680, 180, 630, 180, {}),
  text(655, 255, '左右反転で歪み', { size: 16 }),
  text(590, 330, '最後にラフ・下描きレイヤーを非表示', { size: 17, color: G }),
  title('仕上げ＝描き足すより「消す・直す・隠す」'),
]);
svg('s7-own-rough', [
  panel(60, 70, 200, 250, '① 自分のラフ'),
  [0, 1, 2].map((k) => bust(160 + (k - 1) * 2, 190 + k, 1, { opacity: 0.35 })),
  arrow(275, 195, 315, 195, { color: G }),
  panel(330, 70, 200, 250, '② 不透明度 20〜30%'),
  bust(430, 191, 1, { opacity: 0.2 }),
  arrow(545, 195, 585, 195, { color: G }),
  panel(600, 70, 150, 250, '③ 上に線画', { color: G, labelColor: G }),
  bust(675, 191, 0.8, { color: G, width: 3 }),
  title('ラフの「勢い」を残したまま、線だけを選び直す'),
]);
svg('s7-bust-guide', [
  rect(230, 40, 340, 400, { rx: 6 }),
  bust(400, 200, 2.1),
  line(230, 200, 570, 200, { stroke: G, 'stroke-dasharray': '6 6' }),
  text(590, 205, '目の高さ', { size: 17, anchor: 'start', color: G }),
  line(230, 380, 570, 380, { stroke: G, 'stroke-dasharray': '6 6' }),
  text(590, 385, '胸の上あたりで切る', { size: 17, anchor: 'start', color: G }),
  text(120, 120, '頭の上に', { size: 17 }),
  text(120, 145, '少し余白', { size: 17 }),
  arrow(160, 160, 225, 60, { width: 2 }),
  title('バストアップ＝頭から胸まで。首と肩が入ると人物らしくなる'),
]);

// ============================================================ ステージ8
svg('s8-rule-of-thirds', [
  frame(80, 50, 280, 380),
  [1, 2].map((k) => [
    line(80 + (280 * k) / 3, 50, 80 + (280 * k) / 3, 430, { stroke: G, 'stroke-dasharray': '6 6' }),
    line(80, 50 + (380 * k) / 3, 360, 50 + (380 * k) / 3, { stroke: G, 'stroke-dasharray': '6 6' }),
  ]),
  [[1, 1], [2, 1], [1, 2], [2, 2]].map(([i, j]) => circle(80 + (280 * i) / 3, 50 + (380 * j) / 3, 7, { fill: G, stroke: 'none' })),
  bust(173, 177, 1.05),
  text(220, 462, '三分割：交点に顔', { size: 18 }),
  frame(420, 50, 150, 190),
  bust(495, 130, 0.6),
  text(495, 272, '中央：正面・力強い', { size: 16 }),
  frame(600, 50, 150, 190),
  line(600, 240, 750, 50, { stroke: G, 'stroke-dasharray': '6 6' }),
  `<g transform="rotate(-25 675 150)">${flat(bust(675, 140, 0.55))}</g>`,
  text(675, 272, '対角：動き・勢い', { size: 16 }),
  text(585, 350, '主役の位置を先に決めてから描く', { size: 18, color: G }),
]);
svg('s8-eye-flow', [
  frame(150, 40, 500, 400),
  bust(330, 190, 1.6),
  circle(330, 190, 70, { stroke: G, 'stroke-width': 3 }),
  num(250, 118, 1, G),
  path('M400,215 Q500,240 535,322', { stroke: G, 'stroke-dasharray': '8 6' }),
  circle(560, 350, 22),
  num(603, 318, 2, G),
  path('M535,375 Q420,420 335,385', { stroke: G, 'stroke-dasharray': '8 6' }),
  num(305, 400, 3, G),
  text(720, 195, '顔（主役）', { size: 17, color: G }),
  text(560, 400, '小物', { size: 17 }),
  title('明るい所・細かい所・顔に目が行く。主役→脇→主役と巡らせる'),
]);
svg('s8-framing-3', [
  frame(50, 60, 200, 300),
  bust(150, 170, 1.2),
  text(150, 395, 'バストアップ', { size: 20 }),
  text(150, 423, '表情を見せる', { size: 16 }),
  frame(300, 60, 200, 300),
  circle(400, 100, 18),
  line(400, 118, 400, 230),
  line(400, 140, 370, 200),
  line(400, 140, 430, 200),
  line(400, 230, 380, 330),
  line(400, 230, 420, 330),
  text(400, 395, '全身', { size: 20 }),
  text(400, 423, 'ポーズ・服を見せる', { size: 16 }),
  frame(550, 60, 200, 300),
  path('M580,340 L650,110 L720,340', { stroke: G, 'stroke-dasharray': '6 6' }),
  ell(650, 130, 34, 30),
  path('M615,340 L628,170 L672,170 L685,340'),
  text(650, 395, 'アオリ', { size: 20 }),
  text(650, 423, '下から見上げる＝迫力', { size: 16 }),
  title('同じキャラでも「どこまで入れるか」「どこから見るか」で印象が変わる'),
]);
svg('s8-thumbnails', [
  Array.from({ length: 10 }, (_, k) => {
    const x = 60 + (k % 5) * 140;
    const y = 60 + Math.floor(k / 5) * 190;
    const w = 110;
    const h = 150;
    const px = x + w * [0.33, 0.5, 0.66, 0.3, 0.5, 0.7, 0.4, 0.6, 0.35, 0.5][k];
    const py = y + h * [0.45, 0.6, 0.5, 0.7, 0.4, 0.6, 0.55, 0.45, 0.6, 0.75][k];
    const r = [22, 30, 18, 26, 14, 34, 20, 24, 28, 16][k];
    return [
      frame(x, y, w, h, { width: 2 }),
      circle(px, py - r, r * 0.55),
      path(`M${f(Math.max(x + 2, px - r))},${f(y + h)} Q${f(px)},${f(py - r * 0.2)} ${f(Math.min(x + w - 2, px + r))},${f(y + h)}`),
      text(x + 12, y + 20, String(k + 1), { size: 14, anchor: 'start', color: G }),
    ];
  }),
  title('切手サイズで10個。1個1分、上手さより「配置の違い」を出す'),
]);
// s8-sky-ground → content/figures/_gen/fix-2026-09.mjs で生成（2026-09 絵の先生レビューで作り直し。ここで再生成すると古い版に戻るので外した）
// s8-room-corner → tools/gen-review-figures.mjs で生成（2026-09 教材レビューで作り直し。ここで再生成すると古い版に戻るので外した）
{
  const speed = [];
  for (let k = 0; k < 28; k++) {
    const a = (k / 28) * TAU;
    const r0 = 95 + (k % 3) * 12;
    speed.push(line(200 + 190 * Math.cos(a), 250 + 190 * Math.sin(a), 200 + r0 * Math.cos(a), 250 + r0 * Math.sin(a), { 'stroke-width': 1.8 }));
  }
  svg('s8-effect-bg', [
    `<clipPath id="s8-effect-clip"><rect x="60" y="70" width="280" height="360"/></clipPath>`,
    frame(60, 70, 280, 360),
    `<g clip-path="url(#s8-effect-clip)">${speed.join('')}</g>`,
    bust(200, 250, 0.7),
    text(200, 462, '集中線：驚き・勢い', { size: 17 }),
    frame(370, 70, 170, 360),
    [0, 1, 2, 3, 4].map((k) => circle(400 + k * 30, 110 + k * 70, 18 + (k % 2) * 10, { opacity: 0.3, 'stroke-width': 6 })),
    bust(455, 250, 0.6),
    text(455, 462, 'ぼかし：やわらかい', { size: 17 }),
    rect(570, 70, 170, 360, { rx: 4, fill: G, 'fill-opacity': 0.25, stroke: G }),
    bust(655, 250, 0.6),
    text(655, 462, '単色：主役が目立つ', { size: 17, color: G }),
  ]);
}
svg('s8-three-plans', [
  [0, 1, 2].map((k) => {
    const x = 60 + k * 240;
    const inner =
      k === 0 ? bust(x + 100, 170, 1) : k === 1 ? bust(x + 70, 150, 0.9) : `<g transform="rotate(-20 ${x + 100} 180)">${flat(bust(x + 100, 180, 0.9))}</g>`;
    return [
      frame(x, 60, 200, 260, { color: k === 1 ? G : undefined, width: k === 1 ? 3.5 : 2 }),
      inner,
      text(x + 100, 350, ['A 中央', 'B 三分割', 'C 対角'][k], { size: 19, color: k === 1 ? G : undefined }),
    ];
  }),
  arrow(400, 375, 400, 415, { color: G }),
  text(400, 450, 'いちばん「見たい」案を1つ選んで線画へ', { size: 19, color: G }),
]);

// ============================================================ ステージ9（色の図解は実色 fill）
svg('s9-flat-layers', [
  [['線画', null], ['髪', BASE.hair], ['服', BASE.cloth], ['肌', BASE.skin]].map(([n, c], i) => {
    const y = 60 + i * 90;
    return [path(`M40,${y + 60} L120,${y} L330,${y} L250,${y + 60} Z`, { fill: c ?? 'none' }), text(350, y + 38, n, { size: 20, anchor: 'start' })];
  }),
  inkBust(590, 210, 1.7, BASE),
  text(590, 430, '線画は一番上、色はその下にパーツごと', { size: 17 }),
  title('1パーツ＝1レイヤー。はみ出しても他のパーツに影響しない'),
]);
svg('s9-limited-palette', [
  inkBust(200, 200, 1.4, BASE),
  [BASE.skin, BASE.hair, BASE.cloth, BASE.eye].map((c, k) => rect(90 + k * 55, 380, 45, 28, { fill: c, 'stroke-width': 1 })),
  text(200, 440, '4色：まとまって見える', { size: 18, color: G }),
  colorBust(580, 200, 1.4, { skin: '#F7D4C0', hair: '#E0443A', cloth: '#2FB5A3', eye: '#F2C200' }),
  rect(515, 262, 30, 40, { fill: '#9B59B6', stroke: 'none' }),
  rect(610, 268, 30, 34, { fill: '#F39C12', stroke: 'none' }),
  rect(560, 130, 40, 14, { fill: '#FF66CC', stroke: 'none' }),
  bust(580, 200, 1.4, { face: false }),
  ['#F7D4C0', '#E0443A', '#2FB5A3', '#F2C200', '#9B59B6', '#F39C12', '#FF66CC'].map((c, k) => rect(460 + k * 35, 380, 28, 28, { fill: c, 'stroke-width': 1 })),
  text(580, 440, '7色：どこを見ればいいか迷う', { size: 18 }),
  title('ベタ塗りの色は3〜5色に絞る'),
]);
svg('s9-skin-hair-cloth', [
  [
    ['肌', ['#FBE3D3', '#F6D7C3', '#EFC3A4', '#D9A27C'], '少し黄み・赤みのある明るい色'],
    ['髪', ['#2E2A3A', '#5A4A78', '#A8743E', '#E9D38A'], 'キャラの個性。肌と明るさの差を'],
    ['服', ['#4F7FB8', '#F4F4F4', '#B8433F', '#3E5E3A'], '面積が大きい。彩度は控えめから'],
  ].map(([n, cs, d], i) => {
    const y = 60 + i * 130;
    return [
      text(70, y + 45, n, { size: 26, weight: 700 }),
      cs.map((c, k) => rect(120 + k * 80, y + 10, 64, 56, { fill: c, rx: 6, 'stroke-width': 1.5 })),
      text(460, y + 45, d, { size: 17, anchor: 'start' }),
    ];
  }),
  title('まずは各パーツ1色。影や光はステージ10で足す'),
]);
svg('s9-hsv', [
  Array.from({ length: 12 }, (_, k) => {
    const a = (k / 12) * TAU - Math.PI / 2;
    return circle(150 + 90 * Math.cos(a), 220 + 90 * Math.sin(a), 18, { fill: hsl(k * 30, 80, 55), stroke: 'none' });
  }),
  text(150, 360, '色相', { size: 22, weight: 700 }),
  text(150, 388, '赤・黄・青…の種類', { size: 16 }),
  Array.from({ length: 5 }, (_, k) => rect(290 + k * 44, 190, 40, 60, { fill: hsl(210, k * 25, 55), stroke: 'none' })),
  text(400, 360, '彩度', { size: 22, weight: 700 }),
  text(400, 388, '鮮やかさ（左ほど灰色）', { size: 16 }),
  Array.from({ length: 5 }, (_, k) => rect(540 + k * 44, 190, 40, 60, { fill: hsl(210, 60, 10 + k * 20), stroke: 'none' })),
  text(650, 360, '明度', { size: 22, weight: 700 }),
  text(650, 388, '明るさ（左ほど暗い）', { size: 16 }),
  title('色は「種類・鮮やかさ・明るさ」の3つのつまみでできている'),
]);
// s9-color-schemes → tools/gen-review-figures.mjs で生成（2026-09 教材レビューで作り直し。ここで再生成すると古い版に戻るので外した）
svg('s9-palette-extract', [
  rect(62, 62, 296, 170, { fill: '#BFD9EE', stroke: 'none' }),
  rect(62, 232, 296, 166, { fill: '#8FB07A', stroke: 'none' }),
  colorBust(210, 250, 1.3, { skin: '#F4D2BD', hair: '#6B4A3A', cloth: '#E8E2D0', eye: '#4A6B8A' }),
  rect(60, 60, 300, 340, { rx: 6 }),
  [[120, 110], [210, 190], [180, 360], [310, 360], [230, 265]].map(([x, y], k) => [
    circle(x, y, 10, { stroke: G, 'stroke-width': 3 }),
    line(x + 10, y, 425, 91 + k * 60, { stroke: G, 'stroke-dasharray': '4 5', 'stroke-width': 1.5 }),
  ]),
  ['#BFD9EE', '#6B4A3A', '#E8E2D0', '#8FB07A', '#F4D2BD'].map((c, k) => [
    rect(430, 70 + k * 60, 70, 42, { fill: c, rx: 4, 'stroke-width': 1.5 }),
    text(520, 98 + k * 60, ['背景（空）', '髪', '服', '地面', '肌'][k], { size: 17, anchor: 'start' }),
  ]),
  text(680, 200, 'スポイトで', { size: 18 }),
  text(680, 228, '5色だけ拾う', { size: 18, color: G }),
  title('好きな絵の色を「見本」にする。拾うのは面積の大きい色から'),
]);
svg('s9-value-check', [
  inkBust(220, 210, 1.5, BASE),
  text(220, 410, 'カラー', { size: 19 }),
  arrow(360, 210, 420, 210, { color: G }),
  inkBust(580, 210, 1.5, { skin: '#DCDCDC', hair: '#5C5C5C', cloth: '#848484', eye: '#6A6A6A' }),
  text(580, 410, '白黒にして確認', { size: 19, color: G }),
  title('白黒にしても肌・髪・服の区別がつけば、明度差は十分'),
]);
svg('s9-sat-a', [inkBust(400, 220, 2, { skin: '#F6D7C3', hair: '#E6204A', cloth: '#1E6BFF', eye: '#E6204A' })]);
svg('s9-sat-b', [inkBust(400, 220, 2, { skin: '#E8DAD0', hair: '#9A7A80', cloth: '#7C8AA0', eye: '#9A7A80' })]);
svg('s9-val-a', [inkBust(400, 220, 2, { skin: '#F6D7C3', hair: '#2E2A3A', cloth: '#4F7FB8', eye: '#2E2A3A' })]);
svg('s9-val-b', [inkBust(400, 220, 2, { skin: '#E9B8A0', hair: '#D98A70', cloth: '#E0A090', eye: '#C07060' })]);

// ============================================================ ステージ10
svg('s10-light-source', [
  sun(110, 90),
  arrow(150, 125, 280, 200, { color: G, width: 3 }),
  shadedBall(380, 260, 110, ['#F2F2F2', '#A8A8A8'], { idPrefix: 's10-light-source' }),
  circle(380, 260, 110),
  ell(500, 395, 120, 20, { fill: 'currentColor', opacity: 0.2, stroke: 'none' }),
  text(560, 150, '① 光源を1つ決める', { size: 20, anchor: 'start', color: G }),
  text(560, 210, '② 反対側が影', { size: 20, anchor: 'start' }),
  text(560, 270, '③ 床に落ち影', { size: 20, anchor: 'start' }),
  title('光源の位置は、最初にキャンバスの隅へメモしておく'),
]);
// s10-two-shadows → content/figures/_gen/fix-2026-09.mjs で生成（2026-09 絵の先生レビューで作り直し。ここで再生成すると古い版に戻るので外した）
// （この図が使っていた shadedBall の通し番号 3 つ分を進めて、後の図の clipPath の id を変えない）
ballSeq += 3;
svg('s10-highlight-bounce', [
  sun(110, 90),
  shadedBall(400, 240, 140, ['#8FB3D9', '#5E7FA8'], { idPrefix: 's10-highlight-bounce' }),
  path('M330,360 A140,140 0 0 0 520,290 A150,150 0 0 1 330,360 Z', { fill: '#86A3C2', stroke: 'none' }),
  circle(400, 240, 140),
  ell(345, 180, 34, 20, { fill: '#FFFFFF', stroke: 'none' }),
  text(230, 170, 'ハイライト', { size: 19, anchor: 'end' }),
  line(235, 172, 310, 180, { 'stroke-width': 1.5 }),
  text(590, 400, '反射光', { size: 18, anchor: 'start', color: G }),
  text(590, 424, '（影の縁が少し明るい）', { size: 15, anchor: 'start', color: G }),
  line(585, 395, 500, 345, { stroke: G, 'stroke-width': 1.5 }),
  rect(250, 400, 280, 26, { fill: '#E9D38A', stroke: 'none' }),
  text(390, 455, '床の色がはね返る', { size: 16 }),
  title('ハイライトは光源側に小さく、反射光は影の中にごく控えめに'),
]);
svg('s10-anime-shading', [
  colorBust(220, 210, 1.5, BASE),
  path('M165,190 Q185,240 220,275 L220,290 Q170,262 158,200 Z', { fill: '#E4AE95', stroke: 'none' }),
  path('M187,106 L175,150 L200,130 L210,160 L225,120 L240,110 Z', { fill: '#3E3258', stroke: 'none' }),
  bust(220, 210, 1.5, { face: false }),
  text(220, 420, '影の境目はくっきり', { size: 19, color: G }),
  text(420, 110, '① ベタの上に影用レイヤーを作る', { size: 18, anchor: 'start' }),
  text(420, 170, '② クリッピング（下の色の中だけ塗れる）', { size: 18, anchor: 'start' }),
  text(420, 230, '③ 影は「塗りつぶし」か硬いペンで面に', { size: 18, anchor: 'start' }),
  text(420, 290, '④ 乗算レイヤーで少し暗い色', { size: 18, anchor: 'start' }),
  text(420, 350, '例：ibisPaint・CLIP STUDIO「クリッピング」', { size: 15, anchor: 'start' }),
  text(420, 374, '　　Krita「アルファを継承」', { size: 15, anchor: 'start' }),
  title('アニメ塗り＝境目をぼかさない2〜3段階の塗り'),
]);
svg('s10-anime-steps', [
  [0, 1, 2].map((k) => {
    const x = 140 + k * 260;
    return [
      colorBust(x, 200, 1.1, BASE),
      k >= 1 ? path(`M${x - 40},190 Q${x - 30},240 ${x},250 L${x},258 Q${x - 42},240 ${x - 46},192 Z`, { fill: '#E4AE95', stroke: 'none' }) : null,
      k >= 2 ? path(`M${x - 38},195 Q${x - 32},225 ${x - 18},240 L${x - 24},243 Q${x - 40},226 ${x - 43},196 Z`, { fill: '#C98670', stroke: 'none' }) : null,
      k >= 2 ? ell(x - 12, 148, 22, 6, { fill: '#FFFFFF', stroke: 'none', opacity: 0.85 }) : null,
      bust(x, 200, 1.1, { face: false }),
      text(x, 360, ['① ベタ', '② 1影', '③ 2影＋ハイライト'][k], { size: 19, color: k === 2 ? G : undefined }),
    ];
  }),
  title('アニメ塗りの3ステップ。各ステップで1レイヤー'),
]);
svg('s10-anime-hair', [
  path('M200,380 Q120,200 250,110 Q400,40 550,110 Q680,200 600,380 Z', { fill: BASE.hair, stroke: 'none' }),
  path('M230,330 Q200,240 270,200 L300,260 L330,190 L360,270 L400,200 L440,270 L470,190 L500,260 L530,200 Q600,240 570,330 Z', { fill: '#3E3258', stroke: 'none' }),
  path('M260,150 Q400,110 540,150 Q400,135 260,165 Z', { fill: '#B7A6D8', stroke: 'none' }),
  path('M200,380 Q120,200 250,110 Q400,40 550,110 Q680,200 600,380'),
  text(640, 110, 'ハイライト', { size: 17, anchor: 'start', color: G }),
  text(640, 134, '（天使の輪）', { size: 15, anchor: 'start', color: G }),
  line(635, 118, 545, 145, { stroke: G, 'stroke-width': 1.5 }),
  text(640, 300, '毛先側に影', { size: 17, anchor: 'start' }),
  line(635, 295, 575, 300, { 'stroke-width': 1.5 }),
  title('髪は「頭の丸み」に沿って影とハイライトを帯状に置く'),
]);
{
  const strokes = [];
  const cols = ['#D9A27C', '#E4AE95', '#F0C4AA', '#F6D7C3', '#C98670'];
  for (let k = 0; k < 26; k++) {
    const a = (k / 26) * TAU;
    const r = 30 + (k % 4) * 22;
    strokes.push(
      path(`M${f(220 + r * Math.cos(a))},${f(240 + r * Math.sin(a))} l${f(28 * Math.cos(a + 1.4))},${f(28 * Math.sin(a + 1.4))}`, { stroke: cols[k % 5], 'stroke-width': 18, opacity: 0.85 }),
    );
  }
  svg('s10-painterly', [
    circle(220, 240, 120, { fill: '#F0C4AA', stroke: 'none' }),
    strokes,
    circle(220, 240, 120, { opacity: 0.25 }),
    text(220, 400, '色を置いて、境目を塗り混ぜる', { size: 18 }),
    text(420, 130, '・線画は薄くするか、色でなじませる', { size: 18, anchor: 'start' }),
    text(420, 190, '・不透明なブラシで「面」を置く', { size: 18, anchor: 'start' }),
    text(420, 250, '・スポイトで中間色を拾って重ねる', { size: 18, anchor: 'start', color: G }),
    text(420, 310, '・細部は最後、顔まわりだけ', { size: 18, anchor: 'start' }),
    title('厚塗り＝線より「面」で形を作る塗り方'),
  ]);
}
svg('s10-painterly-steps', [
  [0, 1, 2].map((k) => {
    const x = 140 + k * 260;
    const base = k === 0 ? '#9A9A9A' : '#E7B99C';
    const shade = k === 0 ? '#555555' : '#B9806A';
    return [
      shadedBall(x, 200, 80, [base, shade], { idPrefix: 's10-painterly-steps' }),
      k === 2 ? path(`M${x - 72},230 A80,80 0 0 0 ${x + 60},210`, { stroke: '#D29C84', 'stroke-width': 26, opacity: 0.8 }) : null,
      k === 2 ? ell(x - 28, 160, 16, 10, { fill: '#FFF1E6', stroke: 'none' }) : null,
      text(x, 330, ['① 白黒で明暗', '② 色をのせる', '③ 境目をなじませる'][k], { size: 19, color: k === 2 ? G : undefined }),
    ];
  }),
  title('厚塗りの3ステップ。明暗を先に決めると色で迷わない'),
]);
svg('s10-painterly-face', [
  shadedBall(260, 230, 150, ['#E7B99C', '#B9806A'], { idPrefix: 's10-painterly-face' }),
  ell(210, 225, 22, 14, { fill: '#6A4A40', stroke: 'none' }),
  ell(310, 225, 22, 14, { fill: '#6A4A40', stroke: 'none' }),
  ell(205, 220, 5, 4, { fill: '#FFFFFF', stroke: 'none' }),
  ell(305, 220, 5, 4, { fill: '#FFFFFF', stroke: 'none' }),
  ell(200, 270, 26, 12, { fill: '#F0A0A0', stroke: 'none', opacity: 0.6 }),
  circle(260, 230, 170, { stroke: G, 'stroke-dasharray': '6 6' }),
  text(560, 170, '描き込むのは', { size: 20, anchor: 'start' }),
  text(560, 205, '顔まわりだけ', { size: 22, anchor: 'start', color: G, weight: 700 }),
  text(560, 270, '他は大きな筆のまま', { size: 18, anchor: 'start' }),
  text(560, 300, '残してOK', { size: 18, anchor: 'start' }),
  title('描き込みに差をつけると、見てほしい所がはっきりする'),
]);
svg('s10-watercolor', [
  `<defs><filter id="s10-wc-blur"><feGaussianBlur stdDeviation="4"/></filter></defs>`,
  circle(220, 230, 110, { fill: '#9CC3E6', stroke: 'none', opacity: 0.7, filter: 'url(#s10-wc-blur)' }),
  circle(250, 200, 70, { fill: '#F2B8C6', stroke: 'none', opacity: 0.6, filter: 'url(#s10-wc-blur)' }),
  circle(220, 230, 110, { stroke: '#6E9CC6', 'stroke-width': 3, opacity: 0.8 }),
  text(220, 390, '輪郭がにじみ、色が重なって透ける', { size: 17 }),
  text(420, 130, '・薄い色から重ねる（明→暗）', { size: 18, anchor: 'start' }),
  text(420, 190, '・乗算レイヤー、不透明度は低め', { size: 18, anchor: 'start' }),
  text(420, 250, '・紙の質感を最後にのせる', { size: 18, anchor: 'start' }),
  text(420, 310, '・白い所は「塗らずに残す」', { size: 18, anchor: 'start', color: G }),
  title('水彩風＝透明感。塗りすぎないことがいちばんのコツ'),
]);
svg('s10-watercolor-steps', [
  `<defs><filter id="s10-wc-blur2"><feGaussianBlur stdDeviation="3"/></filter></defs>`,
  [0, 1, 2].map((k) => {
    const x = 140 + k * 260;
    return [
      shadedBall(x, 200, 80, k >= 1 ? ['#F6D7C3', '#EBB1A2'] : ['#F6D7C3'], { idPrefix: 's10-watercolor-steps', opacity: 0.85 }),
      k >= 2 ? circle(x + 30, 240, 30, { fill: '#9CC3E6', opacity: 0.4, stroke: 'none', filter: 'url(#s10-wc-blur2)' }) : null,
      k >= 2 ? Array.from({ length: 24 }, (_, i) => circle(x - 70 + ((i * 37) % 140), 130 + ((i * 53) % 140), 1.5, { fill: '#A08A70', stroke: 'none', opacity: 0.5 })) : null,
      circle(x, 200, 80, { opacity: 0.5, 'stroke-width': 1.5 }),
      text(x, 330, ['① 薄いベタ', '② 乗算で影を重ねる', '③ 差し色＋紙の質感'][k], { size: 19, color: k === 2 ? G : undefined }),
    ];
  }),
  title('水彩風の3ステップ。どの段も「薄く」が合言葉'),
]);
svg('s10-watercolor-edge', [
  `<defs><filter id="s10-wc-blur3"><feGaussianBlur stdDeviation="6"/></filter></defs>`,
  rect(80, 120, 260, 200, { fill: '#9CC3E6', stroke: 'none', opacity: 0.8 }),
  text(210, 370, 'くっきり：アニメ塗り寄り', { size: 18 }),
  rect(460, 120, 260, 200, { fill: '#9CC3E6', stroke: 'none', opacity: 0.8, filter: 'url(#s10-wc-blur3)' }),
  rect(460, 120, 260, 200, { fill: 'none', stroke: '#6E9CC6', 'stroke-width': 3, opacity: 0.6 }),
  text(590, 370, 'にじみ＋縁が少し濃い：水彩風', { size: 18, color: G }),
  title('水彩らしさは「縁」に出る。境界をぼかし、縁だけ少し濃く'),
]);
svg('s10-effects', [
  `<defs><filter id="s10-glow"><feGaussianBlur stdDeviation="10"/></filter></defs>`,
  circle(150, 200, 60, { fill: '#FFE08A', stroke: 'none', filter: 'url(#s10-glow)' }),
  circle(150, 200, 30, { fill: '#FFF6D5', stroke: 'none' }),
  text(150, 330, 'グロー（発光）', { size: 19 }),
  text(150, 356, '加算・発光レイヤー', { size: 15 }),
  bust(400, 210, 1.1, { color: '#E0443A', opacity: 0.7 }),
  `<g transform="translate(6 0)">${flat(bust(400, 210, 1.1, { color: '#2FA3E0', opacity: 0.7 }))}</g>`,
  text(400, 330, '色収差', { size: 19 }),
  text(400, 356, '赤と青を少しずらす', { size: 15 }),
  rect(560, 130, 170, 150, { fill: '#E8DCC4', stroke: 'none' }),
  Array.from({ length: 40 }, (_, k) => circle(570 + ((k * 37) % 160), 140 + ((k * 53) % 130), 1.8, { fill: '#8A7A5A', stroke: 'none', opacity: 0.6 })),
  text(645, 330, 'テクスチャ', { size: 19 }),
  text(645, 356, '紙・ノイズをオーバーレイ', { size: 15 }),
  text(400, 420, '効果は「ひとつまみ」。入れすぎたら不透明度を下げる', { size: 18, color: G }),
  title('効果は最後に、別レイヤーで。いつでも消せるようにする'),
]);
svg('s10-color-correction', [
  colorBust(160, 200, 1.1, BASE),
  text(160, 350, '元の絵', { size: 18 }),
  colorBust(400, 200, 1.1, { skin: '#FAD9BE', hair: '#6E4E6E', cloth: '#6F86A8', eye: '#6E86A0' }),
  rect(310, 110, 180, 200, { fill: '#FFB060', opacity: 0.14, stroke: 'none' }),
  text(400, 350, '暖色寄り（夕方）', { size: 18 }),
  colorBust(640, 200, 1.1, { skin: '#E8D6D6', hair: '#3E3E6E', cloth: '#3E6FB8', eye: '#3A6EA5' }),
  rect(550, 110, 180, 200, { fill: '#6080FF', opacity: 0.14, stroke: 'none' }),
  text(640, 350, '寒色寄り（夜）', { size: 18 }),
  text(400, 410, 'トーンカーブ・色相／彩度・カラーバランス、または色を置いたオーバーレイレイヤー', { size: 15 }),
  title('全体を1回だけ調整して、色に「空気」をまとめる'),
]);
svg('s10-export', [
  rect(80, 60, 200, 280, { rx: 4 }),
  bust(180, 190, 1),
  text(250, 322, 'sign', { size: 16, color: G }),
  text(180, 380, 'サインは隅に小さく', { size: 18 }),
  text(340, 110, '保存（作業用）', { size: 20, anchor: 'start', weight: 700 }),
  text(360, 145, 'アプリ独自の形式（レイヤーが残る）', { size: 17, anchor: 'start' }),
  text(360, 175, '例：.ipv ／ .clip ／ .kra', { size: 16, anchor: 'start' }),
  text(340, 235, '書き出し（見せる用）', { size: 20, anchor: 'start', weight: 700, color: G }),
  text(360, 270, 'PNG（または JPEG）', { size: 17, anchor: 'start' }),
  text(360, 300, '長い辺 2000〜3000px が目安', { size: 17, anchor: 'start' }),
  text(360, 330, '成長通への提出も、この書き出し画像で', { size: 17, anchor: 'start', color: G }),
  title('作業用は残し、見せる用を書き出す。2つは別物'),
]);
svg('s10-milestones', [
  [['ラフ', '1日目〜'], ['線画', '2日目〜'], ['塗り', '3日目〜'], ['仕上げ', '最後']].map(([n, d], k) => {
    const x = 120 + k * 190;
    return [
      circle(x, 180, 50, { stroke: k === 3 ? G : undefined, 'stroke-width': 3 }),
      text(x, 188, n, { size: 21, color: k === 3 ? G : undefined }),
      text(x, 270, d, { size: 17 }),
      k < 3 ? arrow(x + 58, 180, x + 132, 180, {}) : null,
      k < 3 ? text(x, 305, '提出', { size: 16, color: G }) : null,
    ];
  }),
  text(400, 380, '1日で終わらなくてOK。工程ごとに提出して区切る', { size: 19 }),
  title('最終課題は複数日。いまどの工程かだけ分かれば迷わない'),
]);
svg('s10-critique-loop', [
  [['提出', 400, 90], ['批評を読む', 620, 250], ['1つだけ直す', 400, 410], ['再提出', 180, 250]].map(([n, x, y], k) => [
    rect(x - 85, y - 30, 170, 60, { rx: 30, stroke: k === 2 ? G : undefined, 'stroke-width': k === 2 ? 3 : 2.5 }),
    text(x, y + 7, n, { size: 20, color: k === 2 ? G : undefined }),
  ]),
  arrow(490, 110, 600, 215, {}),
  arrow(600, 285, 490, 390, {}),
  arrow(310, 390, 200, 285, {}),
  arrow(200, 215, 310, 110, {}),
  text(400, 245, '全部は直さない', { size: 18, color: G }),
  text(400, 275, '「次の1つ」だけ', { size: 18, color: G }),
]);
svg('s10-pixiv-post', [
  rect(80, 50, 280, 380, { rx: 8 }),
  rect(100, 70, 240, 240, { rx: 4 }),
  bust(220, 190, 1.1),
  rect(100, 325, 240, 20, { rx: 3, opacity: 0.5 }),
  text(110, 340, 'タイトル', { size: 14, anchor: 'start' }),
  rect(100, 355, 240, 30, { rx: 3, opacity: 0.5 }),
  text(110, 375, 'キャプション', { size: 14, anchor: 'start' }),
  [0, 1, 2].map((k) => rect(100 + k * 80, 395, 70, 22, { rx: 11, stroke: G })),
  text(420, 110, 'タグ', { size: 21, anchor: 'start', weight: 700, color: G }),
  text(440, 142, '作品名・キャラ名（二次創作）／オリジナル', { size: 16, anchor: 'start' }),
  text(440, 168, '内容を表すタグを少しだけ', { size: 16, anchor: 'start' }),
  text(420, 225, 'キャプション', { size: 21, anchor: 'start', weight: 700 }),
  text(440, 257, '一言の説明・描いた気持ち', { size: 16, anchor: 'start' }),
  text(420, 315, 'サイズと公開範囲', { size: 21, anchor: 'start', weight: 700 }),
  text(440, 347, '長い辺 2000〜3000px／最初は非公開でもOK', { size: 16, anchor: 'start' }),
  title('投稿はゴールではなく記録。気軽に1枚目を置いてみる'),
]);
svg('s10-before-after', [
  rect(80, 60, 260, 320, { rx: 6 }),
  path('M170,160 Q210,120 250,160 Q260,230 210,260 Q160,230 170,160 Z', { 'stroke-width': 2 }),
  line(190, 190, 200, 190),
  line(220, 190, 230, 190),
  text(210, 410, 'Before（ステージ0）', { size: 19 }),
  arrow(360, 220, 440, 220, { color: G, width: 3 }),
  rect(460, 60, 260, 320, { rx: 6, stroke: G, 'stroke-width': 3 }),
  inkBust(590, 200, 1.3, BASE),
  text(590, 410, 'After（ステージ10）', { size: 19, color: G }),
  title('ギャラリーで並べる。ここまで続けたこと自体が成果'),
]);

console.log(made.length, 'figures');
