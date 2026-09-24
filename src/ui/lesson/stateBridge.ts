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
} from '@/data/repo';
import { openDb } from '@/data/db';
import { downscaleToWebp } from '@/data/images';
import { xpForDrillScore, xpForEvent } from '@/data/xp';
import type { CounterKind, Drawing, DrawingKind, StrokeDrawing } from '@/data/types';
import type { CritiqueResult } from '@/critic';
import { createCanvasEngine } from '@/canvas';
import type { Lesson } from '@/content/schema';
import { counters, critiques, drillStats, nextNode, profile, reloadData, saveProfile, streak, uiPrefs } from '../state';
import { baselineToRecord, scorersFor } from './limits';
import type { Baseline } from '@/scoring';
import { buildPlaySteps, type PlayStep } from './steps';
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
 * 絵に付加情報（模写の差分マーカー等）を足す。
 * data/types の Drawing に meta 欄は無いので、レコードに `meta` を追加して put する
 * （IndexedDB には残る。backup の zod は未知キーを落とすので往復では消える）。
 */
export async function saveDrawingMeta(drawingId: string, meta: Record<string, unknown>): Promise<void> {
  const d = await getDrawing(drawingId);
  if (!d) return;
  const db = await openDb();
  const withMeta = { ...d, meta, updatedAt: new Date().toISOString() } as Drawing & { meta: Record<string, unknown> };
  await db.put('drawings', withMeta);
}

export async function storeCritique(drawingId: string, r: CritiqueResult): Promise<void> {
  await saveCritique({
    drawingId,
    response: {
      good: r.good,
      issues: r.issues.map((i) => ({ where: i.where, what: i.what, how: i.fix })),
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
