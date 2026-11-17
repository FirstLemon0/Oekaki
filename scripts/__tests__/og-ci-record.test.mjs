// 記録のある OG の ci の使い回しの判定（scripts/og-ci-record.mjs、ilust-sup-followup-06 / ADR-0013 D6-4、受け入れ ilust-ci-record-reuse）。
// 純関数（PROGRESS の行の読み取り・記録の中身・全体の判定）と、一時ディレクトリの偽の OG（本物の git）での auto の探索と verify-build を確かめる。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  abbreviatedRecordRows,
  annotationSealC,
  annotationSealE,
  autoCandidates,
  checkAuto,
  checkRecordFile,
  evaluateRecord,
  matchRecordRow,
  progressRecordRows,
  recordContentProblems,
  tableRecordPairs,
  tagFacts,
  verifyBuildRecord,
} from '../og-ci-record.mjs';

const tmpDirs = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
  GIT_CONFIG_NOSYSTEM: '1',
  HOME: tmpdir(),
};
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (dir, rel, body) => {
  mkdirSync(join(dir, rel, '..'), { recursive: true });
  writeFileSync(join(dir, rel), body);
};
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

const C = 'c'.repeat(40);
const E = 'e'.repeat(40);

/** 封の C の ci の記録（og-ci-record/1 の形。ci-record.sh が書くもの） */
function goodRecord(commit = C, over = {}) {
  return {
    schema: 'og-ci-record/1',
    commit,
    command: 'npm run ci',
    ciEnv: 'unset',
    exit: 0,
    clean: true,
    porcelainBefore: [],
    porcelainAfter: [],
    untracked: [],
    headAfter: commit,
    vitest: { ran: true, passed: 10, failed: 0, skipped: 0, filesFailed: 0, errors: 0 },
    e2e: { ran: true, total: 5, passed: 5, failed: 0, skipped: 0, flaky: 0, didNotRun: 0, interrupted: 0, retryAttempts: 0, retries: 0 },
    ...over,
  };
}

const progressLine = (commit, sha) =>
  `  ci の記録 \`../OG-nanika-pkg/logs/${commit}-ci.json\`（sha256 \`${sha}\`）、ログ \`…-ci-20261104-142814.log\`（sha256 \`${'b'.repeat(64)}\`）= \`ci-green-final-c\`。`;

describe('og-ci-record: 純関数', () => {
  it('PROGRESS の行から「記録の名前と、その後ろの sha256」の組を拾う（ログの sha256 と取り違えない・同じ組は 1 つ）', () => {
    const sha = 'f'.repeat(64);
    const text = ['# PROGRESS', progressLine(C, sha), progressLine(C, sha), `記録 \`${C}-ci.json\` だけで sha の無い行`, `sha256 \`${'a'.repeat(64)}\` だけの行`].join('\n');
    expect(progressRecordRows(text)).toEqual([{ commit: C, name: `${C}-ci.json`, sha256: sha }]);
    expect(progressRecordRows('')).toEqual([]);
  });

  it('記録の中身: exit 0・clean・retries 0・失敗 0・npm run ci・CI 無し・HEAD 不動のすべてを求める', () => {
    expect(recordContentProblems(goodRecord())).toEqual([]);
    const bad = [
      [{ exit: 1 }, /exit/],
      [{ clean: false }, /clean/],
      [{ porcelainAfter: [' M src/a.ts'] }, /porcelainAfter/],
      [{ command: 'npm run ci:fast' }, /コマンド/],
      [{ ciEnv: '1' }, /CI が付いて/],
      [{ headAfter: E }, /HEAD が動き/],
      [{ schema: 'other/1' }, /schema/],
      [{ e2e: { ...goodRecord().e2e, retries: 1 } }, /retries/],
      [{ e2e: { ...goodRecord().e2e, retryAttempts: 2 } }, /再試行/],
      [{ e2e: { ...goodRecord().e2e, failed: 1 } }, /failed/],
      [{ e2e: { ...goodRecord().e2e, flaky: 1 } }, /flaky/],
      [{ e2e: { ran: false } }, /e2e が回って/],
      [{ vitest: { ran: true, failed: 0, filesFailed: 0, errors: 1 } }, /errors/],
    ];
    for (const [over, re] of bad) expect(recordContentProblems(goodRecord(C, over)).join('\n'), JSON.stringify(over)).toMatch(re);
  });

  it('全体の判定: 同じコミットか祖先で差が docs/ だけ・seal-check 0・PROGRESS の sha256 と一致のときだけ ok', () => {
    const sha = 'f'.repeat(64);
    const base = { ogCommit: E, record: goodRecord(), recordSha: sha, progressText: progressLine(C, sha), isAncestor: true, nonDocsDiff: [], sealExit: 0 };
    expect(evaluateRecord(base)).toEqual({ ok: true, reasons: [], rowSource: 'progress' });
    // 同じコミットなら祖先の判定は要らない
    expect(evaluateRecord({ ...base, ogCommit: C, isAncestor: false, nonDocsDiff: null }).ok).toBe(true);
    const cases = [
      [{ isAncestor: false }, /祖先ではありません/],
      [{ nonDocsDiff: ['src/app/main.ts'] }, /docs\/ の外があります: src\/app\/main\.ts/],
      [{ nonDocsDiff: null }, /確かめられませんでした/],
      [{ sealExit: 1 }, /seal-check/],
      [{ sealExit: null }, /回せない/],
      [{ recordSha: 'a'.repeat(64) }, /一致しません/],
      [{ progressText: '' }, /行がありません/],
      [{ record: goodRecord(C, { exit: 2 }) }, /exit/],
    ];
    for (const [over, re] of cases) {
      const r = evaluateRecord({ ...base, ...over });
      expect(r.ok, JSON.stringify(over)).toBe(false);
      expect(r.reasons.join('\n')).toMatch(re);
    }
  });
});

/** 偽の OG: C（src と seal-check.sh）→ E（docs だけ: PROGRESS に記録の行）→ X（src を変える）。記録は ../OG-nanika-pkg/logs に置く */
function makeOg({ sealExit = 0, recordOver = {}, progressSha = null } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'og-ci-record-'));
  tmpDirs.push(base);
  const og = join(base, 'OG-nanika');
  mkdirSync(og, { recursive: true });
  git(og, 'init', '-b', 'main');
  write(og, 'src/core/VERSION', '0.13.1\n');
  write(og, 'scripts/pkg/seal-check.sh', `#!/usr/bin/env bash\necho "sealed (fake) $*"\nexit ${sealExit}\n`);
  chmodSync(join(og, 'scripts/pkg/seal-check.sh'), 0o755);
  write(og, 'docs/PROGRESS.md', '# PROGRESS\n');
  git(og, 'add', '.');
  git(og, 'commit', '-m', 'C');
  const c = git(og, 'rev-parse', 'HEAD');
  const body = `${JSON.stringify(goodRecord(c, recordOver), null, 2)}\n`;
  const logs = join(base, 'OG-nanika-pkg', 'logs');
  write(logs, `${c}-ci.json`, body);
  const sha = sha256(body);
  write(og, 'docs/PROGRESS.md', `# PROGRESS\n${progressLine(c, progressSha ?? sha)}\n`);
  git(og, 'commit', '-am', 'E (docs)');
  const e = git(og, 'rev-parse', 'HEAD');
  write(og, 'src/core/VERSION', '0.13.2\n');
  write(og, 'docs/PROGRESS.md', `# PROGRESS\n${progressLine(c, progressSha ?? sha)}\n`);
  git(og, 'commit', '-am', 'X (src)');
  const x = git(og, 'rev-parse', 'HEAD');
  return { base, og, c, e, x, sha, recordPath: join(logs, `${c}-ci.json`) };
}

describe('og-ci-record: 偽の OG（本物の git）', () => {
  it('auto: E の PROGRESS の行から記録を見つけ、docs だけの差・seal-check 0・sha256 の一致で ok', () => {
    const { og, c, e, sha, recordPath } = makeOg();
    const r = checkAuto(og, e);
    expect(r.reasons).toEqual([]);
    expect(r).toMatchObject({ ok: true, path: recordPath, recordSha: sha, recordCommit: c });
    expect(r.seal).toMatch(/sealed \(fake\) --no-dist --repo .* [0-9a-f]{40} [0-9a-f]{40}/);
    // 明示のパスでも同じ
    expect(checkRecordFile(og, e, recordPath).ok).toBe(true);
  });

  it('記録の commit と og_commit の差に docs/ の外があれば使わない（seal-check も回さない）', () => {
    const { og, x } = makeOg();
    let sealed = 0;
    const r = checkAuto(og, x, {
      sealCheck: () => {
        sealed++;
        return { exit: 0, out: '' };
      },
    });
    expect(r.ok).toBe(false);
    expect(r.reasons.join('\n')).toMatch(/docs\/ の外があります: src\/core\/VERSION/);
    expect(sealed).toBe(0);
  });

  it('seal-check が 0 でない・記録の中身が悪い・PROGRESS の sha256 が違うなら使わない', () => {
    let o = makeOg({ sealExit: 1 });
    expect(checkAuto(o.og, o.e).reasons.join('\n')).toMatch(/seal-check.*exit 0 ではありません（1）/);
    o = makeOg({ recordOver: { e2e: { ...goodRecord().e2e, retries: 1 } } });
    expect(checkAuto(o.og, o.e).reasons.join('\n')).toMatch(/retries/);
    o = makeOg({ progressSha: 'a'.repeat(64) });
    expect(checkAuto(o.og, o.e).reasons.join('\n')).toMatch(/一致しません/);
  });

  it('記録のファイルが見つからない・PROGRESS に行が無いなら使わない（理由つき）', () => {
    const o = makeOg();
    rmSync(o.recordPath);
    expect(checkAuto(o.og, o.e).reasons.join('\n')).toMatch(/記録のファイルが見つかりません/);
    expect(checkAuto(o.og, o.c).reasons.join('\n')).toMatch(/PROGRESS\.md に ci の記録.*行がありません/);
  });

  it('verify-build（safe-push の 2b）: ogCiCommit / ogCiRecord を OG の git だけで確かめ直す', () => {
    const { og, c, e, x, sha } = makeOg();
    expect(verifyBuildRecord(og, e, c, sha)).toEqual({ ok: true, reasons: [], rowSource: 'progress' });
    expect(verifyBuildRecord(og, e, c, 'a'.repeat(64)).reasons.join('\n')).toMatch(/行がありません/);
    expect(verifyBuildRecord(og, x, c, sha).reasons.join('\n')).toMatch(/docs\/ の外があります/);
    expect(verifyBuildRecord(og, e, 'c'.repeat(12), sha).reasons.join('\n')).toMatch(/40 桁/);
    expect(verifyBuildRecord(og, c, e, sha).reasons.join('\n')).toMatch(/祖先ではありません/);
  });
});

// ---- ilust-sup-followup-01（OG ADR-0017 D6-1 (iii)、受け入れ ilust-ci-record-tag）----
// M16 の PROGRESS は C の記録の名前を `da36135f…-ci.json` と略して書いた。40 桁の行が無いときだけ、og_commit を指す注釈つきの受け入れのタグの本文
// （封が書く・後から変えない）を第 2 の出どころとして読み、略した名前は sha256 の一致 + 前置きで始まる commit が seal-facts の C のときだけ認める。

/** M16 の封の PROGRESS の形（略した名前、OG docs/PROGRESS.md:54 の写し） */
const abbrevLine = (commit, sha) =>
  `  13 段すべて 0。記録 \`../OG-nanika-pkg/logs/${commit.slice(0, 8)}…-ci.json\`（sha256 \`${sha}\`）を封が \`ci-record.py verify-final\` で照合 = ok`;
/** 封のタグの注釈（OG m16-accepted の形の写し。C / E と ci record の行） */
const annotation = ({ c, e, recLine = '' }) =>
  [
    'm99-accepted: M99 acceptance (seal-packaging, 2026-11-16)',
    '',
    `candidate C = ${c} (test(M99): acceptance specs)`,
    `evidence commit E = ${e} (docs only)`,
    recLine,
  ].join('\n');
const tagRecLine = (c, sha) =>
  `ci record (ADR-0012 D12-1): ${c}-ci.json sha256 ${sha} (commit ${c.slice(0, 8)}; exit 0; clean yes; log ${c}-ci-20261116-103406.log sha256 8c822579a0bcd498)`;

describe('og-ci-record: 受け入れのタグの注釈と略した名前（ilust-sup-followup-01）', () => {
  const sha = 'f'.repeat(64);
  const other = 'a'.repeat(64);

  it('略した名前の行を拾う（8 桁以上・… か ...・直後の sha256）。40 桁の名前・7 桁以下・sha256 の無い行は拾わない', () => {
    const text = [
      abbrevLine(C, sha),
      `記録 \`${C.slice(0, 12)}...-ci.json\`（sha256 \`${sha}\`）`,
      `記録 \`${C}-ci.json\`（sha256 \`${sha}\`）`,
      `記録 \`${C.slice(0, 7)}…-ci.json\`（sha256 \`${sha}\`）`,
      `記録 \`${C.slice(0, 8)}…-ci.json\` だけ`,
    ].join('\n');
    expect(abbreviatedRecordRows(text)).toEqual([
      { prefix: C.slice(0, 8), sha256: sha },
      { prefix: C.slice(0, 12), sha256: sha },
    ]);
  });

  it('注釈の C / E は seal-facts.sh と同じ規則で読む（candidate C = …、無ければ行頭の C = …）', () => {
    expect(annotationSealC(annotation({ c: C, e: E }))).toBe(C);
    expect(annotationSealE(annotation({ c: C, e: E }))).toBe(E);
    expect(annotationSealC('m1-accepted\n\nC: 1234567abc\n')).toBe('1234567abc');
    expect(annotationSealC('m1-accepted\n\nno candidate here')).toBeNull();
  });

  it('照合: 略した PROGRESS の行 = sha256 一致かつ前置きで始まる記録の commit が seal-facts の C → 合格', () => {
    expect(matchRecordRow({ rec: C, recordSha: sha, progressText: abbrevLine(C, sha), tagTexts: [], sealCs: [C] })).toEqual({
      ok: true,
      source: 'progress-abbrev',
      reason: '',
    });
    // 注釈の中の略した名前も同じ規則
    expect(matchRecordRow({ rec: C, recordSha: sha, progressText: '', tagTexts: [abbrevLine(C, sha)], sealCs: [C] }).source).toBe('tag-abbrev');
  });

  it('照合: タグの注釈だけに 40 桁の行 → 合格（PROGRESS に行が無いとき）', () => {
    const r = matchRecordRow({ rec: C, recordSha: sha, progressText: '# PROGRESS', tagTexts: [annotation({ c: C, e: E, recLine: tagRecLine(C, sha) })], sealCs: [C] });
    expect(r).toEqual({ ok: true, source: 'tag', reason: '' });
  });

  it('照合: 前置きの不一致（前置きで始まる commit が seal-facts の C でない）→ 拒否', () => {
    const r = matchRecordRow({ rec: C, recordSha: sha, progressText: abbrevLine(C, sha), tagTexts: [], sealCs: ['d'.repeat(40)] });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/seal-facts の C（dddddddddddd）と違います/);
    // C の注釈が無い（タグが無い）ときも拒否
    expect(matchRecordRow({ rec: C, recordSha: sha, progressText: abbrevLine(C, sha), tagTexts: [], sealCs: [] }).reason).toMatch(/受け入れのタグの注釈に無い/);
    // 略した名前の前置きが記録の commit と合わない
    const r2 = matchRecordRow({ rec: C, recordSha: sha, progressText: abbrevLine(E, sha), tagTexts: [], sealCs: [C] });
    expect(r2.ok).toBe(false);
    expect(r2.reason).toMatch(/前置きが合いません/);
  });

  it('照合: sha256 の不一致 → 拒否（略した名前・注釈の行のどちらも）', () => {
    const a = matchRecordRow({ rec: C, recordSha: other, progressText: abbrevLine(C, sha), tagTexts: [], sealCs: [C] });
    expect(a.ok).toBe(false);
    expect(a.reason).toMatch(/略した名前 c{8}…-ci\.json の行.*一致しません/);
    const t = matchRecordRow({ rec: C, recordSha: other, progressText: '', tagTexts: [annotation({ c: C, e: E, recLine: tagRecLine(C, sha) })], sealCs: [C] });
    expect(t.ok).toBe(false);
    expect(t.reason).toMatch(/タグの注釈の行.*一致しません/);
  });

  it('照合: PROGRESS に 40 桁の行があればそれだけで決める（sha256 が違えば注釈の一致する行に逃げない）', () => {
    const r = matchRecordRow({
      rec: C,
      recordSha: sha,
      progressText: progressLine(C, other),
      tagTexts: [annotation({ c: C, e: E, recLine: tagRecLine(C, sha) })],
      sealCs: [C],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/docs\/PROGRESS\.md の行.*一致しません/);
  });

  it('evaluateRecord の段 4 も同じ照合（tagTexts / sealCs を facts で受ける）', () => {
    const base = { ogCommit: E, record: goodRecord(), recordSha: sha, progressText: abbrevLine(C, sha), isAncestor: true, nonDocsDiff: [], sealExit: 0 };
    expect(evaluateRecord({ ...base, sealCs: [C] })).toEqual({ ok: true, reasons: [], rowSource: 'progress-abbrev' });
    expect(evaluateRecord(base).reasons.join('\n')).toMatch(/seal-facts の C/);
    expect(evaluateRecord({ ...base, sealCs: [C], recordSha: other }).reasons.join('\n')).toMatch(/一致しません/);
  });

  it('auto の候補: 略した名前は前置きで始まる seal-facts の C に広げ、広げられないものは理由つきで外す', () => {
    const { rows, skipped } = autoCandidates({ progressText: [abbrevLine(C, sha), abbrevLine(E, sha)].join('\n'), tagTexts: [tagRecLine(C, sha)], sealCs: [C] });
    expect(rows).toEqual([{ commit: C, name: `${C}-ci.json`, sha256: sha, source: 'tag' }]);
    expect(skipped.join('\n')).toMatch(/e{8}…-ci\.json: 前置きで始まる seal-facts の C がありません/);
  });
});

/**
 * 偽の OG（本物の git、M16 の形）: P → C（src と seal-check.sh）→ E（docs だけ。PROGRESS は progress(c, sha) の行）、E に注釈つきのタグ m99-accepted。
 * 記録は ../OG-nanika-pkg/logs/<C 40 桁>-ci.json。
 */
function makeSealedOg({ progress, tag, tagC = 'c', lightweight = false, tagE = null }) {
  const base = mkdtempSync(join(tmpdir(), 'og-ci-record-tag-'));
  tmpDirs.push(base);
  const og = join(base, 'OG-nanika');
  mkdirSync(og, { recursive: true });
  git(og, 'init', '-b', 'main');
  write(og, 'src/core/VERSION', '0.13.3\n');
  write(og, 'scripts/pkg/seal-check.sh', '#!/usr/bin/env bash\necho "sealed (fake) $*"\nexit 0\n');
  chmodSync(join(og, 'scripts/pkg/seal-check.sh'), 0o755);
  write(og, 'docs/PROGRESS.md', '# PROGRESS\n');
  git(og, 'add', '.');
  git(og, 'commit', '-m', 'P');
  const p = git(og, 'rev-parse', 'HEAD');
  write(og, 'src/core/VERSION', '0.13.4\n');
  git(og, 'commit', '-am', 'C');
  const c = git(og, 'rev-parse', 'HEAD');
  const body = `${JSON.stringify(goodRecord(c), null, 2)}\n`;
  const logs = join(base, 'OG-nanika-pkg', 'logs');
  write(logs, `${c}-ci.json`, body);
  const sha = sha256(body);
  write(og, 'docs/PROGRESS.md', `# PROGRESS\n${progress ? progress(c, sha) : ''}\n`);
  git(og, 'commit', '-am', 'E (docs)');
  const e = git(og, 'rev-parse', 'HEAD');
  if (tag) {
    const msg = annotation({ c: tagC === 'p' ? p : c, e: tagE ?? e, recLine: tag(c, sha) });
    write(base, 'tag-msg.txt', msg);
    if (lightweight) git(og, 'tag', 'm99-accepted', e);
    else git(og, 'tag', '-a', 'm99-accepted', '-F', join(base, 'tag-msg.txt'), e);
  }
  return { og, p, c, e, sha, recordPath: join(logs, `${c}-ci.json`) };
}

describe('og-ci-record: 偽の OG のタグの注釈（本物の git、ilust-sup-followup-01）', () => {
  it('略した PROGRESS の行 + 注釈の C: checkAuto・明示のパス・verify-build の 3 か所で recorded', () => {
    const o = makeSealedOg({ progress: abbrevLine, tag: () => '' });
    expect(tagFacts(o.og, o.e)).toEqual({ tagTexts: [expect.stringContaining(`candidate C = ${o.c}`)], sealCs: [o.c], tags: ['m99-accepted'] });
    const r = checkAuto(o.og, o.e);
    expect(r.reasons).toEqual([]);
    expect(r).toMatchObject({ ok: true, path: o.recordPath, recordSha: o.sha, recordCommit: o.c, rowSource: 'progress-abbrev' });
    expect(checkRecordFile(o.og, o.e, o.recordPath)).toMatchObject({ ok: true, rowSource: 'progress-abbrev' });
    expect(verifyBuildRecord(o.og, o.e, o.c, o.sha)).toEqual({ ok: true, reasons: [], rowSource: 'progress-abbrev' });
  });

  it('タグの注釈だけの行（PROGRESS に記録の行が無い）: 3 か所で recorded', () => {
    const o = makeSealedOg({ progress: null, tag: tagRecLine });
    expect(checkAuto(o.og, o.e)).toMatchObject({ ok: true, path: o.recordPath, rowSource: 'tag' });
    expect(checkRecordFile(o.og, o.e, o.recordPath)).toMatchObject({ ok: true, rowSource: 'tag' });
    expect(verifyBuildRecord(o.og, o.e, o.c, o.sha)).toEqual({ ok: true, reasons: [], rowSource: 'tag' });
  });

  it('前置きの不一致（注釈の C が記録の commit でない）: 3 か所で拒否', () => {
    const o = makeSealedOg({ progress: abbrevLine, tag: () => '', tagC: 'p' });
    expect(tagFacts(o.og, o.e).sealCs).toEqual([o.p]);
    const a = checkAuto(o.og, o.e);
    expect(a.ok).toBe(false);
    expect(a.reasons.join('\n')).toMatch(/前置きで始まる seal-facts の C がありません/);
    const f = checkRecordFile(o.og, o.e, o.recordPath);
    expect(f.ok).toBe(false);
    expect(f.reasons.join('\n')).toMatch(/seal-facts の C.*と違います/);
    const v = verifyBuildRecord(o.og, o.e, o.c, o.sha);
    expect(v.ok).toBe(false);
    expect(v.reasons.join('\n')).toMatch(/seal-facts の C.*と違います/);
  });

  it('sha256 の不一致（略した行・注釈の行）: 3 か所で拒否', () => {
    const bad = 'a'.repeat(64);
    for (const o of [
      makeSealedOg({ progress: (c) => abbrevLine(c, bad), tag: () => '' }),
      makeSealedOg({ progress: null, tag: (c) => tagRecLine(c, bad) }),
    ]) {
      const a = checkAuto(o.og, o.e);
      expect(a.ok).toBe(false);
      expect(a.reasons.join('\n')).toMatch(/一致しません/);
      expect(checkRecordFile(o.og, o.e, o.recordPath).reasons.join('\n')).toMatch(/一致しません/);
      expect(verifyBuildRecord(o.og, o.e, o.c, o.sha).reasons.join('\n')).toMatch(/一致しません/);
    }
  });

  it('軽いタグ・注釈の E が og_commit と違うタグは読まない（略した行は認めない）', () => {
    for (const o of [
      makeSealedOg({ progress: abbrevLine, tag: tagRecLine, lightweight: true }),
      makeSealedOg({ progress: abbrevLine, tag: tagRecLine, tagE: 'd'.repeat(40) }),
    ]) {
      expect(tagFacts(o.og, o.e).sealCs).toEqual([]);
      expect(checkAuto(o.og, o.e).ok).toBe(false);
      expect(verifyBuildRecord(o.og, o.e, o.c, o.sha).ok).toBe(false);
    }
  });
});

// 表の行（OG ADR-0018 D6-1 (iv)、cycle18 ilust-sup-followup-02）。下の 4 行は OG の M17 の証跡のコミット E（166b7276）の
// docs/PROGRESS.md:55-58 の写し（`git -C ../OG-nanika show 166b7276:docs/PROGRESS.md | sed -n 55,58p`、1 文字も変えない）。
const M17_C = '0f2d4e5c6d1d1b01f3943858f399400e380b970b';
const M17_RECORD_SHA = '2f8c58db30051c7584a515d7dfd57f42e093be3512debc63da07e225e603d238';
const M17_LOG_SHA = '1d82f63d18e9114ed5c9ce045c5110cb19339fea0286fc722de054e051283152';
const M17_E_PROGRESS_55_58 = [
  '  | 記録 | sha256 | 中身 |',
  '  |---|---|---|',
  '  | `../OG-nanika-pkg/logs/0f2d4e5c6d1d1b01f3943858f399400e380b970b-ci.json` | `2f8c58db30051c7584a515d7dfd57f42e093be3512debc63da07e225e603d238` | `ci-record.py verify-final --commit C` = ok（状態ファイルの runId = 記録、skippedTests 4 ⊆ `e2e/skip-registry.json`）= `ci-green-final-c-m17` |',
  '  | `../OG-nanika-pkg/logs/0f2d4e5c6d1d1b01f3943858f399400e380b970b-ci-20261117-165251.log` | `1d82f63d18e9114ed5c9ce045c5110cb19339fea0286fc722de054e051283152` | e2e の全 project 失敗 0（skip 4 = 撮影 1・`OG_TIMELAPSE_PERF` の [perf] の記録 1・Ilust の SW 2）= `regression-e2e-m1-m16` |',
].join('\n');

describe('og-ci-record: 表の行（ilust-sup-followup-02、OG ADR-0018 D6-1 (iv)）', () => {
  it('M17 の E の docs/PROGRESS.md:58 の写し: 記録の名前のセルの後ろの 64 桁のセルを組にする（ログの行・見出しの行は拾わない）', () => {
    expect(progressRecordRows(M17_E_PROGRESS_55_58)).toEqual([{ commit: M17_C, name: `${M17_C}-ci.json`, sha256: M17_RECORD_SHA }]);
    expect(progressRecordRows(M17_E_PROGRESS_55_58).some((r) => r.sha256 === M17_LOG_SHA)).toBe(false);
  });

  it('照合: 表の行だけで PROGRESS の第 1 の読み手が決める（source = progress、タグの注釈に頼らない）・sha256 が違えば拒む', () => {
    expect(matchRecordRow({ rec: M17_C, recordSha: M17_RECORD_SHA, progressText: M17_E_PROGRESS_55_58 })).toEqual({ ok: true, source: 'progress', reason: '' });
    const bad = matchRecordRow({ rec: M17_C, recordSha: 'e'.repeat(64), progressText: M17_E_PROGRESS_55_58, tagTexts: [tagRecLine(M17_C, 'e'.repeat(64))] });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toContain('docs/PROGRESS.md');
  });

  it('表のセルの読み方: 中身が 64 桁だけのセル（前後の空白とバッククォートは外す）。略した sha・後ろに文字の続くセル・表でない行・名前の前のセルは拾わない', () => {
    const sha = 'c'.repeat(64);
    expect(tableRecordPairs(`| ${C}-ci.json | ${sha} |`)).toEqual([{ commit: C, sha256: sha }]);
    expect(tableRecordPairs(`| \`${C}-ci.json\` | 中身 | \` ${sha} \` |`)).toEqual([{ commit: C, sha256: sha }]);
    expect(tableRecordPairs(`| \`${C}-ci.json\` | \`${sha.slice(0, 8)}…${sha.slice(-4)}\` |`)).toEqual([]);
    expect(tableRecordPairs(`| \`${C}-ci.json\` | \`${sha}\` の写し |`)).toEqual([]);
    expect(tableRecordPairs(`| \`${sha}\` | \`${C}-ci.json\` |`)).toEqual([]);
    expect(tableRecordPairs(`記録 \`${C}-ci.json\` \`${sha}\``)).toEqual([]);
    expect(tableRecordPairs(`| \`${C}-ci.json.bak\` | \`${sha}\` |`)).toEqual([]);
    // 文の行（sha256 の語あり）は今までどおり文の規則で読み、表の規則と二重にしない
    expect(progressRecordRows(`| 記録 \`${C}-ci.json\`（sha256 \`${sha}\`） | \`${'d'.repeat(64)}\` |`)).toEqual([{ commit: C, name: `${C}-ci.json`, sha256: sha }]);
  });
});
