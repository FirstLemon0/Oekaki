/**
 * 自由お絵描き: #/free で描いて終わる → ギャラリーに1枚増える。
 */
import { expect, test } from '@playwright/test';
import { drawFewStrokes, gotoApp } from './helpers';

test.describe('自由お絵描き', () => {
  test('描いて終わるとギャラリーに増える', async ({ page }) => {
    await gotoApp(page);

    await page.getByRole('link', { name: /自由お絵描き/ }).click();

    const canvas = page.locator('.ls-canvas__paper canvas');
    await expect(canvas).toBeVisible();
    await drawFewStrokes(page, canvas, 3);

    await page.getByRole('button', { name: '終わる' }).click();
    // 「終わる」シート（お絵描き v2）: 保存して終わる
    await page.getByRole('button', { name: '保存して終わる' }).click();

    // ホームへ戻ったらギャラリーへ
    await page.getByRole('link', { name: 'ギャラリー' }).click();
    await expect(page.getByRole('heading', { name: 'ギャラリー' })).toBeVisible();

    await page
      .getByRole('group', { name: '種類で絞り込む' })
      .getByRole('button', { name: '自由' })
      .click();

    // 「まだ絵がありません」ではなく、タイル（種別「自由」）が最低 1 枚ある
    await expect(page.getByText('まだ絵がありません')).toHaveCount(0);
    await expect(page.locator('.itile').first()).toBeVisible();
    await expect(page.getByRole('link', { name: /^自由 / })).toHaveCount(1);
  });
});
