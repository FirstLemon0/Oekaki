#!/usr/bin/env node
/**
 * 教材レビュー（2026-09）の確定指摘を教材 JSON（content/stages/*.json）に反映するスクリプト。
 *
 *   node tools/patch-review-2026-09.mjs          … 変更を書き込む
 *   node tools/patch-review-2026-09.mjs --check  … 書き込まずに、変更が必要なところだけ表示（差分があれば exit 1）
 *
 * 何度実行しても同じ結果になる（冪等）。値は「こうあるべき」を直接書く（差分の足し引きはしない）。
 * 整形は既存ファイルの書き方を保つ（tools/json-format.mjs）。
 *
 * 図解・線画・部屋の角のなぞりテンプレートは tools/gen-review-figures.mjs で生成する。
 *
 * 番号はレビューの指摘番号:
 *   1 楕円の「軸」＝長い径（採点・見本と同じ）      9  s9/s10 の外部アプリ工程は free の取り込み
 *   2 Before / After の保存                         10 s4〜s6 の copy は線画（*-lineart）
 *   3 曲線・2点ドリルの本文を画面の目標に合わせる     11 長いレッスンは minutes を実態に＋「休日向け」
 *   4 前ステップの線が残る前提の指示を直す            12 s10-u2（選択式）の案内文
 *   5 肘の尖りの説明                                 13 mosha の指示文と s3 の refId
 *   6 配色の型（HSV の色相環）                       14 クイズの正解位置を散らす
 *   7 部屋の角は2点透視                              15 表記揺れ・題名・同じ文の反復
 *   8 250箱チャレンジの加算経路                       16 drill.params の未知キーと counter
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectFormat, formatAs } from './json-format.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STAGES = join(ROOT, 'content', 'stages');
const CHECK = process.argv.includes('--check');
const ALL = ['s0', 's1', 's1_5', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10'];

/* ------------------------------------------------------------------ */
/* 読み書き・探索                                                        */
/* ------------------------------------------------------------------ */

const files = new Map();
for (const id of ALL) {
  const file = join(STAGES, `${id}.json`);
  const text = readFileSync(file, 'utf8');
  // s1_5.json は 1 か所だけ construct の stages が複数行で書かれていて型が混ざっている。
  // そこだけ 1 行の書き方にそろえてよい（差分は数十行）ので、「プロパティ値も 1 行」の型で書く
  const format = detectFormat(text) ?? (id === 's1_5' ? { kind: 'inline', inlineIn: 'any' } : null);
  if (!format) throw new Error(`${id}.json の整形の型が判別できません（手で整形を戻してから実行してください）`);
  files.set(id, { file, text, format, data: JSON.parse(text) });
}

const lessons = new Map();
for (const { data } of files.values()) for (const u of data.units) for (const l of u.lessons) lessons.set(l.id, { lesson: l, unit: u, stage: data });

const log = [];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function L(id) {
  const hit = lessons.get(id);
  if (!hit) throw new Error(`レッスン ${id} が見つかりません`);
  return hit.lesson;
}

/** ステップを取り出す（負の番号は後ろから）。types を渡すと型を確かめる */
function S(id, i, types) {
  const steps = L(id).steps;
  const idx = i < 0 ? steps.length + i : i;
  const s = steps[idx];
  if (!s) throw new Error(`${id} [${i}] がありません`);
  if (types && !types.split('|').includes(s.type)) throw new Error(`${id} [${i}] は ${s.type}（想定: ${types}）`);
  return s;
}

/** オブジェクトのキーを差し替える（キーの並びは保つ。undefined は削除） */
function set(obj, patch, where) {
  const before = JSON.stringify(obj);
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete obj[k];
    else obj[k] = v;
  }
  if (JSON.stringify(obj) !== before) log.push(where);
}

/** ステップを丸ごと置き換える */
function put(id, i, step, types) {
  const steps = L(id).steps;
  const idx = i < 0 ? steps.length + i : i;
  S(id, i, types);
  if (!same(steps[idx], step)) {
    steps[idx] = step;
    log.push(`${id} [${idx}] ${step.type} を置き換え`);
  }
}

/** 最後のステップ（振り返り）の直前に、match に合うステップが無ければ差し込む（あれば置き換える） */
function ensureBeforeLast(id, match, step) {
  const steps = L(id).steps;
  const at = steps.findIndex(match);
  if (at >= 0) {
    if (!same(steps[at], step)) {
      steps[at] = step;
      log.push(`${id} [${at}] ${step.type} を置き換え`);
    }
    return;
  }
  steps.splice(steps.length - 1, 0, step);
  log.push(`${id} [${steps.length - 2}] ${step.type} を追加`);
}

/** 指定位置に、match に合うステップが無ければ差し込む */
function ensureAt(id, index, match, step) {
  const steps = L(id).steps;
  const at = steps.findIndex(match);
  if (at >= 0) {
    if (!same(steps[at], step)) {
      steps[at] = step;
      log.push(`${id} [${at}] ${step.type} を置き換え`);
    }
    return;
  }
  steps.splice(index, 0, step);
  log.push(`${id} [${index}] ${step.type} を追加`);
}

function replaceIn(id, i, key, from, to) {
  const s = S(id, i);
  if (typeof s[key] !== 'string') throw new Error(`${id} [${i}].${key} が文字列ではありません`);
  if (s[key].includes(from)) {
    s[key] = s[key].replaceAll(from, to);
    log.push(`${id} [${i}] ${key}: 「${from.slice(0, 16)}…」を置換`);
  } else if (!s[key].includes(to)) {
    throw new Error(`${id} [${i}].${key} に「${from.slice(0, 30)}」も置換後の文も見つかりません`);
  }
}

function allLessons() {
  return [...lessons.values()].map((x) => x.lesson);
}

/* ------------------------------------------------------------------ */
/* 1. 楕円の「軸」＝長い径                                              */
/* ------------------------------------------------------------------ */

set(L('s1-u3-l4'), { summary: '楕円の「軸」（長い径）の傾きを意識しながら、傾いた楕円を描きます。' }, 's1-u3-l4 summary');
put('s1-u3-l4', 0, {
  type: 'read',
  title: '楕円の「軸」は長い径',
  body:
    '楕円には、長い径（長い方の直径）と短い径（短い方の直径）があり、この2本は必ず直角に交わります。\n\n' +
    'このアプリでは、長い径を通る線を楕円の「軸」と呼びます。軸の傾きが、その楕円の傾きです。ドリルの右上に出る見本も、採点も、この長い径の傾きで見ています。\n\n' +
    '先に軸の線を1本引いてから、その線に対して上下対称になるように楕円を描くと、傾きが安定します。\n\n' +
    'なお、円柱を描くときの「中心の線」は、楕円の短い径と同じ向きになります。楕円の軸（長い径）とは直角なので、混ぜないようにしましょう。',
  figure: 'ellipse-axis',
});
set(
  S('s1-u3-l4', 1, 'drill'),
  {
    instruction: '軸（長い径）の線を、右上がりに60度くらい傾けて先に引き、その線に合わせて度合い50%くらいの楕円を15個描きましょう。右上の見本と同じ傾きです。',
    params: { degree: 0.5, axisAngleDeg: 120 },
  },
  's1-u3-l4 [1] 軸＝長い径（120°）',
);
set(
  S('s1-u3-l4', 2, 'drill'),
  { instruction: '軸（長い径）を縦にした、縦長の楕円（度合い50%くらい）を10個描きましょう。' },
  's1-u3-l4 [2] 軸＝長い径',
);
set(
  S('s1-u3-l4', 3, 'read'),
  {
    body: '軸の線を先に引くと、楕円の傾きは安定しましたか。\n\n楕円の傾きは、円柱や腕・脚を描くときに「どちらを向いているか」を伝える大事な手がかりです。今日はその考え方に触れられれば OK です。',
  },
  's1-u3-l4 [3] 振り返り',
);
replaceIn('s1-u3-l6', 0, 'body', '楕円は度合いと軸。', '楕円は度合いと軸（長い径の傾き）。');
set(
  S('s1-u3-l6', 3, 'drill'),
  {
    instruction: '軸（長い径）を右上がり45度に傾けた、度合い40%の楕円を10個描きましょう。先に軸の線を引いても OK です。',
    params: { degree: 0.4, axisAngleDeg: 135 },
  },
  's1-u3-l6 [3] 軸＝長い径（135°）',
);
replaceIn('s1_5-u1-l2', 2, 'instruction', '軸は横向き', '軸は縦向き');
replaceIn('s3-u5-l1', 0, 'body', '「円柱の楕円は軸にそろえる」', '「円柱の楕円は、短い径を中心の軸にそろえる」');
set(
  S('s3-u5-l1', 1, 'drill'),
  {
    instruction: '軸（長い径）を右上がり45度に傾けた楕円（度合い40%）を10個描きましょう。ななめに向いた腕の切り口の練習です。',
    params: { degree: 0.4, axisAngleDeg: 135 },
  },
  's3-u5-l1 [1] 軸＝長い径（135°）',
);
set(
  S('s5-u2-l1', 1, 'drill'),
  {
    instruction: '腕の断面として、軸（長い径）が右上がりに60度くらい傾いた楕円（度合い40%くらい）を10個描きましょう。右上の見本と同じ傾きです。',
    params: { degree: 0.4, axisAngleDeg: 120 },
  },
  's5-u2-l1 [1] 軸＝長い径（120°）',
);
put('s1-u3-l5', 0, {
  type: 'read',
  title: '同じ楕円を、中心線にそろえて重ねる',
  body:
    '円柱（缶やコップの形）は、上と下に同じ度合いの楕円を置き、左右を直線でつないだ形です。\n\n' +
    'コツは、先に円柱の中心線を1本引いて、上下の楕円がその線に対して左右対称になるようにすることです。中心線は、楕円の短い径と同じ向きになります。\n\n' +
    '下の楕円の奥側（見えない部分）も、うすく描いておくと形が確認しやすくなります。',
  figure: 'cylinder-mouth',
});
replaceIn('s2-u2-l4', 0, 'body', '楕円の短い径は、いつも軸と同じ向きにそろえます。', '楕円の短い径は、いつも中心の軸と同じ向きにそろえます（楕円そのものの軸＝長い径は、中心の軸と直角になります）。');
put(
  's2-u2-l4',
  2,
  {
    type: 'drill',
    drill: 'ellipse',
    count: 10,
    instruction: '円柱の口と底になる、度合い40%の横長の楕円を10個描きましょう。どれも同じ度合いにそろえることを意識します。',
    params: { degree: 0.4, axisAngleDeg: 0 },
    counter: 'ellipses',
  },
  'drill',
);

/* ------------------------------------------------------------------ */
/* 2. Before / After                                                    */
/* ------------------------------------------------------------------ */

set(S('s0-u1-l1', 1, 'free'), { save: 'before' }, 's0-u1-l1 [1] free: save before');
ensureAt('s10-u4-l3', 2, (s) => s.type === 'free' && s.save === 'after', {
  type: 'free',
  instruction: '最終課題の完成画像（書き出した PNG か JPEG）を取り込みましょう。「After」として保存され、ステージ0の Before と並べて見られます。',
  source: 'import',
  save: 'after',
});
put(
  's10-u4-l3',
  -1,
  {
    type: 'read',
    title: 'Before と並べる',
    body:
      '取り込んだ After を、ステージ0で描いた最初の1枚（Before）と並べてみましょう。成長通のギャラリーでも、2枚をいつでも並べて見返せます。\n\n' +
      '並べてみて、どこが一番変わったと感じますか。線の迷いのなさ、形のとらえ方、色。どれでも、それはここまで続けてきた時間そのものです。\n\n' +
      '成長通のカリキュラムはこれでおしまいです。自由お絵描き枠はこれからも使えます。次に描きたい1枚を、また自由に描いていきましょう。本当におつかれさまでした。',
    figure: 's10-before-after',
  },
  'read',
);

/* ------------------------------------------------------------------ */
/* 3. 曲線・2点ドリル: 画面の目標（ガイド線・アプリが置く点）に合わせる         */
/* ------------------------------------------------------------------ */

replaceIn(
  's1-u1-l4',
  0,
  'body',
  '2つの点を結ぶときは、まず始点と終点を打ってから、空中で動きを予行しましょう。',
  '2つの点を結ぶときは、まず始点と終点を確かめてから、空中で動きを予行しましょう。ドリルでは、2つの点をアプリが画面に置きます。',
);
set(S('s1-u1-l4', 1, 'drill'), { instruction: '画面に出る2つの点を、1本の直線で結びましょう。点の位置と向きは1本ごとに変わります。15組やってみます。' }, 's1-u1-l4 [1]');
set(S('s1-u1-l4', 2, 'drill'), { instruction: '今度は点と点の距離が広がります。長めの線で10組結びましょう。長い線は肩から動かします。' }, 's1-u1-l4 [2]');
set(S('s1-u1-l6', 3, 'drill'), { instruction: '画面に出る2つの点を結ぶ、斜めの線を10組引きましょう。目は終点を見ます。' }, 's1-u1-l6 [3]');

const GUIDE = '破線のガイド';
set(S('s1-u2-l1', 1, 'drill'), { instruction: `画面に出る${GUIDE}に重ねるように、ゆるやかなCカーブを15本引きましょう。ガイドとどれだけ重なったかで採点されます。` }, 's1-u2-l1 [1]');
set(S('s1-u2-l1', 2, 'drill'), { instruction: `今度は曲がりの強いCカーブ（半円に近いもの）の${GUIDE}が出ます。ガイドに沿って10本引きましょう。大きく曲がるので、肘から動かします。` }, 's1-u2-l1 [2]');
set(S('s1-u2-l2', 1, 'drill'), { instruction: `画面に出るSカーブの${GUIDE}に沿って、上から下へ15本引きましょう。途中で止まらず、一定の速さで引き切ります。` }, 's1-u2-l2 [1]');
set(S('s1-u2-l2', 2, 'drill'), { instruction: `横向きのSカーブの${GUIDE}に沿って、10本引きましょう。長いものは肘や肩から動かして OK です。` }, 's1-u2-l2 [2]');
set(S('s1-u2-l3', 1, 'drill'), { instruction: `画面の左から右へ、波線の${GUIDE}に沿って10本引きましょう。山の幅と高さをガイドにそろえます。` }, 's1-u2-l3 [1]');
set(S('s1-u2-l3', 2, 'drill'), { instruction: `中心から外へ、スパイラルの${GUIDE}（2周半）に沿って6個描きましょう。線と線の間隔を同じに保ちます。` }, 's1-u2-l3 [2]');
replaceIn(
  's1-u2-l4',
  0,
  'body',
  '点を3〜4個打ったら、全部を通る道すじを空中で2〜3回なぞりましょう。',
  '点を3〜4個決めたら（ドリルでは、点をアプリが画面に置きます）、全部を通る道すじを空中で2〜3回なぞりましょう。',
);
set(
  S('s1-u2-l4', 1, 'drill'),
  { instruction: '画面に出る3つの点を、全部通る1本の曲線で結びましょう。点の配置は1本ごとに変わります。12回やってみます。点を通るなめらかな曲線（画面には出ません）にどれだけ近いかで採点されます。' },
  's1-u2-l4 [1]',
);
set(S('s1-u2-l4', 2, 'drill'), { instruction: '今度は4つの点を通る曲線を8本引きましょう。途中で向きが変わるSカーブになることもあります。' }, 's1-u2-l4 [2]');
set(S('s1-u2-l5', 1, 'drill'), { instruction: `Cカーブの${GUIDE}に沿って、8本引きましょう。` }, 's1-u2-l5 [1]');
set(S('s1-u2-l5', 2, 'drill'), { instruction: `Sカーブの${GUIDE}に沿って、8本引きましょう。` }, 's1-u2-l5 [2]');
set(S('s1-u2-l5', 3, 'drill'), { instruction: '画面に出る3つの点を通る曲線を、6本引きましょう。' }, 's1-u2-l5 [3]');
set(S('s1-u5-l1', 2, 'drill'), { instruction: `Sカーブの${GUIDE}に沿って、6本引きましょう。` }, 's1-u5-l1 [2]');
set(S('s1_5-u1-l3', 2, 'drill'), { instruction: `眉や口の練習として、${GUIDE}に沿ってゆるやかなCカーブを12本引きましょう。眉や口の線は、この弧を短く切り取った形です。` }, 's1_5-u1-l3 [2]');
set(S('s3-u3-l2', 2, 'drill'), { instruction: `くびれの線のつもりで、${GUIDE}に沿ってCカーブを10本引きましょう。` }, 's3-u3-l2 [2]');
set(S('s4-u4-l2', 2, 'drill'), { instruction: `口の線の練習として、${GUIDE}に沿ってCカーブを12本引きましょう。口のカーブは、この弧を短く切り取った形です。` }, 's4-u4-l2 [2]');
set(
  S('s4-u6-l3', 1, 'drill'),
  { instruction: `束の練習として、Sカーブの${GUIDE}に沿って、上から下へ15本引きましょう。最後はペンを持ち上げながら抜きます（抜きは採点に入りませんが、毛先の練習になります）。` },
  's4-u6-l3 [1]',
);
// そのほかの曲線ドリル: ガイドに沿うことを一言添える
for (const l of allLessons()) {
  l.steps.forEach((s, i) => {
    if (s.type !== 'drill' || s.drill !== 'curve') return;
    if (s.params?.shape === 'through-points' || /ガイド|点/.test(s.instruction)) return;
    s.instruction = `${s.instruction}画面の${GUIDE}に重ねるように引きます。`;
    log.push(`${l.id} [${i}] curve: ガイドの一言`);
  });
}

/* ------------------------------------------------------------------ */
/* 4. 前ステップの線が残る前提の指示                                        */
/* ------------------------------------------------------------------ */

put(
  's1-u3-l5',
  1,
  {
    type: 'drill',
    drill: 'ellipse',
    count: 20,
    instruction: '円柱の口と底になる、度合い40%くらいの横長の楕円を20個描きましょう。上と下の楕円を同じ度合いにそろえるつもりで、1個ずつ度合いを合わせます。',
    params: { degree: 0.4, axisAngleDeg: 0 },
    counter: 'ellipses',
  },
  'drill',
);
put(
  's1-u3-l5',
  2,
  {
    type: 'construct',
    instruction: '楕円を重ねて、円柱を3つ組み立てましょう。',
    stages: [
      { title: '中心線', figure: 'cylinder-mouth', instruction: '縦の線を1本引きます。これが円柱の中心線です。' },
      { title: '上の楕円', instruction: '中心線の上のほうに、度合い40%くらいの横長の楕円を描きます。中心線が楕円の短い径と重なるようにします。' },
      { title: '下の楕円', instruction: '同じ度合いの楕円を、中心線の下のほうに描きます。奥側（見えない半分）はうすく描いて OK です。' },
      { title: '左右をつなぐ', instruction: '上下の楕円の左右の端を、直線でつなぎます。場所と高さを変えて、あと2つ描きましょう。' },
    ],
  },
  'drill|construct',
);
put(
  's1-u4-l2',
  2,
  {
    type: 'construct',
    instruction: '円を描いて、線の太さの差を見比べましょう。',
    stages: [
      { title: '円を描く', figure: 'line-weight', instruction: 'ふつうの筆圧で、円を1つ描きます。' },
      { title: '外側を太く', instruction: '円の外側の輪郭を、少し強めの筆圧でもう一度なぞって太くします。' },
      { title: '内側に細い線', instruction: '円の内側に、弱い筆圧で短い線を1本入れます。場所を変えて、同じセットをあと2つ描きましょう。' },
    ],
  },
  'drill|construct',
);
set(S('s1-u4-l3', 2, 'drill'), { instruction: '今度は反対向き（-45度）の線を、同じ間隔で20本並べましょう。' }, 's1-u4-l3 [2]');
ensureAt('s1-u4-l3', 3, (s) => s.type === 'construct', {
  type: 'construct',
  instruction: '四角の中に線を重ねて、クロスハッチングを作りましょう。',
  stages: [
    { title: '四角', figure: 'hatching', instruction: '小さな四角を1つ描きます。' },
    { title: '45度の線', instruction: '四角の中に、45度の短い線を同じ間隔で並べます。' },
    { title: '-45度を重ねる', instruction: '同じ四角の中に、反対向き（-45度）の線を重ねます。1方向だけのときより暗く見えれば OK です。' },
  ],
});
set(
  S('s2-u4-l5', 1, 'drill'),
  { instruction: '45度のハッチングを、同じ間隔で20本並べましょう。間隔をそろえられると、詰めたり広げたりして暗さを変えるのも自由になります。' },
  's2-u4-l5 [1]',
);
put(
  's2-u4-l5',
  2,
  {
    type: 'construct',
    instruction: '線の密度で、暗さを3段階に描き分けましょう。',
    stages: [
      { title: '3つのマス', figure: 'hatching-shade', instruction: '横に並んだ四角を3つ描きます。' },
      { title: '明るい段', instruction: '左の四角に、45度の線を広めの間隔で並べます。' },
      { title: '中間の段', instruction: 'まん中の四角に、45度の線を狭い間隔で並べます。' },
      { title: 'いちばん暗い段', instruction: '右の四角に、45度の線を並べてから、-45度の線を重ねてクロスハッチングにします。' },
    ],
  },
  'drill|construct',
);

/* ------------------------------------------------------------------ */
/* 5. 肘の尖りは上腕で決まる                                              */
/* ------------------------------------------------------------------ */

put('s5-u2-l2', 0, {
  type: 'read',
  title: '肘の尖りは上腕で決まる',
  body:
    '腕を曲げると、肘の尖り（肘頭）は、曲げた内側の反対、つまり上腕の後ろ側に出ます。尖りの向きを決めるのは上腕の向きです。手首をひねっても、肘の尖りは動きません。\n\n' +
    '手のひらの向きを変えるのは、前腕のひねりです。前腕には2本の骨があり、手のひらを上に向けると平行に、下に向けると交差します。このとき動くのは肘から先だけです。絵では、前腕の円柱に「ひねりの線」を1本入れるだけで表せます。\n\n' +
    '細かい骨の形は描かなくて OK です。「肘の尖りは上腕の後ろ側」「手のひらの向きは前腕のひねり」と、分けて覚えておきましょう。',
  figure: 's5-elbow-wrist',
});
put(
  's5-u2-l2',
  1,
  {
    type: 'construct',
    instruction: '上腕の向きは同じまま、手のひらの向きだけが違う腕を2本描き比べましょう。',
    stages: [
      { title: '手のひらが上の腕', figure: 's5-arm-cylinders', instruction: '肘を軽く曲げた腕を描き、手のひらが上を向くように手首の球を置きます。前腕のひねりの線はまっすぐです。' },
      { title: '手のひらが下の腕', figure: 's5-elbow-wrist', instruction: '上腕の向きと肘の曲げ方は1本目と同じにして、手のひらが下を向く腕を描きます。前腕にねじれた線を1本入れます。' },
      { title: '肘の尖り', instruction: 'どちらの腕にも、上腕の後ろ側（曲げた内側の反対）に肘の尖りを小さく描きます。2本で同じ位置になっていれば OK です。' },
    ],
  },
  'construct',
);
put(
  's5-u2-l2',
  2,
  {
    type: 'quiz',
    question: '肘を軽く曲げた腕で、手首をひねって手のひらを上から下へ向け変えました。肘の尖りはどうなりますか？',
    options: [{ text: '手のひらと反対側へ回り込む' }, { text: '動かない（上腕の後ろ側のまま）' }, { text: '親指の側へ動く' }],
    answer: 1,
    explain: '肘の尖りは上腕とつながる関節の端にあり、上腕の向きで決まります。手のひらの向きを変えるのは前腕のひねりなので、肘の尖りは動きません。',
  },
  'quiz',
);
set(S('s5-u2-l2', 3, 'read'), { body: '肘の尖りは上腕、手のひらの向きは前腕のひねり。2つを分けて考えられましたか。\n\n次のレッスンでは、いよいよ手の形に進みます。' }, 's5-u2-l2 [3]');

/* ------------------------------------------------------------------ */
/* 6. 配色の型（HSV の色相環）                                            */
/* ------------------------------------------------------------------ */

set(
  S('s9-u2-l2', 0, 'read'),
  {
    body:
      '色の組み合わせに迷ったら、色相環の上での位置関係で選ぶと、まとまりやすくなります。\n\n' +
      'ここでは、お絵描きアプリのカラーピッカーと同じ色相環（HSV）で考えます。この輪では、赤の反対はシアン、青の反対は黄、緑の反対はマゼンタです（絵の具の色相環とは少し違います）。\n\n' +
      '類似色: 色相環でとなり合う色どうし（水色と青と青紫など）。落ち着いた、まとまりのある印象です。\n\n' +
      '補色: 色相環で反対側にある色どうし（青と黄、赤とシアンなど）。おたがいを引き立て合い、目立ちます。面積に差をつけて、片方を少しだけ使うのがコツです。\n\n' +
      'トライアド: 色相環を三等分した3色（赤・緑・青など）。にぎやかで元気な印象です。彩度を少し下げると使いやすくなります。',
  },
  's9-u2-l2 [0] HSV の色相環',
);
put(
  's9-u2-l2',
  1,
  {
    type: 'quiz',
    question: '青い服のキャラクターに、目立つアクセントの色を少しだけ足したい。お絵描きアプリの色相環（HSV）で補色を選ぶならどれ？',
    options: [{ text: '水色' }, { text: '紺色' }, { text: '黄色' }],
    answer: 2,
    explain: 'HSV の色相環で青の反対側にあるのは黄です。小さな面積に使うと、青い服を引き立てるアクセントになります。',
  },
  'quiz',
);

/* ------------------------------------------------------------------ */
/* 7. 部屋の角は2点透視                                                  */
/* ------------------------------------------------------------------ */

set(L('s8-u2-l2'), { summary: '部屋の角を2点透視でとらえて、簡単な室内の一角を描きます。' }, 's8-u2-l2 summary');
put('s8-u2-l2', 0, {
  type: 'read',
  title: '部屋の角は線3本',
  body:
    '室内の背景は、部屋全体を描かなくても、角を1つ描くだけで成り立ちます。\n\n' +
    '部屋の角をななめから見ると、左の壁と右の壁は、それぞれ別の向きに奥へ伸びています。だから消失点は2つ。ステージ2で学んだ2点透視です。アイレベル（目の高さの線）を横に引き、その線の左右に消失点を1つずつ置きます。\n\n' +
    '部屋の角は、縦の線1本と、床と壁の境目の線2本でできています。左の壁の境目は右の消失点へ、右の壁の境目は左の消失点へ向かいます。角の下の端から、それぞれ反対側の消失点を目がけて線を引き、手前へのばしましょう。窓や机の横の線も、その壁と同じ消失点へ向けます。\n\n' +
    '外部アプリには、定規やパース定規の機能があるものもあります（例: CLIP STUDIO の「パース定規」、Krita の「アシスタントツール」）。なくても、消失点に点を打って定規ツールで引けば十分です。',
  figure: 's8-room-corner',
});
set(
  S('s8-u2-l2', 1, 'trace'),
  { instruction: '部屋の角・床と壁の境目・窓のお手本をなぞりましょう。左右の境目と窓の横の辺が、どちらの消失点に向かっているか意識します。' },
  's8-u2-l2 [1]',
);
put(
  's8-u2-l2',
  2,
  {
    type: 'construct',
    instruction: '成長通のキャンバスで、2点透視の部屋の一角を描いてみましょう。',
    stages: [
      { title: 'アイレベルと2つの消失点', figure: 's8-room-corner', instruction: '横線を1本引き、その線の左右の端近くに消失点を1つずつ打ちます。' },
      { title: '部屋の角', figure: 's8-room-corner', instruction: '縦の線を1本引きます。下の端から、右の消失点を目がけた線を左の手前へ、左の消失点を目がけた線を右の手前へのばすと、床と壁の境目になります。' },
      { title: '窓か机を1つ', figure: 's8-room-corner', instruction: '窓か机を1つだけ足します。縦の辺はまっすぐ垂直に、横の辺はその壁と同じ消失点へ向けます。' },
    ],
  },
  'construct',
);

/* ------------------------------------------------------------------ */
/* 8. 250箱チャレンジの加算経路                                           */
/* ------------------------------------------------------------------ */

const boxTrace = (template, count, lead) => ({
  type: 'trace',
  template,
  instruction: `${lead}お手本の箱を${count}回なぞりましょう。1回なぞるごとに、箱カウンターが1個増えます（250箱チャレンジ）。`,
  count,
  counter: 'boxes',
});
// U2-2: 各レッスン末の「長い直線10本」を、箱のなぞりに
// （l1・l2 は前半にも箱のなぞりと構築があるので 3 回、l4〜l6 は 4 回）
for (const [id, i, tpl, n] of [
  ['s2-u2-l1', 3, 'cube-1pt', 3],
  ['s2-u2-l2', 3, 'cube-2pt', 3],
  ['s2-u2-l4', 4, 'cube-1pt', 4],
  ['s2-u2-l5', 3, 'cube-2pt', 4],
  ['s2-u2-l6', 3, 'cube-2pt', 4],
]) {
  put(id, i, boxTrace(tpl, n, '仕上げに、'), 'drill|trace');
}
// l3 は冒頭のなぞり（2回）と箱を回す構築（5個）で 15 分いっぱいなので、末尾の直線を外すだけにする
{
  const steps = L('s2-u2-l3').steps;
  const at = steps.findIndex((s, i) => i > 2 && s.type === 'drill' && s.instruction.startsWith('仕上げに'));
  if (at >= 0) {
    steps.splice(at, 1);
    log.push('s2-u2-l3 末尾の直線ドリルを外す');
  }
}
replaceIn('s2-u2-l1', -1, 'body', '今日から箱を描くたびに数えていきます。まずは3個、お疲れさまでした。', '今日から箱を描くたびに数えていきます。今日の分は9個、おつかれさまでした。');
// 箱をなぞっているのに数えていなかったなぞり
for (const [id, i] of [
  ['s2-u3-l3', 1],
  ['s3-u4-l1', 1],
]) {
  const s = S(id, i, 'trace');
  if (!/^cube-/.test(s.template)) throw new Error(`${id} [${i}] は箱のなぞりではありません`);
  set(s, { instruction: '2点透視の箱をなぞって、手順を思い出しましょう。1回なぞるごとに、箱カウンターが1個増えます。', counter: 'boxes' }, `${id} [${i}] counter: boxes`);
}
// Robo Bean の「箱の辺を狙う直線」は、箱そのものをなぞる
put('s3-u4-l2', 2, boxTrace('cube-2pt', 5, '箱の辺を狙う練習として、2点透視の'), 'drill|trace');
// ユニットの締めに、短い箱のなぞり
for (const [id, tpl] of [
  ['s2-u3-l5', 'cube-2pt'],
  ['s2-u4-l3', 'cube-1pt'],
  ['s2-u5-l4', 'cube-2pt'],
]) {
  ensureBeforeLast(id, (s) => s.type === 'trace' && s.counter === 'boxes' && s.instruction.startsWith('ユニットの締めに'), boxTrace(tpl, 3, 'ユニットの締めに、'));
}

/* ------------------------------------------------------------------ */
/* 9. s9/s10 の外部アプリ工程は、取り込みの free                             */
/* ------------------------------------------------------------------ */

const IMPORT_TAIL = '塗り終えたら画像として書き出し、ここで取り込みましょう（採点はなく、記録として残ります）。';
const FREE_TEXT = {
  's9-u2-l2': '外部アプリで、ベタ塗りした絵を複製し、服と背景の色を「類似色」版と「補色」版の2通りに塗り替えて比べてみましょう。気に入ったほう（または2枚を並べた画像）を書き出し、ここで取り込みましょう（採点はなく、記録として残ります）。',
  's10-u3-l2': '外部アプリで、仕上げた絵にオーバーレイのレイヤーを1枚足し、暖色版と寒色版を切り替えて比べてみましょう。気に入ったほうを残して書き出し、ここで取り込みましょう（採点はなく、記録として残ります）。',
};
for (const l of allLessons()) {
  if (!/^s(9|10)-/.test(l.id)) continue;
  l.steps.forEach((s, i) => {
    if (s.type !== 'free' || s.save === 'after') return;
    if (!s.instruction?.startsWith('外部アプリで')) return;
    const text = FREE_TEXT[l.id] ?? s.instruction.replace('描いた時間を自由枠として記録します。', IMPORT_TAIL);
    if (!text.endsWith(IMPORT_TAIL) && !FREE_TEXT[l.id]) throw new Error(`${l.id} [${i}] free の文末が想定と違います`);
    set(s, { instruction: text, source: 'import' }, `${l.id} [${i}] free: source import`);
  });
}

/* ------------------------------------------------------------------ */
/* 10. s4〜s6 の copy は線画（*-lineart）                                   */
/* ------------------------------------------------------------------ */

const LINEART_SRC = [
  's4-eye-parts', 's4-eye-types', 's4-nose-anime', 's4-mouth-shapes', 's4-brow-expression', 's4-ear-simple',
  's4-expressions-6', 's4-expression-intensity', 's4-hair-blocks', 's4-hair-flow', 's4-hairstyles',
  's5-torso-gender', 's5-hand-poses', 's5-foot-shoe', 's5-poses-standing',
  's6-fold-types', 's6-cloth-weight', 's6-skirt-pants', 's6-accessories', 's6-bag-weapon', 's6-shoes-hats',
];
for (const l of allLessons()) {
  if (!/^s[456]-/.test(l.id)) continue;
  l.steps.forEach((s, i) => {
    if (s.type !== 'copy' || s.reference !== 'builtin' || !LINEART_SRC.includes(s.refId)) return;
    set(s, { refId: `${s.refId}-lineart`, instruction: s.instruction.replace('の図を', 'の線画を').replace('の図の', 'の線画の') }, `${l.id} [${i}] copy → ${s.refId}-lineart`);
  });
}
set(S('s4-u3-l1', 3, 'copy'), { instruction: '目の線画を横に見ながら、上まぶた → 虹彩と瞳孔 → ハイライト → 下まぶたの順で描きましょう。二重の線とまつ毛は最後に足します。' }, 's4-u3-l1 [3]');
set(S('s4-u6-l3', 2, 'copy'), { instruction: '流れと束の線画を横に見ながら描きましょう。つむじから毛先へ向かう流れに沿って、大きな束から先に描きます。' }, 's4-u6-l3 [2]');

/* ------------------------------------------------------------------ */
/* 11. 長いレッスン: minutes を実態に＋「休日向け」                            */
/* ------------------------------------------------------------------ */

const HOLIDAY = [
  // 卒業課題・最終課題
  's1-u5-l3', 's1_5-u2-l4', 's2-u6-l5', 's3-u6-l2', 's4-u7-l2', 's5-u5-l2', 's6-u4-l2', 's7-u3-l3', 's8-u3-l1', 's9-u3-l1', 's10-u4-l1', 's10-u4-l2',
  // 模写チェックポイント（模写→印→描き直し）
  's1-u5-l2', 's2-u6-l4', 's3-u6-l1', 's4-u7-l1', 's5-u5-l1', 's6-u4-l1', 's7-u3-l2',
  // そのほか 15 分に収まらない回
  's3-u2-l5', 's5-u4-l5', 's7-u1-l1', 's7-u3-l1',
];
const HOLIDAY_NOTE = '休日向け（約 30 分）。';
for (const id of HOLIDAY) {
  const l = L(id);
  const summary = l.summary.includes('休日向け') ? l.summary : `${l.summary}${HOLIDAY_NOTE}`;
  set(l, { minutes: 30, summary }, `${id} minutes 30・休日向け`);
}

/* ------------------------------------------------------------------ */
/* 12. s10-u2（選択式）の案内文                                             */
/* ------------------------------------------------------------------ */

const OLD_SKIP = 'この技法を選ばない場合は次のユニットへ進んで OK です。';
const NEW_SKIP = 'この技法をやらない場合は、ヘッダの「この技法は飛ばす」で3課とも飛ばして OK です。';
for (const l of L('s10-u2-l1') && lessons.get('s10-u2-l1').unit.lessons) {
  const first = l.steps.find((s) => s.type === 'read');
  if (first.body.startsWith(OLD_SKIP)) {
    first.body = NEW_SKIP + first.body.slice(OLD_SKIP.length);
    log.push(`${l.id} 選択式の案内文`);
  } else if (!first.body.startsWith(NEW_SKIP)) {
    throw new Error(`${l.id}: 最初の read の冒頭文が想定と違います`);
  }
}
replaceIn('s10-u2-l1', 0, 'body', 'パスの上ではすべてのレッスンが並んでいるので、選ばない技法のレッスンは、説明を読んで練習の枠を短く閉じれば先へ進めます。', '');
replaceIn('s10-u2-l1', 0, 'body', '1つ以上を選んで、じっくり練習しましょう。\n\nアニメ塗りは', '1つ以上を選んで、じっくり練習しましょう。選ばない技法のレッスンは、ヘッダの「この技法は飛ばす」で飛ばせます（あとから開いて取り組むこともできます）。\n\nアニメ塗りは');
replaceIn(
  's10-u2-l3',
  -1,
  'body',
  'アニメ塗りで進むと決めたなら、次のユニット（仕上げ）へ進んでOKです。',
  'アニメ塗りで進むと決めたなら、厚塗り入門と水彩風のレッスンは、ヘッダの「この技法は飛ばす」で飛ばして、次のユニット（仕上げ）へ進んで OK です。',
);
replaceIn(
  's10-u2-l6',
  -1,
  'body',
  '厚塗りで進むと決めたなら、次のユニット（仕上げ）へ進んでOKです。',
  '厚塗りで進むと決めたなら、水彩風のレッスンは、ヘッダの「この技法は飛ばす」で飛ばして、次のユニット（仕上げ）へ進んで OK です。',
);

/* ------------------------------------------------------------------ */
/* 13. mosha の指示文（描き直し → 差分に印 → 1か所変えて描き直す）と refId         */
/* ------------------------------------------------------------------ */

const MOSHA_FLOW = '描き終えたらお手本と並べて（重ねても見られます）見比べ、違うところをタップして印をつけます。';
const MOSHA = {
  's1-u5-l2': `カップか葉のお手本を選んで、もう一度模写しましょう。${MOSHA_FLOW}最後に、取っ手の形や葉の向きなど、1か所だけ自由に変えて、もう1枚描きます。自分で用意した画像を取り込んでお手本にしても OK です。`,
  's2-u6-l4': `マグカップかペットボトルのお手本を選んで、もう一度模写しましょう。${MOSHA_FLOW}最後に、取っ手の形やボトルのくびれなど、1か所だけ自由に変えて、もう1枚描きます。身の回りの日用品の写真を取り込んで、図形分解から模写しても OK です。`,
  's3-u6-l1': `マネキンのお手本（線画）を見ながら、もう一度模写しましょう。${MOSHA_FLOW}最後に、腕の角度や顔の向きなど、1か所だけ自由に変えて、もう1枚描きます。自分で用意したポーズの写真を取り込んでお手本にしても OK です。`,
  's4-u7-l1': `前のステップで模写した絵を「取り込んだ画像から選ぶ」で選び、もう一度模写しましょう。${MOSHA_FLOW}特に目の位置と幅を見比べます。最後に、表情か髪型を1か所だけ自由に変えて、もう1枚描きます。`,
  's5-u5-l1': `前のステップで模写した全身イラストを「取り込んだ画像から選ぶ」で選び、今度はマネキンの形で描き直しましょう。${MOSHA_FLOW}最後に、マネキンの腕か脚の角度を1か所だけ変えて、もう1枚描きます。`,
  's6-u4-l1': `前のステップで模写した絵を「取り込んだ画像から選ぶ」で選び、もう一度模写しましょう。${MOSHA_FLOW}特にシワの起点を見比べます。最後に、袖の長さやスカートの丈など、服を1か所だけ自由に変えて、もう1枚描きます。`,
  's7-u3-l2': `好きな絵を取り込んでお手本に選び、線画を模写しましょう。${MOSHA_FLOW}最後に、髪型や表情など1か所だけ自由に変えて、もう1枚描きます。`,
};
for (const [id, text] of Object.entries(MOSHA)) {
  const steps = L(id).steps;
  const i = steps.findIndex((s) => s.type === 'mosha');
  if (i < 0) throw new Error(`${id} に mosha がありません`);
  set(steps[i], { instruction: text, ...(id === 's3-u6-l1' ? { refId: 's3-mannequin-lineart' } : {}) }, `${id} [${i}] mosha の指示文`);
}

/* ------------------------------------------------------------------ */
/* 15. 表記揺れ・題名・同じ文の反復                                         */
/* ------------------------------------------------------------------ */

set(L('s4-u1-l4'), { title: '頭の角度を変えて3問' }, 's4-u1-l4 title');
set(L('s4-u5-l3'), { title: '表情を描き分けて4問' }, 's4-u5-l3 title');
set(L('s5-u2-l5'), { title: '手の角度を変えて3問' }, 's5-u2-l5 title');
set(L('s4-u1-l4'), { summary: '指定された角度で頭を組み立てる練習を、3問続けて行います。' }, 's4-u1-l4 summary');
set(L('s4-u5-l3'), { summary: '指定された4つの表情を、眉・目・口の組み合わせで描き分けます。' }, 's4-u5-l3 summary');
set(L('s5-u2-l5'), { summary: '指定された角度とポーズで、手を組み立てる練習を3問行います。' }, 's5-u2-l5 summary');
replaceIn('s4-u5-l3', 0, 'body', '今日は出題された表情を描きます。', '今日は指定された4つの表情を描きます。');
replaceIn('s4-u5-l3', 2, 'instruction', '出題された順に、表情を描きましょう。', 'お題の順に、表情を描きましょう。');

const REPEAT = '違いが見つかるのは、見る目が育っている証拠です。';
const VARIANT = {
  's1-u5-l2': '違いが見つかったら、それだけ見る目が細かくなってきたということです。',
  's2-u6-l4': '違いがたくさん見つかっても大丈夫。見つけた数だけ、次に直せる場所が増えます。',
  's3-u6-l1': '見つけた違いは、次にポーズを描くときの確認ポイントになります。',
  's4-u7-l1': '目の位置や幅のずれに気づけたら、それが次の1枚で直すところです。',
};
for (const [id, text] of Object.entries(VARIANT)) replaceIn(id, 0, 'body', REPEAT, text);
replaceIn('s3-u6-l1', 0, 'body', '描き終えたらお手本と重ねて、違うところを探します。', '最後の模写チェックポイントでは、マネキンのお手本（線画）をもう一度模写して、お手本と見比べます。');
replaceIn('s6-u4-l1', -1, 'body', '服を1か所変えられたなら、服の形を理解できている証拠です。', '服を1か所変えられたなら、服のつくりがつかめてきています。');

/* ------------------------------------------------------------------ */
/* 16. drill.params の未知キーと counter                                   */
/* ------------------------------------------------------------------ */

/** 採点・画面に反映しない（表示もしない）キー。本文で説明しているので削除する */
const DROP_PARAMS = ['speed', 'joint', 'technique', 'weight'];
for (const l of allLessons()) {
  l.steps.forEach((s, i) => {
    if (s.type !== 'drill') return;
    if (s.params) {
      for (const k of DROP_PARAMS) {
        if (k in s.params) {
          delete s.params[k];
          log.push(`${l.id} [${i}] params.${k} を削除`);
        }
      }
      if (Object.keys(s.params).length === 0) delete s.params;
    }
    // 直線だけが「直線」カウンターに加算される（曲線・ハッチング・筆圧は数えない）
    if (['curve', 'hatching', 'pressure'].includes(s.drill) && s.counter) {
      delete s.counter;
      log.push(`${l.id} [${i}] ${s.drill}: counter を外す`);
    }
  });
}

/* ------------------------------------------------------------------ */
/* 14. クイズの正解位置を散らす                                             */
/* ------------------------------------------------------------------ */

/** 図に A/B/C のラベルがあるもの・並び順に意味があるものは、ここで並びを決める */
const QUIZ_FIXED = {
  's2-u4-l1#1': {
    options: [{ text: 'A', figure: 'quiz-sphere-b' }, { text: 'B', figure: 'quiz-sphere-c' }, { text: 'C', figure: 'quiz-sphere-a' }],
    answer: 2,
    explain: '光源と反対側（右下）が陰になり、落ち影も光源と反対の右へ伸びます。Aは陰が光源側、Bは落ち影が光源側に伸びています。',
  },
  's2-u4-l3#1': {
    options: [{ text: '左へ伸びている', figure: 'quiz-sphere-c' }, { text: '右へ伸びている', figure: 'quiz-sphere-a' }],
    answer: 1,
  },
  's4-u2-l1#3': { options: [{ text: '目の半分' }, { text: '目1つ分' }, { text: '目2つ分' }], answer: 1 },
  's8-u1-l2#1': null, // 下で入れ替え
  's9-u1-l2#1': 'keep', // 1〜2色 / 3〜5色 / 8色以上（並び順に意味がある）
  's9-u2-l1#1': {
    options: [{ text: 'A', figure: 's9-sat-b' }, { text: 'B', figure: 's9-sat-a' }],
    answer: 1,
    explain: 'B は、髪や服の色が鮮やかで、はっきりしています。A は灰色が混ざったような、落ち着いた色（彩度が低い色）です。',
  },
  's9-u2-l1#2': 'keep',
  's2-u4-l2#1': {
    options: [{ text: 'A', figure: 'quiz-cube-b' }, { text: 'B', figure: 'quiz-cube-a' }],
    answer: 0,
    explain: '上面がいちばん明るく、光源側の左面が中間、反対の右面がいちばん暗いAが正解です。',
  },
  's5-u2-l2#2': 'keep', // 5. で作り直したクイズ
  's9-u2-l2#1': 'keep', // 6. で作り直したクイズ
};
/** 3択の正解位置の並び（0 始まり）。規則的に見えないよう、6 個ごとに 0/1/2 を 2 回ずつ */
const PATTERN3 = [2, 0, 1, 1, 2, 0, 0, 2, 1, 2, 1, 0];
let k3 = 0;
for (const l of allLessons()) {
  l.steps.forEach((s, i) => {
    if (s.type !== 'quiz') return;
    const key = `${l.id}#${i}`;
    const fixed = QUIZ_FIXED[key];
    if (fixed === 'keep') return;
    if (fixed) {
      set(s, fixed, `${key} クイズの並び`);
      return;
    }
    let target;
    if (s.options.length === 2) target = key === 's8-u1-l2#1' ? 1 : s.answer;
    else target = PATTERN3[k3++ % PATTERN3.length];
    if (target === s.answer) return;
    const correct = s.options[s.answer];
    const rest = s.options.filter((_, j) => j !== s.answer);
    rest.splice(target, 0, correct);
    s.options = rest;
    s.answer = target;
    log.push(`${key} 正解を ${target + 1} 番目へ`);
  });
}

/* ------------------------------------------------------------------ */
/* 15'. 表記揺れ（最後に全文へ）                                           */
/* ------------------------------------------------------------------ */

function normalizeText(v) {
  return v.replaceAll('OKです', 'OK です').replaceAll('お疲れさま', 'おつかれさま');
}
function walk(obj, where) {
  if (Array.isArray(obj)) return obj.forEach((x, i) => walk(x, `${where}[${i}]`));
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') {
      const n = normalizeText(v);
      if (n !== v) {
        obj[k] = n;
        log.push(`${where}.${k}: 表記揃え`);
      }
    } else walk(v, `${where}.${k}`);
  }
}
for (const [id, f] of files) walk(f.data, id);

/* ------------------------------------------------------------------ */

let dirty = false;
for (const [id, f] of files) {
  if (JSON.stringify(f.data) === JSON.stringify(JSON.parse(f.text))) continue;
  dirty = true;
  if (!CHECK) writeFileSync(f.file, formatAs(f.format, f.data));
  console.log(`${CHECK ? '要変更' : '書き込み'}: ${id}.json`);
}
if (!dirty) console.log('変更なし（すでに適用済み）');
else console.log(`${log.length} 件の変更`);
if (process.argv.includes('--verbose')) for (const l of log) console.log(`  - ${l}`);
if (CHECK && dirty) process.exit(1);
