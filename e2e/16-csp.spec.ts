/**
 * ビルドの index.html の CSP（robustness-security-05 の Ilust 側、受け入れ ilust-csp の meta の分）。
 * script-src 'self' でインラインのスクリプトは動かず、アプリ本体（同じオリジンのモジュール）は動く。
 * frame-ancestors は meta では効かないので Render の Headers で入れる（docs/DEPLOY.md ⑦）。
 */
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gotoApp } from './helpers';
import { drawOg, openOgFree, setOgEngine, waitOgContent } from './og-helpers';

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

test('配信の CSP（public/_headers）の下でも、新しいお絵描き（同じオリジンの iframe と Worker）が動く', async ({ page }) => {
  const headers = readFileSync(fileURLToPath(new URL('../public/_headers', import.meta.url)), 'utf8');
  const csp = /Content-Security-Policy:\s*(.+)/.exec(headers)?.[1]?.trim();
  expect(csp).toContain("frame-ancestors 'self'");
  // 文書（成長通と /paint/embed.html）に Render と同じヘッダーを付ける
  await page.route(
    (url) => url.origin === 'http://localhost:4173' && (url.pathname === '/' || url.pathname.endsWith('.html')),
    async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, headers: { ...res.headers(), 'content-security-policy': csp! } });
    },
  );
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  await setOgEngine(page, true);
  const frame = await openOgFree(page);
  await drawOg(page, 1);
  await waitOgContent(frame);
  expect(violations).toEqual([]);
});
