/**
 * ドリルのキャンバス。レッスンの drill ステップと、復習セッション（#/review/:drillType）で使う。
 *
 * 1 本ごと（ハッチングは 1 セットごと）に採点するが、描いている間は何も動かさない:
 * - 1 本ごとの点数は右上のカウンター横の小さなチップ（mono）と、線そのもののヒート色だけ。線は積み重ねて残す
 * - 全画面の採点シートは「セットを終えたとき」と「チップをタップしたとき」だけ出す
 * - 履歴（drillStats）・累計・絵の保存は「完了」を押したときに、確定した本だけまとめて行う
 *   （やり直した本は記録しない。保存に失敗したらシートの中で案内し、押し直せる）
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { DrillStep } from '@/content/schema';
import type { Drawing, Stroke, StrokePoint } from '@/scoring';
import { CanvasScreen } from '../screens/CanvasScreen';
import { drillStats } from '../state';
import { useEngine } from './common';
import { drillSetup, heatBand, scoreDrill, type DrillSetup, type Size } from './drillSetup';
import { ScoreSheet } from './ScoreSheet';
import { bump, recordDrillScores, saveStrokes, scorers, type LessonSession } from './stateBridge';
import { counterKindOf, isSetDrill } from './steps';
import { strokeKey, summarizeEntries, syncEntries, type DrillEntry } from './drillEntries';

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

/** 採点済みの線をヒート色で重ねる（描いた線の上に同じくらいの太さで） */
function HeatStrokes({ entries }: { entries: readonly DrillEntry[] }) {
  return (
    <g class="ls-guide__heat">
      {entries.flatMap((e, ei) =>
        e.strokes.map((s, si) => {
          const heat = e.result.heat[si] ?? e.result.heat[0] ?? [];
          return s.slice(1).map((q, i) => {
            const a = s[i]!;
            const h = heat[i + 1] ?? heat[i] ?? 0;
            return <line key={`${ei}-${si}-${i}`} class={`is-${heatBand(h)}`} x1={a.x} y1={a.y} x2={q.x} y2={q.y} />;
          });
        }),
      )}
    </g>
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
  const setDrill = isSetDrill(step.drill);
  // ハッチングは count 本で 1 セット（1 回だけ採点）
  const target = setDrill ? 1 : Math.max(1, Math.floor(step.count));
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [entries, setEntries] = useState<DrillEntry[]>([]);
  /** null: 描いている / 'last': チップから開いた最後の 1 本 / 'final': セットを終えた */
  const [sheet, setSheet] = useState<null | 'last' | 'final'>(null);
  const [strokeCount, setStrokeCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 自己ベストは開いた時点の値（この回を含めない）
  const [best] = useState<number | null>(() => drillStats.value.find((d) => d.drillType === step.drill)?.bestScore ?? null);
  const busyRef = useRef(false);
  /** 完了の記録の進み具合（失敗して押し直したときに二重にしない） */
  const done = useRef({ saved: false, recorded: { done: 0 }, bumped: false });

  const index = Math.min(entries.length, target - 1);
  const setup = useMemo(() => drillSetup(step.drill, step.params, size, index), [step, size, index]);
  const finished = entries.length >= target;

  const live = useRef({ setup, entries, finished });
  live.current = { setup, entries, finished };

  const add = (entry: DrillEntry) => {
    const next = [...live.current.entries, entry];
    live.current.entries = next;
    live.current.finished = next.length >= target;
    setEntries(next);
    if (next.length >= target) setSheet('final');
  };

  /** ハッチング: 「採点」でセットを採点 */
  const evaluateSet = () => {
    const { setup: st, finished: fin } = live.current;
    if (fin) return;
    const strokes = engine.getStrokes().filter((s) => s.length >= 2);
    const result = scoreDrill(scorers.value, step.drill, st, strokes);
    if (!result) return;
    add({ keys: strokes.map(strokeKey), strokes, result, target: null });
  };

  useEffect(() => {
    const offStroke = engine.on('strokeend', (s) => {
      if (setDrill) return;
      if (s.length < 2 || pathLen(s) < 12) {
        // 点を打っただけ・ごく短い線は採点しない
        engine.undo();
        return;
      }
      const { setup: st, finished: fin } = live.current;
      if (fin) {
        // セットを終えたあとの線は数えない
        engine.undo();
        return;
      }
      const result = scoreDrill(scorers.value, step.drill, st, [s]);
      if (!result) return;
      add({ keys: [strokeKey(s)], strokes: [s], result, target: targetOf(st) });
    });
    const offChange = engine.on('change', () => {
      const strokes = engine.getStrokes();
      setStrokeCount(strokes.length);
      const cur = live.current.entries;
      const kept = syncEntries(cur, strokes);
      if (kept.length !== cur.length) {
        live.current.entries = kept;
        live.current.finished = kept.length >= target;
        setEntries(kept);
      }
    });
    return () => {
      offStroke();
      offChange();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, setDrill]);

  /** 最後の 1 本（ハッチングはセット）をやり直す。記録はしない */
  const again = () => {
    if (busyRef.current) return;
    const cur = live.current.entries;
    const lastEntry = cur[cur.length - 1];
    if (!lastEntry) return;
    const drop = new Set(lastEntry.keys);
    const rest = cur.slice(0, -1);
    live.current.entries = rest;
    live.current.finished = false;
    setEntries(rest);
    const all = engine.getStrokes();
    const styles = engine.getStyles();
    const keep = all.map((s) => !drop.has(strokeKey(s)));
    engine.loadStrokes(
      all.filter((_, k) => keep[k]),
      styles.filter((_, k) => keep[k]),
    );
    setStrokeCount(engine.getStrokes().length);
    setSheet(null);
    setError(null);
  };

  /** 「完了」: 絵の保存 → 点数の記録 → 累計。済んだものは押し直しで繰り返さない */
  const complete = async () => {
    if (busyRef.current) return;
    const list = live.current.entries;
    if (list.length < target) return;
    busyRef.current = true;
    setSaving(true);
    setError(null);
    const scores = list.map((e) => e.result.score);
    const d = done.current;
    try {
      if (!d.saved) {
        await saveStrokes(
          list.flatMap((e) => e.strokes),
          'drill',
          lessonId,
          session,
        );
        d.saved = true;
      }
      await recordDrillScores(step.drill, scores, d.recorded);
      const ck = counterKindOf(step.counter);
      if (ck && !d.bumped) {
        const n = setDrill ? list.reduce((a, e) => a + e.strokes.length, 0) : list.length;
        await bump(ck, n, session);
      }
      d.bumped = true;
      session?.drillScores.push(...scores);
      busyRef.current = false;
      setSaving(false);
      onFinish(scores);
    } catch {
      busyRef.current = false;
      setSaving(false);
      setError('保存できませんでした。端末の空き容量を確かめて、もう一度「完了」を押してみましょう。');
    }
  };

  /** 画面の回転などで紙の大きさが変わった: 採点済みの線も同じ変換で動かす */
  const rescale = (map: (q: StrokePoint) => StrokePoint) => {
    const moved = live.current.entries.map((e) => {
      const strokes = e.strokes.map((s) => s.map(map));
      return { ...e, strokes, keys: strokes.map(strokeKey), target: e.target ? e.target.map((s) => s.map(map)) : null };
    });
    live.current.entries = moved;
    setEntries(moved);
  };

  const last = entries[entries.length - 1] ?? null;
  const summary = sheet === 'final' ? summarizeEntries(entries) : null;

  const guide = (sz: Size) => (
    <>
      {!finished && <DrillGuideSvg setup={setup} size={sz} />}
      {!setDrill && <HeatStrokes entries={entries} />}
    </>
  );

  const counterLabel = setDrill
    ? `${Math.min(strokeCount, step.count)}/${step.count}`
    : `${Math.min(entries.length + (finished ? 0 : 1), target)}/${target}`;

  let sheetEl = null;
  if (sheet === 'final' && summary) {
    sheetEl = (
      <ScoreSheet
        result={summary}
        strokes={entries.flatMap((e) => e.strokes)}
        target={entries.flatMap((e) => e.target ?? [])}
        best={best}
        onAgain={again}
        onNext={() => void complete()}
        nextLabel="完了"
        againLabel={setDrill ? 'もう一回' : '最後の1本をもう一回'}
        heatLabel={setDrill || entries.length > 1 ? 'ヒートマップ — このセット' : undefined}
        busy={saving}
        error={error}
      />
    );
  } else if (sheet === 'last' && last) {
    sheetEl = (
      <ScoreSheet
        result={last.result}
        strokes={last.strokes}
        target={last.target}
        best={best}
        onAgain={again}
        onNext={() => setSheet(null)}
        nextLabel="続ける"
      />
    );
  }

  return (
    <CanvasScreen
      engine={engine}
      lockPen
      task={step.instruction}
      counter={counterLabel}
      counterExtra={
        last && !setDrill ? (
          <button
            type="button"
            class={`ls-scorechip num is-${last.result.score >= 60 ? 'good' : 'mid'}`}
            aria-label={`最後の1本の点数 ${last.result.score}点。タップで詳しく見る`}
            data-testid="score-chip"
            onClick={() => setSheet(finished ? 'final' : 'last')}
          >
            {last.result.score}
          </button>
        ) : null
      }
      onExit={onExit}
      exitLabel="ドリルの説明へ戻る"
      onSize={setSize}
      onRescale={rescale}
      guide={guide}
      onDone={setDrill ? evaluateSet : finished ? () => setSheet('final') : undefined}
      doneLabel={setDrill ? '採点' : '完了'}
      doneDisabled={setDrill ? strokeCount < Math.min(3, step.count) || finished || saving : saving}
      sheet={sheetEl}
    />
  );
}
