/**
 * レッスン再生の純ロジック（DOM・IndexedDB に触らない）。
 *
 * - buildPlaySteps: レッスンのステップ列に、復習ウォームアップを差し込む
 * - drill 進行: 1 本（1 セット）ごとの採点 → 「もう一回」「次へ」→ count で完了
 * - 小さな対応表（カウンター種別、保存時の絵の種別）
 */
import { normalizePressureProfile, type Counter, type Lesson, type PressureProfile, type Step } from '@/content/schema';
import type { DrillStep, TraceStep } from '@/content/schema';
import type { PathNode } from '@/content';
import type { CounterKind, DrawingKind, Progress } from '@/data/types';
import type { DueReview } from '@/data/review';

export type DrillType = DrillStep['drill'];

export const DRILL_TYPES: readonly DrillType[] = ['line', 'curve', 'circle', 'ellipse', 'pressure', 'hatching'];

export function isDrillType(s: string): s is DrillType {
  return (DRILL_TYPES as readonly string[]).includes(s);
}

/** 再生する 1 ステップ。warmup は復習として差し込んだもの */
export interface PlayStep {
  step: Step;
  warmup: boolean;
}

/** 復習セッションの本数 */
export const REVIEW_COUNT = 10;

export const DRILL_LABEL: Record<DrillType, string> = {
  line: '直線',
  curve: '曲線',
  circle: '円',
  ellipse: '楕円',
  pressure: '筆圧',
  hatching: 'ハッチング',
};

const REVIEW_PARAMS: Record<DrillType, Record<string, number | string>> = {
  line: { orientation: 'h' },
  curve: { shape: 'c' },
  circle: { size: 'medium' },
  ellipse: { degree: 0.5, axisAngleDeg: 0 },
  pressure: { profile: 'ramp-up' },
  hatching: { spacing: 14, angleDeg: 45 },
};

/** drill / trace / construct の counter（教材の語）→ data の CounterKind */
export function counterKindOf(counter: Counter | undefined): CounterKind | null {
  switch (counter) {
    case 'lines':
      return 'line';
    case 'ellipses':
      return 'ellipse';
    case 'circles':
      return 'circle';
    case 'boxes':
      return 'box';
    default:
      return null;
  }
}

const DEFAULT_COUNTER: Partial<Record<DrillType, DrillStep['counter']>> = {
  line: 'lines',
  circle: 'circles',
  ellipse: 'ellipses',
};

/** 復習用のドリルステップ（該当ドリル 10 本） */
export function reviewDrillStep(drill: DrillType, count = REVIEW_COUNT): DrillStep {
  const counter = DEFAULT_COUNTER[drill];
  const unit = drill === 'circle' || drill === 'ellipse' ? '個' : '本';
  return {
    type: 'drill',
    drill,
    count,
    instruction: `復習: ${DRILL_LABEL[drill]}を${count}${unit}。手を温めるつもりで、1つずつ落ち着いて描きましょう。`,
    params: { ...REVIEW_PARAMS[drill] },
    ...(counter ? { counter } : {}),
  };
}

/**
 * レッスンの再生ステップ列を作る。
 * withWarmup が true で、dueReviews にドリル種別の該当があれば、先頭に復習を 1 つ差し込む。
 */
export function buildPlaySteps(lesson: Lesson, due: readonly DueReview[], withWarmup = true): PlayStep[] {
  const steps: PlayStep[] = lesson.steps.map((step) => ({ step, warmup: false }));
  if (!withWarmup) return steps;
  const hit = due.find((d) => isDrillType(d.drillType));
  if (!hit || !isDrillType(hit.drillType)) return steps;
  return [{ step: reviewDrillStep(hit.drillType), warmup: true }, ...steps];
}

/** ステップを保存するときの絵の種別 */
export function drawingKindForStep(type: Step['type']): DrawingKind {
  switch (type) {
    case 'drill':
      return 'drill';
    case 'free':
      return 'free';
    case 'critique':
    case 'submit':
      return 'submit';
    default:
      return 'lesson';
  }
}

/** 採点ありのドリルで「1 セット＝複数ストローク」のもの（count はセット内の本数） */
export function isSetDrill(drill: DrillType): boolean {
  return drill === 'hatching';
}

/**
 * 筆圧プロファイル（採点側の名前）。教材の別名（increasing 等）は読み込み時に
 * スキーマが正式な値へそろえるので、ここは未指定・想定外のときの既定（ramp-up）を足すだけ。
 */
export function pressureProfileOf(v: unknown): PressureProfile {
  return normalizePressureProfile(v) ?? 'ramp-up';
}

/**
 * trace / construct の累計への加算。
 * - trace: 1 回なぞるごとに n（=1）
 * - construct: 描き終えたときに n（= step.count、既定 1）
 * counter が無いステップは null。
 */
export function stepCounterBump(step: Step): { kind: CounterKind; n: number } | null {
  if (step.type !== 'trace' && step.type !== 'construct') return null;
  const kind = counterKindOf(step.counter);
  if (!kind) return null;
  return { kind, n: step.type === 'construct' ? (step.count ?? 1) : 1 };
}

// ---------------------------------------------------------------------------
// ドリルの進行
// ---------------------------------------------------------------------------

export interface DrillProgress {
  /** 今描いている番号（0 始まり） */
  index: number;
  count: number;
  /** 「次へ」で確定した点数 */
  scores: number[];
  /** 採点シートに出している点数（未確定） */
  pending: number | null;
}

export function startDrill(count: number): DrillProgress {
  return { index: 0, count: Math.max(1, Math.floor(count)), scores: [], pending: null };
}

/** 1 本（1 セット）を採点した */
export function drillScored(p: DrillProgress, score: number): DrillProgress {
  if (drillDone(p)) return p;
  return { ...p, pending: score };
}

/** 「もう一回」: 同じ番号をやり直す */
export function drillAgain(p: DrillProgress): DrillProgress {
  return { ...p, pending: null };
}

/** 「次へ」: 採点した点数を確定して番号を進める。未採点なら何もしない */
export function drillNext(p: DrillProgress): DrillProgress {
  if (p.pending === null || drillDone(p)) return p;
  return { ...p, index: p.index + 1, scores: [...p.scores, p.pending], pending: null };
}

export function drillDone(p: DrillProgress): boolean {
  return p.index >= p.count;
}

/** 「7/10」表記（描いている番号。完了後は count/count） */
export function drillCounterLabel(p: DrillProgress): string {
  return `${Math.min(p.index + 1, p.count)}/${p.count}`;
}

export function average(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
}

// ---------------------------------------------------------------------------
// ステップ進行
// ---------------------------------------------------------------------------

/** 範囲外の番号を丸める */
export function clampStep(n: number, total: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), Math.max(0, total - 1));
}

/** 次のステップ番号。最後なら null（＝レッスン完了） */
export function nextStepIndex(n: number, total: number): number | null {
  return n + 1 < total ? n + 1 : null;
}

/** ヘッダの進捗セグメント */
export function progressSegments(current: number, total: number): ('done' | 'current' | 'todo')[] {
  return Array.from({ length: total }, (_, i) => (i < current ? 'done' : i === current ? 'current' : 'todo'));
}

// ---------------------------------------------------------------------------
// 途中再開・選択式
// ---------------------------------------------------------------------------

/** 先頭に差し込んだ復習の数 */
export function warmupCount(steps: readonly PlayStep[]): number {
  let n = 0;
  while (n < steps.length && steps[n]!.warmup) n += 1;
  return n;
}

/**
 * いま再生する位置（session.steps の添字）。
 * URL にはレッスン本来の番号だけを載せ、復習は「表示上の前置き」として扱う:
 * 済ませた復習の数が先頭の復習数に満たないうちは復習を、終えたらレッスン本来の番号のステップを出す。
 */
export function playIndexOf(steps: readonly PlayStep[], warmupsDone: number, lessonIndex: number): number {
  const w = warmupCount(steps);
  if (warmupsDone < w) return Math.max(0, warmupsDone);
  return w + clampStep(lessonIndex, steps.length - w);
}

/** ステップを終えたあとの行き先 */
export type AfterStep = { kind: 'warmup'; warmupsDone: number } | { kind: 'step'; lessonIndex: number } | { kind: 'finish' };

export function afterStep(steps: readonly PlayStep[], warmupsDone: number, lessonIndex: number): AfterStep {
  const w = warmupCount(steps);
  if (warmupsDone < w) return { kind: 'warmup', warmupsDone: warmupsDone + 1 };
  const n = clampStep(lessonIndex, steps.length - w);
  return n + 1 < steps.length - w ? { kind: 'step', lessonIndex: n + 1 } : { kind: 'finish' };
}

/**
 * 再生中の番号（復習を含む）→ レッスン本来のステップ番号。
 * 途中再開の保存はこちらで行う（再開時は復習を差し込まないので、番号がずれない）。
 */
export function lessonStepIndex(steps: readonly PlayStep[], playIndex: number): number {
  return Math.max(0, playIndex - warmupCount(steps));
}

/**
 * 「続きから」を出すステップ番号。記録が無い・先頭・範囲外なら null。
 * （completeLesson は lastStep を null に戻すので、完了済みで途中記録が無ければ null）
 */
export function resumeStepOf(p: Pick<Progress, 'lastStep'> | undefined, totalSteps: number): number | null {
  const k = p?.lastStep;
  if (typeof k !== 'number' || !Number.isInteger(k)) return null;
  if (k <= 0 || k >= totalSteps) return null;
  return k;
}

/** 選択式のレッスンか（飛ばせる） */
export function isSkippable(lesson: Pick<Lesson, 'optional'>): boolean {
  return lesson.optional === true;
}

/**
 * 飛ばしたあとに開くレッスン。パス上で飛ばしたものより後ろの未完了の最初。
 * 後ろが全部終わっていれば、前に残っている未完了の最初（飛ばしたもの自身は除く）。
 */
export function nextAfterSkip(path: readonly PathNode[], completedIds: ReadonlySet<string>, skippedId: string): PathNode | undefined {
  const at = path.findIndex((n) => n.lesson.id === skippedId);
  const open = (n: PathNode) => n.lesson.id !== skippedId && !completedIds.has(n.lesson.id);
  return path.slice(at + 1).find(open) ?? path.find(open);
}

// ---------------------------------------------------------------------------
// 所要時間・描いていた時間
// ---------------------------------------------------------------------------

/** 完了モーダルに出す所要分の上限（開きっぱなしで 300 分等にならないように） */
export const ELAPSED_MIN_CAP = 60;

/** 所要分（1..ELAPSED_MIN_CAP）。capped は上限で丸めたか */
export function elapsedMinutes(startedAt: number, now: number): { min: number; capped: boolean } {
  const raw = Math.round(Math.max(0, now - startedAt) / 60000);
  if (raw > ELAPSED_MIN_CAP) return { min: ELAPSED_MIN_CAP, capped: true };
  return { min: Math.max(1, raw), capped: false };
}

/** ストロークとストロークの間は、これより長い空きを「描いていない」とみなす */
export const MAX_IDLE_GAP_MS = 60 * 1000;

/**
 * 実際に描いていた時間（ms）。各ストロークの長さ＋ストローク間の空き（1 回 MAX_IDLE_GAP_MS まで）。
 * spans は描いた順の { start, end }（ms）。
 */
export function activeDrawingMs(spans: readonly { start: number; end: number }[], maxGap = MAX_IDLE_GAP_MS): number {
  let total = 0;
  let prevEnd: number | null = null;
  for (const sp of spans) {
    const start = Math.min(sp.start, sp.end);
    const end = Math.max(sp.start, sp.end);
    total += end - start;
    if (prevEnd !== null) total += Math.min(maxGap, Math.max(0, start - prevEnd));
    prevEnd = end;
  }
  return total;
}

// ---------------------------------------------------------------------------
// クイズ（選択肢のシャッフル）
// ---------------------------------------------------------------------------

/** 0..n-1 の並べ替え（rnd は 0..1）。order[i] = 表示 i 番目に出す元の選択肢の番号 */
export function shuffledOrder(n: number, rnd: () => number = Math.random): number[] {
  const order = Array.from({ length: Math.max(0, n) }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

/**
 * クイズの選択肢ラベル。表示の位置 i（0 始まり）→ ①②③…（⑳ まで。それより先は「21.」のような数字）。
 * 並べ替えた後の表示の順に振る（元の番号ではない）。
 */
export function choiceMark(i: number): string {
  if (i >= 0 && i < 20) return String.fromCharCode(0x2460 + i);
  return `${i + 1}.`;
}

/** 選択肢の本文の先頭に残った「A: 」「B：」「(C) 」などの記号を外す（並べ替えると意味が無くなるため） */
export function stripChoicePrefix(text: string): string {
  const t = text.replace(/^\s*(?:[（(]\s*[A-DＡ-Ｄa-dａ-ｄ]\s*[)）]|[A-DＡ-Ｄa-dａ-ｄ]\s*[:：.．)）])\s*/, '');
  return t.length > 0 ? t : text;
}

/**
 * 表示用の選択肢: order（shuffledOrder の結果）の順に、①②③… を振った一覧。
 * orig は元の番号（正解判定は orig === step.answer）。
 */
export function labeledChoices(texts: readonly string[], order: readonly number[]): { orig: number; mark: string; text: string }[] {
  return order.map((orig, i) => ({ orig, mark: choiceMark(i), text: stripChoicePrefix(texts[orig] ?? '') }));
}

// ---------------------------------------------------------------------------
// 箱の追加ドリル（250 箱チャレンジの加算経路）
// ---------------------------------------------------------------------------

/** 復習・追加ドリルのルート名（#/review/box） */
export const BOX_REVIEW = 'box';

/** 箱を描く: 1 点透視 2 回 → 2 点透視 3 回のなぞり（1 回ごとに boxes +1） */
export function boxReviewSteps(): TraceStep[] {
  return [
    {
      type: 'trace',
      template: 'cube-1pt',
      count: 2,
      counter: 'boxes',
      instruction: '箱を描く: 1点透視の箱を2回なぞりましょう。奥へ向かう線は消失点へそろえます。',
    },
    {
      type: 'trace',
      template: 'cube-2pt',
      count: 3,
      counter: 'boxes',
      instruction: '箱を描く: 2点透視の箱を3回なぞりましょう。縦の辺はまっすぐ立てます。',
    },
  ];
}

/** ステージ 2（形と立体）以降の学習者か（次にやるレッスンのステージで見る。全部終えていれば true） */
export function reachedBoxStage(path: readonly PathNode[], completedIds: ReadonlySet<string>): boolean {
  const next = path.find((n) => !completedIds.has(n.lesson.id));
  if (!next) return path.length > 0;
  return next.stage.order >= 2;
}
