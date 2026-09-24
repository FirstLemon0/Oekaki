import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from './db';
import {
  bumpCounter,
  completeLesson,
  getCounters,
  getCritique,
  getDrillStats,
  getProfile,
  getSettings,
  getStreak,
  listDrawings,
  listReferences,
  recordActivity,
  recordDrill,
  saveCritique,
  saveDrawing,
  saveReference,
  updateProfile,
  updateSettings,
} from './repo';

/**
 * DB接続は使い回しつつ、全ストアを空にする。
 * fake-indexeddb では `deleteDatabase` が既存接続をブロックして固まりやすいため、
 * テスト間の分離は「接続はそのまま・中身だけ clear」で行う。
 */
async function clearAllStores(): Promise<void> {
  const db = await openDb();
  const storeNames = Array.from(db.objectStoreNames);
  const tx = db.transaction(storeNames, 'readwrite');
  await Promise.all(storeNames.map((name) => tx.objectStore(name).clear()));
  await tx.done;
}

beforeEach(async () => {
  await clearAllStores();
});

function webp(content = 'fake-webp-bytes'): Blob {
  return new Blob([content], { type: 'image/webp' });
}

describe('profile', () => {
  it('未初期化ならデフォルト値、更新すれば反映される', async () => {
    const initial = await getProfile();
    expect(initial.beforeDrawingId).toBeNull();

    const updated = await updateProfile({ beforeDrawingId: 'drawing-1', beforeCreatedAt: '2026-01-01' });
    expect(updated.beforeDrawingId).toBe('drawing-1');

    const fetched = await getProfile();
    expect(fetched.beforeDrawingId).toBe('drawing-1');
    expect(fetched.beforeCreatedAt).toBe('2026-01-01');
  });
});

describe('progress / completeLesson', () => {
  it('初回完了で attempts=1、2回目以降で加算される', async () => {
    const first = await completeLesson('u1-l1', { score: 80 });
    expect(first.attempts).toBe(1);
    expect(first.lastScore).toBe(80);
    expect(first.completedAt).not.toBeNull();

    const second = await completeLesson('u1-l1', { score: 95 });
    expect(second.attempts).toBe(2);
    expect(second.lastScore).toBe(95);
    // 初回完了日時は保持される
    expect(second.completedAt).toBe(first.completedAt);
  });
});

describe('drillStats / recordDrill', () => {
  it('履歴が積み上がり、自己ベストが更新される', async () => {
    await recordDrill('line', 60);
    await recordDrill('line', 90);
    const afterHigh = await getDrillStats('line');
    expect(afterHigh?.history).toHaveLength(2);
    expect(afterHigh?.bestScore).toBe(90);

    await recordDrill('line', 70);
    const afterLow = await getDrillStats('line');
    expect(afterLow?.history).toHaveLength(3);
    // ベストは下がらない
    expect(afterLow?.bestScore).toBe(90);
  });
});

describe('drawings / listDrawings', () => {
  it('保存した絵を index 経由で kind/lessonId 絞り込みできる', async () => {
    await saveDrawing({ kind: 'free', image: webp('free-1'), createdAt: '2026-01-01T00:00:00.000Z' });
    await saveDrawing({
      kind: 'drill',
      lessonId: 'u1-l1',
      image: webp('drill-1'),
      createdAt: '2026-01-02T00:00:00.000Z',
    });
    await saveDrawing({
      kind: 'drill',
      lessonId: 'u1-l1',
      image: webp('drill-2'),
      createdAt: '2026-01-03T00:00:00.000Z',
    });
    await saveDrawing({
      kind: 'lesson',
      lessonId: 'u1-l2',
      image: webp('lesson-1'),
      createdAt: '2026-01-04T00:00:00.000Z',
    });

    const all = await listDrawings();
    expect(all).toHaveLength(4);
    // 新しい順
    expect(all[0]?.createdAt).toBe('2026-01-04T00:00:00.000Z');

    const drills = await listDrawings({ kind: 'drill' });
    expect(drills).toHaveLength(2);
    expect(drills.every((d) => d.kind === 'drill')).toBe(true);

    const forLesson = await listDrawings({ lessonId: 'u1-l1' });
    expect(forLesson).toHaveLength(2);

    const forLessonAndKind = await listDrawings({ lessonId: 'u1-l1', kind: 'drill' });
    expect(forLessonAndKind).toHaveLength(2);

    const limited = await listDrawings({ limit: 1 });
    expect(limited).toHaveLength(1);
    expect(limited[0]?.createdAt).toBe('2026-01-04T00:00:00.000Z');
  });
});

describe('critiques', () => {
  it('保存して drawingId で取得できる', async () => {
    const drawing = await saveDrawing({ kind: 'submit', image: webp() });
    const critique = await saveCritique({
      drawingId: drawing.id,
      model: 'claude-opus-5-5',
      response: {
        good: ['線が伸びやか'],
        issues: [{ where: '目の位置', what: '左右で高さが違う', how: 'アタリ線を引いてから描く' }],
        next_one: '目の位置を揃える練習',
        encourage: 'この調子!',
      },
    });
    const fetched = await getCritique(drawing.id);
    expect(fetched).toEqual(critique);
  });
});

describe('streak / recordActivity', () => {
  it('連続活動で current が伸びる', async () => {
    await recordActivity('2026-01-01');
    const s1 = await getStreak();
    expect(s1.current).toBe(1);

    await recordActivity('2026-01-02');
    const s2 = await getStreak();
    expect(s2.current).toBe(2);
  });
});

describe('counters / bumpCounter', () => {
  it('加算され、他のカウンターに影響しない', async () => {
    await bumpCounter('line', 3);
    await bumpCounter('circle', 1);
    const c = await getCounters();
    expect(c.line).toBe(3);
    expect(c.circle).toBe(1);
    expect(c.box).toBe(0);
  });
});

describe('settings', () => {
  it('デフォルト値があり、部分更新できる', async () => {
    const defaults = await getSettings();
    expect(defaults.dailyCritiqueLimit).toBe(3);

    const updated = await updateSettings({ apiKey: 'sk-xxx', dailyCritiqueLimit: 5 });
    expect(updated.apiKey).toBe('sk-xxx');
    expect(updated.dailyCritiqueLimit).toBe(5);
    // 更新していないフィールドは維持される
    expect(updated.modelId).toBe(defaults.modelId);
  });
});

describe('references', () => {
  it('保存して一覧できる', async () => {
    await saveReference({ image: webp('ref-1'), label: 'お気に入りの絵1' });
    await saveReference({ image: webp('ref-2') });
    const list = await listReferences();
    expect(list).toHaveLength(2);
  });
});
