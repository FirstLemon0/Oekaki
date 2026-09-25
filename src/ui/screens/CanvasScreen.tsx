/**
 * キャンバス画面（DESIGN_SYSTEM §3 キャンバス・§4 縦向き）。
 *
 * 地 canvas。上中央 課題ピル（折り畳み可）、右上 カウンター、左中央 ツールバー＋取っ手＋グリッド、
 * 左下「ペンのみ」、右下 主「完了」。左利きではツールバーが右端、完了が左下。
 * 描いている間は何も動かさない（トースト・アニメなし）。採点シートは sheet に渡す。
 *
 * ツールバー（DESIGN_SYSTEM §2）: ペン・消しゴム・補助線・元に戻す・やり直す・全消し・お手本・グリッド・左右反転・
 * シルエット・再生・課題（?）。右横に取っ手 36×48、その下に「グリッド」ミニセグメント
 * （なし／2／3／4／6／8 分割 と 25／50／100 px の 2 段）。
 *
 * 補助線（アイコンは点線の斜め線）: 当たりや目安を引く細い線（1.5px・ink-2 色・不透明度 0.35）。
 * 採点・本数・累計には数えない（engine.getStrokes() に出ない）。再生と保存画像には薄く残る。
 * 採点するドリル（lockPen）でも使える。ジェスチャーのミニツールバーには出さない。
 *
 * お手本（side）: sideMatch のときは紙と同じ大きさの枠に出す（横向きは左右半分ずつ、縦向きは上下半分ずつ）。
 * 重ね表示（overlay）も紙に収まる最大で描くので、横に見るお手本と重ねたお手本が同じ大きさになる。
 *
 * 左上のパネル（topLeft: 構築の手順カード）は、ツールバーとグリッド欄の右隣（左利きは戻るボタンの右）に置き、
 * 課題ピルはカードの上に同じ幅で並べる（ツールバー・グリッド欄・課題ピルと重ならない）。縦向きはツールバーの下。
 *
 * ペン・消しゴムは、選択中にもう一度タップ（またはロングプレス 400ms）で小パネル（ペンは ToolPanels、消しゴムは太さだけ）。
 * 消しゴムは普通のラスター消しゴム（通った所だけ消える）。選択中はカーソル位置に輪（半径 = 太さ）が出る。
 * 設定は端末内の好み（localStorage、canvasPrefs）。採点するドリル（lockPen）ではペン・墨に固定する。
 * 紙に触れたらパネルは閉じる（描いている間は出さない）。左右反転は絵だけ（グリッドは固定）。
 *
 * 左上の「← 戻る」ピル（BackPill）。保存していない線があるときは、戻る・端末の戻る・閉じるで確認を出す（navGuard）。
 * 描いている間は線が変わるたび（1 秒まとめて）に下書きを sessionStorage へ保存し（draftKey があるとき）、
 * 同じステップを開き直したら「続きから／捨てる」を出す。保存が済んで画面を離れたら下書きは消す。
 * ツールバーの取っ手の下に「反対側へ」（左右矢印）: ツールバー・グリッド欄・完了ボタンを反対側へ移す（設定の利き手と連動）。
 * ドリルでは「紙を替える」（onNewPaper）で表示上の線を消せる（本数・累計はそのまま）。
 *
 * 紙の大きさが変わったとき（画面の回転など）は、描いた線を「中心合わせ・短辺の比で拡縮」して動かす。
 * お手本（fitTemplate）やドリルの手がかりも同じ規則で作り直されるので、線と目標がずれない。
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { CanvasView, PEN_PRESETS, type CanvasEngine, type EraserStyle, type OverlaySpec, type PenStyle, type StrokeHistory, type Tool } from '@/canvas';
import type { StrokePoint } from '@/scoring';
import { BackPill, Button, Icon, Modal, Slider } from '../components';
import { saveSettings, uiPrefs } from '../state';
import { href, navigate } from '../router';
import { armLeaveGuard, requestLeave } from '../navGuard';
import { clearDraft, loadDraft, saveDraft, type Draft } from '../draft';
import { LsIcon } from '../lesson/LsIcon';
import { rescaleMap, type Size } from '../lesson/drillSetup';
import {
  GRID_DIVIDE,
  GRID_PITCH,
  gridLabel,
  ERASER_SIZE,
  gridSpecOf,
  loadEraserStyle,
  loadPenStyle,
  loadRecentColors,
  pushRecentColor,
  saveEraserStyle,
  savePenStyle,
  saveRecentColors,
  loadFillPrefs,
  saveFillPrefs,
  loadShapeTool,
  saveShapeTool,
  normalizeColor,
  SHAPE_LABEL,
  type FillPrefs,
  type GridKey,
  type ShapeTool,
} from './canvasPrefs';
import { PenPanel, penDotColor } from './ToolPanels';
import { PaintIcon } from '../paint/PaintIcon';
import { FillPanel, ShapePanel, ZoomPill } from '../paint/PaintPanels';
import { LayerPanel } from '../paint/LayerPanel';
import { isSelectTool, releaseSelection, SelectionOverlay } from '../paint/SelectionOverlay';
import { isRichDocument, rescaleDocument, settleTransform } from '../paint/canvasDoc';

/** 採点するドリルで使う固定のペン（「ペン」の既定・墨） */
function lockedPen(): PenStyle {
  return { preset: 'pen', size: PEN_PRESETS.pen.size, opacity: PEN_PRESETS.pen.opacity, color: undefined };
}

const LONG_PRESS_MS = 400;

/** lesson.css の縦向きレイアウトと同じ条件 */
const PORTRAIT_QUERY = '(orientation: portrait), (max-width: 900px)';

/** 消しゴムの小パネル: 太さ（半径 4〜40）だけ */
function EraserSizePanel({ style, onChange }: { style: EraserStyle; onChange: (next: EraserStyle) => void }) {
  return (
    <div class="ls-pop ls-toolpanel" role="group" aria-label="消しゴムの設定">
      <span class="ls-toolpanel__title">消しゴム</span>
      <label class="ls-toolpanel__row">
        <span class="ls-toolpanel__label">太さ</span>
        <Slider value={style.size} min={ERASER_SIZE.min} max={ERASER_SIZE.max} onInput={(v) => onChange({ size: v })} label="消しゴムの太さ" width={150} />
        <span class="num ls-pop__val">{style.size}</span>
      </label>
    </div>
  );
}

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
  /**
   * side を紙と同じ大きさの枠にする（お手本用）。お手本を枠に収まる最大で出せば、
   * 重ね表示（キャンバスに収まる最大）と同じ大きさになる。
   */
  sideMatch?: boolean;
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
  /**
   * フルツール（お絵描き v2）: 塗りつぶし・スポイト・図形・選択と変形・手のひら・レイヤーパネル・HSV ピッカー。
   * 自由お絵描きと、採点しない描くステップ（copy / construct / mosha / gesture / free / critique）で使う。
   * 採点する画面（ドリル・なぞり・校正・復習）は付けない（従来の簡易ツール）。
   */
  full?: boolean;
  /**
   * 採点する画面（ドリル・なぞり・較正）: ペンを「ペン」・墨に固定する。
   * 採点は線の精度を見るため。パネルにはその旨だけ出す。
   */
  lockPen?: boolean;
  /** 下書きの保存先（draft.ts の draftKey）。無ければ下書きを保存しない */
  draftKey?: string | null;
  /** 今の線は保存済み（戻っても消えない）。true のあいだは離脱の確認を出さない */
  saved?: boolean;
  /** 下書きを戻すとき（既定は engine.loadHistory）。ドリルは採点し直す */
  onRestoreDraft?: (h: StrokeHistory) => void;
  /** 「紙を替える」（ドリルの薄表示）。渡したときだけツールバーに出す */
  onNewPaper?: () => void;
}

/** 下書きの保存は線が変わってから 1 秒まとめて */
const DRAFT_DEBOUNCE_MS = 1000;

function ToolButton({
  icon,
  label,
  onClick,
  onLongPress,
  expanded,
  selected,
  disabled,
  children,
}: {
  icon?: Parameters<typeof Icon>[0]['name'];
  label: string;
  onClick: () => void;
  /** 400ms 押し続けたとき（このときは onClick を呼ばない） */
  onLongPress?: () => void;
  /** 小パネルが開いているか（aria-expanded） */
  expanded?: boolean;
  selected?: boolean;
  disabled?: boolean;
  children?: ComponentChildren;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);
  return (
    <button
      type="button"
      class={selected ? 'ls-tool is-selected' : 'ls-tool'}
      aria-label={label}
      aria-pressed={selected === undefined ? undefined : selected}
      aria-expanded={expanded}
      title={label}
      disabled={disabled}
      onPointerDown={
        onLongPress
          ? () => {
              fired.current = false;
              clear();
              timer.current = setTimeout(() => {
                timer.current = null;
                fired.current = true;
                onLongPress();
              }, LONG_PRESS_MS);
            }
          : undefined
      }
      onPointerUp={onLongPress ? clear : undefined}
      onPointerLeave={onLongPress ? clear : undefined}
      onPointerCancel={onLongPress ? clear : undefined}
      onContextMenu={onLongPress ? (e) => e.preventDefault() : undefined}
      onClick={() => {
        if (fired.current) {
          fired.current = false;
          return;
        }
        onClick();
      }}
    >
      {icon ? <Icon name={icon} size={24} /> : children}
    </button>
  );
}

export function CanvasScreen(props: CanvasScreenProps) {
  const { engine, overlay } = props;
  const prefs = uiPrefs.value;
  const lockPen = props.lockPen === true;
  const full = props.full === true && !props.mini;
  const [tool, setTool] = useState<Tool>('pen');
  const [penStyle, setPenStyle] = useState<PenStyle>(() => loadPenStyle() ?? engine.getPen());
  const [eraserStyle, setEraserStyle] = useState<EraserStyle>(() => loadEraserStyle());
  const [recentColors, setRecentColors] = useState<string[]>(() => loadRecentColors());
  /** 開いている小パネル */
  const [panel, setPanel] = useState<'pen' | 'eraser' | 'fill' | 'shape' | null>(null);
  // ---- フルツール ----
  const [shape, setShape] = useState<ShapeTool>(() => loadShapeTool());
  const [fillPrefs, setFillPrefs] = useState<FillPrefs>(() => loadFillPrefs());
  const [layersOpen, setLayersOpen] = useState(false);
  /** 選択範囲があるか（課題ピルの代わりに変形バーを出す） */
  const [selActive, setSelActive] = useState(false);
  /** アクティブなレイヤーがロック中か（描けない旨を出す） */
  const [activeLocked, setActiveLocked] = useState(false);
  /** スポイトで色を取ったら戻るツール */
  const beforeDropper = useRef<Tool>('pen');
  const penStyleRef = useRef(penStyle);
  penStyleRef.current = penStyle;
  const recentRef = useRef(recentColors);
  recentRef.current = recentColors;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const [grid, setGrid] = useState<GridKey>('none');
  const [flipped, setFlipped] = useState(false);
  const [silhouette, setSilhouette] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [taskOpen, setTaskOpen] = useState(true);
  const [opacityOpen, setOpacityOpen] = useState(false);
  const [opacity, setOpacity] = useState(overlay?.opacity ?? 0.4);
  /** グリッドのツールボタンで戻す先（最後に選んだ分割） */
  const [lastGrid, setLastGrid] = useState<Exclude<GridKey, 'none'>>('d3');
  const [, setTick] = useState(0);
  const [replaying, setReplaying] = useState(false);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const paperRef = useRef<HTMLDivElement>(null);
  const exitRef = useRef<HTMLDivElement>(null);
  /** 履歴の本数（消しゴム・補助線を含む）。1 本以上で、保存していなければ離脱を確かめる */
  const [histLen, setHistLen] = useState(() => engine.getHistory().strokes.length);
  /** 離脱の確認（「戻る」を選んだら呼ぶ） */
  const [leaveAsk, setLeaveAsk] = useState<(() => void) | null>(null);
  /** 開いたときに見つかった下書き（続きから／捨てる を選ぶまで） */
  const draftKey = props.draftKey ?? null;
  const [draftOffer, setDraftOffer] = useState<Draft | null>(() => (draftKey ? loadDraft(draftKey) : null));
  const draftOfferRef = useRef(draftOffer);
  draftOfferRef.current = draftOffer;
  const savedRef = useRef(props.saved === true);
  savedRef.current = props.saved === true;
  const onExitRef = useRef(props.onExit);
  onExitRef.current = props.onExit;

  // 設定の反映
  useEffect(() => {
    engine.setOptions({ penOnly: prefs.penOnly, leftHanded: prefs.leftHanded });
  }, [engine, prefs.penOnly, prefs.leftHanded]);

  useEffect(() => {
    engine.setOptions({ grid: gridSpecOf(grid), flipped, silhouette });
  }, [engine, grid, flipped, silhouette]);

  useEffect(() => {
    engine.setTool(tool);
  }, [engine, tool]);

  // ペン・消しゴムの設定（採点するドリルではペン・墨に固定）。色なし＝墨に戻すため color は常に渡す
  useEffect(() => {
    engine.setPen(lockPen ? lockedPen() : { ...penStyle, color: penStyle.color });
  }, [engine, lockPen, penStyle]);

  useEffect(() => {
    engine.setEraser(eraserStyle);
  }, [engine, eraserStyle]);

  const changePen = (next: PenStyle) => {
    if (lockPen) return;
    setPenStyle(next);
    savePenStyle(next);
  };
  const changeEraser = (next: EraserStyle) => {
    const v = { size: next.size };
    setEraserStyle(v);
    saveEraserStyle(v);
  };
  const rememberColor = (color: string) => {
    const list = pushRecentColor(recentRef.current, color);
    setRecentColors(list);
    saveRecentColors(list);
  };

  // ---- フルツール: 塗りつぶしの設定・スポイト・レイヤーのロック ----
  useEffect(() => {
    if (full) engine.setFill(fillPrefs);
  }, [engine, full, fillPrefs]);
  const changeFill = (next: FillPrefs) => {
    setFillPrefs(next);
    saveFillPrefs(next);
  };

  // スポイト: エンジンが setPen({color}) して 'toolchange' を出す。ペンの色に反映して直近に記憶し、前のツールへ戻る
  useEffect(() => {
    if (!full) return;
    return engine.on('toolchange', () => {
      const picked = normalizeColor(engine.getPen().color);
      const cur = penStyleRef.current;
      if (!picked || picked === normalizeColor(cur.color)) return;
      const next: PenStyle = { ...cur, color: picked };
      setPenStyle(next);
      savePenStyle(next);
      rememberColor(picked);
      if (toolRef.current === 'eyedropper') {
        const back = beforeDropper.current;
        engine.setTool(back);
        setTool(back);
      }
    });
  }, [engine, full]);

  useEffect(() => {
    if (!full) return;
    const read = () => {
      const id = engine.getActiveLayer();
      setActiveLocked(engine.getLayers().some((l) => l.id === id && l.locked));
    };
    read();
    return engine.on('layerschange', read);
  }, [engine, full]);

  /** ツールを替える（選択ツールから離れるときは変形を確定して選択を外す） */
  const switchTool = (t: Tool) => {
    if (full && isSelectTool(tool) && !isSelectTool(t)) releaseSelection(engine);
    if (t === 'eyedropper' && tool !== 'eyedropper') beforeDropper.current = tool === 'fill' ? 'fill' : 'pen';
    engine.setTool(t); // 描画直後の最初のホバーから消しゴムの輪を出すため、effect を待たずに渡す
    setTool(t);
  };

  /** 小パネルを持つツール */
  const panelOf = (t: Tool): 'pen' | 'eraser' | 'fill' | 'shape' | null =>
    t === 'pen' || t === 'eraser' || t === 'fill' ? t : t === 'shape-line' || t === 'shape-rect' || t === 'shape-ellipse' ? 'shape' : null;

  /** ツールボタン: 未選択なら選ぶ。選択中にもう一度押したら小パネルを開け閉め（補助線などは小パネルなし） */
  const pickTool = (t: Tool) => {
    if (tool === t) {
      const p = panelOf(t);
      if (p) setPanel(panel === p ? null : p);
      return;
    }
    switchTool(t);
    setPanel(null);
  };
  const longPressTool = (t: Tool) => {
    if (tool !== t) switchTool(t);
    setPanel(panelOf(t));
  };
  const pickShape = (s: ShapeTool) => {
    setShape(s);
    saveShapeTool(s);
    switchTool(s);
    setPanel(null); // サブ選択なので選んだら閉じる
  };

  // 紙に触れたら（描き始めたら）小パネルを閉じる。描いている間は出さない
  useEffect(() => {
    const el = paperRef.current;
    if (!el) return;
    const close = () => setPanel(null);
    el.addEventListener('pointerdown', close, true);
    return () => el.removeEventListener('pointerdown', close, true);
  }, []);

  // 畳んだとき・採点シートが出たときも閉じる
  const hasSheet = Boolean(props.sheet);
  useEffect(() => {
    if (collapsed || hasSheet) setPanel(null);
  }, [collapsed, hasSheet]);

  // Undo/Redo の可否・履歴の本数を追う（フルツールはレイヤー・塗りなどの操作も数える）
  useEffect(() => {
    const read = () => {
      setTick((t) => t + 1);
      const n = engine.getHistory().strokes.length;
      setHistLen(full ? Math.max(n, engine.getStrokes().length, engine.canUndo() ? 1 : 0) : n);
    };
    const offs = [engine.on('change', read)];
    if (full) offs.push(engine.on('opsend', read), engine.on('layerschange', read));
    return () => offs.forEach((f) => f());
  }, [engine, full]);

  // 保存していない線があるあいだ: 戻る・端末の戻る・閉じるで確かめる
  const dirty = histLen > 0 && props.saved !== true && draftOffer === null;
  useEffect(() => {
    if (!dirty) return;
    return armLeaveGuard(
      (proceed) => setLeaveAsk(() => proceed),
      () => {
        const exit = onExitRef.current;
        if (exit) exit();
        else navigate(href.home());
      },
    );
  }, [dirty]);

  // 下書き: 線が変わるたび 1 秒まとめて保存。画面を離れたら（保存して進んだ・戻るを選んだ）消す
  useEffect(() => {
    if (!draftKey) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onChange = () => {
      // 下書きを戻すか決めるまでは上書きしない
      if (draftOfferRef.current) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (savedRef.current) {
          clearDraft(draftKey);
          return;
        }
        // フルツールでレイヤー・塗りなどを使っていれば文書ごと（getDocument）残す
        const doc = full ? engine.getDocument() : null;
        saveDraft(draftKey, engine.getHistory(), engine.size(), doc && isRichDocument(doc) ? doc : null);
      }, DRAFT_DEBOUNCE_MS);
    };
    const offs = [engine.on('change', onChange)];
    if (full) offs.push(engine.on('opsend', onChange), engine.on('layerschange', onChange));
    return () => {
      offs.forEach((f) => f());
      if (timer !== null) clearTimeout(timer);
      clearDraft(draftKey);
    };
  }, [engine, draftKey, full]);
  useEffect(() => {
    if (draftKey && props.saved) clearDraft(draftKey);
  }, [draftKey, props.saved]);

  const restoreDraft = () => {
    const d = draftOffer;
    setDraftOffer(null);
    if (!d) return;
    // 文書つきの下書き（レイヤー等）は loadDocument で戻す（座標はキャンバス座標のまま。ビューで合わせる）
    const cur = engine.size();
    const resized = cur.width > 0 && cur.height > 0 && (cur.width !== d.size.width || cur.height !== d.size.height);
    if (d.doc && full) {
      engine.loadDocument(resized ? rescaleDocument(d.doc, d.size, cur) : d.doc);
      return;
    }
    let h = d.history;
    if (resized) {
      const map = rescaleMap(d.size, cur);
      h = { strokes: h.strokes.map((st) => st.map(map)), styles: h.styles };
    }
    if (props.onRestoreDraft) props.onRestoreDraft(h);
    else engine.loadHistory(h);
  };
  const discardDraft = () => {
    if (draftKey) clearDraft(draftKey);
    setDraftOffer(null);
  };

  const exit = () => {
    const fn = props.onExit;
    if (fn) requestLeave(fn);
  };

  const swapSide = () => {
    void saveSettings({ leftHanded: !prefs.leftHanded });
  };

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

  // 左上のパネル（構築の手順カード）の位置: ツールバー＋グリッド欄の右隣（縦向きはその下）
  const stageRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [topLeftPos, setTopLeftPos] = useState<{ left: number; top: number; portrait: boolean } | null>(null);
  const hasTopLeft = Boolean(props.topLeft);
  useLayoutEffect(() => {
    if (!hasTopLeft) return;
    const stage = stageRef.current;
    const bar = toolbarRef.current;
    if (!stage || !bar) return;
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia(PORTRAIT_QUERY) : null;
    const place = () => {
      const s = stage.getBoundingClientRect();
      const b = bar.getBoundingClientRect();
      const portrait = mq?.matches ?? s.height > s.width;
      let next: { left: number; top: number; portrait: boolean };
      if (portrait) next = { left: 16, top: Math.round(b.bottom - s.top + 12), portrait };
      else if (prefs.leftHanded) {
        // 左利き: ツールバーは右端。左上の「戻る」の右隣に置く
        const ex = exitRef.current?.getBoundingClientRect();
        next = { left: ex ? Math.round(ex.right - s.left + 12) : 16, top: 16, portrait };
      }
      else next = { left: Math.round(b.right - s.left + 12), top: 16, portrait };
      setTopLeftPos((prev) => (prev && prev.left === next.left && prev.top === next.top && prev.portrait === next.portrait ? prev : next));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(stage);
    ro.observe(bar);
    mq?.addEventListener('change', place);
    return () => {
      ro.disconnect();
      mq?.removeEventListener('change', place);
    };
  }, [hasTopLeft, prefs.leftHanded, collapsed]);

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
    const resized = prev !== null && (prev.width !== size.width || prev.height !== size.height);
    if (resized && full) {
      // フルツール: 旧 API（loadHistory）はレイヤーを消すので、文書ごと座標を写して loadDocument で戻す
      const doc = engine.getDocument();
      if (doc.ops.length > 0) {
        settleTransform(engine);
        engine.setSelection(null);
        onRescaleRef.current?.(rescaleMap(prev, size));
        engine.loadDocument(rescaleDocument(engine.getDocument(), prev, size));
      }
    } else if (resized && prev) {
      const h = engine.getHistory();
      if (h.strokes.length > 0) {
        const map = rescaleMap(prev, size);
        onRescaleRef.current?.(map);
        // 消しゴムを含む履歴ごと動かす（線ごとの見た目・消した所もそのまま）
        engine.loadHistory({ strokes: h.strokes.map((s) => s.map(map)), styles: h.styles });
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

  const taskPill = (
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
  );

  const renderGridItem = (k: GridKey, label: string) => (
    <button
      key={k}
      type="button"
      role="radio"
      aria-checked={grid === k}
      aria-label={gridLabel(k)}
      title={gridLabel(k)}
      class={grid === k ? 'ls-gridseg__item is-selected' : 'ls-gridseg__item'}
      onClick={() => {
        setGrid(k);
        if (k !== 'none') setLastGrid(k);
      }}
    >
      {label}
    </button>
  );

  const isShape = tool === 'shape-line' || tool === 'shape-rect' || tool === 'shape-ellipse';
  /** フルツールのツールバー（2 列のグループ: 描く／選ぶ／編集／表示／ほか。縦向きは 2 段） */
  const fullToolbar = (
    <div class="ls-toolbar pt-toolbar" role="toolbar" aria-label="描画ツール">
      <div class="pt-group" role="group" aria-label="描く">
        <div class="ls-toolbar__pop-host is-static">
          <ToolButton label="ペン" selected={tool === 'pen'} expanded={panel === 'pen'} onClick={() => pickTool('pen')} onLongPress={() => longPressTool('pen')}>
            <span class="ls-tool__pen">
              <Icon name="pen" size={24} />
              <span class="ls-tool__dot" style={{ background: penDotColor(penStyle, lockPen) }} aria-hidden="true" />
            </span>
          </ToolButton>
          {panel === 'pen' && (
            <PenPanel full style={penStyle} locked={lockPen} recent={recentColors} onChange={changePen} onCustomColor={rememberColor} />
          )}
        </div>
        <div class="ls-toolbar__pop-host is-static">
          <ToolButton
            icon="eraser"
            label="消しゴム"
            selected={tool === 'eraser'}
            expanded={panel === 'eraser'}
            onClick={() => pickTool('eraser')}
            onLongPress={() => longPressTool('eraser')}
          />
          {panel === 'eraser' && <EraserSizePanel style={eraserStyle} onChange={changeEraser} />}
        </div>
        <ToolButton label="補助線（採点に数えない薄い線）" selected={tool === 'guide'} onClick={() => pickTool('guide')}>
          <LsIcon name="guide" size={24} />
        </ToolButton>
        <div class="ls-toolbar__pop-host is-static">
          <ToolButton
            label="塗りつぶし"
            selected={tool === 'fill'}
            expanded={panel === 'fill'}
            onClick={() => pickTool('fill')}
            onLongPress={() => longPressTool('fill')}
          >
            <span class="ls-tool__pen">
              <PaintIcon name="fill" />
              <span class="ls-tool__dot" style={{ background: penDotColor(penStyle, lockPen) }} aria-hidden="true" />
            </span>
          </ToolButton>
          {panel === 'fill' && <FillPanel prefs={fillPrefs} onChange={changeFill} />}
        </div>
        <ToolButton label="スポイト" selected={tool === 'eyedropper'} onClick={() => pickTool('eyedropper')}>
          <PaintIcon name="eyedropper" />
        </ToolButton>
        <div class="ls-toolbar__pop-host is-static">
          <ToolButton
            label={`図形（${SHAPE_LABEL[shape]}）`}
            selected={isShape}
            expanded={panel === 'shape'}
            onClick={() => (isShape ? pickTool(tool) : pickTool(shape))}
            onLongPress={() => longPressTool(shape)}
          >
            <PaintIcon name={shape} />
          </ToolButton>
          {panel === 'shape' && <ShapePanel shape={shape} onPick={pickShape} />}
        </div>
      </div>
      <div class="pt-group" role="group" aria-label="選ぶ">
        <ToolButton label="矩形選択" selected={tool === 'select-rect'} onClick={() => pickTool('select-rect')}>
          <PaintIcon name="select-rect" />
        </ToolButton>
        <ToolButton label="投げ縄" selected={tool === 'select-lasso'} onClick={() => pickTool('select-lasso')}>
          <PaintIcon name="select-lasso" />
        </ToolButton>
        <ToolButton label="手のひら（紙を動かす）" selected={tool === 'hand'} onClick={() => pickTool('hand')}>
          <PaintIcon name="hand" />
        </ToolButton>
      </div>
      <div class="pt-group" role="group" aria-label="編集">
        <ToolButton icon="undo" label="元に戻す" disabled={!engine.canUndo()} onClick={() => engine.undo()} />
        <ToolButton icon="redo" label="やり直す" disabled={!engine.canRedo()} onClick={() => engine.redo()} />
        <ToolButton
          label="紙を替える（このレイヤーを消す）"
          onClick={() => {
            releaseSelection(engine);
            engine.clearLayer(engine.getActiveLayer());
          }}
        >
          <LsIcon name="newpaper" size={24} />
        </ToolButton>
      </div>
      <div class="pt-group" role="group" aria-label="表示">
        <div class="ls-toolbar__pop-host">
          <ToolButton icon="overlay" label="お手本の不透明度" selected={opacityOpen} disabled={!overlay} onClick={() => setOpacityOpen(!opacityOpen)} />
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
        <ToolButton icon="flip" label="絵を左右反転（グリッドは固定）" selected={flipped} onClick={() => setFlipped(!flipped)} />
        <ToolButton icon="silhouette" label="シルエット" selected={silhouette} onClick={() => setSilhouette(!silhouette)} />
        <ToolButton icon="play" label={replaying ? '再生を止める' : '描いた順に再生'} selected={replaying} onClick={() => void replay()} />
        <ToolButton label="レイヤー" selected={layersOpen} expanded={layersOpen} onClick={() => setLayersOpen(!layersOpen)}>
          <PaintIcon name="layers" />
        </ToolButton>
      </div>
      <div class="pt-group" role="group" aria-label="ほか">
        <ToolButton icon="help" label={taskOpen ? '課題を隠す' : '課題を見る'} selected={taskOpen} onClick={() => setTaskOpen(!taskOpen)} />
      </div>
    </div>
  );

  const rootClass = [
    'ls-canvas',
    prefs.leftHanded ? 'is-left' : '',
    props.side ? 'has-side' : '',
    props.side && props.sideMatch ? 'has-side-match' : '',
    props.topLeft ? 'has-topleft' : '',
    collapsed ? 'is-collapsed' : '',
    full ? 'is-full' : '',
    full && layersOpen ? 'has-layers' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div class={rootClass}>
      {props.side && <aside class="ls-canvas__side">{props.side}</aside>}
      <div class="ls-canvas__stage" ref={stageRef}>
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
          <div class="ls-canvas__exit" ref={exitRef}>
            <BackPill label={props.exitLabel ?? '戻る'} onClick={exit} />
          </div>
        )}

        {full && !props.sheet && (
          <SelectionOverlay engine={engine} paperRef={paperRef} tool={tool} onActiveChange={setSelActive} />
        )}

        {props.topCenter ? (
          <div class="ls-canvas__center">{props.topCenter}</div>
        ) : (
          !props.topLeft && !(full && (selActive || isSelectTool(tool))) && taskPill
        )}

        {!props.mini && (
          <div class="ls-counterbox">
            {props.counterExtra}
            {props.counter && <div class="ls-counter num">{props.counter}</div>}
            <ZoomPill engine={engine} />
          </div>
        )}
        {props.mini && (props.counter || props.counterExtra) && (
          <div class="ls-counterbox">
            {props.counterExtra}
            {props.counter && <div class="ls-counter num">{props.counter}</div>}
          </div>
        )}

        {full && layersOpen && !props.sheet && <LayerPanel engine={engine} onClose={() => setLayersOpen(false)} />}

        {props.topLeft && (
          <div
            class={topLeftPos?.portrait ? 'ls-canvas__topleft is-portrait' : 'ls-canvas__topleft'}
            data-testid="canvas-topleft"
            style={
              topLeftPos
                ? topLeftPos.portrait
                  ? { top: `${topLeftPos.top}px`, left: '16px', right: '16px' }
                  : { top: `${topLeftPos.top}px`, left: `${topLeftPos.left}px` }
                : { visibility: 'hidden' }
            }
          >
            {!props.topCenter && taskPill}
            {props.topLeft}
          </div>
        )}

        <div class="ls-toolbar-wrap" ref={toolbarRef}>
          {!collapsed && full && fullToolbar}
          {!collapsed && !full && (
            <div class="ls-toolbar" role="toolbar" aria-label="描画ツール">
              <div class="ls-toolbar__pop-host is-static">
                <ToolButton
                  label="ペン"
                  selected={tool === 'pen'}
                  expanded={panel === 'pen'}
                  onClick={() => pickTool('pen')}
                  onLongPress={() => longPressTool('pen')}
                >
                  <span class="ls-tool__pen">
                    <Icon name="pen" size={24} />
                    <span class="ls-tool__dot" style={{ background: penDotColor(penStyle, lockPen) }} aria-hidden="true" />
                  </span>
                </ToolButton>
                {panel === 'pen' && (
                  <PenPanel style={penStyle} locked={lockPen} recent={recentColors} onChange={changePen} onCustomColor={rememberColor} />
                )}
              </div>
              {!props.mini && (
                <div class="ls-toolbar__pop-host is-static">
                  <ToolButton
                    icon="eraser"
                    label="消しゴム"
                    selected={tool === 'eraser'}
                    expanded={panel === 'eraser'}
                    onClick={() => pickTool('eraser')}
                    onLongPress={() => longPressTool('eraser')}
                  />
                  {panel === 'eraser' && <EraserSizePanel style={eraserStyle} onChange={changeEraser} />}
                </div>
              )}
              {!props.mini && (
                <ToolButton label="補助線（採点に数えない薄い線）" selected={tool === 'guide'} onClick={() => pickTool('guide')}>
                  <LsIcon name="guide" size={24} />
                </ToolButton>
              )}
              <ToolButton icon="undo" label="元に戻す" disabled={!engine.canUndo()} onClick={() => engine.undo()} />
              {!props.mini && <ToolButton icon="redo" label="やり直す" disabled={!engine.canRedo()} onClick={() => engine.redo()} />}
              <ToolButton icon="trash" label="全部消す" disabled={!engine.canUndo() && engine.getStrokes().length === 0} onClick={() => engine.clear()} />
              {props.onNewPaper && (
                <ToolButton label="紙を替える（本数・累計はそのまま）" onClick={props.onNewPaper}>
                  <LsIcon name="newpaper" size={24} />
                </ToolButton>
              )}
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
                  <ToolButton icon="flip" label="絵を左右反転（グリッドは固定）" selected={flipped} onClick={() => setFlipped(!flipped)} />
                  <ToolButton icon="silhouette" label="シルエット" selected={silhouette} onClick={() => setSilhouette(!silhouette)} />
                  <ToolButton icon="play" label={replaying ? '再生を止める' : '描いた順に再生'} selected={replaying} onClick={() => void replay()} />
                  <ToolButton icon="help" label={taskOpen ? '課題を隠す' : '課題を見る'} selected={taskOpen} onClick={() => setTaskOpen(!taskOpen)} />
                </>
              )}
            </div>
          )}
          <div class="ls-toolbar__aside">
            <div class="ls-toolbar__handles">
            <button
              type="button"
              class="ls-toolbar__handle"
              aria-label={collapsed ? 'ツールバーを開く' : 'ツールバーを畳む'}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed(!collapsed)}
            >
              <span aria-hidden="true" class="ls-toolbar__grip" />
            </button>
            <button type="button" class="ls-toolbar__handle ls-toolbar__swap" aria-label="ツールバーを反対側へ" title="ツールバーを反対側へ" onClick={swapSide}>
              <LsIcon name="swap" size={22} />
            </button>
            </div>
            {!collapsed && !props.mini && (
              <div class="ls-gridseg" role="radiogroup" aria-label="グリッド">
                <span class="ls-gridseg__label" aria-hidden="true">
                  グリッド（分割）
                </span>
                {GRID_DIVIDE.map((o) => renderGridItem(o.key, o.label))}
                <span class="ls-gridseg__label" aria-hidden="true">
                  方眼 px
                </span>
                {GRID_PITCH.map((o) => renderGridItem(o.key, o.label))}
              </div>
            )}
          </div>
        </div>

        {prefs.penOnly && <div class="ls-penonly">ペンのみ — 指では描けません</div>}
        {full && activeLocked && !isSelectTool(tool) && tool !== 'hand' && tool !== 'eyedropper' && (
          <div class="pt-locknote" role="status">
            <PaintIcon name="lock" size={18} />
            <span>このレイヤーはロック中です。描くときはレイヤーの鍵を外します</span>
          </div>
        )}

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
      <Modal
        open={leaveAsk !== null}
        onClose={() => setLeaveAsk(null)}
        title="描いた線が消えます。戻りますか？"
        actions={
          <>
            <Button variant="secondary" onClick={() => setLeaveAsk(null)}>
              描き続ける
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const go = leaveAsk;
                setLeaveAsk(null);
                if (draftKey) clearDraft(draftKey);
                go?.();
              }}
            >
              戻る
            </Button>
          </>
        }
      >
        <p>まだ保存していません。残したいときは「描き続ける」を選んで、完了のボタンで保存しましょう。</p>
      </Modal>
      <Modal
        open={draftOffer !== null}
        onClose={restoreDraft}
        title="描きかけがあります"
        actions={
          <>
            <Button variant="secondary" onClick={discardDraft}>
              捨てる
            </Button>
            <Button variant="primary" onClick={restoreDraft}>
              続きから
            </Button>
          </>
        }
      >
        <p>前に開いたときの線が残っています。続きから描きますか？</p>
      </Modal>
    </div>
  );
}
