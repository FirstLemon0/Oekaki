// tools/safe-push.sh と tools/hooks/pre-push の試験（受け入れ ilust-safe-push、ADR-0007 D5）。
// 一時ディレクトリに bare の origin と作業用の clone を作り、本物の git で次がどれも拒否されることを確かめる:
//   (1) fast-forward でない push（safe-push も、手で打った force-push もフックが止める）
//   (2) zip を stage した / コミットした push
//   (3) 想定外の未追跡のファイルがある push
//   (4) 緑の確認（e2e など）が落ちた push
// あわせて、緑なら fast-forward で push されること、試験用の差し替えは origin が GitHub だと使えないことも確かめる。
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
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

describe('tools/hooks/pre-push', () => {
  it('ブランチの削除を拒む', () => {
    const { origin, work } = setup();
    spawnSync('bash', ['tools/safe-push.sh'], { cwd: work, env: { ...GIT_ENV, SAFE_PUSH_TEST_CHECKS: 'true' } }); // フックを入れる
    const del = spawnSync('git', ['push', 'origin', ':main'], { cwd: work, env: GIT_ENV, encoding: 'utf8' });
    expect(del.status).not.toBe(0);
    expect(git(origin, 'rev-parse', 'main')).toMatch(/^[0-9a-f]{40}$/);
  });
});
