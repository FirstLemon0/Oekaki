// tools/safe-push.sh と tools/hooks/pre-push の試験（受け入れ ilust-safe-push、ADR-0007 D5）。
// 一時ディレクトリに bare の origin と作業用の clone を作り、本物の git で次がどれも拒否されることを確かめる:
//   (1) fast-forward でない push（safe-push も、手で打った force-push もフックが止める）
//   (2) zip を stage した / コミットした push
//   (3) 想定外の未追跡のファイルがある push
//   (4) 緑の確認（e2e など）が落ちた push
// あわせて、緑なら fast-forward で push されること、試験用の差し替えは origin が GitHub だと使えないことも確かめる。
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ZIP_NAME = 'デザイン確認フォーム進行中.zip';
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
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_NOSYSTEM: '1',
  HOME: tmpdir(),
};

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** origin（bare）と clone を作り、safe-push とフックを clone の tools/ に置いて main を 1 コミット push しておく */
function setup() {
  const base = mkdtempSync(join(tmpdir(), 'safe-push-'));
  tmpDirs.push(base);
  const origin = join(base, 'origin.git');
  const work = join(base, 'work');
  execFileSync('git', ['init', '--bare', '-b', 'main', origin], { env: GIT_ENV, stdio: 'ignore' });
  execFileSync('git', ['clone', origin, work], { env: GIT_ENV, stdio: 'ignore' });
  git(work, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  mkdirSync(join(work, 'tools', 'hooks'), { recursive: true });
  copyFileSync(join(ROOT, 'tools', 'safe-push.sh'), join(work, 'tools', 'safe-push.sh'));
  copyFileSync(join(ROOT, 'tools', 'hooks', 'pre-push'), join(work, 'tools', 'hooks', 'pre-push'));
  chmodSync(join(work, 'tools', 'safe-push.sh'), 0o755);
  chmodSync(join(work, 'tools', 'hooks', 'pre-push'), 0o755);
  writeFileSync(join(work, 'README.md'), 'v1\n');
  git(work, 'add', 'README.md', 'tools/safe-push.sh', 'tools/hooks/pre-push');
  git(work, 'commit', '-m', 'init');
  git(work, 'push', 'origin', 'HEAD:main');
  return { base, origin, work };
}

function commitFile(work, name, body = 'x\n') {
  writeFileSync(join(work, name), body);
  git(work, 'add', name);
  git(work, 'commit', '-m', `add ${name}`);
}

function safePush(work, checks = 'true', extraEnv = {}) {
  const r = spawnSync('bash', ['tools/safe-push.sh'], {
    cwd: work,
    env: { ...GIT_ENV, SAFE_PUSH_TEST_CHECKS: checks, SEICHOTSU_DEPLOY_URL: '', ...extraEnv },
    encoding: 'utf8',
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

const originHead = (origin) => git(origin, 'rev-parse', 'main');

describe('tools/safe-push.sh', () => {
  it('緑なら fast-forward で origin main に push し、記録を残す（未追跡の zip 1 つは許す）', () => {
    const { origin, work } = setup();
    writeFileSync(join(work, ZIP_NAME), 'zip');
    commitFile(work, 'a.txt');
    const r = safePush(work);
    expect(r.out).toContain('push しました');
    expect(r.code).toBe(0);
    expect(originHead(origin)).toBe(git(work, 'rev-parse', 'HEAD'));
    expect(git(origin, 'ls-tree', '-r', '--name-only', 'main')).not.toContain('.zip');
    expect(git(work, 'rev-parse', '--git-path', 'hooks/pre-push')).toBeTruthy();
  });

  it('(1) fast-forward でない（origin が先に進んだ）と止め、手の force-push もフックが拒む', () => {
    const { base, origin, work } = setup();
    // 別の clone が先に push する
    const other = join(base, 'other');
    execFileSync('git', ['clone', origin, other], { env: GIT_ENV, stdio: 'ignore' });
    commitFile(other, 'theirs.txt');
    git(other, 'push', 'origin', 'HEAD:main');
    const theirs = originHead(origin);

    commitFile(work, 'mine.txt');
    const r = safePush(work);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/fast-forward でない/);
    expect(originHead(origin)).toBe(theirs);

    // safe-push がフックを入れた後なので、手で force-push してもフックが拒む
    const force = spawnSync('git', ['push', '--force', 'origin', 'HEAD:main'], { cwd: work, env: GIT_ENV, encoding: 'utf8' });
    expect(force.status).not.toBe(0);
    expect(force.stderr).toMatch(/pre-push: 拒否しました: fast-forward でない/);
    expect(originHead(origin)).toBe(theirs);
  });

  it('(2) zip を stage した・コミットした push は止める（フックも範囲の zip を拒む）', () => {
    const { origin, work } = setup();
    const before = originHead(origin);
    commitFile(work, 'a.txt');
    writeFileSync(join(work, ZIP_NAME), 'zip');
    git(work, 'add', ZIP_NAME);
    let r = safePush(work);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/stage された/);

    git(work, 'commit', '-m', 'oops zip');
    r = safePush(work);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/\.zip があります/);
    expect(originHead(origin)).toBe(before);

    const manual = spawnSync('git', ['push', 'origin', 'HEAD:main'], { cwd: work, env: GIT_ENV, encoding: 'utf8' });
    expect(manual.status).not.toBe(0);
    expect(manual.stderr).toMatch(/pre-push: 拒否しました: push する範囲に \.zip/);
    expect(originHead(origin)).toBe(before);
  });

  it('(3) 想定外の未追跡のファイル・未コミットの変更があると止める', () => {
    const { origin, work } = setup();
    const before = originHead(origin);
    commitFile(work, 'a.txt');
    writeFileSync(join(work, 'stray.png'), 'png');
    let r = safePush(work);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/想定外の未追跡.*stray\.png/);
    rmSync(join(work, 'stray.png'));
    writeFileSync(join(work, 'a.txt'), 'changed\n');
    r = safePush(work);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/未コミットの変更/);
    expect(originHead(origin)).toBe(before);
  });

  it('(4) 緑の確認（e2e など）が落ちたら push しない', () => {
    const { origin, work } = setup();
    const before = originHead(origin);
    commitFile(work, 'a.txt');
    const r = safePush(work, 'echo "e2e: 1 failed" >&2; exit 1');
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/緑の確認.*失敗/);
    expect(originHead(origin)).toBe(before);
  });

  it('main 以外のブランチ・push するコミットが無いときは止める', () => {
    const { work } = setup();
    let r = safePush(work);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/push するコミットがありません/);
    git(work, 'checkout', '-b', 'feature');
    commitFile(work, 'f.txt');
    r = safePush(work);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/main ではありません/);
  });

  it('試験用の差し替え（SAFE_PUSH_TEST_CHECKS）は origin が GitHub だと使えない（fetch より前に止める）', () => {
    const { work } = setup();
    git(work, 'remote', 'set-url', 'origin', 'https://github.com/example/never-used.git');
    commitFile(work, 'a.txt');
    const r = safePush(work, 'true');
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/ローカルのパスのときだけ/);
  });
});

/** 偽の OG のリポジトリ: A → B（B は A の子孫）と、A から分かれた C */
function makeOgRepo(base) {
  const og = join(base, 'OG-nanika');
  mkdirSync(og, { recursive: true });
  git(og, 'init', '-b', 'main');
  const c = (name) => {
    writeFileSync(join(og, 'f.txt'), `${name}\n`);
    git(og, 'add', 'f.txt');
    git(og, 'commit', '-m', name);
    return git(og, 'rev-parse', 'HEAD');
  };
  const A = c('A');
  const B = c('B');
  git(og, 'checkout', '-q', '-b', 'side', A);
  const C = c('C');
  git(og, 'checkout', '-q', 'main');
  return { og, A, B, C };
}

/** public/paint/BUILD.json だけを書いてコミットする（照合は手順 3 の check-paint-artifact の仕事。ここは手順 2b だけを見る） */
function commitPaint(work, info) {
  mkdirSync(join(work, 'public', 'paint'), { recursive: true });
  writeFileSync(
    join(work, 'public', 'paint', 'BUILD.json'),
    JSON.stringify({ schema: 2, ogCi: 'ran', ogClean: true, ogAccepted: 'm7-accepted', buildId: `${info.ogCommit.slice(0, 12)}-x`, ...info }),
  );
  git(work, 'add', 'public/paint/BUILD.json');
  git(work, 'commit', '-m', `paint ${info.ogCommit.slice(0, 7)}`);
}

describe('tools/safe-push.sh 手順 2b: 埋め込みのペイントの版（ilust-sup-followup-02）', () => {
  it('origin/main の ogCommit の子孫への取り込みは通り、記録に paint_gate が残る', () => {
    const { base, origin, work } = setup();
    const { og, A, B } = makeOgRepo(base);
    commitPaint(work, { ogCommit: A });
    git(work, 'push', 'origin', 'HEAD:main');
    commitPaint(work, { ogCommit: B });
    const r = safePush(work, 'true', { OG_DIR: og });
    expect(r.out).toContain('2b.');
    expect(r.code, r.out).toBe(0);
    expect(originHead(origin)).toBe(git(work, 'rev-parse', 'HEAD'));
    const log = readFileSync(git(work, 'rev-parse', '--path-format=absolute', '--git-path', 'safe-push.log'), 'utf8');
    expect(log).toMatch(new RegExp(`paint_gate=changed:${A.slice(0, 12)}->${B.slice(0, 12)}`));
  });

  it('版の後退（新しい ogCommit が origin/main の ogCommit の祖先）・枝違いは止める', () => {
    const { base, origin, work } = setup();
    const { og, A, B, C } = makeOgRepo(base);
    commitPaint(work, { ogCommit: B });
    git(work, 'push', 'origin', 'HEAD:main');
    const before = originHead(origin);
    commitPaint(work, { ogCommit: A });
    let r = safePush(work, 'true', { OG_DIR: og });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/埋め込みの版が後退しています/);
    git(work, 'reset', '-q', '--hard', 'HEAD~1');
    commitPaint(work, { ogCommit: C });
    r = safePush(work, 'true', { OG_DIR: og });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/子孫ではありません/);
    expect(originHead(origin)).toBe(before);
  });

  it('版が変わるのに OG のリポジトリが無い・コミットを知らないときは止める', () => {
    const { base, origin, work } = setup();
    const { og, A, B } = makeOgRepo(base);
    commitPaint(work, { ogCommit: A });
    git(work, 'push', 'origin', 'HEAD:main');
    const before = originHead(origin);
    commitPaint(work, { ogCommit: B });
    let r = safePush(work, 'true', { OG_DIR: join(base, 'no-such-og') });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/OG のリポジトリがありません/);
    git(work, 'reset', '-q', '--hard', 'HEAD~1');
    commitPaint(work, { ogCommit: 'f'.repeat(40) });
    r = safePush(work, 'true', { OG_DIR: og });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/HEAD の ogCommit ffffffffffff がありません/);
    expect(originHead(origin)).toBe(before);
  });

  it('変わった取り込みの ogClean が true でなければ止める（試験でも）。ogCi = skipped・タグ無しは試験のときだけ警告', () => {
    const { base, origin, work } = setup();
    const { og, A, B } = makeOgRepo(base);
    commitPaint(work, { ogCommit: A });
    git(work, 'push', 'origin', 'HEAD:main');
    const before = originHead(origin);
    commitPaint(work, { ogCommit: B, ogClean: false });
    let r = safePush(work, 'true', { OG_DIR: og });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/ogClean が true ではありません/);
    expect(originHead(origin)).toBe(before);

    git(work, 'reset', '-q', '--hard', 'HEAD~1');
    commitPaint(work, { ogCommit: B, ogCi: 'skipped', ogAccepted: null });
    r = safePush(work, 'true', { OG_DIR: og });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/試験のため警告だけ: 新しい埋め込みの取り込みの ogCi が ran ではありません/);
    expect(r.out).toMatch(/試験のため警告だけ: 新しい埋め込みの取り込みに受け入れのタグ/);
  });

  it('埋め込みの版が同じ（BUILD.json が変わらない）なら OG のリポジトリは要らない', () => {
    const { base, work } = setup();
    const { A } = makeOgRepo(base);
    commitPaint(work, { ogCommit: A });
    git(work, 'push', 'origin', 'HEAD:main');
    commitFile(work, 'b.txt');
    const r = safePush(work, 'true', { OG_DIR: join(base, 'no-such-og') });
    expect(r.code, r.out).toBe(0);
  });

  it('--dry-run は push せず、記録に DRY-RUN と paint_gate を残す', () => {
    const { base, origin, work } = setup();
    const { og, A, B } = makeOgRepo(base);
    commitPaint(work, { ogCommit: A });
    git(work, 'push', 'origin', 'HEAD:main');
    const before = originHead(origin);
    commitPaint(work, { ogCommit: B });
    const r = spawnSync('bash', ['tools/safe-push.sh', '--dry-run'], {
      cwd: work,
      env: { ...GIT_ENV, SAFE_PUSH_TEST_CHECKS: 'true', SEICHOTSU_DEPLOY_URL: '', OG_DIR: og },
      encoding: 'utf8',
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/--dry-run のため push しません/);
    expect(originHead(origin)).toBe(before);
    const log = readFileSync(git(work, 'rev-parse', '--path-format=absolute', '--git-path', 'safe-push.log'), 'utf8');
    expect(log).toMatch(/\tDRY-RUN\t.*paint_gate=changed:/);
  });
});

describe('tools/safe-push.sh の STOP の行の mode（ilust-sup-followup-04、ADR-0010 D6-4、受け入れ ilust-safe-push-mode）', () => {
  const logOf = (work) => readFileSync(git(work, 'rev-parse', '--path-format=absolute', '--git-path', 'safe-push.log'), 'utf8');
  const stopRows = (work) =>
    logOf(work)
      .split('\n')
      .filter((l) => l.split('\t')[1] === 'STOP')
      .map((l) => l.split('\t'));

  it('--dry-run で緑の確認が落ちると、画面と記録の STOP の行に mode=DRY-RUN と理由が出る（HEAD は 40 字）', () => {
    const { origin, work } = setup();
    const before = originHead(origin);
    commitFile(work, 'a.txt');
    const r = spawnSync('bash', ['tools/safe-push.sh', '--dry-run'], {
      cwd: work,
      env: { ...GIT_ENV, SAFE_PUSH_TEST_CHECKS: 'echo "e2e: 1 failed" >&2; exit 1', SEICHOTSU_DEPLOY_URL: '' },
      encoding: 'utf8',
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/止めました（mode=DRY-RUN）: 緑の確認（試験用）が失敗しました/);
    expect(originHead(origin)).toBe(before);
    const rows = stopRows(work);
    expect(rows).toHaveLength(1);
    const [at, kind, head, mode, reason] = rows[0];
    expect(at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(kind).toBe('STOP');
    expect(head).toBe(git(work, 'rev-parse', 'HEAD'));
    expect(mode).toBe('mode=DRY-RUN');
    expect(reason).toBe('reason=緑の確認（試験用）が失敗しました');
    expect(rows[0]).toHaveLength(5);
  });

  it('本番の実行（引数なし）で止めると mode=PUSH が出る', () => {
    const { origin, work } = setup();
    const before = originHead(origin);
    commitFile(work, 'a.txt');
    const r = safePush(work, 'exit 1');
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/止めました（mode=PUSH）/);
    expect(originHead(origin)).toBe(before);
    const rows = stopRows(work);
    expect(rows).toHaveLength(1);
    expect(rows[0][3]).toBe('mode=PUSH');
    expect(rows[0][4]).toMatch(/^reason=緑の確認/);
  });

  it('理由に複数のファイル名が並んでも 1 行・5 列のまま（列を崩さない）', () => {
    const { work } = setup();
    commitFile(work, 'a.txt');
    writeFileSync(join(work, 'stray-1.txt'), 'x');
    writeFileSync(join(work, 'stray-2.txt'), 'y');
    const r = safePush(work);
    expect(r.code).not.toBe(0);
    const lines = logOf(work).split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    const cols = lines[0].split('\t');
    expect(cols).toHaveLength(5);
    expect(cols[3]).toBe('mode=PUSH');
    expect(cols[4]).toMatch(/^reason=想定外の未追跡のファイルがあります: stray-1\.txt stray-2\.txt/);
  });

  it('OG の parseSafePushLog と同じ規則（TAB 区切り・3 列目が 40 字の sha・以降 key=value）で mode と reason が読める', () => {
    const { work } = setup();
    commitFile(work, 'a.txt');
    safePush(work, 'exit 1');
    const parsed = [];
    for (const line of logOf(work).split('\n')) {
      const cols = line.split('\t');
      if (cols.length < 3 || !/^[0-9a-f]{40}$/.test(cols[2] ?? '')) continue;
      const kv = {};
      for (const c of cols.slice(3)) {
        const i = c.indexOf('=');
        if (i > 0) kv[c.slice(0, i)] = c.slice(i + 1);
      }
      parsed.push({ kind: cols[1], head: cols[2], ...kv });
    }
    expect(parsed).toEqual([{ kind: 'STOP', head: git(work, 'rev-parse', 'HEAD'), mode: 'PUSH', reason: '緑の確認（試験用）が失敗しました' }]);
  });
});

describe('tools/safe-push.sh 手順 5 の待ち（ilust-sup-followup-09）', () => {
  it('壁時計で区切る（コメントと実装が 600 秒で一致し、30 回の固定の繰り返しが無い）', () => {
    const text = readFileSync(join(ROOT, 'tools', 'safe-push.sh'), 'utf8');
    expect(text).toMatch(/SAFE_PUSH_DEPLOY_WAIT_S:-600/);
    expect(text).not.toMatch(/seq 1 30/);
    expect(text).toMatch(/paint_deploy=/);
  });
});

describe('tools/hooks/pre-push', () => {
  it('ブランチの削除を拒む', () => {
    const { origin, work } = setup();
    spawnSync('bash', ['tools/safe-push.sh'], { cwd: work, env: { ...GIT_ENV, SAFE_PUSH_TEST_CHECKS: 'true' } }); // フックを入れる
    const del = spawnSync('git', ['push', 'origin', ':main'], { cwd: work, env: GIT_ENV, encoding: 'utf8' });
    expect(del.status).not.toBe(0);
    expect(git(origin, 'rev-parse', 'main')).toMatch(/^[0-9a-f]{40}$/);
  });
});
