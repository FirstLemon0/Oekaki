/**
 * DB v1 → v2（ogDocs の追加）を本物のブラウザで確かめる（受け入れ ilust-idb-compat、ADR-0007 D6-6）。
 *
 * - v1 の 9 ストアの全データ（進捗・ギャラリー・設定ほか）が入った端末で新しい版を開くと v2 になり、全件がそのまま読め、
 *   ogDocs が空で作られる（既存のストア・インデックス・キー・値の形に差分 0）
 * - 古い版を開いたままの別タブ（versionchange で閉じない）がある間は「ほかのタブを閉じて」の案内を出し、閉じれば進む
 *
 * v1 のデータは、アプリの JS が動かない同じオリジンのページ（/manifest.webmanifest）で v1 の形のまま作る。
 */
import { expect, test, type Page } from '@playwright/test';
import { gotoApp } from './helpers';
import { dump, seedV1, type Dump } from './db-helpers';

test.describe('DB v2（ogDocs の追加）', () => {
  test('v1 の 9 ストアのデータを入れた端末で開くと v2 になり、全件そのまま・ogDocs は空', async ({ page }) => {
    await seedV1(page);
    const before = await dump(page);
    expect(before.version).toBe(1);
    expect(Object.keys(before.stores)).toHaveLength(9);

    await gotoApp(page, '#/gallery');
    await expect(page.getByRole('heading', { name: 'ギャラリー' })).toBeVisible();
    // v1 の絵がギャラリーに出る（アプリが v2 で読めている）
    await expect(page.locator('.itile').first()).toBeVisible();
    await expect(page.locator('.load-error')).toHaveCount(0);

    await page.goto('/manifest.webmanifest');
    const after = await dump(page);
    expect(after.version).toBe(2);
    expect(Object.keys(after.stores).sort()).toEqual([...Object.keys(before.stores), 'ogDocs'].sort());
    expect(after.stores['ogDocs']).toEqual({ keyPath: 'id', indexes: [], keys: [], values: [] });
    for (const name of Object.keys(before.stores)) {
      expect(after.stores[name], name).toEqual(before.stores[name]);
    }
  });

  test('古い版を開いたままの別タブがあると案内を出し、閉じると v2 へ進む', async ({ page, context }) => {
    await seedV1(page);
    // 古いタブ: v1 で開いたまま、versionchange でも閉じない
    const stale = await context.newPage();
    await stale.goto('/manifest.webmanifest');
    await stale.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('seichotsu', 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      (window as unknown as { __staleDb: IDBDatabase }).__staleDb = db;
    });

    await page.goto('/#/');
    await expect(page.getByRole('alert')).toContainText('ほかのタブやウィンドウで成長通を開いていたら閉じてください');
    await expect(page.locator('.loading')).toHaveCount(1);

    await stale.evaluate(() => (window as unknown as { __staleDb: IDBDatabase }).__staleDb.close());
    await page.locator('.loading').waitFor({ state: 'detached' });
    await expect(page.locator('.load-error')).toHaveCount(0);
    await page.goto('/manifest.webmanifest');
    expect((await dump(page)).version).toBe(2);
  });
});
