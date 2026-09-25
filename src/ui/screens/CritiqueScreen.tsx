/**
 * 批評画面（DESIGN_SYSTEM §3 批評）: 送信前確認 → 待機 → 結果。
 * 上限（今日の「試行回数」≥ dailyCritiqueLimit。失敗した送信も数える）とキー未設定はここで止め、critic は呼ばない。
 * 送る直前に recordCritiqueAttempt() で試行を 1 回数える。
 * 「履歴」ボタンはレッスンの外（#/critique/:id）だけ。レッスン中に出すと離脱して絵が宙に浮くため。
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { critique as runCritique, CriticError, estimateCostJpy, type CritiqueResult } from '@/critic';
import { downscaleToWebp } from '@/data/images';
import { getCritique, getDrawing, getTodayCritiqueAttempts, recordCritiqueAttempt } from '@/data/repo';
import type { Critique, Drawing } from '@/data/types';
import type { Rubric } from '@/content/schema';
import { BackPill, Button, Icon } from '../components';
import { href, navigate } from '../router';
import { curriculum, path, settings } from '../state';
import { useBlobUrl } from '../lesson/common';
import { critiqueGate } from '../lesson/limits';
import { ERROR_TEXT } from '../lesson/critiqueText';
import { storeCritique } from '../lesson/stateBridge';
import { markerPlacement, type MarkerPos as Pos } from '../lesson/critiqueMarkers';

/** 番号マーカーの位置は「保存した（切り詰め後の）絵の左上原点 0..1」 */
interface View {
  good: string[];
  issues: { where: string; what: string; fix: string; pos?: Pos }[];
  next_one: string;
  encourage: string;
  model: string;
}

function fromSaved(c: Critique): View {
  return {
    good: c.response.good,
    issues: c.response.issues.map((i) => ({ where: i.where, what: i.what, fix: i.how, ...(i.pos ? { pos: i.pos } : {}) })),
    next_one: c.response.next_one,
    encourage: c.response.encourage,
    model: c.model,
  };
}

function fromResult(r: CritiqueResult): View {
  return { good: r.good, issues: r.issues, next_one: r.next_one, encourage: r.encourage, model: r.model };
}

export interface CritiqueScreenProps {
  drawingId: string;
  image: Blob;
  rubric: Rubric | null;
  task: string;
  stageTitle: string;
  /** ヘッダの見出し（例: 正面顔 — 批評） */
  title: string;
  /** ヘッダのラベル（例: ステージ1.5 卒業課題） */
  label: string;
  onFinish: () => void;
  finishLabel?: string;
  onBack?: () => void;
  /** 保存済みの批評（履歴の再表示） */
  saved?: Critique | null;
  /** 結果に「履歴」ボタンを出す（レッスンの外だけ。レッスン中は完了後にギャラリーで見られる） */
  showHistory?: boolean;
}

type Phase = { k: 'confirm' } | { k: 'waiting' } | { k: 'result'; view: View; fallback: boolean } | { k: 'error'; kind: CriticError['kind'] };

export function CritiqueScreen(props: CritiqueScreenProps) {
  const [phase, setPhase] = useState<Phase>(() => (props.saved ? { k: 'result', view: fromSaved(props.saved), fallback: false } : { k: 'confirm' }));
  const abortRef = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);
  const imgUrl = useBlobUrl(props.image);
  const s = settings.value;
  const model = s?.modelId ?? 'claude-opus-5-5';
  const limit = s?.dailyCritiqueLimit ?? 3;
  /** 今日の試行回数（失敗も含む）。読み込むまでは null で送れない */
  const [used, setUsed] = useState<number | null>(null);
  const gate = critiqueGate(s?.apiKey, limit, used ?? 0);

  useEffect(() => {
    let alive = true;
    void getTodayCritiqueAttempts().then(
      (n) => {
        if (alive) setUsed(n);
      },
      () => {
        if (alive) setUsed(0);
      },
    );
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, []);

  const send = async () => {
    if (sendingRef.current || used === null || !gate.ok || !props.rubric || !s?.apiKey) return;
    sendingRef.current = true;
    const ac = new AbortController();
    abortRef.current = ac;
    setPhase({ k: 'waiting' });
    try {
      // 送る前に試行を数える（失敗・キャンセルでも 1 回。上限はこの回数で見る）
      const n = await recordCritiqueAttempt();
      setUsed(n);
      if (n > Math.max(0, Math.floor(limit))) {
        setPhase({ k: 'error', kind: 'daily_limit' });
        return;
      }
      let image: Blob = props.image;
      try {
        image = await downscaleToWebp(props.image, { maxEdge: 1024 });
      } catch {
        // 縮小できなければそのまま（保存時に縮小済み）
      }
      const r = await runCritique(
        { image, task: props.task, rubric: props.rubric, stageTitle: props.stageTitle, settings: { apiKey: s.apiKey, model, effort: s.effort } },
        { signal: ac.signal },
      );
      await storeCritique(props.drawingId, r);
      setPhase({ k: 'result', view: fromResult(r), fallback: r.model !== model });
    } catch (e) {
      if (ac.signal.aborted) {
        setPhase({ k: 'confirm' });
        return;
      }
      setPhase({ k: 'error', kind: e instanceof CriticError ? e.kind : 'network' });
    } finally {
      abortRef.current = null;
      sendingRef.current = false;
    }
  };

  const cancel = () => abortRef.current?.abort();

  const remaining = Math.max(0, limit - (used ?? 0));

  return (
    <div class="ls-critique">
      <header class="ls-chead">
        {props.onBack ? (
          <BackPill onClick={props.onBack} />
        ) : (
          <span class="ls-chead__spacer" />
        )}
        <div class="ls-chead__titles">
          <span class="ls-label ls-label--accent">{props.label}</span>
          <h1 class="ls-chead__title">{props.title}</h1>
        </div>
        <span class="ls-chead__remain">
          今日の残り <span class="num">{remaining}/{limit}</span> 回
        </span>
      </header>

      {phase.k === 'confirm' && (
        <div class="ls-cconfirm">
          <figure class="ls-cpic">
            <span class="ls-cpic__cap">送る絵（縮小）</span>
            {imgUrl && <img src={imgUrl} alt="送る絵" />}
          </figure>
          <div class="ls-cconfirm__side">
            <h2 class="ls-h-critique">先生に見てもらいますか？</h2>
            <ul class="ls-card ls-sendlist">
              <li>
                <Icon name="check" size={20} />
                自分の絵（長辺 1024px に縮小）
              </li>
              <li>
                <Icon name="check" size={20} />
                課題文
              </li>
              <li>
                <Icon name="check" size={20} />
                ルーブリック{props.rubric ? `（${props.rubric.title}）` : ''}
              </li>
              <li class="is-no">
                <span class="ls-sendlist__no" aria-hidden="true">
                  <Icon name="close" size={18} />
                </span>
                お手本は送りません
              </li>
            </ul>
            {!gate.ok && gate.reason === 'daily_limit' && (
              <p class="ls-warn" role="status">
                今日の分は使い切りました。明日また見てもらいましょう。
              </p>
            )}
            {!gate.ok && gate.reason === 'no_api_key' && (
              <p class="ls-warn" role="status">
                API キーがまだ設定されていません。設定の「AI 批評」で入れましょう。
              </p>
            )}
            {!props.rubric && (
              <p class="ls-warn" role="status">
                この課題の観点（ルーブリック）が見つかりませんでした。
              </p>
            )}
            <p class="ls-note">
              10〜30秒かかります。点数はつけません。言葉で見ます。モデル: <span class="num">{model}</span> · 目安 ¥
              <span class="num">{estimateCostJpy(model)}</span>
            </p>
            <div class="ls-cconfirm__actions">
              <Button variant="secondary" onClick={props.onFinish}>
                やめる
              </Button>
              {!gate.ok && gate.reason === 'no_api_key' ? (
                <Button variant="primary" onClick={() => navigate(href.settings('ai'))}>
                  設定へ
                </Button>
              ) : (
                <Button variant="primary" disabled={used === null || !gate.ok || !props.rubric} onClick={() => void send()}>
                  送る
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {phase.k === 'waiting' && (
        <div class="ls-cwait" aria-busy="true">
          {imgUrl && <img class="ls-cwait__pic" src={imgUrl} alt="" />}
          <div class="ls-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <p class="ls-cwait__text" role="status">
            先生が見ています…
          </p>
          <Button variant="secondary" onClick={cancel}>
            キャンセル
          </Button>
        </div>
      )}

      {phase.k === 'error' && (
        <div class="ls-cerror" role="alert">
          <h2 class="ls-h-critique">{ERROR_TEXT[phase.kind].title}</h2>
          <p class="ls-prose">{ERROR_TEXT[phase.kind].body}</p>
          <div class="ls-cconfirm__actions">
            <Button variant="secondary" onClick={props.onFinish}>
              送らずに進む
            </Button>
            {phase.kind === 'no_api_key' || phase.kind === 'model_unavailable' ? (
              <Button variant="primary" onClick={() => navigate(href.settings('ai'))}>
                設定へ
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setPhase({ k: 'confirm' })}>
                もう一度
              </Button>
            )}
          </div>
        </div>
      )}

      {phase.k === 'result' && (
        <div class="ls-cresult">
          <figure class="ls-cpic ls-cpic--result">
            <div class="ls-cpic__frame">
              {imgUrl && <img src={imgUrl} alt="批評を受けた絵" />}
              {phase.view.issues.map((it, i) => {
                const at = markerPlacement(it.pos);
                return at ? (
                  <span
                    key={i}
                    class="ls-marker num ls-cpic__pin"
                    style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }}
                    aria-hidden="true"
                    data-testid="critique-pin"
                  >
                    {i + 1}
                  </span>
                ) : null;
              })}
            </div>
            <div class="ls-cpic__markers" aria-hidden="true">
              {phase.view.issues.map((it, i) =>
                markerPlacement(it.pos) ? null : (
                  <span key={i} class="ls-marker num">
                    {i + 1}
                  </span>
                ),
              )}
            </div>
            <figcaption class="ls-note">
              番号は右の「直す点」と対応します。モデル: <span class="num">{phase.view.model}</span>
              {phase.fallback ? '（指定のモデルが使えなかったため代わりに使いました）' : ''}
            </figcaption>
          </figure>
          <div class="ls-cgrid">
            <section class="ls-cblock ls-cblock--good">
              <h3>良い点</h3>
              <ul>
                {phase.view.good.map((g, i) => (
                  <li key={i}>
                    <Icon name="check" size={18} />
                    <span>{g}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section class="ls-cblock ls-cblock--issues">
              <h3>直す点</h3>
              {phase.view.issues.length === 0 ? (
                <p class="ls-muted">大きく直すところは見つかりませんでした。</p>
              ) : (
                <ol>
                  {phase.view.issues.map((it, i) => (
                    <li key={i}>
                      <span class="ls-marker ls-marker--sm num">{i + 1}</span>
                      <div>
                        <p>
                          <strong>{it.where}</strong> — {it.what}
                        </p>
                        <p class="ls-fix">→ {it.fix}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
            <section class="ls-cblock ls-cblock--next">
              <h3>次にやる1つ</h3>
              <p>{phase.view.next_one}</p>
            </section>
            <div class="ls-cfoot">
              <p class="ls-quote">『{phase.view.encourage}』</p>
              <div class="ls-cconfirm__actions">
                {props.showHistory && (
                  <Button variant="secondary" onClick={() => navigate(href.galleryDetail(props.drawingId))}>
                    履歴
                  </Button>
                )}
                <Button variant="primary" onClick={props.onFinish}>
                  {props.finishLabel ?? 'レッスンを終える'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** ステップの rubric id → Rubric */
export function findRubric(id: string | undefined): Rubric | null {
  if (!id) return null;
  return curriculum.value?.rubrics.find((r) => r.id === id) ?? null;
}

/** #/critique/:drawingId — 履歴の再表示（未批評なら送信前確認から） */
export function CritiqueRoute({ drawingId }: { drawingId: string }) {
  const [state, setState] = useState<{ drawing: Drawing; saved: Critique | null } | null | 'missing'>(null);
  useEffect(() => {
    let alive = true;
    void Promise.all([getDrawing(drawingId), getCritique(drawingId)]).then(([d, c]) => {
      if (!alive) return;
      setState(d ? { drawing: d, saved: c ?? null } : 'missing');
    });
    return () => {
      alive = false;
    };
  }, [drawingId]);

  if (state === null) return <div class="ls-loading" aria-busy="true" />;
  if (state === 'missing') {
    return (
      <div class="ls-missing">
        <p>この絵は見つかりませんでした。</p>
        <Button variant="primary" href={href.gallery()}>
          ギャラリーへ
        </Button>
      </div>
    );
  }
  const node = state.drawing.lessonId ? path.value.find((n) => n.lesson.id === state.drawing.lessonId) : undefined;
  const step = node?.lesson.steps.find((s) => s.type === 'critique' || s.type === 'submit');
  const rubricId = step && (step.type === 'critique' || step.type === 'submit') ? step.rubric : undefined;
  const task = step && (step.type === 'critique' || step.type === 'submit') ? step.instruction : '自由に描いた絵です。';
  const back = () => navigate(href.galleryDetail(drawingId));
  return (
    <CritiqueScreen
      drawingId={drawingId}
      image={state.drawing.image}
      rubric={findRubric(rubricId) ?? curriculum.value?.rubrics.find((r) => r.stage === node?.stage.id) ?? null}
      task={task}
      stageTitle={node?.stage.title ?? ''}
      label={node ? `${node.stage.title} 卒業課題` : '批評'}
      title={`${node?.lesson.title ?? '絵'} — 批評`}
      saved={state.saved}
      onBack={back}
      onFinish={back}
      finishLabel="戻る"
    />
  );
}
