#!/usr/bin/env node
/**
 * 記録のある OG の ci を取り込みに使い回す判定（ogCi = recorded、ilust-sup-followup-06 / ADR-0013 D6-4）。
 *
 * OG の封（Seal）は候補 C で `npm run ci` の全部を回し、その記録（scripts/pkg/ci-record.sh の og-ci-record/1 の JSON）の sha256 を
 * OG の docs/PROGRESS.md に書く。受け入れのタグ（証跡のコミット E）は C に docs を足しただけなので、取り込みのたびに E で
 * 1.5〜2 時間の全通しを回し直す代わりに、次を **全部** 満たすときだけ OG の `npm run ci` を省く（build:embed・check:embed は必ず回す）:
 *   1. 記録の commit が og_commit そのものか、og_commit の祖先で差が docs/ だけ（`git diff --name-only <rec> <og_commit> -- . ':!docs'` が空）
 *   2. `scripts/pkg/seal-check.sh --no-dist <rec> <og_commit>` が exit 0（共用の機械では --no-dist、ADR-0012 D4-2 R8）
 *   3. 記録が exit 0・clean（前後の porcelain が空）・e2e の retries 0（再試行 0 回）・失敗 0・`npm run ci`・HEAD が動いていない
 *   4. 記録のファイルの sha256 が、og_commit の docs/PROGRESS.md の「その記録の名前（か commit）と sha256 を同じ行に書いた行」と一致
 * どれか 1 つでも欠ければ ok = false（呼び手の import-paint.sh は従来どおり ci を回す = ogCi ran）。抜け道ではなく、関門は緩めない。
 *
 *   node scripts/og-ci-record.mjs check --og-dir=<OG> --og-commit=<sha> [--record=<path>|auto|none] [--json]
 *     … 判定して 1 行（--json なら JSON）。exit 0 = 使える、1 = 使えない（理由つき）、2 = 引数の誤り
 *   node scripts/og-ci-record.mjs verify-build --og-dir=<OG> --og-commit=<sha> --record-commit=<sha> --record-sha=<64 桁>
 *     … BUILD.json の ogCiCommit / ogCiRecord を OG の git だけで確かめ直す（safe-push の 2b。1・4 を見る。記録のファイルは要らない）
 *
 * --record=auto（既定）: og_commit の docs/PROGRESS.md に書かれた `<40 桁>-ci.json` と sha256 の組を拾い、記録のファイルを
 *   OG_CI_RECORD_DIR・<OG>/../OG-nanika-pkg/logs・<OG の主の作業木>/../OG-nanika-pkg/logs の順に探す（見つかったものだけを判定）。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { env } from 'node:process';
import { fileURLToPath } from 'node:url';

export const RECORD_SCHEMA_RE = /^og-ci-record\/\d+$/;
const SHA40 = /^[0-9a-f]{40}$/;
const SHA64 = /^[0-9a-f]{64}$/;

/**
 * og_commit の PROGRESS の本文から「記録の名前（<40 桁>-ci.json）と sha256 が同じ行にある」組を拾う。
 * 戻り値: [{ commit, name, sha256 }]（同じ組は 1 つに）
 */
export function progressRecordRows(progressText) {
  const out = [];
  const seen = new Set();
  for (const line of String(progressText ?? '').split('\n')) {
    const names = [...line.matchAll(/([0-9a-f]{40})-ci\.json/g)];
    const shas = [...line.matchAll(/sha256\s*`?([0-9a-f]{64})`?/g)];
    if (names.length === 0 || shas.length === 0) continue;
    // 記録の名前の直後の sha256 を組にする（ログの sha256 と取り違えない）
    for (const n of names) {
      const after = shas.find((s) => s.index > n.index) ?? null;
      if (!after) continue;
      const key = `${n[1]}:${after[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ commit: n[1], name: `${n[1]}-ci.json`, sha256: after[1] });
    }
  }
  return out;
}

/** 記録の中身の検査（3）。理由の配列（空 = 合格） */
export function recordContentProblems(record) {
  const p = [];
  if (!record || typeof record !== 'object') return ['記録が JSON のオブジェクトではありません'];
  if (!RECORD_SCHEMA_RE.test(String(record.schema ?? ''))) p.push(`記録の schema が og-ci-record/<n> ではありません: ${record.schema}`);
  if (!SHA40.test(String(record.commit ?? ''))) p.push(`記録の commit が 40 桁の sha ではありません: ${record.commit}`);
  if (record.command !== 'npm run ci') p.push(`記録のコマンドが npm run ci ではありません: ${record.command}`);
  if (record.exit !== 0) p.push(`記録の exit が 0 ではありません: ${record.exit}`);
  if (record.clean !== true) p.push(`記録が clean ではありません: ${record.clean}`);
  for (const k of ['porcelainBefore', 'porcelainAfter', 'untracked']) {
    if (Array.isArray(record[k]) && record[k].length > 0) p.push(`記録の ${k} が空ではありません（${record[k].length} 件）`);
  }
  if (record.headAfter !== undefined && record.headAfter !== record.commit) p.push(`記録の ci の間に HEAD が動きました: ${record.headAfter}`);
  if (record.ciEnv !== undefined && record.ciEnv !== 'unset') p.push(`記録の CI が付いていました（retries が緩む）: ${record.ciEnv}`);
  const e2e = record.e2e;
  if (!e2e || e2e.ran !== true) p.push('記録で e2e が回っていません');
  else {
    if (e2e.retries !== 0) p.push(`記録の e2e の retries が 0 ではありません: ${e2e.retries}`);
    if (e2e.retryAttempts !== 0) p.push(`記録の e2e に再試行があります: ${e2e.retryAttempts}`);
    for (const k of ['failed', 'flaky', 'interrupted', 'didNotRun']) {
      if (Number(e2e[k] ?? 0) !== 0) p.push(`記録の e2e の ${k} が 0 ではありません: ${e2e[k]}`);
    }
  }
  const vt = record.vitest;
  if (!vt || vt.ran !== true) p.push('記録で vitest が回っていません');
  else {
    for (const k of ['failed', 'filesFailed', 'errors']) {
      if (Number(vt[k] ?? 0) !== 0) p.push(`記録の vitest の ${k} が 0 ではありません: ${vt[k]}`);
    }
  }
  return p;
}

/**
 * 判定の本体（純関数。git や seal-check の結果は呼び手が渡す）。
 * facts: { ogCommit, record, recordSha, progressText, isAncestor, nonDocsDiff: string[] | null, sealExit: number | null }
 * 戻り値: { ok, reasons }
 */
export function evaluateRecord(facts) {
  const reasons = [];
  const { ogCommit, record, recordSha, progressText, isAncestor, nonDocsDiff, sealExit } = facts;
  if (!SHA40.test(String(ogCommit ?? ''))) reasons.push(`og_commit が 40 桁の sha ではありません: ${ogCommit}`);
  if (!SHA64.test(String(recordSha ?? ''))) reasons.push(`記録の sha256 が不正です: ${recordSha}`);
  reasons.push(...recordContentProblems(record));
  const rec = record && typeof record === 'object' ? String(record.commit ?? '') : '';
  // 1. 同じコミットか、祖先で差が docs/ だけ
  if (SHA40.test(rec) && rec !== ogCommit) {
    if (isAncestor !== true) reasons.push(`記録の commit ${rec.slice(0, 12)} が og_commit ${String(ogCommit).slice(0, 12)} の祖先ではありません`);
    if (!Array.isArray(nonDocsDiff)) reasons.push('記録の commit と og_commit の差（docs/ の外）を確かめられませんでした');
    else if (nonDocsDiff.length > 0) reasons.push(`記録の commit と og_commit の差に docs/ の外があります: ${nonDocsDiff.slice(0, 5).join(' ')}${nonDocsDiff.length > 5 ? ' …' : ''}`);
  }
  // 2. seal-check
  if (sealExit !== 0) reasons.push(`seal-check.sh --no-dist ${rec.slice(0, 12) || '?'} ${String(ogCommit).slice(0, 12)} が exit 0 ではありません（${sealExit ?? '回せない'}）`);
  // 4. PROGRESS の行と一致
  const rows = progressRecordRows(progressText);
  const row = rows.find((r) => r.commit === rec && r.sha256 === recordSha);
  if (!row) {
    const same = rows.filter((r) => r.commit === rec);
    reasons.push(
      same.length
        ? `記録の sha256 ${String(recordSha).slice(0, 12)}… が og_commit の docs/PROGRESS.md の行（${same.map((r) => r.sha256.slice(0, 12)).join(', ')}…）と一致しません`
        : `og_commit の docs/PROGRESS.md に記録 ${rec || '?'}-ci.json と sha256 の行がありません`,
    );
  }
  return { ok: reasons.length === 0, reasons };
}

function git(cwd, args, { allowFail = false } = {}) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    if (allowFail) return null;
    throw new Error(`git ${args.join(' ')}: ${(r.stderr ?? '').trim()}`);
  }
  return r.stdout;
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** 記録の commit と og_commit の git の事実（1 と 4 に要るもの） */
function gitFacts(ogDir, recCommit, ogCommit) {
  const progressText = git(ogDir, ['show', `${ogCommit}:docs/PROGRESS.md`], { allowFail: true }) ?? '';
  let isAncestor = recCommit === ogCommit;
  let nonDocsDiff = [];
  if (SHA40.test(recCommit) && recCommit !== ogCommit) {
    const hasRec = git(ogDir, ['cat-file', '-e', `${recCommit}^{commit}`], { allowFail: true }) !== null;
    if (!hasRec) return { progressText, isAncestor: false, nonDocsDiff: null };
    isAncestor = spawnSync('git', ['-C', ogDir, 'merge-base', '--is-ancestor', recCommit, ogCommit]).status === 0;
    const d = git(ogDir, ['diff', '--name-only', recCommit, ogCommit, '--', '.', ':!docs'], { allowFail: true });
    nonDocsDiff = d === null ? null : d.split('\n').filter(Boolean);
  }
  return { progressText, isAncestor, nonDocsDiff };
}

/** 記録のファイルを探す場所（--record=auto） */
export function recordSearchDirs(ogDir) {
  const dirs = [];
  if (env['OG_CI_RECORD_DIR']) dirs.push(resolve(env['OG_CI_RECORD_DIR']));
  dirs.push(resolve(ogDir, '..', 'OG-nanika-pkg', 'logs'));
  const common = git(ogDir, ['rev-parse', '--path-format=absolute', '--git-common-dir'], { allowFail: true });
  if (common) dirs.push(resolve(dirname(common.trim()), '..', 'OG-nanika-pkg', 'logs'));
  return [...new Set(dirs)];
}

function runSealCheck(ogDir, recCommit, ogCommit) {
  const script = join(ogDir, 'scripts', 'pkg', 'seal-check.sh');
  if (!existsSync(script)) return { exit: null, out: `${script} がありません` };
  const r = spawnSync('bash', [script, '--no-dist', '--repo', ogDir, recCommit, ogCommit], { encoding: 'utf8', timeout: 300_000 });
  return { exit: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

/** 1 つの記録のファイルを判定する */
export function checkRecordFile(ogDir, ogCommit, path, { sealCheck = runSealCheck } = {}) {
  let record = null;
  let recordSha = null;
  try {
    recordSha = sha256File(path);
    record = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return { ok: false, path, reasons: [`記録を読めません（${path}）: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const rec = String(record?.commit ?? '');
  const facts = SHA40.test(rec) ? gitFacts(ogDir, rec, ogCommit) : { progressText: '', isAncestor: false, nonDocsDiff: null };
  // seal-check は 1 が満たされたときだけ回す（祖先でない・docs の外の差がある記録に時間を使わない）
  const pre = evaluateRecord({ ogCommit, record, recordSha, ...facts, sealExit: 0 });
  let seal = { exit: null, out: '' };
  if (pre.ok) seal = sealCheck(ogDir, rec, ogCommit);
  const verdict = pre.ok ? evaluateRecord({ ogCommit, record, recordSha, ...facts, sealExit: seal.exit }) : pre;
  return { ok: verdict.ok, path, reasons: verdict.reasons, recordSha, recordCommit: rec, seal: seal.out.split('\n')[0] ?? '' };
}

/** --record=auto: PROGRESS の行から候補を作り、og_commit に近い順に最初の合格を返す */
export function checkAuto(ogDir, ogCommit, opts = {}) {
  const progressText = git(ogDir, ['show', `${ogCommit}:docs/PROGRESS.md`], { allowFail: true }) ?? '';
  const rows = progressRecordRows(progressText);
  if (rows.length === 0) return { ok: false, path: null, reasons: ['og_commit の docs/PROGRESS.md に ci の記録（<40 桁>-ci.json と sha256）の行がありません'] };
  const dirs = recordSearchDirs(ogDir);
  const distance = (c) => {
    if (c === ogCommit) return 0;
    const n = git(ogDir, ['rev-list', '--count', `${c}..${ogCommit}`], { allowFail: true });
    return n === null ? Number.POSITIVE_INFINITY : Number(n.trim());
  };
  const cands = rows.map((r) => ({ ...r, d: distance(r.commit) })).sort((a, b) => a.d - b.d);
  const tried = [];
  for (const c of cands) {
    const path = dirs.map((d) => join(d, c.name)).find((p) => existsSync(p));
    if (!path) {
      tried.push(`${c.name}: 記録のファイルが見つかりません（${dirs.join(' / ')}）`);
      continue;
    }
    const r = checkRecordFile(ogDir, ogCommit, path, opts);
    if (r.ok) return r;
    tried.push(`${basename(path)}: ${r.reasons.join(' / ')}`);
  }
  return { ok: false, path: null, reasons: tried };
}

/** safe-push の 2b: BUILD.json の ogCiCommit / ogCiRecord を OG の git だけで確かめ直す（1 と 4） */
export function verifyBuildRecord(ogDir, ogCommit, recCommit, recSha) {
  const reasons = [];
  if (!SHA40.test(String(recCommit ?? ''))) reasons.push(`ogCiCommit が 40 桁の sha ではありません: ${recCommit}`);
  if (!SHA64.test(String(recSha ?? ''))) reasons.push(`ogCiRecord が 64 桁の sha256 ではありません: ${recSha}`);
  if (reasons.length) return { ok: false, reasons };
  const f = gitFacts(ogDir, recCommit, ogCommit);
  if (recCommit !== ogCommit) {
    if (f.isAncestor !== true) reasons.push(`ogCiCommit ${recCommit.slice(0, 12)} が ogCommit ${ogCommit.slice(0, 12)} の祖先ではありません`);
    if (!Array.isArray(f.nonDocsDiff)) reasons.push('ogCiCommit と ogCommit の差を確かめられませんでした');
    else if (f.nonDocsDiff.length > 0) reasons.push(`ogCiCommit と ogCommit の差に docs/ の外があります: ${f.nonDocsDiff.slice(0, 5).join(' ')}`);
  }
  if (!progressRecordRows(f.progressText).some((r) => r.commit === recCommit && r.sha256 === recSha)) {
    reasons.push(`ogCommit の docs/PROGRESS.md に ${recCommit.slice(0, 12)}…-ci.json と sha256 ${recSha.slice(0, 12)}… の行がありません`);
  }
  return { ok: reasons.length === 0, reasons };
}

function parseArgs(argv) {
  const out = { _: [] };
  for (const a of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) out[m[1]] = m[2] ?? true;
    else out._.push(a);
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  const ogDir = typeof args['og-dir'] === 'string' ? resolve(args['og-dir']) : '';
  const ogCommit = String(args['og-commit'] ?? '');
  if (!ogDir || !SHA40.test(ogCommit) || (cmd !== 'check' && cmd !== 'verify-build')) {
    console.error('usage: og-ci-record.mjs check --og-dir=<OG> --og-commit=<40 桁> [--record=<path>|auto|none] [--json] | verify-build --og-dir=… --og-commit=… --record-commit=… --record-sha=…');
    process.exit(2);
  }
  if (cmd === 'verify-build') {
    const r = verifyBuildRecord(ogDir, ogCommit, String(args['record-commit'] ?? ''), String(args['record-sha'] ?? ''));
    if (!r.ok) for (const x of r.reasons) console.error(`og-ci-record: ${x}`);
    process.exit(r.ok ? 0 : 1);
  }
  const mode = typeof args.record === 'string' ? args.record : 'auto';
  let r;
  if (mode === 'none') r = { ok: false, path: null, reasons: ['--record=none（記録を使わない）'] };
  else if (mode === 'auto') r = checkAuto(ogDir, ogCommit);
  else r = checkRecordFile(ogDir, ogCommit, isAbsolute(mode) ? mode : resolve(mode));
  if (args.json) process.stdout.write(`${JSON.stringify(r)}\n`);
  else if (r.ok) console.log(`og-ci-record: 使える: ${r.path}（sha256 ${r.recordSha}、commit ${r.recordCommit}、${r.seal}）`);
  else for (const x of r.reasons) console.log(`og-ci-record: 使えない: ${x}`);
  process.exit(r.ok ? 0 : 1);
}
