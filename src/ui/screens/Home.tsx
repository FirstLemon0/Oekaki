/**
 * ホーム（一本道パス）  #/
 *
 * レイアウト（横 1472×920 想定）: 左レール 88 | 上部ピル＋ステージバナー＋パス（スクロール） | 右パネル 372
 * 縦向き: 右パネルは「今日のカード」だけ下部固定。つみあげ等はパスの左余白に縦並び。
 */
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { PathNode } from '@/content';
import { stageProgress } from '@/content';
import { monthlyPromptDue } from '@/data/beforeAfter';
import { diffDays } from '@/data/date';
import type { DueReview } from '@/data/review';
import { Button, Card, Icon, Pill, ProgressBar } from '../components';
import {
  drillName,
  formatStageOrder,
  lessonHeadline,
  lessonNumber,
  nf,
  stepComposition,
  unitNumber,
} from '../format';
import { href, navigate } from '../router';
import {
  completedIds,
  completedTodayIds,
  counters,
  isFirstRun,
  level,
  localDay,
  nextNode,
  path,
  profile,
  reviews,
  saveProfile,
  saveUiPrefs,
  streak,
  streakAtRisk,
  today,
  todayDone,
  totalXp,
  uiPrefs,
} from '../state';

// ---------------------------------------------------------------------------
// パスのレイアウト計算
// ---------------------------------------------------------------------------

type NodeState = 'done' | 'today' | 'tomorrow' | 'locked';

type PathItem =
  | { kind: 'unit'; key: string; y: number; label: string }
  | { kind: 'stage'; key: string; y: number; node: PathNode; done: boolean }
  | { kind: 'node'; key: string; x: number; y: number; node: PathNode; state: NodeState }
  | { kind: 'review'; key: string; x: number; y: number; review: DueReview };

const PATH_BASE_X = 156;
const PATH_AMP = 64;
const ROW = { unit: 64, node: 112, today: 148, gate: 96, stage: 156, review: 104 };

interface PathLayout {
  items: PathItem[];
  segments: { x: number; y: number }[][];
  height: number;
}

function layoutPath(
  nodes: PathNode[],
  done: Set<string>,
  next: PathNode | undefined,
  finishedToday: boolean,
  review: DueReview | undefined,
): PathLayout {
  const items: PathItem[] = [];
  const segments: { x: number; y: number }[][] = [[]];
  let y = 8;
  let k = 0;
  let prevUnit = '';
  let prevStage = nodes[0]?.stage.id ?? '';
  const currentStageId = (next ?? nodes[nodes.length - 1])?.stage.id;

  const xAt = (i: number) => Math.round(PATH_BASE_X + PATH_AMP * Math.sin(i * 0.95));
  const pushPoint = (x: number, py: number) => segments[segments.length - 1]!.push({ x, y: py });

  for (const node of nodes) {
    if (node.stage.id !== prevStage) {
      // ステージの切れ目: 線を切ってカードを置く
      const stageDone = node.stage.units.every((u) => u.lessons.every((l) => done.has(l.id)));
      items.push({ kind: 'stage', key: `stage-${node.stage.id}`, y, node, done: stageDone });
      y += ROW.stage;
      segments.push([]);
      prevStage = node.stage.id;
    }
    if (node.unit.id !== prevUnit) {
      items.push({
        kind: 'unit',
        key: `unit-${node.unit.id}`,
        y,
        label: `ユニット ${unitNumber(node.unit.id)} ・ ${node.unit.title}`,
      });
      y += ROW.unit;
      prevUnit = node.unit.id;
    }

    const isNext = next?.lesson.id === node.lesson.id;

    if (isNext && review && !finishedToday && node.stage.id === currentStageId) {
      const x = xAt(k++);
      const cy = y + ROW.review / 2;
      items.push({ kind: 'review', key: `review-${review.drillType}`, x, y: cy, review });
      pushPoint(x, cy);
      y += ROW.review;
    }

    let state: NodeState;
    if (done.has(node.lesson.id)) state = 'done';
    else if (isNext) state = finishedToday ? 'tomorrow' : 'today';
    else state = 'locked';

    const isGate = node.lesson.kind === 'graduation';
    const h = isGate ? ROW.gate : state === 'today' ? ROW.today : ROW.node;
    const x = isGate ? PATH_BASE_X : xAt(k++);
    const cy = y + h / 2;
    items.push({ kind: 'node', key: node.lesson.id, x, y: cy, node, state });
    pushPoint(x, cy);
    y += h;
  }

  return { items, segments: segments.filter((s) => s.length > 0), height: y + 40 };
}

function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  let d = `M ${first!.x} ${first!.y}`;
  let prev = first!;
  for (const p of rest) {
    const my = (prev.y + p.y) / 2;
    d += ` C ${prev.x} ${my}, ${p.x} ${my}, ${p.x} ${p.y}`;
    prev = p;
  }
  return d;
}

// ---------------------------------------------------------------------------
// パスのノード
// ---------------------------------------------------------------------------

function NodeButton({ item }: { item: Extract<PathItem, { kind: 'node' }> }) {
  const { node, state } = item;
  const lesson = node.lesson;
  const n = lessonNumber(lesson.id);
  const locked = state === 'locked';
  const shape = lesson.kind === 'graduation' ? 'gate' : lesson.kind === 'checkpoint' ? 'checkpoint' : 'lesson';
  const stateLabel = { done: '完了', today: '今日', tomorrow: '明日', locked: 'ロック中' }[state];
  const aria = `${shape === 'gate' ? '卒業課題の門' : shape === 'checkpoint' ? '模写チェックポイント' : `L${n}`} ${lesson.title}（${stateLabel}）`;

  let inner = null;
  if (shape === 'gate') {
    inner = (
      <>
        {state === 'done' ? <Icon name="check" size={20} /> : locked ? <Icon name="lock" size={18} /> : null}
        <span>卒業課題の門</span>
      </>
    );
  } else if (state === 'done') {
    inner = <Icon name="check" size={shape === 'checkpoint' ? 22 : 28} strokeWidth={3} class="node__glyph" />;
  } else if (locked) {
    inner = <Icon name="lock" size={22} class="node__glyph" />;
  } else if (state === 'today') {
    inner = <Icon name="pen" size={32} class="node__glyph" />;
  } else {
    inner = <span class="node__num num node__glyph">{n}</span>;
  }

  return (
    <div
      class={`path-row path-row--${state}`}
      style={{ top: `${item.y}px`, left: `${item.x}px` }}
      data-today={state === 'today' || state === 'tomorrow' ? 'true' : undefined}
    >
      <button
        type="button"
        class={`node node--${shape} node--${state}`}
        disabled={locked}
        aria-label={aria}
        onClick={() => navigate(href.lesson(lesson.id))}
      >
        {inner}
      </button>
      {state === 'today' ? (
        <div class="node-label node-label--today">
          <span class="label today-tag">今日</span>
          <span class="node-label__title">{lesson.title}</span>
          <span class="node-label__meta">
            約{lesson.minutes}分 ・ {stepComposition(lesson)}
          </span>
        </div>
      ) : state === 'tomorrow' ? (
        <div class="node-label">
          <span class="label today-tag">明日</span>
          <span class="node-label__text">
            L{n} {lesson.title}
          </span>
        </div>
      ) : (
        <div class={locked ? 'node-label is-locked' : 'node-label'}>
          <span class="node-label__text">
            {shape === 'gate' ? lesson.title : shape === 'checkpoint' ? `模写チェックポイント ・ ${lesson.title}` : `L${n} ${lesson.title}`}
          </span>
        </div>
      )}
    </div>
  );
}

function ReviewButton({ item, target }: { item: Extract<PathItem, { kind: 'review' }>; target: string }) {
  return (
    <div class="path-row" style={{ top: `${item.y}px`, left: `${item.x}px` }}>
      <button
        type="button"
        class="node node--review"
        aria-label={`復習 ${drillName(item.review.drillType)}`}
        onClick={() => navigate(target)}
      >
        <Icon name="rotate" size={24} class="node__glyph" />
      </button>
      <div class="node-label">
        <span class="node-label__text">復習 ・ {drillName(item.review.drillType)}</span>
      </div>
    </div>
  );
}

function PathView() {
  const nodes = path.value;
  const next = nextNode.value;
  const review = reviews.value[0];
  const layout = layoutPath(nodes, completedIds.value, next, todayDone.value, review);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);

  // 今日のノードが画面内に来るよう初期スクロール（アニメーションなし）
  useLayoutEffect(() => {
    if (scrolled.current) return;
    const host = scrollRef.current;
    const el = host?.querySelector<HTMLElement>('[data-today="true"]');
    if (host && el) {
      const top = el.offsetTop - host.clientHeight / 2;
      host.scrollTop = Math.max(0, top);
      scrolled.current = true;
    }
  }, [nodes.length]);

  if (nodes.length === 0) {
    return <div class="path-scroll" />;
  }

  return (
    <div class="path-scroll" ref={scrollRef}>
      <div class="path" style={{ height: `${layout.height}px` }}>
        <svg class="path__line" width="100%" height={layout.height} aria-hidden="true">
          {layout.segments.map((seg, i) => (
            <path key={i} d={smoothPath(seg)} />
          ))}
        </svg>
        {layout.items.map((item) => {
          switch (item.kind) {
            case 'unit':
              return (
                <h3 key={item.key} class="path-unit label" style={{ top: `${item.y + 20}px` }}>
                  {item.label}
                </h3>
              );
            case 'stage':
              return (
                <div key={item.key} class="path-stage" style={{ top: `${item.y + 16}px` }}>
                  <Card tone="dashed" class="path-stage__card">
                    <span class="label">
                      {item.done ? '修了' : 'つぎ'} ・ ステージ {formatStageOrder(item.node.stage.order)}
                    </span>
                    <span class="path-stage__title display">{item.node.stage.title}</span>
                  </Card>
                </div>
              );
            case 'review':
              return <ReviewButton key={item.key} item={item} target={href.lesson(`review-${item.review.drillType}`)} />;
            case 'node':
              return <NodeButton key={item.key} item={item} />;
          }
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 上部ピル・バナー
// ---------------------------------------------------------------------------

function TopBar() {
  const s = streak.value;
  const days = s?.current ?? 0;
  return (
    <div class="home-top">
      <div class="home-top__left">
        <Pill icon="flame" iconClass="icon-flame">
          {days > 0 ? (
            <>
              <span class="num">{days}</span>日つづけています
            </>
          ) : (
            '今日から始めましょう'
          )}
        </Pill>
        <Pill icon="freeze" iconClass="icon-freeze" title="ストリークフリーズ（最大 2）">
          フリーズ <span class="num">{s?.freezes ?? 0}</span>
        </Pill>
        <Pill tone={todayDone.value ? 'accent' : 'default'}>
          今日の目標 <span class="num">{todayDone.value ? 1 : 0} / 1</span>
        </Pill>
      </div>
      <span class="home-top__xp num">
        Lv.{level.value} · {nf.format(totalXp.value)} XP
      </span>
    </div>
  );
}

function StageBanner() {
  const node = nextNode.value ?? path.value[path.value.length - 1];
  if (!node) return null;
  const sp = stageProgress(path.value, completedIds.value, node.stage.id);
  return (
    <Card class="stage-banner">
      <div class="stage-banner__text">
        <span class="label">ステージ {formatStageOrder(node.stage.order)}</span>
        <h1 class="stage-banner__title display">{node.stage.title}</h1>
      </div>
      <div class="stage-banner__progress">
        <span class="num stage-banner__count">
          {sp.done} / {sp.total} レッスン
        </span>
        <ProgressBar value={sp.done} max={sp.total} width={220} label="ステージの進み具合" />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 右パネル
// ---------------------------------------------------------------------------

function TodayCard() {
  const next = nextNode.value;
  const firstRun = isFirstRun.value;

  if (!next) {
    return (
      <Card class="today-card">
        <span class="label">今日のレッスン</span>
        <h2 class="today-card__title display">全レッスンを終えました</h2>
        <p class="today-card__body">ここまでの道のり、おつかれさまでした。自由お絵描きで描き続けましょう。</p>
      </Card>
    );
  }

  if (todayDone.value) {
    const lastId = completedTodayIds.value[completedTodayIds.value.length - 1];
    return (
      <Card class="today-card">
        <span class="label">今日のレッスン</span>
        <h2 class="today-card__title display">今日の分は終わり</h2>
        <p class="today-card__body">
          明日は L{lessonNumber(next.lesson.id)}「{next.lesson.title}」です。続きは明日で OK。
        </p>
        <p class="today-card__meta">もう少し描きたい日は、追加ドリルか自由枠へ。</p>
        <Button variant="secondary" size="lg" block href={lastId ? href.lesson(lastId) : href.free()}>
          追加ドリル
        </Button>
      </Card>
    );
  }

  return (
    <Card class="today-card">
      <span class="label">{firstRun ? 'はじめの 1 枚' : '今日のレッスン'}</span>
      <h2 class="today-card__title display">{next.lesson.title}</h2>
      <p class="today-card__body">
        {firstRun ? 'まずは今の絵を Before として残しましょう。上手さは気にしなくて OK。' : next.lesson.summary}
      </p>
      <p class="today-card__meta num">
        約{next.lesson.minutes}分 ・ {lessonHeadline(next.lesson)}
      </p>
      <Button variant="primary" block href={href.lesson(next.lesson.id)}>
        はじめる
      </Button>
    </Card>
  );
}

function FreeButton() {
  return (
    <a class="free-btn" href={href.free()}>
      <Icon name="brush" size={24} />
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
    { label: '箱', value: `${nf.format(c?.box ?? 0)} / 250` },
    { label: 'ジェスチャー', value: nf.format(c?.gesture ?? 0), unit: '回' },
    { label: '完成した絵', value: nf.format(c?.completed ?? 0), unit: '枚' },
  ];
  return (
    <Card class="counters-card">
      <span class="label">つみあげ</span>
      <dl class="counters">
        {cells.map((cell) => (
          <div key={cell.label} class="counters__cell">
            <dt>{cell.label}</dt>
            <dd>
              <span class="counters__num num">{cell.value}</span>
              {cell.unit && <span class="counters__unit">{cell.unit}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function NoticeCard() {
  const pf = profile.value;
  const prefs = uiPrefs.value;
  const t = today.value;

  if (pf && monthlyPromptDue(pf, t)) {
    return (
      <Card tone="soft" class="notice">
        <span class="notice__title">今月の Before / After</span>
        <p class="notice__body">同じお題をもう一度描いて、並べてみましょう。</p>
        <div class="notice__actions">
          <a class="notice__link" href={href.free()}>
            描く
          </a>
          <button type="button" class="notice__link notice__link--quiet" onClick={() => void saveProfile({ lastMonthlyPromptAt: t })}>
            あとで
          </button>
        </div>
      </Card>
    );
  }

  const since = prefs.lastBackupAt ? diffDays(localDay(prefs.lastBackupAt), t) : pf ? diffDays(pf.startedAt, t) : 0;
  if (since >= 30 && prefs.backupSnoozedOn !== t) {
    return (
      <Card tone="soft" class="notice">
        <span class="notice__title">{prefs.lastBackupAt ? 'バックアップから 30 日たちました' : 'バックアップを取りましょう'}</span>
        <p class="notice__body">端末の外に写しを残しておくと安心です。</p>
        <div class="notice__actions">
          <a class="notice__link" href={href.settings('data')}>
            書き出す
          </a>
          <button type="button" class="notice__link notice__link--quiet" onClick={() => void saveUiPrefs({ backupSnoozedOn: t })}>
            あとで
          </button>
        </div>
      </Card>
    );
  }
  return null;
}

function SideExtras() {
  return (
    <>
      <FreeButton />
      <CountersCard />
      <NoticeCard />
    </>
  );
}

// ---------------------------------------------------------------------------
// 画面
// ---------------------------------------------------------------------------

export function Home() {
  return (
    <div class="home">
      <div class="home__main">
        <TopBar />
        {streakAtRisk.value && (
          <p class="risk-line" role="status">
            <Icon name="flame" size={18} class="icon-flame" />
            今日はまだです。5 分の自由お絵描きでも続きます。
          </p>
        )}
        <StageBanner />
        <div class="home__body">
          <aside class="home__side" aria-label="つみあげ">
            <SideExtras />
          </aside>
          <PathView />
        </div>
      </div>
      <aside class="home__panel" aria-label="今日">
        <TodayCard />
        <div class="home__panel-rest">
          <SideExtras />
        </div>
      </aside>
    </div>
  );
}
