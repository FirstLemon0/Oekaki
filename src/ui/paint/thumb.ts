/**
 * レイヤーのサムネイルを「描いた範囲」で切り出す（DESIGN_SYSTEM §2「レイヤーパネル」）。
 *
 * エンジンの getLayerThumbnail は紙全体を縮めた透明 PNG を返す。紙の隅に小さく描いただけだと
 * 40px の枠ではほとんど見えないので、UI 側で不透明な画素の外接矩形を求め、余白をつけて正方形に切り出す。
 */

export interface AlphaBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** RGBA の画素列から、アルファが threshold を超える画素の外接矩形。何も無ければ null */
export function alphaBounds(data: ArrayLike<number>, width: number, height: number, threshold = 8): AlphaBox | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if ((data[row + x * 4 + 3] ?? 0) > threshold) {
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

/** 切り出す正方形（中身の外接矩形の長辺 + 余白 12%、最低 minSide px）。画像の外にはみ出してもよい（透明で埋まる） */
export function cropSquare(b: AlphaBox, minSide = 8, pad = 0.12): AlphaBox {
  const side = Math.max(minSide, Math.max(b.w, b.h) * (1 + pad * 2));
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return { x: cx - side / 2, y: cy - side / 2, w: side, h: side };
}

/**
 * 透明 PNG の Blob → 描いた範囲で切り出した size×size の PNG。
 * 中身が無い・画像を読めない環境では元の Blob をそのまま返す。
 */
export async function cropThumbnail(blob: Blob, size: number): Promise<Blob> {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return blob;
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob);
  } catch {
    return blob;
  }
  try {
    const src = document.createElement('canvas');
    src.width = bmp.width;
    src.height = bmp.height;
    const sc = src.getContext('2d', { willReadFrequently: true });
    if (!sc || src.width === 0 || src.height === 0) return blob;
    sc.drawImage(bmp, 0, 0);
    const b = alphaBounds(sc.getImageData(0, 0, src.width, src.height).data, src.width, src.height);
    if (!b) return blob;
    const sq = cropSquare(b);
    const out = document.createElement('canvas');
    out.width = size;
    out.height = size;
    const oc = out.getContext('2d');
    if (!oc) return blob;
    oc.imageSmoothingEnabled = true;
    oc.imageSmoothingQuality = 'high';
    oc.drawImage(src, sq.x, sq.y, sq.w, sq.h, 0, 0, size, size);
    const png = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
    return png ?? blob;
  } finally {
    bmp.close();
  }
}
