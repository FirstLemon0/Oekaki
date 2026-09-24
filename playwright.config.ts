import { defineConfig, devices } from '@playwright/test';

/**
 * E2E 設定（DESIGN.md §9・完了条件）。
 * `vite preview --port 4173` を webServer にして baseURL をそろえる。
 * viewport は横 1472×920 を既定、縦向きテストだけ 920×1472 を個別指定する。
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 1,
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
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
