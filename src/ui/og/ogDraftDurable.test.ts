/**
 * 下書きの印を端末に残す（ilust-sup-followup-04）と、旧お絵描きに戻した理由の記録（ilust-sup-followup-13）の試験。
 *
 * - 印は localStorage（OG_DRAFT_MARK_KEY）。M7 の sessionStorage の印（engine og）は読んだら移し、v2 の下書きには触れない
 * - 期限（24 時間）: 期限切れは掃除、期限内は「続きから / 捨てる」。印が無くても期限内のジャーナルは出す（新しい絵の画面だけ）
 * - Web Locks og-free-draft: 取れたタブだけが持ち主。取れないタブは shared の持ち方（印に触れない・掃除しない）
 * - 理由の記録: 通知の末尾「（理由: timeout）」、localStorage の { reason, at, buildId }、設定の 1 行
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  acquireDraftLock,
  createDraftKeeper,
  createOgDraftStore,
  decideDraft,
  isMarkExpired,
  LEGACY_DRAFT_MARK_KEY,
  OG_DRAFT_LOCK,
  OG_DRAFT_MARK_KEY,
  OG_DRAFT_TTL_MS,
  sharedKeeper,
  type DraftApi,
  type OgDraftMark,
} from './ogDraft';
import {
  formatFallbackLine,
  OG_FALLBACK_KEY,
  parseFallbackRecord,
  readFallback,
  recordFallback,
  withReason,
} from './fallbackReason';

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

/** 古い版の写しの掃除は og.test.ts で確かめる（ここでは呼ばれたことだけ数える） */
const noLegacy = async () => undefined;

const NOW = new Date('2026-10-22T12:00:00.000Z');
const mark = (over: Partial<OgDraftMark> = {}): OgDraftMark => ({
  engine: 'og',
  docId: 'og-doc-A',
  savedAt: '2026-10-22T11:00:00.000Z',
  continueId: null,
  ...over,
});
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

function journalApi(entries: { id: string; docId: string; savedAt: string }[] = []) {
  const journal = new Map(entries.map((e) => [e.id, { ...e, bytes: 10 }]));
  const calls: string[] = [];
  const api: DraftApi = {
    hasContent: () => true,
    discardRecovery: async () => {
      calls.push('discardRecovery');
      journal.clear();
    },
    saveDraft: async () => {
      const rec = { id: 'j-new', docId: 'og-doc-N', savedAt: NOW.toISOString(), bytes: 10 };
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

describe('印は localStorage（ilust-sup-followup-04）', () => {
  it('印は storage（localStorage）に置かれ、閉じて開き直した = 新しい store でも読める', async () => {
    const local = memoryStorage();
    const s1 = createOgDraftStore({ storage: () => local, dropLegacy: noLegacy });
    const { api } = journalApi();
    await createDraftKeeper({ api, store: s1, continueId: null }).save();
    expect(JSON.parse(local.map.get(OG_DRAFT_MARK_KEY)!)).toMatchObject({ engine: 'og', docId: 'og-doc-N' });
    // 「アプリを終了して開き直す」= 同じ端末の storage で新しい store を作る（本体は OG のジャーナル = 同じ api）
    const s2 = createOgDraftStore({ storage: () => local, dropLegacy: noLegacy });
    const m = s2.readMark();
    expect(m).toEqual({ engine: 'og', docId: 'og-doc-N', savedAt: NOW.toISOString(), continueId: null });
    const k2 = createDraftKeeper({ api, store: s2, continueId: null });
    expect(await k2.peek()).toEqual(m);
    expect(await k2.restore(m!)).toBe('og-doc-N');
  });

  it('M7 の印（sessionStorage・engine og）は読んだら localStorage に移す。v2 の下書き（同じキー）には触れない', () => {
    const local = memoryStorage();
    const session = memoryStorage();
    const store = createOgDraftStore({ storage: () => local, legacyStorage: () => session, dropLegacy: noLegacy });
    session.setItem(LEGACY_DRAFT_MARK_KEY, JSON.stringify({ history: { strokes: [] }, size: { width: 1, height: 1 }, savedAt: 'x' }));
    expect(store.readMark()).toBeNull();
    expect(session.map.has(LEGACY_DRAFT_MARK_KEY)).toBe(true);
    session.setItem(LEGACY_DRAFT_MARK_KEY, JSON.stringify(mark()));
    expect(store.readMark()).toEqual(mark());
    expect(session.map.has(LEGACY_DRAFT_MARK_KEY)).toBe(false);
    expect(JSON.parse(local.map.get(OG_DRAFT_MARK_KEY)!)).toEqual(mark());
  });

  it('ジャーナルの持ち方: save は印を storage に置き、peek は印が無くても latestDraft を印の形で返す（continueId なし）', async () => {
    const local = memoryStorage();
    const store = createOgDraftStore({ storage: () => local, dropLegacy: noLegacy });
    const { api } = journalApi([{ id: 'j-1', docId: 'og-doc-A', savedAt: hoursAgo(1) }]);
    const k = createDraftKeeper({ api, store, continueId: 'drawing-1' });
    expect(await k.peek()).toEqual({ engine: 'og', docId: 'og-doc-A', savedAt: hoursAgo(1), continueId: null });
    await k.save();
    expect(store.readMark()).toMatchObject({ docId: 'og-doc-N', continueId: 'drawing-1' });
    await k.sweep();
    expect(store.readMark()).toBeNull();
    expect(await k.peek()).toBeNull();
  });
});

describe('開いたときの判断 decideDraft（掃除は期限切れか残っているものが無いときだけ）', () => {
  it.each([
    ['印も記録も無い → 掃除（消すものが無い）', { mark: null, found: null, continueId: null }, { kind: 'sweep', reason: 'none' }],
    ['期限内の印・同じ画面 → 出す', { mark: mark(), found: null, continueId: null }, { kind: 'offer', mark: mark() }],
    ['期限内の印・別の画面 → 触らない', { mark: mark({ continueId: 'drawing-1' }), found: null, continueId: null }, { kind: 'keep' }],
    ['期限切れの印 → 掃除', { mark: mark({ savedAt: hoursAgo(25) }), found: null, continueId: null }, { kind: 'sweep', reason: 'expired' }],
    ['読めない savedAt → 期限切れ', { mark: mark({ savedAt: '' }), found: null, continueId: null }, { kind: 'sweep', reason: 'expired' }],
    ['印が無く期限内のジャーナル（新しい絵の画面）→ 出す', { mark: null, found: mark(), continueId: null }, { kind: 'offer', mark: mark() }],
    ['印が無く期限内のジャーナル（続きから描く画面）→ 触らない', { mark: null, found: mark(), continueId: 'drawing-1' }, { kind: 'keep' }],
    ['印が無く期限切れのジャーナル → 掃除', { mark: null, found: mark({ savedAt: hoursAgo(30) }), continueId: null }, { kind: 'sweep', reason: 'expired' }],
  ] as const)('%s', (_label, input, want) => {
    expect(decideDraft({ ...input, now: NOW })).toEqual(want);
  });

  it('期限の境目（24 時間ちょうどは期限内、1 ms 過ぎたら期限切れ）。未来の時刻は期限内', () => {
    const at = (ms: number) => ({ savedAt: new Date(NOW.getTime() - ms).toISOString() });
    expect(isMarkExpired(at(OG_DRAFT_TTL_MS), NOW)).toBe(false);
    expect(isMarkExpired(at(OG_DRAFT_TTL_MS + 1), NOW)).toBe(true);
    expect(isMarkExpired(at(-60_000), NOW)).toBe(false);
  });
});

describe('Web Locks og-free-draft（取れたタブだけが持ち主）', () => {
  /** navigator.locks の偽物（名前ごとに 1 つ、待ち行列つき、signal で取り下げ） */
  function fakeLocks() {
    const held = new Map<string, boolean>();
    const queue = new Map<string, (() => void)[]>();
    const requests: string[] = [];
    return {
      requests,
      request(name: string, options: { signal?: AbortSignal; ifAvailable?: boolean }, cb: (lock: unknown) => Promise<void>) {
        requests.push(name);
        return new Promise<unknown>((resolve, reject) => {
          const grant = () => {
            held.set(name, true);
            void cb({ name }).then(() => {
              held.set(name, false);
              const next = queue.get(name)?.shift();
              next?.();
              resolve(undefined);
            });
          };
          if (!held.get(name)) return grant();
          if (options.ifAvailable) return void cb(null).then(() => resolve(undefined));
          queue.set(name, [...(queue.get(name) ?? []), grant]);
          options.signal?.addEventListener('abort', () => {
            queue.set(
              name,
              (queue.get(name) ?? []).filter((g) => g !== grant),
            );
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      },
    };
  }

  it('最初のタブは取れ、2 つ目のタブは待ち時間の後に held = false。1 つ目が手放すと次は取れる', async () => {
    const locks = fakeLocks();
    const a = await acquireDraftLock(locks, 50);
    expect(a.held).toBe(true);
    expect(locks.requests).toEqual([OG_DRAFT_LOCK]);
    const b = await acquireDraftLock(locks, 50);
    expect(b.held).toBe(false);
    a.release();
    await new Promise((r) => setTimeout(r, 0));
    const c = await acquireDraftLock(locks, 50);
    expect(c.held).toBe(true);
    c.release();
  });

  it('待っている間に前のタブが手放せば取れる（再読み込みの直後）', async () => {
    const locks = fakeLocks();
    const a = await acquireDraftLock(locks, 1000);
    const pending = acquireDraftLock(locks, 1000);
    setTimeout(() => a.release(), 20);
    expect((await pending).held).toBe(true);
  });

  it('Web Locks の無い環境では持ち主として扱う（M7 までと同じ）', async () => {
    expect((await acquireDraftLock(null)).held).toBe(true);
  });

  it('shared の持ち方: 印と下書きに触れず、掃除しない。離れるときの discardRecovery は今の文書のためだけ', async () => {
    const local = memoryStorage();
    const store = createOgDraftStore({ storage: () => local, dropLegacy: noLegacy });
    store.setMark(mark());
    const { api, calls, journal } = journalApi([{ id: 'j-1', docId: 'og-doc-A', savedAt: hoursAgo(1) }]);
    const k = sharedKeeper(api);
    expect(k.kind).toBe('shared');
    await k.save();
    await k.sweep();
    expect(await k.peek()).toBeNull();
    expect(await k.restore(mark())).toBeNull();
    expect(store.readMark()).toEqual(mark());
    expect(journal.size).toBe(1);
    await k.clear();
    expect(calls).toEqual(['discardRecovery']);
    expect(store.readMark()).toEqual(mark());
  });
});

describe('旧お絵描きに戻した理由（ilust-sup-followup-13）', () => {
  it('通知の末尾に「（理由: …）」', () => {
    expect(withReason('新しいお絵描きを開けなかったので、今までのお絵描きで開きました。', 'timeout')).toBe(
      '新しいお絵描きを開けなかったので、今までのお絵描きで開きました。（理由: timeout）',
    );
  });

  it('localStorage に { reason, at, buildId } を残し、読み戻して設定の 1 行にする', () => {
    const local = memoryStorage();
    const rec = recordFallback(local, 'boot', 'baabbe0ab899-0123456789ab', NOW);
    expect(JSON.parse(local.map.get(OG_FALLBACK_KEY)!)).toEqual({ reason: 'boot', at: NOW.toISOString(), buildId: 'baabbe0ab899-0123456789ab' });
    expect(readFallback(local)).toEqual(rec);
    const line = formatFallbackLine(rec);
    expect(line).toMatch(/^最後に今までのお絵描きに戻った理由: boot（埋め込みのペイントの起動に失敗）・\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}・版 baabbe0ab899-0123456789ab$/);
    // buildId が無ければ none
    expect(recordFallback(local, 'missing', null, NOW).buildId).toBe('none');
  });

  it('壊れた記録・知らない理由は読まない。書けない storage でも落ちない', () => {
    expect(parseFallbackRecord('{bad')).toBeNull();
    expect(parseFallbackRecord(JSON.stringify({ reason: 'weird', at: NOW.toISOString() }))).toBeNull();
    expect(parseFallbackRecord(JSON.stringify({ reason: 'version', at: 'not-a-date' }))).toBeNull();
    const broken = memoryStorage();
    broken.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
    expect(() => recordFallback(broken, 'timeout', 'x', NOW)).not.toThrow();
    expect(readFallback(null)).toBeNull();
  });
});
