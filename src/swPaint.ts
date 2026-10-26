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
 * - install のときは、遅い回線（effectiveType が slow-2g / 2g / 3g）とモバイル回線（connection.type === 'cellular'）でも入れない
 *   （ilust-sup-followup-09。読めるブラウザだけ）。その場合は新しいお絵描きの ready の後の 'og-paint-fill' の message で埋める
 *   （使う端末だけが取りに行く。Save-Data は message でも入れない）
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

/** 先に入れない理由（'save-data' = 回線の節約、'slow-connection' = 遅い回線、'cellular' = モバイル回線） */
export type PaintFillSkip = 'save-data' | 'slow-connection' | 'cellular';

/** navigator.connection（Network Information API）の読む分だけ。読めないブラウザでは undefined */
export interface ConnectionLike {
  readonly saveData?: boolean;
  readonly effectiveType?: string;
  readonly type?: string;
}

/** 遅い回線とみなす effectiveType（ilust-sup-followup-09） */
export const SLOW_EFFECTIVE_TYPES: readonly string[] = ['slow-2g', '2g', '3g'];

/**
 * 先に入れるのを止める理由（無ければ null）。
 * - 'install' … SW の install（新しいお絵描きを開かない端末も含む）: Save-Data・遅い回線・モバイル回線で止める
 * - 'message' … 新しいお絵描きの ready の後の 'og-paint-fill'（使う端末）: Save-Data だけで止める
 */
export function paintFillSkipReason(conn: ConnectionLike | null | undefined, trigger: 'install' | 'message'): PaintFillSkip | null {
  if (!conn) return null;
  if (conn.saveData === true) return 'save-data';
  if (trigger === 'message') return null;
  if (typeof conn.type === 'string' && conn.type === 'cellular') return 'cellular';
  if (typeof conn.effectiveType === 'string' && SLOW_EFFECTIVE_TYPES.includes(conn.effectiveType)) return 'slow-connection';
  return null;
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
  /** 止める理由（paintFillSkipReason の結果）。あれば何もしない */
  readonly skip?: PaintFillSkip | null;
  readonly concurrency?: number;
}

export interface FillPaintCacheResult {
  /** 何もしなかった理由（false = 埋めた） */
  readonly skipped: false | PaintFillSkip;
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
  const skip = deps.skip ?? (deps.saveData ? 'save-data' : null);
  if (skip) return { skipped: skip, added: 0, present: 0, failed: 0, mismatched: 0 };
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

/* ------------------------------------------------------------------------------------------------------------------
 * 1 つ前の版の og-paint-* を残す（ilust-sup-followup-02）
 *
 * 新しい SW は skipWaiting + clientsClaim で描きかけのページ（更新を保留中 = 古い版の embed.html とハッシュ名）も握る。
 * activate で古い og-paint-* をすぐ消すと、そのページのまだ読んでいないチャンクは新しいキャッシュにも配信（Render は新しい版だけ）にも無く 404 になる。
 * そこで:
 * - activate: 今の版と「1 つ前の版」のキャッシュを残し、それ以外の og-paint-* を消す。activate の時に開いていたページ（= 前の版で読み込まれた）
 *   の client id を記録する（メタの小さな JSON を SW_META_CACHE に置く。SW は途中で止まりうるので記憶に持たない）
 * - 1 つ前は「次の activate」か「ページから message（'og-paint-prune' / 'og-paint-fill'）が届いたとき」に、記録した client が
 *   clients.matchAll() に 1 つも残っていない（古い版のページが無い）ことを確かめてから消す
 * - SW のバイトだけが変わった（ペイントの版が同じ）activate では、1 つ前と記録した client をそのまま引き継ぐ
 * - /paint/assets/ は今のキャッシュに無ければ、ほかの og-paint-* を全部見てからネットワークへ（matchInPaintCaches）
 * ------------------------------------------------------------------------------------------------------------------ */

/** 埋め込みのペイントの実行時キャッシュの名前の頭 */
export const PAINT_CACHE_PREFIX = 'og-paint-';
/** SW の記録（1 つ前の版・その時のページ）の置き場（og-paint- で始めない = 掃除の対象にしない） */
export const SW_META_CACHE = 'seichotsu-sw-meta';
/** SW_META_CACHE の中の鍵（スコープの中の偽の URL） */
export const PAINT_META_PATH = '/__seichotsu-sw/og-paint-meta.json';

export interface PaintCacheMeta {
  readonly v: 1;
  /** 今の版のキャッシュの名前（og-paint-<buildId>） */
  readonly current: string;
  /** 残している 1 つ前の版のキャッシュの名前（ふつう 0〜1 個） */
  readonly previous: readonly string[];
  /** 1 つ前の版で読み込まれたページ（activate の時に開いていた window client の id）。ここが空になったら 1 つ前を消せる */
  readonly oldClients: readonly string[];
}

/** 記録の JSON を読む（形が違えば null = 記録なし） */
export function parsePaintCacheMeta(value: unknown): PaintCacheMeta | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  const strs = (a: unknown): string[] | null => (Array.isArray(a) && a.every((x) => typeof x === 'string') ? (a as string[]) : null);
  const previous = strs(o['previous']);
  const oldClients = strs(o['oldClients']);
  if (o['v'] !== 1 || typeof o['current'] !== 'string' || !previous || !oldClients) return null;
  return { v: 1, current: o['current'], previous, oldClients };
}

export interface PaintActivatePlan {
  /** 消す og-paint-* */
  readonly remove: readonly string[];
  /** 書く記録 */
  readonly meta: PaintCacheMeta;
}

/**
 * activate で何を残し何を消すか。
 * @param keys caches.keys() の全部（og-paint-* 以外は触らない）
 * @param current 今の版のキャッシュの名前
 * @param meta 前の記録（無ければ null）
 * @param clientIds いま開いている window client の id（clients.matchAll({ type: 'window', includeUncontrolled: true })）
 */
export function planPaintActivate(
  keys: readonly string[],
  current: string,
  meta: PaintCacheMeta | null,
  clientIds: readonly string[],
): PaintActivatePlan {
  const paintKeys = keys.filter((k) => k.startsWith(PAINT_CACHE_PREFIX));
  let previous: string[];
  let oldClients: readonly string[];
  if (meta && meta.current === current) {
    // SW のバイトだけが変わった（ペイントの版は同じ）: 1 つ前と、その版のページの記録を引き継ぐ
    previous = [...meta.previous];
    oldClients = meta.oldClients;
  } else if (meta) {
    // ペイントの版が変わった: 今まで今だったものが 1 つ前。その前の 1 つ前は次の activate = いま消す
    previous = [meta.current];
    oldClients = clientIds;
  } else {
    // 記録なし（この仕組みの前の SW から）: 今の版以外の og-paint-* を 1 つ前として残す（前の SW は 1 つしか残さない）
    previous = paintKeys.filter((k) => k !== current);
    oldClients = clientIds;
  }
  previous = [...new Set(previous)].filter((k) => k !== current && paintKeys.includes(k));
  const remove = paintKeys.filter((k) => k !== current && !previous.includes(k));
  return { remove, meta: { v: 1, current, previous, oldClients: previous.length ? [...new Set(oldClients)] : [] } };
}

/**
 * 1 つ前の版を消してよいか（記録した古い版のページが 1 つも開いていなければ消す）。
 * @param liveClientIds いま開いている window client の id
 */
export function planPaintPrune(meta: PaintCacheMeta, liveClientIds: readonly string[]): PaintActivatePlan {
  if (meta.previous.length === 0) return { remove: [], meta: meta.oldClients.length ? { ...meta, oldClients: [] } : meta };
  const live = new Set(liveClientIds);
  const alive = meta.oldClients.filter((id) => live.has(id));
  if (alive.length === 0) return { remove: [...meta.previous], meta: { v: 1, current: meta.current, previous: [], oldClients: [] } };
  return { remove: [], meta: { ...meta, oldClients: alive } };
}

/** Cache Storage の最小の形（caches） */
export interface CacheStorageLike {
  keys(): Promise<string[]>;
  open(name: string): Promise<{ match(request: RequestInfo | URL): Promise<Response | undefined> }>;
}

/**
 * 今のキャッシュ（current）以外の og-paint-* から探す（今のキャッシュに無かったときの /paint/assets/ の後ろ盾）。
 * 1 つ前（previous）を先に見る。どこにも無ければ undefined（呼び出し側がネットワークへ）
 */
export async function matchInPaintCaches(
  storage: CacheStorageLike,
  request: RequestInfo | URL,
  current: string,
  preferred: readonly string[] = [],
): Promise<Response | undefined> {
  let names: string[];
  try {
    names = (await storage.keys()).filter((k) => k.startsWith(PAINT_CACHE_PREFIX) && k !== current);
  } catch {
    return undefined;
  }
  names.sort((a, b) => Number(preferred.includes(b)) - Number(preferred.includes(a)));
  for (const name of names) {
    try {
      const hit = await (await storage.open(name)).match(request);
      if (hit) return hit;
    } catch {
      // 次のキャッシュへ
    }
  }
  return undefined;
}
