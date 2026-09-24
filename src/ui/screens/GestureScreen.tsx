/**
 * ジェスチャー（DESIGN_SYSTEM §3 ジェスチャー）。
 * 左 560px のパネルにポーズ（棒人形 8 種を順番に／取込画像）、右にキャンバス、上中央 mono 96 のタイマー。
 * 時間切れ（または「先に終える」）で見比べ画面（並べる／重ねる）→「次のポーズ」で count まで。
 * three.js のポーズ人形は今回は使わない。
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { GestureStep } from '@/content/schema';
import type { Drawing } from '@/scoring';
import type { ReferenceImage } from '@/data/types';
import { listReferences } from '@/data/repo';
import { Button, Segment } from '../components';
import { CanvasScreen } from './CanvasScreen';
import { ReferencePicker, useBlobUrl, useCountdown, useEngine } from '../lesson/common';
import { POSE_VIEWBOX, poseAt, poseBounds, type MannequinPose } from '../lesson/mannequin-poses';
import { bump, saveStrokes, type LessonSession } from '../lesson/stateBridge';

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
function StrokesSvg({ strokes, fit, class: cls }: { strokes: Drawing; fit: { x: number; y: number; w: number; h: number } | null; class?: string }) {
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

export interface GestureScreenProps {
  step: GestureStep;
  session?: LessonSession;
  lessonId: string | null;
  onFinish: () => void;
  onExit: () => void;
}

export function GestureScreen({ step, session, lessonId, onFinish, onExit }: GestureScreenProps) {
  const engine = useEngine();
  const [i, setI] = useState(0);
  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState<'draw' | 'compare'>('draw');
  const [mode, setMode] = useState<'side' | 'overlay'>('side');
  const [strokes, setStrokes] = useState<Drawing>([]);
  const [refs, setRefs] = useState<ReferenceImage[] | null>(step.source === 'user' ? null : []);
  const [picked, setPicked] = useState(false);

  useEffect(() => {
    if (step.source !== 'user') return;
    void listReferences().then((r) => setRefs([...r].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))));
  }, [step.source]);

  const useUser = step.source === 'user' && refs !== null && refs.length > 0;
  const pose = poseAt(i);
  const userRef = useUser ? refs![i % refs!.length]! : null;
  const needPick = step.source === 'user' && refs !== null && refs.length === 0 && !picked;

  const endDraw = () => {
    setStrokes(engine.getStrokes());
    setPhase('compare');
  };

  const left = useCountdown(step.seconds, phase === 'draw' && !needPick && refs !== null, `${i}-${round}`, endDraw);

  const bounds = useMemo(() => poseBounds(pose), [pose]);

  if (needPick) {
    return (
      <div class="ls-step ls-pick">
        <div class="ls-step__body">
          <span class="ls-label ls-label--accent">ジェスチャー</span>
          <p class="ls-prose">{step.instruction}</p>
          <p class="ls-muted">ポーズの写真や絵を取り込むと、それを順番に出します。取り込まない場合は棒人形で練習します。</p>
          <ReferencePicker
            title="ポーズの画像"
            onPick={(r) => {
              setRefs([r]);
              setPicked(true);
            }}
          />
          <Button variant="ghost" onClick={() => setPicked(true)}>
            棒人形で練習する
          </Button>
        </div>
      </div>
    );
  }

  const poseView = userRef ? <UserPose refImg={userRef} /> : <PoseSvg pose={pose} class="ls-pose__svg" />;
  const label = `${i + 1}/${step.count}体目`;

  const nextPose = async () => {
    const drawn = strokes;
    void bump('gesture', 1, session);
    if (drawn.length > 0) await saveStrokes(drawn, 'lesson', lessonId, session);
    engine.loadStrokes([]);
    if (i + 1 >= step.count) {
      onFinish();
      return;
    }
    setI(i + 1);
    setMode('side');
    setPhase('draw');
  };

  const sameAgain = () => {
    engine.loadStrokes([]);
    setRound(round + 1);
    setPhase('draw');
  };

  if (phase === 'compare') {
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
            <div class="ls-compare__panel ls-compare__panel--pose">{poseView}</div>
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
                {userRef ? <UserPose refImg={userRef} /> : <PoseSvg pose={pose} class="ls-pose__svg is-overlay" />}
                <StrokesSvg strokes={strokes} fit={userRef ? null : bounds} class="ls-mine__svg is-top" />
              </div>
            </div>
          </div>
        )}
        <footer class="ls-compare__foot">
          <p class="ls-muted">細部より、体の傾きと流れが似ているかを見ましょう。</p>
          <div class="ls-compare__actions">
            <Button variant="secondary" onClick={sameAgain}>
              もう一度同じポーズ
            </Button>
            <Button variant="primary" onClick={() => void nextPose()}>
              {i + 1 >= step.count ? '終える' : '次のポーズ'}
            </Button>
          </div>
        </footer>
      </div>
    );
  }

  return (
    <CanvasScreen
      engine={engine}
      task={step.instruction}
      mini
      onExit={onExit}
      side={
        <div class="ls-pose">
          <div class="ls-pose__frame">{poseView}</div>
          <span class="ls-muted">{userRef ? '取り込んだ画像' : `棒人形 · ${pose.label}`}</span>
        </div>
      }
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
  );
}

