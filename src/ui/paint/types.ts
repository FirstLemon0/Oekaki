/**
 * お絵描き v2 の UI で使う型。すべて契約 1b（ARCHITECTURE.md）の CanvasEngine のメソッドから導く
 * （src/canvas がどの名前で型を export するかに依存しないため）。
 */
import type { CanvasEngine } from '@/canvas';

export type LayerInfo = ReturnType<CanvasEngine['getLayers']>[number];
export type BlendMode = LayerInfo['blend'];
export type CanvasDocument = ReturnType<CanvasEngine['getDocument']>;
export type CanvasOp = CanvasDocument['ops'][number];
export type SelectionMask = NonNullable<ReturnType<CanvasEngine['getSelection']>>;
export type Mat = Parameters<CanvasEngine['transformSelection']>[0];
export type ViewState = ReturnType<CanvasEngine['getView']>;
export type FillOptions = ReturnType<CanvasEngine['getFill']>;
export type FillReference = FillOptions['reference'];
