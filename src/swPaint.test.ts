/**
 * SW の install で埋め込みのペイントを先に入れる（ilust-sup-followup-12、src/swPaint.ts）の試験。
 *
 * - 一覧: BUILD.json の assets/ の下・.bin（precache 済み）と embed.html（NetworkFirst）を除く・形の正しいものだけ
 * - 件数の上限: 埋め込みのファイル数より必ず大きい（今の public/paint/BUILD.json でも確かめる）
 * - 埋め方: 足りない分だけ取りに行く・sha256 が一致したものだけ入れる・200 以外と通信の失敗は数えるだけ・Save-Data では何もしない・
 *   同時に取りに行く数の上限・キャッシュが開けなくても投げない
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  fillPaintCache,
  paintCacheMaxEntries,
  paintPrefetchList,
  PAINT_CACHE_MIN_ENTRIES,
  PAINT_FILL_CONCURRENCY,
  sha256Hex,
  type PaintCacheLike,
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
