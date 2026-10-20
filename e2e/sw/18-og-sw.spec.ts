/**
 * Service Worker を有効にした新しいお絵描き（project chromium-sw、UR-002 S2 / ADR-0007 D7）。
 *
 * - og-sw-update-defer（受け入れ ilust-update-defer の新しいお絵描きの分）: #/free（埋め込みのペイント）に保存していない絵があるあいだは、
 *   新しい SW が有効になっても再読み込みせず「更新があります（保存後に再読み込み）」と知らせる。保存した後に再読み込みする
 * - ilust-precache-scope の新しいお絵描きの分: 一度開いた後は通信を切っても #/free の新しいお絵描きが開いて描ける
 *   （/paint/assets/ は SW の実行時キャッシュ、/paint/embed.html は NetworkFirst の写し）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { gotoApp } from '../helpers';
import { drawOg, OG_ROOT, ogFrame, setOgEngine, waitOgContent } from '../og-helpers';

const DIST_SW = fileURLToPath(new URL('../../dist/sw.js', import.meta.url));

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

/** 今のページで #/free を開いて ready まで（SW の制御を保ったまま、ハッシュの移動で） */
async function openOgFreeHere(page: Page) {
  await page.evaluate(() => {
    location.hash = '#/free';
  });
  await expect(page.locator(`${OG_ROOT}[data-phase="ready"]`)).toBeVisible({ timeout: 30_000 });
  return ogFrame(page);
}

