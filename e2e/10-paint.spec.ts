/**
 * お絵描き v2（フルツール）: レイヤー・塗りつぶし・選択と変形・ズーム表示・透過 PNG 書き出し。
 * 自由お絵描き #/free で確かめる。
 * PAINT_SHOTS_DIR を渡すと、各場面のスクリーンショットをそこへ保存する（見た目の確認用）。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { gotoApp } from './helpers';

const SHOTS = process.env.PAINT_SHOTS_DIR;

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

async function openFree(page: Page): Promise<Locator> {
  await gotoApp(page);
  await page.getByRole('link', { name: /自由お絵描き/ }).click();
  const paper = page.locator('.ls-canvas__paper');
  await expect(paper.locator('canvas').first()).toBeVisible();
  return paper;
}

/** 紙の上をドラッグする（割合で指定。UI と重ならない中央寄り） */
async function drag(page: Page, paper: Locator, from: [number, number], to: [number, number], steps = 12): Promise<void> {
  const box = await paper.boundingBox();
  if (!box) throw new Error('紙が見つかりません');
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps });
  await page.mouse.up();
}

async function tapPaper(page: Page, paper: Locator, at: [number, number]): Promise<void> {
  const box = await paper.boundingBox();
  if (!box) throw new Error('紙が見つかりません');
  await page.mouse.click(box.x + box.width * at[0], box.y + box.height * at[1]);
}

const toolbar = (page: Page) => page.getByRole('toolbar', { name: '描画ツール' });

test.describe('お絵描き v2', () => {
  test('レイヤー: 追加 → 描く → 不透明度 → 下と結合', async ({ page }) => {
    const paper = await openFree(page);
    await toolbar(page).getByRole('button', { name: 'レイヤー', exact: true }).click();
    const panel = page.getByTestId('layer-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.pt-layer')).toHaveCount(1);

    await panel.getByRole('button', { name: '追加' }).click();
    await expect(panel.locator('.pt-layer')).toHaveCount(2);
    // 新しいレイヤーが上（手前）に入り、選択中になる
    await expect(panel.locator('.pt-layer').first()).toHaveClass(/is-active/);
    await expect(panel.locator('.pt-layer.is-active .pt-layer__name')).toHaveText('レイヤー 2');

    await drag(page, paper, [0.3, 0.45], [0.5, 0.6]);
    await expect(toolbar(page).getByRole('button', { name: '元に戻す' })).toBeEnabled();

    const slider = panel.getByRole('slider', { name: 'レイヤーの不透明度' });
    await slider.fill('40');
    await expect(panel.locator('.pt-layers__val')).toHaveText('40%');

    // 合成モード
    await panel.getByRole('radio', { name: '乗算' }).click();
    await expect(panel.getByRole('radio', { name: '乗算' })).toHaveAttribute('aria-checked', 'true');

    // 目・鍵
    const eye = panel.getByRole('button', { name: 'レイヤー 2を隠す' });
    await eye.click();
    await expect(panel.getByRole('button', { name: 'レイヤー 2を表示する' })).toBeVisible();
    await panel.getByRole('button', { name: 'レイヤー 2を表示する' }).click();
    await panel.getByRole('button', { name: 'レイヤー 2をロックする' }).click();
    await expect(page.locator('.pt-locknote')).toBeVisible();
    await panel.getByRole('button', { name: 'レイヤー 2のロックを外す' }).click();
    await expect(page.locator('.pt-locknote')).toHaveCount(0);
    await shot(page, '01-layers');

    await panel.getByRole('button', { name: '下と結合' }).click();
    await expect(panel.locator('.pt-layer')).toHaveCount(1);

    // 閉じる
    await panel.getByRole('button', { name: 'レイヤーを閉じる' }).click();
    await expect(panel).toHaveCount(0);
  });

  test('塗りつぶし: 許容値と境界を選んで塗る → 保存できる', async ({ page }) => {
    const paper = await openFree(page);
    const fill = toolbar(page).getByRole('button', { name: '塗りつぶし' });
    await fill.click();
    await expect(fill).toHaveAttribute('aria-pressed', 'true');
    // もう一度押すと小パネル
    await fill.click();
    const panel = page.getByRole('group', { name: '塗りつぶしの設定' });
    await expect(panel).toBeVisible();
    await panel.getByRole('slider', { name: '塗りつぶしの許容値' }).fill('50');
    await expect(panel.locator('.ls-pop__val')).toHaveText('50%');
    await panel.getByRole('radio', { name: 'すべて' }).click();
    await expect(panel.getByText('ペンの色で塗ります', { exact: false })).toBeVisible();
    await shot(page, '02-fill-panel');

    await tapPaper(page, paper, [0.55, 0.55]);
    await expect(panel).toHaveCount(0); // 紙に触れたら閉じる
    await expect(toolbar(page).getByRole('button', { name: '元に戻す' })).toBeEnabled();
    await shot(page, '03-filled');

    // 塗りだけの絵でも、戻るときに確かめる（線の本数ではなく ops の描画 op で判定）
    await page.getByRole('button', { name: 'ホームへ戻る' }).click();
    await expect(page.getByRole('dialog', { name: /描いた線が消えます/ })).toBeVisible();
    await page.getByRole('button', { name: '描き続ける' }).click();

    // 塗りだけの絵も保存できる（meta.doc 付き）
    await page.getByRole('button', { name: '終わる' }).click();
    await page.getByRole('button', { name: '保存して終わる' }).click();
    await expect(page.getByRole('link', { name: /自由お絵描き/ })).toBeVisible();
    await page.getByRole('link', { name: 'ギャラリー' }).click();
    await expect(page.getByRole('link', { name: /^自由 / })).toHaveCount(1);
  });

  test('選択 → 移動 → 確定', async ({ page }) => {
    const paper = await openFree(page);
    await drag(page, paper, [0.4, 0.45], [0.55, 0.55]);

    await toolbar(page).getByRole('button', { name: '矩形選択' }).click();
    const bar = page.getByTestId('transform-bar');
    await expect(bar).toContainText('矩形選択');
    await drag(page, paper, [0.35, 0.4], [0.6, 0.62]);
    await expect(bar.getByRole('button', { name: '確定' })).toBeVisible();
    await expect(bar.getByRole('button', { name: '取消' })).toBeDisabled();

    // 枠の中をドラッグして移動
    const body = page.getByTestId('selection-body');
    const b = await body.boundingBox();
    if (!b) throw new Error('選択枠が見つかりません');
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 80, b.y + b.height / 2 + 40, { steps: 8 });
    await page.mouse.up();
    await expect(bar.getByRole('button', { name: '取消' })).toBeEnabled();
    // 左右反転・回転ハンドルも出ている
    await expect(page.getByTestId('rotate-handle')).toBeVisible();
    await bar.getByRole('button', { name: '左右反転' }).click();
    await shot(page, '04-transform');

    await bar.getByRole('button', { name: '確定' }).click();
    await expect(bar.getByRole('button', { name: '確定' })).toHaveCount(0);
    await expect(page.getByTestId('selection-body')).toHaveCount(0);
    // 選択ツールのままなら「すべて選択」だけのバー
    await expect(bar.getByRole('button', { name: 'すべて選択' })).toBeVisible();
    await expect(toolbar(page).getByRole('button', { name: '元に戻す' })).toBeEnabled();

    // ペンに戻すと課題ピルに戻る
    await toolbar(page).getByRole('button', { name: 'ペン', exact: true }).click();
    await expect(page.getByTestId('transform-bar')).toHaveCount(0);
    await expect(page.locator('.ls-task')).toBeVisible();
  });

  test('ズーム表示: ピルに倍率、手のひらで動かしてタップで全体表示', async ({ page }) => {
    const paper = await openFree(page);
    const pill = page.getByTestId('zoom-pill').locator('.pt-zoom__pct');
    await expect(pill).toHaveText(/^\d+%$/);
    await toolbar(page).getByRole('button', { name: /手のひら/ }).click();
    await drag(page, paper, [0.5, 0.5], [0.6, 0.6]);
    await pill.click();
    // 全体を表示（fitView）: 収まる絵なら 100% に戻る
    await expect(pill).toHaveText('100%');
    await shot(page, '05-zoom');
  });

  test('HSV ピッカーと直近の色・図形', async ({ page }) => {
    const paper = await openFree(page);
    const pen = toolbar(page).getByRole('button', { name: 'ペン', exact: true });
    await pen.click(); // 選択中にもう一度 → 小パネル
    const picker = page.getByTestId('hsv-picker');
    await expect(picker).toBeVisible();
    const sv = picker.getByRole('slider', { name: '彩度と明るさ' });
    const box = await sv.boundingBox();
    if (!box) throw new Error('ピッカーが見つかりません');
    await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.2);
    // 指を離した色が「最近の色」に入る
    await expect(page.getByRole('radiogroup', { name: '最近の色' }).getByRole('radio')).toHaveCount(1);
    // パレットの色を選ぶとピッカーもその色になる
    await page.getByRole('radio', { name: '墨（テーマの色）' }).click();
    await expect(picker.locator('.pt-hsv__hex')).toHaveText('#2b2a28');
    await shot(page, '06-hsv');

    // 図形: もう一度押して「楕円」
    const shape = toolbar(page).getByRole('button', { name: /^図形/ });
    await shape.click();
    await shape.click();
    await page.getByRole('radio', { name: '楕円' }).click();
    await expect(toolbar(page).getByRole('button', { name: '図形（楕円）' })).toBeVisible();
    await expect(page.getByRole('group', { name: '図形の種類' })).toHaveCount(0); // 選んだら閉じる
    await drag(page, paper, [0.35, 0.35], [0.55, 0.6]);
    await expect(toolbar(page).getByRole('button', { name: '元に戻す' })).toBeEnabled();
  });

  test('透過 PNG を書き出す・ギャラリーから PNG で書き出す', async ({ page }) => {
    const paper = await openFree(page);
    await drag(page, paper, [0.35, 0.45], [0.6, 0.6]);
    await page.getByRole('button', { name: '終わる' }).click();
    const sheet = page.getByRole('dialog', { name: '終わる' });
    await expect(sheet).toBeVisible();
    await shot(page, '07-end-sheet');

    const [dl] = await Promise.all([page.waitForEvent('download'), sheet.getByRole('button', { name: '透過 PNG を書き出す' }).click()]);
    expect(dl.suggestedFilename()).toMatch(/^seichotsu-free-\d{8}-\d{4}\.png$/);
    const bytes = readFileSync(await dl.path());
    // PNG の署名と、IHDR の色の種類 6（RGBA＝透過あり）
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(bytes[25]).toBe(6);
    // 長辺 2048（IHDR の幅・高さ）
    expect(Math.max(bytes.readUInt32BE(16), bytes.readUInt32BE(20))).toBe(2048);
    await expect(sheet.getByText('透過 PNG を書き出しました。')).toBeVisible();

    // 描き続ける → シートが閉じる → もう一度終わる → 保存
    await sheet.getByRole('button', { name: '描き続ける' }).click();
    await expect(sheet).toHaveCount(0);
    await page.getByRole('button', { name: '終わる' }).click();
    await page.getByRole('button', { name: '保存して終わる' }).click();

    await page.getByRole('link', { name: 'ギャラリー' }).click();
    await page.getByRole('link', { name: /^自由 / }).first().click();
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PNG で書き出す' }).click()]);
    expect(dl2.suggestedFilename()).toMatch(/\.png$/);
    const b2 = readFileSync(await dl2.path());
    expect([...b2.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    await shot(page, '08-gallery-detail');
  });
});

test.describe('お絵描き v2（縦向き）', () => {
  test.use({ viewport: { width: 920, height: 1472 } });

  test('ツールバーは 2 段、レイヤーは下からのシート', async ({ page }) => {
    await openFree(page);
    const bar = toolbar(page);
    const box = await bar.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.width).toBeGreaterThan(box.height);
      expect(box.height).toBeLessThan(130);
    }
    await bar.getByRole('button', { name: 'レイヤー', exact: true }).click();
    const panel = page.getByTestId('layer-panel');
    const pb = await panel.boundingBox();
    expect(pb && pb.width).toBeGreaterThan(880);
    // シートは「終わる」に重ならない（その上で止まる）
    const done = await page.getByRole('button', { name: '終わる' }).boundingBox();
    if (!pb || !done) throw new Error('シートか終わるが見つかりません');
    expect(pb.y + pb.height).toBeLessThanOrEqual(done.y);
    // 削除は左端（右下の「終わる」と同じ位置に来ない）
    const del = await panel.getByRole('button', { name: '削除' }).boundingBox();
    const add = await panel.getByRole('button', { name: '追加' }).boundingBox();
    expect(del && add && del.x < add.x).toBe(true);
    await expect(page.getByRole('button', { name: '終わる' })).toBeVisible();
    await shot(page, '09-portrait-layers');
  });
});

test.describe('簡易ツール（採点する画面）', () => {
  test('校正ではレイヤー・塗り・選択を出さない', async ({ page }) => {
    await gotoApp(page, '#/calibrate');
    const bar = toolbar(page);
    await expect(bar).toBeVisible();
    await expect(bar.getByRole('button', { name: 'ペン', exact: true })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'レイヤー', exact: true })).toHaveCount(0);
    await expect(bar.getByRole('button', { name: '塗りつぶし' })).toHaveCount(0);
    await expect(bar.getByRole('button', { name: '矩形選択' })).toHaveCount(0);
    // 採点する画面は 2 本指のズーム等を切る（gestures: false）: ズームピル・手のひらを出さない
    await expect(page.getByTestId('zoom-pill')).toHaveCount(0);
    await expect(bar.getByRole('button', { name: /手のひら/ })).toHaveCount(0);
    await shot(page, '10-simple-calibrate');
  });
});

/** 紙の上に指（touch）の pointerdown / pointerup を送る（ペン専用のときは無視されるはず） */
async function touchPaper(page: Page, paper: Locator, at: [number, number]): Promise<void> {
  const box = await paper.boundingBox();
  if (!box) throw new Error('紙が見つかりません');
  const x = box.x + box.width * at[0];
  const y = box.y + box.height * at[1];
  await page.evaluate(
    ({ x, y }) => {
      const target = document.elementFromPoint(x, y) ?? document.body;
      const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: 77, pointerType: 'touch', isPrimary: true };
      target.dispatchEvent(new PointerEvent('pointerdown', { ...init, buttons: 1 }));
      target.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
    },
    { x, y },
  );
}

/** 選択枠を作る（矩形選択ツールで割合の範囲をドラッグ） */
async function selectRect(page: Page, paper: Locator, from: [number, number], to: [number, number]): Promise<void> {
  const rect = toolbar(page).getByRole('button', { name: '矩形選択' });
  if ((await rect.getAttribute('aria-pressed')) !== 'true') await rect.click();
  await drag(page, paper, from, to, 6);
  await expect(page.getByTestId('transform-bar').getByRole('button', { name: '確定' })).toBeVisible();
}

test.describe('お絵描き v2 レビュー対応（2026-09-25）', () => {
  test('スポイト: 空振りはスポイトのまま・色を拾ったら（同じ色でも）前のツールへ戻り、直近の色に入る', async ({ page }) => {
    const paper = await openFree(page);
    // ペンを赤系に
    const pen = toolbar(page).getByRole('button', { name: 'ペン', exact: true });
    await pen.click();
    await page.getByRole('radiogroup', { name: '色' }).getByRole('radio').nth(3).click();
    await tapPaper(page, paper, [0.9, 0.9]); // 閉じる（描かない位置でもよい: 点が付くだけ）
    await pen.click(); // 太くして拾いやすく
    await page.getByRole('slider', { name: 'ペンの太さ' }).fill('16');
    await tapPaper(page, paper, [0.9, 0.9]); // 小パネルを閉じる
    await drag(page, paper, [0.45, 0.5], [0.75, 0.5], 16);
    const dotBefore = await pen.locator('.ls-tool__dot').evaluate((el) => getComputedStyle(el).backgroundColor);

    const dropper = toolbar(page).getByRole('button', { name: 'スポイト' });
    await dropper.click();
    // 空振り（透明な所）: スポイトのまま、ペンの色も変わらない
    await tapPaper(page, paper, [0.6, 0.3]);
    await expect(dropper).toHaveAttribute('aria-pressed', 'true');
    expect(await pen.locator('.ls-tool__dot').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(dotBefore);

    // 線の上（同じ色）: ペンに戻る
    await tapPaper(page, paper, [0.6, 0.5]);
    await expect(pen).toHaveAttribute('aria-pressed', 'true');
    await pen.click();
    await expect(page.getByRole('radiogroup', { name: '最近の色' }).getByRole('radio')).not.toHaveCount(0);
    await shot(page, '11-eyedropper');
  });

  test('変形を確定して Undo すると、動かした位置に枠が残らない', async ({ page }) => {
    const paper = await openFree(page);
    await drag(page, paper, [0.4, 0.45], [0.55, 0.55]);
    await selectRect(page, paper, [0.35, 0.4], [0.6, 0.62]);
    const body = page.getByTestId('selection-body');
    const before = await body.boundingBox();
    if (!before) throw new Error('選択枠が見つかりません');
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width / 2 + 120, before.y + before.height / 2 + 60, { steps: 8 });
    await page.mouse.up();
    await page.getByTestId('transform-bar').getByRole('button', { name: '確定' }).click();
    await toolbar(page).getByRole('button', { name: '元に戻す' }).click();
    // エンジンが選択も戻す。枠が出ているなら元の位置（動かした先には残らない）
    await page.waitForTimeout(100);
    const after = (await body.count()) > 0 ? await body.boundingBox() : null;
    if (after) {
      expect(Math.abs(after.x - before.x)).toBeLessThan(4);
      expect(Math.abs(after.y - before.y)).toBeLessThan(4);
    }
    await shot(page, '12-undo-transform');
  });

  test('ペン専用: 指が触れても変形は確定せず、小パネルも閉じない', async ({ page }) => {
    const paper = await openFree(page);
    await drag(page, paper, [0.4, 0.45], [0.55, 0.55]);
    await selectRect(page, paper, [0.35, 0.4], [0.6, 0.62]);
    const bar = page.getByTestId('transform-bar');
    await bar.getByRole('button', { name: '左右反転' }).click();
    await expect(bar.getByRole('button', { name: '取消' })).toBeEnabled();
    await touchPaper(page, paper, [0.8, 0.8]);
    // 確定されていない（取消が押せる・枠が残る）
    await expect(bar.getByRole('button', { name: '取消' })).toBeEnabled();
    await expect(page.getByTestId('selection-body')).toBeVisible();
    await bar.getByRole('button', { name: '取消' }).click();

    // 小パネル
    const pen = toolbar(page).getByRole('button', { name: 'ペン', exact: true });
    await pen.click();
    await pen.click();
    const panel = page.getByRole('group', { name: 'ペンの設定' });
    await expect(panel).toBeVisible();
    await touchPaper(page, paper, [0.8, 0.8]);
    await expect(panel).toBeVisible();
  });

  test('ロック中は選択ツールでも案内が出て、ハンドル・反転が無効', async ({ page }) => {
    const paper = await openFree(page);
    await drag(page, paper, [0.4, 0.45], [0.55, 0.55]);
    await toolbar(page).getByRole('button', { name: 'レイヤー', exact: true }).click();
    await page.getByTestId('layer-panel').getByRole('button', { name: 'レイヤー 1をロックする' }).click();
    await page.getByTestId('layer-panel').getByRole('button', { name: 'レイヤーを閉じる' }).click();
    await toolbar(page).getByRole('button', { name: '矩形選択' }).click();
    await expect(page.locator('.pt-locknote')).toContainText('変形するときは');
    await drag(page, paper, [0.35, 0.4], [0.6, 0.62], 6);
    const bar = page.getByTestId('transform-bar');
    await expect(bar).toContainText('ロック中');
    await expect(page.getByTestId('rotate-handle')).toHaveCount(0);
    await expect(page.locator('.pt-handle')).toHaveCount(0);
    await expect(bar.getByRole('button', { name: '左右反転' })).toBeDisabled();
    await shot(page, '13-locked-select');
  });

  test('回転ハンドル: 上端に近い選択では下に出る／小さい選択は四隅だけで中央を動かせる', async ({ page }) => {
    const paper = await openFree(page);
    await drag(page, paper, [0.4, 0.05], [0.6, 0.12]);
    await selectRect(page, paper, [0.35, 0.02], [0.65, 0.15]);
    await expect(page.getByTestId('rotate-handle')).toHaveAttribute('data-side', 'bottom');
    await page.getByTestId('transform-bar').getByRole('button', { name: '確定' }).click();

    // 中ほどの普通の選択は上
    await selectRect(page, paper, [0.35, 0.4], [0.6, 0.62]);
    await expect(page.getByTestId('rotate-handle')).toHaveAttribute('data-side', 'top');
    await expect(page.locator('.pt-handle:not(.is-corner):not(.is-rotate)')).toHaveCount(4);
    await page.getByTestId('transform-bar').getByRole('button', { name: '確定' }).click();

    // 小さい選択（約 20px）: 辺のハンドルなし・四隅 4 つ
    const box = await paper.boundingBox();
    if (!box) throw new Error('紙が見つかりません');
    const cx = 0.5;
    const cy = 0.7;
    const d = 10 / box.width;
    const dy = 10 / box.height;
    await drag(page, paper, [cx - d * 3, cy], [cx + d * 3, cy], 6);
    await selectRect(page, paper, [cx - d, cy - dy], [cx + d, cy + dy]);
    await expect(page.locator('.pt-handle.is-corner')).toHaveCount(4);
    await expect(page.locator('.pt-handle:not(.is-corner):not(.is-rotate)')).toHaveCount(0);
    // 中央をつかんで動かせる
    const x = box.x + box.width * cx;
    const y = box.y + box.height * cy;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 60, y + 30, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByTestId('transform-bar').getByRole('button', { name: '取消' })).toBeEnabled();
    await shot(page, '14-small-selection');
  });

  test('レイヤー: サムネイルは描いた範囲で切り出す・合成のセグメントは 12px', async ({ page }) => {
    const paper = await openFree(page);
    // 紙の隅に小さく描く
    await drag(page, paper, [0.8, 0.2], [0.84, 0.24], 6);
    await toolbar(page).getByRole('button', { name: 'レイヤー', exact: true }).click();
    const panel = page.getByTestId('layer-panel');
    const img = panel.locator('.pt-layer__thumb img').first();
    await expect(img).toBeVisible();
    await page.waitForTimeout(500);
    const cover = await img.evaluate(async (el) => {
      const im = el as HTMLImageElement;
      await im.decode().catch(() => undefined);
      const c = document.createElement('canvas');
      c.width = im.naturalWidth;
      c.height = im.naturalHeight;
      const g = c.getContext('2d');
      if (!g) return 0;
      g.drawImage(im, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let x0 = c.width;
      let x1 = -1;
      for (let y = 0; y < c.height; y++)
        for (let x = 0; x < c.width; x++)
          if (d[(y * c.width + x) * 4 + 3]! > 8) {
            x0 = Math.min(x0, x);
            x1 = Math.max(x1, x);
          }
      return x1 < 0 ? 0 : (x1 - x0 + 1) / c.width;
    });
    // 紙全体の縮小なら 5% 程度。切り出していれば半分以上を占める
    expect(cover).toBeGreaterThan(0.5);
    const fs = await panel.getByRole('radio', { name: 'スクリーン' }).evaluate((el) => getComputedStyle(el).fontSize);
    expect(fs).toBe('12px');
    const sw = await panel.getByRole('radio', { name: 'スクリーン' }).evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(sw).toBe(true);
    await shot(page, '15-layer-thumb');
  });

  test('高さだけ変わっても（ソフトキーボード）Undo 履歴が残る', async ({ page }) => {
    const paper = await openFree(page);
    await drag(page, paper, [0.4, 0.45], [0.55, 0.55]);
    await tapPaper(page, paper, [0.3, 0.3]);
    const undo = toolbar(page).getByRole('button', { name: '元に戻す' });
    await expect(undo).toBeEnabled();
    await page.setViewportSize({ width: 1472, height: 620 });
    await page.waitForTimeout(300);
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect(undo).toBeEnabled(); // 2 手あったので 1 手戻してもまだ戻せる
  });
});

/** 構築ステップ（手順カードが左上に出る）の lessonId と添字。教材 JSON から探す */
function constructStep(): { lessonId: string; index: number } | null {
  const dir = fileURLToPath(new URL('../content/stages', import.meta.url));
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const stage = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { units?: { lessons: { id: string; steps: { type: string }[] }[] }[] };
    for (const u of stage.units ?? [])
      for (const l of u.lessons) {
        const index = l.steps.findIndex((st) => st.type === 'construct');
        if (index >= 0) return { lessonId: l.id, index };
      }
  }
  return null;
}

test('左利き: レイヤーパネルが構築の手順カードと重ならない', async ({ page }) => {
  const hit = constructStep();
  test.skip(!hit, '構築ステップが教材にありません');
  if (!hit) return;
  await page.goto(`/#/lesson/${hit.lessonId}/step/${hit.index}`);
  await page.locator('.loading').waitFor({ state: 'detached' }).catch(() => undefined);
  const card = page.getByTestId('canvas-topleft');
  await expect(card).toBeVisible();
  // ツールバーを反対側へ（左利き）
  await page.getByRole('button', { name: 'ツールバーを反対側へ' }).click();
  await expect(page.locator('.ls-canvas.is-left')).toBeVisible();
  await toolbar(page).getByRole('button', { name: 'レイヤー', exact: true }).click();
  const panel = page.getByTestId('layer-panel');
  await expect(panel).toBeVisible();
  const pb = await panel.boundingBox();
  const cb = await card.boundingBox();
  if (!pb || !cb) throw new Error('パネルかカードが見つかりません');
  const cardShown = await card.evaluate((el) => getComputedStyle(el).visibility !== 'hidden');
  if (cardShown) {
    const overlap = pb.x < cb.x + cb.width && cb.x < pb.x + pb.width && pb.y < cb.y + cb.height && cb.y < pb.y + pb.height;
    expect(overlap).toBe(false);
  }
  await shot(page, '16-lefthanded-construct-layers');
});
