/**
 * キャンバス描画エンジン v2（契約 1 + 契約 1b）。
 * createCanvasEngine() は DOM に触らない。attach(host) で初めて <canvas> を作る。
 *
 * 文書モデル: 「最初のレイヤー一覧（baseList）」＋「操作履歴 ops（CanvasOp）」。すべての編集は op として積み、
 * Undo/Redo は op のまとまり（unit）単位。レイヤー一覧・点列（採点用）・画像はどれも ops の再生で決まる。
 *
 * 表示: レイヤーごとにオフスクリーン canvas（紙の大きさ × DPR、透明背景。キャンバス座標で保持）。
 * 重ね順は 紙色 → レイヤー（下から、visible/opacity/blend）→ 描画中ストローク（アクティブレイヤーに合成）
 *   → 重ね（overlay）→ 選択の点線 → 消しゴムの輪 → グリッド。
 * 画面座標 = DPR × 反転 × ビュー（zoom/pan/rotation）× キャンバス座標。グリッドだけは画面座標に固定。
 *
 * Undo: stroke 以外で画素を書き換える op（fill/transform/delete/clear/merge/remove）の直前（と直後）に、
 * そのレイヤーの画像のスナップショット（チェックポイント）を取る。線だけのレイヤーも CKPT_EVERY 手ごとに取る。
 * レイヤーの任意時点の画像は「その時点以前で最も新しいチェックポイント ＋ それ以降の op の再適用」で作る。
 * チェックポイントは直近 20 op ぶん（かつ合計 192MB まで）。古い所へ戻るときは ops の再適用。
 *
 * 塗りつぶしの領域は、キャンバス座標 × 1 の固定解像度・固定の見た目で計算して op ごとに覚え（maskFor）、
 * 表示・再生・書き出しでは倍率に合わせて拡大して敷く（端末の DPR やテーマで塗りが変わらない）。
 * 拡大表示（zoom > 1）は見えている範囲を表示の倍率で ops から描き直した画像を使う（hires）。
 * 使わなくなった canvas は width = 0 にして手放す（freeLayer）。
 *
 * 旧 API（getStrokes/getStyles/getHistory/loadHistory/setStrokeVisibility/toWebp/replay）は 1 レイヤーなら従来と同じ結果。
 */
import type { Drawing, Stroke, StrokePoint, Vec2 } from '@/scoring/types';
import type {
  CanvasDocument,
  CanvasEngine,
  CanvasOptions,
  EraserStyle,
  FillOptions,
  LayerInfo,
  Mat,
  OverlaySpec,
  PenStyle,
  SelectionMask,
  StrokeHistory,
  StrokeStyle,
  Tool,
  ToPngOptions,
  ToWebpOptions,
  ViewState,
} from './types';
import { normalizePressure, shouldAppend } from './smooth';
import { buildReplaySchedule, visibleCounts, type ReplaySchedule } from './replay';
import { resolveColor } from './color';
import { cropRect, exportScale, inkBounds, padRect, type Rect } from './crop';
import { flattenHistory } from './erase';
import { GRID_COLOR, gridLines, normalizeGrid, sameGrid } from './grid';
import {
  DEFAULT_ERASER,
  DEFAULT_PEN,
  PEN_PRESETS,
  clampEraserSize,
  clampOpacity,
  clampPenSize,
  eraserStrokeStyle,
  guideStrokeStyle,
  isEraserStyle,
  isGuideStyle,
  isPenPreset,
  maxPenWidth,
  needsLayer,
  normalizeHexColor,
  resolvePen,
  sanitizeStyle,
  silhouettePen,
  styleFromPen,
} from './pen';
import { clearLayer, drawRange, drawTail, freeLayer, geom, makeLayer, paintEraser, prep, resizeLayer, type Ctx, type Layer, type Paint, type Xf } from './paint';
import {
  compositeOp,
  copyLayer,
  cutMask,
  drawCut,
  drawDeleteOp,
  drawFillOp,
  drawLayerOnto,
  drawStrokeOp,
  drawTransformOp,
  mergeInto,
  readPixels,
  type FillOp,
  type RasterEnv,
} from './raster';
import {
  DEFAULT_TOLERANCE,
  applyLayerOp,
  copyInfo,
  exportOp,
  isRasterOp,
  layerName,
  newLayerInfo,
  sanitizeDocument,
  sanitizePatch,
  vectorModel,
  visibleInk,
  writesOf,
  type EngineOp,
  type RawHistory,
} from './ops';
import {
  DEFAULT_VIEW,
  IDENTITY,
  apply,
  clampZoom,
  fitViewFor,
  gestureView,
  invert,
  isFiniteMat,
  isIdentity,
  isIdentityView,
  mul,
  normalizeDeg,
  translate,
  twistDeg,
  viewMatrix,
} from './matrix';
import { copyMask, maskBox, maskPolygon, pointInMask, sanitizeMask, transformMask } from './selection';
import { shapeStrokes, type ShapeKind } from './shapes';
import { bakeOnPaper, cssRgb, dilateMask, encodeMask, floodFillMask, toHex, type FillMask } from './fill';

export const DEFAULT_OPTIONS: CanvasOptions = {
  penOnly: false,
  leftHanded: false,
  paperColor: 'var(--color-canvas)',
  inkColor: 'var(--color-ink)',
  baseWidth: 3,
  grid: 'none',
  flipped: false,
  silhouette: false,
  allowMouse: true,
  gestures: true,
};

/** CSS 変数が未定義のときの色（DESIGN_BRIEF_UI: 薄いウォームグレーの紙、墨色） */
const FALLBACK_PAPER = '#f3f0ea';
const FALLBACK_INK = '#2b2926';
/** 補助線の色（--color-ink-2）が未定義のとき */
const FALLBACK_GUIDE = '#5f5b54';
const GUIDE_COLOR_VAR = 'var(--color-ink-2)';
const SILHOUETTE_PAPER = '#ffffff';
const SILHOUETTE_INK = '#000000';
/** ビューを動かしたときの紙の外側 */
const DESK_SHADE = 'rgba(0,0,0,0.10)';
/** 読み込んだ絵の続きを描くときにあける時間（ms） */
const RESUME_GAP_MS = 300;
/** Undo の手数の上限 */
const UNDO_LIMIT = 200;
/** チェックポイントを持つ op の数の上限と、画像の合計バイト数の上限 */
const CKPT_OPS = 20;
const CKPT_BYTES = 192 * 1024 * 1024;
/** 2 本指のひねりをビューの回転とみなす角度（度） */
const TWIST_THRESHOLD = 3;
/** スポイトで透明とみなすアルファ（0..255） */
const PICK_MIN_ALPHA = 8;
/** スポイトで墨（'ink'）とみなす色の差（各チャンネルの最大） */
const PICK_INK_TOLERANCE = 6;
/**
 * 塗りつぶしの領域計算用の固定の見た目（端末・テーマに依存しないように）。
 * 領域はキャンバス座標 × 1 の画素で計算し、膨張は 1px。
 */
const REF_INK = '#2B2A28';
const REF_GUIDE = FALLBACK_GUIDE;
const REF_PAPER: [number, number, number] = [0xf3, 0xf0, 0xea];
const FILL_DILATE = 1;
/** 線だけのレイヤーでも、この本数ごとにチェックポイントを取る（Undo が本数に比例しないように） */
const CKPT_EVERY = 32;
/** 定期チェックポイントをレイヤーごとに何枚残すか */
const PERIODIC_KEEP = 2;
/** 拡大表示の描き直し: ビューが止まってから／中身が変わってから（ms） */
const HIRES_VIEW_DELAY = 150;
const HIRES_CONTENT_DELAY = 16;
/** 拡大表示の描き直しに使う画素数の上限（画面の画素数の倍数） */
const HIRES_MAX_SCREENS = 3;

type Styles = (StrokeStyle | undefined)[];

/** 生の履歴（消しゴム・補助線込み）。strokes と styles は同じ長さ・同じ並び。 */
interface Doc {
  strokes: Drawing;
  styles: Styles;
}

interface LiveInput {
  pointerId: number;
  tool: 'pen' | 'eraser' | 'guide';
  layer: string;
  points: StrokePoint[];
  /** 描画済みの最後の制御点インデックス（0 = まだ何も描いていない） */
  drawnCtrl: number;
  dotDrawn: boolean;
  /** 消しゴムの輪を出す位置（最後の入力位置） */
  lastEraserPt: Vec2 | null;
  /** 消しゴム: レイヤーに消し込んだ点の数 */
  erasedPts: number;
  style: StrokeStyle;
}

interface ShapeInput {
  pointerId: number;
  kind: ShapeKind;
  layer: string;
  a: Vec2;
  b: Vec2;
  t0: number;
  style: StrokeStyle;
}

interface SelectInput {
  pointerId: number;
  mode: 'rect' | 'lasso' | 'move';
  start: Vec2;
  points: Vec2[];
  base: Mat;
}

interface TransformPreview {
  layer: string;
  mask: SelectionMask;
  matrix: Mat;
  /** 選択範囲を透明にしたレイヤー画像（attach 前は null） */
  base: Layer | null;
  /** 切り出した選択範囲 */
  cut: Layer | null;
}

interface Gesture {
  ids: [number, number];
  c1: Vec2;
  c2: Vec2;
  s1: Vec2;
  s2: Vec2;
  base: ViewState;
  rotating: boolean;
}

interface ReplayState {
  schedule: ReplaySchedule;
  /** op の添字 → ストロークの通し番号（stroke 以外は -1） */
  strokeOf: number[];
  /** 次に適用する op */
  opIdx: number;
  start: number;
  /** live レイヤーに途中まで描いている op（-1 = なし）。消しゴムはレイヤーに直接消し込む */
  partial: number;
  /** ペン: 描いた制御点の番号。消しゴム: 消し込んだ点の数 */
  partialCtrl: number;
  partialDot: boolean;
  raf: number;
  resolve: () => void;
}

interface Ckpt {
  id: string;
  /** この画像は ops[0..count) を適用した後のレイヤー */
  count: number;
  /** どの op のために取ったか（古い順に捨てる） */
  owner: number;
  layer: Layer;
  bytes: number;
  /** 線だけのレイヤーで CKPT_EVERY 手ごとに取ったもの（レイヤーごとに新しい PERIODIC_KEEP 枚だけ残す） */
  periodic?: boolean;
}

function strokeBounds(d: Drawing): { width: number; height: number } {
  let w = 0;
  let h = 0;
  for (const s of d) for (const p of s) {
    if (p.x > w) w = p.x;
    if (p.y > h) h = p.y;
  }
  return { width: Math.ceil(w + 16), height: Math.ceil(h + 16) };
}

function copyDrawing(d: Drawing): Drawing {
  return d.map((s) => s.map((p) => ({ x: p.x, y: p.y, p: p.p, t: p.t })));
}

/** getStyles() が返した配列 → その時点の生の履歴（historyOf 用） */
const historyByStyles = new WeakMap<object, Doc>();

function docToHistory(doc: Doc): StrokeHistory {
  return { strokes: copyDrawing(doc.strokes), styles: doc.styles.map(copyStyle) };
}

/**
 * engine.getStyles() が返した配列から、同じ時点の「消しゴムを含む生の履歴」（getHistory() と同じ形のコピー）を得る。
 * getStyles() の戻り値でない（加工した配列など）ときは null。
 */
export function historyOf(styles: readonly unknown[] | null | undefined): StrokeHistory | null {
  if (!styles) return null;
  const doc = historyByStyles.get(styles);
  return doc ? docToHistory(doc) : null;
}

/** 点 q と線分 ab の距離 */
function distToSegment(q: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const L = vx * vx + vy * vy;
  const u = L > 0 ? Math.max(0, Math.min(1, ((q.x - a.x) * vx + (q.y - a.y) * vy) / L)) : 0;
  return Math.hypot(q.x - (a.x + vx * u), q.y - (a.y + vy * u));
}

/** 線分 ab と cd の距離（交わっていれば 0） */
function segDist(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  const cross = (o: Vec2, p: Vec2, q: Vec2) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(distToSegment(a, c, d), distToSegment(b, c, d), distToSegment(c, a, b), distToSegment(d, a, b));
}

function copyStyle(s: StrokeStyle | undefined): StrokeStyle | undefined {
  if (!s) return undefined;
  const out: StrokeStyle = { preset: s.preset, size: s.size, opacity: s.opacity };
  if (s.color) out.color = s.color;
  return out;
}

function toBlobAsync(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      c.toBlob((b) => resolve(b), type, quality);
    } catch {
      resolve(null);
    }
  });
}

export function createCanvasEngine(init?: Partial<CanvasOptions>): CanvasEngine {
  let opts: CanvasOptions = { ...DEFAULT_OPTIONS, ...init };
  let tool: Tool = 'pen';
  let pen: PenStyle = { ...DEFAULT_PEN };
  /** プリセットごとに最後に使った size / opacity */
  const penMemory: Record<string, { size: number; opacity: number }> = {};
  for (const k of Object.keys(PEN_PRESETS) as (keyof typeof PEN_PRESETS)[]) {
    penMemory[k] = { size: PEN_PRESETS[k].size, opacity: PEN_PRESETS[k].opacity };
  }
  let eraser: EraserStyle = { ...DEFAULT_ERASER };
  let fillOpts: FillOptions = { tolerance: DEFAULT_TOLERANCE, reference: 'layer' };
  let view: ViewState = { ...DEFAULT_VIEW };

  // ================= 文書（ops） =================
  const FIRST_ID = 'layer-1';
  let baseList: readonly LayerInfo[] = [newLayerInfo(FIRST_ID, layerName(1))];
  let ops: EngineOp[] = [];
  /** 各 Undo 単位の開始位置（昇順）。units[0] より前は Undo できない */
  let units: number[] = [];
  let redoUnits: EngineOp[][] = [];
  let active = FIRST_ID;
  /** 紙の大きさ（CSS px）。attach 後は画面より小さくならない */
  let docW = 0;
  let docH = 0;
  /** 中身が変わるたびに増やす（メモの鍵） */
  let version = 0;
  let listCache: (readonly LayerInfo[])[] = [baseList];

  function listAt(n: number): readonly LayerInfo[] {
    const m = Math.max(0, Math.min(n, ops.length));
    while (listCache.length <= m) {
      const i = listCache.length;
      listCache.push(applyLayerOp(listCache[i - 1]!, ops[i - 1]!));
    }
    return listCache[m]!;
  }
  const curList = () => listAt(ops.length);
  function touched(from: number): void {
    version++;
    if (listCache.length > from + 1) listCache.length = from + 1;
    // 塗りの領域計算用の画像が、変わった所より先まで進んでいたら捨てる
    if (ref && ref.n > from) freeRef();
    // 拡大表示の描き直しが、変わった所より先まで進んでいたらやり直す（末尾に足しただけなら続きで描く）
    if (hiJob && from < hiJob.job.j) invalidateHires(HIRES_CONTENT_DELAY);
  }

  let modelMemo: { v: number; model: ReturnType<typeof vectorModel> } | null = null;
  function model(): ReturnType<typeof vectorModel> {
    if (!modelMemo || modelMemo.v !== version) modelMemo = { v: version, model: vectorModel(baseList, ops) };
    return modelMemo.model;
  }
  let inkMemo: { v: number; ink: { strokes: Drawing; styles: Styles } } | null = null;
  function ink(): { strokes: Drawing; styles: Styles } {
    if (!inkMemo || inkMemo.v !== version) inkMemo = { v: version, ink: visibleInk(model()) };
    return inkMemo.ink;
  }
  /**
   * アクティブレイヤーの stroke op（getHistory の中身）と、その op の添字。
   * そのレイヤーを最後に空にした op（layer-clear・作り直しの add / duplicate）より後だけ
   * （「全部消す」の後に、消した線が採点・再生に残らないように）。
   */
  let histMemo: { v: number; active: string; doc: Doc; index: Map<number, number> } | null = null;
  function activeHistory(): { doc: Doc; index: Map<number, number> } {
    if (!histMemo || histMemo.v !== version || histMemo.active !== active) {
      const doc: Doc = { strokes: [], styles: [] };
      const index = new Map<number, number>();
      let from = 0;
      for (let j = ops.length - 1; j >= 0; j--) {
        const op = ops[j]!;
        if (
          (op.kind === 'layer-clear' && op.layer === active) ||
          (op.kind === 'layer-add' && op.layer.id === active) ||
          (op.kind === 'layer-duplicate' && op.newId === active)
        ) {
          from = j + 1;
          break;
        }
      }
      for (let j = from; j < ops.length; j++) {
        const op = ops[j]!;
        if (op.kind !== 'stroke' || op.layer !== active) continue;
        index.set(j, doc.strokes.length);
        doc.strokes.push(op.points);
        doc.styles.push(op.style);
      }
      histMemo = { v: version, active, doc, index };
    }
    return histMemo;
  }

  const findLayer = (id: string, list = curList()) => list.find((l) => l.id === id);

  function uniqueId(): string {
    const used = new Set<string>();
    for (const l of baseList) used.add(l.id);
    for (const op of ops) {
      if (op.kind === 'layer-add') used.add(op.layer.id);
      if (op.kind === 'layer-duplicate') used.add(op.newId);
    }
    for (const u of redoUnits) for (const op of u) {
      if (op.kind === 'layer-add') used.add(op.layer.id);
      if (op.kind === 'layer-duplicate') used.add(op.newId);
    }
    let n = used.size + 1;
    while (used.has(`layer-${n}`)) n++;
    return `layer-${n}`;
  }
  function nextLayerNumber(): number {
    let n = 0;
    const scan = (name: string) => {
      const m = /^レイヤー (\d+)$/.exec(name);
      if (m) n = Math.max(n, Number(m[1]));
    };
    for (const l of baseList) scan(l.name);
    for (const op of ops) if (op.kind === 'layer-add') scan(op.layer.name);
    return Math.max(n, curList().length) + 1;
  }

  /** id のレイヤーの画素を最後に作った（add / duplicate）op の添字。最初からあるレイヤーは -1 */
  function creationIndex(id: string, n: number): number {
    for (let j = Math.min(n, ops.length) - 1; j >= 0; j--) {
      const op = ops[j]!;
      if ((op.kind === 'layer-add' && op.layer.id === id) || (op.kind === 'layer-duplicate' && op.newId === id)) {
        if (writesOf(op, listAt(j)).includes(id)) return j;
      }
    }
    return -1;
  }

  /** 最後に画素が空になってから何か書かれたか（clear() の判定用） */
  function hasContent(id: string): boolean {
    for (let j = ops.length - 1; j >= 0; j--) {
      const op = ops[j]!;
      if (!writesOf(op, listAt(j)).includes(id)) continue;
      return !(op.kind === 'layer-clear' || op.kind === 'layer-add');
    }
    return false;
  }

  /** 最後に空になってから stroke 以外の画素 op（塗りつぶし等）があるか（消しゴムの空振り判定用） */
  function hasRasterContent(id: string): boolean {
    for (let j = ops.length - 1; j >= 0; j--) {
      const op = ops[j]!;
      if (!writesOf(op, listAt(j)).includes(id)) continue;
      if (op.kind === 'layer-clear' || op.kind === 'layer-add') return false;
      if (op.kind !== 'stroke') return true;
    }
    return false;
  }

  let overlay: OverlaySpec | null = null;
  let overlayImg: HTMLImageElement | null = null;
  let overlayToken = 0;

  const strokeEndCbs = new Set<(s: Stroke) => void>();
  const changeCbs = new Set<() => void>();
  const toolChangeCbs = new Set<() => void>();
  const layersCbs = new Set<() => void>();
  const viewCbs = new Set<() => void>();
  const selectionCbs = new Set<() => void>();
  const opsCbs = new Set<() => void>();

  // ================= DOM（attach 後のみ） =================
  let host: HTMLElement | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let ctx: Ctx | null = null;
  /** レイヤーごとの表示用画像（今表示している時点の状態） */
  const bms = new Map<string, Layer>();
  /** 表示しているレイヤーの並び（ふつうは curList()、再生中は途中の並び） */
  let dispList: readonly LayerInfo[] = baseList;
  /** 進行中ストローク（入力・再生）・図形のプレビュー */
  let liveLayer: Layer | null = null;
  /** 1 本ずつ合成するための作業用 */
  let scratch: Layer | null = null;
  /** 進行中の線・変形プレビューをレイヤーと合成するための作業用（必要なときだけ作る） */
  let mix: Layer | null = null;
  let ro: ResizeObserver | null = null;
  let dprMql: MediaQueryList | null = null;
  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  let paper = FALLBACK_PAPER;
  let inkColor = FALLBACK_INK;
  let guideInk = FALLBACK_GUIDE;
  let ckpts: Ckpt[] = [];
  /** レイヤーごとの、最後のチェックポイントから積んだ op の数（線だけのレイヤーのチェックポイント用） */
  const sinceCkpt = new Map<string, number>();

  /**
   * 塗りつぶしの領域計算用: 全レイヤーをキャンバス座標 × 1 の固定解像度・固定の見た目で ops[0..n) まで進めた画像
   * （CPU canvas、willReadFrequently）。前へ進めるだけで、戻るときは作り直す。
   */
  interface RefState {
    n: number;
    w: number;
    h: number;
    layers: Map<string, Layer>;
  }
  let ref: RefState | null = null;
  let refScratch: Layer | null = null;
  let refComp: Layer | null = null;
  /** 塗りの型押し用（CPU canvas、使い回す） */
  let stampLayer: Layer | null = null;
  /** fill op → 領域（固定解像度）。op のオブジェクトごとに 1 回だけ計算する（表示・Undo・再生・書き出しで共通） */
  const fillMasks = new WeakMap<object, FillMask | null>();

  /** 拡大表示（zoom > 1）の描き直し: 見えている範囲を表示の倍率で ops から描いたレイヤー画像 */
  interface HiRes {
    key: string;
    k: number;
    /** 描いた範囲（キャンバス座標）と、画素をデバイス画素にそろえるための端数（デバイス px） */
    R: Rect;
    fx: number;
    fy: number;
    W: number;
    H: number;
    layers: Map<string, Layer>;
  }
  let hires: HiRes | null = null;
  let hiLive: Layer | null = null;
  let hiScratch: Layer | null = null;
  let hiTimer: ReturnType<typeof setTimeout> | null = null;
  /** 描き直しの途中（少しずつ進める）。ビュー・中身が変わったら捨てる */
  let hiJob: { h: HiRes; job: RenderJob } | null = null;
  /** シルエット表示の合成用（画面の大きさ） */
  let silTmp: Layer | null = null;

  let live: LiveInput | null = null;
  let shape: ShapeInput | null = null;
  let selIn: SelectInput | null = null;
  let panIn: { pointerId: number; last: Vec2 } | null = null;
  let pickIn: number | null = null;
  /** タッチの塗りつぶしは指を離したときに積む（2 本目の指でジェスチャーに変わったら積まない） */
  let pendingFill: { pointerId: number; op: FillOp } | null = null;
  /** タッチ 1 本の操作を 2 本指のジェスチャーに切り替えるときに、その操作の影響を戻す */
  let singleRevert: (() => void) | null = null;
  const touches = new Map<number, Vec2>();
  let gesture: Gesture | null = null;
  let selection: SelectionMask | null = null;
  let tf: TransformPreview | null = null;
  /** 消しゴム選択中にペン／マウスが紙の上にある位置（輪を出す） */
  let hoverPt: Vec2 | null = null;
  /** live レイヤーに何か描いてあり、合成に使う見た目と、合成先のレイヤー */
  let livePaint: Paint | null = null;
  let liveOn: string | null = null;
  let rafId = 0;
  let fullDirty = false;
  let composeDirty = false;
  let timeOrigin: number | null = null;
  let replayState: ReplayState | null = null;
  /** 表示だけの透明度（getHistory() の添字ごと）。null はすべて 1 */
  let visibility: readonly (number | undefined)[] | null = null;

  const bmW = () => Math.max(1, Math.round(docW * dpr));
  const bmH = () => Math.max(1, Math.round(docH * dpr));

  // ---------- 色・スタイル ----------
  function lookupVar(name: string): string {
    if (typeof getComputedStyle === 'undefined') return '';
    const el = host ?? (typeof document !== 'undefined' ? document.documentElement : null);
    if (!el) return '';
    return getComputedStyle(el).getPropertyValue(name);
  }
  function resolveColors(): void {
    paper = resolveColor(opts.paperColor, lookupVar, FALLBACK_PAPER);
    inkColor = resolveColor(opts.inkColor, lookupVar, FALLBACK_INK);
    guideInk = resolveColor(GUIDE_COLOR_VAR, lookupVar, FALLBACK_GUIDE);
  }
  /** 墨 ink で描く見た目（表示・書き出し・領域計算で墨だけ変える） */
  function paintWith(ink: string, guide: string): (style: StrokeStyle | undefined) => Paint {
    return (style) => {
      if (isGuideStyle(style)) return { color: guide, pen: resolvePen(style, opts.baseWidth) };
      return { color: style?.color ?? ink, pen: resolvePen(style, opts.baseWidth) };
    };
  }
  /** 表示・重ね用（シルエットは合成時に黒くするので、ここではふつうの色） */
  function normalPaint(style: StrokeStyle | undefined): Paint {
    return paintWith(inkColor, guideInk)(style);
  }
  /** 塗りつぶしに使う色（ペンの色、未指定は墨 = 'ink'） */
  function fillColorNow(): string {
    return pen.color ?? 'ink';
  }
  /** 紙色の RGB（結合の焼き込み・サムネイル用） */
  function paperRgb(): [number, number, number] {
    return cssRgb(paper) ?? cssRgb(FALLBACK_PAPER)!;
  }

  // ---------- イベント ----------
  const emit = (set: Set<() => void>) => {
    for (const cb of [...set]) cb();
  };
  const emitChange = () => emit(changeCbs);
  const emitToolChange = () => emit(toolChangeCbs);
  const emitLayers = () => emit(layersCbs);
  const emitView = () => emit(viewCbs);
  const emitSelection = () => emit(selectionCbs);
  const emitOps = () => emit(opsCbs);

  // ================= レイヤー画像の計算 =================
  function visAlpha(j: number): number {
    if (!visibility || replayState) return 1;
    const i = activeHistory().index.get(j);
    if (i === undefined) return 1;
    const v = visibility[i];
    if (v === undefined || !Number.isFinite(v)) return 1;
    return Math.min(1, Math.max(0, v));
  }

  /** 塗りの型押し用の CPU canvas（w×h 以上） */
  function getStamp(w: number, h: number): Layer | null {
    if (!stampLayer || stampLayer.canvas.width < w || stampLayer.canvas.height < h) {
      const nw = Math.max(w, stampLayer?.canvas.width ?? 0);
      const nh = Math.max(h, stampLayer?.canvas.height ?? 0);
      freeLayer(stampLayer);
      stampLayer = makeLayer(nw, nh, { cpu: true });
    }
    return stampLayer;
  }

  function dispEnv(): RasterEnv {
    const w = bmW();
    const h = bmH();
    return {
      xf: { k: dpr, ox: 0, oy: 0 },
      w,
      h,
      paint: normalPaint,
      fillColor: (c) => (c === 'ink' ? inkColor : c),
      scratch,
      make: () => makeLayer(w, h),
      mask: maskFor,
      alpha: visAlpha,
      paper: paperRgb(),
      stamp: getStamp,
    };
  }

  /**
   * op（添字 j）が layer id に及ぼす効果を target に描く。target は op の直前の id の画像。
   * other(id2) は op の直前（時点 j）の別のレイヤーの画像（結合・複製で使う）。
   */
  function execInto(target: Layer, id: string, op: EngineOp, j: number, other: (id2: string) => Layer | null, env: RasterEnv): void {
    switch (op.kind) {
      case 'stroke':
        if (op.layer === id) drawStrokeOp(target, op.points, op.style, env, env.alpha(j));
        return;
      case 'fill':
        if (op.layer === id) drawFillOp(target, env.mask(op, j), env.fillColor(op.color), env);
        return;
      case 'transform':
        if (op.layer === id) drawTransformOp(target, op.mask, op.matrix, env);
        return;
      case 'delete':
        if (op.layer === id) drawDeleteOp(target, op.mask, env);
        return;
      case 'layer-clear':
        if (op.layer === id) clearLayer(target);
        return;
      case 'layer-merge-down': {
        const list = listAt(j);
        const i = list.findIndex((l) => l.id === op.layer);
        if (i <= 0 || list[i - 1]!.id !== id) return;
        mergeInto(target, other(op.layer), list[i - 1]!, list[i]!, env);
        return;
      }
      case 'layer-add':
        if (op.layer.id === id) clearLayer(target);
        return;
      case 'layer-duplicate': {
        if (op.newId !== id) return;
        const src = other(op.layer);
        if (src) copyLayer(target, src);
        else clearLayer(target);
        return;
      }
      default:
        return;
    }
  }

  // ---------- 塗りつぶしの領域（固定解像度） ----------
  function refSize(): { w: number; h: number } {
    let w = docW;
    let h = docH;
    if (!(w > 0 && h > 0)) {
      const b = strokeBounds(ink().strokes);
      w = b.width;
      h = b.height;
    }
    return { w: Math.max(1, Math.ceil(w)), h: Math.max(1, Math.ceil(h)) };
  }
  function freeRef(): void {
    if (ref) for (const l of ref.layers.values()) freeLayer(l);
    ref = null;
    freeLayer(refScratch);
    refScratch = null;
    freeLayer(refComp);
    refComp = null;
  }
  function refEnv(w: number, h: number): RasterEnv {
    if (!refScratch || refScratch.canvas.width !== w || refScratch.canvas.height !== h) {
      freeLayer(refScratch);
      refScratch = makeLayer(w, h, { cpu: true });
    }
    return {
      xf: { k: 1, ox: 0, oy: 0 },
      w,
      h,
      paint: paintWith(REF_INK, REF_GUIDE),
      fillColor: (c) => (c === 'ink' ? REF_INK : c),
      scratch: refScratch,
      make: () => makeLayer(w, h, { cpu: true }),
      mask: maskFor,
      alpha: () => 1,
      paper: REF_PAPER,
      stamp: getStamp,
    };
  }
  /**
   * 領域計算用の画像を時点 j（ops[0..j) 適用後）まで進める。先へ進んでいれば作り直す。
   * deadline（performance.now()）を渡すと、その時刻を過ぎたら途中でやめる（戻り値 false）。
   */
  function ensureRef(j: number, deadline = Infinity): boolean {
    const { w, h } = refSize();
    if (ref && ref.n > j) freeRef();
    if (ref && (ref.w !== w || ref.h !== h)) {
      if (w >= ref.w && h >= ref.h) {
        // 紙が広がった: 左上そろえで広げるだけ（描き直さない）
        for (const l of ref.layers.values()) resizeLayer(l, w, h, true);
        ref.w = w;
        ref.h = h;
      } else freeRef();
    }
    if (!ref) {
      ref = { n: 0, w, h, layers: new Map() };
      for (const l of listAt(0)) {
        const t = makeLayer(w, h, { cpu: true });
        if (t) ref.layers.set(l.id, t);
      }
    }
    const r = ref;
    if (r.n >= j) return true;
    const env = refEnv(w, h);
    while (r.n < j) {
      if (deadline !== Infinity && performance.now() > deadline) return false;
      const jj = r.n;
      const op = ops[jj]!;
      const list = listAt(jj);
      for (const id of writesOf(op, list)) {
        let t = r.layers.get(id);
        if (!t) {
          t = makeLayer(w, h, { cpu: true }) ?? undefined;
          if (!t) continue;
          r.layers.set(id, t);
        }
        execInto(t, id, op, jj, (id2) => r.layers.get(id2) ?? null, env);
      }
      r.n = jj + 1;
      const next = listAt(jj + 1);
      if (next !== list) {
        for (const [id, l] of [...r.layers]) {
          if (!next.some((x) => x.id === id)) {
            freeLayer(l);
            r.layers.delete(id);
          }
        }
      }
    }
    return true;
  }

  /**
   * 塗りつぶしツールを選んでいる間、領域計算用の画像を空き時間に少しずつ今の時点まで進めておく
   * （読み込み直後の最初の塗りで、長い履歴を一度に描かないように）。
   */
  let warmTimer: ReturnType<typeof setTimeout> | null = null;
  function warmRef(): void {
    if (warmTimer !== null || typeof setTimeout === 'undefined' || typeof document === 'undefined') return;
    if (tool !== 'fill' || !ctx) return;
    if (ref && ref.n >= ops.length) return;
    warmTimer = setTimeout(() => {
      warmTimer = null;
      if (tool !== 'fill' || !ctx || live || shape) return;
      const done = ensureRef(ops.length, performance.now() + 8);
      if (!done) warmRef();
    }, 30);
  }
  /**
   * fill op（添字 j）の領域。キャンバス座標 × 1 の固定解像度で、端末の DPR・テーマ・表示（シルエット・薄表示）に
   * 依存せずに計算する。結果は op ごとに覚えておき、表示・Undo・再生・書き出しで同じ領域を拡大して使う。
   */
  function maskFor(op: FillOp, j: number): FillMask | null {
    if (fillMasks.has(op)) return fillMasks.get(op)!;
    ensureRef(j);
    const r = ref;
    if (!r) return null;
    let data: Uint8ClampedArray | null = null;
    if (op.reference === 'all') {
      if (!refComp || refComp.canvas.width !== r.w || refComp.canvas.height !== r.h) {
        freeLayer(refComp);
        refComp = makeLayer(r.w, r.h, { cpu: true });
      }
      if (refComp) {
        clearLayer(refComp);
        for (const l of listAt(j)) {
          const src = r.layers.get(l.id);
          if (src) drawLayerOnto(refComp, src, l);
        }
        data = readPixels(refComp)?.data ?? null;
      }
    } else {
      const src = r.layers.get(op.layer);
      data = src ? (readPixels(src)?.data ?? null) : new Uint8ClampedArray(r.w * r.h * 4);
    }
    let m: FillMask | null = null;
    if (data) {
      const raw = floodFillMask(data, r.w, r.h, op.x, op.y, op.tolerance);
      if (raw) m = encodeMask(dilateMask(raw, r.w, r.h, FILL_DILATE), r.w, r.h);
    }
    fillMasks.set(op, m);
    return m;
  }
  /** まだ領域の無い fill を前から順に計算する（1 回の前進で済ませる） */
  function primeMasks(): void {
    for (let j = 0; j < ops.length; j++) {
      const op = ops[j]!;
      if (op.kind === 'fill' && !fillMasks.has(op) && writesOf(op, listAt(j)).length > 0) maskFor(op, j);
    }
  }

  // ---------- 任意時点のレイヤー画像 ----------
  type Memo = Map<string, { layer: Layer | null; temp: boolean }>;

  /**
   * target に「ops[0..n) を適用した後の id の画像」を描く（チェックポイント＋再適用）。
   * periodic: 表示用の画像を今の時点まで描き直すとき、途中で CKPT_EVERY 手ごとに定期チェックポイントを取る
   * （読み込み直後や古い所への Undo の後も、次の Undo が本数に比例しないように）。
   */
  function renderLayerInto(target: Layer, id: string, n: number, env: RasterEnv, memo: Memo, periodic = false): void {
    const created = creationIndex(id, n);
    let best: Ckpt | null = null;
    for (const c of ckpts) {
      if (c.id !== id || c.count > n || c.count <= created) continue;
      if (!best || c.count > best.count) best = c;
    }
    let start: number;
    if (best) {
      copyLayer(target, best.layer);
      start = best.count;
    } else {
      clearLayer(target);
      start = Math.max(0, created);
    }
    const idx: number[] = [];
    for (let j = start; j < n; j++) if (writesOf(ops[j]!, listAt(j)).includes(id)) idx.push(j);
    let since = 0;
    idx.forEach((j, i) => {
      execInto(target, id, ops[j]!, j, (id2) => layerAtTemp(id2, j, env, memo), env);
      since++;
      // 残すのは新しい PERIODIC_KEEP 枚だけなので、それより前では取らない
      const left = idx.length - 1 - i;
      if (periodic && since >= CKPT_EVERY && left > 0 && left < CKPT_EVERY * PERIODIC_KEEP) {
        saveCkpt(id, j + 1, j, target, true);
        since = 0;
      } else if (since >= CKPT_EVERY) since = 0;
    });
    if (periodic) sinceCkpt.set(id, since);
  }

  /** 結合・複製の相手の、時点 n の画像。ちょうどのチェックポイントがあればそのまま使う（読むだけ）。 */
  function layerAtTemp(id: string, n: number, env: RasterEnv, memo: Memo): Layer | null {
    const key = `${n}\u0000${id}`;
    const hit = memo.get(key);
    if (hit) return hit.layer;
    const created = creationIndex(id, n);
    const exact = ckpts.find((c) => c.id === id && c.count === n && c.count > created);
    if (exact) {
      memo.set(key, { layer: exact.layer, temp: false });
      return exact.layer;
    }
    const t = env.make();
    memo.set(key, { layer: t, temp: true });
    if (t) renderLayerInto(t, id, n, env, memo);
    return t;
  }
  /** 作業用に作った画像を手放す（width = 0） */
  function releaseMemo(memo: Memo): void {
    for (const v of memo.values()) if (v.temp) freeLayer(v.layer);
    memo.clear();
  }

  // ---------- チェックポイント ----------
  function saveCkpt(id: string, count: number, owner: number, src: Layer, periodic = false): void {
    if (periodic && ckpts.some((c) => c.id === id && c.count === count)) {
      sinceCkpt.set(id, 0);
      return;
    }
    const copy = makeLayer(src.canvas.width, src.canvas.height);
    if (!copy) return;
    copy.ctx.drawImage(src.canvas, 0, 0);
    ckpts = ckpts.filter((c) => {
      if (c.id === id && c.count === count) {
        freeLayer(c.layer);
        return false;
      }
      return true;
    });
    ckpts.push({ id, count, owner, layer: copy, bytes: src.canvas.width * src.canvas.height * 4, periodic });
    sinceCkpt.set(id, 0);
    if (periodic) {
      // 定期チェックポイントは新しいものだけ残す（古い所へ戻るときは、そこから描き直す途中でまた取る）
      const mine = ckpts.filter((c) => c.id === id && c.periodic).sort((a, b) => b.count - a.count);
      const old = new Set(mine.slice(PERIODIC_KEEP));
      if (old.size > 0) {
        ckpts = ckpts.filter((c) => {
          if (!old.has(c)) return true;
          freeLayer(c.layer);
          return false;
        });
      }
    }
    evictCkpts();
  }
  /**
   * 上限（op の数・合計バイト数）を超えたら古いものから捨てる。ただしレイヤーごとにいちばん新しいものは
   * 最後まで残す（そのレイヤーの直近の Undo が最初からの描き直しにならないように）。
   */
  function evictCkpts(): void {
    for (;;) {
      const owners = new Set(ckpts.map((c) => c.owner));
      const bytes = ckpts.reduce((s, c) => s + c.bytes, 0);
      if (owners.size <= CKPT_OPS && bytes <= CKPT_BYTES) return;
      if (ckpts.length <= 1) return;
      const latest = new Map<string, Ckpt>();
      for (const c of ckpts) {
        const cur = latest.get(c.id);
        if (!cur || c.count > cur.count) latest.set(c.id, c);
      }
      const protectedSet = new Set(latest.values());
      const pool = ckpts.filter((c) => !protectedSet.has(c));
      const cands = pool.length > 0 ? pool : ckpts;
      let oldest = Infinity;
      for (const c of cands) if (c.owner < oldest) oldest = c.owner;
      const drop = new Set(cands.filter((c) => c.owner === oldest));
      ckpts = ckpts.filter((c) => {
        if (!drop.has(c)) return true;
        freeLayer(c.layer);
        return false;
      });
    }
  }
  function dropCkptsAbove(n: number): void {
    ckpts = ckpts.filter((c) => {
      if (c.count <= n) return true;
      freeLayer(c.layer);
      return false;
    });
    sinceCkpt.clear();
  }
  function dropAllCkpts(): void {
    for (const c of ckpts) freeLayer(c.layer);
    ckpts = [];
    sinceCkpt.clear();
  }

  // ---------- 表示用の画像 ----------
  function ensureBm(id: string): Layer | null {
    let l = bms.get(id);
    if (!l) {
      l = makeLayer(bmW(), bmH()) ?? undefined;
      if (!l) return null;
      bms.set(id, l);
    }
    return l;
  }
  function pruneBms(list: readonly LayerInfo[]): void {
    for (const [id, l] of [...bms]) {
      if (list.some((x) => x.id === id)) continue;
      freeLayer(l);
      bms.delete(id);
    }
  }

  /** 表示中（時点 j）の画像に op を適用する。snapshots: Undo 用のチェックポイントを取る */
  function applyOpDisplay(op: EngineOp, j: number, snapshots: boolean, skipExec = false): void {
    const before = listAt(j);
    if (!ctx) {
      dispList = listAt(j + 1);
      return;
    }
    const writes = writesOf(op, before);
    const snap = snapshots && isRasterOp(op);
    if (snap) {
      const ids = new Set(writes);
      if (op.kind === 'layer-remove' || op.kind === 'layer-merge-down') ids.add(op.layer);
      for (const id of ids) {
        const bm = bms.get(id);
        if (bm) saveCkpt(id, j, j, bm);
      }
    }
    if (!skipExec) {
      const env = dispEnv();
      for (const id of writes) {
        const bm = ensureBm(id);
        if (bm) execInto(bm, id, op, j, (id2) => bms.get(id2) ?? null, env);
      }
    }
    if (snap) {
      for (const id of writes) {
        const bm = bms.get(id);
        if (bm) saveCkpt(id, j + 1, j, bm);
      }
    } else if (snapshots) {
      // 線だけのレイヤーも CKPT_EVERY 手ごとにチェックポイント（古い線の Undo が本数に比例しないように）
      for (const id of writes) {
        const n = (sinceCkpt.get(id) ?? 0) + 1;
        const bm = bms.get(id);
        if (n >= CKPT_EVERY && bm) saveCkpt(id, j + 1, j, bm, true);
        else sinceCkpt.set(id, n);
      }
    }
    // 拡大表示の画像: 線は同じ倍率で描き足す。画素を書き換えるそれ以外の op は描き直す
    if (hires && writes.length > 0 && !replayState) {
      if (op.kind === 'stroke') {
        if (!skipExec) {
          const env = hiresEnv(hires);
          for (const id of writes) {
            const hl = hires.layers.get(id);
            if (hl) execInto(hl, id, op, j, () => null, env);
          }
        }
      } else invalidateHires(HIRES_CONTENT_DELAY);
    }
    dispList = listAt(j + 1);
    if (!replayState) pruneBms(dispList);
  }

  /** 全レイヤーを ops.length の時点に描き直す */
  function rebuildAll(): void {
    if (!ctx) return;
    primeMasks();
    dispList = curList();
    const env = dispEnv();
    const memo: Memo = new Map();
    for (const l of dispList) {
      const bm = ensureBm(l.id);
      if (bm) renderLayerInto(bm, l.id, ops.length, env, memo, !replayState);
    }
    releaseMemo(memo);
    pruneBms(dispList);
    invalidateHires(HIRES_CONTENT_DELAY);
    // なぞっている途中の消しゴムは履歴にまだ無いので、描き直したら消し込み直す
    if (live && live.tool === 'eraser') {
      live.erasedPts = 0;
      eraseLiveIncrement();
    }
  }

  /** 指定したレイヤーだけ ops.length の時点に描き直す */
  function rebuildLayers(ids: Iterable<string>): void {
    if (!ctx) return;
    dispList = curList();
    const env = dispEnv();
    const memo: Memo = new Map();
    for (const id of ids) {
      if (!dispList.some((l) => l.id === id)) continue;
      const bm = ensureBm(id);
      if (bm) renderLayerInto(bm, id, ops.length, env, memo, !replayState);
    }
    releaseMemo(memo);
    pruneBms(dispList);
    invalidateHires(HIRES_CONTENT_DELAY);
  }

  function fullRedraw(): void {
    rebuildAll();
    compose();
  }

  // ================= 合成 =================
  function applyView(c: Ctx): void {
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (opts.flipped) c.transform(-1, 0, 0, 1, cssW, 0);
    if (!isIdentityView(view)) {
      const v = viewMatrix(view);
      c.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
    }
  }

  /** グリッド（画面座標に固定。反転しない）。 */
  function drawGrid(c: Ctx): void {
    if (opts.silhouette) return;
    const spec = normalizeGrid(opts.grid);
    if (spec === 'none') return;
    const { xs, ys } = gridLines(spec, cssW, cssH, dpr);
    if (xs.length === 0 && ys.length === 0) return;
    const W = canvas?.width ?? 0;
    const H = canvas?.height ?? 0;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.strokeStyle = GRID_COLOR;
    c.lineWidth = 1;
    c.beginPath();
    for (const x of xs) {
      c.moveTo(x, 0);
      c.lineTo(x, H);
    }
    for (const y of ys) {
      c.moveTo(0, y);
      c.lineTo(W, y);
    }
    c.stroke();
  }

  function drawOverlay(c: Ctx): void {
    if (!overlay || opts.silhouette || overlay.opacity <= 0) return;
    const a = Math.min(1, Math.max(0, overlay.opacity));
    applyView(c);
    if (overlay.kind === 'strokes') {
      const paint = normalPaint(undefined);
      prep(c, paint.color);
      for (const s of overlay.src as Drawing) {
        c.globalAlpha = a;
        const g = geom(s, paint.pen, true);
        drawRange(c, g, paint.pen, 0, g.pts.length - 2, a);
        drawTail(c, g, paint.pen, a);
      }
    } else if (overlayImg) {
      c.globalAlpha = a;
      const iw = overlayImg.naturalWidth;
      const ih = overlayImg.naturalHeight;
      if (iw > 0 && ih > 0) {
        const k = Math.min(cssW / iw, cssH / ih);
        const w = iw * k;
        const h = ih * k;
        c.drawImage(overlayImg, (cssW - w) / 2, (cssH - h) / 2, w, h);
      } else {
        c.drawImage(overlayImg, 0, 0, cssW, cssH);
      }
    }
    c.globalAlpha = 1;
  }

  /** 選択範囲の点線（白黒 2 重）と、投げ縄の描きかけ */
  function drawSelection(c: Ctx): void {
    if (replayState) return;
    const shown = selection ? (tf ? transformMask(tf.mask, tf.matrix) : selection) : null;
    const lasso = selIn && selIn.mode === 'lasso' && selIn.points.length > 1 ? selIn.points : null;
    if (!shown && !lasso) return;
    applyView(c);
    const px = 1 / Math.max(0.01, view.zoom);
    c.globalAlpha = 1;
    c.lineWidth = px;
    const path = () => {
      c.beginPath();
      if (shown) {
        const poly = maskPolygon(shown);
        poly.forEach((p, i) => (i === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y)));
        c.closePath();
      }
      if (lasso) lasso.forEach((p, i) => (i === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y)));
    };
    c.setLineDash([]);
    c.strokeStyle = '#ffffff';
    path();
    c.stroke();
    c.setLineDash([4 * px, 4 * px]);
    c.strokeStyle = '#000000';
    path();
    c.stroke();
    c.setLineDash([]);
  }

  /** 消しゴムの輪（半径 = size）。なぞっている間と、ペン／マウスが紙の上にある間に出す。 */
  function drawEraserRing(c: Ctx): void {
    const pt = live ? (live.tool === 'eraser' ? live.lastEraserPt : null) : tool === 'eraser' && !replayState ? hoverPt : null;
    if (!pt) return;
    applyView(c);
    c.globalAlpha = 0.45;
    c.strokeStyle = opts.silhouette ? SILHOUETTE_INK : inkColor;
    c.lineWidth = 1 / Math.max(1, dpr) / Math.max(0.01, view.zoom);
    c.beginPath();
    c.arc(pt.x, pt.y, eraser.size, 0, Math.PI * 2);
    c.stroke();
    c.globalAlpha = 1;
  }

  function ensureMix(w: number, h: number): Layer | null {
    if (!mix || mix.canvas.width !== w || mix.canvas.height !== h) {
      freeLayer(mix);
      mix = makeLayer(w, h);
    }
    return mix;
  }

  // ---------- 拡大表示の描き直し（zoom > 1 でもぼやけないように） ----------
  function hiresKey(): string {
    return [view.zoom, view.panX, view.panY, view.rotationDeg, docW, docH, dpr, cssW, cssH].join('|');
  }
  function hiresValid(): HiRes | null {
    return hires && !replayState && hires.key === hiresKey() ? hires : null;
  }
  function dropHires(): void {
    if (hiJob) abortRender(hiJob.job);
    hiJob = null;
    if (hires) for (const l of hires.layers.values()) freeLayer(l);
    hires = null;
    freeLayer(hiLive);
    hiLive = null;
    freeLayer(hiScratch);
    hiScratch = null;
  }
  /** 拡大表示の画像を捨て、必要なら delay ms 後に描き直す */
  function invalidateHires(delay: number): void {
    dropHires();
    if (hiTimer !== null) {
      clearTimeout(hiTimer);
      hiTimer = null;
    }
    if (!ctx || replayState || !(view.zoom > 1.001) || typeof setTimeout === 'undefined') return;
    hiTimer = setTimeout(buildHires, delay);
  }
  function hiresXf(h: HiRes): Xf {
    return { k: h.k, ox: -h.R.x * h.k + h.fx, oy: -h.R.y * h.k + h.fy };
  }
  function hiresEnv(h: HiRes): RasterEnv {
    if (!hiScratch || hiScratch.canvas.width !== h.W || hiScratch.canvas.height !== h.H) {
      freeLayer(hiScratch);
      hiScratch = makeLayer(h.W, h.H);
    }
    return {
      xf: hiresXf(h),
      w: h.W,
      h: h.H,
      paint: normalPaint,
      fillColor: (c) => (c === 'ink' ? inkColor : c),
      scratch: hiScratch,
      make: () => makeLayer(h.W, h.H),
      mask: maskFor,
      alpha: visAlpha,
      paper: paperRgb(),
      stamp: getStamp,
    };
  }
  /** 画面に見えている紙の範囲（キャンバス座標、整数にそろえる）。無ければ null */
  function visibleBox(): Rect | null {
    const inv = invert(viewMatrix(view));
    const cs = [apply(inv, 0, 0), apply(inv, cssW, 0), apply(inv, 0, cssH), apply(inv, cssW, cssH)];
    const x0 = Math.max(0, Math.floor(Math.min(...cs.map((p) => p.x))) - 1);
    const y0 = Math.max(0, Math.floor(Math.min(...cs.map((p) => p.y))) - 1);
    const x1 = Math.min(Math.ceil(docW), Math.ceil(Math.max(...cs.map((p) => p.x))) + 1);
    const y1 = Math.min(Math.ceil(docH), Math.ceil(Math.max(...cs.map((p) => p.y))) + 1);
    if (!(x1 > x0 && y1 > y0)) return null;
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }
  function buildHires(): void {
    hiTimer = null;
    if (!ctx || !canvas || replayState || !(view.zoom > 1.001)) {
      dropHires();
      return;
    }
    // 入力の途中は待つ（途中から live を高解像度に切り替えない）
    if (live || shape || selIn || gesture || panIn || pendingFill) {
      hiTimer = setTimeout(buildHires, HIRES_VIEW_DELAY);
      return;
    }
    const box = visibleBox();
    if (!box) {
      dropHires();
      return;
    }
    const k = dpr * view.zoom;
    const R = regionFor(box, true);
    const W = Math.max(1, Math.ceil(R.width * k) + 1);
    const H = Math.max(1, Math.ceil(R.height * k) + 1);
    if (W * H > HIRES_MAX_SCREENS * canvas.width * canvas.height) {
      dropHires();
      return;
    }
    // 回転していなければ、描く画素をデバイス画素にそろえる（1:1 で置くので補間されない）
    let fx = 0;
    let fy = 0;
    if (normalizeDeg(view.rotationDeg) === 0) {
      const gx = dpr * view.panX + k * R.x;
      const gy = dpr * view.panY + k * R.y;
      fx = gx - Math.floor(gx);
      fy = gy - Math.floor(gy);
    }
    const h: HiRes = { key: hiresKey(), k, R, fx, fy, W, H, layers: new Map() };
    dropHires();
    const job = startRender(W, H, hiresXf(h), { ink: inkColor, display: true });
    if (!job) return;
    hiJob = { h, job };
    stepHires();
  }
  /** 描き直しを 1 フレームぶん（約 10ms）進める。終わったら入れ替えて合成する（長く固まらないように） */
  function stepHires(): void {
    hiTimer = null;
    const b = hiJob;
    if (!b) return;
    if (!ctx || replayState || b.h.key !== hiresKey()) {
      dropHires();
      return;
    }
    if (live || shape || selIn || gesture || panIn || pendingFill) {
      hiTimer = setTimeout(stepHires, HIRES_VIEW_DELAY);
      return;
    }
    if (!stepRender(b.job, performance.now() + 10)) {
      hiTimer = setTimeout(stepHires, 0);
      return;
    }
    hiJob = null;
    freeLayer(b.job.sc);
    b.h.layers = b.job.layers;
    hires = b.h;
    hiLive = makeLayer(b.h.W, b.h.H);
    compose();
  }

  /**
   * 範囲 box を描くのに必要な範囲。変形（transform）はほかの場所から画素を運んでくるので、
   * 後ろから順に、box に入ってくる元の範囲を足していく（紙の外は表示にも無いので紙で切る）。
   */
  function regionFor(box: Rect, clipToPaper: boolean): Rect {
    let x0 = box.x;
    let y0 = box.y;
    let x1 = box.x + box.width;
    let y1 = box.y + box.height;
    const pad = 2;
    for (let j = ops.length - 1; j >= 0; j--) {
      const op = ops[j]!;
      if (op.kind !== 'transform') continue;
      const d = maskBox(transformMask(op.mask, op.matrix));
      const hx0 = Math.max(x0, d.x - pad);
      const hy0 = Math.max(y0, d.y - pad);
      const hx1 = Math.min(x1, d.x + d.w + pad);
      const hy1 = Math.min(y1, d.y + d.h + pad);
      if (!(hx1 > hx0 && hy1 > hy0)) continue;
      const inv = invert(op.matrix);
      const cs = [apply(inv, hx0, hy0), apply(inv, hx1, hy0), apply(inv, hx0, hy1), apply(inv, hx1, hy1)];
      const sb = maskBox(op.mask);
      let sx0 = Math.max(Math.min(...cs.map((p) => p.x)) - pad, sb.x - pad);
      let sy0 = Math.max(Math.min(...cs.map((p) => p.y)) - pad, sb.y - pad);
      let sx1 = Math.min(Math.max(...cs.map((p) => p.x)) + pad, sb.x + sb.w + pad);
      let sy1 = Math.min(Math.max(...cs.map((p) => p.y)) + pad, sb.y + sb.h + pad);
      if (clipToPaper && docW > 0 && docH > 0) {
        sx0 = Math.max(0, sx0);
        sy0 = Math.max(0, sy0);
        sx1 = Math.min(docW, sx1);
        sy1 = Math.min(docH, sy1);
      }
      if (!(sx1 > sx0 && sy1 > sy0)) continue;
      x0 = Math.min(x0, sx0);
      y0 = Math.min(y0, sy0);
      x1 = Math.max(x1, sx1);
      y1 = Math.max(y1, sy1);
    }
    const fx0 = Math.floor(x0);
    const fy0 = Math.floor(y0);
    return { x: fx0, y: fy0, width: Math.max(1, Math.ceil(x1) - fx0), height: Math.max(1, Math.ceil(y1) - fy0) };
  }

  function ensureSilTmp(): Layer | null {
    const w = canvas?.width ?? 0;
    const h = canvas?.height ?? 0;
    if (!silTmp || silTmp.canvas.width !== w || silTmp.canvas.height !== h) {
      freeLayer(silTmp);
      silTmp = makeLayer(w, h);
    }
    return silTmp;
  }

  /**
   * 全層を合成し直す（レイヤー画像は作り直さない）。
   * シルエット: 見えているレイヤー（不透明度込み）の形を画面の大きさの作業用に重ね、黒で塗って白い紙に置く
   * （レイヤー画像は描き直さない）。拡大表示中で描き直しが済んでいれば、その画像を 1:1 で置く。
   */
  function compose(): void {
    if (!ctx || !canvas) return;
    composeDirty = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const sil = opts.silhouette;
    const paperNow = sil ? SILHOUETTE_PAPER : paper;
    ctx.fillStyle = paperNow;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!isIdentityView(view)) {
      // 紙の外側は少し暗く
      ctx.fillStyle = DESK_SHADE;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      applyView(ctx);
      ctx.fillStyle = paperNow;
      ctx.fillRect(0, 0, docW, docH);
    }
    let dst: Ctx = ctx;
    const st = sil ? ensureSilTmp() : null;
    if (st) {
      clearLayer(st);
      dst = st.ctx;
    }
    applyView(dst);
    const hi = hiresValid();
    for (const l of dispList) {
      if (!l.visible) continue;
      const bm = bms.get(l.id);
      if (!bm) continue;
      const withTf = !!tf && tf.layer === l.id && !!tf.base && !!tf.cut;
      const hl = hi && !withTf ? (hi.layers.get(l.id) ?? null) : null;
      const base = hl ?? bm;
      const liveSrc = hl ? hiLive : liveLayer;
      const px = hl ? hi!.R.x - hi!.fx / hi!.k : 0;
      const py = hl ? hi!.R.y - hi!.fy / hi!.k : 0;
      const pw = hl ? hi!.W / hi!.k : docW;
      const ph = hl ? hi!.H / hi!.k : docH;
      const withLive = !!livePaint && !!liveSrc && liveOn === l.id;
      const blend = sil ? 'source-over' : compositeOp(l.blend);
      if (withLive && !withTf && l.opacity >= 1 && blend === 'source-over' && livePaint!.pen.blend === 'source-over') {
        // 完了ストロークの上に進行中の線を不透明度付きで重ねる
        dst.drawImage(base.canvas, px, py, pw, ph);
        dst.globalAlpha = livePaint!.pen.opacity;
        dst.drawImage(liveSrc!.canvas, px, py, pw, ph);
        dst.globalAlpha = 1;
        continue;
      }
      let src: Layer = base;
      if (withTf || withLive) {
        const m = ensureMix(base.canvas.width, base.canvas.height);
        if (m) {
          clearLayer(m);
          if (withTf) {
            m.ctx.drawImage(tf!.base!.canvas, 0, 0);
            drawCut(m, tf!.cut!, tf!.matrix, { k: dpr, ox: 0, oy: 0 });
          } else m.ctx.drawImage(base.canvas, 0, 0);
          if (withLive) {
            // multiply 等は紙ではなくレイヤーの中身にだけ掛ける（確定後と同じ見た目にする）
            m.ctx.globalAlpha = livePaint!.pen.opacity;
            m.ctx.globalCompositeOperation = livePaint!.pen.blend;
            m.ctx.drawImage(liveSrc!.canvas, 0, 0);
            m.ctx.globalAlpha = 1;
            m.ctx.globalCompositeOperation = 'source-over';
          }
          src = m;
        }
      }
      if (l.opacity < 1) dst.globalAlpha = l.opacity;
      if (blend !== 'source-over') dst.globalCompositeOperation = blend;
      dst.drawImage(src.canvas, px, py, pw, ph);
      dst.globalAlpha = 1;
      dst.globalCompositeOperation = 'source-over';
    }
    if (st) {
      const c = st.ctx;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalCompositeOperation = 'source-in';
      c.fillStyle = SILHOUETTE_INK;
      c.fillRect(0, 0, st.canvas.width, st.canvas.height);
      c.globalCompositeOperation = 'source-over';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(st.canvas, 0, 0);
    }
    drawOverlay(ctx);
    drawSelection(ctx);
    drawEraserRing(ctx);
    drawGrid(ctx);
  }

  /** 進行中の消しゴムの、まだ消し込んでいない点をアクティブレイヤーから消す（拡大表示の画像からも）。 */
  function eraseLiveIncrement(): void {
    if (!live || live.tool !== 'eraser') return;
    const bm = bms.get(live.layer);
    if (!bm) return;
    const n = live.points.length;
    if (n <= live.erasedPts) return;
    paintEraser(bm.ctx, live.points, live.style.size, { k: dpr, ox: 0, oy: 0 }, live.erasedPts, n);
    const hi = hiresValid();
    const hl = hi?.layers.get(live.layer);
    if (hi && hl) paintEraser(hl.ctx, live.points, live.style.size, hiresXf(hi), live.erasedPts, n);
    live.erasedPts = n;
    composeDirty = true;
  }

  /** 進行中の線・図形を描く先（live レイヤーと、拡大表示中はその倍率の live） */
  function liveTargets(): { l: Layer; xf: Xf }[] {
    const out: { l: Layer; xf: Xf }[] = [];
    if (liveLayer) out.push({ l: liveLayer, xf: { k: dpr, ox: 0, oy: 0 } });
    const hi = hiresValid();
    if (hi && hiLive) out.push({ l: hiLive, xf: hiresXf(hi) });
    return out;
  }

  /** 進行中のペン入力の新しい区間を live レイヤーに描き足す。描いたら true。 */
  function drawLiveIncrement(): boolean {
    if (!live || live.tool === 'eraser' || !liveLayer || !livePaint) return false;
    const rp = livePaint.pen;
    const n = live.points.length;
    const ready = n - 2;
    if (ready > live.drawnCtrl) {
      if (live.dotDrawn) {
        for (const t of liveTargets()) clearLayer(t.l);
        live.drawnCtrl = 0;
        live.dotDrawn = false;
      }
      const g = geom(live.points, rp, false);
      for (const t of liveTargets()) {
        const c = t.l.ctx;
        c.setTransform(t.xf.k, 0, 0, t.xf.k, t.xf.ox, t.xf.oy);
        prep(c, livePaint.color);
        drawRange(c, g, rp, live.drawnCtrl, ready, 1);
        c.globalAlpha = 1;
      }
      live.drawnCtrl = ready;
      return true;
    }
    if (n >= 1 && live.drawnCtrl === 0 && !live.dotDrawn) {
      // まだ区間が確定していない: 1 点目を点として見せる
      const g = geom(live.points.slice(0, 1), rp, false);
      for (const t of liveTargets()) {
        const c = t.l.ctx;
        c.setTransform(t.xf.k, 0, 0, t.xf.k, t.xf.ox, t.xf.oy);
        prep(c, livePaint.color);
        drawTail(c, g, rp, 1);
        c.globalAlpha = 1;
      }
      live.dotDrawn = true;
      return true;
    }
    return false;
  }

  /** 図形のプレビューを live レイヤーに描く */
  function drawShapePreview(): void {
    if (!shape || !liveLayer || !livePaint) return;
    for (const t of liveTargets()) {
      clearLayer(t.l);
      const c = t.l.ctx;
      for (const s of shapeStrokes(shape.kind, shape.a, shape.b, shape.t0)) {
        const g = geom(s, livePaint.pen, true);
        c.setTransform(t.xf.k, 0, 0, t.xf.k, t.xf.ox, t.xf.oy);
        prep(c, livePaint.color);
        drawRange(c, g, livePaint.pen, 0, g.pts.length - 2, 1);
        drawTail(c, g, livePaint.pen, 1);
        c.globalAlpha = 1;
      }
      c.setTransform(1, 0, 0, 1, 0, 0);
    }
  }

  /** live 系の作業用を全部空にする */
  function clearLive(): void {
    clearLayer(liveLayer);
    clearLayer(hiLive);
  }

  function frame(): void {
    rafId = 0;
    if (!ctx) return;
    if (fullDirty) {
      fullDirty = false;
      fullRedraw();
      return;
    }
    const drew = drawLiveIncrement();
    if (drew || composeDirty) compose();
  }

  function schedule(): void {
    if (rafId || typeof requestAnimationFrame === 'undefined') return;
    rafId = requestAnimationFrame(frame);
  }

  // ---------- サイズ ----------
  /** 解像度（DPR）が変わった・最初の attach: 画像を作り直す（中身は描き直す） */
  function reallocBitmaps(): void {
    const w = bmW();
    const h = bmH();
    for (const l of [...bms.values(), liveLayer, scratch]) {
      if (!l) continue;
      l.canvas.width = w;
      l.canvas.height = h;
    }
    freeLayer(mix);
    mix = null;
    dropAllCkpts();
    dropHires();
    if (tf) cancelTf();
  }

  /**
   * 紙が広がっただけ（画面の回転など）: 画像を左上そろえで広げる。描き直さず、チェックポイントも捨てない
   * （チェックポイントは小さいまま。復元は左上に置くだけで同じ）。
   */
  function growBitmaps(): void {
    const w = bmW();
    const h = bmH();
    for (const l of bms.values()) resizeLayer(l, w, h, true);
    for (const l of [liveLayer, scratch]) if (l) resizeLayer(l, w, h, false);
    freeLayer(mix);
    mix = null;
    dropHires();
  }

  function resize(): void {
    if (!host || !canvas) return;
    const w = host.clientWidth;
    const h = host.clientHeight;
    const nd = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    if (w === cssW && h === cssH && nd === dpr && canvas.width > 0) return;
    cssW = w;
    cssH = h;
    const dprChanged = nd !== dpr;
    dpr = nd;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    const nw = Math.max(docW, w);
    const nh = Math.max(docH, h);
    const grew = nw !== docW || nh !== docH;
    docW = nw;
    docH = nh;
    const first = (liveLayer?.canvas.width ?? 0) === 0;
    if (grew || dprChanged || first) {
      const full = dprChanged || first;
      if (full) reallocBitmaps();
      else growBitmaps();
      if (live && live.tool !== 'eraser') {
        // 大きさが変わると live レイヤーは消えるので描き直す
        live.drawnCtrl = 0;
        live.dotDrawn = false;
        drawLiveIncrement();
      }
      if (shape) drawShapePreview();
      if (replayState) {
        if (full) replayRebuild(replayState);
        compose();
        return;
      }
      if (full) fullRedraw();
      else {
        invalidateHires(HIRES_VIEW_DELAY);
        compose();
      }
      return;
    }
    invalidateHires(HIRES_VIEW_DELAY);
    compose();
  }

  function watchDpr(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    dprMql?.removeEventListener('change', onDprChange);
    dprMql = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    dprMql.addEventListener('change', onDprChange);
  }
  function onDprChange(): void {
    watchDpr();
    resize();
  }

  // ---------- 重ね ----------
  function loadOverlayImage(): void {
    overlayImg = null;
    const o = overlay;
    if (!o || o.kind === 'strokes' || typeof Image === 'undefined' || typeof URL === 'undefined') return;
    const token = ++overlayToken;
    const blob =
      o.kind === 'svg'
        ? new Blob([typeof o.src === 'string' ? o.src : ''], { type: 'image/svg+xml' })
        : o.src instanceof Blob
          ? o.src
          : null;
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (token !== overlayToken) return;
      overlayImg = img;
      compose();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  // ================= 操作の積み下ろし =================
  /** op のまとまりを 1 手として積む（表示にも適用）。skipFirstExec: 先頭 op の画像は描き済み（消しゴム） */
  function pushUnit(unit: EngineOp[], skipFirstExec = false): void {
    if (unit.length === 0) return;
    redoUnits = [];
    const start = ops.length;
    units.push(start);
    const listBefore = curList();
    unit.forEach((op, i) => {
      const j = ops.length;
      ops.push(op);
      touched(j);
      applyOpDisplay(op, j, true, skipFirstExec && i === 0);
    });
    while (units.length > UNDO_LIMIT) units.shift();
    afterOps(listBefore);
  }

  function afterOps(listBefore: readonly LayerInfo[]): void {
    const list = curList();
    let layersChanged = list !== listBefore;
    if (!list.some((l) => l.id === active)) {
      active = list[list.length - 1]!.id;
      layersChanged = true;
    }
    if (tf && !list.some((l) => l.id === tf!.layer)) cancelTf();
    compose();
    emitChange();
    emitOps();
    if (layersChanged) emitLayers();
    warmRef();
  }

  /** 変形プレビュー中なら先に確定する */
  function settleTransform(): void {
    if (tf) engine.commitTransform();
  }

  function activeEditable(): boolean {
    const l = findLayer(active);
    return !!l && !l.locked;
  }

  function cancelTf(): void {
    if (tf) {
      freeLayer(tf.base);
      freeLayer(tf.cut);
    }
    tf = null;
  }

  // ================= 入力 =================
  /** 画面上の位置（反転を戻した CSS px、ビュー適用前） */
  function screenPt(e: { clientX: number; clientY: number }): Vec2 {
    const rect = canvas!.getBoundingClientRect();
    let x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (opts.flipped) x = rect.width - x;
    return { x, y };
  }
  function viewInverse(p: Vec2): Vec2 {
    if (isIdentityView(view)) return p;
    return apply(invert(viewMatrix(view)), p.x, p.y);
  }
  function toPoint(e: { clientX: number; clientY: number }): Vec2 {
    return viewInverse(screenPt(e));
  }

  function allowed(e: PointerEvent): boolean {
    if (e.pointerType === 'mouse' && e.button !== 0) return false;
    if (!opts.penOnly) return true;
    if (e.pointerType === 'pen') return true;
    if (e.pointerType === 'mouse') return opts.allowMouse;
    return false;
  }

  function timeOf(e: { timeStamp: number }): number {
    if (timeOrigin === null) {
      let lastT = -RESUME_GAP_MS;
      for (const op of ops) if (op.kind === 'stroke') for (const p of op.points) if (Number.isFinite(p.t) && p.t > lastT) lastT = p.t;
      timeOrigin = e.timeStamp - (lastT + RESUME_GAP_MS);
    }
    return Math.max(0, e.timeStamp - timeOrigin);
  }

  /**
   * 消しゴムの軌跡（半径 r）が、いま見えている線（ペン、シルエット中は太い線）に届きうるか。
   * 届かない消しゴムは履歴に積まない（何も無い所をなぞっても Undo の手数が増えないように）。
   * 塗りつぶし等の画素があるレイヤーでは常に積む。
   */
  function eraserTouchesInk(pts: readonly StrokePoint[], r: number, layerId: string): boolean {
    if (pts.length === 0) return false;
    if (hasRasterContent(layerId)) return true;
    let ex0 = Infinity;
    let ey0 = Infinity;
    let ex1 = -Infinity;
    let ey1 = -Infinity;
    for (const q of pts) {
      if (q.x < ex0) ex0 = q.x;
      if (q.y < ey0) ey0 = q.y;
      if (q.x > ex1) ex1 = q.x;
      if (q.y > ey1) ey1 = q.y;
    }
    const doc: RawHistory = model().raw.get(layerId) ?? { strokes: [], styles: [] };
    return doc.strokes.some((s, i) => {
      const st = doc.styles[i];
      if (isEraserStyle(st) || s.length === 0) return false;
      const rp = resolvePen(st, opts.baseWidth);
      const pad = r + Math.max(maxPenWidth(rp), maxPenWidth(silhouettePen(rp))) / 2 + rp.grain + 2;
      let sx0 = Infinity;
      let sy0 = Infinity;
      let sx1 = -Infinity;
      let sy1 = -Infinity;
      for (const q of s) {
        if (q.x < sx0) sx0 = q.x;
        if (q.y < sy0) sy0 = q.y;
        if (q.x > sx1) sx1 = q.x;
        if (q.y > sy1) sy1 = q.y;
      }
      if (ex1 + pad < sx0 || ex0 - pad > sx1 || ey1 + pad < sy0 || ey0 - pad > sy1) return false;
      for (let k = 0; k < pts.length; k++) {
        const a = pts[k]!;
        const b = pts[k + 1] ?? a;
        for (let j = 0; j < s.length; j++) {
          const c = s[j]!;
          const d = s[j + 1] ?? c;
          if (segDist(a, b, c, d) <= pad) return true;
        }
      }
      return false;
    });
  }

  function addSample(e: PointerEvent): void {
    if (!live) return;
    const pos = toPoint(e);
    if (live.tool === 'eraser') {
      live.lastEraserPt = pos;
      composeDirty = true;
      const prevE = live.points[live.points.length - 1];
      if (!shouldAppend(prevE, pos)) return;
      live.points.push({ x: pos.x, y: pos.y, p: normalizePressure(e.pressure), t: timeOf(e) });
      eraseLiveIncrement();
      return;
    }
    const prev = live.points[live.points.length - 1];
    if (!shouldAppend(prev, pos)) return;
    live.points.push({ x: pos.x, y: pos.y, p: normalizePressure(e.pressure), t: timeOf(e) });
  }

  function capture(e: PointerEvent): void {
    try {
      canvas?.setPointerCapture(e.pointerId);
    } catch {
      /* 一部環境では失敗するが描画は続けられる */
    }
  }

  /** 1 本指・ペン・マウスの操作を取り消す（2 本指のジェスチャーに切り替えるとき） */
  function cancelSingleInput(): void {
    if (live) interruptInput();
    if (shape) {
      shape = null;
      livePaint = null;
      liveOn = null;
      clearLive();
    }
    if (selIn) {
      selIn = null;
      composeDirty = true;
    }
    panIn = null;
    pickIn = null;
    // 1 本目の指でした操作の影響（スポイトで変えた色・選択の解除や移動）を戻す。塗りはまだ積んでいない
    pendingFill = null;
    const revert = singleRevert;
    singleRevert = null;
    revert?.();
    stopFrame();
    compose();
  }

  function startGesture(): void {
    const ids = [...touches.keys()].slice(0, 2) as [number, number];
    const s1 = touches.get(ids[0])!;
    const s2 = touches.get(ids[1])!;
    gesture = { ids, s1: { ...s1 }, s2: { ...s2 }, c1: viewInverse(s1), c2: viewInverse(s2), base: { ...view }, rotating: false };
  }
  function updateGesture(): void {
    const g = gesture;
    if (!g) return;
    const s1 = touches.get(g.ids[0]);
    const s2 = touches.get(g.ids[1]);
    if (!s1 || !s2) return;
    if (!g.rotating && Math.abs(twistDeg(g.s1, g.s2, s1, s2)) >= TWIST_THRESHOLD) g.rotating = true;
    view = gestureView(g.base, g.c1, g.c2, s1, s2, g.rotating);
    invalidateHires(HIRES_VIEW_DELAY);
    composeDirty = true;
    schedule();
    emitView();
  }

  function selectionShown(): SelectionMask | null {
    if (!selection) return null;
    return tf ? transformMask(tf.mask, tf.matrix) : selection;
  }

  function onDown(e: PointerEvent): void {
    if (!canvas || replayState) return;
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, screenPt(e));
      if (touches.size === 2) {
        // gestures: false（採点する画面）では 2 本目の指を無視する
        if (!opts.gestures) return;
        // ペン・マウスで描いている間の手のひら（2 本目のタッチ）ではビューを動かさない
        const busy = live?.pointerId ?? shape?.pointerId ?? selIn?.pointerId ?? panIn?.pointerId ?? pickIn ?? pendingFill?.pointerId;
        if (busy !== null && busy !== undefined && !touches.has(busy)) return;
        e.preventDefault();
        capture(e);
        cancelSingleInput();
        startGesture();
        return;
      }
      if (touches.size > 2) return;
      if (gesture) return;
    } else if (gesture) {
      // ペン・マウスが来たらジェスチャーをやめて描く（ペン優先）
      gesture = null;
    }
    if (live || shape || selIn || panIn || pickIn !== null || pendingFill) return;
    if (tool === 'hand' && !opts.gestures) return;
    if (tool !== 'hand' && !allowed(e)) return;
    e.preventDefault();
    capture(e);
    const p = toPoint(e);
    // タッチ 1 本の操作は、2 本目の指が来たら取り消してジェスチャーに切り替える
    const touchMayPinch = e.pointerType === 'touch' && opts.gestures;
    singleRevert = null;
    switch (tool) {
      case 'hand':
        panIn = { pointerId: e.pointerId, last: screenPt(e) };
        return;
      case 'eyedropper': {
        pickIn = e.pointerId;
        if (touchMayPinch) {
          const before = pen.color;
          singleRevert = () => engine.setPen({ color: before });
        }
        pickAt(p);
        return;
      }
      case 'fill': {
        settleTransform();
        if (!activeEditable()) return;
        if (docW > 0 && docH > 0 && (p.x < 0 || p.y < 0 || p.x >= docW || p.y >= docH)) return;
        const op: FillOp = { kind: 'fill', layer: active, x: p.x, y: p.y, color: fillColorNow(), tolerance: fillOpts.tolerance, reference: fillOpts.reference };
        // 指は離したときに積む（ピンチの 1 本目で塗りが確定しないように）。ペン・マウスは押した瞬間
        if (touchMayPinch) pendingFill = { pointerId: e.pointerId, op };
        else pushUnit([op]);
        return;
      }
      case 'select-rect':
      case 'select-lasso': {
        const shown = selectionShown();
        if (touchMayPinch) {
          const selBefore = selection;
          const tfBefore = tf ? ([...tf.matrix] as Mat) : null;
          singleRevert = () => {
            if (tfBefore) engine.transformSelection(tfBefore);
            else if (tf) cancelTf();
            selection = selBefore;
            composeDirty = true;
            emitSelection();
          };
        }
        if (shown && pointInMask(shown, p.x, p.y) && activeEditable()) {
          selIn = { pointerId: e.pointerId, mode: 'move', start: p, points: [], base: tf ? tf.matrix : [...IDENTITY] };
          return;
        }
        settleTransform();
        selIn = { pointerId: e.pointerId, mode: tool === 'select-rect' ? 'rect' : 'lasso', start: p, points: [p], base: [...IDENTITY] };
        if (tool === 'select-rect') selection = null;
        composeDirty = true;
        schedule();
        return;
      }
      case 'shape-line':
      case 'shape-rect':
      case 'shape-ellipse': {
        settleTransform();
        if (!activeEditable()) return;
        const style = styleFromPen(pen);
        const kind: ShapeKind = tool === 'shape-line' ? 'line' : tool === 'shape-rect' ? 'rect' : 'ellipse';
        shape = { pointerId: e.pointerId, kind, layer: active, a: p, b: p, t0: timeOf(e), style };
        clearLive();
        livePaint = normalPaint(style);
        liveOn = active;
        return;
      }
      default:
        break;
    }
    // pen / eraser / guide
    settleTransform();
    if (!activeEditable()) return;
    const t = tool as 'pen' | 'eraser' | 'guide';
    const style = t === 'eraser' ? eraserStrokeStyle(eraser.size) : t === 'guide' ? guideStrokeStyle() : styleFromPen(pen);
    live = { pointerId: e.pointerId, tool: t, layer: active, points: [], drawnCtrl: 0, dotDrawn: false, lastEraserPt: null, erasedPts: 0, style };
    clearLive();
    livePaint = t === 'eraser' ? null : normalPaint(style);
    liveOn = t === 'eraser' ? null : active;
    addSample(e);
    schedule();
  }

  function onMove(e: PointerEvent): void {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, screenPt(e));
      if (gesture) {
        if (gesture.ids.includes(e.pointerId)) {
          e.preventDefault();
          updateGesture();
        }
        return;
      }
    }
    if (panIn && e.pointerId === panIn.pointerId) {
      e.preventDefault();
      const s = screenPt(e);
      const dx = s.x - panIn.last.x;
      const dy = s.y - panIn.last.y;
      panIn.last = s;
      if (dx !== 0 || dy !== 0) {
        view = { ...view, panX: view.panX + dx, panY: view.panY + dy };
        invalidateHires(HIRES_VIEW_DELAY);
        composeDirty = true;
        schedule();
        emitView();
      }
      return;
    }
    if (pickIn !== null && e.pointerId === pickIn) {
      pickAt(toPoint(e));
      return;
    }
    if (shape && e.pointerId === shape.pointerId) {
      e.preventDefault();
      shape.b = toPoint(e);
      drawShapePreview();
      composeDirty = true;
      schedule();
      return;
    }
    if (selIn && e.pointerId === selIn.pointerId) {
      e.preventDefault();
      const p = toPoint(e);
      if (selIn.mode === 'rect') {
        selection = sanitizeMask({ kind: 'rect', x: selIn.start.x, y: selIn.start.y, w: p.x - selIn.start.x, h: p.y - selIn.start.y });
      } else if (selIn.mode === 'lasso') {
        const last = selIn.points[selIn.points.length - 1];
        if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 1) selIn.points.push(p);
      } else {
        engine.transformSelection(mul(translate(p.x - selIn.start.x, p.y - selIn.start.y), selIn.base));
        return;
      }
      composeDirty = true;
      schedule();
      return;
    }
    if (!live) {
      // 消しゴム選択中は、ペン／マウスの位置に輪を出す（タッチはホバーが無いので出さない）
      if (tool === 'eraser' && canvas && !replayState && e.pointerType !== 'touch') {
        hoverPt = toPoint(e);
        composeDirty = true;
        schedule();
      }
      return;
    }
    if (e.pointerId !== live.pointerId) return;
    e.preventDefault();
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const ev of list.length > 0 ? list : [e]) addSample(ev);
    schedule();
  }

  function stopFrame(): void {
    if (rafId && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function finishShape(e: PointerEvent, cancelled: boolean): void {
    const s = shape!;
    shape = null;
    livePaint = null;
    liveOn = null;
    clearLive();
    if (!cancelled) s.b = toPoint(e);
    const strokes = cancelled ? [] : shapeStrokes(s.kind, s.a, s.b, s.t0);
    if (strokes.length === 0) {
      compose();
      return;
    }
    pushUnit(strokes.map((pts) => ({ kind: 'stroke', layer: s.layer, points: pts, style: s.style })));
    for (const pts of strokes) for (const cb of [...strokeEndCbs]) cb(pts);
  }

  function finishSelect(e: PointerEvent, cancelled: boolean): void {
    const s = selIn!;
    selIn = null;
    if (s.mode === 'move') {
      if (!cancelled) {
        const p = toPoint(e);
        engine.transformSelection(mul(translate(p.x - s.start.x, p.y - s.start.y), s.base));
      }
      return;
    }
    if (cancelled) {
      compose();
      return;
    }
    if (s.mode === 'rect') {
      const p = toPoint(e);
      const m = sanitizeMask({ kind: 'rect', x: s.start.x, y: s.start.y, w: p.x - s.start.x, h: p.y - s.start.y });
      // 小さすぎる矩形（タップ）は選択解除
      selection = m && m.kind === 'rect' && m.w >= 2 && m.h >= 2 ? m : null;
    } else {
      selection = sanitizeMask({ kind: 'lasso', points: s.points });
    }
    compose();
    emitSelection();
  }

  function finish(e: PointerEvent, cancelled: boolean): void {
    if (e.pointerType === 'touch') {
      touches.delete(e.pointerId);
      if (gesture && gesture.ids.includes(e.pointerId)) {
        gesture = null;
        return;
      }
    }
    if (panIn && e.pointerId === panIn.pointerId) {
      panIn = null;
      return;
    }
    if (pickIn !== null && e.pointerId === pickIn) {
      pickIn = null;
      singleRevert = null;
      return;
    }
    if (pendingFill && e.pointerId === pendingFill.pointerId) {
      const f = pendingFill;
      pendingFill = null;
      if (!cancelled) pushUnit([f.op]);
      return;
    }
    if (shape && e.pointerId === shape.pointerId) {
      finishShape(e, cancelled);
      return;
    }
    if (selIn && e.pointerId === selIn.pointerId) {
      singleRevert = null;
      finishSelect(e, cancelled);
      return;
    }
    if (!live || e.pointerId !== live.pointerId) return;
    if (!cancelled) addSample(e);
    const l = live;
    live = null;
    livePaint = null;
    liveOn = null;
    clearLive();
    if (l.tool === 'eraser') {
      stopFrame();
      hoverPt = e.pointerType === 'touch' || cancelled ? null : l.lastEraserPt;
      if (eraserTouchesInk(l.points, l.style.size, l.layer)) {
        // 画像には消し込み済み。1 回なぞる（down〜up）で 1 操作
        pushUnit([{ kind: 'stroke', layer: l.layer, points: l.points, style: l.style }], true);
        if (fullDirty) {
          fullDirty = false;
          fullRedraw();
        }
      } else {
        fullDirty = false;
        rebuildLayers([l.layer]);
        compose();
      }
      return;
    }
    // キャンセル（システムジェスチャ等）で 1 点しかなければ捨てる
    if (l.points.length === 0 || (cancelled && l.points.length < 2)) {
      stopFrame();
      compose();
      return;
    }
    const stroke: Stroke = l.points;
    stopFrame();
    pushUnit([{ kind: 'stroke', layer: l.layer, points: stroke, style: l.style }]);
    if (fullDirty) {
      fullDirty = false;
      fullRedraw();
    }
    // 補助線は採点しないので strokeend を出さない（change だけ）
    if (l.tool !== 'guide') for (const cb of [...strokeEndCbs]) cb(stroke);
  }

  const onUp = (e: PointerEvent): void => finish(e, false);
  const onCancel = (e: PointerEvent): void => finish(e, true);
  const onLeave = (): void => {
    if (!hoverPt) return;
    hoverPt = null;
    composeDirty = true;
    schedule();
  };

  function pickAt(p: Vec2): void {
    const c = engine.pickColor(p.x, p.y);
    // 透明・墨は「色なし（墨＝テーマ追従）」に戻す
    engine.setPen({ color: c === null || c === 'ink' ? undefined : c });
  }

  // ================= 再生 =================
  function drawReplayPartial(st: ReplayState): void {
    if (st.partial < 0 || !liveLayer) return;
    const op = ops[st.partial];
    if (!op || op.kind !== 'stroke') return;
    const s = op.points;
    const n = Math.min(s.length, visibleCounts(st.schedule, performance.now() - st.start)[st.strokeOf[st.partial]!] ?? 0);
    const style = op.style;
    if (isEraserStyle(style)) {
      // 消しゴムはレイヤーから直接消していく
      livePaint = null;
      liveOn = null;
      const bm = bms.get(op.layer);
      if (bm && n > st.partialCtrl) {
        paintEraser(bm.ctx, s, style.size, { k: dpr, ox: 0, oy: 0 }, st.partialCtrl, n);
        st.partialCtrl = n;
      }
      return;
    }
    if (isGuideStyle(style) && opts.silhouette) {
      livePaint = null;
      liveOn = null;
      return;
    }
    const paint = normalPaint(style);
    livePaint = paint;
    liveOn = op.layer;
    const c = liveLayer.ctx;
    const pts = s.slice(0, n);
    const ready = n - 2;
    if (ready > st.partialCtrl) {
      if (st.partialDot) {
        clearLive();
        st.partialCtrl = 0;
        st.partialDot = false;
      }
      const g = geom(pts, paint.pen, false);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      prep(c, paint.color);
      drawRange(c, g, paint.pen, st.partialCtrl, ready, 1);
      c.globalAlpha = 1;
      st.partialCtrl = ready;
    } else if (n >= 1 && st.partialCtrl === 0 && !st.partialDot) {
      const g = geom(pts.slice(0, 1), paint.pen, false);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      prep(c, paint.color);
      drawTail(c, g, paint.pen, 1);
      c.globalAlpha = 1;
      st.partialDot = true;
    }
  }

  /** 再生用: 表示を時点 0 に戻す */
  function resetDisplayTo0(): void {
    dispList = listAt(0);
    for (const l of dispList) {
      const bm = ensureBm(l.id);
      clearLayer(bm);
    }
  }

  /** 再生中にレイヤー画像が消えたとき（リサイズ）: 時点 opIdx まで描き直す */
  function replayRebuild(st: ReplayState): void {
    resetDisplayTo0();
    for (let j = 0; j < st.opIdx; j++) applyOpDisplay(ops[j]!, j, false);
    st.partialCtrl = 0;
    st.partialDot = false;
    clearLive();
    drawReplayPartial(st);
  }

  function endReplay(): void {
    const st = replayState;
    if (!st) return;
    replayState = null;
    if (st.raf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(st.raf);
    livePaint = null;
    liveOn = null;
    clearLive();
    fullRedraw();
    st.resolve();
  }

  function replayStep(): void {
    const st = replayState;
    if (!st || !ctx) return;
    st.raf = 0;
    const elapsed = performance.now() - st.start;
    const counts = visibleCounts(st.schedule, elapsed);
    while (st.opIdx < ops.length) {
      const op = ops[st.opIdx]!;
      if (op.kind === 'stroke' && (counts[st.strokeOf[st.opIdx]!] ?? 0) < op.points.length) break;
      if (st.partial === st.opIdx) {
        st.partial = -1;
        livePaint = null;
        liveOn = null;
        clearLive();
      }
      applyOpDisplay(op, st.opIdx, false);
      st.opIdx++;
    }
    const next = st.opIdx;
    const op = ops[next];
    if (op && op.kind === 'stroke' && (counts[st.strokeOf[next]!] ?? 0) > 0) {
      if (st.partial !== next) {
        st.partial = next;
        st.partialCtrl = 0;
        st.partialDot = false;
        clearLive();
      }
      drawReplayPartial(st);
    }
    if (elapsed >= st.schedule.total && st.opIdx >= ops.length) {
      endReplay();
      return;
    }
    compose();
    st.raf = requestAnimationFrame(replayStep);
  }

  // ================= 書き出し =================
  /**
   * 全 op を xf の解像度で新しいレイヤー画像に適用する（表示とは無関係）。
   * o.ink: 墨の色。o.display: 表示だけの透明度（setStrokeVisibility）を掛ける（拡大表示の描き直し用）。
   * 途中で消えたレイヤーの画像はその場で手放す。返した画像は呼び出し側が freeLayer する。
   */
  /** ops を新しいレイヤー画像に順に適用する途中の状態（書き出し・拡大表示の描き直し） */
  interface RenderJob {
    j: number;
    W: number;
    H: number;
    layers: Map<string, Layer>;
    env: RasterEnv;
    sc: Layer | null;
    /** 描く範囲（キャンバス座標）。この外にある線は描かない（結果は同じ） */
    view: { x0: number; y0: number; x1: number; y1: number };
  }

  /** 線 1 本が塗りうる範囲（キャンバス座標、線幅・消しゴムの半径込み） */
  const strokeBoxes = new WeakMap<object, { x0: number; y0: number; x1: number; y1: number }>();
  function strokeBox(op: Extract<EngineOp, { kind: 'stroke' }>): { x0: number; y0: number; x1: number; y1: number } {
    let b = strokeBoxes.get(op);
    if (b) return b;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const q of op.points) {
      if (q.x < x0) x0 = q.x;
      if (q.y < y0) y0 = q.y;
      if (q.x > x1) x1 = q.x;
      if (q.y > y1) y1 = q.y;
    }
    const rp = resolvePen(op.style, opts.baseWidth);
    const pad = isEraserStyle(op.style) ? op.style.size + 2 : maxPenWidth(rp) / 2 + rp.grain + 2;
    b = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
    strokeBoxes.set(op, b);
    return b;
  }

  /**
   * 全 op を xf の解像度で新しいレイヤー画像に適用する準備（表示とは無関係）。
   * o.ink: 墨の色。o.display: 表示だけの透明度（setStrokeVisibility）を掛ける（拡大表示の描き直し用）。
   */
  function startRender(W: number, H: number, xf: Xf, o: { ink: string; display: boolean }): RenderJob | null {
    primeMasks();
    const needScratch = ops.some((op) => op.kind === 'stroke' && !isEraserStyle(op.style) && needsLayer(resolvePen(op.style, opts.baseWidth)));
    const sc = needScratch ? makeLayer(W, H) : null;
    const layers = new Map<string, Layer>();
    for (const l of listAt(0)) {
      const c = makeLayer(W, H);
      if (!c) {
        for (const x of layers.values()) freeLayer(x);
        freeLayer(sc);
        return null;
      }
      layers.set(l.id, c);
    }
    const env: RasterEnv = {
      xf,
      w: W,
      h: H,
      paint: paintWith(o.ink, guideInk),
      fillColor: (c) => (c === 'ink' ? o.ink : c),
      scratch: sc,
      make: () => makeLayer(W, H),
      mask: maskFor,
      alpha: o.display ? visAlpha : () => 1,
      paper: paperRgb(),
      stamp: getStamp,
    };
    const view = { x0: -xf.ox / xf.k, y0: -xf.oy / xf.k, x1: (W - xf.ox) / xf.k, y1: (H - xf.oy) / xf.k };
    return { j: 0, W, H, layers, env, sc, view };
  }

  /** job を進める。deadline（performance.now()）を過ぎたら途中でやめる。終われば true */
  function stepRender(job: RenderJob, deadline = Infinity): boolean {
    const { layers, env, view } = job;
    while (job.j < ops.length) {
      if (deadline !== Infinity && performance.now() > deadline) return false;
      const j = job.j;
      const op = ops[j]!;
      const list = listAt(j);
      const skip =
        op.kind === 'stroke' &&
        (() => {
          const b = strokeBox(op);
          return b.x1 < view.x0 || b.y1 < view.y0 || b.x0 > view.x1 || b.y0 > view.y1;
        })();
      if (!skip) {
        for (const id of writesOf(op, list)) {
          let t = layers.get(id);
          if (!t) {
            t = makeLayer(job.W, job.H) ?? undefined;
            if (!t) continue;
            layers.set(id, t);
          }
          execInto(t, id, op, j, (id2) => layers.get(id2) ?? null, env);
        }
      }
      const next = listAt(j + 1);
      if (next !== list) {
        for (const [id, l] of [...layers]) {
          if (next.some((x) => x.id === id)) continue;
          freeLayer(l);
          layers.delete(id);
        }
      }
      job.j = j + 1;
    }
    return true;
  }

  function abortRender(job: RenderJob | null): void {
    if (!job) return;
    for (const l of job.layers.values()) freeLayer(l);
    freeLayer(job.sc);
    job.layers.clear();
  }

  /**
   * 全 op を xf の解像度で新しいレイヤー画像に適用する（表示とは無関係）。描く範囲の外の線は飛ばす。
   * 途中で消えたレイヤーの画像はその場で手放す。返した画像は呼び出し側が freeRendered する。
   */
  function renderDoc(W: number, H: number, xf: Xf, o: { ink: string; display: boolean }): { list: readonly LayerInfo[]; layers: Map<string, Layer> } | null {
    const job = startRender(W, H, xf, o);
    if (!job) return null;
    stepRender(job);
    freeLayer(job.sc);
    return { list: curList(), layers: job.layers };
  }

  function freeRendered(r: { layers: Map<string, Layer> } | null): void {
    if (r) for (const l of r.layers.values()) freeLayer(l);
  }

  /** 塗りつぶしを含む文書の、画素で見た内容の範囲（CSS px）。分からなければ null */
  function pixelBounds(): Rect | null {
    const W0 = docW > 0 ? docW : strokeBounds(ink().strokes).width;
    const H0 = docH > 0 ? docH : strokeBounds(ink().strokes).height;
    const s = Math.min(1, 1024 / Math.max(1, W0, H0));
    const W = Math.max(1, Math.round(W0 * s));
    const H = Math.max(1, Math.round(H0 * s));
    const r = renderDoc(W, H, { k: s, ox: 0, oy: 0 }, { ink: inkColor, display: false });
    if (!r) return null;
    const comp = makeLayer(W, H, { cpu: true });
    let img: ImageData | null = null;
    if (comp) {
      for (const l of r.list) {
        const src = r.layers.get(l.id);
        if (src && l.visible) drawLayerOnto(comp, src, l);
      }
      img = readPixels(comp);
    }
    freeRendered(r);
    freeLayer(comp);
    if (!img) return null;
    let x0 = W;
    let y0 = H;
    let x1 = -1;
    let y1 = -1;
    const d = img.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3]! === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (x1 < 0) return null;
    return { x: x0 / s, y: y0 / s, width: (x1 + 1 - x0) / s, height: (y1 + 1 - y0) / s };
  }

  function contentRect(): Rect | null {
    const v = ink();
    if (!ops.some((op) => op.kind === 'fill')) return cropRect(v.strokes, opts.baseWidth, v.styles);
    const vb = inkBounds(v.strokes, opts.baseWidth, v.styles);
    const pb = pixelBounds();
    if (!vb && !pb) return null;
    if (!vb || !pb) return padRect((vb ?? pb)!);
    const x = Math.min(vb.x, pb.x);
    const y = Math.min(vb.y, pb.y);
    return padRect({ x, y, width: Math.max(vb.x + vb.width, pb.x + pb.width) - x, height: Math.max(vb.y + vb.height, pb.y + pb.height) - y });
  }

  /**
   * 書き出し。範囲 rect を倍率 k で描く。変形（transform）で範囲の外から運ばれてくる画素があるので、
   * 必要な範囲（regionFor）を同じ倍率で再生してから rect を切り出す（切り詰めても動かした線が消えない）。
   * 合成は紙色の上で（乗算・スクリーンが画面と同じ見た目）。transparent だけ透明の上で合成する。
   */
  async function exportImage(
    maxEdge: number,
    o: {
      crop: boolean;
      transparent: boolean;
      type: string;
      quality?: number;
      ink?: string;
      /** maxEdge まで拡大してよいか（省略時は切り詰めたときだけ） */
      upscale?: boolean;
      fullSize: () => { width: number; height: number };
    },
  ): Promise<Blob> {
    if (typeof document === 'undefined') throw new Error('書き出し: document がありません');
    if (!host) resolveColors();
    const inkNow = o.ink ? resolveColor(o.ink, lookupVar, inkColor) : inkColor;
    const cropped = o.crop ? contentRect() : null;
    let rect: Rect;
    if (cropped) rect = cropped;
    else {
      const sz = o.fullSize();
      rect = { x: 0, y: 0, width: Math.max(1, sz.width), height: Math.max(1, sz.height) };
    }
    const k = exportScale(rect, maxEdge, dpr, o.upscale ?? cropped !== null);
    const W = Math.max(1, Math.round(rect.width * k));
    const H = Math.max(1, Math.round(rect.height * k));
    const R = regionFor(rect, true);
    const same = R.x === rect.x && R.y === rect.y && R.width === rect.width && R.height === rect.height;
    const RW = same ? W : Math.max(1, Math.ceil(R.width * k));
    const RH = same ? H : Math.max(1, Math.ceil(R.height * k));
    const r = renderDoc(RW, RH, { k, ox: -R.x * k, oy: -R.y * k }, { ink: inkNow, display: false });
    const out = makeLayer(W, H);
    if (!r || !out) {
      freeRendered(r);
      freeLayer(out);
      throw new Error('書き出し: 2D コンテキストを作れません');
    }
    const c = out.ctx;
    if (!o.transparent) {
      c.fillStyle = paper;
      c.fillRect(0, 0, W, H);
    }
    const dx = (R.x - rect.x) * k;
    const dy = (R.y - rect.y) * k;
    for (const l of r.list) {
      const src = r.layers.get(l.id);
      if (!src || !l.visible || l.opacity <= 0) continue;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalAlpha = l.opacity;
      c.globalCompositeOperation = compositeOp(l.blend);
      c.drawImage(src.canvas, dx, dy);
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
    }
    freeRendered(r);
    try {
      const b = await toBlobAsync(out.canvas, o.type, o.quality);
      if (b) return b;
      const png = await toBlobAsync(out.canvas, 'image/png');
      if (png) return png;
      throw new Error('書き出し: 画像化に失敗しました');
    } finally {
      freeLayer(out);
    }
  }

  // ================= 公開 API =================
  function interruptInput(): void {
    if (live) {
      const wasEraser = live.tool === 'eraser';
      const layer = live.layer;
      live = null;
      livePaint = null;
      liveOn = null;
      clearLive();
      // 消し込み途中のレイヤーを履歴どおりに戻す
      if (wasEraser) {
        rebuildLayers([layer]);
        compose();
      }
    }
    if (shape) {
      shape = null;
      livePaint = null;
      liveOn = null;
      clearLive();
    }
    selIn = null;
    panIn = null;
    pickIn = null;
    pendingFill = null;
    singleRevert = null;
  }

  /** 文書を置き換える（履歴はリセット） */
  function resetDocument(list: readonly LayerInfo[], newOps: EngineOp[], act: string, w: number, h: number): void {
    endReplay();
    interruptInput();
    const prevList = curList();
    baseList = list;
    ops = newOps;
    units = [];
    redoUnits = [];
    listCache = [baseList];
    version++;
    const cur = curList();
    active = cur.some((l) => l.id === act) ? act : cur[cur.length - 1]!.id;
    selection = null;
    cancelTf();
    timeOrigin = null;
    dropAllCkpts();
    freeRef();
    const nw = Math.max(w, cssW);
    const nh = Math.max(h, cssH);
    const sizeChanged = nw !== docW || nh !== docH;
    docW = nw;
    docH = nh;
    if (ctx && sizeChanged) reallocBitmaps();
    fullRedraw();
    emitChange();
    emitOps();
    if (JSON.stringify(prevList) !== JSON.stringify(cur)) emitLayers();
    emitSelection();
    warmRef();
  }

  /** 描いた内容のおおよその範囲（線の範囲 ∪ 塗りの領域の外接矩形、CSS px）。何も無ければ null */
  function quickContentBox(): Rect | null {
    const v = ink();
    const vb = inkBounds(v.strokes, opts.baseWidth, v.styles);
    let x0 = vb ? vb.x : Infinity;
    let y0 = vb ? vb.y : Infinity;
    let x1 = vb ? vb.x + vb.width : -Infinity;
    let y1 = vb ? vb.y + vb.height : -Infinity;
    for (const op of ops) {
      if (op.kind !== 'fill') continue;
      const m = fillMasks.get(op);
      if (!m) continue;
      x0 = Math.min(x0, m.box.x0);
      y0 = Math.min(y0, m.box.y0);
      x1 = Math.max(x1, m.box.x1 + 1);
      y1 = Math.max(y1, m.box.y1 + 1);
    }
    if (!(x1 > x0 && y1 > y0)) return null;
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }

  /**
   * GPU のリセットなどで 2D コンテキストが失われて戻ったとき（'contextrestored'）: 画像はすべて空になっているので、
   * チェックポイント・領域計算用の画像を捨てて ops から描き直す。
   */
  function onContextRestored(): void {
    dropAllCkpts();
    freeRef();
    dropHires();
    freeLayer(mix);
    mix = null;
    fullDirty = true;
    schedule();
  }

  const engine: CanvasEngine = {
    attach(el: HTMLElement): void {
      if (host === el) return;
      if (host) engine.detach();
      host = el;
      const c = document.createElement('canvas');
      c.style.display = 'block';
      c.style.width = '100%';
      c.style.height = '100%';
      c.style.touchAction = 'none';
      c.style.userSelect = 'none';
      (c.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = 'none';
      el.style.touchAction = 'none';
      el.appendChild(c);
      canvas = c;
      ctx = c.getContext('2d');
      // 作る順: 表示 → レイヤー（下から）→ live → scratch
      for (const l of curList()) {
        const b = makeLayer(0, 0);
        if (b) bms.set(l.id, b);
      }
      dispList = curList();
      liveLayer = makeLayer(0, 0);
      scratch = makeLayer(0, 0);
      c.addEventListener('pointerdown', onDown);
      c.addEventListener('pointermove', onMove);
      c.addEventListener('pointerup', onUp);
      c.addEventListener('pointercancel', onCancel);
      c.addEventListener('pointerleave', onLeave);
      c.addEventListener('contextmenu', preventDefault);
      c.addEventListener('contextrestored', onContextRestored);
      resolveColors();
      cssW = 0;
      cssH = 0;
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => resize());
        ro.observe(el);
      }
      watchDpr();
      resize();
      if (overlay && !overlayImg) loadOverlayImage();
    },

    detach(): void {
      endReplay();
      interruptInput();
      stopFrame();
      fullDirty = false;
      composeDirty = false;
      ro?.disconnect();
      ro = null;
      dprMql?.removeEventListener('change', onDprChange);
      dprMql = null;
      if (canvas) {
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerup', onUp);
        canvas.removeEventListener('pointercancel', onCancel);
        canvas.removeEventListener('pointerleave', onLeave);
        canvas.removeEventListener('contextmenu', preventDefault);
        canvas.removeEventListener('contextrestored', onContextRestored);
        canvas.remove();
        canvas.width = 0;
        canvas.height = 0;
      }
      canvas = null;
      ctx = null;
      // 作業用の canvas はすべて大きさ 0 にして明示的に手放す（GC を待たない）
      for (const l of bms.values()) freeLayer(l);
      bms.clear();
      freeLayer(liveLayer);
      liveLayer = null;
      freeLayer(scratch);
      scratch = null;
      freeLayer(mix);
      mix = null;
      freeLayer(silTmp);
      silTmp = null;
      freeLayer(stampLayer);
      stampLayer = null;
      if (hiTimer !== null) clearTimeout(hiTimer);
      hiTimer = null;
      if (warmTimer !== null) clearTimeout(warmTimer);
      warmTimer = null;
      dropHires();
      freeRef();
      hoverPt = null;
      host = null;
      touches.clear();
      gesture = null;
      if (tf) {
        freeLayer(tf.base);
        freeLayer(tf.cut);
        tf.base = null;
        tf.cut = null;
      }
      dropAllCkpts();
    },

    setTool(t: Tool): void {
      if (tool === t) return;
      tool = t;
      warmRef();
      if (t !== 'eraser' && hoverPt) {
        hoverPt = null;
        compose();
      }
    },

    setPen(style: Partial<PenStyle>): void {
      const prev = pen;
      let next: PenStyle = { ...pen };
      if (style.preset !== undefined && isPenPreset(style.preset) && style.preset !== pen.preset) {
        const mem = penMemory[style.preset]!;
        next = { ...next, preset: style.preset, size: mem.size, opacity: mem.opacity };
      }
      if (style.size !== undefined) next.size = clampPenSize(style.size, next.size);
      if (style.opacity !== undefined) next.opacity = clampOpacity(style.opacity, next.opacity);
      if ('color' in style) {
        if (style.color === undefined) delete next.color;
        else {
          const c = normalizeHexColor(style.color);
          if (c) next.color = c;
        }
      }
      penMemory[next.preset] = { size: next.size, opacity: next.opacity };
      pen = next;
      if (prev.preset !== next.preset || prev.size !== next.size || prev.opacity !== next.opacity || prev.color !== next.color) {
        emitToolChange();
      }
    },

    getPen: () => ({ ...pen }),

    setEraser(style: Partial<EraserStyle>): void {
      const prev = eraser;
      const next: EraserStyle = { size: eraser.size };
      // mode は旧 API の名残。受け付けるが使わない（消しゴムは常にラスター消しゴム）
      if (style.size !== undefined) next.size = clampEraserSize(style.size, next.size);
      eraser = next;
      if (prev.size !== next.size) {
        if (hoverPt) compose();
        emitToolChange();
      }
    },

    getEraser: () => ({ ...eraser }),

    setOptions(patch: Partial<CanvasOptions>): void {
      const prev = opts;
      opts = { ...opts, ...patch };
      const prevPaper = paper;
      const prevInk = inkColor;
      if (patch.paperColor !== undefined || patch.inkColor !== undefined) resolveColors();
      if (!opts.gestures) {
        gesture = null;
        panIn = null;
      }
      // シルエットは合成のときに黒くするだけ（レイヤー画像は描き直さない・チェックポイントも捨てない）
      const strokeLook = prevPaper !== paper || prevInk !== inkColor || prev.baseWidth !== opts.baseWidth;
      const viewLook = strokeLook || !sameGrid(prev.grid, opts.grid) || prev.flipped !== opts.flipped || prev.silhouette !== opts.silhouette;
      if (strokeLook) {
        dropAllCkpts();
        if (replayState) {
          replayRebuild(replayState);
          compose();
        } else fullRedraw();
      } else if (viewLook) compose();
    },

    setStrokeVisibility(alphas: readonly (number | undefined)[] | null): void {
      const next = alphas && alphas.some((a) => a !== undefined && a !== 1) ? [...alphas] : null;
      const same =
        next === visibility ||
        (next !== null && visibility !== null && next.length === visibility.length && next.every((a, i) => a === visibility![i]));
      if (same) return;
      visibility = next;
      dropAllCkpts();
      if (!replayState) fullRedraw();
    },

    setOverlay(o: OverlaySpec | null): void {
      overlayToken++;
      overlay = o;
      overlayImg = null;
      if (canvas) loadOverlayImage();
      compose();
    },

    undo(): void {
      endReplay();
      interruptInput();
      // 変形プレビュー中はプレビューを取り消すだけ（直前の操作は取り消さない）
      if (tf) {
        engine.cancelTransform();
        return;
      }
      const start = units.pop();
      if (start === undefined) return;
      const listBefore = curList();
      const affected = new Set<string>();
      let moved: SelectionMask | null = null;
      for (let j = start; j < ops.length; j++) {
        const op = ops[j]!;
        for (const id of writesOf(op, listAt(j))) affected.add(id);
        if (op.kind === 'layer-remove' || op.kind === 'layer-merge-down') affected.add(op.layer);
        if (op.kind === 'transform' && !moved) moved = op.mask;
      }
      redoUnits.push(ops.splice(start));
      touched(start);
      dropCkptsAbove(start);
      rebuildLayers(affected);
      // 移動・変形を戻したら選択範囲も元の位置へ
      if (moved) selection = copyMask(moved);
      afterOps(listBefore);
      if (moved) emitSelection();
    },

    redo(): void {
      endReplay();
      interruptInput();
      if (tf) {
        cancelTf();
        emitSelection();
      }
      const unit = redoUnits.pop();
      if (!unit) return;
      const listBefore = curList();
      units.push(ops.length);
      let moved: SelectionMask | null = null;
      for (const op of unit) {
        const j = ops.length;
        ops.push(op);
        touched(j);
        applyOpDisplay(op, j, true);
        // 作り直したレイヤーをアクティブに（add / duplicate のときと同じ）
        if (op.kind === 'layer-add') active = op.layer.id;
        if (op.kind === 'layer-duplicate') active = op.newId;
        if (op.kind === 'transform') moved = transformMask(op.mask, op.matrix);
      }
      if (moved) selection = moved;
      afterOps(listBefore);
      if (moved) emitSelection();
    },

    clear(): void {
      endReplay();
      interruptInput();
      settleTransform();
      const unit: EngineOp[] = curList()
        .filter((l) => !l.locked && hasContent(l.id))
        .map((l) => ({ kind: 'layer-clear', layer: l.id }));
      pushUnit(unit);
    },

    canUndo: () => units.length > 0,
    canRedo: () => redoUnits.length > 0,

    getStrokes: () => copyDrawing(ink().strokes),

    getStyles(): (StrokeStyle | undefined)[] {
      const out = ink().styles.map(copyStyle);
      // 返した配列から、同じ時点の生の履歴（アクティブレイヤー）を引けるようにする
      historyByStyles.set(out, activeHistory().doc);
      return out;
    },

    getHistory: () => docToHistory(activeHistory().doc),

    loadHistory(h: { strokes: Drawing; styles?: (StrokeStyle | undefined)[] }): void {
      engine.loadStrokes(h.strokes, h.styles);
    },

    loadStrokes(d: Drawing, styles?: (StrokeStyle | undefined)[]): void {
      const strokes = copyDrawing(d);
      const list = [newLayerInfo(FIRST_ID, layerName(1))];
      resetDocument(
        list,
        strokes.map((s, i) => ({ kind: 'stroke', layer: FIRST_ID, points: s, style: sanitizeStyle(styles?.[i]) })),
        FIRST_ID,
        0,
        0,
      );
    },

    replay(o: { speed: number }): Promise<void> {
      endReplay();
      interruptInput();
      if (!ctx || typeof requestAnimationFrame === 'undefined') return Promise.resolve();
      const strokeOf: number[] = [];
      const drawing: Drawing = [];
      for (const op of ops) {
        if (op.kind === 'stroke') {
          strokeOf.push(drawing.length);
          drawing.push(op.points);
        } else strokeOf.push(-1);
      }
      const sched = buildReplaySchedule(drawing, { speed: o.speed });
      primeMasks();
      if (hiTimer !== null) clearTimeout(hiTimer);
      hiTimer = null;
      dropHires();
      return new Promise<void>((resolve) => {
        replayState = {
          schedule: sched,
          strokeOf,
          opIdx: 0,
          start: performance.now(),
          partial: -1,
          partialCtrl: 0,
          partialDot: false,
          raf: 0,
          resolve,
        };
        resetDisplayTo0();
        clearLive();
        compose();
        replayStep();
      });
    },

    cancelReplay(): void {
      endReplay();
    },

    toWebp(maxEdge: number, quality = 0.85, o?: ToWebpOptions): Promise<Blob> {
      if (typeof document === 'undefined') return Promise.reject(new Error('toWebp: document がありません'));
      return exportImage(maxEdge, {
        crop: o?.crop ?? true,
        transparent: false,
        type: 'image/webp',
        quality,
        fullSize: () => (cssW > 0 && cssH > 0 ? { width: cssW, height: cssH } : docW > 0 && docH > 0 ? { width: docW, height: docH } : strokeBounds(ink().strokes)),
      });
    },

    toPng(maxEdge: number, o?: ToPngOptions): Promise<Blob> {
      if (typeof document === 'undefined') return Promise.reject(new Error('toPng: document がありません'));
      return exportImage(maxEdge, {
        crop: o?.crop ?? false,
        transparent: o?.transparent ?? false,
        type: 'image/png',
        ink: o?.inkColor,
        // toPng は maxEdge まで拡大して描く（ops から描き直すので線はシャープ）
        upscale: true,
        fullSize: () => (docW > 0 && docH > 0 ? { width: docW, height: docH } : strokeBounds(ink().strokes)),
      });
    },

    size: () => ({ width: cssW, height: cssH }),

    on(event: string, cb: (s: Stroke) => void): () => void {
      if (event === 'strokeend') {
        strokeEndCbs.add(cb);
        return () => {
          strokeEndCbs.delete(cb);
        };
      }
      const f = cb as unknown as () => void;
      const set =
        event === 'toolchange'
          ? toolChangeCbs
          : event === 'layerschange'
            ? layersCbs
            : event === 'viewchange'
              ? viewCbs
              : event === 'selectionchange'
                ? selectionCbs
                : event === 'opsend'
                  ? opsCbs
                  : changeCbs;
      set.add(f);
      return () => {
        set.delete(f);
      };
    },

    // ---------------- レイヤー ----------------
    getLayers: () => curList().map(copyInfo),
    getActiveLayer: () => active,

    setActiveLayer(id: string): void {
      if (id === active || !findLayer(id)) return;
      settleTransform();
      active = id;
      if (visibility) {
        dropAllCkpts();
        fullRedraw();
      }
      emitLayers();
    },

    addLayer(o?: { name?: string; index?: number }): LayerInfo {
      endReplay();
      interruptInput();
      settleTransform();
      const list = curList();
      const id = uniqueId();
      const name = o?.name?.trim() ? o.name.trim().slice(0, 100) : layerName(nextLayerNumber());
      const ai = list.findIndex((l) => l.id === active);
      const index = o?.index !== undefined && Number.isFinite(o.index) ? Math.max(0, Math.min(list.length, Math.round(o.index))) : ai + 1;
      const info = newLayerInfo(id, name);
      active = id;
      pushUnit([{ kind: 'layer-add', layer: info, index }]);
      return copyInfo(info);
    },

    removeLayer(id: string): void {
      const list = curList();
      const i = list.findIndex((l) => l.id === id);
      if (i < 0 || list.length <= 1) return;
      endReplay();
      interruptInput();
      settleTransform();
      if (active === id) active = (list[i - 1] ?? list[i + 1])!.id;
      pushUnit([{ kind: 'layer-remove', layer: id }]);
    },

    duplicateLayer(id: string): LayerInfo {
      const src = findLayer(id);
      if (!src) throw new Error(`duplicateLayer: レイヤー ${id} がありません`);
      endReplay();
      interruptInput();
      settleTransform();
      const newId = uniqueId();
      active = newId;
      pushUnit([{ kind: 'layer-duplicate', layer: id, newId }]);
      return copyInfo(findLayer(newId)!);
    },

    mergeDown(id: string): void {
      const list = curList();
      const i = list.findIndex((l) => l.id === id);
      if (i <= 0 || list[i - 1]!.locked) return;
      endReplay();
      interruptInput();
      settleTransform();
      if (active === id) active = list[i - 1]!.id;
      pushUnit([{ kind: 'layer-merge-down', layer: id }]);
    },

    moveLayer(id: string, index: number): void {
      const list = curList();
      const i = list.findIndex((l) => l.id === id);
      if (i < 0 || !Number.isFinite(index)) return;
      const to = Math.max(0, Math.min(list.length - 1, Math.round(index)));
      if (to === i) return;
      endReplay();
      settleTransform();
      pushUnit([{ kind: 'layer-move', layer: id, index: to }]);
    },

    setLayer(id: string, patch: Partial<Omit<LayerInfo, 'id'>>): void {
      const cur = findLayer(id);
      if (!cur) return;
      const p = sanitizePatch(patch);
      const changed = (Object.keys(p) as (keyof typeof p)[]).filter((k) => p[k] !== cur[k]);
      if (changed.length === 0) return;
      const clean: Partial<Omit<LayerInfo, 'id'>> = {};
      for (const k of changed) (clean as Record<string, unknown>)[k] = p[k];
      endReplay();
      // 不透明度のスライダーは続けて動かしても 1 手にまとめる
      const lastStart = units[units.length - 1];
      const last = ops[ops.length - 1];
      if (
        changed.length === 1 &&
        changed[0] === 'opacity' &&
        lastStart === ops.length - 1 &&
        redoUnits.length === 0 &&
        last &&
        last.kind === 'layer-set' &&
        last.layer === id &&
        Object.keys(last.patch).length === 1 &&
        'opacity' in last.patch
      ) {
        const listBefore = curList();
        ops[ops.length - 1] = { kind: 'layer-set', layer: id, patch: clean };
        touched(ops.length - 1);
        dispList = curList();
        afterOps(listBefore);
        return;
      }
      pushUnit([{ kind: 'layer-set', layer: id, patch: clean }]);
    },

    clearLayer(id: string): void {
      const l = findLayer(id);
      if (!l || l.locked || !hasContent(id)) return;
      endReplay();
      interruptInput();
      settleTransform();
      pushUnit([{ kind: 'layer-clear', layer: id }]);
    },

    async getLayerThumbnail(id: string, size: number): Promise<Blob> {
      if (typeof document === 'undefined') throw new Error('getLayerThumbnail: document がありません');
      const W0 = docW > 0 ? docW : strokeBounds(ink().strokes).width;
      const H0 = docH > 0 ? docH : strokeBounds(ink().strokes).height;
      const k = Math.max(1, size) / Math.max(1, W0, H0);
      const W = Math.max(1, Math.round(W0 * k));
      const H = Math.max(1, Math.round(H0 * k));
      const out = makeLayer(W, H);
      if (!out) throw new Error('getLayerThumbnail: 2D コンテキストを作れません');
      const bm = !replayState ? bms.get(id) : undefined;
      if (bm && ctx) {
        out.ctx.imageSmoothingEnabled = true;
        out.ctx.drawImage(bm.canvas, 0, 0, W, H);
      } else {
        const r = renderDoc(W, H, { k, ox: 0, oy: 0 }, { ink: inkColor, display: false });
        const l = r?.layers.get(id);
        if (l && r?.list.some((x) => x.id === id)) out.ctx.drawImage(l.canvas, 0, 0);
        freeRendered(r);
      }
      // 乗算・スクリーンのレイヤーは紙色の上での見た目を焼き込む（透明背景のまま、画面と同じ色に見える）
      const info = findLayer(id);
      if (info && info.blend !== 'normal') {
        const img = readPixels(out);
        if (img) {
          bakeOnPaper(img.data, [{ data: new Uint8ClampedArray(img.data), opacity: 1, blend: info.blend }], paperRgb());
          out.ctx.putImageData(img, 0, 0);
        }
      }
      try {
        const b = (await toBlobAsync(out.canvas, 'image/png')) ?? null;
        if (!b) throw new Error('getLayerThumbnail: 画像化に失敗しました');
        return b;
      } finally {
        freeLayer(out);
      }
    },

    // ---------------- 塗りつぶし・スポイト ----------------
    setFill(o: Partial<FillOptions>): void {
      const next = { ...fillOpts };
      if (o.tolerance !== undefined && Number.isFinite(o.tolerance)) next.tolerance = Math.min(255, Math.max(0, Math.round(o.tolerance)));
      if (o.reference === 'layer' || o.reference === 'all') next.reference = o.reference;
      if (next.tolerance !== fillOpts.tolerance || next.reference !== fillOpts.reference) {
        fillOpts = next;
        emitToolChange();
      }
    },
    getFill: () => ({ ...fillOpts }),

    pickColor(x: number, y: number): string | null {
      if (!ctx || !Number.isFinite(x) || !Number.isFinite(y)) return null;
      const px = Math.floor(x * dpr);
      const py = Math.floor(y * dpr);
      if (px < 0 || py < 0 || px >= bmW() || py >= bmH()) return null;
      const one = makeLayer(1, 1);
      if (!one) return null;
      for (const l of dispList) {
        const bm = bms.get(l.id);
        if (!bm || !l.visible) continue;
        one.ctx.globalAlpha = l.opacity;
        one.ctx.globalCompositeOperation = compositeOp(l.blend);
        one.ctx.drawImage(bm.canvas, -px, -py);
      }
      const d = readPixels(one, 0, 0, 1, 1)?.data;
      freeLayer(one);
      if (!d || d[3]! < PICK_MIN_ALPHA) return null;
      // 墨（いまのテーマの墨色）なら記号 'ink' を返す（テーマを変えても墨のまま）
      const ink = cssRgb(inkColor);
      if (ink && Math.max(Math.abs(d[0]! - ink[0]), Math.abs(d[1]! - ink[1]), Math.abs(d[2]! - ink[2])) <= PICK_INK_TOLERANCE) return 'ink';
      return toHex(d[0]!, d[1]!, d[2]!);
    },

    // ---------------- 選択と変形 ----------------
    getSelection: () => {
      const s = selectionShown();
      return s ? copyMask(s) : null;
    },

    setSelection(mask: SelectionMask | null): void {
      settleTransform();
      const next = mask ? sanitizeMask(mask) : null;
      if (next === null && selection === null) return;
      selection = next;
      compose();
      emitSelection();
    },

    selectAll(): void {
      const w = docW > 0 ? docW : cssW;
      const h = docH > 0 ? docH : cssH;
      if (!(w > 0 && h > 0)) return;
      engine.setSelection({ kind: 'rect', x: 0, y: 0, w, h });
    },

    transformSelection(matrix: Mat): void {
      if (!selection || !isFiniteMat(matrix) || replayState) return;
      if (!tf) {
        if (!activeEditable()) return;
        const bm = bms.get(active);
        let base: Layer | null = null;
        let cut: Layer | null = null;
        if (bm && ctx) {
          const env = dispEnv();
          cut = cutMask(bm, selection, env);
          base = env.make();
          if (base) {
            copyLayer(base, bm);
            drawDeleteOp(base, selection, env);
          }
        }
        tf = { layer: active, mask: selection, matrix: [...matrix] as Mat, base, cut };
      } else tf.matrix = [...matrix] as Mat;
      compose();
      emitSelection();
    },

    commitTransform(): void {
      const t = tf;
      if (!t) return;
      cancelTf();
      if (isIdentity(t.matrix)) {
        compose();
        emitSelection();
        return;
      }
      selection = transformMask(t.mask, t.matrix);
      pushUnit([{ kind: 'transform', layer: t.layer, mask: copyMask(t.mask), matrix: [...t.matrix] as Mat }]);
      emitSelection();
    },

    cancelTransform(): void {
      if (!tf) return;
      cancelTf();
      compose();
      emitSelection();
    },

    deleteSelection(): void {
      settleTransform();
      if (!selection || !activeEditable()) return;
      endReplay();
      pushUnit([{ kind: 'delete', layer: active, mask: copyMask(selection) }]);
    },

    isTransforming: () => tf !== null,

    // ---------------- ビュー ----------------
    getView: () => ({ ...view }),

    setView(patch: Partial<ViewState>): void {
      const next: ViewState = { ...view };
      if (patch.zoom !== undefined) next.zoom = clampZoom(patch.zoom);
      if (patch.panX !== undefined && Number.isFinite(patch.panX)) next.panX = patch.panX;
      if (patch.panY !== undefined && Number.isFinite(patch.panY)) next.panY = patch.panY;
      if (patch.rotationDeg !== undefined) next.rotationDeg = normalizeDeg(patch.rotationDeg);
      if (next.zoom === view.zoom && next.panX === view.panX && next.panY === view.panY && next.rotationDeg === view.rotationDeg) return;
      view = next;
      invalidateHires(HIRES_VIEW_DELAY);
      compose();
      emitView();
    },

    resetView(): void {
      engine.setView({ ...DEFAULT_VIEW });
    },

    fitView(): void {
      // 紙が画面に収まるなら 100%
      if (!(docW > 0 && docH > 0 && cssW > 0 && cssH > 0) || (docW <= cssW + 0.5 && docH <= cssH + 0.5)) {
        engine.setView({ ...DEFAULT_VIEW });
        return;
      }
      // 紙は画面より大きい（画面を回したあとなど）: 描いた内容が収まるなら 100% で内容が見える位置へ
      const c = quickContentBox();
      if (!c || (c.x >= 0 && c.y >= 0 && c.x + c.width <= cssW && c.y + c.height <= cssH)) {
        engine.setView({ ...DEFAULT_VIEW });
        return;
      }
      if (c.width <= cssW && c.height <= cssH) {
        const panX = Math.min(0, Math.max(cssW - docW, cssW / 2 - (c.x + c.width / 2)));
        const panY = Math.min(0, Math.max(cssH - docH, cssH / 2 - (c.y + c.height / 2)));
        engine.setView({ zoom: 1, panX, panY, rotationDeg: 0 });
        return;
      }
      // 収まらないときだけ縮小（紙全体）
      engine.setView(fitViewFor(docW, docH, cssW, cssH));
    },

    toCanvasPoint(clientX: number, clientY: number): { x: number; y: number } {
      if (!canvas) return { x: clientX, y: clientY };
      return toPoint({ clientX, clientY });
    },

    toClientPoint(x: number, y: number): { x: number; y: number } {
      if (!canvas) return { x, y };
      const rect = canvas.getBoundingClientRect();
      const s = isIdentityView(view) ? { x, y } : apply(viewMatrix(view), x, y);
      const sx = opts.flipped ? rect.width - s.x : s.x;
      return { x: sx + rect.left, y: s.y + rect.top };
    },

    // ---------------- 文書 ----------------
    getDocument(): CanvasDocument {
      return {
        v: 2,
        width: docW,
        height: docH,
        layers: baseList.map(copyInfo),
        active,
        ops: ops.map((op) => exportOp(op, opts.baseWidth)),
      };
    },

    loadDocument(doc: CanvasDocument): void {
      const d = sanitizeDocument(doc);
      if (!d) throw new Error('loadDocument: レイヤーがありません');
      resetDocument(d.layers, d.ops, d.active, d.width, d.height);
    },
  };

  return engine;
}

function preventDefault(e: Event): void {
  e.preventDefault();
}
