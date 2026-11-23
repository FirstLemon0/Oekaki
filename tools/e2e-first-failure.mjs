#!/usr/bin/env node
/**
 * Playwright の JSON の記録（--reporter=json、PLAYWRIGHT_JSON_OUTPUT_NAME）から「最初に落ちた spec::題」を 1 行で出す
 * （tools/safe-push.sh の STOP の行の failed=…、OG ADR-0020 D6-2 (v)・cycle20 ilust-sup-followup-05 (a)）。
 *
 *   node tools/e2e-first-failure.mjs <report.json>   … 標準出力に 1 行（見つからなければ空、読めなければ exit 1）
 *
 * 形: `<spec のファイル>::<describe › … › 題>`（project が chromium 以外なら ` [<project>]` を足す）。
 * spec が 1 つも落ちていないのに全体のエラー（webServer が起きない・設定の誤りなど、JSON の errors[]）があれば `(global)::<最初の行>`。
 * TAB・改行は空白にし（STOP の行の列を崩さない）、長すぎる題は 300 字で切る。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FAILED_MAX_CHARS = 300;

/** TAB・改行を空白にし、続く空白を 1 つにして切る */
export function oneLine(s, max = FAILED_MAX_CHARS) {
  const t = String(s ?? '')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Playwright の test の status（expected / unexpected / flaky / skipped）で落ちたもの = unexpected（--retries=0 なので flaky は出ない） */
const isFailedTest = (t) => t?.status === 'unexpected';

/**
 * 記録の木を書かれた順にたどり、最初に落ちた spec を返す（純関数）。戻り値: 1 行の文字列（無ければ ''）。
 * report: Playwright の JSON reporter の出力（{ suites: [{ title, file, specs: [{ title, ok, file, tests: [{ projectName, status }] }], suites: [...] }], errors: [...] }）
 */
export function firstFailure(report) {
  if (!report || typeof report !== 'object') return '';
  const walk = (suite, titles, file) => {
    const f = suite?.file ?? file;
    for (const spec of suite?.specs ?? []) {
      const bad = (spec?.tests ?? []).find(isFailedTest) ?? (spec?.ok === false ? (spec?.tests ?? [])[0] ?? {} : null);
      if (bad) {
        const project = bad?.projectName && bad.projectName !== 'chromium' ? ` [${bad.projectName}]` : '';
        return oneLine(`${spec?.file ?? f ?? '?'}::${[...titles, spec?.title ?? '?'].join(' › ')}${project}`);
      }
    }
    for (const child of suite?.suites ?? []) {
      const hit = walk(child, [...titles, child?.title ?? ''].filter(Boolean), f);
      if (hit) return hit;
    }
    return '';
  };
  for (const top of report.suites ?? []) {
    // ファイルの段（title = ファイル名）は題に入れない
    const hit = walk(top, [], top?.file ?? top?.title);
    if (hit) return hit;
  }
  const err = (report.errors ?? [])[0];
  if (err) return oneLine(`(global)::${String(err.message ?? err.value ?? JSON.stringify(err)).split('\n')[0]}`);
  return '';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: e2e-first-failure.mjs <report.json>');
    process.exit(2);
  }
  let report;
  try {
    report = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.error(`e2e-first-failure: ${path} を読めません: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  process.stdout.write(firstFailure(report));
}
