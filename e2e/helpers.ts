/**
 * E2E 共通ヘルパー。
 *
 * 各 Playwright テストは既定でブラウザコンテキストが分かれる（＝ IndexedDB / localStorage も
 * テストごとに白紙）ので、通常は `page.goto('/')` するだけで初回起動状態になる。
 * バックアップのテスト（05）だけは同一テスト内で明示的に IndexedDB を消す必要があるので、
 * `wipeIndexedDb` を用意している。
 */
import type { Locator, Page } from '@playwright/test';

/** ホーム／設定などの通常画面に入る。初期化（ready）を待つ。 */
export async function gotoApp(page: Page, hash = '#/'): Promise<void> {
  await page.goto(`/${hash}`);
  // App は ready.value になるまで .loading を出す（src/app.tsx）
  await page.locator('.loading').waitFor({ state: 'detached' }).catch(() => undefined);
}

/**
 * 現在のページの IndexedDB（seichotsu）を消す。
 * 手順: いったん about:blank へ退避して既存の接続を閉じ、再度アプリへ戻ってから削除する。
 * （同一オリジンで開いたままだと `deleteDatabase` が blocked のまま進まないため）
 */
export async function wipeIndexedDb(page: Page): Promise<void> {
  await page.evaluate(() => {
    return new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('seichotsu');
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
      // 実行中の接続がある場合、次の reload で確実に閉じられて処理が進む
      setTimeout(resolve, 500);
    });
  });
}

/**
 * キャンバス上でマウスをドラッグして 1 本の線を引く（DESIGN 指定どおり 300px 以上）。
 *
 * 始点・終点は紙の中央〜右寄り・縦中央の帯（幅・高さの 35%〜75%）に収める。
 * CanvasScreen は左中央にツールバー、上中央に課題ピル、右下・左下に完了/ペン専用の
 * バッジを重ねて配置する（src/ui/screens/CanvasScreen.tsx）ため、紙の端に近い位置で
 * mousedown するとそれらの UI がクリックを奪ってしまい、線が1本も記録されない。
 */
export async function drawLine(
  page: Page,
  canvas: Locator,
  opts: { dx?: number; dy?: number; steps?: number; yRatio?: number } = {},
): Promise<void> {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('キャンバスが見つかりません（表示されていない可能性があります）');
  const dx = opts.dx ?? Math.min(380, box.width * 0.35);
  const dy = opts.dy ?? Math.min(160, box.height * 0.2);
  const steps = opts.steps ?? 14;
  const yRatio = opts.yRatio ?? 0.5;
  const x0 = box.x + box.width * 0.35;
  const y0 = box.y + box.height * yRatio;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + (dx * i) / steps, y0 + (dy * i) / steps);
  }
  await page.mouse.up();
}

/** キャンバス上に複数本の線を描く（自由お絵描き用）。中央〜右寄りの帯に収める（drawLine 参照）。 */
export async function drawFewStrokes(page: Page, canvas: Locator, count = 3): Promise<void> {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('キャンバスが見つかりません');
  const dx = Math.min(300, box.width * 0.3);
  for (let n = 0; n < count; n++) {
    const y = box.y + box.height * (0.4 + n * 0.08);
    const x0 = box.x + box.width * 0.35;
    await page.mouse.move(x0, y);
    await page.mouse.down();
    await page.mouse.move(x0 + dx, y + 40, { steps: 10 });
    await page.mouse.up();
  }
}

/** Anthropic Messages API 形式の正常応答本文を組み立てる（src/critic/critic.test.ts と同じ形）。 */
export function anthropicMessageBody(good: string[], issues: { where: string; what: string; fix: string }[]) {
  return {
    id: 'msg_e2e',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          good,
          issues,
          next_one: 'つぎは十字線の角度をそろえてみましょう',
          encourage: 'よく描けています。',
        }),
      },
    ],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1200, output_tokens: 300 },
  };
}
