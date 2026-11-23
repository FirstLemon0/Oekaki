// tools/e2e-first-failure.mjs（safe-push の STOP の行の failed=…、OG ADR-0020 D6-2 (v)・cycle20 ilust-sup-followup-05 (a)）の純関数の試験。
// Playwright の JSON の記録（--reporter=json）の形: suites（ファイル）→ suites（describe）→ specs → tests（project ごと、status）。
import { describe, expect, it } from 'vitest';
import { FAILED_MAX_CHARS, firstFailure, oneLine } from '../e2e-first-failure.mjs';

const spec = (title, status, { projectName = 'chromium', file } = {}) => ({
  title,
  ok: status !== 'unexpected',
  ...(file ? { file } : {}),
  tests: [{ projectName, status, results: [{ status: status === 'unexpected' ? 'failed' : 'passed' }] }],
});

describe('e2e-first-failure: firstFailure', () => {
  it('書かれた順で最初に落ちた spec を <file>::<describe › 題> で返す（後ろの失敗・skipped・flaky は見ない）', () => {
    const report = {
      suites: [
        { title: '01-a.spec.ts', file: '01-a.spec.ts', specs: [spec('通る', 'expected'), spec('飛ばす', 'skipped')], suites: [] },
        {
          title: '13-og-free.spec.ts',
          file: '13-og-free.spec.ts',
          specs: [spec('上の段で通る', 'expected')],
          suites: [
            {
              title: '新しいお絵描き',
              file: '13-og-free.spec.ts',
              specs: [spec('揺れたが通った', 'flaky'), spec('ギャラリーから続けると同じ画素', 'unexpected', { file: '13-og-free.spec.ts' })],
              suites: [],
            },
          ],
        },
        { title: '20-z.spec.ts', file: '20-z.spec.ts', specs: [spec('後ろの失敗', 'unexpected')] },
      ],
      errors: [],
    };
    expect(firstFailure(report)).toBe('13-og-free.spec.ts::新しいお絵描き › ギャラリーから続けると同じ画素');
  });

  it('chromium 以外の project（SW を有効にした chromium-sw）は [project] を足す', () => {
    const report = { suites: [{ title: 'sw/01.spec.ts', file: 'sw/01.spec.ts', specs: [spec('更新を保留', 'unexpected', { projectName: 'chromium-sw' })] }] };
    expect(firstFailure(report)).toBe('sw/01.spec.ts::更新を保留 [chromium-sw]');
  });

  it('spec.ok = false だけの記録（tests の status が無い古い形）も落ちたと読む', () => {
    const report = { suites: [{ title: 'x.spec.ts', file: 'x.spec.ts', specs: [{ title: '古い形', ok: false, tests: [] }] }] };
    expect(firstFailure(report)).toBe('x.spec.ts::古い形');
  });

  it('spec が落ちていないのに全体のエラー（webServer など）があれば (global)::<最初の行>', () => {
    const report = { suites: [], errors: [{ message: 'Error: Timed out waiting 120000ms from config.webServer.\n    at …' }] };
    expect(firstFailure(report)).toBe('(global)::Error: Timed out waiting 120000ms from config.webServer.');
  });

  it('全部通った・空・形の違う記録は空文字', () => {
    expect(firstFailure({ suites: [{ title: 'a', file: 'a', specs: [spec('ok', 'expected')] }], errors: [] })).toBe('');
    expect(firstFailure({})).toBe('');
    expect(firstFailure(null)).toBe('');
    expect(firstFailure('x')).toBe('');
  });

  it('TAB・改行は空白にし（STOP の行の列を崩さない）、長い題は切る', () => {
    const report = { suites: [{ title: 'a.spec.ts', file: 'a.spec.ts', specs: [spec('題\tに\nTAB と\r\n改行', 'unexpected')] }] };
    const r = firstFailure(report);
    expect(r).toBe('a.spec.ts::題 に TAB と 改行');
    expect(r).not.toMatch(/[\t\r\n]/);
    const long = firstFailure({ suites: [{ title: 'a.spec.ts', file: 'a.spec.ts', specs: [spec('x'.repeat(1000), 'unexpected')] }] });
    expect(long.length).toBe(FAILED_MAX_CHARS);
    expect(long.endsWith('…')).toBe(true);
    expect(oneLine('  a \t b  ')).toBe('a b');
  });
});
