import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

/**
 * 埋め込みのペイント（OG の成果物、public/paint/。tools/import-paint.sh が置く）の BUILD.json。無ければ null（S1 はペイントなし）。
 * - buildId は SW の実行時キャッシュの名前（og-paint-<buildId>）に使う
 * - 字形の .bin は precache に明示で入れる（globIgnores で paint/** を外すので、オフラインで文字の道具を使えるように）
 */
interface PaintBuildInfo {
  buildId: string;
  files: Record<string, string>;
}
function readPaintBuild(): PaintBuildInfo | null {
  const p = fileURLToPath(new URL('./public/paint/BUILD.json', import.meta.url));
  if (!existsSync(p)) return null;
  const info = JSON.parse(readFileSync(p, 'utf8')) as Partial<PaintBuildInfo>;
  if (typeof info.buildId !== 'string' || !info.files || typeof info.files !== 'object') {
    throw new Error('public/paint/BUILD.json が不正です（tools/import-paint.sh で取り込み直してください）');
  }
  return { buildId: info.buildId, files: info.files };
}
const paintBuild = readPaintBuild();
const paintFontEntries = paintBuild
  ? Object.entries(paintBuild.files)
      .filter(([f]) => /\.bin$/i.test(f))
      .map(([f, sha]) => ({ url: `paint/${f}`, revision: sha }))
  : [];

/** この版の識別子（Render は RENDER_GIT_COMMIT を渡す。手元は git の HEAD）。dist/BUILD_ID に書き、safe-push が配信中の版と照合する */
function ilustBuildId(): string {
  const fromRender = process.env['RENDER_GIT_COMMIT'];
  if (fromRender) return fromRender;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}
function buildIdPlugin(): Plugin {
  return {
    name: 'seichotsu-build-id',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'BUILD_ID', source: `${ilustBuildId()}\n` });
    },
  };
}

/**
 * ビルドの index.html に CSP を入れる（robustness-security-05 の Ilust 側。開発サーバーはインラインのスクリプトを使うので入れない）。
 * meta では frame-ancestors が効かないので、Render の Headers に `Content-Security-Policy: frame-ancestors 'self'` を足す（docs/DEPLOY.md ⑦）。
 * connect-src・img-src は絞らない（AI 批評の API・Blob の画像を使うため）。
 */
export const CONTENT_SECURITY_POLICY = "script-src 'self'; object-src 'none'; worker-src 'self' blob:; base-uri 'self'";
function cspPlugin(): Plugin {
  return {
    name: 'seichotsu-csp',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

export default defineConfig({
  define: {
    __OG_PAINT_BUILD_ID__: JSON.stringify(paintBuild?.buildId ?? 'none'),
  },
  build: {
    // scripts/check-bundle.mjs が入口と静的 import の木を数える（dist/.vite/manifest.json）
    manifest: true,
  },
  plugins: [
    buildIdPlugin(),
    cspPlugin(),
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: '成長通',
        short_name: '成長通',
        description: '画力ゼロからキャラクターイラストまで、毎日15分で伴走する練習アプリ',
        lang: 'ja',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        background_color: '#F2EFE8',
        theme_color: '#F2EFE8',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        share_target: {
          action: '/share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: { files: [{ name: 'image', accept: ['image/*'] }] },
        },
      },
      // 共有シート（POST /share-target）を受けるため自前の SW（src/sw.ts）に precache を注入する
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json,glb}'],
        // 埋め込みのペイント（OG の成果物）は precache に入れない（実行時のキャッシュ。src/sw.ts）。ビルドの内部情報も入れない
        globIgnores: ['paint/**', '.vite/**'],
        // 字形の .bin だけは明示で入れる（拡張子がパターンに合わず、オフラインで文字の道具が使えなくなるため）
        additionalManifestEntries: paintFontEntries,
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@content': fileURLToPath(new URL('./content', import.meta.url)),
    },
  },
  server: { port: 5173 },
});
