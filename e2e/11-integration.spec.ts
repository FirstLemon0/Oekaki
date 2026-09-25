/**
 * お絵描き v2 と既存機能の統合（2026-09-25 レビュー対応）を実操作で確かめる。
 *
 * - ギャラリーの再生: 塗りを含む絵は保存時の切り詰め範囲（meta.contentRect）で再生し、縦横の倍率がそろう
 * - 下書き: 文書つき（レイヤー・塗り）は history を二重に持たず、再読込の「続きから」でレイヤーごと戻る。
 *   保存に失敗したら古い下書きを残さない
 * - 回転: 塗り・変形を含む文書が新しい紙の大きさに写される（下書きの文書で確かめる）
 * - 合成（スクリーン）の書き出しが画面と同じ（紙色の上で合成）
 * - ダークでの塗りは墨を記号（'ink'）のまま保存する
 * - ジェスチャー: フルツール（レイヤー・塗り・変形）の絵を保存できる。変形バーがタイマーを覆わない
 * - 採点する画面: 2 本指のピンチでビューが動かない（自由お絵描きでは動く）
 * - ドリル: 「全部消す」→ 描き直し → 回転 → 下書き復元で、消した線がよみがえらない
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { drawLine, gotoApp } from './helpers';

type AnyStep = { type: string; [k: string]: unknown };
type AnyLesson = { id: string; steps: AnyStep[] };

function allLessons(): AnyLesson[] {
  const dir = fileURLToPath(new URL('../content/stages', import.meta.url));
  const out: AnyLesson[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const stage = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { units?: { lessons: AnyLesson[] }[] };
    for (const u of stage.units ?? []) out.push(...u.lessons);
  }
  return out;
}

function findStep(pred: (s: AnyStep) => boolean): { lessonId: string; index: number; step: AnyStep } | null {
  for (const l of allLessons()) {
    const index = l.steps.findIndex(pred);
    if (index >= 0) return { lessonId: l.id, index, step: l.steps[index]! };
  }
  return null;
}

const toolbar = (page: Page) => page.getByRole('toolbar', { name: '描画ツール' });

async function openFree(page: Page): Promise<Locator> {
  await gotoApp(page);
  await page.getByRole('link', { name: /自由お絵描き/ }).click();
  const paper = page.locator('.ls-canvas__paper');
  await expect(paper.locator('canvas').first()).toBeVisible();
  return paper;
}

async function drag(page: Page, paper: Locator, from: [number, number], to: [number, number], steps = 12): Promise<void> {
  const box = await paper.boundingBox();
  if (!box) throw new Error('紙が見つかりません');
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps });
  await page.mouse.up();
}

async function tapPaper(page: Page, paper: Locator, at: [number, number]): Promise<void> {
  const box = await paper.boundingBox();
  if (!box) throw new Error('紙が見つかりません');
  await page.mouse.click(box.x + box.width * at[0], box.y + box.height * at[1]);
}

/** レイヤーを 1 枚足してパネルを閉じる（新しいレイヤーが選択中になる） */
async function addLayer(page: Page): Promise<void> {
  await toolbar(page).getByRole('button', { name: 'レイヤー', exact: true }).click();
  const panel = page.getByTestId('layer-panel');
  await expect(panel).toBeVisible();
  const before = await panel.locator('.pt-layer').count();
  await panel.getByRole('button', { name: '追加' }).click();
  await expect(panel.locator('.pt-layer')).toHaveCount(before + 1);
  await panel.getByRole('button', { name: 'レイヤーを閉じる' }).click();
  await expect(panel).toHaveCount(0);
}

/** 塗りつぶしツールで紙の 1 点を塗り、ペンに戻す */
async function fillAt(page: Page, paper: Locator, at: [number, number]): Promise<void> {
  const fill = toolbar(page).getByRole('button', { name: '塗りつぶし' });
  await fill.click();
  await expect(fill).toHaveAttribute('aria-pressed', 'true');
  await tapPaper(page, paper, at);
  await expect(toolbar(page).getByRole('button', { name: '元に戻す' })).toBeEnabled();
  await toolbar(page).getByRole('button', { name: 'ペン', exact: true }).click();
}

/** 矩形選択 → 枠の中をドラッグして移動 → 確定（transform の op を 1 つ積む） */
async function moveSelection(page: Page, paper: Locator, from: [number, number], to: [number, number]): Promise<void> {
  await toolbar(page).getByRole('button', { name: '矩形選択' }).click();
  await drag(page, paper, from, to, 6);
  const bar = page.getByTestId('transform-bar');
  await expect(bar.getByRole('button', { name: '確定' })).toBeVisible();
  const body = page.getByTestId('selection-body');
  const b = await body.boundingBox();
  if (!b) throw new Error('選択枠が見つかりません');
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2 + 20, { steps: 6 });
  await page.mouse.up();
  await bar.getByRole('button', { name: '確定' }).click();
  await expect(page.getByTestId('selection-body')).toHaveCount(0);
  await toolbar(page).getByRole('button', { name: 'ペン', exact: true }).click();
}

async function saveFree(page: Page): Promise<void> {
  await page.getByRole('button', { name: '終わる' }).click();
  await page.getByRole('button', { name: '保存して終わる' }).click();
  await expect(page.getByRole('link', { name: /自由お絵描き/ })).toBeVisible();
}

interface StoredMeta {
  id: string;
  kind: string;
  meta?: { doc?: { width: number; height: number; layers: unknown[]; ops: { kind: string; color?: string }[] }; contentRect?: { x: number; y: number; width: number; height: number } };
  imageW: number;
  imageH: number;
}

/** IndexedDB の絵（画像は大きさだけ） */
async function storedDrawings(page: Page): Promise<StoredMeta[]> {
  return page.evaluate(
    () =>
      new Promise<StoredMeta[]>((resolve, reject) => {
        const req = indexedDB.open('seichotsu');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('drawings', 'readonly');
          const all = tx.objectStore('drawings').getAll();
          all.onsuccess = async () => {
            const out: StoredMeta[] = [];
            for (const d of all.result as { id: string; kind: string; meta?: StoredMeta['meta']; image: Blob }[]) {
              const bmp = await createImageBitmap(d.image);
              out.push({ id: d.id, kind: d.kind, meta: d.meta, imageW: bmp.width, imageH: bmp.height });
              bmp.close();
            }
            db.close();
            resolve(out);
          };
          all.onerror = () => reject(all.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );
}

type DraftJson = { history?: unknown; doc?: { width: number; height: number; ops: { kind: string }[]; layers: unknown[] }; size?: { width: number; height: number } } | null;

async function readDraft(page: Page, key: string): Promise<DraftJson> {
  return page.evaluate((k) => {
    const raw = sessionStorage.getItem(k);
    return raw ? (JSON.parse(raw) as DraftJson) : null;
  }, key);
}

/** 紙の上の濃い画素の外接矩形（画面の描画面で見る） */
async function inkBox(canvas: Locator): Promise<{ n: number; x0: number; y0: number; x1: number; y1: number }> {
  return canvas.evaluate((el: HTMLCanvasElement) => {
    const c = el.getContext('2d')!;
    const { data, width, height } = c.getImageData(0, 0, el.width, el.height);
    let n = 0;
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3]! > 0 && data[i]! + data[i + 1]! + data[i + 2]! < 300) {
          n++;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    return { n, x0, y0, x1, y1 };
  });
}

// ---------------------------------------------------------------------------

test.describe('統合: 保存形式・ギャラリー・下書き', () => {
  test('ギャラリー: 塗りを含む絵は contentRect で再生し、縦横の倍率がそろう', async ({ page }) => {
    const paper = await openFree(page);
    // 線は小さく左寄り、塗り（空のレイヤーを塗る＝紙全体）は線よりずっと広い
    await drag(page, paper, [0.3, 0.45], [0.38, 0.5]);
    await addLayer(page);
    await fillAt(page, paper, [0.7, 0.3]);
    await saveFree(page);

    const [d] = await storedDrawings(page);
    expect(d?.meta?.doc).toBeDefined();
    const rect = d!.meta!.contentRect!;
    expect(rect).toBeDefined();
    // 画像と範囲の縦横比が一致する
    expect(Math.abs(rect.width / rect.height - d!.imageW / d!.imageH)).toBeLessThan(0.02 * (d!.imageW / d!.imageH));

    await page.getByRole('link', { name: 'ギャラリー' }).click();
    await page.getByRole('link', { name: /^自由 / }).first().click();
    await page.getByRole('button', { name: '描いた順に再生' }).click();
    const host = page.locator('.replay__host');
    await expect(host).toBeVisible();
    await expect.poll(async () => (await host.getAttribute('style')) ?? '').toMatch(/scale\(/);
    const style = (await host.getAttribute('style')) ?? '';
    const m = /scale\(([\d.e-]+),\s*([\d.e-]+)\)/.exec(style);
    expect(m).not.toBeNull();
    const sx = Number(m![1]);
    const sy = Number(m![2]);
    expect(Math.abs(sx - sy) / sx).toBeLessThan(0.02);
  });

  test('下書き: 文書つきは history を持たず、再読込の「続きから」でレイヤーごと戻る。保存に失敗したら残さない', async ({ page }) => {
    const paper = await openFree(page);
    await drag(page, paper, [0.35, 0.45], [0.55, 0.55]);
    await addLayer(page);
    await fillAt(page, paper, [0.7, 0.3]);
    const key = 'seichotsu.draft.free';
    await expect.poll(async () => (await readDraft(page, key))?.doc?.ops.length ?? 0).toBeGreaterThan(1);
    const draft = await readDraft(page, key);
    expect(draft?.history).toBeUndefined();

    page.on('dialog', (dlg) => void dlg.accept());
    await page.reload();
    await page.locator('.loading').waitFor({ state: 'detached' }).catch(() => undefined);
    const offer = page.getByRole('dialog', { name: '描きかけがあります' });
    await expect(offer).toBeVisible();
    await offer.getByRole('button', { name: '続きから' }).click();
    await toolbar(page).getByRole('button', { name: 'レイヤー', exact: true }).click();
    await expect(page.getByTestId('layer-panel').locator('.pt-layer')).toHaveCount(2);
    await page.getByTestId('layer-panel').getByRole('button', { name: 'レイヤーを閉じる' }).click();

    // 容量不足（setItem が失敗する）: 古い下書きも消して静かに諦める
    await expect.poll(async () => (await readDraft(page, key)) !== null).toBe(true);
    await page.evaluate(() => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k: string, v: string) {
        if (k.startsWith('seichotsu.draft.')) throw new DOMException('quota', 'QuotaExceededError');
        return orig.call(this, k, v);
      };
    });
    await drag(page, paper, [0.4, 0.6], [0.6, 0.66]);
    await expect.poll(() => page.evaluate((k) => sessionStorage.getItem(k), key)).toBeNull();
    // 画面にはエラーを出さない
    await expect(page.locator('.toast--danger, [role="alert"]')).toHaveCount(0);
  });

  test('回転: 塗り・変形を含む文書が新しい紙の大きさへ写される', async ({ page }) => {
    const paper = await openFree(page);
    await drag(page, paper, [0.35, 0.45], [0.55, 0.55]);
    await moveSelection(page, paper, [0.3, 0.4], [0.6, 0.6]);
    await addLayer(page);
    await fillAt(page, paper, [0.8, 0.25]);
    const key = 'seichotsu.draft.free';
    await expect.poll(async () => (await readDraft(page, key))?.doc?.ops.map((o) => o.kind).join(',') ?? '').toMatch(/transform.*fill/);
    const before = (await readDraft(page, key))!;

    await page.setViewportSize({ width: 920, height: 1472 });
    const box = await paper.boundingBox();
    expect(box).not.toBeNull();
    await expect
      .poll(async () => (await readDraft(page, key))?.size?.width ?? 0)
      .toBeLessThan(before.size!.width);
    const after = (await readDraft(page, key))!;
    expect(after.doc!.width).toBe(after.size!.width);
    expect(after.doc!.height).toBe(after.size!.height);
    const kinds = after.doc!.ops.map((o) => o.kind);
    expect(kinds).toContain('fill');
    expect(kinds).toContain('transform');
    expect(after.doc!.layers.length).toBe(before.doc!.layers.length);
    // 画面にも塗りが残る
    await expect.poll(async () => (await inkBox(paper.locator('canvas').first())).n).toBeGreaterThan(1000);
  });

  test('合成（スクリーン）: 書き出しが画面と同じ（明るい紙の上では色がほぼ消える）', async ({ page }) => {
    const paper = await openFree(page);
    await addLayer(page);
    await toolbar(page).getByRole('button', { name: 'レイヤー', exact: true }).click();
    const panel = page.getByTestId('layer-panel');
    await panel.getByRole('radio', { name: 'スクリーン' }).click();
    await expect(panel.getByRole('radio', { name: 'スクリーン' })).toHaveAttribute('aria-checked', 'true');
    await panel.getByRole('button', { name: 'レイヤーを閉じる' }).click();
    // 赤のペンで描く
    const pen = toolbar(page).getByRole('button', { name: 'ペン', exact: true });
    await pen.click();
    await page.getByRole('radio', { name: /^赤/ }).first().click();
    await pen.click();
    await drag(page, paper, [0.35, 0.45], [0.6, 0.6]);
    await drag(page, paper, [0.35, 0.5], [0.6, 0.65]);

    // 画面に見えている色（紙の CSS 背景も含む）: 線の中ほどを切り出す
    const box = (await paper.boundingBox())!;
    const shotPng = await page.screenshot({
      clip: { x: box.x + box.width * 0.42, y: box.y + box.height * 0.5, width: box.width * 0.12, height: box.height * 0.1 },
    });
    await saveFree(page);
    await page.getByRole('link', { name: 'ギャラリー' }).click();
    await page.getByRole('link', { name: /^自由 / }).first().click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PNG で書き出す' }).click()]);
    const redness = (png: Buffer) =>
      page.evaluate(async (s) => {
        const bin = Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bin], { type: 'image/png' }));
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(bmp, 0, 0);
        const { data } = ctx.getImageData(0, 0, c.width, c.height);
        // 赤み（R − G）の最大。線の芯の色を見る
        let max = -255;
        for (let i = 0; i < data.length; i += 4) if (data[i + 3]! > 200) max = Math.max(max, data[i]! - data[i + 1]!);
        return max;
      }, png.toString('base64'));
    const onScreen = await redness(shotPng);
    const inExport = await redness(readFileSync(await dl.path()));
    // 書き出しは画面と同じ見た目（紙色の上で合成）。透明の上で合成すると赤がそのまま出て食い違う
    expect(Math.abs(onScreen - inExport), `画面 ${onScreen} / 書き出し ${inExport}`).toBeLessThan(40);
  });
});

test.describe('統合: ダーク', () => {
  test.use({ colorScheme: 'dark' });

  test('ダークで墨の塗りは記号（ink）のまま保存する', async ({ page }) => {
    const paper = await openFree(page);
    await drag(page, paper, [0.35, 0.45], [0.55, 0.55]);
    await fillAt(page, paper, [0.8, 0.25]);
    await saveFree(page);
    const [d] = await storedDrawings(page);
    const fills = (d?.meta?.doc?.ops ?? []).filter((o) => o.kind === 'fill');
    expect(fills.length).toBe(1);
    expect(fills[0]!.color).toBe('ink');
  });
});

test.describe('統合: ジェスチャー（フルツール）', () => {
  test('レイヤー・塗り・変形を使った体を保存でき、変形バーはタイマーを覆わない', async ({ page }) => {
    const hit = findStep((s) => s.type === 'gesture' && s.source !== 'user');
    test.skip(!hit, 'ジェスチャーのステップが教材に無い');
    await gotoApp(page);
    await page.goto(`/?seed=7#/lesson/${hit!.lessonId}/step/${hit!.index}`);
    await page.locator('.loading').waitFor({ state: 'detached' }).catch(() => undefined);
    const paper = page.locator('.ls-canvas__paper');
    await expect(paper.locator('canvas').first()).toBeVisible();
    await expect(page.locator('.ls-timer')).toBeVisible();

    // 紙の左側はツールバー・グリッド欄が重なるので右寄りで描く
    await drag(page, paper, [0.55, 0.45], [0.75, 0.55]);
    await addLayer(page);
    await fillAt(page, paper, [0.9, 0.8]);
    // 変形バーの位置: タイマーより下
    await toolbar(page).getByRole('button', { name: '矩形選択' }).click();
    await drag(page, paper, [0.5, 0.35], [0.8, 0.65], 6);
    const bar = page.getByTestId('transform-bar');
    await expect(bar.getByRole('button', { name: '確定' })).toBeVisible();
    const tb = await page.locator('.ls-timer').boundingBox();
    const bb = await bar.boundingBox();
    expect(tb && bb && bb.y >= tb.y + tb.height - 1).toBe(true);
    // 変形のプレビュー中のまま「先に終える」: 変形を確定してから線・画像を取る
    const body = page.getByTestId('selection-body');
    const b = await body.boundingBox();
    if (!b) throw new Error('選択枠が見つかりません');
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.getByRole('button', { name: '先に終える' }).click();
    await expect(page.getByRole('heading', { name: '見比べ' })).toBeVisible();
    await page.getByRole('button', { name: /次のポーズ|終える/ }).click();
    await expect.poll(async () => (await storedDrawings(page)).length).toBe(1);
    const [d] = await storedDrawings(page);
    const kinds = (d?.meta?.doc?.ops ?? []).map((o) => o.kind);
    expect(kinds).toContain('fill');
    expect(kinds).toContain('transform');
    expect(d?.meta?.contentRect).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 採点する画面の保護（gestures: false）
// ---------------------------------------------------------------------------

async function pinch(page: Page, paper: Locator): Promise<void> {
  const box = await paper.boundingBox();
  if (!box) throw new Error('紙が見つかりません');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const pts = (d: number) => [
    { x: cx - d, y: cy, id: 1 },
    { x: cx + d, y: cy, id: 2 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(40) });
  for (let d = 50; d <= 200; d += 15) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

function drillStep(minCount: number) {
  return findStep((s) => s.type === 'drill' && s.drill === 'line' && Number(s.count) >= minCount);
}

async function openDrill(page: Page, lessonId: string, index: number): Promise<Locator> {
  await page.goto(`/#/lesson/${lessonId}/step/${index}`);
  await page.locator('.loading').waitFor({ state: 'detached' }).catch(() => undefined);
  const start = page.getByRole('button', { name: '描く' });
  if (await start.isVisible().catch(() => false)) await start.click();
  const paper = page.locator('.ls-canvas__paper');
  await expect(paper.locator('canvas').first()).toBeVisible();
  return paper;
}

test.describe('統合: 採点する画面の保護', () => {
  test.use({ hasTouch: true });

  test('自由お絵描きではピンチでズームし、ドリルではビューが動かない', async ({ page }) => {
    // 対照: フルツールではピンチが効く
    const free = await openFree(page);
    const pct = page.getByTestId('zoom-pill').locator('.pt-zoom__pct');
    const pct0 = await pct.textContent();
    await pinch(page, free);
    await expect.poll(() => pct.textContent()).not.toBe(pct0);

    const hit = drillStep(3);
    test.skip(!hit, '直線ドリルが教材に無い');
    const paper = await openDrill(page, hit!.lessonId, hit!.index);
    const canvas = paper.locator('canvas').first();
    await drawLine(page, canvas, { yRatio: 0.45, dx: 300, dy: 0 });
    const before = await inkBox(canvas);
    expect(before.n).toBeGreaterThan(50);
    await pinch(page, paper);
    await page.waitForTimeout(200);
    const after = await inkBox(canvas);
    // 線の位置も大きさも変わらない（ズーム・パン・回転しない）
    expect(Math.abs(after.x0 - before.x0)).toBeLessThanOrEqual(2);
    expect(Math.abs(after.x1 - before.x1)).toBeLessThanOrEqual(2);
    expect(Math.abs(after.y0 - before.y0)).toBeLessThanOrEqual(2);
    expect(Math.abs(after.y1 - before.y1)).toBeLessThanOrEqual(2);
  });
});

test.describe('統合: 全部消した線がよみがえらない', () => {
  test('ドリル: 全部消す → 描き直し → 回転 → 再読込の「続きから」で 1 本だけ', async ({ page }) => {
    const hit = drillStep(4);
    test.skip(!hit, '直線 4 本以上のドリルが教材に無い');
    const count = Number(hit!.step.count);
    await gotoApp(page);
    const paper = await openDrill(page, hit!.lessonId, hit!.index);
    const canvas = paper.locator('canvas').first();
    await drawLine(page, canvas, { yRatio: 0.35, dx: 300, dy: 0 });
    await drawLine(page, canvas, { yRatio: 0.55, dx: 300, dy: 0 });
    await expect(page.locator('.ls-counter')).toHaveText(`3/${count}`);

    await toolbar(page).getByRole('button', { name: '全部消す' }).click();
    await expect(page.locator('.ls-counter')).toHaveText(`1/${count}`);
    await drawLine(page, canvas, { yRatio: 0.45, dx: 300, dy: 0 });
    await expect(page.locator('.ls-counter')).toHaveText(`2/${count}`);

    // 回転（紙の大きさが変わる）
    await page.setViewportSize({ width: 920, height: 1472 });
    await expect(page.locator('.ls-counter')).toHaveText(`2/${count}`);
    const key = `seichotsu.draft.${hit!.lessonId}.${hit!.index}`;
    await expect
      .poll(async () => ((await readDraft(page, key)) as { history?: { strokes: unknown[] } } | null)?.history?.strokes.length ?? -1)
      .toBe(1);

    page.on('dialog', (dlg) => void dlg.accept());
    await page.reload();
    await page.locator('.loading').waitFor({ state: 'detached' }).catch(() => undefined);
    const start = page.getByRole('button', { name: '描く' });
    if (await start.isVisible().catch(() => false)) await start.click();
    const offer = page.getByRole('dialog', { name: '描きかけがあります' });
    await expect(offer).toBeVisible();
    await offer.getByRole('button', { name: '続きから' }).click();
    await expect(page.locator('.ls-counter')).toHaveText(`2/${count}`);
  });
});
