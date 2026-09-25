/**
 * 選択範囲の枠・変形ハンドル・変形バー（DESIGN_SYSTEM §2「変形バー」）。
 *
 * - 選択（矩形／投げ縄）はエンジンが作る（select-rect / select-lasso ツールのドラッグ）。ここは 'selectionchange' を受けて
 *   点線の枠を描く。描いている（紙に触れている）間は何も動かさず、指を離してから枠とバーを出す
 * - 枠の中をドラッグで移動、四隅（縦横比を保つ）・辺の中央（片方向）で拡縮、上の丸で回転（15° に吸着）
 * - 行列はキャンバス座標。transformSelection(matrix) でプレビューし、「確定」で commitTransform()、「取消」で cancelTransform()
 * - ハンドルの位置は toClientPoint（ビューのズーム・パン・回転に追従）。当たり判定 48px
 * - 上部の変形バー: 左右反転・上下反転・削除・選択解除・取消・確定。選択ツールで何も選んでいないときは「すべて選択」だけ
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CanvasEngine, Tool } from '@/canvas';
import { PaintIcon } from './PaintIcon';
import {
  apply,
  corners,
  IDENTITY_STATE,
  isIdentityState,
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

type Drag =
  | { kind: 'move'; pointerId: number; start: { x: number; y: number }; from: TransformState }
  | { kind: 'scale'; pointerId: number; hx: -1 | 0 | 1; hy: -1 | 0 | 1; from: TransformState }
  | { kind: 'rotate'; pointerId: number; from: TransformState };

export function isSelectTool(t: Tool): boolean {
  return t === 'select-rect' || t === 'select-lasso';
}

/** 変形中なら確定し、選択を外す（ツールを替えるとき・保存の前） */
export function releaseSelection(engine: CanvasEngine): void {
  if (engine.isTransforming()) engine.commitTransform();
  if (engine.getSelection()) engine.setSelection(null);
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
}: {
  engine: CanvasEngine;
  paperRef: { current: HTMLElement | null };
  tool: Tool;
  /** 選択があるか（課題ピルの代わりに変形バーを出すため） */
  onActiveChange?: (active: boolean) => void;
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

  // エンジンの選択・ビューを追う。紙に触れている間（選択を描いている間）は枠を出さず、離してから出す
  useEffect(() => {
    let down = false;
    let pending = false;
    const sync = () => {
      const m = engine.getSelection();
      // 変形のプレビュー中にエンジンが選択を更新しても、確定・取消まではこちらの基準（元の外接矩形）を保つ
      if (m && engine.isTransforming()) return;
      setMask(m);
      if (!engine.isTransforming()) setTs(IDENTITY_STATE);
    };
    const offs = [
      engine.on('selectionchange', () => {
        if (down) pending = true;
        else sync();
      }),
      engine.on('viewchange', () => setFrame((f) => f + 1)),
    ];
    const el = paperRef.current;
    const onDown = () => {
      down = true;
      // 変形中に枠の外（紙）を触った: いまの変形を確定してから、エンジンの新しい選択・描画へ
      if (engine.isTransforming()) {
        engine.commitTransform();
        setTs(IDENTITY_STATE);
      }
    };
    const onUp = () => {
      if (!down) return;
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
    else if (d.kind === 'scale') push(scaleFromHandle(b, d.from, { hx: d.hx, hy: d.hy }, p));
    else push({ ...d.from, rot: rotationFromPointer(b, d.from, p) });
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
    <div class="pt-xbar" role="toolbar" aria-label="選択範囲の変形" data-testid="transform-bar">
      <span class="pt-xbar__label">選択中</span>
      <button type="button" class="pt-xbar__btn" aria-label="左右反転" title="左右反転" onClick={() => flip('x')}>
        <PaintIcon name="flip-h" />
      </button>
      <button type="button" class="pt-xbar__btn" aria-label="上下反転" title="上下反転" onClick={() => flip('y')}>
        <PaintIcon name="flip-v" />
      </button>
      <button type="button" class="pt-xbar__btn" aria-label="選択範囲を消す" title="選択範囲を消す" onClick={remove}>
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
    <div class="pt-xbar" role="toolbar" aria-label="選択" data-testid="transform-bar">
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
  const showHandles = (selectTool || engine.isTransforming()) && box.w >= 1 && box.h >= 1;
  const zoom = Math.max(0.01, engine.getView().zoom);
  const rotPos = toLocal(rotateHandlePos(box, ts, ROTATE_GAP_PX / zoom));
  const topMid = toLocal(handleCanvasPoint(box, ts, 0, -1));

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
            <line class="pt-sel__stem" x1={topMid.x} y1={topMid.y} x2={rotPos.x} y2={rotPos.y} />
          </>
        )}
      </svg>
      {showHandles &&
        HANDLES.map((h) => {
          const p = toLocal(handleCanvasPoint(box, ts, h.hx, h.hy));
          return (
            <button
              key={`${h.hx},${h.hy}`}
              type="button"
              class={h.hx !== 0 && h.hy !== 0 ? 'pt-handle is-corner' : 'pt-handle'}
              style={{ left: `${p.x}px`, top: `${p.y}px` }}
              aria-label={`${h.label}のハンドル（拡大・縮小）`}
              onPointerDown={(e) => begin(e as unknown as PointerEvent, { kind: 'scale', pointerId: e.pointerId, hx: h.hx, hy: h.hy, from: tsRef.current })}
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
          class="pt-handle is-rotate"
          style={{ left: `${rotPos.x}px`, top: `${rotPos.y}px` }}
          aria-label="回転のハンドル"
          data-testid="rotate-handle"
          onPointerDown={(e) => begin(e as unknown as PointerEvent, { kind: 'rotate', pointerId: e.pointerId, from: tsRef.current })}
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
