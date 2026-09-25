/**
 * お絵描き v2 の保存形式まわり（契約 1b の「保存」規則）。
 *
 * - 保存: `Drawing.meta.doc = engine.getDocument()`。レイヤーが 2 枚以上、または stroke 以外の op
 *   （塗りつぶし・変形・削除・レイヤー操作）があるときだけ。それ以外は従来の strokes / strokeStyles / history。
 * - 読み出し: meta.doc の形をざっと確かめてから loadDocument に渡す（壊れていたら使わない）。
 * - 書き出し: toPng の Blob をファイルとしてダウンロードさせる。
 */
import { cropRect, DEFAULT_OPTIONS, isNonInkStyle, type CanvasEngine, type Rect, type StrokeStyle } from '@/canvas';
import type { Drawing } from '@/scoring/types';
import { padRect } from '@/canvas/crop';
import type { CanvasDocument, CanvasOp, Mat, SelectionMask } from './types';

/** 変形のプレビュー中なら確定する（保存・ツール切替の前に） */
export function settleTransform(engine: CanvasEngine): void {
  if (engine.isTransforming()) engine.commitTransform();
}

/** 従来の形式（strokes / history）では表せない文書か */
export function isRichDocument(doc: CanvasDocument): boolean {
  return doc.layers.length >= 2 || doc.ops.some((op) => op.kind !== 'stroke');
}

/** 保存用の文書。従来の形式で足りるときは null */
export function docForSave(engine: CanvasEngine): CanvasDocument | null {
  settleTransform(engine);
  const doc = engine.getDocument();
  return isRichDocument(doc) ? doc : null;
}

/**
 * 紙の大きさが変わったとき（画面の回転・下書きの復元）に、文書の座標を写す。
 * 規則は drillSetup.rescaleMap と同じ「中心合わせ・短辺の比で拡縮」: p' = k·p + o。
 * stroke の点・fill の位置・transform / delete の選択範囲を写し、transform の行列は S·M·S⁻¹
 * （線形部分はそのまま、平行移動成分だけ変わる）。線の太さは変えない（従来の再スケールと同じ）。
 */
export function rescaleDocument(doc: CanvasDocument, from: { width: number; height: number }, to: { width: number; height: number }): CanvasDocument {
  const k = Math.min(to.width, to.height) / Math.max(1, Math.min(from.width, from.height));
  const ox = to.width / 2 - (from.width / 2) * k;
  const oy = to.height / 2 - (from.height / 2) * k;
  const pt = <P extends { x: number; y: number }>(p: P): P => ({ ...p, x: p.x * k + ox, y: p.y * k + oy });
  const mask = (m: SelectionMask): SelectionMask =>
    m.kind === 'rect' ? { ...m, x: m.x * k + ox, y: m.y * k + oy, w: m.w * k, h: m.h * k } : { ...m, points: m.points.map(pt) };
  const ops = doc.ops.map((op): CanvasOp => {
    switch (op.kind) {
      case 'stroke':
        return { ...op, points: op.points.map(pt) };
      case 'fill':
        return { ...op, ...pt({ x: op.x, y: op.y }) };
      case 'delete':
        return { ...op, mask: mask(op.mask) };
      case 'transform': {
        const [a, b, c, d, e, f] = op.matrix;
        const matrix: Mat = [a, b, c, d, k * e + ox - (a * ox + c * oy), k * f + oy - (b * ox + d * oy)];
        return { ...op, mask: mask(op.mask), matrix };
      }
      default:
        return op;
    }
  });
  return { ...doc, width: to.width, height: to.height, ops };
}

/** 描く op（線・塗り・変形・削除）。レイヤーの追加・設定などは含めない */
export function isDrawOp(op: CanvasOp): boolean {
  return op.kind === 'stroke' || op.kind === 'fill' || op.kind === 'transform' || op.kind === 'delete';
}

/**
 * 描く op の数（「このステップで描いたか」の判定用。別のレイヤーに描いても・塗っただけでも増える）。
 * 消しゴム・補助線の線も 1 手に数える（Undo で減る）。
 */
export function drawOpCount(doc: CanvasDocument): number {
  let n = 0;
  for (const op of doc.ops) if (isDrawOp(op)) n += 1;
  return n;
}

/**
 * 何か描いてあるか（白紙の保存・提出を止めるため）。
 * レイヤーを足しただけ・設定を変えただけ・全部消したあとは偽。ペンの線（消しゴム・補助線を除く）か塗りが、
 * 最後の時点で残っているレイヤーにあれば真（レイヤーの削除・結合・複製・消去を順にたどる）。
 * 見えないレイヤーの線も「描いてある」に数える（保存すれば残るため）。
 */
export function hasContent(doc: CanvasDocument): boolean {
  const order: string[] = doc.layers.map((l) => l.id);
  const filled = new Map<string, boolean>(order.map((id) => [id, false]));
  const at = (id: string) => order.indexOf(id);
  for (const op of doc.ops) {
    switch (op.kind) {
      case 'stroke':
        if (filled.has(op.layer) && !isNonInkStyle(op.style) && op.points.length > 0) filled.set(op.layer, true);
        break;
      case 'fill':
        if (filled.has(op.layer)) filled.set(op.layer, true);
        break;
      case 'layer-clear':
        if (filled.has(op.layer)) filled.set(op.layer, false);
        break;
      case 'layer-add':
        if (!filled.has(op.layer.id)) {
          order.splice(Math.max(0, Math.min(order.length, op.index)), 0, op.layer.id);
          filled.set(op.layer.id, false);
        }
        break;
      case 'layer-remove':
        if (filled.has(op.layer) && order.length > 1) {
          order.splice(at(op.layer), 1);
          filled.delete(op.layer);
        }
        break;
      case 'layer-move': {
        const i = at(op.layer);
        if (i >= 0) {
          order.splice(i, 1);
          order.splice(Math.max(0, Math.min(order.length, op.index)), 0, op.layer);
        }
        break;
      }
      case 'layer-merge-down': {
        const i = at(op.layer);
        if (i > 0) {
          const below = order[i - 1]!;
          filled.set(below, filled.get(below) === true || filled.get(op.layer) === true);
          order.splice(i, 1);
          filled.delete(op.layer);
        }
        break;
      }
      case 'layer-duplicate': {
        const i = at(op.layer);
        if (i >= 0 && !filled.has(op.newId)) {
          order.splice(i + 1, 0, op.newId);
          filled.set(op.newId, filled.get(op.layer) === true);
        }
        break;
      }
      default:
        break;
    }
  }
  for (const v of filled.values()) if (v) return true;
  return false;
}

/** 何か描いてあるか（エンジンの今の絵）。変形のプレビュー中でも確定はしない */
export function engineHasContent(engine: Pick<CanvasEngine, 'getDocument'>): boolean {
  return hasContent(engine.getDocument());
}

// ---------------------------------------------------------------------------
// 切り詰め範囲つきの書き出し（ギャラリーの再生を保存画像と同じ範囲・縦横比にするため）
// ---------------------------------------------------------------------------

/** 保存する絵の画像と、その画像が写している範囲（キャンバス CSS px）。meta.contentRect に入れる */
export interface SavedImage {
  image: Blob;
  contentRect?: Rect;
}

function isRect(v: unknown): v is Rect {
  if (!isObj(v)) return false;
  return (
    Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.width) && Number.isFinite(v.height) && Number(v.width) > 0 && Number(v.height) > 0
  );
}

/** meta.contentRect を読む（無い・壊れているときは undefined＝旧データ。再生は推定で合わせる） */
export function readContentRect(meta: Record<string, unknown> | null | undefined): Rect | undefined {
  const r = meta?.contentRect;
  if (!isRect(r)) return undefined;
  return { x: Number(r.x), y: Number(r.y), width: Number(r.width), height: Number(r.height) };
}

/**
 * 文書つきの絵で見せる範囲。保存時の切り詰め範囲（contentRect）があればそれ（画像と同じ範囲）。
 * 無い旧データ: 線の切り詰め範囲が画像と同じ縦横比ならそこ、違えば（塗りが線より広いなど）紙全体を
 * 画像の縦横比に広げて見せる（縦横で倍率が変わって絵が歪まないように）。
 */
export function docSourceRect(
  doc: { width: number; height: number },
  contentRect: Rect | undefined,
  strokes: Drawing,
  imageAspect: number,
  styles?: readonly (StrokeStyle | undefined)[],
): Rect {
  if (contentRect) return contentRect;
  const crop = strokes.length > 0 ? cropRect(strokes, DEFAULT_OPTIONS.baseWidth, styles) : null;
  if (crop && imageAspect > 0 && Math.abs(crop.width / crop.height - imageAspect) / imageAspect < 0.03) return crop;
  if (!(imageAspect > 0)) return { x: 0, y: 0, width: doc.width, height: doc.height };
  // 紙全体を画像の縦横比の箱に収める（中心合わせ）
  const paperAspect = doc.width / Math.max(1, doc.height);
  const width = paperAspect >= imageAspect ? doc.width : doc.height * imageAspect;
  const height = width / imageAspect;
  return { x: (doc.width - width) / 2, y: (doc.height - height) / 2, width, height };
}

/** 画素の不透明な範囲（画素座標）。何も無ければ null */
export function alphaBounds(data: Uint8ClampedArray, w: number, h: number): Rect | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3]! === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, width: x1 + 1 - x0, height: y1 + 1 - y0 };
}

/**
 * 切り詰めの範囲を決める: 不透明な範囲（CSS px）に toWebp と同じ余白（長辺の 8%、最低 24px）を足し、紙の中に収める。
 * 紙より外は紙色で埋まらないので、範囲は紙の中だけにする。
 */
export function paddedContentRect(bounds: Rect, paper: { width: number; height: number }): Rect {
  const r = padRect(bounds);
  const x = Math.max(0, r.x);
  const y = Math.max(0, r.y);
  const x2 = Math.min(Math.max(x + 1, paper.width), r.x + r.width);
  const y2 = Math.min(Math.max(y + 1, paper.height), r.y + r.height);
  return { x, y, width: Math.max(1, x2 - x), height: Math.max(1, y2 - y) };
}

async function blobToImageData(blob: Blob): Promise<{ data: Uint8ClampedArray; width: number; height: number; bmp: ImageBitmap }> {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d');
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
  return { data: img.data, width: bmp.width, height: bmp.height, bmp };
}

function canvasToBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => c.toBlob((b) => resolve(b), type, quality));
}

/**
 * 文書つきの絵（塗り・変形・レイヤー）の保存画像を、範囲（contentRect）が分かる形で作る。
 * エンジンの切り詰め（toWebp）は塗りの画素まで含めて範囲を決めるが、その範囲は外から分からないため、
 * 紙全体を書き出して（透過で範囲を測り、紙色つきで切り抜く）ここで切り詰める。
 * 測れない環境（createImageBitmap が無いなど）では従来の toWebp（範囲なし＝再生は推定）。
 */
export async function exportForSave(engine: CanvasEngine, maxEdge = 1024): Promise<SavedImage> {
  settleTransform(engine);
  const doc = engine.getDocument();
  const paper = { width: doc.width, height: doc.height };
  const canMeasure =
    typeof document !== 'undefined' && typeof createImageBitmap === 'function' && paper.width > 0 && paper.height > 0;
  if (canMeasure) {
    try {
      const long = Math.max(paper.width, paper.height);
      // 範囲を測る（透過・紙全体・等倍）
      const probe = await blobToImageData(await engine.toPng(long, { transparent: true, crop: false }));
      probe.bmp.close();
      const px = alphaBounds(probe.data, probe.width, probe.height);
      if (px) {
        const k = probe.width / paper.width;
        const rect = paddedContentRect({ x: px.x / k, y: px.y / k, width: px.width / k, height: px.height / k }, paper);
        // 切り抜く元（紙色つき・紙全体）。範囲の長辺が maxEdge に届く倍率まで（端末の DPR が上限）
        const full = await engine.toPng(Math.ceil(long * Math.max(1, maxEdge / Math.max(rect.width, rect.height))), { crop: false });
        const bmp = await createImageBitmap(full);
        try {
          const s = bmp.width / paper.width;
          const out = Math.min(s, maxEdge / Math.max(rect.width, rect.height));
          const W = Math.max(1, Math.round(rect.width * out));
          const H = Math.max(1, Math.round(rect.height * out));
          const c = document.createElement('canvas');
          c.width = W;
          c.height = H;
          const ctx = c.getContext('2d');
          if (!ctx) throw new Error('2d');
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(bmp, rect.x * s, rect.y * s, rect.width * s, rect.height * s, 0, 0, W, H);
          const image = (await canvasToBlob(c, 'image/webp', 0.85)) ?? (await canvasToBlob(c, 'image/png'));
          if (image) return { image, contentRect: rect };
        } finally {
          bmp.close();
        }
      }
    } catch {
      // 測れなければ従来の書き出しへ
    }
  }
  return { image: await engine.toWebp(maxEdge) };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * 保存された絵の meta から文書を読む（meta.doc）。無い・壊れているときは undefined。
 * 中身の op の細部はエンジン（loadDocument）が見る。ここでは形だけ確かめる。
 */
export function readDrawingDoc(meta: Record<string, unknown> | null | undefined): CanvasDocument | undefined {
  const raw = meta?.doc;
  if (!isObj(raw)) return undefined;
  if (raw.v !== 2) return undefined;
  if (!(Number(raw.width) > 0) || !(Number(raw.height) > 0)) return undefined;
  if (!Array.isArray(raw.layers) || !Array.isArray(raw.ops) || typeof raw.active !== 'string') return undefined;
  if (!raw.layers.every((l) => isObj(l) && typeof l.id === 'string')) return undefined;
  if (!raw.ops.every((op) => isObj(op) && typeof op.kind === 'string')) return undefined;
  return raw as unknown as CanvasDocument;
}

/**
 * キャンバスを白紙の 1 レイヤーに戻す（ジェスチャーで次のポーズへ進むとき）。
 * 従来の形式で足りる絵なら loadStrokes([])。レイヤー等を使っていたら、1 枚目のレイヤー（設定は既定）だけの
 * 空の文書を loadDocument する（履歴もリセットされる）。
 */
export function resetCanvas(engine: CanvasEngine): void {
  settleTransform(engine);
  engine.setSelection(null);
  const doc = engine.getDocument();
  const first = doc.layers[0];
  if (!isRichDocument(doc) || !first) {
    engine.loadStrokes([]);
    return;
  }
  engine.loadDocument({
    v: 2,
    width: doc.width,
    height: doc.height,
    layers: [{ ...first, visible: true, opacity: 1, locked: false, blend: 'normal' }],
    active: first.id,
    ops: [],
  });
}

/** Blob をファイルとして保存させる（<a download>） */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 書き出しのファイル名: `seichotsu-<種類>-YYYYMMDD-HHMM.png` */
export function exportFileName(kind: string, at: Date = new Date()): string {
  const d = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
  const t = `${pad(at.getHours())}${pad(at.getMinutes())}`;
  return `seichotsu-${kind}-${d}-${t}.png`;
}
