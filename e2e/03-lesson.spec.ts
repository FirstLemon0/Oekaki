/**
 * 最初のレッスン（s0-u1-l1）を最後まで進め、完了モーダル → ホームで
 * パスが1歩進む（L1 が完了・L2 のロックが外れる）ことを確認する。
 *
 * 注: このアプリは「1日1レッスン」が前提（DESIGN.md §6）で、今日すでに1本終えると
 * 次のレッスンは翌日まで「明日」表示になる（src/ui/screens/Home.tsx の
 * `finishedToday ? 'tomorrow' : 'today'`）。そのため完了直後の次ノードは「今日」ではなく
 * 「明日」ラベルになるのが正しい挙動。
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

    // ホームに戻ると、L1 は完了・L2 のロックが外れている（今日はもう1本終えたので「明日」表示）
    await expect(page.getByRole('button', { name: /^L1 .*（完了）$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^L2 .*（明日）$/ })).toBeVisible();
  });
});
