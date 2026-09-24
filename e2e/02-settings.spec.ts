/**
 * 設定: API キーの保存・再読込後の保持、モデル切替、上限の増減、テーマ切替を確認する。
 */
import { expect, test } from '@playwright/test';
import { gotoApp } from './helpers';

const FAKE_KEY = 'sk-ant-e2e-test-0123456789';

test.describe('設定', () => {
  test('API キーが再読込後も残る', async ({ page }) => {
    await gotoApp(page, '#/settings');

    const keyField = page.getByLabel('API キー').first();
    await keyField.fill(FAKE_KEY);
    // Preact の onChange はネイティブ change イベント（blur/確定）で発火するため、
    // 明示的にフォーカスを外して保存を確定させる。
    await keyField.press('Tab');

    // 保存されると「未接続」表示に変わる（キー未設定時の案内文が消える）
    await expect(page.getByText('未接続')).toBeVisible();

    await page.reload();
    await page.locator('.loading').waitFor({ state: 'detached' }).catch(() => undefined);

    await expect(page.getByLabel('API キー').first()).toHaveValue(FAKE_KEY);
  });

  test('モデルを切り替えられる', async ({ page }) => {
    await gotoApp(page, '#/settings');

    await page.getByRole('radio', { name: 'Sonnet 5' }).click();
    await expect(page.getByRole('radio', { name: 'Sonnet 5' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.set-mono').filter({ hasText: 'claude-sonnet-5' })).toBeVisible();

    await page.getByRole('radio', { name: 'Opus 5', exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Opus 5', exact: true })).toHaveAttribute('aria-checked', 'true');
  });

  test('1日の上限回数を増減できる', async ({ page }) => {
    await gotoApp(page, '#/settings');

    const value = page.locator('.stepper__value');
    await expect(value).toHaveText('3');

    await page.getByRole('button', { name: '1日の上限回数を増やす' }).click();
    await expect(value).toHaveText('4');
    await page.getByRole('button', { name: '1日の上限回数を増やす' }).click();
    await expect(value).toHaveText('5');
    await page.getByRole('button', { name: '1日の上限回数を減らす' }).click();
    await expect(value).toHaveText('4');
  });

  test('テーマを切り替えると data-theme が変わる', async ({ page }) => {
    await gotoApp(page, '#/settings');
    const html = page.locator('html');

    await page.getByRole('radio', { name: 'ダーク' }).click();
    await expect(html).toHaveAttribute('data-theme', 'dark');

    await page.getByRole('radio', { name: 'ライト' }).click();
    await expect(html).toHaveAttribute('data-theme', 'light');

    await page.getByRole('radio', { name: '端末' }).click();
    await expect(html).not.toHaveAttribute('data-theme', /.+/);
  });
});
