/**
 * DB v2（ogDocs の追加）とバックアップの互換（UR-002 / ADR-0007 D6、受け入れ ilust-idb-compat・ilust-backup-compat・ilust-quota）。
 *
 * 旧い版 = f4f1ed2 のアプリの src/data をそのまま写したもの（`__legacy__/f4f1ed2/`、編集しない。
 *   一字一句の一致は scripts/__tests__/legacy-snapshot.test.mjs が git と照合する）。
 * - v1 のアプリが 9 ストアに書いたデータを新しい版で開くと v2 になり、全件がそのまま読め、ogDocs が空で作られる
 * - (a) 旧で書いたバックアップを新で取り込む
 * - (b) 新で書いたバックアップ（data/ogDocs/<id>.ognk を含む、manifest の版 1）を旧で取り込む（画像は残り、.ognk は無視される）
 * - (c) 新 → 新で .ognk のバイト（= 画素）が一致、置き換えで ogDocs の孤児 0
 * - saveOgDrawing: WebP と .ognk を 1 トランザクションで書く。QuotaExceededError で結果がメモリに残り、再試行で保存できる
 *
 * テストごとに fake-indexeddb の IDBFactory を新しくし（deleteDatabase は接続待ちで固まりやすい）、両方の版の接続のキャッシュを捨てる。
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';

import * as newBackup from './backup';
import * as newDb from './db';
import * as newRepo from './repo';
import type { OgDrawingMeta } from './types';

import * as oldBackup from './__legacy__/f4f1ed2/backup';
import * as oldDb from './__legacy__/f4f1ed2/db';
import * as oldRepo from './__legacy__/f4f1ed2/repo';

function freshFactory(): void {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  newDb.resetDbForTests();
  oldDb.resetDbForTests();
}

beforeEach(() => {
  freshFactory();
});

/** WebP の先頭（RIFF....WEBP）を持つ小さな画像の代わり（sniffImageType が webp と判定する） */
function webp(tag: string): Blob {
  const head = strToU8('RIFF\0\0\0\0WEBPVP8 ');
  return new Blob([head, strToU8(tag)], { type: 'image/webp' });
}

/** .ognk の代わり（中身は zip。バイトの一致で画素の一致を確かめる） */
function ognk(tag: string): Blob {
  const z = zipSync({ 'manifest.json': strToU8(JSON.stringify({ tag })), 'tiles/0.bin': new Uint8Array([1, 2, 3, tag.length]) });
  return new Blob([z as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

async function bytes(b: Blob): Promise<number[]> {
  return Array.from(new Uint8Array(await b.arrayBuffer()));
}

const OG_META: OgDrawingMeta = {
  docId: 'og-doc-1',
  docSize: { w: 2048, h: 1536 },
  contentRect: { x: 10, y: 20, w: 300, h: 200 },
  engine: 'og',
  ogContract: '0.9.0',
};

/** v1 のアプリで 9 ストアすべてにデータを書く */
async function seedLegacy(): Promise<void> {
  await oldRepo.updateProfile({ beforeDrawingId: 'd-before', beforeCreatedAt: '2026-01-01', unlockedLessonIds: ['s1-u1-l1'] });
  await oldRepo.completeLesson('s0-u1-l1', { score: 80 });
  await oldRepo.setLessonStep('s0-u1-l2', 3);
  await oldRepo.recordDrill('line', 70);
  await oldRepo.saveDrawing({
    id: 'd-before',
    kind: 'before',
    image: webp('before'),
    strokes: [[{ x: 1, y: 2, p: 0.5, t: 0 }]],
    meta: { doc: { version: 2, layers: [] } },
  });
  await oldRepo.saveDrawing({ id: 'd-free', kind: 'free', image: webp('free'), strokes: null, meta: { source: 'share' } });
  await oldRepo.saveCritique({
    drawingId: 'd-free',
    response: { good: ['線'], issues: [{ where: '左', what: '傾き', how: '直す' }], next_one: '箱', encourage: 'よし' },
    model: 'm',
  });
  await oldRepo.recordActivity('2026-01-02');
  await oldRepo.bumpCounter('box', 3);
  await oldRepo.updateSettings({ apiKey: 'sk-local', penOnly: false, theme: 'dark' });
  await oldRepo.saveReference({ id: 'r1', image: webp('ref'), label: '見本' });
}

/** 生の IndexedDB でストアごとの全件・キー・インデックスを読む（版を問わない） */
async function dumpRaw(): Promise<{
  version: number;
  stores: Record<string, { keyPath: unknown; indexes: string[]; keys: unknown[]; values: unknown[] }>;
}> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(newDb.DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const names = Array.from(db.objectStoreNames);
  const stores: Record<string, { keyPath: unknown; indexes: string[]; keys: unknown[]; values: unknown[] }> = {};
  const tx = db.transaction(names, 'readonly');
  for (const name of names) {
    const s = tx.objectStore(name);
    const req = (r: IDBRequest) =>
      new Promise<unknown[]>((resolve, reject) => {
        r.onsuccess = () => resolve(r.result as unknown[]);
        r.onerror = () => reject(r.error);
      });
    const values = await req(s.getAll());
    const keys = await req(s.getAllKeys());
    const plain = await Promise.all(values.map((v) => normalize(v)));
    stores[name] = { keyPath: s.keyPath, indexes: Array.from(s.indexNames).sort(), keys, values: plain };
  }
  const version = db.version;
  db.close();
  return { version, stores };
}

/** Blob をバイト列に置き換えて比べられる形にする */
async function normalize(v: unknown): Promise<unknown> {
  if (v instanceof Blob) return { blob: await bytes(v), type: v.type };
  if (Array.isArray(v)) return Promise.all(v.map((x) => normalize(x)));
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = await normalize(x);
    return out;
  }
  return v;
}

describe('ilust-idb-compat: v1 のデータを v2 で開く', () => {
  it('v1 の 9 ストアの全件・キー・インデックスがそのまま読め、ogDocs が空で作られる', async () => {
    await seedLegacy();
    const before = await dumpRaw();
    expect(before.version).toBe(1);
    expect(Object.keys(before.stores).sort()).toEqual([...newDb.V1_STORES].sort());

    // 新しい版で開く（v1 の接続は versionchange で閉じる = 旧い db.ts の blocking と同じ動き）
    const db = await newDb.openDb();
    expect(db.version).toBe(2);
    newDb.resetDbForTests();
    db.close();

    const after = await dumpRaw();
    expect(after.version).toBe(2);
    expect(Object.keys(after.stores).sort()).toEqual([...newDb.V1_STORES, 'ogDocs'].sort());
    expect(after.stores['ogDocs']).toEqual({ keyPath: 'id', indexes: [], keys: [], values: [] });
    for (const name of newDb.V1_STORES) {
      expect(after.stores[name], name).toEqual(before.stores[name]);
    }

    // 新しい版の読み出しも同じ値を返す
    const drawings = await newRepo.listDrawings();
    expect(drawings.map((d) => d.id).sort()).toEqual(['d-before', 'd-free']);
    expect((await newRepo.getSettings()).apiKey).toBe('sk-local');
    expect(await newRepo.getProgress('s0-u1-l2')).toMatchObject({ lastStep: 3 });
  });

  it('別タブで v1 を開いたまま（閉じない古いタブ）だと blocked を知らせ、閉じれば v2 へ進む', async () => {
    await seedLegacy();
    oldDb.resetDbForTests();
    // versionchange を無視する（閉じない）古いタブの接続
    const stale = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(newDb.DB_NAME, 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    // 旧い db.ts の接続（閉じる方）も開いたままにする
    const legacyConn = await oldDb.openDb();
    const events: newDb.DbEvent[] = [];
    const off = newDb.onDbEvent((e) => events.push(e));
    const opening = newDb.openDb();
    await new Promise((r) => setTimeout(r, 20));
    expect(events.map((e) => e.type)).toContain('blocked');
    expect(events.find((e) => e.type === 'blocked')?.newVersion).toBe(2);
    stale.close();
    const db = await opening;
    expect(db.version).toBe(2);
    expect(Array.from(db.objectStoreNames)).toContain('ogDocs');
    // 旧い db.ts は自分の接続を閉じている
    expect(() => legacyConn.transaction('profile')).toThrow();
    off();
  });

  it('v2 になった後に v1 のアプリで開くと VersionError（旧アプリは版を下げられない）', async () => {
    await newDb.openDb();
    await expect(oldDb.openDb()).rejects.toMatchObject({ name: 'VersionError' });
  });
});

describe('ilust-backup-compat', () => {
  it('(a) f4f1ed2 で書いたバックアップを新しい版で取り込める（置き換え・merge）', async () => {
    await seedLegacy();
    const zip = await oldBackup.exportBackupBlob();
    const legacyEntries = Object.keys(unzipSync(new Uint8Array(await zip.arrayBuffer())));
    expect(legacyEntries).not.toContain('data/ogDocs.json');

    freshFactory();
    await newRepo.updateSettings({ apiKey: 'sk-new-device' });
    await newBackup.importBackup(zip, 'replace');
    const drawings = await newRepo.listDrawings();
    expect(drawings.map((d) => d.id).sort()).toEqual(['d-before', 'd-free']);
    const before = drawings.find((d) => d.id === 'd-before');
    expect(await bytes(before!.image)).toEqual(await bytes(webp('before')));
    expect(before!.meta).toEqual({ doc: { version: 2, layers: [] } });
    expect(await newRepo.listOgDocs()).toEqual([]);
    expect((await newRepo.getSettings()).apiKey).toBe('sk-new-device');
    expect((await newRepo.getCounters()).box).toBe(3);

    // merge でも同じく読める
    freshFactory();
    await newBackup.importBackup(zip, 'merge');
    expect((await newRepo.listReferences()).map((r) => r.id)).toEqual(['r1']);
  });

  it('(b) 新しい版のバックアップ（.ognk 入り、版 1）を f4f1ed2 で取り込め、画像と meta.og が残る', async () => {
    await newRepo.saveDrawing({ id: 'd-v2', kind: 'free', image: webp('v2'), strokes: null });
    const saved = await newRepo.saveOgDrawing({
      id: 'd-og',
      kind: 'free',
      image: webp('og'),
      ognk: ognk('a'),
      og: OG_META,
      embedApi: 1,
    });
    expect(saved.ok).toBe(true);
    const zip = await newBackup.exportBackupBlob();
    const files = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    expect(JSON.parse(strFromU8(files['manifest.json']!))).toMatchObject({ version: 1 });
    expect(Object.keys(files)).toContain('data/ogDocs.json');
    expect(Object.keys(files)).toContain(newBackup.ogDocPath('d-og'));

    freshFactory();
    await oldBackup.importBackup(zip, 'replace');
    const legacy = await oldRepo.listDrawings();
    expect(legacy.map((d) => d.id).sort()).toEqual(['d-og', 'd-v2']);
    const og = legacy.find((d) => d.id === 'd-og')!;
    expect(og.strokes).toBeNull();
    expect(og.meta).toEqual({ og: OG_META });
    expect(await bytes(og.image)).toEqual(await bytes(webp('og')));
    // 旧い版の DB は v1 のまま（ogDocs は無い）
    const raw = await dumpRaw();
    expect(raw.version).toBe(1);
    expect(Object.keys(raw.stores)).not.toContain('ogDocs');
  });

  it('(c) 新 → 新: .ognk のバイトが一致し、置き換えで ogDocs の孤児が残らない', async () => {
    const r = await newRepo.saveOgDrawing({ id: 'd-og', kind: 'after', image: webp('og'), ognk: ognk('c'), og: OG_META, embedApi: 1 });
    expect(r.ok).toBe(true);
    const zip = await newBackup.exportBackupBlob();

    // 取り込む先には、バックアップに無い絵と文書がある（置き換えで消える = 孤児 0）
    freshFactory();
    await newRepo.saveOgDrawing({ id: 'd-local', kind: 'free', image: webp('local'), ognk: ognk('local'), og: OG_META, embedApi: 1 });
    await newBackup.importBackup(zip, 'replace');
    const docs = await newRepo.listOgDocs();
    expect(docs.map((d) => d.id)).toEqual(['d-og']);
    expect(await bytes(docs[0]!.bytes)).toEqual(await bytes(ognk('c')));
    expect(docs[0]).toMatchObject({ drawingId: 'd-og', format: 'ognk', ogContract: '0.9.0', embedApi: 1 });
    expect((await newRepo.listDrawings()).map((d) => d.id)).toEqual(['d-og']);
    const drawing = await newRepo.getDrawing('d-og');
    expect(drawing?.meta).toEqual({ og: OG_META });
    expect(drawing?.meta && 'doc' in drawing.meta).toBe(false);
  });

  it('merge: 文書は絵と同じく新しい方を残し、対応する絵の無い文書は取り込まない', async () => {
    await newRepo.saveOgDrawing({ id: 'd-og', kind: 'free', image: webp('og'), ognk: ognk('old'), og: OG_META, embedApi: 1 });
    const zip = await newBackup.exportBackupBlob();
    // 対応する絵の無い文書を足した zip（手で作る）
    const files = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    const metas = JSON.parse(strFromU8(files['data/ogDocs.json']!)) as Array<Record<string, unknown>>;
    metas.push({ ...metas[0], id: 'orphan', drawingId: 'orphan' });
    files['data/ogDocs.json'] = strToU8(JSON.stringify(metas));
    files[newBackup.ogDocPath('orphan')] = new Uint8Array(await ognk('orphan').arrayBuffer());
    const withOrphan = zipSync(files);

    // 端末側の方が新しい
    await new Promise((r) => setTimeout(r, 5));
    await newRepo.saveOgDrawing({ id: 'd-og', kind: 'free', image: webp('og2'), ognk: ognk('newer'), og: OG_META, embedApi: 1 });
    await newBackup.importBackup(withOrphan, 'merge');
    const docs = await newRepo.listOgDocs();
    expect(docs.map((d) => d.id)).toEqual(['d-og']);
    expect(await bytes(docs[0]!.bytes)).toEqual(await bytes(ognk('newer')));

    // 置き換えでも孤児は入らない
    await newBackup.importBackup(withOrphan, 'replace');
    expect((await newRepo.listOgDocs()).map((d) => d.id)).toEqual(['d-og']);
  });

  it('本体（.ognk）の欠けた一覧は飛ばして、ほかのデータは取り込む', async () => {
    await newRepo.saveOgDrawing({ id: 'd-og', kind: 'free', image: webp('og'), ognk: ognk('x'), og: OG_META, embedApi: 1 });
    const files = unzipSync(new Uint8Array(await (await newBackup.exportBackupBlob()).arrayBuffer()));
    delete files[newBackup.ogDocPath('d-og')];
    freshFactory();
    await newBackup.importBackup(zipSync(files), 'replace');
    expect(await newRepo.listOgDocs()).toEqual([]);
    expect((await newRepo.listDrawings()).map((d) => d.id)).toEqual(['d-og']);
  });
});

describe('ilust-quota: saveOgDrawing', () => {
  it('絵と文書を 1 トランザクションで書き、deleteDrawing で両方消える', async () => {
    const r = await newRepo.saveOgDrawing({ kind: 'free', image: webp('a'), ognk: ognk('a'), og: OG_META, embedApi: 1 });
    if (!r.ok) throw new Error('save failed');
    expect(r.drawing.strokes).toBeNull();
    expect(r.drawing.meta).toEqual({ og: OG_META });
    expect(r.doc.id).toBe(r.drawing.id);
    expect(await newRepo.getOgDoc(r.drawing.id)).toBeDefined();
    await newRepo.deleteDrawing(r.drawing.id);
    expect(await newRepo.getDrawing(r.drawing.id)).toBeUndefined();
    expect(await newRepo.getOgDoc(r.drawing.id)).toBeUndefined();
  });

  it('QuotaExceededError: 何も書かれず、結果がメモリに残り、retry で保存できる', async () => {
    const proto = (globalThis as unknown as { IDBObjectStore: { prototype: { put: (...a: unknown[]) => unknown } } }).IDBObjectStore
      .prototype;
    const realPut = proto.put;
    let failures = 0;
    proto.put = function (this: { name: string }, ...args: unknown[]) {
      if (this.name === 'ogDocs') {
        failures += 1;
        throw new DOMException('空き容量が足りません', 'QuotaExceededError');
      }
      return realPut.apply(this, args);
    };
    let r: newRepo.SaveOgDrawingResult;
    try {
      r = await newRepo.saveOgDrawing({ id: 'd-q', kind: 'free', image: webp('q'), ognk: ognk('q'), og: OG_META, embedApi: 1 });
    } finally {
      proto.put = realPut;
    }
    expect(failures).toBe(1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('quota');
    // 片方だけ残っていない
    expect(await newRepo.getDrawing('d-q')).toBeUndefined();
    expect(await newRepo.getOgDoc('d-q')).toBeUndefined();
    // 入力（画像と文書）はメモリに残っている
    expect(await bytes(r.input.ognk)).toEqual(await bytes(ognk('q')));
    const again = await r.retry();
    expect(again.ok).toBe(true);
    expect(await bytes((await newRepo.getOgDoc('d-q'))!.bytes)).toEqual(await bytes(ognk('q')));
    expect((await newRepo.getDrawing('d-q'))?.meta).toEqual({ og: OG_META });
  });

  it('meta.og は JSON の値だけ（Blob・NaN・知らない形は拒む）、extraMeta に og / doc は使えない', async () => {
    const bad = { ...OG_META, docSize: { w: Number.NaN, h: 1 } };
    const r1 = await newRepo.saveOgDrawing({ kind: 'free', image: webp('a'), ognk: ognk('a'), og: bad, embedApi: 1 });
    expect(r1.ok).toBe(false);
    const withBlob = { ...OG_META, contentRect: new Blob(['x']) } as unknown as OgDrawingMeta;
    expect(newRepo.isJsonOgMeta(withBlob)).toBe(false);
    const r2 = await newRepo.saveOgDrawing({
      kind: 'free',
      image: webp('a'),
      ognk: ognk('a'),
      og: OG_META,
      embedApi: 1,
      extraMeta: { doc: {} },
    });
    expect(r2.ok).toBe(false);
    expect(await newRepo.listDrawings()).toEqual([]);
  });
});
