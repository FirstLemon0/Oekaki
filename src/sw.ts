/**
 * Service Worker（vite-plugin-pwa の injectManifest で組み立てる）。
 *
 * - precache: ビルド成果物（図解・three のチャンク・書体を含む）を self.__WB_MANIFEST から丸ごと。
 * - autoUpdate: 新しい SW はすぐ有効化してページを握る（registerType: 'autoUpdate' と対）。
 * - SPA: ナビゲーションは index.html を返す（generateSW の navigateFallback と同じ）。
 *   ただし /paint/（埋め込みのペイント = OG の成果物。iframe の読み込みもナビゲーション）は対象外にする。
 *   そうしないと iframe の中に成長通そのものが入れ子で起動する（UR-002 / ADR-0007 D7、ilust-sup-integration-01）。
 * - /paint/ は precache に入れない（vite.config の globIgnores）。/paint/assets/ は実行時のキャッシュ（CacheFirst、
 *   名前は OG の BUILD_ID ごと、件数の上限、容量不足で掃除）、/paint/*.html は NetworkFirst（一度開けばオフラインでも開ける）。
 *   字形の .bin だけは precache に明示で入れる（vite.config の additionalManifestEntries）。古い版の og-paint-* は activate で消す。
 * - install で og-paint-<buildId> に BUILD.json の assets/ の全部（.bin 以外、sha256 が一致したものだけ）を先に入れる（ilust-sup-followup-12、
 *   src/swPaint.ts）。動的 import でしか読まれないチャンクもオフライン・配信の切り替わりで読める。install は失敗させない・待つのは最大 2 分・
 *   回線の節約（Save-Data）では入れない。ページからの `{ type: 'og-paint-fill' }` の message でも足りない分を入れる（新しいお絵描きの ready の後）
 *   ほかのキャッシュ（workbox の precache・share-target）には触れない。
 * - 共有シートの受け口: POST /share-target（manifest の share_target）で届いた画像を
 *   Cache Storage の SHARE_CACHE に置き、`/#/gallery?shared=N` へ 303 で送る。
 *   アプリ側（src/ui/state.ts の importSharedImages）が起動時に読み出して取込画像として保存し、
 *   キャッシュから消す。
 *
 * tsconfig は DOM ライブラリなので、SW 固有の型はここで最小限だけ宣言する。
 */
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { clientsClaim } from 'workbox-core';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import {
  fillPaintCache,
  paintCacheMaxEntries,
  paintPrefetchList,
  PAINT_FILL_INSTALL_BUDGET_MS,
  sha256Hex,
  type FillPaintCacheResult,
} from './swPaint';

/** state.ts と同じ名前（共有で届いた画像の一時置き場） */
const SHARE_CACHE = 'share-target';
const SHARE_PREFIX = '/share-target/pending/';

/** 埋め込みのペイントの実行時キャッシュ（OG の BUILD_ID ごと。vite.config の define が public/paint/BUILD.json から入れる） */
const PAINT_CACHE_PREFIX = 'og-paint-';
const PAINT_CACHE = `${PAINT_CACHE_PREFIX}${__OG_PAINT_BUILD_ID__}`;
/** 埋め込みのファイルの一覧（BUILD.json の files = パス → sha256。vite.config の define。ペイントの無いビルドは {}） */
const PAINT_FILES: Record<string, string> = __OG_PAINT_FILES__;
/** install で先に入れる一覧（assets/ の下・.bin 以外） */
const PAINT_PREFETCH = paintPrefetchList(PAINT_FILES);
/** 実行時キャッシュの件数の上限（埋め込みのファイル数より必ず大きく、際限なく増えない値。swPaint.ts） */
const PAINT_CACHE_MAX_ENTRIES = paintCacheMaxEntries(Object.keys(PAINT_FILES).length);

interface ExtendableEventLike {
  waitUntil(p: Promise<unknown>): void;
}

interface SwScope {
  __WB_MANIFEST: Array<string | { url: string; revision: string | null }>;
  registration: { scope: string };
  location: { origin: string };
  navigator: { connection?: { saveData?: boolean } };
  skipWaiting(): Promise<void>;
  addEventListener(type: 'activate' | 'install', listener: (event: ExtendableEventLike) => void): void;
  addEventListener(type: 'message', listener: (event: ExtendableEventLike & { data: unknown }) => void): void;
}

const sw = self as unknown as SwScope;

sw.skipWaiting();
clientsClaim();

// ビルド時に workbox-build がこの `self.__WB_MANIFEST` を探して precache 一覧に置き換える（字面を変えない）
precacheAndRoute((self as unknown as SwScope).__WB_MANIFEST);
cleanupOutdatedCaches();

// SPA のナビゲーションは index.html（共有の受け口は POST なので対象外）
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/share-target/, /^\/paint\//],
  }),
);

// 埋め込みのペイント: 中身はハッシュ名のアセットなので CacheFirst。版が変われば別の名前のキャッシュになる
registerRoute(
  ({ url, request }) => request.method === 'GET' && url.origin === sw.location.origin && url.pathname.startsWith('/paint/assets/'),
  new CacheFirst({
    cacheName: PAINT_CACHE,
    plugins: [new ExpirationPlugin({ maxEntries: PAINT_CACHE_MAX_ENTRIES, purgeOnQuotaError: true })],
  }),
);
// 埋め込みの入口（/paint/embed.html ほか）: 通信できれば最新、できなければ最後に開いた版
registerRoute(
  ({ url, request }) =>
    request.method === 'GET' && url.origin === sw.location.origin && /^\/paint\/[^/]*\.html$/.test(url.pathname),
  new NetworkFirst({
    cacheName: PAINT_CACHE,
    networkTimeoutSeconds: 5,
    plugins: [new ExpirationPlugin({ maxEntries: PAINT_CACHE_MAX_ENTRIES, purgeOnQuotaError: true })],
  }),
);

// 古い版のペイントのキャッシュを消す（og-paint-* だけ。workbox の precache・share-target には触れない）
sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith(PAINT_CACHE_PREFIX) && k !== PAINT_CACHE).map((k) => caches.delete(k))),
      ),
  );
});

// 埋め込みのペイントを先に入れる（ilust-sup-followup-12）。同時に 2 本は走らせない（install と message が重なっても 1 回）
let paintFill: Promise<FillPaintCacheResult | null> | null = null;
function fillPaintOnce(): Promise<FillPaintCacheResult | null> {
  if (!paintFill) {
    paintFill = fillPaintCache({
      list: PAINT_PREFETCH,
      openCache: () => caches.open(PAINT_CACHE),
      fetch: (url) => fetch(url, { credentials: 'same-origin' }),
      digest: sha256Hex,
      saveData: sw.navigator.connection?.saveData === true,
    })
      .catch(() => null)
      .finally(() => {
        paintFill = null;
      });
  }
  return paintFill;
}

sw.addEventListener('install', (event) => {
  if (PAINT_PREFETCH.length === 0) return;
  // install は失敗させない（fillPaintCache は投げない）。待つのは最大 PAINT_FILL_INSTALL_BUDGET_MS、残りは SW が生きている間だけ続ける
  event.waitUntil(Promise.race([fillPaintOnce(), new Promise((r) => setTimeout(r, PAINT_FILL_INSTALL_BUDGET_MS))]));
});

sw.addEventListener('message', (event) => {
  const data = event.data as { type?: unknown } | null;
  if (!data || data.type !== 'og-paint-fill' || PAINT_PREFETCH.length === 0) return;
  event.waitUntil(fillPaintOnce());
});

function appUrl(hash: string): string {
  return new URL(`./${hash}`, sw.registration.scope).href;
}

async function receiveShare(request: Request): Promise<Response> {
  try {
    const form = await request.formData();
    const files = form.getAll('image').filter((f): f is File => typeof f !== 'string' && f.type.startsWith('image/'));
    const cache = await caches.open(SHARE_CACHE);
    const stamp = Date.now();
    await Promise.all(
      files.map((file, i) =>
        cache.put(
          new URL(`${SHARE_PREFIX}${stamp}-${i}`, sw.registration.scope).href,
          new Response(file, {
            headers: {
              'content-type': file.type || 'application/octet-stream',
              'x-file-name': encodeURIComponent(file.name || ''),
            },
          }),
        ),
      ),
    );
    return Response.redirect(appUrl(`#/gallery?shared=${files.length}`), 303);
  } catch {
    return Response.redirect(appUrl('#/gallery?shared=0'), 303);
  }
}

registerRoute(
  ({ url, request }) => request.method === 'POST' && url.pathname.endsWith('/share-target'),
  ({ request }) => receiveShare(request),
  'POST',
);
