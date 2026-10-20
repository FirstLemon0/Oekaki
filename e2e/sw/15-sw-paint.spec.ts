/**
 * Service Worker を有効にした E2E（project chromium-sw。UR-002 / ADR-0007 D7）。
 *
 * - ilust-sw-paint-passthrough: SW がページを握った後でも /paint/embed.html（埋め込みのペイント）が成長通の index.html にならない。
 *   iframe の読み込みもナビゲーションなので同じ。/share-target と SPA のナビゲーションは今のまま
 * - ilust-og-sw-absent: ペイントを開く前と後で caches.keys() の成長通の分（workbox の precache・share-target）が同じ
 * - ilust-precache-scope: precache に paint/** が無く、一度開いた後はオフラインでも #/free と /paint/embed.html が開く
 * - ilust-update-defer（og-sw-update-defer）: #/free に保存していない線があるあいだは、新しい SW が有効になっても再読み込みせず
 *   「更新があります（保存後に再読み込み）」と知らせる。保存した後に再読み込みする
 *
 * public/paint/ に本物の成果物（tools/import-paint.sh）が無いとき（S1）は、/paint/embed.html を試験用の HTML で返す
 * （context.route = SW を通り抜けて通信に出たときだけ当たる。SW が横取りすれば当たらず、成長通の index.html になって落ちる）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { drawFewStrokes, gotoApp } from '../helpers';
import { setOgEngine } from '../og-helpers';

const BUILD_JSON = fileURLToPath(new URL('../../public/paint/BUILD.json', import.meta.url));
const REAL_PAINT = existsSync(BUILD_JSON);
const DIST_SW = fileURLToPath(new URL('../../dist/sw.js', import.meta.url));
const FIXTURE_TITLE = 'og-embed-fixture';
const FIXTURE_HTML = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${FIXTURE_TITLE}</title></head><body><div id="og-embed-fixture">ペイント（試験用）</div></body></html>`;

async function routeFixture(context: BrowserContext): Promise<void> {
  if (REAL_PAINT) return;
  await context.route('**/paint/embed.html', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURE_HTML }),
  );
}

/** SW が有効になり、このページを握るまで待つ（初回は clientsClaim で握る） */
async function waitForController(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
      setTimeout(resolve, 5000);
    });
  });
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
}

/**
 * 新しい版の SW を出す: vite preview は dist を要求ごとに読む（sirv の dev）ので、dist/sw.js の末尾に 1 行足すと
 * 次の registration.update() で別の SW として入る。戻り値で元に戻す（Playwright の route は SW のスクリプトの更新の取得に当たらない）。
 */
function bumpServiceWorker(tag: string): () => void {
  const original = readFileSync(DIST_SW, 'utf8');
  writeFileSync(DIST_SW, `${original}\n// e2e update ${tag}\n`);
  return () => writeFileSync(DIST_SW, original);
}

async function embedTitleExpectation(): Promise<RegExp | string> {
  if (!REAL_PAINT) return FIXTURE_TITLE;
  return /^(?!成長通$).+/;
}

async function openEmbedInIframe(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const f = document.createElement('iframe');
        f.src = '/paint/embed.html';
        f.style.width = '400px';
        f.style.height = '300px';
        f.dataset['test'] = 'paint-iframe';
        f.onload = () => resolve(f.contentDocument?.title ?? '(no document)');
        f.onerror = () => reject(new Error('iframe error'));
        document.body.appendChild(f);
      }),
  );
}

test.describe('Service Worker と埋め込みのペイント', () => {
  test('ilust-sw-paint-passthrough: SW の制御下でも /paint/embed.html は成長通にならない（直接・iframe とも）', async ({ page, context }) => {
    await routeFixture(context);
    await gotoApp(page);
    await waitForController(page);
    await page.reload();
    await waitForController(page);

    const titleRe = await embedTitleExpectation();
    // iframe（ナビゲーションのリクエスト）
    const iframeTitle = await openEmbedInIframe(page);
    expect(iframeTitle).not.toBe('成長通');
    expect(iframeTitle).toMatch(titleRe);

    // 直接開く
    await page.goto('/paint/embed.html');
    await expect(page).not.toHaveTitle('成長通');
    await expect(page).toHaveTitle(titleRe);
    if (!REAL_PAINT) await expect(page.locator('#og-embed-fixture')).toBeVisible();

    // SPA のナビゲーションは今のまま（SW が index.html を返す。通信を切っても開く）
    await page.goto('/');
    await waitForController(page);
    await context.setOffline(true);
    try {
      await page.goto('/some/deep/path');
      await expect(page).toHaveTitle('成長通');
      await page.goto('/#/gallery');
      await expect(page.getByRole('heading', { name: 'ギャラリー' })).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  });

  test('share-target の受け口は今のまま（POST の画像は share-target のキャッシュに入り、ギャラリーへ送られる）', async ({ page }) => {
    await gotoApp(page);
    await waitForController(page);
    const r = await page.evaluate(async () => {
      // 1×1 の透明 PNG
      const png = Uint8Array.from(
        atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
        (c) => c.charCodeAt(0),
      );
      const form = new FormData();
      form.append('image', new File([png], 'shared.png', { type: 'image/png' }));
      const res = await fetch('/share-target', { method: 'POST', body: form, redirect: 'manual' });
      const has = await caches.has('share-target');
      const count = has ? (await (await caches.open('share-target')).keys()).length : 0;
      await caches.delete('share-target');
      return { type: res.type, has, count };
    });
    expect(r.type).toBe('opaqueredirect');
    expect(r.has).toBe(true);
    expect(r.count).toBe(1);
  });

  test('ilust-og-sw-absent / ilust-precache-scope: ペイントの前後で成長通のキャッシュが同じ、precache に paint/ が無く、オフラインでも開く', async ({
    page,
    context,
  }) => {
    await routeFixture(context);
    // 今までのお絵描き（v2）の #/free を確かめる（UR-002 S3 で既定が新しいお絵描きになったので設定で v2 に。新しいお絵描きは 18-og-sw）
    await setOgEngine(page, false);
    await gotoApp(page);
    await waitForController(page);
    await page.reload();
    await waitForController(page);

    const before = await page.evaluate(() => caches.keys());
    expect(before.some((k) => k.startsWith('workbox-precache'))).toBe(true);
    const precached = await page.evaluate(async () => {
      const name = (await caches.keys()).find((k) => k.startsWith('workbox-precache'))!;
      const keys = await (await caches.open(name)).keys();
      return keys.map((r) => new URL(r.url).pathname);
    });
    const paintPrecached = precached.filter((p) => p.startsWith('/paint/'));
    // 字形の .bin の明示の分だけ（成果物が無い S1 では 0 件）
    expect(paintPrecached.every((p) => /\.bin$/.test(p))).toBe(true);
    if (REAL_PAINT) {
      const build = JSON.parse(readFileSync(BUILD_JSON, 'utf8')) as { files: Record<string, string> };
      const bins = Object.keys(build.files).filter((f) => f.endsWith('.bin'));
      expect(paintPrecached.sort()).toEqual(bins.map((f) => `/paint/${f}`).sort());
    } else {
      expect(paintPrecached).toEqual([]);
    }
    // #/free の画面（遅延のチャンク）は precache にある
    expect(precached.some((p) => /\/assets\/FreeDraw-[^/]+\.js$/.test(p))).toBe(true);

    // ペイントを開く（iframe）
    const title = await openEmbedInIframe(page);
    expect(title).toMatch(await embedTitleExpectation());
    const after = await page.evaluate(() => caches.keys());
    const ilustOnly = (keys: string[]) => keys.filter((k) => !k.startsWith('og-paint-')).sort();
    expect(ilustOnly(after)).toEqual(ilustOnly(before));
    // ペイントの入口は版ごとの実行時キャッシュに入った（成長通の precache とは別）
    expect(after.some((k) => k.startsWith('og-paint-'))).toBe(true);

    // 一度開いた後はオフラインでも #/free と /paint/embed.html が開く（試験用の route は外す = SW のキャッシュから）
    await page.goto('/#/free');
    await expect(page.locator('.ls-canvas__paper canvas')).toBeVisible();
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.setOffline(true);
    try {
      await page.reload();
      await expect(page.locator('.ls-canvas__paper canvas')).toBeVisible();
      const offlineTitle = await openEmbedInIframe(page);
      expect(offlineTitle).toMatch(await embedTitleExpectation());
    } finally {
      await context.setOffline(false);
    }
  });

  test('ilust-update-defer: #/free に保存していない線があるあいだは更新で再読み込みせず、保存の後に再読み込みする', async ({ page }) => {
    // 今までのお絵描き（v2）で確かめる（新しいお絵描きの分は 18-og-sw の og-sw-update-defer）
    await setOgEngine(page, false);
    let loads = 0;
    page.on('load', () => {
      loads += 1;
    });

    await gotoApp(page);
    await waitForController(page);
    await page.reload();
    await waitForController(page);

    await page.getByRole('link', { name: /自由お絵描き/ }).click();
    const canvas = page.locator('.ls-canvas__paper canvas');
    await expect(canvas).toBeVisible();
    await drawFewStrokes(page, canvas, 2);
    await page.evaluate(() => {
      (window as unknown as { __e2eMarker: number }).__e2eMarker = 1;
    });
    const loadsBeforeUpdate = loads;

    const restore = bumpServiceWorker('defer');
    try {
      const updated = await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg) return 'no-registration';
        await reg.update();
        return 'ok';
      });
      expect(updated).toBe('ok');

      // 新しい SW が有効になった知らせ（再読み込みはしない）
      await expect(page.getByText('更新があります（保存後に再読み込み）')).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(1500);
      expect(loads).toBe(loadsBeforeUpdate);
      expect(await page.evaluate(() => (window as unknown as { __e2eMarker?: number }).__e2eMarker)).toBe(1);

      // 保存して終わる → ガードが外れて再読み込み
      const reloaded = page.waitForEvent('load', { timeout: 20_000 });
      await page.getByRole('button', { name: '終わる' }).click();
      await page.getByRole('button', { name: '保存して終わる' }).click();
      await reloaded;
      expect(await page.evaluate(() => (window as unknown as { __e2eMarker?: number }).__e2eMarker)).toBeUndefined();
      await page.locator('.loading').waitFor({ state: 'detached' }).catch(() => undefined);
      // 保存した絵は残っている（ギャラリーに 1 枚）
      await page.goto('/#/gallery');
      await expect(page.locator('.itile').first()).toBeVisible();
    } finally {
      restore();
    }
  });

  test('#/free 以外では、新しい SW が有効になったらすぐ再読み込みする（今のまま）', async ({ page }) => {
    await gotoApp(page);
    await waitForController(page);
    await page.reload();
    await waitForController(page);
    await page.evaluate(() => {
      (window as unknown as { __e2eMarker: number }).__e2eMarker = 1;
    });
    const reloaded = page.waitForEvent('load', { timeout: 20_000 });
    const restore = bumpServiceWorker('home');
    try {
      await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        await reg?.update();
      });
      await reloaded;
    } finally {
      restore();
    }
    expect(await page.evaluate(() => (window as unknown as { __e2eMarker?: number }).__e2eMarker)).toBeUndefined();
  });
});
