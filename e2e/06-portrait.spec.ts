/**
 * 縦向き 920×1472: ホームで下部ナビが出て、今日カードが見えることを確認する。
 * （このファイルだけ既定のビューポートを縦向きに上書きする）
 */
import { expect, test } from '@playwright/test';
import { gotoApp } from './helpers';

test.use({ viewport: { width: 920, height: 1472 } });

test.describe('縦向きレイアウト', () => {
  test('下部ナビと今日カードが見える', async ({ page }) => {
    await gotoApp(page);

    const nav = page.getByRole('navigation', { name: 'メイン' });
    await expect(nav).toBeVisible();
    const box = await nav.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      // 横向きの左レール（幅 96px 程度）ではなく、画面幅いっぱいの下部ナビになっている
      expect(box.width).toBeGreaterThan(700);
      // 画面下寄りに配置されている
      expect(box.y).toBeGreaterThan(1472 * 0.7);
    }

    // ナビの項目が横並びで3つとも見える
    await expect(nav.getByRole('link', { name: 'ホーム' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'ギャラリー' })).toBeVisible();
    await expect(nav.getByRole('link', { name: '設定' })).toBeVisible();

    // 今日カード（初回起動なので Before カード）が見える
    await expect(page.getByRole('heading', { name: '今の1枚を描きましょう' })).toBeVisible();
  });
});
