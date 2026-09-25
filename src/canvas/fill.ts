/**
 * 塗りつぶし（純関数）。RGBA バイト列（ImageData.data と同じ並び、ストレートアルファ）を相手にする。
 * - floodFillMask: スキャンライン法。種の色から各チャンネルの差の最大が tolerance 以下の、4 近傍でつながった画素
 * - dilateMask: 塗り領域を r px 膨張（線のアンチエイリアスの隙間を埋める）
 * - paintBehind: 塗り領域に色を「下に敷く」（既存の画素を上に重ねる = destination-over）
 */

/** 2 色の差（各チャンネルの差の最大）。両方とも完全に透明なら 0（RGB は意味を持たない）。 */
function diff(d: Uint8ClampedArray, p: number, r: number, g: number, b: number, a: number): number {
  const pa = d[p + 3]!;
  if (pa === 0 && a === 0) return 0;
  return Math.max(Math.abs(d[p]! - r), Math.abs(d[p + 1]! - g), Math.abs(d[p + 2]! - b), Math.abs(pa - a));
}

/**
 * 種 (sx, sy)（整数の画素位置）からつながった同系色の範囲。範囲外なら null。
 * 戻り値は 1 画素 1 バイト（1 = 塗る）。
 */
export function floodFillMask(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  sx: number,
  sy: number,
  tolerance: number,
): Uint8Array | null {
  sx = Math.floor(sx);
  sy = Math.floor(sy);
  if (!(w > 0 && h > 0) || sx < 0 || sy < 0 || sx >= w || sy >= h || data.length < w * h * 4) return null;
  const tol = Math.max(0, Math.min(255, Number.isFinite(tolerance) ? tolerance : 0));
  const s = (sy * w + sx) * 4;
  const r = data[s]!;
  const g = data[s + 1]!;
  const b = data[s + 2]!;
  const a = data[s + 3]!;
  const mask = new Uint8Array(w * h);
  // 同色かどうかは 1 画素 1 回だけ判定する（0 = 未判定, 1 = 塗る, 2 = 境界）
  const seen = new Uint8Array(w * h);
  const ok = (i: number): boolean => {
    const v = seen[i]!;
    if (v !== 0) return v === 1;
    const m = diff(data, i * 4, r, g, b, a) <= tol;
    seen[i] = m ? 1 : 2;
    return m;
  };
  const stack: number[] = [sx, sy];
  while (stack.length > 0) {
    const y = stack.pop()!;
    let x = stack.pop()!;
    const row = y * w;
    if (mask[row + x] || !ok(row + x)) continue;
    while (x > 0 && !mask[row + x - 1] && ok(row + x - 1)) x--;
    let upOpen = false;
    let downOpen = false;
    for (; x < w && !mask[row + x] && ok(row + x); x++) {
      mask[row + x] = 1;
      if (y > 0) {
        const i = row - w + x;
        const hit = !mask[i] && ok(i);
        if (hit && !upOpen) stack.push(x, y - 1);
        upOpen = hit;
      }
      if (y < h - 1) {
        const i = row + w + x;
        const hit = !mask[i] && ok(i);
        if (hit && !downOpen) stack.push(x, y + 1);
        downOpen = hit;
      }
    }
  }
  return mask;
}

/** 8 近傍で r 回膨張（r px の正方形の膨張）。 */
export function dilateMask(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  let cur = mask;
  for (let k = 0; k < Math.max(0, Math.floor(r)); k++) {
    const next = new Uint8Array(cur);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        if (cur[row + x]) continue;
        const x0 = x > 0 ? x - 1 : x;
        const x1 = x < w - 1 ? x + 1 : x;
        const y0 = y > 0 ? y - 1 : y;
        const y1 = y < h - 1 ? y + 1 : y;
        let hit = false;
        for (let yy = y0; yy <= y1 && !hit; yy++) {
          const rr = yy * w;
          for (let xx = x0; xx <= x1; xx++) {
            if (cur[rr + xx]) {
              hit = true;
              break;
            }
          }
        }
        if (hit) next[row + x] = 1;
      }
    }
    cur = next;
  }
  return cur;
}

/** マスクの外接矩形（画素）。空なら null。 */
export function maskBox(mask: Uint8Array, w: number, h: number): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (!mask[row + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/**
 * マスクの画素に不透明な色 rgb を下に敷く（既存の画素 over 色）。dst はストレートアルファの RGBA。
 * 透明な所は色そのもの、半透明な縁は既存の色を上に重ねた色になる。
 */
export function paintBehind(dst: Uint8ClampedArray, mask: Uint8Array, rgb: [number, number, number]): void {
  const [r, g, b] = rgb;
  const n = mask.length;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    const p = i * 4;
    const a = dst[p + 3]! / 255;
    if (a >= 1) continue;
    if (a <= 0) {
      dst[p] = r;
      dst[p + 1] = g;
      dst[p + 2] = b;
      dst[p + 3] = 255;
      continue;
    }
    dst[p] = Math.round(dst[p]! * a + r * (1 - a));
    dst[p + 1] = Math.round(dst[p + 1]! * a + g * (1 - a));
    dst[p + 2] = Math.round(dst[p + 2]! * a + b * (1 - a));
    dst[p + 3] = 255;
  }
}

/** `#RRGGBB` / `#RGB` → [r,g,b]。読めなければ null。 */
export function parseHex(c: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  const v = parseInt(h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function toHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}
