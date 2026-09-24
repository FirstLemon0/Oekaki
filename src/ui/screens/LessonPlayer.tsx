/**
 * レッスン再生（DESIGN_SYSTEM §3 レッスン）。#/lesson/:id と #/lesson/:id/step/:n
 *
 * ヘッダ 80（✕＝ホームへ、8px 進捗セグメント、mono「2/7」）＋ ステップ型ごとの画面。
 * 開始時に復習の該当があれば、先頭に「復習」ステップ（該当ドリル 10 本）を差し込む。
 * URL の番号はレッスン本来の番号だけ。復習は表示上の前置き（session.warmupsDone で進める）なので、
 * 再読込しても本来のステップが飛ばない。
 * セッションは画面を離れたら（アンマウントで）捨てる。前回の点数・絵・開始時刻は持ち越さない。
 * 最後のステップで completeLesson・ストリーク・XP を記録し、完了モーダル（卒業課題はステージ修了）を出す。
 *
 * 途中再開: ステップが進むたびに「次に開くステップ番号」（レッスン本来の番号）を保存する。
 * #/lesson/:id（番号なし）で開いたとき途中の記録があれば「続きから／最初から」のシートを出す。
 * 選択式（lesson.optional）: ヘッダの「この技法は飛ばす」で完了扱い（skipped）にして次のレッスンへ。
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Button, Sheet, showToast } from '../components';
import { href, navigate } from '../router';
import { completedIds, path, progress, reviews } from '../state';
import { LsIcon } from '../lesson/LsIcon';
import { DrillRunner } from '../lesson/DrillRunner';
import { ConstructView, CopyView, CritiqueStepView, FreeStepView, MoshaView, SubmitStepView, TraceView, type StepCtx } from '../lesson/DrawSteps';
import { DrillIntro, QuizView, ReadView } from '../lesson/StepViews';
import {
  endLessonSession,
  finishLesson,
  getLessonSession,
  resetLessonSession,
  saveLessonStep,
  skipLesson,
  type LessonSession,
  type LessonSummary,
} from '../lesson/stateBridge';
import {
  afterStep,
  BOX_REVIEW,
  clampStep,
  isSkippable,
  playIndexOf,
  progressSegments,
  reachedBoxStage,
  resumeStepOf,
  warmupCount,
  type DrillType,
} from '../lesson/steps';
import { GestureScreen } from './GestureScreen';
import { LessonDoneModal, StageDoneModal } from './LessonModals';

function Header({
  current,
  total,
  onClose,
  onSkip,
  skipping,
}: {
  current: number;
  total: number;
  onClose: () => void;
  /** 選択式のレッスンのときだけ渡す */
  onSkip?: () => void;
  skipping?: boolean;
}) {
  return (
    <header class="ls-head">
      <button type="button" class="ls-head__close" aria-label="レッスンをやめてホームへ" title="ホームへ" onClick={onClose}>
        <LsIcon name="close" size={26} />
      </button>
      <div class="ls-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={current + 1} aria-label="レッスンの進み具合">
        {progressSegments(current, total).map((s, i) => (
          <span key={i} class={`ls-progress__seg is-${s}`} />
        ))}
      </div>
      <div class="ls-head__right">
        {onSkip && (
          <Button variant="secondary" size="sm" class="ls-head__skip" disabled={skipping} onClick={onSkip}>
            この技法は飛ばす
          </Button>
        )}
        <span class="ls-head__count num">
          {current + 1}/{total}
        </span>
      </div>
    </header>
  );
}

export function LessonPlayer({ id, step }: { id: string; step?: number }) {
  const node = useMemo(() => path.value.find((n) => n.lesson.id === id), [id, path.value]);
  // セッションは画面ごとに持つ。開いたときに作り直し（前回の残りを引き継がない）、離れたら捨てる
  const [session, setSession] = useState<LessonSession | null>(() =>
    node ? resetLessonSession(node.lesson, reviews.value, (step ?? 0) === 0) : null,
  );
  useEffect(() => () => endLessonSession(id), [id]);
  // 復習を 1 つ終えたときの再描画用
  const [, setTick] = useState(0);
  const [drawing, setDrawing] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState(false);
  const finishingRef = useRef(false);
  const [skipping, setSkipping] = useState(false);
  const [summary, setSummary] = useState<LessonSummary | null>(null);
  // 番号なしで開いたときだけ、途中の記録を確かめる（開いた時点の値で固定）
  const [resumeAt, setResumeAt] = useState<number | null>(() => {
    if (step !== undefined || !node) return null;
    return resumeStepOf(
      progress.value.find((p) => p.lessonId === id),
      node.lesson.steps.length,
    );
  });

  if (!node || !session) {
    return (
      <div class="ls-missing">
        <p>このレッスンは見つかりませんでした（{id}）。</p>
        <Button variant="primary" href={href.home()}>
          ホームへ
        </Button>
      </div>
    );
  }

  const total = session.steps.length;
  const warmups = warmupCount(session.steps);
  const lessonTotal = total - warmups;
  const lessonIndex = clampStep(step ?? 0, lessonTotal);
  const n = playIndexOf(session.steps, session.warmupsDone, lessonIndex);
  const play = session.steps[n]!;
  const st = play.step;

  /** レッスン本来の番号 k へ（URL と途中保存はこの番号） */
  const goStep = (k: number) => {
    setDrawing(false);
    void saveLessonStep(id, k);
    navigate(href.lessonStep(id, k), { replace: true });
  };

  const restart = (k: number | null) => {
    setResumeAt(null);
    // 続きから: 復習を差し込まない。最初から: 開き直した今の復習で作り直す
    setSession(resetLessonSession(node.lesson, reviews.value, k === null));
    setDrawing(false);
    navigate(href.lessonStep(id, k ?? 0), { replace: true });
  };

  const skip = async () => {
    if (skipping || finishing) return;
    setSkipping(true);
    try {
      const nextId = await skipLesson(node.lesson);
      showToast('飛ばしました。あとで戻れます', 'info');
      navigate(nextId ? href.lesson(nextId) : href.home());
    } catch {
      showToast('飛ばせませんでした。もう一度試しましょう', 'danger');
    } finally {
      setSkipping(false);
    }
  };

  const finish = async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setFinishing(true);
    setFinishError(false);
    try {
      setSummary(await finishLesson(node.lesson, session));
    } catch {
      // 記録に失敗: 押し直せるようにする（済んだ記録は session.finish で繰り返さない）
      setFinishError(true);
    } finally {
      finishingRef.current = false;
      setFinishing(false);
    }
  };

  const onDone = () => {
    const nx = afterStep(session.steps, session.warmupsDone, lessonIndex);
    if (nx.kind === 'warmup') {
      session.warmupsDone = nx.warmupsDone;
      setDrawing(false);
      setTick((t) => t + 1);
      return;
    }
    if (nx.kind === 'step') {
      goStep(nx.lessonIndex);
      return;
    }
    void finish();
  };

  const close = () => {
    endLessonSession(id);
    navigate(href.home());
  };

  const onBack = () => {
    if (!play.warmup && lessonIndex > 0) goStep(lessonIndex - 1);
    else setDrawing(false);
  };

  const ctx: StepCtx = { node, session, onDone, onBack };

  if (summary) {
    const lastDrill = [...node.lesson.steps].reverse().find((s) => s.type === 'drill');
    const moreType: DrillType = lastDrill && lastDrill.type === 'drill' ? lastDrill.drill : 'line';
    const boxes = reachedBoxStage(path.value, completedIds.value);
    return (
      <div class="ls-root ls-root--done">
        {summary.graduation ? (
          <StageDoneModal summary={summary} node={node} />
        ) : (
          <LessonDoneModal
            summary={summary}
            node={node}
            onMore={() => navigate(href.review(moreType))}
            onBoxes={boxes ? () => navigate(href.review(BOX_REVIEW)) : undefined}
          />
        )}
      </div>
    );
  }

  let body;
  let fullscreen = false;
  switch (st.type) {
    case 'read':
      body = <ReadView step={st} onNext={ctx.onDone} />;
      break;
    case 'drill':
      if (drawing) {
        fullscreen = true;
        body = <DrillRunner step={st} session={session} lessonId={id} onFinish={() => ctx.onDone()} onExit={() => setDrawing(false)} />;
      } else {
        body = <DrillIntro step={st} warmup={play.warmup} onStart={() => setDrawing(true)} />;
      }
      break;
    case 'quiz':
      body = <QuizView step={st} onNext={() => ctx.onDone()} />;
      break;
    case 'trace':
      fullscreen = true;
      body = <TraceView step={st} ctx={ctx} />;
      break;
    case 'copy':
      fullscreen = st.reference === 'builtin';
      body = <CopyView step={st} ctx={ctx} />;
      break;
    case 'construct':
      fullscreen = true;
      body = <ConstructView step={st} ctx={ctx} />;
      break;
    case 'gesture':
      fullscreen = true;
      body = <GestureScreen step={st} session={session} lessonId={id} onFinish={() => ctx.onDone()} onExit={onBack} />;
      break;
    case 'mosha':
      body = <MoshaView step={st} ctx={ctx} />;
      break;
    case 'critique':
      body = <CritiqueStepView step={st} ctx={ctx} />;
      break;
    case 'submit':
      body = <SubmitStepView step={st} ctx={ctx} />;
      break;
    case 'free':
      fullscreen = st.source !== 'import';
      body = <FreeStepView step={st} ctx={ctx} />;
      break;
  }

  return (
    <div class={fullscreen ? 'ls-root is-fullscreen' : 'ls-root'} data-step-type={st.type}>
      {!fullscreen && (
        <Header
          current={n}
          total={total}
          onClose={close}
          onSkip={isSkippable(node.lesson) ? () => void skip() : undefined}
          skipping={skipping}
        />
      )}
      <div class="ls-root__body" key={`${id}-${n}`}>
        {body}
      </div>
      {(finishing || finishError) && (
        <div class="ls-scrim ls-scrim--clear" aria-busy={finishing}>
          {finishing ? (
            <span class="ls-muted">記録しています…</span>
          ) : (
            <div class="ls-finerr" role="alert">
              <p class="ls-finerr__text">記録できませんでした。端末の空き容量を確かめて、もう一度押してみましょう。描いた絵は保存済みです。</p>
              <div class="ls-finerr__actions">
                <Button variant="secondary" onClick={() => setFinishError(false)}>
                  閉じる
                </Button>
                <Button variant="primary" onClick={() => void finish()}>
                  もう一度記録する
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      <Sheet open={resumeAt !== null} onClose={() => setResumeAt(null)} title="続きから始めますか？">
        {resumeAt !== null && (
          <div class="ls-resume">
            <p class="ls-resume__text">
              前回は <span class="num">{resumeAt + 1}</span>/<span class="num">{node.lesson.steps.length}</span> ステップ目の途中で閉じました。
            </p>
            <div class="ls-resume__actions">
              <Button variant="secondary" onClick={() => restart(null)}>
                最初から
              </Button>
              <Button variant="primary" onClick={() => restart(resumeAt)}>
                {`続きから（ステップ ${resumeAt + 1}）`}
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}

/** ホームの復習ノード（#/lesson/review-<drillType>）から来たときの橋渡し */
export function isReviewLessonId(id: string): string | null {
  const m = /^review-(.+)$/.exec(id);
  return m ? m[1]! : null;
}

