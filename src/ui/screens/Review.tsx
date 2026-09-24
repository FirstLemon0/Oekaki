/**
 * 復習・追加ドリル #/review/:drillType — 該当ドリル 10 本だけの短いセッション。
 * #/review/box は「箱を描く」（cube-1pt / cube-2pt のなぞり。1 回ごとに累計の箱 +1）。
 * ステージ 2 以降の学習者には、終わった画面の候補に「箱を描く」を出す（250 箱チャレンジの加算経路）。
 */
import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { Button, Icon } from '../components';
import { href, navigate } from '../router';
import { completedIds, path } from '../state';
import { DrillRunner } from '../lesson/DrillRunner';
import { TraceRunner } from '../lesson/DrawSteps';
import { DrillIntro } from '../lesson/StepViews';
import { average, BOX_REVIEW, boxReviewSteps, DRILL_LABEL, isDrillType, reachedBoxStage, reviewDrillStep } from '../lesson/steps';

function DoneView({
  title,
  body,
  againLabel,
  onAgain,
  offerBoxes = true,
}: {
  title: string;
  body: ComponentChildren;
  againLabel: string;
  onAgain: () => void;
  /** ステージ 2 以降なら「箱を描く」を候補に出す */
  offerBoxes?: boolean;
}) {
  const boxes = offerBoxes && reachedBoxStage(path.value, completedIds.value);
  return (
    <div class="ls-root">
      <div class="ls-reviewdone">
        <span class="ls-done__check" aria-hidden="true">
          <Icon name="check" size={26} strokeWidth={2.5} />
        </span>
        <h2 class="ls-done__title">{title}</h2>
        <p class="ls-muted">{body}</p>
        <div class="ls-modal__actions">
          <Button variant="secondary" onClick={onAgain}>
            {againLabel}
          </Button>
          {boxes && (
            <Button variant="secondary" onClick={() => navigate(href.review(BOX_REVIEW))}>
              箱を描く
            </Button>
          )}
          <Button variant="primary" onClick={() => navigate(href.home())}>
            ホームへ
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 箱を描く（なぞり 2 種を順に） */
function BoxReview() {
  const steps = useMemo(() => boxReviewSteps(), []);
  const [k, setK] = useState(0);
  const [round, setRound] = useState(0);
  const total = steps.reduce((a, s) => a + (s.count ?? 1), 0);
  if (k >= steps.length) {
    return (
      <DoneView
        title="箱を描きました"
        body={
          <>
            箱 <span class="num">{total}</span> 個ぶん、累計に足しました。
          </>
        }
        againLabel="もう一度箱を描く"
        offerBoxes={false}
        onAgain={() => {
          setK(0);
          setRound(round + 1);
        }}
      />
    );
  }
  return (
    <div class="ls-root is-fullscreen">
      <TraceRunner
        key={`${round}-${k}`}
        step={steps[k]!}
        lessonId={null}
        onFinish={() => setK(k + 1)}
        onExit={() => navigate(href.home())}
      />
    </div>
  );
}

export function Review({ drillType }: { drillType: string }) {
  if (drillType === BOX_REVIEW) return <BoxReview />;
  return <DrillReview drillType={drillType} />;
}

function DrillReview({ drillType }: { drillType: string }) {
  const step = useMemo(() => (isDrillType(drillType) ? reviewDrillStep(drillType) : null), [drillType]);
  const [phase, setPhase] = useState<'intro' | 'draw' | 'done'>('intro');
  const [scores, setScores] = useState<number[]>([]);

  if (!step) {
    return (
      <div class="ls-missing">
        <p>この復習（{drillType}）は用意していません。</p>
        <Button variant="primary" href={href.home()}>
          ホームへ
        </Button>
      </div>
    );
  }

  if (phase === 'draw') {
    return (
      <div class="ls-root is-fullscreen">
        <DrillRunner
          step={step}
          lessonId={null}
          onExit={() => setPhase('intro')}
          onFinish={(s) => {
            setScores(s);
            setPhase('done');
          }}
        />
      </div>
    );
  }

  if (phase === 'done') {
    const avg = average(scores);
    return (
      <DoneView
        title="復習おわり"
        body={
          <>
            {DRILL_LABEL[step.drill]} <span class="num">{scores.length}</span> 本 · 平均 <span class="num">{avg ?? '—'}</span> 点
          </>
        }
        againLabel="もう10本"
        onAgain={() => setPhase('intro')}
      />
    );
  }

  return (
    <div class="ls-root">
      <header class="ls-head">
        <button type="button" class="ls-head__close" aria-label="ホームへ" onClick={() => navigate(href.home())}>
          <Icon name="back" size={24} />
        </button>
        <span class="ls-head__title">復習</span>
        <span />
      </header>
      <div class="ls-root__body">
        <DrillIntro step={step} warmup onStart={() => setPhase('draw')} />
      </div>
    </div>
  );
}
