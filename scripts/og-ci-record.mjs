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
 *   4. 記録のファイルの sha256 が、og_commit の docs/PROGRESS.md の「その記録の名前（か commit）と sha256 を同じ行に書いた行」と一致。
 *      PROGRESS に記録の commit の 40 桁の行が無いときだけ、第 2 の出どころ（OG ADR-0017 D6-1 (iii)、ilust-sup-followup-01）を読む:
 *      og_commit を指す注釈つきの受け入れのタグ（`git for-each-ref --points-at <og_commit> refs/tags/*-accepted`）の本文の 40 桁の行。
 *      略した名前（`<8 桁以上>…-ci.json`、M16 の PROGRESS の形）は、sha256 が一致し、かつその前置きで始まる記録の commit（40 桁）が
 *      seal-facts の C（タグの注釈の「candidate C = <sha>」を seal-facts.sh の 3. と同じ規則で読み、og_commit の祖先か同じ）と同じときだけ認める。
 * どれか 1 つでも欠ければ ok = false（呼び手の import-paint.sh は従来どおり ci を回す = ogCi ran）。抜け道ではなく、関門は緩めない。
 *
 *   node scripts/og-ci-record.mjs check --og-dir=<OG> --og-commit=<sha> [--record=<path>|auto|none] [--json]
 *     … 判定して 1 行（--json なら JSON）。exit 0 = 使える、1 = 使えない（理由つき）、2 = 引数の誤り
 *   node scripts/og-ci-record.mjs verify-build --og-dir=<OG> --og-commit=<sha> --record-commit=<sha> --record-sha=<64 桁>
 *     … BUILD.json の ogCiCommit / ogCiRecord を OG の git だけで確かめ直す（safe-push の 2b。1・4 を見る。記録のファイルは要らない）
 *
 * --record=auto（既定）: og_commit の docs/PROGRESS.md（と上の第 2 の出どころ）に書かれた `<40 桁>-ci.json` と sha256 の組を拾い、記録のファイルを
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

/**
 * 略した記録の名前（`<8〜39 桁>…-ci.json` / `<…>...-ci.json`）と、その直後の sha256 の組を拾う（M16 の PROGRESS の形、ilust-sup-followup-01）。
 * 戻り値: [{ prefix, sha256 }]。40 桁の名前は progressRecordRows が拾うのでここでは拾わない。
 */
export function abbreviatedRecordRows(text) {
  const out = [];
  const seen = new Set();
  for (const line of String(text ?? '').split('\n')) {
    const names = [...line.matchAll(/(?<![0-9a-f])([0-9a-f]{8,39})(?:…|\.\.\.)-ci\.json/g)];
    const shas = [...line.matchAll(/sha256\s*`?([0-9a-f]{64})`?/g)];
    if (names.length === 0 || shas.length === 0) continue;
    for (const n of names) {
      const after = shas.find((x) => x.index > n.index) ?? null;
      if (!after) continue;
      const key = `${n[1]}:${after[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ prefix: n[1], sha256: after[1] });
    }
  }
  return out;
}

/**
 * 受け入れのタグの注釈から、seal-facts.sh の「3. C」と同じ規則で C を読む（OG scripts/pkg/seal-facts.sh の
 * `candidate C\s*[=:]\s*([0-9a-f]{7,40})`、無ければ行頭の `C = <sha>` の写し）。戻り値は注釈に書かれた sha（7〜40 桁）か null。
 */
export function annotationSealC(annotation) {
  const t = String(annotation ?? '');
  const m = /candidate C\s*[=:]\s*([0-9a-f]{7,40})/.exec(t) ?? /^\s*C\s*[=:]\s*([0-9a-f]{7,40})/m.exec(t);
  return m ? m[1] : null;
}

/** 注釈の「evidence commit E = <sha>」（seal-facts.sh の 1. の写し）。無ければ null */
export function annotationSealE(annotation) {
  const m = /evidence commit E\s*[=:]\s*([0-9a-f]{7,40})/.exec(String(annotation ?? ''));
  return m ? m[1] : null;
}

/**
 * 判定 4 の行の照合（純関数）。facts: { rec, recordSha, progressText, tagTexts?: string[], sealCs?: string[] }
 * 1. og_commit の PROGRESS に rec の 40 桁の行があれば、それだけで決める（sha256 が違えば拒む。第 2 の出どころは読まない）
 * 2. 無ければ受け入れのタグの注釈の 40 桁の行（同じく sha256 の一致）
 * 3. それも無ければ略した名前（PROGRESS・注釈）: 前置きで rec が始まり、rec が seal-facts の C（sealCs）で、sha256 が一致するときだけ
 * 戻り値: { ok, source, reason }（source = progress | tag | progress-abbrev | tag-abbrev）
 */
export function matchRecordRow({ rec, recordSha, progressText, tagTexts = [], sealCs = [] }) {
  const short = (x) => String(x ?? '').slice(0, 12);
  const progRows = progressRecordRows(progressText).filter((r) => r.commit === rec);
  if (progRows.length) {
    if (progRows.some((r) => r.sha256 === recordSha)) return { ok: true, source: 'progress', reason: '' };
    return {
      ok: false,
      source: null,
      reason: `記録の sha256 ${short(recordSha)}… が og_commit の docs/PROGRESS.md の行（${progRows.map((r) => r.sha256.slice(0, 12)).join(', ')}…）と一致しません`,
    };
  }
  const tagRows = tagTexts.flatMap((t) => progressRecordRows(t)).filter((r) => r.commit === rec);
  if (tagRows.length) {
    if (tagRows.some((r) => r.sha256 === recordSha)) return { ok: true, source: 'tag', reason: '' };
    return {
      ok: false,
      source: null,
      reason: `記録の sha256 ${short(recordSha)}… が og_commit の受け入れのタグの注釈の行（${tagRows.map((r) => r.sha256.slice(0, 12)).join(', ')}…）と一致しません`,
    };
  }
  const abbrev = [
    ...abbreviatedRecordRows(progressText).map((r) => ({ ...r, source: 'progress-abbrev' })),
    ...tagTexts.flatMap((t) => abbreviatedRecordRows(t).map((r) => ({ ...r, source: 'tag-abbrev' }))),
  ];
  const mine = abbrev.filter((r) => SHA40.test(String(rec ?? '')) && rec.startsWith(r.prefix));
  if (mine.length) {
    if (!sealCs.includes(rec)) {
      return {
        ok: false,
        source: null,
        reason: `略した記録の名前 ${mine[0].prefix}…-ci.json の前置きで始まる記録の commit ${short(rec)} が seal-facts の C（${sealCs.length ? sealCs.map(short).join(', ') : 'og_commit を指す受け入れのタグの注釈に無い'}）と違います`,
      };
    }
    const hit = mine.find((r) => r.sha256 === recordSha);
    if (hit) return { ok: true, source: hit.source, reason: '' };
    return {
      ok: false,
      source: null,
      reason: `記録の sha256 ${short(recordSha)}… が略した名前 ${mine[0].prefix}…-ci.json の行（${mine.map((r) => r.sha256.slice(0, 12)).join(', ')}…）と一致しません`,
    };
  }
  if (abbrev.length) {
    return {
      ok: false,
      source: null,
      reason: `og_commit の docs/PROGRESS.md / 受け入れのタグの注釈に記録 ${rec || '?'}-ci.json の行がありません（略した名前 ${[...new Set(abbrev.map((r) => `${r.prefix}…`))].join(', ')} は前置きが合いません）`,
    };
  }
  return { ok: false, source: null, reason: `og_commit の docs/PROGRESS.md（と受け入れのタグの注釈）に記録 ${rec || '?'}-ci.json と sha256 の行がありません` };
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
 * facts: { ogCommit, record, recordSha, progressText, tagTexts?: string[], sealCs?: string[], isAncestor, nonDocsDiff: string[] | null, sealExit: number | null }
 *   tagTexts = og_commit を指す受け入れのタグの注釈の本文、sealCs = その注釈から seal-facts の規則で読んだ C（40 桁、og_commit の祖先か同じ）
 * 戻り値: { ok, reasons, rowSource }
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
  // 4. PROGRESS の行と一致（無ければ受け入れのタグの注釈・略した名前 + seal-facts の C、ilust-sup-followup-01）
  const m = matchRecordRow({ rec, recordSha, progressText, tagTexts: facts.tagTexts ?? [], sealCs: facts.sealCs ?? [] });
  if (!m.ok) reasons.push(m.reason);
  return { ok: reasons.length === 0, reasons, rowSource: m.source };
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

/**
 * og_commit を指す注釈つきの受け入れのタグ（refs/tags/*-accepted）の本文と、seal-facts の規則で読んだ C（判定 4 の第 2 の出どころ）。
 * 注釈の「evidence commit E = <sha>」があれば og_commit と合うタグだけを使う。C は OG にコミットがあり og_commit の祖先か同じものだけ（seal-facts の 3.）。
 * 戻り値: { tagTexts: string[], sealCs: string[], tags: string[] }
 */
export function tagFacts(ogDir, ogCommit) {
  const out = { tagTexts: [], sealCs: [], tags: [] };
  if (!SHA40.test(String(ogCommit ?? ''))) return out;
  const list = git(ogDir, ['for-each-ref', '--points-at', ogCommit, '--format=%(objecttype) %(refname)', 'refs/tags/*-accepted'], { allowFail: true }) ?? '';
  for (const line of list.split('\n').filter(Boolean)) {
    const [type, ref] = line.split(' ');
    if (type !== 'tag' || !ref) continue; // 軽いタグは封の注釈を持たない
    const raw = git(ogDir, ['cat-file', 'tag', ref], { allowFail: true });
    if (raw === null) continue;
    const i = raw.indexOf('\n\n');
    const text = i >= 0 ? raw.slice(i + 2) : '';
    const e = annotationSealE(text);
    if (e && !ogCommit.startsWith(e)) continue;
    out.tags.push(ref.replace(/^refs\/tags\//, ''));
    out.tagTexts.push(text);
    const c = annotationSealC(text);
    if (!c) continue;
    const full = (git(ogDir, ['rev-parse', '--verify', '--quiet', `${c}^{commit}`], { allowFail: true }) ?? '').trim();
    if (!SHA40.test(full)) continue;
    const anc = full === ogCommit || spawnSync('git', ['-C', ogDir, 'merge-base', '--is-ancestor', full, ogCommit]).status === 0;
    if (anc && !out.sealCs.includes(full)) out.sealCs.push(full);
  }
  return out;
}

/** 記録の commit と og_commit の git の事実（1 と 4 に要るもの） */
function gitFacts(ogDir, recCommit, ogCommit) {
  const progressText = git(ogDir, ['show', `${ogCommit}:docs/PROGRESS.md`], { allowFail: true }) ?? '';
  const { tagTexts, sealCs } = tagFacts(ogDir, ogCommit);
  let isAncestor = recCommit === ogCommit;
  let nonDocsDiff = [];
  if (SHA40.test(recCommit) && recCommit !== ogCommit) {
    const hasRec = git(ogDir, ['cat-file', '-e', `${recCommit}^{commit}`], { allowFail: true }) !== null;
    if (!hasRec) return { progressText, tagTexts, sealCs, isAncestor: false, nonDocsDiff: null };
    isAncestor = spawnSync('git', ['-C', ogDir, 'merge-base', '--is-ancestor', recCommit, ogCommit]).status === 0;
    const d = git(ogDir, ['diff', '--name-only', recCommit, ogCommit, '--', '.', ':!docs'], { allowFail: true });
    nonDocsDiff = d === null ? null : d.split('\n').filter(Boolean);
  }
  return { progressText, tagTexts, sealCs, isAncestor, nonDocsDiff };
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
  const facts = SHA40.test(rec) ? gitFacts(ogDir, rec, ogCommit) : { progressText: '', tagTexts: [], sealCs: [], isAncestor: false, nonDocsDiff: null };
  // seal-check は 1 が満たされたときだけ回す（祖先でない・docs の外の差がある記録に時間を使わない）
  const pre = evaluateRecord({ ogCommit, record, recordSha, ...facts, sealExit: 0 });
  let seal = { exit: null, out: '' };
  if (pre.ok) seal = sealCheck(ogDir, rec, ogCommit);
  const verdict = pre.ok ? evaluateRecord({ ogCommit, record, recordSha, ...facts, sealExit: seal.exit }) : pre;
  return { ok: verdict.ok, path, reasons: verdict.reasons, recordSha, recordCommit: rec, rowSource: verdict.rowSource ?? null, seal: seal.out.split('\n')[0] ?? '' };
}

/**
 * --record=auto の候補（純関数）: PROGRESS の 40 桁の行、受け入れのタグの注釈の 40 桁の行、略した名前の行（前置きで始まる seal-facts の C に
 * 広げたものだけ。広げられない行は skipped に理由）。戻り値: { rows: [{ commit, name, sha256, source }], skipped: string[] }
 */
export function autoCandidates({ progressText, tagTexts = [], sealCs = [] }) {
  const rows = [];
  const seen = new Set();
  const add = (commit, sha256, source) => {
    const key = `${commit}:${sha256}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ commit, name: `${commit}-ci.json`, sha256, source });
  };
  for (const r of progressRecordRows(progressText)) add(r.commit, r.sha256, 'progress');
  for (const t of tagTexts) for (const r of progressRecordRows(t)) add(r.commit, r.sha256, 'tag');
  const skipped = [];
  const abbrev = [
    ...abbreviatedRecordRows(progressText).map((r) => ({ ...r, source: 'progress-abbrev' })),
    ...tagTexts.flatMap((t) => abbreviatedRecordRows(t).map((r) => ({ ...r, source: 'tag-abbrev' }))),
  ];
  for (const r of abbrev) {
    const cs = sealCs.filter((c) => c.startsWith(r.prefix));
    if (cs.length === 0) skipped.push(`${r.prefix}…-ci.json: 前置きで始まる seal-facts の C がありません（${sealCs.length ? sealCs.map((c) => c.slice(0, 12)).join(', ') : 'og_commit を指す受け入れのタグの注釈に C が無い'}）`);
    for (const c of cs) add(c, r.sha256, r.source);
  }
  return { rows, skipped };
}

/** --record=auto: PROGRESS の行（と受け入れのタグの注釈・略した名前）から候補を作り、og_commit に近い順に最初の合格を返す */
export function checkAuto(ogDir, ogCommit, opts = {}) {
  const progressText = git(ogDir, ['show', `${ogCommit}:docs/PROGRESS.md`], { allowFail: true }) ?? '';
  const { tagTexts, sealCs } = tagFacts(ogDir, ogCommit);
  const { rows, skipped } = autoCandidates({ progressText, tagTexts, sealCs });
  if (rows.length === 0) {
    return {
      ok: false,
      path: null,
      reasons: ['og_commit の docs/PROGRESS.md に ci の記録（<40 桁>-ci.json と sha256）の行がありません（受け入れのタグの注釈・略した名前 + seal-facts の C にもありません）', ...skipped],
    };
  }
  const dirs = recordSearchDirs(ogDir);
  const distance = (c) => {
    if (c === ogCommit) return 0;
    const n = git(ogDir, ['rev-list', '--count', `${c}..${ogCommit}`], { allowFail: true });
    return n === null ? Number.POSITIVE_INFINITY : Number(n.trim());
  };
  const cands = rows.map((r) => ({ ...r, d: distance(r.commit) })).sort((a, b) => a.d - b.d);
  const tried = [...skipped];
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
  // 判定 4 と同じ照合（PROGRESS の 40 桁の行、無ければ受け入れのタグの注釈・略した名前 + seal-facts の C、ilust-sup-followup-01）
  const m = matchRecordRow({ rec: recCommit, recordSha: recSha, progressText: f.progressText, tagTexts: f.tagTexts ?? [], sealCs: f.sealCs ?? [] });
  if (!m.ok) reasons.push(`ogCommit の docs/PROGRESS.md（と受け入れのタグの注釈）に ${recCommit.slice(0, 12)}…-ci.json と sha256 ${recSha.slice(0, 12)}… の行がありません: ${m.reason}`);
  return { ok: reasons.length === 0, reasons, rowSource: m.source };
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
  else if (r.ok) console.log(`og-ci-record: 使える: ${r.path}（sha256 ${r.recordSha}、commit ${r.recordCommit}、行の出どころ ${r.rowSource}、${r.seal}）`);
  else for (const x of r.reasons) console.log(`og-ci-record: 使えない: ${x}`);
  process.exit(r.ok ? 0 : 1);
}
