/// <reference types="vite-plugin-pwa/client" />

/** 埋め込みのペイント（public/paint/BUILD.json）の buildId。無ければ 'none'（vite.config の define が入れる。SW だけが使う） */
declare const __OG_PAINT_BUILD_ID__: string;
