/**
 * バックアップ: 設定から zip を書き出し → IndexedDB を消して再読込 → 読み込み →
 * 進捗が戻ることを確認する。
 *
 * 注: 前を終えたら次はすぐ開く（DESIGN.md §6）。進捗が戻ったことは L1「完了」・
 * L2「今日」（＝ロックが外れている）で判定する。
 */
import { expect, test, type Page } from '@playwright/test';
import { drawLine, gotoApp, wipeIndexedDb } from './helpers';

/** 設定画面を開き、見出しが出るまで待つ（ハッシュ遷移だけでは描画完了を保証しないため） */
async function gotoSettings(page: Page): Promise<void> {
  await gotoApp(page, '#/settings');
  await expect(page.getByRole('heading', { name: '設定', level: 1 })).toBeVisible();
}

test.describe('バックアップ', () => {
  test('書き出し→データ消去→読み込みで進捗が戻る', async ({ page }) => {
    await gotoApp(page);

    // 進捗を1つ作っておく（s0-u1-l1 を完了）
    await page.getByRole('link', { name: 'Before を描く' }).click();
    await page.getByRole('button', { name: '次へ' }).click();
    const canvas = page.locator('.ls-canvas__paper canvas');
    await expect(canvas).toBeVisible();
    await drawLine(page, canvas);
    await page.getByRole('button', { name: '終わる' }).click();
    await expect(page.getByRole('heading', { name: '今日の分は終わり。' })).toBeVisible();
    await page.getByRole('button', { name: 'ホームへ' }).click();
    await expect(page.getByRole('button', { name: /^L1 .*（完了）$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^L2 .*（今日）$/ })).toBeVisible();

    // 書き出し
    await gotoSettings(page);
    const exportButton = page.getByRole('button', { name: 'zip で書き出す' });
    await expect(exportButton).toBeVisible();
    await expect(exportButton).toBeEnabled();
    const downloadPromise = page.waitForEvent('download');
    await exportButton.click();
    const download = await downloadPromise;
    await expect(page.getByText('バックアップを書き出しました')).toBeVisible();
    const filePath = await download.path();
    expect(filePath).not.toBeNull();

    // データを消して開き直す（初回起動の状態に戻ることを確認）
    await wipeIndexedDb(page);
    await gotoApp(page, '#/');
    await expect(page.getByRole('link', { name: 'Before を描く' })).toBeVisible();

    // 読み込み
    await gotoSettings(page);
    await page.locator('input[type="file"]').setInputFiles(filePath as string);
    const dialog = page.getByRole('dialog', { name: 'データを置き換えますか' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '置き換える' }).click();
    await expect(page.getByText('バックアップを読み込みました')).toBeVisible();

    // 進捗が戻っている
    await gotoApp(page, '#/');
    await expect(page.getByRole('button', { name: /^L1 .*（完了）$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^L2 .*（今日）$/ })).toBeVisible();
  });
});
