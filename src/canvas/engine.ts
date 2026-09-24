/**
 * キャンバス描画エンジン（契約 1）。
 * createCanvasEngine() は DOM に触らない。attach(host) で初めて <canvas> を作る。
 *
 * 表示の重ね順: 紙 → 完了ストローク（オフスクリーン cache、透明背景）→ 進行中ストローク（live レイヤー）→ 重ね（overlay）
 *   → 消しゴムの輪 → グリッド。左右反転は「紙〜重ね・消しゴムの輪」だけに掛け、グリッドは画面座標に固定。
 * 不透明度 < 1・multiply・筆圧で濃淡が変わるペンは、1 本ずつ別レイヤー（scratch）に描いてから合成する
 * （区間の継ぎ目が濃くならないように）。
 * 消しゴムは普通のラスター消しゴム: 消しゴムストロークを cache に destination-out の丸い線（半径 size）で描く。
 * 紙は cache に含めないので、消した所は紙が見える。
 * 補助線（tool 'guide'、StrokeStyle.preset 'guide'）は ink-2 色・幅 1.5px・不透明度 0.35 の細線。
 * 見た目・再生・書き出しには含めるが、getStrokes()/getStyles() には出さず（採点・本数から除く）、strokeend も出さない。
 * シルエット表示では出さない。
 */
import type { Drawing, Stroke, StrokePoint, Vec2 } from '@/scoring/types';
import type {
  CanvasEngine,
  CanvasOptions,
  EraserStyle,
  OverlaySpec,
  PenStyle,
  StrokeHistory,
  StrokeStyle,
  Tool,
  ToWebpOptions,
} from './types';
import { UndoStack } from './history';
import { normalizePressure, quadSegmentAt, shouldAppend, tailSegment } from './smooth';
import { buildReplaySchedule, visibleCounts, type ReplaySchedule } from './replay';
import { resolveColor } from './color';
import { cropRect, exportScale, type Rect } from './crop';
import { flattenHistory } from './erase';
import { GRID_COLOR, gridLines, normalizeGrid, sameGrid } from './grid';
import {
  DEFAULT_ERASER,
  DEFAULT_PEN,
  PEN_PRESETS,
  clampEraserSize,
  clampOpacity,
  clampPenSize,
  cumulativeLength,
  eraserStrokeStyle,
  guideStrokeStyle,
  isEraserStyle,
  isGuideStyle,
  isPenPreset,
  jitterPoints,
  maxPenWidth,
  needsLayer,
  normalizeHexColor,
  penAlpha,
  penWidth,
  resolvePen,
  sanitizeStyle,
  silhouettePen,
  styleFromPen,
  taperFactor,
  taperLength,
  type ResolvedPen,
} from './pen';

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
};

/** CSS 変数が未定義のときの色（DESIGN_BRIEF_UI: 薄いウォームグレーの紙、墨色） */
const FALLBACK_PAPER = '#f3f0ea';
const FALLBACK_INK = '#2b2926';
/** 補助線の色（--color-ink-2）が未定義のとき */
const FALLBACK_GUIDE = '#5f5b54';
const GUIDE_COLOR_VAR = 'var(--color-ink-2)';
const SILHOUETTE_PAPER = '#ffffff';
const SILHOUETTE_INK = '#000000';
/** 読み込んだ絵の続きを描くときにあける時間（ms） */
const RESUME_GAP_MS = 300;

type Ctx = CanvasRenderingContext2D;
type Styles = (StrokeStyle | undefined)[];

/** 履歴 1 手ぶんの状態（消しゴムストロークを含む生の履歴）。strokes と styles は同じ長さ・同じ並び。 */
interface Doc {
  strokes: Drawing;
  styles: Styles;
}

/** 描画用に解決済みの見た目。 */
interface Paint {
  color: string;
  pen: ResolvedPen;
}

/** CSS px → デバイス px の変換（dev = css × k + o）。 */
interface Xf {
  k: number;
  ox: number;
  oy: number;
}

interface Layer {
  canvas: HTMLCanvasElement;
  ctx: Ctx;
}

interface LiveInput {
  pointerId: number;
  tool: Tool;
  points: StrokePoint[];
  /** 描画済みの最後の制御点インデックス（0 = まだ何も描いていない） */
  drawnCtrl: number;
  dotDrawn: boolean;
  /** 消しゴムの輪を出す位置（最後の入力位置） */
  lastEraserPt: Vec2 | null;
  /** 消しゴム: cache に消し込んだ点の数 */
  erasedPts: number;
  style: StrokeStyle;
}

interface ReplayState {
  doc: Doc;
  schedule: ReplaySchedule;
  start: number;
  /** cache に完成形を描き終えたストローク数（先頭から） */
  committed: number;
  /** live レイヤーに途中まで描いているストローク（-1 = なし）。消しゴムは cache に直接消し込む */
  partial: number;
  /** ペン: 描いた制御点の番号。消しゴム: cache に消し込んだ点の数 */
  partialCtrl: number;
  partialDot: boolean;
  raf: number;
  resolve: () => void;
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
 * getStrokes()/getStyles() だけを受け取る保存処理が、呼び出し側を変えずに消しゴム込みの履歴も残せるようにするためのもの。
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

/* ------------------------------------------------------------------ */
/* ストロークの描画（ctx の変換は呼び出し側で設定済み）                    */
/* ------------------------------------------------------------------ */

/** 描画用に前処理した点列（ざらつき適用後）と入り抜き用の弧長。 */
interface Geom {
  pts: readonly StrokePoint[];
  cum: number[] | null;
  total: number | null;
  len: number;
}

/** final: 終点が確定している（完了ストローク）。false なら始点側だけ入り抜きを掛ける。 */
function geom(pts: readonly StrokePoint[], rp: ResolvedPen, final: boolean): Geom {
  const jp = jitterPoints(pts, rp.grain);
  if (!rp.taper) return { pts: jp, cum: null, total: null, len: 0 };
  const cum = cumulativeLength(jp);
  const L = cum[cum.length - 1] ?? 0;
  return { pts: jp, cum, total: final ? L : null, len: final ? taperLength(rp, L) : rp.size * 6 };
}

function prep(c: Ctx, color: string): void {
  c.strokeStyle = color;
  c.fillStyle = color;
  c.lineCap = 'round';
  c.lineJoin = 'round';
}

function setAlpha(c: Ctx, rp: ResolvedPen, p: number, mul: number): void {
  if (rp.pressureOpacity[0] !== rp.pressureOpacity[1]) c.globalAlpha = mul * penAlpha(rp, p);
}

/** 制御点 (from, to] の区間を描く。 */
function drawRange(c: Ctx, g: Geom, rp: ResolvedPen, from: number, to: number, mul: number): void {
  if (to <= from) return;
  for (let k = Math.max(1, from + 1); k <= to; k++) {
    const seg = quadSegmentAt(g.pts, k);
    if (!seg) continue;
    const f = g.cum ? taperFactor(rp, g.cum[k] ?? 0, g.total, g.len) : 1;
    setAlpha(c, rp, seg.p, mul);
    c.beginPath();
    c.moveTo(seg.from.x, seg.from.y);
    c.quadraticCurveTo(seg.ctrl.x, seg.ctrl.y, seg.to.x, seg.to.y);
    c.lineWidth = penWidth(rp, seg.p) * f;
    c.stroke();
  }
}

/** 末尾区間（1 点なら点）を描く。 */
function drawTail(c: Ctx, g: Geom, rp: ResolvedPen, mul: number): void {
  const pts = g.pts;
  const only = pts.length === 1 ? pts[0] : undefined;
  if (only) {
    setAlpha(c, rp, only.p, mul);
    c.beginPath();
    c.arc(only.x, only.y, penWidth(rp, only.p) / 2, 0, Math.PI * 2);
    c.fill();
    return;
  }
  const tail = tailSegment(pts);
  if (!tail) return;
  const n = pts.length;
  const s = g.cum ? ((g.cum[n - 2] ?? 0) + (g.cum[n - 1] ?? 0)) / 2 : 0;
  const f = g.cum ? taperFactor(rp, s, g.total, g.len) : 1;
  setAlpha(c, rp, tail.p, mul);
  c.beginPath();
  c.moveTo(tail.from.x, tail.from.y);
  c.quadraticCurveTo(tail.ctrl.x, tail.ctrl.y, tail.to.x, tail.to.y);
  c.lineWidth = penWidth(rp, tail.p) * f;
  c.stroke();
}

/**
 * 消しゴムストロークの点 [from, to) を c から消す（destination-out・半径 radius の丸い線）。
 * from > 0 なら点 from-1 からつなぐ。点が 1 個だけなら円。c は変換なし（デバイス px）を前提に xf で CSS px を写す。
 * 終わると c の変換・globalAlpha・合成方法は既定に戻っている。
 */
function paintEraser(c: Ctx, pts: readonly StrokePoint[], radius: number, xf: Xf, from = 0, to = pts.length): void {
  const end = Math.min(to, pts.length);
  if (end <= from || end === 0) return;
  c.setTransform(xf.k, 0, 0, xf.k, xf.ox, xf.oy);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'destination-out';
  prep(c, '#000');
  const start = Math.max(0, from - 1);
  const first = pts[start]!;
  if (end - start === 1) {
    c.beginPath();
    c.arc(first.x, first.y, radius, 0, Math.PI * 2);
    c.fill();
  } else {
    c.lineWidth = radius * 2;
    c.beginPath();
    c.moveTo(first.x, first.y);
    for (let i = start + 1; i < end; i++) c.lineTo(pts[i]!.x, pts[i]!.y);
    c.stroke();
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-over';
}

/**
 * 完了ストローク 1 本を c に描く。c は変換なし（デバイス px）を前提に xf で CSS px を写す。
 * 重なりを避けたいペンは scratch（c と同じ大きさ以上）に描いてから opacity と blend で合成する。
 * 終わると c の変換・globalAlpha・合成方法は既定（恒等・1・source-over）に戻っている。
 */
function paintStroke(c: Ctx, pts: readonly StrokePoint[], paint: Paint, xf: Xf, scratch: Layer | null, size: { w: number; h: number }): void {
  if (pts.length === 0) return;
  const rp = paint.pen;
  const g = geom(pts, rp, true);
  if (!needsLayer(rp) || !scratch) {
    c.setTransform(xf.k, 0, 0, xf.k, xf.ox, xf.oy);
    c.globalAlpha = rp.opacity;
    if (rp.blend !== 'source-over') c.globalCompositeOperation = rp.blend;
    prep(c, paint.color);
    drawRange(c, g, rp, 0, g.pts.length - 2, rp.opacity);
    drawTail(c, g, rp, rp.opacity);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    if (rp.blend !== 'source-over') c.globalCompositeOperation = 'source-over';
    return;
  }
  // 範囲（デバイス px）
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const q of g.pts) {
    if (q.x < minX) minX = q.x;
    if (q.y < minY) minY = q.y;
    if (q.x > maxX) maxX = q.x;
    if (q.y > maxY) maxY = q.y;
  }
  const pad = maxPenWidth(rp) / 2 + 2;
  const bx = Math.max(0, Math.floor((minX - pad) * xf.k + xf.ox));
  const by = Math.max(0, Math.floor((minY - pad) * xf.k + xf.oy));
  const ex = Math.min(size.w, Math.ceil((maxX + pad) * xf.k + xf.ox));
  const ey = Math.min(size.h, Math.ceil((maxY + pad) * xf.k + xf.oy));
  if (!(ex > bx && ey > by)) return;
  const sc = scratch.ctx;
  sc.setTransform(1, 0, 0, 1, 0, 0);
  sc.globalAlpha = 1;
  sc.globalCompositeOperation = 'source-over';
  sc.clearRect(bx, by, ex - bx, ey - by);
  sc.setTransform(xf.k, 0, 0, xf.k, xf.ox, xf.oy);
  prep(sc, paint.color);
  drawRange(sc, g, rp, 0, g.pts.length - 2, 1);
  drawTail(sc, g, rp, 1);
  sc.globalAlpha = 1;
  sc.setTransform(1, 0, 0, 1, 0, 0);
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = rp.opacity;
  c.globalCompositeOperation = rp.blend;
  c.drawImage(scratch.canvas, bx, by, ex - bx, ey - by, bx, by, ex - bx, ey - by);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
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

  const history = new UndoStack<Doc>({ strokes: [], styles: [] });
  const current = (): Doc => history.present;
  /** 履歴 → ペンだけの点列（消しゴムで消えた点を除く）。Doc ごとに 1 回だけ計算する */
  const flatMemo = new WeakMap<Doc, Doc>();
  function flat(doc: Doc): Doc {
    let f = flatMemo.get(doc);
    if (!f) {
      f = flattenHistory(doc.strokes, doc.styles);
      flatMemo.set(doc, f);
    }
    return f;
  }

  let overlay: OverlaySpec | null = null;
  let overlayImg: HTMLImageElement | null = null;
  let overlayToken = 0;

  const strokeEndCbs = new Set<(s: Stroke) => void>();
  const changeCbs = new Set<() => void>();
  const toolChangeCbs = new Set<() => void>();

  // --- DOM 状態（attach 後のみ） ---
  let host: HTMLElement | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let ctx: Ctx | null = null;
  /** 紙＋完了ストローク */
  let cache: Layer | null = null;
  /** 進行中ストローク（入力・再生） */
  let liveLayer: Layer | null = null;
  /** 1 本ずつ合成するための作業用 */
  let scratch: Layer | null = null;
  /** 進行中の multiply ペンを「完了ストロークだけ」に掛けるための合成用（必要なときだけ作る） */
  let mix: Layer | null = null;
  let ro: ResizeObserver | null = null;
  let dprMql: MediaQueryList | null = null;
  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  let paper = FALLBACK_PAPER;
  let ink = FALLBACK_INK;
  let guideInk = FALLBACK_GUIDE;

  let live: LiveInput | null = null;
  /** 消しゴム選択中にペン／マウスが紙の上にある位置（輪を出す） */
  let hoverPt: Vec2 | null = null;
  /** live レイヤーに何か描いてあり、合成に使う見た目 */
  let livePaint: Paint | null = null;
  let rafId = 0;
  let fullDirty = false;
  let composeDirty = false;
  let timeOrigin: number | null = null;
  let replayState: ReplayState | null = null;

  // ---------- 色・スタイル ----------
  function lookupVar(name: string): string {
    if (typeof getComputedStyle === 'undefined') return '';
    const el = host ?? (typeof document !== 'undefined' ? document.documentElement : null);
    if (!el) return '';
    return getComputedStyle(el).getPropertyValue(name);
  }
  function resolveColors(): void {
    paper = resolveColor(opts.paperColor, lookupVar, FALLBACK_PAPER);
    ink = resolveColor(opts.inkColor, lookupVar, FALLBACK_INK);
    guideInk = resolveColor(GUIDE_COLOR_VAR, lookupVar, FALLBACK_GUIDE);
  }
  /** 書き出し・重ね用（シルエットを無視） */
  function normalPaint(style: StrokeStyle | undefined): Paint {
    if (isGuideStyle(style)) return { color: guideInk, pen: resolvePen(style, opts.baseWidth) };
    return { color: style?.color ?? ink, pen: resolvePen(style, opts.baseWidth) };
  }
  /** 画面表示用（シルエット中は太い黒） */
  function viewPaint(style: StrokeStyle | undefined): Paint {
    const p = normalPaint(style);
    if (!opts.silhouette || isGuideStyle(style)) return p;
    return { color: SILHOUETTE_INK, pen: silhouettePen(p.pen) };
  }

  // ---------- イベント ----------
  function emitChange(): void {
    for (const cb of [...changeCbs]) cb();
  }
  function emitToolChange(): void {
    for (const cb of [...toolChangeCbs]) cb();
  }

  // ---------- レイヤー ----------
  function makeLayer(w: number, h: number): Layer | null {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const c = cv.getContext('2d');
    return c ? { canvas: cv, ctx: c } : null;
  }
  function devSize(): { w: number; h: number } {
    return { w: canvas?.width ?? 0, h: canvas?.height ?? 0 };
  }
  function clearLayer(l: Layer | null): void {
    if (!l) return;
    l.ctx.setTransform(1, 0, 0, 1, 0, 0);
    l.ctx.globalAlpha = 1;
    l.ctx.clearRect(0, 0, l.canvas.width, l.canvas.height);
  }

  // ---------- 描画 ----------
  function applyView(c: Ctx): void {
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (opts.flipped) c.transform(-1, 0, 0, 1, cssW, 0);
  }

  function paintCacheStroke(i: number, doc: Doc): void {
    if (!cache) return;
    const s = doc.strokes[i];
    if (!s) return;
    const st = doc.styles[i];
    if (isEraserStyle(st)) {
      paintEraser(cache.ctx, s, st.size, { k: dpr, ox: 0, oy: 0 });
      return;
    }
    // 補助線はシルエット（形だけを見る表示）には出さない
    if (isGuideStyle(st) && opts.silhouette) return;
    paintStroke(cache.ctx, s, viewPaint(st), { k: dpr, ox: 0, oy: 0 }, scratch, devSize());
  }

  /** cache を透明にして、doc の先頭 upto 本（消しゴムを含む）を描く。紙は compose で塗る。 */
  function rebuildCache(doc: Doc = current(), upto = doc.strokes.length): void {
    if (!cache) return;
    const c = cache.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, cache.canvas.width, cache.canvas.height);
    for (let i = 0; i < upto; i++) paintCacheStroke(i, doc);
  }

  /** 進行中の消しゴムの、まだ消し込んでいない点を cache から消す。 */
  function eraseLiveIncrement(): void {
    if (!live || live.tool !== 'eraser' || !cache) return;
    const n = live.points.length;
    if (n <= live.erasedPts) return;
    paintEraser(cache.ctx, live.points, live.style.size, { k: dpr, ox: 0, oy: 0 }, live.erasedPts, n);
    live.erasedPts = n;
    composeDirty = true;
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

  /** 消しゴムの輪（半径 = size）。なぞっている間と、ペン／マウスが紙の上にある間に出す。 */
  function drawEraserRing(c: Ctx): void {
    const pt = live ? (live.tool === 'eraser' ? live.lastEraserPt : null) : tool === 'eraser' && !replayState ? hoverPt : null;
    if (!pt) return;
    applyView(c);
    c.globalAlpha = 0.45;
    c.strokeStyle = opts.silhouette ? SILHOUETTE_INK : ink;
    c.lineWidth = 1 / Math.max(1, dpr);
    c.beginPath();
    c.arc(pt.x, pt.y, eraser.size, 0, Math.PI * 2);
    c.stroke();
    c.globalAlpha = 1;
  }

  /** 全層を合成し直す（cache は作り直さない）。 */
  function compose(): void {
    if (!ctx || !canvas) return;
    composeDirty = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = opts.silhouette ? SILHOUETTE_PAPER : paper;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    applyView(ctx);
    if (livePaint && liveLayer && cache && livePaint.pen.blend !== 'source-over') {
      // multiply 等は紙ではなく完了ストロークにだけ掛ける（確定後の cache と同じ見た目にする）
      if (!mix || mix.canvas.width !== cache.canvas.width || mix.canvas.height !== cache.canvas.height) {
        mix = makeLayer(cache.canvas.width, cache.canvas.height);
      }
      if (mix) {
        const m = mix.ctx;
        clearLayer(mix);
        m.drawImage(cache.canvas, 0, 0);
        m.globalAlpha = livePaint.pen.opacity;
        m.globalCompositeOperation = livePaint.pen.blend;
        m.drawImage(liveLayer.canvas, 0, 0);
        m.globalAlpha = 1;
        m.globalCompositeOperation = 'source-over';
        ctx.drawImage(mix.canvas, 0, 0, cssW, cssH);
        drawOverlay(ctx);
        drawEraserRing(ctx);
        drawGrid(ctx);
        return;
      }
    }
    if (cache) ctx.drawImage(cache.canvas, 0, 0, cssW, cssH);
    if (livePaint && liveLayer) {
      ctx.globalAlpha = livePaint.pen.opacity;
      if (livePaint.pen.blend !== 'source-over') ctx.globalCompositeOperation = livePaint.pen.blend;
      ctx.drawImage(liveLayer.canvas, 0, 0, cssW, cssH);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    drawOverlay(ctx);
    drawEraserRing(ctx);
    drawGrid(ctx);
  }

  function fullRedraw(): void {
    rebuildCache();
    // なぞっている途中の消しゴムは履歴にまだ無いので、描き直したら消し込み直す
    if (live && live.tool === 'eraser') {
      live.erasedPts = 0;
      eraseLiveIncrement();
    }
    compose();
  }

  /** 進行中のペン入力の新しい区間を live レイヤーに描き足す。描いたら true。 */
  function drawLiveIncrement(): boolean {
    if (!live || live.tool === 'eraser' || !liveLayer || !livePaint) return false;
    const rp = livePaint.pen;
    const n = live.points.length;
    const ready = n - 2;
    const c = liveLayer.ctx;
    if (ready > live.drawnCtrl) {
      if (live.dotDrawn) {
        clearLayer(liveLayer);
        live.drawnCtrl = 0;
        live.dotDrawn = false;
      }
      const g = geom(live.points, rp, false);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      prep(c, livePaint.color);
      drawRange(c, g, rp, live.drawnCtrl, ready, 1);
      c.globalAlpha = 1;
      live.drawnCtrl = ready;
      return true;
    }
    if (n >= 1 && live.drawnCtrl === 0 && !live.dotDrawn) {
      // まだ区間が確定していない: 1 点目を点として見せる
      const g = geom(live.points.slice(0, 1), rp, false);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      prep(c, livePaint.color);
      drawTail(c, g, rp, 1);
      c.globalAlpha = 1;
      live.dotDrawn = true;
      return true;
    }
    return false;
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
  function resize(): void {
    if (!host || !canvas || !cache) return;
    const w = host.clientWidth;
    const h = host.clientHeight;
    const nd = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    if (w === cssW && h === cssH && nd === dpr && canvas.width > 0) return;
    cssW = w;
    cssH = h;
    dpr = nd;
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    canvas.width = pw;
    canvas.height = ph;
    mix = null;
    for (const l of [cache, liveLayer, scratch]) {
      if (!l) continue;
      l.canvas.width = pw;
      l.canvas.height = ph;
    }
    if (live && live.tool !== 'eraser') {
      // 大きさが変わると live レイヤーは消えるので描き直す
      live.drawnCtrl = 0;
      live.dotDrawn = false;
      drawLiveIncrement();
    }
    if (replayState) {
      rebuildCache(replayState.doc, replayState.committed);
      replayState.partialCtrl = 0;
      replayState.partialDot = false;
      clearLayer(liveLayer);
      drawReplayPartial(replayState);
      compose();
      return;
    }
    fullRedraw();
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

  // ---------- 入力 ----------
  function toPoint(e: PointerEvent): Vec2 {
    const rect = canvas!.getBoundingClientRect();
    let x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (opts.flipped) x = rect.width - x;
    return { x, y };
  }

  function allowed(e: PointerEvent): boolean {
    if (e.pointerType === 'mouse' && e.button !== 0) return false;
    if (!opts.penOnly) return true;
    if (e.pointerType === 'pen') return true;
    if (e.pointerType === 'mouse') return opts.allowMouse;
    return false;
  }

  function timeOf(e: PointerEvent): number {
    if (timeOrigin === null) {
      let lastT = -RESUME_GAP_MS;
      for (const s of current().strokes) for (const p of s) if (Number.isFinite(p.t) && p.t > lastT) lastT = p.t;
      timeOrigin = e.timeStamp - (lastT + RESUME_GAP_MS);
    }
    return Math.max(0, e.timeStamp - timeOrigin);
  }

  /**
   * 消しゴムの軌跡（半径 r）が、いま見えている線（ペン、シルエット中は太い線）に届きうるか。
   * 届かない消しゴムは履歴に積まない（何も無い所をなぞっても Undo の手数が増えないように）。
   */
  function eraserTouchesInk(pts: readonly StrokePoint[], r: number): boolean {
    if (pts.length === 0) return false;
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
    const doc = current();
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
      // 線分どうしの距離（端点と線分の距離の最小）で詳しく見る
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

  function onDown(e: PointerEvent): void {
    if (!canvas || replayState || live) return;
    if (!allowed(e)) return;
    e.preventDefault();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* 一部環境では失敗するが描画は続けられる */
    }
    const style = tool === 'eraser' ? eraserStrokeStyle(eraser.size) : tool === 'guide' ? guideStrokeStyle() : styleFromPen(pen);
    live = { pointerId: e.pointerId, tool, points: [], drawnCtrl: 0, dotDrawn: false, lastEraserPt: null, erasedPts: 0, style };
    clearLayer(liveLayer);
    livePaint = tool === 'eraser' ? null : viewPaint(style);
    addSample(e);
    schedule();
  }

  function onMove(e: PointerEvent): void {
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

  function finish(e: PointerEvent, cancelled: boolean): void {
    if (!live || e.pointerId !== live.pointerId) return;
    if (!cancelled) addSample(e);
    const l = live;
    live = null;
    livePaint = null;
    clearLayer(liveLayer);
    if (l.tool === 'eraser') {
      stopFrame();
      hoverPt = e.pointerType === 'touch' || cancelled ? null : l.lastEraserPt;
      if (eraserTouchesInk(l.points, l.style.size)) {
        // cache には消し込み済み。1 回なぞる（down〜up）で 1 操作
        const prev = history.present;
        history.commit({ strokes: [...prev.strokes, l.points], styles: [...prev.styles, l.style] });
        if (fullDirty) {
          fullDirty = false;
          fullRedraw();
        } else compose();
        emitChange();
      } else {
        fullDirty = false;
        fullRedraw();
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
    const prev = history.present;
    const next: Doc = { strokes: [...prev.strokes, stroke], styles: [...prev.styles, l.style] };
    history.commit(next);
    stopFrame();
    if (fullDirty) {
      fullDirty = false;
      fullRedraw();
    } else {
      paintCacheStroke(next.strokes.length - 1, next);
      compose();
    }
    // 補助線は採点しないので strokeend を出さない（change だけ）
    if (l.tool !== 'guide') for (const cb of [...strokeEndCbs]) cb(stroke);
    emitChange();
  }

  const onUp = (e: PointerEvent): void => finish(e, false);
  const onCancel = (e: PointerEvent): void => finish(e, true);
  const onLeave = (): void => {
    if (!hoverPt) return;
    hoverPt = null;
    composeDirty = true;
    schedule();
  };

  // ---------- 再生 ----------
  /** 再生中のストローク（partial）の、まだ描いていない部分を live レイヤーに描く。 */
  function drawReplayPartial(st: ReplayState): void {
    if (st.partial < 0 || !liveLayer) return;
    const s = st.doc.strokes[st.partial];
    if (!s) return;
    const n = Math.min(s.length, visibleCounts(st.schedule, performance.now() - st.start)[st.partial] ?? 0);
    const style = st.doc.styles[st.partial];
    if (isEraserStyle(style)) {
      // 消しゴムは cache から直接消していく
      livePaint = null;
      if (cache && n > st.partialCtrl) {
        paintEraser(cache.ctx, s, style.size, { k: dpr, ox: 0, oy: 0 }, st.partialCtrl, n);
        st.partialCtrl = n;
      }
      return;
    }
    if (isGuideStyle(style) && opts.silhouette) {
      livePaint = null;
      return;
    }
    const paint = viewPaint(style);
    livePaint = paint;
    const c = liveLayer.ctx;
    const pts = s.slice(0, n);
    const ready = n - 2;
    if (ready > st.partialCtrl) {
      if (st.partialDot) {
        clearLayer(liveLayer);
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

  function endReplay(): void {
    const st = replayState;
    if (!st) return;
    replayState = null;
    if (st.raf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(st.raf);
    livePaint = null;
    clearLayer(liveLayer);
    fullRedraw();
    st.resolve();
  }

  function replayStep(): void {
    const st = replayState;
    if (!st || !ctx) return;
    st.raf = 0;
    const elapsed = performance.now() - st.start;
    const counts = visibleCounts(st.schedule, elapsed);
    const strokes = st.doc.strokes;
    // 描き終わったストロークは完成形を cache へ
    while (st.committed < strokes.length && (counts[st.committed] ?? 0) >= strokes[st.committed]!.length) {
      if (st.partial === st.committed) {
        st.partial = -1;
        livePaint = null;
        clearLayer(liveLayer);
      }
      paintCacheStroke(st.committed, st.doc);
      st.committed++;
    }
    const next = st.committed;
    if (next < strokes.length && (counts[next] ?? 0) > 0) {
      if (st.partial !== next) {
        st.partial = next;
        st.partialCtrl = 0;
        st.partialDot = false;
        clearLayer(liveLayer);
      }
      drawReplayPartial(st);
    }
    if (elapsed >= st.schedule.total) {
      endReplay();
      return;
    }
    compose();
    st.raf = requestAnimationFrame(replayStep);
  }

  // ---------- 公開 API ----------
  function interruptInput(): void {
    if (live) {
      const wasEraser = live.tool === 'eraser';
      live = null;
      livePaint = null;
      clearLayer(liveLayer);
      // 消し込み途中の cache を履歴どおりに戻す
      if (wasEraser) fullRedraw();
    }
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
      cache = makeLayer(0, 0);
      liveLayer = makeLayer(0, 0);
      scratch = makeLayer(0, 0);
      c.addEventListener('pointerdown', onDown);
      c.addEventListener('pointermove', onMove);
      c.addEventListener('pointerup', onUp);
      c.addEventListener('pointercancel', onCancel);
      c.addEventListener('pointerleave', onLeave);
      c.addEventListener('contextmenu', preventDefault);
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
        canvas.remove();
      }
      canvas = null;
      ctx = null;
      cache = null;
      liveLayer = null;
      scratch = null;
      mix = null;
      hoverPt = null;
      host = null;
    },

    setTool(t: Tool): void {
      if (tool === t) return;
      tool = t;
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
      if (
        prev.preset !== next.preset ||
        prev.size !== next.size ||
        prev.opacity !== next.opacity ||
        prev.color !== next.color
      ) {
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
      const prevInk = ink;
      if (patch.paperColor !== undefined || patch.inkColor !== undefined) resolveColors();
      const strokeLook =
        prevPaper !== paper ||
        prevInk !== ink ||
        prev.baseWidth !== opts.baseWidth ||
        prev.silhouette !== opts.silhouette;
      const view = strokeLook || !sameGrid(prev.grid, opts.grid) || prev.flipped !== opts.flipped;
      if (strokeLook) {
        if (replayState) {
          rebuildCache(replayState.doc, replayState.committed);
          compose();
        } else fullRedraw();
      } else if (view) compose();
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
      if (history.undo() === undefined) return;
      fullRedraw();
      emitChange();
    },

    redo(): void {
      endReplay();
      interruptInput();
      if (history.redo() === undefined) return;
      fullRedraw();
      emitChange();
    },

    clear(): void {
      endReplay();
      interruptInput();
      if (history.present.strokes.length === 0) return;
      history.commit({ strokes: [], styles: [] });
      fullRedraw();
      emitChange();
    },

    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),

    getStrokes: () => copyDrawing(flat(current()).strokes),

    getStyles(): (StrokeStyle | undefined)[] {
      const doc = current();
      const out = flat(doc).styles.map(copyStyle);
      // 返した配列から、同じ時点の生の履歴を引けるようにする（historyOf。保存側が消しゴム込みで残すため）
      historyByStyles.set(out, doc);
      return out;
    },

    getHistory: () => docToHistory(current()),

    loadHistory(h: { strokes: Drawing; styles?: (StrokeStyle | undefined)[] }): void {
      engine.loadStrokes(h.strokes, h.styles);
    },

    loadStrokes(d: Drawing, styles?: (StrokeStyle | undefined)[]): void {
      endReplay();
      interruptInput();
      const strokes = copyDrawing(d);
      const st: Styles = strokes.map((_, i) => sanitizeStyle(styles?.[i]));
      history.reset({ strokes, styles: st });
      timeOrigin = null;
      fullRedraw();
      emitChange();
    },

    replay(o: { speed: number }): Promise<void> {
      endReplay();
      interruptInput();
      if (!ctx || typeof requestAnimationFrame === 'undefined') return Promise.resolve();
      const doc = current();
      const sched = buildReplaySchedule(doc.strokes, { speed: o.speed });
      return new Promise<void>((resolve) => {
        replayState = {
          doc,
          schedule: sched,
          start: performance.now(),
          committed: 0,
          partial: -1,
          partialCtrl: 0,
          partialDot: false,
          raf: 0,
          resolve,
        };
        rebuildCache(doc, 0);
        clearLayer(liveLayer);
        compose();
        replayStep();
      });
    },

    cancelReplay(): void {
      endReplay();
    },

    toWebp(maxEdge: number, quality = 0.85, o?: ToWebpOptions): Promise<Blob> {
      if (typeof document === 'undefined') return Promise.reject(new Error('toWebp: document がありません'));
      if (!host) resolveColors();
      const doc = current();
      const visible = flat(doc);
      const crop = o?.crop ?? true;
      // 切り詰めは「消しゴムで消えた点を除いた線」の範囲
      const cropped = crop ? cropRect(visible.strokes, opts.baseWidth, visible.styles) : null;
      let rect: Rect;
      if (cropped) {
        rect = cropped;
      } else {
        const sz = cssW > 0 && cssH > 0 ? { width: cssW, height: cssH } : strokeBounds(visible.strokes);
        rect = { x: 0, y: 0, width: Math.max(1, sz.width), height: Math.max(1, sz.height) };
      }
      const k = exportScale(rect, maxEdge, dpr, cropped !== null);
      const W = Math.max(1, Math.round(rect.width * k));
      const H = Math.max(1, Math.round(rect.height * k));
      const paints = doc.styles.map((s) => (isEraserStyle(s) ? null : normalPaint(s)));
      // 作業用レイヤーは必要なときだけ（出力 canvas より先に作る）。線は透明な層に描いて（消しゴム込み）紙に重ねる
      const layer = paints.some((p) => p !== null && needsLayer(p.pen)) ? makeLayer(W, H) : null;
      const inkLayer = makeLayer(W, H);
      const out = document.createElement('canvas');
      out.width = W;
      out.height = H;
      const c = out.getContext('2d');
      if (!c || !inkLayer) return Promise.reject(new Error('toWebp: 2D コンテキストを作れません'));
      const xf: Xf = { k, ox: -rect.x * k, oy: -rect.y * k };
      doc.strokes.forEach((s, i) => {
        const p = paints[i];
        const st = doc.styles[i];
        if (p) paintStroke(inkLayer.ctx, s, p, xf, layer, { w: W, h: H });
        else if (isEraserStyle(st)) paintEraser(inkLayer.ctx, s, st.size, xf);
      });
      c.fillStyle = paper;
      c.fillRect(0, 0, out.width, out.height);
      c.drawImage(inkLayer.canvas, 0, 0);
      return new Promise<Blob>((resolve, reject) => {
        out.toBlob(
          (b) => {
            if (b) {
              resolve(b);
              return;
            }
            out.toBlob((png) => (png ? resolve(png) : reject(new Error('toWebp: 画像化に失敗しました'))), 'image/png');
          },
          'image/webp',
          quality,
        );
      });
    },

    size: () => ({ width: cssW, height: cssH }),

    on(event: 'strokeend' | 'change' | 'toolchange', cb: (s: Stroke) => void): () => void {
      if (event === 'strokeend') {
        strokeEndCbs.add(cb);
        return () => {
          strokeEndCbs.delete(cb);
        };
      }
      const f = cb as unknown as () => void;
      const set = event === 'toolchange' ? toolChangeCbs : changeCbs;
      set.add(f);
      return () => {
        set.delete(f);
      };
    },
  };

  return engine;
}

function preventDefault(e: Event): void {
  e.preventDefault();
}
