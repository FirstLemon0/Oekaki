/**
 * お絵描き v2（フルツール）: レイヤー・塗りつぶし・選択と変形・ズーム表示・透過 PNG 書き出し。
 * 自由お絵描き #/free で確かめる。
 * PAINT_SHOTS_DIR を渡すと、各場面のスクリーンショットをそこへ保存する（見た目の確認用）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { gotoApp } from './helpers';

const SHOTS = process.env.PAINT_SHOTS_DIR;

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

async function openFree(page: Page): Promise<Locator> {
  await gotoApp(page);
  await page.getByRole('link', { name: /自由お絵描き/ }).click();
  const paper = page.locator('.ls-canvas__paper');
  await expect(paper.locator('canvas').first()).toBeVisible();
  return paper;
}

/** 紙の上をドラッグする（割合で指定。UI と重ならない中央寄り） */
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

const toolbar = (page: Page) => page.getByRole('toolbar', { name: '描画ツール' });

test.describe('お絵描き v2', () => {
  test('レイヤー: 追加 → 描く → 不透明度 → 下と結合', async ({ page }) => {
    const paper = await openFree(page);
    await toolbar(page).getByRole('button', { name: 'レイヤー', exact: true }).click();
    const panel = page.getByTestId('layer-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.pt-layer')).toHaveCount(1);

    await panel.getByRole('button', { name: '追加' }).click();
    await expect(panel.locator('.pt-layer')).toHaveCount(2);
    // 新しいレイヤーが上（手前）に入り、選択中になる
    await expect(panel.locator('.pt-layer').first()).toHaveClass(/is-active/);
    await expect(panel.locator('.pt-layer.is-active .pt-layer__name')).toHaveText('レイヤー 2');

    await drag(page, paper, [0.3, 0.45], [0.5, 0.6]);
    await expect(toolbar(page).getByRole('button', { name: '元に戻す' })).toBeEnabled();

    const slider = panel.getByRole('slider', { name: 'レイヤーの不透明度' });
    await slider.fill('40');
    await expect(panel.locator('.pt-layers__val')).toHaveText('40%');

    // 合成モード
    await panel.getByRole('radio', { name: '乗算' }).click();
    await expect(panel.getByRole('radio', { name: '乗算' })).toHaveAttribute('aria-checked', 'true');

    // 目・鍵
    const eye = panel.getByRole('button', { name: 'レイヤー 2を隠す' });
    await eye.click();
    await expect(panel.getByRole('button', { name: 'レイヤー 2を表示する' })).toBeVisible();
    await panel.getByRole('button', { name: 'レイヤー 2を表示する' }).click();
    await panel.getByRole('button', { name: 'レイヤー 2をロックする' }).click();
    await expect(page.locator('.pt-locknote')).toBeVisible();
    await panel.getByRole('button', { name: 'レイヤー 2のロックを外す' }).click();
    await expect(page.locator('.pt-locknote')).toHaveCount(0);
    await shot(page, '01-layers');

    await panel.getByRole('button', { name: '下と結合' }).click();
    await expect(panel.locator('.pt-layer')).toHaveCount(1);

    // 閉じる
    await panel.getByRole('button', { name: 'レイヤーを閉じる' }).click();
    await expect(panel).toHaveCount(0);
  });

  test('塗りつぶし: 許容値と境界を選んで塗る → 保存できる', async ({ page }) => {
    const paper = await openFree(page);
    const fill = toolbar(page).getByRole('button', { name: '塗りつぶし' });
    await fill.click();
    await expect(fill).toHaveAttribute('aria-pressed', 'true');
    // もう一度押すと小パネル
    await fill.click();
    const panel = page.getByRole('group', { name: '塗りつぶしの設定' });
    await expect(panel).toBeVisible();
    await panel.getByRole('slider', { name: '塗りつぶしの許容値' }).fill('50');
    await expect(panel.locator('.ls-pop__val')).toHaveText('50');
    await panel.getByRole('radio', { name: 'すべて' }).click();
    await expect(panel.getByText('色はペンの色を使います', { exact: false })).toBeVisible();
    await shot(page, '02-fill-panel');

    await tapPaper(page, paper, [0.55, 0.55]);
    await expect(panel).toHaveCount(0); // 紙に触れたら閉じる
    await expect(toolbar(page).getByRole('button', { name: '元に戻す' })).toBeEnabled();
    await shot(page, '03-filled');

    // 塗りだけの絵も保存できる（meta.doc 付き）
    await page.getByRole('button', { name: '終わる' }).click();
    await page.getByRole('button', { name: '保存して終わる' }).click();
    await expect(page.getByRole('link', { name: /自由お絵描き/ })).toBeVisible();
    await page.getByRole('link', { name: 'ギャラリー' }).click();
    await expect(page.getByRole('link', { name: /^自由 / })).toHaveCount(1);
  });

  test('選択 → 移動 → 確定', async ({ page }) => {
    const paper = await openFree(page);
    await drag(page, paper, [0.4, 0.45], [0.55, 0.55]);

    await toolbar(page).getByRole('button', { name: '矩形選択' }).click();
    const bar = page.getByTestId('transform-bar');
    await expect(bar).toContainText('矩形選択');
    await drag(page, paper, [0.35, 0.4], [0.6, 0.62]);
    await expect(bar.getByRole('button', { name: '確定' })).toBeVisible();
    await expect(bar.getByRole('button', { name: '取消' })).toBeDisabled();

    // 枠の中をドラッグして移動
    const body = page.getByTestId('selection-body');
    const b = await body.boundingBox();
    if (!b) throw new Error('選択枠が見つかりません');
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 80, b.y + b.height / 2 + 40, { steps: 8 });
    await page.mouse.up();
    await expect(bar.getByRole('button', { name: '取消' })).toBeEnabled();
    // 左右反転・回転ハンドルも出ている
    await expect(page.getByTestId('rotate-handle')).toBeVisible();
    await bar.getByRole('button', { name: '左右反転' }).click();
    await shot(page, '04-transform');

    await bar.getByRole('button', { name: '確定' }).click();
    await expect(bar.getByRole('button', { name: '確定' })).toHaveCount(0);
    await expect(page.getByTestId('selection-body')).toHaveCount(0);
    // 選択ツールのままなら「すべて選択」だけのバー
    await expect(bar.getByRole('button', { name: 'すべて選択' })).toBeVisible();
    await expect(toolbar(page).getByRole('button', { name: '元に戻す' })).toBeEnabled();

    // ペンに戻すと課題ピルに戻る
    await toolbar(page).getByRole('button', { name: 'ペン', exact: true }).click();
    await expect(page.getByTestId('transform-bar')).toHaveCount(0);
    await expect(page.locator('.ls-task')).toBeVisible();
  });

  test('ズーム表示: ピルに倍率、手のひらで動かしてタップで全体表示', async ({ page }) => {
    const paper = await openFree(page);
    const pill = page.getByTestId('zoom-pill').locator('.pt-zoom__pct');
    await expect(pill).toHaveText(/^\d+%$/);
    await toolbar(page).getByRole('button', { name: /手のひら/ }).click();
    await drag(page, paper, [0.5, 0.5], [0.6, 0.6]);
    await pill.click();
    await expect(pill).toHaveText(/^\d+%$/);
    await shot(page, '05-zoom');
  });

  test('HSV ピッカーと直近の色・図形', async ({ page }) => {
    const paper = await openFree(page);
    const pen = toolbar(page).getByRole('button', { name: 'ペン', exact: true });
    await pen.click(); // 選択中にもう一度 → 小パネル
    const picker = page.getByTestId('hsv-picker');
    await expect(picker).toBeVisible();
    const sv = picker.getByRole('slider', { name: '彩度と明るさ' });
    const box = await sv.boundingBox();
    if (!box) throw new Error('ピッカーが見つかりません');
    await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.2);
    // 指を離した色が「最近の色」に入る
    await expect(page.getByRole('radiogroup', { name: '最近の色' }).getByRole('radio')).toHaveCount(1);
    // パレットの色を選ぶとピッカーもその色になる
    await page.getByRole('radio', { name: '墨（テーマの色）' }).click();
    await expect(picker.locator('.pt-hsv__hex')).toHaveText('#2b2a28');
    await shot(page, '06-hsv');

    // 図形: もう一度押して「楕円」
    const shape = toolbar(page).getByRole('button', { name: /^図形/ });
    await shape.click();
    await shape.click();
    await page.getByRole('radio', { name: '楕円' }).click();
    await expect(toolbar(page).getByRole('button', { name: '図形（楕円）' })).toBeVisible();
    await expect(page.getByRole('group', { name: '図形の種類' })).toHaveCount(0); // 選んだら閉じる
    await drag(page, paper, [0.35, 0.35], [0.55, 0.6]);
    await expect(toolbar(page).getByRole('button', { name: '元に戻す' })).toBeEnabled();
  });

  test('透過 PNG を書き出す・ギャラリーから PNG で書き出す', async ({ page }) => {
    const paper = await openFree(page);
    await drag(page, paper, [0.35, 0.45], [0.6, 0.6]);
    await page.getByRole('button', { name: '終わる' }).click();
    const sheet = page.getByRole('dialog', { name: '終わる' });
    await expect(sheet).toBeVisible();
    await shot(page, '07-end-sheet');

    const [dl] = await Promise.all([page.waitForEvent('download'), sheet.getByRole('button', { name: '透過 PNG を書き出す' }).click()]);
    expect(dl.suggestedFilename()).toMatch(/^seichotsu-free-\d{8}-\d{4}\.png$/);
    const bytes = readFileSync(await dl.path());
    // PNG の署名と、IHDR の色の種類 6（RGBA＝透過あり）
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(bytes[25]).toBe(6);
    await expect(sheet.getByText('透過 PNG を書き出しました。')).toBeVisible();

    // 描き続ける → シートが閉じる → もう一度終わる → 保存
    await sheet.getByRole('button', { name: '描き続ける' }).click();
    await expect(sheet).toHaveCount(0);
    await page.getByRole('button', { name: '終わる' }).click();
    await page.getByRole('button', { name: '保存して終わる' }).click();

    await page.getByRole('link', { name: 'ギャラリー' }).click();
    await page.getByRole('link', { name: /^自由 / }).first().click();
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PNG で書き出す' }).click()]);
    expect(dl2.suggestedFilename()).toMatch(/\.png$/);
    const b2 = readFileSync(await dl2.path());
    expect([...b2.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    await shot(page, '08-gallery-detail');
  });
});

test.describe('お絵描き v2（縦向き）', () => {
  test.use({ viewport: { width: 920, height: 1472 } });

  test('ツールバーは 2 段、レイヤーは下からのシート', async ({ page }) => {
    await openFree(page);
    const bar = toolbar(page);
    const box = await bar.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.width).toBeGreaterThan(box.height);
      expect(box.height).toBeLessThan(130);
    }
    await bar.getByRole('button', { name: 'レイヤー', exact: true }).click();
    const panel = page.getByTestId('layer-panel');
    const pb = await panel.boundingBox();
    expect(pb && pb.width).toBeGreaterThan(900);
    expect(pb && pb.y + pb.height).toBeGreaterThan(1460);
    await shot(page, '09-portrait-layers');
  });
});

test.describe('簡易ツール（採点する画面）', () => {
  test('校正ではレイヤー・塗り・選択を出さない', async ({ page }) => {
    await gotoApp(page, '#/calibrate');
    const bar = toolbar(page);
    await expect(bar).toBeVisible();
    await expect(bar.getByRole('button', { name: 'ペン', exact: true })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'レイヤー', exact: true })).toHaveCount(0);
    await expect(bar.getByRole('button', { name: '塗りつぶし' })).toHaveCount(0);
    await expect(bar.getByRole('button', { name: '矩形選択' })).toHaveCount(0);
    // ビュー（ズーム率のピル）は出る
    await expect(page.getByTestId('zoom-pill')).toBeVisible();
    await shot(page, '10-simple-calibrate');
  });
});
