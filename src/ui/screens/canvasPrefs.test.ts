import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ERASER,
  DEFAULT_FILL,
  gridLabel,
  gridSpecOf,
  parseEraserStyle,
  parseFillPrefs,
  parsePenStyle,
  parseShapeTool,
  parseRecentColors,
  pushRecentColor,
  toleranceFromPercent,
  toleranceToPercent,
} from './canvasPrefs';

describe('canvasPrefs', () => {
  it('ペン設定: 正しい値は範囲に丸めて読む', () => {
    expect(parsePenStyle({ preset: 'brush', size: 30, opacity: 0.04 })).toEqual({ preset: 'brush', size: 16, opacity: 0.1 });
    expect(parsePenStyle({ preset: 'pencil', size: 3.4, opacity: 0.555, color: '#AA3300' })).toEqual({
      preset: 'pencil',
      size: 3,
      opacity: 0.56,
      color: '#aa3300',
    });
  });
  it('ペン設定: 壊れた値は null、壊れた色は捨てる（墨）', () => {
    expect(parsePenStyle(null)).toBeNull();
    expect(parsePenStyle({ preset: 'crayon', size: 3, opacity: 1 })).toBeNull();
    expect(parsePenStyle({ preset: 'pen', size: 'x', opacity: 1 })).toBeNull();
    expect(parsePenStyle({ preset: 'pen', size: 3, opacity: 1, color: 'red' })).toEqual({ preset: 'pen', size: 3, opacity: 1 });
  });
  it('消しゴム: 太さだけ。既定 12、範囲外は丸める、旧形式 {mode,size} は size だけ読む', () => {
    expect(parseEraserStyle(undefined)).toEqual(DEFAULT_ERASER);
    expect(DEFAULT_ERASER).toEqual({ size: 12 });
    expect(parseEraserStyle({ mode: 'stroke', size: 99 })).toEqual({ size: 40 });
    expect(parseEraserStyle({ mode: 'bad', size: 1 })).toEqual({ size: 4 });
    expect(parseEraserStyle({ size: 20.4 })).toEqual({ size: 20 });
    expect(parseEraserStyle({ mode: 'partial' })).toEqual({ size: 12 });
  });
  it('直近の任意色: 6 つまで・重複は先頭へ', () => {
    let list = parseRecentColors(['#111111', 'bad', '#222222']);
    expect(list).toEqual(['#111111', '#222222']);
    for (const c of ['#333333', '#444444', '#555555', '#666666', '#777777']) list = pushRecentColor(list, c);
    expect(list).toEqual(['#777777', '#666666', '#555555', '#444444', '#333333', '#111111']);
    expect(pushRecentColor(list, '#111111')).toEqual(['#111111', '#777777', '#666666', '#555555', '#444444', '#333333']);
  });
  it('塗りつぶし: 許容値は 0..255 に丸め、参照は layer / all。表示は 0..100', () => {
    expect(parseFillPrefs(null)).toEqual(DEFAULT_FILL);
    expect(parseFillPrefs({ tolerance: 400, reference: 'all' })).toEqual({ tolerance: 255, reference: 'all' });
    expect(parseFillPrefs({ tolerance: -3, reference: 'x' })).toEqual({ tolerance: 0, reference: 'layer' });
    expect(toleranceFromPercent(100)).toBe(255);
    expect(toleranceFromPercent(50)).toBe(128);
    expect(toleranceToPercent(32)).toBe(13);
    expect(toleranceToPercent(toleranceFromPercent(40))).toBe(40);
  });
  it('図形: 既定は直線、知らない値も直線', () => {
    expect(parseShapeTool('shape-ellipse')).toBe('shape-ellipse');
    expect(parseShapeTool('circle')).toBe('shape-line');
  });
  it('グリッド: キーから GridSpec と名前', () => {
    expect(gridSpecOf('none')).toBe('none');
    expect(gridSpecOf('d6')).toEqual({ kind: 'divide', n: 6 });
    expect(gridSpecOf('p25')).toEqual({ kind: 'pitch', px: 25 });
    expect(gridLabel('d3')).toBe('3分割');
    expect(gridLabel('p100')).toBe('100px の方眼');
  });
});
