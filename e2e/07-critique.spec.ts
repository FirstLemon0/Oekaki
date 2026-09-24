/**
 * 批評（採点 B）:
 *  1) API キー未設定なら卒業課題の「送る」が出ず、「設定へ」に誘導されること。
 *  2) 本物の API は呼ばず、api.anthropic.com をモックして結果画面が出ること（1本）。
 *
 * 卒業課題（critique ステップ）はステージ末（s1-u5-l3）にあり、実際にそこまで
 * プレイすると長くなりすぎるため、IndexedDB に直接「卒業課題として提出した絵」
 * （kind: 'submit', lessonId: 's1-u5-l3'）を1件だけ差し込んで #/critique/:id を開く。
 */
import { expect, type Page, test } from '@playwright/test';
import { anthropicMessageBody, gotoApp } from './helpers';

const LESSON_ID = 's1-u5-l3'; // ステージ1 卒業課題（rubric: s1-graduation）

async function seedSubmitDrawing(page: Page, id: string): Promise<void> {
  await page.evaluate(async (drawingId) => {
    const req = indexedDB.open('seichotsu', 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const image = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], { type: 'image/webp' });
    const now = new Date().toISOString();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('drawings', 'readwrite');
      tx.objectStore('drawings').put({
        id: drawingId,
        lessonId: 's1-u5-l3',
        kind: 'submit',
        image,
        createdAt: now,
        strokes: null,
        updatedAt: now,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, id);
}

test.describe('AI 批評', () => {
  test('API キー未設定では「送る」が出ず設定へ誘導される', async ({ page }) => {
    await gotoApp(page);
    await seedSubmitDrawing(page, 'e2e-submit-noauth');

    await gotoApp(page, `#/critique/e2e-submit-noauth`);

    await expect(page.getByRole('heading', { name: '先生に見てもらいますか？' })).toBeVisible();
    await expect(page.getByText('API キーがまだ設定されていません')).toBeVisible();
    await expect(page.getByRole('button', { name: '送る' })).toHaveCount(0);

    const toSettings = page.getByRole('button', { name: '設定へ' });
    await expect(toSettings).toBeVisible();
    await toSettings.click();

    await expect(page.getByRole('heading', { name: '設定' })).toBeVisible();
    await expect(page.getByLabel('API キー').first()).toBeVisible();
  });

  test('モック応答で結果画面が出る（本物の API は呼ばない）', async ({ page }) => {
    await gotoApp(page, '#/settings');
    await page.getByLabel('API キー').first().fill('sk-ant-e2e-mock-key');
    await page.getByLabel('API キー').first().press('Tab');

    await seedSubmitDrawing(page, 'e2e-submit-mocked');

    let sawMockedCall = false;
    await page.route('https://api.anthropic.com/**', async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'POST, GET, OPTIONS',
            'access-control-allow-headers': '*',
          },
        });
        return;
      }
      sawMockedCall = true;
      const body = anthropicMessageBody(
        ['十字線がまっすぐ引けています', '輪郭の線が一度で引けています'],
        [{ where: '左目', what: '右目より少し高い位置にあります', fix: '横線に両目の下端をそろえる' }],
      );
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(body),
      });
    });

    await gotoApp(page, `#/critique/e2e-submit-mocked`);
    await expect(page.getByRole('heading', { name: '先生に見てもらいますか？' })).toBeVisible();

    const send = page.getByRole('button', { name: '送る' });
    await expect(send).toBeEnabled();
    await send.click();

    await expect(page.getByRole('heading', { name: '良い点' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('十字線がまっすぐ引けています')).toBeVisible();
    await expect(page.getByRole('heading', { name: '直す点' })).toBeVisible();
    await expect(page.locator('.ls-cfoot').getByRole('button', { name: '戻る' })).toBeVisible();

    // 送信先は page.route でモックした api.anthropic.com のみ（本物の API は呼んでいない）
    expect(sawMockedCall).toBe(true);
  });
});
