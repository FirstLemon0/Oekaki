// 記録のある OG の ci の使い回しの判定（scripts/og-ci-record.mjs、ilust-sup-followup-06 / ADR-0013 D6-4、受け入れ ilust-ci-record-reuse）。
// 純関数（PROGRESS の行の読み取り・記録の中身・全体の判定）と、一時ディレクトリの偽の OG（本物の git）での auto の探索と verify-build を確かめる。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkAuto, checkRecordFile, evaluateRecord, progressRecordRows, recordContentProblems, verifyBuildRecord } from '../og-ci-record.mjs';

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
    expect(evaluateRecord(base)).toEqual({ ok: true, reasons: [] });
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
    expect(verifyBuildRecord(og, e, c, sha)).toEqual({ ok: true, reasons: [] });
    expect(verifyBuildRecord(og, e, c, 'a'.repeat(64)).reasons.join('\n')).toMatch(/行がありません/);
    expect(verifyBuildRecord(og, x, c, sha).reasons.join('\n')).toMatch(/docs\/ の外があります/);
    expect(verifyBuildRecord(og, e, 'c'.repeat(12), sha).reasons.join('\n')).toMatch(/40 桁/);
    expect(verifyBuildRecord(og, c, e, sha).reasons.join('\n')).toMatch(/祖先ではありません/);
  });
});
