// 図解 SVG 生成スクリプト
// 実行: node content/figures/_gen/figures.mjs
// 出力: content/figures/<id>.svg（viewBox 800×500、線は currentColor、強調は #45702A）
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..');
const G = '#45702A';
const f = (n) => Math.round(n * 10) / 10;

function svg(id, body) {
  const s =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" font-family="Zen Kaku Gothic New, sans-serif">\n` +
    body.flat(Infinity).filter(Boolean).map((l) => '  ' + l).join('\n') +
    '\n</svg>\n';
  writeFileSync(join(OUT, `${id}.svg`), s);
  console.log(id);
}

// ---- 部品
const attrs = (o = {}) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('');
const line = (x1, y1, x2, y2, o) => `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"${attrs(o)}/>`;
const path = (d, o) => `<path d="${d}"${attrs(o)}/>`;
const circle = (cx, cy, r, o) => `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}"${attrs(o)}/>`;
const ell = (cx, cy, rx, ry, rot = 0, o) =>
  `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}"${rot ? ` transform="rotate(${rot} ${f(cx)} ${f(cy)})"` : ''}${attrs(o)}/>`;
const dot = (x, y, color = 'currentColor', r = 5) => circle(x, y, r, { fill: color, stroke: 'none' });
const text = (x, y, s, o = {}) =>
  `<text x="${f(x)}" y="${f(y)}" font-size="${o.size ?? 22}" fill="${o.color ?? 'currentColor'}" stroke="none" text-anchor="${o.anchor ?? 'middle'}"${o.weight ? ` font-weight="${o.weight}"` : ''}>${s}</text>`;
const DASH = { 'stroke-dasharray': '8 8', opacity: 0.6 };

/** 矢じりつき線分 */
function arrow(x1, y1, x2, y2, o = {}) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const h = o.head ?? 14;
  const p1 = [x2 - h * Math.cos(a - 0.45), y2 - h * Math.sin(a - 0.45)];
  const p2 = [x2 - h * Math.cos(a + 0.45), y2 - h * Math.sin(a + 0.45)];
  const st = { stroke: o.color, 'stroke-width': o.width, 'stroke-dasharray': o.dash };
  return [
    line(x1, y1, x2, y2, st),
    path(`M${f(p1[0])},${f(p1[1])} L${f(x2)},${f(y2)} L${f(p2[0])},${f(p2[1])}`, { stroke: o.color, 'stroke-width': o.width }),
  ];
}
/** 両端矢印（寸法線） */
const dim = (x1, y1, x2, y2, o = {}) => [arrow(x1, y1, x2, y2, o), arrow(x2, y2, x1, y1, o)];

/** 円弧（中心・半径・角度[deg]）＋終端の矢じり */
function arcArrow(cx, cy, r, a0, a1, o = {}) {
  const rad = (d) => (d * Math.PI) / 180;
  const p = (d) => [cx + r * Math.cos(rad(d)), cy + r * Math.sin(rad(d))];
  const [sx, sy] = p(a0);
  const [ex, ey] = p(a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  const d = `M${f(sx)},${f(sy)} A${f(r)},${f(r)} 0 ${large} ${sweep} ${f(ex)},${f(ey)}`;
  const out = [path(d, { stroke: o.color, 'stroke-width': o.width, 'stroke-dasharray': o.dash })];
  if (o.head !== false) {
    const back = a1 - Math.sign(a1 - a0) * 4;
    const [bx, by] = p(back);
    out.push(arrow(bx, by, ex, ey, { color: o.color, width: o.width, head: 14 }).slice(1));
  }
  return out;
}
/** 番号つき丸 */
const num = (x, y, n, color = 'currentColor') => [
  circle(x, y, 15, { stroke: color, 'stroke-width': 2 }),
  text(x, y + 7, String(n), { size: 18, color }),
];
const NUMS = ['①', '②', '③', '④', '⑤', '⑥'];

// ================================================================ ステージ1

// ゴースティング: 空中で3回なぞる → 引く
svg('ghosting', [
  dot(90, 300), dot(330, 220),
  [0, 1, 2].map((i) => path(`M90,${300 - 28 - i * 22} Q210,${230 - 40 - i * 22} 330,${220 - 28 - i * 22}`, { ...DASH })),
  num(360, 190, 1), num(360, 160, 2), num(360, 130, 3),
  text(210, 110, '浮かせて3回なぞる'),
  arrow(410, 250, 470, 250, { width: 3 }),
  dot(500, 300), dot(740, 220),
  line(500, 300, 740, 220, { stroke: G, 'stroke-width': 5 }),
  num(760, 190, 4, G),
  text(620, 340, '一気に引く', { color: G }),
  text(90, 330, '始点', { size: 18 }), text(330, 250, '終点', { size: 18 }),
  text(400, 440, '点を置く → 空中で動きを予行 → 迷わず1本', { size: 20 }),
]);

// 手首・肘・肩の可動範囲
{
  const panel = (cx, r, label, sub, color) => [
    dot(cx, 400, color, 7),
    line(cx, 400, cx, 400 - r, { stroke: color }),
    arcArrow(cx, 400, r, -130, -50, { color, width: color === G ? 4 : 2.5 }),
    text(cx, 450, label, { color, weight: 700 }),
    text(cx, 478, sub, { size: 18, color }),
  ];
  svg('shoulder-vs-wrist', [
    panel(120, 60, '手首', '短い線・細部'),
    panel(340, 130, '肘', '中くらいの線'),
    panel(610, 220, '肩', '長い線・大きな円', G),
    text(400, 40, '支点から先が長いほど、大きくなめらかに動かせる', { size: 20 }),
  ]);
}

// 速い線と遅い線
{
  let wob = 'M120,340';
  for (let x = 140; x <= 680; x += 20) wob += ` L${x},${f(340 + Math.sin(x / 23) * 6 + Math.sin(x / 7) * 3)}`;
  svg('line-speed', [
    line(120, 150, 680, 150, { stroke: G, 'stroke-width': 4 }),
    arrow(560, 110, 680, 110, { color: G }), arrow(600, 110, 720, 110, { color: G }),
    text(120, 100, '速い線：まっすぐ伸びる', { anchor: 'start', color: G }),
    path(wob),
    arrow(620, 390, 680, 390, { width: 2 }),
    text(120, 300, '遅い線：ゆれやすい', { anchor: 'start' }),
    text(400, 460, '迷いは線に出る。点を決めたら思い切って', { size: 20 }),
  ]);
}

// 等間隔の平行線
svg('parallel-spacing', [
  [0, 1, 2, 3, 4, 5].map((i) => line(80, 90 + i * 55, 420, 90 + i * 55)),
  [0, 1, 2, 3, 4].map((i) => dim(450, 94 + i * 55, 450, 141 + i * 55, { color: G, head: 9, width: 2 })),
  text(470, 260, '同じ間隔', { anchor: 'start', color: G }),
  [0, 1, 2, 3, 4].map((i) => line(560 + i * 30, 380, 640 + i * 30, 120)),
  text(640, 430, '斜めでも同じ', { size: 20 }),
  text(250, 450, '1本目を基準に、隣との間を見ながら引く', { size: 20 }),
]);

// Cカーブ・Sカーブ
svg('c-curve-s-curve', [
  path('M300,110 Q110,250 300,390', { 'stroke-width': 4 }),
  arrow(250, 330, 290, 380, { color: G }),
  text(200, 450, 'Cカーブ：一方向に曲がる'),
  path('M500,110 Q740,170 620,250 Q500,330 740,390', { 'stroke-width': 4 }),
  dot(620, 250, G, 8),
  line(620, 250, 700, 250, { stroke: G, 'stroke-width': 2, 'stroke-dasharray': '4 6' }),
  text(690, 290, '向きが変わる点', { color: G, size: 18 }),
  text(600, 450, 'Sカーブ：途中で向きが変わる'),
]);

// 波線とスパイラル
{
  let wave = 'M60,140';
  for (let x = 60; x <= 740; x += 10) wave += ` L${x},${f(140 + Math.sin((x - 60) / 45) * 40)}`;
  let sp = '';
  for (let a = 0; a <= Math.PI * 6; a += 0.1) {
    const r = 8 + a * 6;
    sp += `${sp ? ' L' : 'M'}${f(400 + r * Math.cos(a))},${f(355 + r * Math.sin(a))}`;
  }
  svg('wave-spiral', [
    path(wave),
    [0, 1].map((i) => dim(60 + i * 283, 70, 343 + i * 283, 70, { color: G, head: 9, width: 2 })),
    text(400, 50, '山と山の幅をそろえる', { color: G, size: 18 }),
    path(sp),
    arrow(525, 360, 575, 360, { color: G }),
    text(590, 367, '中心から外へ', { size: 18, anchor: 'start' }),
    text(590, 395, '間隔を一定に', { size: 18, anchor: 'start' }),
  ]);
}

// 指定点を通る曲線
svg('curve-through-points', [
  dot(120, 350, G, 8), dot(330, 150, G, 8), dot(560, 300, G, 8), dot(700, 130, G, 8),
  path('M120,350 C200,200 260,140 330,150 S500,320 560,300 S660,150 700,130', { ...DASH }),
  path('M120,350 C200,200 260,140 330,150 S500,320 560,300 S660,150 700,130'),
  num(120, 395, 1), num(330, 105, 2), num(560, 345, 3), num(700, 85, 4),
  text(400, 460, '点を先に打ち、全部を通るように空中で予行してから', { size: 20 }),
]);

// 2点を結ぶ
svg('two-points', [
  circle(150, 360, 14, { stroke: G }), dot(150, 360, G),
  circle(650, 140, 14, { stroke: G }), dot(650, 140, G),
  line(150, 360, 650, 140, { ...DASH }),
  text(150, 410, '始点', { color: G }), text(650, 110, '終点', { color: G }),
  text(430, 300, '目は終点を見る', { anchor: 'start' }),
  arrow(420, 290, 610, 170, { width: 2 }),
  text(400, 470, '引いている途中はペン先ではなく、ゴールを見る', { size: 20 }),
]);

// 手首の円・腕の円
svg('circle-wrist-vs-arm', [
  circle(180, 250, 55),
  dot(180, 390, 'currentColor', 7), line(180, 390, 180, 305, { ...DASH }),
  text(180, 440, '小さい円：手首'),
  circle(540, 240, 150, { stroke: G, 'stroke-width': 4 }),
  circle(540, 240, 160, { ...DASH }), circle(540, 240, 142, { ...DASH }),
  arcArrow(540, 240, 180, -60, 10, { color: G }),
  text(540, 450, '大きい円：肘・肩から', { color: G }),
  text(740, 110, '空中で2〜3周', { size: 18, anchor: 'end' }),
]);

// 楕円の度合い
svg('ellipse-degree', [
  [
    [150, 1, '100%'],
    [400, 0.6, '60%'],
    [650, 0.3, '30%'],
  ].map(([x, d, l]) => [
    ell(x, 230, 100, 100 * d),
    line(x, 230 - 100 * d - 20, x, 230 + 100 * d + 20, { stroke: G, 'stroke-width': 2 }),
    line(x - 100, 230, x + 100, 230, { ...DASH }),
    text(x, 400, l, { size: 30, weight: 700 }),
  ]),
  text(400, 460, '度合い＝短い径 ÷ 長い径。薄いほど横から見た円', { size: 20 }),
  text(710, 170, '短い径', { size: 18, color: G, anchor: 'start' }),
]);

// 楕円の軸の向き
// ellipse-axis → tools/gen-review-figures.mjs で生成（2026-09 教材レビューで作り直し。ここで再生成すると古い版に戻るので外した）

// 円柱の口
svg('cylinder-mouth', [
  ell(400, 120, 150, 50),
  path('M250,380 A150,50 0 0 0 550,380'),
  path('M250,380 A150,50 0 0 1 550,380', { ...DASH }),
  line(250, 120, 250, 380), line(550, 120, 550, 380),
  line(400, 40, 400, 460, { stroke: G, 'stroke-width': 3 }),
  text(420, 470, '短い径の軸（中心線）', { anchor: 'start', color: G, size: 18 }),
  dim(600, 70, 600, 170, { head: 9, width: 2 }), dim(600, 330, 600, 430, { head: 9, width: 2 }),
  text(620, 125, '同じ度合い', { anchor: 'start', size: 20 }),
  text(620, 385, '同じ度合い', { anchor: 'start', size: 20 }),
  text(140, 260, '軸をそろえて重ねる', { size: 20 }),
]);

// 線の強弱（入り抜き・外側太く）
{
  // 入り抜きのある線を塗りの多角形で表す
  const N = 60;
  const top = [];
  const bot = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = 80 + t * 360;
    const y = 180 - Math.sin(t * Math.PI) * 60;
    const w = 1 + Math.sin(t * Math.PI) * 9;
    top.push(`${f(x)},${f(y - w)}`);
    bot.unshift(`${f(x)},${f(y + w)}`);
  }
  svg('line-weight', [
    path(`M${top.join(' L')} L${bot.join(' L')} Z`, { fill: 'currentColor', stroke: 'none' }),
    text(90, 230, '入り（細）', { size: 18 }), text(260, 90, '中（太）', { size: 18 }), text(430, 230, '抜き（細）', { size: 18 }),
    circle(610, 180, 95, { stroke: G, 'stroke-width': 9 }),
    path('M560,160 Q600,140 640,170', { 'stroke-width': 1.5 }),
    text(610, 320, '外側は太く・内側は細く', { color: G }),
    text(400, 440, '力を抜いて置き、途中で押し、また抜く', { size: 20 }),
  ]);
}

// ハッチング
{
  const hatch = (x0, y0, s, sp, dir) => {
    const out = [];
    if (dir > 0) {
      // 「／」向き: (x-x0)+(y-y0)=c
      for (let c = sp; c < 2 * s; c += sp) {
        const xa = Math.max(0, c - s);
        const xb = Math.min(s, c);
        out.push(line(x0 + xa, y0 + c - xa, x0 + xb, y0 + c - xb, { 'stroke-width': 2 }));
      }
    } else {
      // 「＼」向き: (x-x0)-(y-y0)=c
      for (let c = -s + sp; c < s; c += sp) {
        const xa = Math.max(0, c);
        const xb = Math.min(s, s + c);
        out.push(line(x0 + xa, y0 + xa - c, x0 + xb, y0 + xb - c, { 'stroke-width': 2 }));
      }
    }
    return out;
  };
  svg('hatching', [
    path('M100,100 h240 v240 h-240 Z', { ...DASH }),
    hatch(100, 100, 240, 24, 1),
    text(220, 400, 'ハッチング：同じ角度・同じ間隔'),
    arcArrow(100, 340, 60, -45, 0, { color: G, head: false }),
    text(175, 330, '45°', { color: G, size: 18 }),
    path('M460,100 h240 v240 h-240 Z', { ...DASH }),
    hatch(460, 100, 240, 24, 1),
    hatch(460, 100, 240, 24, -1).map((l) => l.replace('/>', ` stroke="${G}"/>`)),
    text(580, 400, 'クロス：向きを変えて重ねる'),
    text(400, 460, '線の間隔が詰まるほど暗く見える', { size: 20 }),
  ]);
}

// カップの線画（模写用お手本）
svg('cup-lineart', [
  ell(360, 120, 150, 40),
  ell(360, 120, 132, 30, 0, { 'stroke-width': 1.5 }),
  path('M210,120 L235,390'), path('M510,120 L485,390'),
  path('M235,390 A125,32 0 0 0 485,390'),
  path('M505,170 C600,160 610,300 492,320'),
  path('M500,200 C565,200 570,280 495,290', { 'stroke-width': 1.5 }),
  line(360, 60, 360, 450, { ...DASH, 'stroke-width': 1.5 }),
]);

// 葉の線画（模写用お手本）
svg('leaf-lineart', [
  path('M400,60 Q220,200 400,420'), path('M400,60 Q580,200 400,420'),
  path('M400,90 L400,470', { 'stroke-width': 2 }),
  path('M400,170 Q360,140 330,130', { 'stroke-width': 1.5 }),
  path('M400,230 Q450,195 480,185', { 'stroke-width': 1.5 }),
  path('M400,290 Q350,255 318,245', { 'stroke-width': 1.5 }),
  path('M400,340 Q445,310 470,305', { 'stroke-width': 1.5 }),
]);

// ================================================================ ステージ1.5（正面顔 共通寸法）
const FACE = { cx: 400, top: 50, cy: 230, hw: 150, chin: 450, eye: 260 };
const faceD = () =>
  `M${FACE.cx - FACE.hw},${FACE.cy} A${FACE.hw},${FACE.cy - FACE.top} 0 0 1 ${FACE.cx + FACE.hw},${FACE.cy} ` +
  `Q${FACE.cx + FACE.hw * 0.95},390 ${FACE.cx},${FACE.chin} Q${FACE.cx - FACE.hw * 0.95},390 ${FACE.cx - FACE.hw},${FACE.cy} Z`;

svg('face-cross', [
  path(faceD()),
  line(FACE.cx, 30, FACE.cx, 470, { stroke: G, 'stroke-width': 3, 'stroke-dasharray': '10 8' }),
  path(`M${FACE.cx - FACE.hw},${FACE.eye} Q${FACE.cx},${FACE.eye + 18} ${FACE.cx + FACE.hw},${FACE.eye}`, { stroke: G, 'stroke-width': 3 }),
  num(170, 150, 1), text(140, 120, '輪郭', { size: 20 }),
  num(430, 40, 2, G), text(530, 47, '縦の中心線', { color: G, size: 20 }),
  num(600, 262, 3, G), text(660, 300, '目の高さ', { color: G, size: 20 }),
  text(700, 440, '左右が同じ幅か確認', { size: 18, anchor: 'end' }),
]);

// アニメの目の構造
svg('anime-eye-structure', [
  // 上まぶた（太い）
  path('M170,210 Q300,90 470,150 Q500,165 510,190', { 'stroke-width': 8 }),
  // まつ毛
  path('M470,150 L505,125', { 'stroke-width': 4 }), path('M492,165 L530,150', { 'stroke-width': 4 }),
  // 虹彩
  ell(330, 250, 80, 115),
  // 瞳孔
  ell(330, 270, 32, 50, 0, { fill: 'currentColor', opacity: 0.35 }),
  // ハイライト
  circle(300, 205, 20, { stroke: G, 'stroke-width': 3 }),
  // 下まぶた
  path('M270,375 Q340,390 420,355', { 'stroke-width': 3 }),
  // 番号と引き出し線
  num(575, 70, 1), text(598, 77, '上まぶた（太く）', { anchor: 'start', size: 18 }), line(560, 75, 360, 120, { 'stroke-width': 1.5 }),
  num(575, 150, 2), text(598, 157, '虹彩（縦長）', { anchor: 'start', size: 18 }), line(560, 155, 410, 230, { 'stroke-width': 1.5 }),
  num(575, 230, 3), text(598, 237, '瞳孔', { anchor: 'start', size: 18 }), line(560, 235, 362, 270, { 'stroke-width': 1.5 }),
  num(575, 310, 4, G), text(598, 317, 'ハイライト', { anchor: 'start', size: 18, color: G }), line(560, 310, 320, 205, { stroke: G, 'stroke-width': 1.5 }),
  num(575, 390, 5), text(598, 397, '下まぶた（短く）', { anchor: 'start', size: 18 }), line(560, 390, 420, 360, { 'stroke-width': 1.5 }),
  num(575, 460, 6), text(598, 467, 'まつ毛（目じり）', { anchor: 'start', size: 18 }), line(560, 455, 520, 150, { 'stroke-width': 1.5 }),
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
    // 眉
    path('M300,195 Q335,175 370,188'), path('M500,195 Q465,175 430,188'),
    // 目（簡略）
    path('M300,255 Q335,235 372,250', { 'stroke-width': 4 }), path('M500,255 Q465,235 428,250', { 'stroke-width': 4 }),
    ell(336, 272, 18, 24), ell(464, 272, 18, 24),
    // 鼻・口
    path('M404,325 L396,340 L406,343'),
    path('M375,388 Q400,398 425,388'),
    // 耳（眉〜鼻の高さ）
    path('M250,210 Q222,215 226,275 Q230,330 256,335'),
    path('M550,210 Q578,215 574,275 Q570,330 544,335'),
    dim(200, 190, 200, 340, { head: 8, width: 1.5 }),
    text(190, 270, '耳', { anchor: 'end', size: 20 }),
    dim(372, 290, 428, 290, { head: 7, width: 1.5, color: G }),
    text(400, 315, '目1つ分', { size: 14, color: G }),
  ]);
}

// 髪の塊
svg('hair-mass', [
  circle(400, 230, 150, { ...DASH }),
  path('M230,420 Q190,230 260,130 Q400,10 540,130 Q610,230 570,420', { 'stroke-width': 3.5 }),
  dim(400, 80, 400, 50, { color: G, head: 7, width: 2 }),
  text(420, 60, 'ボリューム', { anchor: 'start', color: G, size: 16 }),
  path('M280,160 L300,250 L340,180 L380,260 L420,180 L460,255 L500,170 L520,240', { stroke: G, 'stroke-width': 3 }),
  path('M270,230 Q255,330 270,410'), path('M530,230 Q545,330 530,410'),
  num(400, 300, 1, G), text(400, 340, '前髪', { color: G, size: 20 }),
  num(215, 330, 2), text(140, 337, 'サイド', { size: 20 }),
  num(585, 330, 3), text(660, 337, 'サイド', { size: 20 }),
  num(400, 100, 4), text(640, 90, '後ろ（外形）', { size: 20 }),
  text(400, 480, '頭の球（点線）より外側に、塊ごとに描く', { size: 18 }),
]);

// 正面顔の線画（模写用お手本・構築線つき）
svg('face-front-lineart', [
  path(faceD()),
  line(FACE.cx, 40, FACE.cx, 465, { ...DASH, 'stroke-width': 1.5 }),
  path(`M${FACE.cx - FACE.hw},${FACE.eye} Q${FACE.cx},${FACE.eye + 18} ${FACE.cx + FACE.hw},${FACE.eye}`, { ...DASH, 'stroke-width': 1.5 }),
  path('M290,258 Q335,222 380,246', { 'stroke-width': 5 }), path('M510,258 Q465,222 420,246', { 'stroke-width': 5 }),
  ell(336, 280, 22, 30), ell(464, 280, 22, 30),
  circle(330, 268, 6), circle(458, 268, 6),
  path('M310,318 Q336,324 356,314', { 'stroke-width': 1.5 }), path('M490,318 Q464,324 444,314', { 'stroke-width': 1.5 }),
  path('M300,205 Q335,190 368,200'), path('M500,205 Q465,190 432,200'),
  path('M404,338 L397,352 L406,354'),
  path('M378,398 Q400,408 422,398'),
  path('M240,380 Q220,220 280,130 Q400,40 520,130 Q580,220 560,380'),
  path('M280,160 L300,240 L340,175 L380,250 L420,175 L460,245 L500,165 L515,230'),
]);
