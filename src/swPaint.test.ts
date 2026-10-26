/**
 * SW の install で埋め込みのペイントを先に入れる（ilust-sup-followup-12、src/swPaint.ts）の試験。
 *
 * - 一覧: BUILD.json の assets/ の下・.bin（precache 済み）と embed.html（NetworkFirst）を除く・形の正しいものだけ
 * - 件数の上限: 埋め込みのファイル数より必ず大きい（今の public/paint/BUILD.json でも確かめる）
 * - 埋め方: 足りない分だけ取りに行く・sha256 が一致したものだけ入れる・200 以外と通信の失敗は数えるだけ・Save-Data では何もしない・
 *   同時に取りに行く数の上限・キャッシュが開けなくても投げない
 * - ilust-prefetch-conditions（ilust-sup-followup-09）: install は Save-Data・遅い回線（slow-2g / 2g / 3g）・モバイル回線（cellular）で止め、
 *   新しいお絵描きの ready の後の message は Save-Data のときだけ止める
 * - ilust-sw-keep-previous（ilust-sup-followup-02）: activate で今の版と 1 つ前の版の og-paint-* を残し、古い版のページ（activate の時に
 *   開いていた client）が残っていなければ 1 つ前を消す。/paint/assets/ は今のキャッシュに無ければ 1 つ前から先に探す
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  fillPaintCache,
  matchInPaintCaches,
  paintCacheMaxEntries,
  paintFillSkipReason,
  paintPrefetchList,
  parsePaintCacheMeta,
  planPaintActivate,
  planPaintPrune,
  PAINT_CACHE_MIN_ENTRIES,
  PAINT_FILL_CONCURRENCY,
  sha256Hex,
  type CacheStorageLike,
  type PaintCacheLike,
  type PaintCacheMeta,
  type PaintFileEntry,
} from './swPaint';

/** 今の成果物の BUILD.json（無いビルド = S1 では undefined） */
const builds = import.meta.glob<{ files: Record<string, string> }>('../public/paint/BUILD.json', { eager: true, import: 'default' });
const BUILD = Object.values(builds)[0];

const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
/** 試験で使う文字列の sha256（beforeAll で先に計算する） */
const HASH = new Map<string, string>();
const hex = (s: string): string => {
  const h = HASH.get(s);
  if (!h) throw new Error(`hash not prepared: ${s}`);
  return h;
};
beforeAll(async () => {
  const words = ['html', 'a', 'b', 'bin', 'css', 'txt', 'deep', 'esc', 'x', ...'abcdef'.split('').map((c) => `body-${c}`)];
  for (let i = 0; i < 20; i++) words.push(`m${i}`);
  for (const w of words) HASH.set(w, await sha256Hex(enc(w)));
});

function memoryCache(initial: Record<string, string> = {}) {
  const map = new Map<string, Response>(Object.entries(initial).map(([k, v]) => [k, new Response(v)]));
  const puts: string[] = [];
  const cache: PaintCacheLike = {
    match: async (url) => map.get(url)?.clone(),
    put: async (url, res) => {
      puts.push(url);
      map.set(url, res);
    },
  };
  return { cache, map, puts };
}

/** 配信の偽物（パス → 本文。無ければ 404。数と同時の本数を数える） */
function fakeServer(bodies: Record<string, string>, opts: { delayMs?: number; throwOn?: string } = {}) {
  let inFlight = 0;
  let maxInFlight = 0;
  const requested: string[] = [];
  const fetch = async (url: string): Promise<Response> => {
    requested.push(url);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((r) => setTimeout(r, opts.delayMs ?? 0));
      if (url === opts.throwOn) throw new TypeError('network');
      const body = bodies[url];
      if (body === undefined) return new Response('not found', { status: 404 });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/javascript' } });
    } finally {
      inFlight -= 1;
    }
  };
  return { fetch, requested, get maxInFlight() {
    return maxInFlight;
  } };
}

describe('ilust-warm-lazy-chunks: 先に入れる一覧（paintPrefetchList）と件数の上限', () => {
  it('assets/ の下だけ・.bin と embed.html を除く・sha256 の形が正しいものだけ・名前順', () => {
    const files = {
      'embed.html': hex('html'),
      'assets/b-2.js': hex('b'),
      'assets/a-1.js': hex('a'),
      'assets/glyphs-x.bin': hex('bin'),
      'assets/style-1.css': hex('css'),
      'assets/OFL-1.txt': hex('txt'),
      'assets/sub/deep.js': hex('deep'),
      'assets/../escape.js': hex('esc'),
      'assets/bad-hash.js': 'zz',
      'other/x.js': hex('x'),
    };
    expect(paintPrefetchList(files).map((e) => e.url)).toEqual([
      '/paint/assets/OFL-1.txt',
      '/paint/assets/a-1.js',
      '/paint/assets/b-2.js',
      '/paint/assets/style-1.css',
    ]);
    expect(paintPrefetchList(files)[1]).toEqual({ url: '/paint/assets/a-1.js', sha256: hex('a') });
    expect(paintPrefetchList({})).toEqual([]);
    expect(paintPrefetchList(null)).toEqual([]);
  });

  it('件数の上限はファイル数より必ず大きい（下限 300、多ければファイル数の 2 倍）', () => {
    expect(paintCacheMaxEntries(0)).toBe(PAINT_CACHE_MIN_ENTRIES);
    expect(paintCacheMaxEntries(149)).toBe(PAINT_CACHE_MIN_ENTRIES);
    expect(paintCacheMaxEntries(149)).toBeGreaterThan(149);
    expect(paintCacheMaxEntries(400)).toBe(800);
    expect(paintCacheMaxEntries(Number.NaN)).toBe(PAINT_CACHE_MIN_ENTRIES);
  });

  it.runIf(BUILD !== undefined)('今の成果物（public/paint/BUILD.json）: JS のチャンクは全部入り、件数の上限はファイル数より大きい', () => {
    const build = BUILD!;
    const all = Object.keys(build.files);
    const list = paintPrefetchList(build.files);
    const js = all.filter((f) => /^assets\/.+\.js$/.test(f));
    expect(js.length).toBeGreaterThan(100);
    // JS のチャンクは 1 本も漏れない（動的 import でしか読まれないものを含む）
    expect(list.filter((e) => e.url.endsWith('.js')).map((e) => e.url).sort()).toEqual(js.map((f) => `/paint/${f}`).sort());
    // 除くのは .bin（precache）と embed.html（NetworkFirst）だけ
    expect(all.length - list.length).toBe(all.filter((f) => f.endsWith('.bin') || !f.startsWith('assets/')).length);
    expect(paintCacheMaxEntries(all.length)).toBeGreaterThan(all.length);
  });
});

describe('ilust-warm-lazy-chunks: 埋め方（fillPaintCache）', () => {
  let list: PaintFileEntry[] = [];
  let bodies: Record<string, string> = {};
  beforeAll(() => {
    list = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => ({ url: `/paint/assets/${n}.js`, sha256: hex(`body-${n}`) }));
    bodies = Object.fromEntries(list.map((e) => [e.url, `body-${e.url.slice(-4, -3)}`]));
  });

  it('足りない分だけ取りに行き、sha256 が合うものを入れる（2 回目は 0 件）', async () => {
    const { cache, map } = memoryCache({ '/paint/assets/a.js': 'body-a' });
    const server = fakeServer(bodies);
    const r1 = await fillPaintCache({ list, openCache: async () => cache, fetch: server.fetch, digest: sha256Hex });
    expect(r1).toEqual({ skipped: false, added: 5, present: 1, failed: 0, mismatched: 0 });
    expect(server.requested.sort()).toEqual(list.slice(1).map((e) => e.url).sort());
    expect(await map.get('/paint/assets/c.js')!.clone().text()).toBe('body-c');
    expect(map.get('/paint/assets/c.js')!.headers.get('content-type')).toBe('text/javascript');
    const r2 = await fillPaintCache({ list, openCache: async () => cache, fetch: server.fetch, digest: sha256Hex });
    expect(r2).toEqual({ skipped: false, added: 0, present: 6, failed: 0, mismatched: 0 });
    expect(server.requested).toHaveLength(5);
  });

  it('中身が違う（配信の切り替わり・SPA の index.html）・404・通信の失敗は入れずに数えるだけ', async () => {
    const { cache, puts } = memoryCache();
    const server = fakeServer({ ...bodies, '/paint/assets/b.js': '<!doctype html>成長通', '/paint/assets/c.js': undefined as never }, { throwOn: '/paint/assets/d.js' });
    const r = await fillPaintCache({ list, openCache: async () => cache, fetch: server.fetch, digest: sha256Hex });
    expect(r).toEqual({ skipped: false, added: 3, present: 0, failed: 2, mismatched: 1 });
    expect(puts.sort()).toEqual(['/paint/assets/a.js', '/paint/assets/e.js', '/paint/assets/f.js']);
  });

  it('回線の節約（Save-Data）では何もしない', async () => {
    const { cache, puts } = memoryCache();
    const server = fakeServer(bodies);
    const r = await fillPaintCache({ list, openCache: async () => cache, fetch: server.fetch, digest: sha256Hex, saveData: true });
    expect(r.skipped).toBe('save-data');
    expect(server.requested).toEqual([]);
    expect(puts).toEqual([]);
  });

  it(`同時に取りに行くのは ${PAINT_FILL_CONCURRENCY} 本まで（指定すればその数）`, async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ url: `/paint/assets/m${i}.js`, sha256: hex(`m${i}`) }));
    const server = fakeServer(Object.fromEntries(many.map((e, i) => [e.url, `m${i}`])), { delayMs: 2 });
    const r = await fillPaintCache({ list: many, openCache: async () => memoryCache().cache, fetch: server.fetch, digest: sha256Hex });
    expect(r.added).toBe(20);
    expect(server.maxInFlight).toBe(PAINT_FILL_CONCURRENCY);
    const one = fakeServer(Object.fromEntries(many.map((e, i) => [e.url, `m${i}`])), { delayMs: 1 });
    await fillPaintCache({ list: many, openCache: async () => memoryCache().cache, fetch: one.fetch, digest: sha256Hex, concurrency: 1 });
    expect(one.maxInFlight).toBe(1);
  });

  it('キャッシュを開けない・書けないときも投げない（install を失敗させない）', async () => {
    const server = fakeServer(bodies);
    const r = await fillPaintCache({ list, openCache: () => Promise.reject(new DOMException('full', 'QuotaExceededError')), fetch: server.fetch, digest: sha256Hex });
    expect(r).toMatchObject({ added: 0, failed: list.length });
    const broken: PaintCacheLike = { match: async () => undefined, put: () => Promise.reject(new DOMException('full', 'QuotaExceededError')) };
    const r2 = await fillPaintCache({ list, openCache: async () => broken, fetch: server.fetch, digest: sha256Hex });
    expect(r2).toMatchObject({ added: 0, failed: list.length });
    expect(await fillPaintCache({ list: [], openCache: async () => broken, fetch: server.fetch, digest: sha256Hex })).toEqual({
      skipped: false,
      added: 0,
      present: 0,
      failed: 0,
      mismatched: 0,
    });
  });

  it('sha256Hex は FIPS 180-2 の試験ベクトル（"abc"・空）と同じ値', async () => {
    expect(await sha256Hex(enc('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256Hex(enc(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('ilust-prefetch-conditions: 先に入れるのを止める条件（ilust-sup-followup-09）', () => {
  it.each([
    [undefined, null, null],
    [{}, null, null],
    [{ effectiveType: '4g', type: 'wifi' }, null, null],
    [{ saveData: true, effectiveType: '4g' }, 'save-data', 'save-data'],
    [{ effectiveType: 'slow-2g' }, 'slow-connection', null],
    [{ effectiveType: '2g' }, 'slow-connection', null],
    [{ effectiveType: '3g' }, 'slow-connection', null],
    [{ type: 'cellular', effectiveType: '4g' }, 'cellular', null],
    [{ type: 'ethernet', effectiveType: '3g' }, 'slow-connection', null],
  ] as const)('connection %j: install → %s、message → %s', (conn, install, message) => {
    expect(paintFillSkipReason(conn, 'install')).toBe(install);
    expect(paintFillSkipReason(conn, 'message')).toBe(message);
  });

  it('止める理由があれば何も取りに行かず、その理由を返す（message の埋め方は今までどおり埋める）', async () => {
    const list = [{ url: '/paint/assets/a.js', sha256: hex('body-a') }];
    const server = fakeServer({ '/paint/assets/a.js': 'body-a' });
    const { cache, puts } = memoryCache();
    const skipped = await fillPaintCache({ list, openCache: async () => cache, fetch: server.fetch, digest: sha256Hex, skip: paintFillSkipReason({ type: 'cellular' }, 'install') });
    expect(skipped).toEqual({ skipped: 'cellular', added: 0, present: 0, failed: 0, mismatched: 0 });
    expect(server.requested).toEqual([]);
    const filled = await fillPaintCache({ list, openCache: async () => cache, fetch: server.fetch, digest: sha256Hex, skip: paintFillSkipReason({ type: 'cellular' }, 'message') });
    expect(filled).toEqual({ skipped: false, added: 1, present: 0, failed: 0, mismatched: 0 });
    expect(puts).toEqual(['/paint/assets/a.js']);
  });
});

describe('ilust-sw-keep-previous: 1 つ前の版の og-paint-* を残す（ilust-sup-followup-02）', () => {
  const A = 'og-paint-aaaa';
  const B = 'og-paint-bbbb';
  const C = 'og-paint-cccc';
  const OTHER = ['workbox-precache-v2-https://x/', 'share-target'];

  it('記録なし（前の SW から）: 今の版以外の og-paint-* を 1 つ前として残し、その時のページを記録する。ほかのキャッシュには触れない', () => {
    const plan = planPaintActivate([...OTHER, A, B], B, null, ['page-1', 'frame-1']);
    expect(plan.remove).toEqual([]);
    expect(plan.meta).toEqual({ v: 1, current: B, previous: [A], oldClients: ['page-1', 'frame-1'] });
  });

  it('版が変わった: 今までの今が 1 つ前になり、その前の 1 つ前は消す（次の activate で消す）', () => {
    const meta: PaintCacheMeta = { v: 1, current: B, previous: [A], oldClients: ['page-0'] };
    const plan = planPaintActivate([A, B, C], C, meta, ['page-1']);
    expect(plan.remove).toEqual([A]);
    expect(plan.meta).toEqual({ v: 1, current: C, previous: [B], oldClients: ['page-1'] });
  });

  it('SW のバイトだけが変わった（ペイントの版が同じ）: 1 つ前と古い版のページの記録をそのまま引き継ぐ', () => {
    const meta: PaintCacheMeta = { v: 1, current: B, previous: [A], oldClients: ['page-0'] };
    const plan = planPaintActivate([A, B], B, meta, ['page-0', 'page-1']);
    expect(plan.remove).toEqual([]);
    expect(plan.meta).toEqual(meta);
  });

  it('記録の 1 つ前がもう無い（消されていた）なら 1 つ前なし・記録するページもなし', () => {
    const plan = planPaintActivate([C], C, { v: 1, current: B, previous: [], oldClients: [] }, ['page-1']);
    expect(plan).toEqual({ remove: [], meta: { v: 1, current: C, previous: [], oldClients: [] } });
  });

  it('古い版のページが 1 つでも開いていれば 1 つ前を残し（生きている id だけに縮める）、無くなったら消す', () => {
    const meta: PaintCacheMeta = { v: 1, current: B, previous: [A], oldClients: ['page-1', 'frame-1'] };
    // 保留中の描きかけのページ（とその iframe）がまだある。新しいページ page-2 から message が来ても消さない
    const keep = planPaintPrune(meta, ['page-1', 'frame-1', 'page-2']);
    expect(keep.remove).toEqual([]);
    expect(keep.meta).toEqual(meta);
    const shrink = planPaintPrune(meta, ['frame-1', 'page-2']);
    expect(shrink).toEqual({ remove: [], meta: { ...meta, oldClients: ['frame-1'] } });
    // 保存して再読み込みした（古い版のページが無い）→ 1 つ前を消す
    const gone = planPaintPrune(meta, ['page-2', 'frame-2']);
    expect(gone).toEqual({ remove: [A], meta: { v: 1, current: B, previous: [], oldClients: [] } });
  });

  it('activate の時に開いているページが無い（閉じた後の更新）なら 1 つ前もすぐ消せる', () => {
    const plan = planPaintActivate([A, B], B, { v: 1, current: A, previous: [], oldClients: [] }, []);
    expect(plan.meta.previous).toEqual([A]);
    expect(planPaintPrune(plan.meta, []).remove).toEqual([A]);
  });

  it('記録の JSON は形が違えば読まない', () => {
    expect(parsePaintCacheMeta({ v: 1, current: B, previous: [A], oldClients: ['x'] })).toEqual({ v: 1, current: B, previous: [A], oldClients: ['x'] });
    for (const bad of [null, 1, {}, { v: 2, current: B, previous: [], oldClients: [] }, { v: 1, current: B, previous: [1], oldClients: [] }, { v: 1, previous: [], oldClients: [] }]) {
      expect(parsePaintCacheMeta(bad)).toBeNull();
    }
  });

  it('matchInPaintCaches: 今のキャッシュ以外の og-paint-* を 1 つ前から先に探し、無ければ undefined。ほかのキャッシュは見ない', async () => {
    const stores: Record<string, Record<string, string>> = {
      [A]: { '/paint/assets/x.js': 'from-A' },
      [C]: { '/paint/assets/x.js': 'from-C', '/paint/assets/y.js': 'from-C' },
      [B]: { '/paint/assets/z.js': 'from-B' },
      'share-target': { '/paint/assets/w.js': 'nope' },
    };
    const opened: string[] = [];
    const storage: CacheStorageLike = {
      keys: async () => Object.keys(stores),
      open: async (name) => {
        opened.push(name);
        return { match: async (req) => (stores[name]?.[String(req)] !== undefined ? new Response(stores[name]![String(req)]) : undefined) };
      },
    };
    expect(await (await matchInPaintCaches(storage, '/paint/assets/x.js', B, [C]))!.text()).toBe('from-C');
    expect(await (await matchInPaintCaches(storage, '/paint/assets/x.js', B, [A]))!.text()).toBe('from-A');
    expect(await (await matchInPaintCaches(storage, '/paint/assets/y.js', B))!.text()).toBe('from-C');
    opened.length = 0;
    expect(await matchInPaintCaches(storage, '/paint/assets/z.js', B)).toBeUndefined();
    expect(await matchInPaintCaches(storage, '/paint/assets/w.js', B)).toBeUndefined();
    expect(opened).not.toContain(B);
    expect(opened).not.toContain('share-target');
    const broken: CacheStorageLike = { keys: () => Promise.reject(new Error('x')), open: () => Promise.reject(new Error('x')) };
    expect(await matchInPaintCaches(broken, '/paint/assets/x.js', B)).toBeUndefined();
  });
});
