// OG の node_modules と package-lock.json の一致（scripts/og-deps-check.mjs、OG ADR-0018 D6-1 (v)、cycle18 ilust-sup-followup-08、
// 受け入れ ilust-import-deps-check）。純関数 depsProblems と、一時ディレクトリの偽の OG での CLI の終了コードを確かめる。
// import-paint.sh の中での使い方（外れたら npm ci → 確かめ直し）は tools/__tests__/import-paint.test.mjs。
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { depsProblems } from '../og-deps-check.mjs';

const SCRIPT = fileURLToPath(new URL('../og-deps-check.mjs', import.meta.url));
const tmpDirs = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const LOCK = {
  name: 'og',
  lockfileVersion: 3,
  packages: {
    '': { name: 'og', version: '0.18.0' },
    'node_modules/vite': { version: '6.4.4', integrity: 'sha512-vite' },
    'node_modules/zod': { version: '3.24.1', integrity: 'sha512-zod', dev: true },
    'node_modules/@rollup/rollup-win32-x64-msvc': { version: '4.30.0', integrity: 'sha512-win', optional: true },
    'node_modules/fsevents': { version: '2.3.3', integrity: 'sha512-fsev', devOptional: true },
    'node_modules/linked': { resolved: 'packages/linked', link: true },
  },
};
const installedOf = (lock, drop = []) => ({
  name: lock.name,
  lockfileVersion: 3,
  // 深い写し（試験の中で書き換えても LOCK に漏れない）
  packages: JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(lock.packages).filter(([k, v]) => k !== '' && !v.optional && !v.devOptional && !drop.includes(k))))),
});
const clone = (x) => JSON.parse(JSON.stringify(x));

describe('og-deps-check: depsProblems（純関数）', () => {
  it('一致: optional / devOptional の部品は入っていなくてよい（root と link も扱う）', () => {
    const r = depsProblems(LOCK, installedOf(LOCK));
    expect(r).toEqual({ ok: true, problems: [], checked: 3 });
  });

  it('外れ: 版・integrity・入っていない・lock に無い部品・link の先', () => {
    const inst = installedOf(LOCK);
    inst.packages['node_modules/vite'].version = '6.4.3';
    inst.packages['node_modules/zod'].integrity = 'sha512-other';
    delete inst.packages['node_modules/linked'];
    inst.packages['node_modules/left-pad'] = { version: '1.3.0' };
    const r = depsProblems(LOCK, inst);
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual([
      'node_modules/vite: 版が違います（lock 6.4.4 / 入っている 6.4.3）',
      expect.stringMatching(/^node_modules\/zod: integrity が違います/),
      'node_modules/linked: 入っていません（lock packages/linked）',
      'node_modules/left-pad: lock に無い部品が入っています（1.3.0）',
    ]);
    const link = installedOf(LOCK);
    link.packages['node_modules/linked'].resolved = 'elsewhere';
    expect(depsProblems(LOCK, link).problems).toEqual([expect.stringMatching(/^node_modules\/linked: link の先が違います/)]);
  });

  it('optional の部品も、入っていれば版を比べる（違う版が入っていれば外れ）', () => {
    const inst = installedOf(LOCK);
    inst.packages['node_modules/fsevents'] = { version: '2.3.2', integrity: 'sha512-old' };
    expect(depsProblems(LOCK, inst).problems).toEqual(['node_modules/fsevents: 版が違います（lock 2.3.3 / 入っている 2.3.2）']);
    inst.packages['node_modules/fsevents'] = clone(LOCK.packages['node_modules/fsevents']);
    expect(depsProblems(LOCK, inst).ok).toBe(true);
  });

  it('hidden lockfile が無い・lock に packages が無い（古い lockfileVersion 1）は外れ。理由は多ければ切り詰める', () => {
    expect(depsProblems(LOCK, null).problems[0]).toMatch(/node_modules\/\.package-lock\.json がありません/);
    expect(depsProblems({ lockfileVersion: 1, dependencies: {} }, installedOf(LOCK)).problems[0]).toMatch(/packages がありません/);
    const many = { packages: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`node_modules/p${i}`, { version: '1.0.0' }])) };
    const r = depsProblems(many, { packages: {} }, { maxProblems: 5 });
    expect(r.problems).toHaveLength(6);
    expect(r.problems[5]).toBe('ほか 25 件');
  });
});

describe('og-deps-check: CLI（偽の OG）', () => {
  function fakeOg({ lock = LOCK, installed = installedOf(LOCK) } = {}) {
    const og = mkdtempSync(join(tmpdir(), 'og-deps-'));
    tmpDirs.push(og);
    if (lock) writeFileSync(join(og, 'package-lock.json'), JSON.stringify(lock));
    if (installed) {
      mkdirSync(join(og, 'node_modules'), { recursive: true });
      writeFileSync(join(og, 'node_modules', '.package-lock.json'), JSON.stringify(installed));
    }
    return og;
  }
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

  it('exit 0 = 一致、1 = 外れ（--json で理由）、2 = package-lock.json が無い・引数の誤り', () => {
    expect(run(`--og-dir=${fakeOg()}`).status).toBe(0);
    const drift = installedOf(LOCK);
    drift.packages['node_modules/vite'].version = '7.0.0';
    const r = run(`--og-dir=${fakeOg({ installed: drift })}`, '--json');
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, problems: ['node_modules/vite: 版が違います（lock 6.4.4 / 入っている 7.0.0）'] });
    expect(run(`--og-dir=${fakeOg({ installed: null })}`).status).toBe(1);
    expect(run(`--og-dir=${fakeOg({ lock: null })}`).status).toBe(2);
    expect(run().status).toBe(2);
    expect(run('--og-dir=x', '--bogus').status).toBe(2);
  });
});
