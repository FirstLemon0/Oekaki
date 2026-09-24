/**
 * 最初のレッスン（s0-u1-l1）を最後まで進め、完了モーダル → ホームで
 * パスが1歩進む（L1 が完了・L2 のロックが外れる）ことを確認する。
 *
 * 注: 今日のノードは「未完了の最初のレッスン」（DESIGN.md §6）。前を終えたら日付に関係なく
 * すぐ次が開くので、完了直後の L2 は「今日」ラベルになる。
 */
import { expect, test } from '@playwright/test';
import { drawLine, gotoApp } from './helpers';

test.describe('レッスン進行', () => {
  test('s0-u1-l1 を最後まで進めるとホームの次ノードが「今日」になる', async ({ page }) => {
    await gotoApp(page);

    // ホームの「Before を描く」から最初のレッスンへ
    await page.getByRole('link', { name: 'Before を描く' }).click();

    // 1 ステップ目: read「このアプリの約束」→「次へ」
    await expect(page.getByRole('heading', { name: 'このアプリの約束' })).toBeVisible();
    await page.getByRole('button', { name: '次へ' }).click();

    // 2 ステップ目: free（キャンバス）。マウスで数本描いて「終わる」
    const canvas = page.locator('.ls-canvas__paper canvas');
    await expect(canvas).toBeVisible();
    await drawLine(page, canvas);
    await drawLine(page, canvas, { dx: 250, dy: -180 });

    await page.getByRole('button', { name: '終わる' }).click();

    // 最後のステップだったのでレッスン完了モーダルが出る
    await expect(page.getByRole('heading', { name: '今日の分は終わり。' })).toBeVisible();
    await page.getByRole('button', { name: 'ホームへ' }).click();

    // ホームに戻ると、L1 は完了・L2 のロックが外れて今日のノードになっている（翌日を待たない）
    await expect(page.getByRole('button', { name: /^L1 .*（完了）$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^L2 .*（今日）$/ })).toBeVisible();
    // 右パネルは「今日の分は終わり」でも次のレッスンを続けられる
    await expect(page.getByText('今日の分は終わり。続けるなら次へ')).toBeVisible();
    await expect(page.getByRole('link', { name: '続ける' })).toBeVisible();
  });
});
