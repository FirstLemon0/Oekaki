export type {
  Tool,
  OverlaySpec,
  CanvasOptions,
  CanvasEngine,
  ToWebpOptions,
  PenPreset,
  PenStyle,
  EraserMode,
  EraserStyle,
  GridSpec,
  StrokeStyle,
  StrokeHistory,
} from './types';
export { cropRect, inkBounds, exportScale, CROP_MARGIN_RATIO, CROP_MARGIN_MIN, type Rect } from './crop';
export {
  PEN_PRESETS,
  PALETTE_COLORS,
  DEFAULT_PEN,
  DEFAULT_ERASER,
  PEN_SIZE_RANGE,
  PEN_OPACITY_RANGE,
  ERASER_SIZE_RANGE,
  sanitizeStyle,
  normalizeHexColor,
  isEraserStyle,
  isGuideStyle,
  isNonInkStyle,
  guideStrokeStyle,
  GUIDE_WIDTH,
  GUIDE_OPACITY,
  type PenPresetSpec,
  type PaletteColor,
} from './pen';
export { eraseSegments, flattenHistory, type EraseResult } from './erase';
export { normalizeGrid, gridLines, GRID_COLOR } from './grid';
export { createCanvasEngine, DEFAULT_OPTIONS, historyOf } from './engine';
export { CanvasView, type CanvasViewProps } from './CanvasView';
