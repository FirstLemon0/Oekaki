/**
 * ホームの一覧表示（カード）と、「全部開放」「進捗に戻す」を実操作で確かめる。
 *
 * - 「道／一覧」のセグメントで一覧に切り替わり、選択は再読込後も残る（localStorage）
 * - ステージ見出し・ユニット見出し・レッスンのカード。今日のカードは目立たせる
 * - カードからレッスンを開く。ロック中のカードも 10 回タップで開放できる
 * - 全部開放でロックが消え（道にも反映）、進捗に戻すで隠し開放が消える。設定 → 練習 にも同じボタン
 */
import { expect, test, type Page } from '@playwright/test';
import { gotoApp } from './helpers';

async function openList(page: Page): Promise<void> {
  await gotoApp(page);
  await page.getByRole('radio', { name: '一覧' }).click();
  await expect(page.locator('.home-list')).toBeVisible();
}

test.describe('ホームの一覧表示', () => {
  test('一覧へ切り替えると、ステージ・ユニット・カードが並び、選択は記憶される', async ({ page }) => {
    await gotoApp(page);
    await expect(page.getByRole('radio', { name: '道' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.path-scroll')).toBeVisible();

    await page.getByRole('radio', { name: '一覧' }).click();
    const list = page.locator('.home-list');
    await expect(list).toBeVisible();
    await expect(page.locator('.path-scroll')).toHaveCount(0);

    const s0 = list.locator('.home-list__stage[data-stage="s0"]');
    await expect(s0.locator('.home-list__stage-head')).toContainText('STAGE 0');
    await expect(s0.locator('.home-list__stage-head')).toContainText('準備');
    await expect(s0.locator('.home-list__count')).toHaveText('0/7');
    await expect(s0.locator('.home-list__unit').first()).toHaveText(/^ユニット 1 ・ はじめに$/);
    await expect(s0.locator('.lcard')).toHaveCount(7);
    // すべてのステージが並ぶ（道は今のステージだけ）
    expect(await list.locator('.home-list__stage').count()).toBeGreaterThan(5);

    // 今日のカードは 1 枚だけ・accent-soft の地。所要時間と要約も出る
    const today = list.locator('.lcard[data-today="true"]');
    await expect(today).toHaveCount(1);
    await expect(today).toHaveClass(/lcard--today/);
    await expect(today.locator('.lcard__min')).toHaveText(/^\d+分$/);
    await expect(today.locator('.lcard__summary')).not.toBeEmpty();
    await expect(page.getByRole('button', { name: /^L2 ペンの持ち方とタブレットの準備（ロック中）$/ })).toHaveClass(/lcard--locked/);
    // 模写チェックポイント・卒業課題のチップ
    expect(await list.locator('.lcard__chip', { hasText: '卒業課題' }).count()).toBeGreaterThan(5);
    expect(await list.locator('.lcard__chip', { hasText: '模写チェックポイント' }).count()).toBeGreaterThan(0);

    // 再読込しても一覧のまま
    await page.reload();
    await page.locator('.loading').waitFor({ state: 'detached' }).catch(() => undefined);
    await expect(page.locator('.home-list')).toBeVisible();
    await expect(page.getByRole('radio', { name: '一覧' })).toHaveAttribute('aria-checked', 'true');

    // 道に戻せる
    await page.getByRole('radio', { name: '道' }).click();
    await expect(page.locator('.path-scroll')).toBeVisible();
    await expect(page.locator('.home-list')).toHaveCount(0);
  });

  test('カードからレッスンを開く。ロック中のカードも 10 回タップで開放できる', async ({ page }) => {
    await openList(page);
    await page.locator('.lcard[data-today="true"]').click();
    await expect(page).toHaveURL(/#\/lesson\/s0-u1-l1/);

    await openList(page);
    const locked = page.getByRole('button', { name: /^L2 ペンの持ち方とタブレットの準備（ロック中）$/ });
    for (let i = 0; i < 3; i++) await locked.click({ force: true });
    await expect(page.getByText('あと7回で開放').first()).toBeVisible();
    for (let i = 0; i < 7; i++) await locked.click({ force: true });
    await expect(page.getByText('開放しました').first()).toBeVisible();
    const opened = page.getByRole('button', { name: /^L2 ペンの持ち方とタブレットの準備（開放）$/ });
    await expect(opened).toHaveClass(/lcard--open/);
    await opened.click();
    await expect(page).toHaveURL(/#\/lesson\/s0-u1-l2/);
  });

  test('全部開放でロックが消え、進捗に戻すで隠し開放が消える（道にも反映）', async ({ page }) => {
    await openList(page);
    expect(await page.locator('.lcard--locked').count()).toBeGreaterThan(100);

    // やめる → 何も変わらない
    await page.getByRole('button', { name: '全部開放' }).click();
    const askAll = page.getByRole('dialog', { name: '全部開放しますか' });
    await expect(askAll).toContainText('すべてのレッスンを開放します。ストリークや進捗は変わりません。');
    await askAll.getByRole('button', { name: 'やめる' }).click();
    await expect(askAll).toHaveCount(0);
    expect(await page.locator('.lcard--locked').count()).toBeGreaterThan(100);

    await page.getByRole('button', { name: '全部開放' }).click();
    await askAll.getByRole('button', { name: '開放する' }).click();
    await expect(page.getByText('すべて開放しました')).toBeVisible();
    await expect(page.locator('.lcard--locked')).toHaveCount(0);
    // 進捗は変わらない
    await expect(page.locator('.home-list__stage[data-stage="s0"] .home-list__count')).toHaveText('0/7');

    // 道にも反映（ロックのノード・次ステージの帯が無い）
    await page.getByRole('radio', { name: '道' }).click();
    await expect(page.locator('.path-scroll')).toBeVisible();
    await expect(page.getByRole('button', { name: /（ロック中/ })).toHaveCount(0);
    await expect(page.locator('.stage-next')).toHaveCount(0);

    // 進捗に戻す（一覧から）
    await page.getByRole('radio', { name: '一覧' }).click();
    await page.getByRole('button', { name: '進捗に戻す' }).click();
    const askReset = page.getByRole('dialog', { name: '進捗に戻しますか' });
    await expect(askReset).toContainText('隠し開放をすべて取り消し、完了状況どおりのロックに戻します。完了した記録は残ります。');
    await askReset.getByRole('button', { name: '戻す' }).click();
    await expect(page.getByText('進捗に合わせて戻しました')).toBeVisible();
    expect(await page.locator('.lcard--locked').count()).toBeGreaterThan(100);
    await expect(page.getByRole('button', { name: /^L2 ペンの持ち方とタブレットの準備（ロック中）$/ })).toBeVisible();

    await page.getByRole('radio', { name: '道' }).click();
    await expect(page.getByRole('button', { name: /^L2 ペンの持ち方とタブレットの準備（ロック中）$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: '次のステージ 線と手のコントロール（ロック中）' })).toBeVisible();
  });

  test('設定 → 練習 にも「全部開放」「進捗に戻す」がある', async ({ page }) => {
    await gotoApp(page, '#/settings?section=practice');
    await page.getByRole('button', { name: '全部開放' }).click();
    await page.getByRole('dialog', { name: '全部開放しますか' }).getByRole('button', { name: '開放する' }).click();
    await expect(page.getByText('すべて開放しました')).toBeVisible();

    await gotoApp(page);
    await expect(page.getByRole('button', { name: /^L2 ペンの持ち方とタブレットの準備（開放）$/ })).toBeVisible();

    await gotoApp(page, '#/settings?section=practice');
    await page.getByRole('button', { name: '進捗に戻す' }).click();
    await page.getByRole('dialog', { name: '進捗に戻しますか' }).getByRole('button', { name: '戻す' }).click();
    await expect(page.getByText('進捗に合わせて戻しました')).toBeVisible();

    await gotoApp(page);
    await expect(page.getByRole('button', { name: /^L2 ペンの持ち方とタブレットの準備（ロック中）$/ })).toBeVisible();
  });
});
