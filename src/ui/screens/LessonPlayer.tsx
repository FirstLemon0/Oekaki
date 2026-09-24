/**
 * レッスン再生（DESIGN_SYSTEM §3 レッスン）。#/lesson/:id と #/lesson/:id/step/:n
 *
 * ヘッダ 80（✕＝ホームへ、8px 進捗セグメント、mono「2/7」）＋ ステップ型ごとの画面。
 * 開始時に復習の該当があれば、先頭に「復習」ステップ（該当ドリル 10 本）を差し込む。
 * 最後のステップで completeLesson・ストリーク・XP を記録し、完了モーダル（卒業課題はステージ修了）を出す。
 */
import { useMemo, useState } from 'preact/hooks';
import { Button } from '../components';
import { href, navigate } from '../router';
import { path, reviews } from '../state';
import { LsIcon } from '../lesson/LsIcon';
import { DrillRunner } from '../lesson/DrillRunner';
import { ConstructView, CopyView, CritiqueStepView, FreeStepView, MoshaView, SubmitStepView, TraceView, type StepCtx } from '../lesson/DrawSteps';
import { DrillIntro, QuizView, ReadView } from '../lesson/StepViews';
import { endLessonSession, finishLesson, getLessonSession, type LessonSummary } from '../lesson/stateBridge';
import { clampStep, nextStepIndex, progressSegments, type DrillType } from '../lesson/steps';
import { GestureScreen } from './GestureScreen';
import { LessonDoneModal, StageDoneModal } from './LessonModals';

function Header({ current, total, onClose }: { current: number; total: number; onClose: () => void }) {
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
      <span class="ls-head__count num">
        {current + 1}/{total}
      </span>
    </header>
  );
}

export function LessonPlayer({ id, step }: { id: string; step?: number }) {
  const node = useMemo(() => path.value.find((n) => n.lesson.id === id), [id, path.value]);
  const startAt = step ?? 0;
  const session = useMemo(() => (node ? getLessonSession(node.lesson, reviews.value, startAt) : null), [node]);
  const [drawing, setDrawing] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [summary, setSummary] = useState<LessonSummary | null>(null);

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
  const n = clampStep(startAt, total);
  const play = session.steps[n]!;
  const st = play.step;

  const goStep = (k: number) => {
    setDrawing(false);
    navigate(href.lessonStep(id, k), { replace: true });
  };

  const onDone = async () => {
    const nx = nextStepIndex(n, total);
    if (nx !== null) {
      goStep(nx);
      return;
    }
    if (finishing) return;
    setFinishing(true);
    try {
      setSummary(await finishLesson(node.lesson, session));
    } finally {
      setFinishing(false);
    }
  };

  const close = () => {
    endLessonSession(id);
    navigate(href.home());
  };

  const onBack = () => {
    if (n > 0) goStep(n - 1);
    else setDrawing(false);
  };

  const ctx: StepCtx = { node, session, onDone: () => void onDone(), onBack };

  if (summary) {
    const lastDrill = [...node.lesson.steps].reverse().find((s) => s.type === 'drill');
    const moreType: DrillType = lastDrill && lastDrill.type === 'drill' ? lastDrill.drill : 'line';
    return (
      <div class="ls-root ls-root--done">
        {summary.graduation ? (
          <StageDoneModal summary={summary} node={node} />
        ) : (
          <LessonDoneModal summary={summary} node={node} onMore={() => navigate(`#/review/${moreType}`)} />
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
      fullscreen = true;
      body = <FreeStepView step={st} ctx={ctx} />;
      break;
  }

  return (
    <div class={fullscreen ? 'ls-root is-fullscreen' : 'ls-root'} data-step-type={st.type}>
      {!fullscreen && <Header current={n} total={total} onClose={close} />}
      <div class="ls-root__body" key={`${id}-${n}`}>
        {body}
      </div>
      {finishing && (
        <div class="ls-scrim ls-scrim--clear" aria-busy="true">
          <span class="ls-muted">記録しています…</span>
        </div>
      )}
    </div>
  );
}

/** ホームの復習ノード（#/lesson/review-<drillType>）から来たときの橋渡し */
export function isReviewLessonId(id: string): string | null {
  const m = /^review-(.+)$/.exec(id);
  return m ? m[1]! : null;
}

