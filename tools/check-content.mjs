#!/usr/bin/env node
/**
 * 教材の参照整合チェック（スキーマ検証＝vitest の外側で、中身の食い違いを見る）。
 *
 *   node tools/check-content.mjs            … 問題を一覧表示。1 件でもあれば exit 1
 *   node tools/check-content.mjs --summary  … あわせて集計（クイズの正解位置・箱の加算数など）を表示
 *
 * 見ること:
 *   figure   read.figure・quiz の選択肢の figure・construct の各段階の figure が content/figures にある
 *   template trace.template が content/templates にある
 *   rubric   critique / submit の rubric が content/rubrics にある
 *   refId    copy（builtin）・mosha の refId が content/figures にある。s4〜s6 の copy と mosha の refId は線画（*-lineart）。
 *            線画には文字・強調色（#7BB661）を入れない
 *   quiz     answer が選択肢の範囲内
 *   counter  種別が正しい。曲線・ハッチング・筆圧のドリルは数えない（直線だけが「直線」）。trace の counter は箱（cube-*）だけ
 *   params   drill.params のキーが採点・画面で使うもの（表示だけのものを含む）に限られる。値の形も見る
 *   所要時間 15 分を超えるレッスンは summary に「休日向け」。「休日向け」と書いたレッスンは 20 分以上。
 *            15 分のレッスンは、ステップからの目安（下の estimate）が 20 分を超えない
 *   free     外部アプリで描く工程（instruction が「外部アプリで」）は source: 'import'。save は Before/After の 2 か所だけ
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const C = join(ROOT, 'content');
const SUMMARY = process.argv.includes('--summary');

const figureIds = new Set(readdirSync(join(C, 'figures')).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4)));
const templateIds = new Set(readdirSync(join(C, 'templates')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)));
const rubricIds = new Set(readdirSync(join(C, 'rubrics')).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(C, 'rubrics', f), 'utf8')).id));
const stages = readdirSync(join(C, 'stages'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(C, 'stages', f), 'utf8')))
  .sort((a, b) => a.order - b.order);

const COUNTERS = ['lines', 'ellipses', 'circles', 'boxes'];
/** drill 種別ごとに使ってよい params のキーと、値の検査（true なら何でもよい） */
const PARAMS = {
  line: { orientation: ['h', 'v', 'd'], length: ['short', 'long'], mode: ['two-points'] },
  curve: { shape: ['c', 's', 'wave', 'spiral', 'through-points'], bend: ['strong'], points: 'int', direction: ['horizontal', 'vertical'], taper: ['in', 'out', 'both'] },
  circle: { size: ['small', 'medium', 'large', 'mixed'], direction: ['reverse'] },
  ellipse: { degree: 'unit', axisAngleDeg: 'angle', mode: ['stacked'] },
  pressure: { profile: ['ramp-up', 'ramp-down', 'flat'] },
  hatching: { spacing: 'num', angleDeg: 'num' },
};
const NO_COUNTER_DRILLS = ['curve', 'hatching', 'pressure'];
const DRILL_COUNTER = { line: 'lines', circle: 'circles', ellipse: 'ellipses' };

const problems = [];
const bad = (where, msg) => problems.push(`${where}: ${msg}`);

function checkValue(spec, v) {
  if (Array.isArray(spec)) return spec.includes(v);
  if (spec === 'int') return Number.isInteger(v) && v >= 2 && v <= 6;
  if (spec === 'unit') return typeof v === 'number' && v > 0 && v <= 1;
  if (spec === 'angle') return typeof v === 'number' && v >= 0 && v < 180;
  if (spec === 'num') return typeof v === 'number' && Number.isFinite(v);
  return true;
}

/** ステップから見た所要時間の目安（分）。描く系は少し多めに見積もる */
const PER_STROKE = { line: 0.15, curve: 0.2, ellipse: 0.2, circle: 0.15, pressure: 0.15 };
function estimate(lesson) {
  let t = 0;
  for (const s of lesson.steps) {
    if (s.type === 'read') t += 1;
    else if (s.type === 'quiz') t += 0.5;
    else if (s.type === 'drill') t += s.drill === 'hatching' ? 2 : s.count * PER_STROKE[s.drill];
    else if (s.type === 'trace') t += (s.count ?? 1) * 1.2;
    else if (s.type === 'copy') t += 5;
    else if (s.type === 'construct') t += s.stages.length * 1.5 * Math.sqrt(s.count ?? 1);
    else if (s.type === 'gesture') t += s.count * (s.seconds / 60 + 0.5);
    else if (s.type === 'mosha') t += 12;
    else if (s.type === 'critique') t += 18;
    else if (s.type === 'submit') t += 5;
    else if (s.type === 'free') t += 8;
  }
  return t;
}

const quizPos = {};
const counterTotals = { lines: 0, ellipses: 0, circles: 0, boxes: 0 };
let lessonCount = 0;
const saves = [];

for (const stage of stages) {
  for (const unit of stage.units) {
    for (const lesson of unit.lessons) {
      lessonCount++;
      const L = lesson.id;
      const holiday = lesson.summary.includes('休日向け');
      if (lesson.minutes > 15 && !holiday) bad(L, `minutes ${lesson.minutes} なのに summary に「休日向け」が無い`);
      if (holiday && lesson.minutes < 20) bad(L, `summary に「休日向け」があるのに minutes ${lesson.minutes}`);
      const est = estimate(lesson);
      if (lesson.minutes <= 15 && est > 20) bad(L, `目安 ${est.toFixed(1)} 分（minutes ${lesson.minutes}）。長すぎる`);

      lesson.steps.forEach((s, i) => {
        const W = `${L} [${i}] ${s.type}`;
        const fig = (id, what) => {
          if (id !== undefined && !figureIds.has(id)) bad(W, `${what} "${id}" の図が無い`);
        };
        switch (s.type) {
          case 'read':
            fig(s.figure, 'figure');
            break;
          case 'quiz':
            s.options.forEach((o) => fig(o.figure, 'option.figure'));
            if (!(Number.isInteger(s.answer) && s.answer >= 0 && s.answer < s.options.length)) bad(W, `answer ${s.answer} が範囲外`);
            else {
              const k = `${s.options.length}択`;
              quizPos[k] ??= Array(s.options.length).fill(0);
              quizPos[k][s.answer]++;
            }
            break;
          case 'construct':
            s.stages.forEach((st) => fig(st.figure, 'stage.figure'));
            if (s.counter && !COUNTERS.includes(s.counter)) bad(W, `counter "${s.counter}" が不明`);
            if (s.counter) counterTotals[s.counter] += s.count ?? 1;
            if (s.counter === 'boxes') {
              const m = /箱カウンターに(\d+)個加わります/.exec(s.instruction);
              if (!m || Number(m[1]) !== (s.count ?? 1)) bad(W, `instruction の個数と count（${s.count ?? 1}）が合わない`);
            }
            break;
          case 'trace':
            if (!templateIds.has(s.template)) bad(W, `template "${s.template}" が無い`);
            if (s.counter && s.counter !== 'boxes') bad(W, `trace の counter は boxes だけ（${s.counter}）`);
            if (s.counter === 'boxes' && !/^cube-/.test(s.template)) bad(W, `箱ではないなぞり（${s.template}）に counter: boxes`);
            if (s.counter) counterTotals[s.counter] += s.count ?? 1;
            break;
          case 'copy':
            if (s.reference === 'builtin') {
              if (!s.refId) bad(W, 'builtin なのに refId が無い');
              else fig(s.refId, 'refId');
              if (/^s[456]-/.test(L) && s.refId && !s.refId.endsWith('-lineart')) bad(W, `お手本 "${s.refId}" が線画（*-lineart）ではない`);
            } else if (s.refId) bad(W, 'reference: user なのに refId がある');
            break;
          case 'mosha':
            if (s.refId) {
              fig(s.refId, 'refId');
              if (!s.refId.endsWith('-lineart')) bad(W, `お手本 "${s.refId}" が線画（*-lineart）ではない`);
            }
            if (/^描いた/.test(s.instruction)) bad(W, '指示文が「描いた絵を重ねて」から始まっている（実装は描き直しから始まる）');
            break;
          case 'critique':
          case 'submit':
            if (!rubricIds.has(s.rubric)) bad(W, `rubric "${s.rubric}" が無い`);
            break;
          case 'free':
            if (s.instruction?.startsWith('外部アプリで') && s.source !== 'import') bad(W, '外部アプリで描く工程なのに source: import ではない');
            if (s.save) saves.push(`${L}:${s.save}`);
            break;
          case 'drill': {
            const spec = PARAMS[s.drill];
            for (const [k, v] of Object.entries(s.params ?? {})) {
              if (!(k in spec)) bad(W, `params.${k} は ${s.drill} では使われない`);
              else if (!checkValue(spec[k], v)) bad(W, `params.${k} の値 ${JSON.stringify(v)} が不正`);
            }
            if (s.counter && !COUNTERS.includes(s.counter)) bad(W, `counter "${s.counter}" が不明`);
            if (NO_COUNTER_DRILLS.includes(s.drill) && s.counter) bad(W, `${s.drill} のドリルに counter（${s.counter}）`);
            if (s.counter && DRILL_COUNTER[s.drill] && s.counter !== DRILL_COUNTER[s.drill]) bad(W, `${s.drill} に counter "${s.counter}"`);
            if (s.counter) counterTotals[s.counter] += s.count;
            break;
          }
        }
      });
    }
  }
}

// 線画（*-lineart）に文字・強調色が入っていない
for (const id of figureIds) {
  if (!id.endsWith('-lineart') || id === 's7-rough-to-lineart') continue; // s7-rough-to-lineart は説明図
  const svg = readFileSync(join(C, 'figures', `${id}.svg`), 'utf8');
  if (/<text\b/.test(svg)) bad(`figures/${id}.svg`, '線画に文字がある');
  if (/#7BB661/i.test(svg)) bad(`figures/${id}.svg`, '線画に強調色がある');
}
// Before / After は 1 か所ずつ
const before = saves.filter((x) => x.endsWith(':before'));
const after = saves.filter((x) => x.endsWith(':after'));
if (before.length !== 1) bad('free.save', `before が ${before.length} か所（${before.join(', ')}）`);
if (after.length !== 1) bad('free.save', `after が ${after.length} か所（${after.join(', ')}）`);

if (SUMMARY) {
  console.log(`レッスン数: ${lessonCount}`);
  for (const s of stages) console.log(`  ${s.id}: ${s.units.reduce((n, u) => n + u.lessons.length, 0)}`);
  console.log(`クイズの正解位置（1 番目から）: ${Object.entries(quizPos).map(([k, v]) => `${k} ${v.join('/')}`).join('・')}`);
  console.log(`教材で加算されるカウンター: ${Object.entries(counterTotals).map(([k, v]) => `${k} ${v}`).join('・')}`);
}
if (problems.length === 0) {
  console.log('参照整合チェック: 問題 0 件');
} else {
  console.log(`参照整合チェック: 問題 ${problems.length} 件`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
