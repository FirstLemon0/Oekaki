/**
 * 自由お絵描き: #/free で描いて終わる → ギャラリーに1枚増える。
 * UR-002 S3 から #/free の既定は新しいお絵描き（埋め込みのペイントの iframe）。文言（「終わる」「保存して終わる」「自由」のタイル）は今までと同じ。
 * 今までのお絵描き（v2）は設定で選べる（その流れは 10-paint の透過 PNG・11-integration で確かめる）。
 * 受け入れ ilust-e2e-retarget の 04-free-draw の分: 判定（ギャラリーに 1 枚増える）を OG の流れで確かめる。
 */
import { expect, test } from '@playwright/test';
import { gotoApp } from './helpers';
import { drawOg, OG_FRAME, OG_ROOT, ogFrame, waitOgContent } from './og-helpers';

test.describe('自由お絵描き', () => {
  test('描いて終わるとギャラリーに増える', async ({ page }) => {
    await gotoApp(page);

    await page.getByRole('link', { name: /自由お絵描き/ }).click();

    // 既定は新しいお絵描き（設定を触らずに）
    await expect(page.locator(`${OG_ROOT}[data-phase="ready"]`)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(OG_FRAME)).toHaveAttribute('src', '/paint/embed.html');
    await drawOg(page, 3);
    await waitOgContent(await ogFrame(page));

    await page.getByRole('button', { name: '終わる' }).click();
    // 「終わる」シート: 保存して終わる
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
