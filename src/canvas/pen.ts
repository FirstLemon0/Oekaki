/** ペンのプリセットと、ストロークの見た目の計算（純関数）。DOM 非依存。 */
import type { StrokePoint, Vec2 } from '@/scoring/types';
import type { EraserStyle, PenPreset, PenStyle, StrokeStyle } from './types';

export interface PenPresetSpec {
  label: string;
  /** 既定の基準幅 px */
  size: number;
  /** 既定の不透明度 */
  opacity: number;
  /** 筆圧 0→1 での幅倍率 */
  pressureWidth: [number, number];
  /** 筆圧 0→1 での不透明度倍率 */
  pressureOpacity: [number, number];
  /** 入り抜き（始点・終点で幅を絞る） */
  taper: boolean;
  blend: 'source-over' | 'multiply';
  /** 契約への追加: 点の位置を ±grain px だけずらすざらつき（シード固定）。0 でなし */
  grain: number;
}

export const PEN_PRESETS: Record<PenPreset, PenPresetSpec> = {
  pencil: {
    label: '鉛筆',
    size: 2,
    opacity: 0.85,
    pressureWidth: [0.6, 1.2],
    pressureOpacity: [0.5, 1.0],
    taper: false,
    blend: 'source-over',
    grain: 0.5,
  },
  pen: {
    label: 'ペン',
    size: 3,
    opacity: 1,
    pressureWidth: [0.5, 1.6],
    pressureOpacity: [1, 1],
    taper: false,
    blend: 'source-over',
    grain: 0,
  },
  brush: {
    label: '筆ペン',
    size: 5,
    opacity: 1,
    pressureWidth: [0.2, 2.2],
    pressureOpacity: [1, 1],
    taper: true,
    blend: 'source-over',
    grain: 0,
  },
  marker: {
    label: 'マーカー',
    size: 10,
    opacity: 0.45,
    pressureWidth: [1, 1],
    pressureOpacity: [1, 1],
    taper: false,
    blend: 'multiply',
    grain: 0,
  },
};

/** パレット 1 色。 */
export interface PaletteColor {
  label: string;
  /** `#RRGGBB` */
  color: string;
}

/** パレットの推奨 14 色（先頭の墨は inkColor に近い色。テーマ追従させたいときは color を未指定にする） */
export const PALETTE_COLORS: readonly PaletteColor[] = [
  { label: '墨', color: '#2B2A28' },
  { label: '灰', color: '#8E8A80' },
  { label: '茶', color: '#7A5230' },
  { label: '赤', color: '#C8553D' },
  { label: '朱', color: '#D9674A' },
  { label: '橙', color: '#E08A2E' },
  { label: '黄', color: '#D9A441' },
  { label: '若葉', color: '#7BB661' },
  { label: '緑', color: '#3E8E7E' },
  { label: '青', color: '#3E7EC8' },
  { label: '藍', color: '#2F4E8F' },
  { label: '紫', color: '#7C5CB8' },
  { label: '桃', color: '#D97BA0' },
  { label: '白', color: '#FAF8F3' },
];

/** `#RRGGBB`（大文字小文字どちらも）なら大文字に正規化して返す。それ以外は undefined。 */
export function normalizeHexColor(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const m = /^#([0-9a-fA-F]{6})$/.exec(v.trim());
  return m ? `#${m[1]!.toUpperCase()}` : undefined;
}

export const PEN_SIZE_RANGE: [number, number] = [1, 16];
export const PEN_OPACITY_RANGE: [number, number] = [0.1, 1];
export const ERASER_SIZE_RANGE: [number, number] = [4, 40];

export const DEFAULT_PEN: PenStyle = { preset: 'pen', size: PEN_PRESETS.pen.size, opacity: PEN_PRESETS.pen.opacity };
export const DEFAULT_ERASER: EraserStyle = { size: 12 };

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;

export function isPenPreset(v: unknown): v is PenPreset {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PEN_PRESETS, v);
}

export function clampPenSize(v: number, fallback: number): number {
  return Number.isFinite(v) ? clamp(v, PEN_SIZE_RANGE[0], PEN_SIZE_RANGE[1]) : fallback;
}
export function clampOpacity(v: number, fallback: number): number {
  return Number.isFinite(v) ? clamp(v, PEN_OPACITY_RANGE[0], PEN_OPACITY_RANGE[1]) : fallback;
}
export function clampEraserSize(v: number, fallback: number): number {
  return Number.isFinite(v) ? clamp(v, ERASER_SIZE_RANGE[0], ERASER_SIZE_RANGE[1]) : fallback;
}

/** 消しゴムストロークのスタイルか。 */
export function isEraserStyle(s: StrokeStyle | undefined | null): s is StrokeStyle & { preset: 'eraser' } {
  return !!s && s.preset === 'eraser';
}

/** 消しゴムストロークのスタイル（size は半径）。 */
export function eraserStrokeStyle(radius: number): StrokeStyle {
  return { preset: 'eraser', size: clampEraserSize(radius, DEFAULT_ERASER.size), opacity: 1 };
}

/** 読み込んだスタイルの検証。壊れていれば undefined（旧データ扱い）。 */
export function sanitizeStyle(s: unknown): StrokeStyle | undefined {
  if (!s || typeof s !== 'object') return undefined;
  const o = s as Partial<StrokeStyle>;
  if (o.preset === 'eraser') return eraserStrokeStyle(Number(o.size));
  if (!isPenPreset(o.preset)) return undefined;
  const spec = PEN_PRESETS[o.preset];
  const out: StrokeStyle = {
    preset: o.preset,
    size: clampPenSize(Number(o.size), spec.size),
    opacity: clampOpacity(Number(o.opacity), spec.opacity),
  };
  const color = normalizeHexColor(o.color);
  if (color) out.color = color;
  return out;
}

/** 描画に使う解決済みの見た目。 */
export interface ResolvedPen {
  size: number;
  opacity: number;
  pressureWidth: [number, number];
  pressureOpacity: [number, number];
  taper: boolean;
  blend: 'source-over' | 'multiply';
  grain: number;
}

/**
 * スタイル → 解決済みの見た目。undefined（旧データ）は baseWidth の pen（0.5x..1.6x、不透明）。
 */
export function resolvePen(style: StrokeStyle | undefined, baseWidth: number): ResolvedPen {
  const preset = style && isPenPreset(style.preset) ? style.preset : 'pen';
  const spec = PEN_PRESETS[preset];
  return {
    size: style ? style.size : baseWidth,
    opacity: style ? style.opacity : 1,
    pressureWidth: spec.pressureWidth,
    pressureOpacity: spec.pressureOpacity,
    taper: spec.taper,
    blend: spec.blend,
    grain: spec.grain,
  };
}

/** シルエット表示用（白地に太い黒）。不透明・通常合成・ざらつき／入り抜きなし。 */
export function silhouettePen(rp: ResolvedPen): ResolvedPen {
  const [w0, w1] = rp.pressureWidth;
  return {
    size: rp.size,
    opacity: 1,
    pressureWidth: [Math.max(w0 * 3, 4), Math.max(w1 * 3, 4)],
    pressureOpacity: [1, 1],
    taper: false,
    blend: 'source-over',
    grain: 0,
  };
}

/** 筆圧 p での線幅（入り抜き前）。 */
export function penWidth(rp: ResolvedPen, p: number): number {
  const pp = Number.isFinite(p) ? clamp(p, 0, 1) : 0.5;
  return rp.size * lerp(rp.pressureWidth[0], rp.pressureWidth[1], pp);
}

/** 筆圧 p での不透明度倍率（ストローク全体の opacity は別に掛ける）。 */
export function penAlpha(rp: ResolvedPen, p: number): number {
  const pp = Number.isFinite(p) ? clamp(p, 0, 1) : 0.5;
  return lerp(rp.pressureOpacity[0], rp.pressureOpacity[1], pp);
}

/** この見た目で線幅が取りうる最大値。 */
export function maxPenWidth(rp: ResolvedPen): number {
  return rp.size * Math.max(rp.pressureWidth[0], rp.pressureWidth[1]);
}

/** 別レイヤーに描いてから合成する必要があるか（重なりを濃くしないため）。 */
export function needsLayer(rp: ResolvedPen): boolean {
  return rp.opacity < 1 || rp.blend !== 'source-over' || rp.pressureOpacity[0] !== rp.pressureOpacity[1];
}

/** 入り抜きの長さ（px）。ストロークの長さの 35% まで、最大 size × 6。 */
export function taperLength(rp: ResolvedPen, total: number): number {
  return Math.min(rp.size * 6, total * 0.35);
}

/** 入り抜きの最小倍率（0 だと線が消えるので少しだけ残す） */
export const TAPER_MIN = 0.08;

/**
 * 入り抜きの幅倍率。s は始点からの弧長、total は全長（進行中で終点が未定なら null → 始点側だけ絞る）。
 * taper なしのペンは常に 1。
 */
export function taperFactor(rp: ResolvedPen, s: number, total: number | null, len: number): number {
  if (!rp.taper || len <= 0) return 1;
  let f = Math.min(1, s / len);
  if (total !== null) f = Math.min(f, (total - s) / len);
  return Math.max(TAPER_MIN, Math.min(1, f));
}

/** 各点までの弧長（先頭 0）。 */
export function cumulativeLength(pts: readonly Vec2[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) acc += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
    out.push(acc);
  }
  return out;
}

/** 32bit ハッシュ → [0,1)。 */
function hash01(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** ストロークのシード（最初の点から決める。同じデータなら何度描いても同じざらつき）。 */
export function strokeSeed(pts: readonly StrokePoint[]): number {
  const f = pts[0];
  if (!f) return 0;
  const t = Number.isFinite(f.t) ? f.t : 0;
  return (Math.round(f.x * 16) * 73856093) ^ (Math.round(f.y * 16) * 19349663) ^ (Math.round(t) * 83492791);
}

/**
 * ざらつき: 各点を ±amp px（x・y それぞれ）ずらした点列を返す。点ごとに決まるので途中まで描いても結果は同じ。
 * amp が 0 なら元の配列をそのまま返す。
 */
export function jitterPoints(pts: readonly StrokePoint[], amp: number, seed = strokeSeed(pts)): readonly StrokePoint[] {
  if (!(amp > 0)) return pts;
  return pts.map((q, i) => ({
    x: q.x + (hash01(seed, i * 2) * 2 - 1) * amp,
    y: q.y + (hash01(seed, i * 2 + 1) * 2 - 1) * amp,
    p: q.p,
    t: q.t,
  }));
}

/** ストローク作成時に保存するスタイル（現在のペン設定のコピー）。 */
export function styleFromPen(pen: PenStyle): StrokeStyle {
  const out: StrokeStyle = { preset: pen.preset, size: pen.size, opacity: pen.opacity };
  if (pen.color) out.color = pen.color;
  return out;
}
