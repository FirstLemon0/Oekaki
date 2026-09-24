#!/usr/bin/env node
/**
 * レッスン再生の実ブラウザ確認（Playwright / chromium）。
 *
 *   npm run build && npx vite preview --port 4179 &   （別ターミナル）
 *   node tools/e2e-lesson.mjs [http://localhost:4179/]
 *
 * 確かめること:
 *   1. 選択式（U10-2）のレッスンで「この技法は飛ばす」→ 次のレッスンへ・トースト
 *   2. 途中で閉じて開き直すと「続きから／最初から」が出て、続きからで同じステップに戻る
 *   3. 「最初から」でステップ 1 から始まる
 */
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://localhost:4179/';
const out = [];
const ok = (m) => out.push(`OK  ${m}`);
const fail = (m) => {
  out.push(`NG  ${m}`);
  process.exitCode = 1;
};
const expectTrue = (cond, m) => (cond ? ok(m) : fail(m));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1472, height: 920 } });
page.on('pageerror', (e) => fail(`pageerror: ${e.message}`));

async function open(hash) {
  await page.goto('about:blank');
  await page.goto(`${BASE}${hash}`);
  await page.waitForSelector('.ls-root, .ls-missing', { timeout: 15000 });
}

try {
// 1. 飛ばす ---------------------------------------------------------------
await open('#/lesson/s10-u2-l1');
const skipBtn = page.getByRole('button', { name: 'この技法は飛ばす' });
expectTrue(await skipBtn.isVisible(), '選択式レッスンのヘッダに「この技法は飛ばす」が出る');
await skipBtn.click();
await page.waitForFunction(() => location.hash === '#/lesson/s10-u2-l2', null, { timeout: 5000 }).catch(() => {});
expectTrue((await page.evaluate(() => location.hash)) === '#/lesson/s10-u2-l2', '飛ばすと次のレッスン（s10-u2-l2）へ進む');
expectTrue(await page.getByText('飛ばしました。あとで戻れます').isVisible(), 'トースト「飛ばしました。あとで戻れます」が出る');
expectTrue((await page.locator('.ls-done, .ls-modal, [role="dialog"]').count()) === 0, '完了モーダルは出ない');

await open('#/lesson/s10-u1-l1');
expectTrue((await page.getByRole('button', { name: 'この技法は飛ばす' }).count()) === 0, '必修のレッスンには「飛ばす」が出ない');

// 2. 途中再開（最終課題 s10-u4-l1: read, read, submit, ...） ---------------
await open('#/lesson/s10-u4-l1');
await page.getByRole('button', { name: '次へ' }).click();
await page.waitForFunction(() => location.hash.endsWith('/step/1'));
await page.getByRole('button', { name: '次へ' }).click();
await page.waitForFunction(() => location.hash.endsWith('/step/2'));
ok('最終課題をステップ 3（提出）まで進めた');
// 保存の完了を少し待ってから閉じる（別の日に開き直す想定で、ページごと読み直す）
await page.waitForTimeout(300);
await page.goto('about:blank');
await open('#/lesson/s10-u4-l1');
const sheet = page.getByRole('dialog', { name: '続きから始めますか？' });
await sheet.waitFor({ timeout: 5000 }).catch(() => {});
expectTrue(await sheet.isVisible(), '開き直すと「続きから始めますか？」が出る');
out.push(`    シート: ${(await sheet.innerText()).replace(/\s+/g, ' ')}`);
const cont = page.getByRole('button', { name: /続きから（ステップ 3）/ });
expectTrue(await cont.isVisible({ timeout: 3000 }).catch(() => false), '「続きから（ステップ 3）」が出る');
await cont.click();
await page.waitForFunction(() => location.hash.endsWith('/step/2'), null, { timeout: 5000 }).catch(() => {});
expectTrue((await page.evaluate(() => location.hash)) === '#/lesson/s10-u4-l1/step/2', '続きからでステップ 3 に戻る');
expectTrue((await page.locator('.ls-head__count').innerText()).replace(/\s/g, '') === '3/7', 'ヘッダの番号も 3/7');

// 3. 最初から ---------------------------------------------------------------
await page.goto('about:blank');
await open('#/lesson/s10-u4-l1');
await page.getByRole('button', { name: '最初から' }).click();
expectTrue(!(await sheet.isVisible()), '「最初から」でシートが閉じる');
expectTrue((await page.locator('.ls-head__count').innerText()).replace(/\s/g, '').startsWith('1/'), '最初から＝ステップ 1');

} catch (e) {
  fail(`中断: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
  await page.screenshot({ path: 'tools/.e2e-lesson-fail.png' }).catch(() => {});
} finally {
  await browser.close();
  console.log(out.join('\n'));
}
