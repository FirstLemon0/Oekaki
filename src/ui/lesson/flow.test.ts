/**
 * レッスン進行（選択式の飛ばし・途中再開・累計）のテスト。
 * 純ロジック（steps.ts）と、IndexedDB（fake-indexeddb）越しの記録（stateBridge.ts）の両方を見る。
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { flattenPath, loadCurriculum } from '@/content';
import type { ConstructStep, Lesson, TraceStep } from '@/content/schema';
import { openDb } from '@/data/db';
import { getCounters, getDrawing, getProgress, listProgress, saveDrawing } from '@/data/repo';
import { exportBackup, importBackup } from '@/data/backup';
import { counters, curriculum, progress } from '../state';
import {
  buildPlaySteps,
  isSkippable,
  lessonStepIndex,
  nextAfterSkip,
  resumeStepOf,
  stepCounterBump,
  warmupCount,
} from './steps';
import { markerPlacement } from './critiqueMarkers';
import { bumpForStep, getLessonSession, endLessonSession, saveDrawingMeta, saveLessonStep, skipLesson } from './stateBridge';

const cur = loadCurriculum();
const path = flattenPath(cur);
const node = (id: string) => path.find((n) => n.lesson.id === id)!;

async function clearAllStores(): Promise<void> {
  const db = await openDb();
  const names = Array.from(db.objectStoreNames);
  const tx = db.transaction(names, 'readwrite');
  await Promise.all(names.map((n) => tx.objectStore(n).clear()));
  await tx.done;
}

beforeEach(async () => {
  await clearAllStores();
  curriculum.value = cur;
  progress.value = [];
  counters.value = null;
});

// ---------------------------------------------------------------------------
// 純ロジック
// ---------------------------------------------------------------------------

describe('累計への加算量', () => {
  const trace: TraceStep = { type: 'trace', template: 'cube-2pt', instruction: 'x', count: 3, counter: 'boxes' };
  const construct: ConstructStep = { type: 'construct', instruction: 'x', stages: [{ title: 'a', instruction: 'b' }], counter: 'boxes', count: 5 };

  it('trace は 1 回ごとに 1、construct は count ぶん（既定 1）', () => {
    expect(stepCounterBump(trace)).toEqual({ kind: 'box', n: 1 });
    expect(stepCounterBump(construct)).toEqual({ kind: 'box', n: 5 });
    expect(stepCounterBump({ ...construct, count: undefined })).toEqual({ kind: 'box', n: 1 });
    expect(stepCounterBump({ ...construct, counter: 'circles' })).toEqual({ kind: 'circle', n: 5 });
  });

  it('counter が無い・対象外の型は null', () => {
    expect(stepCounterBump({ ...trace, counter: undefined })).toBeNull();
    expect(stepCounterBump({ type: 'read', title: 't', body: 'b' })).toBeNull();
    expect(stepCounterBump({ type: 'drill', drill: 'line', count: 3, instruction: 'x', counter: 'lines' })).toBeNull();
  });

  it('実教材: s2-u2-l3 は なぞり 2 回＋構築 5 個', () => {
    const steps = node('s2-u2-l3').lesson.steps;
    expect(stepCounterBump(steps[1]!)).toEqual({ kind: 'box', n: 1 });
    expect((steps[1] as TraceStep).count).toBe(2);
    expect(stepCounterBump(steps[2]!)).toEqual({ kind: 'box', n: 5 });
  });
});

describe('途中再開の番号', () => {
  const lesson = node('s1-u1-l1').lesson;

  it('復習を差し込んだぶんを引いて、レッスン本来の番号にする', () => {
    const withWarmup = buildPlaySteps(lesson, [{ drillType: 'line', reasons: ['stale'], recentAverage: 50, bestScore: 80, daysSinceLast: 20 }]);
    expect(warmupCount(withWarmup)).toBe(1);
    expect(lessonStepIndex(withWarmup, 0)).toBe(0);
    expect(lessonStepIndex(withWarmup, 1)).toBe(0);
    expect(lessonStepIndex(withWarmup, 3)).toBe(2);
    const plain = buildPlaySteps(lesson, []);
    expect(warmupCount(plain)).toBe(0);
    expect(lessonStepIndex(plain, 3)).toBe(3);
  });

  it('続きからを出すのは 1..(総数-1) のときだけ', () => {
    expect(resumeStepOf(undefined, 5)).toBeNull();
    expect(resumeStepOf({ lastStep: null }, 5)).toBeNull();
    expect(resumeStepOf({}, 5)).toBeNull();
    expect(resumeStepOf({ lastStep: 0 }, 5)).toBeNull();
    expect(resumeStepOf({ lastStep: 3 }, 5)).toBe(3);
    expect(resumeStepOf({ lastStep: 5 }, 5)).toBeNull();
    expect(resumeStepOf({ lastStep: 1.5 }, 5)).toBeNull();
  });
});

describe('選択式', () => {
  it('U10-2 だけが飛ばせる', () => {
    expect(isSkippable(node('s10-u2-l1').lesson)).toBe(true);
    expect(isSkippable(node('s10-u1-l1').lesson)).toBe(false);
    expect(isSkippable(node('s10-u4-l1').lesson)).toBe(false);
  });

  it('飛ばしたあとは、パス上で未完了の最初へ（飛ばしたもの自身は除く）', () => {
    const done = new Set(path.slice(0, path.findIndex((n) => n.lesson.id === 's10-u2-l1')).map((n) => n.lesson.id));
    expect(nextAfterSkip(path, done, 's10-u2-l1')?.lesson.id).toBe('s10-u2-l2');
    // 飛ばしたもの自身が completedIds に入っていても同じ
    expect(nextAfterSkip(path, new Set([...done, 's10-u2-l1']), 's10-u2-l1')?.lesson.id).toBe('s10-u2-l2');
    // 手前に未完了が残っていても、飛ばしたものの後ろを優先する
    expect(nextAfterSkip(path, new Set(), 's10-u2-l1')?.lesson.id).toBe('s10-u2-l2');
    // 後ろが全部終わっていれば、前に残っている未完了へ
    const allButFirst = new Set(path.slice(1).map((n) => n.lesson.id));
    expect(nextAfterSkip(path, allButFirst, 's10-u2-l9')?.lesson.id).toBe(path[0]!.lesson.id);
    // 全部終わっていれば undefined
    expect(nextAfterSkip(path, new Set(path.map((n) => n.lesson.id)), 's10-u2-l9')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 記録（IndexedDB）
// ---------------------------------------------------------------------------

describe('飛ばす（記録）', () => {
  it('completeLesson(skipped) で完了扱いになり、途中の記録は消え、次のレッスンを返す', async () => {
    // U10-2-l1 の手前まで完了済みにしておく
    progress.value = path
      .slice(0, path.findIndex((n) => n.lesson.id === 's10-u2-l1'))
      .map((n) => ({ lessonId: n.lesson.id, completedAt: '2026-01-01T00:00:00.000Z', attempts: 1, lastScore: null, updatedAt: '2026-01-01T00:00:00.000Z' }));
    await saveLessonStep('s10-u2-l1', 2);

    const nextId = await skipLesson(node('s10-u2-l1').lesson);
    expect(nextId).toBe('s10-u2-l2');

    const p = await getProgress('s10-u2-l1');
    expect(p?.skipped).toBe(true);
    expect(p?.completedAt).not.toBeNull();
    expect(p?.lastStep).toBeNull();
    // signals にも反映（ホームの次のレッスンが進む）
    expect(progress.value.find((x) => x.lessonId === 's10-u2-l1')?.skipped).toBe(true);
  });

  it('飛ばしたレッスンも、あとで取り組めば skipped が外れる', async () => {
    const { completeLesson } = await import('@/data/repo');
    await skipLesson(node('s10-u2-l4').lesson);
    await completeLesson('s10-u2-l4', {});
    const p = await getProgress('s10-u2-l4');
    expect(p?.skipped).toBe(false);
    expect(p?.attempts).toBe(2);
  });
});

describe('途中再開（記録）', () => {
  it('ステップを進めるたびに lastStep が更新され、最後の値が残る（順番どおり）', async () => {
    const id = 's10-u4-l1';
    const saves = [1, 2, 3, 4].map((k) => saveLessonStep(id, k));
    await Promise.all(saves);
    expect((await getProgress(id))?.lastStep).toBe(4);
    expect(progress.value.find((p) => p.lessonId === id)?.lastStep).toBe(4);
    // 完了扱いにはならない
    expect((await getProgress(id))?.completedAt).toBeNull();
    expect(resumeStepOf(await getProgress(id), node(id).lesson.steps.length)).toBe(4);
  });

  it('複数日にまたがる最終課題: 別の日に開き直しても続きから（記録は DB に残る）', async () => {
    const id = 's10-u4-l1';
    const lesson: Lesson = node(id).lesson;
    // 1 日目: 提出 1 回目（ステップ 2）を終えて、ステップ 3 で閉じた
    await saveLessonStep(id, 3);
    endLessonSession(id);
    // 2 日目: アプリを開き直した（signals は DB から読み直す）
    progress.value = await listProgress();
    const k = resumeStepOf(progress.value.find((p) => p.lessonId === id), lesson.steps.length);
    expect(k).toBe(3);
    // 続きから開くセッションには復習を差し込まない（保存した番号＝再生の番号）
    const session = getLessonSession(lesson, [{ drillType: 'line', reasons: ['stale'], recentAverage: 50, bestScore: 80, daysSinceLast: 20 }], k!);
    expect(warmupCount(session.steps)).toBe(0);
    expect(session.steps[k!]!.step).toBe(lesson.steps[k!]);
    endLessonSession(id);
  });
});

describe('累計（記録）', () => {
  it('construct の count ぶん・trace は 1 回ぶん box が増え、セッションにも載る', async () => {
    const lesson = node('s2-u2-l3').lesson;
    const session = getLessonSession(lesson, [], 0);
    await bumpForStep(lesson.steps[1]!, session); // なぞり 1 回目
    await bumpForStep(lesson.steps[1]!, session); // なぞり 2 回目
    await bumpForStep(lesson.steps[2]!, session); // 構築 5 個
    expect((await getCounters()).box).toBe(7);
    expect(counters.value?.box).toBe(7);
    expect(session.counterDelta.box).toBe(7);
    // counter の無いステップは何もしない
    await bumpForStep(lesson.steps[0]!, session);
    expect((await getCounters()).box).toBe(7);
    endLessonSession(lesson.id);
  });
});

describe('模写マーク（Drawing.meta）', () => {
  it('saveDrawingMeta は正式な meta 欄にマージして保存し、バックアップの往復でも残る', async () => {
    const d = await saveDrawing({ kind: 'lesson', lessonId: 's1-u5-l2', image: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }) });
    await saveDrawingMeta(d.id, { moshaMarks: [{ x: 0.25, y: 0.5 }], reference: 'cup-lineart' });
    await saveDrawingMeta(d.id, { note: 'extra' });
    const got = await getDrawing(d.id);
    expect(got?.meta).toEqual({ moshaMarks: [{ x: 0.25, y: 0.5 }], reference: 'cup-lineart', note: 'extra' });
    expect(got?.createdAt).toBe(d.createdAt);

    const zip = await exportBackup();
    await clearAllStores();
    await importBackup(zip, 'replace');
    expect((await getDrawing(d.id))?.meta).toEqual({ moshaMarks: [{ x: 0.25, y: 0.5 }], reference: 'cup-lineart', note: 'extra' });
  });
});

describe('批評の番号マーカー', () => {
  it('pos があれば絵の上（0..1 に丸める）、無い・壊れていれば右上に並べる（null）', () => {
    expect(markerPlacement({ x: 0.3, y: 0.7 })).toEqual({ x: 0.3, y: 0.7 });
    expect(markerPlacement({ x: -0.2, y: 1.4 })).toEqual({ x: 0, y: 1 });
    expect(markerPlacement(undefined)).toBeNull();
    expect(markerPlacement({ x: Number.NaN, y: 0.5 })).toBeNull();
  });
});
