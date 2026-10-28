/**
 * 過去の埋め込みで作った「描きかけの下書き」をフィクスチャとして書き出す（ilust-sup-followup-06 の Ilust の側、ADR-0010 D6-4、
 * 受け入れ ilust-draft-cross-version）。通常の e2e には入らない（*.gen.ts）。
 *
 *   OG_DRAFT_FIXTURE_NAME=og-8af7b0f-draft npx playwright test --config=e2e/fixtures/og-fixture.config.ts make-og-draft-fixture
 *
 * **配信中の成果物（取り込み直す前の public/paint/ と、その版の親のアプリ）で**走らせる（例: `git archive <配信中のコミット>` を /tmp に
 * 展開し、このファイルと og-fixture.config.ts を写して回す）。2 つの置き場を両方書く:
 *   - opfs: 既定（Chromium は OPFS の `autosave/<docId>/{entry.json, base-<n>.ognk, j-<n>-<m>.zip}`）
 *   - idb : OPFS を隠した（`StorageManager.prototype.getDirectory` を消した）とき = IndexedDB `og-files-autosave`（版 2、records / files）
 * どちらも、描いて下書きの写しが落ち着いた後の **ディスクの中身そのもの**（OPFS の全ファイル・IDB の全ストア）と、親の印
 * （localStorage `seichotsu.ogDraft.free`）と、そのときの透過 PNG の画素の要約を e2e/fixtures/<name>-<store>.json に書く。
 * 読む側は e2e/19-og-draft-cross-version.spec.ts。
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { drawOg, ogPaperBox, openOgFree, setOgEngine, settledPixels, waitOgContent } from '../og-helpers';

const NAME = process.env['OG_DRAFT_FIXTURE_NAME'] ?? '';
const HERE = dirname(fileURLToPath(import.meta.url));
const MARK_KEY = 'seichotsu.ogDraft.free';
const AUTOSAVE_DB = 'og-files-autosave';

for (const store of ['opfs', 'idb'] as const) {
  test(`過去の埋め込みの下書きのフィクスチャを作る（${store}）`, async ({ page, context }) => {
    test.setTimeout(120_000);
    expect(NAME, 'OG_DRAFT_FIXTURE_NAME（例 og-8af7b0f-draft）').toMatch(/^og-[0-9a-f]{7,12}-draft$/);
    if (store === 'idb') {
      await context.addInitScript(() => {
        delete (StorageManager.prototype as { getDirectory?: unknown }).getDirectory;
      });
    }
    await setOgEngine(page, true);
    const frame = await openOgFree(page);
    await drawOg(page, 2);
    await waitOgContent(frame);
    await waitDraftSettled(page, Date.now() - 1);
    // 最初の写し（base）の後にもう 1 本: 2 回目の写しはジャーナル（j-<n>-<m>）への追記になる = 記録の形を広く押さえる
    const b = await ogPaperBox(page);
    await page.mouse.move(b.x + b.width * 0.62, b.y + b.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.4, b.y + b.height * 0.7, { steps: 14 });
    await page.mouse.up();
    const drawnAt = Date.now();
    await waitDraftSettled(page, drawnAt);
    const pixels = await settledPixels(frame);
    await waitDraftSettled(page, drawnAt);
    const build = (await page.evaluate(async () => (await fetch('/paint/BUILD.json', { cache: 'no-store' })).json())) as {
      ogCommit: string;
      buildId: string;
      ogContract: string;
      embedApi: number;
    };
    // ホーム画面のアプリを閉じた = beforeunload も後始末も走らない。ディスクの中身は別のページで読む（埋め込みを読み込まない）
    await page.close();
    const reader = await context.newPage();
    await reader.goto('/paint/BUILD.json');
    const dump = await reader.evaluate(
      async ({ markKey, dbName }) => {
        const toB64 = (bin: Uint8Array) => {
          let s = '';
          for (let i = 0; i < bin.length; i += 0x8000) s += String.fromCharCode(...bin.subarray(i, i + 0x8000));
          return btoa(s);
        };
        // IndexedDB の値を JSON にする（Uint8Array / ArrayBuffer / Blob / Date に印を付ける）
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
        const opfs: { path: string; b64: string }[] = [];
        if (typeof StorageManager.prototype.getDirectory === 'function') {
          type Dir = FileSystemDirectoryHandle & { entries(): AsyncIterable<[string, FileSystemHandle]> };
          const walk = async (d: Dir, prefix: string): Promise<void> => {
            for await (const [name, h] of d.entries()) {
              const path = prefix ? `${prefix}/${name}` : name;
              if (h.kind === 'directory') await walk(h as Dir, path);
              else opfs.push({ path, b64: toB64(new Uint8Array(await (await (h as FileSystemFileHandle).getFile()).arrayBuffer())) });
            }
          };
          await walk((await navigator.storage.getDirectory()) as Dir, '');
          opfs.sort((a, b) => (a.path < b.path ? -1 : 1));
        }
        let idb: null | {
          version: number;
          stores: { name: string; keyPath: string | string[] | null; autoIncrement: boolean; entries: { key: unknown; value: unknown }[] }[];
        } = null;
        if ((await indexedDB.databases()).some((d) => d.name === dbName)) {
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
          idb = { version: db.version, stores };
          db.close();
        }
        return { mark: localStorage.getItem(markKey), opfs, idb };
      },
      { markKey: MARK_KEY, dbName: AUTOSAVE_DB },
    );
    expect(dump.mark, '親の印').not.toBeNull();
    if (store === 'opfs') expect(dump.opfs.some((f) => /(^|\/)autosave\/[^/]+\/entry\.json$/.test(f.path))).toBe(true);
    else {
      expect(dump.idb?.version).toBe(2);
      expect(dump.idb?.stores.find((s) => s.name === 'records')?.entries.length ?? 0).toBeGreaterThan(0);
    }
    writeFileSync(
      join(HERE, `${NAME}-${store}.json`),
      `${JSON.stringify(
        {
          comment:
            'make-og-draft-fixture.gen.ts が書いた。下書きを作った埋め込みの版、親の印、自動保存の置き場の中身（OPFS の全ファイル / IndexedDB og-files-autosave の全ストア）、そのときの透過 PNG（長辺 2048）の画素の要約',
          ogCommit: build.ogCommit,
          buildId: build.buildId,
          ogContract: build.ogContract,
          embedApi: build.embedApi,
          store,
          createdAt: new Date().toISOString(),
          mark: JSON.parse(dump.mark!),
          opfs: dump.opfs,
          idb: dump.idb,
          pixels: { sha: pixels.sha, opaque: pixels.opaque, w: pixels.w, h: pixels.h },
        },
        null,
        2,
      )}\n`,
    );
    await reader.close();
  });
}

/** 13-og-free.spec.ts の waitDraftSettled と同じ: 印の savedAt が `after` より後で、1.5 秒変わらなければ落ち着いた */
async function waitDraftSettled(page: Page, after: number): Promise<void> {
  const savedAt = () =>
    page.evaluate((k) => Date.parse(JSON.parse(localStorage.getItem(k) ?? 'null')?.savedAt ?? '') || 0, MARK_KEY);
  await expect.poll(savedAt, { timeout: 15_000 }).toBeGreaterThan(after);
  let last = await savedAt();
  for (;;) {
    await page.waitForTimeout(1500);
    const now = await savedAt();
    if (now === last) return;
    last = now;
  }
}
