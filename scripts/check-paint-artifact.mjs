#!/usr/bin/env node
/**
 * public/paint/（埋め込みのペイントの成果物）の照合（ADR-0007 D5-3 の 1 つ。tools/safe-push.sh が push の前に回す）。
 * - public/paint/ が無ければ合格（S1 はペイントなしで出してよい）
 * - あれば BUILD.json の一覧・sha256・合計と実物が一致し、sw.js / manifest / .map / sandbox / bench / OG のソース / 製品名が無いこと
 * - 取り込みの関門の記録（schema 2、ADR-0008 D10）: ogCi = skipped・ogClean ≠ true・受け入れのタグ（ogAccepted）無しは不合格
 *   （tools/safe-push.sh の試験 = SAFE_PUSH_TEST_CHECKS のときだけ ci の省略とタグ無しを警告にする）。schema 1（M7 までの取り込み）は警告
 * - embed.html の CSP の meta: あれば script-src 'self'・object-src 'none' を求める。無ければ移行の印として警告（契約 0.10.0 以降は不合格）
 *   （契約 0.10.0 以降か、受け入れのタグが m8 以降 = m8.1-accepted の取り込みは meta が必須。robustness-security-06）
 * - 埋め込みの初期 JS の増え方（ilust-sup-followup-04）: origin/main の public/paint/BUILD.json の ogInitialJsGzipBytes と比べ、
 *   +8 KB を超えたか、OG の check-embed の予算 560 KB の 98 % を超えたら警告（落とさない。origin/main が読めなければ何も言わない）
 * - dist/ があれば、ビルドの出力の dist/paint/ も同じく照合する（public からの写しが崩れていない）
 *
 *   node scripts/check-paint-artifact.mjs [--dir=public/paint] [--base-ref=origin/main]
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkInitialJsGrowth, testImportsAllowed, verifyPaintArtifact } from './paint-artifact.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv.slice(2).find((a) => a.startsWith('--dir='));
const baseRefArg = process.argv.slice(2).find((a) => a.startsWith('--base-ref='));
const baseRef = baseRefArg ? baseRefArg.slice('--base-ref='.length) : 'origin/main';
const dirs = [arg ? arg.slice('--dir='.length) : join(ROOT, 'public', 'paint')];
if (!arg && existsSync(join(ROOT, 'dist'))) dirs.push(join(ROOT, 'dist', 'paint'));

/** origin/main（--base-ref）の public/paint/BUILD.json（読めなければ null。fetch はしない = 手元の origin/main の記録） */
function readBaseBuild() {
  try {
    const text = execFileSync('git', ['show', `${baseRef}:public/paint/BUILD.json`], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(text);
  } catch {
    return null;
  }
}
const baseBuild = readBaseBuild();

let failed = false;
for (const dir of dirs) {
  const r = verifyPaintArtifact(dir, { allowTestImports: testImportsAllowed() });
  if (!r.present) {
    console.log(`check-paint-artifact: ${dir}: 成果物なし（合格。S1 はペイントなしで出せる）`);
    continue;
  }
  if (r.info) r.warnings.push(...checkInitialJsGrowth(r.info, baseBuild));
  for (const w of r.warnings) console.warn(`  ! ${w}`);
  if (r.errors.length) {
    failed = true;
    console.error(`check-paint-artifact: ${dir}: 不合格 ${r.errors.length} 件`);
    for (const e of r.errors) console.error(`  ✗ ${e}`);
  } else {
    const gate = r.info.schema >= 2 ? `・ci ${r.info.ogCi}・clean ${r.info.ogClean}・${r.info.ogAccepted ?? 'タグなし'}` : '・schema 1';
    console.log(
      `check-paint-artifact: ${dir}: 合格（OG ${r.info.ogCommit}・契約 ${r.info.ogContract}・API v${r.info.embedApi}${gate}・${Object.keys(r.info.files).length} ファイル・${r.info.totalBytes} B` +
        `${r.warnings.length ? `・警告 ${r.warnings.length}` : ''}）`,
    );
  }
}
process.exit(failed ? 1 : 0);
