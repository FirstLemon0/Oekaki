#!/usr/bin/env node
/**
 * 【適用済み・記録用】2026-09-24 の 1 回目の教材パッチ。すでに全部適用済みで、
 * その後の修正（tools/patch-content-fix-a.mjs / -b.mjs）で前提の構造が変わっているため、
 * そのまま実行すると失敗する。履歴として残しているだけで、再実行しないこと（--force で強行可）。
 *
 * 教材 JSON（content/stages/*.json）を機械的に直すスクリプト。
 *
 *   node tools/patch-content.mjs          … 変更を書き込む
 *   node tools/patch-content.mjs --check  … 書き込まずに、変更が必要なところだけ表示（CI 用。差分があれば exit 1）
 *
 * 何度実行しても同じ結果になる（冪等）。整形は既存と同じ「2 スペース・末尾改行」で、
 * 手書きの 1 行オブジェクト（{ "text": … }）も保つ（tools/json-format.mjs）。変更の無いファイルには書き込まない。
 *
 * やること:
 *   1. s10 の U10-2（塗り技法 9 レッスン）に optional: true（選択式。パスで「飛ばす」ことができる）
 *   2. s2 の箱を描く construct / trace に counter: "boxes"（construct は描く個数を count に）
 *      あわせて instruction の「1個描くごとに箱カウンターが増えます」を、実際の動き
 *      （描き終えたときにまとめて加算）に合わせた文言へ直す
 *   3. drill: "pressure" の params.profile の別名（increasing 等）を正式な値へ
 */
if (!process.argv.includes('--force')) {
  console.log('tools/patch-content.mjs は適用済みの記録用スクリプトです。再実行は不要です（--force で強行）。');
  process.exit(0);
}
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectFormat, formatAs } from './json-format.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STAGES = join(ROOT, 'content', 'stages');
const CHECK = process.argv.includes('--check');

/** 変更の記録（表示用） */
const log = [];

function load(stageId) {
  const file = join(STAGES, `${stageId}.json`);
  const text = readFileSync(file, 'utf8');
  return { stageId, file, text, data: JSON.parse(text), format: detectFormat(text) };
}

function save({ stageId, file, text, data, format }) {
  if (JSON.stringify(data) === JSON.stringify(JSON.parse(text))) return false;
  if (!format) {
    throw new Error(`${stageId}.json の整形の型が判別できません。書き換えると差分が膨らむので中止します（手で直してください）`);
  }
  if (!CHECK) writeFileSync(file, formatAs(format, data));
  return true;
}

function lessonsOf(stage) {
  return stage.units.flatMap((u) => u.lessons.map((l) => ({ unit: u, lesson: l })));
}

function findLesson(stage, id) {
  const hit = lessonsOf(stage).find(({ lesson }) => lesson.id === id);
  if (!hit) throw new Error(`レッスン ${id} が見つかりません`);
  return hit.lesson;
}

/** キーの並びを保ったまま、指定キーの直後に新しいキーを差し込む（既にあれば値だけ更新） */
function setAfter(obj, afterKey, key, value) {
  if (key in obj) {
    obj[key] = value;
    return obj;
  }
  const entries = Object.entries(obj);
  const at = entries.findIndex(([k]) => k === afterKey);
  entries.splice(at < 0 ? entries.length : at + 1, 0, [key, value]);
  for (const k of Object.keys(obj)) delete obj[k];
  for (const [k, v] of entries) obj[k] = v;
  return obj;
}

// ---------------------------------------------------------------------------
// 1. s10 U10-2 を選択式に
// ---------------------------------------------------------------------------

function patchS10() {
  const st = load('s10');
  const unit = st.data.units.find((u) => u.id === 's10-u2');
  if (!unit) throw new Error('s10-u2 が見つかりません');
  for (const lesson of unit.lessons) {
    if (lesson.optional !== true) {
      setAfter(lesson, 'summary', 'optional', true);
      log.push(`${lesson.id}: optional: true`);
    }
    const first = lesson.steps.find((s) => s.type === 'read');
    // 冒頭の案内文（2026-09 のレビューで「ヘッダの『この技法は飛ばす』」の案内に書き換え済み）
    if (!first || !first.body.startsWith('この技法をやらない場合は、ヘッダの「この技法は飛ばす」で')) {
      throw new Error(`${lesson.id}: 最初の read の冒頭文が想定と違います（手で確認してください）`);
    }
  }
  return save(st);
}

// ---------------------------------------------------------------------------
// 2. s2 の箱カウンター
// ---------------------------------------------------------------------------

/**
 * [レッスン id, ステップ番号, 描く個数]。個数は各 stages の指示文から数えた値。
 * trace は count（なぞる回数）ぶん加算されるので個数は持たない（null）。
 */
const BOX_STEPS = [
  // U2-2 立体の基礎
  ['s2-u2-l1', 1, null], // 1点透視の立方体をなぞる ×3
  ['s2-u2-l1', 2, 3], // 1個＋「場所を変えてあと2個」
  ['s2-u2-l2', 1, null], // 2点透視の立方体をなぞる ×3
  ['s2-u2-l2', 2, 3], // 1個＋「あと2個」
  ['s2-u2-l3', 1, null], // 箱をなぞる ×2
  ['s2-u2-l3', 2, 5], // 「少しずつ回しながら、5個」
  ['s2-u2-l6', 1, 1], // 箱と円柱を組み合わせる（箱 1）
  ['s2-u2-l6', 2, 1], // 箱を切る（箱 1）
  // 以降も「箱カウンターが増えます」と書いてある construct
  ['s2-u3-l3', 2, 1], // 見上げる建物（大きな箱 1）
  ['s2-u3-l5', 2, 3], // マス目の上に箱を 3 つ
  ['s2-u4-l2', 3, 1], // 箱を 3 値で塗り分ける（箱 1）
  ['s2-u4-l3', 3, 1], // 箱と球の落ち影（箱 1）
  ['s2-u5-l4', 1, 1], // 有機形を箱に入れる（箱 1）
  ['s2-u5-l4', 2, 1], // 豆形がすっぽり入る箱（箱 1）
  ['s2-u6-l2', 1, 2], // 本（薄い箱）＋上の箱
];

const OLD_BOX_TEXT = '1個描くごとに箱カウンターが増えます（250箱チャレンジ）。';

function boxText(step, n) {
  if (step.type === 'trace') return null;
  return `描き終えると、箱カウンターに${n}個加わります（250箱チャレンジ）。`;
}

function patchS2() {
  const st = load('s2');
  for (const [id, idx, n] of BOX_STEPS) {
    const lesson = findLesson(st.data, id);
    const step = lesson.steps[idx];
    if (!step || (step.type !== 'construct' && step.type !== 'trace')) {
      throw new Error(`${id} のステップ ${idx} が construct/trace ではありません`);
    }
    if (step.type === 'trace' && !/^cube-/.test(step.template)) {
      throw new Error(`${id} のステップ ${idx} は箱のなぞりではありません（${step.template}）`);
    }
    const before = JSON.stringify(step);
    if (step.type === 'construct') {
      setAfter(step, 'stages', 'counter', 'boxes');
      setAfter(step, 'counter', 'count', n);
      const text = boxText(step, n);
      if (step.instruction.includes(OLD_BOX_TEXT)) step.instruction = step.instruction.replace(OLD_BOX_TEXT, text);
    } else {
      setAfter(step, 'count', 'counter', 'boxes');
    }
    if (JSON.stringify(step) !== before) {
      log.push(`${id} [${idx}] ${step.type}: counter: "boxes"${step.type === 'construct' ? `, count: ${n}` : `（なぞり ${step.count ?? 1} 回ぶん）`}`);
    }
  }
  // 取りこぼし確認: 旧文言が残っていないこと
  for (const { lesson } of lessonsOf(st.data)) {
    lesson.steps.forEach((s, i) => {
      if (typeof s.instruction === 'string' && s.instruction.includes('箱カウンターが増えます')) {
        throw new Error(`${lesson.id} [${i}] に旧文言が残っています（BOX_STEPS に追加してください）`);
      }
    });
  }
  return save(st);
}

// ---------------------------------------------------------------------------
// 3. 筆圧プロファイルの別名を正式な値へ
// ---------------------------------------------------------------------------

const PRESSURE_ALIASES = { increasing: 'ramp-up', decreasing: 'ramp-down', constant: 'flat' };

function patchPressureAliases(stageIds) {
  const changed = [];
  for (const id of stageIds) {
    const st = load(id);
    for (const { lesson } of lessonsOf(st.data)) {
      lesson.steps.forEach((s, i) => {
        const p = s.type === 'drill' && s.drill === 'pressure' ? s.params?.profile : undefined;
        if (typeof p === 'string' && p in PRESSURE_ALIASES) {
          s.params.profile = PRESSURE_ALIASES[p];
          log.push(`${lesson.id} [${i}] drill pressure: profile "${p}" → "${s.params.profile}"`);
        }
      });
    }
    if (save(st)) changed.push(id);
  }
  return changed.length > 0;
}

// ---------------------------------------------------------------------------

const ALL = ['s0', 's1', 's1_5', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10'];
let dirty = false;
dirty = patchS10() || dirty;
dirty = patchS2() || dirty;
dirty = patchPressureAliases(ALL) || dirty;

if (log.length === 0) {
  console.log('変更なし（すでに適用済み）');
} else {
  console.log(`${CHECK ? '要変更' : '変更しました'}（${log.length} 件）:`);
  for (const l of log) console.log(`  - ${l}`);
}
if (CHECK && dirty) process.exit(1);
