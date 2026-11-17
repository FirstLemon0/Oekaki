/**
 * 過去の埋め込みで利用者が変えた「設定」と「サブツール」の実物の控え（OG ADR-0018 D6-1 (iii)・cycle18 ilust-sup-followup-05、
 * 受け入れ ilust-settings-fixture）。通常の e2e には入らない（*.gen.ts）。
 *
 *   OG_SETTINGS_FIXTURE_NAME=og-1cb6433-stores npx playwright test --config=e2e/fixtures/og-fixture.config.ts make-og-settings-fixture
 *
 * **取り込み直す前の public/paint/ で**走らせる（m17 の埋め込みは起動の時に `og-nanika-settings` の `customize.keymap.user` を 1 回書き直す
 * = `defaultsRev` の移し替え。m16 以前の埋め込みが書いた設定の実物は、その版の埋め込みでしか作れない）。
 * 埋め込みの画面の操作だけで次の 3 つを変える（親のページから IndexedDB に書き込まない = 埋め込み自身が書いた形のまま残す）:
 *   1. ショートカットキー設定（Ctrl+Alt+Shift+K）で「全体表示」に F2 を割り当てる。F2 は既定（m16 = 切り取り、global）と衝突するので
 *      「置き換える」を選ぶ → 差分 = added {F2 → 全体表示} / removed {F2 → 切り取り}（後の既定と衝突する利用者のキー）
 *   2. 選択ペンのブラシサイズを変える（ツールプロパティのスライダーを矢印キーで）→ `og-subtools`
 *   3. 環境設定（Ctrl+K）のクイックアクセスの表示を「アイコンだけ」にする → `customize.quickAccess.display`
 * そのあと `og-nanika-settings` と `og-subtools` の全ストア（版・keyPath・全件）を e2e/fixtures/<name>-idb.json に書く。
 * 読む側は e2e/20-og-embed-idb-names.spec.ts の embed-settings-cross-version（書き戻して今の埋め込みで開く）。
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { OG_FRAME, openOgFree, setOgEngine } from '../og-helpers';

const NAME = process.env['OG_SETTINGS_FIXTURE_NAME'] ?? '';
const HERE = dirname(fileURLToPath(import.meta.url));
const DBS = ['og-nanika-settings', 'og-subtools'] as const;
/** F2 を割り当てるコマンドの題名（埋め込みで隠れない・押しても絵を変えない） */
const F2_TARGET_TITLE = '全体表示';

/** 埋め込みの中の何も描かない場所（キャンバスの下のステータスバー）を押して、キーが iframe（キャンバスの領域）に届くようにする */
async function focusEmbed(page: Page, f: FrameLocator): Promise<void> {
  await f.locator('[data-og-viewport]').first().focus().catch(() => {});
  await f.locator('.og-canvas-status').first().click();
  await page.waitForTimeout(200);
}

async function idbDump(page: Page): Promise<unknown> {
  const frame = page.frames().find((x) => /\/paint\/embed\.html$/.test(x.url()))!;
  return frame.evaluate(async (names) => {
    const toB64 = (bin: Uint8Array) => {
      let s = '';
      for (let i = 0; i < bin.length; i += 0x8000) s += String.fromCharCode(...bin.subarray(i, i + 0x8000));
      return btoa(s);
    };
    const enc = async (v: unknown): Promise<unknown> => {
      if (v instanceof Uint8Array) return { __t: 'u8', b64: toB64(v) };
      if (v instanceof ArrayBuffer) return { __t: 'ab', b64: toB64(new Uint8Array(v)) };
      if (v instanceof Blob) return { __t: 'blob', type: v.type, b64: toB64(new Uint8Array(await v.arrayBuffer())) };
      if (v instanceof Date) return { __t: 'date', iso: v.toISOString() };
      if (Array.isArray(v)) return Promise.all(v.map(enc));
      if (v && typeof v === 'object') {
        const o: Record<string, unknown> = {};
        for (const [k, x] of Object.entries(v)) o[k] = await enc(x);
        return o;
      }
      return v;
    };
    const out: Record<string, unknown> = {};
    const have = (await indexedDB.databases()).map((d) => d.name);
    for (const dbName of names) {
      if (!have.includes(dbName)) {
        out[dbName] = null;
        continue;
      }
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open(dbName);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const stores = [];
      for (const name of Array.from(db.objectStoreNames)) {
        const raw = await new Promise<{ keys: IDBValidKey[]; values: unknown[]; keyPath: string | string[] | null; autoIncrement: boolean }>(
          (resolve, reject) => {
            const tx = db.transaction(name, 'readonly');
            const os = tx.objectStore(name);
            const k = os.getAllKeys();
            const v = os.getAll();
            tx.oncomplete = () => resolve({ keys: k.result, values: v.result, keyPath: os.keyPath, autoIncrement: os.autoIncrement });
            tx.onerror = () => reject(tx.error);
          },
        );
        const entries = [];
        for (let i = 0; i < raw.keys.length; i++) entries.push({ key: raw.keys[i], value: await enc(raw.values[i]) });
        stores.push({ name, keyPath: raw.keyPath, autoIncrement: raw.autoIncrement, entries });
      }
      out[dbName] = { version: db.version, stores };
      db.close();
    }
    return out;
  }, [...DBS]);
}

type Dump = Record<string, { version: number; stores: { name: string; entries: { key: unknown; value: unknown }[] }[] } | null>;
const settingOf = (d: Dump, key: string): unknown =>
  d['og-nanika-settings']?.stores.find((s) => s.name === 'settings')?.entries.find((e) => e.key === key)?.value;

test('過去の埋め込みの設定とサブツールの実物の控えを作る', async ({ page }) => {
  test.setTimeout(180_000);
  expect(NAME, 'OG_SETTINGS_FIXTURE_NAME（例 og-1cb6433-stores）').toMatch(/^og-[0-9a-f]{7,12}-stores$/);
  await setOgEngine(page, true);
  await openOgFree(page);
  const f = page.frameLocator(OG_FRAME);
  const build = (await page.evaluate(async () => (await fetch('/paint/BUILD.json', { cache: 'no-store' })).json())) as {
    ogCommit: string;
    buildId: string;
    ogContract: string;
    embedApi: number;
    ogAccepted?: string | null;
  };

  // 1. ショートカットキー設定: 全体表示 ← F2（置き換える）
  await focusEmbed(page, f);
  await page.keyboard.press('Control+Alt+Shift+KeyK');
  const keys = f.locator('[data-customize="shortcuts"]');
  await expect(keys).toBeVisible({ timeout: 15_000 });
  await keys.getByRole('searchbox').fill(F2_TARGET_TITLE);
  const row = keys.locator('.og-cu-keys__row').filter({ has: f.locator('.og-cu-keys__name', { hasText: new RegExp(`^${F2_TARGET_TITLE}$`) }) }).first();
  await row.click();
  const targetId = await row.getAttribute('data-command');
  expect(targetId).toBeTruthy();
  await keys.locator('.og-cu-keys__add').click();
  await expect(keys.locator('[data-capturing]')).toBeVisible();
  await page.keyboard.press('F2');
  const warn = keys.locator('.og-cu-keys__warn');
  await expect(warn, 'F2 は既定（切り取り）と衝突する').toBeVisible();
  const conflictText = (await warn.innerText()).replace(/\s+/g, ' ');
  await warn.locator('.og-cu-keys__replace').click();
  await expect(keys.locator(`.og-cu-keys__chip[data-chord="F2"]`)).toBeVisible();
  await page.screenshot({ path: 'playwright-report/w1cfg/settings-1-keys.png' });
  await f.locator('.og-w-dialog').filter({ has: keys }).getByRole('button', { name: 'OK', exact: true }).click();
  await expect(keys).toHaveCount(0);

  // 2. 選択ペンのブラシサイズ（ツールの一覧の「選択ペン」→ ツールプロパティの「ブラシサイズ」を → で 5 つ上げる）
  await f.getByRole('button', { name: '選択ペン', exact: true }).first().click();
  const size = f.getByRole('slider', { name: /ブラシサイズ/ }).first();
  await expect(size).toBeVisible();
  const before = await size.getAttribute('aria-valuenow');
  await size.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await expect.poll(() => size.getAttribute('aria-valuenow')).not.toBe(before);
  const after = await size.getAttribute('aria-valuenow');
  await page.screenshot({ path: 'playwright-report/w1cfg/settings-2-selpen.png' });
  // ペンに戻す（最後に使ったサブツールが選択ペンのままだと、開いた直後に描く試験がずれる）
  await f.getByRole('button', { name: 'ペン', exact: true }).last().click();

  // 3. 環境設定: クイックアクセスの表示 = アイコンだけ
  await focusEmbed(page, f);
  await page.keyboard.press('Control+KeyK');
  const prefs = f.locator('.og-w-dialog').filter({ hasText: '環境設定' }).last();
  await expect(prefs).toBeVisible({ timeout: 15_000 });
  await prefs.getByRole('tab', { name: 'インターフェース' }).click().catch(async () => {
    await prefs.getByText('インターフェース', { exact: true }).first().click();
  });
  const qa = prefs.getByRole('button', { name: /クイックアクセスの表示/ }).first();
  await qa.scrollIntoViewIfNeeded();
  await qa.click();
  await f.getByRole('option', { name: 'アイコンだけ' }).click();
  await page.screenshot({ path: 'playwright-report/w1cfg/settings-3-prefs.png' });
  await prefs.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(prefs).toHaveCount(0);

  // 書き込みが落ち着くまで（3 つの値が IndexedDB に揃う）
  let dump: Dump = {};
  await expect
    .poll(
      async () => {
        dump = (await idbDump(page)) as Dump;
        const km = settingOf(dump, 'customize.keymap.user') as { added?: { chord: string; id: string }[] } | undefined;
        const qaDisp = settingOf(dump, 'customize.quickAccess.display');
        const sub = JSON.stringify(dump['og-subtools'] ?? null);
        return Boolean(km?.added?.some((b) => b.chord === 'F2' && b.id === targetId)) && qaDisp === 'icon' && sub.length > 20;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  await page.waitForTimeout(1500);
  dump = (await idbDump(page)) as Dump;

  writeFileSync(
    join(HERE, `${NAME}-idb.json`),
    `${JSON.stringify(
      {
        comment:
          'make-og-settings-fixture.gen.ts が書いた。埋め込みの画面で F2 → 全体表示（置き換える）・選択ペンのブラシサイズ・クイックアクセスの表示（アイコンだけ）を変えた後の og-nanika-settings と og-subtools の全ストア（埋め込みが書いたまま）',
        ogCommit: build.ogCommit,
        buildId: build.buildId,
        ogContract: build.ogContract,
        embedApi: build.embedApi,
        ogAccepted: build.ogAccepted ?? null,
        createdAt: new Date().toISOString(),
        changed: {
          keymap: { chord: 'F2', id: targetId, title: F2_TARGET_TITLE, conflict: conflictText, choice: 'replace' },
          selectionPenBrushSize: { before: Number(before), after: Number(after), via: 'ArrowRight x5' },
          quickAccessDisplay: 'icon',
        },
        dbs: dump,
      },
      null,
      2,
    )}\n`,
  );
});
