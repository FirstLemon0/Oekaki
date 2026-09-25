/**
 * お絵描き v2 と既存機能の統合（2026-09-25 レビュー対応）。
 * - 白紙の判定（hasContent）・描いた手数（drawOpCount）
 * - 回転・引き継ぎでの文書の写し（rescaleDocument。塗り・変形・削除・墨 'ink'）
 * - 構築の引き継ぎ（rememberCanvas が文書ごと覚える）
 * - 下書き（文書があれば history を持たない・容量超過・触れている間は書かない・文書からの復元）
 * - 「全部消す」後の getHistory（消した線が採点・下書きによみがえらない）
 * - ギャラリーの再生範囲（contentRect・旧データの推定で縦横比を保つ）
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCanvasEngine, type StrokeHistory } from '@/canvas';
import type { Stroke } from '@/scoring/types';
import {
  alphaBounds,
  docSourceRect,
  drawOpCount,
  hasContent,
  paddedContentRect,
  readContentRect,
  rescaleDocument,
} from '../paint/canvasDoc';
import type { CanvasDocument, CanvasOp, LayerInfo } from '../paint/types';
import { rescaleMap } from './drillSetup';
import { rememberCanvas, type LessonSession } from './stateBridge';
import { clearDraft, DRAFT_MAX_CHARS, draftKey, draftTooLarge, historyFromDoc, isPointerDown, loadDraft, saveDraft } from '../draft';

const line = (y: number, n = 5, x0 = 10): Stroke => Array.from({ length: n }, (_, i) => ({ x: x0 + i * 10, y, p: 0.5, t: i * 10 }));
const L1: LayerInfo = { id: 'L1', name: 'レイヤー 1', visible: true, opacity: 1, locked: false, blend: 'normal' };
const L2: LayerInfo = { ...L1, id: 'L2', name: 'レイヤー 2' };
const PEN = { preset: 'pen', size: 3, opacity: 1 } as const;
const ERASER = { preset: 'eraser', size: 12, opacity: 1 } as const;

function doc(ops: CanvasOp[], layers: LayerInfo[] = [L1]): CanvasDocument {
  return { v: 2, width: 800, height: 600, layers, active: layers[layers.length - 1]!.id, ops };
}
const stroke = (layer: string, y = 100, style: CanvasOp extends infer _ ? typeof PEN | typeof ERASER : never = PEN): CanvasOp =>
  ({ kind: 'stroke', layer, points: line(y), style }) as CanvasOp;
const fill = (layer: string, color = '#c8553d'): CanvasOp => ({ kind: 'fill', layer, x: 50, y: 60, color, tolerance: 32, reference: 'layer' });

// ---------------------------------------------------------------------------
// 白紙の判定・描いた手数
// ---------------------------------------------------------------------------

describe('hasContent（白紙の保存・提出を止める）', () => {
  it('レイヤーを足しただけ・設定を変えただけは偽', () => {
    expect(hasContent(doc([]))).toBe(false);
    expect(hasContent(doc([{ kind: 'layer-add', layer: L2, index: 1 }]))).toBe(false);
    expect(hasContent(doc([{ kind: 'layer-set', layer: 'L1', patch: { opacity: 0.5 } }]))).toBe(false);
  });
  it('塗りだけでも真。消しゴムだけ・補助線だけは偽', () => {
    expect(hasContent(doc([fill('L1')]))).toBe(true);
    expect(hasContent(doc([stroke('L1', 100, ERASER)]))).toBe(false);
    expect(hasContent(doc([{ kind: 'stroke', layer: 'L1', points: line(10), style: { preset: 'guide', size: 1, opacity: 0.4 } } as CanvasOp]))).toBe(false);
  });
  it('全部消したあとは偽、別レイヤーに描けば真。削除・結合・複製をたどる', () => {
    expect(hasContent(doc([stroke('L1'), { kind: 'layer-clear', layer: 'L1' }]))).toBe(false);
    const added: CanvasOp = { kind: 'layer-add', layer: L2, index: 1 };
    expect(hasContent(doc([added, stroke('L2')]))).toBe(true);
    expect(hasContent(doc([added, stroke('L2'), { kind: 'layer-remove', layer: 'L2' }]))).toBe(false);
    expect(hasContent(doc([added, stroke('L2'), { kind: 'layer-merge-down', layer: 'L2' }]))).toBe(true);
    expect(
      hasContent(doc([added, stroke('L2'), { kind: 'layer-duplicate', layer: 'L2', newId: 'L3' }, { kind: 'layer-clear', layer: 'L2' }])),
    ).toBe(true);
  });
  it('エンジンの文書: 塗りだけ・レイヤー追加だけ', () => {
    const e = createCanvasEngine();
    e.addLayer();
    expect(hasContent(e.getDocument())).toBe(false);
    e.loadDocument(doc([fill('L1')]));
    expect(hasContent(e.getDocument())).toBe(true);
  });
});

describe('drawOpCount（構築で「ここで描いたか」）', () => {
  it('線・塗り・変形・削除を数え、レイヤー操作は数えない', () => {
    const ops: CanvasOp[] = [
      stroke('L1'),
      { kind: 'layer-add', layer: L2, index: 1 },
      fill('L2'),
      { kind: 'transform', layer: 'L2', mask: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, matrix: [1, 0, 0, 1, 5, 5] },
      { kind: 'delete', layer: 'L2', mask: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 } },
      { kind: 'layer-set', layer: 'L2', patch: { visible: false } },
    ];
    expect(drawOpCount(doc(ops))).toBe(4);
  });
  it('引き継いだ文書のあと、別のレイヤーに描いても増える（getStrokes のアクティブ履歴では増えない場合）', () => {
    const e = createCanvasEngine();
    e.loadStrokes([line(10), line(20)]);
    const session = { lastCanvas: null } as unknown as LessonSession;
    // 紙の大きさが無い（attach 前）ときは覚えない
    rememberCanvas(session, e);
    expect(session.lastCanvas).toBeNull();
    rememberCanvas(session, { getHistory: () => e.getHistory(), getDocument: () => e.getDocument(), size: () => ({ width: 800, height: 600 }) });
    const carry = session.lastCanvas!;
    expect(carry.doc?.ops.length).toBe(2);
    const next = createCanvasEngine();
    next.loadDocument(carry.doc!);
    const base = drawOpCount(next.getDocument());
    const layer = next.addLayer();
    next.setActiveLayer(layer.id);
    next.loadDocument({ ...next.getDocument(), ops: [...next.getDocument().ops, fill(layer.id)] });
    expect(drawOpCount(next.getDocument())).toBe(base + 1);
  });
  it('引き継ぎは文書ごと（塗り・レイヤーも残る）', () => {
    const src = doc([{ kind: 'layer-add', layer: L2, index: 1 }, stroke('L1'), fill('L2')]);
    const session = { lastCanvas: null } as unknown as LessonSession;
    const e = createCanvasEngine();
    e.loadDocument(src);
    rememberCanvas(session, { getHistory: () => e.getHistory(), getDocument: () => e.getDocument(), size: () => ({ width: 800, height: 600 }) });
    const kinds = session.lastCanvas!.doc!.ops.map((o) => o.kind);
    expect(kinds).toContain('fill');
    expect(kinds).toContain('layer-add');
  });
});

// ---------------------------------------------------------------------------
// 回転（rescaleDocument）
// ---------------------------------------------------------------------------

describe('rescaleDocument（回転・大きさ違いの復元）', () => {
  const from = { width: 1000, height: 700 };
  const to = { width: 700, height: 1000 };
  const map = rescaleMap(from, to);

  it('塗り（墨 ink を含む）・変形・削除・線を同じ規則で写し、ほかは変えない', () => {
    const tf: CanvasOp = {
      kind: 'transform',
      layer: 'L1',
      mask: { kind: 'lasso', points: [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 200, y: 300 }] },
      matrix: [0, 1, -1, 0, 400, 50],
    };
    const src: CanvasDocument = {
      ...doc([
        stroke('L1', 200),
        fill('L1', 'ink'),
        tf,
        { kind: 'delete', layer: 'L1', mask: { kind: 'rect', x: 10, y: 20, w: 30, h: 40 } },
        { kind: 'layer-set', layer: 'L1', patch: { blend: 'multiply' } },
      ]),
      ...from,
    };
    const out = rescaleDocument(src, from, to);
    expect(out.width).toBe(700);
    expect(out.height).toBe(1000);
    const f = out.ops[1] as Extract<CanvasOp, { kind: 'fill' }>;
    expect(f.color).toBe('ink');
    const m = map({ x: 50, y: 60, p: 0, t: 0 });
    expect(f.x).toBeCloseTo(m.x, 6);
    expect(f.y).toBeCloseTo(m.y, 6);
    // 変形: 元で M をかけてから写す ＝ 写してから M' をかける
    const t0 = src.ops[2] as Extract<CanvasOp, { kind: 'transform' }>;
    const t1 = out.ops[2] as Extract<CanvasOp, { kind: 'transform' }>;
    const apply = (mm: readonly number[], p: { x: number; y: number }) => ({ x: mm[0]! * p.x + mm[2]! * p.y + mm[4]!, y: mm[1]! * p.x + mm[3]! * p.y + mm[5]! });
    for (const p of [{ x: 0, y: 0 }, { x: 123, y: 456 }, { x: 900, y: 10 }]) {
      const a = map({ ...apply(t0.matrix, p), p: 0, t: 0 });
      const b = apply(t1.matrix, map({ ...p, p: 0, t: 0 }));
      expect(b.x).toBeCloseTo(a.x, 6);
      expect(b.y).toBeCloseTo(a.y, 6);
    }
    expect(t1.mask.kind === 'lasso' && t1.mask.points[0]!.x).toBeCloseTo(map({ x: 100, y: 100, p: 0, t: 0 }).x, 6);
    const d = out.ops[3] as Extract<CanvasOp, { kind: 'delete' }>;
    const k = Math.min(to.width, to.height) / Math.min(from.width, from.height);
    expect(d.mask.kind === 'rect' && d.mask.w).toBeCloseTo(30 * k, 6);
    expect(out.ops[4]).toEqual(src.ops[4]);
    // 元の文書は変えない
    expect((src.ops[1] as Extract<CanvasOp, { kind: 'fill' }>).x).toBe(50);
  });

  it('エンジンに戻せる（loadDocument で塗り・変形の op が残る）', () => {
    const e = createCanvasEngine();
    e.loadDocument({
      ...doc([stroke('L1', 200), fill('L1', 'ink'), { kind: 'transform', layer: 'L1', mask: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 }, matrix: [1, 0, 0, 1, 10, 0] }]),
      ...from,
    });
    const out = rescaleDocument(e.getDocument(), from, to);
    e.loadDocument(out);
    const kinds = e.getDocument().ops.map((o) => o.kind);
    expect(kinds).toEqual(['stroke', 'fill', 'transform']);
    const f = e.getDocument().ops[1] as Extract<CanvasOp, { kind: 'fill' }>;
    expect(f.color).toBe('ink');
  });
});

// ---------------------------------------------------------------------------
// 「全部消す」の後（採点画面: gestures: false 前提の簡易ツール）
// ---------------------------------------------------------------------------

describe('全部消す → もう一回 → 回転 → 下書き復元', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('clear() 後の getHistory には消した線が残らない', () => {
    const e = createCanvasEngine();
    e.loadStrokes([line(10), line(20)]);
    e.clear();
    expect(e.getStrokes()).toHaveLength(0);
    expect(e.getHistory().strokes).toHaveLength(0);
  });

  it('消した線が回転（loadHistory で写す）・下書きの復元でよみがえらない', () => {
    vi.stubGlobal('sessionStorage', memoryStorage());
    const e = createCanvasEngine();
    e.loadStrokes([line(10), line(20)]);
    e.clear();
    // もう一回（新しい 1 本）
    e.loadHistory({ strokes: [...e.getHistory().strokes, line(50)], styles: [...e.getHistory().styles, undefined] });
    // 回転: CanvasScreen（簡易ツール）と同じく getHistory を写して loadHistory
    const map = rescaleMap({ width: 800, height: 600 }, { width: 600, height: 800 });
    const h = e.getHistory();
    e.loadHistory({ strokes: h.strokes.map((s) => s.map(map)), styles: h.styles });
    expect(e.getStrokes()).toHaveLength(1);
    // 下書き: 簡易ツールは getHistory だけを保存する
    const key = draftKey('L', 3);
    saveDraft(key, e.getHistory(), { width: 600, height: 800 }, null);
    const d = loadDraft(key)!;
    const back = createCanvasEngine();
    back.loadHistory(d.history);
    expect(back.getStrokes()).toHaveLength(1);
  });

  it('文書だけの下書きから作る履歴も、最後の全消去より後だけ', () => {
    const d = doc([stroke('L1', 10), stroke('L1', 20), { kind: 'layer-clear', layer: 'L1' }, stroke('L1', 50)]);
    const h = historyFromDoc(d);
    expect(h.strokes).toHaveLength(1);
    expect(h.strokes[0]![0]!.y).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// 下書きの容量
// ---------------------------------------------------------------------------

function memoryStorage(limit = Infinity): Storage & { map: Map<string, string> } {
  const m = new Map<string, string>();
  return {
    map: m,
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => {
      if (v.length > limit) throw new Error('QuotaExceededError');
      m.set(k, v);
    },
  };
}

const EMPTY: StrokeHistory = { strokes: [], styles: [] };

describe('下書きの容量と文書の復元', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('文書があれば history を二重に持たない。読み出しは文書から戻せる', () => {
    const st = memoryStorage();
    vi.stubGlobal('sessionStorage', st);
    const key = draftKey('L', 1);
    const src = { ...doc([{ kind: 'layer-add', layer: L2, index: 1 }, stroke('L2'), fill('L1', 'ink')]), active: 'L2' };
    const h: StrokeHistory = { strokes: [line(100)], styles: [PEN] };
    saveDraft(key, h, { width: 800, height: 600 }, src);
    const raw = JSON.parse(st.map.get(key)!) as Record<string, unknown>;
    expect(raw.history).toBeUndefined();
    expect(raw.doc).toBeDefined();
    const d = loadDraft(key)!;
    expect(d.doc?.ops).toHaveLength(3);
    // アクティブ（L2）の線が互換の履歴になる
    expect(d.history.strokes).toHaveLength(1);
    const e = createCanvasEngine();
    e.loadDocument(d.doc!);
    expect(e.getLayers()).toHaveLength(2);
    expect((e.getDocument().ops[2] as Extract<CanvasOp, { kind: 'fill' }>).color).toBe('ink');
  });

  it('1MB を超える下書きは保存を諦めて印だけ残す（古い下書きは残さない）', () => {
    const st = memoryStorage();
    vi.stubGlobal('sessionStorage', st);
    const key = draftKey('L', 2);
    saveDraft(key, { strokes: [line(10)], styles: [undefined] }, { width: 800, height: 600 });
    expect(loadDraft(key)).not.toBeNull();
    const many = Array.from({ length: Math.ceil(DRAFT_MAX_CHARS / 1500) + 10 }, (_, i) => line(i, 50));
    saveDraft(key, { strokes: many, styles: many.map(() => undefined) }, { width: 800, height: 600 });
    expect(st.map.get(key)!.length).toBeLessThan(200);
    expect(draftTooLarge(key)).toBe(true);
    expect(loadDraft(key)).toBeNull();
    // 小さくなれば（Undo など）また残せる
    saveDraft(key, { strokes: [line(10)], styles: [undefined] }, { width: 800, height: 600 });
    expect(draftTooLarge(key)).toBe(false);
    expect(loadDraft(key)).not.toBeNull();
  });

  it('setItem が失敗したら古い下書きも消す', () => {
    const st = memoryStorage(600);
    vi.stubGlobal('sessionStorage', st);
    const key = draftKey('L', 4);
    saveDraft(key, { strokes: [line(10, 2)], styles: [undefined] }, { width: 800, height: 600 });
    expect(st.map.has(key)).toBe(true);
    expect(() => saveDraft(key, { strokes: [line(10, 40)], styles: [undefined] }, { width: 800, height: 600 })).not.toThrow();
    expect(st.map.has(key)).toBe(false);
    expect(loadDraft(key)).toBeNull();
  });

  it('画面に触れている間は書かず、離れてから（アイドル時に）書く。待っている間の clearDraft で取り消す', async () => {
    const st = memoryStorage();
    vi.stubGlobal('sessionStorage', st);
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    const ric = vi.fn((cb: () => void) => {
      setTimeout(cb, 0);
      return 1;
    });
    vi.stubGlobal('requestIdleCallback', ric);
    const ev = (type: string, pointerId = 1) => Object.assign(new Event(type), { pointerId });
    const key = draftKey('L', 5);
    // 追跡を始める（最初の保存で登録される）
    saveDraft(key, EMPTY, { width: 1, height: 1 });
    target.dispatchEvent(ev('pointerdown'));
    expect(isPointerDown()).toBe(true);
    saveDraft(key, { strokes: [line(10)], styles: [undefined] }, { width: 800, height: 600 });
    expect(st.map.has(key)).toBe(false);
    target.dispatchEvent(ev('pointerup'));
    await new Promise((r) => setTimeout(r, 5));
    expect(ric).toHaveBeenCalled();
    expect(st.map.has(key)).toBe(true);

    // 触れている間の保存 → clearDraft → 離れても書かない
    clearDraft(key);
    target.dispatchEvent(ev('pointerdown', 2));
    saveDraft(key, { strokes: [line(10)], styles: [undefined] }, { width: 800, height: 600 });
    clearDraft(key);
    target.dispatchEvent(ev('pointerup', 2));
    await new Promise((r) => setTimeout(r, 5));
    expect(st.map.has(key)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ギャラリーの再生範囲
// ---------------------------------------------------------------------------

describe('ギャラリーの再生範囲（contentRect）', () => {
  it('保存時の範囲があればそれを使う（線の範囲と違っても）', () => {
    const rect = { x: 40, y: 30, width: 500, height: 200 };
    expect(docSourceRect({ width: 800, height: 600 }, rect, [line(100)], 2.5)).toEqual(rect);
  });
  it('旧データ: 紙全体を画像の縦横比の箱に収める（縦横で倍率が変わらない）', () => {
    const r = docSourceRect({ width: 800, height: 600 }, undefined, [], 2);
    expect(r.width / r.height).toBeCloseTo(2, 6);
    expect(r.width).toBeGreaterThanOrEqual(800);
    expect(r.height).toBeGreaterThanOrEqual(600 - 1e-6 - (600 - 400));
    const tall = docSourceRect({ width: 800, height: 600 }, undefined, [], 0.5);
    expect(tall.width / tall.height).toBeCloseTo(0.5, 6);
    expect(tall.height).toBeGreaterThanOrEqual(600);
  });
  it('readContentRect は壊れた値を読まない', () => {
    expect(readContentRect({ contentRect: { x: 1, y: 2, width: 3, height: 4 } })).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(readContentRect({ contentRect: { x: 1, y: 2, width: 0, height: 4 } })).toBeUndefined();
    expect(readContentRect({ contentRect: 'x' })).toBeUndefined();
    expect(readContentRect(undefined)).toBeUndefined();
  });
  it('範囲の計算: 不透明な画素 → 余白つき・紙の中に収める', () => {
    const w = 10;
    const h = 8;
    const data = new Uint8ClampedArray(w * h * 4);
    data[(3 * w + 2) * 4 + 3] = 255;
    data[(5 * w + 6) * 4 + 3] = 10;
    expect(alphaBounds(data, w, h)).toEqual({ x: 2, y: 3, width: 5, height: 3 });
    expect(alphaBounds(new Uint8ClampedArray(16), 2, 2)).toBeNull();
    const r = paddedContentRect({ x: 100, y: 100, width: 200, height: 100 }, { width: 800, height: 600 });
    // 余白 24px（長辺 200 × 8% = 16 < 24）
    expect(r).toEqual({ x: 76, y: 76, width: 248, height: 148 });
    const edge = paddedContentRect({ x: 0, y: 0, width: 800, height: 600 }, { width: 800, height: 600 });
    expect(edge).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });
});
