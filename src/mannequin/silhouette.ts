/** シルエット画像まわりの純ロジック（ピクセル処理・色の解釈） */

export interface PixelBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** RGBA 配列の不透明部分の外接矩形（なければ null）。threshold は alpha 0〜255。 */
export function alphaBounds(data: ArrayLike<number>, width: number, height: number, threshold = 8): PixelBounds | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** WebGL の readPixels（下から上）を画像の行順（上から下）に並べ替える */
export function flipRows(data: Uint8Array, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  const row = width * 4;
  for (let y = 0; y < height; y++) out.set(data.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  return out;
}

/** 全画素を単色にする（alpha は残す） */
export function tintSolid(data: Uint8ClampedArray, rgb: readonly [number, number, number]): void {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
  }
}

/** premultiplied alpha → straight alpha */
export function unpremultiply(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a > 0 && a < 255) {
      data[i] = Math.min(255, Math.round((data[i]! * 255) / a));
      data[i + 1] = Math.min(255, Math.round((data[i + 1]! * 255) / a));
      data[i + 2] = Math.min(255, Math.round((data[i + 2]! * 255) / a));
    }
  }
}

/** '#7BB661' / '#7b6' / 'rgb(1, 2, 3)' / 'rgba(1,2,3,.5)' を [r,g,b] に。解釈できなければ null */
export function parseCssColor(s: string): [number, number, number] | null {
  const v = s.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) {
    const h = m[1]!;
    return [0, 1, 2].map((k) => parseInt(h[k]! + h[k]!, 16)) as [number, number, number];
  }
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(v);
  if (m) {
    const h = m[1]!;
    return [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16)) as [number, number, number];
  }
  m = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/i.exec(v);
  if (m) return [1, 2, 3].map((k) => Math.max(0, Math.min(255, Math.round(Number(m![k]))))) as [number, number, number];
  return null;
}
