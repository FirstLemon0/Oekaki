/**
 * ホーム（一本道パス）  #/   （DESIGN_SYSTEM.md §3 ホーム）
 *
 * 横 1472×920: 左レール 96 | 上部バー 72（ピル群 ＋ Lv/XP）
 *              | 中央: ステージバナー 520×64 ＋ パス（幅 520、縦スクロール） | 右パネル 400
 * 縦 920×1472: 上部バー 80 → 今日カード（横並び）→ 累計チップ横スクロール → バナー＋パス → 下ナビ 88
 *
 * パスに出すのは「今いるステージ」だけ。末尾に門（卒業課題）と、次ステージのロック帯を置く。
 *
 * 完了アニメ: `#/?justDone=<lessonId>` で来たら、そのノードを塗り（200ms）→ チェックを描き（300ms）
 * → 次区間の道を伸ばす（400ms）。読んだらハッシュは `#/` に戻す（再訪で繰り返さない）。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { PathNode, Step } from '@/content';
import { stageProgress } from '@/content';
import { monthlyPromptDue } from '@/data/beforeAfter';
import { diffDays } from '@/data/date';
import type { DueReview } from '@/data/review';
import { Button, CounterChip, Icon, Modal, showToast } from '../components';
import { drillName, formatStageOrder, lessonNumber, nf, unitNumber } from '../format';
import { href, navigate } from '../router';
import {
  completedIds,
  completedTodayIds,
  counters,
  curriculum,
  freezeAvailability,
  freezeToday,
  isFirstRun,
  level,
  localDay,
  nextNode,
  now,
  path,
  profile,
  reviews,
  skippedIds,
  saveProfile,
  saveSettings,
  streak,
  streakAtRisk,
  today,
  todayDone,
  totalXp,
  uiPrefs,
} from '../state';

// ---------------------------------------------------------------------------
// 直近完了ノード（#/?justDone=<lessonId>）
// ---------------------------------------------------------------------------

function readJustDone(): string | null {
  if (typeof location === 'undefined') return null;
  const q = location.hash.split('?')[1];
  if (!q) return null;
  return new URLSearchParams(q).get('justDone');
}

/** 初回描画時に一度だけ読み、ハッシュからは消す（ルートは home のまま） */
function useJustDone(): string | null {
  const [id] = useState(readJustDone);
  useEffect(() => {
    if (id && typeof history !== 'undefined') history.replaceState(null, '', '#/');
  }, [id]);
  return id;
}

// ---------------------------------------------------------------------------
// 表示用の小さな整形
// ---------------------------------------------------------------------------

const STEP_NAME: Record<Step['type'], string> = {
  read: '説明',
  drill: 'ドリル',
  trace: 'なぞり',
  copy: '見て描く',
  construct: '構築',
  gesture: 'ジェスチャー',
  quiz: 'クイズ',
  mosha: '模写',
  critique: '批評',
  submit: '提出',
  free: '自由',
};

/** 「説明 → ドリル → なぞり」（出てくる順・重複なし・最大 4 つ） */
function stepFlow(steps: Step[]): string {
  const seen: string[] = [];
  for (const s of steps) {
    const n = STEP_NAME[s.type];
    if (!seen.includes(n)) seen.push(n);
  }
  return seen.slice(0, 4).join(' → ');
}

function lessonTitle(node: PathNode): string {
  const l = node.lesson;
  return l.kind === 'lesson' ? `L${lessonNumber(l.id)} ${l.title}` : l.title;
}

/** 選択式（飛ばせる）レッスンか */
function isOptional(node: PathNode): boolean {
  return node.lesson.optional === true;
}

function unitLabel(node: PathNode): string {
  return `U${formatStageOrder(node.stage.order)}-${unitNumber(node.unit.id)} ${node.unit.title}`;
}

// ---------------------------------------------------------------------------
// パスのレイアウト（幅 520、中心 x=260 の縦うねり）
// ---------------------------------------------------------------------------

/** 今日＝未完了の最初のレッスン（前を終えたら日付に関係なくすぐ開く）。それより先はロック */
type NodeState = 'done' | 'today' | 'locked';

type PathItem =
  | { kind: 'unit'; key: string; y: number; label: string; skippable: boolean }
  | {
      kind: 'node';
      key: string;
      x: number;
      y: number;
      node: PathNode;
      state: NodeState;
      pi: number;
      optional: boolean;
      skipped: boolean;
    }
  | { kind: 'review'; key: string; x: number; y: number; review: DueReview; pi: number };

const PATH_W = 520;
const CX = PATH_W / 2;
/** 原本のうねり（260, 330, 370, 330, 260, 190, 150, 190 …） */
const WAVE = [0, 70, 110, 70, 0, -70, -110, -70];
const STEP_Y = 92;

interface PathLayout {
  items: PathItem[];
  points: { x: number; y: number }[];
  /** 若葉の実線で描く最後の点（含む）。-1 なら実線なし */
  solidEnd: number;
  /** 直近完了ノードの点（完了アニメの起点）。無ければ -1 */
  justIdx: number;
  gateY: number | null;
  height: number;
}

function layoutStage(
  nodes: PathNode[],
  done: Set<string>,
  skipped: Set<string>,
  next: PathNode | undefined,
  finishedToday: boolean,
  review: DueReview | undefined,
  justDone: string | null,
): PathLayout {
  const items: PathItem[] = [];
  const points: { x: number; y: number }[] = [];
  let y = 40;
  let k = 0;
  let prevUnit = '';
  let solidEnd = -1;
  let justIdx = -1;
  let gateY: number | null = null;
  let gap = false;

  const push = (x: number, py: number) => {
    points.push({ x, y: py });
    return points.length - 1;
  };

  for (const node of nodes) {
    if (node.unit.id !== prevUnit) {
      if (prevUnit !== '') y += 24;
      const skippable = nodes.some((n) => n.unit.id === node.unit.id && isOptional(n));
      items.push({ kind: 'unit', key: `unit-${node.unit.id}`, y: y - 42, label: unitLabel(node), skippable });
      prevUnit = node.unit.id;
    }

    const isNext = next?.lesson.id === node.lesson.id;

    if (isNext && review && !finishedToday) {
      const x = CX + WAVE[k++ % WAVE.length]!;
      const pi = push(x, y);
      items.push({ kind: 'review', key: `review-${review.drillType}`, x, y, review, pi });
      solidEnd = pi;
      y += STEP_Y;
    }

    let state: NodeState;
    if (done.has(node.lesson.id)) state = 'done';
    else if (isNext) state = 'today';
    else state = 'locked';

    const isGate = node.lesson.kind === 'graduation';
    if (isGate) y += 16;
    const x = isGate ? CX : CX + WAVE[k++ % WAVE.length]!;
    const pi = push(x, y);
    items.push({
      kind: 'node',
      key: node.lesson.id,
      x,
      y,
      node,
      state,
      pi,
      optional: isOptional(node),
      skipped: state === 'done' && skipped.has(node.lesson.id),
    });
    // 実線は「先頭から途切れずに進んだところ」まで（飛ばして先に済ませたノードでは伸ばさない）
    if (state === 'done') {
      if (!gap) solidEnd = pi;
      if (node.lesson.id === justDone) justIdx = pi;
    } else if (state === 'today') {
      solidEnd = pi;
      gap = true;
    } else {
      gap = true;
    }
    if (isGate) gateY = y;
    // 今日のノードは題と「今日」ピルぶん下を空ける
    y += state === 'today' ? STEP_Y + 24 : STEP_Y;
  }

  return { items, points, solidEnd, justIdx, gateY, height: y };
}

/** ノード中心を通る縦向きの滑らかな曲線（各ノードで接線が縦になる 3 次ベジェ） */
function curve(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  let d = `M${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const my = (a.y + b.y) / 2;
    d += ` C${a.x} ${my} ${b.x} ${my} ${b.x} ${b.y}`;
  }
  return d;
}

// ---------------------------------------------------------------------------
// ノード
// ---------------------------------------------------------------------------

/** ロック: 左右に 3px 1 回だけ振れて「前のレッスンを終えると開きます」 */
function shake(el: HTMLElement) {
  el.classList.remove('st-shake');
  void el.offsetWidth;
  el.classList.add('st-shake');
  el.addEventListener('animationend', () => el.classList.remove('st-shake'), { once: true });
  showToast('前のレッスンを終えると開きます', 'info', 2000);
}

function NodeView({
  item,
  justDone,
  gateJustOpened,
}: {
  item: Extract<PathItem, { kind: 'node' }>;
  justDone: boolean;
  gateJustOpened: boolean;
}) {
  const { node, state, optional, skipped } = item;
  const lesson = node.lesson;
  const shape = lesson.kind === 'graduation' ? 'gate' : lesson.kind === 'checkpoint' ? 'cp' : 'lesson';
  const blocked = state === 'locked';
  const stateLabel = { done: '完了', today: '今日', locked: 'ロック中' }[state];
  const aria = `${lessonTitle(node)}（${skipped ? '飛ばした · タップで挑戦' : stateLabel}${optional ? ' · 任意' : ''}）`;

  const onClick = (e: MouseEvent) => {
    if (blocked) {
      shake(e.currentTarget as HTMLElement);
      return;
    }
    navigate(href.lesson(lesson.id));
  };

  if (shape === 'gate') {
    const open = state === 'today';
    return (
      <div class="pnode pnode--gate" style={{ left: `${item.x - 100}px`, top: `${item.y - 30}px` }} data-today={open ? 'true' : undefined}>
        <button
          type="button"
          class={`gate gate--${state}${gateJustOpened ? ' gate--opening' : ''}`}
          aria-label={aria}
          aria-disabled={blocked || undefined}
          onClick={onClick}
        >
          {state === 'done' ? (
            <>
              <Icon name="check" size={20} strokeWidth={2.5} />
              卒業課題
            </>
          ) : open ? (
            <>卒業課題へ</>
          ) : (
            <>
              <span class="gate__seam" aria-hidden="true" />
              <Icon name="lock" size={20} />
              卒業課題
            </>
          )}
          {gateJustOpened && (
            <>
              <span class="gate__door gate__door--l" aria-hidden="true" />
              <span class="gate__door gate__door--r" aria-hidden="true" />
            </>
          )}
        </button>
      </div>
    );
  }

  let glyph;
  if (skipped) {
    glyph = <Icon name="chevron" size={26} strokeWidth={2.25} />;
  } else if (state === 'done') {
    glyph = (
      <svg class="node__check" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M5 12l5 5L20 7" pathLength={30} stroke-dasharray={justDone ? 30 : undefined} />
      </svg>
    );
  } else if (state === 'today') {
    glyph = <Icon name={shape === 'cp' ? 'image' : 'pen'} size={shape === 'cp' ? 26 : 32} />;
  } else {
    glyph = <Icon name={shape === 'cp' ? 'image' : 'lock'} size={24} />;
  }

  return (
    <div
      class={`pnode pnode--${state}${optional ? ' pnode--optional' : ''}${skipped ? ' pnode--skipped' : ''}`}
      style={{ left: `${item.x - 60}px`, top: `${item.y - (state === 'today' ? 36 : 32)}px` }}
      data-today={state === 'today' ? 'true' : undefined}
    >
      <button
        type="button"
        class={`node node--${shape} node--${state}${skipped ? ' node--skipped' : ''}${optional ? ' node--optional' : ''}${justDone && !skipped ? ' node--just-done' : ''}`}
        aria-label={aria}
        aria-disabled={blocked || undefined}
        onClick={onClick}
      >
        <span class="node__glyph">{glyph}</span>
      </button>
      <span class="pnode__label">
        {lessonTitle(node)}
        {optional && <span class="pnode__optional">任意</span>}
      </span>
      {state === 'today' && <span class="pnode__tag">今日</span>}
    </div>
  );
}

function ReviewView({ item }: { item: Extract<PathItem, { kind: 'review' }> }) {
  return (
    <div class="pnode pnode--review" style={{ left: `${item.x - 60}px`, top: `${item.y - 28}px` }}>
      <button
        type="button"
        class="node node--review"
        aria-label={`復習 ${drillName(item.review.drillType)}`}
        onClick={() => navigate(href.review(item.review.drillType))}
      >
        <Icon name="undo" size={24} />
      </button>
      <span class="pnode__label">復習 · {drillName(item.review.drillType)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ステージバナー
// ---------------------------------------------------------------------------

function currentStageNode(): PathNode | undefined {
  return nextNode.value ?? path.value[path.value.length - 1];
}

function StageBanner() {
  const node = currentStageNode();
  if (!node) return null;
  const sp = stageProgress(path.value, completedIds.value, node.stage.id);
  return (
    <div class="stage-banner">
      <div class="stage-banner__text">
        <span class="stage-banner__kicker">STAGE {formatStageOrder(node.stage.order)}</span>
        <h1 class="stage-banner__title">{node.stage.title}</h1>
      </div>
      <div class="stage-banner__progress">
        <span class="stage-banner__bar" aria-hidden="true">
          <span style={{ width: `${sp.total > 0 ? (sp.done / sp.total) * 100 : 0}%` }} />
        </span>
        <span class="stage-banner__count num" aria-label={`${sp.total} レッスン中 ${sp.done} 完了`}>
          {sp.done}
          <span class="stage-banner__of">/{sp.total}</span>
        </span>
      </div>
    </div>
  );
}

function NextStageBanner({ top }: { top: number }) {
  const node = currentStageNode();
  const cur = curriculum.value;
  if (!node || !cur) return null;
  const nextStage = [...cur.stages].sort((a, b) => a.order - b.order).find((s) => s.order > node.stage.order);
  if (!nextStage) return null;
  return (
    <div class="stage-next" style={{ top: `${top}px` }} role="note" aria-label={`次のステージ ${nextStage.title}（ロック中）`}>
      <div>
        <span class="stage-next__kicker">STAGE {formatStageOrder(nextStage.order)}</span>
        <span class="stage-next__title">{nextStage.title}</span>
      </div>
      <Icon name="lock" size={18} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// パス
// ---------------------------------------------------------------------------

function PathView({ justDone }: { justDone: string | null }) {
  const cur = currentStageNode();
  const nodes = cur ? path.value.filter((n) => n.stage.id === cur.stage.id) : [];
  const next = nextNode.value;
  const layout = layoutStage(nodes, completedIds.value, skippedIds.value, next, todayDone.value, reviews.value[0], justDone);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);

  // 今日のノードが画面内（上から 4 割あたり）に来るよう初期スクロール（アニメーションなし）
  useLayoutEffect(() => {
    if (scrolled.current) return;
    const host = scrollRef.current;
    const el = host?.querySelector<HTMLElement>('[data-today="true"]');
    if (host && el) {
      host.scrollTop = Math.max(0, el.offsetTop - host.clientHeight * 0.4);
      scrolled.current = true;
    }
  }, [nodes.length]);

  if (nodes.length === 0) return <div class="path-scroll" />;

  const { points, solidEnd, justIdx } = layout;
  // 完了アニメ中は「直近完了ノードまで」を実線、その先 1 区間を伸ばす
  const growing = justIdx >= 0 && justIdx < solidEnd;
  const solidPts = points.slice(0, (growing ? justIdx : solidEnd) + 1);
  const growPts = growing ? points.slice(justIdx, justIdx + 2) : [];
  const gateItem = layout.items.find(
    (it): it is Extract<PathItem, { kind: 'node' }> => it.kind === 'node' && it.node.lesson.kind === 'graduation',
  );
  const gateJustOpened =
    !!gateItem && gateItem.state === 'today' && justDone !== null && points[justIdx + 1]?.y === gateItem.y;
  const lastY = points[points.length - 1]?.y ?? 0;
  const bottom = layout.gateY !== null ? layout.gateY + 30 + 40 : lastY + 88;
  const height = bottom + 52 + 40;

  return (
    <div class="path-scroll" ref={scrollRef}>
      <div class="path" style={{ height: `${height}px` }}>
        <svg class="path__svg" width={PATH_W} height={height} viewBox={`0 0 ${PATH_W} ${height}`} fill="none" aria-hidden="true">
          <path class="path__todo" d={curve(points)} />
          {solidPts.length > 1 && <path class="path__done" d={curve(solidPts)} />}
          {growPts.length > 1 && <path class="path__done path__grow" d={curve(growPts)} pathLength={1} />}
        </svg>
        {layout.items.map((item) => {
          switch (item.kind) {
            case 'unit':
              return (
                <span key={item.key} class="path-unit" style={{ top: `${item.y}px` }}>
                  {item.label}
                  {item.skippable && <span class="path-unit__note">この技法は飛ばせます</span>}
                </span>
              );
            case 'review':
              return <ReviewView key={item.key} item={item} />;
            case 'node':
              return (
                <NodeView
                  key={item.key}
                  item={item}
                  justDone={item.pi === justIdx && item.state === 'done'}
                  gateJustOpened={item === gateItem && gateJustOpened}
                />
              );
          }
        })}
        <NextStageBanner top={bottom} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 上部バー
// ---------------------------------------------------------------------------

function TopBar() {
  const s = streak.value;
  const days = s?.current ?? 0;
  const risk = streakAtRisk.value;
  const done = todayDone.value;
  return (
    <header class="home-top">
      <div class="home-top__pills">
        {risk ? (
          <span class="pill pill--danger" title="ストリーク">
            <Icon name="flame" size={20} />
            <span class="num">{days}</span>
            <span>日 · 今日まだ</span>
          </span>
        ) : (
          <span class="pill" title="ストリーク">
            <Icon name="flame" size={20} class="icon-flame" />
            <span class="num">{days}</span>
            <span>日</span>
          </span>
        )}
        <span class="pill" title="ストリークフリーズ（最大 2）" aria-label={`フリーズ 残り ${s?.freezes ?? 0} / 2`}>
          <Icon name="snow" size={18} />
          <span class="num num--sm">{s?.freezes ?? 0}</span>
          <span class="pill__of num">/2</span>
        </span>
        {done ? (
          <span class="pill pill--accent">
            <span class="pill__target" aria-hidden="true">
              <Icon name="target" size={20} />
              <Icon name="check" size={20} strokeWidth={2.5} />
            </span>
            今日 達成
          </span>
        ) : (
          <span class="pill pill--todo">
            <Icon name="target" size={20} class="faint" />
            今日 未達
          </span>
        )}
      </div>
      <div class="home-top__xp">
        <span>
          Lv <span class="num">{level.value}</span>
        </span>
        <span class="home-top__xp-points">
          XP <span class="num">{nf.format(totalXp.value)}</span>
        </span>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// 右パネル
// ---------------------------------------------------------------------------

function timeLeftToday(d: Date): string {
  const end = new Date(d);
  end.setHours(24, 0, 0, 0);
  const mins = Math.max(0, Math.floor((end.getTime() - d.getTime()) / 60000));
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
}

function TodayCard() {
  const next = nextNode.value;
  const freezes = streak.value?.freezes ?? 0;
  const avail = freezeAvailability.value;
  const [asking, setAsking] = useState(false);
  const [freezing, setFreezing] = useState(false);

  const confirmFreeze = async () => {
    setFreezing(true);
    try {
      const ok = await freezeToday();
      setAsking(false);
      if (ok) showToast('今日はお休み。ストリークは続きます');
      else showToast('フリーズを使えませんでした', 'danger', 3200);
    } catch (e) {
      showToast(`保存できませんでした: ${e instanceof Error ? e.message : String(e)}`, 'danger', 4000);
    } finally {
      setFreezing(false);
    }
  };

  if (!next) {
    return (
      <section class="today today--done" aria-label="今日の1歩">
        <span class="today__kicker">
          <Icon name="check" size={16} strokeWidth={2.5} />
          ぜんぶ終わり
        </span>
        <h2 class="today__title">全レッスンを終えました</h2>
        <p class="today__meta">ここまでの道のり、おつかれさまでした。自由お絵描きで描き続けましょう。</p>
      </section>
    );
  }

  if (todayDone.value) {
    const lastId = completedTodayIds.value[completedTodayIds.value.length - 1];
    return (
      <section class="today today--done" aria-label="今日の1歩">
        <span class="today__kicker">
          <Icon name="check" size={16} strokeWidth={2.5} />
          今日の分は終わり。続けるなら次へ
        </span>
        <div class="today__next">
          <span class="today__next-label">次のレッスン</span>
          <h2 class="today__title today__title--sm">{lessonTitle(next)}</h2>
          <p class="today__meta">
            約<span class="num">{next.lesson.minutes}</span>分 · <span class="num">{next.lesson.steps.length}</span>ステップ ·{' '}
            {stepFlow(next.lesson.steps)}
          </p>
          <Button variant="primary" block href={href.lesson(next.lesson.id)}>
            続ける
          </Button>
        </div>
        <div class="today__actions">
          <Button variant="secondary" size="md" href={lastId ? href.lesson(lastId) : href.free()}>
            追加ドリル
          </Button>
          <Button variant="secondary" size="md" href={href.free()}>
            自由お絵描き
          </Button>
        </div>
      </section>
    );
  }

  if (streakAtRisk.value) {
    return (
      <section class="today today--risk" aria-label="今日の1歩">
        <span class="today__kicker">今日まだ描いていません</span>
        <h2 class="today__title">
          あと <span class="num">{timeLeftToday(now.value)}</span> で日付が変わります
        </h2>
        <p class="today__meta">
          5分の短縮版もあります。フリーズは残り <span class="num">{freezes}</span>。
        </p>
        <div class="today__actions today__actions--risk">
          <Button variant="primary" href={href.free()}>
            5分だけ描く
          </Button>
          <Button
            variant="secondary"
            size="lg"
            class="btn--on-ink"
            disabled={!avail.ok || freezing}
            aria-describedby={avail.ok ? undefined : 'freeze-reason'}
            onClick={() => setAsking(true)}
          >
            <Icon name="snow" size={18} />
            フリーズ
          </Button>
        </div>
        {!avail.ok && (
          <p id="freeze-reason" class="today__reason">
            {avail.reason}
          </p>
        )}
        <Modal
          open={asking}
          onClose={() => setAsking(false)}
          title="フリーズを使いますか？"
          width={440}
          actions={
            <>
              <Button variant="secondary" size="md" onClick={() => setAsking(false)}>
                やめる
              </Button>
              <Button variant="primary" size="md" disabled={freezing || !avail.ok} onClick={() => void confirmFreeze()}>
                使う
              </Button>
            </>
          }
        >
          <p class="muted">
            今日はお休みにして、ストリークを保ちます。フリーズは残り <span class="num">{freezes}</span> →{' '}
            <span class="num">{Math.max(0, freezes - 1)}</span> になります。
          </p>
          {!avail.ok && <p class="muted">{avail.reason}</p>}
        </Modal>
      </section>
    );
  }

  if (isFirstRun.value) {
    return (
      <section class="today" aria-label="はじめに">
        <span class="today__kicker">はじめに</span>
        <h2 class="today__title">今の1枚を描きましょう</h2>
        <p class="today__meta today__meta--body">
          上手さは見ません。半年後に見比べるための「Before」です。好きなキャラを1人、15分で。
        </p>
        <Button variant="primary" block href={href.lesson(next.lesson.id)}>
          Before を描く
        </Button>
      </section>
    );
  }

  return (
    <section class="today" aria-label="今日の1歩">
      <span class="today__kicker">今日の1歩</span>
      <h2 class="today__title">{lessonTitle(next)}</h2>
      <p class="today__meta">
        約<span class="num">{next.lesson.minutes}</span>分 · <span class="num">{next.lesson.steps.length}</span>ステップ ·{' '}
        {stepFlow(next.lesson.steps)}
      </p>
      <Button variant="primary" block href={href.lesson(next.lesson.id)}>
        始める
      </Button>
    </section>
  );
}

function FreeButton() {
  return (
    <a class="free-btn" href={href.free()}>
      <Icon name="brush" size={22} />
      <span class="free-btn__main">自由お絵描き</span>
      <span class="free-btn__sub">採点なし・記録だけ</span>
    </a>
  );
}

function CountersCard() {
  const c = counters.value;
  const cells: { label: string; value: string; unit?: string }[] = [
    { label: '直線', value: nf.format(c?.line ?? 0), unit: '本' },
    { label: '楕円', value: nf.format(c?.ellipse ?? 0), unit: '個' },
    { label: '円', value: nf.format(c?.circle ?? 0), unit: '個' },
    { label: '箱', value: nf.format(c?.box ?? 0), unit: '/250' },
    { label: 'ジェスチャー', value: nf.format(c?.gesture ?? 0), unit: '回' },
    { label: '完成した絵', value: nf.format(c?.completed ?? 0), unit: '枚' },
  ];
  return (
    <section class="counters-card" aria-label="累計">
      <span class="counters-card__label">累計</span>
      <div class="counters-grid">
        {cells.map((cell) => (
          <CounterChip key={cell.label} label={cell.label} value={cell.value} unit={cell.unit} />
        ))}
      </div>
    </section>
  );
}

function NoticeRow() {
  const pf = profile.value;
  const prefs = uiPrefs.value;
  const t = today.value;
  if (todayDone.value || streakAtRisk.value) return null;

  if (pf && monthlyPromptDue(pf, t)) {
    return (
      <div class="notice-row" role="note">
        <span class="notice-row__text">今月の Before / After を描きましょう</span>
        <Button variant="secondary" size="sm" href="#/free?save=after">
          描く
        </Button>
        <button type="button" class="notice-row__later" onClick={() => void saveProfile({ lastMonthlyPromptAt: t })}>
          あとで
        </button>
      </div>
    );
  }

  const since = prefs.lastBackupAt ? diffDays(localDay(prefs.lastBackupAt), t) : pf ? diffDays(pf.startedAt, t) : 0;
  if (since >= 30 && prefs.backupSnoozedOn !== t) {
    return (
      <div class="notice-row" role="note">
        <span class="notice-row__text">
          {prefs.lastBackupAt ? (
            <>
              バックアップから<span class="num">{since}</span>日経過しました
            </>
          ) : (
            'バックアップを取りましょう'
          )}
        </span>
        <Button variant="secondary" size="sm" href={href.settings('data')}>
          書き出す
        </Button>
        <button type="button" class="notice-row__later" onClick={() => void saveSettings({ backupSnoozedOn: t })}>
          あとで
        </button>
      </div>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// 画面
// ---------------------------------------------------------------------------

export function Home() {
  const justDone = useJustDone();
  return (
    <div class="home">
      <TopBar />
      <section class="home__path" aria-label="パス">
        <StageBanner />
        <PathView justDone={justDone} />
      </section>
      <aside class="home__panel" aria-label="今日">
        <TodayCard />
        <FreeButton />
        <CountersCard />
        <NoticeRow />
      </aside>
    </div>
  );
}

