/**
 * 描かないステップの画面: read / drill の開始画面 / quiz / 取り込み（submit・critique import）
 */
import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import type { DrillStep, QuizStep, ReadStep } from '@/content/schema';
import { Button, Icon } from '../components';
import { drillStats } from '../state';
import { Figure, ImportButton } from './common';
import { DRILL_LABEL, shuffledOrder } from './steps';

/** レッスン本文の段落（空行区切り） */
export function Paragraphs({ text, class: cls }: { text: string; class?: string }) {
  return (
    <div class={cls}>
      {text
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p, i) => (
          <p key={i}>{p}</p>
        ))}
    </div>
  );
}

/** 本文とフッタの枠（フッタ 112、右寄せ） */
export function StepFrame({ children, footer, class: cls }: { children: ComponentChildren; footer?: ComponentChildren; class?: string }) {
  return (
    <div class={['ls-step', cls].filter(Boolean).join(' ')}>
      <div class="ls-step__body">{children}</div>
      {footer && <div class="ls-step__foot">{footer}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------

export function ReadView({ step, onNext, warmupNote }: { step: ReadStep; onNext: () => void; warmupNote?: string }) {
  return (
    <StepFrame
      class="ls-read"
      footer={
        <Button variant="primary" class="ls-wide" onClick={onNext}>
          次へ
        </Button>
      }
    >
      <div class="ls-read__grid">
        <div class="ls-card ls-read__figure">
          {step.figure ? <Figure id={step.figure} label={step.title} /> : <div class="ls-figure is-empty" aria-hidden="true" />}
        </div>
        <div class="ls-read__text">
          <span class="ls-label ls-label--accent">説明</span>
          <h2 class="ls-h-lesson">{step.title}</h2>
          <Paragraphs text={step.body} class="ls-prose" />
          {warmupNote && <p class="ls-aside">{warmupNote}</p>}
        </div>
      </div>
    </StepFrame>
  );
}

// ---------------------------------------------------------------------------
// drill 開始画面
// ---------------------------------------------------------------------------

/** ドリルの見本図（図解が無いので、ドリル種別ごとの簡単な線を描く） */
function DrillPreview({ step }: { step: DrillStep }) {
  const p = step.params ?? {};
  const W = 400;
  const H = 300;
  let body: ComponentChildren;
  switch (step.drill) {
    case 'line': {
      const o = p.orientation;
      body =
        o === 'v' ? (
          [120, 200, 280].map((x) => <line key={x} x1={x} y1={60} x2={x} y2={240} />)
        ) : o === 'd' ? (
          [0, 1, 2].map((k) => <line key={k} x1={90 + k * 70} y1={230} x2={170 + k * 70} y2={70} />)
        ) : (
          [90, 150, 210].map((y) => <line key={y} x1={80} y1={y} x2={320} y2={y} />)
        );
      if (p.mode === 'two-points') {
        body = (
          <>
            {body}
            <circle class="is-accent" cx={80} cy={90} r={7} />
            <circle class="is-accent" cx={320} cy={90} r={7} />
          </>
        );
      }
      break;
    }
    case 'curve':
      body =
        p.shape === 's' ? (
          <path d="M200 50 C 120 50, 120 150, 200 150 S 280 250, 200 250" />
        ) : p.shape === 'wave' ? (
          <path d="M60 150 Q 95 90 130 150 T 200 150 T 270 150 T 340 150" />
        ) : p.shape === 'spiral' ? (
          <path d="M200 150 m 8 0 a 8 8 0 1 1 -16 0 a 24 24 0 1 1 48 0 a 40 40 0 1 1 -80 0 a 56 56 0 1 1 112 0 a 72 72 0 1 1 -144 0" />
        ) : (
          <path d="M250 60 A 100 100 0 0 0 250 240" />
        );
      break;
    case 'circle':
      body = (
        <>
          <circle cx={200} cy={150} r={90} />
          <circle cx={200} cy={150} r={4} class="is-accent" />
        </>
      );
      break;
    case 'ellipse': {
      const deg = typeof p.degree === 'number' ? (p.degree > 1 ? p.degree / 90 : p.degree) : 0.5;
      const ang = typeof p.axisAngleDeg === 'number' ? p.axisAngleDeg : 0;
      body = (
        <g transform={`rotate(${ang} 200 150)`}>
          <ellipse cx={200} cy={150} rx={130} ry={Math.max(6, 130 * deg)} />
          <line class="is-dash" x1={50} y1={150} x2={350} y2={150} />
        </g>
      );
      break;
    }
    case 'pressure':
      body = (
        <>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((k) => {
            const prof = p.profile;
            const w = prof === 'flat' ? 5 : prof === 'ramp-down' ? 9 - k : 2 + k;
            return <line key={k} x1={70 + k * 34} y1={150} x2={104 + k * 34} y2={150} stroke-width={w} />;
          })}
        </>
      );
      break;
    case 'hatching': {
      const ang = typeof p.angleDeg === 'number' ? p.angleDeg : 45;
      body = (
        <g transform={`rotate(${ang} 200 150)`}>
          {[-4, -3, -2, -1, 0, 1, 2, 3, 4].map((k) => (
            <line key={k} x1={130} y1={150 + k * 14} x2={270} y2={150 + k * 14} />
          ))}
        </g>
      );
      break;
    }
  }
  return (
    <svg class="ls-drillpreview" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${DRILL_LABEL[step.drill]}の見本`}>
      {body}
    </svg>
  );
}

export function DrillIntro({
  step,
  warmup,
  onStart,
}: {
  step: DrillStep;
  warmup: boolean;
  onStart: () => void;
}) {
  const stats = drillStats.value.find((d) => d.drillType === step.drill);
  const last = stats?.history[stats.history.length - 1]?.score ?? null;
  const unit = step.drill === 'circle' || step.drill === 'ellipse' ? '個' : '本';
  return (
    <StepFrame
      class="ls-drill"
      footer={
        <Button variant="primary" icon="pen" class="ls-wide" onClick={onStart}>
          描く
        </Button>
      }
    >
      <div class="ls-drill__grid">
        <div class="ls-drill__text">
          <span class="ls-label ls-label--accent">{warmup ? 'ウォームアップ（復習）' : 'ドリル'}</span>
          <h2 class="ls-h-drill">
            {DRILL_LABEL[step.drill]}
            {step.drill === 'hatching' ? '' : 'のドリル'}
          </h2>
          <p class="ls-drill__inst">{step.instruction}</p>
          <dl class="ls-goal">
            <div>
              <dt>目標</dt>
              <dd class="num">
                {step.count}
                <small>{unit}</small>
              </dd>
            </div>
            <div class="is-quiet">
              <dt>現在</dt>
              <dd class="num">0</dd>
            </div>
            <div class="is-quiet">
              <dt>前回</dt>
              <dd class="num">
                {last ?? '—'}
                {last !== null && <small>点</small>}
              </dd>
            </div>
          </dl>
        </div>
        <div class="ls-card ls-drill__figure">
          <DrillPreview step={step} />
        </div>
      </div>
    </StepFrame>
  );
}

// ---------------------------------------------------------------------------
// quiz
// ---------------------------------------------------------------------------

/**
 * 選択式。表示のたびに選択肢を並べ替える（教材は正解が 1 番目に偏っているため）。
 * 正誤は「表示の位置 → 元の番号」の対応で判定する。
 */
export function QuizView({ step, onNext }: { step: QuizStep; onNext: (correct: boolean) => void }) {
  const order = useMemo(() => shuffledOrder(step.options.length), [step]);
  /** 選んだ元の選択肢の番号 */
  const [chosen, setChosen] = useState<number | null>(null);
  const answered = chosen !== null;
  const correct = chosen === step.answer;
  const hasFigures = step.options.some((o) => o.figure);
  return (
    <StepFrame
      class="ls-quiz"
      footer={
        <Button variant="primary" class="ls-wide" disabled={!answered} onClick={() => onNext(correct)}>
          次へ
        </Button>
      }
    >
      <div class="ls-quiz__inner">
        <span class="ls-label ls-label--accent">クイズ</span>
        <h2 class="ls-h-lesson">{step.question}</h2>
        <ul class={hasFigures ? 'ls-quiz__opts has-figures' : 'ls-quiz__opts'} role="radiogroup" aria-label="選択肢">
          {order.map((orig) => {
            const o = step.options[orig]!;
            const state = !answered ? '' : orig === step.answer ? 'is-answer' : orig === chosen ? 'is-chosen' : 'is-dim';
            return (
              <li key={orig}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={chosen === orig}
                  class={`ls-quiz__opt ${state}`}
                  disabled={answered}
                  onClick={() => setChosen(orig)}
                >
                  {o.figure && <Figure id={o.figure} class="ls-quiz__fig" label={o.text} />}
                  <span class="ls-quiz__text">{o.text}</span>
                  {answered && orig === step.answer && <Icon name="check" size={22} />}
                </button>
              </li>
            );
          })}
        </ul>
        {answered && (
          <div class={correct ? 'ls-explain is-correct' : 'ls-explain'} role="status">
            <strong>{correct ? '正解です。' : '答えは「' + (step.options[step.answer]?.text ?? '') + '」です。'}</strong>
            <p>{step.explain}</p>
          </div>
        )}
      </div>
    </StepFrame>
  );
}

// ---------------------------------------------------------------------------
// 取り込み（submit / critique import）
// ---------------------------------------------------------------------------

export function ImportView({
  label,
  title,
  body,
  note,
  onFile,
  busy,
  error,
}: {
  label: string;
  title: string;
  body: string;
  note?: string;
  onFile: (f: File) => void;
  busy?: boolean;
  /** 保存に失敗したときの案内 */
  error?: string | null;
}) {
  return (
    <StepFrame class="ls-import">
      <div class="ls-import__inner">
        <span class="ls-label ls-label--accent">{label}</span>
        <h2 class="ls-h-lesson">{title}</h2>
        <Paragraphs text={body} class="ls-prose" />
        {note && <p class="ls-aside">{note}</p>}
        {error && (
          <p class="ls-warn" role="alert">
            {error}
          </p>
        )}
        <div class="ls-import__action">{busy ? <span class="ls-muted">取り込んでいます…</span> : <ImportButton variant="primary" onFile={onFile} />}</div>
      </div>
    </StepFrame>
  );
}
