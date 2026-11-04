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
//   - OG の e2e が書き直す追跡済みの docs/progress/ の画像だけは og_commit の版に戻して取り込む（例外は狭い）
//   - ilust-sup-followup-03: OG の e2e の port（OG_E2E_PORT / OG_EMBED_PORT）が塞がっていれば ci の前にすぐ止める。CI=1 は拒む
//   - 点の版の受け入れのタグ（m8.1-accepted、ADR-0009 D1-2）からも取り込める
//   - ilust-sup-followup-01（ADR-0013 D6-2）: og_commit の契約が今の（HEAD の）public/paint と違うのに今の版のフィクスチャ 4 つが HEAD に無ければ、ci の前に止める
//   - ilust-sup-followup-06（ADR-0013 D6-4）: 記録のある C の ci を条件つきで使い回す（ogCi = recorded・ogCiRecord・ogCiCommit）。
//     条件が欠ける・--og-ci-record=none なら従来どおり ci を回す（ogCi = ran）。build:embed と check:embed はいつも回す
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
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
// safe-push は CI=1 で vitest を回す。import-paint.sh は CI を拒む（OG の retries が緩む）ので、試験の子には渡さない
delete GIT_ENV.CI;
delete GIT_ENV.OG_E2E_PORT;
delete GIT_ENV.OG_EMBED_PORT;
delete GIT_ENV.OG_CI_RECORD;
delete GIT_ENV.OG_CI_RECORD_DIR;

/** 今空いている 127.0.0.1 の port を 2 つ（OG の e2e の既定 5190 / 5191 が他の作業で塞がっていても試験が揺れないように） */
function freePorts() {
  const out = execFileSync(
    process.execPath,
    [
      '-e',
      "const net=require('net');const a=net.createServer(),b=net.createServer();a.listen(0,'127.0.0.1',()=>b.listen(0,'127.0.0.1',()=>{console.log(a.address().port+' '+b.address().port);a.close();b.close();}));",
    ],
    { encoding: 'utf8' },
  );
  const [e2e, embed] = out.trim().split(/\s+/);
  return { OG_E2E_PORT: e2e, OG_EMBED_PORT: embed };
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function write(dir, rel, body) {
  mkdirSync(join(dir, rel, '..'), { recursive: true });
  writeFileSync(join(dir, rel), body);
}

/** 偽の OG: ci は無視されるディレクトリに印を置く（ciDirty なら追跡外のファイルを作る）、build:embed は dist-embed/ を作る */
function makeOg(base, { ciDirty = false, ciScript = null } = {}) {
  const og = join(base, 'OG-nanika');
  mkdirSync(og, { recursive: true });
  git(og, 'init', '-b', 'main');
  const ciCmd = ciScript
    ? 'node tooling/ci.mjs'
    : ciDirty
      ? "node -e \"require('fs').writeFileSync('stray-from-ci.txt','x')\""
      : "node -e \"require('fs').mkdirSync('out',{recursive:true});require('fs').writeFileSync('out/ci-ran','1')\"";
  if (ciScript) write(og, 'tooling/ci.mjs', ciScript);
  // OG の e2e が書き直す証跡（追跡済み）
  write(og, 'docs/progress/m3/shot.png', 'png-v1');
  write(og, 'docs/progress/m7/shot.jpg', 'jpg-v1');
  write(og, 'docs/progress/m7/README.md', 'notes\n');
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
  git(og, 'add', 'package.json', 'tooling', 'src', '.gitignore', 'docs');
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
  for (const f of ['paint-artifact.mjs', 'check-paint-artifact.mjs', 'og-ci-record.mjs']) copyFileSync(join(ROOT, 'scripts', f), join(il, 'scripts', f));
  return il;
}

function setup(opts) {
  const base = mkdtempSync(join(tmpdir(), 'import-paint-'));
  tmpDirs.push(base);
  return { base, og: makeOg(base, opts), il: makeIlust(base) };
}

function importPaint(il, og, ref, extraEnv = {}, extraArgs = []) {
  const r = spawnSync('bash', ['tools/import-paint.sh', ref, ...extraArgs], {
    cwd: il,
    env: { ...GIT_ENV, ...freePorts(), OG_DIR: og, ...extraEnv },
    encoding: 'utf8',
  });
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

  it('OG の e2e が書き直した追跡済みの docs/progress/ の画像だけは og_commit の版に戻して取り込む', () => {
    const ci = [
      "import { writeFileSync } from 'node:fs';",
      "writeFileSync('docs/progress/m3/shot.png', 'png-v2');",
      "writeFileSync('docs/progress/m7/shot.jpg', 'jpg-v2');",
    ].join('\n');
    const { og, il } = setup({ ciScript: ci });
    const r = importPaint(il, og, 'm7-accepted');
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/証跡の画像 2 件を/);
    expect(readFileSync(join(og, 'docs/progress/m3/shot.png'), 'utf8')).toBe('png-v1');
    expect(readFileSync(join(og, 'docs/progress/m7/shot.jpg'), 'utf8')).toBe('jpg-v1');
    expect(git(og, 'status', '--porcelain')).toBe('');
    expect(readBuild(il)).toMatchObject({ ogCi: 'ran', ogClean: true });
  });

  it('証跡の例外は狭い: 新しい画像・画像以外・docs/progress/ の外の書き換えは拒む', () => {
    const cases = [
      ["writeFileSync('docs/progress/m7/new.png', 'x');", /new\.png/],
      ["writeFileSync('docs/progress/m7/README.md', 'changed');", /README\.md/],
      ["writeFileSync('src/core/VERSION', '0.9.9');", /VERSION/],
    ];
    for (const [line, re] of cases) {
      const ci = ["import { writeFileSync } from 'node:fs';", "writeFileSync('docs/progress/m3/shot.png', 'png-v2');", line].join('\n');
      const { og, il } = setup({ ciScript: ci });
      const r = importPaint(il, og, 'm7-accepted');
      expect(r.code, r.out).not.toBe(0);
      expect(r.out).toMatch(/clean でなくなりました/);
      expect(r.out).toMatch(re);
      expect(existsSync(join(il, 'public', 'paint'))).toBe(false);
    }
  });
  it('ilust-import-port-check: OG の e2e の port が塞がっていれば ci の前にすぐ止める（既定は E2E + 1 を EMBED に）', async () => {
    const { og, il } = setup();
    const busy = createServer();
    await new Promise((resolve) => busy.listen(0, '127.0.0.1', resolve));
    const port = busy.address().port;
    try {
      // E2E の port が塞がっている
      const r1 = importPaint(il, og, 'm7-accepted', { OG_E2E_PORT: String(port), OG_EMBED_PORT: String(freePorts().OG_EMBED_PORT) });
      expect(r1.code, r1.out).not.toBe(0);
      expect(r1.out).toContain(`port ${port} が使われています`);
      expect(r1.out).toMatch(/空いている 52xx/);
      expect(r1.out).not.toContain('== OG: npm run ci');
      expect(existsSync(join(og, 'out', 'ci-ran'))).toBe(false);
      // EMBED の port（OG_EMBED_PORT が無ければ E2E + 1）が塞がっている
      const r2 = importPaint(il, og, 'm7-accepted', { OG_E2E_PORT: String(port - 1), OG_EMBED_PORT: '' });
      if (r2.out.includes(`port ${port - 1} が使われています`)) return; // port - 1 がたまたま他で使われている（E2E の側で止まる = 同じく正しい）
      expect(r2.code, r2.out).not.toBe(0);
      expect(r2.out).toContain(`port ${port} が使われています`);
      expect(existsSync(join(og, 'out', 'ci-ran'))).toBe(false);
    } finally {
      await new Promise((resolve) => busy.close(resolve));
    }
  });

  it('ilust-import-port-check: CI が付いていれば止める（OG の retries が 1 になり関門が緩む）。port が数でなければ止める', () => {
    const { og, il } = setup();
    const r = importPaint(il, og, 'm7-accepted', { CI: '1' });
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toMatch(/CI=1 が付いています/);
    expect(existsSync(join(og, 'out', 'ci-ran'))).toBe(false);
    const r2 = importPaint(il, og, 'm7-accepted', { OG_E2E_PORT: 'abc' });
    expect(r2.code, r2.out).not.toBe(0);
    expect(r2.out).toMatch(/OG_E2E_PORT が数ではありません/);
  });

  /** OG を点の版（契約 0.10.3）に進めて m8.1-accepted を打つ。withCsp なら build:embed が embed.html の head の先頭に CSP の meta を入れる */
  function pointRelease(og, { withCsp }) {
    const csp = withCsp
      ? `<meta http-equiv=\\"Content-Security-Policy\\" content=\\"default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'\\">`
      : '';
    write(
      og,
      'tooling/build-embed.mjs',
      [
        "import { mkdirSync, writeFileSync } from 'node:fs';",
        "mkdirSync('dist-embed/assets', { recursive: true });",
        `writeFileSync('dist-embed/embed.html', "<!doctype html><html><head>${csp}<title>お絵描き</title><script type=\\"module\\" src=\\"/paint/assets/embed-x.js\\"></script></head><body></body></html>");`,
        "writeFileSync('dist-embed/assets/embed-x.js', 'export const x = 1;'.repeat(30));",
      ].join('\n'),
    );
    write(og, 'src/core/VERSION', '0.10.3\n');
    git(og, 'add', 'tooling', 'src');
    git(og, 'commit', '-m', 'og v1.1');
    git(og, 'tag', '-a', 'm8.1-accepted', '-m', 'M8.1 accepted (point release)');
  }

  it('ilust-reimport-m8-1: 点の版の受け入れのタグ（m8.1-accepted）の指すコミットから取り込め、ogAccepted に点の版が入って合格', () => {
    const { og, il } = setup();
    pointRelease(og, { withCsp: true });
    const r = importPaint(il, og, 'm8.1-accepted');
    expect(r.code, r.out).toBe(0);
    expect(readBuild(il)).toMatchObject({ ogRef: 'm8.1-accepted', ogAccepted: 'm8.1-accepted', ogContract: '0.10.3', ogCi: 'ran', ogClean: true });
    expect(r.out).toMatch(/受け入れ m8\.1-accepted/);
    expect(r.out).not.toMatch(/CSP の meta がありません/);
  });

  /** Ilust の HEAD に今の埋め込みの BUILD.json（と、あればフィクスチャ）をコミットする */
  function commitCurrentPaint(il, { ogCommit, ogContract, fixtures = [] }) {
    write(il, 'public/paint/BUILD.json', JSON.stringify({ schema: 2, ogCommit, ogContract, ogCi: 'ran', ogClean: true, ogAccepted: 'm6-accepted' }));
    for (const f of fixtures) write(il, `e2e/fixtures/${f}`, '{}\n');
    git(il, 'add', 'public/paint/BUILD.json', ...fixtures.map((f) => `e2e/fixtures/${f}`));
    git(il, 'commit', '-q', '-m', `paint ${ogCommit.slice(0, 7)}`);
  }
  const FX_SUFFIXES = ['.ognk', '.json', '-draft-opfs.json', '-draft-idb.json'];

  it('ilust-fixture-precheck: 契約が変わるのに今の版のフィクスチャ 4 つが HEAD に無ければ、OG の ci の前に止める（生成のコマンドを出す）', () => {
    const { og, il } = setup();
    const cur = 'a1b2c3d'.padEnd(40, '0');
    commitCurrentPaint(il, { ogCommit: cur, ogContract: '0.9.1', fixtures: ['og-a1b2c3d.ognk', 'og-a1b2c3d.json'] });
    const r = importPaint(il, og, 'm7-accepted');
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toMatch(/契約が 0\.9\.1 から 0\.9\.2 に変わるのに/);
    expect(r.out).toContain('og-a1b2c3d-draft-opfs.json');
    expect(r.out).toContain('og-a1b2c3d-draft-idb.json');
    expect(r.out).not.toContain(' og-a1b2c3d.ognk');
    expect(r.out).toContain('OG_FIXTURE_NAME=og-a1b2c3d OG_DRAFT_FIXTURE_NAME=og-a1b2c3d-draft');
    expect(r.out).not.toContain('== OG: npm run ci');
    expect(existsSync(join(og, 'out', 'ci-ran'))).toBe(false);
    // 作業木にあるだけ（コミットしていない）では足りない
    for (const sfx of FX_SUFFIXES) write(il, `e2e/fixtures/og-a1b2c3d${sfx}`, '{}\n');
    expect(importPaint(il, og, 'm7-accepted').code).not.toBe(0);
    git(il, 'add', ...FX_SUFFIXES.map((sfx) => `e2e/fixtures/og-a1b2c3d${sfx}`));
    git(il, 'commit', '-q', '-m', 'fixtures');
    const ok = importPaint(il, og, 'm7-accepted');
    expect(ok.code, ok.out).toBe(0);
    expect(ok.out).toMatch(/フィクスチャ 4 つが HEAD にあります/);
    expect(readBuild(il)).toMatchObject({ ogContract: '0.9.2', ogCi: 'ran' });
  });

  it('ilust-fixture-precheck: 契約が同じならフィクスチャは問わない', () => {
    const { og, il } = setup();
    commitCurrentPaint(il, { ogCommit: 'b'.repeat(40), ogContract: '0.9.2' });
    const r = importPaint(il, og, 'm7-accepted');
    expect(r.code, r.out).toBe(0);
    expect(r.out).not.toMatch(/フィクスチャ/);
  });

  /**
   * 偽の OG を封の形にする: C（seal-check.sh を足す）→ 記録（../OG-nanika-pkg/logs/<C>-ci.json）→ E（docs/PROGRESS.md に記録の行だけ）に m7.1-accepted。
   * srcChange なら E で src も変える（差が docs/ の外）。sealExit は偽の seal-check.sh の終了コード
   */
  function sealLike(base, og, { sealExit = 0, srcChange = false, retries = 0 } = {}) {
    write(og, 'scripts/pkg/seal-check.sh', `#!/usr/bin/env bash\necho "sealed (fake) $*"\nexit ${sealExit}\n`);
    chmodSync(join(og, 'scripts/pkg/seal-check.sh'), 0o755);
    git(og, 'add', 'scripts');
    git(og, 'commit', '-q', '-m', 'C');
    const c = git(og, 'rev-parse', 'HEAD');
    const record = {
      schema: 'og-ci-record/1',
      commit: c,
      command: 'npm run ci',
      ciEnv: 'unset',
      exit: 0,
      clean: true,
      porcelainBefore: [],
      porcelainAfter: [],
      untracked: [],
      headAfter: c,
      vitest: { ran: true, failed: 0, filesFailed: 0, errors: 0 },
      e2e: { ran: true, failed: 0, flaky: 0, didNotRun: 0, interrupted: 0, retryAttempts: retries, retries },
    };
    const body = `${JSON.stringify(record, null, 2)}\n`;
    write(join(base, 'OG-nanika-pkg', 'logs'), `${c}-ci.json`, body);
    const sha = createHash('sha256').update(body).digest('hex');
    write(og, 'docs/progress/m7/README.md', `ci の記録 \`../OG-nanika-pkg/logs/${c}-ci.json\`（sha256 \`${sha}\`）\n`);
    write(og, 'docs/PROGRESS.md', `# PROGRESS\n  ci の記録 \`../OG-nanika-pkg/logs/${c}-ci.json\`（sha256 \`${sha}\`）、ログ（sha256 \`${'b'.repeat(64)}\`）\n`);
    if (srcChange) write(og, 'src/core/VERSION', '0.9.2\n// changed\n');
    git(og, 'add', 'docs', 'src');
    git(og, 'commit', '-q', '-m', 'E (evidence)');
    git(og, 'tag', '-a', 'm7.1-accepted', '-m', 'M7.1 accepted (point release)');
    return { c, sha };
  }

  it('ilust-ci-record-reuse: 記録の commit が祖先で差が docs/ だけ・seal-check 0・記録が緑・sha256 が PROGRESS と一致なら ci を省き ogCi = recorded（build:embed / check:embed は回す）', () => {
    const { base, og, il } = setup();
    const { c, sha } = sealLike(base, og);
    const r = importPaint(il, og, 'm7.1-accepted');
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/npm run ci を記録で代えます/);
    expect(r.out).not.toContain('== OG: npm run ci\n');
    expect(r.out).toContain('== OG: npm run build:embed');
    expect(r.out).toContain('== OG: npm run check:embed');
    expect(existsSync(join(og, 'out', 'ci-ran'))).toBe(false);
    const b = readBuild(il);
    expect(b).toMatchObject({ ogCi: 'recorded', ogCiRecord: sha, ogCiCommit: c, ogAccepted: 'm7.1-accepted', ogClean: true, ogInitialJsGzipBytes: 4321 });
    const check = spawnSync('node', ['scripts/check-paint-artifact.mjs'], { cwd: il, env: GIT_ENV, encoding: 'utf8' });
    expect(check.status, check.stderr).toBe(0);
    expect(check.stdout).toMatch(/ci recorded（記録/);
  });

  it('ilust-ci-record-reuse: --og-ci-record=none・差が docs/ の外・seal-check が 0 でない・retries のある記録なら ci を回す（ogCi = ran）', () => {
    const cases = [
      [{}, ['--og-ci-record=none'], /記録を使わない|npm run ci/],
      [{ srcChange: true }, [], /docs\/ の外があります: src\/core\/VERSION/],
      [{ sealExit: 1 }, [], /seal-check.*exit 0 ではありません/],
      [{ retries: 1 }, [], /retries/],
    ];
    for (const [opts, args, re] of cases) {
      const { base, og, il } = setup();
      sealLike(base, og, opts);
      const r = importPaint(il, og, 'm7.1-accepted', {}, args);
      expect(r.code, r.out).toBe(0);
      expect(r.out, JSON.stringify(opts)).toMatch(re);
      expect(r.out).toContain('== OG: npm run ci');
      expect(existsSync(join(og, 'out', 'ci-ran'))).toBe(true);
      const b = readBuild(il);
      expect(b.ogCi).toBe('ran');
      expect(b).not.toHaveProperty('ogCiRecord');
    }
  });

  it('知らない 2 つ目の引数は拒む', () => {
    const { og, il } = setup();
    const r = importPaint(il, og, 'm7-accepted', {}, ['--skip-ci']);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/知らない引数です: --skip-ci/);
    expect(existsSync(join(og, 'out', 'ci-ran'))).toBe(false);
  });

  it('robustness-security-06: m8.1-accepted の成果物に CSP の meta が無ければ照合で止まり、public/paint/ を置き換えない', () => {
    const { og, il } = setup();
    pointRelease(og, { withCsp: false });
    const r = importPaint(il, og, 'm8.1-accepted');
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toMatch(/CSP の meta がありません/);
    expect(existsSync(join(il, 'public', 'paint'))).toBe(false);
  });
});
