/**
 * レッスン再生の純ロジック（DOM・IndexedDB に触らない）。
 *
 * - buildPlaySteps: レッスンのステップ列に、復習ウォームアップを差し込む
 * - drill 進行: 1 本（1 セット）ごとの採点 → 「もう一回」「次へ」→ count で完了
 * - 小さな対応表（カウンター種別、保存時の絵の種別）
 */
import { normalizePressureProfile, type Counter, type Lesson, type PressureProfile, type Step } from '@/content/schema';
import type { DrillStep } from '@/content/schema';
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
