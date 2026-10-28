/**
 * 過去の埋め込みで保存した .ognk のフィクスチャを作る（ilust-sup-followup-06）。通常の e2e には入らない（*.gen.ts）。
 *
 *   OG_FIXTURE_NAME=og-8af7b0f npx playwright test --config=e2e/fixtures/og-fixture.config.ts
 *
 * **配信中の成果物（public/paint/ を取り込み直す前）で**走らせる。e2e/fixtures/<name>.ognk と <name>.json（画素の要約・版）を書く。
 * 取り込み直しで OGNK の形式か ogContract が上がるときは、その前にこれで今の版のフィクスチャを足し、13-og-free の試験に加える。
 *
 * 下書き（OG の自動保存の記録）のフィクスチャ（ADR-0010 D6-4、受け入れ ilust-draft-cross-version）は make-og-draft-fixture.gen.ts:
 *   OG_DRAFT_FIXTURE_NAME=og-8af7b0f-draft npx playwright test --config=e2e/fixtures/og-fixture.config.ts make-og-draft-fixture
 */
import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: ['make-og-fixture.gen.ts', 'make-og-draft-fixture.gen.ts'],
  retries: 0,
  reporter: [['list']],
  projects: [{ ...base.projects![0]!, testIgnore: [] }],
});
