// 埋め込みのペイントの成果物の照合（受け入れ embed-artifact-delivery / ilust-og-sw-absent の check-paint-artifact 側）。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { BUILD_JSON, fontBinFiles, listFiles, makeBuildInfo, verifyPaintArtifact } from '../paint-artifact.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const EMBED_HTML =
  '<!doctype html><html><head><title>ペイント</title><script type="module" crossorigin src="/paint/assets/embed-abc.js"></script>' +
  '<link rel="modulepreload" href="/paint/assets/chunk-1.js"></head><body><div id="app"></div></body></html>';

function makeArtifact(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'paint-art-'));
  dirs.push(dir);
  const files = {
    'embed.html': EMBED_HTML,
    'assets/embed-abc.js': 'export const a = 1;'.repeat(50),
    'assets/chunk-1.js': 'export const b = 2;'.repeat(20),
    'assets/og-bundled-gothic.ttf-xyz.bin': 'FONTDATA',
    ...extra,
  };
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

function sign(dir) {
  const info = makeBuildInfo(dir, { ogCommit: 'a'.repeat(40), ogContract: '0.9.0', embedApi: 1, vite: '6.4.4', createdAt: '2026-10-20T00:00:00.000Z' });
  writeFileSync(join(dir, BUILD_JSON), JSON.stringify(info));
  return info;
}

describe('paint-artifact', () => {
  it('リポジトリの public/paint/: 無ければ合格（S1）、あれば BUILD.json とハッシュが一致する', () => {
    const r = verifyPaintArtifact(join(ROOT, 'public', 'paint'));
    expect(r.errors).toEqual([]);
    if (r.present) {
      expect(r.info.embedApi).toBe(1);
      expect(Object.keys(r.info.files)).toContain('embed.html');
    }
  });

  it('BUILD.json: コミット・契約・API・ファイルごとの sha256・合計・初期 JS の gz', () => {
    const dir = makeArtifact();
    const info = sign(dir);
    expect(info).toMatchObject({ schema: 1, ogCommit: 'a'.repeat(40), ogContract: '0.9.0', embedApi: 1, vite: '6.4.4' });
    expect(Object.keys(info.files).sort()).toEqual(['assets/chunk-1.js', 'assets/embed-abc.js', 'assets/og-bundled-gothic.ttf-xyz.bin', 'embed.html']);
    expect(info.files['embed.html']).toMatch(/^[0-9a-f]{64}$/);
    expect(info.totalBytes).toBeGreaterThan(0);
    const gz = gzipSync('export const a = 1;'.repeat(50), { level: 9 }).length + gzipSync('export const b = 2;'.repeat(20), { level: 9 }).length;
    expect(info.initialJsGzipBytes).toBe(gz);
    expect(info.buildId).toMatch(/^aaaaaaaaaaaa-[0-9a-f]{12}$/);
    expect(verifyPaintArtifact(dir).errors).toEqual([]);
    expect(fontBinFiles(listFiles(dir))).toEqual(['assets/og-bundled-gothic.ttf-xyz.bin']);
  });

  it('手で直した・足した・消したファイルは落ちる', () => {
    const dir = makeArtifact();
    sign(dir);
    writeFileSync(join(dir, 'assets/chunk-1.js'), 'export const b = 3;');
    expect(verifyPaintArtifact(dir).errors.join('\n')).toMatch(/sha256 が一致しません.*chunk-1\.js/);

    const dir2 = makeArtifact();
    sign(dir2);
    writeFileSync(join(dir2, 'assets/extra.js'), 'x');
    expect(verifyPaintArtifact(dir2).errors.join('\n')).toMatch(/一覧に無いファイル.*extra\.js/);

    const dir3 = makeArtifact();
    sign(dir3);
    rmSync(join(dir3, 'assets/chunk-1.js'));
    expect(verifyPaintArtifact(dir3).errors.join('\n')).toMatch(/一覧のファイルがありません.*chunk-1\.js/);
  });

  it('BUILD.json が無い成果物は落ちる', () => {
    const dir = makeArtifact();
    expect(verifyPaintArtifact(dir).errors.join('\n')).toMatch(/BUILD\.json が無い/);
  });

  it.each([
    ['sw.js', 'self.skipWaiting()', /Service Worker/],
    ['manifest.webmanifest', '{}', /manifest/],
    ['assets/embed-abc.js.map', '{}', /sourcemap/],
    ['sandbox.html', '<html></html>', /sandbox/],
    ['bench/run.js', 'x', /bench/],
    ['src/embed/api.ts', 'export {}', /OG のソース/],
  ])('置いてはいけないファイル %s は落ちる', (rel, body, re) => {
    const dir = makeArtifact({ [rel]: body });
    sign(dir);
    expect(verifyPaintArtifact(dir).errors.join('\n')).toMatch(re);
  });

  it('製品名の字面・SW の登録・sourcemap の参照・/paint/ の外の絶対パス・manifest の link は落ちる', () => {
    const cases = [
      [{ 'assets/chunk-1.js': 'const s = "CLIP STUDIO";' }, /製品名/],
      [{ 'assets/chunk-1.js': 'const s = "クリスタ";' }, /製品名/],
      [{ 'assets/chunk-1.js': 'navigator.serviceWorker.register("/sw.js")' }, /Service Worker の登録/],
      [{ 'assets/chunk-1.js': 'x\n//# sourceMappingURL=chunk-1.js.map' }, /sourcemap の参照/],
      [{ 'embed.html': EMBED_HTML.replace('/paint/assets/chunk-1.js', '/assets/chunk-1.js') }, /\/paint\/ の外/],
      [{ 'embed.html': EMBED_HTML.replace('</head>', '<link rel="manifest" href="/paint/m.json"></head>') }, /manifest の link/],
    ];
    for (const [extra, re] of cases) {
      const dir = makeArtifact(extra);
      sign(dir);
      expect(verifyPaintArtifact(dir).errors.join('\n')).toMatch(re);
    }
  });

  it('不正なコミット・契約・API の版では BUILD.json を作らない', () => {
    const dir = makeArtifact();
    expect(() => makeBuildInfo(dir, { ogCommit: 'zz', ogContract: '0.9.0', embedApi: 1 })).toThrow(/og-commit/);
    expect(() => makeBuildInfo(dir, { ogCommit: 'abcdef1', ogContract: 'x', embedApi: 1 })).toThrow(/og-contract/);
    expect(() => makeBuildInfo(dir, { ogCommit: 'abcdef1', ogContract: '0.9.0', embedApi: 0 })).toThrow(/embed-api/);
  });
});
