import { describe, expect, it } from 'vitest';
import { hexToHsv, hexToRgb, hsvToHex } from './color';
import {
  apply,
  corners,
  IDENTITY_STATE,
  isIdentityState,
  maskBounds,
  matrixOf,
  MIN_SCALE,
  rotateHandlePos,
  rotationFromPointer,
  scaleFromHandle,
} from './transform';
import { exportFileName, isRichDocument, readDrawingDoc, rescaleDocument } from './canvasDoc';
import { rescaleMap } from '../lesson/drillSetup';
import { engineIndexOfRow, nextLayerName } from './LayerPanel';
import type { CanvasDocument } from './types';

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

describe('color', () => {
  it('HSV → 色', () => {
    expect(hsvToHex({ h: 0, s: 1, v: 1 })).toBe('#ff0000');
    expect(hsvToHex({ h: 120, s: 1, v: 1 })).toBe('#00ff00');
    expect(hsvToHex({ h: 240, s: 1, v: 0.5 })).toBe('#000080');
    expect(hsvToHex({ h: 360, s: 0, v: 1 })).toBe('#ffffff');
    expect(hsvToHex({ h: 30, s: 2, v: -1 })).toBe('#000000');
  });
  it('色 → HSV → 色 で戻る', () => {
    for (const c of ['#7bb661', '#c8553d', '#2b2a28', '#4aa3c9', '#ffffff', '#000000', '#d9a441']) {
      expect(hsvToHex(hexToHsv(c)!)).toBe(c);
    }
  });
  it('無彩色では色相を保つ・読めない色は null', () => {
    expect(hexToHsv('#808080', 200)?.h).toBe(200);
    expect(hexToHsv('#000', 45)).toEqual({ h: 45, s: 0, v: 0 });
    expect(hexToHsv('red')).toBeNull();
    expect(hexToRgb('#ABC')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
  });
});

describe('transform', () => {
  const box = { x: 100, y: 50, w: 200, h: 100 };

  it('外接矩形: 矩形（負の幅も）と投げ縄', () => {
    expect(maskBounds({ kind: 'rect', x: 300, y: 150, w: -200, h: -100 })).toEqual(box);
    expect(
      maskBounds({
        kind: 'lasso',
        points: [
          { x: 120, y: 60 },
          { x: 300, y: 50 },
          { x: 100, y: 150 },
        ],
      }),
    ).toEqual(box);
  });

  it('何もしなければ単位行列', () => {
    expect(isIdentityState(IDENTITY_STATE)).toBe(true);
    const m = matrixOf(box, IDENTITY_STATE);
    expect(m.map((v, i) => close(v, [1, 0, 0, 1, 0, 0][i]!))).toEqual([true, true, true, true, true, true]);
  });

  it('移動・反転・回転は中心を基準にする', () => {
    const moved = apply(matrixOf(box, { ...IDENTITY_STATE, tx: 10, ty: -5 }), { x: 100, y: 50 });
    expect(moved).toEqual({ x: 110, y: 45 });
    // 左右反転: 左上の角は右上へ
    const flipped = apply(matrixOf(box, { ...IDENTITY_STATE, flipX: true }), { x: 100, y: 50 });
    expect(close(flipped.x, 300) && close(flipped.y, 50)).toBe(true);
    // 90° 回転: 中心 (200,100) の右 100 は下 100 へ
    const rot = apply(matrixOf(box, { ...IDENTITY_STATE, rot: 90 }), { x: 300, y: 100 });
    expect(close(rot.x, 200) && close(rot.y, 200)).toBe(true);
    // 2 倍: 左上の角は中心から 2 倍の位置
    const c = corners(box, { ...IDENTITY_STATE, sx: 2, sy: 2 });
    expect(close(c[0]!.x, 0) && close(c[0]!.y, 0) && close(c[2]!.x, 400) && close(c[2]!.y, 200)).toBe(true);
  });

  it('ハンドル: 角は縦横比を保ち、辺は片方向だけ。下限あり', () => {
    const corner = scaleFromHandle(box, IDENTITY_STATE, { hx: 1, hy: 1 }, { x: 400, y: 200 });
    expect(close(corner.sx, 2) && close(corner.sy, 2)).toBe(true);
    const edge = scaleFromHandle(box, IDENTITY_STATE, { hx: 1, hy: 0 }, { x: 350, y: 999 });
    expect(close(edge.sx, 1.5) && edge.sy === 1).toBe(true);
    const tiny = scaleFromHandle(box, IDENTITY_STATE, { hx: 0, hy: -1 }, { x: 200, y: 100 });
    expect(tiny.sy).toBe(MIN_SCALE);
  });

  it('回転ハンドル: 真上が 0°、右が 90°、15° に吸着', () => {
    const top = rotateHandlePos(box, IDENTITY_STATE, 40);
    expect(close(top.x, 200) && close(top.y, 10)).toBe(true);
    expect(rotationFromPointer(box, IDENTITY_STATE, { x: 200, y: 0 })).toBe(0);
    expect(rotationFromPointer(box, IDENTITY_STATE, { x: 400, y: 100 })).toBe(90);
    expect(rotationFromPointer(box, IDENTITY_STATE, { x: 200, y: 300 })).toBe(180);
    // 46° 付近は 45° に吸着
    const a = (46 * Math.PI) / 180;
    expect(rotationFromPointer(box, IDENTITY_STATE, { x: 200 + 100 * Math.sin(a), y: 100 - 100 * Math.cos(a) })).toBe(45);
    // 回転した後のハンドルは回転方向へ
    const r = rotateHandlePos(box, { ...IDENTITY_STATE, rot: 90 }, 40);
    expect(close(r.x, 290) && close(r.y, 100)).toBe(true);
  });
});

describe('canvasDoc', () => {
  const layer = { id: 'L1', name: 'レイヤー 1', visible: true, opacity: 1, locked: false, blend: 'normal' as const };
  const doc: CanvasDocument = {
    v: 2,
    width: 800,
    height: 600,
    layers: [layer],
    active: 'L1',
    ops: [{ kind: 'stroke', layer: 'L1', points: [{ x: 1, y: 2, p: 0.5, t: 0 }], style: { preset: 'pen', size: 3, opacity: 1 } }],
  };

  it('保存に文書が要るのは、レイヤー 2 枚以上か stroke 以外の op があるときだけ', () => {
    expect(isRichDocument(doc)).toBe(false);
    expect(isRichDocument({ ...doc, layers: [layer, { ...layer, id: 'L2' }] })).toBe(true);
    expect(isRichDocument({ ...doc, ops: [...doc.ops, { kind: 'fill', layer: 'L1', x: 1, y: 1, color: '#000000', tolerance: 32, reference: 'layer' }] })).toBe(true);
  });

  it('meta.doc を読む。壊れていれば undefined', () => {
    expect(readDrawingDoc({ doc })).toEqual(doc);
    expect(readDrawingDoc(undefined)).toBeUndefined();
    expect(readDrawingDoc({ doc: { ...doc, v: 1 } })).toBeUndefined();
    expect(readDrawingDoc({ doc: { ...doc, width: 0 } })).toBeUndefined();
    expect(readDrawingDoc({ doc: { ...doc, ops: 'x' } })).toBeUndefined();
    expect(readDrawingDoc({ doc: { ...doc, layers: [{ name: 'no id' }] } })).toBeUndefined();
    expect(readDrawingDoc({ doc: { ...doc, ops: [{ nope: 1 }] } })).toBeUndefined();
  });

  it('大きさが変わったら文書の座標を写す（rescaleMap と同じ規則、変形は S·M·S⁻¹）', () => {
    const from = { width: 1000, height: 600 };
    const to = { width: 600, height: 1000 };
    const map = rescaleMap(from, to);
    const M: [number, number, number, number, number, number] = [0, 1, -1, 0, 700, -100]; // 90° 回転＋移動
    const src: CanvasDocument = {
      ...doc,
      width: 1000,
      height: 600,
      ops: [
        { kind: 'stroke', layer: 'L1', points: [{ x: 100, y: 200, p: 0.5, t: 3 }], style: { preset: 'pen', size: 3, opacity: 1 } },
        { kind: 'fill', layer: 'L1', x: 500, y: 300, color: '#000000', tolerance: 32, reference: 'layer' },
        { kind: 'transform', layer: 'L1', mask: { kind: 'rect', x: 100, y: 100, w: 200, h: 100 }, matrix: M },
        { kind: 'delete', layer: 'L1', mask: { kind: 'lasso', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }] } },
        { kind: 'layer-set', layer: 'L1', patch: { opacity: 0.5 } },
      ],
    };
    const out = rescaleDocument(src, from, to);
    expect(out.width).toBe(600);
    expect(out.height).toBe(1000);
    const s = out.ops[0] as Extract<CanvasDocument['ops'][number], { kind: 'stroke' }>;
    expect(s.points[0]).toEqual({ ...map({ x: 100, y: 200, p: 0.5, t: 3 }) });
    const f = out.ops[1] as Extract<CanvasDocument['ops'][number], { kind: 'fill' }>;
    expect({ x: f.x, y: f.y }).toEqual({ x: map({ x: 500, y: 300, p: 0, t: 0 }).x, y: map({ x: 500, y: 300, p: 0, t: 0 }).y });
    const t = out.ops[2] as Extract<CanvasDocument['ops'][number], { kind: 'transform' }>;
    const k = 600 / 600;
    expect(t.mask).toMatchObject({ kind: 'rect', w: 200 * k, h: 100 * k });
    // 写した点に写した行列を掛ける ＝ 元の行列を掛けてから写す
    for (const p of [{ x: 120, y: 130 }, { x: 290, y: 190 }]) {
      const a = apply(t.matrix, map({ ...p, p: 0, t: 0 }));
      const b = map({ ...apply(M, p), p: 0, t: 0 });
      expect(close(a.x, b.x) && close(a.y, b.y)).toBe(true);
    }
    expect(out.ops[4]).toEqual(src.ops[4]);
  });

  it('書き出しのファイル名', () => {
    expect(exportFileName('free', new Date(2026, 8, 5, 7, 3))).toBe('seichotsu-free-20260905-0703.png');
  });
});

describe('レイヤーパネル', () => {
  it('新しい名前は「レイヤー n」（最大 + 1、枚数より小さくしない）', () => {
    expect(nextLayerName([{ name: 'レイヤー 1' }])).toBe('レイヤー 2');
    expect(nextLayerName([{ name: 'レイヤー 1' }, { name: 'レイヤー 7' }])).toBe('レイヤー 8');
    expect(nextLayerName([{ name: '下描き' }, { name: '清書' }])).toBe('レイヤー 3');
  });
  it('表示の行（上＝手前）とエンジンの添字（下＝奥）', () => {
    expect(engineIndexOfRow(0, 3)).toBe(2);
    expect(engineIndexOfRow(2, 3)).toBe(0);
  });
});
