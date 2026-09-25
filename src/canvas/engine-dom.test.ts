/**
 * engine.ts を最小の偽 DOM（document / canvas / 2D コンテキストの記録器 / rAF / performance.now）で動かすテスト。
 * 実際の描画結果ではなく「何を描いたか（呼び出し）」と状態の整合を見る。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Drawing, Stroke, StrokePoint } from '@/scoring/types';
import { createCanvasEngine } from './engine';
import { CROP_MARGIN_MIN, cropRect, exportScale, inkBounds } from './crop';
import { lineWidth } from './smooth';

const pt = (x: number, y: number, p = 0.5, t = 0): StrokePoint => ({ x, y, p, t });
/** (x0,y0) から右へ 10px 間隔で n 点、t は 10ms 間隔 */
const line = (n: number, t0 = 0, x0 = 0, y0 = 0): Stroke =>
  Array.from({ length: n }, (_, i) => pt(x0 + i * 10, y0, 0.5, t0 + i * 10));

/* ------------------------------------------------------------------ */
/* 偽 DOM                                                              */
/* ------------------------------------------------------------------ */

interface Call {
  name: string;
  args: unknown[];
}
interface FakeCanvas {
  width: number;
  height: number;
  style: Record<string, string>;
  calls: Call[];
  getContext(): unknown;
  addEventListener(): void;
  removeEventListener(): void;
  remove(): void;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  toBlob(cb: (b: Blob | null) => void, type?: string): void;
  /** toBlob した時点の大きさ（書き出し後は canvas を大きさ 0 にして手放すため） */
  bw?: number;
  bh?: number;
}

let canvases: FakeCanvas[] = [];
let now = 0;
let rafQueue = new Map<number, FrameRequestCallback>();
let rafSeq = 0;

function makeCanvas(): FakeCanvas {
  const calls: Call[] = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        calls.push({ name: String(prop), args });
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
  const c: FakeCanvas = {
    width: 0,
    height: 0,
    style: {},
    calls,
    getContext: () => ctx,
    addEventListener() {},
    removeEventListener() {},
    remove() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }),
    toBlob(cb, type) {
      c.bw = c.width;
      c.bh = c.height;
      cb(new Blob(['x'], { type: type ?? 'image/png' }));
    },
  };
  canvases.push(c);
  return c;
}

function makeHost(w = 400, h = 300): HTMLElement {
  return { clientWidth: w, clientHeight: h, style: {}, appendChild() {} } as unknown as HTMLElement;
}

/** 時刻を進めて、その時点で予約されている rAF をすべて実行する */
function advance(ms: number): void {
  now += ms;
  const q = [...rafQueue.values()];
  rafQueue.clear();
  for (const cb of q) cb(now);
}

function runToEnd(): void {
  for (let i = 0; i < 50 && rafQueue.size > 0; i++) advance(50);
}

const count = (c: FakeCanvas, name: string) => c.calls.filter((x) => x.name === name).length;

beforeEach(() => {
  canvases = [];
  now = 1000;
  rafQueue = new Map();
  rafSeq = 0;
  vi.stubGlobal('document', { createElement: () => makeCanvas() });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = ++rafSeq;
    rafQueue.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    rafQueue.delete(id);
  });
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/* 再生                                                                */
/* ------------------------------------------------------------------ */

describe('replay（偽 DOM）', () => {
  /** 5 点 + 4 点 → 区間は 4 + 3 = 7 */
  const drawing: Drawing = [line(5, 0), line(4, 1000, 0, 50)];
  const SEGMENTS = 7;

  /** attach で作られる canvas: [0] 表示 / [1] cache（紙＋完了ストローク） / [2] live（進行中） / [3] scratch */
  function setup() {
    const e = createCanvasEngine();
    e.attach(makeHost());
    const [main, cache, live] = canvases as [FakeCanvas, FakeCanvas, FakeCanvas];
    return { e, main, cache, live };
  }
  const reset = (...cs: FakeCanvas[]) => cs.forEach((c) => (c.calls.length = 0));

  it('loadStrokes の後でも最後まで再生でき、完了で Promise が解決する', async () => {
    const { e, main, cache, live } = setup();
    e.loadStrokes(drawing);
    reset(main, cache, live);
    let done = false;
    const p = e.replay({ speed: 1 }).then(() => {
      done = true;
    });
    runToEnd();
    await p;
    expect(done).toBe(true);
    // 途中は live レイヤーに描き足し、描き終えた線は cache へ完成形を 1 回。終了時に cache を作り直して貼る
    expect(count(live, 'quadraticCurveTo') + count(live, 'arc')).toBeGreaterThan(0);
    expect(count(cache, 'quadraticCurveTo')).toBe(SEGMENTS * 2);
    expect(count(main, 'quadraticCurveTo')).toBe(0);
    expect(main.calls.at(-1)!.name).toBe('drawImage');
    expect(e.getStrokes()).toEqual(drawing);
    expect(rafQueue.size).toBe(0);
  });

  it('attach 前に loadStrokes しておいても再生できる', async () => {
    const e = createCanvasEngine();
    e.loadStrokes(drawing);
    e.attach(makeHost());
    const cache = canvases[1]!;
    cache.calls.length = 0;
    const p = e.replay({ speed: 4 });
    runToEnd();
    await p;
    expect(count(cache, 'quadraticCurveTo')).toBe(SEGMENTS * 2);
  });

  it('再生途中の cancelReplay: 即解決・完成状態を表示・データと履歴は変わらない', async () => {
    const { e, main, cache, live } = setup();
    e.loadStrokes(drawing);
    e.loadStrokes(drawing); // 2 回読んでも履歴は積まれない
    const canUndo = e.canUndo();
    reset(main, cache, live);
    const p = e.replay({ speed: 1 });
    advance(20); // 1 本目の途中
    const partial = count(live, 'quadraticCurveTo');
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(SEGMENTS);
    expect(count(cache, 'quadraticCurveTo')).toBe(0); // まだ描き終えた線はない

    e.cancelReplay();
    await expect(p).resolves.toBeUndefined();
    expect(main.calls.at(-1)!.name).toBe('drawImage');
    expect(rafQueue.size).toBe(0);
    expect(e.getStrokes()).toEqual(drawing);
    expect(e.canUndo()).toBe(canUndo);

    // 止めた後に時間が進んでも描き足さない
    const before = [main, cache, live].map((c) => c.calls.length);
    advance(1000);
    expect([main, cache, live].map((c) => c.calls.length)).toEqual(before);

    // 2 回目の cancel は無害、再生し直せば最初から全部描く
    e.cancelReplay();
    reset(main, cache, live);
    const p2 = e.replay({ speed: 1 });
    runToEnd();
    await p2;
    expect(count(cache, 'quadraticCurveTo')).toBe(SEGMENTS * 2);
  });

  it('再生中の loadStrokes / undo / 再度の replay は前の再生を解決して止める', async () => {
    const { e, main, cache, live } = setup();
    e.loadStrokes(drawing);
    const p1 = e.replay({ speed: 1 });
    advance(20);
    e.loadStrokes([line(3)]);
    await expect(p1).resolves.toBeUndefined();

    const p2 = e.replay({ speed: 1 });
    advance(5);
    const p3 = e.replay({ speed: 1 }); // 重ねて呼ぶ（前の再生の終了処理で cache を描き直す）
    await expect(p2).resolves.toBeUndefined();
    reset(main, cache, live);
    runToEnd();
    await p3;
    expect(count(cache, 'quadraticCurveTo')).toBe(2 * 2); // 新しい 3 点のストロークだけ（再生中 1 回＋終了時 1 回）
    expect(e.getStrokes()).toEqual([line(3)]);

    e.clear();
    e.undo();
    const p4 = e.replay({ speed: 1 });
    e.undo();
    await expect(p4).resolves.toBeUndefined();
    expect(e.getStrokes()).toEqual([line(3)]);
  });

  it('detach で再生中の Promise も解決する', async () => {
    const { e } = setup();
    e.loadStrokes(drawing);
    const p = e.replay({ speed: 1 });
    advance(10);
    e.detach();
    await expect(p).resolves.toBeUndefined();
    expect(rafQueue.size).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* 書き出し                                                            */
/* ------------------------------------------------------------------ */

describe('toWebp（偽 DOM）', () => {
  const stroke: Stroke = [pt(100, 100), pt(200, 125), pt(300, 150)];

  it('既定は内容の範囲に切り詰め、縦横比を保って maxEdge に収める', async () => {
    const e = createCanvasEngine();
    e.attach(makeHost(400, 300));
    e.loadStrokes([stroke]);
    const blob = await e.toWebp(1024);
    expect(blob.type).toBe('image/webp');
    const out = canvases.at(-1)!;
    const r = cropRect([stroke], 3)!;
    expect(Math.max(out.bw!, out.bh!)).toBeLessThanOrEqual(1024);
    expect(out.bw! / out.bh!).toBeCloseTo(r.width / r.height, 1);
    expect(out.bw!).not.toBe(out.bh!);
    // 原点を切り詰め範囲の左上へずらして描く（線は透明な層に描いてから紙に重ねる）
    const ink = canvases.at(-2)!;
    const tf = ink.calls.find((c) => c.name === 'setTransform')!.args as number[];
    const k = tf[0]!;
    expect(tf[4]).toBeCloseTo(-r.x * k);
    expect(tf[5]).toBeCloseTo(-r.y * k);
  });

  it('crop: false は紙全体（従来どおり）', async () => {
    const e = createCanvasEngine();
    e.attach(makeHost(400, 300));
    e.loadStrokes([stroke]);
    await e.toWebp(1024, 0.8, { crop: false });
    const out = canvases.at(-1)!;
    expect([out.bw!, out.bh!]).toEqual([400, 300]);
  });

  it('ストロークが無ければ紙全体', async () => {
    const e = createCanvasEngine();
    e.attach(makeHost(400, 300));
    await e.toWebp(200);
    const out = canvases.at(-1)!;
    expect([out.bw!, out.bh!]).toEqual([200, 150]);
  });

  it('attach 前（保存時の一時エンジン）でも切り詰めて書き出せる', async () => {
    const e = createCanvasEngine();
    e.loadStrokes([stroke]);
    await e.toWebp(1024);
    const out = canvases.at(-1)!;
    const r = cropRect([stroke], 3)!;
    expect(out.bw! / out.bh!).toBeCloseTo(r.width / r.height, 1);
  });
});

/* ------------------------------------------------------------------ */
/* 切り詰め範囲（純関数）                                               */
/* ------------------------------------------------------------------ */

describe('crop（純関数）', () => {
  it('inkBounds: 線幅の半分ぶん外側まで含む／空なら null／非数は無視', () => {
    expect(inkBounds([], 3)).toBeNull();
    expect(inkBounds([[]], 3)).toBeNull();
    const r = lineWidth(3, 1) / 2;
    const b = inkBounds([[pt(10, 20, 1), pt(50, 40, 1), pt(Number.NaN, 999, 1)]], 3)!;
    expect(b.x).toBeCloseTo(10 - r);
    expect(b.y).toBeCloseTo(20 - r);
    expect(b.width).toBeCloseTo(40 + 2 * r);
    expect(b.height).toBeCloseTo(20 + 2 * r);
  });

  it('cropRect: 余白は長辺の 8%（大きい絵）', () => {
    const big: Drawing = [[pt(0, 0, 0), pt(1000, 500, 0)]];
    const b = inkBounds(big, 3)!;
    const r = cropRect(big, 3)!;
    const m = b.width * 0.08; // 約 80 > 24
    expect(r.x).toBe(Math.floor(b.x - m));
    expect(r.y).toBe(Math.floor(b.y - m));
    expect(r.x + r.width).toBe(Math.ceil(b.x + b.width + m));
    expect(r.y + r.height).toBe(Math.ceil(b.y + b.height + m));
    // 内容の縦横比（正方形にしない）
    expect(r.width).toBeGreaterThan(r.height * 1.5);
  });

  it('cropRect: 小さい絵は最低 24px、1 点だけでも範囲がある、負の座標も可', () => {
    const r = cropRect([[pt(-5, 10)]], 3)!;
    const half = lineWidth(3, 0.5) / 2;
    expect(r.x).toBe(Math.floor(-5 - half - CROP_MARGIN_MIN));
    expect(r.width).toBeGreaterThanOrEqual(2 * CROP_MARGIN_MIN);
    expect(r.height).toBeGreaterThanOrEqual(2 * CROP_MARGIN_MIN);
    expect(cropRect([], 3)).toBeNull();
  });

  it('exportScale: 長辺は maxEdge 以下。upscale（切り詰め・toPng）は最大 4 倍（か DPR）まで拡大、toWebp の紙全体は DPR まで', () => {
    expect(exportScale({ width: 2000, height: 100 }, 1024, 2, true)).toBeCloseTo(1024 / 2000);
    expect(exportScale({ width: 256, height: 100 }, 1024, 1, true)).toBeCloseTo(4);
    expect(exportScale({ width: 100, height: 50 }, 1024, 1, true)).toBe(4);
    // toPng(2048) で長辺 1472 の紙 → 2048
    expect(exportScale({ width: 1472, height: 920 }, 2048, 1, true)).toBeCloseTo(2048 / 1472);
    expect(exportScale({ width: 400, height: 300 }, 1024, 2, false)).toBe(2);
    expect(exportScale({ width: 400, height: 300 }, 1024, 0.5, false)).toBe(1);
    expect(exportScale({ width: 4000, height: 300 }, 1024, 2, false)).toBeCloseTo(1024 / 4000);
  });
});

/* ------------------------------------------------------------------ */
/* 表示だけの透明度（ドリルの薄表示）                                    */
/* ------------------------------------------------------------------ */

describe('setStrokeVisibility（偽 DOM）', () => {
  /** 5 点（4 区間）+ 4 点（3 区間） */
  const drawing: Drawing = [line(5, 0), line(4, 1000, 0, 50)];

  function setup() {
    const e = createCanvasEngine();
    e.attach(makeHost());
    const cache = canvases[1]!;
    e.loadStrokes(drawing);
    cache.calls.length = 0;
    return { e, cache };
  }

  it('0 の線は描かない・薄い線は描く。getStrokes / getHistory は変わらない', () => {
    const { e, cache } = setup();
    const before = e.getHistory();
    e.setStrokeVisibility([0, 1]);
    expect(count(cache, 'quadraticCurveTo')).toBe(3);
    cache.calls.length = 0;
    const scratch = canvases[3]!;
    scratch.calls.length = 0;
    e.setStrokeVisibility([0.3, 1]);
    // 薄い線は作業レイヤー（scratch）に描いてから透明度を掛けて cache へ合成する
    expect(count(cache, 'quadraticCurveTo')).toBe(3);
    expect(count(scratch, 'quadraticCurveTo')).toBe(4);
    expect(count(cache, 'drawImage')).toBeGreaterThan(0);
    expect(e.getStrokes()).toEqual(drawing);
    expect(e.getHistory()).toEqual(before);
    expect(e.canUndo()).toBe(false);
  });

  it('同じ値なら描き直さない。null で元に戻る', () => {
    const { e, cache } = setup();
    e.setStrokeVisibility([0, 1]);
    cache.calls.length = 0;
    e.setStrokeVisibility([0, 1]);
    expect(cache.calls.length).toBe(0);
    e.setStrokeVisibility(null);
    expect(count(cache, 'quadraticCurveTo')).toBe(7);
  });
});
