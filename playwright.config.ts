import { defineConfig, devices } from '@playwright/test';

/**
 * E2E 設定（DESIGN.md §9・完了条件）。
 * `vite preview --port 4173` を webServer にして baseURL をそろえる。
 * viewport は横 1472×920 を既定、縦向きテストだけ 920×1472 を個別指定する。
 *
 * project:
 * - chromium     … 既存の全 spec。Service Worker は止める（ビルド差分やデータ消去の検証を安定させる）
 * - chromium-sw  … e2e/sw/ の spec だけ。Service Worker を有効にする（ADR-0007 D5 / D7: SW が /paint/ を
 *                  成長通の index.html にしない・更新の再読み込みを保留する、を本番と同じ条件で確かめる）
 * push の前（tools/safe-push.sh）は CI=1・--retries=0 で全 project を回す（古い preview を使わない・1 回目の失敗を隠さない）。
 */
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  // CI（safe-push）では再試行しない。手元では 1 回まで
  retries: isCI ? 0 : 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    acceptDownloads: true,
    // PWA の Service Worker がキャッシュを返すと、ビルド差分やデータ消去の検証が不安定になる
    serviceWorkers: 'block',
    viewport: { width: 1472, height: 920 },
  },
  projects: [
    {
      name: 'chromium',
      // devices['Desktop Chrome'] 自体の viewport (1280x720) で上書きされないよう、
      // 上の既定ビューポート（1472x920）を明示的に再指定する。
      use: { ...devices['Desktop Chrome'], viewport: { width: 1472, height: 920 }, serviceWorkers: 'block' },
      testIgnore: ['**/sw/**'],
    },
    {
      name: 'chromium-sw',
      testMatch: ['**/sw/**/*.spec.ts'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1472, height: 920 }, serviceWorkers: 'allow' },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
