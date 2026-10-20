/**
 * 新しいお絵描き（#/free の OgFreeDraw）の画面に依らない部分（UR-002 S2、ADR-0007 D6 / 設計案 §4 の対応表）。
 *
 * - 親の設定 → 埋め込みの設定（テーマは親が system を解決して渡す、ilust-sup-integration-20）
 * - 新しい紙の大きさ（画面の縦横比 × 長辺 2048・150 dpi・成長通の紙色）
 * - 実描画の区間: ogEmbed.onStroke の { start, end, tool } のうち pen / eraser だけを積み、今の activeDrawingMs にそのまま渡す
 *   （関数は変えない。ilust-sup-integration-13）
 * - 保存: WebP（ギャラリー）と .ognk をメモリで作ってから saveOgDrawing で 1 トランザクションに書く。何も描いていなければ保存しない。
 *   失敗（容量不足を含む）は例外にせず、作った画像と文書を持ったまま retry を返す（ilust-sup-integration-18）
 */
import type { Drawing, DrawingKind, FontScale, OgDrawingMeta, Theme } from '@/data/types';
import type { ContinueTarget } from './ogDrawing';
import type { SaveOgDrawingInput, SaveOgDrawingResult } from '@/data/repo';
import { activeDrawingMs } from '../lesson/steps';
import type { OgEmbedApi, OgEmbedConfig, OgGalleryImage, OgNewDocumentOptions, OgStrokeSpan } from './embedApi';

// ---------------------------------------------------------------------------
// 設定
// ---------------------------------------------------------------------------

/** 親のテーマ（system を含む）を埋め込みの light / dark に解決する */
export function resolveEmbedTheme(theme: Theme | undefined, prefersDark: boolean): OgEmbedConfig['theme'] {
  if (theme === 'light' || theme === 'dark') return theme;
  return prefersDark ? 'dark' : 'light';
}

export interface ParentPrefs {
  theme: Theme | undefined;
  penOnly: boolean;
  leftHanded: boolean;
  fontScale: FontScale;
}

/** 親の設定 → 埋め込みの設定（毎回まるごと渡す。埋め込みは OG の設定 DB に書かない） */
export function embedConfigFrom(p: ParentPrefs, prefersDark: boolean): OgEmbedConfig {
  return {
    theme: resolveEmbedTheme(p.theme, prefersDark),
    penOnly: p.penOnly,
    leftHanded: p.leftHanded,
    fontScale: p.fontScale === 'large' ? 'large' : 'normal',
  };
}

// ---------------------------------------------------------------------------
// 紙
// ---------------------------------------------------------------------------

/** 新しい紙の長辺（透過 PNG の長辺と同じ。練習の紙に A4 300dpi は大きすぎる、設計案 §6） */
export const OG_PAPER_LONG_EDGE = 2048;
export const OG_PAPER_DPI = 150;
/** 成長通の紙色（DESIGN_SYSTEM §1 の paper、manifest の background_color と同じ） */
export const OG_PAPER_COLOR = '#F2EFE8';

/** 画面の縦横比（幅 / 高さ）から新しい紙（縦横比は 0.5〜2 に収める） */
export function paperFor(aspect: number): OgNewDocumentOptions {
  const a = Number.isFinite(aspect) && aspect > 0 ? Math.min(2, Math.max(0.5, aspect)) : 1;
  const width = a >= 1 ? OG_PAPER_LONG_EDGE : Math.round(OG_PAPER_LONG_EDGE * a);
  const height = a >= 1 ? Math.round(OG_PAPER_LONG_EDGE / a) : OG_PAPER_LONG_EDGE;
  return { width, height, dpi: OG_PAPER_DPI, paper: OG_PAPER_COLOR };
}

// ---------------------------------------------------------------------------
// 実描画の区間（ストリーク）
// ---------------------------------------------------------------------------

/** 実描画の時間に数える道具（v2 と同じく線を引く道具だけ。図形・塗りは数えない、設計案 §4） */
export function countsAsDrawing(tool: OgStrokeSpan['tool']): boolean {
  return tool === 'pen' || tool === 'eraser';
}

export interface SpanLog {
  add(s: OgStrokeSpan): void;
  spans(): readonly { start: number; end: number }[];
  /** activeDrawingMs（steps.ts、v2 と同じ関数）に渡した値 */
  activeMs(): number;
}

export function createSpanLog(): SpanLog {
  const list: { start: number; end: number }[] = [];
  return {
    add(s) {
      if (!countsAsDrawing(s.tool)) return;
      if (!Number.isFinite(s.start) || !Number.isFinite(s.end)) return;
      list.push({ start: s.start, end: s.end });
    },
    spans: () => list,
    activeMs: () => activeDrawingMs(list),
  };
}

// ---------------------------------------------------------------------------
// 保存
// ---------------------------------------------------------------------------

/** OG の書き出しの結果 → Drawing.meta.og（JSON の値だけ。meta.doc は入れない、ADR-0007 D6-2） */
export function ogMetaFrom(g: OgGalleryImage, docId: string, ogContract: string): OgDrawingMeta {
  const r = g.contentRect;
  return {
    docId,
    docSize: { w: g.docSize.width, h: g.docSize.height },
    // ギャラリーの画像が写す範囲（文書 px。内容で切り詰め + 余白）。空の文書は保存しないので常にある
    contentRect: { x: r.x, y: r.y, w: r.width, h: r.height },
    engine: 'og',
    ogContract,
  };
}

export type OgSaveOutcome =
  | { status: 'empty' }
  | { status: 'saved'; drawing: Drawing }
  | {
      status: 'failed';
      reason: 'quota' | 'other';
      error: unknown;
      /** 作った画像と文書のまま書き直す */
      retry: () => Promise<OgSaveOutcome>;
    };

export interface SaveOgFreeOptions {
  api: Pick<OgEmbedApi, 'hasContent' | 'exportGalleryImage' | 'serializeProject' | 'version'>;
  kind: DrawingKind;
  docId: string;
  ogContract: string;
  /** 続きから描いた絵（同じ id・種別・作成日時で置き換える） */
  target?: ContinueTarget | null;
  save: (input: SaveOgDrawingInput) => Promise<SaveOgDrawingResult>;
}

function fromResult(r: SaveOgDrawingResult): OgSaveOutcome {
  if (r.ok) return { status: 'saved', drawing: r.drawing };
  return { status: 'failed', reason: r.reason, error: r.error, retry: async () => fromResult(await r.retry()) };
}

/**
 * 保存する（何も描いていなければ 'empty'）。画像と文書を先にメモリで作り、成長通の DB へ 1 トランザクションで書く。
 * 書き出し（OG 側）が失敗したら 'failed'（reason 'other'）で、retry はもう一度書き出しからやり直す。
 */
export async function saveOgFree(o: SaveOgFreeOptions): Promise<OgSaveOutcome> {
  if (!o.api.hasContent()) return { status: 'empty' };
  let image: OgGalleryImage;
  let ognk: Blob;
  try {
    image = await o.api.exportGalleryImage();
    ognk = await o.api.serializeProject();
  } catch (error) {
    return { status: 'failed', reason: 'other', error, retry: () => saveOgFree(o) };
  }
  const t = o.target ?? null;
  const input: SaveOgDrawingInput = {
    ...(t ? { id: t.id, createdAt: t.createdAt, lessonId: t.lessonId } : {}),
    kind: t ? t.kind : o.kind,
    image: image.image,
    ognk,
    og: ogMetaFrom(image, t ? t.docId : o.docId, o.ogContract),
    embedApi: o.api.version,
  };
  return fromResult(await o.save(input));
}

/** 文書の id（成長通の側で付ける。OG の内部の id は API に出てこない） */
export function newOgDocId(rand: () => string = defaultRandomId): string {
  return `og-${rand()}`;
}

function defaultRandomId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
