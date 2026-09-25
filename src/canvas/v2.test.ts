/**
 * キャンバス v2（契約 1b）のテスト: 塗りつぶし・選択マスク・変形行列・図形・レイヤー操作・ops の再生・文書の往復・後方互換。
 * 画素の結果は純関数（fill.ts）で見る。エンジンは偽 DOM（呼び出しの記録）で状態の整合を見る。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Stroke, StrokePoint } from '@/scoring/types';
import type { CanvasDocument, CanvasOp, Mat } from './types';
import { dilateMask, floodFillMask, maskBox as pixelBox, paintBehind, parseHex, toHex } from './fill';
import { cutStrokes, maskBox, pointInMask, sanitizeMask, splitByMask, transformMask } from './selection';
import { apply, clampZoom, fitViewFor, gestureView, invert, isIdentity, mul, normalizeDeg, rotate, scale, translate, twistDeg, viewMatrix } from './matrix';
import { ELLIPSE_POINTS, LINE_POINTS, SHAPE_PRESSURE, shapeStrokes } from './shapes';
import { applyLayerOp, newLayerInfo, sanitizeDocument, vectorModel, visibleInk, writesOf, type EngineOp } from './ops';
import { createCanvasEngine } from './engine';

const pt = (x: number, y: number, p = 0.5, t = 0): StrokePoint => ({ x, y, p, t });
const hline = (n: number, y = 0, x0 = 0, step = 10): Stroke => Array.from({ length: n }, (_, i) => pt(x0 + i * step, y, 0.5, i * 10));

/* ------------------------------------------------------------------ */
/* 塗りつぶし（純関数）                                                  */
/* ------------------------------------------------------------------ */

/** w×h の透明な画像に、縦線 x=cx（幅 1、黒・不透明）を引いたもの */
function imageWithLine(w: number, h: number, cx: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const p = (y * w + cx) * 4;
    d[p + 3] = 255;
  }
  return d;
}

describe('fill（純関数）', () => {
  it('線で仕切られた左側だけを塗る（4 近傍・スキャンライン）', () => {
    const w = 10;
    const h = 6;
    const d = imageWithLine(w, h, 4);
    const m = floodFillMask(d, w, h, 1, 1, 32)!;
    let n = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (m[y * w + x]) {
        n++;
        expect(x).toBeLessThan(4);
      }
    }
    expect(n).toBe(4 * h);
  });

  it('範囲外の種は null、空の画像は全部', () => {
    const d = new Uint8ClampedArray(5 * 5 * 4);
    expect(floodFillMask(d, 5, 5, -1, 0, 0)).toBeNull();
    expect(floodFillMask(d, 5, 5, 5, 0, 0)).toBeNull();
    const m = floodFillMask(d, 5, 5, 2, 2, 0)!;
    expect(m.every((v) => v === 1)).toBe(true);
  });

  it('tolerance は RGBA の最大差。完全透明どうしは色を見ない', () => {
    const w = 3;
    const d = new Uint8ClampedArray(w * 4);
    // [透明(0,0,0,0)] [透明だが RGB が違う(255,0,0,0)] [半透明 a=20]
    d.set([0, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 20]);
    expect([...floodFillMask(d, w, 1, 0, 0, 10)!]).toEqual([1, 1, 0]);
    expect([...floodFillMask(d, w, 1, 0, 0, 20)!]).toEqual([1, 1, 1]);
  });

  it('スパイラル状の迷路でも取りこぼさない（上下の行に戻って塗る）', () => {
    // 0 = 空き, 1 = 壁。U 字の通路
    const rows = ['.....', '###.#', '.....', '.####', '.....'];
    const w = 5;
    const h = rows.length;
    const d = new Uint8ClampedArray(w * h * 4);
    rows.forEach((r, y) => [...r].forEach((c, x) => (d[(y * w + x) * 4 + 3] = c === '#' ? 255 : 0)));
    const m = floodFillMask(d, w, h, 0, 0, 0)!;
    const filled = rows.map((r, y) => [...r].map((_, x) => (m[y * w + x] ? 'o' : '.')).join(''));
    expect(filled).toEqual(['ooooo', '...o.', 'ooooo', 'o....', 'ooooo']);
  });

  it('dilateMask: 1px 膨張で 8 近傍に広がる', () => {
    const w = 5;
    const m = new Uint8Array(25);
    m[12] = 1;
    const r = dilateMask(m, w, 5, 1);
    expect(pixelBox(r, w, 5)).toEqual({ x0: 1, y0: 1, x1: 3, y1: 3 });
    expect([...r].filter(Boolean)).toHaveLength(9);
    expect(dilateMask(m, w, 5, 0)).toBe(m);
  });

  it('paintBehind: 透明は色そのもの、不透明は残す、半透明は既存を上に重ねる', () => {
    const d = new Uint8ClampedArray([0, 0, 0, 0, 10, 20, 30, 255, 0, 0, 0, 128]);
    paintBehind(d, new Uint8Array([1, 1, 1]), [200, 100, 50]);
    expect([...d.slice(0, 4)]).toEqual([200, 100, 50, 255]);
    expect([...d.slice(4, 8)]).toEqual([10, 20, 30, 255]);
    expect(d[11]).toBe(255);
    expect(d[8]).toBeCloseTo(200 * (1 - 128 / 255), -1);
  });

  it('parseHex / toHex', () => {
    expect(parseHex('#c8553d')).toEqual([200, 85, 61]);
    expect(parseHex('#abc')).toEqual([170, 187, 204]);
    expect(parseHex('red')).toBeNull();
    expect(toHex(200, 85, 61)).toBe('#C8553D');
  });
});

/* ------------------------------------------------------------------ */
/* 選択マスク（純関数）                                                  */
/* ------------------------------------------------------------------ */

describe('selection（純関数）', () => {
  const tri = { kind: 'lasso' as const, points: [pt(0, 0), pt(100, 0), pt(0, 100)].map(({ x, y }) => ({ x, y })) };

  it('sanitizeMask: 負の幅をそろえ、面積 0・3 点未満・非数は null', () => {
    expect(sanitizeMask({ kind: 'rect', x: 10, y: 10, w: -5, h: 4 })).toEqual({ kind: 'rect', x: 5, y: 10, w: 5, h: 4 });
    expect(sanitizeMask({ kind: 'rect', x: 0, y: 0, w: 0, h: 4 })).toBeNull();
    expect(sanitizeMask({ kind: 'lasso', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })).toBeNull();
    expect(sanitizeMask({ kind: 'rect', x: Number.NaN, y: 0, w: 1, h: 1 })).toBeNull();
    expect(sanitizeMask(tri)).toEqual(tri);
  });

  it('pointInMask: 矩形と投げ縄（偶奇）', () => {
    const r = { kind: 'rect' as const, x: 10, y: 10, w: 20, h: 20 };
    expect(pointInMask(r, 15, 15)).toBe(true);
    expect(pointInMask(r, 5, 15)).toBe(false);
    expect(pointInMask(tri, 10, 10)).toBe(true);
    expect(pointInMask(tri, 80, 80)).toBe(false);
    expect(maskBox(tri)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });

  it('transformMask: 拡縮・移動は矩形のまま、回転は投げ縄', () => {
    const r = { kind: 'rect' as const, x: 0, y: 0, w: 10, h: 20 };
    expect(transformMask(r, mul(translate(5, 5), scale(2)))).toEqual({ kind: 'rect', x: 5, y: 5, w: 20, h: 40 });
    // 左右反転（-1 スケール）でも矩形
    expect(transformMask(r, [-1, 0, 0, 1, 10, 0])).toEqual({ kind: 'rect', x: 0, y: 0, w: 10, h: 20 });
    const rot = transformMask(r, rotate(90));
    expect(rot.kind).toBe('lasso');
  });

  it('splitByMask / cutStrokes: 範囲内を消す・動かす（外側はそのまま、境界で切る）', () => {
    const r = { kind: 'rect' as const, x: 40, y: -10, w: 30, h: 20 };
    const s = hline(11, 0); // x = 0..100
    const parts = splitByMask(s, r);
    expect(parts.map((p) => p.inside)).toEqual([false, true, false]);
    expect(parts[0]!.pts.at(-1)!.x).toBeCloseTo(40, 1);
    expect(parts[2]!.pts[0]!.x).toBeCloseTo(70, 1);
    const del = cutStrokes([s], [undefined], r, null);
    expect(del.strokes).toHaveLength(2);
    const moved = cutStrokes([s], [undefined], r, translate(0, 50));
    expect(moved.strokes).toHaveLength(3);
    expect(moved.strokes[1]!.every((q) => q.y === 50)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* 変形行列・ビュー（純関数）                                             */
/* ------------------------------------------------------------------ */

describe('matrix（純関数）', () => {
  it('mul は B を先に掛ける。invert で元に戻る', () => {
    const m = mul(translate(10, 0), scale(2)); // 2 倍してから右へ 10
    expect(apply(m, 1, 1)).toEqual({ x: 12, y: 2 });
    const back = apply(invert(m), 12, 2);
    expect(back.x).toBeCloseTo(1);
    expect(back.y).toBeCloseTo(1);
    expect(isIdentity(mul(m, invert(m)))).toBe(true);
    expect(isIdentity(invert([0, 0, 0, 0, 0, 0]))).toBe(true); // 特異 → 恒等
  });

  it('rotate(90) は x 軸を y 軸へ。normalizeDeg / clampZoom', () => {
    const p = apply(rotate(90), 1, 0);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(1);
    expect(normalizeDeg(270)).toBe(-90);
    expect(normalizeDeg(-180)).toBe(180);
    expect(clampZoom(100)).toBe(8);
    expect(clampZoom(0.01)).toBe(0.25);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it('viewMatrix: zoom → 回転 → pan', () => {
    const v = { zoom: 2, panX: 10, panY: 20, rotationDeg: 0 };
    expect(apply(viewMatrix(v), 5, 5)).toEqual({ x: 20, y: 30 });
  });

  it('gestureView: ピンチで 2 倍、指の下の点は動かない。ひねりは rotate=true のときだけ', () => {
    const base = { zoom: 1, panX: 0, panY: 0, rotationDeg: 0 };
    const c1 = { x: 100, y: 100 };
    const c2 = { x: 200, y: 100 };
    const v = gestureView(base, c1, c2, { x: 50, y: 100 }, { x: 250, y: 100 }, false);
    expect(v.zoom).toBeCloseTo(2);
    const m = viewMatrix(v);
    expect(apply(m, 100, 100).x).toBeCloseTo(50);
    expect(apply(m, 200, 100).x).toBeCloseTo(250);
    // 90° ひねる
    const s1 = { x: 150, y: 50 };
    const s2 = { x: 150, y: 150 };
    expect(twistDeg(c1, c2, s1, s2)).toBeCloseTo(90);
    expect(gestureView(base, c1, c2, s1, s2, false).rotationDeg).toBe(0);
    expect(gestureView(base, c1, c2, s1, s2, true).rotationDeg).toBeCloseTo(90);
    // ズームは 0.25..8 に丸める
    expect(gestureView(base, c1, c2, { x: 0, y: 0 }, { x: 5000, y: 0 }, false).zoom).toBe(8);
  });

  it('fitViewFor: 中央に収める', () => {
    const v = fitViewFor(1000, 500, 500, 500);
    expect(v.zoom).toBeCloseTo(0.48);
    expect(v.panX).toBeCloseTo((500 - 1000 * 0.48) / 2);
    expect(v.rotationDeg).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* 図形（純関数）                                                        */
/* ------------------------------------------------------------------ */

describe('shapes（純関数）', () => {
  it('直線は 32 点・筆圧 0.6、四角は角で 4 本、楕円は閉じた 1 本', () => {
    const [line] = shapeStrokes('line', { x: 0, y: 0 }, { x: 310, y: 0 });
    expect(line).toHaveLength(LINE_POINTS);
    expect(line![0]!.p).toBe(SHAPE_PRESSURE);
    expect(line!.at(-1)!.x).toBe(310);
    const rect = shapeStrokes('rect', { x: 50, y: 40 }, { x: 10, y: 0 });
    expect(rect).toHaveLength(4);
    expect(rect[0]![0]).toMatchObject({ x: 10, y: 0 });
    expect(rect[3]!.at(-1)).toMatchObject({ x: 10, y: 0 });
    const [ell] = shapeStrokes('ellipse', { x: 0, y: 0 }, { x: 100, y: 50 });
    expect(ell).toHaveLength(ELLIPSE_POINTS + 1);
    expect(ell![0]!.x).toBeCloseTo(ell!.at(-1)!.x);
    expect(ell![0]!.y).toBeCloseTo(0);
    expect(shapeStrokes('rect', { x: 1, y: 1 }, { x: 1.5, y: 1.2 })).toEqual([]);
    // 時刻は単調
    const ts = rect.flat().map((q) => q.t);
    expect(ts.every((t, i) => i === 0 || t >= ts[i - 1]!)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* ops（純関数）                                                         */
/* ------------------------------------------------------------------ */

describe('ops（純関数）', () => {
  const L1 = newLayerInfo('a', 'A');
  const L2 = newLayerInfo('b', 'B');

  it('applyLayerOp: add/move/set/duplicate/merge/remove。最後の 1 枚は消さない', () => {
    let list = applyLayerOp([L1], { kind: 'layer-add', layer: L2, index: 1 });
    expect(list.map((l) => l.id)).toEqual(['a', 'b']);
    list = applyLayerOp(list, { kind: 'layer-move', layer: 'b', index: 0 });
    expect(list.map((l) => l.id)).toEqual(['b', 'a']);
    list = applyLayerOp(list, { kind: 'layer-set', layer: 'a', patch: { opacity: 0.5, blend: 'multiply' } });
    expect(list[1]).toMatchObject({ id: 'a', opacity: 0.5, blend: 'multiply' });
    list = applyLayerOp(list, { kind: 'layer-duplicate', layer: 'b', newId: 'c' });
    expect(list.map((l) => l.id)).toEqual(['b', 'c', 'a']);
    expect(list[1]!.name).toBe('B のコピー');
    list = applyLayerOp(list, { kind: 'layer-merge-down', layer: 'c' });
    expect(list.map((l) => l.id)).toEqual(['b', 'a']);
    list = applyLayerOp(list, { kind: 'layer-remove', layer: 'b' });
    list = applyLayerOp(list, { kind: 'layer-remove', layer: 'a' });
    expect(list.map((l) => l.id)).toEqual(['a']);
    // 関係ない op は同じ配列
    expect(applyLayerOp(list, { kind: 'layer-clear', layer: 'a' })).toBe(list);
  });

  it('writesOf: 書き換えるレイヤー（結合は下のレイヤー、複製は新しいレイヤー）', () => {
    const list = [L1, L2];
    expect(writesOf({ kind: 'layer-merge-down', layer: 'b' }, list)).toEqual(['a']);
    expect(writesOf({ kind: 'layer-merge-down', layer: 'a' }, list)).toEqual([]);
    expect(writesOf({ kind: 'layer-duplicate', layer: 'a', newId: 'z' }, list)).toEqual(['z']);
    expect(writesOf({ kind: 'layer-set', layer: 'a', patch: { visible: false } }, list)).toEqual([]);
    expect(writesOf({ kind: 'fill', layer: 'x', x: 0, y: 0, color: '#000000', tolerance: 0, reference: 'layer' }, list)).toEqual([]);
  });

  it('vectorModel: レイヤーごとの点列。結合で下へ移り、非表示レイヤーは visibleInk に出ない', () => {
    const ops: EngineOp[] = [
      { kind: 'stroke', layer: 'a', points: hline(3, 0), style: undefined },
      { kind: 'layer-add', layer: L2, index: 1 },
      { kind: 'stroke', layer: 'b', points: hline(3, 50), style: undefined },
    ];
    const m = vectorModel([L1], ops);
    expect(visibleInk(m).strokes).toHaveLength(2);
    const hidden = vectorModel([L1], [...ops, { kind: 'layer-set', layer: 'b', patch: { visible: false } }]);
    expect(visibleInk(hidden).strokes).toHaveLength(1);
    const merged = vectorModel([L1], [...ops, { kind: 'layer-merge-down', layer: 'b' }]);
    expect(merged.list.map((l) => l.id)).toEqual(['a']);
    expect(merged.raw.get('a')!.strokes).toHaveLength(2);
    const cleared = vectorModel([L1], [...ops, { kind: 'layer-clear', layer: 'a' }]);
    expect(visibleInk(cleared).strokes.map((s) => s[0]!.y)).toEqual([50]);
  });

  it('sanitizeDocument: 壊れた op は捨て、レイヤーが無ければ null', () => {
    expect(sanitizeDocument({ v: 2, layers: [], ops: [] })).toBeNull();
    const d = sanitizeDocument({
      v: 2,
      width: 400,
      height: 300,
      layers: [L1, L1, { id: 5 }],
      active: 'a',
      ops: [
        { kind: 'stroke', layer: 'a', points: [{ x: 1, y: 2, p: 0.5, t: 0 }, { x: 'bad' }], style: { preset: 'pen', size: 99, opacity: 1 } },
        { kind: 'fill', layer: 'a', x: 1, y: 1, color: 'red', tolerance: 3, reference: 'all' },
        { kind: 'fill', layer: 'a', x: 1, y: 1, color: '#ff0000', tolerance: 999, reference: 'x' },
        { kind: 'transform', layer: 'a', mask: { kind: 'rect', x: 0, y: 0, w: 1, h: 1 }, matrix: [1, 0, 0, 1, 0] },
        { kind: 'nope' },
      ],
    })!;
    expect(d.layers).toHaveLength(1);
    expect(d.ops).toHaveLength(2);
    expect(d.ops[0]).toMatchObject({ kind: 'stroke', points: [{ x: 1, y: 2 }], style: { size: 16 } });
    expect(d.ops[1]).toMatchObject({ kind: 'fill', color: '#FF0000', tolerance: 255, reference: 'layer' });
  });
});

/* ------------------------------------------------------------------ */
/* エンジン（偽 DOM）                                                   */
/* ------------------------------------------------------------------ */

interface Call {
  name: string;
  args: unknown[];
  state: Record<string, unknown>;
}
interface FakeCanvas {
  width: number;
  height: number;
  style: Record<string, string>;
  calls: Call[];
  listeners: Map<string, (e: unknown) => void>;
  getContext(): unknown;
  addEventListener(n: string, f: (e: unknown) => void): void;
  removeEventListener(): void;
  remove(): void;
  setPointerCapture(): void;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  toBlob(cb: (b: Blob | null) => void, type?: string): void;
}
let canvases: FakeCanvas[] = [];
let rafQueue = new Map<number, FrameRequestCallback>();
let rafSeq = 0;

function makeCanvas(): FakeCanvas {
  const calls: Call[] = [];
  const props: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(props, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        calls.push({ name: String(prop), args, state: { ...target } });
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
  const listeners = new Map<string, (e: unknown) => void>();
  const c: FakeCanvas = {
    width: 0,
    height: 0,
    style: {},
    calls,
    listeners,
    getContext: () => ctx,
    addEventListener(n, f) {
      listeners.set(n, f);
    },
    removeEventListener() {},
    remove() {},
    setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }),
    toBlob(cb, type) {
      cb(new Blob(['x'], { type: type ?? 'image/png' }));
    },
  };
  canvases.push(c);
  return c;
}
const host = () => ({ clientWidth: 400, clientHeight: 300, style: {}, appendChild() {} }) as unknown as HTMLElement;
function flush(): void {
  for (let i = 0; i < 10 && rafQueue.size > 0; i++) {
    const q = [...rafQueue.values()];
    rafQueue.clear();
    for (const cb of q) cb(0);
  }
}
let ts = 0;
function pe(x: number, y: number, pointerId = 1, pointerType = 'pen') {
  ts += 10;
  return { pointerId, pointerType, button: 0, clientX: x, clientY: y, pressure: 0.5, timeStamp: ts, preventDefault() {} };
}
function drag(c: FakeCanvas, pts: [number, number][]): void {
  const [first, ...rest] = pts;
  c.listeners.get('pointerdown')!(pe(first![0], first![1]));
  for (const [x, y] of rest) c.listeners.get('pointermove')!(pe(x, y));
  const last = pts.at(-1)!;
  c.listeners.get('pointerup')!(pe(last[0], last[1]));
  flush();
}

beforeEach(() => {
  canvases = [];
  rafQueue = new Map();
  rafSeq = 0;
  ts = 0;
  vi.stubGlobal('document', { createElement: () => makeCanvas() });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = ++rafSeq;
    rafQueue.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    rafQueue.delete(id);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('エンジン v2: レイヤー操作', () => {
  it('既定は 1 枚。add はアクティブの上に作ってアクティブにする。Undo/Redo は op 単位', () => {
    const e = createCanvasEngine();
    expect(e.getLayers()).toHaveLength(1);
    const first = e.getActiveLayer();
    let layersEv = 0;
    e.on('layerschange', () => layersEv++);
    const b = e.addLayer();
    expect(e.getLayers().map((l) => l.id)).toEqual([first, b.id]);
    expect(e.getActiveLayer()).toBe(b.id);
    expect(b.name).toBe('レイヤー 2');
    const c = e.addLayer({ name: '線画', index: 0 });
    expect(e.getLayers().map((l) => l.name)).toEqual(['線画', 'レイヤー 1', 'レイヤー 2']);
    expect(layersEv).toBe(2);
    e.undo();
    expect(e.getLayers().map((l) => l.id)).toEqual([first, b.id]);
    // 消えたレイヤーがアクティブだったら一番上へ
    expect(e.getActiveLayer()).toBe(b.id);
    e.redo();
    expect(e.getLayers().some((l) => l.id === c.id)).toBe(true);
  });

  it('setLayer / moveLayer / removeLayer / duplicateLayer / mergeDown', () => {
    const e = createCanvasEngine();
    const a = e.getActiveLayer();
    e.loadStrokes([hline(3, 10)]);
    const b = e.addLayer();
    e.setLayer(b.id, { opacity: 0.4, blend: 'multiply', name: '影' });
    expect(e.getLayers()[1]).toMatchObject({ opacity: 0.4, blend: 'multiply', name: '影' });
    e.moveLayer(b.id, 0);
    expect(e.getLayers().map((l) => l.id)).toEqual([b.id, a]);
    e.undo();
    expect(e.getLayers().map((l) => l.id)).toEqual([a, b.id]);
    const d = e.duplicateLayer(a);
    expect(e.getLayers().map((l) => l.id)).toEqual([a, d.id, b.id]);
    expect(e.getStrokes()).toHaveLength(2); // 複製したので同じ線が 2 本
    e.mergeDown(d.id);
    expect(e.getLayers().map((l) => l.id)).toEqual([a, b.id]);
    expect(e.getStrokes()).toHaveLength(2);
    e.removeLayer(b.id);
    e.removeLayer(a); // 最後の 1 枚は消せない
    expect(e.getLayers().map((l) => l.id)).toEqual([a]);
    e.undo();
    e.undo();
    expect(e.getLayers().map((l) => l.id)).toEqual([a, d.id, b.id]);
  });

  it('不透明度のスライダーを続けて動かしても Undo は 1 手', () => {
    const e = createCanvasEngine();
    const b = e.addLayer();
    e.setLayer(b.id, { opacity: 0.9 });
    e.setLayer(b.id, { opacity: 0.7 });
    e.setLayer(b.id, { opacity: 0.5 });
    expect(e.getLayers()[1]!.opacity).toBe(0.5);
    e.undo();
    expect(e.getLayers()[1]!.opacity).toBe(1);
    e.undo();
    expect(e.getLayers()).toHaveLength(1);
  });

  it('ロック中のレイヤーには描けない・消せない', () => {
    const e = createCanvasEngine();
    e.attach(host());
    const main = canvases[0]!;
    const id = e.getActiveLayer();
    e.setLayer(id, { locked: true });
    drag(main, [[10, 10], [50, 50], [90, 90]]);
    expect(e.getStrokes()).toHaveLength(0);
    e.clearLayer(id);
    expect(e.canUndo()).toBe(true); // lock の 1 手だけ
    e.undo();
    expect(e.canUndo()).toBe(false);
    drag(main, [[10, 10], [50, 50], [90, 90]]);
    expect(e.getStrokes()).toHaveLength(1);
  });

  it('描いた線はアクティブレイヤーに入る。getStrokes は全レイヤー（下から）、getHistory はアクティブだけ', () => {
    const e = createCanvasEngine();
    e.attach(host());
    const main = canvases[0]!;
    const a = e.getActiveLayer();
    drag(main, [[10, 100], [60, 100], [110, 100]]);
    const b = e.addLayer({ index: 0 }); // 下に作る
    drag(main, [[10, 200], [60, 200], [110, 200]]);
    expect(e.getStrokes().map((s) => s[0]!.y)).toEqual([200, 100]);
    expect(e.getHistory().strokes).toHaveLength(1);
    expect(e.getHistory().strokes[0]![0]!.y).toBe(200);
    e.setActiveLayer(a);
    expect(e.getHistory().strokes[0]![0]!.y).toBe(100);
    e.setLayer(b.id, { visible: false });
    expect(e.getStrokes().map((s) => s[0]!.y)).toEqual([100]);
    // 各レイヤーに表示用の画像がある（2 枚目は後から作る）
    const ops = e.getDocument().ops;
    expect(ops.filter((o) => o.kind === 'stroke').map((o) => (o as Extract<CanvasOp, { kind: 'stroke' }>).layer)).toEqual([a, b.id]);
  });
});

describe('エンジン v2: ツール', () => {
  it('図形: ドラッグで四角 4 本の stroke op（1 手）、strokeend も 4 回。筆圧 0.6', () => {
    const e = createCanvasEngine();
    e.attach(host());
    const main = canvases[0]!;
    const ends: Stroke[] = [];
    e.on('strokeend', (s) => ends.push(s));
    e.setTool('shape-rect');
    drag(main, [[100, 100], [150, 130], [200, 180]]);
    expect(ends).toHaveLength(4);
    expect(e.getStrokes()).toHaveLength(4);
    expect(e.getStrokes()[0]![0]).toMatchObject({ x: 100, y: 100, p: 0.6 });
    e.undo();
    expect(e.getStrokes()).toHaveLength(0);
    e.setTool('shape-line');
    drag(main, [[0, 0], [300, 0]]);
    expect(e.getStrokes()[0]).toHaveLength(32);
    e.setTool('shape-ellipse');
    drag(main, [[0, 0], [100, 100]]);
    expect(e.getStrokes()[1]).toHaveLength(65);
  });

  it('塗りつぶし: タップで fill op（色はペンの色、許容値と参照は setFill）', () => {
    const e = createCanvasEngine();
    e.attach(host());
    const main = canvases[0]!;
    e.setPen({ color: '#3e7ec8' });
    e.setFill({ tolerance: 300, reference: 'all' });
    expect(e.getFill()).toEqual({ tolerance: 255, reference: 'all' });
    e.setTool('fill');
    drag(main, [[20, 30]]);
    const op = e.getDocument().ops.at(-1)!;
    expect(op).toEqual({ kind: 'fill', layer: e.getActiveLayer(), x: 20, y: 30, color: '#3E7EC8', tolerance: 255, reference: 'all' });
    expect(e.canUndo()).toBe(true);
    // 紙の外は塗らない
    drag(main, [[500, 30]]);
    expect(e.getDocument().ops).toHaveLength(1);
    // 塗った後は取り消し用のスナップショット（直前・直後）を持つ → Undo で作り直すのではなく復元
    const layerCv = canvases[1]!;
    layerCv.calls.length = 0;
    e.undo();
    expect(layerCv.calls.some((c) => c.name === 'drawImage')).toBe(true);
  });

  it('スポイト: 透明なら墨に戻す（toolchange）', () => {
    const e = createCanvasEngine();
    e.attach(host());
    const main = canvases[0]!;
    e.setPen({ color: '#ff0000' });
    let n = 0;
    e.on('toolchange', () => n++);
    e.setTool('eyedropper');
    drag(main, [[20, 30]]);
    expect(e.getPen().color).toBeUndefined();
    expect(n).toBe(1);
    expect(e.pickColor(20, 30)).toBeNull();
  });

  it('選択: 矩形をドラッグで作り、中をドラッグすると移動プレビュー、commit で transform op。選択も動く', () => {
    const e = createCanvasEngine();
    e.attach(host());
    const main = canvases[0]!;
    drag(main, [[10, 100], [60, 100], [110, 100]]);
    let sel = 0;
    e.on('selectionchange', () => sel++);
    e.setTool('select-rect');
    drag(main, [[0, 80], [60, 100], [120, 120]]);
    expect(e.getSelection()).toEqual({ kind: 'rect', x: 0, y: 80, w: 120, h: 40 });
    drag(main, [[50, 100], [60, 120], [70, 150]]);
    expect(e.isTransforming()).toBe(true);
    expect(e.getSelection()).toEqual({ kind: 'rect', x: 20, y: 130, w: 120, h: 40 });
    const before = e.getDocument().ops.length;
    e.commitTransform();
    expect(e.isTransforming()).toBe(false);
    const op = e.getDocument().ops.at(-1)!;
    expect(op.kind).toBe('transform');
    expect((op as Extract<CanvasOp, { kind: 'transform' }>).matrix).toEqual([1, 0, 0, 1, 20, 50]);
    expect(e.getDocument().ops).toHaveLength(before + 1);
    // 点列も動く（採点・保存用）
    expect(e.getStrokes()[0]![0]).toMatchObject({ x: 30, y: 150 });
    expect(sel).toBeGreaterThan(2);
    // タップで選択解除
    drag(main, [[300, 250]]);
    expect(e.getSelection()).toBeNull();
    e.undo();
    expect(e.getStrokes()[0]![0]).toMatchObject({ x: 10, y: 100 });
  });

  it('選択: transformSelection は上書き、cancel で戻す、反転は -1 スケール、deleteSelection', () => {
    const e = createCanvasEngine();
    e.attach(host());
    e.loadStrokes([hline(11, 50)]);
    e.setSelection({ kind: 'rect', x: -10, y: 40, w: 60, h: 20 });
    e.transformSelection([1, 0, 0, 1, 100, 0]);
    e.transformSelection([-1, 0, 0, 1, 40, 0]); // x=20 を軸に左右反転
    e.cancelTransform();
    expect(e.getDocument().ops).toHaveLength(1);
    e.transformSelection([-1, 0, 0, 1, 40, 0]);
    e.commitTransform();
    const xs = e.getStrokes().flatMap((s) => s.map((q) => q.x));
    expect(Math.min(...xs)).toBeCloseTo(-10, 0);
    e.deleteSelection();
    expect(e.getDocument().ops.at(-1)!.kind).toBe('delete');
    expect(e.getStrokes().flatMap((s) => s.map((q) => q.x)).every((x) => x >= 49.9)).toBe(true);
    e.selectAll();
    expect(e.getSelection()).toEqual({ kind: 'rect', x: 0, y: 0, w: 400, h: 300 });
  });

  it('投げ縄: 3 点以上で lasso', () => {
    const e = createCanvasEngine();
    e.attach(host());
    const main = canvases[0]!;
    e.setTool('select-lasso');
    drag(main, [[10, 10], [100, 10], [100, 100], [10, 100]]);
    const s = e.getSelection()!;
    expect(s.kind).toBe('lasso');
    expect(s.kind === 'lasso' && s.points.length).toBe(4);
  });
});

describe('エンジン v2: ビュー', () => {
  it('setView は丸めて viewchange。入力はビューの逆変換でキャンバス座標に', () => {
    const e = createCanvasEngine();
    e.attach(host());
    const main = canvases[0]!;
    let n = 0;
    e.on('viewchange', () => n++);
    e.setView({ zoom: 2, panX: 10, panY: 20 });
    e.setView({ zoom: 2 }); // 同じ → 通知なし
    expect(n).toBe(1);
    expect(e.toCanvasPoint(110, 220)).toEqual({ x: 50, y: 100 });
    expect(e.toClientPoint(50, 100)).toEqual({ x: 110, y: 220 });
    drag(main, [[110, 220], [130, 220], [150, 220]]);
    expect(e.getStrokes()[0]!.map((q) => q.x)).toEqual([50, 60, 70]);
    e.setView({ zoom: 100, rotationDeg: 450 });
    expect(e.getView()).toMatchObject({ zoom: 8, rotationDeg: 90 });
    e.resetView();
    expect(e.getView()).toEqual({ zoom: 1, panX: 0, panY: 0, rotationDeg: 0 });
    e.fitView();
    expect(e.getView().zoom).toBeCloseTo(0.96);
  });

  it('反転とビューを合わせても toCanvasPoint ↔ toClientPoint は往復する', () => {
    const e = createCanvasEngine({ flipped: true });
    e.attach(host());
    e.setView({ zoom: 1.5, panX: -30, panY: 12, rotationDeg: 30 });
    const p = e.toCanvasPoint(123, 45);
    const q = e.toClientPoint(p.x, p.y);
    expect(q.x).toBeCloseTo(123);
    expect(q.y).toBeCloseTo(45);
  });

  it('hand ツールはタッチ 1 本でもパン', () => {
    const e = createCanvasEngine({ penOnly: true });
    e.attach(host());
    const main = canvases[0]!;
    e.setTool('hand');
    main.listeners.get('pointerdown')!(pe(100, 100, 5, 'touch'));
    main.listeners.get('pointermove')!(pe(130, 90, 5, 'touch'));
    main.listeners.get('pointerup')!(pe(130, 90, 5, 'touch'));
    expect(e.getView()).toMatchObject({ panX: 30, panY: -10, zoom: 1 });
  });

  it('2 本指: ピンチでズーム。penOnly=false で 1 本指描画中に 2 本目が来たら線を取り消す', () => {
    const e = createCanvasEngine({ penOnly: false });
    e.attach(host());
    const main = canvases[0]!;
    const down = (x: number, y: number, id: number) => main.listeners.get('pointerdown')!(pe(x, y, id, 'touch'));
    const move = (x: number, y: number, id: number) => main.listeners.get('pointermove')!(pe(x, y, id, 'touch'));
    const up = (x: number, y: number, id: number) => main.listeners.get('pointerup')!(pe(x, y, id, 'touch'));
    down(100, 100, 1);
    move(110, 100, 1);
    down(200, 100, 2);
    move(250, 100, 2);
    move(50, 100, 1);
    up(50, 100, 1);
    up(250, 100, 2);
    flush();
    expect(e.getStrokes()).toHaveLength(0);
    expect(e.canUndo()).toBe(false);
    // 2 本目が触れた時点の指の間隔 90px → 200px
    expect(e.getView().zoom).toBeCloseTo(200 / 90);
    expect(e.getView().rotationDeg).toBe(0);
  });

  it('ペンで描いている間の 2 本のタッチ（手のひら）ではビューを動かさず、線も取り消さない', () => {
    const e = createCanvasEngine({ penOnly: true });
    e.attach(host());
    const main = canvases[0]!;
    const L = (n: string) => main.listeners.get(n)!;
    L('pointerdown')(pe(10, 10, 1, 'pen'));
    L('pointerdown')(pe(100, 100, 7, 'touch'));
    L('pointerdown')(pe(200, 100, 8, 'touch'));
    L('pointermove')(pe(300, 100, 8, 'touch'));
    L('pointermove')(pe(50, 50, 1, 'pen'));
    L('pointerup')(pe(50, 50, 1, 'pen'));
    flush();
    expect(e.getStrokes()).toHaveLength(1);
    expect(e.getView().zoom).toBe(1);
  });

  it('2 本指のひねり: 3° 未満は回転しない、超えたら回転', () => {
    const e = createCanvasEngine({ penOnly: true });
    e.attach(host());
    const main = canvases[0]!;
    const down = (x: number, y: number, id: number) => main.listeners.get('pointerdown')!(pe(x, y, id, 'touch'));
    const move = (x: number, y: number, id: number) => main.listeners.get('pointermove')!(pe(x, y, id, 'touch'));
    down(100, 100, 1);
    down(200, 100, 2);
    move(200, 103, 2); // 約 1.7°
    expect(e.getView().rotationDeg).toBe(0);
    move(200, 200, 2); // 45°
    expect(e.getView().rotationDeg).toBeCloseTo(45);
  });
});

describe('エンジン v2: 文書の往復・再生・後方互換', () => {
  function build() {
    const e = createCanvasEngine();
    e.attach(host());
    const main = canvases[0]!;
    drag(main, [[10, 100], [60, 100], [110, 100]]);
    const b = e.addLayer();
    e.setPen({ color: '#c8553d', preset: 'brush' });
    drag(main, [[10, 200], [60, 210], [110, 220]]);
    e.setLayer(b.id, { opacity: 0.6, blend: 'multiply' });
    e.setTool('fill');
    drag(main, [[300, 250]]);
    e.setSelection({ kind: 'rect', x: 0, y: 190, w: 120, h: 40 });
    e.transformSelection([1, 0, 0, 1, 0, -20]);
    e.commitTransform();
    return e;
  }

  it('getDocument → loadDocument で同じレイヤー・同じ点列・同じ ops（履歴はリセット）', () => {
    const e = build();
    const doc = e.getDocument();
    expect(doc.v).toBe(2);
    expect(doc.layers).toHaveLength(1); // ops を適用する前のレイヤー
    expect([doc.width, doc.height]).toEqual([400, 300]);
    const json = JSON.parse(JSON.stringify(doc)) as CanvasDocument;
    const e2 = createCanvasEngine();
    e2.loadDocument(json);
    expect(e2.getLayers()).toEqual(e.getLayers());
    expect(e2.getActiveLayer()).toBe(e.getActiveLayer());
    expect(e2.getStrokes()).toEqual(e.getStrokes());
    expect(e2.getStyles()).toEqual(e.getStyles());
    expect(e2.getDocument()).toEqual(doc);
    expect(e2.canUndo()).toBe(false);
    // attach 後に読んでも同じ
    const e3 = createCanvasEngine();
    e3.attach(host());
    e3.loadDocument(json);
    expect(e3.getDocument().ops).toEqual(doc.ops);
    expect(() => e3.loadDocument({ ...json, layers: [] })).toThrow();
  });

  it('Undo をすべてやると最初に戻り、Redo で同じ文書', () => {
    const e = build();
    const doc = e.getDocument();
    let n = 0;
    while (e.canUndo()) {
      e.undo();
      n++;
    }
    expect(n).toBe(6);
    expect(e.getLayers()).toHaveLength(1);
    expect(e.getStrokes()).toHaveLength(0);
    while (e.canRedo()) e.redo();
    expect(e.getDocument()).toEqual(doc);
  });

  it('再生は ops を順に適用し、終われば今の状態を描き直す（非 stroke の op も途中で適用）', async () => {
    const e = build();
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    let done = false;
    const p = e.replay({ speed: 1 }).then(() => (done = true));
    clock = 1e7;
    flush();
    await p;
    expect(done).toBe(true);
    expect(e.getLayers()).toHaveLength(2);
    expect(rafQueue.size).toBe(0);
  });

  it('書き出し: toPng は各レイヤーを描いてから合成（multiply・不透明度）。transparent なら紙を敷かない', async () => {
    const e = build();
    const before = canvases.length;
    const blob = await e.toPng(512, { transparent: true });
    expect(blob.type).toBe('image/png');
    const made = canvases.slice(before);
    const out = made.at(-1)!;
    expect(out.calls.some((c) => c.name === 'fillRect')).toBe(false);
    const comp = made.at(-2)!;
    const mult = comp.calls.find((c) => c.name === 'drawImage' && c.state.globalCompositeOperation === 'multiply');
    expect(mult?.state.globalAlpha).toBe(0.6);
    const b2 = canvases.length;
    await e.toPng(512);
    expect(canvases.slice(b2).at(-1)!.calls[0]!.name).toBe('fillRect');
    await expect(e.getLayerThumbnail(e.getActiveLayer(), 64)).resolves.toBeInstanceOf(Blob);
  });

  it('後方互換: 1 レイヤー・stroke だけなら getDocument の ops は getHistory と同じ並び', () => {
    const e = createCanvasEngine();
    const h = { strokes: [hline(3, 10), hline(4, 20)], styles: [undefined, { preset: 'eraser' as const, size: 5, opacity: 1 }] };
    e.loadHistory(h);
    expect(e.getHistory()).toEqual(h);
    const doc = e.getDocument();
    expect(doc.ops.map((o) => o.kind)).toEqual(['stroke', 'stroke']);
    // style の無い旧データは baseWidth のペンとして書き出す
    expect((doc.ops[0] as Extract<CanvasOp, { kind: 'stroke' }>).style).toEqual({ preset: 'pen', size: 3, opacity: 1 });
    const e2 = createCanvasEngine();
    e2.loadDocument(doc);
    expect(e2.getStrokes()).toEqual(e.getStrokes());
  });

  it('clear() は内容のあるレイヤーをすべて空にする（1 手）', () => {
    const e = createCanvasEngine();
    e.loadStrokes([hline(3, 10)]);
    const b = e.addLayer();
    e.clear(); // b は空なので a だけ
    expect(e.getDocument().ops.filter((o) => o.kind === 'layer-clear')).toHaveLength(1);
    expect(e.getStrokes()).toHaveLength(0);
    e.undo();
    expect(e.getStrokes()).toHaveLength(1);
    expect(e.getLayers().map((l) => l.id)).toContain(b.id);
  });

  it('opsend / change は 1 手ごとに 1 回', () => {
    const e = createCanvasEngine();
    let ops = 0;
    let ch = 0;
    e.on('opsend', () => ops++);
    e.on('change', () => ch++);
    e.addLayer();
    e.undo();
    e.redo();
    expect([ops, ch]).toEqual([3, 3]);
  });

  it('Mat は CSS matrix と同じ並び（型の確認）', () => {
    const m: Mat = [1, 0, 0, 1, 5, 6];
    expect(apply(m, 0, 0)).toEqual({ x: 5, y: 6 });
  });
});
