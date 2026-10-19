/**
 * 埋め込みのペイント（OG の成果物、public/paint/）の BUILD.json の作成と照合（UR-002 / ADR-0007 D4-2・D7、受け入れ embed-artifact-delivery）。
 *
 * public/paint/ に置いてよいのは、OG で `npm run check:embed` が緑だった成果物だけ（tools/import-paint.sh が置く）。
 * BUILD.json には OG のコミット・契約の版・API の版・ファイルごとの sha256・合計のバイト数・初期 JS の gz を書き、
 * ここの `verifyPaintArtifact` が「一覧と実物が一致する（手で直した・足した・消したファイルが無い）」「sw.js / manifest / .map /
 * sandbox / bench / OG のソース / 製品名の字面が無い」を確かめる。
 *
 *   node scripts/paint-artifact.mjs write <dir> --og-commit=<sha> --og-contract=<版> --embed-api=<n> [--vite=<版>]
 *   node scripts/paint-artifact.mjs verify <dir>
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const BUILD_JSON = 'BUILD.json';
export const BUILD_SCHEMA = 1;

/** 製品名の字面（UI に出さない約束。OG の check:embed と同じ考え方で、成果物に 1 つでもあれば失敗） */
export const PRODUCT_NAME_RE = /クリスタ|CLIP\s*STUDIO|CELSYS|セルシス|clipstudio/i;

/** 置いてはいけないファイル（パスはディレクトリからの相対、/ 区切り） */
export const FORBIDDEN_FILES = [
  { re: /(^|\/)sw\.js$/i, why: 'Service Worker（Ilust の SW と衝突する）' },
  { re: /(^|\/)(manifest\.webmanifest|manifest\.json)$/i, why: 'PWA の manifest' },
  { re: /\.map$/i, why: 'sourcemap（OG のソースが公開される）' },
  { re: /(^|\/)sandbox[^/]*\.html$/i, why: 'sandbox の入口' },
  { re: /(^|\/)bench/i, why: 'bench' },
  { re: /\.(ts|tsx|mts|cts)$/i, why: 'OG のソース' },
  { re: /(^|\/)\.vite\//, why: 'ビルドの内部情報（.vite）' },
  { re: /\.(icc|icm)$/i, why: 'ICC プロファイル' },
];

const TEXT_EXT = /\.(js|mjs|css|html|json|svg|txt)$/i;

/** ディレクトリの全ファイル（相対パス、/ 区切り、辞書順） */
export function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(dir, full).split(sep).join('/'));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** embed.html が起動時に読む JS（module script と modulepreload）の gz の合計 */
export function initialJsGzipBytes(dir) {
  const htmlPath = join(dir, 'embed.html');
  if (!existsSync(htmlPath)) return 0;
  const html = readFileSync(htmlPath, 'utf8');
  const refs = new Set();
  for (const m of html.matchAll(/<script[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/g)) refs.add(m[1]);
  for (const m of html.matchAll(/<link[^>]*\brel=["']modulepreload["'][^>]*\bhref=["']([^"']+)["']/g)) refs.add(m[1]);
  let total = 0;
  for (const ref of refs) {
    const rel = ref.replace(/^\/paint\//, '').replace(/^\.\//, '');
    const p = join(dir, rel);
    if (existsSync(p)) total += gzipSync(readFileSync(p), { level: 9 }).length;
  }
  return total;
}

/** 字形の .bin（Service Worker が明示で precache する分） */
export function fontBinFiles(files) {
  return files.filter((f) => /\.bin$/i.test(f));
}

/** BUILD.json を作る（ファイルの一覧と sha256 は今のディレクトリの中身から） */
export function makeBuildInfo(dir, { ogCommit, ogContract, embedApi, vite = null, createdAt = new Date().toISOString() }) {
  if (!/^[0-9a-f]{7,40}$/.test(String(ogCommit))) throw new Error(`og-commit が不正です: ${ogCommit}`);
  if (!/^\d+\.\d+\.\d+/.test(String(ogContract))) throw new Error(`og-contract が不正です: ${ogContract}`);
  const api = Number(embedApi);
  if (!Number.isInteger(api) || api < 1) throw new Error(`embed-api が不正です: ${embedApi}`);
  const files = {};
  let totalBytes = 0;
  for (const f of listFiles(dir)) {
    if (f === BUILD_JSON) continue;
    const buf = readFileSync(join(dir, f));
    files[f] = sha256(buf);
    totalBytes += buf.length;
  }
  const digest = sha256(Buffer.from(JSON.stringify(files))).slice(0, 12);
  return {
    schema: BUILD_SCHEMA,
    ogCommit: String(ogCommit),
    ogContract: String(ogContract),
    embedApi: api,
    // Service Worker の実行時キャッシュの名前（og-paint-<buildId>）。中身が変われば変わる
    buildId: `${String(ogCommit).slice(0, 12)}-${digest}`,
    vite,
    createdAt,
    files,
    totalBytes,
    initialJsGzipBytes: initialJsGzipBytes(dir),
  };
}

/** BUILD.json を読む（無い・壊れていれば null） */
export function readBuildInfo(dir) {
  const p = join(dir, BUILD_JSON);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 成果物を照合する。ディレクトリが無ければ { present: false, errors: [] }（S1 は成果物なしで出してよい）。
 * 戻り値の errors が空なら合格。
 */
export function verifyPaintArtifact(dir) {
  const errors = [];
  if (!existsSync(dir)) return { present: false, errors, info: null };
  const files = listFiles(dir);
  if (files.length === 0) return { present: false, errors, info: null };
  const info = readBuildInfo(dir);
  if (!info) {
    errors.push(`${BUILD_JSON} が無いか読めません`);
    return { present: true, errors, info: null };
  }
  if (info.schema !== BUILD_SCHEMA) errors.push(`${BUILD_JSON} の schema が ${BUILD_SCHEMA} ではありません: ${info.schema}`);
  for (const key of ['ogCommit', 'ogContract', 'buildId']) {
    if (typeof info[key] !== 'string' || !info[key]) errors.push(`${BUILD_JSON} に ${key} がありません`);
  }
  if (!Number.isInteger(info.embedApi) || info.embedApi < 1) errors.push(`${BUILD_JSON} の embedApi が不正です`);
  const listed = info.files && typeof info.files === 'object' ? info.files : {};
  const actual = files.filter((f) => f !== BUILD_JSON);
  for (const f of actual) {
    if (!(f in listed)) errors.push(`一覧に無いファイルがあります（手で足した?）: ${f}`);
  }
  let totalBytes = 0;
  for (const [f, hash] of Object.entries(listed)) {
    const p = join(dir, f);
    if (!existsSync(p)) {
      errors.push(`一覧のファイルがありません: ${f}`);
      continue;
    }
    const buf = readFileSync(p);
    totalBytes += buf.length;
    if (sha256(buf) !== hash) errors.push(`sha256 が一致しません（手で直した?）: ${f}`);
  }
  if (typeof info.totalBytes === 'number' && info.totalBytes !== totalBytes) {
    errors.push(`合計のバイト数が一致しません: BUILD.json ${info.totalBytes} / 実物 ${totalBytes}`);
  }
  if (!actual.includes('embed.html')) errors.push('embed.html がありません');
  for (const f of actual) {
    for (const rule of FORBIDDEN_FILES) if (rule.re.test(f)) errors.push(`置いてはいけないファイル（${rule.why}）: ${f}`);
    if (TEXT_EXT.test(f)) {
      const text = readFileSync(join(dir, f), 'utf8');
      if (PRODUCT_NAME_RE.test(text)) errors.push(`製品名の字面があります: ${f}`);
      if (/\.m?js$/i.test(f) && /serviceWorker\s*\.\s*register/.test(text)) errors.push(`Service Worker の登録があります: ${f}`);
      if (/\.m?js$/i.test(f) && /sourceMappingURL=/.test(text)) errors.push(`sourcemap の参照があります: ${f}`);
      if (/\.html$/i.test(f)) {
        for (const m of text.matchAll(/\b(?:src|href)=["'](\/[^"']*)["']/g)) {
          if (!m[1].startsWith('/paint/')) errors.push(`/paint/ の外の絶対パスを参照しています（${m[1]}）: ${f}`);
        }
        if (/rel=["']manifest["']/.test(text)) errors.push(`manifest の link があります: ${f}`);
      }
    }
  }
  return { present: true, errors, info };
}

function parseArgs(argv) {
  const out = { _: [] };
  for (const a of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2];
    else out._.push(a);
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, dir] = args._;
  if (cmd === 'write' && dir) {
    const info = makeBuildInfo(dir, {
      ogCommit: args['og-commit'],
      ogContract: args['og-contract'],
      embedApi: args['embed-api'],
      vite: args.vite ?? null,
    });
    writeFileSync(join(dir, BUILD_JSON), `${JSON.stringify(info, null, 2)}\n`);
    console.log(
      `BUILD.json: ${Object.keys(info.files).length} files, ${info.totalBytes} B, initial JS ${(info.initialJsGzipBytes / 1024).toFixed(1)} KB gz, buildId ${info.buildId}`,
    );
  } else if (cmd === 'verify' && dir) {
    const r = verifyPaintArtifact(dir);
    if (!r.present) console.log(`${dir}: 成果物なし（S1 はペイントなしで出せる）`);
    for (const e of r.errors) console.error(`  ✗ ${e}`);
    process.exit(r.errors.length ? 1 : 0);
  } else {
    console.error('usage: paint-artifact.mjs write <dir> --og-commit=… --og-contract=… --embed-api=… | verify <dir>');
    process.exit(2);
  }
}
