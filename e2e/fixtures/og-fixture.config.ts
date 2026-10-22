/**
 * 過去の埋め込みで保存した .ognk のフィクスチャを作る（ilust-sup-followup-06）。通常の e2e には入らない（*.gen.ts）。
 *
 *   OG_FIXTURE_NAME=og-8af7b0f npx playwright test --config=e2e/fixtures/og-fixture.config.ts
 *
 * **配信中の成果物（public/paint/ を取り込み直す前）で**走らせる。e2e/fixtures/<name>.ognk と <name>.json（画素の要約・版）を書く。
 * 取り込み直しで OGNK の形式か ogContract が上がるときは、その前にこれで今の版のフィクスチャを足し、13-og-free の試験に加える。
 */
import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: ['make-og-fixture.gen.ts'],
  retries: 0,
  reporter: [['list']],
  projects: [{ ...base.projects![0]!, testIgnore: [] }],
});
