#!/usr/bin/env node
/**
 * OG の作業木の node_modules が package-lock.json と一致するかを確かめる（OG ADR-0018 D6-1 (v)、cycle18 ilust-sup-followup-08、
 * 受け入れ ilust-import-deps-check）。tools/import-paint.sh が ogCi に依らず（ran でも recorded でも）build:embed の前に呼ぶ。
 *
 * 記録のある ci の使い回し（ogCi = recorded）では OG の `npm run ci` が 1 回も走らないので、埋め込みは前に入れた node_modules から作られる。
 * 依存を上げた M の後に記録を使い回すと、FinalCI（新しい作業木で `npm ci`）と違う依存で dist-embed を作り、ogClean: true のまま
 * 記録と成果物の出どころがずれる。ここで lock（`package-lock.json` の packages）と、npm が入れた中身の記録
 * （`node_modules/.package-lock.json` = hidden lockfile、npm 7 以降が install / ci のたびに書く）を比べる:
 *   - lock の optional でない（optional / devOptional の印が無い）項目は、node_modules に同じ道の項目があり、version が同じで、
 *     lock に integrity があれば integrity も同じ（無い = 入っていない・版が違う・中身の出どころが違う）
 *   - optional の項目（プラットフォームごとの部品など）は入っていなくてよい。入っていれば version / integrity を同じく比べる
 *   - node_modules にだけある項目（lock に無い = 余計な部品）も外れ
 *   - link（workspace）の項目は resolved を比べる
 * 外れれば呼び手が `npm ci` を回し、もう一度これで確かめる（それでも外れれば止める）。
 *
 *   node scripts/og-deps-check.mjs --og-dir=<OG> [--json]
 *     … exit 0 = 一致、1 = 外れ（理由つき）、2 = 引数の誤り・OG に package-lock.json が無い
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { argv, exit, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const isOptional = (e) => Boolean(e && (e.optional || e.devOptional));

/**
 * lock（package-lock.json の JSON）と入っている中身（node_modules/.package-lock.json の JSON か null）を比べる（純関数）。
 * 戻り値: { ok, problems: string[], checked: number }（problems は最大 maxProblems 件 + 「ほか n 件」）
 */
export function depsProblems(lock, installed, { maxProblems = 20 } = {}) {
  const problems = [];
  const lockPkgs = lock && typeof lock === 'object' && lock.packages && typeof lock.packages === 'object' ? lock.packages : null;
  if (!lockPkgs) return { ok: false, problems: ['package-lock.json に packages がありません（lockfileVersion 2 以上が要る）'], checked: 0 };
  const instPkgs = installed && typeof installed === 'object' && installed.packages && typeof installed.packages === 'object' ? installed.packages : null;
  if (!instPkgs) return { ok: false, problems: ['node_modules/.package-lock.json がありません（node_modules が無いか、npm 7 より前の install）'], checked: 0 };
  let checked = 0;
  for (const [path, want] of Object.entries(lockPkgs)) {
    if (path === '' || !want || typeof want !== 'object') continue;
    const have = instPkgs[path];
    if (!have) {
      if (!isOptional(want)) problems.push(`${path}: 入っていません（lock ${want.version ?? want.resolved ?? '?'}）`);
      continue;
    }
    checked++;
    if (want.link) {
      if (have.resolved !== want.resolved) problems.push(`${path}: link の先が違います（lock ${want.resolved} / 入っている ${have.resolved}）`);
      continue;
    }
    if (have.version !== want.version) problems.push(`${path}: 版が違います（lock ${want.version} / 入っている ${have.version ?? '?'}）`);
    else if (want.integrity && have.integrity !== want.integrity) problems.push(`${path}: integrity が違います（lock ${String(want.integrity).slice(0, 19)}… / 入っている ${String(have.integrity ?? 'なし').slice(0, 19)}…）`);
  }
  for (const path of Object.keys(instPkgs)) {
    if (path !== '' && !(path in lockPkgs)) problems.push(`${path}: lock に無い部品が入っています（${instPkgs[path]?.version ?? '?'}）`);
  }
  const shown = problems.slice(0, maxProblems);
  if (problems.length > maxProblems) shown.push(`ほか ${problems.length - maxProblems} 件`);
  return { ok: problems.length === 0, problems: shown, checked };
}

/** OG の作業木を読んで比べる。OG に package-lock.json が無ければ例外（呼び手は 2 で止める） */
export function checkOgDeps(ogDir) {
  const lockPath = join(ogDir, 'package-lock.json');
  if (!existsSync(lockPath)) throw new Error(`OG に package-lock.json がありません: ${lockPath}`);
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const hiddenPath = join(ogDir, 'node_modules', '.package-lock.json');
  let installed = null;
  if (existsSync(hiddenPath)) {
    try {
      installed = JSON.parse(readFileSync(hiddenPath, 'utf8'));
    } catch {
      installed = null;
    }
  }
  return depsProblems(lock, installed);
}

function main(args) {
  let ogDir = '';
  let json = false;
  for (const a of args) {
    if (a.startsWith('--og-dir=')) ogDir = a.slice('--og-dir='.length);
    else if (a === '--json') json = true;
    else {
      console.error(`og-deps-check: 知らない引数です: ${a}`);
      return 2;
    }
  }
  if (!ogDir) {
    console.error('og-deps-check: --og-dir=<OG> を指定してください');
    return 2;
  }
  let r;
  try {
    r = checkOgDeps(resolve(ogDir));
  } catch (e) {
    console.error(`og-deps-check: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  if (json) stdout.write(`${JSON.stringify(r)}\n`);
  else if (r.ok) console.log(`og-deps-check: node_modules は package-lock.json と一致（${r.checked} 件）`);
  else console.log(`og-deps-check: node_modules が package-lock.json と一致しません:\n  - ${r.problems.join('\n  - ')}`);
  return r.ok ? 0 : 1;
}

if (argv[1] && resolve(argv[1]) === fileURLToPath(import.meta.url)) exit(main(argv.slice(2)));
