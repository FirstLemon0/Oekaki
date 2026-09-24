#!/usr/bin/env node
/**
 * 教材修正 A（ステージ 0・1・1.5・2・3・4）。3 系統レビュー（絵の先生／初心者体験／編集者）の確定指摘を直す。
 *
 *   node tools/patch-content-fix-a.mjs          … 変更を書き込む
 *   node tools/patch-content-fix-a.mjs --check  … 書き込まずに、変更が必要なファイルだけ表示（差分があれば exit 1）
 *
 * 何度実行しても同じ結果になる（冪等）。整形は既存と同じ（tools/json-format.mjs）。
 * あわせて、Loomis の比率を直したなぞりテンプレート 2 つ（s4-loomis-front-v2 / s4-loomis-34-v2）を生成する。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectFormat, formatAs } from './json-format.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const changed = [];

/* ------------------------------------------------------------------ */
/* 読み書き                                                             */
/* ------------------------------------------------------------------ */

function loadFile(file) {
  const text = readFileSync(file, 'utf8');
  return { file, text, data: JSON.parse(text), format: detectFormat(text) };
}
function saveFile(f) {
  if (JSON.stringify(f.data) === JSON.stringify(JSON.parse(f.text))) return;
  if (!f.format) throw new Error(`${f.file} の整形の型が判別できません`);
  changed.push(f.file.replace(ROOT + '/', ''));
  if (!CHECK) writeFileSync(f.file, formatAs(f.format, f.data));
}
const stagePath = (id) => join(ROOT, 'content', 'stages', `${id}.json`);
const rubricPath = (id) => join(ROOT, 'content', 'rubrics', `${id}.json`);

/* ------------------------------------------------------------------ */
/* 小さな道具                                                           */
/* ------------------------------------------------------------------ */

function lesson(stage, id) {
  for (const u of stage.units) for (const l of u.lessons) if (l.id === id) return l;
  throw new Error(`レッスン ${id} が見つかりません`);
}

/** type が一致し、JSON に needle（配列ならどれか）を含む最初のステップ */
function find(l, type, needle) {
  const needles = Array.isArray(needle) ? needle : [needle];
  const s = l.steps.find((x) => x.type === type && needles.some((n) => JSON.stringify(x).includes(n)));
  if (!s) throw new Error(`${l.id}: ${type} "${needles[0]}" が見つかりません`);
  return s;
}
function tryFind(l, type, needle) {
  try {
    return find(l, type, needle);
  } catch {
    return undefined;
  }
}

/** obj[key] の from を to に（すでに to なら何もしない） */
function rep(obj, key, from, to, where = '') {
  const v = obj[key];
  if (typeof v !== 'string') throw new Error(`${where} ${key} が文字列ではありません`);
  if (v.includes(to)) return;
  if (!v.includes(from)) throw new Error(`${where} ${key}: "${from}" が見つかりません（現在: ${v.slice(0, 60)}…）`);
  obj[key] = v.replace(from, to);
}

/** キーの並びを保ったまま afterKey の直後に key を差し込む（既にあれば値だけ更新） */
function setAfter(obj, afterKey, key, value) {
  if (key in obj) {
    obj[key] = value;
    return;
  }
  const entries = Object.entries(obj);
  const at = entries.findIndex(([k]) => k === afterKey);
  entries.splice(at < 0 ? entries.length : at + 1, 0, [key, value]);
  for (const k of Object.keys(obj)) delete obj[k];
  for (const [k, v] of entries) obj[k] = v;
}

/** pred に合うステップを取り除く */
function removeStep(l, pred) {
  const i = l.steps.findIndex(pred);
  if (i >= 0) l.steps.splice(i, 1);
}

/** marker（JSON 部分文字列）を持つステップがまだ無ければ、index の位置へ差し込む */
function insertOnce(l, marker, step, where) {
  if (l.steps.some((x) => JSON.stringify(x).includes(marker))) return;
  let at;
  if (where === 'beforeLastRead') {
    at = l.steps.length;
    for (let i = l.steps.length - 1; i >= 0; i--)
      if (l.steps[i].type === 'read') {
        at = i;
        break;
      }
  } else if (typeof where === 'object' && where.after) {
    at = l.steps.indexOf(where.after) + 1;
    if (at === 0) throw new Error(`${l.id}: 差し込み位置が見つかりません`);
  } else throw new Error('where が不明');
  l.steps.splice(at, 0, step);
}

/** すべての文字列値に fn を適用 */
function mapStrings(v, fn) {
  if (typeof v === 'string') return fn(v);
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, fn));
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) {
      if (k === 'id' || k === 'figure' || k === 'refId' || k === 'template' || k === 'rubric' || k === 'type') continue;
      v[k] = mapStrings(v[k], fn);
    }
    return v;
  }
  return v;
}

/* ------------------------------------------------------------------ */
/* 共通の文言                                                           */
/* ------------------------------------------------------------------ */

const HOJO = 'ツールバーの「補助線」で薄く引くと採点されません。';
const GESTURE_LONG = '描き終えるごとに、ポーズ人形と自分の絵が並んで表示されます。違いを1つだけ見つけてから次へ進みましょう。';
const GESTURE_SHORT = '描き終えるごとに見比べて、違いを1つ見つけましょう。';
const TRACE_BOX_SENTENCES = [
  '1回なぞるごとに、箱カウンターが1個増えます（250箱チャレンジ）。',
  '1回なぞるごとに、箱カウンターが1個増えます。',
];

/** 「角度を変えて自由に箱を描く」（250箱チャレンジ。s2-u2-l3 以降の各レッスン末） */
const freeBoxes = () => ({
  type: 'construct',
  instruction: '角度を変えながら、自由に箱を5個描きましょう。描き終えると、箱カウンターに5個加わります（250箱チャレンジ）。',
  stages: [
    {
      title: '向きを変えて描き、辺を伸ばして確かめる',
      figure: 's2-box-freehand',
      instruction:
        '地平線より上・下、左向き・右向きと、1個ごとに向きを変えて箱を描きます。描き終えたら、ツールバーの「補助線」で同じ向きの辺を画面の外まで伸ばしてみましょう。1点に集まっていれば OK です。ずれていたら、次の箱で消失点を意識します。',
    },
  ],
  counter: 'boxes',
  count: 5,
});

/* ------------------------------------------------------------------ */
/* 表記の統一（6 ファイル＋ルーブリック）                                */
/* ------------------------------------------------------------------ */

function normalize(s, stageId) {
  let t = s
    .replace(/分か(?=る|り|っ|ら|れば)/g, 'わか')
    .replace(/一番/g, 'いちばん')
    .replace(/捉え/g, 'とらえ')
    .replace(/活(?=か|き)/g, '生')
    .replace(/ひじ/g, '肘')
    .replace(/ひざ/g, '膝')
    .replace(/延ば/g, '伸ば')
    .replace(/しわ/g, 'シワ')
    .replace(/下書き/g, '下描き')
    .replace(/三等分/g, '3等分')
    .replace(/ふくらむ所とくびれる所/g, 'ふくらむところとくびれるところ')
    .replace(/約 (\d+) 分/g, '約$1分')
    .replace(/([^\s\x00-\x7f])OK/g, '$1 OK')
    .replace(/OK(?=[^\s\x00-\x7f。、）」？])/g, 'OK ')
    .replace(/([^\x00-\x7f]):\s?/g, '$1：')
    .replace(/[！!](?=\s|$|[^\x00-\x7f])/g, '');
  if (stageId === 's1' || stageId === 's2') t = t.replace(/陰(?!影)/g, '影');
  if (stageId === 's2') t = t.replace(/照り返し/g, '反射光').replace(/ふち/g, '縁');
  return t;
}

/* ================================================================== */
/* ステージ 0                                                          */
/* ================================================================== */

function patchS0(st) {
  const l1 = lesson(st, 's0-u1-l1');
  rep(find(l1, 'read', 'このアプリの約束'), 'body', '上手に描けたかどうかは気にしなくてOK です。', '思いどおりに描けたかどうかは、気にしなくて大丈夫です。', 's0-u1-l1');
  const l7 = lesson(st, 's0-u1-l7');
  rep(find(l7, 'read', '自由お絵描き枠について'), 'body', 'うまく描く必要はありません。', 'きれいに仕上げる必要はありません。', 's0-u1-l7');
}

/* ================================================================== */
/* ステージ 1                                                          */
/* ================================================================== */

function patchS1(st) {
  // 25: 「〜てください」
  const u1l1 = lesson(st, 's1-u1-l1');
  rep(find(u1l1, 'drill', '少し速めに'), 'instruction', '感じてみてください。', '感じてみましょう。');

  // 9: 始点と終点に点（短い線は自動取消）
  const u1l2 = lesson(st, 's1-u1-l2');
  rep(find(u1l2, 'drill', '垂直な線を12本'), 'instruction', '始点と終点に小さな点を打ってからでもOK です。', '終点を見ながら、一気に引きます。');

  // 7: 45° は右下がり（＼）
  const u1l5 = lesson(st, 's1-u1-l5');
  const r15 = find(u1l5, 'read', '隣の線を見ながら引く');
  if (!r15.body.includes('右下がり（＼）')) r15.body += '\n\nなお、このアプリの「45度」は右下がり（＼）の線、「-45度」は右上がり（／）の線のことです。';
  rep(find(u1l5, 'drill', '45度の平行線'), 'instruction', '斜め45度の平行線を', '右下がり（＼）の斜め45度の平行線を');

  // 24: 内部 ID
  const u1l6 = lesson(st, 's1-u1-l6');
  rep(find(u1l6, 'read', '直線ユニット完了'), 'body', 'U1-1 の最初のレッスン', '直線ユニットの最初のレッスン（短い水平線）');

  // 18: C カーブのガイド（半円／ほぼ円）
  const u2l1 = lesson(st, 's1-u2-l1');
  rep(find(u2l1, 'drill', '15本引きましょう'), 'instruction', '画面に出る破線のガイドに重ねるように、ゆるやかなCカーブを15本引きましょう。', '画面に出る半円の破線のガイドに重ねるように、Cカーブを15本引きましょう。');
  rep(find(u2l1, 'drill', '"bend":"strong"'), 'instruction', '今度は曲がりの強いCカーブ（半円に近いもの）の破線のガイドが出ます。', '今度は曲がりの強い、ほぼ円に近いCカーブの破線のガイドが出ます。');
  rep(find(u2l1, 'read', '振り返り'), 'body', 'ゆるいカーブと強いカーブ、', '半円のカーブと、ほぼ円のカーブ、');

  // 22 に合わせて s1 の「薄い楕円」も言い換え
  const u3l3 = lesson(st, 's1-u3-l3');
  rep(find(u3l3, 'read', '楕円は、ななめから見た円'), 'body', '数字が小さく、薄い楕円になります。', '数字が小さく、つぶれた楕円になります。');
  rep(find(u3l3, 'drill', '度合い30%'), 'instruction', 'もっと薄い、度合い30%くらいの楕円', 'もっとつぶれた、度合い30%くらいの楕円');
  rep(find(u3l3, 'read', '振り返り'), 'body', '薄い楕円ほど', 'つぶれた楕円ほど');

  // 8: 先に軸を引く → 補助線
  const u3l4 = lesson(st, 's1-u3-l4');
  rep(
    find(u3l4, 'read', '楕円の「軸」は長い径'),
    'body',
    '先に軸の線を1本引いてから、その線に対して上下対称になるように楕円を描くと、傾きが安定します。',
    '軸の線を目安にしたいときは、ツールバーの「補助線」で薄く引いておきましょう。補助線は採点されません。その線に対して上下対称になるように楕円を描くと、傾きが安定します。',
  );
  rep(
    find(u3l4, 'drill', '"axisAngleDeg":120'),
    'instruction',
    '軸（長い径）の線を、右上がりに60度くらい傾けて先に引き、その線に合わせて度合い50%くらいの楕円を15個描きましょう。右上の見本と同じ傾きです。',
    `軸（長い径）が右上がりに60度くらい傾いた、度合い50%くらいの楕円を15個描きましょう。右上の見本と同じ傾きです。軸の線は、${HOJO}`,
  );
  rep(find(u3l4, 'read', '振り返り'), 'body', '軸の線を先に引くと、', '補助線で軸を先に引くと、');
  const u3l6 = lesson(st, 's1-u3-l6');
  rep(find(u3l6, 'drill', '"axisAngleDeg":135'), 'instruction', '先に軸の線を引いても OK です。', `軸の線は、${HOJO}`);

  // 7: ハッチング
  const u4l3 = lesson(st, 's1-u4-l3');
  const r43 = find(u4l3, 'read', '線を並べて暗さをつくる');
  if (!r43.body.includes('右下がり（＼）')) r43.body += '\n\nこのアプリの「45度」は右下がり（＼）、「-45度」は右上がり（／）の線です。';
  rep(find(u4l3, 'drill', '"angleDeg":45}'), 'instruction', '四角い範囲の中に、45度の短い線を', '四角い範囲の中に、右下がり（＼）45度の短い線を');
  rep(find(u4l3, 'drill', '"angleDeg":-45}'), 'instruction', '今度は反対向き（-45度）の線を', '今度は反対向きの、右上がり（／）-45度の線を');
  const c43 = find(u4l3, 'construct', 'クロスハッチング');
  rep(c43.stages[1], 'instruction', '四角の中に、45度の短い線を', '四角の中に、右下がり（＼）45度の短い線を');
  rep(c43.stages[2], 'instruction', '反対向き（-45度）の線を重ねます。', '反対向きの右上がり（／）-45度の線を重ねます。');
  const u5l1 = lesson(st, 's1-u5-l1');
  rep(find(u5l1, 'drill', '"drill":"hatching"'), 'instruction', '45度のハッチングを15本', '右下がり（＼）45度のハッチングを15本');
}

/* ================================================================== */
/* ステージ 1.5                                                        */
/* ================================================================== */

function patchS1_5(st) {
  // 19: 十字線 → 輪郭
  const l1 = lesson(st, 's1_5-u1-l1');
  rep(l1, 'title', '輪郭と十字線（アタリ）', '十字線と輪郭（アタリ）');
  rep(l1, 'summary', '正面顔の輪郭と十字線をなぞって', '正面顔の十字線と輪郭をなぞって');
  rep(find(l1, 'read', '顔は「アタリ」から'), 'body', 'まず輪郭と十字線を描きます。', 'まず十字線を引き、それから輪郭を描きます。');
  rep(find(l1, 'trace', 'face-outline-cross'), 'instruction', 'お手本の輪郭と十字線をなぞりましょう。', 'お手本の十字線をなぞってから、輪郭をなぞりましょう。');
  // 8: 中心線 → 補助線
  rep(find(l1, 'drill', '"drill":"ellipse"'), 'instruction', '1つごとに縦の中心線を引いてもOK です。', `縦の中心線を入れたいときは、${HOJO}`);

  const l3 = lesson(st, 's1_5-u1-l3');
  rep(find(l3, 'drill', '"shape":"c"'), 'instruction', '破線のガイドに沿ってゆるやかなCカーブを12本', '半円の破線のガイドに沿ってCカーブを12本');

  const u2l1 = lesson(st, 's1_5-u2-l1');
  rep(find(u2l1, 'read', 'なぞらずに描いてみる'), 'body', '輪郭と十字線 → 目', '十字線と輪郭 → 目');
  rep(find(u2l1, 'copy', 'face-front-lineart'), 'instruction', 'まず輪郭と十字線を描いてから', 'まず十字線と輪郭を描いてから');

  // 17: 左右反転
  const u2l2 = lesson(st, 's1_5-u2-l2');
  const copy = find(u2l2, 'copy', 'face-front-lineart');
  insertOnce(
    u2l2,
    's1-flip-check',
    {
      type: 'read',
      title: '左右反転で対称を確かめる',
      body: 'ツールバーの左右反転を使うと、描いた絵を鏡に映したように見られます。\n\n反転すると、目の高さの左右差や輪郭の傾きなど、見慣れて気づかなかった対称のズレが目に飛び込んできます。次の模写では、お手本と重ねたあとに、左右反転でも一度見てみましょう。',
      figure: 's1-flip-check',
    },
    { after: find(u2l2, 'read', '重ねると違いが見える') },
  );
  rep(copy, 'instruction', 'どれくらい違うかを確かめます。', 'どれくらい違うかを確かめます。最後にツールバーの左右反転でも見て、左右の対称のズレを探しましょう。');
}

/* ================================================================== */
/* ステージ 2                                                          */
/* ================================================================== */

function patchS2(st) {
  const L = (id) => lesson(st, id);
  const isBoxTrace = (x) => x.type === 'trace' && /^cube-/.test(x.template) && /仕上げに|ユニットの締めに/.test(x.instruction);

  // 24
  rep(find(L('s2-u1-l3'), 'read', '奥の半分が小さく見えました'), 'body', 'U2-3 のパース入門で、', 'このあとのパース入門のユニットで、');
  // 文字なしの模写用お手本へ
  const u1l4copy = find(L('s2-u1-l4'), 'copy', 'shape-silhouettes');
  u1l4copy.refId = 'shape-silhouettes-lineart';

  // 15・26: s2-u2-l1 / l2 … なぞり 2 回、仕上げのなぞりは削除、なぞりは箱を数えない。250 箱の初出は l3
  for (const id of ['s2-u2-l1', 's2-u2-l2']) {
    const l = L(id);
    removeStep(l, isBoxTrace);
    const tr = l.steps.find((x) => x.type === 'trace');
    tr.count = 2;
    delete tr.counter;
    rep(find(l, 'construct', '箱カウンター'), 'instruction', '箱カウンターに3個加わります（250箱チャレンジ）。', '箱カウンターに3個加わります。');
  }
  rep(find(L('s2-u2-l1'), 'read', '振り返り'), 'body', '今日から箱を描くたびに数えていきます。今日の分は9個、おつかれさまでした。', '自分で描いた箱は、箱カウンターに数えていきます。今日の分は3個、おつかれさまでした。');

  // s2-u2-l3
  const u2l3 = L('s2-u2-l3');
  removeStep(u2l3, (x) => x.type === 'trace');
  const r23 = find(u2l3, 'read', '250箱チャレンジ、スタート');
  if (!r23.body.includes('自分で描いた箱だけ'))
    r23.body += '\n\nこのレッスンから、各レッスンの最後に「角度を変えて自由に箱を描く」ステップがあります。描いた箱の辺を補助線で伸ばして、消失点に集まるかを確かめましょう。お手本をなぞった箱は数えず、自分で描いた箱だけを数えます。';
  // 5
  rep(find(u2l3, 'construct', '正面に近い箱').stages[1], 'instruction', '左右の消失点を同じくらい遠くに置きます。', '片方の消失点をかなり遠くに置きます（1点透視に近い見え方になります）。');

  // s2-u2-l4 … 22 楕円の言い方、16 短縮の下地
  const u2l4 = L('s2-u2-l4');
  rep(
    find(u2l4, 'read', '円柱は軸と楕円'),
    'body',
    '目の高さから離れるほど楕円は太く（度合いが大きく）なります。上から見下ろす円柱なら、底の楕円は口より少し太くなります。',
    '目の高さから離れるほど、楕円の度合いは大きく（丸く）なります。上から見下ろす円柱なら、底の楕円は口より度合いが少し大きくなります。',
  );
  find(u2l4, 'trace', '"template":"cylinder"').count = 2;
  const c24 = find(u2l4, 'construct', '倒れた円柱');
  rep(c24.stages[0], 'instruction', '上に浅い楕円、下に少し深い楕円を置いて', '上に度合いの小さい楕円、下に度合いの少し大きい楕円を置いて');
  insertOnce(
    u2l4,
    's2-foreshorten-cylinder',
    {
      type: 'construct',
      instruction: 'こちらを向いた円柱と箱を描きましょう。奥へ向かう長さがとても短く見えることを確かめます（この見え方を「短縮」と呼びます。ステージ5で腕や脚に使います）。',
      stages: [
        {
          title: 'こちらを向いた円柱',
          figure: 's2-foreshorten-cylinder',
          instruction: '手前の口をほぼ円で描き、その少し奥に、ひと回り小さい円を重ねます。2つの円の外側を直線でつなぐと、こちらへ伸びる短い円柱になります。',
        },
        {
          title: 'こちらを向いた箱',
          instruction: '手前の面を大きめの四角で描き、奥の面を少し小さく、中心寄りに描いて、角どうしを結びます。奥行きの辺がとても短く見えれば OK です。',
        },
      ],
    },
    { after: c24 },
  );

  // 仕上げのなぞりを外し、各レッスン末に「自由に箱」を置く（s2-u2-l3 〜 s2-u6-l3）
  const FREE_FROM = [
    's2-u2-l3', 's2-u2-l4', 's2-u2-l5', 's2-u2-l6',
    's2-u3-l1', 's2-u3-l2', 's2-u3-l3', 's2-u3-l4', 's2-u3-l5',
    's2-u4-l1', 's2-u4-l2', 's2-u4-l3', 's2-u4-l4', 's2-u4-l5',
    's2-u5-l1', 's2-u5-l2', 's2-u5-l3', 's2-u5-l4',
    's2-u6-l1', 's2-u6-l2', 's2-u6-l3',
  ];
  for (const id of FREE_FROM) {
    const l = L(id);
    removeStep(l, isBoxTrace);
    insertOnce(l, 's2-box-freehand', freeBoxes(), 'beforeLastRead');
  }
  // 残るなぞり（手順の確認用）は箱を数えない
  for (const u of st.units)
    for (const l of u.lessons)
      for (const x of l.steps)
        if (x.type === 'trace') {
          delete x.counter;
          for (const s of TRACE_BOX_SENTENCES) x.instruction = x.instruction.replace(s, '').trim();
        }

  // 24
  rep(find(L('s2-u2-l6'), 'read', '振り返り'), 'body', 'U2-6 で実際の物を描くときに使います。', 'このステージの最後のユニット「物を図形で描く」で、実際の物を描くときに使います。');

  // 4・22
  const u3l4 = L('s2-u3-l4');
  const c34 = find(u3l4, 'construct', '床に置いた円');
  rep(c34.stages[3], 'instruction', '消失点から遠い位置にもう1つ描き、楕円の太さの違いを比べます。', '地平線から離れた手前の位置にもう1つ描き、楕円の度合いの違いを比べます。');
  rep(find(u3l4, 'read', '振り返り'), 'body', '地平線から遠い円ほど、楕円は太くなりました。', '地平線から離れた円ほど、楕円の度合いは大きくなりました。');

  // 26: s2-u3-l5 のなぞりを 1 回に
  find(L('s2-u3-l5'), 'trace', 'perspective-grid-1pt').count = 1;

  // 7・21・28: 光と影
  const u4l1 = L('s2-u4-l1');
  const q41 = find(u4l1, 'quiz', 'quiz-sphere-b');
  q41.question = '光源が左上にあるとき、正しい陰影はどれですか？';
  const sphereText = { 'quiz-sphere-a': '右下が暗く、落ち影は右', 'quiz-sphere-b': '左上が暗く、落ち影は右', 'quiz-sphere-c': '右下が暗く、落ち影は左' };
  for (const o of q41.options) o.text = sphereText[o.figure];
  q41.explain = '光源と反対側（右下）が影になり、落ち影も光源と反対の右へ伸びます。「左上が暗い」球は影が光源側に、「落ち影は左」の球は落ち影が光源側に伸びています。';
  find(u4l1, 'quiz', '明暗の境界').question = '球の「明暗の境界」は、どんな線で描くとよいですか？';
  rep(find(u4l1, 'drill', '"drill":"hatching"'), 'instruction', '45度のハッチングを15本。', '右下がり（＼）45度のハッチングを15本。');

  const u4l2 = L('s2-u4-l2');
  const q42 = find(u4l2, 'quiz', 'quiz-cube-b');
  q42.question = '光源が左上にあるとき、正しい明暗はどれですか？';
  const cubeText = { 'quiz-cube-a': '上面がいちばん暗い箱', 'quiz-cube-b': '上面がいちばん明るく、右面がいちばん暗い箱' };
  for (const o of q42.options) o.text = cubeText[o.figure];
  q42.explain = '上面がいちばん明るく、光源側の左面が中間、反対の右面がいちばん暗いものが正解です。';
  find(u4l2, 'quiz', '3値の差').question = '3値の差が小さすぎると、箱はどう見えますか？';
  rep(find(u4l2, 'drill', '"drill":"hatching"'), 'instruction', '逆向き（-45度）のハッチングを', '逆向きの、右上がり（／）-45度のハッチングを');

  const u4l3 = L('s2-u4-l3');
  find(u4l3, 'quiz', 'quiz-sphere-c').question = '光源が左上にあるとき、落ち影の向きが正しいのはどちらですか？';
  find(u4l3, 'quiz', '夕方の太陽').question = '光源が低い（夕方の太陽のような）とき、落ち影はどうなりますか？';

  const u4l4 = L('s2-u4-l4');
  find(u4l4, 'quiz', 'いちばん暗くなるのは').question = '光源が左にあるとき、立った円柱でいちばん暗くなるのはどこですか？';
  find(u4l4, 'quiz', '帯は、どの向き').question = '円柱の明暗の帯は、どの向きに並びますか？';

  const u4l5 = L('s2-u4-l5');
  find(u4l5, 'quiz', 'いちばん暗い」を表すには').question = 'ハッチングで「いちばん暗い」を表すには、どうしますか？';
  rep(find(u4l5, 'drill', '"drill":"hatching"'), 'instruction', '45度のハッチングを、同じ間隔で20本', '右下がり（＼）45度のハッチングを、同じ間隔で20本');
  const c45 = find(u4l5, 'construct', '3つのマス');
  rep(c45.stages[1], 'instruction', '左の四角に、45度の線を', '左の四角に、右下がり（＼）45度の線を');
  rep(c45.stages[3], 'instruction', '-45度の線を重ねて', '右上がり（／）-45度の線を重ねて');

  // 20: 巻く線（コンター）
  const u5l3 = L('s2-u5-l3');
  rep(u5l3, 'title', '輪郭線を巻く', '巻く線（コンター）');
  rep(find(u5l3, 'read', 'テープを巻くように'), 'body', '「輪郭線（コンター）」と呼びます。', '「巻く線（コンター）」と呼びます。');
  rep(find(u5l3, 'construct', '有機形に'), 'instruction', '有機形に輪郭線を巻きましょう。', '有機形に巻く線を入れましょう。');
  rep(find(L('s2-u5-l4'), 'construct', '豆形と箱').stages[1], 'instruction', '輪郭線を巻いて向きを示します。', '巻く線を入れて向きを示します。');

  // 22
  const u6l1 = L('s2-u6-l1');
  rep(find(u6l1, 'read', 'マグカップ＝円柱＋取っ手'), 'body', '底の楕円を口より少し太く（深く）します。', '底の楕円の度合いを口より少し大きくします。');
  rep(find(u6l1, 'construct', 'マグカップを図形から').stages[1], 'instruction', '口より少し太い底の楕円', '口より度合いが少し大きい底の楕円');
}

/* ================================================================== */
/* ステージ 3                                                          */
/* ================================================================== */

function patchS3(st) {
  const L = (id) => lesson(st, id);

  // 25
  rep(find(L('s3-u1-l3'), 'read', '振り返り'), 'body', '「シルエットでうまく嘘をつく」簡略化', '「シルエットで伝わるように、思い切って省く」簡略化');

  // 29: Proko
  rep(
    find(L('s3-u2-l1'), 'read', 'まず1本の流れ'),
    'body',
    'このアプリのジェスチャーは、Proko の考え方',
    'Proko（プロコ）は、人体ドローイングの解説動画で知られるアメリカの講師 Stan Prokopenko さんの講座です。このアプリのジェスチャーは、Proko の考え方',
  );

  // 12: シルエット → マーカーで塊
  const u2l4 = L('s3-u2-l4');
  rep(u2l4, 'summary', 'ポーズを塗りつぶしたシルエットとして捉え、', 'ポーズをマーカー（太いペン）で塊として描き、');
  rep(
    find(u2l4, 'read', '外形で読めるか'),
    'body',
    'ポーズを塗りつぶして、外形（シルエット）だけにしても何をしているか伝わるかを考えます。',
    'ポーズを外形（シルエット）だけにしても、何をしているか伝わるかを考えます。このレッスンでは、ツールバーのペン設定でマーカー（太いペン）を選び、ポーズを1つの塊として描きます。',
  );
  rep(find(u2l4, 'gesture', 'シルエット'), 'instruction', '60秒で、ポーズを塗りつぶしたシルエットとして描きましょう。', '60秒で、マーカー（太いペン）を使って、ポーズを1つの塊（シルエット）として描きましょう。');

  // 10・14: ジェスチャーの出題グループと、くり返しの2文
  const groups = {
    's3-u2-l1': 'all', 's3-u2-l2': 'all', 's3-u2-l3': 'all', 's3-u2-l4': 'all', 's3-u2-l5': 'all',
    's3-u3-l3': 'all', 's3-u5-l2': 'action', 's3-u5-l3': 'standing', 's3-u5-l5': 'standing', 's3-u6-l1': 'all',
  };
  // s3-u5-l4 は「座る」と「動き」の 2 つに分ける
  const u5l4 = L('s3-u5-l4');
  const g54 = tryFind(u5l4, 'gesture', '座る・走るなど動きの大きいポーズです');
  if (g54) {
    const i = u5l4.steps.indexOf(g54);
    u5l4.steps.splice(
      i,
      1,
      { type: 'gesture', seconds: 60, count: 2, source: 'mannequin', instruction: `60秒のジェスチャーを2枚。座る・しゃがむポーズが出ます。腰の位置と、ももの向きを先に決めましょう。${GESTURE_SHORT}`, poseGroup: 'sitting' },
      { type: 'gesture', seconds: 60, count: 2, source: 'mannequin', instruction: `60秒のジェスチャーを2枚。走る・跳ぶなど動きのあるポーズが出ます。動きの線を大きく傾けて描き始めましょう。${GESTURE_SHORT}`, poseGroup: 'action' },
    );
  }
  let first = true;
  for (const u of st.units)
    for (const l of u.lessons)
      for (const g of l.steps) {
        if (g.type !== 'gesture' || g.source !== 'mannequin') continue;
        if (groups[l.id]) g.poseGroup = groups[l.id];
        if (first) {
          first = false; // 最初の 1 回（s3-u2-l1）だけ、見比べの画面の説明を残す
          continue;
        }
        g.instruction = g.instruction.replace(GESTURE_LONG, GESTURE_SHORT);
      }

  // 15: なぞりは箱カウンターに数えない
  for (const u of st.units)
    for (const l of u.lessons)
      for (const x of l.steps)
        if (x.type === 'trace') {
          delete x.counter;
          for (const s of TRACE_BOX_SENTENCES) x.instruction = x.instruction.replace(s, '').trim();
        }

  // 20
  rep(find(L('s3-u3-l2'), 'read', '豆どうしの関係で動く'), 'body', '豆に巻く線（ステージ2の輪郭線）を', '豆に巻く線（コンター。ステージ2で練習しました）を');

  // 11: 模写チェックポイント
  const u6l1 = L('s3-u6-l1');
  rep(
    find(u6l1, 'read', 'ここまでの手順で描き写す'),
    'body',
    '最後の模写チェックポイントでは、マネキンのお手本（線画）をもう一度模写して、お手本と見比べます。',
    '最後の模写チェックポイントでは、お手本をもう一度模写して見比べます。お手本は、内蔵のポーズ人形の線画か、自分の画像を選べます。',
  );
  const c61 = find(u6l1, 'construct', 'マネキンを1体');
  rep(c61, 'instruction', 'ポーズ人形を見ながら、マネキンを1体描きましょう。', '横に表示されるポーズ人形の線画を見ながら、マネキンを1体描きましょう。');
  setAfter(c61, 'stages', 'reference', 'builtin');
  setAfter(c61, 'reference', 'refId', 's3-mannequin-lineart');
  find(u6l1, 'mosha', 'もう一度模写').instruction =
    'お手本を選んで、もう一度模写しましょう。お手本は、内蔵のポーズ人形の線画か、自分の画像を選べます。描き終えたらお手本と並べて（重ねても見られます）見比べ、違うところをタップして印をつけます。最後に、腕の角度や顔の向きなど、1か所だけ自由に変えて、もう1枚描きます。';
}

/* ================================================================== */
/* ステージ 4                                                          */
/* ================================================================== */

function patchS4(st) {
  const L = (id) => lesson(st, id);

  // 1: Loomis の比率
  const u1l1 = L('s4-u1-l1');
  const r11 = find(u1l1, 'read', '頭は球から始める');
  rep(r11, 'body', 'ステージ1.5では、輪郭と十字線から正面顔を描きました。', 'ステージ1.5では、十字線と輪郭から正面顔を描きました。');
  rep(
    r11,
    'body',
    '手順は4つです。①球を描く、②球の左右を少し切り落とす（側面の楕円）、③顔の縦の中心線を引く、④眉の線・鼻の線・あごの位置を決める。',
    '手順は4つです。①球を描き、真ん中（赤道）に眉の線を引く、②球の左右を少し切り落とす（側面の円）、③顔の縦の中心線を引く、④生え際・鼻の線・あごの位置を決める。',
  );
  rep(
    r11,
    'body',
    '眉の線は球の真ん中、鼻の線は球の下の端あたりです。あごは、眉から鼻までと同じ長さだけ下に置きます。',
    '眉の線は、球の真ん中（赤道）です。側面の切り落としの円は球より少し内側に収まり、その上の端が髪の生え際、下の端が鼻の線になります。あごは、眉から鼻までと同じ長さだけ下に置きます。頭のてっぺんは、生え際よりさらに上（球のいちばん上）です。',
  );
  r11.figure = 's4-loomis-corrected';
  const t11 = find(u1l1, 'trace', ['s4-loomis-head-front', 's4-loomis-front-v2']);
  t11.template = 's4-loomis-front-v2';
  t11.instruction = '正面の頭のお手本を、球→眉の線→側面の切り落とし→縦の中心線→生え際と鼻の線→あごの順になぞりましょう。';
  const c11 = find(u1l1, 'construct', '正面の頭を自分で');
  c11.stages = [
    { title: '球を描く', figure: 's4-loomis-corrected', instruction: '肘を使って、大きめの円を1つ描きます。少しいびつでも OK です。' },
    { title: '眉の線を引く', instruction: '円のちょうど真ん中（赤道）に、横の線を引きます。これが眉の高さです。' },
    { title: '側面の切り落とし', instruction: '円の左右の内側に、縦に細い楕円を1つずつ描きます。楕円の上の端と下の端は、円の輪郭より少し内側に収めます。' },
    { title: '中心線を引く', instruction: '円の上から下へ縦の中心線を引き、円の外まで長めに伸ばします。' },
    { title: '生え際・鼻の線とあご', instruction: '側面の楕円の上の端の高さに生え際の線、下の端の高さに鼻の線を引きます。眉〜鼻と同じ長さだけ下にあごの点を置き、側面の楕円の下あたりから、あごの点へ輪郭を下ろします。' },
  ];

  // 2: 側面の楕円の形
  const u1l2 = L('s4-u1-l2');
  const r12 = find(u1l2, 'read', '中心線が曲面を回り込む');
  rep(
    r12,
    'body',
    '側面の切り落とし（楕円）も同じです。正面では見えず、3/4 では片側に細い楕円として見え、横向きでは大きな円に近い形になります。',
    '側面の切り落とし（楕円）も、向きによって形が変わります。正面では左右の端に縦に細い楕円、3/4 では見えている側の側面に太めの楕円、横向きではほぼ円になります。',
  );
  r12.figure = 's4-side-oval-by-angle';
  find(u1l2, 'trace', ['s4-loomis-head-34', 's4-loomis-34-v2']).template = 's4-loomis-34-v2';

  const u1l4 = L('s4-u1-l4');
  const s14 = find(u1l4, 'construct', '1問目').stages[0];
  rep(s14, 'instruction', '切り落としの楕円を左側に細く置きます（顔は右を向きます）。', '切り落としの楕円を左側に太めに置きます（顔は右を向きます）。');
  setAfter(s14, 'title', 'figure', 's4-side-oval-by-angle');

  // 13: 印は採点のあと（構築ステップ）で
  const u2l1 = L('s4-u2-l1');
  const t21 = find(u2l1, 'trace', 'face-outline-cross');
  t21.instruction = '十字線と輪郭をなぞりましょう。';
  insertOnce(
    u2l1,
    '"keepPrevious":true',
    {
      type: 'construct',
      instruction: 'なぞった輪郭の上に、目5つ分の目安の印を打ちましょう。',
      stages: [
        { title: '5等分の印', figure: 's4-eye-spacing', instruction: '目の高さの横線を、輪郭の端から端まで5等分する位置に、小さな印を4つ打ちます。2つ目と4つ目の区間が目の場所です。' },
      ],
      keepPrevious: true,
    },
    { after: t21 },
  );

  // 3: 3/4 の輪郭（奥側の頬骨・目のくぼみ・あご）
  const u3l3 = L('s4-u3-l3');
  const eyeC = find(u3l3, 'construct', ['3/4 の頭に両目', '3/4 の頭に、両目']);
  insertOnce(
    u3l3,
    's4-face-34-contour',
    {
      type: 'construct',
      instruction: '3/4 の頭に、奥側の輪郭を描きましょう。奥側の輪郭には、頬骨・目のくぼみ・あごの3か所の凹凸が出ます。',
      stages: [
        { title: '3/4 の頭', figure: 's4-head-angles', instruction: '球・太めの側面の楕円・カーブした中心線・眉の線・鼻の線を描きます。' },
        { title: '目のくぼみ', figure: 's4-face-34-contour', instruction: '眉の線のすぐ下で、奥側の輪郭を少し内側へへこませます。遠い目は、このくぼみのあたりに収まります。' },
        { title: '奥側の頬骨', instruction: 'くぼみの下、目と鼻の線の間で、奥側の輪郭を少し外へ張り出させます。' },
        { title: 'あごの線', instruction: '頬骨から、中心線の延長上にあるあご先へ、輪郭を下ろします。手前側は側面の楕円の下からあご先へつなぎます。' },
      ],
    },
    { after: find(u3l3, 'quiz', '遠い方の目') },
  );
  if (eyeC.stages[0].title === '3/4 の頭') {
    eyeC.instruction = '前のステップで描いた3/4 の頭に、両目を置いてみましょう。';
    eyeC.stages.shift();
    setAfter(eyeC, 'stages', 'keepPrevious', true);
  }

  // 6: 視線の確かめ方
  const u3l4 = L('s4-u3-l4');
  rep(
    find(u3l4, 'read', '両目で同じ点を見る'),
    'body',
    '確かめ方は簡単です。見ている先に点を1つ決め、左右の虹彩の中心からその点へ線を引きます。2本の線がその点で交わればOK です。',
    '確かめ方は、左右の虹彩が、それぞれの目の枠の中で同じ向きに、同じ割合だけ寄っているかを見ることです。たとえば右上を見るなら、両方の虹彩が枠の右上へ同じくらい寄っていれば OK です。',
  );
  rep(
    find(u3l4, 'construct', '視線の先を決めて').stages[2],
    'instruction',
    '左右の虹彩を、点の方向へ同じだけ寄せて描きます。虹彩の中心から点へ薄い線を引いて確かめます。',
    '左右の虹彩を、点の方向へ同じ向き・同じ割合だけ寄せて描きます。目の枠の中での虹彩の位置が、左右でそろっているか確かめます。',
  );

  // 1: 鼻の線の位置
  rep(find(L('s4-u4-l1'), 'read', '鼻は「ほのめかす」だけ'), 'body', '鼻の線（Loomis の球の下の端）の上です。', '鼻の線（Loomis の側面の切り落とし円の下の端）の上です。');

  // 1: 生え際
  const u6l1 = L('s4-u6-l1');
  const r61 = find(u6l1, 'read', '髪は生え際とつむじから生える');
  rep(
    r61,
    'body',
    '生え際は、Loomis の頭の一番上の横線（3等分の上の線）あたりに、額を囲む弧として置きます。',
    '生え際は、Loomis の頭の側面の切り落とし円の上の端の高さ（3等分のいちばん上の線）に、額を囲む弧として置きます。頭のてっぺんは、生え際よりさらに上にあります。',
  );
  r61.figure = 's4-loomis-corrected';
  rep(find(u6l1, 'construct', '生え際とつむじを置き').stages[1], 'instruction', '眉の線から、眉〜鼻と同じ長さだけ上に、額を囲む弧を描きます。', '眉の線から、眉〜鼻と同じ長さだけ上（側面の切り落とし円の上の端の高さ）に、額を囲む弧を描きます。');

  // 旧 Loomis の図（鼻の線が球の下端）を、直した図へ
  for (const u of st.units)
    for (const l of u.lessons)
      for (const s of l.steps) {
        if (s.figure === 's4-loomis-sphere') s.figure = 's4-loomis-corrected';
        for (const g of s.stages ?? []) if (g.figure === 's4-loomis-sphere') g.figure = 's4-loomis-corrected';
      }
}

/* ================================================================== */
/* ルーブリック                                                        */
/* ================================================================== */

function patchRubrics(r) {
  if (r.data.id === 's2-graduation') rep(r.data.points, 0, '楕円の太さが矛盾していないか', '楕円の度合いが矛盾していないか', 's2-graduation');
}

/* ================================================================== */
/* テンプレート（Loomis の比率を直した版）                                */
/* ================================================================== */

function genTemplates() {
  const TAU = Math.PI * 2;
  const param = (f, t0, t1, fine = 400) => {
    const pts = [];
    for (let i = 0; i <= fine; i++) pts.push(f(t0 + ((t1 - t0) * i) / fine));
    return pts;
  };
  const ellipse = (cx, cy, rx, ry, a0 = -Math.PI / 2, a1 = a0 + TAU) => param((a) => [cx + rx * Math.cos(a), cy + ry * Math.sin(a)], a0, a1);
  const quad = (p0, c, p1) =>
    param((t) => [(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1]], 0, 1);
  const poly = (...pts) => pts;
  const resample = (pts, n) => {
    const d = [0];
    for (let i = 1; i < pts.length; i++) d.push(d[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const Lg = d[d.length - 1];
    const out = [];
    let j = 0;
    for (let k = 0; k < n; k++) {
      const s = (Lg * k) / (n - 1);
      while (j < pts.length - 2 && d[j + 1] < s) j++;
      const seg = d[j + 1] - d[j] || 1;
      const u = Math.min(1, Math.max(0, (s - d[j]) / seg));
      out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * u, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * u]);
    }
    return out;
  };
  const toStroke = (pts, n) => {
    const r = (v) => Math.round(v * 10000) / 10000;
    return resample(pts, n).map(([x, y], i) => ({ x: r(x), y: r(y), p: 0.6, t: i * 16 }));
  };
  const save = (id, strokes) => {
    for (const s of strokes) {
      if (s.length < 40 || s.length > 120) throw new Error(`${id}: 点数 ${s.length}`);
      for (const { x, y } of s) if (x < 0 || x > 1 || y < 0 || y > 1) throw new Error(`${id}: 範囲外 ${x},${y}`);
    }
    const file = join(ROOT, 'content', 'templates', `${id}.json`);
    const text = JSON.stringify(strokes) + '\n';
    if (existsSync(file) && readFileSync(file, 'utf8') === text) return;
    changed.push(`content/templates/${id}.json`);
    if (!CHECK) writeFileSync(file, text);
  };

  // 正面: 球 → 眉（赤道）→ 側面の楕円（左右）→ 中心線 → 生え際 → 鼻の線 → あご（左右）
  {
    const cx = 0.5, cy = 0.36, r = 0.25, h = 0.16; // h = 眉〜鼻 = 生え際〜眉 = 鼻〜あご
    const sx = r * 0.72, srx = 0.035; // 側面の楕円（縦に細い）
    save('s4-loomis-front-v2', [
      toStroke(ellipse(cx, cy, r, r), 120),
      toStroke(poly([cx - r, cy], [cx + r, cy]), 60),
      toStroke(ellipse(cx - sx, cy, srx, h), 80),
      toStroke(ellipse(cx + sx, cy, srx, h), 80),
      toStroke(poly([cx, cy - r - 0.02], [cx, cy + 2 * h + 0.03]), 70),
      toStroke(poly([cx - 0.12, cy - h], [cx + 0.12, cy - h]), 44),
      toStroke(poly([cx - 0.08, cy + h], [cx + 0.08, cy + h]), 40),
      toStroke(quad([cx - sx, cy + h], [cx - sx + 0.02, cy + 1.75 * h], [cx, cy + 2 * h]), 56),
      toStroke(quad([cx + sx, cy + h], [cx + sx - 0.02, cy + 1.75 * h], [cx, cy + 2 * h]), 56),
    ]);
  }
  // 3/4（右向き）: 球 → 側面の楕円（太め・右寄り）→ 曲面に沿う中心線 → 眉 → 生え際 → 鼻の線 → あご（奥・手前）
  {
    const cx = 0.48, cy = 0.36, r = 0.25, h = 0.155;
    const ox = 0.61, orx = 0.09; // 側面の楕円
    const mx = 0.39; // 中心線の赤道での位置
    save('s4-loomis-34-v2', [
      toStroke(ellipse(cx, cy, r, r), 120),
      toStroke(ellipse(ox, cy, orx, h), 90),
      toStroke([...quad([0.44, cy - r + 0.005], [0.33, cy], [0.4, cy + h]), ...quad([0.4, cy + h], [0.4, cy + 1.6 * h], [0.42, cy + 2 * h])], 90),
      toStroke(quad([cx - r + 0.01, cy - 0.02], [mx, cy + 0.04], [ox - orx, cy]), 60),
      toStroke(quad([0.3, cy - h - 0.01], [mx, cy - h + 0.02], [ox - orx + 0.01, cy - h + 0.01]), 50),
      toStroke(quad([0.33, cy + h], [0.39, cy + h + 0.012], [0.46, cy + h]), 40),
      toStroke(quad([ox - 0.02, cy + h], [0.6, cy + 1.8 * h], [0.42, cy + 2 * h]), 60),
      toStroke(quad([0.26, cy + 0.1], [0.28, cy + 1.8 * h], [0.42, cy + 2 * h]), 56),
    ]);
  }
}

/* ================================================================== */
/* 実行                                                                */
/* ================================================================== */

const PATCH = { s0: patchS0, s1: patchS1, s1_5: patchS1_5, s2: patchS2, s3: patchS3, s4: patchS4 };
for (const [id, fn] of Object.entries(PATCH)) {
  const f = loadFile(stagePath(id));
  fn(f.data);
  mapStrings(f.data, (s) => normalize(s, id));
  saveFile(f);
}
for (const id of ['s1', 's1_5', 's2-graduation', 's3-graduation', 's4-graduation']) {
  const f = loadFile(rubricPath(id));
  patchRubrics(f);
  mapStrings(f.data, (s) => normalize(s, f.data.stage));
  saveFile(f);
}
genTemplates();

if (changed.length === 0) console.log('変更なし');
else console.log(`${CHECK ? '変更が必要' : '書き込み'}: ${changed.join(', ')}`);
if (CHECK && changed.length) process.exit(1);
