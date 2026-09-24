#!/usr/bin/env node
/**
 * 教材修正 B（ステージ 5〜10）: 3 系統のレビュー（絵の先生／初心者体験／編集者）で確定した指摘の反映。
 *
 *   node tools/patch-content-fix-b.mjs          … 変更を書き込む
 *   node tools/patch-content-fix-b.mjs --check  … 書き込まずに、変更が必要なところだけ表示（差分があれば exit 1）
 *
 * 何度実行しても同じ結果になる（冪等）。整形は既存ファイルの書き方を保つ（tools/json-format.mjs）。
 * 触るのは content/stages/s5〜s10.json と content/rubrics の s5〜s10 のものだけ。
 *
 * 1. 個別の修正（内容の誤り・矛盾、ステップの追加、レッスンの追加と番号の振り直し）
 * 2. 表記の統一（シワ／俯瞰／下描き／いちばん／ところ／わかる／生かす／伸ばす／「で OK です」／全角コロン／①…／
 *    クイズの文末を丁寧体に／休日向け（約30分））
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectFormat, formatAs } from './json-format.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const log = [];
const warn = [];

function loadFile(file) {
  const text = readFileSync(file, 'utf8');
  return { file, text, data: JSON.parse(text), format: detectFormat(text) };
}
function saveFile(f) {
  if (JSON.stringify(f.data) === JSON.stringify(JSON.parse(f.text))) return false;
  if (!f.format) throw new Error(`${f.file} の整形の型が判別できません`);
  if (!CHECK) writeFileSync(f.file, formatAs(f.format, f.data));
  return true;
}

const STAGE_IDS = ['s5', 's6', 's7', 's8', 's9', 's10'];
const RUBRIC_FILES = ['s5-graduation', 's6-graduation', 's7-graduation', 's7-setup', 's8-graduation', 's9-graduation', 's10-final', 's10-milestone'];
const stages = Object.fromEntries(STAGE_IDS.map((id) => [id, loadFile(join(ROOT, 'content', 'stages', `${id}.json`))]));
const rubrics = Object.fromEntries(RUBRIC_FILES.map((id) => [id, loadFile(join(ROOT, 'content', 'rubrics', `${id}.json`))]));

function lesson(id) {
  const st = stages[id.split('-')[0]].data;
  for (const u of st.units) for (const l of u.lessons) if (l.id === id) return l;
  throw new Error(`レッスン ${id} が見つかりません`);
}
function unit(id) {
  const st = stages[id.split('-')[0]].data;
  const u = st.units.find((x) => x.id === id);
  if (!u) throw new Error(`ユニット ${id} が見つかりません`);
  return u;
}
/** キーの並びを保ったまま、指定キーの直後に新しいキーを差し込む（既にあれば値だけ更新） */
function setAfter(obj, afterKey, key, value) {
  if (key in obj) {
    if (JSON.stringify(obj[key]) !== JSON.stringify(value)) obj[key] = value;
    return obj;
  }
  const entries = Object.entries(obj);
  const at = entries.findIndex(([k]) => k === afterKey);
  entries.splice(at < 0 ? entries.length : at + 1, 0, [key, value]);
  for (const k of Object.keys(obj)) delete obj[k];
  for (const [k, v] of entries) obj[k] = v;
  return obj;
}
/** obj[field] の old を new に置き換える。old が無く new も無ければ警告（想定外の文面） */
function rep(where, obj, field, oldStr, newStr) {
  const v = obj[field];
  if (typeof v !== 'string') throw new Error(`${where}.${field} が文字列ではありません`);
  if (v.includes(newStr)) return; // 適用済み（new が old を含む場合もここで止める）
  if (v.includes(oldStr)) {
    obj[field] = v.split(oldStr).join(newStr);
    log.push(`${where}.${field}: 「${oldStr.slice(0, 24)}…」を置き換え`);
  } else {
    warn.push(`${where}.${field}: 「${oldStr.slice(0, 30)}」が見つからず、置き換え後の文面もありません`);
  }
}
/** steps の中で pred に合うステップが無ければ、index の位置に挿入する */
function insertStep(l, index, step, pred) {
  if (l.steps.some(pred)) return;
  l.steps.splice(index, 0, step);
  log.push(`${l.id}: ${step.type} を [${index}] に追加`);
}
function stepAt(l, i, type) {
  const s = l.steps[i];
  if (!s || s.type !== type) throw new Error(`${l.id} [${i}] が ${type} ではありません（${s?.type}）`);
  return s;
}
const findStep = (l, pred, what) => {
  const s = l.steps.find(pred);
  if (!s) throw new Error(`${l.id}: ${what} が見つかりません`);
  return s;
};

// 「著作物はアプリに入れず」→ 端末内だけで使う（19）
const OLD_COPYRIGHT = '著作物はアプリに入れず、自分の端末に保存してある画像を使います。';
const NEW_COPYRIGHT = '自分の端末に保存してある画像を取り込みます。取り込んだ画像は自分の端末の中だけで使い、外には出しません。';

// ===========================================================================
// ステージ 5
// ===========================================================================
{
  // 1. ルーブリック: 肘の尖り
  const r = rubrics['s5-graduation'].data;
  const i = r.points.findIndex((p) => p.startsWith('関節の向き'));
  const want = '関節の向き：肘の尖りが曲げた内側の反対（上腕の後ろ側）にあり、膝のお皿が脚の前にあり、肩と腰の傾きが自然か';
  if (i < 0) throw new Error('s5-graduation に「関節の向き」がありません');
  if (r.points[i] !== want) {
    r.points[i] = want;
    log.push('s5-graduation: 関節の向き（肘の尖り）');
  }

  // 19. 著作物の言い回し
  {
    const l = lesson('s5-u2-l4');
    const s = findStep(l, (x) => x.type === 'copy' && x.reference === 'user', 'copy(user)');
    rep('s5-u2-l4', s, 'instruction', `絵師さんの絵を使うときは、${OLD_COPYRIGHT}`, `絵師さんの絵を使うときは、${NEW_COPYRIGHT}`);
  }
  for (const id of ['s5-u4-l3', 's5-u5-l1']) {
    const s = findStep(lesson(id), (x) => x.type === 'copy' && x.reference === 'user', 'copy(user)');
    rep(id, s, 'instruction', OLD_COPYRIGHT, NEW_COPYRIGHT);
  }

  // 5. poseGroup
  for (const [id, g] of [['s5-u4-l1', 'standing'], ['s5-u4-l2', 'sitting'], ['s5-u4-l3', 'action'], ['s5-u4-l5', 'all']]) {
    const s = findStep(lesson(id), (x) => x.type === 'gesture' && x.source === 'mannequin', 'gesture');
    if (s.poseGroup !== g) {
      setAfter(s, 'source', 'poseGroup', g);
      log.push(`${id}: gesture.poseGroup = ${g}`);
    }
  }

  // 4. 短縮: 正面向きの手足の回を足す
  {
    const l = lesson('s5-u4-l4');
    rep('s5-u4-l4', l, 'summary', '「短縮」を、円柱の重なりで描きます。', '「短縮」を、円柱の重なりで描き、動きのあるポーズでも試します。');
    const qi = l.steps.findIndex((x) => x.type === 'quiz');
    insertStep(
      l,
      qi + 1,
      {
        type: 'construct',
        instruction: 'こちらへ走ってくるポーズを、円柱を重ねて描きましょう。手前に来る腕や脚ほど大きく、短く描きます。',
        stages: [
          { title: '動きの線', figure: 's5-foreshorten-gesture', instruction: '頭から手前の足先へ、こちらへ向かってくる動きの線を1本引きます。' },
          { title: '手前の手足', figure: 's5-foreshortening', instruction: 'こちらへ踏み出した脚と、前に振った腕を、断面の大きな丸い楕円から描き始めます。' },
          { title: '奥の胴体と手足', instruction: '胴体と奥の手足を、手前の円柱に重ねて小さめに描きます。隠れる所は描かなくて OK です。' },
        ],
      },
      (x) => x.type === 'construct' && x.stages.some((st) => st.figure === 's5-foreshorten-gesture'),
    );
    insertStep(
      l,
      qi + 2,
      {
        type: 'gesture',
        seconds: 30,
        count: 4,
        source: 'mannequin',
        poseGroup: 'action',
        instruction: 'ポーズ人形の動きのあるポーズを、30秒ずつ4体描きましょう。こちらへ向かってくる腕や脚は、円柱を重ねて短く描きます。終わったら見比べます。',
      },
      (x) => x.type === 'gesture',
    );
  }

  // 6・23. 全身週間: 描き直しのお手本
  {
    const l = lesson('s5-u4-l5');
    const s = findStep(l, (x) => x.type === 'construct', 'construct');
    rep(
      's5-u4-l5',
      s,
      'instruction',
      '10体の中から、いちばん描きにくかった1体を選んで、時間を気にせず描き直しましょう。',
      '10体の中で描きにくかったポーズを思い出し、横のお手本（立つ・座る・走る）から近いものを1つ選んで、時間を気にせず描き直しましょう。',
    );
    setAfter(s, 'stages', 'reference', 'builtin');
    setAfter(s, 'reference', 'refId', 'fx-s5-poses-mix-lineart');
    rep('s5-u4-l5', s.stages[0], 'instruction', '描きにくかったポーズの動きの線を、もう一度1本で引きます。', '選んだポーズの動きの線を、1本で引きます。');
    const r0 = stepAt(l, 0, 'read');
    rep('s5-u4-l5', r0, 'body', 'この週は、自由時間にもくり返し取り組んでみてください。', 'この週は、自由時間にもくり返し取り組んでみましょう。');
  }

  // 6. 模写チェックポイント: 構築ステップのお手本は取り込んだ絵
  {
    const l = lesson('s5-u5-l1');
    const s = findStep(l, (x) => x.type === 'construct', 'construct');
    rep('s5-u5-l1', s, 'instruction', '模写したポーズを、マネキンで描き直しましょう。', '模写したポーズを、マネキンで描き直しましょう。お手本には、前のステップで取り込んだイラストを選びます。');
    setAfter(s, 'stages', 'reference', 'user');
    rep('s5-u5-l1', s.stages[0], 'instruction', '模写した絵の横に、同じ動きの線を1本引きます。', 'お手本と同じ動きの線を1本引きます。');
  }

  // 20. 〜てください
  rep('s5-u5-l2', stepAt(lesson('s5-u5-l2'), 0, 'read'), 'body', '大切にしてください。', '大切にしましょう。');
}

// ===========================================================================
// ステージ 6
// ===========================================================================
{
  // 2. ルーブリック
  const r = rubrics['s6-graduation'].data;
  const want = 'シワの起点：シワが肩・肘・脇・股・膝などの関節や、胸の頂点・ベルト・肩掛けなどの支点から出て、曲げた内側に蛇腹ジワや折れジワ、外側に引っぱりジワという向きになっているか';
  if (r.points[0] !== want) {
    if (!r.points[0].startsWith('シワの起点')) throw new Error('s6-graduation の 1 つ目が「シワの起点」ではありません');
    r.points[0] = want;
    log.push('s6-graduation: シワの起点（関節と支点・蛇腹ジワ／折れジワ）');
  }
  rep('s6-graduation', r, 'focus', 'シワが関節から出ていれば', 'シワが関節や支点から出ていれば');

  // 3. シワの起点を関節と支点に・プリーツ
  {
    const l = lesson('s6-u1-l2');
    rep('s6-u1-l2', l, 'title', 'シワは関節から出る', 'シワは関節と支点から出る');
    rep('s6-u1-l2', l, 'summary', '服のシワの起点が、体の関節にあることを確かめます。', '服のシワの起点が、体の関節と、布を支える点（支点）にあることを確かめます。');
    const r0 = stepAt(l, 0, 'read');
    rep('s6-u1-l2', r0, 'title', '起点は関節', '起点は関節と支点');
    insertStep(
      l,
      1,
      {
        type: 'read',
        title: '支点からも出る',
        body: 'もう1つの起点は「支点」です。胸の頂点、ベルトで締めた腰、バッグの肩掛けなど、布が体や物に引っかかって支えられている点からも、シワが伸びます。\n\n支点では布が持ち上げられたり締めつけられたりするので、そこから引っぱりジワや垂れジワが広がります。関節と支点の両方に印をつけてから描くと、シワの置き場所に迷いません。',
        figure: 's6-fold-anchors',
      },
      (x) => x.type === 'read' && x.figure === 's6-fold-anchors',
    );
    const ci = l.steps.findIndex((x) => x.type === 'construct');
    insertStep(
      l,
      ci + 1,
      {
        type: 'construct',
        instruction: 'プリーツスカートを描きましょう。プリーツは、布をあらかじめ折りたたんで作った折り目です。シワと違って、腰から裾まで規則正しく並び、裾に向かって広がります。',
        stages: [
          { title: '腰の楕円', figure: 's6-pleats', instruction: '腰に巻きつく楕円を描きます。ここが折り目の支点です。' },
          { title: '裾の楕円', instruction: '腰より大きな裾の楕円を、同じ傾きで描きます。' },
          { title: '折り目の線', instruction: '腰から裾へ、放射状に折り目の線を等間隔で引きます。' },
          { title: '裾のジグザグ', instruction: '裾の楕円を、折り目ごとに山と谷が交互になるジグザグにします。' },
        ],
      },
      (x) => x.type === 'construct' && x.stages.some((st) => st.figure === 's6-pleats'),
    );
    const last = l.steps[l.steps.length - 1];
    rep('s6-u1-l2', last, 'body', '「シワは関節から出る」は、', '「シワは関節と支点から出る」は、');
  }
  rep('s6-u4-l1', stepAt(lesson('s6-u4-l1'), 0, 'read'), 'body', '多くは肩・肘・脇・股・膝などの関節から出ています。', '多くは肩・肘・脇・股・膝などの関節や、胸・ベルト・肩掛けなどの支点から出ています。');
  rep('s6-u4-l2', stepAt(lesson('s6-u4-l2'), 0, 'read'), 'body', 'シワは関節を起点に描き、', 'シワは関節と支点を起点に描き、');

  // 19. 著作物の言い回し
  for (const id of ['s6-u2-l3', 's6-u4-l1']) {
    const s = findStep(lesson(id), (x) => x.type === 'copy' && x.reference === 'user', 'copy(user)');
    rep(id, s, 'instruction', OLD_COPYRIGHT, NEW_COPYRIGHT);
  }
}

// ===========================================================================
// ステージ 7
// ===========================================================================
{
  // 20
  rep('s7-u1-l1', stepAt(lesson('s7-u1-l1'), 0, 'read'), 'body', '遠慮なく使ってください。', '遠慮なく使いましょう。');

  // 22. 3D 人形＋ジェスチャー＋提出は休日向け
  {
    const l = lesson('s7-u1-l3');
    if (l.minutes !== 30) {
      l.minutes = 30;
      log.push('s7-u1-l3: minutes 30');
    }
    rep('s7-u1-l3', l, 'summary', 'ポーズの形をつかむ方法を覚えます。', 'ポーズの形をつかむ方法を覚えます。人形の準備に時間がかかるので、休日向け（約30分）。');
  }

  // 15. ゴースティングはステージ 0
  rep('s7-u2-l1', stepAt(lesson('s7-u2-l1'), 0, 'read'), 'body', 'ステージ1で練習したゴースティング', 'ステージ0で練習したゴースティング');

  // 11・21. 線の重なり／外部アプリで線の強弱を試す
  {
    const l = lesson('s7-u2-l2');
    insertStep(
      l,
      1,
      {
        type: 'read',
        title: '重なる所は手前を太く、奥を切る',
        body: '線と線が重なるところでは、手前のものの線を太くし、奥のものの線は手前の線に当たるところで切って止めます。これだけで、どちらが前にあるかがはっきりします。',
        figure: 's7-line-overlap',
      },
      (x) => x.type === 'read' && x.figure === 's7-line-overlap',
    );
    insertStep(
      l,
      l.steps.length,
      {
        type: 'free',
        instruction: '外部アプリで、5分だけ線の強弱を試しましょう。筆圧の効くペンで、丸いものか顔の輪郭を描き、外側と影側を太く・内側を細くしてみます。描けたら書き出して、ここで取り込みましょう（採点はなく、記録として残ります）。',
        source: 'import',
      },
      (x) => x.type === 'free',
    );
  }
}

// ===========================================================================
// ステージ 8
// ===========================================================================
{
  // 20
  rep('s8-u1-l1', lesson('s8-u1-l1').steps.at(-1), 'body', '理由がうまく言えなくても大丈夫です。', '理由を言葉にできなくても大丈夫です。');
  rep('s8-u1-l2', lesson('s8-u1-l2').steps.at(-1), 'body', 'うまく巡らないときは、', '目が一周しないときは、');

  // 9. 関節で画面を切らない
  insertStep(
    lesson('s8-u1-l3'),
    1,
    {
      type: 'read',
      title: '関節で切らない',
      body: '画面の端でキャラクターを切るときは、手首・膝・足首などの関節でちょうど切らないようにしましょう。関節で切ると、手足が切り落とされたように見えます。関節と関節の間で切るか、関節の先まで入れます。',
      figure: 's8-no-cut-joints',
    },
    (x) => x.type === 'read' && x.figure === 's8-no-cut-joints',
  );

  // 7. なぞった枠を引き継ぐ
  {
    const l = lesson('s8-u1-l4');
    const s = findStep(l, (x) => x.type === 'construct', 'construct');
    rep('s8-u1-l4', s, 'instruction', '描いた10個の枠に、', 'なぞって描いた10個の枠に、');
    if (s.keepPrevious !== true) {
      setAfter(s, 'stages', 'keepPrevious', true);
      log.push('s8-u1-l4: construct.keepPrevious = true');
    }
  }

  // 8. キャラのどの高さを地平線が通るか
  {
    const l = lesson('s8-u2-l2');
    const r0 = stepAt(l, 0, 'read');
    rep('s8-u2-l2', r0, 'body', 'アイレベル（目の高さの線）を横に引き', '目の高さの線（地平線）を横に引き');
    insertStep(
      l,
      1,
      {
        type: 'read',
        title: '地平線がキャラのどこを通るか',
        body: 'キャラクターを部屋に立たせるときは、目の高さの線（地平線）がキャラのどの高さを通るかを先に決めます。同じくらいの背の人が立って見ていれば、地平線はキャラの目のあたりを通ります。\n\n地平線が腰や足元を通ると、下から見上げる角度（アオリ）になります。頭より上を通ると、上から見下ろす角度（俯瞰）になります。キャラと背景で、この高さをそろえましょう。\n\nただし、線が目や首にぴったり重なると絵を横に切って見えるので、少し上下にずらします（前のレッスンと同じです）。',
        figure: 's8-eyelevel-character',
      },
      (x) => x.type === 'read' && x.figure === 's8-eyelevel-character',
    );
    const s = findStep(l, (x) => x.type === 'construct', 'construct');
    rep('s8-u2-l2', s.stages[0], 'title', 'アイレベルと2つの消失点', '目の高さの線と2つの消失点');
    if (!s.stages.some((st) => st.figure === 's8-eyelevel-character')) {
      s.stages.push({ title: 'キャラクターを立たせる', figure: 's8-eyelevel-character', instruction: '部屋の角の手前に、キャラクターのアタリを1人置きます。目の高さの線がキャラの腰のあたりを通るようにして、頭の丸・胴体・脚を線だけで描きます。' });
      log.push('s8-u2-l2: construct にキャラクターの段階を追加');
    }
  }

  // 8. ルーブリック
  {
    const r = rubrics['s8-graduation'].data;
    const p = '目の高さの線（地平線）がキャラクターのどの高さを通るかが決まっていて、背景とキャラクターの見上げ・見下ろしがそろっているか（地平線が目や首にぴったり重なっていないか）';
    if (!r.points.includes(p)) {
      r.points.splice(3, 0, p);
      log.push('s8-graduation: 目の高さの線の観点を追加');
    }
    rep('s8-graduation', r, 'focus', '主役の位置→余白→視線誘導の順に', '主役の位置→余白→視線誘導→目の高さの線の順に');
    rep('s8-graduation', r, 'focus', '構図の3観点のうち', '構図の4観点のうち');
  }
}

// ===========================================================================
// ステージ 9
// ===========================================================================
{
  // 10. 色の面積比
  insertStep(
    lesson('s9-u1-l2'),
    1,
    {
      type: 'read',
      title: '色の面積比は 70／25／5',
      body: '色を配るときは、面積の比を「いちばん多い色 70%・次の色 25%・目立たせたい色 5%」くらいにすると、まとまりやすくなります。5% の色は、リボンや目など、見てほしいところに置きましょう。',
      figure: 's9-area-ratio',
    },
    (x) => x.type === 'read' && x.figure === 's9-area-ratio',
  );

  // 25. 選択肢の A／B ラベル（アプリが並べ替えて番号を振る）→ 中身がわかる短い説明に
  {
    const l = lesson('s9-u2-l1');
    const qs = l.steps.filter((x) => x.type === 'quiz');
    const sat = qs.find((q) => q.options.some((o) => o.figure === 's9-sat-a'));
    const val = qs.find((q) => q.options.some((o) => o.figure === 's9-val-a'));
    const setText = (q, fig, text) => {
      const o = q.options.find((x) => x.figure === fig);
      if (o.text !== text) {
        o.text = text;
        log.push(`s9-u2-l1: 選択肢 ${fig} のラベルを「${text}」に`);
      }
    };
    setText(sat, 's9-sat-b', '赤紫がかった髪・青灰色の服');
    setText(sat, 's9-sat-a', '赤い髪・青い服');
    rep('s9-u2-l1', sat, 'explain', 'B は、髪や服の色が鮮やかで、はっきりしています。A は灰色が混ざったような、落ち着いた色（彩度が低い色）です。', '赤い髪・青い服の絵は、色が鮮やかではっきりしています。もう一方は灰色が混ざったような、落ち着いた色（彩度が低い色）です。');
    setText(val, 's9-val-a', '黒っぽい髪・青い服');
    setText(val, 's9-val-b', 'オレンジ系の髪と服');
    rep('s9-u2-l1', val, 'explain', 'A は、明るい肌・暗い髪・中くらいの服と、明るさがはっきり分かれています。B は色が違っても明るさが近いので、白黒にすると区別しにくくなります。', '黒っぽい髪の絵は、明るい肌・暗い髪・中くらいの服と、明るさがはっきり分かれています。オレンジ系の絵は色が違っても明るさが近いので、白黒にすると区別しにくくなります。');
  }
}

// ===========================================================================
// ステージ 10
// ===========================================================================
const FULL_EXPORT = '塗り終えたら画像として書き出し、ここで取り込みましょう（採点はなく、記録として残ります）。';
const SHORT_EXPORT = '書き出して、ここで取り込みましょう。';
const SKIP_OLD = 'この技法をやらない場合は、ヘッダの「この技法は飛ばす」で3課とも飛ばして OK です。\n\n';
{
  // 18. 陰＝影
  rep(
    's10-u1-l1',
    stepAt(lesson('s10-u1-l1'), 0, 'read'),
    'body',
    '光源が決まれば、影の場所も決まります。',
    'ステージ2で習った「陰」（光の反対側の暗い面）は、このステージでは「影」と呼びます。このステージでは、影・反射光・縁（ふち）の3つの言葉で説明していきます。\n\n光源が決まれば、影の場所も決まります。',
  );

  const u2 = unit('s10-u2');
  // 12. アニメ塗り①と②の間に「目と顔の影」を足す
  if (!u2.lessons.some((l) => l.title.includes('目と顔の影'))) {
    u2.lessons.splice(1, 0, {
      id: 's10-u2-l2',
      title: 'アニメ塗り②目と顔の影',
      minutes: 15,
      kind: 'lesson',
      summary: '目の塗り方（虹彩・まぶたの影・ハイライト）と、顔によく入る影の型を覚えます。',
      optional: true,
      steps: [
        {
          type: 'read',
          title: '目は3つの手順で塗る',
          body: '目は、顔の中でいちばん見られるところです。アニメ塗りの目は、3つの手順で塗ります。\n\n①虹彩のグラデーション：虹彩（黒目）の上を暗く、下を明るくします。上まぶたの影が落ちるからです。\n\n②上まぶたの落ち影：白目と虹彩の上のほうに、まぶたの形に沿った影を細く入れます。\n\n③瞳のハイライト：光源の側に、白い点を1〜2個置きます。両目で同じ位置にそろえると、視線がはっきりします。',
          figure: 's10-eye-paint',
        },
        {
          type: 'read',
          title: '顔の影には型がある',
          body: '顔の影は、毎回形を考えなくても、よく使う型があります。\n\n前髪の影：前髪の毛先の形に沿って、おでこに落ちる影です。\n\n鼻の横の影：光の反対側の、鼻の横に小さく入れる影です。\n\n首の影：あごの下から首へ落ちる影です。首の上のほうを広めに暗くします。\n\nどれも光源の反対側に入れます。ユニット1で決めた光源の矢印を見ながら置きましょう。',
          figure: 's10-face-shadows',
        },
        {
          type: 'free',
          instruction: `外部アプリで、目に虹彩のグラデーション・上まぶたの影・ハイライトを入れ、顔に前髪・鼻の横・首の影を入れてみましょう。${SHORT_EXPORT}`,
          source: 'import',
        },
        {
          type: 'read',
          title: '振り返り',
          body: '目と顔の影が入ると、表情がぐっとはっきりします。\n\n影の型は、どの絵でも使い回せます。迷ったら、この3つから入れてみましょう。',
          figure: 's10-face-shadows',
        },
      ],
    });
    log.push('s10-u2: アニメ塗り②目と顔の影 を追加');
  }
  // 番号の振り直しとタイトルの番号
  u2.lessons.forEach((l, i) => {
    const id = `s10-u2-l${i + 1}`;
    if (l.id !== id) {
      log.push(`${l.id} → ${id}`);
      l.id = id;
    }
    if (l.optional !== true) setAfter(l, 'summary', 'optional', true);
  });
  const L = (n) => u2.lessons[n - 1];
  rep('s10-u2-l3', L(3), 'title', 'アニメ塗り②1影と2影', 'アニメ塗り③1影と2影');
  rep('s10-u2-l4', L(4), 'title', 'アニメ塗り③髪の影と天使の輪', 'アニメ塗り④髪の影と天使の輪');

  // 13. 「飛ばして OK」は各技法の最初だけ
  {
    const b = L(1).steps[0];
    rep(
      's10-u2-l1',
      b,
      'body',
      SKIP_OLD + 'このユニットには、アニメ塗り（レッスン1〜3）・厚塗り入門（4〜6）・水彩風（7〜9）の3つの塗り方があります。1つ以上を選んで、じっくり練習しましょう。選ばない技法のレッスンは、ヘッダの「この技法は飛ばす」で飛ばせます（あとから開いて取り組むこともできます）。',
      'この技法をやらない場合は、ヘッダの「この技法は飛ばす」で4レッスンとも飛ばして OK です。\n\nこのユニットには、アニメ塗り（レッスン1〜4）・厚塗り入門（5〜7）・水彩風（8〜10）の3つの塗り方があります。1つ以上を選んで、じっくり練習しましょう。選ばなかった技法のレッスンも、あとから開いて取り組めます。',
    );
    for (const n of [5, 8]) rep(`s10-u2-l${n}`, L(n).steps[0], 'body', SKIP_OLD, 'この技法をやらない場合は、ヘッダの「この技法は飛ばす」で3レッスンとも飛ばして OK です。\n\n');
    for (const n of [3, 4, 6, 7, 9, 10]) {
      const s = L(n).steps[0];
      if (s.body.startsWith(SKIP_OLD)) {
        s.body = s.body.slice(SKIP_OLD.length);
        log.push(`s10-u2-l${n}: 冒頭の「飛ばして OK」を削除`);
      }
    }
  }
  rep('s10-u2-l4', L(4).steps.at(-1), 'body', 'アニメ塗りの3レッスン', 'アニメ塗りの4レッスン');

  // 22. 1枚仕上げの回は複数日で OK
  for (const n of [4, 7, 10]) {
    const l = L(n);
    const add = '1枚を仕上げる回なので、複数日かけて OK です。';
    if (!l.summary.includes(add)) {
      l.summary = `${l.summary}${add}`;
      log.push(`s10-u2-l${n}: summary に複数日`);
    }
    const f = findStep(l, (x) => x.type === 'free', 'free');
    const note = '複数日かけて OK です。ここでは途中まででも取り込んで OK です。';
    if (!f.instruction.includes(note)) {
      if (f.instruction.includes(FULL_EXPORT)) f.instruction = f.instruction.replace(FULL_EXPORT, `${note}${SHORT_EXPORT}`);
      else if (f.instruction.includes(SHORT_EXPORT)) f.instruction = f.instruction.replace(SHORT_EXPORT, `${note}${SHORT_EXPORT}`);
      else f.instruction = `${f.instruction}${note}`;
      log.push(`s10-u2-l${n}: free に複数日の案内`);
    }
  }

  // 26. 書き出しの定型文は技法の最初（と U10-1 の最初）だけ完全版
  const fullAt = new Set(['s10-u1-l2', 's10-u2-l1', 's10-u2-l5', 's10-u2-l8']);
  for (const u of stages.s10.data.units) {
    for (const l of u.lessons) {
      for (const s of l.steps) {
        if (s.type !== 'free' || !s.instruction?.includes(FULL_EXPORT) || fullAt.has(l.id)) continue;
        s.instruction = s.instruction.replace(FULL_EXPORT, SHORT_EXPORT);
        log.push(`${l.id}: 書き出しの定型文を短く`);
      }
    }
  }
  // 効果の回は「塗り終えたら」ではないので、もともと短い文へ（上で置換済み）

  // 12. subtitle
  const st = stages.s10.data;
  const count = st.units.reduce((n, u) => n + u.lessons.length, 0);
  const sub = `6週間・${count}レッスン（塗り技法は選択式）`;
  if (st.subtitle !== sub) {
    st.subtitle = sub;
    log.push(`s10: subtitle = ${sub}`);
  }

  // 14. 最終課題の summary の矛盾
  {
    const l = lesson('s10-u4-l1');
    rep('s10-u4-l1', l, 'summary', '工程ごとに提出して区切ります。休日向け（約 30 分）。', '1日15分ずつでも進められるよう、工程ごとに提出して区切ります。');
    if (l.minutes !== 15) {
      l.minutes = 15;
      log.push('s10-u4-l1: minutes 15（1日分の目安。全体は複数日）');
    }
  }

  // 17. 書き出しサイズ
  rep('s10-u4-l3', stepAt(lesson('s10-u4-l3'), 0, 'read'), 'body', '書き出した長い辺 2000〜3000px の PNG か JPEG で大丈夫です。', '長い辺を 2000〜3000px で書き出した PNG か JPEG で大丈夫です。');
}

// ===========================================================================
// 表記の統一（24）
// ===========================================================================
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];
function normalize(s) {
  let t = s;
  t = t.replace(/休日向け（約\s*30\s*分）/g, '休日向け（約30分）');
  t = t.replace(/しわ/g, 'シワ');
  t = t.replace(/フカン/g, '俯瞰');
  t = t.replace(/アイレベル/g, '目の高さの線');
  t = t.replace(/下書き/g, '下描き');
  t = t.replace(/三等分/g, '3等分');
  t = t.replace(/一番/g, 'いちばん');
  t = t.replace(/(?<![場か])所/g, 'ところ');
  t = t.replace(/分か(る|り|ら|っ|れば)/g, 'わか$1');
  t = t.replace(/捉え/g, 'とらえ');
  t = t.replace(/活か/g, '生か').replace(/活き/g, '生き');
  t = t.replace(/(?<![伸])のば(し|す)/g, '伸ば$1');
  t = t.replace(/延ば/g, '伸ば');
  // 「で OK です」
  t = t.replace(/([^\s「（(])OK/g, '$1 OK');
  t = t.replace(/OK(?=です)/g, 'OK ');
  // 全角コロン
  t = t.replace(/\s*:\s*/g, '：');
  // 列挙番号
  t = t.replace(/(^|\n)([1-9])\. /g, (_, a, n) => a + CIRCLED[Number(n) - 1]);
  t = t.replace(/(^|\n)([1-9])つ目、/g, (_, a, n) => a + CIRCLED[Number(n) - 1]);
  // 感嘆符
  t = t.replace(/[！!]/g, '。').replace(/。。/g, '。');
  return t;
}
function politeQuestion(q) {
  return q
    .replace(/どっち？/g, 'どちらですか？')
    .replace(/(どれ|どこ|どちら側|どの並び順)？/g, '$1ですか？')
    .replace(/どうなる？/g, 'どうなりますか？')
    .replace(/保存する？/g, '保存しますか？')
    .replace(/(よい|やすい)？/g, '$1ですか？');
}
const TEXT_KEYS = new Set(['title', 'subtitle', 'summary', 'body', 'instruction', 'question', 'explain', 'text', 'focus']);
function walk(node, where) {
  if (Array.isArray(node)) {
    node.forEach((x, i) => {
      if (typeof x === 'string' && where === 'points') {
        const n = normalize(x);
        if (n !== x) node[i] = n;
      } else walk(x, where);
    });
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string' && TEXT_KEYS.has(k)) {
      let n = normalize(v);
      if (k === 'question') n = politeQuestion(n);
      if (n !== v) node[k] = n;
    } else if (typeof v === 'object') walk(v, k);
  }
}
for (const f of [...Object.values(stages), ...Object.values(rubrics)]) {
  const before = JSON.stringify(f.data);
  walk(f.data, '');
  if (JSON.stringify(f.data) !== before) log.push(`${f.file.replace(ROOT + '/', '')}: 表記の統一`);
}

// ===========================================================================
let dirty = false;
for (const f of [...Object.values(stages), ...Object.values(rubrics)]) dirty = saveFile(f) || dirty;

if (!dirty) console.log('変更なし（すでに適用済み）');
else {
  console.log(`${CHECK ? '要変更' : '変更しました'}（${log.length} 件）:`);
  for (const l of log) console.log(`  - ${l}`);
}
if (warn.length) {
  console.log(`注意（${warn.length} 件）:`);
  for (const w of warn) console.log(`  - ${w}`);
}
if (CHECK && dirty) process.exit(1);
