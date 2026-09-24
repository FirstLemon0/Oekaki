/**
 * ドリルのキャンバス（1 本ごと、ハッチングは 1 セットごとに採点 → 採点シート）。
 * レッスンの drill ステップと、復習セッション（#/review/:drillType）で使う。
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { DrillStep } from '@/content/schema';
import type { Drawing, ScoreResult, Stroke } from '@/scoring';
import { CanvasScreen } from '../screens/CanvasScreen';
import { drillStats } from '../state';
import { useEngine } from './common';
import { drillSetup, scoreDrill, type DrillSetup, type Size } from './drillSetup';
import { ScoreSheet } from './ScoreSheet';
import { bump, recordDrillScore, saveStrokes, scorers, type LessonSession } from './stateBridge';
import {
  counterKindOf,
  drillAgain,
  drillCounterLabel,
  drillDone,
  drillNext,
  drillScored,
  isSetDrill,
  startDrill,
  type DrillProgress,
} from './steps';

interface Scored {
  result: ScoreResult;
  strokes: Drawing;
  target: Drawing | null;
  best: number | null;
}

function pathLen(s: Stroke): number {
  let L = 0;
  for (let i = 1; i < s.length; i++) L += Math.hypot(s[i]!.x - s[i - 1]!.x, s[i]!.y - s[i - 1]!.y);
  return L;
}

function targetOf(setup: DrillSetup): Drawing | null {
  if (setup.curve) return [setup.curve];
  if (setup.line) {
    const { from, to } = setup.line;
    return [
      [
        { x: from.x, y: from.y, p: 0.5, t: 0 },
        { x: to.x, y: to.y, p: 0.5, t: 1 },
      ],
    ];
  }
  return null;
}

/** キャンバスに重ねる手がかり */
export function DrillGuideSvg({ setup, size }: { setup: DrillSetup; size: Size }) {
  const g = setup.guide;
  return (
    <>
      {g.path && <polyline class="ls-guide__path" points={g.path.map((q) => `${q.x},${q.y}`).join(' ')} />}
      {g.area && <rect class="ls-guide__area" x={g.area.x} y={g.area.y} width={g.area.w} height={g.area.h} rx={8} />}
      {g.points.map((q, i) => (
        <g key={i}>
          <circle class="ls-guide__ring" cx={q.x} cy={q.y} r={14} />
          <circle class="ls-guide__dot" cx={q.x} cy={q.y} r={5} />
        </g>
      ))}
      {g.sample && (
        <g transform={`translate(${size.width - 92} ${128})`}>
          <rect class="ls-guide__samplebox" x={-60} y={-44} width={120} height={88} rx={10} />
          {g.sample.kind === 'ellipse' ? (
            <ellipse class="ls-guide__sample" cx={0} cy={0} rx={40} ry={Math.max(3, 40 * g.sample.degree)} transform={`rotate(${g.sample.axisAngleDeg})`} />
          ) : (
            <g transform={`rotate(${g.sample.angleDeg})`}>
              {[-2, -1, 0, 1, 2].map((k) => (
                <line key={k} class="ls-guide__sample" x1={-30} y1={k * 10} x2={30} y2={k * 10} />
              ))}
            </g>
          )}
          <text class="ls-guide__label" x={0} y={60} text-anchor="middle">
            見本
          </text>
        </g>
      )}
    </>
  );
}

export interface DrillRunnerProps {
  step: DrillStep;
  session?: LessonSession;
  lessonId: string | null;
  onFinish: (scores: number[]) => void;
  onExit: () => void;
}

export function DrillRunner({ step, session, lessonId, onFinish, onExit }: DrillRunnerProps) {
  const engine = useEngine();
  const setDrillEarly = isSetDrill(step.drill);
  // ハッチングは count 本で 1 セット（1 回だけ採点）
  const [progress, setProgress] = useState<DrillProgress>(() => startDrill(setDrillEarly ? 1 : step.count));
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [scored, setScored] = useState<Scored | null>(null);
  const [strokeCount, setStrokeCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const kept = useRef<Drawing>([]);
  const setDrill = isSetDrill(step.drill);

  const setup = useMemo(() => drillSetup(step.drill, step.params, size, progress.index), [step, size, progress.index]);

  const live = useRef({ setup, progress, scored });
  live.current = { setup, progress, scored };

  const evaluate = () => {
    const { setup: st, progress: pr, scored: sc } = live.current;
    if (sc || drillDone(pr)) return;
    const strokes = engine.getStrokes();
    const result = scoreDrill(scorers.value, step.drill, st, strokes);
    if (!result) return;
    const shown = setDrill ? strokes.filter((s) => s.length >= 2) : strokes.slice(-1);
    const heat = setDrill ? result.heat : result.heat.slice(-1);
    const best = drillStats.value.find((d) => d.drillType === step.drill)?.bestScore ?? null;
    setScored({ result: { ...result, heat }, strokes: shown, target: targetOf(st), best });
    setProgress((p) => drillScored(p, result.score));
    void recordDrillScore(step.drill, result.score);
  };

  // 1 本ごとの採点（ハッチングは「採点」ボタン）
  useEffect(() => {
    const offStroke = engine.on('strokeend', (s) => {
      if (setDrill) return;
      if (s.length < 2 || pathLen(s) < 12) {
        // 点を打っただけ・ごく短い線は採点しない
        engine.undo();
        return;
      }
      evaluate();
    });
    const offChange = engine.on('change', () => setStrokeCount(engine.getStrokes().length));
    return () => {
      offStroke();
      offChange();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, setDrill]);

  const again = () => {
    engine.loadStrokes([]);
    setStrokeCount(0);
    setScored(null);
    setProgress((p) => drillAgain(p));
  };

  const next = async () => {
    if (!scored) return;
    kept.current = [...kept.current, ...scored.strokes];
    const np = drillNext(progress);
    setProgress(np);
    setScored(null);
    engine.loadStrokes([]);
    setStrokeCount(0);
    const ck = counterKindOf(step.counter);
    if (ck) void bump(ck, setDrill ? scored.strokes.length : 1, session);
    if (drillDone(np)) {
      setSaving(true);
      if (session) session.drillScores.push(...np.scores);
      try {
        await saveStrokes(kept.current, 'drill', lessonId, session);
      } finally {
        setSaving(false);
      }
      onFinish(np.scores);
    }
  };

  const guide = (s: Size) => <DrillGuideSvg setup={setup} size={s} />;

  return (
    <CanvasScreen
      engine={engine}
      task={step.instruction}
      counter={setDrill ? `${Math.min(strokeCount, step.count)}/${step.count}` : drillCounterLabel(progress)}
      onExit={onExit}
      exitLabel="ドリルの説明へ戻る"
      onSize={setSize}
      guide={guide}
      onDone={setDrill ? evaluate : undefined}
      doneLabel="採点"
      doneDisabled={strokeCount < (setDrill ? Math.min(3, step.count) : 1) || scored !== null || saving}
      sheet={
        scored ? (
          <ScoreSheet
            result={scored.result}
            strokes={scored.strokes}
            target={scored.target}
            best={scored.best}
            onAgain={again}
            onNext={() => void next()}
            nextLabel={progress.index + 1 >= progress.count ? '終える' : '次へ'}
            heatLabel={setDrill ? 'ヒートマップ — このセット' : undefined}
          />
        ) : null
      }
    />
  );
}
