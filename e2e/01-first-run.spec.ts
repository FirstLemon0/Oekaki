/**
 * 初回起動: ホームが Before を促すカード・ストリーク 0・パス先頭ノード「今日」を
 * 見せていることを確認する。
 */
import { expect, test } from '@playwright/test';
import { gotoApp } from './helpers';

test.describe('初回起動', () => {
  test('ホームに Before カード・ストリーク0・「今日」ノードが出る', async ({ page }) => {
    await gotoApp(page);

    // ストリーク 0（左上の炎ピル）
    const streakPill = page.locator('[title="ストリーク"]');
    await expect(streakPill).toBeVisible();
    await expect(streakPill).toContainText('0');
    await expect(streakPill).toContainText('日');

    // Before を促すカード（今の1枚を描きましょう）
    await expect(page.getByRole('heading', { name: '今の1枚を描きましょう' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Before を描く' })).toBeVisible();

    // パスの最初のノードが「今日」
    await expect(page.getByRole('button', { name: /（今日）$/ }).first()).toBeVisible();
  });
});
