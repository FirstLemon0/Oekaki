#!/usr/bin/env node
/**
 * 教材レビュー（2026-09）で作り直した図解・お手本を生成するスクリプト。
 *
 *   node tools/gen-review-figures.mjs
 *
 * 出力（何度実行しても同じ結果）:
 *   - 作り直した図解: ellipse-axis / s5-elbow-wrist / s8-room-corner / s9-color-schemes
 *   - 作り直したなぞりテンプレート: s8-room-corner-guide（2点透視の部屋の角）
 *   - copy / mosha 用の線画（*-lineart）: 説明図から文字・番号・矢印・強調色・構築線を除いたもの
 *
 * 元の生成スクリプト（content/figures/_gen/figures.mjs・content/templates/_gen/gen-s7s10.mjs）からは
 * 上の図の定義を外してある（あちらを再実行しても、ここで作った図が古い版に戻らないように）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIG = join(ROOT, 'content', 'figures');
const TPL = join(ROOT, 'content', 'templates');
const G = '#7BB661';
const HEAD =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" font-family="Zen Kaku Gothic New, sans-serif">';

const f = (n) => Math.round(n * 10) / 10;
const attrs = (o = {}) =>
  Object.entries(o)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('');
const line = (x1, y1, x2, y2, o) => `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"${attrs(o)}/>`;
const path = (d, o) => `<path d="${d}"${attrs(o)}/>`;
const circle = (cx, cy, r, o) => `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}"${attrs(o)}/>`;
const ell = (cx, cy, rx, ry, o) => `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}"${attrs(o)}/>`;
const text = (x, y, s, { size = 20, color = 'currentColor', anchor = 'middle', weight } = {}) =>
  `<text x="${f(x)}" y="${f(y)}" font-size="${size}" fill="${color}" stroke="none" text-anchor="${anchor}"${weight ? ` font-weight="${weight}"` : ''}>${s}</text>`;
const DASH = { 'stroke-dasharray': '8 8', opacity: '0.6' };

const made = [];
function writeSvg(id, body) {
  const s = `${HEAD}\n${body.flat(Infinity).filter(Boolean).map((l) => `  ${l}`).join('\n')}\n</svg>\n`;
  writeFileSync(join(FIG, `${id}.svg`), s);
  made.push(id);
}

/* ------------------------------------------------------------------ */
/* 1. 楕円の軸＝長い径（採点・ドリルの見本と同じ定義）                        */
/* ------------------------------------------------------------------ */
{
  const r = (25 * Math.PI) / 180;
  writeSvg('ellipse-axis', [
    ell(260, 250, 170, 80, { transform: 'rotate(-25 260 250)' }),
    // 長い径＝軸（緑）
    line(260 - 190 * Math.cos(r), 250 + 190 * Math.sin(r), 260 + 190 * Math.cos(r), 250 - 190 * Math.sin(r), { stroke: G, 'stroke-width': 4 }),
    // 短い径（点線）
    line(260 - 110 * Math.sin(r), 250 - 110 * Math.cos(r), 260 + 110 * Math.sin(r), 250 + 110 * Math.cos(r), DASH),
    text(260, 440, '長い径（緑）が楕円の「軸」', { color: G }),
    text(260, 468, '軸の傾き＝楕円の傾き', { size: 18 }),
    ell(620, 250, 70, 150),
    line(620, 80, 620, 420, { stroke: G, 'stroke-width': 4 }),
    line(530, 250, 710, 250, DASH),
    path('M620,235 L635,235 L635,250', { 'stroke-width': 2 }),
    text(620, 440, '短い径は軸と直角に交わる'),
    text(620, 468, '縦長の楕円＝軸が縦', { size: 18 }),
  ]);
}

/* ------------------------------------------------------------------ */
/* 2. 肘の尖りは上腕で決まる／手のひらの向きは前腕のひねり                   */
/* ------------------------------------------------------------------ */
writeSvg('s5-elbow-wrist', [
  // 左: 曲げた腕（肩→上腕→肘→前腕→手）
  circle(150, 80, 24),
  line(124, 104, 128, 247),
  line(176, 104, 172, 247),
  circle(150, 266, 20),
  line(176.5, 275.1, 316.8, 204.5),
  line(159.5, 238.9, 303.2, 175.5),
  ell(342, 176, 32, 16, { transform: 'rotate(-25 342 176)' }),
  // 肘の尖り（上腕の後ろ側＝曲げの外側）
  circle(128, 284, 8, { fill: G, stroke: 'none' }),
  text(95, 330, '肘の尖り', { size: 22, color: G }),
  text(210, 400, '尖りは上腕の後ろ側', { size: 22 }),
  text(210, 430, '（曲げた内側の反対）', { size: 18 }),
  text(210, 465, '手首をひねっても動かない', { size: 18, color: G }),
  line(410, 40, 410, 460, { 'stroke-dasharray': '8 8', opacity: '0.6', 'stroke-width': 1.5 }),
  // 右: 前腕のひねり（2本の骨が平行→交差）
  line(450, 176, 700, 172),
  line(450, 124, 700, 128),
  line(462, 142, 690, 142, { stroke: G, 'stroke-width': 3 }),
  line(462, 158, 690, 158, { stroke: G, 'stroke-width': 3 }),
  ell(735, 150, 34, 20),
  text(575, 105, '手のひら 上', { size: 22 }),
  line(450, 356, 700, 352),
  line(450, 304, 700, 308),
  line(462, 322, 690, 338, { stroke: G, 'stroke-width': 3 }),
  line(462, 338, 690, 322, { stroke: G, 'stroke-width': 3 }),
  ell(735, 330, 34, 20),
  text(575, 290, '手のひら 下', { size: 22 }),
  path('M755.5,183.6 A60,60 0 0 1 755.5,296.4'),
  path('M764.9,286 L755.5,296.4 L769.5,297.3'),
  text(575, 420, '前腕がひねれて2本が交差', { size: 22, color: G }),
  text(575, 450, '動くのは肘から先だけ', { size: 18 }),
]);

/* ------------------------------------------------------------------ */
/* 3. 部屋の角は2点透視                                                 */
/* ------------------------------------------------------------------ */
{
  const EYE = 200;
  const VL = [60, EYE]; // 左の消失点（右の壁の横線が向かう）
  const VR = [740, EYE]; // 右の消失点（左の壁の横線が向かう）
  const C = 360; // 部屋の角（縦線）の x
  const top = 40;
  const bottom = 330;
  // 直線 p→q を、x または y の境界で止める
  const at = (p, q, { x, y }) => {
    const t = x !== undefined ? (x - p[0]) / (q[0] - p[0]) : (y - p[1]) / (q[1] - p[1]);
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  };
  const leftFloor = at(VR, [C, bottom], { x: 40 }); // 左の壁と床の境目（左端まで）
  const rightFloor = at(VL, [C, bottom], { y: 460 }); // 右の壁と床の境目（下端まで）
  // 右の壁の窓: 縦の辺は垂直、上下の辺は左の消失点へ
  const wy = (x, y0) => EYE + ((y0 - EYE) * (x - VL[0])) / (480 - VL[0]);
  const W1 = 480;
  const W2 = 600;
  const WT = 110;
  const WB = 225;
  writeSvg('s8-room-corner', [
    `<rect x="40" y="30" width="720" height="430" rx="4"/>`,
    line(40, EYE, 760, EYE, { stroke: G, 'stroke-dasharray': '6 6' }),
    text(750, EYE - 12, 'アイレベル', { size: 16, color: G, anchor: 'end' }),
    circle(VL[0], VL[1], 6, { fill: G, stroke: 'none' }),
    circle(VR[0], VR[1], 6, { fill: G, stroke: 'none' }),
    text(VL[0] + 6, EYE + 28, '消失点 1', { size: 16, color: G, anchor: 'start' }),
    text(VR[0] - 6, EYE + 28, '消失点 2', { size: 16, color: G, anchor: 'end' }),
    // 部屋の角と、床と壁の境目
    line(C, top, C, bottom, { 'stroke-width': 3 }),
    line(C, bottom, leftFloor[0], leftFloor[1]),
    line(C, bottom, rightFloor[0], rightFloor[1]),
    // 境目を奥へのばすと、反対側の消失点に届く
    line(C, bottom, VR[0], VR[1], { opacity: '0.35', 'stroke-dasharray': '4 6' }),
    line(C, bottom, VL[0], VL[1], { opacity: '0.35', 'stroke-dasharray': '4 6' }),
    // 窓（右の壁）
    path(`M${W1},${WT} L${W2},${f(wy(W2, WT))} L${W2},${f(wy(W2, WB))} L${W1},${WB} Z`),
    line(W1 + (W2 - W1) / 2, wy(W1 + (W2 - W1) / 2, WT), W1 + (W2 - W1) / 2, wy(W1 + (W2 - W1) / 2, WB)),
    line(W1, (WT + WB) / 2, W2, wy(W2, (WT + WB) / 2)),
    line(W2, wy(W2, WT), VL[0], VL[1], { opacity: '0.35', 'stroke-dasharray': '4 6' }),
    text(540, 90, '窓', { size: 16 }),
    text(400, 488, '2点透視：角の縦線1本＋床と壁の境目2本。境目はそれぞれ反対側の消失点へ', { size: 17 }),
  ]);

  // なぞりテンプレート（0..1。キャンバスでは正方形に収まる）
  const N = (x, y) => [f((x - 40) / 720 * 1000) / 1000, f(((y - 30) / 430) * 1000) / 1000];
  const toStroke = (pts, n) => {
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
      const x = pts[j][0] + (pts[j + 1][0] - pts[j][0]) * u;
      const y = pts[j][1] + (pts[j + 1][1] - pts[j][1]) * u;
      out.push({ x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000, p: 0.6, t: k * 16 });
    }
    return out;
  };
  const tpl = [
    toStroke([N(C, top), N(C, bottom)], 60),
    toStroke([N(C, bottom), N(leftFloor[0], leftFloor[1])], 60),
    toStroke([N(C, bottom), N(rightFloor[0], rightFloor[1])], 60),
    toStroke([N(W1, WT), N(W2, wy(W2, WT)), N(W2, wy(W2, WB)), N(W1, WB), N(W1, WT)], 80),
  ];
  writeFileSync(join(TPL, 's8-room-corner-guide.json'), `${JSON.stringify(tpl)}\n`);
  made.push('template:s8-room-corner-guide');
}

/* ------------------------------------------------------------------ */
/* 4. 配色の型（HSV の色相環: 赤の反対はシアン、青の反対は黄）                */
/* ------------------------------------------------------------------ */
{
  const TAU = Math.PI * 2;
  const hsl = (h) => `hsl(${h},75%,55%)`;
  const wheel = (cx, pick, name, note) => [
    circle(cx, 200, 90, { opacity: '0.3' }),
    Array.from({ length: 12 }, (_, k) => {
      const h = k * 30;
      const a = (h / 360) * TAU - Math.PI / 2;
      return circle(cx + 90 * Math.cos(a), 200 + 90 * Math.sin(a), 8, { fill: hsl(h), stroke: 'none', opacity: '0.55' });
    }),
    pick.length > 1
      ? path(
          pick
            .map((h, i) => {
              const a = (h / 360) * TAU - Math.PI / 2;
              return `${i ? 'L' : 'M'}${f(cx + 90 * Math.cos(a))},${f(200 + 90 * Math.sin(a))}`;
            })
            .join(' ') + (pick.length > 2 ? ' Z' : ''),
          { 'stroke-width': 1.5, opacity: '0.6' },
        )
      : null,
    pick.map((h) => {
      const a = (h / 360) * TAU - Math.PI / 2;
      return circle(cx + 90 * Math.cos(a), 200 + 90 * Math.sin(a), 22, { fill: hsl(h), stroke: 'currentColor', 'stroke-width': 2 });
    }),
    text(cx, 340, name, { size: 22, weight: 700 }),
    text(cx, 370, note, { size: 16 }),
  ];
  writeSvg('s9-color-schemes', [
    wheel(140, [210, 240, 270], '類似色', '水色・青・青紫：落ち着く'),
    wheel(400, [240, 60], '補色', '青と黄（反対同士）：目立つ'),
    wheel(660, [0, 120, 240], 'トライアド', '赤・緑・青（三角形）：にぎやか'),
    text(400, 430, 'お絵描きアプリの色相環（HSV）。赤の反対はシアン、青の反対は黄', { size: 17 }),
    text(400, 482, '色相環の「どこから取るか」で雰囲気が決まる', { size: 19 }),
  ]);
}

/* ------------------------------------------------------------------ */
/* 5. 線画（*-lineart）: 説明図から、文字・番号・矢印・強調色・構築線を除く      */
/* ------------------------------------------------------------------ */

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/**
 * 変換の既定:
 *   - <text> は消す
 *   - 点線（stroke-dasharray）の構築線・区切り線は消す（solid に挙げたものは実線にして残す）
 *   - 強調色で塗った小さな点（fill="#7BB661" の circle）は消す
 *   - 図の区切り枠（opacity="0.25"）は消す
 *   - 残した線の強調色は currentColor に戻す
 * drop: 消す要素（本文の行番号・0 始まり）。矢印・寸法線・番号の丸・引き出し線など
 */
const LINEART = {
  's4-eye-parts': { drop: range(8, 60) },
  's4-eye-types': {},
  's4-nose-anime': {
    solid: [6, 7, 8, 11, 12, 13, 16, 17, 18, 21, 22, 23, 26, 27, 28, 31, 32, 33],
    extra: [
      ...[270, 470, 670].map((cx) => path(`M${cx - 78},95 Q${cx - 80},205 ${cx},250 Q${cx + 80},205 ${cx + 82},95`)),
      ...[270, 470, 670].map((cx) => path(`M${cx - 88},280 Q${cx - 98},375 ${cx - 20},438 Q${cx + 62},425 ${cx + 84},280`)),
    ],
  },
  's4-mouth-shapes': {},
  's4-brow-expression': {},
  's4-ear-simple': { drop: [1, 4, 5, 9] },
  's4-expressions-6': {},
  's4-expression-intensity': { drop: [9, 19, 27, 30, 31, 32, 33] },
  's4-hair-blocks': { solid: [1, 2], drop: [7, 8, 9, 11, 13] },
  's4-hair-flow': { drop: [4, 6, 8, 10, 14, 15, 18, 19] },
  's4-hairstyles': { solid: [1, 6, 11, 16] },
  's5-torso-gender': { drop: [...range(6, 13), ...range(19, 26)] },
  's5-hand-poses': { drop: [77] },
  's5-foot-shoe': { drop: range(10, 17) },
  's5-poses-standing': { drop: [72, 73] },
  's6-fold-types': { drop: [37, 38, 49, 50, 51, 52] },
  's6-cloth-weight': {},
  's6-skirt-pants': {},
  's6-accessories': { solid: [0, 12] },
  's6-bag-weapon': { drop: [17, 18], solid: range(0, 12) },
  's6-shoes-hats': {},
};

function bodyLines(id) {
  const src = readFileSync(join(FIG, `${id}.svg`), 'utf8').split('\n');
  const open = src.findIndex((l) => l.startsWith('<svg'));
  const close = src.findIndex((l) => l.startsWith('</svg>'));
  return src.slice(open + 1, close).map((l) => l.trim()).filter(Boolean);
}

function toLineart(el, solid) {
  if (/^<text\b/.test(el)) return null;
  if (/opacity="0\.25"/.test(el)) return null;
  if (/^<circle\b/.test(el) && new RegExp(`fill="${G}"`).test(el)) return null;
  let s = el;
  if (/stroke-dasharray=/.test(s)) {
    if (!solid) return null;
    s = s.replace(/ stroke-dasharray="[^"]*"/, '').replace(/ opacity="[^"]*"/, '');
  }
  return s.replaceAll(G, 'currentColor');
}

for (const [id, cfg] of Object.entries(LINEART)) {
  const drop = new Set(cfg.drop ?? []);
  const solid = new Set(cfg.solid ?? []);
  const out = [];
  bodyLines(id).forEach((el, i) => {
    if (drop.has(i)) return;
    const s = toLineart(el, solid.has(i));
    if (s) out.push(s);
  });
  out.push(...(cfg.extra ?? []));
  writeSvg(`${id}-lineart`, out);
}

/* ------------------------------------------------------------------ */
/* 6. ポーズ人形のマネキン線画（s3 の模写チェックポイント）                   */
/* ------------------------------------------------------------------ */
{
  // s5-poses-standing の「片足重心（コントラポスト）」のマネキン（36〜70 行目）を、少し大きくして中央に置く
  const src = bodyLines('s5-poses-standing').slice(36, 71).filter((l) => !/stroke-dasharray=/.test(l));
  writeSvg('s3-mannequin-lineart', [`<g transform="translate(400 250) scale(1.05) translate(-400 -236)">`, ...src.map((l) => `  ${l}`), '</g>']);
}

console.log(`生成: ${made.length} 件`);
for (const id of made) console.log(`  ${id}`);
