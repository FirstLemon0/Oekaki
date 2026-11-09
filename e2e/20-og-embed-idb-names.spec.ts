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
 * - 片付け（OG ADR-0014 D3-2）: m13 以降の埋め込みで #/free を開くと、古い埋め込みが残した空の `og-files-timelapse` を消す（2 本目の試験、src/ui/og/embedDbCleanup.ts）
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
  // og-subtools（ilust-sup-followup-01、ADR-0014 D3-7）: m13 / m13.1 の埋め込みはキャンバスへの .abr の drop を受けてここに書く（上限 64 MB・512 本・復号 256 MB）。
  // 次の取り込み（m14-accepted 以降）で埋め込みは .abr を受けなくなる。名前は既知の一覧に入れたまま、あったかどうかを記録だけする（合否は変えない）
  test.info().annotations.push({
    type: 'og-subtools',
    description: `${build.ogAccepted ?? '?'}: og-subtools ${og.includes('og-subtools') ? 'あり' : 'なし'}（m13.1 の埋め込みは .abr の drop を受ける、次の取り込みで外れる）`,
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

// 古い埋め込み（m12）が残した空の og-files-timelapse の片付け（OG ADR-0014 D3-2、src/ui/og/embedDbCleanup.ts）:
// m13 以降の埋め込みで #/free を開く（下書きのロックを取れたタブ）と、空なら消える。m12 以前は触らない（埋め込みが自分で作る）。
// 中身のある DB を残すこと・DB を作らないことは vitest（src/ui/og/embedDbCleanup.test.ts）で確かめる
test('embed-idb-cleanup: m13 以降の埋め込みで #/free を開くと、古い埋め込みが残した空の og-files-timelapse が消える', async ({ page }) => {
  test.setTimeout(90_000);
  await setOgEngine(page, true);
  // m12 の埋め込みが作った形（版 1・records（keyPath docId）と frames、中身なし）を先に置く
  await page.evaluate(
    (name) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(name, 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore('records', { keyPath: 'docId' });
          req.result.createObjectStore('frames');
        };
        req.onsuccess = () => {
          req.result.close();
          resolve();
        };
        req.onerror = () => reject(req.error);
      }),
    TIMELAPSE_DB,
  );
  const names = async () => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? ''));
  expect(await names()).toContain(TIMELAPSE_DB);
  await openOgFree(page);
  const build = (await page.evaluate(async () => (await fetch('/paint/BUILD.json', { cache: 'no-store' })).json())) as { ogAccepted?: string | null };
  const ms = acceptedMilestone(build.ogAccepted);
  if (ms !== null && ms >= STRICT_FROM_MILESTONE) {
    await expect.poll(async () => (await names()).includes(TIMELAPSE_DB), { timeout: 15_000, message: `${TIMELAPSE_DB}（空）が片付かない` }).toBe(false);
    // 片付けた後も成長通と埋め込みの DB は残る（ほかの DB に触らない）
    expect((await names()).filter((n) => n.startsWith('og-')).length).toBeGreaterThan(0);
  } else {
    test.info().annotations.push({
      type: 'pending',
      description: `${build.ogAccepted ?? '?'} の埋め込みでは片付けない（m${STRICT_FROM_MILESTONE} 以降で消す。今の埋め込みは ${TIMELAPSE_DB} を自分で作る）`,
    });
    expect(await names()).toContain(TIMELAPSE_DB);
  }
});
