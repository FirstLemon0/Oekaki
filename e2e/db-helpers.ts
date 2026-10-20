/**
 * 成長通の DB（seichotsu）の版上げの試験の補助（14-db-upgrade・17-persistent-upgrade が使う）。
 * v1 のデータは、アプリの JS が動かない同じオリジンのページ（/manifest.webmanifest）で v1 の形のまま作る。
 */
import type { Page } from '@playwright/test';

const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** v1 の DB（f4f1ed2 の db.ts と同じ 9 ストア・インデックス）を作り、全ストアに 1 件以上入れる */
export async function seedV1(page: Page): Promise<void> {
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

export interface Dump {
  version: number;
  stores: Record<string, { keyPath: string | string[] | null; indexes: string[]; keys: string[]; values: string[] }>;
}

/** 版を指定せずに開き、ストアごとの keyPath・インデックス・キー・値（Blob は大きさと型）を読む */
export async function dump(page: Page): Promise<Dump> {
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
