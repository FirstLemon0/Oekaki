/**
 * ジェスチャー（DESIGN_SYSTEM §3 ジェスチャー）。
 * 左 560px のパネルにポーズ人形（three.js・遅延読み込み）／取込画像、右にキャンバス、上中央 mono 96 のタイマー。
 * ポーズ順は pickPoseSequence(count, seed, poseIdsOf(poseGroup))、角度と光源は roundView(seed, n) で 1 体ごとに変える。
 * poseGroup（教材の gesture.poseGroup: standing / sitting / action / all）で出題の母集団を絞る（既定 all）。
 * URL の ?seed=<数> で seed を固定できる（E2E・不具合の再現用。例: /?seed=42#/lesson/…）。
 * 描いている間は人形を動かさない（ユーザーがドラッグしたときだけ回る）。
 * WebGL が使えない／読み込めないときは、同じ関節角から作った 2D 棒人形にフォールバックする。
 * 時間切れ（または「先に終える」）で見比べ画面（並べる／重ねる）→「次のポーズ」で count まで。
 * ペンを置いたまま時間切れになったときは、描きかけの線を確定してから止める（最後の線を消さない）。
 * 「次のポーズ」は保存待ちの間に 2 回押しても 1 回だけ記録する。
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { GestureStep } from '@/content/schema';
import type { Drawing } from '@/scoring';
import type { ReferenceImage } from '@/data/types';
import { listReferences } from '@/data/repo';
import { MannequinView } from '@/mannequin/MannequinView';
import { pickPoseSequence, poseIdsOf, seedFromSearch, type PoseId } from '@/mannequin/poses';
import { roundView } from '@/mannequin/camera';
import type { CompareSnapshot, MannequinViewApi, ViewState } from '@/mannequin/view';
import { Button, Segment } from '../components';
import { CanvasScreen } from './CanvasScreen';
import { ReferencePicker, useBlobUrl, useBusy, useCountdown, useEngine } from '../lesson/common';
import { POSE_VIEWBOX, poseBounds, stickPoseFor, type MannequinPose } from '../lesson/mannequin-poses';
import { bump, saveDocDrawing, saveStrokes, type LessonSession, type StrokeStyles } from '../lesson/stateBridge';
import { docForSave, exportForSave, resetCanvas, type SavedImage } from '../paint/canvasDoc';
import type { CanvasDocument } from '../paint/types';

/** three の読み込みがこれ以上かかったら 2D で始める */
const LOAD_TIMEOUT_MS = 6000;

type Fit = { x: number; y: number; w: number; h: number };

function PoseSvg({ pose, class: cls }: { pose: MannequinPose; class?: string }) {
  return (
    <svg class={cls} viewBox={`0 0 ${POSE_VIEWBOX.width} ${POSE_VIEWBOX.height}`} role="img" aria-label={`ポーズ: ${pose.label}`}>
      <circle cx={pose.head.x} cy={pose.head.y} r={pose.headR} />
      {pose.lines.map((l, i) => (
        <polyline key={i} points={l.map((q) => `${q.x},${q.y}`).join(' ')} />
      ))}
      {pose.lines.flat().map((q, i) => (
        <circle key={`j${i}`} class="ls-pose__joint" cx={q.x} cy={q.y} r={5} />
      ))}
    </svg>
  );
}

/** 自分の線を、ポーズの外接矩形に合わせて描く（見比べ「重ねる」用） */
function StrokesSvg({ strokes, fit, class: cls }: { strokes: Drawing; fit: Fit | null; class?: string }) {
  const pts = strokes.flat();
  if (pts.length === 0) return <svg class={cls} viewBox={`0 0 ${POSE_VIEWBOX.width} ${POSE_VIEWBOX.height}`} />;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const q of pts) {
    x0 = Math.min(x0, q.x);
    y0 = Math.min(y0, q.y);
    x1 = Math.max(x1, q.x);
    y1 = Math.max(y1, q.y);
  }
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  let transform = '';
  let viewBox = `${x0 - 16} ${y0 - 16} ${w + 32} ${h + 32}`;
  if (fit) {
    // 高さを合わせ、中心をそろえる
    const k = fit.h / h;
    const tx = fit.x + fit.w / 2 - (x0 + w / 2) * k;
    const ty = fit.y - y0 * k;
    transform = `translate(${tx} ${ty}) scale(${k})`;
    viewBox = `0 0 ${POSE_VIEWBOX.width} ${POSE_VIEWBOX.height}`;
  }
  return (
    <svg class={cls} viewBox={viewBox} preserveAspectRatio="xMidYMid meet">
      <g transform={transform}>
        {strokes.map((s, i) => (
          <polyline key={i} points={s.map((q) => `${q.x},${q.y}`).join(' ')} vector-effect="non-scaling-stroke" />
        ))}
      </g>
    </svg>
  );
}

function UserPose({ refImg }: { refImg: ReferenceImage }) {
  const url = useBlobUrl(refImg.image);
  return url ? <img class="ls-pose__img" src={url} alt="ポーズの画像" /> : null;
}

/** スナップショットの外接矩形（px）→ 棒人形と同じ viewBox 単位 */
function snapFit(s: CompareSnapshot): Fit | null {
  if (!s.bounds) return null;
  const k = POSE_VIEWBOX.width / s.width;
  return { x: s.bounds.x * k, y: s.bounds.y * k, w: s.bounds.w * k, h: s.bounds.h * k };
}

export interface GestureScreenProps {
  step: GestureStep;
  session?: LessonSession;
  lessonId: string | null;
  onFinish: () => void;
  onExit: () => void;
}

type GlState = 'loading' | 'ready' | 'unsupported';


/** 描いている最中のポインター（時間切れで確定させるため） */
interface LivePointer {
  target: EventTarget;
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  pressure: number;
}

/**
 * 描きかけの線を確定させる: キャンバスへ同じ pointerId の pointerup を送る
 * （エンジンは pointerup で線を確定する。本物の pointerup は後で来ても無視される）。
 */
export function commitLivePointer(p: LivePointer | null): void {
  if (!p || typeof PointerEvent === 'undefined') return;
  p.target.dispatchEvent(
    new PointerEvent('pointerup', {
      bubbles: true,
      pointerId: p.pointerId,
      pointerType: p.pointerType,
      clientX: p.clientX,
      clientY: p.clientY,
      pressure: p.pressure,
      button: 0,
    }),
  );
}

export function GestureScreen({ step, session, lessonId, onFinish, onExit }: GestureScreenProps) {
  const engine = useEngine();
  const [i, setI] = useState(0);
  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState<'draw' | 'compare'>('draw');
  const [mode, setMode] = useState<'side' | 'overlay'>('side');
  const [strokes, setStrokes] = useState<Drawing>([]);
  /** strokes と同じ並びの線ごとの見た目（保存用） */
  const stylesRef = useRef<StrokeStyles>([]);
  /** レイヤー・塗りなどを使った体の文書と画像（見比べのあと「次のポーズ」で保存） */
  const docRef = useRef<{ doc: CanvasDocument; image: Promise<SavedImage | undefined> } | null>(null);
  const [refs, setRefs] = useState<ReferenceImage[] | null>(step.source === 'user' ? null : []);
  const [picked, setPicked] = useState(false);
  const { busy, error, run } = useBusy();
  /** この体の記録の進み具合（失敗して押し直したときに二重にしない） */
  const rec = useRef({ bumped: false, saved: false });
  const livePointer = useRef<LivePointer | null>(null);

  // ポーズ人形: 出題順は 1 回のレッスンの中で固定
  const [seed] = useState(() => seedFromSearch() ?? (Math.random() * 2 ** 32) >>> 0);
  const poseGroup = step.poseGroup ?? 'all';
  const sequence = useMemo(() => pickPoseSequence(step.count, seed, poseIdsOf(poseGroup)), [step.count, seed, poseGroup]);
  const [gl, setGl] = useState<GlState>('loading');
  /** いま表示中の人形が ready になった回（`${i}-${round}`） */
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const apiRef = useRef<MannequinViewApi | null>(null);
  /** 「もう一度同じポーズ」でユーザーが回した角度を引き継ぐ */
  const savedView = useRef<{ i: number; state: ViewState } | null>(null);
  /** 見比べ用の人形の画像（描き終えた瞬間に撮る） */
  const [snap, setSnap] = useState<{ key: string; data: CompareSnapshot | 'pending' | 'failed' } | null>(null);

  useEffect(() => {
    if (step.source !== 'user') return;
    void listReferences().then((r) => setRefs([...r].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))));
  }, [step.source]);

  const useUser = step.source === 'user' && refs !== null && refs.length > 0;
  const userRef = useUser ? refs![i % refs!.length]! : null;
  const needPick = step.source === 'user' && refs !== null && refs.length === 0 && !picked;
  const useMannequin = !userRef && !needPick && refs !== null;
  const poseId: PoseId = sequence[i % Math.max(1, sequence.length)] ?? 'stand';
  const stick = useMemo(() => stickPoseFor(poseId), [poseId]);
  const roundKey = `${i}-${round}`;
  const mannequinLive = useMannequin && gl !== 'unsupported';
  const waitingForModel = mannequinLive && phase === 'draw' && readyKey !== roundKey;

  // three の読み込みが長引いたら 2D で始める（タイマーを待たせ続けない）
  useEffect(() => {
    if (!waitingForModel) return;
    const id = setTimeout(() => setGl('unsupported'), LOAD_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [waitingForModel, roundKey]);

  const endDraw = () => {
    // ペンを置いたままなら、描きかけの線を確定してから止める
    commitLivePointer(livePointer.current);
    livePointer.current = null;
    // 先に変形のプレビューを確定する（docForSave が確定させる）。そのあとで線・画像を取り、文書と食い違わないようにする
    const doc = docForSave(engine);
    setStrokes(engine.getStrokes());
    stylesRef.current = engine.getStyles();
    // レイヤー・塗りなどを使っていれば文書と画像（紙に付いているうちに書き出す。範囲つき）も取っておく
    docRef.current = doc ? { doc, image: exportForSave(engine, 1024).catch(() => undefined) } : null;
    const api = apiRef.current;
    if (api && useMannequin) {
      savedView.current = { i, state: api.getState() };
      const key = roundKey;
      setSnap({ key, data: 'pending' });
      // 描画と画素の読み出しはここで同期に済む（直後のアンマウントで dispose されても大丈夫）
      api.snapshotForCompare().then(
        (data) => setSnap((cur) => (cur && cur.key === key ? { key, data } : cur)),
        () => setSnap((cur) => (cur && cur.key === key ? { key, data: 'failed' } : cur)),
      );
    }
    apiRef.current = null;
    setPhase('compare');
  };

  const left = useCountdown(step.seconds, phase === 'draw' && !needPick && refs !== null && !waitingForModel, roundKey, endDraw);

  const snapHere = snap && snap.key === roundKey ? snap.data : null;
  const snapNow = snapHere && typeof snapHere === 'object' ? snapHere : null;
  const imageUrl = useBlobUrl(snapNow?.image);
  const silhouetteUrl = useBlobUrl(snapNow?.silhouette);
  const stickFit = useMemo(() => poseBounds(stick), [stick]);

  if (needPick) {
    return (
      <div class="ls-step ls-pick">
        <div class="ls-step__body">
          <span class="ls-label ls-label--accent">ジェスチャー</span>
          <p class="ls-prose">{step.instruction}</p>
          <p class="ls-muted">ポーズの写真や絵を取り込むと、それを順番に出します。取り込まない場合はポーズ人形で練習します。</p>
          <ReferencePicker
            title="ポーズの画像"
            onPick={(r) => {
              setRefs([r]);
              setPicked(true);
            }}
          />
          <Button variant="ghost" onClick={() => setPicked(true)}>
            ポーズ人形で練習する
          </Button>
        </div>
      </div>
    );
  }

  const label = `${i + 1}/${step.count}体目`;
  const initialView: Partial<ViewState> =
    savedView.current && savedView.current.i === i ? savedView.current.state : roundView(seed, i);

  const nextPose = () =>
    run(async () => {
      const drawn = strokes;
      const r = rec.current;
      const withDoc = docRef.current;
      if (!r.saved && withDoc) {
        await saveDocDrawing(withDoc.doc, drawn, stylesRef.current, 'lesson', lessonId, session, await withDoc.image);
      } else if (!r.saved && drawn.length > 0) {
        await saveStrokes(drawn, 'lesson', lessonId, session, stylesRef.current);
      }
      docRef.current = null;
      r.saved = true;
      if (!r.bumped) {
        await bump('gesture', 1, session);
        r.bumped = true;
      }
      rec.current = { bumped: false, saved: false };
      resetCanvas(engine);
      if (i + 1 >= step.count) {
        onFinish();
        return;
      }
      savedView.current = null;
      setSnap(null);
      setI(i + 1);
      setMode('side');
      setPhase('draw');
    });

  const sameAgain = () => {
    if (busy) return;
    resetCanvas(engine);
    docRef.current = null;
    setSnap(null);
    setRound(round + 1);
    setPhase('draw');
  };

  if (phase === 'compare') {
    // 並べる: 描き終えた瞬間の人形の画像／重ねる: accent 80% のシルエットに自分の線
    const poseSide = userRef ? (
      <UserPose refImg={userRef} />
    ) : imageUrl ? (
      <img class="mq-snap" src={imageUrl} alt={`ポーズ人形: ${stick.label}`} />
    ) : snapHere === 'pending' ? (
      <span class="ls-muted">人形を写しています…</span>
    ) : (
      <PoseSvg pose={stick} class="ls-pose__svg" />
    );
    const overlayPose = userRef ? (
      <UserPose refImg={userRef} />
    ) : silhouetteUrl ? (
      <img class="mq-silhouette" src={silhouetteUrl} alt={`ポーズ人形のシルエット: ${stick.label}`} />
    ) : snapHere === 'pending' ? null : (
      <PoseSvg pose={stick} class="ls-pose__svg is-overlay" />
    );
    const overlayFit = userRef ? null : snapNow && silhouetteUrl ? snapFit(snapNow) : stickFit;
    return (
      <div class="ls-compare">
        <header class="ls-compare__head">
          <div>
            <h2 class="ls-compare__title">見比べ</h2>
            <span class="ls-muted">
              <span class="num">{label}</span> · <span class="num">{step.seconds}</span>秒
            </span>
          </div>
          <Segment
            label="見比べ方"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'side', label: '並べる' },
              { value: 'overlay', label: '重ねる' },
            ]}
          />
        </header>
        {mode === 'side' ? (
          <div class="ls-compare__body">
            <div class="ls-compare__panel ls-compare__panel--pose">{poseSide}</div>
            <div class="ls-compare__panel ls-compare__panel--mine">
              <StrokesSvg strokes={strokes} fit={null} class="ls-mine__svg" />
            </div>
          </div>
        ) : (
          <div class="ls-compare__body is-overlay">
            <div class="ls-compare__panel ls-compare__panel--mine">
              <div class="ls-compare__legend">
                <span class="ls-legend__pose" aria-hidden="true" /> ポーズ
                <span class="ls-legend__mine" aria-hidden="true" /> 自分の線
              </div>
              <div class="ls-compare__stack">
                {overlayPose}
                <StrokesSvg strokes={strokes} fit={overlayFit} class="ls-mine__svg is-top" />
              </div>
            </div>
          </div>
        )}
        <footer class="ls-compare__foot">
          {error ? (
            <p class="ls-warn" role="alert">
              {error}
            </p>
          ) : (
            <p class="ls-muted">細部より、体の傾きと流れが似ているかを見ましょう。</p>
          )}
          <div class="ls-compare__actions">
            <Button variant="secondary" disabled={busy} onClick={sameAgain}>
              もう一度同じポーズ
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void nextPose()}>
              {busy ? '保存しています…' : i + 1 >= step.count ? '終える' : '次のポーズ'}
            </Button>
          </div>
        </footer>
      </div>
    );
  }

  const side = userRef ? (
    <div class="ls-pose">
      <div class="ls-pose__frame">
        <UserPose refImg={userRef} />
      </div>
      <span class="ls-muted">取り込んだ画像</span>
    </div>
  ) : (
    <div class="ls-pose mq-side" data-gl={gl} data-pose={poseId} data-pose-group={poseGroup} data-testid="pose-side">
      <div class="ls-pose__frame">
        {(!mannequinLive || readyKey !== roundKey) && <PoseSvg pose={stick} class="ls-pose__svg" />}
        {mannequinLive && (
          <MannequinView
            key={roundKey}
            poseId={poseId}
            initialState={initialView}
            seed={seed ^ (i * 7919)}
            onReady={(api) => {
              apiRef.current = api;
              setGl('ready');
              setReadyKey(roundKey);
            }}
            onUnsupported={() => {
              apiRef.current = null;
              setGl('unsupported');
            }}
          />
        )}
        {waitingForModel && <span class="mq-side__loading">ポーズ人形を準備中…</span>}
      </div>
      <div class="mq-side__meta">
        {mannequinLive && (
          <div class="mq-side__controls">
            <Button variant="secondary" size="sm" icon="rotate" disabled={readyKey !== roundKey} onClick={() => apiRef.current?.setCameraPreset('random')}>
              別の角度
            </Button>
            <Button variant="secondary" size="sm" icon="target" disabled={readyKey !== roundKey} onClick={() => apiRef.current?.resetCamera()}>
              正面に戻す
            </Button>
          </div>
        )}
        <span class="ls-muted">
          {mannequinLive ? 'ポーズ人形' : '棒人形'} · {stick.label}
        </span>
        {mannequinLive && <span class="mq-side__hint">ドラッグで回す・ピンチで寄る</span>}
      </div>
    </div>
  );

  const track = (e: PointerEvent) => {
    if (!(e.target instanceof HTMLCanvasElement)) return;
    livePointer.current = {
      target: e.target,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      clientX: e.clientX,
      clientY: e.clientY,
      pressure: e.pressure,
    };
  };
  const untrack = (e: PointerEvent) => {
    if (livePointer.current && livePointer.current.pointerId === e.pointerId) livePointer.current = null;
  };

  return (
    <div
      class="ls-gesture-track"
      onPointerDownCapture={track}
      onPointerMoveCapture={(e) => {
        if (livePointer.current && livePointer.current.pointerId === e.pointerId) track(e);
      }}
      onPointerUpCapture={untrack}
      onPointerCancelCapture={untrack}
    >
    <CanvasScreen
      engine={engine}
      task={step.instruction}
      full
      onExit={onExit}
      side={side}
      topCenter={
        <div class="ls-timer">
          <span class="ls-timer__num num" role="timer" aria-live="off">
            {left}
          </span>
          <span class="ls-timer__meta num">
            {step.seconds}秒 · {label}
          </span>
        </div>
      }
      extraAction={
        <Button variant="secondary" class="ls-glass" onClick={endDraw}>
          先に終える
        </Button>
      }
    />
    </div>
  );
}
