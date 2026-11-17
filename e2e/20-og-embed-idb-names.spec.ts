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
 *
 * 作品 ID（`.ognk` の manifest の `workId`、OG ADR-0016 D6-1 (v)・cycle16 ilust-sup-followup-02）: m15 の埋め込みは契約 0.13.3 のまま、保存する `.ognk` の manifest に
 * 作品 ID（UUID、36 字）を書き、開いた `.ognk` の値を引き継ぐ（m14 以前は書かない。どちらの向きでも開ける = 形の変化だが互換）。
 * - 4 本目: 受け入れのタグが m15 以降のときだけ、描いて保存した `ogDocs` の `.ognk` に作品 ID があり、ギャラリーの『続きから描く』で描き足して保存し直しても同じ値（strict）。
 *   m14 以前は「書かない」を注記に記録する（pending。m15-accepted の取り込み = M16 で strict になる）
 *
 * m16 の埋め込み（OG m16-accepted = 1cb64330、契約 0.13.4、OG ADR-0017 D6-1 (v)・cycle17 ilust-sup-followup §2）: 新しい IndexedDB の名前は無い
 * （`KNOWN_OG_DBS` の 6 つのまま、m16 用の新しい分岐は要らない）。埋め込みに届く M16 の変化は M16 の候補 4 で変わった埋め込みの既定
 * （#6 の既定のキー = F2 / F3 / F4・Z・N・Ctrl+G など。ただし `files.*`・`shell.nextTab/prevTab` 宛ては埋め込みで外れる。#8 Shift+ホイール = 回転。
 * #16 選択ペン / 選択消しのサブツールの欄）で、`og-nanika-settings`・`og-subtools` の**保存の形**は変えていない（OG ADR-0017 D6-5）。
 * 1 本目は m16 以降でこの 1 行を `embed-defaults` の注記に残す（合否は変えない。物理キーボード / ホイールが前提で、ペンだけの操作は変わらない）。
 *
 * m17 の埋め込み（OG m17-accepted = E 166b7276 / C 0f2d4e5c、契約 0.13.4、OG ADR-0018 D6-1 (vi)(vii)・cycle18 ilust-sup-followup-01 / -05）: 新しい IndexedDB の名前は無い
 * （`KNOWN_OG_DBS` の 6 つのまま）。埋め込みに届く M17 の変化（`EMBED_DEFAULTS_M17`）= F2（切り取りの別キー）/ F3 / F4・Shift+F7 は**キャンバスの領域だけ**
 * （scope canvas。スライダーの直接入力・サブツールの名前の変更の F2 と同時に動かない = M16 の F2 の誤動作の直し、cycle17 fidelity-ui-workflow-01）、
 * Ctrl+B = レイヤーカラーの切り替え、刻印の配列（JIS / US）で変わる既定、`defaultsRev`（起動の時に印の古い `customize.keymap.user` を 1 回だけ書き直す移し替え =
 * 前の版で利用者が足したキーと同じキーの新しい既定を外し、info の通知を 1 件）。1 本目は m17 以降でこの 1 行も `embed-defaults` の注記に残す（合否は変えない）。
 * 5 本目（embed-settings-cross-version）: m16 の埋め込みが書いた設定とサブツールの実物（e2e/fixtures/og-<版>-stores-idb.json、make-og-settings-fixture.gen.ts）を
 * 書き戻して今の埋め込みで開く → 起動のエラー 0・利用者の F2（全体表示）が残り切り取りに戻らない・選択ペンのブラシサイズとクイックアクセスの表示が残る。
 * m17 以降は `defaultsRev` = 17 の印と移し替えの通知が 1 回（2 回目の起動で通知なし）を strict に求める。フィクスチャと同じ版の埋め込みでは理由つきで飛ばす。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { expect, test, type Page } from '@playwright/test';
import { gotoApp } from './helpers';
import { drawOg, finishOg, ogPixels, openOgFree, setOgEngine, waitOgContent } from './og-helpers';

/** 埋め込みが作ってよい IndexedDB（OG の files / materials / gradient / settings / tools-core の保存） */
const KNOWN_OG_DBS = ['og-files-autosave', 'og-files-recent', 'og-materials', 'og-nanika-gradients', 'og-nanika-settings', 'og-subtools'];
/** M13 の OG から埋め込みでは作らない DB（m12 の埋め込みは作る） */
const TIMELAPSE_DB = 'og-files-timelapse';
/** TIMELAPSE_DB を作らないことを求める受け入れの版（m<n>-accepted の n） */
const STRICT_FROM_MILESTONE = 13;
/** 埋め込みが .abr を受けない（og-subtools に書かない）受け入れの版（OG ADR-0014 D10-4） */
const ABR_REFUSED_FROM_MILESTONE = 14;
/** 埋め込みが保存する .ognk の manifest に作品 ID（workId）を書く受け入れの版（OG ADR-0016 D6-1） */
const WORK_ID_FROM_MILESTONE = 15;
/** M16 の候補 4 で埋め込みの既定（#6 のキー・Shift+ホイール・#16）が変わった受け入れの版（OG ADR-0017 D6-1 (v)、注記だけ） */
const EMBED_DEFAULTS_M16 = 16;
/** M17 で埋め込みの既定（F2 / F3 / F4・Shift+F7 はキャンバスだけ・Ctrl+B・JIS の刻印・defaultsRev の移し替え）が変わった受け入れの版（OG ADR-0018 D6-1 (vii)、注記と 5 本目） */
const EMBED_DEFAULTS_M17 = 17;

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
  if (ms !== null && ms >= EMBED_DEFAULTS_M16) {
    test.info().annotations.push({
      type: 'embed-defaults',
      description: `${build.ogAccepted}: M16 の候補 4 で変わった埋め込みの既定（#6 のキー・Shift+ホイール = 回転・#16 選択ペン / 選択消しの欄）。DB の名前と保存の形は不変`,
    });
  }
  if (ms !== null && ms >= EMBED_DEFAULTS_M17) {
    test.info().annotations.push({
      type: 'embed-defaults',
      description: `${build.ogAccepted}: M17 で変わった埋め込みの既定（F2 / F3 / F4・Shift+F7 はキャンバスの領域だけ = M16 の F2 の誤動作の直し、Ctrl+B = レイヤーカラー、JIS / US の刻印の既定、defaultsRev の移し替え = 前の版で足したキーと衝突する新しい既定を 1 回だけ外して通知）。DB の名前は不変`,
    });
  }
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

/** 成長通の DB の ogDocs の全件（id・drawingId と、.ognk の manifest の workId。workId が無い・形が違えば null） */
async function ogDocWorkIds(page: Page): Promise<{ id: string; drawingId: string; workId: string | null }[]> {
  const rows = await page.evaluate(
    () =>
      new Promise<{ id: string; drawingId: string; b64: string }[]>((resolve, reject) => {
        const req = indexedDB.open('seichotsu');
        req.onsuccess = () => {
          const g = req.result.transaction('ogDocs', 'readonly').objectStore('ogDocs').getAll();
          g.onsuccess = async () => {
            req.result.close();
            const out: { id: string; drawingId: string; b64: string }[] = [];
            for (const r of g.result as { id: string; drawingId: string; bytes: Blob }[]) {
              const u8 = new Uint8Array(await r.bytes.arrayBuffer());
              let bin = '';
              for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
              out.push({ id: r.id, drawingId: r.drawingId, b64: btoa(bin) });
            }
            resolve(out);
          };
          g.onerror = () => reject(g.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );
  return rows.map(({ id, drawingId, b64 }) => {
    const files = unzipSync(new Uint8Array(Buffer.from(b64, 'base64')), { filter: (f) => f.name === 'manifest.json' });
    const manifest = JSON.parse(strFromU8(files['manifest.json']!)) as { workId?: unknown };
    const workId = typeof manifest.workId === 'string' && /^[0-9a-f-]{36}$/i.test(manifest.workId) ? manifest.workId : null;
    return { id, drawingId, workId };
  });
}

test('embed-ognk-work-id: m15 以降の埋め込みは保存した .ognk に作品 ID を書き、『続きから描く』で描き足して保存し直しても同じ値', async ({ page }) => {
  test.setTimeout(120_000);
  await setOgEngine(page, true);
  const frame = await openOgFree(page);
  const build = (await page.evaluate(async () => (await fetch('/paint/BUILD.json', { cache: 'no-store' })).json())) as { ogAccepted?: string | null };
  const ms = acceptedMilestone(build.ogAccepted);
  await drawOg(page, 2);
  await waitOgContent(frame);
  await finishOg(page);
  const first = await ogDocWorkIds(page);
  expect(first, '保存した ogDocs は 1 件').toHaveLength(1);
  if (ms === null || ms < WORK_ID_FROM_MILESTONE) {
    test.info().annotations.push({
      type: 'pending',
      description: `${build.ogAccepted ?? '?'} の埋め込みは .ognk に作品 ID を${first[0]!.workId ? '書く' : '書かない'}（m${WORK_ID_FROM_MILESTONE} 以降で strict）`,
    });
    return;
  }
  const workId = first[0]!.workId;
  expect(workId, '.ognk の manifest の workId（UUID 36 字）').not.toBeNull();
  // ギャラリーの『続きから描く』→ 描き足す → 保存し直す: 同じ ogDocs の 1 件が置き換わり、作品 ID は変わらない
  await gotoApp(page, `#/gallery/${first[0]!.drawingId}`);
  await page.getByRole('link', { name: '続きから描く' }).click();
  await expect(page).toHaveURL(/#\/free\?og=/);
  const frame2 = await openOgFree(page, new URL(page.url()).hash);
  await waitOgContent(frame2);
  await drawOg(page, 1);
  await finishOg(page);
  const second = await ogDocWorkIds(page);
  expect(second, '描き足して保存し直しても ogDocs は 1 件のまま').toHaveLength(1);
  expect(second[0]!.id).toBe(first[0]!.id);
  expect(second[0]!.workId, '開いた .ognk の作品 ID を引き継ぐ').toBe(workId);
  test.info().annotations.push({ type: 'embed-ognk-work-id', description: `${build.ogAccepted}: workId ${workId}（保存し直しても同じ）` });
});

// 設定とサブツールの版またぎ（OG ADR-0018 D6-1 (iii)(vii)・cycle18 ilust-sup-followup-05、受け入れ ilust-settings-fixture）。
// フィクスチャ e2e/fixtures/og-<版>-stores-idb.json = その版の埋め込みの画面で「F2 → 全体表示（置き換える）・選択ペンのブラシサイズ・
// クイックアクセスの表示 = アイコンだけ」を変えた後の og-nanika-settings / og-subtools の全ストア（make-og-settings-fixture.gen.ts、埋め込みが書いたまま）。
// 書き戻して今の埋め込みを開き、利用者の値が残ることを見る。m17 以降は defaultsRev の移し替え（印 17・切り取りの既定 F2（canvas）を removed へ・通知 1 回）も strict。
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const STORES_FIXTURE = /^og-([0-9a-f]{7,12})-stores-idb\.json$/;
const STORES_FILES = readdirSync(FIXTURES).filter((f) => STORES_FIXTURE.test(f)).sort();
/** m17 の移し替えの通知（OG strings/ja/customize.json の customize.keys.defaultsMigrated の頭） */
const MIGRATED_TOAST = '前の版で追加したショートカットと同じキーに新しい既定の割当があったため';

interface StoresFixture {
  ogCommit: string;
  ogAccepted: string | null;
  changed: {
    keymap: { chord: string; id: string };
    selectionPenBrushSize: { before: number; after: number };
    quickAccessDisplay: string;
  };
  dbs: Record<string, null | { version: number; stores: { name: string; keyPath: string | string[] | null; autoIncrement: boolean; entries: { key: IDBValidKey; value: unknown }[] }[] }>;
}

interface KeyBinding {
  chord: string;
  id: string;
  scope?: string;
}
interface UserKeymapValue {
  version: number;
  added?: KeyBinding[];
  removed?: KeyBinding[];
  defaultsRev?: number;
}

/** og-nanika-settings の settings ストアの 1 件・og-subtools の state（埋め込みの iframe とは別に、親のページから読む = 同じオリジン） */
async function readOgStores(page: Page): Promise<{ keymap: UserKeymapValue | null; qaDisplay: unknown; selPenSize: unknown }> {
  return page.evaluate(async () => {
    const open = (name: string) =>
      new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    const get = (db: IDBDatabase, store: string, key: string) =>
      new Promise<unknown>((res, rej) => {
        const g = db.transaction(store, 'readonly').objectStore(store).get(key);
        g.onsuccess = () => res(g.result);
        g.onerror = () => rej(g.error);
      });
    const s = await open('og-nanika-settings');
    const keymap = (await get(s, 'settings', 'customize.keymap.user')) as UserKeymapValue | null;
    const qaDisplay = await get(s, 'settings', 'customize.quickAccess.display');
    s.close();
    const t = await open('og-subtools');
    const state = (await get(t, 'state', 'state')) as { presets?: Record<string, { settings?: { size?: unknown } }> } | undefined;
    t.close();
    return { keymap: keymap ?? null, qaDisplay, selPenSize: state?.presets?.['selection.pen.pen']?.settings?.size };
  });
}

test('embed-settings-fixtures: 設定とサブツールの実物の控えが 1 つ以上ある（e2e/fixtures/og-<版>-stores-idb.json）', () => {
  expect(STORES_FILES.length, 'make-og-settings-fixture.gen.ts で取り込み直しの前に作る（OG ADR-0018 D6-1 (iii)）').toBeGreaterThan(0);
});

for (const file of STORES_FILES) {
  test(`embed-settings-cross-version: ${file}（前の版の埋め込みが書いた設定・サブツール）を今の埋め込みで開くと利用者の値が残る（m17 以降は defaultsRev の移し替えと通知 1 回）`, async ({ page }) => {
    test.setTimeout(150_000);
    const fx = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as StoresFixture;
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await setOgEngine(page, true);
    const build = (await page.evaluate(async () => (await fetch('/paint/BUILD.json', { cache: 'no-store' })).json())) as { ogCommit: string; ogAccepted?: string | null };
    test.skip(
      build.ogCommit.startsWith(STORES_FIXTURE.exec(file)![1]!),
      `${file} は今の public/paint/ と同じ版（取り込み直しの前に作ったフィクスチャ、OG ADR-0018 D6-1 (iii)）= 版をまたがない。次の取り込みの後に走る`,
    );
    const ms = acceptedMilestone(build.ogAccepted);
    const want = fx.changed;

    // 前の版の埋め込みが書いたものをそのまま書く（アプリの JS が動かない同じオリジンのページで）
    await page.goto('/manifest.webmanifest');
    await page.evaluate(async (dbs) => {
      for (const [name, db] of Object.entries(dbs)) {
        if (!db) continue;
        await new Promise<void>((res, rej) => {
          const d = indexedDB.deleteDatabase(name);
          d.onsuccess = () => res();
          d.onerror = () => rej(d.error);
        });
        await new Promise<void>((resolve, reject) => {
          const req = indexedDB.open(name, db.version);
          req.onupgradeneeded = () => {
            for (const s of db.stores) req.result.createObjectStore(s.name, { keyPath: s.keyPath ?? undefined, autoIncrement: s.autoIncrement });
          };
          req.onsuccess = () => {
            const conn = req.result;
            const tx = conn.transaction(db.stores.map((s) => s.name), 'readwrite');
            for (const s of db.stores) for (const e of s.entries) tx.objectStore(s.name).put(e.value, s.keyPath ? undefined : e.key);
            tx.oncomplete = () => {
              conn.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
          req.onerror = () => reject(req.error);
        });
      }
    }, fx.dbs);

    // 1 回目の起動
    const frame = await openOgFree(page);
    const toast = frame.locator('.og-w-toast').filter({ hasText: MIGRATED_TOAST });
    if (ms !== null && ms >= EMBED_DEFAULTS_M17) {
      await expect.poll(async () => (await readOgStores(page)).keymap?.defaultsRev, { timeout: 20_000, message: 'defaultsRev の印（移し替え）' }).toBe(EMBED_DEFAULTS_M17);
      await expect(toast, '移し替えの通知（info）が 1 件').toHaveCount(1, { timeout: 10_000 });
    } else {
      await page.waitForTimeout(3000);
      test.info().annotations.push({
        type: 'pending',
        description: `${build.ogAccepted ?? '?'} の埋め込みは defaultsRev の移し替えをしない（m${EMBED_DEFAULTS_M17} 以降で strict）`,
      });
    }
    const first = await readOgStores(page);
    const added = first.keymap?.added ?? [];
    const removed = first.keymap?.removed ?? [];
    expect(added, `利用者が足した ${want.keymap.chord} → ${want.keymap.id} が残る`).toContainEqual(expect.objectContaining({ chord: want.keymap.chord, id: want.keymap.id }));
    expect(removed, '前の版で「置き換える」で外した切り取りの F2 は外れたまま').toContainEqual(expect.objectContaining({ chord: 'F2', id: 'edit-ops.cut', scope: 'global' }));
    if (ms !== null && ms >= EMBED_DEFAULTS_M17) {
      expect(removed, '新しい既定（F2 = 切り取り、キャンバスの領域）も外す（移し替え）').toContainEqual(expect.objectContaining({ chord: 'F2', id: 'edit-ops.cut', scope: 'canvas' }));
    }
    expect(first.qaDisplay, 'クイックアクセスの表示').toBe(want.quickAccessDisplay);
    expect(first.selPenSize, '選択ペンのブラシサイズ（og-subtools）').toBe(want.selectionPenBrushSize.after);

    // 画面でも: 選択ペンのブラシサイズ
    const f = page.frameLocator('[data-testid="og-free-frame"]');
    await f.getByRole('button', { name: '選択ペン', exact: true }).first().click();
    await expect(f.getByRole('slider', { name: /ブラシサイズ/ }).first()).toHaveAttribute('aria-valuenow', String(want.selectionPenBrushSize.after));
    await f.getByRole('button', { name: 'ペン', exact: true }).last().click();

    // 2 回目の起動: 通知は出ない・印と割当はそのまま
    await gotoApp(page, '#/');
    const frame2 = await openOgFree(page);
    await page.waitForTimeout(3000);
    await expect(frame2.locator('.og-w-toast').filter({ hasText: MIGRATED_TOAST }), '2 回目の起動で通知なし').toHaveCount(0);
    const second = await readOgStores(page);
    expect(second.keymap, '2 回目の起動で差分を書き直さない').toEqual(first.keymap);

    // 押して確かめる: キャンバスの領域で F2 = 全体表示（切り取りにならない = 描いた線が残る）
    await drawOg(page, 2);
    await waitOgContent(frame2);
    const before = await ogPixels(frame2);
    await f.locator('[data-og-viewport]').first().focus().catch(() => {});
    await f.locator('.og-canvas-status').first().click();
    await page.keyboard.press('F2');
    await page.waitForTimeout(1500);
    const after = await ogPixels(frame2);
    expect(after.opaque, 'F2 で絵が切り取られない（利用者の F2 = 全体表示が先に動く）').toBe(before.opaque);
    expect(errors, '起動のエラー').toEqual([]);
    test.info().annotations.push({
      type: 'embed-settings-cross-version',
      description: `${fx.ogAccepted ?? fx.ogCommit.slice(0, 7)} → ${build.ogAccepted ?? build.ogCommit.slice(0, 7)}: keymap ${JSON.stringify(first.keymap)}, qa ${String(first.qaDisplay)}, selPen ${String(first.selPenSize)}`,
    });
  });
}
