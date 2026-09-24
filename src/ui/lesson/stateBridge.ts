/**
 * レッスン系の保存処理と signals の更新（state.ts には書かない更新関数をここに置く）。
 */
import { computed } from '@preact/signals';
import {
  bumpCounter,
  completeLesson,
  getDrawing,
  listCritiques,
  listDrillStats,
  recordActivity,
  recordDrill,
  saveCritique,
  saveDrawing,
  setLessonStep,
} from '@/data/repo';
import { downscaleToWebp } from '@/data/images';
import { xpForDrillScore, xpForEvent } from '@/data/xp';
import type { CounterKind, Drawing, DrawingKind, Progress, StrokeDrawing } from '@/data/types';
import type { CritiqueResult } from '@/critic';
import { createCanvasEngine } from '@/canvas';
import type { Lesson } from '@/content/schema';
import { completedIds, counters, critiques, drillStats, nextNode, path, profile, progress, reloadData, saveProfile, streak, uiPrefs } from '../state';
import { baselineToRecord, scorersFor } from './limits';
import type { Baseline } from '@/scoring';
import { buildPlaySteps, nextAfterSkip, stepCounterBump, type PlayStep } from './steps';
import type { Step } from '@/content/schema';
import type { DueReview } from '@/data/review';

// ---------------------------------------------------------------------------
// 採点関数（校正＋厳しさを反映）
// ---------------------------------------------------------------------------

export const scorers = computed(() => scorersFor(profile.value?.calibration, uiPrefs.value.strictness));

export async function saveCalibrationBaseline(b: Baseline): Promise<void> {
  await saveProfile({ calibration: { calibratedAt: new Date().toISOString(), baselines: baselineToRecord(b) } });
}

// ---------------------------------------------------------------------------
// レッスンのセッション（再生中のステップ列と、その回の記録）
// ---------------------------------------------------------------------------

export interface LessonSession {
  lessonId: string;
  steps: PlayStep[];
  startedAt: number;
  /** この回に確定したドリルの点数 */
  drillScores: number[];
  /** この回に増えたカウンター */
  counterDelta: Partial<Record<CounterKind, number>>;
  /** この回に保存した絵 */
  drawingIds: string[];
  /** 何かの採点（なぞり等）の点数。レッスンの lastScore に使う */
  otherScores: number[];
}

const sessions = new Map<string, LessonSession>();

/** レッスンのセッションを取る。無ければ作る（ステップ 0 から始めるときだけ復習を差し込む） */
export function getLessonSession(lesson: Lesson, due: readonly DueReview[], startingAt: number): LessonSession {
  const found = sessions.get(lesson.id);
  if (found) return found;
  const s: LessonSession = {
    lessonId: lesson.id,
    steps: buildPlaySteps(lesson, due, startingAt === 0),
    startedAt: Date.now(),
    drillScores: [],
    counterDelta: {},
    drawingIds: [],
    otherScores: [],
  };
  sessions.set(lesson.id, s);
  return s;
}

export function endLessonSession(lessonId: string): void {
  sessions.delete(lessonId);
}

// ---------------------------------------------------------------------------
// 記録
// ---------------------------------------------------------------------------

export async function recordDrillScore(drillType: string, score: number): Promise<void> {
  const next = await recordDrill(drillType, score);
  drillStats.value = [...drillStats.value.filter((d) => d.drillType !== drillType), next];
}

export async function bump(kind: CounterKind, n = 1, session?: LessonSession): Promise<void> {
  if (n <= 0) return;
  counters.value = await bumpCounter(kind, n);
  if (session) session.counterDelta[kind] = (session.counterDelta[kind] ?? 0) + n;
}

/** ストロークから絵を保存する（長辺 1024 の WebP） */
export async function saveStrokes(
  strokes: StrokeDrawing,
  kind: DrawingKind,
  lessonId: string | null,
  session?: LessonSession,
): Promise<Drawing | null> {
  if (strokes.length === 0) return null;
  const tmp = createCanvasEngine();
  tmp.loadStrokes(strokes);
  const image = await tmp.toWebp(1024);
  const d = await saveDrawing({ kind, lessonId, image, strokes });
  session?.drawingIds.push(d.id);
  return d;
}

/** 取込画像を保存する（downscaleToWebp で長辺 1024） */
export async function saveImported(file: Blob, kind: DrawingKind, lessonId: string | null, session?: LessonSession): Promise<Drawing> {
  let image: Blob = file;
  try {
    image = await downscaleToWebp(file, { maxEdge: 1024 });
  } catch {
    // 縮小できない形式はそのまま（critic 側で形式を確認する）
  }
  const d = await saveDrawing({ kind, lessonId, image });
  session?.drawingIds.push(d.id);
  return d;
}

/**
 * 絵に付加情報（模写の差分マーカー等）を足す。既存の meta とはキー単位でマージする。
 * Drawing の正式な `meta` 欄に saveDrawing 経由で書くので、バックアップの往復でも残る。
 */
export async function saveDrawingMeta(drawingId: string, meta: Record<string, unknown>): Promise<void> {
  const d = await getDrawing(drawingId);
  if (!d) return;
  await saveDrawing({ ...d, meta: { ...(d.meta ?? {}), ...meta } });
}

export async function storeCritique(drawingId: string, r: CritiqueResult): Promise<void> {
  await saveCritique({
    drawingId,
    response: {
      good: r.good,
      // pos は「保存した（切り詰め後の）絵の左上原点 0..1」。番号マーカーの位置に使う
      issues: r.issues.map((i) => ({ where: i.where, what: i.what, how: i.fix, ...(i.pos ? { pos: { x: i.pos.x, y: i.pos.y } } : {}) })),
      next_one: r.next_one,
      encourage: r.encourage,
    },
    model: r.model,
    createdAt: r.at,
  });
  critiques.value = await listCritiques();
}

/** 自由お絵描き: 5 分以上ならストリークに数える */
export const FREE_MIN_MS = 5 * 60 * 1000;

export async function recordFreeActivity(elapsedMs: number): Promise<boolean> {
  if (elapsedMs < FREE_MIN_MS) return false;
  streak.value = await recordActivity();
  return true;
}

/** trace / construct の counter を累計へ（trace は 1 回ぶん、construct は count ぶん） */
export async function bumpForStep(step: Step, session?: LessonSession): Promise<void> {
  const b = stepCounterBump(step);
  if (b) await bump(b.kind, b.n, session);
}

// ---------------------------------------------------------------------------
// 途中再開・選択式
// ---------------------------------------------------------------------------

/** 直近の途中保存（完了・飛ばしの前に待つ。順番が入れ替わって lastStep が残らないように） */
let pendingStepSave: Promise<unknown> = Promise.resolve();

function upsertProgress(p: Progress): void {
  progress.value = [...progress.value.filter((x) => x.lessonId !== p.lessonId), p];
}

/** 「次に開くステップ番号」（レッスン本来の番号）を保存する */
export function saveLessonStep(lessonId: string, step: number): Promise<void> {
  const run = pendingStepSave
    .catch(() => undefined)
    .then(() => setLessonStep(lessonId, step))
    .then(upsertProgress);
  pendingStepSave = run;
  return run.catch(() => undefined);
}

/**
 * 選択式のレッスンを飛ばす（完了扱い・skipped）。ストリーク・活動には数えない。
 * 次に開くレッスン（無ければ null）を返す。
 */
export async function skipLesson(lesson: Lesson): Promise<string | null> {
  await pendingStepSave.catch(() => undefined);
  const p = await completeLesson(lesson.id, { skipped: true });
  upsertProgress(p);
  endLessonSession(lesson.id);
  const nx = nextAfterSkip(path.value, completedIds.value, lesson.id);
  return nx ? nx.lesson.id : null;
}

// ---------------------------------------------------------------------------
// レッスン完了
// ---------------------------------------------------------------------------

export interface LessonSummary {
  lessonId: string;
  xp: number;
  streakBefore: number;
  streakAfter: number;
  /** 一番増えたカウンター（無ければ null） */
  counter: { kind: CounterKind; n: number; total: number } | null;
  nextTitle: string | null;
  nextLessonId: string | null;
  graduation: boolean;
  /** 卒業課題の絵（ステージ修了モーダル用） */
  lastDrawingId: string | null;
  elapsedMin: number;
}

export async function finishLesson(lesson: Lesson, session: LessonSession): Promise<LessonSummary> {
  const before = streak.value?.current ?? 0;
  const scored = [...session.drillScores, ...session.otherScores];
  const avg = scored.length > 0 ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : undefined;
  await pendingStepSave.catch(() => undefined);
  await completeLesson(lesson.id, avg !== undefined ? { score: avg } : {});
  const st = await recordActivity();
  if (session.drawingIds.length > 0 && lesson.kind !== 'lesson') {
    await bump('completed', 1, session);
  }
  await reloadData();
  drillStats.value = await listDrillStats();

  const xp =
    xpForEvent(lesson.kind === 'checkpoint' ? 'checkpoint' : lesson.kind === 'graduation' ? 'graduation' : 'lesson') +
    session.drillScores.reduce((a, s) => a + xpForDrillScore(s), 0);

  let counter: LessonSummary['counter'] = null;
  for (const [k, n] of Object.entries(session.counterDelta) as [CounterKind, number][]) {
    if (k === 'completed') continue;
    if (!counter || n > counter.n) counter = { kind: k, n, total: counters.value?.[k] ?? n };
  }

  const nx = nextNode.value;
  const summary: LessonSummary = {
    lessonId: lesson.id,
    xp,
    streakBefore: before,
    streakAfter: st.current,
    counter,
    nextTitle: nx ? nx.lesson.title : null,
    nextLessonId: nx ? nx.lesson.id : null,
    graduation: lesson.kind === 'graduation',
    lastDrawingId: session.drawingIds[session.drawingIds.length - 1] ?? null,
    elapsedMin: Math.max(1, Math.round((Date.now() - session.startedAt) / 60000)),
  };
  endLessonSession(lesson.id);
  return summary;
}
