/**
 * キャンバス描画エンジン（契約 1）。
 * createCanvasEngine() は DOM に触らない。attach(host) で初めて <canvas> を作る。
 *
 * 表示の重ね順: 紙＋完了ストローク（オフスクリーン cache）→ 進行中ストローク（live レイヤー）→ 重ね（overlay）
 *   → 消しゴムの輪 → グリッド。左右反転は「紙〜重ね・消しゴムの輪」だけに掛け、グリッドは画面座標に固定。
 * 不透明度 < 1・multiply・筆圧で濃淡が変わるペンは、1 本ずつ別レイヤー（scratch）に描いてから合成する
 * （区間の継ぎ目が濃くならないように）。
 */
import type { Drawing, Stroke, StrokePoint, Vec2 } from '@/scoring/types';
import type {
  CanvasEngine,
  CanvasOptions,
  EraserStyle,
  OverlaySpec,
  PenStyle,
  StrokeStyle,
  Tool,
  ToWebpOptions,
} from './types';
import { UndoStack } from './history';
import { strokeHit } from './hit';
import { normalizePressure, quadSegmentAt, shouldAppend, tailSegment } from './smooth';
import { buildReplaySchedule, visibleCounts, type ReplaySchedule } from './replay';
import { resolveColor } from './color';
import { cropRect, exportScale, type Rect } from './crop';
import { eraseSegments } from './erase';
import { GRID_COLOR, gridLines, normalizeGrid, sameGrid } from './grid';
import {
  DEFAULT_ERASER,
  DEFAULT_PEN,
  PEN_PRESETS,
  clampEraserSize,
  clampOpacity,
  clampPenSize,
  cumulativeLength,
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
const SILHOUETTE_PAPER = '#ffffff';
const SILHOUETTE_INK = '#000000';
/** 消しゴム（ストローク単位）のサンプル補間間隔（CSS px） */
const ERASER_STEP = 4;
/** 読み込んだ絵の続きを描くときにあける時間（ms） */
const RESUME_GAP_MS = 300;

type Ctx = CanvasRenderingContext2D;
type Styles = (StrokeStyle | undefined)[];

/** 履歴 1 手ぶんの状態。strokes と styles は同じ長さ・同じ並び。 */
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
  lastEraserPt: Vec2 | null;
  style: StrokeStyle;
}

interface ReplayState {
  doc: Doc;
  schedule: ReplaySchedule;
  start: number;
  /** cache に完成形を描き終えたストローク数（先頭から） */
  committed: number;
  /** live レイヤーに途中まで描いているストローク（-1 = なし） */
  partial: number;
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
  /** 消しゴムでなぞっている間の作業コピー（離したら 1 操作として commit） */
  let working: Doc | null = null;
  const current = (): Doc => working ?? history.present;

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
  let ro: ResizeObserver | null = null;
  let dprMql: MediaQueryList | null = null;
  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  let paper = FALLBACK_PAPER;
  let ink = FALLBACK_INK;

  let live: LiveInput | null = null;
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
  }
  /** 書き出し・重ね用（シルエットを無視） */
  function normalPaint(style: StrokeStyle | undefined): Paint {
    return { color: style?.color ?? ink, pen: resolvePen(style, opts.baseWidth) };
  }
  /** 画面表示用（シルエット中は太い黒） */
  function viewPaint(style: StrokeStyle | undefined): Paint {
    const p = normalPaint(style);
    if (!opts.silhouette) return p;
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
    paintStroke(cache.ctx, s, viewPaint(doc.styles[i]), { k: dpr, ox: 0, oy: 0 }, scratch, devSize());
  }

  /** cache を紙色で塗り、doc の先頭 upto 本を描く。 */
  function rebuildCache(doc: Doc = current(), upto = doc.strokes.length): void {
    if (!cache) return;
    const c = cache.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = opts.silhouette ? SILHOUETTE_PAPER : paper;
    c.fillRect(0, 0, cache.canvas.width, cache.canvas.height);
    for (let i = 0; i < upto; i++) paintCacheStroke(i, doc);
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

  function drawEraserRing(c: Ctx): void {
    if (!live || live.tool !== 'eraser' || !live.lastEraserPt) return;
    const pt = live.lastEraserPt;
    applyView(c);
    c.globalAlpha = 0.5;
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
    applyView(ctx);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
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
    compose();
  }

  /** 進行中のペン入力の新しい区間を live レイヤーに描き足す。描いたら true。 */
  function drawLiveIncrement(): boolean {
    if (!live || live.tool !== 'pen' || !liveLayer || !livePaint) return false;
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
    for (const l of [cache, liveLayer, scratch]) {
      if (!l) continue;
      l.canvas.width = pw;
      l.canvas.height = ph;
    }
    if (live && live.tool === 'pen') {
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

  /** ストローク単位の消しゴム: 点に当たる線を丸ごと消す。当たり = 線幅 + (size − 4) px 以内。 */
  function eraseWholeAt(pt: Vec2): void {
    const src = current();
    const margin = Math.max(0, eraser.size - 4);
    const keep: number[] = [];
    src.strokes.forEach((s, i) => {
      const rp = resolvePen(src.styles[i], opts.baseWidth);
      if (!strokeHit(s, pt, opts.baseWidth, margin, (p) => penWidth(rp, p))) keep.push(i);
    });
    if (keep.length === src.strokes.length) return;
    working = { strokes: keep.map((i) => src.strokes[i]!), styles: keep.map((i) => src.styles[i]) };
    fullDirty = true;
  }

  function eraseAlong(from: Vec2 | null, to: Vec2): void {
    if (eraser.mode === 'partial') {
      const src = current();
      const res = eraseSegments(src.strokes, src.styles, from ? [from, to] : [to], eraser.size);
      if (res.changed) {
        working = { strokes: res.strokes, styles: res.styles };
        fullDirty = true;
      }
      return;
    }
    if (!from) {
      eraseWholeAt(to);
      return;
    }
    const d = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(d / ERASER_STEP));
    for (let i = 1; i <= steps; i++) {
      eraseWholeAt({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
    }
  }

  function addSample(e: PointerEvent): void {
    if (!live) return;
    const pos = toPoint(e);
    if (live.tool === 'eraser') {
      eraseAlong(live.lastEraserPt, pos);
      live.lastEraserPt = pos;
      composeDirty = true;
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
    const style = styleFromPen(pen);
    live = { pointerId: e.pointerId, tool, points: [], drawnCtrl: 0, dotDrawn: false, lastEraserPt: null, style };
    clearLayer(liveLayer);
    livePaint = tool === 'pen' ? viewPaint(style) : null;
    addSample(e);
    schedule();
  }

  function onMove(e: PointerEvent): void {
    if (!live || e.pointerId !== live.pointerId) return;
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
      const w = working;
      working = null;
      if (w && w !== history.present) {
        history.commit(w);
        fullDirty = false;
        fullRedraw();
        emitChange();
      } else {
        if (fullDirty) {
          fullDirty = false;
          fullRedraw();
        } else compose();
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
    for (const cb of [...strokeEndCbs]) cb(stroke);
    emitChange();
  }

  const onUp = (e: PointerEvent): void => finish(e, false);
  const onCancel = (e: PointerEvent): void => finish(e, true);

  // ---------- 再生 ----------
  /** 再生中のストローク（partial）の、まだ描いていない部分を live レイヤーに描く。 */
  function drawReplayPartial(st: ReplayState): void {
    if (st.partial < 0 || !liveLayer) return;
    const s = st.doc.strokes[st.partial];
    if (!s) return;
    const n = Math.min(s.length, visibleCounts(st.schedule, performance.now() - st.start)[st.partial] ?? 0);
    const paint = viewPaint(st.doc.styles[st.partial]);
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
      live = null;
      livePaint = null;
      working = null;
      clearLayer(liveLayer);
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
        canvas.removeEventListener('contextmenu', preventDefault);
        canvas.remove();
      }
      canvas = null;
      ctx = null;
      cache = null;
      liveLayer = null;
      scratch = null;
      host = null;
    },

    setTool(t: Tool): void {
      tool = t;
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
      const next: EraserStyle = { ...eraser };
      if (style.mode === 'stroke' || style.mode === 'partial') next.mode = style.mode;
      if (style.size !== undefined) next.size = clampEraserSize(style.size, next.size);
      eraser = next;
      if (prev.mode !== next.mode || prev.size !== next.size) emitToolChange();
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

    getStrokes: () => copyDrawing(current().strokes),

    getStyles: () => current().styles.map(copyStyle),

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
      const crop = o?.crop ?? true;
      const cropped = crop ? cropRect(doc.strokes, opts.baseWidth, doc.styles) : null;
      let rect: Rect;
      if (cropped) {
        rect = cropped;
      } else {
        const sz = cssW > 0 && cssH > 0 ? { width: cssW, height: cssH } : strokeBounds(doc.strokes);
        rect = { x: 0, y: 0, width: Math.max(1, sz.width), height: Math.max(1, sz.height) };
      }
      const k = exportScale(rect, maxEdge, dpr, cropped !== null);
      const W = Math.max(1, Math.round(rect.width * k));
      const H = Math.max(1, Math.round(rect.height * k));
      const paints = doc.styles.map((s) => normalPaint(s));
      // 作業用レイヤーは必要なときだけ（出力 canvas より先に作る）
      const layer = paints.some((p) => needsLayer(p.pen)) ? makeLayer(W, H) : null;
      const out = document.createElement('canvas');
      out.width = W;
      out.height = H;
      const c = out.getContext('2d');
      if (!c) return Promise.reject(new Error('toWebp: 2D コンテキストを作れません'));
      c.fillStyle = paper;
      c.fillRect(0, 0, out.width, out.height);
      const xf: Xf = { k, ox: -rect.x * k, oy: -rect.y * k };
      doc.strokes.forEach((s, i) => paintStroke(c, s, paints[i]!, xf, layer, { w: W, h: H }));
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
