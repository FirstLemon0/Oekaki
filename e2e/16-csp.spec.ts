/**
 * ビルドの index.html の CSP（robustness-security-05 の Ilust 側、受け入れ ilust-csp の meta の分）。
 * script-src 'self' でインラインのスクリプトは動かず、アプリ本体（同じオリジンのモジュール）は動く。
 * frame-ancestors は meta では効かないので Render の Headers で入れる（docs/DEPLOY.md ⑦）。
 */
import { expect, test } from '@playwright/test';
import { gotoApp } from './helpers';

test('CSP: meta があり、インラインのスクリプトは動かず、アプリは動く', async ({ page }) => {
  await gotoApp(page);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("worker-src 'self' blob:");
  await expect(page.getByRole('link', { name: /自由お絵描き/ })).toBeVisible();

  const injected = await page.evaluate(async () => {
    const s = document.createElement('script');
    s.textContent = 'window.__cspInline = 1';
    document.head.appendChild(s);
    await new Promise((r) => setTimeout(r, 50));
    return (window as unknown as { __cspInline?: number }).__cspInline ?? null;
  });
  expect(injected).toBeNull();
});
