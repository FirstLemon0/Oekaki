import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import { DB_NAME, DB_VERSION, getLastDbEvent, onDbEvent, openDb, type DbEvent } from './db';

describe('openDb: 別タブの版上げ（blocking）', () => {
  it('新しい版で開かれそうになったら接続を閉じて通知し、相手の版上げを止めない', async () => {
    const events: DbEvent[] = [];
    const off = onDbEvent((e) => events.push(e));
    const first = await openDb();
    expect(first.version).toBe(DB_VERSION);

    // 別タブ相当: 新しい版で開く。こちらが閉じなければ blocked のまま進まない
    const other = await openDB(DB_NAME, DB_VERSION + 1, { upgrade() {} });
    expect(other.version).toBe(DB_VERSION + 1);

    expect(events.map((e) => e.type)).toEqual(['blocking']);
    expect(events[0]?.newVersion).toBe(DB_VERSION + 1);
    expect(getLastDbEvent()?.type).toBe('blocking');
    // キャッシュは捨てられているので、次の openDb は開き直そうとする。
    // DB はもう新しい版なので古いコードでは開けない（だから UI は再読込を促す）
    await expect(openDb()).rejects.toThrow();
    other.close();
    off();
  });
});
