/** 契約 1: キャンバス（ARCHITECTURE.md）の型。 */
import type { Drawing, Stroke } from '@/scoring/types';

export type { Drawing, Stroke, StrokePoint } from '@/scoring/types';

export type Tool = 'pen' | 'eraser';

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
  /** 既定 3px。筆圧で 0.5x..1.6x */
  baseWidth: number;
  grid: 'none' | 'thirds' | 'quarters';
  /** 左右反転表示（ストローク座標は反転しない） */
  flipped: boolean;
  /** 2 値表示 */
  silhouette: boolean;
  /**
   * 契約への追加: penOnly 中でもマウスでの描画を許可する（開発・デスクトップ確認用）。既定 true。
   * タッチは penOnly 中は常に無視。
   */
  allowMouse: boolean;
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
  /** 再生・復元用。履歴はリセットされる（Undo で読み込み前には戻らない） */
  loadStrokes(d: Drawing): void;
  replay(opts: { speed: number }): Promise<void>;
  cancelReplay(): void;
  toWebp(maxEdge: number, quality?: number): Promise<Blob>;
  size(): { width: number; height: number };
  on(event: 'strokeend', cb: (s: Stroke) => void): () => void;
  on(event: 'change', cb: () => void): () => void;
}
