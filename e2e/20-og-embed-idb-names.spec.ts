/**
 * 埋め込みが Ilust のオリジンに作る IndexedDB の名前の一覧（ilust-sup-followup-02 の Ilust の側、ADR-0013 D6-8、受け入れ embed-no-timelapse-db）。
 *
 * UR-002 の約束「既存の IndexedDB のデータを壊さない」を、`og-files-autosave` の版だけでなく **埋め込みが作る DB の名前の一覧** でも見る:
 * #/free で描いて保存した後の `indexedDB.databases()` のうち `og-` で始まるものが、下の既知の一覧に入っていること。
 * 一覧に無い DB が増えたら赤（増やすときは、この一覧と OG の ADR を書き換える）。
 *
 * タイムラプスの保管 `og-files-timelapse`: m12 の埋め込み（OG m12-accepted）は、タイムラプスが off で画面も無いのに文書を開くたびに作る
 * （cycle13 ilust-sup-followup-02、データは壊さない空の DB）。OG の M13 で埋め込みでは登録しない（files の RegisterOptions.timelapse = !embedded）ので、
 * - 受け入れのタグが m13 以降の埋め込み: `og-files-timelapse` が **無い** ことを求める（strict）
 * - m12 以前: あってもよい。あったかどうかを注記に記録する（pending。m13-accepted の取り込み = M14 で strict になる）
 */
import { expect, test } from '@playwright/test';
import { drawOg, finishOg, openOgFree, setOgEngine, waitOgContent } from './og-helpers';

/** 埋め込みが作ってよい IndexedDB（OG の files / materials / gradient / settings / tools-core の保存） */
const KNOWN_OG_DBS = ['og-files-autosave', 'og-files-recent', 'og-materials', 'og-nanika-gradients', 'og-nanika-settings', 'og-subtools'];
/** M13 の OG から埋め込みでは作らない DB（m12 の埋め込みは作る） */
const TIMELAPSE_DB = 'og-files-timelapse';
/** TIMELAPSE_DB を作らないことを求める受け入れの版（m<n>-accepted の n） */
const STRICT_FROM_MILESTONE = 13;

/** 'm12-accepted' / 'm11.1-accepted' → 12 / 11（形が違えば null） */
function acceptedMilestone(tag: unknown): number | null {
  const m = /^m(\d+)(?:\.\d+)?-accepted$/.exec(String(tag ?? ''));
  return m ? Number(m[1]) : null;
}

test('embed-idb-names: 描いて保存した後に埋め込みが作った IndexedDB は既知の一覧だけ（m13 以降は og-files-timelapse も無い）', async ({ page }) => {
  test.setTimeout(90_000);
  await setOgEngine(page, true);
  const frame = await openOgFree(page);
  await drawOg(page, 3);
  await waitOgContent(frame);
  const build = (await page.evaluate(async () => (await fetch('/paint/BUILD.json', { cache: 'no-store' })).json())) as {
    ogCommit?: string;
    ogAccepted?: string | null;
  };
  await finishOg(page);
  const names = (await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? ''))).sort();
  const og = names.filter((n) => n.startsWith('og-'));
  const ms = acceptedMilestone(build.ogAccepted);
  test.info().annotations.push({
    type: 'embed-idb-names',
    description: `OG ${String(build.ogCommit ?? '?').slice(0, 12)} (${build.ogAccepted ?? '-'}): ${og.join(', ')}`,
  });
  expect(og.length, '埋め込みの DB が 1 つも無い（埋め込みが開いていない?）').toBeGreaterThan(0);
  const unknown = og.filter((n) => !KNOWN_OG_DBS.includes(n) && n !== TIMELAPSE_DB);
  expect(unknown, '既知の一覧に無い DB（増やすなら一覧と OG の ADR を書き換える）').toEqual([]);
  const hasTimelapse = og.includes(TIMELAPSE_DB);
  if (ms !== null && ms >= STRICT_FROM_MILESTONE) {
    expect(hasTimelapse, `${TIMELAPSE_DB} は m${STRICT_FROM_MILESTONE} 以降の埋め込みでは作らない（ADR-0013 D6-8）`).toBe(false);
  } else {
    test.info().annotations.push({
      type: 'pending',
      description: `${build.ogAccepted ?? '?'} の埋め込みは ${TIMELAPSE_DB} を${hasTimelapse ? '作る' : '作らない'}（m${STRICT_FROM_MILESTONE} 以降で strict）`,
    });
  }
});
