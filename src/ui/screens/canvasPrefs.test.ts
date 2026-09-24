import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ERASER,
  gridLabel,
  gridSpecOf,
  parseEraserStyle,
  parsePenStyle,
  parseRecentColors,
  pushRecentColor,
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
  it('消しゴム: 既定は部分消し・12、範囲外は丸める', () => {
    expect(parseEraserStyle(undefined)).toEqual(DEFAULT_ERASER);
    expect(DEFAULT_ERASER).toEqual({ mode: 'partial', size: 12 });
    expect(parseEraserStyle({ mode: 'stroke', size: 99 })).toEqual({ mode: 'stroke', size: 40 });
    expect(parseEraserStyle({ mode: 'bad', size: 1 })).toEqual({ mode: 'partial', size: 4 });
  });
  it('直近の任意色: 3 つまで・重複は先頭へ', () => {
    let list = parseRecentColors(['#111111', 'bad', '#222222']);
    expect(list).toEqual(['#111111', '#222222']);
    list = pushRecentColor(list, '#333333');
    list = pushRecentColor(list, '#444444');
    expect(list).toEqual(['#444444', '#333333', '#111111']);
    expect(pushRecentColor(list, '#111111')).toEqual(['#111111', '#444444', '#333333']);
  });
  it('グリッド: キーから GridSpec と名前', () => {
    expect(gridSpecOf('none')).toBe('none');
    expect(gridSpecOf('d6')).toEqual({ kind: 'divide', n: 6 });
    expect(gridSpecOf('p25')).toEqual({ kind: 'pitch', px: 25 });
    expect(gridLabel('d3')).toBe('3分割');
    expect(gridLabel('p100')).toBe('100px の方眼');
  });
});
