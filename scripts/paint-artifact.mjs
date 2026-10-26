/**
 * 埋め込みのペイント（OG の成果物、public/paint/）の BUILD.json の作成と照合（UR-002 / ADR-0007 D4-2・D7、受け入れ embed-artifact-delivery）。
 *
 * public/paint/ に置いてよいのは、OG で `npm run check:embed` が緑だった成果物だけ（tools/import-paint.sh が置く）。
 * BUILD.json には OG のコミット・契約の版・API の版・ファイルごとの sha256・合計のバイト数・入口の JS の gz を書き、
 * ここの `verifyPaintArtifact` が「一覧と実物が一致する（手で直した・足した・消したファイルが無い）」「sw.js / manifest / .map /
 * sandbox / bench / OG のソース / 製品名の字面が無い」を確かめる。
 *
 * schema 2（M8、ilust-sup-followup-02 / ADR-0008 D10）: 取り込みの関門の記録を足す。
 * - `ogCi`（'ran' | 'skipped'）… OG の `npm run ci` を回したか。'skipped' は check-paint-artifact が拒む（試験の SAFE_PUSH_TEST_CHECKS のときだけ警告）
 * - `ogClean`（true）… OG の作業木が未追跡を含めて clean（`git status --porcelain` が空）だった。false / 無しは拒む
 * - `ogRef`（取り込みに渡した名前、例 'm7-accepted'）・`ogAccepted`（そのコミットを指す受け入れのタグ `m<n>-accepted`、点の版 `m<n>.<k>-accepted` も可。無ければ拒む）
 * - `entryJsGzipBytes` … embed.html が直接読む JS（module script + modulepreload）の gz。旧名 `initialJsGzipBytes` は 1 版だけ同じ値で残す
 *   （埋め込みの本当の初期 JS は入口の動的 import の先も含むので、それは OG の check-embed の値を `ogInitialJsGzipBytes` に写す）
 * schema 1（M7 までの取り込み）は読めるが、関門の記録が無い旨の警告を出す（配信済みの成果物の移行の印）。
 *
 * embed.html の CSP の meta（robustness-security-02、OG の build:embed が M8 から入れる）: あれば head の先頭・`script-src 'self'`・
 * `object-src 'none'` を求め、無ければ移行の印として警告だけ（ogContract が CSP_META_REQUIRED_FROM_CONTRACT 以上、または ogAccepted が m8 以降 = m8-accepted 以降の取り込みでは不合格）。
 *
 * 初期 JS の増え方（ilust-sup-followup-04）: `checkInitialJsGrowth` が origin/main の BUILD.json と比べて警告を返す（check-paint-artifact が出す）。
 *
 *   node scripts/paint-artifact.mjs write <dir> --og-commit=<sha> --og-contract=<版> --embed-api=<n> --og-ci=ran|skipped --og-clean=true|false
 *        [--og-ref=<名前>] [--og-accepted=<タグ>] [--og-initial-js-gz=<n>] [--vite=<版>]
 *   node scripts/paint-artifact.mjs verify <dir>
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { env } from 'node:process';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const BUILD_JSON = 'BUILD.json';
export const BUILD_SCHEMA = 2;
/** 読める schema（1 = M7 までの取り込み。関門の記録なし = 警告） */
export const READABLE_SCHEMAS = [1, 2];
export const OG_CI_VALUES = ['ran', 'skipped'];
/**
 * 受け入れのタグの形（ADR-0008 D10-1: 取り込みの基点は受け入れ済みのタグだけ）。
 * 点の版（ADR-0009 D1-2、例 `m8.1-accepted`）も受け入れ済みのタグとして扱う
 */
export const ACCEPTED_TAG_RE = /^m\d+(?:\.\d+)?-accepted$/;
/** CSP の meta を必須にする契約の版（M8 で 0.10.0 を適用 = m8-accepted 以降の取り込み）。それより前は無くても警告だけ */
export const CSP_META_REQUIRED_FROM_CONTRACT = '0.10.0';
/** CSP の meta を必須にする受け入れの版（m8 以降。契約の版の読み違いがあっても、受け入れのタグからも必須にする。robustness-security-06） */
export const CSP_META_REQUIRED_FROM_MILESTONE = 8;
/**
 * 埋め込みの初期 JS（OG の check-embed の値 = ogInitialJsGzipBytes）の増え方の警告（ilust-sup-followup-04）。
 * OG の check-embed の予算は 560 KB gz（KiB）。origin/main の取り込みから +8 KB を超えるか、予算の 98 % を超えたら警告する（落とさない）
 */
export const OG_EMBED_INITIAL_BUDGET_BYTES = 560 * 1024;
export const INITIAL_JS_GROWTH_WARN_BYTES = 8 * 1024;
export const INITIAL_JS_BUDGET_WARN_RATIO = 0.98;

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

/**
 * embed.html が直接読む JS（module script と modulepreload）の gz の合計。入口が動的 import で読む起動のチャンクは入らない
 * （= 埋め込みの「初期 JS」ではない。ilust-sup-followup-08 で名前を entryJsGzipBytes に改めた）
 */
export function entryJsGzipBytes(dir) {
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

/** 旧名（1 版だけ残す） */
export const initialJsGzipBytes = entryJsGzipBytes;

/** 'a.b.c' の比較（数字の部分だけ。a < b なら負） */
export function compareVersions(a, b) {
  const pa = String(a)
    .split(/[.-]/)
    .map((x) => Number.parseInt(x, 10) || 0);
  const pb = String(b)
    .split(/[.-]/)
    .map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * embed.html の CSP の meta を読む。無ければ null。
 * 戻り値: { directives: Map<名前, 値の配列>, beforeScripts: meta が最初の script / modulepreload より前にあるか, count }
 */
export function readCspMeta(html) {
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].filter((m) => /http-equiv\s*=\s*["']content-security-policy["']/i.test(m[0]));
  if (metas.length === 0) return null;
  const m = metas[0];
  const content = /\bcontent\s*=\s*"([^"]*)"/i.exec(m[0])?.[1] ?? /\bcontent\s*=\s*'([^']*)'/i.exec(m[0])?.[1] ?? '';
  const directives = new Map();
  for (const part of content.split(';')) {
    const toks = part.trim().split(/\s+/).filter(Boolean);
    if (toks.length === 0) continue;
    const name = toks[0].toLowerCase();
    if (!directives.has(name)) directives.set(name, toks.slice(1));
  }
  const firstScript = html.search(/<script\b|<link\b[^>]*\brel=["']modulepreload["']/i);
  return { directives, beforeScripts: firstScript < 0 || m.index < firstScript, count: metas.length };
}

/** script-src に入っていてはいけない値（'self' の外から・文字列から実行できる） */
const UNSAFE_SCRIPT_SOURCES = new Set(['*', "'unsafe-inline'", "'unsafe-eval'", 'data:', 'blob:', 'http:', 'https:']);

/** 受け入れのタグの版の大きい方の数（'m8.1-accepted' → 8、形が違えば null） */
export function acceptedMilestone(tag) {
  const m = /^m(\d+)(?:\.\d+)?-accepted$/.exec(String(tag ?? ''));
  return m ? Number(m[1]) : null;
}

/** CSP の meta が必須の成果物か（契約 0.10.0 以降か、受け入れのタグが m8 以降） */
export function cspMetaRequired({ ogContract, ogAccepted } = {}) {
  if (typeof ogContract === 'string' && compareVersions(ogContract, CSP_META_REQUIRED_FROM_CONTRACT) >= 0) return true;
  const ms = acceptedMilestone(ogAccepted);
  return ms !== null && ms >= CSP_META_REQUIRED_FROM_MILESTONE;
}

/** CSP の meta の検査。{ errors, warnings, present } */
export function checkCspMeta(html, { ogContract, ogAccepted } = {}) {
  const errors = [];
  const warnings = [];
  const csp = readCspMeta(html);
  if (!csp) {
    const required = cspMetaRequired({ ogContract, ogAccepted });
    const msg = `embed.html に CSP の meta がありません（契約 ${CSP_META_REQUIRED_FROM_CONTRACT} 以降・m${CSP_META_REQUIRED_FROM_MILESTONE} 以降の受け入れのタグからの取り込みでは必須）`;
    if (required) errors.push(msg);
    else warnings.push(`${msg}。移行の印: 今の成果物（契約 ${ogContract ?? '?'}）は警告だけ`);
    return { errors, warnings, present: false };
  }
  if (csp.count > 1) warnings.push(`embed.html に CSP の meta が ${csp.count} 個あります（最初の 1 つだけ検査）`);
  if (!csp.beforeScripts) errors.push('embed.html の CSP の meta が最初の script より後にあります（head の先頭に置く）');
  const script = csp.directives.get('script-src') ?? csp.directives.get('default-src');
  if (!script) errors.push('embed.html の CSP に script-src（か default-src）がありません');
  else {
    if (!script.includes("'self'")) errors.push("embed.html の CSP の script-src に 'self' がありません");
    const bad = script.filter((t) => UNSAFE_SCRIPT_SOURCES.has(t.toLowerCase()));
    if (bad.length) errors.push(`embed.html の CSP の script-src が広すぎます: ${bad.join(' ')}`);
  }
  const object = csp.directives.get('object-src');
  if (!object || object.length !== 1 || object[0] !== "'none'") errors.push("embed.html の CSP に object-src 'none' がありません");
  return { errors, warnings, present: true };
}

/** 字形の .bin（Service Worker が明示で precache する分） */
export function fontBinFiles(files) {
  return files.filter((f) => /\.bin$/i.test(f));
}

/** BUILD.json を作る（ファイルの一覧と sha256 は今のディレクトリの中身から） */
export function makeBuildInfo(
  dir,
  {
    ogCommit,
    ogContract,
    embedApi,
    ogCi,
    ogClean,
    ogRef = null,
    ogAccepted = null,
    ogInitialJsGzipBytes = null,
    vite = null,
    createdAt = new Date().toISOString(),
  },
) {
  if (!/^[0-9a-f]{7,40}$/.test(String(ogCommit))) throw new Error(`og-commit が不正です: ${ogCommit}`);
  if (!/^\d+\.\d+\.\d+/.test(String(ogContract))) throw new Error(`og-contract が不正です: ${ogContract}`);
  const api = Number(embedApi);
  if (!Number.isInteger(api) || api < 1) throw new Error(`embed-api が不正です: ${embedApi}`);
  if (!OG_CI_VALUES.includes(ogCi)) throw new Error(`og-ci は ran か skipped です: ${ogCi}`);
  if (typeof ogClean !== 'boolean') throw new Error(`og-clean は true か false です: ${ogClean}`);
  if (ogAccepted !== null && !ACCEPTED_TAG_RE.test(String(ogAccepted))) throw new Error(`og-accepted は m<n>-accepted（点の版は m<n>.<k>-accepted）の形です: ${ogAccepted}`);
  const ogInitial = ogInitialJsGzipBytes === null || ogInitialJsGzipBytes === undefined ? null : Number(ogInitialJsGzipBytes);
  if (ogInitial !== null && (!Number.isInteger(ogInitial) || ogInitial < 0)) throw new Error(`og-initial-js-gz が不正です: ${ogInitialJsGzipBytes}`);
  const files = {};
  let totalBytes = 0;
  for (const f of listFiles(dir)) {
    if (f === BUILD_JSON) continue;
    const buf = readFileSync(join(dir, f));
    files[f] = sha256(buf);
    totalBytes += buf.length;
  }
  const digest = sha256(Buffer.from(JSON.stringify(files))).slice(0, 12);
  const entry = entryJsGzipBytes(dir);
  return {
    schema: BUILD_SCHEMA,
    ogCommit: String(ogCommit),
    ogContract: String(ogContract),
    embedApi: api,
    // Service Worker の実行時キャッシュの名前（og-paint-<buildId>）。中身が変われば変わる
    buildId: `${String(ogCommit).slice(0, 12)}-${digest}`,
    ogRef: ogRef === null ? null : String(ogRef),
    ogAccepted: ogAccepted === null ? null : String(ogAccepted),
    ogCi,
    ogClean,
    vite,
    createdAt,
    files,
    totalBytes,
    entryJsGzipBytes: entry,
    // 旧名（ilust-sup-followup-08。1 版だけ残す。次の schema で消す）
    initialJsGzipBytes: entry,
    ogInitialJsGzipBytes: ogInitial,
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
 * 取り込みの関門の記録（schema 2）の検査。{ errors, warnings }。
 * `allowTestImports`（tools/safe-push.sh の試験 = SAFE_PUSH_TEST_CHECKS のときだけ true）なら、ci の省略・受け入れのタグ無しは警告にする。
 */
export function checkImportGate(info, { allowTestImports = false } = {}) {
  const errors = [];
  const warnings = [];
  const soft = (msg) => (allowTestImports ? warnings.push(`${msg}（試験のため警告だけ）`) : errors.push(msg));
  if (info.schema === 1) {
    warnings.push(`${BUILD_JSON} は schema 1（M7 までの取り込み）: ogCi / ogClean の記録がありません。次の取り込みで schema ${BUILD_SCHEMA} になります`);
    return { errors, warnings };
  }
  if (!OG_CI_VALUES.includes(info.ogCi)) errors.push(`${BUILD_JSON} の ogCi が不正です（ran / skipped）: ${info.ogCi}`);
  else if (info.ogCi === 'skipped') soft(`${BUILD_JSON} の ogCi が skipped です（OG の npm run ci を省いた取り込みは出せません。IMPORT_PAINT_SKIP_OG_CI なしで取り込み直す）`);
  if (info.ogClean !== true) errors.push(`${BUILD_JSON} の ogClean が true ではありません（OG の作業木が未追跡を含めて clean なときだけ取り込める）: ${info.ogClean}`);
  if (info.ogAccepted === null || info.ogAccepted === undefined) soft(`${BUILD_JSON} の ogAccepted がありません（取り込みの基点は受け入れのタグ m<n>-accepted だけ、ADR-0008 D10-1）`);
  else if (!ACCEPTED_TAG_RE.test(String(info.ogAccepted))) errors.push(`${BUILD_JSON} の ogAccepted が受け入れのタグの形ではありません: ${info.ogAccepted}`);
  if (typeof info.entryJsGzipBytes !== 'number') errors.push(`${BUILD_JSON} に entryJsGzipBytes がありません`);
  return { errors, warnings };
}

/**
 * 成果物を照合する。ディレクトリが無ければ { present: false, errors: [], warnings: [] }（S1 は成果物なしで出してよい）。
 * 戻り値の errors が空なら合格（warnings は記録だけ）。
 */
export function verifyPaintArtifact(dir, { allowTestImports = false } = {}) {
  const errors = [];
  const warnings = [];
  if (!existsSync(dir)) return { present: false, errors, warnings, info: null };
  const files = listFiles(dir);
  if (files.length === 0) return { present: false, errors, warnings, info: null };
  const info = readBuildInfo(dir);
  if (!info) {
    errors.push(`${BUILD_JSON} が無いか読めません`);
    return { present: true, errors, warnings, info: null };
  }
  if (!READABLE_SCHEMAS.includes(info.schema)) errors.push(`${BUILD_JSON} の schema が ${READABLE_SCHEMAS.join(' / ')} ではありません: ${info.schema}`);
  else {
    const gate = checkImportGate(info, { allowTestImports });
    errors.push(...gate.errors);
    warnings.push(...gate.warnings);
  }
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
        if (f === 'embed.html') {
          const csp = checkCspMeta(text, { ogContract: info.ogContract, ogAccepted: info.ogAccepted });
          errors.push(...csp.errors);
          warnings.push(...csp.warnings);
        }
      }
    }
  }
  return { present: true, errors, warnings, info };
}

/**
 * 埋め込みの初期 JS の増え方（ilust-sup-followup-04）。base = origin/main の BUILD.json（無ければ null）。
 * 戻り値は警告の文の配列（落とさない。OG の check-embed の予算 560 KB gz が門で、ここは事前に気づくための印）。
 * - 今の ogInitialJsGzipBytes が予算の 98 % を超えた
 * - origin/main の取り込みの値から +8 KB を超えて増えた（同じ値・減った・どちらかが記録なしなら何も言わない）
 */
export function checkInitialJsGrowth(current, base) {
  const warnings = [];
  const cur = current && Number.isInteger(current.ogInitialJsGzipBytes) ? current.ogInitialJsGzipBytes : null;
  if (cur === null) return warnings;
  const kb = (n) => (n / 1024).toFixed(1);
  const limit = OG_EMBED_INITIAL_BUDGET_BYTES * INITIAL_JS_BUDGET_WARN_RATIO;
  if (cur > limit) {
    warnings.push(
      `埋め込みの初期 JS が ${kb(cur)} KB gz で、OG の check-embed の予算 ${kb(OG_EMBED_INITIAL_BUDGET_BYTES)} KB の ${Math.round(INITIAL_JS_BUDGET_WARN_RATIO * 100)} % を超えています（余裕 ${kb(OG_EMBED_INITIAL_BUDGET_BYTES - cur)} KB。次の取り込みで OG の check:embed が落ちうる）`,
    );
  }
  const prev = base && Number.isInteger(base.ogInitialJsGzipBytes) ? base.ogInitialJsGzipBytes : null;
  if (prev !== null && cur - prev > INITIAL_JS_GROWTH_WARN_BYTES) {
    warnings.push(
      `埋め込みの初期 JS が origin/main の取り込み（OG ${String(base.ogCommit ?? '?').slice(0, 12)}）の ${kb(prev)} KB から ${kb(cur)} KB gz に +${kb(cur - prev)} KB 増えました（警告の閾値 +${kb(INITIAL_JS_GROWTH_WARN_BYTES)} KB）`,
    );
  }
  return warnings;
}

/** 試験の差し替え（tools/safe-push.sh の SAFE_PUSH_TEST_CHECKS）のときだけ、ci の省略・タグ無しの取り込みを警告にする */
export function testImportsAllowed() {
  return Boolean(env['SAFE_PUSH_TEST_CHECKS']);
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
    const bool = (v) => (v === 'true' ? true : v === 'false' ? false : v);
    const info = makeBuildInfo(dir, {
      ogCommit: args['og-commit'],
      ogContract: args['og-contract'],
      embedApi: args['embed-api'],
      ogCi: args['og-ci'],
      ogClean: bool(args['og-clean']),
      ogRef: args['og-ref'] || null,
      ogAccepted: args['og-accepted'] || null,
      ogInitialJsGzipBytes: args['og-initial-js-gz'] ? args['og-initial-js-gz'] : null,
      vite: args.vite ?? null,
    });
    writeFileSync(join(dir, BUILD_JSON), `${JSON.stringify(info, null, 2)}\n`);
    console.log(
      `BUILD.json: ${Object.keys(info.files).length} files, ${info.totalBytes} B, entry JS ${(info.entryJsGzipBytes / 1024).toFixed(1)} KB gz` +
        (info.ogInitialJsGzipBytes !== null ? `, OG initial JS ${(info.ogInitialJsGzipBytes / 1024).toFixed(1)} KB gz` : '') +
        `, ogCi ${info.ogCi}, ogClean ${info.ogClean}, ogAccepted ${info.ogAccepted ?? '-'}, buildId ${info.buildId}`,
    );
  } else if (cmd === 'verify' && dir) {
    const r = verifyPaintArtifact(dir, { allowTestImports: testImportsAllowed() });
    if (!r.present) console.log(`${dir}: 成果物なし（S1 はペイントなしで出せる）`);
    for (const w of r.warnings) console.warn(`  ! ${w}`);
    for (const e of r.errors) console.error(`  ✗ ${e}`);
    process.exit(r.errors.length ? 1 : 0);
  } else {
    console.error(
      'usage: paint-artifact.mjs write <dir> --og-commit=… --og-contract=… --embed-api=… --og-ci=ran|skipped --og-clean=true|false [--og-ref=… --og-accepted=… --og-initial-js-gz=…] | verify <dir>',
    );
    process.exit(2);
  }
}
