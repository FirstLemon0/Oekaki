/**
 * 永続コンテキストでの版上げ（受け入れ ilust-idb-compat の Playwright の永続コンテキストの分、ADR-0007 D6-6）。
 *
 * 端末のブラウザのプロファイル（userDataDir）に v1 のデータが入った状態を作ってブラウザを閉じ、
 * 新しい版を同じプロファイルで開く → v2 になり全件そのまま・ogDocs は空 → 新しいお絵描きで描いて保存 → ブラウザを閉じて開き直しても
 * 絵・文書・設定が残り、続きから描ける。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type BrowserContext } from '@playwright/test';
import { dump, seedV1 } from './db-helpers';
import { drawOg, finishOg, ogPixels, openOgFree, readStore, readSingleton, setOgEngine, settledPixels, waitOgContent } from './og-helpers';

const BASE = 'http://localhost:4173';

async function launch(dir: string): Promise<BrowserContext> {
  return chromium.launchPersistentContext(dir, {
    baseURL: BASE,
    viewport: { width: 1472, height: 920 },
    serviceWorkers: 'block',
    acceptDownloads: true,
  });
}

test('永続コンテキスト: v1 のデータの端末で新しい版を開き、描いて保存し、閉じて開き直しても残る', async () => {
  test.setTimeout(180_000);
  const dir = mkdtempSync(join(tmpdir(), 'ilust-persist-'));
  try {
    // 1. 古い版のデータ（v1、9 ストア）が入った端末
    let ctx = await launch(dir);
    let page = ctx.pages()[0] ?? (await ctx.newPage());
    await seedV1(page);
    const v1 = await dump(page);
    expect(v1.version).toBe(1);
    await ctx.close();

    // 2. 新しい版で開く: v2・全件そのまま・ogDocs は空
    ctx = await launch(dir);
    page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto('/#/');
    await page.locator('.loading').waitFor({ state: 'detached' }).catch(() => undefined);
    const v2 = await dump(page);
    expect(v2.version).toBe(2);
    expect(Object.keys(v2.stores).sort()).toEqual([...Object.keys(v1.stores), 'ogDocs'].sort());
    for (const [name, s] of Object.entries(v1.stores)) {
      expect(v2.stores[name]!.keyPath, name).toEqual(s.keyPath);
      expect(v2.stores[name]!.indexes, name).toEqual(s.indexes);
      expect(v2.stores[name]!.keys, name).toEqual(s.keys);
      if (name !== 'settings' && name !== 'profile' && name !== 'streak') expect(v2.stores[name]!.values, name).toEqual(s.values);
    }
    expect(v2.stores['ogDocs']!.keys).toEqual([]);

    // 新しいお絵描きで描いて保存（設定の値も永続に残ることを見るため、いったん off にしてから on で書く）
    await setOgEngine(page, false);
    await setOgEngine(page, true);
    const frame = await openOgFree(page);
    await drawOg(page, 2);
    await waitOgContent(frame);
    const pixels = await settledPixels(frame);
    await finishOg(page);
    const ids = (await readStore(page, 'ogDocs')).map((d) => d['id'] as string);
    expect(ids).toHaveLength(1);
    await ctx.close();

    // 3. ブラウザを閉じて開き直す: v1 の絵・新しい絵・文書・設定が残り、続きから描くで同じ画素
    ctx = await launch(dir);
    page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto('/#/');
    await page.locator('.loading').waitFor({ state: 'detached' }).catch(() => undefined);
    const drawings = await readStore(page, 'drawings');
    expect(drawings.map((d) => d['id']).sort()).toEqual(['d-v1', ids[0]].sort());
    expect((await readSingleton(page, 'settings'))?.['paintEngine']).toBe('og');
    const again = await openOgFree(page, `#/free?og=${ids[0]}`);
    await waitOgContent(again);
    await expect.poll(async () => (await ogPixels(again)).sha, { timeout: 15_000 }).toBe(pixels.sha);
    await ctx.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
