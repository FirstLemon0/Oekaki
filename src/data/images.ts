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

/** バイト列から Blob を復元する（バックアップ復元用）。 */
export function bytesToBlob(bytes: Uint8Array, type = 'image/webp'): Blob {
  // Uint8Array をそのまま Blob に渡すと、渡した TypedArray の
  // 元になっている ArrayBuffer 全体が参照されてしまう場合があるため、
  // 範囲を明示したコピーを作ってから渡す。
  const copy = bytes.slice();
  return new Blob([copy], { type });
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
 * 画像 Blob を長辺 `maxEdge` px 以内に縮小し、WebP に変換する。
 * DOM（Canvas 系 API）が無い環境（Node/vitest）では例外を投げる。テスト対象外。
 */
export async function downscaleToWebp(blob: Blob, options: DownscaleOptions = {}): Promise<Blob> {
  if (!hasBrowserCanvasApis()) {
    throw new Error('downscaleToWebp は DOM 環境（ブラウザ）でのみ利用できます。');
  }

  const maxEdge = options.maxEdge ?? 1024;
  const quality = options.quality ?? 0.85;

  const bitmap = await createImageBitmap(blob);
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
