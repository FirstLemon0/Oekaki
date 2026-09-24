import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { BACKUP_VERSION, exportBackup, importBackup } from './backup';
import { openDb, SINGLETON_KEY } from './db';
import {
  bumpCounter,
  completeLesson,
  recordActivity,
  recordDrill,
  saveCritique,
  saveDrawing,
  saveReference,
  setLessonStep,
  updateProfile,
  updateSettings,
} from './repo';
import type { Drawing, ReferenceImage } from './types';

/**
 * DB接続は使い回しつつ、全ストアを空にする。
 * fake-indexeddb では `deleteDatabase` が既存接続をブロックして固まりやすいため、
 * テスト間・テスト内の分離は「接続はそのまま・中身だけ clear」で行う。
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

function webp(content: string): Blob {
  return new Blob([content], { type: 'image/webp' });
}

async function seed(): Promise<void> {
  await updateProfile({
    beforeDrawingId: 'drawing-before',
    beforeCreatedAt: '2026-01-01',
    calibration: { calibratedAt: '2026-01-01T00:00:00.000Z', baselines: { line: 40 } },
  });
  await completeLesson('u1-l1', { score: 80 });
  await completeLesson('u1-l2', { skipped: true });
  await setLessonStep('u1-l3', 2);
  await recordDrill('line', 60);
  await recordDrill('line', 90);
  await recordActivity('2026-01-01');
  await recordActivity('2026-01-02');
  await bumpCounter('line', 5);
  await updateSettings({ apiKey: 'sk-test', dailyCritiqueLimit: 2 });

  await saveDrawing({
    id: 'drawing-a',
    kind: 'drill',
    lessonId: 'u1-l1',
    image: webp('drawing-a-bytes'),
    strokes: [[{ x: 0, y: 0, p: 0.5, t: 0 }, { x: 1, y: 1, p: 0.6, t: 10 }]],
    meta: { marks: [{ x: 0.2, y: 0.4 }], note: '模写チェック' },
  });
  const drawingWithoutStrokes = await saveDrawing({
    id: 'drawing-before',
    kind: 'before',
    image: webp('drawing-before-bytes'),
  });

  await saveCritique({
    drawingId: drawingWithoutStrokes.id,
    model: 'claude-opus-5-5',
    response: {
      good: ['伸びやかな線'],
      issues: [
        { where: '輪郭', what: 'ゆがみがある', how: 'アタリを先に取る', pos: { x: 0.3, y: 0.6 } },
        { where: '全体', what: '線が薄い', how: '筆圧を上げる' },
      ],
      next_one: '円のドリルを増やす',
      encourage: 'よくがんばりました',
    },
  });

  await saveReference({ id: 'ref-a', image: webp('ref-a-bytes'), label: 'お気に入り' });
}

async function blobText(blob: Blob): Promise<string> {
  return blob.text();
}

describe('backup export/import(replace)', () => {
  it('往復しても全ストアの内容が一致する', async () => {
    await seed();

    const bytes = await exportBackup();

    // インポート前の状態を保存しておく（比較対象）
    const dbBefore = await openDb();
    const [
      profileBefore,
      progressBefore,
      drillStatsBefore,
      drawingsBefore,
      critiquesBefore,
      streakBefore,
      countersBefore,
      settingsBefore,
      referencesBefore,
    ] = await Promise.all([
      dbBefore.get('profile', SINGLETON_KEY),
      dbBefore.getAll('progress'),
      dbBefore.getAll('drillStats'),
      dbBefore.getAll('drawings'),
      dbBefore.getAll('critiques'),
      dbBefore.get('streak', SINGLETON_KEY),
      dbBefore.get('counters', SINGLETON_KEY),
      dbBefore.get('settings', SINGLETON_KEY),
      dbBefore.getAll('references'),
    ]);

    // DBを空にしてから復元する
    await clearAllStores();
    await importBackup(bytes, 'replace');

    const dbAfter = await openDb();
    const [
      profileAfter,
      progressAfter,
      drillStatsAfter,
      drawingsAfter,
      critiquesAfter,
      streakAfter,
      countersAfter,
      settingsAfter,
      referencesAfter,
    ] = await Promise.all([
      dbAfter.get('profile', SINGLETON_KEY),
      dbAfter.getAll('progress'),
      dbAfter.getAll('drillStats'),
      dbAfter.getAll('drawings'),
      dbAfter.getAll('critiques'),
      dbAfter.get('streak', SINGLETON_KEY),
      dbAfter.get('counters', SINGLETON_KEY),
      dbAfter.get('settings', SINGLETON_KEY),
      dbAfter.getAll('references'),
    ]);

    expect(profileAfter).toEqual(profileBefore);
    expect(progressAfter).toEqual(progressBefore);
    expect(drillStatsAfter).toEqual(drillStatsBefore);
    expect(critiquesAfter).toEqual(critiquesBefore);
    expect(streakAfter).toEqual(streakBefore);
    expect(countersAfter).toEqual(countersBefore);
    expect(settingsAfter).toEqual(settingsBefore);

    // drawings / references は Blob を含むので、メタデータと画像内容を分けて比較
    const compareWithImages = async <T extends { id: string; image: Blob }>(
      before: T[],
      after: T[],
    ): Promise<void> => {
      expect(after.map((x) => x.id).sort()).toEqual(before.map((x) => x.id).sort());
      for (const b of before) {
        const a = after.find((x) => x.id === b.id);
        expect(a).toBeDefined();
        if (!a) continue;
        const { image: bImage, ...bMeta } = b;
        const { image: aImage, ...aMeta } = a;
        expect(aMeta).toEqual(bMeta);
        expect(await blobText(aImage)).toBe(await blobText(bImage));
      }
    };

    await compareWithImages<Drawing>(drawingsBefore, drawingsAfter);
    await compareWithImages<ReferenceImage>(referencesBefore, referencesAfter);

    // 後から追加した任意項目が往復で失われていないこと（toEqual だけだと両方欠落でも通るので明示）
    const byLesson = new Map(progressAfter.map((p) => [p.lessonId, p]));
    expect(byLesson.get('u1-l1')).toMatchObject({ skipped: false, lastStep: null });
    expect(byLesson.get('u1-l2')).toMatchObject({ skipped: true, lastStep: null });
    expect(byLesson.get('u1-l3')).toMatchObject({ completedAt: null, lastStep: 2 });
    expect(drawingsAfter.find((d) => d.id === 'drawing-a')?.meta).toEqual({
      marks: [{ x: 0.2, y: 0.4 }],
      note: '模写チェック',
    });
    expect(drawingsAfter.find((d) => d.id === 'drawing-before')).not.toHaveProperty('meta');
    const issues = critiquesAfter[0]!.response.issues;
    expect(issues[0]!.pos).toEqual({ x: 0.3, y: 0.6 });
    expect(issues[1]).not.toHaveProperty('pos');
  });
});

describe('backup import(旧形式)', () => {
  it('skipped / lastStep / meta / pos・新しい設定項目が無い zip も読める', async () => {
    const T = '2026-01-01T00:00:00.000Z';
    const json = (v: unknown) => strToU8(JSON.stringify(v));
    const bytes = zipSync({
      'manifest.json': json({ version: BACKUP_VERSION, exportedAt: T }),
      'data/profile.json': json({
        startedAt: '2026-01-01',
        beforeDrawingId: null,
        beforeCreatedAt: null,
        afterDrawingId: null,
        calibration: null,
        lastMonthlyPromptAt: null,
        updatedAt: T,
      }),
      'data/progress.json': json([{ lessonId: 'u1-l1', completedAt: T, attempts: 1, lastScore: 70, updatedAt: T }]),
      'data/drillStats.json': json([]),
      'data/drawings.json': json([
        { id: 'd-old', lessonId: 'u1-l1', kind: 'lesson', createdAt: T, strokes: null, updatedAt: T },
      ]),
      'data/critiques.json': json([
        {
          drawingId: 'd-old',
          response: { good: ['a'], issues: [{ where: 'w', what: 'x', how: 'y' }], next_one: 'n', encourage: 'e' },
          model: 'claude-opus-5',
          createdAt: T,
          updatedAt: T,
        },
      ]),
      'data/streak.json': json({ current: 2, longest: 2, freezes: 0, lastActiveDay: '2026-01-01', nextFreezeAt: 7, updatedAt: T }),
      'data/counters.json': json({ line: 1, ellipse: 0, circle: 0, box: 0, gesture: 0, completed: 0, updatedAt: T }),
      'data/settings.json': json({
        apiKey: null,
        modelId: 'claude-opus-5',
        effort: 'high',
        dailyCritiqueLimit: 3,
        externalAppName: null,
        theme: 'system',
        updatedAt: T,
      }),
      'data/references.json': json([]),
      'images/drawing/d-old.webp': strToU8('old-image'),
    });

    await importBackup(bytes, 'replace');

    const db = await openDb();
    const progress = await db.get('progress', 'u1-l1');
    expect(progress).toMatchObject({ lessonId: 'u1-l1', attempts: 1, lastScore: 70 });
    expect(progress?.skipped).toBeUndefined();
    expect(progress?.lastStep).toBeUndefined();
    const drawing = await db.get('drawings', 'd-old');
    expect(drawing?.meta).toBeUndefined();
    expect(await blobText(drawing!.image)).toBe('old-image');
    const critique = await db.get('critiques', 'd-old');
    expect(critique?.response.issues[0]).toEqual({ where: 'w', what: 'x', how: 'y' });
    const settings = await db.get('settings', SINGLETON_KEY);
    expect(settings).toMatchObject({ penOnly: true, strictness: 'normal', lastBackupAt: null });
  });
});

describe('backup import(merge)', () => {
  it('id が衝突したら updatedAt が新しい方を採用する', async () => {
    // 既存: 古いドリル記録
    const old = await recordDrill('line', 50);
    expect(old.updatedAt).toBeTruthy();

    const bytesWithOnlyOldState = await exportBackup();

    // その後アプリ側でさらに新しい記録を追加（updatedAt が進む）
    await new Promise((r) => setTimeout(r, 2));
    await recordDrill('line', 95);

    // 古い状態のバックアップを merge で読み込んでも、新しい方（現在のDB）が勝つ
    await importBackup(bytesWithOnlyOldState, 'merge');

    const db = await openDb();
    const merged = await db.get('drillStats', 'line');
    expect(merged?.history.map((h) => h.score)).toEqual([50, 95]);
  });

  it('バックアップ側が新しければバックアップの内容が勝つ', async () => {
    await updateSettings({ apiKey: 'old-key' });
    await new Promise((r) => setTimeout(r, 2));
    const bytesNewer = await exportBackup();

    // DB側をさらに古い状態相当に戻すことはできないので、
    // 代わりにDBを空にしてから import merge することで「バックアップのみが存在」を再現する
    await clearAllStores();
    await importBackup(bytesNewer, 'merge');

    const db = await openDb();
    const settings = await db.get('settings', SINGLETON_KEY);
    expect(settings?.apiKey).toBe('old-key');
  });
});
