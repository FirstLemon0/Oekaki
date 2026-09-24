import { describe, expect, it } from 'vitest';
import type { Drawing, Stroke, StrokePoint } from '@/scoring/types';
import {
  lineWidth,
  movingAverage,
  normalizePressure,
  quadSegmentAt,
  quadSegments,
  shouldAppend,
  tailSegment,
} from './smooth';
import { distPointToSegment, findHitStrokes, strokeHit } from './hit';
import { UndoStack } from './history';
import { buildReplaySchedule, visibleCounts } from './replay';
import { parseCssVar, resolveColor } from './color';
import { createCanvasEngine } from './engine';

const pt = (x: number, y: number, p = 0.5, t = 0): StrokePoint => ({ x, y, p, t });
const line = (n: number, t0 = 0): Stroke => Array.from({ length: n }, (_, i) => pt(i * 10, 0, 0.5, t0 + i * 10));

describe('smooth', () => {
  it('normalizePressure: 0 と非数は 0.5、1 超は 1', () => {
    expect(normalizePressure(0)).toBe(0.5);
    expect(normalizePressure(undefined)).toBe(0.5);
    expect(normalizePressure(Number.NaN)).toBe(0.5);
    expect(normalizePressure(0.3)).toBe(0.3);
    expect(normalizePressure(1.4)).toBe(1);
  });

  it('lineWidth: 0.5x..1.6x', () => {
    expect(lineWidth(3, 0)).toBeCloseTo(1.5);
    expect(lineWidth(3, 1)).toBeCloseTo(4.8);
    expect(lineWidth(3, 2)).toBeCloseTo(4.8);
  });

  it('shouldAppend: 近すぎる点は捨てる', () => {
    expect(shouldAppend(undefined, { x: 0, y: 0 })).toBe(true);
    expect(shouldAppend({ x: 0, y: 0 }, { x: 0.1, y: 0 })).toBe(false);
    expect(shouldAppend({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(true);
  });

  it('movingAverage: 端点固定、ジグザグをならす、p/t を保つ', () => {
    const zig = [pt(0, 0, 0.1, 0), pt(10, 10, 0.2, 1), pt(20, -10, 0.3, 2), pt(30, 10, 0.4, 3), pt(40, 0, 0.5, 4)];
    const out = movingAverage(zig, 3);
    expect(out[0]).toEqual(zig[0]);
    expect(out[4]).toEqual(zig[4]);
    expect(Math.abs(out[2]!.y)).toBeLessThan(10);
    expect(out[2]!.p).toBe(0.3);
    expect(out[2]!.t).toBe(2);
    expect(movingAverage(zig.slice(0, 2), 3)).toEqual(zig.slice(0, 2));
  });

  it('quadSegmentAt: 中点法（先頭は点 0 から）', () => {
    const pts = [pt(0, 0), pt(10, 0), pt(20, 10), pt(30, 10)];
    expect(quadSegmentAt(pts, 0)).toBeNull();
    expect(quadSegmentAt(pts, 3)).toBeNull();
    const s1 = quadSegmentAt(pts, 1)!;
    expect(s1.from).toEqual({ x: 0, y: 0 });
    expect(s1.ctrl).toEqual({ x: 10, y: 0 });
    expect(s1.to).toEqual({ x: 15, y: 5 });
    const s2 = quadSegmentAt(pts, 2)!;
    expect(s2.from).toEqual(s1.to); // 区間はつながる
    expect(s2.to).toEqual({ x: 25, y: 10 });
  });

  it('tailSegment / quadSegments: 最後の点で終わる', () => {
    const pts = [pt(0, 0), pt(10, 0), pt(20, 10), pt(30, 10)];
    const segs = quadSegments(pts);
    expect(segs).toHaveLength(3);
    expect(segs[2]!.to).toEqual({ x: 30, y: 10 });
    expect(segs[2]!.from).toEqual(segs[1]!.to);
    expect(tailSegment([pt(0, 0), pt(5, 5)])!.from).toEqual({ x: 0, y: 0 });
    expect(tailSegment([pt(0, 0)])).toBeNull();
    expect(quadSegments([pt(1, 1)])).toEqual([]);
  });
});

describe('hit', () => {
  it('distPointToSegment: 内側・端点外側・長さ 0', () => {
    expect(distPointToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(3);
    expect(distPointToSegment({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(5);
    expect(distPointToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(5);
  });

  it('strokeHit: 線幅 + 8px 以内でヒット', () => {
    const s = line(5); // (0,0)..(40,0), p=0.5 → 線幅 3*(0.5+0.55)=3.15
    expect(strokeHit(s, { x: 20, y: 11 }, 3)).toBe(true);
    expect(strokeHit(s, { x: 20, y: 11.2 }, 3)).toBe(false);
    expect(strokeHit(s, { x: 200, y: 0 }, 3)).toBe(false);
    expect(strokeHit([], { x: 0, y: 0 }, 3)).toBe(false);
    expect(strokeHit([pt(0, 0)], { x: 5, y: 5 }, 3)).toBe(true);
  });

  it('findHitStrokes: 当たったものだけ', () => {
    const d: Drawing = [line(3), line(3).map((q) => ({ ...q, y: 100 })), [pt(0, 5)]];
    expect(findHitStrokes(d, { x: 5, y: 2 }, 3)).toEqual([0, 2]);
    expect(findHitStrokes(d, { x: 5, y: 60 }, 3)).toEqual([]);
  });
});

describe('history', () => {
  it('commit/undo/redo', () => {
    const h = new UndoStack<number[]>([]);
    expect(h.canUndo()).toBe(false);
    h.commit([1]);
    h.commit([1, 2]);
    expect(h.undo()).toEqual([1]);
    expect(h.present).toEqual([1]);
    expect(h.canRedo()).toBe(true);
    expect(h.redo()).toEqual([1, 2]);
    expect(h.redo()).toBeUndefined();
    h.undo();
    h.commit([1, 3]); // 分岐すると redo は消える
    expect(h.canRedo()).toBe(false);
    expect(h.undo()).toEqual([1]);
    expect(h.undo()).toEqual([]);
    expect(h.undo()).toBeUndefined();
  });

  it('limit を超えた古い履歴は捨てる', () => {
    const h = new UndoStack(0, 3);
    for (let i = 1; i <= 5; i++) h.commit(i);
    let n = 0;
    while (h.undo() !== undefined) n++;
    expect(n).toBe(3);
    expect(h.present).toBe(2);
  });

  it('reset で履歴を捨てる', () => {
    const h = new UndoStack('a');
    h.commit('b');
    h.reset('z');
    expect(h.present).toBe('z');
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
  });
});

describe('replay schedule', () => {
  it('t に従い、speed で縮め、ストローク間の空きを詰める', () => {
    const d: Drawing = [line(3, 0), line(2, 10_000)];
    const s = buildReplaySchedule(d, { speed: 2 });
    expect(s.times[0]).toEqual([0, 5, 10]);
    // 10020 → 10000 の空きは 400ms に丸めて /2
    expect(s.times[1]).toEqual([210, 215]);
    expect(s.total).toBe(215);
  });

  it('壊れた t（減少・NaN）でも単調', () => {
    const d: Drawing = [[pt(0, 0, 0.5, 100), pt(1, 0, 0.5, 50), pt(2, 0, 0.5, Number.NaN), pt(3, 0, 0.5, 60)]];
    const s = buildReplaySchedule(d, { speed: 0 });
    const row = s.times[0]!;
    for (let i = 1; i < row.length; i++) expect(row[i]!).toBeGreaterThanOrEqual(row[i - 1]!);
  });

  it('visibleCounts', () => {
    const s = buildReplaySchedule([line(3, 0), line(2, 100)], { speed: 1 });
    expect(visibleCounts(s, -1)).toEqual([0, 0]);
    expect(visibleCounts(s, 0)).toEqual([1, 0]);
    expect(visibleCounts(s, 15)).toEqual([2, 0]);
    expect(visibleCounts(s, s.total)).toEqual([3, 2]);
  });
});

describe('color', () => {
  it('parseCssVar / resolveColor', () => {
    expect(parseCssVar('#fff')).toBeNull();
    expect(parseCssVar('var(--color-ink)')).toEqual({ name: '--color-ink', fallback: null });
    expect(parseCssVar('var(--a, #123)')).toEqual({ name: '--a', fallback: '#123' });
    const vars: Record<string, string> = { '--a': ' #abc ' };
    const look = (n: string) => vars[n] ?? '';
    expect(resolveColor('var(--a)', look, '#000')).toBe('#abc');
    expect(resolveColor('var(--b, #111)', look, '#000')).toBe('#111');
    expect(resolveColor('var(--b)', look, '#000')).toBe('#000');
    expect(resolveColor('red', look, '#000')).toBe('red');
  });
});

describe('engine（DOM なし）', () => {
  it('document が無くても作成・操作できる', () => {
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
    const e = createCanvasEngine({ baseWidth: 4 });
    let changes = 0;
    const off = e.on('change', () => changes++);
    e.setTool('eraser');
    e.setOptions({ grid: 'thirds', flipped: true, silhouette: true });
    e.setOverlay({ kind: 'svg', src: '<svg/>', opacity: 0.5 });
    e.setOverlay(null);
    expect(e.size()).toEqual({ width: 0, height: 0 });

    e.loadStrokes([line(3), line(2)]);
    expect(e.getStrokes()).toHaveLength(2);
    expect(e.canUndo()).toBe(false);
    e.clear();
    expect(e.getStrokes()).toEqual([]);
    expect(e.canUndo()).toBe(true);
    e.undo();
    expect(e.getStrokes()).toHaveLength(2);
    e.redo();
    expect(e.getStrokes()).toHaveLength(0);
    expect(changes).toBe(4);
    off();
    e.undo();
    expect(changes).toBe(4);
    e.detach();
  });

  it('getStrokes はコピーを返す', () => {
    const e = createCanvasEngine();
    e.loadStrokes([line(2)]);
    e.getStrokes()[0]![0]!.x = 999;
    expect(e.getStrokes()[0]![0]!.x).toBe(0);
  });

  it('attach 前の replay は即完了、toWebp は reject', async () => {
    const e = createCanvasEngine();
    e.loadStrokes([line(3)]);
    await expect(e.replay({ speed: 1 })).resolves.toBeUndefined();
    e.cancelReplay();
    await expect(e.toWebp(512)).rejects.toThrow();
  });
});
