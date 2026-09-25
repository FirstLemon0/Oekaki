/**
 * 2026-09-25 レビュー対応（契約 1b への追加）のテスト。
 * 純関数（fill.ts / ops.ts / crop.ts）は値で、エンジンは偽 DOM（呼び出しの記録。getImageData は透明な画素を返す）で見る。
 * 画素の実際の見た目（切り詰め書き出し・塗りの DPR 非依存・結合の見た目・拡大表示のシャープさ）は Playwright で計測した（README）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Stroke, StrokePoint } from '@/scoring/types';
import type { CanvasDocument, CanvasOp, LayerInfo } from './types';
import { bakeOnPaper, cssRgb, dilateMask, encodeMask, maskBox, stampMask } from './fill';
import { applyLayerOp, newLayerInfo, sanitizeOp } from './ops';
import { exportScale } from './crop';
import { createCanvasEngine } from './engine';

const pt = (x: number, y: number, p = 0.5, t = 0): StrokePoint => ({ x, y, p, t });
const hline = (n: number, y = 0, x0 = 0, step = 10): Stroke => Array.from({ length: n }, (_, i) => pt(x0 + i * step, y, 0.5, i * 10));

/* ------------------------------------------------------------------ */
/* 純関数                                                               */
/* ------------------------------------------------------------------ */

/** 素朴な膨張（全画素を走査）。dilateMask と同じ結果になること */
function naiveDilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  let cur = mask;
  for (let k = 0; k < r; k++) {
    const next = new Uint8Array(cur);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (cur[y * w + x]) continue;
        let hit = false;
        for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++)
          for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) if (cur[yy * w + xx]) hit = true;
        if (hit) next[y * w + x] = 1;
      }
    cur = next;
  }
  return cur;
}

describe('fill（レビュー対応の純関数）', () => {
  it('dilateMask は外接矩形 ± r だけ走査しても、全体を走査したときと同じ（端でも）', () => {
    const w = 40;
    const h = 30;
    for (const seedPts of [
      [[10, 10], [11, 10], [12, 12]],
      [[0, 0]],
      [[39, 29], [38, 29]],
    ]) {
      const m = new Uint8Array(w * h);
      for (const [x, y] of seedPts) m[y! * w + x!] = 1;
      for (const r of [1, 2, 3]) expect(Array.from(dilateMask(m, w, h, r))).toEqual(Array.from(naiveDilate(m, w, h, r)));
    }
    // 空のマスク・r=0 はそのまま
    expect(Array.from(dilateMask(new Uint8Array(4), 2, 2, 1))).toEqual([0, 0, 0, 0]);
  });

  it('encodeMask → stampMask: 区間表現から外接矩形 + 縁 1px の画像に戻せる', () => {
    const w = 8;
    const h = 5;
    const m = new Uint8Array(w * h);
    for (const [x, y] of [[2, 1], [3, 1], [4, 1], [3, 2], [6, 3]]) m[y! * w + x!] = 1;
    const e = encodeMask(m, w, h)!;
    expect(e.box).toEqual(maskBox(m, w, h));
    expect(e.count).toBe(5);
    const bw = e.box.x1 - e.box.x0 + 1 + 2;
    const bh = e.box.y1 - e.box.y0 + 1 + 2;
    const out = new Uint8ClampedArray(bw * bh * 4).fill(7);
    stampMask(e, [10, 20, 30], out, bw);
    const on: [number, number][] = [];
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (out[(y * bw + x) * 4 + 3] === 255) on.push([x + e.box.x0 - 1, y + e.box.y0 - 1]);
    expect(on.sort()).toEqual([[2, 1], [3, 1], [3, 2], [4, 1], [6, 3]].sort());
    // 縁は透明（前の中身は残らない）
    expect(out[3]).toBe(0);
    expect(Array.from(out.slice(((1 * bw + 1) * 4), (1 * bw + 1) * 4 + 3))).toEqual([10, 20, 30]);
    expect(encodeMask(new Uint8Array(4), 2, 2)).toBeNull();
  });

  it('bakeOnPaper: 紙の上に置けば元の見た目（乗算・スクリーン・不透明度）と同じになる', () => {
    const paper: [number, number, number] = [243, 240, 234];
    const over = (px: Uint8ClampedArray) => {
      const a = px[3]! / 255;
      return [0, 1, 2].map((i) => px[i]! * a + paper[i]! * (1 - a));
    };
    const cases: { layers: { rgba: number[]; opacity: number; blend: 'normal' | 'multiply' | 'screen' }[]; expect: number[] }[] = [
      // 乗算の青だけ: 紙 × 青
      { layers: [{ rgba: [51, 102, 204, 255], opacity: 1, blend: 'multiply' }], expect: [51 * 243 / 255, 102 * 240 / 255, 204 * 234 / 255] },
      // 通常 50%
      { layers: [{ rgba: [0, 0, 0, 255], opacity: 0.5, blend: 'normal' }], expect: [121.5, 120, 117] },
      // 下: 通常の青、上: 乗算の赤
      {
        layers: [
          { rgba: [51, 102, 204, 255], opacity: 1, blend: 'normal' },
          { rgba: [255, 51, 0, 255], opacity: 1, blend: 'multiply' },
        ],
        expect: [51, 102 * 51 / 255, 0],
      },
      // スクリーンの黒は変えない
      { layers: [{ rgba: [0, 0, 0, 255], opacity: 1, blend: 'screen' }], expect: paper },
    ];
    for (const c of cases) {
      const out = new Uint8ClampedArray(4);
      bakeOnPaper(out, c.layers.map((l) => ({ data: new Uint8ClampedArray(l.rgba), opacity: l.opacity, blend: l.blend })), paper);
      const got = over(out);
      got.forEach((v, i) => expect(Math.abs(v - c.expect[i]!)).toBeLessThanOrEqual(2));
    }
    // 何も無い所は透明のまま
    const out = new Uint8ClampedArray(4);
    bakeOnPaper(out, [{ data: new Uint8ClampedArray([9, 9, 9, 0]), opacity: 1, blend: 'multiply' }], paper);
    expect(Array.from(out)).toEqual([0, 0, 0, 0]);
  });

  it('cssRgb: #hex と rgb()', () => {
    expect(cssRgb('#f3f0ea')).toEqual([243, 240, 234]);
    expect(cssRgb('rgb(1, 2, 3)')).toEqual([1, 2, 3]);
    expect(cssRgb('rgba(10 20 30 / 0.5)')).toEqual([10, 20, 30]);
    expect(cssRgb('papayawhip')).toBeNull();
  });
});

describe('ops（レビュー対応）', () => {
  it('結合: 下のレイヤーの不透明度・合成は焼き込むので、結合後は 1・通常（名前・表示・ロックは残る）', () => {
    const a: LayerInfo = { ...newLayerInfo('a', 'A'), opacity: 0.5, blend: 'multiply', visible: false };
    const b = newLayerInfo('b', 'B');
    const after = applyLayerOp([a, b], { kind: 'layer-merge-down', layer: 'b' });
    expect(after).toEqual([{ ...a, opacity: 1, blend: 'normal' }]);
  });

  it("塗りの色は 'ink'（墨の記号）も受け付ける", () => {
    expect(sanitizeOp({ kind: 'fill', layer: 'a', x: 1, y: 2, color: 'ink', tolerance: 3, reference: 'all' })).toMatchObject({ color: 'ink' });
    expect(sanitizeOp({ kind: 'fill', layer: 'a', x: 1, y: 2, color: 'red', tolerance: 3 })).toBeNull();
  });

  it('exportScale: toPng（upscale）は maxEdge が紙より大きければ拡大する', () => {
    expect(exportScale({ width: 1472, height: 920 }, 2048, 1, true)).toBeCloseTo(2048 / 1472);
    expect(exportScale({ width: 1472, height: 920 }, 2048, 1, false)).toBe(1);
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
  ctxOpts: unknown;
  listeners: Map<string, (e: unknown) => void>;
  getContext(kind: string, o?: unknown): unknown;
  addEventListener(n: string, f: (e: unknown) => void): void;
  removeEventListener(n: string): void;
  remove(): void;
  setPointerCapture(): void;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  toBlob(cb: (b: Blob | null) => void, type?: string): void;
}
let canvases: FakeCanvas[] = [];
let rafQueue = new Map<number, FrameRequestCallback>();
let rafSeq = 0;
let hostW = 400;
let hostH = 300;

function makeCanvas(): FakeCanvas {
  const calls: Call[] = [];
  const props: Record<string | symbol, unknown> = {};
  const c = {} as FakeCanvas;
  const ctx = new Proxy(props, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'getImageData' || prop === 'createImageData') {
        return (...args: unknown[]) => {
          calls.push({ name: String(prop), args, state: { ...target } });
          const w = Number(prop === 'getImageData' ? args[2] : args[0]);
          const h = Number(prop === 'getImageData' ? args[3] : args[1]);
          return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
        };
      }
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
  Object.assign(c, {
    width: 0,
    height: 0,
    style: {},
    calls,
    ctxOpts: undefined,
    listeners,
    getContext: (_k: string, o?: unknown) => {
      c.ctxOpts = o;
      return ctx;
    },
    addEventListener(n: string, f: (e: unknown) => void) {
      listeners.set(n, f);
    },
    removeEventListener(n: string) {
      listeners.delete(n);
    },
    remove() {},
    setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: hostW, height: hostH }),
    toBlob(cb: (b: Blob | null) => void, type?: string) {
      cb(new Blob(['x'], { type: type ?? 'image/png' }));
    },
  });
  canvases.push(c);
  return c;
}
const host = () => ({ get clientWidth() { return hostW; }, get clientHeight() { return hostH; }, style: {}, appendChild() {} }) as unknown as HTMLElement;
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
function drag(c: FakeCanvas, pts: [number, number][], pointerId = 1, pointerType = 'pen'): void {
  const [first, ...rest] = pts;
  c.listeners.get('pointerdown')!(pe(first![0], first![1], pointerId, pointerType));
  for (const [x, y] of rest) c.listeners.get('pointermove')!(pe(x, y, pointerId, pointerType));
  const last = pts.at(-1)!;
  c.listeners.get('pointerup')!(pe(last[0], last[1], pointerId, pointerType));
  flush();
}
const down = (c: FakeCanvas, x: number, y: number, id: number, t = 'touch') => c.listeners.get('pointerdown')!(pe(x, y, id, t));
const move = (c: FakeCanvas, x: number, y: number, id: number, t = 'touch') => c.listeners.get('pointermove')!(pe(x, y, id, t));
const up = (c: FakeCanvas, x: number, y: number, id: number, t = 'touch') => c.listeners.get('pointerup')!(pe(x, y, id, t));
const strokeCalls = (c: FakeCanvas) => c.calls.filter((x) => x.name === 'stroke').length;
const L1: LayerInfo = newLayerInfo('layer-1', 'レイヤー 1');
const docOf = (ops: CanvasOp[], layers: LayerInfo[] = [L1]): CanvasDocument => ({ v: 2, width: 400, height: 300, layers, active: layers.at(-1)!.id, ops });

beforeEach(() => {
  canvases = [];
  rafQueue = new Map();
  rafSeq = 0;
  ts = 0;
  hostW = 400;
  hostH = 300;
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('エンジン: レビュー対応（致命）', () => {
  it('切り詰めた書き出しでも、範囲の外から移動してきた線を描く（変形の元の範囲まで含めて再生してから切り出す）', async () => {
    const e = createCanvasEngine();
    e.attach(host());
    // 左上の線を右下へ移動。切り詰め範囲は移動後の線のまわりだけ
    e.loadDocument(
      docOf([
        { kind: 'stroke', layer: 'layer-1', points: hline(6, 20, 10, 5), style: { preset: 'pen', size: 3, opacity: 1 } },
        { kind: 'transform', layer: 'layer-1', mask: { kind: 'rect', x: 0, y: 0, w: 60, h: 40 }, matrix: [1, 0, 0, 1, 300, 240] },
      ]),
    );
    const before = canvases.length;
    await e.toWebp(1024);
    const made = canvases.slice(before);
    // 線を描いた画像（stroke を持つ）は、元の位置（x=10..35, y=20）を含む大きさで作られている
    const ink = made.find((c) => strokeCalls(c) > 0)!;
    const tf = ink.calls.find((c) => c.name === 'setTransform' && (c.args as number[])[0] !== 1)!.args as number[];
    const k = tf[0]!;
    // 元の線の左端（x=10）がこの画像の中（原点のずれ ox + 10k >= 0）
    expect(tf[4]! + 10 * k).toBeGreaterThanOrEqual(0);
    const out = made.at(-1)!;
    // 出力は切り詰めたまま（移動後の線のまわりの大きさ）で、線の画像を原点をずらして貼る
    const paste = out.calls.find((c) => c.name === 'drawImage' && c.args[0] === ink)!;
    expect((paste.args[1] as number) < 0 || (paste.args[2] as number) < 0).toBe(true);
  });

  it('参照「すべて」の塗りを何回含む文書を読み込んでも、作業用 canvas の数は塗りの回数に比例しない', () => {
    const e = createCanvasEngine();
    e.attach(host());
    const build = (F: number): CanvasOp[] => {
      const ops: CanvasOp[] = [{ kind: 'layer-add', layer: newLayerInfo('layer-2', 'L2'), index: 1 }];
      ops.push({ kind: 'stroke', layer: 'layer-1', points: hline(20, 100, 50, 10), style: { preset: 'pen', size: 3, opacity: 1 } });
      for (let i = 0; i < F; i++) ops.push({ kind: 'fill', layer: 'layer-2', x: 100 + i, y: 150, color: i % 2 ? '#FF0000' : '#00FF00', tolerance: 32, reference: 'all' });
      return ops;
    };
    const count = (F: number) => {
      const b = canvases.length;
      e.loadDocument(docOf(build(F)));
      return canvases.length - b;
    };
    const five = count(5);
    const twenty = count(20);
    expect(twenty).toBeLessThanOrEqual(five + 2);
    // 領域計算用は紙の大きさ × 1（DPR に依らない）の CPU canvas（willReadFrequently）
    const refs = canvases.filter((c) => (c.ctxOpts as { willReadFrequently?: boolean } | undefined)?.willReadFrequently);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.some((c) => c.width === 400 && c.height === 300)).toBe(true);
  });

  it('「全部消す」の後の getHistory() は、その後に描いた線だけ', () => {
    const e = createCanvasEngine();
    e.attach(host());
    const main = canvases[0]!;
    drag(main, [[10, 10], [50, 10], [90, 10]]);
    drag(main, [[10, 50], [50, 50], [90, 50]]);
    e.clear();
    expect(e.getHistory().strokes).toHaveLength(0);
    drag(main, [[10, 90], [50, 90], [90, 90]]);
    expect(e.getHistory().strokes).toHaveLength(1);
    expect(e.getHistory().strokes[0]![0]).toMatchObject({ x: 10, y: 90 });
    // Undo で「全部消す」の前に戻れば、消した線も戻る
    e.undo();
    e.undo();
    expect(e.getHistory().strokes).toHaveLength(2);
  });

  it('gestures: false では 2 本指のズーム・パンと手のひらを無効にする（既定は true）', () => {
    const e = createCanvasEngine({ penOnly: false, gestures: false });
    e.attach(host());
    const main = canvases[0]!;
    e.setTool('shape-line');
    down(main, 100, 100, 11);
    down(main, 200, 100, 12);
    move(main, 50, 100, 11);
    move(main, 300, 100, 12);
    up(main, 50, 100, 11);
    up(main, 300, 100, 12);
    expect(e.getView()).toEqual({ zoom: 1, panX: 0, panY: 0, rotationDeg: 0 });
    e.setTool('hand');
    drag(main, [[100, 100], [150, 150]], 13, 'touch');
    expect(e.getView()).toEqual({ zoom: 1, panX: 0, panY: 0, rotationDeg: 0 });
    // 既定（true）ならピンチでズーム
    e.setOptions({ gestures: true });
    down(main, 100, 100, 21);
    down(main, 200, 100, 22);
    move(main, 50, 100, 21);
    move(main, 250, 100, 22);
    expect(e.getView().zoom).toBeCloseTo(2);
  });
});

describe('エンジン: レビュー対応（正しさ）', () => {
  it("墨で塗ると fill.color は 'ink'（描画時にテーマの墨へ解決）。toPng の inkColor で上書きできる", async () => {
    const e = createCanvasEngine({ inkColor: '#112233' });
    e.attach(host());
    const main = canvases[0]!;
    e.setTool('fill');
    drag(main, [[20, 30]]);
    const op = e.getDocument().ops.at(-1) as Extract<CanvasOp, { kind: 'fill' }>;
    expect(op.color).toBe('ink');
    // 型押し（createImageData）に墨の色が入る。書き出しでは inkColor で上書き
    const before = canvases.length;
    await e.toPng(400, { inkColor: '#00ff00' });
    const stamp = canvases.find((c) => c.calls.some((x) => x.name === 'putImageData'));
    expect(stamp).toBeDefined();
    expect(canvases.length).toBeGreaterThan(before);
  });

  it('変形プレビュー中の undo() はプレビューを取り消すだけ。確定した移動の Undo/Redo は選択範囲も戻す', () => {
    const e = createCanvasEngine();
    e.attach(host());
    const main = canvases[0]!;
    drag(main, [[10, 100], [60, 100], [110, 100]]);
    e.setSelection({ kind: 'rect', x: 0, y: 80, w: 120, h: 40 });
    e.transformSelection([1, 0, 0, 1, 50, 0]);
    e.undo();
    expect(e.isTransforming()).toBe(false);
    expect(e.getStrokes()).toHaveLength(1); // 直前の線は残る
    expect(e.getSelection()).toEqual({ kind: 'rect', x: 0, y: 80, w: 120, h: 40 });
    e.transformSelection([1, 0, 0, 1, 50, 0]);
    e.commitTransform();
    expect(e.getSelection()).toEqual({ kind: 'rect', x: 50, y: 80, w: 120, h: 40 });
    e.undo();
    expect(e.getSelection()).toEqual({ kind: 'rect', x: 0, y: 80, w: 120, h: 40 });
    e.redo();
    expect(e.getSelection()).toEqual({ kind: 'rect', x: 50, y: 80, w: 120, h: 40 });
  });

  it('選択範囲の切り抜き・消去は偶奇規則（evenodd）でクリップする（当たり判定と同じ）', () => {
    const e = createCanvasEngine();
    e.attach(host());
    const main = canvases[0]!;
    drag(main, [[10, 100], [60, 100], [110, 100]]);
    e.setSelection({ kind: 'lasso', points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }] });
    e.deleteSelection();
    const clips = canvases.flatMap((c) => c.calls.filter((x) => x.name === 'clip'));
    expect(clips.length).toBeGreaterThan(0);
    expect(clips.every((x) => x.args[0] === 'evenodd')).toBe(true);
  });

  it('penOnly=false で塗りのまま 2 本指にしたら、1 本目の塗りは積まない（1 本指だけなら離したときに積む）', () => {
    const e = createCanvasEngine({ penOnly: false });
    e.attach(host());
    const main = canvases[0]!;
    e.setTool('fill');
    down(main, 100, 100, 1);
    down(main, 200, 100, 2);
    move(main, 50, 100, 1);
    move(main, 250, 100, 2);
    up(main, 50, 100, 1);
    up(main, 250, 100, 2);
    expect(e.getDocument().ops).toHaveLength(0);
    e.resetView();
    down(main, 100, 100, 3);
    expect(e.getDocument().ops).toHaveLength(0);
    up(main, 100, 100, 3);
    expect(e.getDocument().ops.map((o) => o.kind)).toEqual(['fill']);
    // スポイトの 1 本目で変わった色もジェスチャーに入るときに戻す
    e.setPen({ color: '#123456' });
    e.setTool('eyedropper');
    down(main, 100, 100, 4); // 透明 → 墨に戻る
    expect(e.getPen().color).toBeUndefined();
    down(main, 200, 100, 5);
    expect(e.getPen().color).toBe('#123456');
  });

  it('fitView: 紙が画面に収まれば 100%。画面より紙が大きく（回転後）内容が収まらないときだけ縮小', () => {
    const e = createCanvasEngine();
    e.attach(host());
    e.setView({ zoom: 0.5, panX: 10 });
    e.fitView();
    expect(e.getView()).toEqual({ zoom: 1, panX: 0, panY: 0, rotationDeg: 0 });
    // 紙を広げる（画面を縦にした）: 400x300 → 300x400 の画面、紙 400x400
    e.loadDocument(docOf([{ kind: 'stroke', layer: 'layer-1', points: [pt(20, 20), pt(380, 380)], style: { preset: 'pen', size: 3, opacity: 1 } }]));
    hostW = 300;
    hostH = 400;
    e.detach();
    e.attach(host());
    expect([e.getDocument().width, e.getDocument().height]).toEqual([400, 400]);
    e.fitView();
    expect(e.getView().zoom).toBeLessThan(1);
    // 内容が小さければ 100%
    e.loadDocument({ ...docOf([{ kind: 'stroke', layer: 'layer-1', points: [pt(20, 20), pt(100, 100)], style: { preset: 'pen', size: 3, opacity: 1 } }]), width: 400, height: 400 });
    e.setView({ zoom: 0.5 });
    e.fitView();
    expect(e.getView().zoom).toBe(1);
  });

  it('書き出しは紙色の上で合成する（紙色を敷いてから乗算のレイヤーを重ねる）。透過だけ透明の上', async () => {
    const e = createCanvasEngine({ paperColor: '#f3f0ea' });
    e.attach(host());
    const main = canvases[0]!;
    drag(main, [[10, 100], [60, 100], [110, 100]]);
    const b = e.addLayer();
    drag(main, [[10, 200], [60, 210], [110, 220]]);
    e.setLayer(b.id, { blend: 'multiply' });
    let before = canvases.length;
    await e.toPng(400);
    let out = canvases.slice(before).at(-1)!;
    const paperAt = out.calls.findIndex((c) => c.name === 'fillRect');
    const multAt = out.calls.findIndex((c) => c.name === 'drawImage' && c.state.globalCompositeOperation === 'multiply');
    expect(paperAt).toBeGreaterThanOrEqual(0);
    expect(multAt).toBeGreaterThan(paperAt);
    before = canvases.length;
    await e.toPng(400, { transparent: true });
    out = canvases.slice(before).at(-1)!;
    expect(out.calls.some((c) => c.name === 'fillRect')).toBe(false);
  });
});

describe('エンジン: レビュー対応（性能・メモリ）', () => {
  it('線だけのレイヤーでも数十本ごとにチェックポイントを取り、古い線が多くても Undo で描き直す本数は一定以下', () => {
    const e = createCanvasEngine();
    e.attach(host());
    const main = canvases[0]!;
    e.loadStrokes(Array.from({ length: 150 }, (_, i) => hline(4, 5 + i, 10, 10)));
    drag(main, [[10, 250], [60, 250], [110, 250]]);
    const layer = canvases[1]!;
    layer.calls.length = 0;
    e.undo();
    // 150 本を最初から描き直さない（チェックポイントから 40 本未満）
    expect(strokeCalls(layer)).toBeLessThan(40 * 3);
    expect(layer.calls.some((c) => c.name === 'drawImage')).toBe(true);
  });

  it('紙が広がる（画面の回転）ときは描き直さず、画像を左上そろえで広げる。シルエットの切り替えも描き直さない', () => {
    const e = createCanvasEngine();
    let cb: (() => void) | null = null;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(f: () => void) {
          cb = f;
        }
        observe() {}
        disconnect() {}
      },
    );
    e.attach(host());
    const main = canvases[0]!;
    for (let i = 0; i < 5; i++) drag(main, [[10, 20 + i * 10], [60, 20 + i * 10], [110, 20 + i * 10]]);
    const layer = canvases[1]!;
    layer.calls.length = 0;
    hostW = 300;
    hostH = 400;
    cb!();
    expect([e.getDocument().width, e.getDocument().height]).toEqual([400, 400]);
    expect(layer.height).toBe(400);
    expect(strokeCalls(layer)).toBe(0);
    expect(layer.calls.some((c) => c.name === 'drawImage')).toBe(true);
    layer.calls.length = 0;
    e.setOptions({ silhouette: true });
    expect(strokeCalls(layer)).toBe(0);
  });

  it('detach・レイヤー削除で canvas を大きさ 0 にして手放す', () => {
    const e = createCanvasEngine();
    e.attach(host());
    const main = canvases[0]!;
    drag(main, [[10, 100], [60, 100], [110, 100]]);
    const b = e.addLayer();
    drag(main, [[10, 150], [60, 150], [110, 150]]);
    const alive = () => canvases.filter((c) => c.width > 0);
    const bm = alive().find((c) => c.calls.some((x) => x.name === 'stroke') && c !== canvases[1]);
    e.removeLayer(b.id);
    expect(bm?.width).toBe(0);
    e.detach();
    expect(alive()).toHaveLength(0);
  });

  it('contextrestored（2D コンテキストが戻った）で ops から描き直す', () => {
    const e = createCanvasEngine();
    e.attach(host());
    const main = canvases[0]!;
    drag(main, [[10, 100], [60, 100], [110, 100]]);
    const layer = canvases[1]!;
    layer.calls.length = 0;
    main.listeners.get('contextrestored')!({});
    flush();
    expect(strokeCalls(layer)).toBeGreaterThan(0);
  });

  it('拡大表示（zoom > 1）は止まってから表示の倍率で描き直した画像を 1:1 で置く', async () => {
    vi.useFakeTimers();
    const e = createCanvasEngine();
    e.attach(host());
    const main = canvases[0]!;
    drag(main, [[10, 100], [60, 100], [110, 100]]);
    e.setView({ zoom: 3, panX: 0, panY: 0 });
    const before = canvases.length;
    vi.advanceTimersByTime(400);
    const made = canvases.slice(before);
    const hi = made.find((c) => strokeCalls(c) > 0);
    expect(hi).toBeDefined();
    // 見えている範囲（400/3 × 300/3）を 3 倍で = 画面と同じくらいの画素
    expect(hi!.width).toBeGreaterThanOrEqual(400);
    expect(hi!.width).toBeLessThanOrEqual(420);
    main.calls.length = 0;
    e.setView({ panX: -1 }); // ビューが変わると一旦は元の画像（描き直しを待つ）
    expect(main.calls.some((c) => c.name === 'drawImage' && c.args[0] === hi)).toBe(false);
    vi.advanceTimersByTime(400);
    e.setOptions({ grid: 'thirds' });
    const last = main.calls.filter((c) => c.name === 'drawImage').map((c) => c.args[0] as FakeCanvas);
    expect(last.some((c) => made.includes(c) || canvases.indexOf(c) >= before)).toBe(true);
  });
});
