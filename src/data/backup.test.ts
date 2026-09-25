import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { BACKUP_VERSION, exportBackup, exportBackupBlob, importBackup } from './backup';
import { sniffImageType } from './images';
import { todayLocalDate } from './date';
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
  getSettings,
  recordCritiqueAttempt,
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
    // API キーは zip に入らないので、空の端末に復元すると null になる（それ以外は一致）
    expect(settingsBefore?.apiKey).toBe('sk-test');
    expect(settingsAfter).toEqual({ ...settingsBefore, apiKey: null });

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
    await updateSettings({ dailyCritiqueLimit: 7 });
    await new Promise((r) => setTimeout(r, 2));
    const bytesNewer = await exportBackup();

    // DB側をさらに古い状態相当に戻すことはできないので、
    // 代わりにDBを空にしてから import merge することで「バックアップのみが存在」を再現する
    await clearAllStores();
    await importBackup(bytesNewer, 'merge');

    const db = await openDb();
    const settings = await db.get('settings', SINGLETON_KEY);
    expect(settings?.dailyCritiqueLimit).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// API キー・lastBackupAt・試行回数
// ---------------------------------------------------------------------------

/** zip の JSON を書き換えた zip を作る（テスト用） */
function patchZipJson(bytes: Uint8Array, path: string, patch: Record<string, unknown>): Uint8Array {
  const files = unzipSync(bytes);
  const v = JSON.parse(strFromU8(files[path]!)) as Record<string, unknown>;
  files[path] = strToU8(JSON.stringify({ ...v, ...patch }));
  return zipSync(files);
}

describe('backup: API キーは zip に入れず、読み込みでは端末側を残す', () => {
  it('書き出した settings.json の apiKey は null', async () => {
    await updateSettings({ apiKey: 'sk-secret' });
    const files = unzipSync(await exportBackup());
    const settings = JSON.parse(strFromU8(files['data/settings.json']!)) as { apiKey: unknown };
    expect(settings.apiKey).toBeNull();
    expect(strFromU8(files['data/settings.json']!)).not.toContain('sk-secret');
  });

  it('replace: zip に（旧形式で）キーが入っていても、端末側のキーを残す', async () => {
    const zip = patchZipJson(await exportBackup(), 'data/settings.json', { apiKey: 'sk-from-zip' });
    await updateSettings({ apiKey: 'sk-device' });
    await importBackup(zip, 'replace');
    expect((await getSettings()).apiKey).toBe('sk-device');
  });

  it('replace: 端末にキーが無ければ null（zip のキーは使わない）', async () => {
    const zip = patchZipJson(await exportBackup(), 'data/settings.json', { apiKey: 'sk-from-zip' });
    await clearAllStores();
    await importBackup(zip, 'replace');
    expect((await getSettings()).apiKey).toBeNull();
  });

  it('merge: zip 側の設定が新しくても、端末側のキーを残す', async () => {
    await updateSettings({ apiKey: 'sk-device', dailyCritiqueLimit: 1 });
    const zip = patchZipJson(await exportBackup(), 'data/settings.json', {
      apiKey: 'sk-from-zip',
      dailyCritiqueLimit: 9,
      updatedAt: '2999-01-01T00:00:00.000Z',
    });
    await importBackup(zip, 'merge');
    const s = await getSettings();
    expect(s.dailyCritiqueLimit).toBe(9);
    expect(s.apiKey).toBe('sk-device');
  });
});

describe('backup: lastBackupAt', () => {
  it('端末側の方が新しければ端末側を残す（replace / merge）', async () => {
    for (const mode of ['replace', 'merge'] as const) {
      await clearAllStores();
      await updateSettings({ lastBackupAt: '2026-01-01T00:00:00.000Z' });
      const zip = await exportBackup();
      await updateSettings({ lastBackupAt: '2026-02-01T00:00:00.000Z' });
      await importBackup(patchZipJson(zip, 'data/settings.json', { updatedAt: '2999-01-01T00:00:00.000Z' }), mode);
      expect((await getSettings()).lastBackupAt).toBe('2026-02-01T00:00:00.000Z');
    }
  });

  it('zip 側の方が新しければ zip 側', async () => {
    await updateSettings({ lastBackupAt: '2026-03-01T00:00:00.000Z' });
    const zip = await exportBackup();
    await updateSettings({ lastBackupAt: '2026-01-01T00:00:00.000Z' });
    await importBackup(zip, 'replace');
    expect((await getSettings()).lastBackupAt).toBe('2026-03-01T00:00:00.000Z');
  });
});

describe('backup: AI 批評の試行回数', () => {
  it('往復で残り、読み込みでは日ごとに多い方を残す', async () => {
    const day = todayLocalDate();
    await recordCritiqueAttempt(day);
    const zip = await exportBackup(); // 今日 1 回
    await recordCritiqueAttempt(day);
    await recordCritiqueAttempt(day); // 端末は今日 3 回
    await importBackup(zip, 'replace');
    const db = await openDb();
    expect((await db.get('profile', SINGLETON_KEY))?.critiqueAttemptsByDay[day]).toBe(3);

    await clearAllStores();
    await importBackup(zip, 'replace');
    expect((await db.get('profile', SINGLETON_KEY))?.critiqueAttemptsByDay[day]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 画像の型
// ---------------------------------------------------------------------------

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
const WEBP_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 8, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 9, 9]);

describe('sniffImageType', () => {
  it('先頭バイトで判定する', () => {
    expect(sniffImageType(PNG_BYTES)).toBe('image/png');
    expect(sniffImageType(WEBP_BYTES)).toBe('image/webp');
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(strToU8('GIF89a...'))).toBe('image/gif');
    expect(sniffImageType(strToU8('RIFF....WAVE'))).toBeNull();
    expect(sniffImageType(new Uint8Array([0x89, 0x50]))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe('backup: 画像の型', () => {
  it('PNG にフォールバックした絵は .png で書き出し、image/png で戻す（type が webp と誤っていても）', async () => {
    await saveDrawing({ id: 'png-1', kind: 'free', image: new Blob([PNG_BYTES], { type: 'image/webp' }) });
    await saveDrawing({ id: 'webp-1', kind: 'free', image: new Blob([WEBP_BYTES], { type: 'image/webp' }) });
    const zip = await exportBackup();
    const names = Object.keys(unzipSync(zip));
    expect(names).toContain('images/drawing/png-1.png');
    expect(names).toContain('images/drawing/webp-1.webp');

    await clearAllStores();
    await importBackup(zip, 'replace');
    const db = await openDb();
    const png = await db.get('drawings', 'png-1');
    const webpImg = await db.get('drawings', 'webp-1');
    expect(png?.image.type).toBe('image/png');
    expect(new Uint8Array(await png!.image.arrayBuffer())).toEqual(PNG_BYTES);
    expect(webpImg?.image.type).toBe('image/webp');
    expect(new Uint8Array(await webpImg!.image.arrayBuffer())).toEqual(WEBP_BYTES);
  });

  it('旧 zip（PNG の中身でも .webp 名・deflate 圧縮）も読め、型は中身で決める', async () => {
    await saveDrawing({ id: 'old-png', kind: 'free', image: new Blob([PNG_BYTES], { type: 'image/png' }) });
    await saveReference({ id: 'old-ref', image: new Blob([WEBP_BYTES], { type: 'image/webp' }) });
    const files = unzipSync(await exportBackup());
    const legacy: Record<string, Uint8Array> = {};
    for (const [name, data] of Object.entries(files)) {
      legacy[name.replace(/\.(png|webp)$/, '.webp')] = data; // 旧形式は全部 .webp
    }
    expect(Object.keys(legacy)).toContain('images/drawing/old-png.webp');
    const zip = zipSync(legacy); // 旧形式と同じく全エントリ deflate

    await clearAllStores();
    await importBackup(zip, 'replace');
    const db = await openDb();
    const d = await db.get('drawings', 'old-png');
    expect(d?.image.type).toBe('image/png');
    expect(new Uint8Array(await d!.image.arrayBuffer())).toEqual(PNG_BYTES);
    expect((await db.get('references', 'old-ref'))?.image.type).toBe('image/webp');
  });
});

// ---------------------------------------------------------------------------
// ストリーミング（多数の画像）
// ---------------------------------------------------------------------------

describe('backup: 多数の画像を往復できる', () => {
  it('200 枚の小画像を Blob で書き出し、Blob（File 相当）から読み戻せる', async () => {
    const N = 200;
    const imgBytes = (i: number) => {
      const b = new Uint8Array(64 + (i % 17));
      b.set(i % 2 === 0 ? WEBP_BYTES : PNG_BYTES);
      for (let k = 16; k < b.length; k++) b[k] = (i * 31 + k) & 0xff;
      return b;
    };
    for (let i = 0; i < N; i++) {
      await saveDrawing({ id: `d-${i}`, kind: 'drill', image: new Blob([imgBytes(i)], { type: 'image/webp' }) });
    }
    for (let i = 0; i < 5; i++) {
      await saveReference({ id: `r-${i}`, image: new Blob([imgBytes(i + 1)], { type: 'image/png' }) });
    }

    const zipBlob = await exportBackupBlob();
    expect(zipBlob.type).toBe('application/zip');
    // 一般的な zip としても読める（中央ディレクトリ・データディスクリプタが正しい）
    const names = Object.keys(unzipSync(new Uint8Array(await zipBlob.arrayBuffer())));
    expect(names.filter((n) => n.startsWith('images/drawing/'))).toHaveLength(N);

    await clearAllStores();
    await importBackup(zipBlob, 'replace');

    const db = await openDb();
    const drawings = await db.getAll('drawings');
    expect(drawings).toHaveLength(N);
    for (let i = 0; i < N; i++) {
      const d = drawings.find((x) => x.id === `d-${i}`)!;
      expect(d.image.type).toBe(i % 2 === 0 ? 'image/webp' : 'image/png');
      expect(new Uint8Array(await d.image.arrayBuffer())).toEqual(imgBytes(i));
    }
    expect(await db.getAll('references')).toHaveLength(5);
  });

  it('zip でないものは分かる言葉で失敗する', async () => {
    await expect(importBackup(strToU8('not a zip at all, definitely not'), 'replace')).rejects.toThrow(/zip/);
  });
});

describe('backup: お絵描き v2 の文書（meta.doc）', () => {
  it('レイヤー・塗りつぶし・変形を含む文書が往復で保たれる', async () => {
    const doc = {
      v: 2,
      width: 1200,
      height: 800,
      layers: [
        { id: 'L1', name: 'レイヤー 1', visible: true, opacity: 1, locked: false, blend: 'normal' },
        { id: 'L2', name: '清書', visible: false, opacity: 0.55, locked: true, blend: 'multiply' },
      ],
      active: 'L2',
      ops: [
        {
          kind: 'stroke',
          layer: 'L1',
          points: [
            { x: 10, y: 20, p: 0.5, t: 0 },
            { x: 30.5, y: 40.25, p: 0.7, t: 16 },
          ],
          style: { preset: 'pen', size: 3, opacity: 1, color: '#c8553d' },
        },
        { kind: 'layer-add', layer: { id: 'L2', name: '清書', visible: true, opacity: 1, locked: false, blend: 'normal' }, index: 1 },
        { kind: 'fill', layer: 'L2', x: 100, y: 120, color: '#7bb661', tolerance: 32, reference: 'all' },
        {
          kind: 'transform',
          layer: 'L2',
          mask: { kind: 'lasso', points: [{ x: 1, y: 2 }, { x: 50, y: 2 }, { x: 25, y: 60 }] },
          matrix: [-1, 0, 0, 1, 80, 0],
        },
        { kind: 'layer-set', layer: 'L2', patch: { opacity: 0.55, blend: 'multiply', visible: false, locked: true } },
      ],
    };
    const style = { preset: 'pen', size: 3, opacity: 1, color: '#c8553d' };
    const saved = await saveDrawing({
      kind: 'free',
      lessonId: null,
      image: webp('doc-image'),
      strokes: [
        [
          { x: 10, y: 20, p: 0.5, t: 0 },
          { x: 30.5, y: 40.25, p: 0.7, t: 16 },
        ],
      ],
      meta: { doc, strokeStyles: [style] },
    });

    const bytes = await exportBackup();
    await clearAllStores();
    await importBackup(bytes, 'replace');

    const db = await openDb();
    const back = (await db.get('drawings', saved.id)) as Drawing | undefined;
    expect(back?.meta?.doc).toEqual(doc);
    expect(back?.meta?.strokeStyles).toEqual([style]);
  });
});

describe('backup: 文書つきの絵の切り詰め範囲（meta.contentRect）と墨の塗り', () => {
  it('meta.doc（fill の色が墨 ink）と meta.contentRect が往復で残る', async () => {
    const doc = {
      v: 2,
      width: 800,
      height: 600,
      layers: [{ id: 'L1', name: 'レイヤー 1', visible: true, opacity: 1, locked: false, blend: 'normal' }],
      active: 'L1',
      ops: [{ kind: 'fill', layer: 'L1', x: 400, y: 300, color: 'ink', tolerance: 32, reference: 'layer' }],
    };
    const contentRect = { x: 12.5, y: 0, width: 787.5, height: 600 };
    const saved = await saveDrawing({ kind: 'free', lessonId: null, image: webp('fill-only'), strokes: [], meta: { doc, contentRect } });

    const bytes = await exportBackup();
    await clearAllStores();
    await importBackup(bytes, 'replace');

    const db = await openDb();
    const back = (await db.get('drawings', saved.id)) as Drawing | undefined;
    expect(back?.meta?.doc).toEqual(doc);
    expect(back?.meta?.contentRect).toEqual(contentRect);
  });
});
