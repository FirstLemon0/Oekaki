/**
 * 古い埋め込みが残した空の og-files-timelapse の片付け（OG ADR-0014 D3-2、src/ui/og/embedDbCleanup.ts）。
 * fake-indexeddb で: m13 以降で空なら消す・中身があれば残す・m12 以前と形の違うタグは触らない・無ければ作らない・databases() の無い環境は諦める。
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import { acceptedMilestone, dropEmptyTimelapseDb, OG_TIMELAPSE_DB } from './embedDbCleanup';

beforeEach(() => {
  // テストごとに空の IndexedDB
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});

const dbNames = async (): Promise<string[]> => (await indexedDB.databases()).map((d) => d.name ?? '');

/** OG m12 の埋め込みが作った形（版 1・records（keyPath docId）と frames）。rows を入れれば中身あり */
async function seedTimelapseDb(rows: { records?: number; frames?: number } = {}): Promise<void> {
  const db = await openDB(OG_TIMELAPSE_DB, 1, {
    upgrade(d) {
      d.createObjectStore('records', { keyPath: 'docId' });
      d.createObjectStore('frames');
    },
  });
  for (let i = 0; i < (rows.records ?? 0); i++) await db.put('records', { docId: `og-doc-${i}`, enabled: false });
  for (let i = 0; i < (rows.frames ?? 0); i++) await db.put('frames', new Uint8Array([i]), `og-doc-0\n${i}`);
  db.close();
}

describe('embedDbCleanup', () => {
  it('acceptedMilestone: 受け入れのタグの番号（点の版も）、形が違えば null', () => {
    expect(acceptedMilestone('m13.1-accepted')).toBe(13);
    expect(acceptedMilestone('m12-accepted')).toBe(12);
    expect(acceptedMilestone('m14-accepted')).toBe(14);
    expect(acceptedMilestone('m13-accepted-x')).toBeNull();
    expect(acceptedMilestone('')).toBeNull();
    expect(acceptedMilestone(null)).toBeNull();
    expect(acceptedMilestone(undefined)).toBeNull();
  });

  it('m13 以降の埋め込み: 空の og-files-timelapse は消す', async () => {
    await seedTimelapseDb();
    expect(await dbNames()).toContain(OG_TIMELAPSE_DB);
    expect(await dropEmptyTimelapseDb('m13.1-accepted')).toBe('deleted');
    expect(await dbNames()).not.toContain(OG_TIMELAPSE_DB);
    // 2 回目は何もしない（作り直さない）
    expect(await dropEmptyTimelapseDb('m13.1-accepted')).toBe('absent');
    expect(await dbNames()).not.toContain(OG_TIMELAPSE_DB);
  });

  it('中身が 1 件でもあれば残す（records だけ・frames だけのどちらでも）。形と版も変えない', async () => {
    await seedTimelapseDb({ records: 1 });
    expect(await dropEmptyTimelapseDb('m14-accepted')).toBe('kept');
    let d = await openDB(OG_TIMELAPSE_DB);
    expect(d.version).toBe(1);
    expect([...d.objectStoreNames].sort()).toEqual(['frames', 'records']);
    expect(await d.count('records')).toBe(1);
    d.close();

    (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    await seedTimelapseDb({ frames: 2 });
    expect(await dropEmptyTimelapseDb('m13-accepted')).toBe('kept');
    d = await openDB(OG_TIMELAPSE_DB);
    expect(await d.count('frames')).toBe(2);
    d.close();
  });

  it('m12 以前・タグの無い・形の違う埋め込みでは触らない（空でも残す）', async () => {
    await seedTimelapseDb();
    for (const tag of ['m12-accepted', 'm11.1-accepted', null, undefined, '', 'main']) {
      expect(await dropEmptyTimelapseDb(tag)).toBe('skipped');
    }
    expect(await dbNames()).toContain(OG_TIMELAPSE_DB);
  });

  it('DB が無ければ何もしない（作らない）。databases() の無い・失敗する環境は諦める', async () => {
    expect(await dropEmptyTimelapseDb('m13.1-accepted')).toBe('absent');
    expect(await dbNames()).not.toContain(OG_TIMELAPSE_DB);
    expect(await dropEmptyTimelapseDb('m13.1-accepted', {})).toBe('skipped');
    expect(await dropEmptyTimelapseDb('m13.1-accepted', { databases: () => Promise.reject(new Error('x')) })).toBe('skipped');
    expect(await dropEmptyTimelapseDb('m13.1-accepted', undefined)).toBe('absent');
  });

  it('ほかの DB（成長通の DB・埋め込みのほかの og-*）には触らない', async () => {
    await seedTimelapseDb();
    const other = await openDB('og-files-autosave', 1, { upgrade: (d) => void d.createObjectStore('docs') });
    other.close();
    const mine = await openDB('seichotsu', 1, { upgrade: (d) => void d.createObjectStore('drawings') });
    mine.close();
    expect(await dropEmptyTimelapseDb('m13.1-accepted')).toBe('deleted');
    expect((await dbNames()).sort()).toEqual(['og-files-autosave', 'seichotsu']);
  });
});
