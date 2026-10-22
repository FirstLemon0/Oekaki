/**
 * 今の public/paint/ の埋め込みで小さい絵を描いて保存し、その .ognk と画素の要約をフィクスチャとして書く（ilust-sup-followup-06）。
 * 使い方は og-fixture.config.ts。保存は画面の操作（『終わる』→『保存して終わる』）で行い、ogDocs の bytes をそのまま書き出す。
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { drawOg, finishOg, openOgFree, setOgEngine, settledPixels, waitOgContent } from '../og-helpers';

const NAME = process.env['OG_FIXTURE_NAME'] ?? '';
const HERE = dirname(fileURLToPath(import.meta.url));

test('過去の埋め込みの .ognk のフィクスチャを作る', async ({ page }) => {
  expect(NAME, 'OG_FIXTURE_NAME（例 og-8af7b0f）').toMatch(/^og-[0-9a-f]{7,12}$/);
  await setOgEngine(page, true);
  const frame = await openOgFree(page);
  await drawOg(page, 3);
  await waitOgContent(frame);
  const pixels = await settledPixels(frame);
  const build = (await page.evaluate(async () => (await fetch('/paint/BUILD.json', { cache: 'no-store' })).json())) as {
    ogCommit: string;
    buildId: string;
  };
  await finishOg(page);
  const doc = await page.evaluate(
    () =>
      new Promise<{ b64: string; ogContract: string; embedApi: number; meta: unknown }>((resolve, reject) => {
        const req = indexedDB.open('seichotsu');
        req.onsuccess = () => {
          const tx = req.result.transaction(['ogDocs', 'drawings'], 'readonly');
          const docs = tx.objectStore('ogDocs').getAll();
          const drawings = tx.objectStore('drawings').getAll();
          tx.oncomplete = async () => {
            const d = (docs.result as { id: string; bytes: Blob; ogContract: string; embedApi: number }[])[0]!;
            const w = (drawings.result as { id: string; meta: { og: unknown } }[]).find((x) => x.id === d.id)!;
            const bin = new Uint8Array(await d.bytes.arrayBuffer());
            let s = '';
            for (let i = 0; i < bin.length; i += 0x8000) s += String.fromCharCode(...bin.subarray(i, i + 0x8000));
            resolve({ b64: btoa(s), ogContract: d.ogContract, embedApi: d.embedApi, meta: w.meta.og });
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );
  const bytes = Buffer.from(doc.b64, 'base64');
  writeFileSync(join(HERE, `${NAME}.ognk`), bytes);
  writeFileSync(
    join(HERE, `${NAME}.json`),
    `${JSON.stringify(
      {
        comment: 'make-og-fixture.gen.ts が書いた。.ognk を書いた埋め込みの版と、そのときの透過 PNG（長辺 2048）の画素の要約',
        ogCommit: build.ogCommit,
        buildId: build.buildId,
        ogContract: doc.ogContract,
        embedApi: doc.embedApi,
        og: doc.meta,
        ognkBytes: bytes.length,
        pixels: { sha: pixels.sha, opaque: pixels.opaque, w: pixels.w, h: pixels.h },
      },
      null,
      2,
    )}\n`,
  );
});
