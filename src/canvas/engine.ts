/**
 * キャンバス描画エンジン（契約 1）。
 * createCanvasEngine() は DOM に触らない。attach(host) で初めて <canvas> を作る。
 * 描画レイヤー: 紙色 → グリッド → 重ね（overlay） → 完了ストローク（オフスクリーンにキャッシュ） → 進行中ストローク。
 */
import type { Drawing, Stroke, StrokePoint, Vec2 } from '@/scoring/types';
import type { CanvasEngine, CanvasOptions, OverlaySpec, Tool, ToWebpOptions } from './types';
import { UndoStack } from './history';
import { findHitStrokes } from './hit';
import { lineWidth, normalizePressure, quadSegmentAt, shouldAppend, tailSegment, type QuadSegment } from './smooth';
import { buildReplaySchedule, visibleCounts, type ReplaySchedule } from './replay';
import { resolveColor } from './color';
import { cropRect, exportScale, type Rect } from './crop';

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
/** 消しゴムのサンプル補間間隔（CSS px） */
const ERASER_STEP = 4;
/** 読み込んだ絵の続きを描くときにあける時間（ms） */
const RESUME_GAP_MS = 300;

type Ctx = CanvasRenderingContext2D;

interface StrokeStyle {
  color: string;
  width: (p: number) => number;
}

interface LiveInput {
  pointerId: number;
  tool: Tool;
  points: StrokePoint[];
  /** 描画済みの最後の制御点インデックス（0 = まだ何も描いていない） */
  drawnCtrl: number;
  lastEraserPt: Vec2 | null;
}

interface ReplayState {
  drawing: Drawing;
  schedule: ReplaySchedule;
  start: number;
  counts: number[];
  /** ストロークごとの描画済み制御点 */
  drawnCtrl: number[];
  tailDone: boolean[];
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

function drawSegment(ctx: Ctx, seg: QuadSegment, style: StrokeStyle): void {
  ctx.beginPath();
  ctx.moveTo(seg.from.x, seg.from.y);
  ctx.quadraticCurveTo(seg.ctrl.x, seg.ctrl.y, seg.to.x, seg.to.y);
  ctx.lineWidth = style.width(seg.p);
  ctx.stroke();
}

function prepStroke(ctx: Ctx, style: StrokeStyle): void {
  ctx.strokeStyle = style.color;
  ctx.fillStyle = style.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

/** 制御点 (from, to] の区間を描く。 */
function drawCtrlRange(ctx: Ctx, pts: readonly StrokePoint[], from: number, to: number, style: StrokeStyle): void {
  if (to <= from) return;
  prepStroke(ctx, style);
  for (let k = Math.max(1, from + 1); k <= to; k++) {
    const seg = quadSegmentAt(pts, k);
    if (seg) drawSegment(ctx, seg, style);
  }
}

/** 末尾区間（1 点なら点）を描く。 */
function drawTail(ctx: Ctx, pts: readonly StrokePoint[], style: StrokeStyle): void {
  prepStroke(ctx, style);
  const only = pts.length === 1 ? pts[0] : undefined;
  if (only) {
    ctx.beginPath();
    ctx.arc(only.x, only.y, style.width(only.p) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const tail = tailSegment(pts);
  if (tail) drawSegment(ctx, tail, style);
}

function drawStrokeFull(ctx: Ctx, pts: readonly StrokePoint[], style: StrokeStyle): void {
  drawCtrlRange(ctx, pts, 0, pts.length - 2, style);
  drawTail(ctx, pts, style);
}

export function createCanvasEngine(init?: Partial<CanvasOptions>): CanvasEngine {
  let opts: CanvasOptions = { ...DEFAULT_OPTIONS, ...init };
  let tool: Tool = 'pen';
  const history = new UndoStack<Drawing>([]);
  /** 消しゴムでなぞっている間の作業コピー（離したら 1 操作として commit） */
  let working: Drawing | null = null;
  const current = (): Drawing => working ?? history.present;

  let overlay: OverlaySpec | null = null;
  let overlayImg: HTMLImageElement | null = null;
  let overlayToken = 0;

  const strokeEndCbs = new Set<(s: Stroke) => void>();
  const changeCbs = new Set<() => void>();

  // --- DOM 状態（attach 後のみ） ---
  let host: HTMLElement | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let ctx: Ctx | null = null;
  let cache: HTMLCanvasElement | null = null;
  let cacheCtx: Ctx | null = null;
  let ro: ResizeObserver | null = null;
  let dprMql: MediaQueryList | null = null;
  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  let paper = FALLBACK_PAPER;
  let ink = FALLBACK_INK;

  let live: LiveInput | null = null;
  let rafId = 0;
  let fullDirty = false;
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
  function normalStyle(): StrokeStyle {
    const base = opts.baseWidth;
    return { color: ink, width: (p) => lineWidth(base, p) };
  }
  function viewStyle(): StrokeStyle {
    if (!opts.silhouette) return normalStyle();
    const base = opts.baseWidth;
    return { color: SILHOUETTE_INK, width: (p) => Math.max(lineWidth(base, p) * 3, base * 4) };
  }

  // ---------- イベント ----------
  function emitChange(): void {
    for (const cb of [...changeCbs]) cb();
  }

  // ---------- 描画 ----------
  function applyView(c: Ctx): void {
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (opts.flipped) c.transform(-1, 0, 0, 1, cssW, 0);
  }

  function rebuildCache(): void {
    if (!cache || !cacheCtx) return;
    cacheCtx.setTransform(1, 0, 0, 1, 0, 0);
    cacheCtx.clearRect(0, 0, cache.width, cache.height);
    cacheCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const style = viewStyle();
    for (const s of current()) drawStrokeFull(cacheCtx, s, style);
  }

  function drawGrid(c: Ctx): void {
    if (opts.grid === 'none' || opts.silhouette) return;
    const n = opts.grid === 'thirds' ? 3 : 4;
    c.save();
    c.globalAlpha = 0.18;
    c.strokeStyle = ink;
    c.lineWidth = 1;
    c.beginPath();
    for (let i = 1; i < n; i++) {
      const x = Math.round((cssW * i) / n) + 0.5;
      const y = Math.round((cssH * i) / n) + 0.5;
      c.moveTo(x, 0);
      c.lineTo(x, cssH);
      c.moveTo(0, y);
      c.lineTo(cssW, y);
    }
    c.stroke();
    c.restore();
  }

  function drawOverlay(c: Ctx): void {
    if (!overlay || opts.silhouette || overlay.opacity <= 0) return;
    c.save();
    c.globalAlpha = Math.min(1, Math.max(0, overlay.opacity));
    if (overlay.kind === 'strokes') {
      const style = normalStyle();
      for (const s of overlay.src as Drawing) drawStrokeFull(c, s, style);
    } else if (overlayImg) {
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
    c.restore();
  }

  function drawReplayPartial(c: Ctx, st: ReplayState): void {
    const style = viewStyle();
    st.drawing.forEach((s, i) => {
      const n = st.counts[i] ?? 0;
      if (n === 0) return;
      const pts = s.slice(0, n);
      drawCtrlRange(c, pts, 0, n - 2, style);
      if (n === s.length) drawTail(c, pts, style);
    });
  }

  /** 全層を描き直す（キャッシュは作り直さない）。 */
  function compose(): void {
    if (!ctx || !canvas) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = opts.silhouette ? SILHOUETTE_PAPER : paper;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    applyView(ctx);
    drawGrid(ctx);
    drawOverlay(ctx);
    if (replayState) {
      drawReplayPartial(ctx, replayState);
      return;
    }
    if (cache) ctx.drawImage(cache, 0, 0, cssW, cssH);
    if (live && live.tool === 'pen') {
      drawCtrlRange(ctx, live.points, 0, live.drawnCtrl, viewStyle());
      if (live.points.length === 1) drawTail(ctx, live.points, viewStyle());
    }
  }

  function fullRedraw(): void {
    rebuildCache();
    compose();
  }

  function frame(): void {
    rafId = 0;
    if (!ctx) return;
    if (fullDirty) {
      fullDirty = false;
      fullRedraw();
      return;
    }
    if (live && live.tool === 'pen') {
      const ready = live.points.length - 2;
      if (ready > live.drawnCtrl) {
        applyView(ctx);
        drawCtrlRange(ctx, live.points, live.drawnCtrl, ready, viewStyle());
        live.drawnCtrl = ready;
      } else if (live.points.length === 1 && live.drawnCtrl === 0) {
        applyView(ctx);
        drawTail(ctx, live.points, viewStyle());
      }
    }
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
    cache.width = pw;
    cache.height = ph;
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
      for (const s of current()) for (const p of s) if (Number.isFinite(p.t) && p.t > lastT) lastT = p.t;
      timeOrigin = e.timeStamp - (lastT + RESUME_GAP_MS);
    }
    return Math.max(0, e.timeStamp - timeOrigin);
  }

  function eraseAt(pt: Vec2): void {
    const src = current();
    const hits = findHitStrokes(src, pt, opts.baseWidth);
    if (hits.length === 0) return;
    const set = new Set(hits);
    working = src.filter((_, i) => !set.has(i));
    fullDirty = true;
  }

  function eraseAlong(from: Vec2 | null, to: Vec2): void {
    if (!from) {
      eraseAt(to);
      return;
    }
    const d = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(d / ERASER_STEP));
    for (let i = 1; i <= steps; i++) {
      eraseAt({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
    }
  }

  function addSample(e: PointerEvent): void {
    if (!live) return;
    const pos = toPoint(e);
    if (live.tool === 'eraser') {
      eraseAlong(live.lastEraserPt, pos);
      live.lastEraserPt = pos;
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
    live = { pointerId: e.pointerId, tool, points: [], drawnCtrl: 0, lastEraserPt: null };
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

  function finish(e: PointerEvent, cancelled: boolean): void {
    if (!live || e.pointerId !== live.pointerId) return;
    const l = live;
    live = null;
    if (!cancelled) addSample(e);
    if (l.tool === 'eraser') {
      if (working && working !== history.present) {
        history.commit(working);
        working = null;
        fullDirty = true;
        schedule();
        emitChange();
      }
      working = null;
      return;
    }
    // キャンセル（システムジェスチャ等）で 1 点しかなければ捨てる
    if (l.points.length === 0 || (cancelled && l.points.length < 2)) {
      compose();
      return;
    }
    const stroke: Stroke = l.points;
    history.commit([...history.present, stroke]);
    if (cacheCtx) {
      cacheCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawStrokeFull(cacheCtx, stroke, viewStyle());
    }
    if (rafId && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(rafId);
    rafId = 0;
    if (fullDirty) {
      fullDirty = false;
      fullRedraw();
    } else compose();
    for (const cb of [...strokeEndCbs]) cb(stroke);
    emitChange();
  }

  const onUp = (e: PointerEvent): void => finish(e, false);
  const onCancel = (e: PointerEvent): void => finish(e, true);

  // ---------- 再生 ----------
  function endReplay(): void {
    const st = replayState;
    if (!st) return;
    replayState = null;
    if (st.raf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(st.raf);
    compose();
    st.resolve();
  }

  function replayStep(): void {
    const st = replayState;
    if (!st || !ctx) return;
    st.raf = 0;
    const elapsed = performance.now() - st.start;
    st.counts = visibleCounts(st.schedule, elapsed);
    applyView(ctx);
    const style = viewStyle();
    st.drawing.forEach((s, i) => {
      const n = st.counts[i] ?? 0;
      if (n === 0) return;
      const pts = s.slice(0, n);
      const ready = n - 2;
      const drawn = st.drawnCtrl[i] ?? 0;
      if (ready > drawn) {
        drawCtrlRange(ctx!, pts, drawn, ready, style);
        st.drawnCtrl[i] = ready;
      }
      if (n === s.length && !st.tailDone[i]) {
        drawTail(ctx!, pts, style);
        st.tailDone[i] = true;
      }
    });
    if (elapsed >= st.schedule.total) {
      endReplay();
      return;
    }
    st.raf = requestAnimationFrame(replayStep);
  }

  // ---------- 公開 API ----------
  function interruptInput(): void {
    if (live) {
      live = null;
      working = null;
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
      cache = document.createElement('canvas');
      cacheCtx = cache.getContext('2d');
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
      if (rafId && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(rafId);
      rafId = 0;
      fullDirty = false;
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
      cacheCtx = null;
      host = null;
    },

    setTool(t: Tool): void {
      tool = t;
    },

    setOptions(patch: Partial<CanvasOptions>): void {
      const prev = opts;
      opts = { ...opts, ...patch };
      if (patch.paperColor !== undefined || patch.inkColor !== undefined) resolveColors();
      const strokeLook =
        prev.inkColor !== opts.inkColor || prev.baseWidth !== opts.baseWidth || prev.silhouette !== opts.silhouette;
      const view =
        strokeLook || prev.paperColor !== opts.paperColor || prev.grid !== opts.grid || prev.flipped !== opts.flipped;
      if (strokeLook) fullRedraw();
      else if (view) compose();
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
      if (history.present.length === 0) return;
      history.commit([]);
      fullRedraw();
      emitChange();
    },

    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),

    getStrokes: () => copyDrawing(current()),

    loadStrokes(d: Drawing): void {
      endReplay();
      interruptInput();
      history.reset(copyDrawing(d));
      timeOrigin = null;
      fullRedraw();
      emitChange();
    },

    replay(o: { speed: number }): Promise<void> {
      endReplay();
      interruptInput();
      if (!ctx || typeof requestAnimationFrame === 'undefined') return Promise.resolve();
      const drawing = current();
      const sched = buildReplaySchedule(drawing, { speed: o.speed });
      return new Promise<void>((resolve) => {
        replayState = {
          drawing,
          schedule: sched,
          start: performance.now(),
          counts: drawing.map(() => 0),
          drawnCtrl: drawing.map(() => 0),
          tailDone: drawing.map(() => false),
          raf: 0,
          resolve,
        };
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
      const drawing = current();
      const crop = o?.crop ?? true;
      const cropped = crop ? cropRect(drawing, opts.baseWidth) : null;
      let rect: Rect;
      if (cropped) {
        rect = cropped;
      } else {
        const sz = cssW > 0 && cssH > 0 ? { width: cssW, height: cssH } : strokeBounds(drawing);
        rect = { x: 0, y: 0, width: Math.max(1, sz.width), height: Math.max(1, sz.height) };
      }
      const k = exportScale(rect, maxEdge, dpr, cropped !== null);
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(rect.width * k));
      out.height = Math.max(1, Math.round(rect.height * k));
      const c = out.getContext('2d');
      if (!c) return Promise.reject(new Error('toWebp: 2D コンテキストを作れません'));
      c.fillStyle = paper;
      c.fillRect(0, 0, out.width, out.height);
      c.setTransform(k, 0, 0, k, -rect.x * k, -rect.y * k);
      const style = normalStyle();
      for (const s of drawing) drawStrokeFull(c, s, style);
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

    on(event: 'strokeend' | 'change', cb: (s: Stroke) => void): () => void {
      if (event === 'strokeend') {
        strokeEndCbs.add(cb);
        return () => {
          strokeEndCbs.delete(cb);
        };
      }
      const f = cb as unknown as () => void;
      changeCbs.add(f);
      return () => {
        changeCbs.delete(f);
      };
    },
  };

  return engine;
}

function preventDefault(e: Event): void {
  e.preventDefault();
}
