/**
 * 復習 #/review/:drillType — 該当ドリル 10 本だけの短いセッション。
 */
import { useMemo, useState } from 'preact/hooks';
import { Button, Icon } from '../components';
import { href, navigate } from '../router';
import { DrillRunner } from '../lesson/DrillRunner';
import { DrillIntro } from '../lesson/StepViews';
import { average, DRILL_LABEL, isDrillType, reviewDrillStep } from '../lesson/steps';

export function Review({ drillType }: { drillType: string }) {
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
      <div class="ls-root">
        <div class="ls-reviewdone">
          <span class="ls-done__check" aria-hidden="true">
            <Icon name="check" size={26} strokeWidth={2.5} />
          </span>
          <h2 class="ls-done__title">復習おわり</h2>
          <p class="ls-muted">
            {DRILL_LABEL[step.drill]} <span class="num">{scores.length}</span> 本 · 平均 <span class="num">{avg ?? '—'}</span> 点
          </p>
          <div class="ls-modal__actions">
            <Button variant="secondary" onClick={() => setPhase('intro')}>
              もう10本
            </Button>
            <Button variant="primary" onClick={() => navigate(href.home())}>
              ホームへ
            </Button>
          </div>
        </div>
      </div>
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
