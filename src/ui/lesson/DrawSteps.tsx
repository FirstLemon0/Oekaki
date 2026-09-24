/**
 * 描くステップ: trace / copy / construct / mosha / free / critique / submit
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { PathNode } from '@/content';
import { getTemplate } from '@/content';
import type { ConstructStep, CopyStep, CritiqueStep, FreeStep, MoshaStep, SubmitStep, TraceStep } from '@/content/schema';
import type { OverlaySpec } from '@/canvas';
import type { Drawing as StoredDrawing, ReferenceImage } from '@/data/types';
import type { Drawing, ScoreResult } from '@/scoring';
import { Button, Segment } from '../components';
import { CanvasScreen } from '../screens/CanvasScreen';
import { CritiqueScreen, findRubric } from '../screens/CritiqueScreen';
import { Figure, ReferencePicker, useBlobUrl, useEngine } from './common';
import { fitTemplate, type Size } from './drillSetup';
import { loadFigure, svgForOverlay } from './figures';
import { ScoreSheet } from './ScoreSheet';
import { bumpForStep, saveDrawingMeta, saveImported, saveStrokes, scorers, type LessonSession } from './stateBridge';
import { drawingKindForStep } from './steps';
import { ImportView, StepFrame } from './StepViews';

export interface StepCtx {
  node: PathNode;
  session: LessonSession;
  /** ステップ完了 */
  onDone: () => void;
  /** キャンバスから戻る（前のステップへ） */
  onBack: () => void;
}

/** 重ね表示用の色（お手本・見比べ）。CSS 変数から実色を取る */
function overlayColor(): string {
  if (typeof document === 'undefined') return '#7BB661';
  const cs = getComputedStyle(document.documentElement);
  return cs.getPropertyValue('--color-accent').trim() || '#7BB661';
}

function inkColor(): string {
  if (typeof document === 'undefined') return '#2B2A28';
  return getComputedStyle(document.documentElement).getPropertyValue('--color-ink').trim() || '#2B2A28';
}

/** お手本（内蔵の図解 または 取込画像） */
export type RefSource = { kind: 'builtin'; id: string } | { kind: 'user'; ref: ReferenceImage };

function RefView({ source }: { source: RefSource }) {
  const url = useBlobUrl(source.kind === 'user' ? source.ref.image : null);
  if (source.kind === 'builtin') return <Figure id={source.id} class="ls-refview__fig" label="お手本" />;
  return url ? <img class="ls-refview__img" src={url} alt="お手本" /> : null;
}

/** 重ね表示用の OverlaySpec を作る */
function useRefOverlay(source: RefSource | null, on: boolean, opacity: number, color: 'ink' | 'accent'): OverlaySpec | null {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (source?.kind === 'builtin') {
      void loadFigure(source.id).then((s) => {
        if (alive) setSvg(s);
      });
    }
    return () => {
      alive = false;
    };
  }, [source]);
  return useMemo(() => {
    if (!on || !source) return null;
    if (source.kind === 'user') return { kind: 'image', src: source.ref.image, opacity };
    if (!svg) return null;
    return { kind: 'svg', src: svgForOverlay(svg, color === 'accent' ? overlayColor() : inkColor()), opacity };
  }, [on, source, svg, opacity, color]);
}

// ---------------------------------------------------------------------------
// trace
// ---------------------------------------------------------------------------

export function TraceView({ step, ctx }: { step: TraceStep; ctx: StepCtx }) {
  const engine = useEngine();
  const count = step.count ?? 1;
  const [i, setI] = useState(0);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [scored, setScored] = useState<{ result: ScoreResult; strokes: Drawing; best: number | null } | null>(null);
  const [n, setN] = useState(0);
  const [best, setBest] = useState<number | null>(null);
  const template = getTemplate(step.template);

  const fitted = useMemo(() => (template && size.width > 0 ? fitTemplate(template, size) : null), [template, size]);
  const overlay = useMemo<OverlaySpec | null>(() => (fitted ? { kind: 'strokes', src: fitted, opacity: 0.4 } : null), [fitted]);

  useEffect(() => engine.on('change', () => setN(engine.getStrokes().length)), [engine]);

  const score = () => {
    if (!fitted) return;
    const strokes = engine.getStrokes();
    const result = scorers.value.scoreTrace(strokes, fitted, 3);
    setScored({ result, strokes, best });
  };

  const again = () => {
    setScored(null);
    engine.loadStrokes([]);
  };

  const next = async () => {
    if (!scored) return;
    ctx.session.otherScores.push(scored.result.score);
    // 累計（counter があれば 1 回なぞるごとに 1）
    void bumpForStep(step, ctx.session);
    setBest((b) => (b === null ? scored.result.score : Math.max(b, scored.result.score)));
    if (i + 1 >= count) {
      await saveStrokes(scored.strokes, 'lesson', ctx.node.lesson.id, ctx.session);
      ctx.onDone();
      return;
    }
    setI(i + 1);
    setScored(null);
    engine.loadStrokes([]);
  };

  if (!template) {
    return (
      <StepFrame footer={<Button variant="primary" onClick={ctx.onDone}>次へ</Button>}>
        <p class="ls-prose">なぞりのお手本（{step.template}）が見つかりませんでした。このステップは飛ばします。</p>
      </StepFrame>
    );
  }

  return (
    <CanvasScreen
      engine={engine}
      task={step.instruction}
      counter={count > 1 ? `${i + 1}/${count}` : null}
      overlay={overlay}
      onSize={setSize}
      onExit={ctx.onBack}
      onDone={score}
      doneLabel="採点"
      doneDisabled={n === 0 || scored !== null}
      sheet={
        scored ? (
          <ScoreSheet
            result={scored.result}
            strokes={scored.strokes}
            target={fitted}
            best={scored.best}
            onAgain={again}
            onNext={() => void next()}
            nextLabel={i + 1 >= count ? '終える' : '次へ'}
          />
        ) : null
      }
    />
  );
}

// ---------------------------------------------------------------------------
// copy（横に見て描く → 重ねて見る）
// ---------------------------------------------------------------------------

export function CopyView({ step, ctx }: { step: CopyStep; ctx: StepCtx }) {
  const engine = useEngine();
  const [source, setSource] = useState<RefSource | null>(
    step.reference === 'builtin' && step.refId ? { kind: 'builtin', id: step.refId } : null,
  );
  const [comparing, setComparing] = useState(false);
  const [n, setN] = useState(0);
  const [busy, setBusy] = useState(false);
  const overlay = useRefOverlay(source, comparing, 0.55, 'accent');

  useEffect(() => engine.on('change', () => setN(engine.getStrokes().length)), [engine]);

  if (!source) {
    return (
      <StepFrame class="ls-pick">
        <p class="ls-prose">{step.instruction}</p>
        <ReferencePicker onPick={(r) => setSource({ kind: 'user', ref: r })} />
      </StepFrame>
    );
  }

  const finish = async () => {
    setBusy(true);
    try {
      await saveStrokes(engine.getStrokes(), 'lesson', ctx.node.lesson.id, ctx.session);
    } finally {
      setBusy(false);
    }
    ctx.onDone();
  };

  return (
    <CanvasScreen
      engine={engine}
      task={comparing ? 'お手本を重ねました。形・大きさ・位置の違いを見てみましょう。' : step.instruction}
      side={
        <div class="ls-refview">
          <span class="ls-label">お手本</span>
          <RefView source={source} />
        </div>
      }
      overlay={overlay}
      onExit={ctx.onBack}
      onDone={comparing ? () => void finish() : () => setComparing(true)}
      doneLabel={comparing ? '次へ' : '重ねて見る'}
      doneDisabled={n === 0 || busy}
      extraAction={
        comparing ? (
          <Button variant="secondary" class="ls-glass" onClick={() => setComparing(false)}>
            重ねを外す
          </Button>
        ) : null
      }
    />
  );
}

// ---------------------------------------------------------------------------
// construct（手順ごとの図解と指示）
// ---------------------------------------------------------------------------

export function ConstructView({ step, ctx }: { step: ConstructStep; ctx: StepCtx }) {
  const engine = useEngine();
  const [k, setK] = useState(0);
  const [busy, setBusy] = useState(false);
  const stage = step.stages[k]!;
  const last = k + 1 >= step.stages.length;

  const finish = async () => {
    setBusy(true);
    try {
      const saved = await saveStrokes(engine.getStrokes(), 'lesson', ctx.node.lesson.id, ctx.session);
      // 累計（counter があれば count ぶん）。何も描かずに進んだときは足さない
      if (saved) await bumpForStep(step, ctx.session);
    } finally {
      setBusy(false);
    }
    ctx.onDone();
  };

  return (
    <CanvasScreen
      engine={engine}
      task={step.instruction}
      counter={`${k + 1}/${step.stages.length}`}
      onExit={ctx.onBack}
      topLeft={
        <div class="ls-construct">
          {stage.figure && <Figure id={stage.figure} class="ls-construct__fig" label={stage.title} />}
          <span class="ls-label ls-label--accent">
            手順 <span class="num">{k + 1}</span>
          </span>
          <h3 class="ls-construct__title">{stage.title}</h3>
          <p class="ls-construct__text">{stage.instruction}</p>
          <div class="ls-construct__nav">
            {k > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setK(k - 1)}>
                前の手順
              </Button>
            )}
            {!last && (
              <Button variant="secondary" size="sm" onClick={() => setK(k + 1)}>
                次の手順
              </Button>
            )}
          </div>
        </div>
      }
      onDone={() => void finish()}
      doneDisabled={!last || busy}
    />
  );
}

// ---------------------------------------------------------------------------
// mosha（模写 → 差分に印 → 1 か所だけ変えて描き直す）
// ---------------------------------------------------------------------------

interface Mark {
  x: number;
  y: number;
}

function MarkView({
  source,
  drawing,
  onDone,
}: {
  source: RefSource;
  drawing: StoredDrawing;
  onDone: (marks: Mark[]) => void;
}) {
  const [marks, setMarks] = useState<Mark[]>([]);
  const [mode, setMode] = useState<'side' | 'overlay'>('side');
  const url = useBlobUrl(drawing.image);
  const add = (e: MouseEvent) => {
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    setMarks([...marks, { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }]);
  };
  return (
    <div class="ls-mark">
      <header class="ls-mark__head">
        <div>
          <span class="ls-label ls-label--accent">模写チェックポイント</span>
          <h2 class="ls-mark__title">違うところをタップして印をつけましょう</h2>
        </div>
        <Segment
          label="表示"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'side', label: '並べる' },
            { value: 'overlay', label: '重ねる' },
          ]}
        />
      </header>
      <div class={mode === 'side' ? 'ls-mark__body' : 'ls-mark__body is-overlay'}>
        {mode === 'side' && (
          <div class="ls-mark__panel ls-mark__panel--ref">
            <RefView source={source} />
          </div>
        )}
        <div class="ls-mark__panel ls-mark__panel--mine">
          {mode === 'overlay' && (
            <div class="ls-mark__under">
              <RefView source={source} />
            </div>
          )}
          <div class="ls-mark__tap" onClick={add} role="button" aria-label="印をつける" tabIndex={0} data-testid="mark-area">
            {url && <img src={url} alt="自分の絵" draggable={false} />}
            {marks.map((m, i) => (
              <span key={i} class="ls-marker num ls-mark__pin" style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}>
                {i + 1}
              </span>
            ))}
          </div>
        </div>
      </div>
      <footer class="ls-mark__foot">
        <p class="ls-muted">
          印 <span class="num">{marks.length}</span> か所。気づいた違いの数が、次に直すところです。
        </p>
        <div class="ls-mark__actions">
          <Button variant="secondary" disabled={marks.length === 0} onClick={() => setMarks(marks.slice(0, -1))}>
            1つ消す
          </Button>
          <Button variant="primary" onClick={() => onDone(marks)}>
            1か所だけ変えて描き直す
          </Button>
        </div>
      </footer>
    </div>
  );
}

export function MoshaView({ step, ctx }: { step: MoshaStep; ctx: StepCtx }) {
  const engine = useEngine();
  const engine2 = useEngine();
  const [source, setSource] = useState<RefSource | null>(null);
  const [phase, setPhase] = useState<'pick' | 'draw' | 'mark' | 'modify'>('pick');
  const [first, setFirst] = useState<StoredDrawing | null>(null);
  const [n, setN] = useState(0);
  const [n2, setN2] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => engine.on('change', () => setN(engine.getStrokes().length)), [engine]);
  useEffect(() => engine2.on('change', () => setN2(engine2.getStrokes().length)), [engine2]);

  const builtins = ctx.node.lesson.steps.flatMap((s) => (s.type === 'copy' && s.reference === 'builtin' && s.refId ? [s.refId] : []));
  const uniqueBuiltins = [...new Set(builtins)];

  if (phase === 'pick' || !source) {
    return (
      <StepFrame class="ls-pick">
        <span class="ls-label ls-label--accent">模写チェックポイント</span>
        <p class="ls-prose">{step.instruction}</p>
        {uniqueBuiltins.length > 0 && (
          <div class="ls-refpick">
            <h3 class="ls-refpick__title">このレッスンのお手本</h3>
            <ul class="ls-refpick__grid">
              {uniqueBuiltins.map((id) => (
                <li key={id}>
                  <button
                    type="button"
                    class="ls-refpick__tile"
                    onClick={() => {
                      setSource({ kind: 'builtin', id });
                      setPhase('draw');
                    }}
                  >
                    <Figure id={id} label="お手本" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <ReferencePicker
          title="取り込んだ画像から選ぶ"
          onPick={(r) => {
            setSource({ kind: 'user', ref: r });
            setPhase('draw');
          }}
        />
      </StepFrame>
    );
  }

  const side = (
    <div class="ls-refview">
      <span class="ls-label">お手本</span>
      <RefView source={source} />
    </div>
  );

  if (phase === 'draw') {
    return (
      <CanvasScreen
        key="draw"
        engine={engine}
        task="お手本を横に見ながら模写しましょう。描き終えたら「完了」。"
        side={side}
        onExit={() => setPhase('pick')}
        onDone={() => {
          setBusy(true);
          void saveStrokes(engine.getStrokes(), 'lesson', ctx.node.lesson.id, ctx.session)
            .then((d) => {
              setFirst(d);
              setPhase('mark');
            })
            .finally(() => setBusy(false));
        }}
        doneDisabled={n === 0 || busy}
      />
    );
  }

  if (phase === 'mark' && first) {
    return (
      <MarkView
        source={source}
        drawing={first}
        onDone={(marks) => {
          void saveDrawingMeta(first.id, { moshaMarks: marks, reference: source.kind === 'builtin' ? source.id : source.ref.id });
          setPhase('modify');
        }}
      />
    );
  }

  return (
    <CanvasScreen
      key="modify"
      engine={engine2}
      task="1か所だけ自由に変えて、もう1枚描きましょう。形・向き・大きさ、どれでもOKです。"
      side={side}
      onExit={() => setPhase('mark')}
      onDone={() => {
        setBusy(true);
        void saveStrokes(engine2.getStrokes(), 'lesson', ctx.node.lesson.id, ctx.session)
          .then((d) => {
            if (d && first) void saveDrawingMeta(d.id, { moshaVariantOf: first.id });
            ctx.onDone();
          })
          .finally(() => setBusy(false));
      }}
      doneDisabled={n2 === 0 || busy}
    />
  );
}

// ---------------------------------------------------------------------------
// free（採点なし）
// ---------------------------------------------------------------------------

export function FreeStepView({ step, ctx }: { step: FreeStep; ctx: StepCtx }) {
  const engine = useEngine();
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => engine.on('change', () => setN(engine.getStrokes().length)), [engine]);
  return (
    <CanvasScreen
      engine={engine}
      task={step.instruction ?? '好きなものを自由に描きましょう。採点はありません。'}
      onExit={ctx.onBack}
      doneLabel="終わる"
      doneDisabled={busy}
      onDone={() => {
        setBusy(true);
        const strokes = engine.getStrokes();
        void (n > 0 ? saveStrokes(strokes, drawingKindForStep('free'), ctx.node.lesson.id, ctx.session) : Promise.resolve(null))
          .then(() => ctx.onDone())
          .finally(() => setBusy(false));
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// critique / submit（B 提出）
// ---------------------------------------------------------------------------

function CritiqueStage({ ctx, drawing, rubricId, task }: { ctx: StepCtx; drawing: StoredDrawing; rubricId: string; task: string }) {
  const { node } = ctx;
  return (
    <CritiqueScreen
      drawingId={drawing.id}
      image={drawing.image}
      rubric={findRubric(rubricId)}
      task={task}
      stageTitle={node.stage.title}
      label={node.lesson.kind === 'graduation' ? `${node.stage.title} 卒業課題` : node.stage.title}
      title={`${node.lesson.title} — 批評`}
      onFinish={ctx.onDone}
    />
  );
}

export function CritiqueStepView({ step, ctx }: { step: CritiqueStep; ctx: StepCtx }) {
  const engine = useEngine();
  const [drawing, setDrawing] = useState<StoredDrawing | null>(null);
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => engine.on('change', () => setN(engine.getStrokes().length)), [engine]);

  if (drawing) return <CritiqueStage ctx={ctx} drawing={drawing} rubricId={step.rubric} task={step.instruction} />;

  if (step.mode === 'import') {
    return (
      <ImportView
        label="卒業課題"
        title="描いた絵を取り込みましょう"
        body={step.instruction}
        busy={busy}
        onFile={(f) => {
          setBusy(true);
          void saveImported(f, 'submit', ctx.node.lesson.id, ctx.session)
            .then(setDrawing)
            .finally(() => setBusy(false));
        }}
      />
    );
  }

  return (
    <CanvasScreen
      engine={engine}
      task={step.instruction}
      onExit={ctx.onBack}
      doneLabel="提出へ"
      doneDisabled={n === 0 || busy}
      onDone={() => {
        setBusy(true);
        void saveStrokes(engine.getStrokes(), 'submit', ctx.node.lesson.id, ctx.session)
          .then((d) => d && setDrawing(d))
          .finally(() => setBusy(false));
      }}
    />
  );
}

export function SubmitStepView({ step, ctx }: { step: SubmitStep; ctx: StepCtx }) {
  const [drawing, setDrawing] = useState<StoredDrawing | null>(null);
  const [busy, setBusy] = useState(false);
  if (drawing) return <CritiqueStage ctx={ctx} drawing={drawing} rubricId={step.rubric} task={step.instruction} />;
  return (
    <ImportView
      label="提出"
      title="外部アプリで描いてから戻ってきてください"
      body={step.instruction}
      note="描き終えたら画像を書き出して、ここで取り込みます。アプリはこのまま閉じても、また続きから始められます。"
      busy={busy}
      onFile={(f) => {
        setBusy(true);
        void saveImported(f, 'submit', ctx.node.lesson.id, ctx.session)
          .then(setDrawing)
          .finally(() => setBusy(false));
      }}
    />
  );
}
