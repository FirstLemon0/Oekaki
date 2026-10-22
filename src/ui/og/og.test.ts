/**
 * 新しいお絵描き（#/free の OgFreeDraw）の画面に依らない部分の試験（UR-002 S2、受け入れ ilust-free-contracts / ilust-quota / ilust-free-opens-og の vitest の分）。
 *
 * - API の版と形の照合（版が違う・形が違う・起動に失敗 → 旧 FreeDraw に戻す理由）
 * - onStroke の区間 → activeDrawingMs: 同じ時系列の v2（strokeend の区間）と同じ値、pen / eraser だけ、5 分でストリーク
 * - 保存: 何も描いていなければ保存しない、WebP と .ognk を 1 トランザクション、容量不足で何も書かれず retry で保存できる、
 *   meta.og は JSON の値だけ（meta.doc なし）、続きから描いた絵は同じ id・種別・作成日時で置き換える
 * - 下書き: 印（localStorage）とジャーナルの docId の一致、捨てる・保存の後に何も残らない、古い版の写しは DB があるときだけ消す（S4）
 * - 設定: paintEngine の既定と解決、#/free?og= のルート、テーマの解決・紙の大きさ
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import * as db from '@/data/db';
import * as repo from '@/data/repo';
import type { OgDrawingMeta } from '@/data/types';
import { activeDrawingMs } from '../lesson/steps';
import { FREE_MIN_MS } from '../lesson/stateBridge';
import { href, parseHash } from '../router';
import { DEFAULT_PAINT_ENGINE, freeScreenEngine, resolvePaintEngine } from '../paintEngine';
import { connectOgEmbed, isCompatibleOgEmbed, isOgEmbedApi, OG_EMBED_API_VERSION, type OgEmbedApi, type OgStrokeSpan } from './embedApi';
import {
  countsAsDrawing,
  createSpanLog,
  embedConfigFrom,
  newOgDocId,
  ogMetaFrom,
  OG_PAPER_COLOR,
  paperFor,
  resolveEmbedTheme,
  saveOgFree,
} from './freeSession';
import { continueTargetOf } from './ogDrawing';
import {
  createDraftKeeper,
  createOgDraftStore,
  dropLegacySnapshot,
  LEGACY_SNAPSHOT_KEY,
  LEGACY_SNAPSHOT_STORE,
  OG_DRAFT_DB,
  OG_DRAFT_MARK_KEY,
  type DraftApi,
} from './ogDraft';

function freshFactory(): void {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  db.resetDbForTests();
}

beforeEach(() => {
  freshFactory();
});

/** WebP の先頭を持つ小さな画像（sniff が webp と判定する） */
function webp(tag: string): Blob {
  return new Blob([new TextEncoder().encode(`RIFF\0\0\0\0WEBPVP8 ${tag}`)], { type: 'image/webp' });
}

function ognk(tag: string): Blob {
  return new Blob([new TextEncoder().encode(`PK\x03\x04ognk-${tag}`)], { type: 'application/x-ognk' });
}

async function bytes(b: Blob): Promise<number[]> {
  return Array.from(new Uint8Array(await b.arrayBuffer()));
}

/** ogEmbed の偽物（v1 の形。書き出しは呼ばれた回数を数える） */
function fakeApi(over: Partial<OgEmbedApi> & { content?: boolean } = {}): OgEmbedApi & { calls: string[] } {
  const calls: string[] = [];
  const api = {
    version: OG_EMBED_API_VERSION,
    ready: Promise.resolve(),
    configure: () => undefined,
    newDocument: async () => undefined,
    openProject: async () => undefined,
    hasContent: () => over.content ?? true,
    isDirty: () => true,
    exportGalleryImage: async () => {
      calls.push('gallery');
      return { image: webp('g'), contentRect: { x: 100, y: 120, width: 640, height: 480 }, docSize: { width: 2048, height: 1536 } };
    },
    exportTransparentPng: async () => new Blob([]),
    serializeProject: async () => {
      calls.push('serialize');
      return ognk('doc');
    },
    discardRecovery: async () => undefined,
    onStroke: () => () => undefined,
    onDirtyChange: () => () => undefined,
    dispose: () => undefined,
    saveDraft: async () => ({ docId: 'og-doc', savedAt: '2026-10-22T00:00:00.000Z' }),
    latestDraft: async () => null,
    openDraft: async () => undefined,
    calls,
  };
  return Object.assign(api, over);
}

describe('API の版と形（ilust-free-opens-og: 版が違えば旧 FreeDraw）', () => {
  it('v1 の形で版が 1 のときだけ使える', () => {
    const api = fakeApi();
    expect(isOgEmbedApi(api)).toBe(true);
    expect(isCompatibleOgEmbed(api)).toBe(true);
    expect(isCompatibleOgEmbed({ ...api, version: 2 })).toBe(false);
    expect(isOgEmbedApi({ ...api, serializeProject: undefined })).toBe(false);
    expect(isOgEmbedApi({ version: 1 })).toBe(false);
    expect(isOgEmbedApi(null)).toBe(false);
  });

  it('ilust-s4-cleanup: 下書きの口（saveDraft / latestDraft / openDraft）の無い成果物（OG 8af7b0f より前）は形が違う = 未対応（ilust-sup-followup-10）', async () => {
    const api = fakeApi();
    for (const m of ['saveDraft', 'latestDraft', 'openDraft'] as const) {
      expect(isOgEmbedApi({ ...api, [m]: undefined }), m).toBe(false);
      expect(isCompatibleOgEmbed({ ...api, [m]: undefined }), m).toBe(false);
    }
    // wave 1 の成果物（2906365）の形 = 口が 3 つとも無い → connect は 'version' で失敗し、呼び出し側は今までのお絵描きに戻す
    const { saveDraft: _s, latestDraft: _l, openDraft: _o, ...old } = api;
    let t = 0;
    const clock = { now: () => t, sleep: async (ms: number) => void (t += ms) };
    const r = await connectOgEmbed(() => ({ ogEmbed: old }) as unknown as Window, clock);
    expect(r).toEqual({ ok: false, reason: 'version' });
  });

  it('connectOgEmbed: 出てこない → missing、版違い → version、ready の reject → boot、ready → ok', async () => {
    let t = 0;
    const clock = { now: () => t, sleep: async (ms: number) => void (t += ms) };
    const none = await connectOgEmbed(() => ({}) as Window, { ...clock, appearTimeoutMs: 200, pollMs: 50 });
    expect(none).toEqual({ ok: false, reason: 'missing' });

    const v2 = await connectOgEmbed(() => ({ ogEmbed: { ...fakeApi(), version: 2 } }) as unknown as Window, clock);
    expect(v2).toMatchObject({ ok: false, reason: 'version', version: 2 });

    const broken = await connectOgEmbed(() => ({ ogEmbed: { version: 1 } }) as unknown as Window, clock);
    expect(broken).toMatchObject({ ok: false, reason: 'version' });

    const failing = fakeApi({ ready: Promise.reject(new Error('boot failed')) });
    const boot = await connectOgEmbed(() => ({ ogEmbed: failing }) as unknown as Window, clock);
    expect(boot).toMatchObject({ ok: false, reason: 'boot' });

    const never = fakeApi({ ready: new Promise<void>(() => undefined) });
    const slow = await connectOgEmbed(() => ({ ogEmbed: never }) as unknown as Window, { ...clock, readyTimeoutMs: 5 });
    expect(slow).toEqual({ ok: false, reason: 'timeout' });

    // 読み込みの途中は window が差し替わる: 後から出てきたものを使う
    let calls = 0;
    const good = fakeApi();
    const ok = await connectOgEmbed(() => (++calls < 3 ? ({} as Window) : ({ ogEmbed: good } as unknown as Window)), clock);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.api).toBe(good);
  });
});

describe('実描画の区間（ilust-free-contracts: onStroke → activeDrawingMs）', () => {
  it('pen / eraser だけを積み、同じ時系列の v2 と同じ activeDrawingMs', () => {
    // v2: strokeend ごとに { start: 押し下げ, end: 離した } を積む。図形・塗りは線を引く道具ではない
    const timeline: OgStrokeSpan[] = [
      { start: 1_000, end: 4_000, tool: 'pen' },
      { start: 5_000, end: 6_000, tool: 'other' }, // 塗り（v2 でも数えない設計。設計案 §4）
      { start: 8_000, end: 9_500, tool: 'eraser' },
      { start: 200_000, end: 203_000, tool: 'pen' }, // 空きは 1 回 1 分まで
    ];
    const log = createSpanLog();
    for (const s of timeline) log.add(s);
    const v2Spans = timeline.filter((s) => s.tool !== 'other').map(({ start, end }) => ({ start, end }));
    expect(log.spans()).toEqual(v2Spans);
    expect(log.activeMs()).toBe(activeDrawingMs(v2Spans));
    // 3000 + 1500 + 3000（線）+ 4000（空き）+ 60000（空きの上限）
    expect(log.activeMs()).toBe(71_500);
    expect(countsAsDrawing('other')).toBe(false);
  });

  it('5 分の境目: 5 分未満はストリークに数えず、5 分以上で数える', () => {
    const under = createSpanLog();
    under.add({ start: 0, end: FREE_MIN_MS - 1, tool: 'pen' });
    expect(under.activeMs() >= FREE_MIN_MS).toBe(false);
    const over = createSpanLog();
    // 50 秒の線を 6 本、間は 5 秒（空きも数える）
    for (let i = 0; i < 6; i++) over.add({ start: i * 55_000, end: i * 55_000 + 50_000, tool: 'pen' });
    expect(over.activeMs()).toBe(6 * 50_000 + 5 * 5_000);
    expect(over.activeMs() >= FREE_MIN_MS).toBe(true);
  });

  it('壊れた区間（NaN）は積まない', () => {
    const log = createSpanLog();
    log.add({ start: Number.NaN, end: 10, tool: 'pen' });
    expect(log.spans()).toEqual([]);
  });
});

describe('保存（ilust-free-contracts / ilust-quota）', () => {
  it('何も描いていなければ保存しない（書き出しも呼ばない）', async () => {
    const api = fakeApi({ content: false });
    const r = await saveOgFree({ api, kind: 'free', docId: 'og-1', ogContract: '0.9.0', save: repo.saveOgDrawing });
    expect(r.status).toBe('empty');
    expect(api.calls).toEqual([]);
    expect(await repo.listDrawings()).toEqual([]);
  });

  it('WebP（ギャラリー）と .ognk（ogDocs）を書き、meta は og だけ（JSON の値、meta.doc なし）', async () => {
    const api = fakeApi();
    const r = await saveOgFree({ api, kind: 'after', docId: 'og-1', ogContract: '0.9.0', save: repo.saveOgDrawing });
    expect(r.status).toBe('saved');
    if (r.status !== 'saved') return;
    expect(api.calls).toEqual(['gallery', 'serialize']);
    const d = await repo.getDrawing(r.drawing.id);
    expect(d?.kind).toBe('after');
    expect(d?.strokes).toBeNull();
    expect(d?.image.type).toBe('image/webp');
    const og: OgDrawingMeta = { docId: 'og-1', docSize: { w: 2048, h: 1536 }, contentRect: { x: 100, y: 120, w: 640, h: 480 }, engine: 'og', ogContract: '0.9.0' };
    expect(d?.meta).toEqual({ og });
    expect(JSON.parse(JSON.stringify(d?.meta))).toEqual(d?.meta);
    expect(repo.isJsonOgMeta(og)).toBe(true);
    const doc = await repo.getOgDoc(r.drawing.id);
    expect(doc).toMatchObject({ drawingId: r.drawing.id, format: 'ognk', ogContract: '0.9.0', embedApi: 1 });
    expect(await bytes(doc!.bytes)).toEqual(await bytes(ognk('doc')));
    // 続きから描く対象として読める
    expect(continueTargetOf(d)).toEqual({ id: r.drawing.id, kind: 'after', lessonId: null, createdAt: d!.createdAt, docId: 'og-1' });
  });

  it('続きから描いた絵は同じ id・種別・作成日時で置き換える（絵は増えない）', async () => {
    const first = await saveOgFree({ api: fakeApi(), kind: 'before', docId: 'og-1', ogContract: '0.9.0', save: repo.saveOgDrawing });
    if (first.status !== 'saved') throw new Error('first save failed');
    const target = continueTargetOf(first.drawing)!;
    const again = await saveOgFree({ api: fakeApi(), kind: 'free', docId: 'og-other', ogContract: '0.9.1', target, save: repo.saveOgDrawing });
    expect(again.status).toBe('saved');
    const all = await repo.listDrawings();
    expect(all.map((d) => d.id)).toEqual([first.drawing.id]);
    expect(all[0]!.kind).toBe('before');
    expect(all[0]!.createdAt).toBe(first.drawing.createdAt);
    expect((all[0]!.meta as { og: OgDrawingMeta }).og.docId).toBe('og-1');
    expect((all[0]!.meta as { og: OgDrawingMeta }).og.ogContract).toBe('0.9.1');
    expect((await repo.listOgDocs()).length).toBe(1);
  });

  it('容量不足（QuotaExceededError）: 何も書かれず、作った画像と文書のまま retry で保存できる（書き出しはやり直さない）', async () => {
    const proto = (globalThis as unknown as { IDBObjectStore: { prototype: { put: (...a: unknown[]) => unknown } } }).IDBObjectStore.prototype;
    const realPut = proto.put;
    proto.put = function (this: { name: string }, ...args: unknown[]) {
      if (this.name === 'ogDocs') throw new DOMException('空き容量が足りません', 'QuotaExceededError');
      return realPut.apply(this, args);
    };
    const api = fakeApi();
    let r: Awaited<ReturnType<typeof saveOgFree>>;
    try {
      r = await saveOgFree({ api, kind: 'free', docId: 'og-q', ogContract: '0.9.0', save: repo.saveOgDrawing });
    } finally {
      proto.put = realPut;
    }
    expect(r.status).toBe('failed');
    if (r.status !== 'failed') return;
    expect(r.reason).toBe('quota');
    expect(await repo.listDrawings()).toEqual([]);
    expect(await repo.listOgDocs()).toEqual([]);
    const again = await r.retry();
    expect(again.status).toBe('saved');
    expect(api.calls).toEqual(['gallery', 'serialize']);
    expect((await repo.listDrawings()).length).toBe(1);
    expect((await repo.listOgDocs()).length).toBe(1);
  });

  it('書き出し（OG 側）の失敗は failed（other）で、retry は書き出しからやり直す', async () => {
    let n = 0;
    const api = fakeApi({
      serializeProject: async () => {
        n += 1;
        if (n === 1) throw new Error('busy');
        return ognk('ok');
      },
    });
    const r = await saveOgFree({ api, kind: 'free', docId: 'og-x', ogContract: '0.9.0', save: repo.saveOgDrawing });
    expect(r).toMatchObject({ status: 'failed', reason: 'other' });
    if (r.status !== 'failed') return;
    expect((await r.retry()).status).toBe('saved');
  });

  it('ogMetaFrom は contentRect を w / h に写す。文書の id は og- で始まる', () => {
    const m = ogMetaFrom({ image: webp('a'), contentRect: { x: 1, y: 2, width: 3, height: 4 }, docSize: { width: 10, height: 20 } }, 'og-a', '0.9.0');
    expect(m).toEqual({ docId: 'og-a', docSize: { w: 10, h: 20 }, contentRect: { x: 1, y: 2, w: 3, h: 4 }, engine: 'og', ogContract: '0.9.0' });
    expect(newOgDocId(() => 'abc')).toBe('og-abc');
    expect(newOgDocId()).toMatch(/^og-.{8,}$/);
  });

  it('continueTargetOf: 新しいお絵描きの絵だけ（v2 の絵・取込画像は null）', () => {
    const base = { id: 'd', lessonId: null, kind: 'free' as const, image: webp('a'), createdAt: 't', strokes: null, updatedAt: 't' };
    expect(continueTargetOf({ ...base, meta: { doc: {} } })).toBeNull();
    expect(continueTargetOf({ ...base })).toBeNull();
    expect(continueTargetOf({ ...base, meta: { og: { engine: 'v2', docId: 'x' } } })).toBeNull();
    expect(continueTargetOf(undefined)).toBeNull();
  });
});

/** sessionStorage の代わり */
function memoryStorage(): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  };
}

describe('下書きの印（localStorage）と古い版の写しの掃除（ilust-free-contracts の『続きから / 捨てる』、S4）', () => {
  /** 古い版（M7 の局所アダプタ）が使っていた DB の形（ストア og・キー free の 1 件）を作る */
  async function seedLegacySnapshot(): Promise<void> {
    const d = await openDB(OG_DRAFT_DB, 1, {
      upgrade(x) {
        x.createObjectStore(LEGACY_SNAPSHOT_STORE, { keyPath: 'key' });
      },
    });
    await d.put(LEGACY_SNAPSHOT_STORE, { key: LEGACY_SNAPSHOT_KEY, docId: 'og-old', bytes: ognk('old'), savedAt: '2026-10-20T00:00:00.000Z', continueId: null });
    d.close();
  }
  async function legacyCount(): Promise<number> {
    const d = await openDB(OG_DRAFT_DB);
    try {
      return d.objectStoreNames.contains(LEGACY_SNAPSHOT_STORE) ? await d.count(LEGACY_SNAPSHOT_STORE) : -1;
    } finally {
      d.close();
    }
  }
  const dbNames = async () => (await indexedDB.databases()).map((d) => d.name);

  it('印を置く → 読める（engine og）。clear で印が消える', async () => {
    const storage = memoryStorage();
    const store = createOgDraftStore({ storage: () => storage, dropLegacy: async () => undefined });
    store.setMark({ engine: 'og', docId: 'og-1', savedAt: '2026-10-20T00:00:00.000Z', continueId: 'drawing-9' });
    expect(store.readMark()).toEqual({ engine: 'og', docId: 'og-1', savedAt: '2026-10-20T00:00:00.000Z', continueId: 'drawing-9' });
    expect(JSON.parse(storage.map.get(OG_DRAFT_MARK_KEY)!)).toMatchObject({ engine: 'og', docId: 'og-1' });
    await store.clear();
    expect(store.readMark()).toBeNull();
    expect(storage.map.size).toBe(0);
  });

  it('v2 の下書き（engine の無い JSON）や壊れた印は無視する', () => {
    const storage = memoryStorage();
    const store = createOgDraftStore({ storage: () => storage });
    storage.setItem(OG_DRAFT_MARK_KEY, JSON.stringify({ history: { strokes: [] }, size: { width: 1, height: 1 } }));
    expect(store.readMark()).toBeNull();
    storage.setItem(OG_DRAFT_MARK_KEY, '{not json');
    expect(store.readMark()).toBeNull();
  });

  it('印を書けない storage（容量不足・使えない）でも落ちない', async () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
    const store = createOgDraftStore({ storage: () => storage, dropLegacy: async () => undefined });
    expect(() => store.setMark({ engine: 'og', docId: 'x', savedAt: '', continueId: null })).not.toThrow();
    expect(store.readMark()).toBeNull();
    const none = createOgDraftStore({ storage: () => null, dropLegacy: async () => undefined });
    none.setMark({ engine: 'og', docId: 'x', savedAt: '', continueId: null });
    expect(none.readMark()).toBeNull();
    await expect(none.clear()).resolves.toBeUndefined();
  });

  it('古い版の写しは clear のときに消す。DB とストアは残す（名前は予約）。DB が無ければ作らない', async () => {
    // DB が無い: 何もしない（seichotsu-drafts を新しく作らない）
    expect(await dropLegacySnapshot()).toBe(false);
    expect(await dbNames()).not.toContain(OG_DRAFT_DB);
    const storage = memoryStorage();
    const store = createOgDraftStore({ storage: () => storage });
    await store.clear();
    expect(await dbNames()).not.toContain(OG_DRAFT_DB);

    // 古い版の写しがある: clear で 1 件消える。DB の版と形はそのまま（upgrade しない）
    await seedLegacySnapshot();
    expect(await legacyCount()).toBe(1);
    store.setMark({ engine: 'og', docId: 'og-old', savedAt: '2026-10-20T00:00:00.000Z', continueId: null });
    await store.clear();
    expect(store.readMark()).toBeNull();
    expect(await legacyCount()).toBe(0);
    expect(await dbNames()).toContain(OG_DRAFT_DB);
    const d = await openDB(OG_DRAFT_DB);
    expect(d.version).toBe(1);
    expect([...d.objectStoreNames]).toEqual([LEGACY_SNAPSHOT_STORE]);
    d.close();
    // databases() の無い環境・開けない環境は静かに諦める
    expect(await dropLegacySnapshot({})).toBe(false);
    expect(await dropLegacySnapshot({ databases: () => Promise.reject(new Error('x')) })).toBe(false);
  });

  it('書いている間に画面を離れた・保存した（isCurrent が false）なら印を置かない', async () => {
    const storage = memoryStorage();
    const store = createOgDraftStore({ storage: () => storage, dropLegacy: async () => undefined });
    const api: DraftApi = {
      hasContent: () => true,
      discardRecovery: async () => undefined,
      saveDraft: async () => ({ docId: 'og-j', savedAt: '2026-10-20T00:00:00.000Z' }),
      latestDraft: async () => null,
      openDraft: async () => undefined,
    };
    let alive = true;
    const keeper = createDraftKeeper({
      api: {
        ...api,
        saveDraft: async () => {
          alive = false;
          return { docId: 'og-j', savedAt: 's' };
        },
      },
      store,
      continueId: null,
    });
    await keeper.save(() => alive);
    expect(store.readMark()).toBeNull();
    // 始める前から離れていれば saveDraft も呼ばない
    let called = 0;
    const k2 = createDraftKeeper({ api: { ...api, saveDraft: async () => (called++, null) }, store, continueId: null });
    await k2.save(() => false);
    expect(called).toBe(0);
    expect(store.readMark()).toBeNull();
    // saveDraft が失敗しても落ちない（描くのは続けられる）・印は置かない
    const k3 = createDraftKeeper({ api: { ...api, saveDraft: () => Promise.reject(new DOMException('full', 'QuotaExceededError')) }, store, continueId: null });
    await expect(k3.save()).resolves.toBeUndefined();
    expect(store.readMark()).toBeNull();
  });
});

describe('設定とルート', () => {
  it('既定は新しいお絵描き（UR-002 S3）、設定で今までのお絵描き（v2）を選べる', () => {
    expect(DEFAULT_PAINT_ENGINE).toBe('og');
    expect(resolvePaintEngine({ paintEngine: 'v2' })).toBe('v2');
  });

  it('paintEngine: 未設定・不正な値は既定、続きから描く（?og=）はいつも新しいお絵描き', () => {
    expect(resolvePaintEngine(null)).toBe(DEFAULT_PAINT_ENGINE);
    expect(resolvePaintEngine({})).toBe(DEFAULT_PAINT_ENGINE);
    expect(resolvePaintEngine({ paintEngine: 'og' })).toBe('og');
    expect(resolvePaintEngine({ paintEngine: 'v2' })).toBe('v2');
    expect(resolvePaintEngine({ paintEngine: 'x' as never })).toBe(DEFAULT_PAINT_ENGINE);
    expect(freeScreenEngine('v2', 'drawing-1')).toBe('og');
    expect(freeScreenEngine('v2', undefined)).toBe('v2');
    expect(freeScreenEngine('og', undefined)).toBe('og');
  });

  it('設定の paintEngine は保存して読み直せ、古い設定（項目なし）は既定のまま', async () => {
    expect((await repo.getSettings()).paintEngine).toBeUndefined();
    await repo.updateSettings({ paintEngine: 'og' });
    expect((await repo.getSettings()).paintEngine).toBe('og');
  });

  it('#/free?og=<id> は続きから描く、?save= は今のまま', () => {
    expect(parseHash('#/free?og=drawing-1')).toEqual({ name: 'free', og: 'drawing-1' });
    expect(parseHash(href.freeContinue('a b'))).toEqual({ name: 'free', og: 'a b' });
    expect(parseHash('#/free?save=after')).toEqual({ name: 'free', save: 'after' });
    expect(parseHash('#/free')).toEqual({ name: 'free' });
  });

  it('テーマは system を端末の設定で解決する、設定はまるごと渡す', () => {
    expect(resolveEmbedTheme('system', true)).toBe('dark');
    expect(resolveEmbedTheme('system', false)).toBe('light');
    expect(resolveEmbedTheme(undefined, true)).toBe('dark');
    expect(resolveEmbedTheme('light', true)).toBe('light');
    expect(embedConfigFrom({ theme: 'dark', penOnly: true, leftHanded: true, fontScale: 'large' }, false)).toEqual({
      theme: 'dark',
      penOnly: true,
      leftHanded: true,
      fontScale: 'large',
    });
  });

  it('新しい紙は長辺 2048・150 dpi・成長通の紙色、縦横比は 0.5〜2', () => {
    expect(paperFor(1472 / 860)).toEqual({ width: 2048, height: 1197, dpi: 150, paper: OG_PAPER_COLOR });
    expect(paperFor(920 / 1412)).toEqual({ width: 1334, height: 2048, dpi: 150, paper: OG_PAPER_COLOR });
    expect(paperFor(10)).toEqual({ width: 2048, height: 1024, dpi: 150, paper: OG_PAPER_COLOR });
    expect(paperFor(0)).toEqual({ width: 2048, height: 2048, dpi: 150, paper: OG_PAPER_COLOR });
    expect(OG_PAPER_COLOR).toBe('#F2EFE8');
  });
});

describe('バックアップの互換（設定 paintEngine を足しても版 1 のまま）', () => {
  it('新 → 新で paintEngine が残り、新 → f4f1ed2 の版でも取り込める（知らない項目は捨てられる）', async () => {
    const newBackup = await import('@/data/backup');
    const oldBackup = await import('@/data/__legacy__/f4f1ed2/backup');
    const oldDb = await import('@/data/__legacy__/f4f1ed2/db');
    const oldRepo = await import('@/data/__legacy__/f4f1ed2/repo');
    await repo.updateSettings({ paintEngine: 'og', penOnly: false });
    const zip = await newBackup.exportBackupBlob();

    freshFactory();
    await newBackup.importBackup(zip, 'replace');
    expect((await repo.getSettings()).paintEngine).toBe('og');

    freshFactory();
    oldDb.resetDbForTests();
    await oldBackup.importBackup(zip, 'replace');
    const legacy = await oldRepo.getSettings();
    expect(legacy.penOnly).toBe(false);
    expect('paintEngine' in legacy).toBe(false);
    oldDb.resetDbForTests();
  });
});


describe('ilust-s4-cleanup: 局所アダプタ（親の写し・別の realm の Blob）が残っていない', () => {
  const raw = import.meta.glob<string>(['../screens/OgFreeDraw.tsx', './ogDraft.ts'], { query: '?raw', import: 'default', eager: true });
  const src = (name: string) => Object.entries(raw).find(([k]) => k.endsWith(name))?.[1] ?? '';

  it('OgFreeDraw に frameBlob が無く、続きから描くときは親の Blob（rec.bytes）をそのまま openProject に渡す', () => {
    const s = src('OgFreeDraw.tsx');
    expect(s.length).toBeGreaterThan(1000);
    expect(s).not.toMatch(/frameBlob|toFrameBlob|arrayBuffer\(\)/);
    expect(s).toContain('await api.openProject(rec.bytes);');
  });

  it("ogDraft に snapshot の持ち方と seichotsu-drafts の写しの読み書きが無い（DB の名前だけ予約）", () => {
    const s = src('ogDraft.ts');
    expect(s.length).toBeGreaterThan(1000);
    expect(s).not.toMatch(/kind: 'snapshot'|api\.serializeProject\(|\.put\(|sweepOrphan|createObjectStore/);
    expect(s).toContain("export const OG_DRAFT_DB = 'seichotsu-drafts';");
  });
});

describe('下書きの持ち方（OG のジャーナル。S4 で親の写しは外した）', () => {
  function journalApi() {
    const journal = new Map<string, { id: string; docId: string; savedAt: string; bytes: number }>();
    const calls: string[] = [];
    let content = true;
    const api: DraftApi & { setContent(v: boolean): void } = {
      setContent: (v) => void (content = v),
      hasContent: () => content,
      discardRecovery: async () => {
        calls.push('discardRecovery');
        journal.clear();
      },
      saveDraft: async () => {
        calls.push('saveDraft');
        const rec = { id: 'j-1', docId: 'og-doc-A', savedAt: '2026-10-20T01:00:00.000Z', bytes: 10 };
        journal.set(rec.id, rec);
        return { docId: rec.docId, savedAt: rec.savedAt };
      },
      latestDraft: async () => [...journal.values()].at(-1) ?? null,
      openDraft: async (id) => {
        if (!journal.has(id)) throw new Error('no draft');
        calls.push(`openDraft:${id}`);
      },
    };
    return { api, calls, journal };
  }

  it('ジャーナル: save は OG の saveDraft の docId で印を置き、restore は latestDraft と照合して openDraft、clear は discardRecovery', async () => {
    const storage = memoryStorage();
    const store = createOgDraftStore({ storage: () => storage, dropLegacy: async () => undefined });
    const { api, calls, journal } = journalApi();
    const k = createDraftKeeper({ api, store, continueId: null });
    expect(k.kind).toBe('journal');
    await k.save();
    const mark = store.readMark();
    expect(mark).toEqual({ engine: 'og', docId: 'og-doc-A', savedAt: '2026-10-20T01:00:00.000Z', continueId: null });
    expect(await k.restore(mark!)).toBe('og-doc-A');
    expect(calls).toContain('openDraft:j-1');
    // 別の文書の印では開かない
    expect(await k.restore({ ...mark!, docId: 'other' })).toBeNull();
    await k.clear();
    expect(store.readMark()).toBeNull();
    expect(journal.size).toBe(0);
    // 消えた下書きは開けない
    expect(await k.restore(mark!)).toBeNull();
    // 描いていなければ印を置かない
    api.setContent(false);
    await k.save();
    expect(store.readMark()).toBeNull();
  });

  it('続きから描く画面（continueId あり）の印には continueId が入り、sweep は印とジャーナルを消す', async () => {
    const storage = memoryStorage();
    let dropped = 0;
    const store = createOgDraftStore({ storage: () => storage, dropLegacy: async () => void dropped++ });
    const { api, journal } = journalApi();
    const k = createDraftKeeper({ api, store, continueId: 'drawing-1' });
    await k.save();
    expect(store.readMark()).toMatchObject({ docId: 'og-doc-A', continueId: 'drawing-1' });
    await k.sweep();
    expect(store.readMark()).toBeNull();
    expect(journal.size).toBe(0);
    expect(dropped).toBe(1);
  });
});
