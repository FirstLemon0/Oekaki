/**
 * 実機フィードバック（3 回目）の新しい挙動を実操作で確かめる。
 *
 * - 戻る警告: 保存していない線があると「← 戻る」・端末の戻るで確認が出る（描き続ける／戻る）
 * - 下書き: 描きかけで再読込（閉じる確認も出る）→「描きかけがあります」→ 続きから で線が戻る
 * - 復習スキップ: レッスン開始時の復習を「スキップ」で本編へ。ホームの復習も今日は出ない
 * - 10 回タップ開放: ロックのノードを 3 秒以内に 10 回で「開放」になり、開ける
 * - ドリルの薄表示: 採点済みの線は最新 1 本＋薄い 3 本だけ。「紙を替える」で表示を消しても本数はそのまま
 * - ツールバーを反対側へ: 完了ボタンも反対側へ
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { drawFewStrokes, drawLine, gotoApp } from './helpers';

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

/** 紙色と違う（濃い）画素の数。薄く出した線（不透明度 0.3）は数えない */
async function inkPixels(canvas: Locator): Promise<number> {
  return canvas.evaluate((el: HTMLCanvasElement) => {
    const c = el.getContext('2d')!;
    const { data } = c.getImageData(0, 0, el.width, el.height);
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i]! + data[i + 1]! + data[i + 2]! < 300) ink++;
    return ink;
  });
}

async function openFree(page: Page): Promise<Locator> {
  await gotoApp(page);
  await page.getByRole('link', { name: /自由お絵描き/ }).click();
  const canvas = page.locator('.ls-canvas__paper canvas');
  await expect(canvas).toBeVisible();
  return canvas;
}

test.describe('実機フィードバック 3', () => {
  test('戻る警告: 保存していない線があると「戻る」・端末の戻るで確かめる', async ({ page }) => {
    const canvas = await openFree(page);
    const pill = page.locator('.ls-canvas__exit .back-pill');
    await expect(pill).toHaveText(/戻る/);

    await drawFewStrokes(page, canvas, 2);
    const dialog = page.getByRole('dialog', { name: '描いた線が消えます。戻りますか？' });

    // 画面の「戻る」→ 描き続ける（線は残る）
    await pill.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '描き続ける' }).click();
    await expect(dialog).toHaveCount(0);
    expect(await inkPixels(canvas)).toBeGreaterThan(50);

    // 端末の戻る → 確認が出て、画面はそのまま
    await page.goBack();
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/#\/free$/);
    await dialog.getByRole('button', { name: '描き続ける' }).click();

    // もう一度端末の戻る → 「戻る」でホームへ
    await page.goBack();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '戻る', exact: true }).click();
    await expect(page.getByRole('link', { name: /自由お絵描き/ })).toBeVisible();
    await expect(page).not.toHaveURL(/#\/free/);
  });

  test('下書き: 描きかけで再読込しても「続きから」で線が戻る', async ({ page }) => {
    const canvas = await openFree(page);
    await drawFewStrokes(page, canvas, 3);
    const before = await inkPixels(canvas);
    expect(before).toBeGreaterThan(50);
    // 下書きは 1 秒まとめて保存
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('seichotsu.draft.free') !== null)).toBe(true);

    // 閉じる（再読込）ときはブラウザの確認が出る
    const kinds: string[] = [];
    page.on('dialog', (d) => {
      kinds.push(d.type());
      void d.accept();
    });
    await page.reload();
    await page.locator('.loading').waitFor({ state: 'detached' }).catch(() => undefined);
    expect(kinds).toContain('beforeunload');

    const offer = page.getByRole('dialog', { name: '描きかけがあります' });
    await expect(offer).toBeVisible();
    await offer.getByRole('button', { name: '続きから' }).click();
    const canvas2 = page.locator('.ls-canvas__paper canvas');
    await expect.poll(() => inkPixels(canvas2)).toBeGreaterThan(before * 0.5);

    // 保存（終わる）したら下書きは消える
    await page.getByRole('button', { name: '終わる' }).click();
    await expect(page.getByRole('link', { name: /自由お絵描き/ })).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('seichotsu.draft.free'))).toBeNull();
  });

  test('復習スキップ: 差し込まれた復習を飛ばして本編へ。今日はホームにも出ない', async ({ page }) => {
    await gotoApp(page);
    // 20 日前に 1 回だけやった直線ドリル（14 日以上で復習の対象）
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const req = indexedDB.open('seichotsu');
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('drillStats', 'readwrite');
            const at = new Date(Date.now() - 20 * 86400000).toISOString();
            tx.objectStore('drillStats').put({ drillType: 'line', history: [{ at, score: 80 }], bestScore: 80, updatedAt: at });
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
          req.onerror = () => reject(req.error);
        }),
    );
    await page.reload();
    await page.locator('.loading').waitFor({ state: 'detached' }).catch(() => undefined);
    await expect(page.getByRole('button', { name: /^復習 / })).toBeVisible();

    await page.getByRole('link', { name: 'Before を描く' }).click();
    await expect(page.getByText('ウォームアップ（復習）')).toBeVisible();
    await page.getByRole('button', { name: 'スキップ' }).click();
    await expect(page.getByRole('heading', { name: 'このアプリの約束' })).toBeVisible();

    // ホームへ戻ると復習のノードは出ない（期限を 1 日延ばした）
    await page.locator('.ls-head .back-pill').click();
    await expect(page.getByRole('link', { name: /自由お絵描き/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^復習 / })).toHaveCount(0);
  });

  test('10 回タップ開放: ロックのノードを続けて叩くと開放され、開ける', async ({ page }) => {
    await gotoApp(page);
    const locked = page.getByRole('button', { name: /^L2 .*（ロック中）$/ });
    await expect(locked).toBeVisible();
    // 振れのアニメーションで「止まるまで待つ」が入らないよう force（3 秒の窓に収める）
    for (let i = 0; i < 10; i++) await locked.click({ force: true });
    await expect(page.getByText('開放しました')).toBeVisible();
    const opened = page.getByRole('button', { name: /^L2 .*（開放）$/ });
    await expect(opened).toBeVisible();
    await opened.click();
    await expect(page).toHaveURL(/#\/lesson\//);
  });

  test('ドリルの薄表示: 古い線は薄く・隠す。「紙を替える」でも本数はそのまま', async ({ page }) => {
    const lesson = allLessons().find((l) => l.steps.some((s) => s.type === 'drill' && s.drill === 'line' && Number(s.count) >= 7));
    test.skip(!lesson, '直線 7 本以上のドリルが教材に無い');
    const index = lesson!.steps.findIndex((s) => s.type === 'drill' && s.drill === 'line' && Number(s.count) >= 7);
    const count = Number(lesson!.steps[index]!.count);
    await gotoApp(page);
    await page.goto(`/#/lesson/${lesson!.id}/step/${index}`);
    await page.locator('.loading').waitFor({ state: 'detached' }).catch(() => undefined);
    await page.getByRole('button', { name: '描く' }).click();
    const canvas = page.locator('.ls-canvas__paper canvas');
    await expect(canvas).toBeVisible();

    const heat = page.locator('.ls-guide__heat');
    for (let k = 0; k < 5; k++) {
      await drawLine(page, canvas, { yRatio: 0.3 + k * 0.1, dx: 300, dy: 0 });
      await expect(page.locator('.ls-counter')).toHaveText(`${k + 2}/${count}`);
    }
    // 5 本描いた: 最新 1 本＋薄い 3 本（いちばん古い 1 本は出さない）
    await expect(heat).toHaveCount(4);
    await expect(page.locator('.ls-guide__heat[opacity="0.3"]')).toHaveCount(3);
    const inkAll = await inkPixels(canvas);
    expect(inkAll).toBeGreaterThan(50);

    // 紙を替える: 表示上の線は全部消えるが、本数（カウンター）はそのまま
    await page.getByRole('button', { name: /^紙を替える/ }).click();
    await expect(heat).toHaveCount(0);
    await expect.poll(() => inkPixels(canvas)).toBeLessThan(10);
    await expect(page.locator('.ls-counter')).toHaveText(`6/${count}`);

    // 次の 1 本はふつうに出て数えられる
    await drawLine(page, canvas, { yRatio: 0.5, dx: 300, dy: 0 });
    await expect(page.locator('.ls-counter')).toHaveText(`7/${count}`);
    await expect(heat).toHaveCount(1);
  });

  test('ツールバーを反対側へ: ツールバーと完了ボタンが入れ替わり、設定の利き手も変わる', async ({ page }) => {
    await openFree(page);
    const done = page.locator('.ls-donebtn');
    const vw = page.viewportSize()!.width;
    expect((await done.boundingBox())!.x).toBeGreaterThan(vw / 2);
    await page.getByRole('button', { name: 'ツールバーを反対側へ' }).click();
    await expect(page.locator('.ls-canvas.is-left')).toBeVisible();
    expect((await done.boundingBox())!.x).toBeLessThan(vw / 2);
    expect((await page.locator('.ls-toolbar').boundingBox())!.x).toBeGreaterThan(vw / 2);

    // 設定の「利き手」も左になっている（描いていないので確認なしで戻れる）
    await page.locator('.ls-canvas__exit .back-pill').click();
    await gotoApp(page, '#/settings?section=practice');
    await expect(page.getByRole('radio', { name: '左' })).toHaveAttribute('aria-checked', 'true');
  });
});
