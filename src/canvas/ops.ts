/**
 * 操作履歴（CanvasOp）の DOM に依存しない部分（純関数）。
 * - レイヤーの並び・設定の再生（applyLayerOp / listAfter）
 * - 各 op がどのレイヤーの画素を書き換えるか（writesOf）
 * - 採点・保存用の点列モデル（vectorModel）: レイヤーごとの生の履歴（消しゴム込み）
 * - 読み込んだ文書の検証（sanitizeDocument）
 */
import type { Drawing, Stroke } from '@/scoring/types';
import type { BlendMode, CanvasDocument, CanvasOp, LayerInfo, StrokeStyle } from './types';
import { isFiniteMat } from './matrix';
import { copyMask, cutStrokes, sanitizeMask } from './selection';
import { flattenHistory } from './erase';
import { normalizeHexColor, sanitizeStyle } from './pen';

/**
 * エンジン内部の op。stroke の style だけ undefined（旧データ = baseWidth のペン）を許す。
 * getDocument() では明示的なスタイルに直して出す。
 */
export type EngineOp =
  | Exclude<CanvasOp, { kind: 'stroke' }>
  | { kind: 'stroke'; layer: string; points: Stroke; style: StrokeStyle | undefined };

export const DEFAULT_TOLERANCE = 32;
export const BLEND_MODES: readonly BlendMode[] = ['normal', 'multiply', 'screen'];

export function layerName(n: number): string {
  return `レイヤー ${n}`;
}

export function newLayerInfo(id: string, name: string): LayerInfo {
  return { id, name, visible: true, opacity: 1, locked: false, blend: 'normal' };
}

export function copyInfo(l: LayerInfo): LayerInfo {
  return { ...l };
}

const clamp01 = (v: number, fb: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fb);

/** patch の検証（知らないキー・壊れた値は落とす） */
export function sanitizePatch(p: unknown): Partial<Omit<LayerInfo, 'id'>> {
  const out: Partial<Omit<LayerInfo, 'id'>> = {};
  if (!p || typeof p !== 'object') return out;
  const o = p as Record<string, unknown>;
  if (typeof o.name === 'string') out.name = o.name.slice(0, 100);
  if (typeof o.visible === 'boolean') out.visible = o.visible;
  if (typeof o.locked === 'boolean') out.locked = o.locked;
  if (o.opacity !== undefined && Number.isFinite(Number(o.opacity))) out.opacity = clamp01(Number(o.opacity), 1);
  if (typeof o.blend === 'string' && (BLEND_MODES as readonly string[]).includes(o.blend)) out.blend = o.blend as BlendMode;
  return out;
}

export function sanitizeLayerInfo(l: unknown): LayerInfo | null {
  if (!l || typeof l !== 'object') return null;
  const o = l as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id === '') return null;
  return { ...newLayerInfo(o.id, typeof o.name === 'string' ? o.name : o.id), ...sanitizePatch(o) };
}

/** 並び list に op を適用した並び（レイヤーに関係しない op なら同じ配列を返す）。 */
export function applyLayerOp(list: readonly LayerInfo[], op: EngineOp): readonly LayerInfo[] {
  const at = (id: string) => list.findIndex((l) => l.id === id);
  switch (op.kind) {
    case 'layer-add': {
      if (at(op.layer.id) >= 0) return list;
      const i = Math.max(0, Math.min(list.length, Math.round(op.index)));
      const next = [...list];
      next.splice(i, 0, copyInfo(op.layer));
      return next;
    }
    case 'layer-remove': {
      const i = at(op.layer);
      if (i < 0 || list.length <= 1) return list;
      return list.filter((_, k) => k !== i);
    }
    case 'layer-move': {
      const i = at(op.layer);
      if (i < 0) return list;
      const next = [...list];
      const [l] = next.splice(i, 1);
      next.splice(Math.max(0, Math.min(next.length, Math.round(op.index))), 0, l!);
      return next;
    }
    case 'layer-set': {
      const i = at(op.layer);
      if (i < 0) return list;
      const next = [...list];
      next[i] = { ...list[i]!, ...op.patch, id: list[i]!.id };
      return next;
    }
    case 'layer-merge-down': {
      // 下のレイヤーの不透明度・合成は結合で画素に焼き込むので、結合後は不透明度 1・通常になる（名前・表示・ロックは残る）
      const i = at(op.layer);
      if (i <= 0) return list;
      const next = list.filter((_, k) => k !== i);
      next[i - 1] = { ...list[i - 1]!, opacity: 1, blend: 'normal' };
      return next;
    }
    case 'layer-duplicate': {
      const i = at(op.layer);
      if (i < 0 || at(op.newId) >= 0) return list;
      const next = [...list];
      next.splice(i + 1, 0, { ...list[i]!, id: op.newId, name: `${list[i]!.name} のコピー` });
      return next;
    }
    default:
      return list;
  }
}

/**
 * op が画素を書き換えるレイヤー（list は op を適用する前の並び）。
 * 作られるレイヤー（add / duplicate）も含める。存在しないレイヤーへの op は何も書かない。
 */
export function writesOf(op: EngineOp, list: readonly LayerInfo[]): string[] {
  const has = (id: string) => list.some((l) => l.id === id);
  switch (op.kind) {
    case 'stroke':
    case 'fill':
    case 'transform':
    case 'delete':
    case 'layer-clear':
      return has(op.layer) ? [op.layer] : [];
    case 'layer-merge-down': {
      const i = list.findIndex((l) => l.id === op.layer);
      return i > 0 ? [list[i - 1]!.id] : [];
    }
    case 'layer-add':
      return has(op.layer.id) ? [] : [op.layer.id];
    case 'layer-duplicate':
      return has(op.layer) && !has(op.newId) ? [op.newId] : [];
    default:
      return [];
  }
}

/** 画素に関わる op（stroke 以外で、Undo のためにスナップショットを取るもの） */
export function isRasterOp(op: EngineOp): boolean {
  return (
    op.kind === 'fill' ||
    op.kind === 'transform' ||
    op.kind === 'delete' ||
    op.kind === 'layer-clear' ||
    op.kind === 'layer-merge-down' ||
    op.kind === 'layer-remove'
  );
}

/* ------------------------------------------------------------------ */
/* 点列モデル（採点・保存用）                                            */
/* ------------------------------------------------------------------ */

export interface RawHistory {
  strokes: Stroke[];
  styles: (StrokeStyle | undefined)[];
}

/**
 * base の並びから ops を順に適用したときの、レイヤーごとの生の履歴（消しゴム・補助線込み）。
 * delete / transform は点列を切り分けて近似する（そのとき消しゴムは適用済みになり、補助線は落ちる）。
 */
export function vectorModel(base: readonly LayerInfo[], ops: readonly EngineOp[]): { list: readonly LayerInfo[]; raw: Map<string, RawHistory> } {
  let list = base;
  const raw = new Map<string, RawHistory>();
  for (const l of base) raw.set(l.id, { strokes: [], styles: [] });
  const flat = (h: RawHistory): RawHistory => flattenHistory(h.strokes, h.styles);
  for (const op of ops) {
    const has = (id: string) => list.some((l) => l.id === id);
    switch (op.kind) {
      case 'stroke': {
        const h = raw.get(op.layer);
        if (h && has(op.layer)) raw.set(op.layer, { strokes: [...h.strokes, op.points], styles: [...h.styles, op.style] });
        break;
      }
      case 'delete':
      case 'transform': {
        const h = raw.get(op.layer);
        if (h && has(op.layer)) raw.set(op.layer, cutStrokes(h.strokes, h.styles, op.mask, op.kind === 'transform' ? op.matrix : null));
        break;
      }
      case 'layer-clear':
        if (has(op.layer)) raw.set(op.layer, { strokes: [], styles: [] });
        break;
      case 'layer-add':
        if (!has(op.layer.id)) raw.set(op.layer.id, { strokes: [], styles: [] });
        break;
      case 'layer-duplicate': {
        const h = raw.get(op.layer);
        if (h && has(op.layer) && !has(op.newId)) raw.set(op.newId, { strokes: [...h.strokes], styles: [...h.styles] });
        break;
      }
      case 'layer-merge-down': {
        const i = list.findIndex((l) => l.id === op.layer);
        if (i > 0) {
          const below = list[i - 1]!.id;
          const a = flat(raw.get(below) ?? { strokes: [], styles: [] });
          const b = list[i]!.visible ? flat(raw.get(op.layer) ?? { strokes: [], styles: [] }) : { strokes: [], styles: [] };
          raw.set(below, { strokes: [...a.strokes, ...b.strokes], styles: [...a.styles, ...b.styles] });
          raw.delete(op.layer);
        }
        break;
      }
      case 'layer-remove':
        if (has(op.layer) && list.length > 1) raw.delete(op.layer);
        break;
      default:
        break;
    }
    list = applyLayerOp(list, op);
  }
  return { list, raw };
}

/** 見えているレイヤーのペンの線（下から順、消しゴム適用済み）。 */
export function visibleInk(model: { list: readonly LayerInfo[]; raw: Map<string, RawHistory> }): { strokes: Drawing; styles: (StrokeStyle | undefined)[] } {
  const strokes: Drawing = [];
  const styles: (StrokeStyle | undefined)[] = [];
  for (const l of model.list) {
    if (!l.visible) continue;
    const h = model.raw.get(l.id);
    if (!h) continue;
    const f = flattenHistory(h.strokes, h.styles);
    strokes.push(...f.strokes);
    styles.push(...f.styles);
  }
  return { strokes, styles };
}

/* ------------------------------------------------------------------ */
/* 読み込みの検証                                                        */
/* ------------------------------------------------------------------ */

function sanitizeStroke(s: unknown): Stroke | null {
  if (!Array.isArray(s)) return null;
  const out: Stroke = [];
  for (const p of s) {
    if (!p || typeof p !== 'object') continue;
    const o = p as Record<string, unknown>;
    const x = Number(o.x);
    const y = Number(o.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const pr = Number(o.p);
    const t = Number(o.t);
    out.push({ x, y, p: Number.isFinite(pr) ? pr : 0.5, t: Number.isFinite(t) ? t : 0 });
  }
  return out;
}

export function sanitizeOp(op: unknown): EngineOp | null {
  if (!op || typeof op !== 'object') return null;
  const o = op as Record<string, unknown>;
  const layer = typeof o.layer === 'string' ? o.layer : null;
  switch (o.kind) {
    case 'stroke': {
      const points = sanitizeStroke(o.points);
      if (!layer || !points) return null;
      return { kind: 'stroke', layer, points, style: sanitizeStyle(o.style) };
    }
    case 'fill': {
      const x = Number(o.x);
      const y = Number(o.y);
      // 'ink' は墨（テーマの墨色に描画時に解決する記号）
      const color = o.color === 'ink' ? 'ink' : normalizeHexColor(o.color);
      if (!layer || !Number.isFinite(x) || !Number.isFinite(y) || !color) return null;
      const tol = Number(o.tolerance);
      return {
        kind: 'fill',
        layer,
        x,
        y,
        color,
        tolerance: Number.isFinite(tol) ? Math.min(255, Math.max(0, tol)) : DEFAULT_TOLERANCE,
        reference: o.reference === 'all' ? 'all' : 'layer',
      };
    }
    case 'transform': {
      const mask = sanitizeMask(o.mask);
      if (!layer || !mask || !isFiniteMat(o.matrix)) return null;
      return { kind: 'transform', layer, mask, matrix: [...o.matrix] as typeof o.matrix };
    }
    case 'delete': {
      const mask = sanitizeMask(o.mask);
      if (!layer || !mask) return null;
      return { kind: 'delete', layer, mask };
    }
    case 'layer-add': {
      const info = sanitizeLayerInfo(o.layer);
      const index = Number(o.index);
      if (!info) return null;
      return { kind: 'layer-add', layer: info, index: Number.isFinite(index) ? index : 0 };
    }
    case 'layer-remove':
    case 'layer-merge-down':
    case 'layer-clear':
      return layer ? { kind: o.kind, layer } : null;
    case 'layer-move': {
      const index = Number(o.index);
      return layer && Number.isFinite(index) ? { kind: 'layer-move', layer, index } : null;
    }
    case 'layer-set':
      return layer ? { kind: 'layer-set', layer, patch: sanitizePatch(o.patch) } : null;
    case 'layer-duplicate':
      return layer && typeof o.newId === 'string' && o.newId !== '' ? { kind: 'layer-duplicate', layer, newId: o.newId } : null;
    default:
      return null;
  }
}

/** 読み込む文書の検証。壊れた op は捨てる。レイヤーが 1 枚も無ければ null。 */
export function sanitizeDocument(doc: unknown): { width: number; height: number; layers: LayerInfo[]; active: string; ops: EngineOp[] } | null {
  if (!doc || typeof doc !== 'object') return null;
  const o = doc as Record<string, unknown>;
  const layers: LayerInfo[] = [];
  if (Array.isArray(o.layers)) {
    for (const l of o.layers) {
      const info = sanitizeLayerInfo(l);
      if (info && !layers.some((x) => x.id === info.id)) layers.push(info);
    }
  }
  if (layers.length === 0) return null;
  const ops: EngineOp[] = [];
  if (Array.isArray(o.ops)) for (const op of o.ops) {
    const s = sanitizeOp(op);
    if (s) ops.push(s);
  }
  const w = Number(o.width);
  const h = Number(o.height);
  return {
    width: Number.isFinite(w) && w > 0 ? w : 0,
    height: Number.isFinite(h) && h > 0 ? h : 0,
    layers,
    active: typeof o.active === 'string' ? o.active : '',
    ops,
  };
}

/** 保存用の深いコピー（stroke の style が無ければ baseWidth のペンにする） */
export function exportOp(op: EngineOp, baseWidth: number): CanvasOp {
  switch (op.kind) {
    case 'stroke':
      return {
        kind: 'stroke',
        layer: op.layer,
        points: op.points.map((p) => ({ x: p.x, y: p.y, p: p.p, t: p.t })),
        style: op.style ? { ...op.style } : { preset: 'pen', size: baseWidth, opacity: 1 },
      };
    case 'transform':
      return { kind: 'transform', layer: op.layer, mask: copyMask(op.mask), matrix: [...op.matrix] as typeof op.matrix };
    case 'delete':
      return { kind: 'delete', layer: op.layer, mask: copyMask(op.mask) };
    case 'layer-add':
      return { kind: 'layer-add', layer: copyInfo(op.layer), index: op.index };
    case 'layer-set':
      return { kind: 'layer-set', layer: op.layer, patch: { ...op.patch } };
    default:
      return { ...op };
  }
}
