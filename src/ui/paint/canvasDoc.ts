/**
 * お絵描き v2 の保存形式まわり（契約 1b の「保存」規則）。
 *
 * - 保存: `Drawing.meta.doc = engine.getDocument()`。レイヤーが 2 枚以上、または stroke 以外の op
 *   （塗りつぶし・変形・削除・レイヤー操作）があるときだけ。それ以外は従来の strokes / strokeStyles / history。
 * - 読み出し: meta.doc の形をざっと確かめてから loadDocument に渡す（壊れていたら使わない）。
 * - 書き出し: toPng の Blob をファイルとしてダウンロードさせる。
 */
import type { CanvasEngine } from '@/canvas';
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

/** 何か描いてあるか（ops が 1 つでもあれば） */
export function hasContent(doc: CanvasDocument): boolean {
  return doc.ops.length > 0;
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
