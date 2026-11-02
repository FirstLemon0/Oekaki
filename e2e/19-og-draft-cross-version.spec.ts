/**
 * 版をまたいだ下書き（ilust-sup-followup-06 の Ilust の側、ADR-0010 D6-4、受け入れ ilust-draft-cross-version）。
 *
 * 配信中の版（親 fc97d5d + 埋め込み OG 8af7b0f）で「描きかけ」のまま閉じた利用者の端末には、OG の自動保存の記録（ジャーナル）と
 * 親の印（localStorage `seichotsu.ogDraft.free`）が残っている。新しい版を配信した日にその端末で #/free を開くと、
 * 『描きかけがあります』→『続きから』で同じ画素の絵が開けること（= 埋め込みの取り込みで下書きが黙って消えない・読めなくならない）を確かめる。
 *
 * 配信した版ごとにフィクスチャを持つ: 8af7b0f（2026-10-28 まで配信）と b1433b4（m9.1-accepted、2026-10-30 の push で配信、ilust-sup-followup-02 / ADR-0011 D6-2）、
 * 8ea71f2（m10.2-accepted、取り込み直しの前に先に作った、ADR-0012 D6-2）。版は e2e/fixtures/ の列挙（ilust-sup-followup-05）。
 * フィクスチャ（e2e/fixtures/og-<版>-draft-{opfs,idb}.json）は make-og-draft-fixture.gen.ts がその版の配信中の成果物で書いた
 * **ディスクの中身そのもの**:
 *   - opfs: Chromium の既定。OPFS の `autosave/<docId>/{entry.json, base-<n>.ognk, j-<n>-<m>.zip}`
 *   - idb : OPFS の無い端末。IndexedDB `og-files-autosave`（版 2、records / files）。新しい埋め込みがこの DB の版を上げると
 *           upgrade で全部のストアを消す（OG src/files/autosave.ts）ので、開いた後も版 2 のままであることも確かめる
 * 変えるのは日時だけ（印の savedAt と記録の savedAt を「今の 1 分前」に寄せる。印の期限 24 時間・自動保存の掃除 7 日に掛からないように）。
 * 形・バイトはフィクスチャのまま書く。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { gotoApp } from './helpers';
import { finishOg, ogFrame, ogJournalCount, ogPixels, openOgFree, OG_ROOT, readStore, setOgEngine, waitOgContent } from './og-helpers';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const MARK_KEY = 'seichotsu.ogDraft.free';
const AUTOSAVE_DB = 'og-files-autosave';
/**
 * 配信した（配信しうる）埋め込みの OG の版 = e2e/fixtures/og-<版>-draft-{opfs,idb}.json の列挙（ilust-sup-followup-05、ADR-0012 D6-2）。
 * 手書きの一覧を持たない（make-og-draft-fixture.gen.ts で足した版は自動で入る）。8af7b0f と b1433b4 は check-ilust-remote.mjs の
 * facts.paint.ogCommit で 2026-10-28 / 2026-10-30 に配信を確かめた版、8ea71f2（m10.2-accepted）は取り込み直しの前に先に作った版（D6-2）
 */
const DRAFT_FIXTURE = /^og-([0-9a-f]{7,12})-draft-(opfs|idb)\.json$/;
const DRAFT_FILES = readdirSync(FIXTURES).filter((f) => DRAFT_FIXTURE.test(f));
const SERVED_VERSIONS = [...new Set(DRAFT_FILES.map((f) => DRAFT_FIXTURE.exec(f)![1]!))].sort();
/**
 * 今の public/paint/ の埋め込みの版。フィクスチャを先に作った（ADR-0012 D6-2）直後のコミットでは、最新のフィクスチャの版がまだ
 * 今の埋め込みと同じ = 版をまたがない。その版は「次の取り込みの後に版をまたぐ試験」なので、このときだけ理由を残して飛ばす
 * （下の ilust-fixture-enumeration が、版をまたぐフィクスチャが 1 つ以上あることを確かめる = 空振りにしない）
 */
const CURRENT_OG = (() => {
  const p = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'paint', 'BUILD.json');
  return existsSync(p) ? ((JSON.parse(readFileSync(p, 'utf8')) as { ogCommit?: string }).ogCommit ?? '') : '';
})();
const sameAsCurrent = (ver: string) => CURRENT_OG !== '' && CURRENT_OG.startsWith(ver);

test('ilust-fixture-enumeration: 下書きのフィクスチャの一覧が空でなく、どの版も opfs と idb がそろい、今の埋め込みと版をまたぐものがある', () => {
  expect(SERVED_VERSIONS.length, 'e2e/fixtures/og-<版>-draft-{opfs,idb}.json が 1 つも無い').toBeGreaterThan(0);
  for (const ver of SERVED_VERSIONS) {
    for (const store of ['opfs', 'idb'] as const) {
      expect(DRAFT_FILES, `og-${ver}-draft-${store}.json`).toContain(`og-${ver}-draft-${store}.json`);
    }
  }
  expect(CURRENT_OG, 'public/paint/BUILD.json の ogCommit').toMatch(/^[0-9a-f]{40}$/);
  expect(SERVED_VERSIONS.filter((v) => !sameAsCurrent(v)).length, '今の埋め込みと版をまたぐ下書きのフィクスチャが無い').toBeGreaterThan(0);
});

interface DraftFixture {
  ogCommit: string;
  ogContract: string;
  embedApi: number;
  store: 'opfs' | 'idb';
  mark: { engine: 'og'; docId: string; savedAt: string; continueId: string | null };
  opfs: { path: string; b64: string }[];
  idb: null | {
    version: number;
    stores: { name: string; keyPath: string | string[] | null; autoIncrement: boolean; entries: { key: IDBValidKey; value: unknown }[] }[];
  };
  pixels: { sha: string; opaque: number; w: number; h: number };
}

for (const SERVED_OG of SERVED_VERSIONS) for (const store of ['opfs', 'idb'] as const) {
  test(`ilust-draft-cross-version: 配信中の埋め込み（${SERVED_OG}）で作った下書き（${store}）を今の埋め込みが『続きから』で同じ画素で開く`, async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    test.skip(
      sameAsCurrent(SERVED_OG),
      `og-${SERVED_OG} は今の public/paint/ と同じ版（取り込み直しの前に先に作ったフィクスチャ、ADR-0012 D6-2）= 版をまたがない。次の取り込みの後に走る`,
    );
    const fx = JSON.parse(readFileSync(join(FIXTURES, `og-${SERVED_OG}-draft-${store}.json`), 'utf8')) as DraftFixture;
    expect(fx.ogCommit.startsWith(SERVED_OG)).toBe(true);
    expect(fx.store).toBe(store);
    if (store === 'idb') {
      // OPFS の無い端末: 埋め込みは IndexedDB の置き場を使う（OG core/runtime/platform.ts の capabilities.opfs）
      await context.addInitScript(() => {
        delete (StorageManager.prototype as { getDirectory?: unknown }).getDirectory;
      });
      expect(fx.idb?.version).toBe(2);
    }
    // 現在の build が今の埋め込みであること（フィクスチャの版と違う = 版をまたいでいる）
    await setOgEngine(page, true);
    const served = (await page.evaluate(async () => (await fetch('/paint/BUILD.json', { cache: 'no-store' })).json())) as { ogCommit: string };
    expect(served.ogCommit.startsWith(SERVED_OG), '今の public/paint/ が配信中と同じ版だと版をまたいだ試験にならない').toBe(false);

    // 前の版が残したものを書く（アプリの JS が動かない同じオリジンのページで）
    await page.goto('/manifest.webmanifest');
    const at = new Date(Date.now() - 60_000).toISOString();
    await page.evaluate(
      async ({ fx, at, markKey, dbName }) => {
        const fromB64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const dec = (v: unknown): unknown => {
          if (Array.isArray(v)) return v.map(dec);
          if (v && typeof v === 'object') {
            const t = v as { __t?: string; b64?: string; type?: string; iso?: string };
            if (t.__t === 'u8') return fromB64(t.b64!);
            if (t.__t === 'ab') return fromB64(t.b64!).buffer;
            if (t.__t === 'blob') return new Blob([fromB64(t.b64!)], { type: t.type ?? '' });
            if (t.__t === 'date') return new Date(t.iso!);
            const o: Record<string, unknown> = {};
            for (const [k, x] of Object.entries(v)) o[k] = dec(x);
            return o;
          }
          return v;
        };
        // 記録の日時だけ今に寄せる（形は変えない）
        const touch = (rec: Record<string, unknown>) => (typeof rec['savedAt'] === 'string' ? { ...rec, savedAt: at } : rec);
        if (fx.opfs.length > 0) {
          const root = await navigator.storage.getDirectory();
          for (const f of fx.opfs) {
            const parts = f.path.split('/');
            let d = root;
            for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
            let bytes = fromB64(f.b64);
            if (/(^|\/)autosave\/[^/]+\/entry\.json$/.test(f.path)) {
              bytes = new TextEncoder().encode(JSON.stringify(touch(JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>)));
            }
            const w = await (await d.getFileHandle(parts[parts.length - 1]!, { create: true })).createWritable();
            await w.write(bytes);
            await w.close();
          }
        }
        if (fx.idb) {
          const idb = fx.idb;
          await new Promise<void>((resolve, reject) => {
            const req = indexedDB.open(dbName, idb.version);
            req.onupgradeneeded = () => {
              for (const s of idb.stores) req.result.createObjectStore(s.name, { keyPath: s.keyPath ?? undefined, autoIncrement: s.autoIncrement });
            };
            req.onsuccess = () => {
              const db = req.result;
              const tx = db.transaction(
                idb.stores.map((s) => s.name),
                'readwrite',
              );
              for (const s of idb.stores) {
                const os = tx.objectStore(s.name);
                for (const e of s.entries) {
                  let value = dec(e.value);
                  if (s.name === 'records' && value && typeof value === 'object') value = touch(value as Record<string, unknown>);
                  if (s.keyPath === null) os.put(value, e.key);
                  else os.put(value);
                }
              }
              tx.oncomplete = () => {
                db.close();
                resolve();
              };
              tx.onerror = () => reject(tx.error);
            };
            req.onerror = () => reject(req.error);
          });
        }
        localStorage.setItem(markKey, JSON.stringify({ ...fx.mark, savedAt: at }));
      },
      { fx, at, markKey: MARK_KEY, dbName: AUTOSAVE_DB },
    );

    // 新しい版の #/free:『描きかけがあります』→『続きから』
    await gotoApp(page, '#/free');
    const offer = page.getByRole('dialog', { name: '描きかけがあります' });
    await expect(offer).toBeVisible({ timeout: 30_000 });
    await offer.getByRole('button', { name: '続きから' }).click();
    await expect(page.locator(`${OG_ROOT}[data-phase="ready"]`)).toBeVisible({ timeout: 30_000 });
    const frame = await ogFrame(page);
    await waitOgContent(frame);
    // 書き出し（透過 PNG・長辺 2048）の画素のハッシュが、前の版で描いたときと同じ
    await expect.poll(async () => (await ogPixels(frame)).sha, { timeout: 15_000 }).toBe(fx.pixels.sha);
    const now = await ogPixels(frame);
    expect({ opaque: now.opaque, w: now.w, h: now.h }).toEqual({ opaque: fx.pixels.opaque, w: fx.pixels.w, h: fx.pixels.h });
    if (store === 'idb') {
      // 今の埋め込みは og-files-autosave の版を上げていない（上げると upgrade で前の版の下書きが全部消える）
      const v = await page.evaluate(async (n) => (await indexedDB.databases()).find((d) => d.name === n)?.version ?? null, AUTOSAVE_DB);
      expect(v).toBe(2);
    }

    // 保存して終わると、印もジャーナルも残らない（前の版の記録も新しい版が片付ける）
    await finishOg(page);
    expect(await page.evaluate((k) => localStorage.getItem(k), MARK_KEY)).toBeNull();
    expect(await readStore(page, 'drawings')).toHaveLength(1);
    const again = await openOgFree(page);
    await expect(page.getByRole('dialog', { name: '描きかけがあります' })).toHaveCount(0);
    expect(await ogJournalCount(again)).toBe(0);
  });
}
