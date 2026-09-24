// 図解 SVG 生成スクリプト（2026-09 絵の先生レビューで作り直した図・新規の図）
// 実行: node content/figures/_gen/fix-2026-09.mjs
// 出力: content/figures/<id>.svg（viewBox 800×500、線は currentColor、強調は #7BB661）
//
// ここで作る図は、元の生成スクリプト（_gen/figures.mjs・templates/_gen/gen-s7s10.mjs）の
// 対象から外してある（あちらを再実行しても、ここで作った図が古い版に戻らないように）。
// 何度実行しても同じ結果になる。
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..');
const G = '#7BB661';
const f = (n) => Math.round(n * 10) / 10;
const HEAD =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" font-family="Zen Kaku Gothic New, sans-serif">';

const made = [];
function svg(id, body) {
  const s = `${HEAD}\n${body.flat(Infinity).filter(Boolean).map((l) => `  ${l}`).join('\n')}\n</svg>\n`;
  writeFileSync(join(OUT, `${id}.svg`), s);
  made.push(id);
}

// ------------------------------------------------------------------ 部品
const attrs = (o = {}) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('');
const line = (x1, y1, x2, y2, o) => `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"${attrs(o)}/>`;
const path = (d, o) => `<path d="${d}"${attrs(o)}/>`;
const circle = (cx, cy, r, o) => `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}"${attrs(o)}/>`;
const ell = (cx, cy, rx, ry, o = {}) => {
  const { rot, ...rest } = o;
  return `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}"${rot ? ` transform="rotate(${rot} ${f(cx)} ${f(cy)})"` : ''}${attrs(rest)}/>`;
};
const rect = (x, y, w, h, o) => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"${attrs(o)}/>`;
const dot = (x, y, color = 'currentColor', r = 5) => circle(x, y, r, { fill: color, stroke: 'none' });
const text = (x, y, s, o = {}) =>
  `<text x="${f(x)}" y="${f(y)}" font-size="${o.size ?? 20}" fill="${o.color ?? 'currentColor'}" stroke="none" text-anchor="${o.anchor ?? 'middle'}"${o.weight ? ` font-weight="${o.weight}"` : ''}>${s}</text>`;
const title = (s, y = 475, size = 20) => text(400, y, s, { size });
const DASH = { 'stroke-dasharray': '8 8', opacity: 0.6 };
const GUIDE = { 'stroke-width': 1.5, opacity: 0.45 };
const poly = (pts, close = false) => `M${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(' L')}${close ? ' Z' : ''}`;

/** 矢じりつき線分 */
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
/** 矢じり（先端 x2,y2・向きは (x1,y1)→(x2,y2)） */
function head(x1, y1, x2, y2, o = {}) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const h = o.head ?? 13;
  const p1 = [x2 - h * Math.cos(a - 0.45), y2 - h * Math.sin(a - 0.45)];
  const p2 = [x2 - h * Math.cos(a + 0.45), y2 - h * Math.sin(a + 0.45)];
  return path(`M${f(p1[0])},${f(p1[1])} L${f(x2)},${f(y2)} L${f(p2[0])},${f(p2[1])}`, { stroke: o.color, 'stroke-width': o.width });
}
/** 両端矢印（寸法線） */
const dim = (x1, y1, x2, y2, o = {}) => [line(x1, y1, x2, y2, { stroke: o.color, 'stroke-width': o.width }), head(x2, y2, x1, y1, o), head(x1, y1, x2, y2, o)];
/** 円弧（中心・半径・角度[deg]） */
function arc(cx, cy, r, a0, a1, o = {}) {
  const rad = (d) => (d * Math.PI) / 180;
  const p = (d) => [cx + r * Math.cos(rad(d)), cy + r * Math.sin(rad(d))];
  const [sx, sy] = p(a0);
  const [ex, ey] = p(a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  return path(`M${f(sx)},${f(sy)} A${f(r)},${f(r)} 0 ${large} ${sweep} ${f(ex)},${f(ey)}`, o);
}
/** 番号つき丸（半径15＋18px の数字） */
const num = (x, y, n, color = 'currentColor') => [
  circle(x, y, 15, { stroke: color, 'stroke-width': 2 }),
  text(x, y + 6.5, String(n), { size: 18, color }),
];
/** 番号＋ラベル（左詰め） */
const numLabel = (x, y, n, s, color = 'currentColor', size = 19) => [num(x, y, n, color), text(x + 24, y + 7, s, { anchor: 'start', size, color })];
/** 引き出し線 */
const leader = (x1, y1, x2, y2, color) => line(x1, y1, x2, y2, { 'stroke-width': 1.3, opacity: 0.75, stroke: color });

/** 太陽（光源） */
function sun(cx, cy, r = 18) {
  const out = [circle(cx, cy, r, { stroke: G, 'stroke-width': 3 })];
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    out.push(line(cx + (r + 8) * Math.cos(a), cy + (r + 8) * Math.sin(a), cx + (r + 18) * Math.cos(a), cy + (r + 18) * Math.sin(a), { stroke: G, 'stroke-width': 3 }));
  }
  return out;
}

/** 楕円上の点列（角度 deg） */
function ellPts(cx, cy, rx, ry, a0, a1, n = 48, rot = 0) {
  const pts = [];
  const r = (rot * Math.PI) / 180;
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    const x = rx * Math.cos(a);
    const y = ry * Math.sin(a);
    pts.push([cx + x * Math.cos(r) - y * Math.sin(r), cy + x * Math.sin(r) + y * Math.cos(r)]);
  }
  return pts;
}
/** なめらかな曲線（Catmull-Rom → 3次ベジェ） */
function smooth(pts, close = false) {
  const P = close ? [pts[pts.length - 1], ...pts, pts[0], pts[1]] : [pts[0], ...pts, pts[pts.length - 1]];
  let d = `M${f(P[1][0])},${f(P[1][1])}`;
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`;
  }
  return d + (close ? ' Z' : '');
}
/** 太さの変わる棒（関節の丸つき）: p1 半径 r1 → p2 半径 r2 */
function limb(p1, p2, r1, r2, o = {}) {
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  const a = Math.atan2(y2 - y1, x2 - x1);
  const nx = -Math.sin(a);
  const ny = Math.cos(a);
  const d =
    `M${f(x1 + nx * r1)},${f(y1 + ny * r1)} L${f(x2 + nx * r2)},${f(y2 + ny * r2)} ` +
    `A${f(r2)},${f(r2)} 0 0 0 ${f(x2 - nx * r2)},${f(y2 - ny * r2)} L${f(x1 - nx * r1)},${f(y1 - ny * r1)} ` +
    `A${f(r1)},${f(r1)} 0 0 0 ${f(x1 + nx * r1)},${f(y1 + ny * r1)} Z`;
  return path(d, o);
}

/** 3D の箱を透視投影（y 上向き・地面 y=0）。戻り値: 見える辺・見えない辺 */
function box3d({ cx, horizon, f: F, eyeH, Z0, w, d, h, rotDeg, X0 = 0 }) {
  const t = (rotDeg * Math.PI) / 180;
  const ux = [Math.cos(t), Math.sin(t)]; // 幅の向き（x,z）
  const uz = [-Math.sin(t), Math.cos(t)]; // 奥行きの向き
  const V = [];
  for (const sy of [0, 1])
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const X = X0 + (sx * w) / 2 * ux[0] + (sz * d) / 2 * uz[0];
        const Z = Z0 + (sx * w) / 2 * ux[1] + (sz * d) / 2 * uz[1];
        V.push({ X, Y: sy * h, Z, key: `${sx},${sy},${sz}` });
      }
  const P = (v) => [cx + (F * v.X) / v.Z, horizon + (F * (eyeH - v.Y)) / v.Z];
  const idx = (sx, sy, sz) => V.findIndex((v) => v.key === `${sx},${sy},${sz}`);
  // 面: [頂点index...], 外向き法線(3D)
  const faces = [
    { v: [idx(-1, 1, -1), idx(1, 1, -1), idx(1, 1, 1), idx(-1, 1, 1)], n: [0, 1, 0] },
    { v: [idx(-1, 0, -1), idx(1, 0, -1), idx(1, 0, 1), idx(-1, 0, 1)], n: [0, -1, 0] },
    { v: [idx(1, 0, -1), idx(1, 0, 1), idx(1, 1, 1), idx(1, 1, -1)], n: [ux[0], 0, ux[1]] },
    { v: [idx(-1, 0, -1), idx(-1, 0, 1), idx(-1, 1, 1), idx(-1, 1, -1)], n: [-ux[0], 0, -ux[1]] },
    { v: [idx(-1, 0, 1), idx(1, 0, 1), idx(1, 1, 1), idx(-1, 1, 1)], n: [uz[0], 0, uz[1]] },
    { v: [idx(-1, 0, -1), idx(1, 0, -1), idx(1, 1, -1), idx(-1, 1, -1)], n: [-uz[0], 0, -uz[1]] },
  ];
  const visible = faces.filter((fc) => {
    const c = fc.v.reduce((a, i) => [a[0] + V[i].X / 4, a[1] + V[i].Y / 4, a[2] + V[i].Z / 4], [0, 0, 0]);
    const toCam = [0 - c[0], eyeH - c[1], 0 - c[2]];
    return fc.n[0] * toCam[0] + fc.n[1] * toCam[1] + fc.n[2] * toCam[2] > 0;
  });
  const edges = new Map();
  for (const fc of faces)
    for (let k = 0; k < 4; k++) {
      const a = fc.v[k];
      const b = fc.v[(k + 1) % 4];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (!edges.has(key)) edges.set(key, { a, b, vis: false });
    }
  for (const fc of visible)
    for (let k = 0; k < 4; k++) {
      const a = fc.v[k];
      const b = fc.v[(k + 1) % 4];
      edges.get(a < b ? `${a}-${b}` : `${b}-${a}`).vis = true;
    }
  const pts = V.map(P);
  return { pts, edges: [...edges.values()], V, visibleFaces: visible, faces };
}
function drawBox(b, o = {}) {
  return b.edges.map((e) =>
    e.vis
      ? line(...b.pts[e.a], ...b.pts[e.b], { 'stroke-width': o.width ?? 3 })
      : o.hidden === false
        ? null
        : line(...b.pts[e.a], ...b.pts[e.b], { ...DASH, 'stroke-width': 2 }),
  );
}

/** 画面座標で 2 直線の交点 */
function inter(p1, p2, p3, p4) {
  const d = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0]);
  const a = p1[0] * p2[1] - p1[1] * p2[0];
  const b = p3[0] * p4[1] - p3[1] * p4[0];
  return [(a * (p3[0] - p4[0]) - (p1[0] - p2[0]) * b) / d, (a * (p3[1] - p4[1]) - (p1[1] - p2[1]) * b) / d];
}
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// ================================================================== ステージ1

// ハッチング（45°＝右下がり「＼」。アプリの採点と同じ向き）
{
  // 「＼」向き: (x-x0)-(y-y0)=c
  const back = (x0, y0, s, sp, o = {}) => {
    const out = [];
    for (let c = -s + sp; c < s; c += sp) {
      const xa = Math.max(0, c);
      const xb = Math.min(s, s + c);
      out.push(line(x0 + xa, y0 + xa - c, x0 + xb, y0 + xb - c, { 'stroke-width': 2, ...o }));
    }
    return out;
  };
  // 「／」向き: (x-x0)+(y-y0)=c
  const fwd = (x0, y0, s, sp, o = {}) => {
    const out = [];
    for (let c = sp; c < 2 * s; c += sp) {
      const xa = Math.max(0, c - s);
      const xb = Math.min(s, c);
      out.push(line(x0 + xa, y0 + c - xa, x0 + xb, y0 + c - xb, { 'stroke-width': 2, ...o }));
    }
    return out;
  };
  const S = 220;
  svg('hatching', [
    rect(90, 60, S, S, DASH),
    back(90, 60, S, 22),
    // 角度の見本：水平線と右下がりの線
    line(100, 322, 210, 322, { ...GUIDE }),
    line(100, 322, 158, 380, { stroke: G, 'stroke-width': 4 }),
    arc(100, 322, 44, 0, 45, { stroke: G, 'stroke-width': 2.5 }),
    text(160, 346, '45°（右下がり）', { anchor: 'start', size: 19, color: G }),
    text(200, 425, 'ハッチング：同じ角度・同じ間隔'),
    rect(490, 60, S, S, DASH),
    back(490, 60, S, 22),
    fwd(490, 60, S, 22, { stroke: G }),
    text(600, 330, '「＼」に「／」を重ねる', { size: 18, color: G }),
    text(600, 425, 'クロス：向きを変えて重ねる'),
    title('線の間隔が詰まるほど暗く見える', 470),
  ]);
}

// 等間隔の平行線（斜めは 45°＝右下がり）
{
  const k2 = Math.SQRT1_2;
  const diag = [0, 1, 2, 3, 4].map((i) => {
    const c = [630 + (i - 2) * 36 * k2, 250 - (i - 2) * 36 * k2];
    return line(c[0] - 110 * k2, c[1] - 110 * k2, c[0] + 110 * k2, c[1] + 110 * k2);
  });
  svg('parallel-spacing', [
    [0, 1, 2, 3, 4, 5].map((i) => line(60, 90 + i * 55, 350, 90 + i * 55)),
    [0, 1, 2, 3, 4].map((i) => dim(378, 94 + i * 55, 378, 141 + i * 55, { color: G, head: 9, width: 2 })),
    text(398, 240, '同じ', { anchor: 'start', color: G, size: 19 }),
    text(398, 266, '間隔', { anchor: 'start', color: G, size: 19 }),
    diag,
    text(630, 420, '45°（右下がり）でも同じ間隔', { size: 19 }),
    title('1本目を基準に、隣との間を見ながら引く', 470),
  ]);
}

// ゴースティング：空中でなぞる線は、始点と終点を通る直線
svg('ghosting', [
  // 左：予行（点線＝ペンを浮かせて動かす道すじ）
  line(70, 318, 350, 206, { ...DASH, 'stroke-width': 3 }),
  dot(90, 310, 'currentColor', 6), dot(330, 214, 'currentColor', 6),
  text(90, 345, '始点', { size: 18 }), text(330, 248, '終点', { size: 18 }),
  // 往復の矢印（点線のすぐ上に1本・「3回」）
  line(150, 262, 270, 214, { stroke: G, 'stroke-width': 2 }),
  head(150, 262, 270, 214, { head: 11, width: 2, color: G }),
  head(270, 214, 150, 262, { head: 11, width: 2, color: G }),
  text(196, 214, '往復 3 回', { size: 18, color: G }),
  text(210, 120, '空中で 3 回なぞる', { size: 21 }),
  text(210, 390, '（ペン先は紙から浮かせる）', { size: 17 }),
  arrow(410, 262, 470, 262, { width: 3 }),
  // 右：本番の1本
  dot(510, 310, G, 6), dot(750, 214, G, 6),
  line(510, 310, 750, 214, { stroke: G, 'stroke-width': 5 }),
  text(630, 352, '同じ道すじを一気に引く', { color: G, size: 20 }),
  title('点を置く → 空中で 3 回予行 → 迷わず 1 本', 460),
]);

// 図形の組み合わせ（模写用・文字・番号・緑なし）
svg('shape-silhouettes-lineart', [
  path('M70,250 L230,250 L230,380 L70,380 Z'),
  path('M55,250 L150,160 L245,250 Z'),
  path('M130,310 L170,310 L170,380 L130,380 Z'),
  circle(400, 200, 70),
  circle(350, 245, 45),
  circle(450, 245, 45),
  path('M385,280 L415,280 L415,380 L385,380 Z'),
  path('M560,280 L760,280 L760,345 L560,345 Z'),
  path('M600,280 L625,225 L710,225 L735,280 Z'),
  circle(610, 350, 28),
  circle(710, 350, 28),
]);

// ================================================================== ステージ1.5（正面顔の共通寸法）
const FACE = { cx: 400, top: 50, cy: 230, hw: 150, chin: 450, eye: 260 };
const faceD = () =>
  `M${FACE.cx - FACE.hw},${FACE.cy} A${FACE.hw},${FACE.cy - FACE.top} 0 0 1 ${FACE.cx + FACE.hw},${FACE.cy} ` +
  `Q${FACE.cx + FACE.hw * 0.95},390 ${FACE.cx},${FACE.chin} Q${FACE.cx - FACE.hw * 0.95},390 ${FACE.cx - FACE.hw},${FACE.cy} Z`;

svg('face-cross', [
  path(faceD()),
  line(FACE.cx, 30, FACE.cx, 470, { stroke: G, 'stroke-width': 3, 'stroke-dasharray': '10 8' }),
  path(`M${FACE.cx - FACE.hw},${FACE.eye} Q${FACE.cx},${FACE.eye + 18} ${FACE.cx + FACE.hw},${FACE.eye}`, { stroke: G, 'stroke-width': 3 }),
  // ① 輪郭：輪郭の左上のすぐ外に置き、短い引き出し線で輪郭を指す
  num(258, 80, 1), text(234, 87, '輪郭', { size: 20, anchor: 'end' }),
  leader(268, 91, 287, 110),
  num(430, 40, 2, G), text(452, 47, '縦の中心線', { color: G, size: 20, anchor: 'start' }),
  num(600, 262, 3, G), text(660, 300, '目の高さ', { color: G, size: 20 }),
  text(700, 440, '左右が同じ幅か確認', { size: 18, anchor: 'end' }),
]);

// 鼻・口・眉・耳の位置
{
  const lvl = [
    [190, '眉'],
    [FACE.eye, '目'],
    [340, '鼻'],
    [390, '口'],
  ];
  svg('face-nose-mouth-placement', [
    path(faceD()),
    line(FACE.cx, 40, FACE.cx, 465, { ...DASH }),
    lvl.map(([y, l]) => [
      line(220, y, 580, y, { stroke: G, 'stroke-width': 1.5, 'stroke-dasharray': '6 6' }),
      text(600, y + 7, l, { anchor: 'start', color: G, size: 20 }),
    ]),
    path('M300,195 Q335,175 370,188'), path('M500,195 Q465,175 430,188'),
    path('M300,255 Q335,235 372,250', { 'stroke-width': 4 }), path('M500,255 Q465,235 428,250', { 'stroke-width': 4 }),
    ell(336, 272, 18, 24), ell(464, 272, 18, 24),
    path('M404,325 L396,340 L406,343'),
    path('M375,388 Q400,398 425,388'),
    path('M250,210 Q222,215 226,275 Q230,330 256,335'),
    path('M550,210 Q578,215 574,275 Q570,330 544,335'),
    dim(200, 190, 200, 340, { head: 8, width: 1.5 }),
    text(190, 270, '耳', { anchor: 'end', size: 20 }),
    // 目と目の間＝目1つ分（文字は矢印の下、鼻より上のすき間に）
    dim(372, 290, 428, 290, { head: 7, width: 1.5, color: G }),
    text(430, 312, '目1つ分', { size: 14, color: G, anchor: 'start' }),
  ]);
}

// ================================================================== ステージ2

// 目の高さ（地平線）と消失点：上の線は下がり、下の線は上がる
{
  const VP = [400, 230];
  const at = (p, x) => [x, p[1] + ((VP[1] - p[1]) * (x - p[0])) / (VP[0] - p[0])];
  const TL = [60, 50];
  const BL = [60, 440];
  const TR = [740, 50];
  const BR = [740, 440];
  const tl = at(TL, 250);
  const bl = at(BL, 250);
  const tr = at(TR, 550);
  const br = at(BR, 550);
  svg('horizon-vp', [
    line(20, 230, 780, 230, { stroke: G, 'stroke-width': 3 }),
    dot(400, 230, G, 7),
    text(400, 214, '消失点', { size: 17, color: G }),
    text(72, 218, '地平線＝目の高さ', { size: 18, color: G, anchor: 'start' }),
    // 左右の壁（廊下）
    line(...TL, ...tl), line(...BL, ...bl), line(...tl, ...bl),
    line(...TR, ...tr), line(...BR, ...br), line(...tr, ...br),
    line(...tl, ...VP, DASH), line(...bl, ...VP, DASH), line(...tr, ...VP, DASH), line(...br, ...VP, DASH),
    // 上の線が下がる向き・下の線が上がる向き
    arrow(...lerp(TL, tl, 0.35), ...lerp(TL, tl, 0.75), { color: G, width: 3 }),
    arrow(...lerp(BL, bl, 0.35), ...lerp(BL, bl, 0.75), { color: G, width: 3 }),
    text(400, 82, '目より上の線（天井の縁）は', { size: 19 }),
    text(400, 108, '下がって消失点へ', { size: 19, weight: 700 }),
    text(400, 372, '目より下の線（床の縁）は', { size: 19 }),
    text(400, 398, '上がって消失点へ', { size: 19, weight: 700 }),
    title('平行な線は、遠くで1点（消失点）に集まって見える', 470),
  ]);
}

// パースのついた円：奥の半分が小さい
{
  // 単位正方形 → 台形 のホモグラフィ
  const A = [40, 390];
  const B = [600, 390];
  const C = [470, 235];
  const D = [170, 235];
  const VPy = inter(A, D, B, C);
  function homog(src, dst) {
    // 8x8 連立一次方程式
    const M = [];
    const v = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i];
      const [u, w] = dst[i];
      M.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
      v.push(u);
      M.push([0, 0, 0, x, y, 1, -w * x, -w * y]);
      v.push(w);
    }
    for (let c = 0; c < 8; c++) {
      let p = c;
      for (let r = c + 1; r < 8; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      [v[c], v[p]] = [v[p], v[c]];
      for (let r = 0; r < 8; r++) {
        if (r === c) continue;
        const k = M[r][c] / M[c][c];
        for (let j = c; j < 8; j++) M[r][j] -= k * M[c][j];
        v[r] -= k * v[c];
      }
    }
    const h = v.map((x, i) => x / M[i][i]);
    return ([x, y]) => {
      const d = h[6] * x + h[7] * y + 1;
      return [(h[0] * x + h[1] * y + h[2]) / d, (h[3] * x + h[4] * y + h[5]) / d];
    };
  }
  const H = homog([[0, 0], [1, 0], [1, 1], [0, 1]], [A, B, C, D]);
  const circ = [];
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    circ.push(H([0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)]));
  }
  const ctr = H([0.5, 0.5]);
  const front = H([0.5, 0]);
  const backP = H([0.5, 1]);
  const left = H([0, 0.5]);
  const right = H([1, 0.5]);
  svg('circle-in-perspective', [
    text(400, 28, '① パースの正方形 → ② 対角線で中心 → ③ 4辺に接する楕円', { size: 19 }),
    line(20, VPy[1], 780, VPy[1], GUIDE),
    dot(VPy[0], VPy[1], G, 6),
    text(VPy[0] + 12, VPy[1] + 20, '消失点', { size: 15, color: G, anchor: 'start' }),
    path(poly([A, B, C, D], true)),
    line(...A, ...C, DASH), line(...B, ...D, DASH),
    line(...left, ...right, DASH), line(...front, ...backP, DASH),
    path(smooth(circ, true), { stroke: G, 'stroke-width': 4 }),
    dot(...ctr, G, 5), dot(...front, G, 5), dot(...backP, G, 5), dot(...left, G, 5), dot(...right, G, 5),
    num(A[0] + 12, A[1] + 28, 1), num(ctr[0] + 30, ctr[1] - 26, 2, G), num(front[0] + 34, front[1] + 24, 3),
    // 奥の半分と手前の半分を比べる
    line(backP[0], backP[1], 650, backP[1], GUIDE),
    line(ctr[0], ctr[1], 650, ctr[1], GUIDE),
    line(front[0], front[1], 650, front[1], GUIDE),
    dim(650, backP[1] + 2, 650, ctr[1] - 2, { color: G, head: 8, width: 2 }),
    dim(650, ctr[1] + 2, 650, front[1] - 2, { head: 8, width: 2 }),
    text(668, (backP[1] + ctr[1]) / 2 + 2, '奥の半分', { size: 18, anchor: 'start', color: G }),
    text(668, (backP[1] + ctr[1]) / 2 + 24, '（小さい）', { size: 16, anchor: 'start', color: G }),
    text(668, (ctr[1] + front[1]) / 2 + 2, '手前の半分', { size: 18, anchor: 'start' }),
    text(668, (ctr[1] + front[1]) / 2 + 24, '（大きい）', { size: 16, anchor: 'start' }),
    title('パースの円＝正方形に内接する楕円。中心は奥へずれ、奥の半分が小さい', 470, 19),
  ]);
}

// 箱を回す：3つとも箱に見えるように（2点透視で計算）
{
  const boxes = [25, 45, 65].map((rot, i) =>
    box3d({ cx: 140 + i * 260, horizon: 110, f: 520, eyeH: 3.0, Z0: 8, w: 2.6, d: 1.6, h: 1.3, rotDeg: rot }),
  );
  svg('box-rotate', [
    line(20, 110, 780, 110, GUIDE),
    text(770, 100, '目の高さ', { size: 16, anchor: 'end' }),
    boxes.map((b) => drawBox(b)),
    [0, 1, 2].map((i) => num(140 + i * 260, 380, i + 1)),
    arrow(200, 380, 330, 380, { color: G, width: 3 }),
    arrow(460, 380, 590, 380, { color: G, width: 3 }),
    title('同じ箱を少しずつ回す：見える側面の幅が入れかわる', 450),
  ]);
}

// 物を図形に分ける（マグカップ）
svg('object-breakdown', [
  // 左：見たまま
  path('M140,170 C120,240 120,330 160,370 L300,370 C340,330 340,240 320,170', { 'stroke-width': 3.5 }),
  ell(230, 170, 90, 22, { 'stroke-width': 3.5 }),
  path('M160,370 Q230,384 300,370', { 'stroke-width': 3.5 }),
  path('M326,205 C390,195 392,305 330,318', { 'stroke-width': 3.5 }),
  num(230, 118, 1), num(402, 262, 2), num(100, 290, 3),
  text(230, 430, '見たまま', { size: 22 }),
  // 中央：分ける
  arrow(418, 190, 474, 190, { color: G, width: 3 }),
  // 右：図形に分けたもの（左と同じ番号が対応）
  ell(600, 170, 90, 22, { stroke: G, 'stroke-width': 3 }),
  path('M510,170 C490,240 490,330 530,370 M690,170 C710,240 710,330 670,370', { stroke: G, 'stroke-width': 3 }),
  ell(600, 370, 70, 16, { stroke: G, 'stroke-width': 3 }),
  line(510, 170, 530, 370, { ...DASH, 'stroke-width': 1.8 }), line(690, 170, 670, 370, { ...DASH, 'stroke-width': 1.8 }),
  path('M696,205 C760,195 762,305 700,318', { stroke: G, 'stroke-width': 3 }),
  line(600, 130, 600, 410, { stroke: G, 'stroke-width': 1.5, 'stroke-dasharray': '4 6' }),
  num(600, 118, 1, G), num(772, 262, 2, G), num(470, 290, 3, G),
  text(600, 430, '図形に分けたもの', { size: 22, color: G }),
  title('①口＝楕円　②取っ手＝Cカーブ　③胴＝ふくらんだ円柱（同じ番号が対応）', 475, 18),
]);

// 部屋（1点透視）：ドアの説明は壁の線と重ならない位置に
svg('room-1pt', [
  path('M270.8,157.8 L529.2,157.8 L529.2,317.4 L270.8,317.4 Z', { 'stroke-width': 4 }),
  line(60, 40, 270.8, 157.8, { 'stroke-width': 4 }),
  line(740, 40, 529.2, 157.8, { 'stroke-width': 4 }),
  line(740, 460, 529.2, 317.4, { 'stroke-width': 4 }),
  line(60, 460, 270.8, 317.4, { 'stroke-width': 4 }),
  line(60, 230, 740, 230, GUIDE),
  circle(400, 230, 7, { fill: G, stroke: 'none' }),
  path('M350,175 L450,175 L450,240 L350,240 Z'),
  path('M640,392.4 L640,173.5 L580,187.6 L580,351.8 Z', { stroke: G, 'stroke-width': 3 }),
  // ドアの上下の線をのばすと消失点へ
  line(580, 187.6, 400, 230, { stroke: G, 'stroke-width': 1.8, 'stroke-dasharray': '6 6' }),
  line(529.2, 317.4, 400, 230, { stroke: G, 'stroke-width': 1.8, 'stroke-dasharray': '6 6' }),
  line(332, 460, 374.2, 317.4, DASH),
  line(468, 460, 425.8, 317.4, DASH),
  text(400, 290, '奥の壁', { size: 18 }),
  text(400, 104, 'ドア（緑）の上下の線も、のばすと消失点へ', { size: 17, color: G }),
  title('1点透視の部屋：部屋の角からの線が、すべて消失点へ', 482),
]);

// 正方形の分割：② の番号は線と重ならない所に
{
  const P = [[470, 320], [730, 300], [680, 150], [520, 160]];
  const c = inter(P[0], P[2], P[1], P[3]);
  const vpSide = inter(P[0], P[3], P[1], P[2]); // 左右の辺が集まる点
  const vpTB = inter(P[0], P[1], P[3], P[2]); // 上下の辺が集まる点
  const a1 = inter(c, vpSide, P[0], P[1]);
  const a2 = inter(c, vpSide, P[3], P[2]);
  const b1 = inter(c, vpTB, P[0], P[3]);
  const b2 = inter(c, vpTB, P[1], P[2]);
  svg('square-divide', [
    path('M100,80 L360,80 L360,340 L100,340 Z', { 'stroke-width': 4 }),
    line(100, 80, 360, 340, { stroke: G }),
    line(360, 80, 100, 340, { stroke: G }),
    circle(230, 210, 7, { fill: G, stroke: 'none' }),
    line(230, 80, 230, 340, DASH),
    line(100, 210, 360, 210, DASH),
    num(100, 55, 1),
    num(318, 165, 2, G), leader(305, 173, 238, 206, G),
    num(385, 210, 3),
    text(230, 385, '対角線の交点＝中心', { size: 22 }),
    path(poly(P, true), { 'stroke-width': 4 }),
    line(...P[0], ...P[2], { stroke: G }),
    line(...P[1], ...P[3], { stroke: G }),
    circle(c[0], c[1], 7, { fill: G, stroke: 'none' }),
    line(...a1, ...a2, DASH),
    line(...b1, ...b2, DASH),
    text(600, 385, 'ななめから見た面でも使える', { size: 22 }),
    title('① 対角線を2本 → ② 交点が中心 → ③ 中心を通る線で等分'),
  ]);
}

// 片脚に体重をのせた立ちポーズ：肩と腰の傾きを強調線で
{
  const S = { L: [200, 106], R: [316, 120] };
  const E = { L: [188, 184], R: [328, 198] };
  const W = { L: [192, 256], R: [320, 266] };
  const H = { L: [225, 238], R: [280, 226] };
  const K = { L: [207, 326], R: [274, 320] };
  const A = { L: [214, 404], R: [262, 408] };
  const ext = (p, q, k1, k2) => {
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const L = Math.hypot(dx, dy);
    return [p[0] - (dx / L) * k1, p[1] - (dy / L) * k1, q[0] + (dx / L) * k2, q[1] + (dy / L) * k2];
  };
  const sh = ext(S.L, S.R, 28, 40);
  const hp = ext(H.L, H.R, 34, 74);
  const J = 'currentColor';
  svg('standing-pose', [
    ell(262, 62, 21, 27, { rot: 4 }),
    line(259, 90, 258, 110),
    ell(258, 152, 34, 43, { rot: -4 }),
    ell(252, 230, 31, 23, { rot: -12 }),
    limb(S.L, E.L, 9, 7), limb(E.L, W.L, 7, 5),
    limb(S.R, E.R, 9, 7), limb(E.R, W.R, 7, 5),
    limb(H.L, K.L, 13, 9), limb(K.L, A.L, 9, 6),
    limb(H.R, K.R, 13, 9), limb(K.R, A.R, 9, 6),
    [S.L, S.R, E.L, E.R, H.L, H.R, K.L, K.R].map((p) => circle(p[0], p[1], 4, { fill: J, stroke: 'none', opacity: 0.5 })),
    line(...A.L, 196, 414, { 'stroke-width': 5 }),
    line(...A.R, 284, 416, { 'stroke-width': 5 }),
    // 重心線（首の付け根 → 体重のかかる足）
    line(258, 30, 258, 425, { stroke: G, 'stroke-width': 1.8, 'stroke-dasharray': '4 6' }),
    circle(262, 414, 7, { fill: G, stroke: 'none' }),
    // 肩の線・腰の線
    line(...sh, { stroke: G, 'stroke-width': 4 }),
    line(...hp, { stroke: G, 'stroke-width': 4 }),
    text(sh[2] + 10, sh[3] + 6, '肩の線（右下がり）', { size: 18, anchor: 'start', color: G }),
    text(hp[2] + 10, hp[3] + 6, '腰の線（右上がり）', { size: 18, anchor: 'start', color: G }),
    text(560, 300, '肩と腰は反対に傾く', { size: 19, anchor: 'start' }),
    text(560, 350, '体重がかかる脚の上に', { size: 18, anchor: 'start' }),
    text(560, 376, '首の付け根がくる（点線）', { size: 18, anchor: 'start' }),
    title('片脚に体重をのせた立ちポーズ（コントラポスト）', 470),
  ]);
}

// ================================================================== ステージ3〜

// 円柱の明暗：境界のすぐ先が最も暗い帯、ふちは反射光で少し明るい
{
  const L = 260;
  const R = 540;
  const T = 110;
  const B = 380;
  const rx = 140;
  const ry = 40;
  const op = (u) => {
    if (u < 0.55) return 0.02 + 0.11 * (u / 0.55);
    if (u < 0.64) return 0.13 + (0.52 - 0.13) * ((u - 0.55) / 0.09);
    if (u < 0.74) return 0.52;
    return 0.52 - (0.52 - 0.24) * ((u - 0.74) / 0.26);
  };
  const bands = [];
  const N = 70;
  for (let i = 0; i < N; i++) {
    const x = L + ((R - L) * i) / N;
    bands.push(rect(x, T - 2, (R - L) / N + 0.6, B - T + ry + 4, { fill: 'currentColor', 'fill-opacity': f(op((i + 0.5) / N) * 100) / 100, stroke: 'none' }));
  }
  const tx = L + 0.55 * (R - L);
  const ty = (x) => T + ry * Math.sqrt(1 - ((x - 400) / rx) ** 2);
  svg('cylinder-gradient', [
    sun(80, 70),
    text(80, 135, '光源', { size: 18, color: G }),
    arrow(125, 105, 225, 160, { color: G, width: 2.5 }),
    `<clipPath id="cylinder-gradient-side"><path d="M${L},${T} A${rx},${ry} 0 0 0 ${R},${T} L${R},${B} A${rx},${ry} 0 0 1 ${L},${B} Z"/></clipPath>`,
    `<g clip-path="url(#cylinder-gradient-side)">${bands.join('')}</g>`,
    ell(400, T, rx, ry, { 'stroke-width': 3.5 }),
    path(`M${L},${T} L${L},${B} A${rx},${ry} 0 0 0 ${R},${B} L${R},${T}`, { 'stroke-width': 3.5 }),
    line(tx, ty(tx), tx, B + ry * 0.98, { stroke: G, 'stroke-width': 2.5, 'stroke-dasharray': '6 6' }),
    // ラベル
    text(170, 262, '光が当たる面', { size: 18 }), leader(232, 256, 292, 256),
    text(585, 158, '境界', { size: 19, anchor: 'start', color: G }), leader(580, 153, tx + 3, 196, G),
    text(585, 238, '最も暗い帯', { size: 19, anchor: 'start' }),
    text(585, 261, '（コアシャドウ）', { size: 16, anchor: 'start' }), leader(580, 233, L + 0.69 * (R - L), 262),
    text(585, 330, '反射光', { size: 19, anchor: 'start' }),
    text(585, 353, '（ふちが少し明るい）', { size: 16, anchor: 'start' }), leader(580, 325, R - 10, 318),
    title('光の当たる面 → 境界 → すぐ先が最も暗い帯 → ふちは反射光で少し明るい', 470, 19),
  ]);
}

// ================================================================== ステージ4（顔・髪）

// 目のパーツ：①上まぶた ②二重 ③まつ毛 ④虹彩 ⑤瞳孔 ⑥ハイライト ⑦下まぶた
{
  // [番号, 名前, 絵の横に置く番号の位置, 色]（引き出し線は交差しやすいので、番号を部位のすぐ横に置く）
  const labels = [
    [1, '上まぶた（太く）', [92, 203]],
    [2, '二重', [255, 86]],
    [3, 'まつ毛', [510, 160]],
    [4, '虹彩（縦長）', [188, 305]],
    [5, '瞳孔', [398, 318]],
    [6, 'ハイライト', [306, 207], G],
    [7, '下まぶた（細く）', [285, 408]],
  ];
  svg('s4-eye-parts', [
    // 絵（この 8 行の順番は tools/gen-review-figures.mjs の線画変換と対応しているので変えない）
    '<path d="M110,235 Q240,110 410,160 Q440,172 452,200" stroke-width="9"/>',
    '<path d="M150,172 Q250,92 395,122" stroke-width="2"/>',
    '<path d="M410,160 L450,132 M432,170 L476,152 M446,186 L486,178" stroke-width="3.5"/>',
    '<ellipse cx="285" cy="260" rx="72" ry="102"/>',
    '<ellipse cx="285" cy="280" rx="30" ry="46" fill="currentColor" opacity="0.35" stroke="none"/>',
    '<ellipse cx="285" cy="280" rx="30" ry="46"/>',
    '<circle cx="258" cy="218" r="18" stroke="#7BB661" stroke-width="3"/>',
    '<path d="M205,372 Q285,386 368,356" stroke-width="2.5"/>',
    leader(384, 316, 316, 298),
    labels.map(([n, s, [px, py], c], i) => {
      const y = 95 + i * 48;
      const col = c ?? 'currentColor';
      return [num(px, py, n, col), num(580, y, n, col), text(604, y + 7, s, { anchor: 'start', size: 19, color: col })];
    }),
    text(300, 470, 'いちばん太いのは上まぶた', { size: 19 }),
  ]);
}

/**
 * 説明図から模写用の線画（*-lineart）を作る。規則は tools/gen-review-figures.mjs と同じ:
 * 文字を消す・点線は消す（solid に挙げた行は実線にして残す）・緑の点は消す・
 * 区切り枠（opacity 0.25）は消す・残した線の強調色は currentColor に戻す。drop は消す行（0 始まり）。
 */
function lineartOf(id, body, { drop = [], solid = [] } = {}) {
  const els = body.flat(Infinity).filter(Boolean);
  const out = [];
  els.forEach((el, i) => {
    if (drop.includes(i)) return;
    if (/^<text\b/.test(el)) return;
    if (/opacity="0\.25"/.test(el)) return;
    if (/^<circle\b/.test(el) && new RegExp(`fill="${G}"`).test(el)) return;
    let s = el;
    if (/stroke-dasharray=/.test(s)) {
      if (!solid.includes(i)) return;
      s = s.replace(/ stroke-dasharray="[^"]*"/, '').replace(/ opacity="[^"]*"/, '');
    }
    out.push(s.replaceAll(G, 'currentColor'));
  });
  svg(`${id}-lineart`, out);
}

// 髪の流れ（右端の束が枠で切れないよう、右側の 3 段を左へ寄せた）
{
  // 要素の順番は tools/gen-review-figures.mjs の線画変換（drop の行番号）と対応しているので変えない
  const body = [
    '<circle cx="200" cy="220" r="120" stroke-dasharray="6 6" opacity="0.55" stroke-width="1.5"/>',
    '<path d="M60,410 Q45,160 150,90 Q240,65 320,170 Q355,280 340,410" stroke-width="3"/>',
    '<circle cx="230" cy="125" r="6" fill="#7BB661" stroke="none"/>',
    '<path d="M225,133 Q160,160 140,230" stroke="#7BB661" stroke-width="2.5"/>',
    '<path d="M138.6,220.1 L140,230 L146.9,222.7" stroke="#7BB661" stroke-width="2.5"/>',
    '<path d="M240,129 Q320,180 325,340" stroke="#7BB661" stroke-width="2.5"/>',
    '<path d="M320.2,331.2 L325,340 L328.9,330.8" stroke="#7BB661" stroke-width="2.5"/>',
    '<path d="M218,127 Q70,170 68,340" stroke="#7BB661" stroke-width="2.5"/>',
    '<path d="M64.1,330.8 L68,340 L72.8,331.2" stroke="#7BB661" stroke-width="2.5"/>',
    '<path d="M230,135 Q220,190 210,240" stroke="#7BB661" stroke-width="2.5"/>',
    '<path d="M207.5,230.3 L210,240 L216,232" stroke="#7BB661" stroke-width="2.5"/>',
    text(245, 85, 'つむじ', { anchor: 'start', color: G, size: 20 }),
    text(200, 475, 'つむじから毛先へ流す', { size: 19 }),
    path('M405,120 Q405,264 459,360 Q495,252 495,120', { 'stroke-width': 3.5 }),
    line(510, 240, 540, 240, { 'stroke-width': 2 }),
    head(510, 240, 540, 240, { head: 11, width: 2 }),
    path('M555,120 Q555,256.8 581.4,348 Q599,245.4 599,120', { 'stroke-width': 3 }),
    path('M601,120 Q601,235.2 627.4,312 Q645,225.6 645,120', { 'stroke-width': 3 }),
    line(658, 240, 682, 240, { 'stroke-width': 2 }),
    head(658, 240, 682, 240, { head: 11, width: 2 }),
    path('M693,120 Q693,249.6 705,336 Q713,238.8 713,120', { 'stroke-width': 2 }),
    path('M711,120 Q711,228 723,300 Q731,219 731,120', { 'stroke-width': 2 }),
    path('M729,120 Q729,256.8 741,348 Q749,245.4 749,120', { 'stroke-width': 2 }),
    path('M747,120 Q747,220.8 759,288 Q767,212.4 767,120', { 'stroke-width': 2 }),
    text(450, 405, '大きな束', { size: 19 }),
    text(600, 405, '2つに分ける', { size: 19 }),
    text(730, 405, '細かく', { size: 19, color: G }),
    text(590, 90, '大きい束 → 小さい束の順に', { size: 19 }),
  ];
  svg('s4-hair-flow', body);
  lineartOf('s4-hair-flow', body, { drop: [4, 6, 8, 10, 14, 15, 18, 19] });
}

// 表情のパーツ：列ごとに表情名（喜び／怒り／悲しみ／驚き）
{
  const cols = [
    ['喜び', 260],
    ['怒り', 400],
    ['悲しみ', 540],
    ['驚き', 680],
  ];
  const brow = {
    喜び: (x, s) => path(`M${x - s * 14},142 Q${x},128 ${x + s * 14},140`, { 'stroke-width': 3 }),
    怒り: (x, s) => path(`M${x - s * 15},130 L${x + s * 14},146`, { 'stroke-width': 3.5 }),
    悲しみ: (x, s) => path(`M${x - s * 15},146 Q${x},142 ${x + s * 14},130`, { 'stroke-width': 3 }),
    驚き: (x, s) => path(`M${x - s * 14},138 Q${x},116 ${x + s * 14},134`, { 'stroke-width': 3 }),
  };
  // 目（s=-1 が左目、+1 が右目。外側＝目じり）
  const eye = {
    喜び: (x) => path(`M${x - 12},258 Q${x},238 ${x + 12},258`, { 'stroke-width': 3.5 }),
    怒り: (x, s) => [path(`M${x - s * 13},240 L${x + s * 12},250`, { 'stroke-width': 3.5 }), ell(x, 259, 6.5, 9)],
    悲しみ: (x) => [path(`M${x - 13},247 Q${x},236 ${x + 13},247`, { 'stroke-width': 3.5 }), ell(x, 256, 6.5, 10)],
    驚き: (x) => [ell(x, 250, 10, 15), dot(x, 252, 'currentColor', 3)],
  };
  const mouth = {
    喜び: (x) => path(`M${x - 17},348 Q${x},370 ${x + 17},348 Z`, { 'stroke-width': 3 }),
    怒り: (x) => path(`M${x - 17},362 L${x - 7},351 L${x + 7},351 L${x + 17},362`, { 'stroke-width': 3 }),
    悲しみ: (x) => path(`M${x - 15},362 Q${x},348 ${x + 15},362`, { 'stroke-width': 3 }),
    驚き: (x) => ell(x, 356, 8, 11, { 'stroke-width': 3 }),
  };
  svg('s4-expression-parts', [
    text(400, 38, '表情＝眉・目・口の3つの記号の組み合わせ', { size: 20 }),
    rect(472, 64, 136, 346, { rx: 12, stroke: G, 'stroke-width': 3 }),
    cols.map(([n, x]) => text(x, 92, n, { size: 20, weight: 700, color: n === '悲しみ' ? G : 'currentColor' })),
    line(180, 106, 750, 106, { 'stroke-width': 1, opacity: 0.3 }),
    text(120, 145, '眉', { size: 22, weight: 700 }),
    text(120, 257, '目', { size: 22, weight: 700 }),
    text(120, 364, '口', { size: 22, weight: 700 }),
    line(180, 195, 750, 195, { 'stroke-width': 1, opacity: 0.3 }),
    line(180, 305, 750, 305, { 'stroke-width': 1, opacity: 0.3 }),
    line(180, 410, 750, 410, { 'stroke-width': 1, opacity: 0.3 }),
    cols.map(([n, x]) => [
      brow[n](x - 27, -1), brow[n](x + 27, 1),
      eye[n](x - 27, -1), eye[n](x + 27, 1),
      mouth[n](x),
    ]),
    text(400, 455, '例: 悲しみ＝困り眉（内側が上がる）＋ふつうの目＋への字の口', { size: 18, color: G }),
  ]);
}

// 空と地面：地平線をキャラの首に重ねず、胸の高さに
{
  const HZ = 338;
  // 胴の左右の線（胸の高さでの x）
  const torsoL = (y) => 318 - (y - 300) * 0.12;
  const torsoR = (y) => 482 + (y - 300) * 0.12;
  svg('s8-sky-ground', [
    rect(80, 50, 640, 380, { rx: 4 }),
    path('M140,140 q20,-30 50,-10 q25,-25 55,0 q30,-5 30,20 q-10,20 -40,15 q-30,15 -60,0 q-35,5 -35,-25 Z', { opacity: 0.8 }),
    path('M560,215 q15,-20 40,-8 q20,-15 40,5 q15,10 -5,20 l-70,0 q-15,-5 -5,-17 Z', { opacity: 0.6 }),
    text(100, 80, '空：上ほど濃く、地平線近くは薄く', { size: 16, anchor: 'start' }),
    // 地平線（キャラの後ろ＝体のところで切る）
    line(80, HZ, torsoL(HZ) - 10, HZ, { stroke: G, 'stroke-width': 3 }),
    line(torsoR(HZ) + 10, HZ, 720, HZ, { stroke: G, 'stroke-width': 3 }),
    text(700, HZ - 12, '地平線（胸の高さ）', { size: 17, anchor: 'end', color: G }),
    [0, 1, 2, 3].map((k) => line(110 + k * 170, 370 + k * 12, 160 + k * 170, 370 + k * 12, { opacity: 0.5 })),
    // キャラ（胸から上）
    ell(400, 165, 50, 58),
    path('M348,170 Q340,95 400,92 Q462,95 452,170 L440,140 L424,160 L406,130 L388,158 L372,134 L356,160 Z'),
    path('M378,178 q8,-6 16,0'), path('M406,178 q8,-6 16,0'),
    path('M393,205 q7,4 14,0'),
    line(386, 221, 384, 250), line(414, 221, 416, 250),
    path(`M384,250 Q340,258 ${torsoL(300)},300 L${torsoL(430)},430`),
    path(`M416,250 Q460,258 ${torsoR(300)},300 L${torsoR(430)},430`),
    path('M384,250 Q400,270 416,250', { 'stroke-width': 2 }),
    // 首に重ねた悪い例（小さく）
    rect(560, 70, 130, 88, { rx: 3, 'stroke-width': 2 }),
    circle(625, 100, 15, { 'stroke-width': 2 }),
    path('M603,158 Q606,126 625,124 Q644,126 647,158', { 'stroke-width': 2 }),
    line(560, 121, 610, 121, { 'stroke-width': 2 }), line(640, 121, 690, 121, { 'stroke-width': 2 }),
    path('M672,78 l12,12 M684,78 l-12,12', { 'stroke-width': 2.5 }),
    text(625, 180, '首に重ねない', { size: 15 }),
    title('地平線＝見ている人の目の高さ。キャラの首に重ねず、胸や腰の高さに', 470, 19),
  ]);
}

// ================================================================== ステージ10（塗り）
const SKIN = '#F6D7C3';
const SH1 = '#E4AE95';
const SH2 = '#C98670';

// 1影・2影：2影は境界のすぐ先の帯、ふちは反射光で明るめ
{
  const r = 95;
  const cy = 215;
  const A = (cx) => [cx - 0.34 * r, cy - 0.34 * r, 1.05 * r];
  const Bc = (cx) => [cx - 0.26 * r, cy - 0.26 * r, 1.2 * r];
  const reach = ([x0, y0, R], cx, a) => {
    // 中心 (cx,cy) から角度 a の方向に進んだとき、円 (x0,y0,R) の境界までの距離
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const ox = cx - x0;
    const oy = cy - y0;
    const b = ox * dx + oy * dy;
    const c = ox * ox + oy * oy - R * R;
    return -b + Math.sqrt(b * b - c);
  };
  const ball = (cx, kind) => {
    const id = `s10-two-shadows-${kind}`;
    const a = A(cx);
    const b = Bc(cx);
    const inner =
      kind === 'flat'
        ? circle(cx, cy, r, { fill: SKIN, stroke: 'none' })
        : [
            circle(cx, cy, r, { fill: SH1, stroke: 'none' }),
            kind === 'two' ? circle(b[0], b[1], b[2], { fill: SH2, stroke: 'none' }) : null,
            circle(a[0], a[1], a[2], { fill: SKIN, stroke: 'none' }),
          ];
    return [
      `<clipPath id="${id}"><circle cx="${f(cx)}" cy="${f(cy)}" r="${r}"/></clipPath>`,
      `<g clip-path="url(#${id})">${[inner].flat(Infinity).filter(Boolean).join('')}</g>`,
      circle(cx, cy, r),
    ];
  };
  const cx3 = 650;
  const aBand = (100 * Math.PI) / 180;
  const tBand = (reach(A(cx3), cx3, aBand) + reach(Bc(cx3), cx3, aBand)) / 2;
  const bandP = [cx3 + tBand * Math.cos(aBand), cy + tBand * Math.sin(aBand)];
  const aRim = (25 * Math.PI) / 180;
  const tRim = (reach(Bc(cx3), cx3, aRim) + r) / 2;
  const rimP = [cx3 + tRim * Math.cos(aRim), cy + tRim * Math.sin(aRim)];
  svg('s10-two-shadows', [
    sun(55, 60),
    ball(150, 'flat'),
    ball(400, 'one'),
    ball(cx3, 'two'),
    text(150, 355, 'ベタ', { size: 22, weight: 700 }),
    text(150, 385, '基本色', { size: 16 }),
    text(400, 355, '1影', { size: 22, weight: 700 }),
    text(400, 385, '光が当たらない側', { size: 16 }),
    text(cx3, 355, '1影＋2影', { size: 22, weight: 700 }),
    text(cx3, 385, '2影は境界のすぐ先の帯', { size: 16 }),
    leader(572, 330, bandP[0], bandP[1]), text(566, 330, '2影', { size: 17, anchor: 'end' }),
    leader(748, 300, rimP[0], rimP[1]), text(758, 318, '反射光', { size: 17 }),
    title('2影は境界のすぐ先に細く。ふちは反射光で明るめに残す', 450, 19),
  ]);
}

// ================================================================== ステージ6（小物）

// 肩掛けバッグと剣：剣を握る手を「こぶし」に見える形に
{
  // 左半分（バッグ）は元の図のまま。行の順番は tools/gen-review-figures.mjs の線画変換と対応しているので変えない
  const bag = [
    '<circle cx="220" cy="32" r="25" stroke-dasharray="8 8" opacity="0.6"/>',
    '<line x1="230" y1="75" x2="229" y2="55" stroke-dasharray="8 8" opacity="0.6"/>',
    '<line x1="210" y1="75" x2="211" y2="55" stroke-dasharray="8 8" opacity="0.6"/>',
    '<ellipse cx="220" cy="120" rx="39" ry="52" stroke-dasharray="8 8" opacity="0.6"/>',
    '<path d="M181,215 L259,215 L259,259 L181,259 Z" stroke-dasharray="8 8" opacity="0.6"/>',
    '<line x1="162.3" y1="82.3" x2="152.9" y2="168.2" stroke-dasharray="8 8" opacity="0.6"/>',
    '<line x1="184.1" y1="84.9" x2="172.7" y2="170.6" stroke-dasharray="8 8" opacity="0.6"/>',
    '<line x1="153.3" y1="168.8" x2="149.6" y2="249.5" stroke-dasharray="8 8" opacity="0.6"/>',
    '<line x1="172.3" y1="170" x2="165.6" y2="250.5" stroke-dasharray="8 8" opacity="0.6"/>',
    '<line x1="255.9" y1="84.9" x2="267.3" y2="170.6" stroke-dasharray="8 8" opacity="0.6"/>',
    '<line x1="277.7" y1="82.3" x2="287.1" y2="168.2" stroke-dasharray="8 8" opacity="0.6"/>',
    '<line x1="267.7" y1="170" x2="274.4" y2="250.5" stroke-dasharray="8 8" opacity="0.6"/>',
    '<line x1="286.7" y1="168.8" x2="290.4" y2="249.5" stroke-dasharray="8 8" opacity="0.6"/>',
    '<path d="M254,80 Q236,150 162,246" stroke="#7BB661" stroke-width="3"/>',
    '<path d="M266,88 Q248,160 176,248" stroke="#7BB661" stroke-width="3"/>',
    '<path d="M120,246 L196,246 L200,318 Q158,334 116,318 Z"/>',
    '<path d="M120,246 L122,276 Q158,286 197,276" stroke-width="2"/>',
    '<line x1="158" y1="340" x2="158" y2="390" stroke="#7BB661" stroke-width="3"/>',
    '<path d="M151.9,377.4 L158,390 L164.1,377.4" stroke="#7BB661" stroke-width="3"/>',
    '<text x="158" y="418" font-size="18" fill="#7BB661" stroke="none" text-anchor="middle">重みで下へ</text>',
    '<text x="300" y="150" font-size="18" fill="currentColor" stroke="none" text-anchor="start">ベルトは体に</text>',
    '<text x="300" y="174" font-size="18" fill="currentColor" stroke="none" text-anchor="start">沿って曲がる</text>',
    '<text x="220" y="470" font-size="22" fill="currentColor" stroke="none" text-anchor="middle">肩掛けバッグ</text>',
  ];
  // 剣とこぶし（ローカル座標: 柄の軸＝x 軸、指の側＝+y。translate(590 318) rotate(-45) で置く）
  const fingers = [0, 1, 2, 3].map((k) => {
    const x = 26 - 20 * k;
    const bottom = 24 - k * 2;
    return [
      rect(x - 9.5, -12, 19, bottom + 12, { rx: 8 }),
      path(`M${x - 5},${bottom - 9} Q${x},${bottom - 5} ${x + 5},${bottom - 9}`, { 'stroke-width': 1.5 }),
    ];
  });
  const sword = [
    path('M58,-7 L236,-5 L258,0 L236,5 L58,7 Z'),
    line(72, 0, 226, 0, { 'stroke-width': 1.2 }),
    rect(52, -30, 8, 60, { rx: 2 }),
    path('M-44,-6 L-72,-6 M-44,6 L-72,6'),
    ell(-81, 0, 9, 11),
    // 手の甲（指の付け根まで）
    path('M-44,2 Q-52,-30 -38,-44 Q-10,-56 20,-51 Q38,-48 38,-30'),
    // 手首・前腕
    path('M-38,-44 L-78,-122 M16,-51 L-22,-128'),
    fingers,
    // 親指：人さし指の横から柄を押さえる
    path('M36,-44 Q56,-38 54,-12 Q52,4 43,4 Q36,2 37,-10', { 'stroke-width': 2.5 }),
  ];
  const T = 'translate(590 318) rotate(-45)';
  const k = Math.SQRT1_2;
  const P = (x, y) => [590 + k * x + k * y, 318 - k * x + k * y];
  const body = [
    ...bag,
    line(440, 40, 440, 460, { ...DASH, 'stroke-width': 1.5 }),
    `<g transform="${T}">${sword.flat(Infinity).join('')}</g>`,
    line(...P(-112, 0), ...P(262, 0), { stroke: G, 'stroke-width': 2, 'stroke-dasharray': '6 6' }),
    text(650, 400, '握りの軸（緑の点線）が', { size: 18, color: G }),
    text(650, 424, '手の円柱（こぶし）を貫く', { size: 18, color: G }),
    text(600, 470, '剣', { size: 22 }),
  ];
  svg('s6-bag-weapon', body);
  lineartOf('s6-bag-weapon', body, { drop: [17, 18], solid: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] });
}

// ================================================================== ステージ3・5（ジェスチャー）

// シルエット：緑の弧は「体の流れ」を指す
{
  const flow = [[562, 96], [500, 136], [440, 182], [402, 250], [366, 310], [334, 360], [306, 408], [288, 440]];
  const fp = flow[flow.length - 1];
  svg('gesture-silhouette', [
    path('M455,55 C485,70 480,110 455,118 L500,125 L545,95 L555,110 L500,160 L440,200 L420,245 L445,350 L465,455 L430,455 L395,345 L370,300 L345,350 L300,450 L270,445 L330,330 L355,250 L385,170 L420,120 C405,100 420,50 455,55 Z', {
      fill: 'currentColor',
      'fill-opacity': 0.25,
      'stroke-width': 3,
    }),
    // 体の流れ（手先 → 胴 → 後ろ足）
    path(smooth(flow), { stroke: G, 'stroke-width': 4 }),
    head(flow[flow.length - 2][0], flow[flow.length - 2][1], fp[0], fp[1], { color: G, width: 4, head: 16 }),
    text(586, 72, '手先から足先への流れ', { size: 18, anchor: 'start', color: G }),
    // 脚のすき間（形として見る）
    path('M370,306 L392,350 L424,448 L306,448 L348,354 Z', { stroke: G, 'stroke-width': 2, 'stroke-dasharray': '5 6' }),
    text(368, 436, 'すき間', { size: 16, color: G }),
    text(130, 396, '脚のすき間（緑の点線）も', { size: 18, color: G }),
    text(130, 420, '形として見る', { size: 18, color: G }),
    text(650, 200, '中を塗りつぶして', { size: 18 }),
    text(650, 228, '外形だけで動きが', { size: 18 }),
    text(650, 256, '伝わるか見る', { size: 18 }),
    title('シルエットで読めるポーズは、線画でも伝わる', 485),
  ]);
}

// ================================================================== 新規：ステージ4（頭部）

// Loomis の頭（正面・横）：眉＝赤道、生え際と鼻＝側面の円の上端・下端（球より内側）
{
  const r = 110;
  const cy = 180;
  const d = 0.65 * r; // 側面の切り落とし面までの距離
  const rc = Math.sqrt(r * r - d * d); // 切り落とし円の半径
  const yTop = cy - r;
  const yHair = cy - rc;
  const yNose = cy + rc;
  const yChin = cy + 2 * rc;
  const FX = 190; // 正面
  const SX = 500; // 横（顔は右向き）
  const LX = 660; // ガイド線の右端
  const guide = (y, x0) => line(x0, y, LX, y, { 'stroke-width': 1.3, opacity: 0.4, 'stroke-dasharray': '4 6' });
  svg('s4-loomis-corrected', [
    // 高さのガイド
    guide(yTop, FX), guide(yHair, FX - 40), guide(cy, FX - r), guide(yNose, FX - 40), guide(yChin, FX),
    // --- 正面
    circle(FX, cy, r),
    ell(FX - d, cy, rc * 0.2, rc, { 'stroke-width': 2 }),
    ell(FX + d, cy, rc * 0.2, rc, { 'stroke-width': 2 }),
    line(FX - r, cy, FX + r, cy, { stroke: G, 'stroke-width': 4 }),
    line(FX, yTop - 10, FX, yChin + 10, { ...DASH, 'stroke-width': 1.8 }),
    path(`M${FX - d},${yNose} Q${FX - d + 8},${yNose + rc * 0.7} ${FX},${yChin} Q${FX + d - 8},${yNose + rc * 0.7} ${FX + d},${yNose}`),
    dot(FX - d, yHair, G, 5), dot(FX + d, yHair, G, 5), dot(FX - d, yNose, G, 5), dot(FX + d, yNose, G, 5),
    text(FX, 420, '正面', { size: 20, weight: 700 }),
    // --- 横
    circle(SX, cy, r),
    circle(SX, cy, rc, { stroke: G, 'stroke-width': 3 }),
    line(SX - r, cy, SX + r + 12, cy, { stroke: G, 'stroke-width': 4 }),
    // 顔の前面（眉 → 鼻 → あご）とあごの線
    path(`M${SX + r},${cy} L${SX + r + 4},${yNose} Q${SX + r},${yChin} ${SX + r - 22},${yChin}`),
    path(`M${SX - rc * 0.35},${cy + rc * 0.94} Q${SX + 20},${yChin - 22} ${SX + r - 22},${yChin}`),
    dot(SX, yHair, G, 5), dot(SX, yNose, G, 5),
    text(SX, 420, '横', { size: 20, weight: 700 }),
    // 高さの名前
    text(LX + 10, yTop + 6, '頭頂', { size: 17, anchor: 'start' }),
    text(LX + 10, yHair + 6, '生え際', { size: 17, anchor: 'start', color: G }),
    text(LX + 10, cy + 6, '眉＝赤道', { size: 17, anchor: 'start', color: G }),
    text(LX + 10, yNose + 6, '鼻', { size: 17, anchor: 'start', color: G }),
    text(LX + 10, yChin + 6, 'あご', { size: 17, anchor: 'start' }),
    title('生え際と鼻は、側面の円（緑）の上端と下端。球の輪郭より内側にある', 462, 18),
    title('頭頂は生え際よりさらに上。生え際〜眉、眉〜鼻、鼻〜あごはほぼ同じ間隔', 488, 17),
  ]);
}

// 3/4 の顔：奥側の輪郭（目のくぼみ・頬骨・あご）
{
  const far = [[342, 158], [332, 200], [336, 216], [346, 236], [338, 256], [330, 272], [336, 300], [346, 334], [366, 378], [398, 412]];
  svg('s4-face-34-contour', [
    circle(458, 185, 120, { ...DASH, 'stroke-width': 1.8 }),
    // 近い側の輪郭（頭頂 → 後頭部 → あごの角 → あご先）
    path('M342,158 Q360,70 458,66 Q576,70 578,188 Q578,262 552,300 Q538,322 524,336 Q470,392 398,412'),
    // 奥側の輪郭（緑）
    path(smooth(far), { stroke: G, 'stroke-width': 4 }),
    // 中心線（顔の向き）
    path('M402,70 Q378,180 374,262 Q374,350 398,412', { ...DASH, 'stroke-width': 1.8 }),
    // 目・眉（奥の目は小さく細く）
    path('M356,232 Q366,224 382,230', { 'stroke-width': 3.5 }), ell(369, 242, 5, 9),
    path('M412,232 Q440,216 470,228', { 'stroke-width': 3.5 }), ell(441, 244, 11, 15),
    path('M352,212 Q366,204 380,208'), path('M410,206 Q440,194 470,204'),
    // 鼻・口
    path('M386,246 L366,300 L386,305'),
    path('M370,348 Q390,354 410,347'),
    // 耳
    path('M520,232 Q548,222 552,258 Q554,296 526,300'),
    // 番号
    num(288, 280, 1, G), leader(303, 278, 326, 274, G),
    num(290, 230, 2, G), leader(305, 231, 340, 236, G),
    num(300, 372, 3, G), leader(315, 366, 348, 348, G),
    text(40, 130, '奥側の輪郭（緑）は', { size: 18, anchor: 'start' }),
    text(40, 156, 'でこぼこしている', { size: 18, anchor: 'start' }),
    numLabel(620, 150, 1, '頬骨のふくらみ', G, 18),
    numLabel(620, 200, 2, '目のくぼみ', G, 18),
    numLabel(620, 250, 3, 'あごの線', G, 18),
    title('3/4 の顔は、奥側の輪郭を「くぼみ → ふくらみ → あご」と追って描く', 470, 19),
  ]);
}

// 顔の向きと側面の楕円：正面＝縦に細い、3/4＝太め、横＝ほぼ円
{
  const r = 95;
  const cy = 200;
  const d = 0.65 * r;
  const rc = Math.sqrt(r * r - d * d);
  const panel = (cx, deg, name, sub) => {
    const a = (deg * Math.PI) / 180;
    const ex = cx + d * Math.cos(a); // 近い側の切り落とし円の中心
    const rx = Math.max(rc * Math.sin(a), 3);
    const mx = cx - r * Math.sin(a); // 顔の中心線（経線）の位置
    const out = [
      circle(cx, cy, r),
      line(cx - r, cy, cx + r, cy, { ...DASH, 'stroke-width': 1.5 }),
      ell(ex, cy, rx, rc, { stroke: G, 'stroke-width': 3.5 }),
    ];
    if (deg < 30) out.push(ell(cx - d * Math.cos(a), cy, rx, rc, { 'stroke-width': 2, opacity: 0.6 }));
    // 顔の中心線：経線（楕円の半分）
    const mrx = Math.abs(mx - cx);
    if (deg < 85) out.push(path(`M${f(cx)},${cy - r} A${f(mrx)},${r} 0 0 0 ${f(cx)},${cy + r}`, { 'stroke-width': 2 }));
    out.push(
      text(cx, 350, name, { size: 21, weight: 700 }),
      text(cx, 378, sub, { size: 17, color: G }),
    );
    return out;
  };
  svg('s4-side-oval-by-angle', [
    panel(150, 12, '正面', '縦に細い楕円'),
    panel(400, 50, '3/4', '太めの楕円'),
    panel(650, 90, '横', 'ほぼ円'),
    text(650, cy - r - 14, '（顔は左向き）', { size: 15 }),
    text(400, cy - r - 14, '（顔は左向き）', { size: 15 }),
    title('顔が横を向くほど、側面の切り落とし（緑）は太くなり、円に近づく', 450, 19),
  ]);
}

// ================================================================== 新規：ステージ2（立体・パース）

// 短縮：こちらを向いた円柱と箱（横向きとの比較）
{
  svg('s2-foreshorten-cylinder', [
    line(400, 40, 400, 420, { ...DASH, 'stroke-width': 1.5 }),
    text(200, 50, '横向き', { size: 21, weight: 700 }),
    text(600, 50, 'こちら向き', { size: 21, weight: 700, color: G }),
    // 左上：横向きの円柱
    line(90, 100, 290, 100), line(90, 190, 290, 190),
    path('M90,100 A16,45 0 0 0 90,190', { ...DASH, 'stroke-width': 2 }),
    path('M90,100 A16,45 0 0 1 90,190'),
    ell(290, 145, 16, 45),
    dim(90, 214, 290, 214, { head: 8, width: 1.8 }),
    text(190, 238, '長さがそのまま見える', { size: 16 }),
    // 右上：こちら向きの円柱（手前の円が大きく、胴は短い）
    (() => {
      // 手前の円 C1（大）と奥の円 C2（小）。外側の接線 2 本と、奥の円の見える部分
      const C1 = [590, 152, 50];
      const C2 = [634, 120, 43];
      const D = Math.hypot(C2[0] - C1[0], C2[1] - C1[1]);
      const ua = Math.atan2(C2[1] - C1[1], C2[0] - C1[0]);
      const th = Math.acos((C1[2] - C2[2]) / D);
      const tp = (C, a) => [C[0] + C[2] * Math.cos(a), C[1] + C[2] * Math.sin(a)];
      const back = [];
      for (let i = 0; i <= 40; i++) back.push(tp(C2, ua - th + (2 * th * i) / 40));
      const hidden = [];
      for (let i = 0; i <= 40; i++) hidden.push(tp(C2, ua + th + ((2 * Math.PI - 2 * th) * i) / 40));
      return [
        line(...tp(C1, ua - th), ...tp(C2, ua - th)),
        line(...tp(C1, ua + th), ...tp(C2, ua + th)),
        path(smooth(back)),
        path(smooth(hidden), { ...DASH, 'stroke-width': 2 }),
        circle(C1[0], C1[1], C1[2], { stroke: G, 'stroke-width': 3.5 }),
      ];
    })(),
    dim(640, 214, 682, 190, { head: 7, width: 1.8, color: G }),
    text(600, 238, '奥行きが短く見える（短縮）', { size: 16, color: G }),
    // 左下：横向きの箱
    path('M80,300 L300,300 L300,370 L80,370 Z'),
    path('M80,300 L112,276 L332,276 L300,300 M332,276 L332,346 L300,370'),
    dim(80, 394, 300, 394, { head: 8, width: 1.8 }),
    text(190, 418, '長い辺が長く見える', { size: 16 }),
    // 右下：こちら向きの箱（正面の面が大きく、奥行きは短い）
    path('M540,290 L630,290 L630,380 L540,380 Z', { stroke: G, 'stroke-width': 3.5 }),
    path('M540,290 L566,268 L646,268 L630,290 M646,268 L646,350 L630,380'),
    dim(632, 396, 650, 366, { head: 6, width: 1.8, color: G }),
    text(600, 418, '手前の面が大きく、奥行きは短い', { size: 16, color: G }),
    title('同じ円柱・箱でも、こちらを向くと長さが縮んで見える（短縮）', 470, 19),
  ]);
}

// 自由に描いた箱 3 つ → 辺をのばして消失点に集まるか確かめる
{
  const small = [20, 45, 70].map((rot, i) =>
    box3d({ cx: 150 + i * 250, horizon: 16, f: 360, eyeH: 3.2, Z0: 9, w: 2.4, d: 1.8, h: 1.4, rotDeg: rot }),
  );
  // 確かめる箱（2点透視・地平線 y=270）
  const HZ = 270;
  const F = 300;
  const t = (40 * Math.PI) / 180;
  const b = box3d({ cx: 400, horizon: HZ, f: F, eyeH: 2.4, Z0: 6.5, w: 2.2, d: 2.2, h: 1.2, rotDeg: 40 });
  const vpA = [400 + F / Math.tan(t), HZ];
  const vpB = [400 - F * Math.tan(t), HZ];
  // 各辺の向き → どちらの消失点に向かうか
  const ext = b.edges
    .filter((e) => Math.abs(b.V[e.a].Y - b.V[e.b].Y) < 1e-6)
    .map((e) => {
      const pa = b.pts[e.a];
      const pb = b.pts[e.b];
      const dA = Math.abs((pb[1] - pa[1]) * (vpA[0] - pa[0]) - (pb[0] - pa[0]) * (vpA[1] - pa[1]));
      const dB = Math.abs((pb[1] - pa[1]) * (vpB[0] - pa[0]) - (pb[0] - pa[0]) * (vpB[1] - pa[1]));
      const vp = dA < dB ? vpA : vpB;
      const near = Math.hypot(pa[0] - vp[0], pa[1] - vp[1]) < Math.hypot(pb[0] - vp[0], pb[1] - vp[1]) ? pa : pb;
      return line(...near, ...vp, { stroke: G, 'stroke-width': 1.4, 'stroke-dasharray': '5 6' });
    });
  svg('s2-box-freehand', [
    text(40, 40, '① 角度を変えて、自由に3つ描く', { size: 18, anchor: 'start' }),
    small.map((bx) => drawBox(bx, { width: 2.5 })),
    line(40, 205, 760, 205, { 'stroke-width': 1, opacity: 0.3 }),
    text(40, 238, '② 辺をのばして、消失点に集まるか確かめる', { size: 18, anchor: 'start' }),
    line(30, HZ, 770, HZ, GUIDE),
    ext,
    drawBox(b, { width: 3 }),
    dot(...vpA, G, 7), dot(...vpB, G, 7),
    text(vpA[0], HZ - 14, '消失点', { size: 15, color: G }),
    text(vpB[0], HZ - 14, '消失点', { size: 15, color: G }),
    text(40, HZ + 22, '目の高さ', { size: 15, anchor: 'start' }),
    title('同じ向きの辺が1点に集まれば OK。ずれた辺は描き直す', 480, 19),
  ]);
}

// ================================================================== 新規：ステージ1（確認のしかた）

// 左右反転で対称のズレを見る
{
  // わずかに左右非対称な顔（左のあごがふくらみ、目の高さが少しずれている）
  const face = (cx, s) => {
    const X = (x) => cx + s * (x - 200);
    const pts = [[200, 70], [262, 90], [292, 160], [290, 230], [272, 300], [232, 352], [200, 364], [160, 350], [118, 300], [104, 230], [108, 160], [138, 90]];
    return {
      outline: smooth(pts.map(([x, y]) => [X(x), y]), true),
      eyes: [
        path(`M${X(142)},${200} Q${X(162)},${186} ${X(182)},${198}`, { 'stroke-width': 3 }),
        path(`M${X(218)},${208} Q${X(238)},${194} ${X(258)},${206}`, { 'stroke-width': 3 }),
      ],
      center: line(cx, 60, cx, 380, { ...DASH, 'stroke-width': 1.5 }),
      nose: path(`M${X(202)},${250} L${X(196)},${268} L${X(204)},${270}`, { 'stroke-width': 2 }),
      mouth: path(`M${X(184)},${306} Q${X(200)},${314} ${X(216)},${306}`, { 'stroke-width': 2 }),
    };
  };
  const a = face(200, 1);
  const b = face(600, -1);
  const ghost = face(600, 1);
  svg('s1-flip-check', [
    path(a.outline), a.eyes, a.center, a.nose, a.mouth,
    text(200, 410, '反転前', { size: 20, weight: 700 }),
    text(200, 436, 'ズレに目が慣れて気づきにくい', { size: 16 }),
    path('M330,210 Q400,170 470,210', { 'stroke-width': 2.5 }), head(430, 188, 470, 210, { head: 13, width: 2.5 }),
    text(400, 170, '左右反転', { size: 18, color: G }),
    path(ghost.outline, { ...DASH, 'stroke-width': 1.8 }),
    path(b.outline), b.eyes, b.center, b.nose, b.mouth,
    ell(700, 300, 44, 60, { stroke: G, 'stroke-width': 2.5, rot: -20 }),
    text(752, 380, 'ふくらみ', { size: 16, color: G }),
    text(600, 410, '反転後', { size: 20, weight: 700 }),
    text(600, 436, 'ゆがみが目立つ（点線＝反転前）', { size: 16 }),
    title('描いたら左右反転して見る。目の高さ・あごのふくらみのズレが見つかる', 480, 18),
  ]);
}

// ================================================================== 新規：ステージ8（構図）

// キャラと目の高さ：アオリ・目の高さ・俯瞰
{
  // 立ち姿（頭頂 top・足元 bottom）の簡単なキャラ
  const chara = (cx, top) => {
    const s = (y) => top + y; // 高さ 300
    return [
      circle(cx, s(28), 24),
      line(cx - 6, s(52), cx - 6, s(62)), line(cx + 6, s(52), cx + 6, s(62)),
      path(`M${cx - 30},${s(70)} Q${cx},${s(60)} ${cx + 30},${s(70)} L${cx + 26},${s(160)} L${cx - 26},${s(160)} Z`),
      path(`M${cx - 30},${s(72)} L${cx - 40},${s(150)} M${cx + 30},${s(72)} L${cx + 40},${s(150)}`),
      path(`M${cx - 26},${s(160)} L${cx - 20},${s(290)} M${cx - 2},${s(170)} L${cx - 6},${s(290)} M${cx + 2},${s(170)} L${cx + 6},${s(290)} M${cx + 26},${s(160)} L${cx + 20},${s(290)}`),
      path(`M${cx - 20},${s(290)} L${cx - 30},${s(298)} M${cx + 20},${s(290)} L${cx + 30},${s(298)}`),
    ];
  };
  const P = [
    [140, 'アオリ', '地平線が腰', 60 + 165],
    [400, '目の高さ', '地平線が目', 60 + 28],
    [660, '俯瞰', '地平線が頭の上', 60 - 20],
  ];
  const top = 100;
  svg('s8-eyelevel-character', [
    P.map(([cx, name, sub, hz0], i) => {
      const hz = i === 0 ? top + 160 : i === 1 ? top + 28 : top - 34;
      const half = i === 0 ? 46 : i === 1 ? 30 : 0;
      return [
        rect(cx - 115, 50, 230, 362, { rx: 4, 'stroke-width': 2 }),
        chara(cx, top),
        half
          ? [line(cx - 115, hz, cx - half, hz, { stroke: G, 'stroke-width': 3 }), line(cx + half, hz, cx + 115, hz, { stroke: G, 'stroke-width': 3 })]
          : line(cx - 115, hz, cx + 115, hz, { stroke: G, 'stroke-width': 3 }),
        text(cx, 36, name, { size: 21, weight: 700 }),
        text(cx, 438, sub, { size: 18, color: G }),
      ];
    }),
    title('地平線（目の高さ）がキャラのどこを通るかで、見上げ・水平・見下ろしが決まる', 470, 17),
  ]);
}

// ================================================================== 新規：ステージ10（塗り）

// 目の塗り：①虹彩のグラデーション（上が暗い） ②上まぶたの落ち影 ③ハイライト
{
  const eyeOpen = 'M130,250 Q210,120 380,150 Q430,160 450,205 Q440,300 380,352 Q280,382 200,350 Q150,320 130,250 Z';
  svg('s10-eye-paint', [
    `<defs><linearGradient id="s10-eye-paint-iris" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4A3C7A"/><stop offset="0.5" stop-color="#7D69BC"/><stop offset="1" stop-color="#CBBDF2"/></linearGradient>` +
      `<clipPath id="s10-eye-paint-open"><path d="${eyeOpen}"/></clipPath></defs>`,
    `<g clip-path="url(#s10-eye-paint-open)">` +
      [
        path(eyeOpen, { fill: '#FFFFFF', stroke: 'none' }),
        ell(290, 262, 82, 112, { fill: 'url(#s10-eye-paint-iris)', stroke: 'none' }),
        ell(290, 276, 32, 48, { fill: '#241B3E', stroke: 'none' }),
        // 上まぶたの落ち影（白目と虹彩の上に、まぶたの形に沿った帯）
        path('M120,250 Q210,112 380,142 Q440,152 460,205 L460,236 Q432,200 380,196 Q220,176 140,286 Z', { fill: '#1E1830', 'fill-opacity': 0.5, stroke: 'none' }),
        circle(256, 232, 20, { fill: '#FFFFFF', stroke: 'none' }),
        circle(320, 318, 8, { fill: '#FFFFFF', stroke: 'none' }),
        ell(290, 262, 82, 112, { 'stroke-width': 2 }),
      ].join('') +
      '</g>',
    path('M118,258 Q210,112 382,142 Q436,152 458,208', { 'stroke-width': 9 }),
    path('M160,318 Q200,352 280,368 Q350,370 400,336', { 'stroke-width': 2.5 }),
    // 番号
    num(150, 360, 1, G), leader(164, 354, 222, 330, G),
    num(470, 150, 2, G), leader(456, 158, 420, 192, G),
    num(200, 100, 3, G), leader(209, 112, 247, 216, G),
    numLabel(540, 170, 1, '虹彩のグラデーション', G, 18),
    text(564, 196, '（上が暗く、下が明るい）', { size: 16, anchor: 'start' }),
    numLabel(540, 250, 2, '上まぶたの落ち影', G, 18),
    text(564, 276, '（まぶたの形に沿った帯）', { size: 16, anchor: 'start' }),
    numLabel(540, 330, 3, 'ハイライト', G, 18),
    text(564, 356, '（光源側に大、反対に小）', { size: 16, anchor: 'start' }),
    title('目は「上が暗い」が基本。まぶたの影で奥行き、ハイライトで光を入れる', 460, 19),
  ]);
}

// 顔の影の型：前髪の影・鼻の横・首の影・耳の下
{
  const HAIR = '#7A5A48';
  // 顔（光は左上から）
  const faceD = 'M290,120 L290,170 Q290,300 330,350 Q370,400 400,402 Q430,400 470,350 Q510,300 510,170 L510,120 Z';
  const bangsD = 'M270,190 Q262,70 400,62 Q538,70 530,190 L512,210 L498,160 L470,200 L446,150 L418,196 L392,146 L366,196 L340,152 L318,200 L300,160 L286,214 Z';
  svg('s10-face-shadows', [
    `<defs><clipPath id="s10-face-shadows-face"><path d="${faceD}"/></clipPath></defs>`,
    // 首
    path('M362,380 L360,460 L440,460 L438,380 Z', { fill: SKIN, stroke: 'none' }),
    // 首の影（あごの形で落ちる）
    path('M361,392 L360,432 Q400,450 440,432 L439,392 Q400,420 361,392 Z', { fill: SH1, stroke: 'none' }),
    line(362, 380, 360, 460), line(438, 380, 440, 460),
    // 耳と耳の下の影
    path('M510,230 Q540,222 540,262 Q538,300 506,306 Z', { fill: SKIN, stroke: 'none' }),
    path('M510,230 Q540,222 540,262 Q538,300 506,306'),
    path('M290,230 Q260,222 260,262 Q262,300 294,306 Z', { fill: SKIN, stroke: 'none' }),
    path('M290,230 Q260,222 260,262 Q262,300 294,306'),
    // 顔
    path(faceD, { fill: SKIN, stroke: 'none' }),
    `<g clip-path="url(#s10-face-shadows-face)">` +
      [
        // 前髪の影（前髪のギザギザを下にずらした形）
        path('M280,196 L300,176 L318,222 L340,174 L366,218 L392,168 L418,218 L446,172 L470,222 L498,182 L512,232 L520,120 L280,120 Z', { fill: SH1, stroke: 'none' }),
        // 耳の下（あごの付け根の奥）
        path('M520,296 L498,296 Q488,326 456,352 L412,392 L520,392 Z', { fill: SH1, stroke: 'none' }),
        // 鼻の横（光と反対側）
        path('M404,262 L416,300 L402,306 Z', { fill: SH1, stroke: 'none' }),
      ].join('') +
      '</g>',
    path(faceD.replace(' Z', ''), {}),
    // 耳の下の影（耳の下端から首へ）
    // 目・鼻・口
    path('M330,250 Q350,236 372,246', { 'stroke-width': 4 }), ell(352, 262, 10, 15, { fill: '#5B4A8A', stroke: 'none' }),
    path('M470,250 Q450,236 428,246', { 'stroke-width': 4 }), ell(448, 262, 10, 15, { fill: '#5B4A8A', stroke: 'none' }),
    path('M404,290 L400,304 L406,306', { 'stroke-width': 2 }),
    path('M384,338 Q400,346 416,338', { 'stroke-width': 2 }),
    // 髪（前髪）
    path(bangsD, { fill: HAIR, stroke: 'currentColor' }),
    // 番号
    num(222, 200, 1, G), leader(237, 202, 300, 200, G),
    text(200, 207, '前髪の影', { size: 17, anchor: 'end', color: G }),
    num(600, 290, 2, G), leader(585, 290, 414, 290, G),
    text(622, 297, '鼻の横', { size: 17, anchor: 'start', color: G }),
    num(250, 420, 3, G), leader(265, 420, 368, 414, G),
    text(228, 427, '首の影', { size: 17, anchor: 'end', color: G }),
    num(600, 350, 4, G), leader(585, 348, 486, 322, G),
    text(622, 357, '耳の下', { size: 17, anchor: 'start', color: G }),
    title('光は左上。影は「前髪・鼻の横・首・耳の下」の決まった形で置く', 485, 18),
  ]);
}

// ================================================================== 新規：ステージ9（色）

// 色の面積比 70 / 25 / 5
{
  const BASE = '#DDE6EE';
  const MAIN = '#3E5A86';
  const ACC = '#E0473C';
  const SKINc = '#F6D7C3';
  svg('s9-area-ratio', [
    // 帯
    rect(60, 60, 476, 50, { fill: BASE, stroke: 'none' }),
    rect(536, 60, 170, 50, { fill: MAIN, stroke: 'none' }),
    rect(706, 60, 34, 50, { fill: ACC, stroke: 'none' }),
    rect(60, 60, 680, 50, { 'stroke-width': 2 }),
    text(298, 140, 'ベース 70%', { size: 19 }),
    text(621, 140, 'メイン 25%', { size: 19 }),
    text(723, 140, '5%', { size: 17 }),
    text(723, 162, 'アクセント', { size: 14 }),
    // キャラの配色例（服＝ベース、髪・目＝メイン、リボン＝アクセント）。帯と重ならないよう縮めて下へ
    '<g transform="translate(44 123) scale(0.72)" stroke-width="3.2">',
    path('M250,300 Q250,250 300,242 L340,236 L372,236 L412,242 Q462,250 462,300 L470,440 L242,440 Z', { fill: BASE }),
    path('M318,236 L356,290 L394,236', { 'stroke-width': 2.6 }),
    path('M338,244 L356,268 L374,244 L382,262 L356,278 L330,262 Z', { fill: ACC }),
    rect(340, 206, 32, 34, { fill: SKINc }),
    ell(356, 160, 52, 60, { fill: SKINc }),
    path('M300,170 Q288,90 356,86 Q424,90 412,170 L404,140 L386,158 L370,124 L352,156 L336,126 L318,158 L308,140 Z', { fill: MAIN }),
    path('M300,160 Q292,220 304,262 L318,258 Q308,210 312,170 Z', { fill: MAIN }),
    path('M412,160 Q420,220 408,262 L394,258 Q404,210 400,170 Z', { fill: MAIN }),
    circle(336, 170, 6, { fill: MAIN, stroke: 'none' }), circle(376, 170, 6, { fill: MAIN, stroke: 'none' }),
    path('M348,194 Q356,199 364,194', { 'stroke-width': 2.6 }),
    '</g>',
    // 対応の見出し
    rect(540, 220, 26, 26, { fill: BASE, 'stroke-width': 1.5 }), text(578, 240, '服（広い面）＝ベース', { size: 17, anchor: 'start' }),
    rect(540, 280, 26, 26, { fill: MAIN, 'stroke-width': 1.5 }), text(578, 300, '髪・目＝メイン', { size: 17, anchor: 'start' }),
    rect(540, 340, 26, 26, { fill: ACC, 'stroke-width': 1.5 }), text(578, 360, 'リボン＝アクセント', { size: 17, anchor: 'start' }),
    text(578, 385, '（小さく1か所）', { size: 15, anchor: 'start' }),
    title('広い面ほど落ち着いた色。目立つ色はほんの少しだけ', 482, 19),
  ]);
}

// ================================================================== 新規：ステージ6（服のしわ）

// プリーツスカート：山と谷、裾のジグザグ
{
  const N = 10;
  const wc = [230, 110];
  const wrx = 80;
  const wry = 16;
  const hc = [230, 350];
  const hrx = 150;
  const hry = 34;
  const waist = [];
  const hem = [];
  for (let i = 0; i <= N; i++) {
    const a = Math.PI - (Math.PI * i) / N; // 左 → 右（手前半分）
    const mountain = i % 2 === 0;
    waist.push([wc[0] + wrx * Math.cos(a), wc[1] + wry * Math.sin(a)]);
    const dy = mountain ? 0 : -18;
    hem.push([hc[0] + hrx * Math.cos(a), hc[1] + hry * Math.sin(a) + dy]);
  }
  const folds = [];
  for (let i = 1; i < N; i++) {
    const mountain = i % 2 === 0;
    folds.push(line(...waist[i], ...hem[i], mountain ? { 'stroke-width': 2.5 } : { 'stroke-width': 1.5, opacity: 0.7 }));
    // 谷の右側（光と反対）を薄く塗る
    if (!mountain) folds.push(path(poly([waist[i], waist[i + 1], hem[i + 1], hem[i]], true), { fill: 'currentColor', 'fill-opacity': 0.12, stroke: 'none' }));
  }
  // 右：裾を上から見たジグザグ
  const zig = [];
  for (let i = 0; i <= 12; i++) zig.push([500 + i * 22, i % 2 === 0 ? 300 : 260]);
  svg('s6-pleats', [
    ell(...wc, wrx, wry, { 'stroke-width': 3 }),
    line(...waist[0], ...hem[0]), line(...waist[N], ...hem[N]),
    folds,
    path(poly(hem), { stroke: G, 'stroke-width': 3.5 }),
    num(46, 110, 1), text(46, 146, 'ウエスト', { size: 15 }),
    num(46, 230, 2), text(46, 266, '山と谷', { size: 15 }),
    num(46, 370, 3, G), text(46, 406, '裾', { size: 15, color: G }),
    text(230, 440, 'ウエストから放射状に折り線', { size: 17 }),
    // 右の図
    text(632, 110, '裾を真上から見ると', { size: 18 }),
    text(632, 136, 'ジグザグ（山・谷・山…）', { size: 18, color: G }),
    path(poly(zig), { stroke: G, 'stroke-width': 3.5 }),
    [0, 2, 4, 6, 8, 10, 12].map((i) => dot(...zig[i], 'currentColor', 4)),
    text(500, 330, '山', { size: 17 }), text(522, 246, '谷', { size: 17 }),
    arrow(632, 360, 632, 318, { width: 2 }),
    text(632, 384, '見る人の側', { size: 16 }),
    text(632, 420, '山は手前に出て、裾が下がる', { size: 17 }),
    text(632, 444, '谷は奥に入り、裾が上がる', { size: 17 }),
    title('① ウエストの楕円 → ② 山・谷の折り線を交互に → ③ 裾をジグザグにつなぐ', 484, 17),
  ]);
}

// 関節以外の支点から出るシワ（胸の頂点・ベルト・肩掛け）
{
  svg('s6-fold-anchors', [
    // 体（シャツ）
    path('M300,60 Q260,70 230,80 L200,190 L240,200 L250,150 L256,300 L254,360 L446,360 L444,300 L450,150 L460,200 L500,190 L470,80 Q440,70 400,60 Q350,80 300,60 Z'),
    path('M300,60 Q350,100 400,60', { 'stroke-width': 2 }),
    // ベルト
    path('M254,300 L446,300 L446,322 L254,322 Z', { 'stroke-width': 2.5 }),
    rect(338, 298, 24, 26, { rx: 3, 'stroke-width': 2 }),
    // 肩掛け（左肩 → 右腰）
    path('M282,66 L448,300 M306,62 L452,268', { stroke: 'currentColor', 'stroke-width': 3 }),
    // 支点（緑）
    dot(300, 150, G, 7), dot(400, 150, G, 7), dot(350, 300, G, 7), dot(296, 70, G, 7),
    // ① 胸の頂点から下へ垂れるシワ
    path('M296,160 Q282,210 274,286', { 'stroke-width': 2.2 }), path('M300,160 Q300,220 298,280', { 'stroke-width': 2.2 }), path('M305,160 Q318,210 326,262', { 'stroke-width': 2.2 }),
    path('M400,160 Q400,176 398,190', { 'stroke-width': 2.2 }), path('M405,160 Q412,184 414,210', { 'stroke-width': 2.2 }), path('M410,158 Q428,180 436,212', { 'stroke-width': 2.2 }),
    // ② ベルトで絞った所から放射状（上へ・下へ）
    path('M342,296 Q320,286 290,284', { 'stroke-width': 2.2 }), path('M346,294 Q336,276 318,266', { 'stroke-width': 2.2 }),
    path('M356,294 Q366,276 384,268', { 'stroke-width': 2.2 }), path('M360,296 Q384,288 414,288', { 'stroke-width': 2.2 }),
    path('M344,326 Q320,340 290,352', { 'stroke-width': 2.2 }), path('M350,328 Q350,342 348,356', { 'stroke-width': 2.2 }), path('M356,326 Q380,340 410,352', { 'stroke-width': 2.2 }),
    // ③ 肩掛けに引っぱられる斜めのシワ（ベルトから左下へ）
    path('M318,110 Q296,128 266,136', { 'stroke-width': 2.2 }), path('M344,148 Q318,168 280,178', { 'stroke-width': 2.2 }),
    path('M322,70 Q360,96 382,92', { 'stroke-width': 2.2 }),
    // 番号と説明
    num(212, 240, 1, G), leader(226, 234, 294, 158, G),
    num(480, 330, 2, G), leader(466, 326, 362, 304, G),
    num(250, 40, 3, G), leader(263, 48, 290, 64, G),
    numLabel(540, 130, 1, '胸の頂点から下へ垂れる', G, 18),
    numLabel(540, 200, 2, 'ベルトで絞った所から', G, 18),
    text(564, 226, '上下へ放射状に広がる', { size: 18, anchor: 'start' }),
    numLabel(540, 290, 3, '肩掛けのベルトに', G, 18),
    text(564, 316, '引っぱられて斜めに', { size: 18, anchor: 'start' }),
    title('シワは関節だけでなく、布を支える点（緑）からも出る', 440, 19),
  ]);
}

// ================================================================== 新規：ステージ7・8

// 線の重なり：手前を太く、奥の線は手前の線で切る
{
  const back = [0, 0, 105];
  const front = [95, 55, 85];
  const draw = (ox, good) => {
    const B = [ox + 190 + back[0], 220 + back[1], back[2]];
    const Fc = [ox + 190 + front[0], 220 + front[1], front[2]];
    // 奥の円のうち、手前の円の外にある部分
    const pts = [];
    const cut = [];
    for (let i = 0; i <= 180; i++) {
      const a = (i / 180) * Math.PI * 2;
      const p = [B[0] + B[2] * Math.cos(a), B[1] + B[2] * Math.sin(a)];
      const inside = Math.hypot(p[0] - Fc[0], p[1] - Fc[1]) < Fc[2];
      pts.push({ p, inside });
    }
    // 外側の連続部分を 1 本の線に
    let start = pts.findIndex((q) => q.inside);
    while (pts[(start + 1) % pts.length].inside) start = (start + 1) % pts.length;
    const seg = [];
    for (let k = 1; k < pts.length; k++) {
      const q = pts[(start + k) % pts.length];
      if (q.inside) break;
      seg.push(q.p);
    }
    const out = [];
    if (good) {
      out.push(path(poly(seg), { 'stroke-width': 2.5 }));
      out.push(circle(Fc[0], Fc[1], Fc[2], { 'stroke-width': 5.5 }));
      out.push(dot(...seg[0], G, 6), dot(...seg[seg.length - 1], G, 6));
      cut.push(seg[0], seg[seg.length - 1]);
    } else {
      out.push(circle(B[0], B[1], B[2], { 'stroke-width': 2.5 }));
      out.push(circle(Fc[0], Fc[1], Fc[2], { 'stroke-width': 2.5 }));
    }
    return { out, cut, Fc };
  };
  const bad = draw(0, false);
  const good = draw(400, true);
  svg('s7-line-overlap', [
    bad.out,
    text(210, 395, '×　同じ太さで全部つながっている', { size: 17 }),
    text(210, 420, '→ どちらが手前かわからない', { size: 17 }),
    line(400, 40, 400, 430, { ...DASH, 'stroke-width': 1.5 }),
    good.out,
    text(good.Fc[0] + 40, good.Fc[1] + good.Fc[2] + 36, '手前＝太く', { size: 17 }),
    text(560, 72, '奥の線は、手前の線に当たった所（緑）で止める', { size: 16, color: G }),
    text(610, 420, '○　前後がひと目でわかる', { size: 17 }),
    title('重なりは「手前の線を太く・奥の線は手前の線で切る」', 475, 19),
  ]);
}

// 手首・膝・足首で画面を切らない
{
  // 立ち姿の人（ローカル座標：頭頂 y=0、足裏 y=400、中心 x=0。右腕を横に伸ばす）
  const J = {
    head: [0, 30],
    neck: [0, 62],
    shL: [-38, 76], shR: [38, 76],
    elL: [-46, 150], wrL: [-48, 218],
    elR: [110, 80], wrR: [178, 84],
    hipL: [-22, 196], hipR: [22, 196],
    knL: [-24, 292], knR: [24, 292],
    anL: [-24, 380], anR: [24, 380],
  };
  const person = [
    circle(0, 30, 28),
    line(0, 58, 0, 70),
    path('M-38,76 Q0,64 38,76 L30,196 L-30,196 Z'),
    limb(J.shL, J.elL, 9, 7), limb(J.elL, J.wrL, 7, 5),
    ell(-49, 236, 8, 16),
    limb(J.shR, J.elR, 9, 7), limb(J.elR, J.wrR, 7, 5),
    ell(197, 85, 18, 9),
    limb(J.hipL, J.knL, 12, 9), limb(J.knL, J.anL, 9, 6),
    limb(J.hipR, J.knR, 12, 9), limb(J.knR, J.anR, 9, 6),
    path('M-24,380 L-46,396 L-18,398 Z M24,380 L46,396 L18,398 Z'),
  ].join('');
  // 枠（x,y,w,h）と、人を置く変換（枠の中で joint がちょうど端に来るように）
  const W = 200;
  const Hh = 150;
  const cell = (fx, fy, s, lx, ly, id, mark) => {
    // ローカル (lx,ly) を枠の左上に合わせる
    const tx = fx - lx * s;
    const ty = fy - ly * s;
    return [
      `<clipPath id="${id}"><rect x="${fx}" y="${fy}" width="${W}" height="${Hh}"/></clipPath>`,
      `<g clip-path="url(#${id})"><g transform="translate(${f(tx)} ${f(ty)}) scale(${s})" stroke-width="${f(2.5 / s)}">${person}</g></g>`,
      rect(fx, fy, W, Hh, { 'stroke-width': 2.5 }),
      mark ? circle(fx + (mark[0] - lx) * s, fy + (mark[1] - ly) * s, 14, { stroke: G, 'stroke-width': 3 }) : null,
    ];
  };
  const X = [90, 330, 570];
  const Y1 = 62;
  const Y2 = 272;
  svg('s8-no-cut-joints', [
    text(45, Y1 + 82, '×', { size: 34, weight: 700 }),
    text(45, Y2 + 82, '○', { size: 30, weight: 700, color: G }),
    // 手首：× 右端がちょうど手首 / ○ 手まで入れる
    cell(X[0], Y1, 0.7, J.wrR[0] - W / 0.7, -30, 's8-ncj-1', J.wrR),
    cell(X[0], Y2, 0.7, 225 - W / 0.7, -30, 's8-ncj-4'),
    // 膝：× 下端がちょうど膝 / ○ 太ももの途中
    cell(X[1], Y1, 0.5, -178, J.knL[1] - Hh / 0.5, 's8-ncj-2', J.knR),
    cell(X[1], Y2, 0.5, -178, 262 - Hh / 0.5, 's8-ncj-5'),
    // 足首：× 下端がちょうど足首 / ○ 足先まで入れる
    cell(X[2], Y1, 0.375, -266, J.anL[1] - Hh / 0.375, 's8-ncj-3', J.anR),
    cell(X[2], Y2, 0.34, -294, 418 - Hh / 0.34, 's8-ncj-6'),
    text(X[0] + W / 2, 42, '手首', { size: 19, weight: 700 }),
    text(X[1] + W / 2, 42, '膝', { size: 19, weight: 700 }),
    text(X[2] + W / 2, 42, '足首', { size: 19, weight: 700 }),
    text(X[0] + W / 2, Y2 + Hh + 24, '手の先まで入れる', { size: 16, color: G }),
    text(X[1] + W / 2, Y2 + Hh + 24, '関節の間（太もも）で切る', { size: 16, color: G }),
    text(X[2] + W / 2, Y2 + Hh + 24, '足の先まで入れる', { size: 16, color: G }),
    text(400, Y1 + Hh + 30, '緑の丸：枠の線が関節にちょうど重なっている', { size: 16 }),
    title('手首・膝・足首で画面を切らない。切るなら関節と関節の間で', 482, 19),
  ]);
}

// ================================================================== 新規：ステージ5（短縮のジェスチャー）

// こちら向きの腕・脚（短縮）
{
  /** 奥 → 手前の順に並べた形を、手前の形で隠して描く（mask で隠すので塗り色に頼らない） */
  const occlude = (prefix, shapes) =>
    shapes.map((s, i) => {
      const front = shapes.slice(i + 1).filter((t) => t.solid !== false);
      const body = [s.el({}), ...(s.extra ?? [])].join('');
      if (!front.length) return body;
      const id = `${prefix}-m${i}`;
      return (
        `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="800" height="500"><rect x="0" y="0" width="800" height="500" fill="#fff" stroke="none"/>` +
        `${front.map((t) => t.el({ fill: '#000', stroke: '#000' })).join('')}</mask><g mask="url(#${id})">${body}</g>`
      );
    });
  // 左：こちらへ腕を伸ばす（こぶし → 前腕 → 上腕 の順に手前。手前ほど大きい）
  const arm = occlude('s5-fg-arm', [
    { el: (o) => circle(200, 70, 26, o) },
    { el: (o) => path('M150,112 Q200,98 250,112 L242,262 L158,262 Z', o) },
    { el: (o) => path('M156,120 L128,196 L138,262', o), solid: false },
    { el: (o) => limb([246, 124], [264, 172], 17, 21, o) },
    { el: (o) => limb([264, 172], [282, 222], 21, 28, o) },
    {
      el: (o) => ell(292, 262, 50, 44, { 'stroke-width': 3.5, ...o }),
      extra: [
        path('M252,246 Q292,232 332,246', { 'stroke-width': 2 }),
        path('M272,240 L272,262 M292,236 L292,260 M312,240 L312,262', { 'stroke-width': 1.6 }),
        path('M246,272 Q262,298 296,298', { 'stroke-width': 2 }),
      ],
    },
  ]);
  // 右：こちらへ脚を蹴り出す（足裏 → すね → ひざ → 太もも の順に手前）
  const leg = occlude('s5-fg-leg', [
    { el: (o) => path('M566,20 L556,110 M634,20 L644,110', o), solid: false },
    { el: (o) => path('M556,110 Q600,98 644,110 L650,156 Q600,174 550,156 Z', o) },
    { el: (o) => limb([572, 160], [566, 262], 17, 12, o) },
    { el: (o) => limb([566, 262], [570, 352], 12, 8, o) },
    { el: (o) => path('M566,356 L544,368 L590,368 L578,354', o), solid: false },
    { el: (o) => limb([628, 160], [650, 200], 20, 25, o) },
    { el: (o) => limb([650, 200], [662, 246], 25, 30, o) },
    {
      el: (o) => ell(668, 290, 42, 54, { 'stroke-width': 3.5, ...o }),
      extra: [path('M634,268 Q668,252 702,268', { 'stroke-width': 2 }), path('M646,318 Q668,328 690,318', { 'stroke-width': 1.6 })],
    },
  ]);
  svg('s5-foreshorten-gesture', [
    arm,
    // ジェスチャー線（肩 → こぶし）
    path('M204,100 Q256,140 292,262', { stroke: G, 'stroke-width': 4 }),
    head(284, 214, 292, 262, { color: G, width: 4, head: 14 }),
    text(230, 360, '腕をこちらへ', { size: 20, weight: 700 }),
    text(230, 386, 'こぶしが大きく、腕は短く見える', { size: 16 }),
    line(400, 40, 400, 420, { ...DASH, 'stroke-width': 1.5 }),
    leg,
    path('M628,150 Q664,196 668,290', { stroke: G, 'stroke-width': 4 }),
    head(666, 242, 668, 290, { color: G, width: 4, head: 14 }),
    text(706, 206, 'ひざ', { size: 16, anchor: 'start' }), leader(702, 202, 686, 204),
    text(716, 300, '足裏', { size: 16, anchor: 'start' }), leader(712, 296, 706, 294),
    text(600, 400, '脚をこちらへ', { size: 20, weight: 700 }),
    text(600, 426, '足裏が大きく、すねは短く見える', { size: 16 }),
    title('短縮は「手前ほど大きく・前の形が後ろの形を隠す・長さは短く」（緑＝動きの線）', 470, 17),
  ]);
}

// ================================================================== おわり
console.log(`生成: ${made.length} 件`);
for (const id of made) console.log(`  ${id}`);
