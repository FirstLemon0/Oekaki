/**
 * 新しいお絵描き（#/free を埋め込みのペイントで開く、UR-002 S2 / ADR-0007 D3・D6・D7）。
 *
 * 受け入れ:
 * - ilust-free-opens-og: 設定 paintEngine = 'og'（S3 の後は既定）で #/free が /paint/embed.html の iframe を開き、ogEmbed.version === 1 で描ける。
 *   版が違えば今までのお絵描き（FreeDraw）に戻る
 * - ilust-free-contracts: 『終わる』→『保存して終わる』で free / after / before（profile の afterDrawingId / beforeCreatedAt も）、
 *   何も描いていなければ保存しない、5 分以上の実描画でストリーク +1（5 分未満は数えない）、透過 PNG の長辺 2048・四隅 α = 0・名前、
 *   ギャラリーの『自由』のタイル（WebP・長辺 ≤ 1024）、詳細の『続きから描く』で同じ画素、下書きの『続きから / 捨てる』、
 *   離脱の確認が 1 回だけ（描かずに戻ると確認なし）
 * - 親の設定（テーマ・ペン専用・左利き）が埋め込みに渡る。#/free の出入り 10 回で iframe とヒープが戻る（robustness-security-05）
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { gotoApp } from './helpers';
import {
  drawOg,
  finishOg,
  longPenStroke,
  OG_FRAME,
  OG_ROOT,
  ogFrame,
  ogJournalCount,
  ogPixels,
  settledPixels,
  openOgFree,
  readSingleton,
  readStore,
  setOgEngine,
  waitOgContent,
} from './og-helpers';

test('既定（設定を触らない新しい端末）で #/free は新しいお絵描き、設定の「新しいお絵描き（試験中）」は on（UR-002 S3）', async ({ page }) => {
  await gotoApp(page, '#/free');
  await expect(page.locator(`${OG_ROOT}[data-phase="ready"]`)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(OG_FRAME)).toHaveAttribute('src', '/paint/embed.html');
  await gotoApp(page, '#/settings?section=practice');
  await expect(page.getByRole('switch', { name: '新しいお絵描き（試験中）' })).toHaveAttribute('aria-checked', 'true');
  // 設定の値は書いていない（未設定 = 既定に従う）
  expect((await readSingleton(page, 'settings'))?.['paintEngine'] ?? null).toBeNull();
});

test.describe('新しいお絵描き', () => {
  test.beforeEach(async ({ page }) => {
    await setOgEngine(page, true);
  });

  test('ilust-free-opens-og: #/free が /paint/embed.html を開き、ogEmbed v1 で描ける。設定を off にすると今までのお絵描き', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const frame = await openOgFree(page);
    await expect(page.locator(OG_FRAME)).toHaveAttribute('src', '/paint/embed.html');
    expect(await frame.evaluate(() => (window as unknown as { ogEmbed: { version: number } }).ogEmbed.version)).toBe(1);
    expect(await frame.evaluate(() => (window as unknown as { ogEmbed: { hasContent(): boolean } }).ogEmbed.hasContent())).toBe(false);
    const empty = await ogPixels(frame);
    expect(empty.opaque).toBe(0);
    await drawOg(page, 2);
    await waitOgContent(frame);
    const drawn = await ogPixels(frame);
    expect(drawn.opaque).toBeGreaterThan(100);
    // 新しい紙: 長辺 2048（透過 PNG の長辺 = 紙の長辺）
    expect(Math.max(drawn.w, drawn.h)).toBe(2048);
    // 埋め込みの中に成長通は入れ子で起動していない（SW なしでも /paint/ は OG の成果物）
    expect(await frame.evaluate(() => document.title)).not.toBe('成長通');
    expect(errors).toEqual([]);

    // 設定を off に戻すと今までのお絵描き
    await gotoApp(page);
    await setOgEngine(page, false);
    await gotoApp(page, '#/free');
    await expect(page.locator('.ls-canvas__paper canvas')).toBeVisible();
    await expect(page.locator(OG_ROOT)).toHaveCount(0);
  });

  test('版が違う埋め込みなら今までのお絵描き（FreeDraw）に戻る', async ({ page }) => {
    await page.route('**/paint/embed.html', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><html><head><title>embed v2</title><script src="/paint/__v2.js"></script></head><body></body></html>',
      }),
    );
    await page.route('**/paint/__v2.js', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: 'window.ogEmbed = { version: 2, ready: Promise.resolve() };',
      }),
    );
    await gotoApp(page, '#/free');
    await expect(page.getByText('新しいお絵描きを開けなかったので、今までのお絵描きで開きました。')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.ls-canvas__paper canvas')).toBeVisible();
    await expect(page.locator(OG_FRAME)).toHaveCount(0);
  });

  test('保存の種別: 自由は free、?save=after は After と afterDrawingId、?save=before は Before と beforeCreatedAt', async ({ page }) => {
    for (const [hash, kind] of [
      ['#/free', 'free'],
      ['#/free?save=after', 'after'],
      ['#/free?save=before', 'before'],
    ] as const) {
      const frame = await openOgFree(page, hash);
      await drawOg(page, 1);
      await waitOgContent(frame);
      await finishOg(page);
      const drawings = await readStore(page, 'drawings');
      const d = drawings.find((x) => x['kind'] === kind);
      expect(d, `${kind} の絵`).toBeDefined();
      const profile = await readSingleton(page, 'profile');
      if (kind === 'after') expect(profile?.['afterDrawingId']).toBe(d!['id']);
      if (kind === 'before') {
        expect(profile?.['beforeDrawingId']).toBe(d!['id']);
        expect(profile?.['beforeCreatedAt']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
    // 絵（WebP + meta.og）と文書（ogDocs）が同じ数、meta.doc は無い
    const drawings = await readStore(page, 'drawings');
    const docs = await readStore(page, 'ogDocs');
    expect(drawings).toHaveLength(3);
    expect(docs.map((x) => x['id']).sort()).toEqual(drawings.map((x) => x['id']).sort());
    for (const d of drawings) {
      expect(d['strokes']).toBeNull();
      const meta = d['meta'] as { og: Record<string, unknown> };
      expect(Object.keys(meta)).toEqual(['og']);
      expect(meta.og).toMatchObject({ engine: 'og', ogContract: expect.any(String) });
      expect(d['image']).toMatchObject({ blobType: 'image/webp' });
    }
  });

  test('何も描いていなければ保存しない（ストリークにも数えない）', async ({ page }) => {
    await openOgFree(page);
    await finishOg(page);
    await expect(page.getByRole('link', { name: /自由お絵描き/ })).toBeVisible();
    expect(await readStore(page, 'drawings')).toEqual([]);
    expect(await readStore(page, 'ogDocs')).toEqual([]);
    const streak = await readSingleton(page, 'streak');
    expect(streak?.['current'] ?? 0).toBe(0);
  });

  // 実描画の時間は CDP の合成ペンの時刻で作る（実時間を待たない）。1 つの試験（= 新しいページ）で 1 本だけ合成する
  for (const [label, ms, want] of [
    ['5 分未満（4 分 50 秒）はストリークに数えない', 290_000, 0],
    ['5 分以上（5 分 10 秒）でストリーク +1', 310_000, 1],
  ] as const) {
    test(`ストリーク: ${label}（ogEmbed.onStroke の区間 → activeDrawingMs）`, async ({ page, context }) => {
      await openOgFree(page);
      const frame = await ogFrame(page);
      await frame.evaluate(() => {
        const w = window as unknown as { __spans: unknown[]; ogEmbed: { onStroke(cb: (s: unknown) => void): void } };
        w.__spans = [];
        w.ogEmbed.onStroke((s) => w.__spans.push(s));
      });
      const cdp = await context.newCDPSession(page);
      await longPenStroke(cdp, page, ms);
      await waitOgContent(frame);
      const spans = await frame.evaluate(() => (window as unknown as { __spans: { start: number; end: number; tool: string }[] }).__spans);
      expect(spans).toHaveLength(1);
      expect(spans[0]!.tool).toBe('pen');
      // 区間の長さ = 合成した時刻の幅（最初の動きから離すまで）
      expect(Math.abs(spans[0]!.end - spans[0]!.start - ms)).toBeLessThan(100);
      await finishOg(page);
      expect(await readStore(page, 'drawings')).toHaveLength(1);
      expect((await readSingleton(page, 'streak'))?.['current'] ?? 0).toBe(want);
    });
  }

  test('透過 PNG（長辺 2048・四隅 α = 0・名前）、ギャラリーの『自由』のタイル（WebP・長辺 ≤ 1024）、続きから描くで同じ画素', async ({ page }) => {
    const frame = await openOgFree(page);
    await drawOg(page, 3);
    await waitOgContent(frame);
    const before = await settledPixels(frame);

    await page.getByRole('button', { name: '終わる' }).click();
    const sheet = page.getByRole('dialog', { name: '終わる' });
    const [dl] = await Promise.all([page.waitForEvent('download'), sheet.getByRole('button', { name: '透過 PNG を書き出す' }).click()]);
    expect(dl.suggestedFilename()).toMatch(/^seichotsu-free-\d{8}-\d{4}\.png$/);
    const png = readFileSync(await dl.path());
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png[25]).toBe(6); // RGBA
    expect(Math.max(png.readUInt32BE(16), png.readUInt32BE(20))).toBe(2048);
    const corners = await page.evaluate(async (b64) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bin], { type: 'image/png' }), { premultiplyAlpha: 'none' });
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d')!;
      g.drawImage(bmp, 0, 0);
      const a = (x: number, y: number) => g.getImageData(x, y, 1, 1).data[3];
      return [a(0, 0), a(bmp.width - 1, 0), a(0, bmp.height - 1), a(bmp.width - 1, bmp.height - 1)];
    }, png.toString('base64'));
    expect(corners).toEqual([0, 0, 0, 0]);
    await expect(sheet.getByText('透過 PNG を書き出しました。')).toBeVisible();
    await sheet.getByRole('button', { name: '保存して終わる' }).click();
    await expect(page.locator(OG_ROOT)).toHaveCount(0);

    // ギャラリーの『自由』のタイル
    await page.getByRole('link', { name: 'ギャラリー' }).click();
    await page.getByRole('group', { name: '種類で絞り込む' }).getByRole('button', { name: '自由' }).click();
    await expect(page.locator('.itile').first()).toBeVisible();
    const tile = await page.evaluate(
      () =>
        new Promise<{ type: string; w: number; h: number }>((resolve, reject) => {
          const req = indexedDB.open('seichotsu');
          req.onsuccess = () => {
            const g = req.result.transaction('drawings').objectStore('drawings').getAll();
            g.onsuccess = async () => {
              const img = (g.result as { image: Blob }[])[0]!.image;
              const bmp = await createImageBitmap(img);
              resolve({ type: img.type, w: bmp.width, h: bmp.height });
            };
            g.onerror = () => reject(g.error);
          };
        }),
    );
    expect(tile.type).toBe('image/webp');
    expect(Math.max(tile.w, tile.h)).toBeLessThanOrEqual(1024);

    // 詳細: 再生は出ず『続きから描く』→ 同じ画素
    await page.getByRole('link', { name: /^自由 / }).first().click();
    await expect(page.getByRole('button', { name: '描いた順に再生' })).toHaveCount(0);
    await page.getByRole('link', { name: '続きから描く' }).click();
    await expect(page).toHaveURL(/#\/free\?og=/);
    const frame2 = await openOgFree(page, new URL(page.url()).hash);
    await waitOgContent(frame2);
    await expect.poll(async () => (await ogPixels(frame2)).sha, { timeout: 15_000 }).toBe(before.sha);
    // 続きを描いて保存すると同じ絵が置き換わる（絵は増えない）、戻り先はギャラリーの詳細
    await drawOg(page, 1);
    await expect.poll(async () => (await ogPixels(frame2)).sha).not.toBe(before.sha);
    await finishOg(page);
    await expect(page).toHaveURL(/#\/gallery\//);
    expect(await readStore(page, 'drawings')).toHaveLength(1);
    expect(await readStore(page, 'ogDocs')).toHaveLength(1);
  });

  test('下書き: 描きかけで再読込 →『描きかけがあります』→ 続きから で同じ画素、保存の後は印もジャーナルも無い', async ({ page }) => {
    let frame = await openOgFree(page);
    await drawOg(page, 2);
    const drawnAt = Date.now();
    await waitOgContent(frame);
    const before = await settledPixels(frame);
    await expect
      .poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('seichotsu.draft.free') ?? 'null')?.engine ?? null))
      .toBe('og');
    await waitDraftSettled(page, drawnAt);

    // 閉じる（再読込）ときは親の確認が 1 回だけ（iframe の中は beforeunload を張らない）
    const kinds: string[] = [];
    page.on('dialog', (d) => {
      kinds.push(d.type());
      void d.accept();
    });
    await page.reload();
    expect(kinds.filter((k) => k === 'beforeunload')).toHaveLength(1);
    const offer = page.getByRole('dialog', { name: '描きかけがあります' });
    await expect(offer).toBeVisible();
    await offer.getByRole('button', { name: '続きから' }).click();
    await expect(page.locator(`${OG_ROOT}[data-phase="ready"]`)).toBeVisible({ timeout: 30_000 });
    frame = await ogFrame(page);
    await waitOgContent(frame);
    // 開いた直後はタイルの読み込みが続くことがある: 一致するまで待つ
    await expect.poll(async () => (await ogPixels(frame)).sha, { timeout: 15_000 }).toBe(before.sha);

    await finishOg(page);
    expect(await page.evaluate(() => sessionStorage.getItem('seichotsu.draft.free'))).toBeNull();
    expect(await readStore(page, 'drawings')).toHaveLength(1);
    // もう一度開いても下書きの案内は出ず、OG のジャーナルも残っていない
    frame = await openOgFree(page);
    await expect(page.getByRole('dialog', { name: '描きかけがあります' })).toHaveCount(0);
    expect(await ogJournalCount(frame)).toBe(0);
  });

  test('下書き:『捨てる』で白紙から、印も消える', async ({ page }) => {
    const frame = await openOgFree(page);
    await drawOg(page, 1);
    await waitOgContent(frame);
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('seichotsu.draft.free') !== null)).toBe(true);
    page.on('dialog', (d) => void d.accept());
    await page.reload();
    await page.getByRole('dialog', { name: '描きかけがあります' }).getByRole('button', { name: '捨てる' }).click();
    const fresh = await openOgFreeReady(page);
    expect(await fresh.evaluate(() => (window as unknown as { ogEmbed: { hasContent(): boolean } }).ogEmbed.hasContent())).toBe(false);
    expect(await page.evaluate(() => sessionStorage.getItem('seichotsu.draft.free'))).toBeNull();
  });

  test('離脱の確認: 描いたら 1 回だけ（画面の戻る・端末の戻る）、描かずに戻ると確認なし', async ({ page }) => {
    // 描かずに戻る → 確認なしでホーム
    await openOgFree(page);
    await page.locator(`${OG_ROOT} .back-pill`).click();
    await expect(page.getByRole('link', { name: /自由お絵描き/ })).toBeVisible();
    await expect(page.getByRole('dialog', { name: '描いた線が消えます。戻りますか？' })).toHaveCount(0);

    const frame = await openOgFree(page);
    await drawOg(page, 1);
    await waitOgContent(frame);
    const dialog = page.getByRole('dialog', { name: '描いた線が消えます。戻りますか？' });
    await expect(page.locator(`${OG_ROOT}`)).toBeVisible();
    await page.locator(`${OG_ROOT} .back-pill`).click();
    await expect(dialog).toHaveCount(1);
    await dialog.getByRole('button', { name: '描き続ける' }).click();
    await expect(dialog).toHaveCount(0);
    expect(await waitAndHasContent(page)).toBe(true);

    // 端末の戻る → 確認が出て画面はそのまま → 戻る でホーム
    await page.goBack();
    await expect(dialog).toHaveCount(1);
    await expect(page).toHaveURL(/#\/free$/);
    await dialog.getByRole('button', { name: '戻る', exact: true }).click();
    await expect(page.getByRole('link', { name: /自由お絵描き/ })).toBeVisible();
    expect(await readStore(page, 'drawings')).toEqual([]);
    expect(await page.evaluate(() => sessionStorage.getItem('seichotsu.draft.free'))).toBeNull();
  });

  test('親の設定が渡る: テーマ（system を解決）・ペン専用・左利き、変えるとすぐ当て直す', async ({ page }) => {
    await gotoApp(page, '#/settings?section=practice');
    await page.getByRole('radiogroup', { name: '利き手' }).getByRole('radio', { name: '左' }).click();
    const frame = await openOgFree(page);
    const attrs = () =>
      frame.evaluate(() => {
        const h = document.documentElement;
        return { theme: h.getAttribute('data-theme'), hand: h.getAttribute('data-og-hand'), pen: h.getAttribute('data-og-pen-only') };
      });
    expect(await attrs()).toEqual({ theme: 'light', hand: 'left', pen: 'true' });
    await expect(page.locator(`${OG_ROOT}.is-left`)).toBeVisible();
  });

  test('#/free の出入り 10 回で iframe とヒープが戻る（後始末、robustness-security-05）', async ({ page, context }) => {
    test.setTimeout(240_000);
    const cdp = await context.newCDPSession(page);
    const heap = async () => {
      await cdp.send('HeapProfiler.collectGarbage');
      await cdp.send('HeapProfiler.collectGarbage');
      return (await page.evaluate(() => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0)) / 1e6;
    };
    const cycle = async () => {
      await openOgFree(page);
      await page.locator(`${OG_ROOT} .back-pill`).click();
      await expect(page.locator(OG_ROOT)).toHaveCount(0);
      await expect.poll(() => page.frames().length).toBe(1);
    };
    await cycle();
    const base = await heap();
    for (let i = 0; i < 9; i++) await cycle();
    expect(await page.locator('iframe').count()).toBe(0);
    expect(page.frames()).toHaveLength(1);
    const end = await heap();
    // 親のヒープは iframe の数だけ増えない（1 回目の後との差。OG の文書は iframe の側）
    expect(end - base).toBeLessThan(25);
  });
});

async function openOgFreeReady(page: Page) {
  await expect(page.locator(`${OG_ROOT}[data-phase="ready"]`)).toBeVisible({ timeout: 30_000 });
  return ogFrame(page);
}

async function waitAndHasContent(page: Page): Promise<boolean> {
  const f = await ogFrame(page);
  return f.evaluate(() => (window as unknown as { ogEmbed: { hasContent(): boolean } }).ogEmbed.hasContent());
}

/**
 * 下書きの写しが最後の線の後に書かれ、落ち着くまで待つ（写しは最後の確定から 1 秒まとめて書く。負荷が高いと 2 本目より前の写しが先に出る）。
 * 印の savedAt が `after` より後で、1.5 秒変わらなければ落ち着いたとみなす。
 */
async function waitDraftSettled(page: Page, after: number): Promise<void> {
  const savedAt = () =>
    page.evaluate(() => Date.parse(JSON.parse(sessionStorage.getItem('seichotsu.draft.free') ?? 'null')?.savedAt ?? '') || 0);
  await expect.poll(savedAt, { timeout: 15_000 }).toBeGreaterThan(after);
  let last = await savedAt();
  for (;;) {
    await page.waitForTimeout(1500);
    const now = await savedAt();
    if (now === last) return;
    last = now;
  }
}
