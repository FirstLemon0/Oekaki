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
 *
 * 他社ブラシ形式（.abr）と `og-subtools`（OG ADR-0014 D10-4・ADR-0015 D6-2 (iv)、ilust-sup-followup-07）: m13 / m13.1 の埋め込みはキャンバスへの .abr の drop を
 * 読み手まで通して `og-subtools` に書く。m14 以降の埋め込みは読み手を登録しない（OG の tools-paint の foreignBrush の既定 = 埋め込みでは off）。
 * - 1 本目の注記（og-subtools のあり / なし）は版で文を分ける（m14 以降 = 「.abr を受けない」）。合否は変えない
 * - 3 本目: 受け入れのタグが m14 以降のときだけ、試験の中で作る小さな .abr（版 1・計算ブラシ 1 本、24 バイト = 第三者のファイルは入れない）を
 *   埋め込みのキャンバスに落とし、「開けませんでした」のトーストが出て、`og-subtools` の presets の件数が変わらないこと（strict）。m13.1 以前は理由つきで飛ばす
 */
import { expect, test, type Page } from '@playwright/test';
import { drawOg, finishOg, openOgFree, setOgEngine, waitOgContent } from './og-helpers';

/** 埋め込みが作ってよい IndexedDB（OG の files / materials / gradient / settings / tools-core の保存） */
const KNOWN_OG_DBS = ['og-files-autosave', 'og-files-recent', 'og-materials', 'og-nanika-gradients', 'og-nanika-settings', 'og-subtools'];
/** M13 の OG から埋め込みでは作らない DB（m12 の埋め込みは作る） */
const TIMELAPSE_DB = 'og-files-timelapse';
/** TIMELAPSE_DB を作らないことを求める受け入れの版（m<n>-accepted の n） */
const STRICT_FROM_MILESTONE = 13;
/** 埋め込みが .abr を受けない（og-subtools に書かない）受け入れの版（OG ADR-0014 D10-4） */
const ABR_REFUSED_FROM_MILESTONE = 14;

/** 'm12-accepted' / 'm11.1-accepted' → 12 / 11（形が違えば null） */
function acceptedMilestone(tag: unknown): number | null {
  const m = /^m(\d+)(?:\.\d+)?-accepted$/.exec(String(tag ?? ''));
  return m ? Number(m[1]) : null;
}

/** 1 本目の og-subtools の注記の文（版で分ける） */
function subtoolsNote(ms: number | null): string {
  if (ms !== null && ms >= ABR_REFUSED_FROM_MILESTONE) return 'm14 以降の埋め込みは .abr を受けない';
  return 'm14 より前の埋め込み（m13 / m13.1）は .abr の drop を受ける、m14 以降の取り込みで外れる';
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
  // m14-accepted 以降の埋め込みは .abr を受けない（3 本目の試験が strict に確かめる）。名前は既知の一覧に入れたまま（サブツールの設定の保存にも使う）、
  // あったかどうかを記録だけする（合否は変えない）。注記の文は版で分ける（ADR-0015 D6-2 (iv)）
  test.info().annotations.push({
    type: 'og-subtools',
    description: `${build.ogAccepted ?? '?'}: og-subtools ${og.includes('og-subtools') ? 'あり' : 'なし'}（${subtoolsNote(ms)}）`,
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

// 他社ブラシ形式（.abr）を受けない（OG ADR-0014 D10-4・ADR-0015 D6-2 (iv)、ilust-sup-followup-07）。受け入れのタグが m14 以降のときだけ strict。
// 落とすのは試験の中で作る版 1 の .abr（計算ブラシ 1 本: 型 1・間隔 25・直径 20・丸さ 100・角度 0・硬さ 100、ビッグエンディアン 24 バイト）。
// 読み手が登録されていれば 1 本読み込んで og-subtools に書く形なので、「開けませんでした」と件数が同じであることが「受けなかった」の判定になる
const ABR_NAME = 'ilust-embed-refused.abr';
function tinyAbr(): number[] {
  const out: number[] = [];
  const i16 = (v: number) => out.push((v >> 8) & 0xff, v & 0xff);
  const i32 = (v: number) => out.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
  i16(1); // 版
  i16(1); // ブラシの数
  i16(1); // 型 1（計算ブラシ）
  i32(14); // 本体の長さ
  i32(0);
  i16(25); // 間隔 %
  i16(20); // 直径 px
  i16(100); // 丸さ %
  i16(0); // 角度
  i16(100); // 硬さ %
  return out;
}

/** og-subtools の state の presets の件数（DB・記録が無ければ 0）。DB を作らないよう、一覧に無ければ開かない（OG の e2e/embed/embed-abr-refused と同じ読み方） */
async function persistedSubtools(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const names = (await indexedDB.databases()).map((d) => d.name);
    if (!names.includes('og-subtools')) return 0;
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('og-subtools');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    try {
      if (!db.objectStoreNames.contains('state')) return 0;
      const v = await new Promise<unknown>((res, rej) => {
        const g = db.transaction('state', 'readonly').objectStore('state').get('state');
        g.onsuccess = () => res(g.result);
        g.onerror = () => rej(g.error);
      });
      const presets = (v as { presets?: Record<string, unknown> } | undefined)?.presets;
      return presets ? Object.keys(presets).length : 0;
    } finally {
      db.close();
    }
  });
}

test('embed-abr-refused: m14 以降の埋め込みはキャンバスに落とした .abr を受けない（『開けませんでした』のトースト、og-subtools の件数は変わらない）', async ({ page }) => {
  test.setTimeout(90_000);
  await setOgEngine(page, true);
  const frame = await openOgFree(page);
  const build = (await page.evaluate(async () => (await fetch('/paint/BUILD.json', { cache: 'no-store' })).json())) as { ogAccepted?: string | null };
  const ms = acceptedMilestone(build.ogAccepted);
  test.skip(ms === null || ms < ABR_REFUSED_FROM_MILESTONE, `${build.ogAccepted ?? '?'} の埋め込みは .abr の drop を受ける（m${ABR_REFUSED_FROM_MILESTONE} 以降で strict）`);
  const before = await persistedSubtools(page);
  const target = frame.locator('[data-og-viewport]').first();
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  if (!box) throw new Error('新しいお絵描きの紙が見つかりません');
  // DataTransfer と File は iframe の中で作って、紙に dragenter → dragover → drop を送る（座標は iframe の中の座標）
  await target.evaluate(
    (el, [bytes, name]) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(bytes as number[])], name as string, { type: 'application/octet-stream' }));
      const r = el.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
      el.dispatchEvent(new DragEvent('dragenter', opts));
      el.dispatchEvent(new DragEvent('dragover', opts));
      el.dispatchEvent(new DragEvent('drop', opts));
    },
    [tinyAbr(), ABR_NAME] as const,
  );
  const toast = frame.locator('.og-w-toast').filter({ hasText: ABR_NAME });
  await expect(toast.first(), '.abr を開けないトースト（埋め込みは読み手を登録しない）').toBeVisible({ timeout: 30_000 });
  const text = (await toast.first().innerText()).replace(/\s+/g, ' ');
  expect(text).toContain(`${ABR_NAME} を開けませんでした`);
  expect(text, '他社ブラシ形式の読み込みに進んでいない').not.toContain('他社ブラシ形式');
  await expect(frame.locator('.og-w-dialog').filter({ hasText: '他社ブラシ形式の読み込み' })).toHaveCount(0);
  expect(await persistedSubtools(page), 'og-subtools の presets の件数は落とす前と同じ').toBe(before);
  test.info().annotations.push({ type: 'embed-abr-refused', description: `${build.ogAccepted}: subtools ${before} → ${before}、toast「${text}」` });
});
