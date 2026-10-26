// 埋め込みのペイントの成果物の照合（受け入れ embed-artifact-delivery / ilust-og-sw-absent の check-paint-artifact 側）。
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ACCEPTED_TAG_RE,
  acceptedMilestone,
  BUILD_JSON,
  checkCspMeta,
  checkInitialJsGrowth,
  compareVersions,
  cspMetaRequired,
  fontBinFiles,
  listFiles,
  makeBuildInfo,
  verifyPaintArtifact,
} from '../paint-artifact.mjs';

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

const GATE = { ogCi: 'ran', ogClean: true, ogRef: 'm7-accepted', ogAccepted: 'm7-accepted' };

function sign(dir, over = {}) {
  const info = makeBuildInfo(dir, {
    ogCommit: 'a'.repeat(40),
    ogContract: '0.9.0',
    embedApi: 1,
    vite: '6.4.4',
    createdAt: '2026-10-20T00:00:00.000Z',
    ...GATE,
    ...over,
  });
  writeFileSync(join(dir, BUILD_JSON), JSON.stringify(info));
  return info;
}

/** BUILD.json の値を後から書き換える（関門の記録の検査用。ファイルの一覧とハッシュはそのまま） */
function patchBuild(dir, patch) {
  const p = join(dir, BUILD_JSON);
  const info = { ...JSON.parse(readFileSync(p, 'utf8')), ...patch };
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete info[k];
  writeFileSync(p, JSON.stringify(info));
}

const CSP =
  "default-src 'self'; script-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'";
const withCsp = (html, content = CSP) => html.replace('<title>', `<meta http-equiv="Content-Security-Policy" content="${content}"><title>`);

describe('paint-artifact', () => {
  it('リポジトリの public/paint/: 無ければ合格（S1）、あれば BUILD.json とハッシュが一致する', () => {
    const r = verifyPaintArtifact(join(ROOT, 'public', 'paint'));
    expect(r.errors).toEqual([]);
    expect(Array.isArray(r.warnings)).toBe(true);
    if (r.present) {
      expect(r.info.embedApi).toBe(1);
      expect(Object.keys(r.info.files)).toContain('embed.html');
    }
  });

  it('BUILD.json: コミット・契約・API・関門の記録・ファイルごとの sha256・合計・入口の JS の gz', () => {
    const dir = makeArtifact();
    const info = sign(dir, { ogInitialJsGzipBytes: 551_234 });
    expect(info).toMatchObject({
      schema: 2,
      ogCommit: 'a'.repeat(40),
      ogContract: '0.9.0',
      embedApi: 1,
      vite: '6.4.4',
      ogCi: 'ran',
      ogClean: true,
      ogRef: 'm7-accepted',
      ogAccepted: 'm7-accepted',
      ogInitialJsGzipBytes: 551_234,
    });
    expect(Object.keys(info.files).sort()).toEqual(['assets/chunk-1.js', 'assets/embed-abc.js', 'assets/og-bundled-gothic.ttf-xyz.bin', 'embed.html']);
    expect(info.files['embed.html']).toMatch(/^[0-9a-f]{64}$/);
    expect(info.totalBytes).toBeGreaterThan(0);
    const gz = gzipSync('export const a = 1;'.repeat(50), { level: 9 }).length + gzipSync('export const b = 2;'.repeat(20), { level: 9 }).length;
    // ilust-sup-followup-08: 入口の JS は entryJsGzipBytes。旧名 initialJsGzipBytes は 1 版だけ同じ値で残す
    expect(info.entryJsGzipBytes).toBe(gz);
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
    expect(() => makeBuildInfo(dir, { ogCommit: 'zz', ogContract: '0.9.0', embedApi: 1, ...GATE })).toThrow(/og-commit/);
    expect(() => makeBuildInfo(dir, { ogCommit: 'abcdef1', ogContract: 'x', embedApi: 1, ...GATE })).toThrow(/og-contract/);
    expect(() => makeBuildInfo(dir, { ogCommit: 'abcdef1', ogContract: '0.9.0', embedApi: 0, ...GATE })).toThrow(/embed-api/);
    expect(() => makeBuildInfo(dir, { ogCommit: 'abcdef1', ogContract: '0.9.0', embedApi: 1, ...GATE, ogCi: undefined })).toThrow(/og-ci/);
    expect(() => makeBuildInfo(dir, { ogCommit: 'abcdef1', ogContract: '0.9.0', embedApi: 1, ...GATE, ogCi: 'maybe' })).toThrow(/og-ci/);
    expect(() => makeBuildInfo(dir, { ogCommit: 'abcdef1', ogContract: '0.9.0', embedApi: 1, ...GATE, ogClean: 'yes' })).toThrow(/og-clean/);
    expect(() => makeBuildInfo(dir, { ogCommit: 'abcdef1', ogContract: '0.9.0', embedApi: 1, ...GATE, ogAccepted: 'v1.0' })).toThrow(/og-accepted/);
    expect(() => makeBuildInfo(dir, { ogCommit: 'abcdef1', ogContract: '0.9.0', embedApi: 1, ...GATE, ogInitialJsGzipBytes: -1 })).toThrow(/og-initial/);
  });
});

describe('取り込みの関門の記録（schema 2、ilust-sup-followup-02 / ADR-0008 D10）', () => {
  it('ogCi = skipped は不合格（試験の差し替えのときだけ警告）', () => {
    const dir = makeArtifact();
    sign(dir, { ogCi: 'skipped' });
    expect(verifyPaintArtifact(dir).errors.join('\n')).toMatch(/ogCi が skipped/);
    const t = verifyPaintArtifact(dir, { allowTestImports: true });
    expect(t.errors).toEqual([]);
    expect(t.warnings.join('\n')).toMatch(/ogCi が skipped.*試験のため警告だけ/);
  });

  it('ogClean が true でない・無い、ogCi が無い・不正なら不合格（試験でも）', () => {
    for (const patch of [{ ogClean: false }, { ogClean: undefined }, { ogCi: undefined }, { ogCi: 'yes' }, { entryJsGzipBytes: undefined }]) {
      const dir = makeArtifact();
      sign(dir);
      patchBuild(dir, patch);
      const r = verifyPaintArtifact(dir, { allowTestImports: true });
      expect(r.errors.length, JSON.stringify(patch)).toBeGreaterThan(0);
      expect(r.errors.join('\n')).toMatch(/ogClean|ogCi|entryJsGzipBytes/);
    }
  });

  it('受け入れのタグ（ogAccepted）の無い取り込みは不合格（試験のときだけ警告）、形が違えば不合格', () => {
    const dir = makeArtifact();
    sign(dir, { ogAccepted: null });
    expect(verifyPaintArtifact(dir).errors.join('\n')).toMatch(/ogAccepted がありません/);
    expect(verifyPaintArtifact(dir, { allowTestImports: true }).errors).toEqual([]);
    patchBuild(dir, { ogAccepted: 'release-1' });
    expect(verifyPaintArtifact(dir, { allowTestImports: true }).errors.join('\n')).toMatch(/受け入れのタグの形ではありません/);
  });

  it('ilust-reimport-m8-1: 点の版の受け入れのタグ（m8.1-accepted、ADR-0009 D1-2）も受け入れのタグ。形の崩れたものは拒む', () => {
    for (const ok of ['m7-accepted', 'm8-accepted', 'm8.1-accepted', 'm10.2-accepted']) expect(ACCEPTED_TAG_RE.test(ok), ok).toBe(true);
    for (const bad of ['m8.-accepted', 'm8.1.2-accepted', 'm8.1', 'v8.1-accepted', 'm8-1-accepted', 'm8.1-accepted-x']) expect(ACCEPTED_TAG_RE.test(bad), bad).toBe(false);
    const dir = makeArtifact({ 'embed.html': withCsp(EMBED_HTML) });
    const info = sign(dir, { ogContract: '0.10.3', ogRef: 'm8.1-accepted', ogAccepted: 'm8.1-accepted' });
    expect(info.ogAccepted).toBe('m8.1-accepted');
    expect(verifyPaintArtifact(dir).errors).toEqual([]);
    expect(() => sign(makeArtifact(), { ogAccepted: 'm8.1.2-accepted' })).toThrow(/m<n>-accepted/);
  });

  it('schema 1（M7 までの取り込み）は読めて、関門の記録が無い旨の警告だけ。知らない schema は不合格', () => {
    const dir = makeArtifact();
    sign(dir);
    patchBuild(dir, { schema: 1, ogCi: undefined, ogClean: undefined, ogAccepted: undefined, ogRef: undefined, entryJsGzipBytes: undefined });
    const r = verifyPaintArtifact(dir);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join('\n')).toMatch(/schema 1/);
    patchBuild(dir, { schema: 3 });
    expect(verifyPaintArtifact(dir).errors.join('\n')).toMatch(/schema/);
  });
});

describe('embed.html の CSP の meta（robustness-security-02 の Ilust 側）', () => {
  it('meta が無い成果物は、契約 0.10.0 より前は警告だけ（移行の印）、0.10.0 以降は不合格', () => {
    const dir = makeArtifact();
    sign(dir, { ogContract: '0.9.2' });
    const r = verifyPaintArtifact(dir);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join('\n')).toMatch(/CSP の meta がありません.*移行の印/);

    const dir2 = makeArtifact();
    sign(dir2, { ogContract: '0.10.0' });
    expect(verifyPaintArtifact(dir2).errors.join('\n')).toMatch(/CSP の meta がありません/);
  });

  it("head の先頭の meta（script-src 'self'・object-src 'none'）は合格", () => {
    const dir = makeArtifact({ 'embed.html': withCsp(EMBED_HTML) });
    sign(dir, { ogContract: '0.10.0' });
    const r = verifyPaintArtifact(dir);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join('\n')).not.toMatch(/CSP/);
  });

  it.each([
    ["default-src 'self'; script-src 'self' 'unsafe-inline'; object-src 'none'", /広すぎます: 'unsafe-inline'/],
    ["default-src 'self'; script-src 'self' 'unsafe-eval'; object-src 'none'", /広すぎます: 'unsafe-eval'/],
    ["default-src 'self'; script-src https: 'self'; object-src 'none'", /広すぎます: https:/],
    ["default-src 'self'; script-src blob:; object-src 'none'", /'self' がありません/],
    ["default-src 'self'; script-src 'self'", /object-src 'none' がありません/],
    ["script-src 'self'; object-src 'self'", /object-src 'none' がありません/],
    ["img-src 'self'; object-src 'none'", /script-src（か default-src）がありません/],
  ])('CSP %s は不合格', (content, re) => {
    const r = checkCspMeta(withCsp(EMBED_HTML, content), { ogContract: '0.9.2' });
    expect(r.errors.join('\n')).toMatch(re);
  });

  it("script-src が無くても default-src 'self' なら script は 'self' 扱い", () => {
    expect(checkCspMeta(withCsp(EMBED_HTML, "default-src 'self'; object-src 'none'")).errors).toEqual([]);
  });

  it('meta が script の後にあれば不合格（先に読まれる script を縛れない）', () => {
    const html = EMBED_HTML.replace('</head>', `<meta http-equiv="Content-Security-Policy" content="${CSP}"></head>`);
    expect(checkCspMeta(html).errors.join('\n')).toMatch(/最初の script より後/);
  });

  it('robustness-security-06: 受け入れのタグが m8 以降（m8.1-accepted を含む）なら、契約の版の記録に関係なく meta は必須', () => {
    expect(acceptedMilestone('m8.1-accepted')).toBe(8);
    expect(acceptedMilestone('m7-accepted')).toBe(7);
    expect(acceptedMilestone(null)).toBeNull();
    expect(cspMetaRequired({ ogContract: '0.9.2', ogAccepted: 'm7-accepted' })).toBe(false);
    expect(cspMetaRequired({ ogContract: '0.9.2', ogAccepted: 'm8.1-accepted' })).toBe(true);
    expect(cspMetaRequired({ ogContract: '0.10.3', ogAccepted: null })).toBe(true);
    const dir = makeArtifact();
    // 契約の版を読み違えた（古い値の）記録でも、m8.1-accepted の取り込みなら meta が無ければ不合格
    sign(dir, { ogContract: '0.9.2', ogRef: 'm8.1-accepted', ogAccepted: 'm8.1-accepted' });
    expect(verifyPaintArtifact(dir).errors.join('\n')).toMatch(/CSP の meta がありません/);
    const dir2 = makeArtifact({ 'embed.html': withCsp(EMBED_HTML) });
    sign(dir2, { ogContract: '0.10.3', ogRef: 'm8.1-accepted', ogAccepted: 'm8.1-accepted' });
    expect(verifyPaintArtifact(dir2).errors).toEqual([]);
  });

  it('版の比較', () => {
    expect(compareVersions('0.9.2', '0.10.0')).toBeLessThan(0);
    expect(compareVersions('0.10.0', '0.10.0')).toBe(0);
    expect(compareVersions('0.10.1', '0.10.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0', '0.10.0')).toBeGreaterThan(0);
  });
});

describe('埋め込みの初期 JS の増え方の警告（ilust-sup-followup-04）', () => {
  const KB = 1024;
  it('origin/main の取り込みから +8 KB を超えたら警告、8 KB ちょうどまでは何も言わない', () => {
    const base = { ogCommit: 'b'.repeat(40), ogInitialJsGzipBytes: 538 * KB };
    expect(checkInitialJsGrowth({ ogInitialJsGzipBytes: 538 * KB + 8 * KB }, base)).toEqual([]);
    const w = checkInitialJsGrowth({ ogInitialJsGzipBytes: 538 * KB + 8 * KB + 1 }, base);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/origin\/main の取り込み（OG bbbbbbbbbbbb）の 538\.0 KB から 546\.0 KB gz に \+8\.0 KB/);
    // 減った・同じは何も言わない
    expect(checkInitialJsGrowth({ ogInitialJsGzipBytes: 500 * KB }, base)).toEqual([]);
  });

  it('OG の check-embed の予算 560 KB の 98 %（548.8 KB）を超えたら警告（origin/main が無くても）', () => {
    expect(checkInitialJsGrowth({ ogInitialJsGzipBytes: Math.floor(560 * KB * 0.98) }, null)).toEqual([]);
    const w = checkInitialJsGrowth({ ogInitialJsGzipBytes: Math.floor(560 * KB * 0.98) + 1 }, null);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/予算 560\.0 KB の 98 % を超えています/);
    // m8-accepted の実測 551.8 KB（cycle8）: 予算の 98 % を超え、m7-accepted 538.3 KB からは +13.5 KB = 警告 2 つ
    const both = checkInitialJsGrowth({ ogInitialJsGzipBytes: Math.round(551.8 * KB) }, { ogCommit: 'baabbe0', ogInitialJsGzipBytes: 551_184 });
    expect(both).toHaveLength(2);
  });

  it('どちらかが記録なし（null・schema 1）なら増分は言わない', () => {
    expect(checkInitialJsGrowth({ ogInitialJsGzipBytes: null }, { ogInitialJsGzipBytes: 1 })).toEqual([]);
    expect(checkInitialJsGrowth({ ogInitialJsGzipBytes: 300 * KB }, { ogInitialJsGzipBytes: null })).toEqual([]);
    expect(checkInitialJsGrowth(null, null)).toEqual([]);
  });
});
