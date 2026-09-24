/**
 * キャンバス画面（DESIGN_SYSTEM §3 キャンバス・§4 縦向き）。
 *
 * 地 canvas。上中央 課題ピル（折り畳み可）、右上 カウンター、左中央 ツールバー＋取っ手＋グリッド、
 * 左下「ペンのみ」、右下 主「完了」。左利きではツールバーが右端、完了が左下。
 * 描いている間は何も動かさない（トースト・アニメなし）。採点シートは sheet に渡す。
 *
 * ツールバー（DESIGN_SYSTEM §2）: ペン・消しゴム・元に戻す・やり直す・全消し・お手本・グリッド・左右反転・
 * シルエット・再生・課題（?）。右横に取っ手 36×48、その下に「グリッド」ミニセグメント（なし／3分割／4分割）。
 *
 * 紙の大きさが変わったとき（画面の回転など）は、描いた線を「中心合わせ・短辺の比で拡縮」して動かす。
 * お手本（fitTemplate）やドリルの手がかりも同じ規則で作り直されるので、線と目標がずれない。
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { CanvasView, type CanvasEngine, type OverlaySpec } from '@/canvas';
import type { StrokePoint } from '@/scoring';
import { Icon, Slider } from '../components';
import { uiPrefs } from '../state';
import { LsIcon } from '../lesson/LsIcon';
import { rescaleMap, type Size } from '../lesson/drillSetup';

export type Grid = 'none' | 'thirds' | 'quarters';

export interface CanvasScreenProps {
  engine: CanvasEngine;
  /** 課題ピルの文 */
  task: string;
  /** 右上「7/10」 */
  counter?: string | null;
  /** カウンターの左に並べる小さな表示（ドリルの点数チップ） */
  counterExtra?: ComponentChildren;
  /** 紙の大きさが変わって線を動かしたときに、同じ変換を受け取る（採点済みの線などを合わせる） */
  onRescale?: (map: (q: StrokePoint) => StrokePoint) => void;
  /** 完了ボタンの上に出す案内（保存の失敗など。トーストは描画中に出さない） */
  error?: string | null;
  onDone?: () => void;
  doneLabel?: string;
  doneDisabled?: boolean;
  /** 左上の戻る（無ければ出さない） */
  onExit?: () => void;
  exitLabel?: string;
  /** お手本の重ね。不透明度はツールバーで変えられる */
  overlay?: OverlaySpec | null;
  /** キャンバスの上に重ねる SVG の中身（viewBox はキャンバスの CSS px） */
  guide?: (size: Size) => ComponentChildren;
  onSize?: (size: Size) => void;
  /** 横に並べるパネル（見て描く・模写のお手本）。縦向きでは上 */
  side?: ComponentChildren;
  /** 左上のパネル（構築の手順など） */
  topLeft?: ComponentChildren;
  /** 下から出る採点シート。出ている間は描けない */
  sheet?: ComponentChildren;
  /** 右下の完了ボタンの隣に置く副ボタン */
  extraAction?: ComponentChildren;
  /** 上中央に出す大きな表示（ジェスチャーのタイマー）。指定時は課題ピルを出さない */
  topCenter?: ComponentChildren;
  /** ツールを減らす（ジェスチャーのミニツールバー） */
  mini?: boolean;
}

const GRID_OPTIONS: { value: Grid; label: string }[] = [
  { value: 'none', label: 'なし' },
  { value: 'thirds', label: '3分割' },
  { value: 'quarters', label: '4分割' },
];

function ToolButton({
  icon,
  label,
  onClick,
  selected,
  disabled,
  children,
}: {
  icon?: Parameters<typeof Icon>[0]['name'];
  label: string;
  onClick: () => void;
  selected?: boolean;
  disabled?: boolean;
  children?: ComponentChildren;
}) {
  return (
    <button
      type="button"
      class={selected ? 'ls-tool is-selected' : 'ls-tool'}
      aria-label={label}
      aria-pressed={selected === undefined ? undefined : selected}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {icon ? <Icon name={icon} size={24} /> : children}
    </button>
  );
}

export function CanvasScreen(props: CanvasScreenProps) {
  const { engine, overlay } = props;
  const prefs = uiPrefs.value;
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [grid, setGrid] = useState<Grid>('none');
  const [flipped, setFlipped] = useState(false);
  const [silhouette, setSilhouette] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [taskOpen, setTaskOpen] = useState(true);
  const [opacityOpen, setOpacityOpen] = useState(false);
  const [opacity, setOpacity] = useState(overlay?.opacity ?? 0.4);
  /** グリッドのツールボタンで戻す先（最後に選んだ分割） */
  const [lastGrid, setLastGrid] = useState<Exclude<Grid, 'none'>>('thirds');
  const [, setTick] = useState(0);
  const [replaying, setReplaying] = useState(false);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const paperRef = useRef<HTMLDivElement>(null);

  // 設定の反映
  useEffect(() => {
    engine.setOptions({ penOnly: prefs.penOnly, leftHanded: prefs.leftHanded });
  }, [engine, prefs.penOnly, prefs.leftHanded]);

  useEffect(() => {
    engine.setOptions({ grid, flipped, silhouette });
  }, [engine, grid, flipped, silhouette]);

  useEffect(() => {
    engine.setTool(tool);
  }, [engine, tool]);

  // Undo/Redo の可否を追う
  useEffect(() => engine.on('change', () => setTick((t) => t + 1)), [engine]);

  // 重ね（不透明度の変更は少し待ってから反映。画像の読み直しでちらつかないように）
  useEffect(() => {
    if (overlay) setOpacity(overlay.opacity);
  }, [overlay]);
  useEffect(() => {
    if (!overlay) {
      engine.setOverlay(null);
      return;
    }
    const id = setTimeout(() => engine.setOverlay({ ...overlay, opacity }), 90);
    return () => clearTimeout(id);
  }, [engine, overlay, opacity]);

  // 大きさ
  useEffect(() => {
    const el = paperRef.current;
    if (!el) return;
    const report = () => {
      const r = el.getBoundingClientRect();
      const s = { width: Math.round(r.width), height: Math.round(r.height) };
      setSize((prev) => (prev.width === s.width && prev.height === s.height ? prev : s));
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onSizeRef = useRef(props.onSize);
  onSizeRef.current = props.onSize;
  const onRescaleRef = useRef(props.onRescale);
  onRescaleRef.current = props.onRescale;
  const prevSize = useRef<Size | null>(null);
  useEffect(() => {
    if (size.width <= 0 || size.height <= 0) return;
    const prev = prevSize.current;
    prevSize.current = size;
    // 回転などで紙の大きさが変わった: 描いた線を同じ規則で動かす（目標は onSize で作り直される）
    if (prev && (prev.width !== size.width || prev.height !== size.height)) {
      const strokes = engine.getStrokes();
      if (strokes.length > 0) {
        const map = rescaleMap(prev, size);
        onRescaleRef.current?.(map);
        engine.loadStrokes(strokes.map((s) => s.map(map)));
      }
    }
    onSizeRef.current?.(size);
  }, [size, engine]);

  const replay = async () => {
    if (replaying) {
      engine.cancelReplay();
      return;
    }
    setReplaying(true);
    try {
      await engine.replay({ speed: 2 });
    } finally {
      setReplaying(false);
    }
  };

  const rootClass = [
    'ls-canvas',
    prefs.leftHanded ? 'is-left' : '',
    props.side ? 'has-side' : '',
    collapsed ? 'is-collapsed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div class={rootClass}>
      {props.side && <aside class="ls-canvas__side">{props.side}</aside>}
      <div class="ls-canvas__stage">
        <div class="ls-canvas__paper" ref={paperRef}>
          <CanvasView engine={engine} />
          {props.guide && size.width > 0 && (
            <svg
              class="ls-guide"
              viewBox={`0 0 ${size.width} ${size.height}`}
              width={size.width}
              height={size.height}
              aria-hidden="true"
              style={flipped ? { transform: 'scaleX(-1)' } : undefined}
            >
              {props.guide(size)}
            </svg>
          )}
          {props.sheet && <div class="ls-canvas__blocker" aria-hidden="true" />}
        </div>

        {props.onExit && (
          <button type="button" class="ls-glass-btn ls-canvas__exit" aria-label={props.exitLabel ?? '戻る'} title={props.exitLabel ?? '戻る'} onClick={props.onExit}>
            <Icon name="back" size={24} />
          </button>
        )}

        {props.topCenter ? (
          <div class="ls-canvas__center">{props.topCenter}</div>
        ) : (
          <div class={taskOpen ? 'ls-task' : 'ls-task is-folded'}>
            {taskOpen && <span class="ls-task__text">{props.task}</span>}
            <button
              type="button"
              class="ls-task__fold"
              aria-label={taskOpen ? '課題を畳む' : '課題を開く'}
              aria-expanded={taskOpen}
              onClick={() => setTaskOpen(!taskOpen)}
            >
              {taskOpen ? <LsIcon name="collapse" size={20} /> : <Icon name="help" size={20} />}
            </button>
          </div>
        )}

        {(props.counter || props.counterExtra) && (
          <div class="ls-counterbox">
            {props.counterExtra}
            {props.counter && <div class="ls-counter num">{props.counter}</div>}
          </div>
        )}

        {props.topLeft && <div class="ls-canvas__topleft">{props.topLeft}</div>}

        <div class="ls-toolbar-wrap">
          {!collapsed && (
            <div class="ls-toolbar" role="toolbar" aria-label="描画ツール">
              <ToolButton icon="pen" label="ペン" selected={tool === 'pen'} onClick={() => setTool('pen')} />
              {!props.mini && <ToolButton icon="eraser" label="消しゴム" selected={tool === 'eraser'} onClick={() => setTool('eraser')} />}
              <ToolButton icon="undo" label="元に戻す" disabled={!engine.canUndo()} onClick={() => engine.undo()} />
              {!props.mini && <ToolButton icon="redo" label="やり直す" disabled={!engine.canRedo()} onClick={() => engine.redo()} />}
              <ToolButton icon="trash" label="全部消す" disabled={!engine.canUndo() && engine.getStrokes().length === 0} onClick={() => engine.clear()} />
              {!props.mini && (
                <>
                  <div class="ls-toolbar__pop-host">
                    <ToolButton
                      icon="overlay"
                      label="お手本の不透明度"
                      selected={opacityOpen}
                      disabled={!overlay}
                      onClick={() => setOpacityOpen(!opacityOpen)}
                    />
                    {opacityOpen && overlay && (
                      <div class="ls-pop" role="group" aria-label="お手本の不透明度">
                        <Slider value={Math.round(opacity * 100)} min={0} max={100} onInput={(v) => setOpacity(v / 100)} label="お手本の不透明度" width={180} />
                        <span class="num ls-pop__val">{Math.round(opacity * 100)}%</span>
                      </div>
                    )}
                  </div>
                  <ToolButton
                    icon="grid"
                    label={grid === 'none' ? 'グリッドを出す' : 'グリッドを消す'}
                    selected={grid !== 'none'}
                    onClick={() => setGrid(grid === 'none' ? lastGrid : 'none')}
                  />
                  <ToolButton icon="flip" label="左右反転" selected={flipped} onClick={() => setFlipped(!flipped)} />
                  <ToolButton icon="silhouette" label="シルエット" selected={silhouette} onClick={() => setSilhouette(!silhouette)} />
                  <ToolButton icon="play" label={replaying ? '再生を止める' : '描いた順に再生'} selected={replaying} onClick={() => void replay()} />
                  <ToolButton icon="help" label={taskOpen ? '課題を隠す' : '課題を見る'} selected={taskOpen} onClick={() => setTaskOpen(!taskOpen)} />
                </>
              )}
            </div>
          )}
          <div class="ls-toolbar__aside">
            <button
              type="button"
              class="ls-toolbar__handle"
              aria-label={collapsed ? 'ツールバーを開く' : 'ツールバーを畳む'}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed(!collapsed)}
            >
              <span aria-hidden="true" class="ls-toolbar__grip" />
            </button>
            {!collapsed && !props.mini && (
              <div class="ls-gridseg" role="radiogroup" aria-label="グリッド">
                <span class="ls-gridseg__label" aria-hidden="true">
                  グリッド
                </span>
                {GRID_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={grid === o.value}
                    class={grid === o.value ? 'ls-gridseg__item is-selected' : 'ls-gridseg__item'}
                    onClick={() => {
                      setGrid(o.value);
                      if (o.value !== 'none') setLastGrid(o.value);
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {prefs.penOnly && <div class="ls-penonly">ペンのみ — 指では描けません</div>}

        <div class="ls-canvas__actions">
          {props.error && (
            <p class="ls-canvas__error" role="alert">
              {props.error}
            </p>
          )}
          {props.extraAction}
          {props.onDone && (
            <button type="button" class="ls-donebtn" disabled={props.doneDisabled} onClick={props.onDone}>
              <Icon name="check" size={24} />
              <span>{props.doneLabel ?? '完了'}</span>
            </button>
          )}
        </div>

        {props.sheet}
      </div>
    </div>
  );
}
