/**
 * Service Worker（vite-plugin-pwa の injectManifest で組み立てる）。
 *
 * - precache: ビルド成果物（図解・three のチャンク・書体を含む）を self.__WB_MANIFEST から丸ごと。
 * - autoUpdate: 新しい SW はすぐ有効化してページを握る（registerType: 'autoUpdate' と対）。
 * - SPA: ナビゲーションは index.html を返す（generateSW の navigateFallback と同じ）。
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

/** state.ts と同じ名前（共有で届いた画像の一時置き場） */
const SHARE_CACHE = 'share-target';
const SHARE_PREFIX = '/share-target/pending/';

interface SwScope {
  __WB_MANIFEST: Array<string | { url: string; revision: string | null }>;
  registration: { scope: string };
  skipWaiting(): Promise<void>;
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
    denylist: [/^\/share-target/],
  }),
);

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
