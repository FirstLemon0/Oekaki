#!/usr/bin/env node
/**
 * public/paint/（埋め込みのペイントの成果物）の照合（ADR-0007 D5-3 の 1 つ。tools/safe-push.sh が push の前に回す）。
 * - public/paint/ が無ければ合格（S1 はペイントなしで出してよい）
 * - あれば BUILD.json の一覧・sha256・合計と実物が一致し、sw.js / manifest / .map / sandbox / bench / OG のソース / 製品名が無いこと
 * - dist/ があれば、ビルドの出力の dist/paint/ も同じく照合する（public からの写しが崩れていない）
 *
 *   node scripts/check-paint-artifact.mjs [--dir=public/paint]
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPaintArtifact } from './paint-artifact.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv.slice(2).find((a) => a.startsWith('--dir='));
const dirs = [arg ? arg.slice('--dir='.length) : join(ROOT, 'public', 'paint')];
if (!arg && existsSync(join(ROOT, 'dist'))) dirs.push(join(ROOT, 'dist', 'paint'));

let failed = false;
for (const dir of dirs) {
  const r = verifyPaintArtifact(dir);
  if (!r.present) {
    console.log(`check-paint-artifact: ${dir}: 成果物なし（合格。S1 はペイントなしで出せる）`);
    continue;
  }
  if (r.errors.length) {
    failed = true;
    console.error(`check-paint-artifact: ${dir}: 不合格 ${r.errors.length} 件`);
    for (const e of r.errors) console.error(`  ✗ ${e}`);
  } else {
    console.log(
      `check-paint-artifact: ${dir}: 合格（OG ${r.info.ogCommit}・契約 ${r.info.ogContract}・API v${r.info.embedApi}・${Object.keys(r.info.files).length} ファイル・${r.info.totalBytes} B）`,
    );
  }
}
process.exit(failed ? 1 : 0);
