/**
 * 画像の相互変換。
 *
 * `blobToBytes`/`bytesToBlob` は Node にも `Blob` がグローバルに存在するため
 * node 環境（vitest）でもテストできる。一方 `downscaleToWebp` は
 * `createImageBitmap`/Canvas という DOM 依存 API を使うため、ブラウザ専用として
 * ここに隔離し、テスト対象外とする（DESIGN.md §7）。
 */

/** Blob をバイト列に変換する（バックアップの zip 格納用）。 */
export async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

export type SniffedImageType = 'image/webp' | 'image/png' | 'image/jpeg' | 'image/gif';

/**
 * 先頭バイト（マジックナンバー）から画像の型を判定する。分からなければ null。
 * 12 バイトあれば判定できる。
 */
export function sniffImageType(bytes: Uint8Array): SniffedImageType | null {
  const b = bytes;
  // RIFF....WEBP
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return 'image/webp';
  }
  // \x89PNG\r\n\x1a\n
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  // GIF87a / GIF89a
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  return null;
}

/** 画像の型に対応する拡張子（ドットなし）。 */
export function imageExtension(type: SniffedImageType): 'webp' | 'png' | 'jpg' | 'gif' {
  switch (type) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/gif':
      return 'gif';
    default:
      return 'webp';
  }
}

/**
 * バイト列から Blob を復元する（バックアップ復元用）。
 * `type` を省略すると先頭バイトから判定し、分からなければ `image/webp` とする。
 * （Blob は渡したビューの範囲だけをコピーするので、ここで `slice` し直す必要はない）
 */
export function bytesToBlob(bytes: Uint8Array, type?: string): Blob {
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: type ?? sniffImageType(bytes) ?? 'image/webp' });
}

export interface DownscaleOptions {
  /** 長辺の最大ピクセル数。既定 1024px（DESIGN.md §5.2 の B 提出画像と同じ基準）。 */
  maxEdge?: number;
  /** WebP のエンコード品質（0〜1）。 */
  quality?: number;
}

function hasBrowserCanvasApis(): boolean {
  return (
    typeof createImageBitmap === 'function' &&
    (typeof OffscreenCanvas !== 'undefined' || typeof document !== 'undefined')
  );
}

/**
 * EXIF の向きを反映してデコードする。
 * 一部の端末（古い WebView 等）は既定で EXIF 回転を無視するため `imageOrientation: 'from-image'` を明示する。
 * その値を知らない実装はオプションを無視するか TypeError を投げるので、投げた場合だけオプションなしで読み直す。
 */
async function decodeUpright(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch (e) {
    if (e instanceof TypeError) return createImageBitmap(blob);
    throw e;
  }
}

/**
 * 画像 Blob を長辺 `maxEdge` px 以内に縮小し、WebP に変換する。
 * DOM（Canvas 系 API）が無い環境（Node/vitest）では例外を投げる。テスト対象外。
 */
export async function downscaleToWebp(blob: Blob, options: DownscaleOptions = {}): Promise<Blob> {
  if (!hasBrowserCanvasApis()) {
    throw new Error('downscaleToWebp は DOM 環境（ブラウザ）でのみ利用できます。');
  }

  const maxEdge = options.maxEdge ?? 1024;
  const quality = options.quality ?? 0.85;

  const bitmap = await decodeUpright(blob);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  let canvas: OffscreenCanvas | HTMLCanvasElement;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(width, height);
  } else {
    const el = document.createElement('canvas');
    el.width = width;
    el.height = height;
    canvas = el;
  }

  const ctx = canvas.getContext('2d') as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) {
    throw new Error('Canvas 2D コンテキストを取得できませんでした。');
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  if (canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: 'image/webp', quality });
  }

  return new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (result) => {
        if (result) {
          resolve(result);
        } else {
          reject(new Error('WebP への変換に失敗しました。'));
        }
      },
      'image/webp',
      quality,
    );
  });
}
