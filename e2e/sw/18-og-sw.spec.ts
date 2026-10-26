/**
 * Service Worker を有効にした新しいお絵描き（project chromium-sw、UR-002 S2 / ADR-0007 D7）。
 *
 * - og-sw-update-defer（受け入れ ilust-update-defer の新しいお絵描きの分）: #/free（埋め込みのペイント）に保存していない絵があるあいだは、
 *   新しい SW が有効になっても再読み込みせず「更新があります（保存後に再読み込み）」と知らせる。保存した後に再読み込みする
 * - ilust-precache-scope の新しいお絵描きの分: 一度開いた後は通信を切っても #/free の新しいお絵描きが開いて描ける
 *   （/paint/assets/ は SW の実行時キャッシュ、/paint/embed.html は NetworkFirst の写し）
 * - ilust-sup-followup-12: SW の install で og-paint-<buildId> に BUILD.json の assets/ の全部（.bin 以外）が先に入る。
 *   新しいお絵描きを一度も開かずに通信を切っても、動的 import でしか読まれないチャンクを含めて全部キャッシュから読める（中身は BUILD.json の sha256 と一致）
 * - ilust-sw-keep-previous（ilust-sup-followup-02）: ペイントの buildId とアセットのハッシュ名が替わった版（B）が配信されても、更新を保留中の
 *   描きかけのページ（A）は、まだ読んでいない A のチャンクを読める（og-paint-A を残し、/paint/assets/ は全部の og-paint-* を見る）。
 *   A のページが残っている間は message が来ても消さず、保存して再読み込みした（A のページが無い）後に og-paint-A を消す
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { gotoApp } from '../helpers';
import { drawOg, OG_ROOT, ogFrame, setOgEngine, waitOgContent } from '../og-helpers';

const DIST_SW = fileURLToPath(new URL('../../dist/sw.js', import.meta.url));
const BUILD_JSON = fileURLToPath(new URL('../../public/paint/BUILD.json', import.meta.url));

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

/** dist/sw.js に 1 行足して新しい版の SW を出す（戻り値で元に戻す。15-sw-paint と同じ方法） */
function bumpServiceWorker(tag: string): () => void {
  const original = readFileSync(DIST_SW, 'utf8');
  writeFileSync(DIST_SW, `${original}\n// e2e update ${tag}\n`);
  return () => writeFileSync(DIST_SW, original);
}

test.describe('Service Worker と新しいお絵描き', () => {
  test('og-sw-update-defer: 新しいお絵描きに保存していない絵があるあいだは再読み込みせず、保存の後に再読み込みする', async ({ page }) => {
    await setOgEngine(page, true);
    await gotoApp(page);
    await waitForController(page);
    await page.reload();
    await waitForController(page);

    let loads = 0;
    page.on('load', () => {
      loads += 1;
    });
    const frame = await openOgFreeHere(page);
    await drawOg(page, 2);
    await waitOgContent(frame);
    await page.evaluate(() => {
      (window as unknown as { __e2eMarker: number }).__e2eMarker = 1;
    });
    const loadsBefore = loads;

    const restore = bumpServiceWorker('og-defer');
    try {
      expect(
        await page.evaluate(async () => {
          const reg = await navigator.serviceWorker.getRegistration();
          if (!reg) return 'no-registration';
          await reg.update();
          return 'ok';
        }),
      ).toBe('ok');
      await expect(page.getByText('更新があります（保存後に再読み込み）')).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(1500);
      expect(loads).toBe(loadsBefore);
      expect(await page.evaluate(() => (window as unknown as { __e2eMarker?: number }).__e2eMarker)).toBe(1);
      // 描いた絵はそのまま
      expect(await frame.evaluate(() => (window as unknown as { ogEmbed: { hasContent(): boolean } }).ogEmbed.hasContent())).toBe(true);

      const reloaded = page.waitForEvent('load', { timeout: 20_000 });
      await page.getByRole('button', { name: '終わる' }).click();
      await page.getByRole('dialog', { name: '終わる' }).getByRole('button', { name: '保存して終わる' }).click();
      await reloaded;
      expect(await page.evaluate(() => (window as unknown as { __e2eMarker?: number }).__e2eMarker)).toBeUndefined();
      await page.locator('.loading').waitFor({ state: 'detached' }).catch(() => undefined);
      await page.goto('/#/gallery');
      await expect(page.locator('.itile').first()).toBeVisible();
    } finally {
      restore();
    }
  });

  test('一度開いた後は通信を切っても新しいお絵描きが開いて描ける（/paint/ は実行時のキャッシュ）', async ({ page, context }) => {
    await setOgEngine(page, true);
    await gotoApp(page);
    await waitForController(page);
    await page.reload();
    await waitForController(page);
    // 通信がある間に一度開く（実行時のキャッシュに入る）
    await openOgFreeHere(page);
    const cached = await page.evaluate(async () => {
      const names = (await caches.keys()).filter((k) => k.startsWith('og-paint-'));
      let n = 0;
      for (const name of names) n += (await (await caches.open(name)).keys()).length;
      return n;
    });
    expect(cached).toBeGreaterThan(3);
    await page.goto('/#/');
    await context.setOffline(true);
    try {
      await page.reload();
      const frame = await openOgFreeHere(page);
      await drawOg(page, 1);
      await waitOgContent(frame);
    } finally {
      await context.setOffline(false);
    }
  });
});

test('ilust-warm-lazy-chunks: SW の install で埋め込みの assets/ を全部先に入れ、開く前に通信を切っても全部読める（ilust-sup-followup-12）', async ({ page, context }) => {
  test.skip(!existsSync(BUILD_JSON), '成果物（public/paint/）を取り込んでいないビルド');
  const build = JSON.parse(readFileSync(BUILD_JSON, 'utf8')) as { buildId: string; files: Record<string, string> };
  const want = Object.keys(build.files)
    .filter((f) => f.startsWith('assets/') && !f.endsWith('.bin'))
    .map((f) => `/paint/${f}`)
    .sort();
  expect(want.filter((u) => u.endsWith('.js')).length).toBeGreaterThan(100);
  // 新しいお絵描きを開かない（今までのお絵描きの設定・ホームだけ）
  await setOgEngine(page, false);
  await gotoApp(page);
  await waitForController(page);
  const cacheName = `og-paint-${build.buildId}`;
  // install で入る（ホームしか開いていない = 実行時の CacheFirst では入らない）
  await expect
    .poll(
      async () =>
        page.evaluate(async (name) => {
          if (!(await caches.has(name))) return [];
          return (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname).sort();
        }, cacheName),
      { timeout: 60_000 },
    )
    .toEqual(want);
  // 通信を切っても、まだ一度も読んでいないチャンク（動的 import でしか読まれないものを含む）が全部 SW から読め、中身は BUILD.json と一致する
  await context.setOffline(true);
  try {
    const bad = await page.evaluate(
      async ({ urls, files }) => {
        const out: string[] = [];
        for (const u of urls) {
          const res = await fetch(u).catch(() => null);
          if (!res || res.status !== 200) {
            out.push(`${u}: ${res ? res.status : 'network'}`);
            continue;
          }
          const d = await crypto.subtle.digest('SHA-256', await res.arrayBuffer());
          const hex = Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
          if (hex !== files[u.slice('/paint/'.length)]) out.push(`${u}: sha256`);
        }
        return out;
      },
      { urls: want, files: build.files },
    );
    expect(bad).toEqual([]);
  } finally {
    await context.setOffline(false);
  }
});

test('ilust-sw-keep-previous: buildId とハッシュ名が替わった版が来ても、保留中の古い版のページはまだ読んでいないチャンクを読め、保存して再読み込みした後に 1 つ前を消す（ilust-sup-followup-02）', async ({
  page,
}) => {
  test.skip(!existsSync(BUILD_JSON), '成果物（public/paint/）を取り込んでいないビルド');
  const build = JSON.parse(readFileSync(BUILD_JSON, 'utf8')) as { buildId: string; files: Record<string, string> };
  const cacheA = `og-paint-${build.buildId}`;
  const want = Object.keys(build.files)
    .filter((f) => f.startsWith('assets/') && !f.endsWith('.bin'))
    .map((f) => `/paint/${f}`)
    .sort();
  const cacheEntries = (name: string) =>
    page.evaluate(async (n) => ((await caches.has(n)) ? (await (await caches.open(n)).keys()).length : -1), name);

  await setOgEngine(page, true);
  await gotoApp(page);
  await waitForController(page);
  await page.reload();
  await waitForController(page);
  // A の install で og-paint-A に assets/ の全部が入る
  await expect.poll(() => cacheEntries(cacheA), { timeout: 60_000 }).toBeGreaterThanOrEqual(want.length);

  // 描きかけ（保存していない）のページ A
  const frame = await openOgFreeHere(page);
  await drawOg(page, 2);
  await waitOgContent(frame);
  // A のまだ読んでいないチャンク（JS）を 1 つ選ぶ
  const loaded = new Set(
    await frame.evaluate(() => performance.getEntriesByType('resource').map((e) => new URL(e.name).pathname)),
  );
  const unread = want.filter((u) => u.endsWith('.js') && !loaded.has(u) && !/worker/i.test(u));
  expect(unread.length).toBeGreaterThan(0);
  const target = unread[unread.length - 1]!;
  const targetRel = target.slice('/paint/'.length);
  const renamedRel = targetRel.replace(/\.js$/, '-e2eB.js');
  const distTarget = fileURLToPath(new URL(`../../dist/paint/${targetRel}`, import.meta.url));
  const distRenamed = fileURLToPath(new URL(`../../dist/paint/${renamedRel}`, import.meta.url));

  // 版 B を作る: SW の buildId（= キャッシュの名前）と、その 1 つのチャンクのハッシュ名を替える。配信（dist）からは A の名前のファイルが消える
  const buildB = `e2eb${build.buildId.slice(4)}`;
  const cacheB = `og-paint-${buildB}`;
  const originalSw = readFileSync(DIST_SW, 'utf8');
  expect(originalSw).toContain(build.buildId);
  expect(originalSw).toContain(`"${targetRel}"`);
  const swB = originalSw.split(build.buildId).join(buildB).split(`"${targetRel}"`).join(`"${renamedRel}"`);
  try {
    renameSync(distTarget, distRenamed);
    writeFileSync(DIST_SW, `${swB}\n// e2e keep-previous\n`);
    // 配信から A の名前が消えた（ネットワークでは正しい中身が返らない）ことを先に確かめる
    const direct = await page.evaluate(async (u) => {
      const r = await fetch(`${u}?bypass=${Date.now()}`, { cache: 'no-store' }).catch(() => null);
      return r ? { status: r.status, type: r.headers.get('content-type') ?? '' } : null;
    }, target);
    expect(direct === null || direct.status !== 200 || !/javascript/.test(direct.type)).toBe(true);

    expect(
      await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg) return 'no-registration';
        await reg.update();
        return 'ok';
      }),
    ).toBe('ok');
    await expect(page.getByText('更新があります（保存後に再読み込み）')).toBeVisible({ timeout: 30_000 });
    // B が有効になった（og-paint-B ができた）後も og-paint-A は残る
    await expect.poll(() => cacheEntries(cacheB), { timeout: 60_000 }).toBeGreaterThan(0);
    expect(await cacheEntries(cacheA)).toBeGreaterThanOrEqual(want.length);

    // 保留中のページ A は、まだ読んでいない A のチャンクを B の SW から読める（中身は BUILD.json の sha256 と一致）
    const got = await frame.evaluate(async (u) => {
      const r = await fetch(u);
      const d = await crypto.subtle.digest('SHA-256', await r.arrayBuffer());
      return { status: r.status, sha: Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('') };
    }, target);
    expect(got).toEqual({ status: 200, sha: build.files[targetRel] });
    // 動的 import（モジュールとして）も通る
    expect(await frame.evaluate(async (u) => import(/* @vite-ignore */ u).then(() => 'ok', (e) => String(e)), target)).toBe('ok');

    // A のページが残っている間は、掃除を頼んでも og-paint-A を消さない
    await page.evaluate(() => navigator.serviceWorker.controller?.postMessage({ type: 'og-paint-prune' }));
    await page.waitForTimeout(1000);
    expect(await cacheEntries(cacheA)).toBeGreaterThanOrEqual(want.length);

    // 保存すると再読み込み（新しい版のページ）→ 古い版のページが無いので og-paint-A を消す。og-paint-B は残る
    const reloaded = page.waitForEvent('load', { timeout: 30_000 });
    await page.getByRole('button', { name: '終わる' }).click();
    await page.getByRole('dialog', { name: '終わる' }).getByRole('button', { name: '保存して終わる' }).click();
    await reloaded;
    await waitForController(page);
    await expect.poll(() => cacheEntries(cacheA), { timeout: 20_000 }).toBe(-1);
    expect(await cacheEntries(cacheB)).toBeGreaterThan(0);
  } finally {
    writeFileSync(DIST_SW, originalSw);
    if (existsSync(distRenamed)) renameSync(distRenamed, distTarget);
  }
});

/** 今のページで #/free を開いて ready まで（SW の制御を保ったまま、ハッシュの移動で） */
async function openOgFreeHere(page: Page) {
  await page.evaluate(() => {
    location.hash = '#/free';
  });
  await expect(page.locator(`${OG_ROOT}[data-phase="ready"]`)).toBeVisible({ timeout: 30_000 });
  return ogFrame(page);
}

