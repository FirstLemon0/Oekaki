/**
 * 塗りつぶし（純関数）。RGBA バイト列（ImageData.data と同じ並び、ストレートアルファ）を相手にする。
 * - floodFillMask: スキャンライン法。種の色から各チャンネルの差の最大が tolerance 以下の、4 近傍でつながった画素
 * - dilateMask: 塗り領域を r px 膨張（線のアンチエイリアスの隙間を埋める）。外接矩形 ± r だけ走査
 * - paintBehind: 塗り領域に色を「下に敷く」（既存の画素を上に重ねる = destination-over）
 * - encodeMask / stampMask: 領域の区間表現（エンジンは固定解像度 CSS px × 1 で領域を計算して持ち、拡大して適用する）
 * - bakeOnPaper: 紙色の上での見た目（乗算・スクリーン・不透明度）を透明な画像に焼き込む（結合・サムネイル）
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

/**
 * 8 近傍で r 回膨張（r px の正方形の膨張）。走査するのはマスクの外接矩形 ± r だけ（紙全体を舐めない）。
 * 元の mask は変えない。
 */
export function dilateMask(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const n = Math.max(0, Math.floor(r));
  const box = maskBox(mask, w, h);
  if (n === 0 || !box) return n === 0 ? mask : new Uint8Array(mask);
  let cur = mask;
  let { x0, y0, x1, y1 } = box;
  for (let k = 0; k < n; k++) {
    // 1 回ごとに 1px 広がるので、走査範囲も 1px ずつ広げる
    x0 = Math.max(0, x0 - 1);
    y0 = Math.max(0, y0 - 1);
    x1 = Math.min(w - 1, x1 + 1);
    y1 = Math.min(h - 1, y1 + 1);
    const next = new Uint8Array(cur);
    for (let y = y0; y <= y1; y++) {
      const row = y * w;
      const ya = y > 0 ? y - 1 : y;
      const yb = y < h - 1 ? y + 1 : y;
      for (let x = x0; x <= x1; x++) {
        if (cur[row + x]) continue;
        const xa = x > 0 ? x - 1 : x;
        const xb = x < w - 1 ? x + 1 : x;
        let hit = false;
        for (let yy = ya; yy <= yb && !hit; yy++) {
          const rr = yy * w;
          for (let xx = xa; xx <= xb; xx++) {
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

/**
 * 塗りの領域（固定解像度 = キャンバス座標 CSS px × 1 の画素）を行ごとの区間で持つ。
 * runs は [行頭からの通し番号 start, 長さ len] の組の並び（start = y * w + x）。
 */
export interface FillMask {
  /** 領域を計算したときの紙の大きさ（CSS px） */
  w: number;
  h: number;
  box: { x0: number; y0: number; x1: number; y1: number };
  runs: Int32Array;
  /** 画素数 */
  count: number;
}

/** 1 画素 1 バイトのマスク → 区間表現。空なら null。 */
export function encodeMask(mask: Uint8Array, w: number, h: number): FillMask | null {
  const box = maskBox(mask, w, h);
  if (!box) return null;
  const runs: number[] = [];
  let count = 0;
  for (let y = box.y0; y <= box.y1; y++) {
    const row = y * w;
    let x = box.x0;
    while (x <= box.x1) {
      if (!mask[row + x]) {
        x++;
        continue;
      }
      const s = x;
      while (x <= box.x1 && mask[row + x]) x++;
      runs.push(row + s, x - s);
      count += x - s;
    }
  }
  return { w, h, box, runs: Int32Array.from(runs), count };
}

/**
 * 区間表現を RGBA（外接矩形 + 周囲 1px の透明な縁、ストレートアルファ）に書き出す。
 * 戻り値の画像の (1,1) が box の左上。縁は拡大描画の補間で外の画素を拾わないため。
 */
export function stampMask(m: FillMask, rgb: [number, number, number], out: Uint8ClampedArray, ow: number): void {
  out.fill(0);
  const [r, g, b] = rgb;
  for (let i = 0; i < m.runs.length; i += 2) {
    const start = m.runs[i]!;
    const len = m.runs[i + 1]!;
    const y = Math.floor(start / m.w);
    const x = start - y * m.w;
    let p = ((y - m.box.y0 + 1) * ow + (x - m.box.x0 + 1)) * 4;
    for (let k = 0; k < len; k++, p += 4) {
      out[p] = r;
      out[p + 1] = g;
      out[p + 2] = b;
      out[p + 3] = 255;
    }
  }
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

/** 紙の上で重ねる 1 枚（bakeOnPaper 用）。data はストレートアルファの RGBA。 */
export interface BakeLayer {
  data: Uint8ClampedArray;
  opacity: number;
  blend: 'normal' | 'multiply' | 'screen';
}

/**
 * 紙色 paper の上に layers（下から）を不透明度・合成込みで重ねた見た目を、
 * 「紙の上にふつうに（source-over で）置けば同じ見た目になる」透明な画像にして out に書く。
 * 結合（mergeDown）とサムネイルで、乗算・スクリーン・不透明度を焼き込むのに使う。
 * 紙より下に別のレイヤーがある場合は、それを紙色とみなした近似になる。
 */
export function bakeOnPaper(out: Uint8ClampedArray, layers: readonly BakeLayer[], paper: readonly [number, number, number]): void {
  const n = out.length >> 2;
  const P0 = paper[0] / 255;
  const P1 = paper[1] / 255;
  const P2 = paper[2] / 255;
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    let t0 = P0;
    let t1 = P1;
    let t2 = P2;
    let al = 0;
    for (const L of layers) {
      const a = (L.data[p + 3]! / 255) * L.opacity;
      if (a <= 0) continue;
      const c0 = L.data[p]! / 255;
      const c1 = L.data[p + 1]! / 255;
      const c2 = L.data[p + 2]! / 255;
      let b0 = c0;
      let b1 = c1;
      let b2 = c2;
      if (L.blend === 'multiply') {
        b0 = t0 * c0;
        b1 = t1 * c1;
        b2 = t2 * c2;
      } else if (L.blend === 'screen') {
        b0 = t0 + c0 - t0 * c0;
        b1 = t1 + c1 - t1 * c1;
        b2 = t2 + c2 - t2 * c2;
      }
      t0 = (1 - a) * t0 + a * b0;
      t1 = (1 - a) * t1 + a * b1;
      t2 = (1 - a) * t2 + a * b2;
      al = al + a - al * a;
    }
    if (al <= 1 / 512) {
      out[p] = 0;
      out[p + 1] = 0;
      out[p + 2] = 0;
      out[p + 3] = 0;
      continue;
    }
    const q = 1 - al;
    out[p] = Math.round(Math.min(1, Math.max(0, (t0 - q * P0) / al)) * 255);
    out[p + 1] = Math.round(Math.min(1, Math.max(0, (t1 - q * P1) / al)) * 255);
    out[p + 2] = Math.round(Math.min(1, Math.max(0, (t2 - q * P2) / al)) * 255);
    out[p + 3] = Math.round(al * 255);
  }
}

/** CSS の色（#RGB / #RRGGBB / rgb()/rgba()）→ [r,g,b]。読めなければ null。 */
export function cssRgb(c: string): [number, number, number] | null {
  const hex = parseHex(c);
  if (hex) return hex;
  const m = /^\s*rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(c);
  if (!m) return null;
  const v = [Number(m[1]), Number(m[2]), Number(m[3])];
  return v.every(Number.isFinite) ? [Math.round(v[0]!), Math.round(v[1]!), Math.round(v[2]!)] : null;
}
