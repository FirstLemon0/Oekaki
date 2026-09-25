/**
 * レイヤーパネル（右端のドロワー 幅 300。縦向きは下からのシート）。DESIGN_SYSTEM §2「レイヤーパネル」。
 *
 * - 上から順に「手前 → 奥」。engine.getLayers() は下（奥）から順なので、表示は逆順
 * - 各行 56px: サムネイル 40（getLayerThumbnail）、名前（タップで改名）、目（表示）、鍵（ロック）。アクティブ行は accent-soft
 * - 行の長押し（400ms）でつかんで上下へ動かすと並べ替え。アクティブ行は下部の「上へ／下へ」でも動かせる
 * - 下部: アクティブ行の不透明度（ドラッグ中もその場で反映。続けての変更はエンジンが 1 手にまとめる）と合成（通常／乗算／スクリーン）
 * - フッタ: 追加・複製・下と結合・削除（削除は確認）
 * サムネイルは線を描き終えたとき（opsend）とレイヤーが変わったときに、少し待ってから作り直す（描いている間は動かさない）。
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { CanvasEngine } from '@/canvas';
import { Button, Modal } from '../components';
import { PaintIcon } from './PaintIcon';
import type { BlendMode, LayerInfo } from './types';

const ROW_H = 56;
const LONG_PRESS_MS = 400;
const THUMB_DEBOUNCE_MS = 300;

export const BLEND_OPTIONS: { value: BlendMode; label: string }[] = [
  { value: 'normal', label: '通常' },
  { value: 'multiply', label: '乗算' },
  { value: 'screen', label: 'スクリーン' },
];

/** 新しいレイヤーの名前（「レイヤー n」の n は今ある最大 + 1） */
export function nextLayerName(layers: readonly { name: string }[]): string {
  let max = 0;
  for (const l of layers) {
    const m = /^レイヤー\s*(\d+)$/.exec(l.name.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `レイヤー ${Math.max(max, layers.length) + 1}`;
}

/** 表示の行番号（上＝手前が 0）→ エンジンの添字（下＝奥が 0） */
export function engineIndexOfRow(row: number, count: number): number {
  return count - 1 - row;
}

function useLayers(engine: CanvasEngine): { layers: LayerInfo[]; active: string } {
  const read = () => ({ layers: engine.getLayers(), active: engine.getActiveLayer() });
  const [state, setState] = useState(read);
  useEffect(() => {
    setState(read());
    return engine.on('layerschange', () => setState(read()));
  }, [engine]);
  return state;
}

/** レイヤーごとのサムネイル（object URL） */
function useThumbnails(engine: CanvasEngine, layers: readonly LayerInfo[]): Map<string, string> {
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const urlsRef = useRef(urls);
  urlsRef.current = urls;
  const ids = layers.map((l) => l.id).join('|');
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let alive = true;
    let seq = 0;
    const rebuild = () => {
      const my = ++seq;
      const list = engine.getLayers();
      void Promise.all(
        list.map((l) =>
          engine
            .getLayerThumbnail(l.id, 80)
            .then((b) => [l.id, URL.createObjectURL(b)] as const)
            .catch(() => null),
        ),
      ).then((pairs) => {
        const next = new Map<string, string>();
        for (const p of pairs) if (p) next.set(p[0], p[1]);
        if (!alive || my !== seq) {
          for (const u of next.values()) URL.revokeObjectURL(u);
          return;
        }
        for (const u of urlsRef.current.values()) URL.revokeObjectURL(u);
        setUrls(next);
      });
    };
    const later = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        rebuild();
      }, THUMB_DEBOUNCE_MS);
    };
    rebuild();
    const offs = [engine.on('opsend', later), engine.on('layerschange', later)];
    return () => {
      alive = false;
      if (timer !== null) clearTimeout(timer);
      offs.forEach((f) => f());
    };
  }, [engine, ids]);
  useEffect(
    () => () => {
      for (const u of urlsRef.current.values()) URL.revokeObjectURL(u);
    },
    [],
  );
  return urls;
}

function LayerRow({
  layer,
  active,
  thumb,
  dragging,
  offset,
  onSelect,
  onRename,
  onToggleVisible,
  onToggleLock,
  onLongPress,
}: {
  layer: LayerInfo;
  active: boolean;
  thumb: string | undefined;
  dragging: boolean;
  offset: number;
  onSelect: () => void;
  onRename: (name: string) => void;
  onToggleVisible: () => void;
  onToggleLock: () => void;
  onLongPress: (e: PointerEvent) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(layer.name);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  useEffect(() => clear, []);

  const finishRename = () => {
    setEditing(false);
    const name = draft.trim();
    if (name && name !== layer.name) onRename(name.slice(0, 40));
    else setDraft(layer.name);
  };

  const cls = ['pt-layer', active ? 'is-active' : '', dragging ? 'is-dragging' : '', layer.visible ? '' : 'is-hidden'].filter(Boolean).join(' ');
  return (
    <li
      class={cls}
      style={offset ? { transform: `translateY(${offset}px)` } : undefined}
      aria-current={active ? 'true' : undefined}
      data-layer-id={layer.id}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button, input')) return;
        start.current = { x: e.clientX, y: e.clientY };
        const ev = e;
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          timer.current = null;
          onLongPress(ev);
        }, LONG_PRESS_MS);
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8) clear();
      }}
      onPointerUp={clear}
      onPointerCancel={clear}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button, input')) return;
        onSelect();
      }}
    >
      <span class="pt-layer__thumb" aria-hidden="true">
        {thumb && <img src={thumb} alt="" draggable={false} />}
      </span>
      {editing ? (
        <input
          class="pt-layer__input"
          value={draft}
          aria-label="レイヤーの名前"
          maxLength={40}
          ref={(el) => el?.focus()}
          onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
          onBlur={finishRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setDraft(layer.name);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          class="pt-layer__name"
          title="タップで名前を変える"
          aria-label={`${layer.name}（${active ? '選択中。' : ''}タップで名前を変える）`}
          onClick={() => {
            if (!active) {
              onSelect();
              return;
            }
            setDraft(layer.name);
            setEditing(true);
          }}
        >
          {layer.name}
        </button>
      )}
      <button
        type="button"
        class={layer.visible ? 'pt-layer__btn' : 'pt-layer__btn is-off'}
        aria-label={layer.visible ? `${layer.name}を隠す` : `${layer.name}を表示する`}
        aria-pressed={layer.visible}
        title={layer.visible ? '表示中' : '非表示'}
        onClick={onToggleVisible}
      >
        <PaintIcon name={layer.visible ? 'eye' : 'eye-off'} size={22} />
      </button>
      <button
        type="button"
        class={layer.locked ? 'pt-layer__btn is-locked' : 'pt-layer__btn is-off'}
        aria-label={layer.locked ? `${layer.name}のロックを外す` : `${layer.name}をロックする`}
        aria-pressed={layer.locked}
        title={layer.locked ? 'ロック中' : 'ロックなし'}
        onClick={onToggleLock}
      >
        <PaintIcon name={layer.locked ? 'lock' : 'unlock'} size={22} />
      </button>
    </li>
  );
}

export function LayerPanel({ engine, onClose }: { engine: CanvasEngine; onClose: () => void }) {
  const { layers, active } = useLayers(engine);
  const thumbs = useThumbnails(engine, layers);
  const rows = [...layers].reverse();
  const count = layers.length;
  const activeRow = rows.findIndex((l) => l.id === active);
  const activeLayer = rows[activeRow];
  const [opacity, setOpacity] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [drag, setDrag] = useState<{ id: string; from: number; over: number; dy: number } | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  // アクティブ行が変わったら不透明度の下書きを捨てる
  useEffect(() => setOpacity(null), [active]);

  const shownOpacity = Math.round((opacity ?? activeLayer?.opacity ?? 1) * 100);

  const add = () => {
    const at = activeRow >= 0 ? engineIndexOfRow(activeRow, count) + 1 : count;
    const l = engine.addLayer({ name: nextLayerName(layers), index: at });
    engine.setActiveLayer(l.id);
  };
  const duplicate = () => {
    if (!activeLayer) return;
    const l = engine.duplicateLayer(activeLayer.id);
    engine.setActiveLayer(l.id);
  };
  const mergeDown = () => {
    if (!activeLayer || activeRow >= count - 1) return;
    engine.mergeDown(activeLayer.id);
  };
  const remove = () => {
    setConfirmDelete(false);
    if (!activeLayer || count <= 1) return;
    engine.removeLayer(activeLayer.id);
  };
  const move = (dir: -1 | 1) => {
    if (!activeLayer) return;
    const row = activeRow + dir;
    if (row < 0 || row >= count) return;
    engine.moveLayer(activeLayer.id, engineIndexOfRow(row, count));
  };

  // 長押しでつかむ → 指の位置の行へ
  const startDrag = (id: string, row: number, e: PointerEvent) => {
    const el = e.currentTarget as HTMLElement | null;
    try {
      (el ?? listRef.current)?.setPointerCapture?.(e.pointerId);
    } catch {
      // もう指が離れていた
    }
    const startY = e.clientY;
    setDrag({ id, from: row, over: row, dy: 0 });
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const dy = ev.clientY - startY;
      const over = Math.max(0, Math.min(count - 1, row + Math.round(dy / ROW_H)));
      setDrag({ id, from: row, over, dy });
    };
    const onEnd = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      const d = dragRef.current;
      setDrag(null);
      if (d && d.over !== d.from) engine.moveLayer(d.id, engineIndexOfRow(d.over, count));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  };

  const offsetOf = (row: number): number => {
    if (!drag) return 0;
    if (row === drag.from) return drag.dy;
    if (drag.from < drag.over && row > drag.from && row <= drag.over) return -ROW_H;
    if (drag.from > drag.over && row < drag.from && row >= drag.over) return ROW_H;
    return 0;
  };

  return (
    <aside class="pt-layers" aria-label="レイヤー" data-testid="layer-panel">
      <header class="pt-layers__head">
        <span class="pt-layers__title">レイヤー</span>
        <span class="num pt-layers__count">{count}</span>
        <button type="button" class="pt-iconbtn" aria-label="レイヤーを閉じる" onClick={onClose}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </header>
      <ol class={drag ? 'pt-layers__list is-sorting' : 'pt-layers__list'} ref={listRef} aria-label="レイヤーの一覧（上が手前）">
        {rows.map((l, row) => (
          <LayerRow
            key={l.id}
            layer={l}
            active={l.id === active}
            thumb={thumbs.get(l.id)}
            dragging={drag?.id === l.id}
            offset={offsetOf(row)}
            onSelect={() => engine.setActiveLayer(l.id)}
            onRename={(name) => engine.setLayer(l.id, { name })}
            onToggleVisible={() => engine.setLayer(l.id, { visible: !l.visible })}
            onToggleLock={() => engine.setLayer(l.id, { locked: !l.locked })}
            onLongPress={(e) => startDrag(l.id, row, e)}
          />
        ))}
      </ol>
      {activeLayer && (
        <div class="pt-layers__props">
          <label class="pt-layers__row">
            <span class="pt-layers__label">不透明度</span>
            <input
              type="range"
              class="slider"
              min={0}
              max={100}
              step={1}
              value={shownOpacity}
              aria-label="レイヤーの不透明度"
              style={{ '--fill': `${shownOpacity}%` } as Record<string, string>}
              onInput={(e) => {
                // ドラッグ中もその場で反映する（エンジンが続けての不透明度の変更を 1 手にまとめる）
                const v = Number((e.currentTarget as HTMLInputElement).value) / 100;
                setOpacity(v);
                if (v !== activeLayer.opacity) engine.setLayer(activeLayer.id, { opacity: v });
              }}
              onChange={() => setOpacity(null)}
            />
            <span class="num pt-layers__val">{shownOpacity}%</span>
          </label>
          <div class="pt-layers__row">
            <span class="pt-layers__label">合成</span>
            <div class="pt-seg" role="radiogroup" aria-label="合成モード">
              {BLEND_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={activeLayer.blend === o.value}
                  class={activeLayer.blend === o.value ? 'pt-seg__item is-selected' : 'pt-seg__item'}
                  onClick={() => engine.setLayer(activeLayer.id, { blend: o.value })}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div class="pt-layers__order">
            <button type="button" class="pt-iconbtn" aria-label="手前へ" title="手前へ" disabled={activeRow <= 0} onClick={() => move(-1)}>
              <PaintIcon name="up" size={22} />
            </button>
            <button type="button" class="pt-iconbtn" aria-label="奥へ" title="奥へ" disabled={activeRow >= count - 1} onClick={() => move(1)}>
              <PaintIcon name="down" size={22} />
            </button>
            <span class="pt-layers__hint">長押しでつかんで並べ替え</span>
          </div>
        </div>
      )}
      <footer class="pt-layers__foot">
        <button type="button" class="pt-footbtn" onClick={add}>
          <PaintIcon name="add-layer" size={22} />
          <span>追加</span>
        </button>
        <button type="button" class="pt-footbtn" disabled={!activeLayer} onClick={duplicate}>
          <PaintIcon name="duplicate" size={22} />
          <span>複製</span>
        </button>
        <button type="button" class="pt-footbtn" disabled={!activeLayer || activeRow >= count - 1} onClick={mergeDown}>
          <PaintIcon name="merge" size={22} />
          <span>下と結合</span>
        </button>
        <button type="button" class="pt-footbtn is-danger" disabled={!activeLayer || count <= 1} onClick={() => setConfirmDelete(true)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5" />
          </svg>
          <span>削除</span>
        </button>
      </footer>
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`「${activeLayer?.name ?? ''}」を消しますか`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              やめる
            </Button>
            <Button variant="danger" onClick={remove}>
              消す
            </Button>
          </>
        }
      >
        <p>このレイヤーの絵も消えます。元に戻す（Undo）で戻せます。</p>
      </Modal>
    </aside>
  );
}
