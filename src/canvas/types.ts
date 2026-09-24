/** 契約 1: キャンバス（ARCHITECTURE.md）の型。 */
import type { Drawing, Stroke } from '@/scoring/types';

export type { Drawing, Stroke, StrokePoint } from '@/scoring/types';

export type Tool = 'pen' | 'eraser';

/** ペンの種類。見た目のパラメータは PEN_PRESETS（pen.ts）。 */
export type PenPreset = 'pencil' | 'pen' | 'brush' | 'marker';

/** 次に描くストロークに使うペン設定。 */
export interface PenStyle {
  preset: PenPreset;
  /** 基準幅 1..16 px（筆圧 0→1 で PEN_PRESETS[preset].pressureWidth 倍） */
  size: number;
  /** 0.1..1 */
  opacity: number;
  /** CSS 色 `#RRGGBB`。未指定はテーマの墨色（inkColor）を描画時に解決する */
  color?: string;
}

/** 'stroke': 触れた線を丸ごと消す（従来）。'partial': 触れた部分だけ消し、残りを別の線に分ける。 */
export type EraserMode = 'stroke' | 'partial';

export interface EraserStyle {
  mode: EraserMode;
  /** 半径 4..40 px */
  size: number;
}

/** グリッド。divide: 画面を n 等分。pitch: 左上原点の等間隔（CSS px）。 */
export type GridSpec =
  | 'none'
  | { kind: 'divide'; n: 2 | 3 | 4 | 6 | 8 }
  | { kind: 'pitch'; px: 25 | 50 | 100 };

/** ストローク 1 本の見た目（getStrokes() と同じ順で getStyles() が返す）。 */
export interface StrokeStyle {
  preset: PenPreset;
  size: number;
  opacity: number;
  /** `#RRGGBB`。未指定は inkColor（テーマ追従） */
  color?: string;
}

export interface OverlaySpec {
  kind: 'svg' | 'image' | 'strokes';
  /** svg: SVG 文字列 / image: Blob / strokes: Drawing */
  src: string | Blob | Drawing;
  /** 0..1 */
  opacity: number;
}

export interface CanvasOptions {
  /** true: pointerType 'pen' 以外の描画を無視（allowMouse が true ならマウスは許可） */
  penOnly: boolean;
  /** UI 側の配置用。エンジンは参照のみ */
  leftHanded: boolean;
  /** 既定 var(--color-canvas)。CSS 変数は attach 先の要素で解決する */
  paperColor: string;
  /** 既定 var(--color-ink) */
  inkColor: string;
  /**
   * 既定 3px。スタイルを持たないストローク（旧データ・loadStrokes で styles 省略）の線幅。筆圧で 0.5x..1.6x。
   * 新しく描く線の太さは setPen({ size }) で決まる。
   */
  baseWidth: number;
  /** 旧形式 'thirds' / 'quarters' も受け付ける（{kind:'divide',n:3} / {kind:'divide',n:4} とみなす） */
  grid: GridSpec | 'thirds' | 'quarters';
  /** 左右反転表示（絵と重ねだけ反転。グリッドは反転しない。ストローク座標は反転しない） */
  flipped: boolean;
  /** 2 値表示 */
  silhouette: boolean;
  /**
   * 契約への追加: penOnly 中でもマウスでの描画を許可する（開発・デスクトップ確認用）。既定 true。
   * タッチは penOnly 中は常に無視。
   */
  allowMouse: boolean;
}

export interface ToWebpOptions {
  /**
   * true（既定）: 完了ストロークの範囲＋余白（内容の長辺の 8%、最低 24px。線幅ぶんも含む）に切り詰める。
   * 縦横比は内容のまま。ストロークが無ければ紙全体。
   * false: 紙全体（attach 前はストロークの範囲 + 16px、原点は 0,0）。
   */
  crop?: boolean;
}

export interface CanvasEngine {
  attach(host: HTMLElement): void;
  detach(): void;
  setTool(t: Tool): void;
  setOptions(patch: Partial<CanvasOptions>): void;
  setOverlay(o: OverlaySpec | null): void;
  undo(): void;
  redo(): void;
  clear(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** 描いた順（コピーを返す） */
  getStrokes(): Drawing;
  /** getStrokes() と同じ順・同じ長さのスタイル。undefined は旧データ（baseWidth のペン）。 */
  getStyles(): (StrokeStyle | undefined)[];
  /**
   * 再生・復元用。履歴はリセットされる（Undo で読み込み前には戻らない）。
   * styles は d と同じ並び（省略・不足分は undefined = 旧データ扱い、余りは捨てる）。
   */
  loadStrokes(d: Drawing, styles?: (StrokeStyle | undefined)[]): void;
  /**
   * 次に描く線のペン設定（範囲外は丸める）。preset だけ変えると、そのプリセットで最後に使った size/opacity に戻る。
   * color はプリセット共通。`{ color: undefined }` を渡すと墨色（テーマ追従）に戻る。不正な色は無視。
   */
  setPen(style: Partial<PenStyle>): void;
  getPen(): PenStyle;
  setEraser(style: Partial<EraserStyle>): void;
  getEraser(): EraserStyle;
  replay(opts: { speed: number }): Promise<void>;
  cancelReplay(): void;
  /**
   * 紙色＋完了ストロークを画像化する。長辺は maxEdge 以下。
   * 既定では内容の範囲（＋余白）に切り詰める。紙全体が欲しいときは `{ crop: false }`。
   */
  toWebp(maxEdge: number, quality?: number, opts?: ToWebpOptions): Promise<Blob>;
  size(): { width: number; height: number };
  on(event: 'strokeend', cb: (s: Stroke) => void): () => void;
  on(event: 'change', cb: () => void): () => void;
  /** ペン／消しゴム設定が変わったとき */
  on(event: 'toolchange', cb: () => void): () => void;
}

export { PEN_PRESETS, PALETTE_COLORS, type PenPresetSpec, type PaletteColor } from './pen';
