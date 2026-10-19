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

/**
 * 接続まわりの出来事（UI が案内を出すための通知）。
 * - `blocked`    … 新しい版で開こうとしたが、古い版を開いたままの別タブがあって待っている。
 *                  「ほかのタブを閉じてください」と案内する。閉じられれば自動で進む。
 * - `blocking`   … 別タブが新しい版で開こうとしている。こちらの接続はここで閉じたので、
 *                  UI は再読込を促す（このタブのままでは古いコードで動き続けてしまう）。
 * - `terminated` … ブラウザ側で接続が異常終了した（ストレージ削除など）。次の `openDb()` で
 *                  開き直す。UI は再読込を促してよい。
 */
export type DbEventType = 'blocked' | 'blocking' | 'terminated';
export interface DbEvent {
  type: DbEventType;
  /** blocked/blocking: 相手側（または自分）が開こうとしている版。terminated では null。 */
  newVersion: number | null;
}

const dbListeners = new Set<(e: DbEvent) => void>();
let lastDbEvent: DbEvent | null = null;

/** 接続まわりの出来事を購読する。戻り値で解除。 */
export function onDbEvent(cb: (e: DbEvent) => void): () => void {
  dbListeners.add(cb);
  return () => {
    dbListeners.delete(cb);
  };
}

/** 直近に起きた接続まわりの出来事（購読前に起きていた場合の確認用）。無ければ null。 */
export function getLastDbEvent(): DbEvent | null {
  return lastDbEvent;
}

function emitDbEvent(e: DbEvent): void {
  lastDbEvent = e;
  for (const cb of dbListeners) {
    try {
      cb(e);
    } catch {
      // 購読側の例外で他の購読者や DB 処理を止めない
    }
  }
}

/** DB 接続を開く（プロセス内でシングルトン）。テストでは `resetDbForTests` で切り替える。 */
export function openDb(): Promise<SeichotsuDBHandle> {
  if (!dbPromise) {
    const p: Promise<SeichotsuDBHandle> = openDB<SeichotsuDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        upgrade(db, oldVersion);
      },
      blocked(_currentVersion, blockedVersion) {
        emitDbEvent({ type: 'blocked', newVersion: blockedVersion ?? DB_VERSION });
      },
      blocking(_currentVersion, blockedVersion) {
        // 別タブの版上げを止めないよう、こちらの接続をすぐ閉じる
        void p.then((db) => db.close()).catch(() => undefined);
        if (dbPromise === p) dbPromise = null;
        emitDbEvent({ type: 'blocking', newVersion: blockedVersion ?? null });
      },
      terminated() {
        if (dbPromise === p) dbPromise = null;
        emitDbEvent({ type: 'terminated', newVersion: null });
      },
    });
    // 開けなかった場合は次回やり直せるようにキャッシュを捨てる
    p.catch(() => {
      if (dbPromise === p) dbPromise = null;
    });
    dbPromise = p;
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
