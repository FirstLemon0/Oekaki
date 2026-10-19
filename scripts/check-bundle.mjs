#!/usr/bin/env node
/**
 * 初期 JS の予算と、埋め込みのペイントが入口に入っていないことの検査（UR-002 / ADR-0007 D5-3、受け入れ ilust-initial-js-budget・ilust-precache-scope）。
 * `npm run build` の後に回す（tools/safe-push.sh の門の 1 つ）。
 *
 * 1. 初期 JS = 入口（index.html のチャンク）+ その静的 import の閉包。dist/.vite/manifest.json（vite.config の build.manifest）から数え、
 *    各ファイルを gzip（level 9）して合計する。上限 = scripts/bundle-budget.json の baselineGzipKB（S1 の最初のビルドの実測）+ ratchetKB（20）。
 * 2. 遅延でなければならない画面（自由お絵描き。S2 以降は OgFreeDraw も）が、動的 import の入口になっていて初期 JS に入っていないこと。
 * 3. 埋め込みのペイント（public/paint/ = OG の成果物）が入口の静的な木に無いこと: manifest のキーが paint/ の下、
 *    または初期 JS に /paint/embed・/paint/assets・ogEmbed の字面があれば失敗（OG のモジュールや URL を入口が直接持たない）。
 * 4. Service Worker の precache に paint/** が無いこと（字形の .bin の明示の分だけ許す）、.vite/ が無いこと。
 *
 *   node scripts/check-bundle.mjs [--dist=dist] [--json] [--measure]   （--measure は予算を判定せず実測だけ出す）
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 遅延でなければならない画面（manifest のキー = ソースのパス）。ソースがあるものだけ確かめる */
export const MUST_BE_LAZY = ['src/ui/screens/FreeDraw.tsx', 'src/ui/screens/OgFreeDraw.tsx'];

/** 初期 JS に入ってはいけない字面（埋め込みのペイントの入口・アセット・API） */
export const FORBIDDEN_INITIAL_TEXT = [/\/paint\/embed/, /\/paint\/assets/, /\bogEmbed\b/];

/** manifest から初期 JS（入口 + 静的 import の閉包）のキーとファイル */
export function initialGraph(manifest, entryKey = 'index.html') {
  const entry = manifest[entryKey];
  if (!entry) throw new Error(`check-bundle: manifest に入口 "${entryKey}" がありません`);
  const keys = [];
  const files = [];
  const css = new Set();
  const seen = new Set();
  const visit = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    const c = manifest[key];
    if (!c) return;
    keys.push(key);
    if (c.file && /\.m?js$/.test(c.file)) files.push(c.file);
    for (const f of c.css ?? []) css.add(f);
    for (const k of c.imports ?? []) visit(k);
  };
  visit(entryKey);
  return { keys, files, css: [...css] };
}

export function gzipBytes(dist, file) {
  return gzipSync(readFileSync(join(dist, file)), { level: 9 }).length;
}

/** dist/sw.js の precache の URL（workbox-build が注入した一覧） */
export function precacheUrls(swText) {
  return [...swText.matchAll(/"?url"?\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
}

export function checkBundle({ dist, budget, srcExists, measureOnly = false }) {
  const errors = [];
  const manifestPath = join(dist, '.vite', 'manifest.json');
  if (!existsSync(manifestPath)) {
    return { errors: [`${manifestPath} がありません（npm run build の後に回してください）`], report: null };
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const graph = initialGraph(manifest);
  const sizes = graph.files.map((f) => ({ file: f, gzip: gzipBytes(dist, f) }));
  const totalKB = Math.round((sizes.reduce((a, s) => a + s.gzip, 0) / 1024) * 10) / 10;
  const cssKB = Math.round((graph.css.reduce((a, f) => a + gzipBytes(dist, f), 0) / 1024) * 10) / 10;
  const limitKB = Math.round((Number(budget.baselineGzipKB) + Number(budget.ratchetKB)) * 10) / 10;
  if (!measureOnly && totalKB > limitKB) {
    errors.push(`初期 JS ${totalKB} KB gz が上限 ${limitKB} KB（基準線 ${budget.baselineGzipKB} + ${budget.ratchetKB}）を超えています`);
  }

  for (const src of MUST_BE_LAZY) {
    if (!srcExists(src)) continue;
    const c = manifest[src];
    if (!c || !c.isDynamicEntry) errors.push(`${src} が遅延の入口（動的 import）になっていません（入口の静的な木に入っている）`);
    else if (graph.keys.includes(src)) errors.push(`${src} が初期 JS に入っています`);
  }

  for (const key of graph.keys) {
    if (/^(public\/)?paint\//.test(key)) errors.push(`埋め込みのペイントが入口の静的な木にあります: ${key}`);
  }
  for (const f of graph.files) {
    const text = readFileSync(join(dist, f), 'utf8');
    for (const re of FORBIDDEN_INITIAL_TEXT) if (re.test(text)) errors.push(`初期 JS ${f} に ${re} の字面があります（ペイントは遅延の画面からだけ開く）`);
  }

  const swPath = join(dist, 'sw.js');
  let precache = [];
  if (!existsSync(swPath)) errors.push(`${swPath} がありません`);
  else {
    precache = precacheUrls(readFileSync(swPath, 'utf8'));
    if (precache.length === 0) errors.push('sw.js に precache の一覧が見つかりません');
    for (const u of precache) {
      if (/^\/?paint\//.test(u) && !/\.bin$/i.test(u)) errors.push(`precache に埋め込みのペイントがあります（実行時のキャッシュにする）: ${u}`);
      if (/^\/?\.vite\//.test(u)) errors.push(`precache にビルドの内部情報があります: ${u}`);
    }
  }
  return {
    errors,
    report: {
      initialJsGzipKB: totalKB,
      initialCssGzipKB: cssKB,
      limitKB,
      files: sizes,
      precacheEntries: precache.length,
      precachePaint: precache.filter((u) => /^\/?paint\//.test(u)),
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const distArg = args.find((a) => a.startsWith('--dist='));
  const dist = distArg ? distArg.slice('--dist='.length) : join(ROOT, 'dist');
  const budget = JSON.parse(readFileSync(join(ROOT, 'scripts', 'bundle-budget.json'), 'utf8'));
  const { errors, report } = checkBundle({
    dist,
    budget,
    srcExists: (src) => existsSync(join(ROOT, src)),
    measureOnly: args.includes('--measure'),
  });
  if (args.includes('--json')) console.log(JSON.stringify({ errors, report }, null, 2));
  else if (report) {
    console.log(
      `check-bundle: 初期 JS ${report.initialJsGzipKB} KB gz / 上限 ${report.limitKB} KB（CSS ${report.initialCssGzipKB} KB gz）、precache ${report.precacheEntries} 件（paint ${report.precachePaint.length} 件）`,
    );
  }
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(errors.length ? 1 : 0);
}
