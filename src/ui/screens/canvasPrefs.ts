/**
 * キャンバスのツール設定（ペン・消しゴム・グリッド）の端末内の好み。
 *
 * ペンの種類・太さ・不透明度・色と消しゴムの設定は Settings（data 層）の項目ではなく、
 * この端末の好みとして localStorage に置く（バックアップの対象外）。
 * 読めない・壊れている値は捨てて既定に戻す。
 */
import type { EraserStyle, GridSpec, PenPreset, PenStyle } from '@/canvas';

export const PEN_STYLE_KEY = 'seichotsu.penStyle';
export const ERASER_STYLE_KEY = 'seichotsu.eraserStyle';
/** 任意色（HSV ピッカー・スポイト・「その他」）の直近 6 つ（新しい順） */
export const PEN_RECENT_COLORS_KEY = 'seichotsu.penRecentColors';

export const PEN_PRESET_ORDER: readonly PenPreset[] = ['pencil', 'pen', 'brush', 'marker'];
export const PEN_PRESET_LABEL: Record<PenPreset, string> = {
  pencil: '鉛筆',
  pen: 'ペン',
  brush: '筆ペン',
  marker: 'マーカー',
};

export const PEN_SIZE = { min: 1, max: 16 } as const;
export const PEN_OPACITY = { min: 0.1, max: 1 } as const;
export const ERASER_SIZE = { min: 4, max: 40 } as const;
/** 消しゴムは太さ（半径）だけ。既定 12 */
export const DEFAULT_ERASER: EraserStyle = { size: 12 };
export const RECENT_COLORS_MAX = 6;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** `#RRGGBB` だけを色として認める（小文字にそろえる）。それ以外は undefined＝テーマの墨 */
export function normalizeColor(v: unknown): string | undefined {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : undefined;
}

/** 保存値からペン設定を読む。使えない値なら null（エンジンの既定を使う） */
export function parsePenStyle(raw: unknown): PenStyle | null {
  if (!isObj(raw)) return null;
  const { preset, size, opacity } = raw;
  if (typeof preset !== 'string' || !(PEN_PRESET_ORDER as readonly string[]).includes(preset)) return null;
  if (typeof size !== 'number' || !Number.isFinite(size)) return null;
  if (typeof opacity !== 'number' || !Number.isFinite(opacity)) return null;
  const style: PenStyle = {
    preset: preset as PenPreset,
    size: clamp(Math.round(size), PEN_SIZE.min, PEN_SIZE.max),
    opacity: clamp(Math.round(opacity * 100) / 100, PEN_OPACITY.min, PEN_OPACITY.max),
  };
  const color = normalizeColor(raw.color);
  if (color) style.color = color;
  return style;
}

/**
 * 保存値から消しゴム設定（{ size }）を読む。使えない値は既定（12）。
 * 旧形式 { mode, size } は size だけを使う（消し方の切替は廃止）。
 */
export function parseEraserStyle(raw: unknown): EraserStyle {
  if (!isObj(raw)) return { ...DEFAULT_ERASER };
  const size =
    typeof raw.size === 'number' && Number.isFinite(raw.size)
      ? clamp(Math.round(raw.size), ERASER_SIZE.min, ERASER_SIZE.max)
      : DEFAULT_ERASER.size;
  return { size };
}

export function parseRecentColors(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    const c = normalizeColor(v);
    if (c && !out.includes(c)) out.push(c);
    if (out.length >= RECENT_COLORS_MAX) break;
  }
  return out;
}

/** 任意色を直近の先頭へ（重複は前へ寄せ、6 つまで） */
export function pushRecentColor(list: readonly string[], color: string): string[] {
  const c = normalizeColor(color);
  if (!c) return [...list];
  return [c, ...list.filter((x) => x !== c)].slice(0, RECENT_COLORS_MAX);
}

function readJson(key: string): unknown {
  try {
    const s = globalThis.localStorage?.getItem(key);
    return s ? (JSON.parse(s) as unknown) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, v: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(v));
  } catch {
    // 保存できない環境（プライベートモード等）では、その場かぎりの設定にする
  }
}

export const loadPenStyle = (): PenStyle | null => parsePenStyle(readJson(PEN_STYLE_KEY));
export const savePenStyle = (s: PenStyle): void => writeJson(PEN_STYLE_KEY, s);
export const loadEraserStyle = (): EraserStyle => parseEraserStyle(readJson(ERASER_STYLE_KEY));
export const saveEraserStyle = (s: EraserStyle): void => writeJson(ERASER_STYLE_KEY, { size: s.size });
export const loadRecentColors = (): string[] => parseRecentColors(readJson(PEN_RECENT_COLORS_KEY));
export const saveRecentColors = (list: readonly string[]): void => writeJson(PEN_RECENT_COLORS_KEY, list);

// ---------------------------------------------------------------------------
// グリッド（ミニセグメントの 2 段: 分割 ／ 方眼 px）
// ---------------------------------------------------------------------------

export type GridKey = 'none' | 'd2' | 'd3' | 'd4' | 'd6' | 'd8' | 'p25' | 'p50' | 'p100';

export const GRID_DIVIDE: { key: GridKey; label: string }[] = [
  { key: 'none', label: 'なし' },
  { key: 'd2', label: '2' },
  { key: 'd3', label: '3' },
  { key: 'd4', label: '4' },
  { key: 'd6', label: '6' },
  { key: 'd8', label: '8' },
];

export const GRID_PITCH: { key: GridKey; label: string }[] = [
  { key: 'p25', label: '25' },
  { key: 'p50', label: '50' },
  { key: 'p100', label: '100' },
];

export function gridSpecOf(key: GridKey): GridSpec {
  switch (key) {
    case 'none':
      return 'none';
    case 'd2':
      return { kind: 'divide', n: 2 };
    case 'd3':
      return { kind: 'divide', n: 3 };
    case 'd4':
      return { kind: 'divide', n: 4 };
    case 'd6':
      return { kind: 'divide', n: 6 };
    case 'd8':
      return { kind: 'divide', n: 8 };
    case 'p25':
      return { kind: 'pitch', px: 25 };
    case 'p50':
      return { kind: 'pitch', px: 50 };
    case 'p100':
      return { kind: 'pitch', px: 100 };
  }
}

/** 読み上げ用の名前（「3分割」「50px の方眼」） */
export function gridLabel(key: GridKey): string {
  if (key === 'none') return 'グリッドなし';
  return key.startsWith('d') ? `${key.slice(1)}分割` : `${key.slice(1)}px の方眼`;
}

// ---------------------------------------------------------------------------
// 塗りつぶし・図形（お絵描き v2 のフルツール）
// ---------------------------------------------------------------------------

export const FILL_STYLE_KEY = 'seichotsu.fillStyle';
export const SHAPE_KEY = 'seichotsu.shapeTool';

export type FillRef = 'layer' | 'all';
export interface FillPrefs {
  /** エンジンの許容値 0..255 */
  tolerance: number;
  reference: FillRef;
}
/** エンジンの既定（許容値 32・このレイヤー） */
export const DEFAULT_FILL: FillPrefs = { tolerance: 32, reference: 'layer' };

/** 表示の許容値 0..100 → エンジンの 0..255 */
export function toleranceFromPercent(pct: number): number {
  return Math.round((clamp(pct, 0, 100) * 255) / 100);
}
/** エンジンの 0..255 → 表示の 0..100 */
export function toleranceToPercent(t: number): number {
  return Math.round((clamp(t, 0, 255) * 100) / 255);
}

export function parseFillPrefs(raw: unknown): FillPrefs {
  if (!isObj(raw)) return { ...DEFAULT_FILL };
  const tolerance =
    typeof raw.tolerance === 'number' && Number.isFinite(raw.tolerance) ? clamp(Math.round(raw.tolerance), 0, 255) : DEFAULT_FILL.tolerance;
  const reference: FillRef = raw.reference === 'all' ? 'all' : 'layer';
  return { tolerance, reference };
}

export type ShapeTool = 'shape-line' | 'shape-rect' | 'shape-ellipse';
export const SHAPE_ORDER: readonly ShapeTool[] = ['shape-line', 'shape-rect', 'shape-ellipse'];
export const SHAPE_LABEL: Record<ShapeTool, string> = { 'shape-line': '直線', 'shape-rect': '四角', 'shape-ellipse': '楕円' };

export function parseShapeTool(raw: unknown): ShapeTool {
  return typeof raw === 'string' && (SHAPE_ORDER as readonly string[]).includes(raw) ? (raw as ShapeTool) : 'shape-line';
}

export const loadFillPrefs = (): FillPrefs => parseFillPrefs(readJson(FILL_STYLE_KEY));
export const saveFillPrefs = (f: FillPrefs): void => writeJson(FILL_STYLE_KEY, f);
export const loadShapeTool = (): ShapeTool => parseShapeTool(readJson(SHAPE_KEY));
export const saveShapeTool = (t: ShapeTool): void => writeJson(SHAPE_KEY, t);
