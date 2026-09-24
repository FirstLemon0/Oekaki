/**
 * ペン・消しゴム・グリッド・反転（実機フィードバック対応）のテスト。
 * 純関数（pen / erase / grid）と、偽 DOM でのエンジンの状態・描画呼び出し。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Stroke, StrokePoint } from '@/scoring/types';
import type { StrokeStyle } from './types';
import {
  PALETTE_COLORS,
  PEN_PRESETS,
  jitterPoints,
  needsLayer,
  normalizeHexColor,
  penAlpha,
  penWidth,
  resolvePen,
  sanitizeStyle,
  taperFactor,
  TAPER_MIN,
} from './pen';
import { eraseSegments, eraseStroke } from './erase';
import { gridLines, normalizeGrid, sameGrid } from './grid';
import { createCanvasEngine } from './engine';
import { cropRect } from './crop';
import { lineWidth } from './smooth';

const pt = (x: number, y: number, p = 0.5, t = 0): StrokePoint => ({ x, y, p, t });
/** (x0,y0) から右へ step 間隔で n 点 */
const hline = (n: number, y = 0, x0 = 0, step = 10): Stroke =>
  Array.from({ length: n }, (_, i) => pt(x0 + i * step, y, 0.5, i * 10));

/* ------------------------------------------------------------------ */
/* ペン                                                                */
/* ------------------------------------------------------------------ */

describe('pen（純関数）', () => {
  it('既定値: pen は size 3・不透明・0.5〜1.6 倍（旧 lineWidth と同じ）', () => {
    const pen = PEN_PRESETS.pen;
    expect(pen.size).toBe(3);
    expect(pen.opacity).toBe(1);
    expect(pen.pressureWidth).toEqual([0.5, 1.6]);
    expect(pen.taper).toBe(false);
    const rp = resolvePen({ preset: 'pen', size: 3, opacity: 1 }, 99);
    for (const p of [0, 0.3, 1]) expect(penWidth(rp, p)).toBeCloseTo(lineWidth(3, p));
    expect(needsLayer(rp)).toBe(false);
  });

  it('スタイルなし（旧データ）は baseWidth の pen', () => {
    const rp = resolvePen(undefined, 5);
    expect(penWidth(rp, 1)).toBeCloseTo(lineWidth(5, 1));
    expect(rp.opacity).toBe(1);
  });

  it('pencil は筆圧で濃淡、marker は幅一定で multiply、brush は入り抜き', () => {
    const pencil = resolvePen({ preset: 'pencil', size: 2, opacity: 0.85 }, 3);
    expect(penAlpha(pencil, 0)).toBeCloseTo(0.5);
    expect(penAlpha(pencil, 1)).toBeCloseTo(1);
    expect(needsLayer(pencil)).toBe(true);
    const marker = resolvePen({ preset: 'marker', size: 10, opacity: 0.45 }, 3);
    expect(penWidth(marker, 0)).toBe(penWidth(marker, 1));
    expect(marker.blend).toBe('multiply');
    expect(needsLayer(marker)).toBe(true);
    const brush = resolvePen({ preset: 'brush', size: 5, opacity: 1 }, 3);
    expect(penWidth(brush, 0)).toBeCloseTo(1);
    expect(penWidth(brush, 1)).toBeCloseTo(11);
    expect(brush.taper).toBe(true);
  });

  it('taperFactor: 始点・終点で絞り、中ほどは 1。終点未定なら始点側だけ', () => {
    const brush = resolvePen({ preset: 'brush', size: 5, opacity: 1 }, 3);
    expect(taperFactor(brush, 0, 100, 30)).toBe(TAPER_MIN);
    expect(taperFactor(brush, 15, 100, 30)).toBeCloseTo(0.5);
    expect(taperFactor(brush, 50, 100, 30)).toBe(1);
    expect(taperFactor(brush, 100, 100, 30)).toBe(TAPER_MIN);
    expect(taperFactor(brush, 100, null, 30)).toBe(1);
    const pen = resolvePen(undefined, 3);
    expect(taperFactor(pen, 0, 100, 30)).toBe(1);
  });

  it('ざらつきはシード固定（同じ線なら毎回同じ）で ±amp 以内、amp 0 はそのまま', () => {
    const s = hline(20);
    const a = jitterPoints(s, 0.5);
    const b = jitterPoints(s.map((q) => ({ ...q })), 0.5);
    expect(a).toEqual(b);
    a.forEach((q, i) => {
      expect(Math.abs(q.x - s[i]!.x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(q.y - s[i]!.y)).toBeLessThanOrEqual(0.5);
    });
    expect(a.some((q, i) => q.x !== s[i]!.x)).toBe(true);
    // 途中までの点列でも同じ位置（描画中と完成後で線が動かない）
    expect(jitterPoints(s.slice(0, 5), 0.5)).toEqual(a.slice(0, 5));
    expect(jitterPoints(s, 0)).toBe(s);
  });

  it('色: #RRGGBB だけ受け付けて大文字に。パレットは 14 色', () => {
    expect(normalizeHexColor('#c8553d')).toBe('#C8553D');
    expect(normalizeHexColor('red')).toBeUndefined();
    expect(normalizeHexColor('#fff')).toBeUndefined();
    expect(PALETTE_COLORS).toHaveLength(14);
    for (const c of PALETTE_COLORS) expect(normalizeHexColor(c.color)).toBe(c.color);
  });

  it('sanitizeStyle: 範囲外は丸め、壊れたものは undefined', () => {
    expect(sanitizeStyle({ preset: 'pen', size: 99, opacity: 0 })).toEqual({ preset: 'pen', size: 16, opacity: 0.1 });
    expect(sanitizeStyle({ preset: 'nope', size: 3, opacity: 1 })).toBeUndefined();
    expect(sanitizeStyle(null)).toBeUndefined();
    expect(sanitizeStyle({ preset: 'marker', size: 'x', opacity: 0.5, color: '#3e7ec8' })).toEqual({
      preset: 'marker',
      size: 10,
      opacity: 0.5,
      color: '#3E7EC8',
    });
  });
});

/* ------------------------------------------------------------------ */
/* 部分消しゴム                                                         */
/* ------------------------------------------------------------------ */

describe('eraseSegments（純関数）', () => {
  const pen: StrokeStyle = { preset: 'pen', size: 3, opacity: 1 };
  const marker: StrokeStyle = { preset: 'marker', size: 10, opacity: 0.45, color: '#3E7EC8' };

  it('半径の外は無変化（同じ参照を返す）', () => {
    const strokes = [hline(11)];
    const styles = [pen];
    const r = eraseSegments(strokes, styles, [pt(50, 30), pt(60, 30)], 10);
    expect(r.changed).toBe(false);
    expect(r.strokes).toBe(strokes);
    expect(r.styles).toBe(styles);
  });

  it('真ん中を消すと 2 本に分かれ、境界は消しゴムの縁、元の点の p と t はそのまま', () => {
    const s = hline(11); // x = 0..100
    const r = eraseSegments([s], [marker], [pt(50, 0)], 12);
    expect(r.changed).toBe(true);
    expect(r.strokes).toHaveLength(2);
    const [a, b] = r.strokes as [Stroke, Stroke];
    expect(a[0]).toEqual(s[0]);
    expect(a.at(-1)!.x).toBeCloseTo(38, 3);
    expect(b[0]!.x).toBeCloseTo(62, 3);
    expect(b.at(-1)).toEqual(s[10]);
    // 残った元の点は変えない
    expect(a.slice(0, -1)).toEqual(s.slice(0, 4));
    // 境界点の t は線形補間
    expect(a.at(-1)!.t).toBeCloseTo(38, 3);
    // スタイルは元を引き継ぐ
    expect(r.styles).toEqual([marker, marker]);
  });

  it('端を消すと 1 本のまま短くなる', () => {
    const s = hline(11);
    const r = eraseSegments([s], [pen], [pt(100, 0), pt(120, 0)], 15);
    expect(r.strokes).toHaveLength(1);
    expect(r.strokes[0]!.at(-1)!.x).toBeCloseTo(85, 3);
    expect(r.strokes[0]![0]).toEqual(s[0]);
  });

  it('点の間を消しゴムが横切っても切れる（疎な点列）', () => {
    const s: Stroke = [pt(0, 0), pt(100, 0)];
    const r = eraseSegments([s], [pen], [pt(50, -30), pt(50, 30)], 5);
    expect(r.strokes).toHaveLength(2);
    expect(r.strokes[0]!.at(-1)!.x).toBeCloseTo(45, 3);
    expect(r.strokes[1]![0]!.x).toBeCloseTo(55, 3);
  });

  it('複数ストロークを同時に消し、順序と styles の対応を保つ', () => {
    const s0 = hline(11, 0);
    const s1 = hline(11, 200); // 当たらない
    const s2 = hline(11, 10);
    const r = eraseSegments([s0, s1, s2], [pen, undefined, marker], [pt(50, -10), pt(50, 20)], 5);
    expect(r.strokes).toHaveLength(5);
    expect(r.styles).toEqual([pen, pen, undefined, marker, marker]);
    expect(r.strokes[2]).toBe(s1);
    expect(r.strokes[0]![0]!.y).toBe(0);
    expect(r.strokes[3]![0]!.y).toBe(10);
  });

  it('残りが 1 点（長さ 0 の区間）なら捨てる／1 点ストロークに当たれば消える', () => {
    // 右端の 1 点だけを消しゴムの外に残す: 残りの区間はほぼ長さ 0 → 捨てる
    const s: Stroke = [pt(0, 0), pt(10, 0), pt(20, 0)];
    const r = eraseSegments([s], [pen], [pt(10, 0)], 9.8);
    expect(r.changed).toBe(true);
    expect(r.strokes).toHaveLength(0);
    expect(r.styles).toHaveLength(0);
    expect(eraseStroke([pt(5, 5)], [pt(6, 6)], 4)).toEqual([]);
    expect(eraseStroke([pt(5, 5)], [pt(60, 60)], 4)).toBeNull();
  });

  it('全部覆えば消える', () => {
    const r = eraseSegments([hline(3)], [pen], [pt(-10, 0), pt(40, 0)], 20);
    expect(r.strokes).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* グリッド                                                             */
/* ------------------------------------------------------------------ */

describe('grid（純関数）', () => {
  it('旧形式を変換し、不正値は none', () => {
    expect(normalizeGrid('thirds')).toEqual({ kind: 'divide', n: 3 });
    expect(normalizeGrid('quarters')).toEqual({ kind: 'divide', n: 4 });
    expect(normalizeGrid('none')).toBe('none');
    expect(normalizeGrid({ kind: 'divide', n: 5 as 4 })).toBe('none');
    expect(normalizeGrid({ kind: 'pitch', px: 50 })).toEqual({ kind: 'pitch', px: 50 });
    expect(sameGrid('thirds', { kind: 'divide', n: 3 })).toBe(true);
    expect(sameGrid({ kind: 'pitch', px: 25 }, { kind: 'pitch', px: 50 })).toBe(false);
  });

  it('divide: n-1 本ずつ、DPR 込みの整数 + 0.5', () => {
    const g = gridLines({ kind: 'divide', n: 4 }, 400, 300, 2);
    expect(g.xs).toEqual([200.5, 400.5, 600.5]);
    expect(g.ys).toEqual([150.5, 300.5, 450.5]);
    expect(gridLines({ kind: 'divide', n: 8 }, 400, 300, 1).xs).toHaveLength(7);
  });

  it('pitch: 左上原点の等間隔、端ちょうどは引かない', () => {
    const g = gridLines({ kind: 'pitch', px: 100 }, 400, 250, 1.5);
    expect(g.xs).toEqual([150.5, 300.5, 450.5]);
    expect(g.ys).toEqual([150.5, 300.5]);
    expect(gridLines('none', 400, 300, 1)).toEqual({ xs: [], ys: [] });
  });
});

/* ------------------------------------------------------------------ */
/* エンジン（偽 DOM）                                                   */
/* ------------------------------------------------------------------ */

interface Call {
  name: string;
  args: unknown[];
  /** 呼び出し時点の setTransform / transform の記録 */
  state: Record<string, unknown>;
}
interface FakeCanvas {
  width: number;
  height: number;
  style: Record<string, string>;
  calls: Call[];
  props: Record<string | symbol, unknown>;
  listeners: Map<string, (e: unknown) => void>;
  getContext(): unknown;
  addEventListener(n: string, f: (e: unknown) => void): void;
  removeEventListener(): void;
  remove(): void;
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
    props,
    listeners,
    getContext: () => ctx,
    addEventListener(n, f) {
      listeners.set(n, f);
    },
    removeEventListener() {},
    remove() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }),
    toBlob(cb, type) {
      cb(new Blob(['x'], { type: type ?? 'image/png' }));
    },
  };
  canvases.push(c);
  return c;
}

const host = () => ({ clientWidth: 400, clientHeight: 300, style: {}, appendChild() {} }) as unknown as HTMLElement;
const count = (c: FakeCanvas, name: string) => c.calls.filter((x) => x.name === name).length;
function flush(): void {
  for (let i = 0; i < 10 && rafQueue.size > 0; i++) {
    const q = [...rafQueue.values()];
    rafQueue.clear();
    for (const cb of q) cb(0);
  }
}

let ts = 0;
function pe(x: number, y: number, pressure = 0.5) {
  ts += 10;
  return { pointerId: 1, pointerType: 'pen', button: 0, clientX: x, clientY: y, pressure, timeStamp: ts, preventDefault() {} };
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

describe('エンジン: ペン設定', () => {
  it('setPen / getPen: 既定は pen、範囲外は丸め、プリセットごとに size/opacity を覚える、toolchange を出す', () => {
    const e = createCanvasEngine();
    expect(e.getPen()).toEqual({ preset: 'pen', size: 3, opacity: 1 });
    let n = 0;
    const off = e.on('toolchange', () => n++);
    e.setPen({ size: 100 });
    expect(e.getPen().size).toBe(16);
    e.setPen({ preset: 'marker' });
    expect(e.getPen()).toEqual({ preset: 'marker', size: 10, opacity: 0.45 });
    e.setPen({ opacity: 0.01 });
    expect(e.getPen().opacity).toBe(0.1);
    e.setPen({ preset: 'pen' });
    expect(e.getPen()).toEqual({ preset: 'pen', size: 16, opacity: 1 });
    e.setPen({ preset: 'marker', size: 12 });
    expect(e.getPen()).toEqual({ preset: 'marker', size: 12, opacity: 0.1 });
    const before = n;
    e.setPen({ size: 12 }); // 変化なし → 通知なし
    expect(n).toBe(before);
    e.setPen({ color: '#c8553d' });
    expect(e.getPen().color).toBe('#C8553D');
    e.setPen({ color: 'bad' }); // 不正は無視
    expect(e.getPen().color).toBe('#C8553D');
    e.setPen({ preset: 'pencil' }); // 色はプリセット共通
    expect(e.getPen().color).toBe('#C8553D');
    e.setPen({ color: undefined });
    expect('color' in e.getPen()).toBe(false);
    off();
    const k = n;
    e.setPen({ size: 5 });
    expect(n).toBe(k);
  });

  it('setEraser / getEraser: 既定は stroke・半径 12、4..40 に丸め、toolchange', () => {
    const e = createCanvasEngine();
    expect(e.getEraser()).toEqual({ mode: 'stroke', size: 12 });
    let n = 0;
    e.on('toolchange', () => n++);
    e.setEraser({ mode: 'partial', size: 1 });
    expect(e.getEraser()).toEqual({ mode: 'partial', size: 4 });
    e.setEraser({ size: 400 });
    expect(e.getEraser().size).toBe(40);
    expect(n).toBe(2);
  });

  it('描いた線は描いたときのペン設定を持つ（getStyles は getStrokes と同じ長さ）', () => {
    const e = createCanvasEngine();
    e.attach(host());
    const main = canvases[0]!;
    e.setPen({ preset: 'brush', color: '#3e7ec8' });
    drag(main, [[10, 10], [20, 12], [30, 15], [40, 20]]);
    e.setPen({ preset: 'marker' });
    drag(main, [[10, 100], [60, 100], [110, 100]]);
    expect(e.getStrokes()).toHaveLength(2);
    expect(e.getStyles()).toEqual([
      { preset: 'brush', size: 5, opacity: 1, color: '#3E7EC8' },
      { preset: 'marker', size: 10, opacity: 0.45, color: '#3E7EC8' },
    ]);
    // 採点用の点列は従来どおり（x,y,p,t だけ）
    expect(Object.keys(e.getStrokes()[0]![0]!).sort()).toEqual(['p', 't', 'x', 'y']);
    // Undo でスタイルもそろって戻る
    e.undo();
    expect(e.getStyles()).toHaveLength(1);
    e.redo();
    expect(e.getStyles()).toHaveLength(2);
  });

  it('loadStrokes(d, styles): 並びをそろえ、省略・不足は undefined、余りは捨てる', () => {
    const e = createCanvasEngine();
    const pen: StrokeStyle = { preset: 'pencil', size: 2, opacity: 0.85 };
    e.loadStrokes([hline(3), hline(3, 20)], [pen]);
    expect(e.getStyles()).toEqual([pen, undefined]);
    e.loadStrokes([hline(3)], [pen, pen, pen]);
    expect(e.getStyles()).toEqual([pen]);
    e.loadStrokes([hline(3)]);
    expect(e.getStyles()).toEqual([undefined]);
    // 返すのはコピー
    e.loadStrokes([hline(3)], [pen]);
    e.getStyles()[0]!.size = 99;
    expect(e.getStyles()[0]!.size).toBe(2);
  });
});

describe('エンジン: 消しゴム', () => {
  function setup() {
    const e = createCanvasEngine();
    e.attach(host());
    const main = canvases[0]!;
    const marker: StrokeStyle = { preset: 'marker', size: 10, opacity: 0.45 };
    e.loadStrokes([hline(21, 100, 0, 10), hline(21, 200, 0, 10)], [marker, undefined]);
    e.setTool('eraser');
    return { e, main, marker };
  }

  it('stroke モード: 触れた線を丸ごと消す（従来）', () => {
    const { e, main } = setup();
    drag(main, [[100, 90], [100, 110]]);
    expect(e.getStrokes()).toHaveLength(1);
    expect(e.getStrokes()[0]![0]!.y).toBe(200);
    expect(e.getStyles()).toEqual([undefined]);
  });

  it('partial モード: なぞった所だけ消えて分かれる。1 回の操作は Undo 1 手', () => {
    const { e, main, marker } = setup();
    e.setEraser({ mode: 'partial', size: 10 });
    const undoBefore = e.canUndo();
    drag(main, [[100, 80], [100, 100], [100, 120], [150, 200]]);
    const s = e.getStrokes();
    expect(s.length).toBe(4);
    expect(e.getStyles()).toEqual([marker, marker, undefined, undefined]);
    expect(s[0]!.at(-1)!.x).toBeCloseTo(90, 3);
    expect(s[1]![0]!.x).toBeCloseTo(110, 3);
    expect(undoBefore).toBe(false);
    e.undo();
    expect(e.getStrokes()).toHaveLength(2);
    expect(e.canUndo()).toBe(false);
  });
});

describe('エンジン: 表示（反転・グリッド）と書き出し', () => {
  it('反転しても絵には反転を掛け、グリッドは画面座標（恒等変換）で描く', () => {
    const e = createCanvasEngine({ grid: { kind: 'pitch', px: 100 } });
    e.attach(host());
    const main = canvases[0]!;
    main.calls.length = 0;
    e.setOptions({ flipped: true });
    const tf = main.calls.filter((c) => c.name === 'transform');
    expect(tf.length).toBeGreaterThan(0);
    expect(tf[0]!.args).toEqual([-1, 0, 0, 1, 400, 0]);
    // 最後の setTransform は恒等（グリッド）→ moveTo は画面座標
    const lastSet = main.calls.filter((c) => c.name === 'setTransform').at(-1)!;
    expect(lastSet.args).toEqual([1, 0, 0, 1, 0, 0]);
    const moves = main.calls.slice(main.calls.indexOf(lastSet)).filter((c) => c.name === 'moveTo');
    expect(moves.map((m) => m.args)).toEqual([
      [100.5, 0],
      [200.5, 0],
      [300.5, 0],
      [0, 100.5],
      [0, 200.5],
    ]);
    expect(main.calls.at(-1)!.name).toBe('stroke');
  });

  it('旧形式の grid も描ける（thirds → 2 本ずつ）', () => {
    const e = createCanvasEngine();
    e.attach(host());
    const main = canvases[0]!;
    main.calls.length = 0;
    e.setOptions({ grid: 'thirds' });
    expect(count(main, 'moveTo')).toBe(4);
    main.calls.length = 0;
    e.setOptions({ grid: { kind: 'divide', n: 3 } }); // 中身が同じなら描き直さない
    expect(main.calls).toHaveLength(0);
  });

  it('marker は別レイヤーから multiply・不透明度で合成、色はストロークの色', () => {
    const e = createCanvasEngine();
    e.attach(host());
    const cache = canvases[1]!;
    const scratch = canvases[3]!;
    cache.calls.length = 0;
    e.loadStrokes([hline(5, 50)], [{ preset: 'marker', size: 10, opacity: 0.45, color: '#3E7EC8' }]);
    const img = cache.calls.find((c) => c.name === 'drawImage')!;
    expect(img.args[0]).toBe(scratch);
    expect(img.state.globalAlpha).toBe(0.45);
    expect(img.state.globalCompositeOperation).toBe('multiply');
    const seg = scratch.calls.find((c) => c.name === 'stroke')!;
    expect(seg.state.strokeStyle).toBe('#3E7EC8');
  });

  it('toWebp は反転を含めず、ペンごとの幅で切り詰める', async () => {
    const e = createCanvasEngine({ flipped: true });
    e.attach(host());
    const styles: StrokeStyle[] = [{ preset: 'brush', size: 16, opacity: 1 }];
    const s = [pt(100, 100, 1), pt(200, 120, 1), pt(300, 150, 1)];
    e.loadStrokes([s], styles);
    await e.toWebp(1024);
    const out = canvases.at(-1)!;
    expect(out.calls.some((c) => c.name === 'transform')).toBe(false);
    const r = cropRect([s], 3, styles)!;
    expect(out.width / out.height).toBeCloseTo(r.width / r.height, 1);
    expect(r.x).toBeLessThan(cropRect([s], 3)!.x);
  });
});
