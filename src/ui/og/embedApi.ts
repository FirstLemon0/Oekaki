/**
 * 埋め込みのペイント（public/paint/embed.html = OG の成果物）の API `window.ogEmbed` の親の側の型と接続（UR-002 / ADR-0007 D3-4）。
 *
 * - 型は OG の `src/embed/api.ts`（EMBED_API_VERSION = 1）の写し。OG のソースは Ilust に入れない（ADR-0007 D4-3）ので、
 *   形は値の検査（isOgEmbedApi）で確かめてから使う。版が違う・形が違う・起動に失敗した → 呼び出し側は旧 FreeDraw に戻す。
 * - 同じオリジンの iframe の contentWindow を直接さわる（postMessage は使わない）。
 */

/** この親が話せる API の版（OG の EMBED_API_VERSION） */
export const OG_EMBED_API_VERSION = 1;

/** iframe の src（Ilust の public/paint/ に置いた成果物。base は /paint/） */
export const OG_EMBED_URL = '/paint/embed.html';

export type OgEmbedTheme = 'light' | 'dark';
export type OgEmbedFontScale = 'normal' | 'large';

export interface OgEmbedConfig {
  readonly theme: OgEmbedTheme;
  readonly penOnly: boolean;
  readonly leftHanded: boolean;
  readonly fontScale: OgEmbedFontScale;
}

export interface OgEmbedRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface OgEmbedSize {
  readonly width: number;
  readonly height: number;
}

export interface OgNewDocumentOptions {
  readonly width: number;
  readonly height: number;
  readonly dpi: number;
  /** '#RRGGBB' */
  readonly paper: string;
}

export interface OgStrokeSpan {
  readonly start: number;
  readonly end: number;
  readonly tool: 'pen' | 'eraser' | 'other';
}

export interface OgGalleryImage {
  readonly image: Blob;
  readonly contentRect: OgEmbedRect;
  readonly docSize: OgEmbedSize;
}

export interface OgEmbedApi {
  readonly version: number;
  readonly ready: Promise<void>;
  configure(o: Partial<OgEmbedConfig>): void;
  newDocument(o: OgNewDocumentOptions): Promise<void>;
  openProject(bytes: Blob): Promise<void>;
  hasContent(): boolean;
  isDirty(): boolean;
  exportGalleryImage(): Promise<OgGalleryImage>;
  exportTransparentPng(o: { readonly longEdge: number }): Promise<Blob>;
  serializeProject(): Promise<Blob>;
  discardRecovery(): Promise<void>;
  onStroke(cb: (s: OgStrokeSpan) => void): () => void;
  onDirtyChange(cb: (dirty: boolean) => void): () => void;
  dispose(): void;
}

/** 下書き（OG の自動保存の記録 = ジャーナル）。v1 に後から足された口（無い成果物もある） */
export interface OgEmbedDraft {
  readonly id: string;
  readonly docId: string;
  readonly savedAt: string;
  readonly bytes: number;
}

export interface OgEmbedDraftMark {
  readonly docId: string;
  readonly savedAt: string;
}

/**
 * v1 に**足された**下書きの口（OG の w2-embed。版は 1 のまま）。`typeof api.latestDraft === 'function'` で確かめてから使う。
 * 無い成果物（wave 1 の 2906365 など）では、親が serializeProject の写しを持つ局所アダプタ（og/ogDraft.ts）を使う。
 */
export interface OgEmbedDraftApi {
  saveDraft(): Promise<OgEmbedDraftMark | null>;
  latestDraft(): Promise<OgEmbedDraft | null>;
  openDraft(id: string): Promise<void>;
}

/** 下書きの口（ジャーナル）を持つ成果物か */
export function hasJournalDrafts(api: OgEmbedApi): api is OgEmbedApi & OgEmbedDraftApi {
  const o = api as unknown as Record<string, unknown>;
  return typeof o['saveDraft'] === 'function' && typeof o['latestDraft'] === 'function' && typeof o['openDraft'] === 'function';
}

const METHODS = [
  'configure',
  'newDocument',
  'openProject',
  'hasContent',
  'isDirty',
  'exportGalleryImage',
  'exportTransparentPng',
  'serializeProject',
  'discardRecovery',
  'onStroke',
  'onDirtyChange',
  'dispose',
] as const;

/** v1 の形をしているか（版は見ない。版は isCompatibleOgEmbed） */
export function isOgEmbedApi(v: unknown): v is OgEmbedApi {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (typeof o['version'] !== 'number') return false;
  const ready = o['ready'] as { then?: unknown } | undefined;
  if (!ready || typeof ready.then !== 'function') return false;
  return METHODS.every((m) => typeof o[m] === 'function');
}

/** この親が使える API か（形と版の両方） */
export function isCompatibleOgEmbed(v: unknown): v is OgEmbedApi {
  return isOgEmbedApi(v) && v.version === OG_EMBED_API_VERSION;
}

/** 接続できなかった理由（呼び出し側は旧 FreeDraw に戻す） */
export type OgConnectFailure =
  /** iframe の読み込みが終わらない・window に ogEmbed が出てこない */
  | 'missing'
  /** ogEmbed はあるが版か形が違う */
  | 'version'
  /** ready が reject した（起動に失敗） */
  | 'boot'
  /** 時間内に ready にならない */
  | 'timeout';

export type OgConnectResult = { ok: true; api: OgEmbedApi } | { ok: false; reason: OgConnectFailure; error?: unknown; version?: number };

export interface ConnectOptions {
  /** ogEmbed が window に出てくるまで（読み込みの後）待つ時間 */
  readonly appearTimeoutMs?: number;
  /** ready を待つ時間（4× CPU の制限で 3 秒以内が目標。余裕を見る） */
  readonly readyTimeoutMs?: number;
  /** ogEmbed を探す間隔 */
  readonly pollMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * iframe の window から ogEmbed を取り出して ready まで待つ。
 * `getWindow` は毎回 iframe.contentWindow を返す（読み込みの途中で差し替わるので、取り直す）。
 */
export async function connectOgEmbed(
  getWindow: () => (Window & { ogEmbed?: unknown }) | null | undefined,
  opts: ConnectOptions = {},
): Promise<OgConnectResult> {
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? defaultSleep;
  const appearTimeout = opts.appearTimeoutMs ?? 20_000;
  const readyTimeout = opts.readyTimeoutMs ?? 30_000;
  const poll = opts.pollMs ?? 50;

  const t0 = now();
  let candidate: unknown;
  for (;;) {
    let w: (Window & { ogEmbed?: unknown }) | null | undefined;
    try {
      w = getWindow();
      candidate = w ? w.ogEmbed : undefined;
    } catch (error) {
      // 別オリジン（あり得ないが、配信の設定の誤りで起こりうる）
      return { ok: false, reason: 'missing', error };
    }
    if (candidate !== undefined) break;
    if (now() - t0 >= appearTimeout) return { ok: false, reason: 'missing' };
    await sleep(poll);
  }
  if (!isOgEmbedApi(candidate)) return { ok: false, reason: 'version' };
  if (candidate.version !== OG_EMBED_API_VERSION) return { ok: false, reason: 'version', version: candidate.version };
  const api = candidate;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const outcome = await Promise.race([
      api.ready.then(
        () => 'ready' as const,
        (error: unknown) => ({ error }),
      ),
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), readyTimeout);
      }),
    ]);
    if (outcome === 'timeout') return { ok: false, reason: 'timeout' };
    if (outcome !== 'ready') return { ok: false, reason: 'boot', error: outcome.error };
    return { ok: true, api };
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
