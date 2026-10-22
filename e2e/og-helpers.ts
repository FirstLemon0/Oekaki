/**
 * 新しいお絵描き（#/free の OgFreeDraw = 埋め込みのペイントの iframe、UR-002 S2）の E2E の補助。
 *
 * - 埋め込み（/paint/embed.html）は同じオリジンの iframe。紙は iframe の中の `[data-og-viewport]`。
 *   page.mouse の座標は親のページの座標で、iframe の中へそのまま届く（既定の道具はペン）。
 * - ogEmbed（API v1）は iframe の window にある。画素は ogEmbed の書き出しを iframe の中で読んで比べる。
 */
import { expect, type CDPSession, type Frame, type Page } from '@playwright/test';
import { gotoApp } from './helpers';

export const OG_FRAME = '[data-testid="og-free-frame"]';
export const OG_ROOT = '[data-testid="og-free"]';

/** 設定の「新しいお絵描き（試験中）」を on / off にする（設定画面の操作で） */
export async function setOgEngine(page: Page, on: boolean): Promise<void> {
  await gotoApp(page, '#/settings?section=practice');
  const sw = page.getByRole('switch', { name: '新しいお絵描き（試験中）' });
  await expect(sw).toBeVisible();
  if ((await sw.getAttribute('aria-checked')) !== String(on)) await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', String(on));
}

/** #/free（ほか）を開いて、新しいお絵描きが描ける状態（ready）まで待つ */
export async function openOgFree(page: Page, hash = '#/free'): Promise<Frame> {
  await gotoApp(page, hash);
  await expect(page.locator(`${OG_ROOT}[data-phase="ready"]`)).toBeVisible({ timeout: 30_000 });
  return ogFrame(page);
}

export async function ogFrame(page: Page): Promise<Frame> {
  await expect.poll(() => page.frames().some((f) => /\/paint\/embed\.html$/.test(f.url()))).toBe(true);
  return page.frames().find((f) => /\/paint\/embed\.html$/.test(f.url()))!;
}

/** iframe の中の紙（ビューポート）の矩形（親のページの座標） */
export async function ogPaperBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.frameLocator(OG_FRAME).locator('[data-og-viewport]').first().boundingBox();
  if (!box) throw new Error('新しいお絵描きの紙が見つかりません');
  return box;
}

/** 紙の中央寄りに線を n 本（マウス = ペンの既定の道具で描く） */
export async function drawOg(page: Page, n = 2): Promise<void> {
  const b = await ogPaperBox(page);
  for (let i = 0; i < n; i++) {
    const y = b.y + b.height * (0.35 + i * 0.08);
    await page.mouse.move(b.x + b.width * 0.3, y);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.6, y + b.height * 0.06, { steps: 14 });
    await page.mouse.up();
  }
}

type OgWin = Window & {
  ogEmbed: {
    version: number;
    hasContent(): boolean;
    isDirty(): boolean;
    exportTransparentPng(o: { longEdge: number }): Promise<Blob>;
  };
};

export async function ogHasContent(frame: Frame): Promise<boolean> {
  return frame.evaluate(() => (window as unknown as OgWin).ogEmbed.hasContent());
}

export async function waitOgContent(frame: Frame, want = true): Promise<void> {
  await expect.poll(() => ogHasContent(frame), { timeout: 15_000 }).toBe(want);
}

/** 透過 PNG（長辺 2048）の画素の要約（SHA-256・不透明の画素数・四隅の α） */
export async function ogPixels(frame: Frame): Promise<{ sha: string; opaque: number; w: number; h: number; corners: number[] }> {
  return frame.evaluate(async () => {
    const blob = await (window as unknown as OgWin).ogEmbed.exportTransparentPng({ longEdge: 2048 });
    const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d')!;
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
    let opaque = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) opaque++;
    const at = (x: number, y: number) => d[(y * bmp.width + x) * 4 + 3]!;
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', d));
    return {
      sha: Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join(''),
      opaque,
      w: bmp.width,
      h: bmp.height,
      corners: [at(0, 0), at(bmp.width - 1, 0), at(0, bmp.height - 1), at(bmp.width - 1, bmp.height - 1)],
    };
  });
}

/** 成長通の DB（seichotsu）のストアの全件（Blob は type と size に） */
export async function readStore(page: Page, store: string): Promise<Record<string, unknown>[]> {
  return page.evaluate(
    (name) =>
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const req = indexedDB.open('seichotsu');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(name, 'readonly');
          const all = tx.objectStore(name).getAll();
          tx.oncomplete = () => {
            db.close();
            const flat = (v: unknown): unknown => {
              if (v instanceof Blob) return { blobType: v.type, blobSize: v.size };
              if (Array.isArray(v)) return v.map(flat);
              if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, flat(x)]));
              return v;
            };
            resolve((all.result as unknown[]).map((r) => flat(r) as Record<string, unknown>));
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
    store,
  );
}

/** 単一レコードのストア（profile / streak / settings）の値 */
export async function readSingleton(page: Page, store: string): Promise<Record<string, unknown> | null> {
  return page.evaluate(
    (name) =>
      new Promise<Record<string, unknown> | null>((resolve, reject) => {
        const req = indexedDB.open('seichotsu');
        req.onsuccess = () => {
          const db = req.result;
          const g = db.transaction(name, 'readonly').objectStore(name).get('singleton');
          g.onsuccess = () => {
            db.close();
            resolve((g.result as Record<string, unknown> | undefined) ?? null);
          };
          g.onerror = () => reject(g.error);
        };
        req.onerror = () => reject(req.error);
      }),
    store,
  );
}

/** 「終わる」→「保存して終わる」 */
export async function finishOg(page: Page): Promise<void> {
  await page.getByRole('button', { name: '終わる' }).click();
  await page.getByRole('dialog', { name: '終わる' }).getByRole('button', { name: '保存して終わる' }).click();
  await expect(page.locator(OG_ROOT)).toHaveCount(0, { timeout: 20_000 });
}

/**
 * 長い 1 本の線（CDP の合成ペン、時刻つき）。始まりと終わりの時刻の差 = ms（実時間を待たずに「5 分描いた」を作る）。
 * OG の入力はイベントの timeStamp を使い、onStroke の区間はその時刻（親と同じ Date.now の時計）になる。
 */
export async function longPenStroke(cdp: CDPSession, page: Page, ms: number): Promise<void> {
  const b = await ogPaperBox(page);
  // 時刻は今から先へ伸ばす（同じページで 2 本目を合成すると、先の線の時刻より戻れず区間が崩れる。1 つの試験で 1 本だけ使う）
  const t0 = Date.now() / 1000;
  const x0 = b.x + b.width * 0.35;
  const y0 = b.y + b.height * 0.4;
  const n = 20;
  const send = (type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', i: number, ts: number) =>
    cdp.send('Input.dispatchMouseEvent', {
      type,
      x: x0 + i * 8,
      y: y0 + i * 3,
      button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: 1,
      timestamp: ts,
      pointerType: 'pen',
      force: 0.7,
    });
  await send('mousePressed', 0, t0);
  // 区間の始まりは最初の動き（押し下げの直後に 1 回動かす）、終わりは離したとき
  await send('mouseMoved', 1, t0 + 0.016);
  for (let i = 2; i <= n; i++) await send('mouseMoved', i, t0 + 0.016 + (ms / 1000 - 0.032) * ((i - 1) / (n - 1)));
  await send('mouseReleased', n, t0 + ms / 1000);
}

/**
 * OG の自動保存の記録（ジャーナル）の件数。Chromium では OPFS の `…/autosave/<docId>/entry.json`（OG の createOpfsAutosaveStorage）、
 * OPFS の無い環境では IndexedDB `og-files-autosave`（ロック・メタのストアは数えない）。両方を足す
 */
export async function ogJournalCount(frame: Frame): Promise<number> {
  return frame.evaluate(async () => {
    let opfs = 0;
    try {
      const root = await navigator.storage.getDirectory();
      type Dir = FileSystemDirectoryHandle & { entries(): AsyncIterable<[string, FileSystemHandle]> };
      const walk = async (d: Dir, depth: number): Promise<void> => {
        for await (const [name, h] of d.entries()) {
          if (h.kind !== 'directory') continue;
          const sub = h as Dir;
          if (name === 'autosave') {
            for await (const [, rec] of sub.entries()) {
              if (rec.kind !== 'directory') continue;
              try {
                await (rec as FileSystemDirectoryHandle).getFileHandle('entry.json');
                opfs++;
              } catch {
                // 書きかけ（entry.json が無い）は数えない
              }
            }
          } else if (depth < 3) {
            await walk(sub, depth + 1);
          }
        }
      };
      await walk(root as Dir, 0);
    } catch {
      opfs = 0;
    }
    const dbs = await indexedDB.databases();
    if (!dbs.some((d) => d.name === 'og-files-autosave')) return opfs;
    const db = await new Promise<IDBDatabase>((ok, ng) => {
      const r = indexedDB.open('og-files-autosave');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ng(r.error);
    });
    let n = 0;
    for (const s of Array.from(db.objectStoreNames)) {
      if (/lock|meta/i.test(s)) continue;
      n += await new Promise<number>((ok, ng) => {
        const r = db.transaction(s, 'readonly').objectStore(s).count();
        r.onsuccess = () => ok(r.result);
        r.onerror = () => ng(r.error);
      });
    }
    db.close();
    return n + opfs;
  });
}

/** 描いた線の確定が終わって画素が落ち着くまで待ってから要約を返す（確定は線を離した後に非同期で来る） */
export async function settledPixels(frame: Frame): Promise<{ sha: string; opaque: number; w: number; h: number; corners: number[] }> {
  let prev = await ogPixels(frame);
  for (let i = 0; i < 20; i++) {
    await frame.page().waitForTimeout(400);
    const next = await ogPixels(frame);
    if (next.sha === prev.sha) return next;
    prev = next;
  }
  return prev;
}
