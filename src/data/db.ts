import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  Counters,
  Critique,
  DrillStats,
  Drawing,
  Profile,
  ReferenceImage,
  Settings,
  Streak,
  Progress,
} from './types';

export const DB_NAME = 'seichotsu';
export const DB_VERSION = 1;

/** 単一レコードのみを持つストア（profile/streak/counters/settings）で使う固定キー。 */
export const SINGLETON_KEY = 'singleton';

export interface SeichotsuDB extends DBSchema {
  profile: { key: typeof SINGLETON_KEY; value: Profile };
  progress: { key: string; value: Progress };
  drillStats: { key: string; value: DrillStats };
  drawings: {
    key: string;
    value: Drawing;
    indexes: { byLesson: string; byKind: string; byCreatedAt: string };
  };
  critiques: { key: string; value: Critique };
  streak: { key: typeof SINGLETON_KEY; value: Streak };
  counters: { key: typeof SINGLETON_KEY; value: Counters };
  settings: { key: typeof SINGLETON_KEY; value: Settings };
  references: { key: string; value: ReferenceImage };
}

export type SeichotsuDBHandle = IDBPDatabase<SeichotsuDB>;

let dbPromise: Promise<SeichotsuDBHandle> | null = null;

/**
 * バージョンごとのマイグレーションを積み上げる upgrade 関数。
 * `oldVersion` からのフォールスルーで、将来バージョンを追加してもここに
 * `case` を足していくだけで済むようにしてある。
 */
function upgrade(db: IDBPDatabase<SeichotsuDB>, oldVersion: number): void {
  switch (oldVersion) {
    case 0:
      db.createObjectStore('profile');
      db.createObjectStore('progress', { keyPath: 'lessonId' });
      db.createObjectStore('drillStats', { keyPath: 'drillType' });
      {
        const drawings = db.createObjectStore('drawings', { keyPath: 'id' });
        drawings.createIndex('byLesson', 'lessonId');
        drawings.createIndex('byKind', 'kind');
        drawings.createIndex('byCreatedAt', 'createdAt');
      }
      db.createObjectStore('critiques', { keyPath: 'drawingId' });
      db.createObjectStore('streak');
      db.createObjectStore('counters');
      db.createObjectStore('settings');
      db.createObjectStore('references', { keyPath: 'id' });
    // 将来: case 1: ...（v1 -> v2 の差分だけを書く）
  }
}

/** DB 接続を開く（プロセス内でシングルトン）。テストでは `resetDbForTests` で切り替える。 */
export function openDb(): Promise<SeichotsuDBHandle> {
  if (!dbPromise) {
    dbPromise = openDB<SeichotsuDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        upgrade(db, oldVersion);
      },
    });
  }
  return dbPromise;
}

/** テスト用: キャッシュした接続を破棄し、次回 `openDb()` で再接続させる。 */
export function resetDbForTests(): void {
  dbPromise = null;
}

/**
 * 永続ストレージを要求する（DESIGN.md §7）。非対応環境や拒否時も例外を投げず、
 * 成否を boolean で返すだけにする。
 */
export async function requestPersistentStorage(): Promise<boolean> {
  const storage = (globalThis as { navigator?: Navigator }).navigator?.storage;
  if (!storage || typeof storage.persist !== 'function') {
    return false;
  }
  try {
    return await storage.persist();
  } catch {
    return false;
  }
}
