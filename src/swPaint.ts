/**
 * 埋め込みのペイント（public/paint/ = OG の成果物）の実行時キャッシュを、Service Worker の install で先に埋める（ilust-sup-followup-12）。
 *
 * 背景: /paint/assets/ は「読んだものだけ」CacheFirst で入る。起動段・遅延段のモジュールは ready の前に読み終わるが、モジュールの中で
 * さらに動的 import するダイアログ等（使うまで読まれない）は、オフラインで初めて使う・描いている途中に新しい版が配信されて古いハッシュ名が
 * 配信から消えると「動的 import に失敗」になる。そこで BUILD.json の一覧（ファイルごとの sha256）から assets/ の全部を og-paint-<buildId> に入れる。
 *
 * - 対象: `assets/` の下のファイル（JS のチャンク・CSS・書体の注記など）。字形の `.bin` は workbox の precache に入っている（vite.config）ので除く。
 *   `embed.html` は NetworkFirst（最新を取りに行く）なので除く
 * - 既にキャッシュにあるものは取りに行かない（同じ buildId の SW の更新では 0 件）
 * - 取ったものは **sha256 が BUILD.json と一致したときだけ**入れる（配信の切り替わりで別の中身や SPA の index.html が返っても入れない）
 * - 回線の節約（Save-Data）のときは何もしない（使ったものだけが入る今までの振る舞い）
 * - 失敗は数えるだけで投げない（install を失敗させない。足りない分は使ったときの CacheFirst で入る）
 * - 同時に取りに行く数は PAINT_FILL_CONCURRENCY（回線を占有しない）
 *
 * SW 固有の API には依存しない（cache / fetch / digest を引数で受ける）ので vitest で確かめる（src/swPaint.test.ts）。
 */

/** 実行時キャッシュの件数の下限（今までの値） */
export const PAINT_CACHE_MIN_ENTRIES = 300;
/** 同時に取りに行く数 */
export const PAINT_FILL_CONCURRENCY = 4;
/** install を待たせる上限（これを過ぎたら install は先に進み、残りは SW が生きている間だけ続ける） */
export const PAINT_FILL_INSTALL_BUDGET_MS = 120_000;
/** 埋め込みのペイントの置き場（Ilust のオリジンの中のパス） */
export const PAINT_BASE = '/paint/';

export interface PaintFileEntry {
  /** 例 '/paint/assets/app-D5RTNoZv.js' */
  readonly url: string;
  /** 16 進の小文字の sha256（BUILD.json の files の値） */
  readonly sha256: string;
}

/**
 * 実行時キャッシュの件数の上限（ExpirationPlugin の maxEntries）。埋め込みのファイル数（今 149）より必ず大きくする:
 * 先に埋めた分 + 入口の HTML + 版の切り替わりの間の重なりで足りなくならないよう、ファイル数の 2 倍と下限の大きい方
 */
export function paintCacheMaxEntries(fileCount: number): number {
  const n = Number.isFinite(fileCount) && fileCount > 0 ? Math.ceil(fileCount) : 0;
  return Math.max(PAINT_CACHE_MIN_ENTRIES, n * 2);
}

/** BUILD.json の files（パス → sha256）から先に入れるものの一覧（assets/ の下・.bin 以外・パスと sha256 の形が正しいものだけ。並びは名前順） */
export function paintPrefetchList(files: Readonly<Record<string, string>> | null | undefined): PaintFileEntry[] {
  if (!files || typeof files !== 'object') return [];
  const out: PaintFileEntry[] = [];
  for (const [path, sha] of Object.entries(files)) {
    if (typeof path !== 'string' || typeof sha !== 'string') continue;
    if (!/^assets\/[A-Za-z0-9._-]+$/.test(path)) continue; // 下の階層・.. ・変な文字は入れない
    if (/\.bin$/i.test(path)) continue; // precache 済み
    if (!/^[0-9a-f]{64}$/.test(sha)) continue;
    out.push({ url: `${PAINT_BASE}${path}`, sha256: sha });
  }
  return out.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
}

/** キャッシュの最小の形（Cache Storage の Cache） */
export interface PaintCacheLike {
  match(url: string): Promise<Response | undefined>;
  put(url: string, response: Response): Promise<void>;
}

export interface FillPaintCacheDeps {
  readonly list: readonly PaintFileEntry[];
  /** 入れる先（og-paint-<buildId>） */
  openCache(): Promise<PaintCacheLike>;
  fetch(url: string): Promise<Response>;
  /** バイト列の sha256（16 進の小文字） */
  digest(buf: ArrayBuffer): Promise<string>;
  /** 回線の節約（navigator.connection.saveData）。true なら何もしない */
  readonly saveData?: boolean;
  readonly concurrency?: number;
}

export interface FillPaintCacheResult {
  /** 'save-data' = 回線の節約で何もしなかった */
  readonly skipped: false | 'save-data';
  /** 新しく入れた */
  readonly added: number;
  /** 既にあった */
  readonly present: number;
  /** 取れなかった（通信の失敗・200 以外） */
  readonly failed: number;
  /** 中身の sha256 が BUILD.json と違ったので入れなかった */
  readonly mismatched: number;
}

/** 16 進の sha256（SW と vitest の両方の crypto.subtle） */
export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 一覧の足りない分を取りに行き、sha256 が合うものだけ入れる（投げない） */
export async function fillPaintCache(deps: FillPaintCacheDeps): Promise<FillPaintCacheResult> {
  if (deps.saveData) return { skipped: 'save-data', added: 0, present: 0, failed: 0, mismatched: 0 };
  let added = 0;
  let present = 0;
  let failed = 0;
  let mismatched = 0;
  if (deps.list.length === 0) return { skipped: false, added, present, failed, mismatched };
  let cache: PaintCacheLike;
  try {
    cache = await deps.openCache();
  } catch {
    return { skipped: false, added, present, failed: deps.list.length, mismatched };
  }
  const queue = [...deps.list];
  const worker = async () => {
    for (let e = queue.shift(); e; e = queue.shift()) {
      try {
        if (await cache.match(e.url)) {
          present += 1;
          continue;
        }
        const res = await deps.fetch(e.url);
        if (!res.ok || res.status !== 200) {
          failed += 1;
          continue;
        }
        const buf = await res.arrayBuffer();
        if ((await deps.digest(buf)) !== e.sha256) {
          mismatched += 1;
          continue;
        }
        const headers = new Headers();
        const type = res.headers.get('content-type');
        if (type) headers.set('content-type', type);
        await cache.put(e.url, new Response(buf, { status: 200, headers }));
        added += 1;
      } catch {
        failed += 1;
      }
    }
  };
  const n = Math.max(1, Math.min(deps.concurrency ?? PAINT_FILL_CONCURRENCY, deps.list.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return { skipped: false, added, present, failed, mismatched };
}
