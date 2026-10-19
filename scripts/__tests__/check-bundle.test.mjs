// 初期 JS の予算と埋め込みのペイントの混入の検査（受け入れ ilust-initial-js-budget・ilust-precache-scope）。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkBundle, initialGraph, precacheUrls } from '../check-bundle.mjs';

const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function fakeDist({ manifest, files, sw }) {
  const dist = mkdtempSync(join(tmpdir(), 'bundle-'));
  dirs.push(dist);
  mkdirSync(join(dist, '.vite'), { recursive: true });
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, '.vite', 'manifest.json'), JSON.stringify(manifest));
  for (const [f, body] of Object.entries(files)) writeFileSync(join(dist, f), body);
  writeFileSync(join(dist, 'sw.js'), sw ?? 'precacheAndRoute([{"revision":"1","url":"index.html"},{"revision":null,"url":"assets/index.js"}])');
  return dist;
}

const GOOD = {
  manifest: {
    'index.html': { file: 'assets/index.js', isEntry: true, imports: ['_shared.js'], dynamicImports: ['src/ui/screens/FreeDraw.tsx'] },
    '_shared.js': { file: 'assets/shared.js' },
    'src/ui/screens/FreeDraw.tsx': { file: 'assets/FreeDraw.js', isDynamicEntry: true, imports: ['index.html'] },
  },
  files: { 'assets/index.js': 'console.log("entry")', 'assets/shared.js': 'export const s=1', 'assets/FreeDraw.js': 'fetch("/paint/embed.html")' },
};
const BUDGET = { baselineGzipKB: 1, ratchetKB: 20 };
const exists = (src) => src === 'src/ui/screens/FreeDraw.tsx';

describe('check-bundle', () => {
  it('入口 + 静的 import の閉包を数え、遅延のチャンクは数えない', () => {
    const g = initialGraph(GOOD.manifest);
    expect(g.files).toEqual(['assets/index.js', 'assets/shared.js']);
    const { errors, report } = checkBundle({ dist: fakeDist(GOOD), budget: BUDGET, srcExists: exists });
    expect(errors).toEqual([]);
    expect(report.files.map((f) => f.file)).toEqual(['assets/index.js', 'assets/shared.js']);
  });

  it('上限（基準線 + 20 KB）を超えたら失敗', () => {
    const { errors } = checkBundle({ dist: fakeDist(GOOD), budget: { baselineGzipKB: -20, ratchetKB: 20 }, srcExists: exists });
    expect(errors.join('\n')).toMatch(/上限/);
  });

  it('自由お絵描きが静的に入口へ入ったら失敗', () => {
    const manifest = {
      'index.html': { file: 'assets/index.js', isEntry: true, imports: ['src/ui/screens/FreeDraw.tsx'] },
      'src/ui/screens/FreeDraw.tsx': { file: 'assets/FreeDraw.js' },
    };
    const { errors } = checkBundle({ dist: fakeDist({ manifest, files: { 'assets/index.js': '', 'assets/FreeDraw.js': '' } }), budget: BUDGET, srcExists: exists });
    expect(errors.join('\n')).toMatch(/FreeDraw\.tsx が遅延の入口/);
  });

  it('ペイントの URL や API の字面・paint/ のモジュールが入口の静的な木にあれば失敗', () => {
    const files = { ...GOOD.files, 'assets/shared.js': 'const u = "/paint/embed.html"; window.ogEmbed;' };
    const { errors } = checkBundle({ dist: fakeDist({ ...GOOD, files }), budget: BUDGET, srcExists: exists });
    expect(errors.join('\n')).toMatch(/\/paint\\\/embed/);
    expect(errors.join('\n')).toMatch(/ogEmbed/);

    const manifest = { ...GOOD.manifest, 'index.html': { ...GOOD.manifest['index.html'], imports: ['_shared.js', 'paint/assets/x.js'] }, 'paint/assets/x.js': { file: 'assets/shared.js' } };
    const r2 = checkBundle({ dist: fakeDist({ ...GOOD, manifest }), budget: BUDGET, srcExists: exists });
    expect(r2.errors.join('\n')).toMatch(/入口の静的な木にあります: paint\/assets\/x\.js/);
  });

  it('precache: paint/** は失敗（字形の .bin の明示だけ許す）、.vite/ も失敗', () => {
    const sw = 'x([{"revision":"a","url":"index.html"},{"revision":"b","url":"paint/assets/font.bin"},{"revision":"c","url":"paint/assets/embed.js"},{"revision":"d","url":".vite/manifest.json"}])';
    const { errors, report } = checkBundle({ dist: fakeDist({ ...GOOD, sw }), budget: BUDGET, srcExists: exists });
    expect(report.precachePaint).toEqual(['paint/assets/font.bin', 'paint/assets/embed.js']);
    expect(errors.join('\n')).toMatch(/precache に埋め込みのペイントがあります.*embed\.js/);
    expect(errors.join('\n')).not.toMatch(/font\.bin/);
    expect(errors.join('\n')).toMatch(/\.vite\/manifest\.json/);
    expect(precacheUrls('{url:"a.js",revision:null},{"url":"b.js"}')).toEqual(['a.js', 'b.js']);
  });
});
