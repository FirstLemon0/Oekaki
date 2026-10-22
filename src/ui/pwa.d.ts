/// <reference types="vite-plugin-pwa/client" />

/** 埋め込みのペイント（public/paint/BUILD.json）の buildId。無ければ 'none'（vite.config の define が入れる。SW だけが使う） */
declare const __OG_PAINT_BUILD_ID__: string;

/** 埋め込みのペイントの版（public/paint/BUILD.json から。無ければ null。vite.config の define。src/ui/og/paintInfo.ts だけが読む） */
declare const __OG_PAINT_INFO__: { buildId: string; ogContract: string; embedApi: number } | null;

/**
 * 埋め込みのペイントのファイルの一覧（public/paint/BUILD.json の files = パス → sha256）。無ければ {}（vite.config の define。
 * SW だけが使う = install で og-paint-<buildId> に先に入れる、ilust-sup-followup-12・src/swPaint.ts）
 */
declare const __OG_PAINT_FILES__: Record<string, string>;
