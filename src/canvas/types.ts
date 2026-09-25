/** 契約 1: キャンバス（ARCHITECTURE.md）の型。 */
import type { Drawing, Stroke } from '@/scoring/types';

export type { Drawing, Stroke, StrokePoint } from '@/scoring/types';

/**
 * 'guide' は補助線（採点・本数・累計に数えない薄い線。StrokeStyle の preset 'guide'）。
 * v2（契約 1b）: fill 塗りつぶし / eyedropper スポイト / select-rect・select-lasso 選択 /
 * shape-line・shape-rect・shape-ellipse 図形 / hand 手のひら（ビューのパン）。
 */
export type Tool =
  | 'pen'
  | 'eraser'
  | 'guide'
  | 'fill'
  | 'eyedropper'
  | 'select-rect'
  | 'select-lasso'
  | 'shape-line'
  | 'shape-rect'
  | 'shape-ellipse'
  | 'hand';

/* ---------------- 契約 1b: レイヤー・選択・ビュー・操作履歴 ---------------- */

export type BlendMode = 'normal' | 'multiply' | 'screen';

/** レイヤー 1 枚の設定。並びは getLayers() の順（添字 0 がいちばん下）。 */
export interface LayerInfo {
  id: string;
  name: string;
  visible: boolean;
  /** 0..1 */
  opacity: number;
  locked: boolean;
  blend: BlendMode;
}

/** 選択範囲（キャンバス座標 CSS px）。 */
export type SelectionMask =
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'lasso'; points: { x: number; y: number }[] };

/** 2D アフィン行列 a b c d e f（CSS matrix() と同じ: x' = a x + c y + e, y' = b x + d y + f）。 */
export type Mat = [number, number, number, number, number, number];

/** 表示のビュー。画面座標 = 反転(zoom × 回転(rotationDeg) × キャンバス座標 + (panX, panY))。 */
export interface ViewState {
  /** 0.25..8 */
  zoom: number;
  panX: number;
  panY: number;
  rotationDeg: number;
}

/**
 * 操作履歴 1 手（再生・保存・Undo の単位）。座標はすべてキャンバス座標（CSS px、ビューに依存しない）。
 * stroke は pen / eraser / guide / 図形（点列に展開済み）。
 */
export type CanvasOp =
  | { kind: 'stroke'; layer: string; points: Stroke; style: StrokeStyle }
  /** color は `#RRGGBB` か 'ink'（墨。描画時にテーマの墨色へ解決する） */
  | { kind: 'fill'; layer: string; x: number; y: number; color: string | 'ink'; tolerance: number; reference: 'layer' | 'all' }
  /** mask は変形前の選択範囲（Undo で選択範囲もここへ戻る。Redo で transformMask(mask, matrix)） */
  | { kind: 'transform'; layer: string; mask: SelectionMask; matrix: Mat }
  | { kind: 'delete'; layer: string; mask: SelectionMask }
  | { kind: 'layer-add'; layer: LayerInfo; index: number }
  | { kind: 'layer-remove'; layer: string }
  | { kind: 'layer-move'; layer: string; index: number }
  | { kind: 'layer-set'; layer: string; patch: Partial<Omit<LayerInfo, 'id'>> }
  | { kind: 'layer-merge-down'; layer: string }
  | { kind: 'layer-duplicate'; layer: string; newId: string }
  | { kind: 'layer-clear'; layer: string };

/**
 * 保存形式。layers は **ops を適用する前** のレイヤー（ふつうは空のレイヤー 1 枚）。
 * loadDocument は layers から始めて ops を順に適用する。width/height は紙の大きさ（CSS px）。
 */
export interface CanvasDocument {
  v: 2;
  width: number;
  height: number;
  layers: LayerInfo[];
  active: string;
  ops: CanvasOp[];
}

export interface FillOptions {
  /** 0..255（RGBA の最大差）。既定 32 */
  tolerance: number;
  /** 'layer': アクティブレイヤーだけを境界に使う / 'all': 見えているレイヤーの合成結果 */
  reference: 'layer' | 'all';
}

export interface ToPngOptions {
  /** 既定 false（紙色を敷く）。true で透明背景 */
  transparent?: boolean;
  /** 既定 false（紙全体）。true で内容の範囲＋余白（toWebp と同じ規則） */
  crop?: boolean;
  /** 墨（色なし）の線・塗りの色。既定はいまのテーマの墨。透過書き出しはライトの墨 #2B2A28 を渡す */
  inkColor?: string;
}

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

/**
 * 旧 API の名残（後方互換のため型だけ残す）。消しゴムは常に「通ったところを消す」ラスター消しゴムで、
 * mode は受け付けても使わない。
 */
export type EraserMode = 'stroke' | 'partial';

export interface EraserStyle {
  /** 半径 4..40 px */
  size: number;
  /** @deprecated 使わない（渡しても無視する） */
  mode?: EraserMode;
}

/** グリッド。divide: 画面を n 等分。pitch: 左上原点の等間隔（CSS px）。 */
export type GridSpec =
  | 'none'
  | { kind: 'divide'; n: 2 | 3 | 4 | 6 | 8 }
  | { kind: 'pitch'; px: 25 | 50 | 100 };

/**
 * ストローク 1 本の見た目（getStrokes() と同じ順で getStyles() が返す）。
 * preset が 'eraser' のものは消しゴムストローク（size は半径、opacity は 1）。
 * preset が 'guide' のものは補助線（幅 1.5px・ink-2 色・不透明度 0.35 に固定）。
 * どちらも getHistory() にだけ現れ、getStrokes() / getStyles() には出てこない。
 */
export interface StrokeStyle {
  preset: PenPreset | 'eraser' | 'guide';
  size: number;
  opacity: number;
  /** `#RRGGBB`。未指定は inkColor（テーマ追従） */
  color?: string;
}

/**
 * 消しゴムを含む生の描画履歴（描いた順）。strokes と styles は同じ並び・同じ長さ。
 * styles の 'eraser' は消しゴムストローク、'guide' は補助線、undefined は旧データのペン。
 */
export interface StrokeHistory {
  strokes: Drawing;
  styles: (StrokeStyle | undefined)[];
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
  /**
   * 契約 1b への追加: 2 本指のズーム・パン・回転と手のひらツール。既定 true。
   * false（採点する画面）では 2 本目の指を無視し、'hand' ツールでもビューを動かさない。
   */
  gestures: boolean;
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
  /**
   * 表示だけの透明度（getHistory() の添字ごと。0〜1、undefined は 1、0 は描かない）。null で全部ふつうに戻す。
   * ドリルで古い線を薄く・隠すために使う。getStrokes() / getStyles() / getHistory()・再生・toWebp には影響しない。
   * 消しゴムストロークには掛からない（消しゴムはいつも効く）。
   */
  setStrokeVisibility(alphas: readonly (number | undefined)[] | null): void;
  /** 変形プレビュー中は cancelTransform() だけ（直前の操作は取り消さない）。Undo/Redo は選択範囲もその時点に戻す */
  undo(): void;
  redo(): void;
  clear(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /**
   * 採点・保存用の点列（コピー）。ペンのストロークだけを描いた順に返す（補助線・消しゴムは含めない）。
   * 消しゴムで消えた点は取り除き、残った連続区間を別のストロークに分ける（見た目とは無関係の近似: 中心線で判定）。
   */
  getStrokes(): Drawing;
  /** getStrokes() と同じ順・同じ長さのスタイル。undefined は旧データ（baseWidth のペン）。 */
  getStyles(): (StrokeStyle | undefined)[];
  /**
   * 再生・保存用: アクティブレイヤーの消しゴム・補助線を含む生の履歴（コピー）。
   * そのレイヤーを最後に空にした op（layer-clear＝「全部消す」、作り直し）より後の線だけ。
   */
  getHistory(): StrokeHistory;
  /** getHistory() の結果を読み戻す（loadStrokes(h.strokes, h.styles) と同じ）。履歴はリセット。 */
  loadHistory(h: { strokes: Drawing; styles?: (StrokeStyle | undefined)[] }): void;
  /**
   * 再生・復元用。履歴はリセットされる（Undo で読み込み前には戻らない）。
   * styles は d と同じ並び（省略・不足分は undefined = 旧データ扱い、余りは捨てる）。
   * styles に 'eraser' があれば消しゴムストロークとして扱う（loadHistory と同じ）。
   */
  loadStrokes(d: Drawing, styles?: (StrokeStyle | undefined)[]): void;
  /**
   * 次に描く線のペン設定（範囲外は丸める）。preset だけ変えると、そのプリセットで最後に使った size/opacity に戻る。
   * color はプリセット共通。`{ color: undefined }` を渡すと墨色（テーマ追従）に戻る。不正な色は無視。
   */
  setPen(style: Partial<PenStyle>): void;
  getPen(): PenStyle;
  /** 消しゴムの半径（4..40 に丸める）。mode は無視する。 */
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
  /** ペン／消しゴム設定が変わったとき（スポイトで色を拾ったときも） */
  on(event: 'toolchange', cb: () => void): () => void;
  /** layerschange: レイヤーの並び・設定・アクティブ / viewchange: ズーム・パン・回転 / selectionchange: 選択・変形プレビュー / opsend: 操作 1 手を積んだ・戻した */
  on(event: 'layerschange' | 'viewchange' | 'selectionchange' | 'opsend', cb: () => void): () => void;

  /* ---------------- 契約 1b ---------------- */
  /** 下から順（コピー） */
  getLayers(): LayerInfo[];
  getActiveLayer(): string;
  setActiveLayer(id: string): void;
  /** 既定はアクティブレイヤーのすぐ上。作ったレイヤーがアクティブになる */
  addLayer(opts?: { name?: string; index?: number }): LayerInfo;
  /** 最後の 1 枚は消せない */
  removeLayer(id: string): void;
  duplicateLayer(id: string): LayerInfo;
  /** すぐ下のレイヤーへ結合（下のレイヤーの設定が残る） */
  mergeDown(id: string): void;
  moveLayer(id: string, index: number): void;
  setLayer(id: string, patch: Partial<Omit<LayerInfo, 'id'>>): void;
  clearLayer(id: string): void;
  /** 長辺 size px の透明背景 PNG */
  getLayerThumbnail(id: string, size: number): Promise<Blob>;

  setFill(opts: Partial<FillOptions>): void;
  getFill(): FillOptions;
  /**
   * 見えているレイヤーの合成結果の色 `#RRGGBB`（紙色は含めない）。透明なら null。
   * 墨（いまのテーマの墨色）と同じ色なら 'ink'（UI は setPen({ color: undefined }) にする）
   */
  pickColor(x: number, y: number): string | 'ink' | null;

  getSelection(): SelectionMask | null;
  setSelection(mask: SelectionMask | null): void;
  selectAll(): void;
  /** 選択範囲の変形プレビュー（元の位置からの行列。何度でも上書き） */
  transformSelection(matrix: Mat): void;
  commitTransform(): void;
  cancelTransform(): void;
  deleteSelection(): void;
  isTransforming(): boolean;

  getView(): ViewState;
  setView(patch: Partial<ViewState>): void;
  resetView(): void;
  /** 内容が画面に収まるなら 100%（収まる位置へ）、収まらないときだけ紙全体が入るように縮小 */
  fitView(): void;
  toCanvasPoint(clientX: number, clientY: number): { x: number; y: number };
  toClientPoint(x: number, y: number): { x: number; y: number };

  getDocument(): CanvasDocument;
  loadDocument(doc: CanvasDocument): void;
  toPng(maxEdge: number, opts?: ToPngOptions): Promise<Blob>;
}

export { PEN_PRESETS, PALETTE_COLORS, type PenPresetSpec, type PaletteColor } from './pen';
