/**
 * 選択範囲の枠・変形ハンドル・変形バー（DESIGN_SYSTEM §2「変形バー」）。
 *
 * - 選択（矩形／投げ縄）はエンジンが作る（select-rect / select-lasso ツールのドラッグ）。ここは 'selectionchange' を受けて
 *   点線の枠を描く。描いている（紙に触れている）間は何も動かさず、指を離してから枠とバーを出す
 * - 枠の中をドラッグで移動、四隅（縦横比を保つ）・辺の中央（片方向）で拡縮、上の丸で回転（15° に吸着）
 * - 行列はキャンバス座標。transformSelection(matrix) でプレビューし、「確定」で commitTransform()、「取消」で cancelTransform()
 * - ハンドルの位置は toClientPoint（ビューのズーム・パン・回転に追従）。当たり判定 48px
 * - 上部の変形バー: 左右反転・上下反転・削除・選択解除・取消・確定。選択ツールで何も選んでいないときは「すべて選択」だけ
 * - Undo/Redo の後は getSelection() を読み直して枠とハンドルを合わせる（エンジンが選択も戻す。'change' / 'opsend' でも読み直す）
 * - ペン専用（penOnly）のときは指（pointerType 'touch'）を無視する（手のひらが触れても変形が確定しない・ハンドルが動かない）
 * - ロック中のレイヤーではハンドル・反転・削除を出さない（無効）。案内は CanvasScreen のロックのピル
 * - 回転ハンドルは、上に出すと変形バーに隠れる（選択が上端に近い）ときは下辺の下に出す
 * - 画面上の短辺が 40px 未満の小さい選択は、辺のハンドルを出さず四隅だけ（外へずらして中央で移動できるように）
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CanvasEngine, Tool } from '@/canvas';
import { PaintIcon } from './PaintIcon';
import {
  apply,
  corners,
  IDENTITY_STATE,
  isIdentityState,
  isSmallSelection,
  maskBounds,
  matrixOf,
  rotateHandlePos,
  rotationFromPointer,
  scaleFromHandle,
  type Box,
  type TransformState,
} from './transform';
import type { SelectionMask } from './types';

/** 回転ハンドルの、上辺からの距離（画面 px） */
const ROTATE_GAP_PX = 40;
/** 小さい選択で四隅のハンドルを外へずらす量（画面 px、縦横それぞれ） */
const SMALL_CORNER_PUSH_PX = 22;

type Drag =
  | { kind: 'move'; pointerId: number; start: { x: number; y: number }; from: TransformState }
  /** off: つかんだ点とハンドルの本来の位置のずれ（キャンバス座標）。つかんだ瞬間に拡縮が跳ばないように引く */
  | { kind: 'scale'; pointerId: number; hx: -1 | 0 | 1; hy: -1 | 0 | 1; from: TransformState; off: { x: number; y: number } }
  | { kind: 'rotate'; pointerId: number; from: TransformState; side: 1 | -1 };

export function isSelectTool(t: Tool): boolean {
  return t === 'select-rect' || t === 'select-lasso';
}

/** 変形中なら確定し、選択を外す（ツールを替えるとき・保存の前） */
export function releaseSelection(engine: CanvasEngine): void {
  if (engine.isTransforming()) engine.commitTransform();
  if (engine.getSelection()) engine.setSelection(null);
}

function maskKey(m: SelectionMask | null): string {
  return m ? JSON.stringify(m) : '';
}

const HANDLES: { hx: -1 | 0 | 1; hy: -1 | 0 | 1; label: string }[] = [
  { hx: -1, hy: -1, label: '左上' },
  { hx: 0, hy: -1, label: '上' },
  { hx: 1, hy: -1, label: '右上' },
  { hx: 1, hy: 0, label: '右' },
  { hx: 1, hy: 1, label: '右下' },
  { hx: 0, hy: 1, label: '下' },
  { hx: -1, hy: 1, label: '左下' },
  { hx: -1, hy: 0, label: '左' },
];

function handleCanvasPoint(box: Box, ts: TransformState, hx: number, hy: number): { x: number; y: number } {
  const m = matrixOf(box, ts);
  return apply(m, { x: box.x + ((hx + 1) / 2) * box.w, y: box.y + ((hy + 1) / 2) * box.h });
}

export function SelectionOverlay({
  engine,
  paperRef,
  tool,
  onActiveChange,
  penOnly = false,
  locked = false,
}: {
  engine: CanvasEngine;
  paperRef: { current: HTMLElement | null };
  tool: Tool;
  /** 選択があるか（課題ピルの代わりに変形バーを出すため） */
  onActiveChange?: (active: boolean) => void;
  /** ペン専用: 指（touch）の操作を無視する */
  penOnly?: boolean;
  /** アクティブなレイヤーがロック中: ハンドル・反転・削除を出さない */
  locked?: boolean;
}) {
  const [mask, setMask] = useState<SelectionMask | null>(() => engine.getSelection());
  const [ts, setTs] = useState<TransformState>(IDENTITY_STATE);
  const tsRef = useRef(ts);
  tsRef.current = ts;
  const [, setFrame] = useState(0);
  const box = useMemo(() => (mask ? maskBounds(mask) : null), [mask]);
  const boxRef = useRef(box);
  boxRef.current = box;
  const drag = useRef<Drag | null>(null);
  const raf = useRef<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const penOnlyRef = useRef(penOnly);
  penOnlyRef.current = penOnly;
  /** ペン専用のときの指は無視する */
  const ignored = (e: PointerEvent) => penOnlyRef.current && e.pointerType === 'touch';

  // エンジンの選択・ビューを追う。紙に触れている間（選択を描いている間）は枠を出さず、離してから出す
  useEffect(() => {
    let down = false;
    let pending = false;
    let key = maskKey(engine.getSelection());
    const sync = () => {
      const m = engine.getSelection();
      // 変形のプレビュー中にエンジンが選択を更新しても、確定・取消まではこちらの基準（元の外接矩形）を保つ
      if (engine.isTransforming()) return;
      // ハンドルをドラッグしている途中（プレビューを rAF で渡す前）は読み直さない
      if (drag.current || raf.current !== null) return;
      const k = maskKey(m);
      if (k !== key) {
        key = k;
        setMask(m);
      }
      if (!isIdentityState(tsRef.current)) {
        tsRef.current = IDENTITY_STATE;
        setTs(IDENTITY_STATE);
      }
    };
    const later = () => {
      if (down) pending = true;
      else sync();
    };
    const offs = [
      engine.on('selectionchange', later),
      // Undo/Redo（エンジンが選択も戻す）・変形の確定の後に、枠とハンドルを読み直す
      engine.on('change', later),
      engine.on('opsend', later),
      engine.on('viewchange', () => setFrame((f) => f + 1)),
    ];
    const el = paperRef.current;
    const onDown = (e: PointerEvent) => {
      // ペン専用: 指（手のひら）が触れても確定しない
      if (ignored(e)) return;
      down = true;
      // 変形中に枠の外（紙）を触った: いまの変形を確定してから、エンジンの新しい選択・描画へ
      if (engine.isTransforming()) {
        engine.commitTransform();
        setTs(IDENTITY_STATE);
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!down || ignored(e)) return;
      down = false;
      if (pending) {
        pending = false;
        sync();
      }
    };
    el?.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    const ro = typeof ResizeObserver !== 'undefined' && el ? new ResizeObserver(() => setFrame((f) => f + 1)) : null;
    if (el) ro?.observe(el);
    sync();
    return () => {
      offs.forEach((f) => f());
      el?.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      ro?.disconnect();
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [engine, paperRef]);

  const active = mask !== null;
  useEffect(() => onActiveChange?.(active), [active]);

  const push = (next: TransformState) => {
    setTs(next);
    tsRef.current = next;
    if (raf.current !== null) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = null;
      const b = boxRef.current;
      if (b) engine.transformSelection(matrixOf(b, tsRef.current));
    });
  };

  const selectTool = isSelectTool(tool);
  const el = paperRef.current;
  const rect = el?.getBoundingClientRect();

  const toLocal = (p: { x: number; y: number }) => {
    const c = engine.toClientPoint(p.x, p.y);
    return { x: c.x - (rect?.left ?? 0), y: c.y - (rect?.top ?? 0) };
  };
  const canvasAt = (e: PointerEvent) => engine.toCanvasPoint(e.clientX, e.clientY);

  const begin = (e: PointerEvent, d: Drag) => {
    if (ignored(e) || locked) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = d;
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    const b = boxRef.current;
    if (!d || !b || d.pointerId !== e.pointerId) return;
    const p = canvasAt(e);
    if (d.kind === 'move') push({ ...d.from, tx: d.from.tx + (p.x - d.start.x), ty: d.from.ty + (p.y - d.start.y) });
    else if (d.kind === 'scale') push(scaleFromHandle(b, d.from, { hx: d.hx, hy: d.hy }, { x: p.x - d.off.x, y: p.y - d.off.y }));
    else push({ ...d.from, rot: rotationFromPointer(b, d.from, p, d.side) });
  };
  const onEnd = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
  };

  const flip = (axis: 'x' | 'y') => {
    const cur = tsRef.current;
    push(axis === 'x' ? { ...cur, flipX: !cur.flipX } : { ...cur, flipY: !cur.flipY });
  };
  const commit = () => {
    if (engine.isTransforming()) engine.commitTransform();
    engine.setSelection(null);
    setTs(IDENTITY_STATE);
  };
  const cancel = () => {
    if (engine.isTransforming()) engine.cancelTransform();
    setTs(IDENTITY_STATE);
  };
  const remove = () => {
    if (engine.isTransforming()) engine.cancelTransform();
    engine.deleteSelection();
    engine.setSelection(null);
    setTs(IDENTITY_STATE);
  };
  const deselect = () => commit();

  const bar = active ? (
    <div class="pt-xbar" role="toolbar" aria-label="選択範囲の変形" data-testid="transform-bar" ref={barRef}>
      <span class="pt-xbar__label">{locked ? '選択中（ロック中）' : '選択中'}</span>
      <button type="button" class="pt-xbar__btn" aria-label="左右反転" title="左右反転" disabled={locked} onClick={() => flip('x')}>
        <PaintIcon name="flip-h" />
      </button>
      <button type="button" class="pt-xbar__btn" aria-label="上下反転" title="上下反転" disabled={locked} onClick={() => flip('y')}>
        <PaintIcon name="flip-v" />
      </button>
      <button type="button" class="pt-xbar__btn" aria-label="選択範囲を消す" title="選択範囲を消す" disabled={locked} onClick={remove}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5" />
        </svg>
      </button>
      <button type="button" class="pt-xbar__btn" aria-label="選択を解除" title="選択を解除" onClick={deselect}>
        <PaintIcon name="deselect" />
      </button>
      <span class="pt-xbar__sep" aria-hidden="true" />
      <button type="button" class="pt-xbar__text" disabled={isIdentityState(ts)} onClick={cancel}>
        取消
      </button>
      <button type="button" class="pt-xbar__primary" onClick={commit}>
        確定
      </button>
    </div>
  ) : selectTool ? (
    <div class="pt-xbar" role="toolbar" aria-label="選択" data-testid="transform-bar" ref={barRef}>
      <span class="pt-xbar__label">{tool === 'select-lasso' ? '投げ縄 — 囲んで選ぶ' : '矩形選択 — ドラッグで選ぶ'}</span>
      <button type="button" class="pt-xbar__text" onClick={() => engine.selectAll()}>
        すべて選択
      </button>
    </div>
  ) : null;

  if (!mask || !box || !rect) return bar;

  const m = matrixOf(box, ts);
  const outline = (mask.kind === 'rect'
    ? [
        { x: box.x, y: box.y },
        { x: box.x + box.w, y: box.y },
        { x: box.x + box.w, y: box.y + box.h },
        { x: box.x, y: box.y + box.h },
      ]
    : mask.points
  ).map((p) => toLocal(apply(m, p)));
  const d = outline.length > 0 ? `M${outline.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L')} Z` : '';
  const quad = corners(box, ts).map(toLocal);
  const quadPts = quad.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const showHandles = !locked && (selectTool || engine.isTransforming()) && box.w >= 1 && box.h >= 1;
  const zoom = Math.max(0.01, engine.getView().zoom);
  const small = isSmallSelection(box, ts, zoom);
  // 回転ハンドル: 上に出すと変形バー（または画面の上端）に隠れるときは下に出す。ドラッグ中は向きを保つ
  const cur = drag.current;
  let side: 1 | -1 = 1;
  if (cur?.kind === 'rotate') side = cur.side;
  else {
    const above = toLocal(rotateHandlePos(box, ts, ROTATE_GAP_PX / zoom, 1));
    const barBottom = barRef.current ? barRef.current.getBoundingClientRect().bottom - rect.top : 0;
    if (above.y - 24 < Math.max(8, barBottom + 8)) side = -1;
  }
  const rotPos = toLocal(rotateHandlePos(box, ts, ROTATE_GAP_PX / zoom, side));
  const stemFrom = toLocal(handleCanvasPoint(box, ts, 0, side === 1 ? -1 : 1));
  const center = toLocal(handleCanvasPoint(box, ts, 0, 0));
  /** ハンドルの画面上の位置（小さい選択では四隅を中心から外へずらす） */
  const handleAt = (hx: -1 | 0 | 1, hy: -1 | 0 | 1) => {
    const p = toLocal(handleCanvasPoint(box, ts, hx, hy));
    if (!small) return p;
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    const len = Math.hypot(dx, dy) || 1;
    const push = SMALL_CORNER_PUSH_PX * Math.SQRT2;
    return { x: p.x + (dx / len) * push, y: p.y + (dy / len) * push };
  };
  const handles = small ? HANDLES.filter((h) => h.hx !== 0 && h.hy !== 0) : HANDLES;

  return (
    <>
      <svg class="pt-sel" width={rect.width} height={rect.height} aria-hidden="true">
        <path class="pt-sel__ants-bg" d={d} />
        <path class="pt-sel__ants" d={d} />
        {showHandles && (
          <>
            <polygon
              class="pt-sel__body"
              points={quadPts}
              data-testid="selection-body"
              onPointerDown={(e) => begin(e as unknown as PointerEvent, { kind: 'move', pointerId: e.pointerId, start: canvasAt(e as unknown as PointerEvent), from: tsRef.current })}
              onPointerMove={(e) => onMove(e as unknown as PointerEvent)}
              onPointerUp={(e) => onEnd(e as unknown as PointerEvent)}
              onPointerCancel={(e) => onEnd(e as unknown as PointerEvent)}
            />
            <line class="pt-sel__stem" x1={stemFrom.x} y1={stemFrom.y} x2={rotPos.x} y2={rotPos.y} />
          </>
        )}
      </svg>
      {showHandles &&
        handles.map((h) => {
          const p = handleAt(h.hx, h.hy);
          return (
            <button
              key={`${h.hx},${h.hy}`}
              type="button"
              class={h.hx !== 0 && h.hy !== 0 ? (small ? 'pt-handle is-corner is-small' : 'pt-handle is-corner') : 'pt-handle'}
              style={{ left: `${p.x}px`, top: `${p.y}px` }}
              aria-label={`${h.label}のハンドル（拡大・縮小）`}
              onPointerDown={(e) => {
                const ev = e as unknown as PointerEvent;
                const at = canvasAt(ev);
                const real = handleCanvasPoint(box, tsRef.current, h.hx, h.hy);
                begin(ev, { kind: 'scale', pointerId: e.pointerId, hx: h.hx, hy: h.hy, from: tsRef.current, off: { x: at.x - real.x, y: at.y - real.y } });
              }}
              onPointerMove={(e) => onMove(e as unknown as PointerEvent)}
              onPointerUp={(e) => onEnd(e as unknown as PointerEvent)}
              onPointerCancel={(e) => onEnd(e as unknown as PointerEvent)}
            >
              <span class="pt-handle__dot" aria-hidden="true" />
            </button>
          );
        })}
      {showHandles && (
        <button
          type="button"
          class={side === 1 ? 'pt-handle is-rotate' : 'pt-handle is-rotate is-below'}
          style={{ left: `${rotPos.x}px`, top: `${rotPos.y}px` }}
          aria-label="回転のハンドル"
          data-testid="rotate-handle"
          data-side={side === 1 ? 'top' : 'bottom'}
          onPointerDown={(e) => begin(e as unknown as PointerEvent, { kind: 'rotate', pointerId: e.pointerId, from: tsRef.current, side })}
          onPointerMove={(e) => onMove(e as unknown as PointerEvent)}
          onPointerUp={(e) => onEnd(e as unknown as PointerEvent)}
          onPointerCancel={(e) => onEnd(e as unknown as PointerEvent)}
        >
          <span class="pt-handle__dot" aria-hidden="true" />
        </button>
      )}
      {bar}
    </>
  );
}
