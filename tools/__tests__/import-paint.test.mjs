// tools/import-paint.sh の試験（取り込みの関門、ilust-sup-followup-02 / ADR-0008 D10）。
// 一時ディレクトリに「偽の OG」（npm の ci / build:embed / check:embed が小さい node のコマンド）と「偽の Ilust」（取り込みの道具だけ）を作り、
// 本物の git と bash で次を確かめる:
//   - 受け入れのタグ（m<n>-accepted）の指すコミットを clean な作業木から取り込むと、BUILD.json が schema 2（ogCi = ran・ogClean = true・
//     ogRef・ogAccepted・ogInitialJsGzipBytes）で、check-paint-artifact が合格する
//   - OG の作業木に未追跡のファイルがあると取り込まない（--untracked-files=no だった穴）
//   - ci / build:embed が作業木を汚したら取り込まない
//   - IMPORT_PAINT_SKIP_OG_CI=1 の取り込みは ogCi = skipped と記録され、check-paint-artifact が拒む（push できない）
//   - 受け入れのタグの無いコミットは拒む（IMPORT_PAINT_ALLOW_UNTAGGED=1 でも check-paint-artifact が拒む）
//   - OG の HEAD が指定のコミットでなければ拒む。OG が git worktree でも取り込める
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
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
// 親の safe-push の試験の差し替えが漏れてこないように
delete GIT_ENV.SAFE_PUSH_TEST_CHECKS;
delete GIT_ENV.IMPORT_PAINT_SKIP_OG_CI;
delete GIT_ENV.IMPORT_PAINT_ALLOW_UNTAGGED;

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function write(dir, rel, body) {
  mkdirSync(join(dir, rel, '..'), { recursive: true });
  writeFileSync(join(dir, rel), body);
}

/** 偽の OG: ci は無視されるディレクトリに印を置く（ciDirty なら追跡外のファイルを作る）、build:embed は dist-embed/ を作る */
function makeOg(base, { ciDirty = false } = {}) {
  const og = join(base, 'OG-nanika');
  mkdirSync(og, { recursive: true });
  git(og, 'init', '-b', 'main');
  const ciCmd = ciDirty
    ? "node -e \"require('fs').writeFileSync('stray-from-ci.txt','x')\""
    : "node -e \"require('fs').mkdirSync('out',{recursive:true});require('fs').writeFileSync('out/ci-ran','1')\"";
  write(
    og,
    'package.json',
    JSON.stringify(
      {
        name: 'og-fake',
        private: true,
        scripts: { ci: ciCmd, 'build:embed': 'node tooling/build-embed.mjs', 'check:embed': 'node tooling/check-embed.mjs' },
      },
      null,
      2,
    ),
  );
  write(
    og,
    'tooling/build-embed.mjs',
    [
      "import { mkdirSync, writeFileSync } from 'node:fs';",
      "mkdirSync('dist-embed/assets', { recursive: true });",
      "mkdirSync('dist-embed/.vite', { recursive: true });",
      "writeFileSync('dist-embed/.vite/manifest.json', '{}');",
      "writeFileSync('dist-embed/embed.html', '<!doctype html><html><head><title>お絵描き</title><script type=\"module\" src=\"/paint/assets/embed-x.js\"></script></head><body></body></html>');",
      "writeFileSync('dist-embed/assets/embed-x.js', 'export const x = 1;'.repeat(30));",
      "writeFileSync('dist-embed/assets/boot-y.js', 'export const y = 2;'.repeat(30));",
    ].join('\n'),
  );
  write(
    og,
    'tooling/check-embed.mjs',
    "if (process.argv.includes('--json')) console.log(JSON.stringify({ errors: [], warnings: [], info: { initialGzBytes: 4321 } }));\nelse console.log('check-embed: OK');\n",
  );
  write(og, 'src/core/VERSION', '0.9.2\n');
  write(og, 'src/embed/api.ts', 'export const EMBED_API_VERSION = 1;\n');
  write(og, '.gitignore', 'dist-embed/\nnode_modules/\nout/\n');
  write(og, 'node_modules/vite/package.json', JSON.stringify({ name: 'vite', version: '6.4.4' }));
  git(og, 'add', 'package.json', 'tooling', 'src', '.gitignore');
  git(og, 'commit', '-m', 'og v1');
  git(og, 'tag', '-a', 'm7-accepted', '-m', 'M7 accepted');
  return og;
}

/** 偽の Ilust: 取り込みの道具（tools/import-paint.sh と scripts/*paint-artifact.mjs）だけを持つ git の作業木 */
function makeIlust(base) {
  const il = join(base, 'Ilust_Sup');
  mkdirSync(join(il, 'tools'), { recursive: true });
  mkdirSync(join(il, 'scripts'), { recursive: true });
  git(il, 'init', '-b', 'main');
  copyFileSync(join(ROOT, 'tools', 'import-paint.sh'), join(il, 'tools', 'import-paint.sh'));
  chmodSync(join(il, 'tools', 'import-paint.sh'), 0o755);
  for (const f of ['paint-artifact.mjs', 'check-paint-artifact.mjs']) copyFileSync(join(ROOT, 'scripts', f), join(il, 'scripts', f));
  return il;
}

function setup(opts) {
  const base = mkdtempSync(join(tmpdir(), 'import-paint-'));
  tmpDirs.push(base);
  return { base, og: makeOg(base, opts), il: makeIlust(base) };
}

function importPaint(il, og, ref, extraEnv = {}) {
  const r = spawnSync('bash', ['tools/import-paint.sh', ref], { cwd: il, env: { ...GIT_ENV, OG_DIR: og, ...extraEnv }, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

const readBuild = (il) => JSON.parse(readFileSync(join(il, 'public', 'paint', 'BUILD.json'), 'utf8'));

describe('tools/import-paint.sh', () => {
  it('受け入れのタグの指すコミットを clean な作業木から: schema 2（ogCi = ran・ogClean・ogRef・ogAccepted・OG の初期 JS）で合格', () => {
    const { og, il } = setup();
    const r = importPaint(il, og, 'm7-accepted');
    expect(r.out).toContain('check-paint-artifact');
    expect(r.code, r.out).toBe(0);
    expect(existsSync(join(og, 'out', 'ci-ran'))).toBe(true);
    const b = readBuild(il);
    expect(b).toMatchObject({
      schema: 2,
      ogCommit: git(og, 'rev-parse', 'HEAD'),
      ogRef: 'm7-accepted',
      ogAccepted: 'm7-accepted',
      ogCi: 'ran',
      ogClean: true,
      ogContract: '0.9.2',
      embedApi: 1,
      vite: '6.4.4',
      ogInitialJsGzipBytes: 4321,
    });
    expect(b.entryJsGzipBytes).toBeGreaterThan(0);
    expect(b.initialJsGzipBytes).toBe(b.entryJsGzipBytes);
    // .vite は入れない
    expect(Object.keys(b.files).sort()).toEqual(['assets/boot-y.js', 'assets/embed-x.js', 'embed.html']);
    // コミットの sha でも同じコミットなら取り込める（タグは --points-at で見つける）
    const again = importPaint(il, og, git(og, 'rev-parse', '--short', 'HEAD'));
    expect(again.code, again.out).toBe(0);
    expect(readBuild(il).ogAccepted).toBe('m7-accepted');
  });

  it('OG の作業木に未追跡のファイルがあると取り込まない', () => {
    const { og, il } = setup();
    write(og, 'src/strings-new.json', '{}');
    const r = importPaint(il, og, 'm7-accepted');
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/clean ではありません.*strings-new\.json/);
    expect(existsSync(join(il, 'public', 'paint'))).toBe(false);
  });

  it('ci が作業木を汚したら取り込まない', () => {
    const { og, il } = setup({ ciDirty: true });
    const r = importPaint(il, og, 'm7-accepted');
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/clean でなくなりました.*stray-from-ci\.txt/);
    expect(existsSync(join(il, 'public', 'paint'))).toBe(false);
  });

  it('IMPORT_PAINT_SKIP_OG_CI=1 は ogCi = skipped と記録され、check-paint-artifact が拒む', () => {
    const { og, il } = setup();
    const r = importPaint(il, og, 'm7-accepted', { IMPORT_PAINT_SKIP_OG_CI: '1' });
    expect(r.code).not.toBe(0);
    expect(existsSync(join(og, 'out', 'ci-ran'))).toBe(false);
    expect(readBuild(il).ogCi).toBe('skipped');
    expect(r.out).toMatch(/ogCi が skipped/);
    const check = spawnSync('node', ['scripts/check-paint-artifact.mjs'], { cwd: il, env: GIT_ENV, encoding: 'utf8' });
    expect(check.status).not.toBe(0);
    // safe-push の試験の差し替えのときだけ警告
    const t = spawnSync('node', ['scripts/check-paint-artifact.mjs'], { cwd: il, env: { ...GIT_ENV, SAFE_PUSH_TEST_CHECKS: 'true' }, encoding: 'utf8' });
    expect(t.status, t.stderr).toBe(0);
  });

  it('受け入れのタグの無いコミットは拒む（IMPORT_PAINT_ALLOW_UNTAGGED=1 でも check-paint-artifact が拒む）', () => {
    const { og, il } = setup();
    write(og, 'src/core/VERSION', '0.9.3\n');
    git(og, 'commit', '-am', 'og v2 (not accepted)');
    let r = importPaint(il, og, 'HEAD');
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/受け入れのタグ（m<n>-accepted）がありません/);
    r = importPaint(il, og, 'HEAD', { IMPORT_PAINT_ALLOW_UNTAGGED: '1' });
    expect(r.code).not.toBe(0);
    expect(readBuild(il).ogAccepted).toBeNull();
    expect(r.out).toMatch(/ogAccepted がありません/);
  });

  it('OG の HEAD が指定のコミットでなければ拒む。git worktree の OG からは取り込める', () => {
    const { base, og, il } = setup();
    write(og, 'README.md', 'v2\n');
    git(og, 'add', 'README.md');
    git(og, 'commit', '-m', 'og v2');
    let r = importPaint(il, og, 'm7-accepted');
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/作業木が m7-accepted ではありません/);

    const wt = join(base, 'OG-nanika-wt');
    git(og, 'worktree', 'add', '--detach', wt, 'm7-accepted');
    mkdirSync(join(wt, 'node_modules', 'vite'), { recursive: true });
    writeFileSync(join(wt, 'node_modules', 'vite', 'package.json'), JSON.stringify({ version: '6.4.4' }));
    r = importPaint(il, wt, 'm7-accepted');
    expect(r.code, r.out).toBe(0);
    expect(readBuild(il)).toMatchObject({ ogAccepted: 'm7-accepted', ogCi: 'ran', ogClean: true });
  });
});
