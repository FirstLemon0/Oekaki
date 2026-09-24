/**
 * スタブ: src/canvas（ARCHITECTURE.md 契約 1）がまだ無いあいだの最小代替。
 *
 * 統合時は UI 側の import を `@/canvas` に差し替え、このファイルを消す。
 * UI は `canvasAvailable` が false のあいだ「描いた順に再生」を押せない表示にする。
 */
import type { Drawing, Stroke } from '@/scoring/types';

export type Tool = 'pen' | 'eraser';

export interface OverlaySpec {
  kind: 'svg' | 'image' | 'strokes';
  src: string | Blob | Drawing;
  opacity: number;
}

export interface CanvasOptions {
  penOnly: boolean;
  leftHanded: boolean;
  paperColor: string;
  inkColor: string;
  baseWidth: number;
  grid: 'none' | 'thirds' | 'quarters';
  flipped: boolean;
  silhouette: boolean;
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
  getStrokes(): Drawing;
  loadStrokes(d: Drawing): void;
  replay(opts: { speed: number }): Promise<void>;
  cancelReplay(): void;
  toWebp(maxEdge: number, quality?: number): Promise<Blob>;
  size(): { width: number; height: number };
  on(event: 'strokeend', cb: (s: Stroke) => void): () => void;
  on(event: 'change', cb: () => void): () => void;
}

/** 本物のエンジンが入ったら true になる（スタブでは常に false）。 */
export const canvasAvailable = false;

export function createCanvasEngine(_opts?: Partial<CanvasOptions>): CanvasEngine {
  let strokes: Drawing = [];
  return {
    attach() {},
    detach() {},
    setTool() {},
    setOptions() {},
    setOverlay() {},
    undo() {},
    redo() {},
    clear() {
      strokes = [];
    },
    canUndo: () => false,
    canRedo: () => false,
    getStrokes: () => strokes,
    loadStrokes(d) {
      strokes = d;
    },
    replay: async () => {},
    cancelReplay() {},
    toWebp: async () => new Blob([], { type: 'image/webp' }),
    size: () => ({ width: 0, height: 0 }),
    on: () => () => {},
  };
}
