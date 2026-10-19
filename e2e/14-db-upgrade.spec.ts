/**
 * DB v1 → v2（ogDocs の追加）を本物のブラウザで確かめる（受け入れ ilust-idb-compat、ADR-0007 D6-6）。
 *
 * - v1 の 9 ストアの全データ（進捗・ギャラリー・設定ほか）が入った端末で新しい版を開くと v2 になり、全件がそのまま読め、
 *   ogDocs が空で作られる（既存のストア・インデックス・キー・値の形に差分 0）
 * - 古い版を開いたままの別タブ（versionchange で閉じない）がある間は「ほかのタブを閉じて」の案内を出し、閉じれば進む
 *
 * v1 のデータは、アプリの JS が動かない同じオリジンのページ（/manifest.webmanifest）で v1 の形のまま作る。
 */
import { expect, test, type Page } from '@playwright/test';
import { gotoApp } from './helpers';

const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** v1 の DB（f4f1ed2 の db.ts と同じ 9 ストア・インデックス）を作り、全ストアに 1 件以上入れる */
async function seedV1(page: Page): Promise<void> {
  await page.goto('/manifest.webmanifest');
  await page.evaluate(async (png) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('seichotsu', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('profile');
        d.createObjectStore('progress', { keyPath: 'lessonId' });
        d.createObjectStore('drillStats', { keyPath: 'drillType' });
        const drawings = d.createObjectStore('drawings', { keyPath: 'id' });
        drawings.createIndex('byLesson', 'lessonId');
        drawings.createIndex('byKind', 'kind');
        drawings.createIndex('byCreatedAt', 'createdAt');
        d.createObjectStore('critiques', { keyPath: 'drawingId' });
        d.createObjectStore('streak');
        d.createObjectStore('counters');
        d.createObjectStore('settings');
        d.createObjectStore('references', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const image = new Blob([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], { type: 'image/png' });
    const t = '2026-10-01T09:00:00.000Z';
    const tx = db.transaction(Array.from(db.objectStoreNames), 'readwrite');
    tx.objectStore('profile').put(
      {
        startedAt: '2026-09-01',
        beforeDrawingId: null,
        beforeCreatedAt: null,
        afterDrawingId: null,
        calibration: null,
        lastMonthlyPromptAt: null,
        critiqueAttemptsByDay: {},
        unlockedLessonIds: [],
        reviewSkippedOn: {},
        updatedAt: t,
      },
      'singleton',
    );
    tx.objectStore('progress').put({ lessonId: 's0-u1-l1', completedAt: t, attempts: 1, lastScore: 80, updatedAt: t });
    tx.objectStore('drillStats').put({ drillType: 'line', history: [{ at: t, score: 70 }], bestScore: 70, updatedAt: t });
    tx.objectStore('drawings').put({ id: 'd-v1', lessonId: null, kind: 'free', image, createdAt: t, strokes: null, updatedAt: t });
    tx.objectStore('critiques').put({
      drawingId: 'd-v1',
      response: { good: ['線'], issues: [], next_one: '箱', encourage: 'よし' },
      model: 'm',
      createdAt: t,
      updatedAt: t,
    });
    tx.objectStore('streak').put({ current: 3, longest: 5, freezes: 1, lastActiveDay: '2026-10-01', nextFreezeAt: 7, updatedAt: t }, 'singleton');
    tx.objectStore('counters').put({ line: 10, ellipse: 0, circle: 0, box: 2, gesture: 0, completed: 1, updatedAt: t }, 'singleton');
    tx.objectStore('settings').put(
      {
        apiKey: null,
        modelId: 'claude-opus-5-5',
        effort: 'high',
        dailyCritiqueLimit: 3,
        externalAppName: null,
        theme: 'light',
        leftHanded: false,
        penOnly: true,
        strictness: 'normal',
        notifyTime: '20:00',
        fontScale: 'normal',
        lastBackupAt: null,
        backupSnoozedOn: null,
        reviewWarmup: true,
        updatedAt: t,
      },
      'singleton',
    );
    tx.objectStore('references').put({ id: 'r-v1', image, label: '見本', createdAt: t, updatedAt: t });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, PNG_1x1);
}

interface Dump {
  version: number;
  stores: Record<string, { keyPath: string | string[] | null; indexes: string[]; keys: string[]; values: string[] }>;
}

/** 版を指定せずに開き、ストアごとの keyPath・インデックス・キー・値（Blob は大きさと型）を読む */
async function dump(page: Page): Promise<Dump> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('seichotsu');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const stores: Dump['stores'] = {};
    const names = Array.from(db.objectStoreNames);
    const tx = db.transaction(names, 'readonly');
    const get = <T,>(r: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    for (const name of names) {
      const s = tx.objectStore(name);
      const values = await get(s.getAll());
      const keys = await get(s.getAllKeys());
      stores[name] = {
        keyPath: s.keyPath,
        indexes: Array.from(s.indexNames).sort(),
        keys: keys.map((k) => JSON.stringify(k)),
        values: values.map((v) =>
          JSON.stringify(v, (_k, x: unknown) => (x instanceof Blob ? { blob: x.size, type: x.type } : x)),
        ),
      };
    }
    const version = db.version;
    db.close();
    return { version, stores };
  });
}

test.describe('DB v2（ogDocs の追加）', () => {
  test('v1 の 9 ストアのデータを入れた端末で開くと v2 になり、全件そのまま・ogDocs は空', async ({ page }) => {
    await seedV1(page);
    const before = await dump(page);
    expect(before.version).toBe(1);
    expect(Object.keys(before.stores)).toHaveLength(9);

    await gotoApp(page, '#/gallery');
    await expect(page.getByRole('heading', { name: 'ギャラリー' })).toBeVisible();
    // v1 の絵がギャラリーに出る（アプリが v2 で読めている）
    await expect(page.locator('.itile').first()).toBeVisible();
    await expect(page.locator('.load-error')).toHaveCount(0);

    await page.goto('/manifest.webmanifest');
    const after = await dump(page);
    expect(after.version).toBe(2);
    expect(Object.keys(after.stores).sort()).toEqual([...Object.keys(before.stores), 'ogDocs'].sort());
    expect(after.stores['ogDocs']).toEqual({ keyPath: 'id', indexes: [], keys: [], values: [] });
    for (const name of Object.keys(before.stores)) {
      expect(after.stores[name], name).toEqual(before.stores[name]);
    }
  });

  test('古い版を開いたままの別タブがあると案内を出し、閉じると v2 へ進む', async ({ page, context }) => {
    await seedV1(page);
    // 古いタブ: v1 で開いたまま、versionchange でも閉じない
    const stale = await context.newPage();
    await stale.goto('/manifest.webmanifest');
    await stale.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('seichotsu', 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      (window as unknown as { __staleDb: IDBDatabase }).__staleDb = db;
    });

    await page.goto('/#/');
    await expect(page.getByRole('alert')).toContainText('ほかのタブやウィンドウで成長通を開いていたら閉じてください');
    await expect(page.locator('.loading')).toHaveCount(1);

    await stale.evaluate(() => (window as unknown as { __staleDb: IDBDatabase }).__staleDb.close());
    await page.locator('.loading').waitFor({ state: 'detached' });
    await expect(page.locator('.load-error')).toHaveCount(0);
    await page.goto('/manifest.webmanifest');
    expect((await dump(page)).version).toBe(2);
  });
});
