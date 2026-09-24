/**
 * レッスン完了モーダル／ステージ修了モーダル（DESIGN_SYSTEM §3 モーダル）。
 * Esc は「ホームへ」。Tab のフォーカスはモーダルの中で回る。
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { getDrawing } from '@/data/repo';
import type { CounterKind } from '@/data/types';
import type { PathNode } from '@/content';
import { Button, Icon } from '../components';
import { href, navigate } from '../router';
import { counters, path, progress } from '../state';
import { useBlobUrl } from '../lesson/common';
import type { LessonSummary } from '../lesson/stateBridge';

const COUNTER_LABEL: Record<CounterKind, { name: string; unit: string }> = {
  line: { name: '直線', unit: '本' },
  ellipse: { name: '楕円', unit: '個' },
  circle: { name: '円', unit: '個' },
  box: { name: '箱', unit: '個' },
  gesture: { name: 'ジェスチャー', unit: '体' },
  completed: { name: '完成', unit: '枚' },
};

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** Tab / Shift+Tab でフォーカスを枠の中で回す（端から端へ戻す） */
export function trapTab(e: KeyboardEvent, root: HTMLElement): void {
  if (e.key !== 'Tab') return;
  const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
  if (items.length === 0) {
    e.preventDefault();
    return;
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement as HTMLElement | null;
  const inside = active ? root.contains(active) : false;
  if (e.shiftKey && (active === first || !inside)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !inside)) {
    e.preventDefault();
    first.focus();
  }
}

function Dialog({
  labelId,
  class: cls,
  onEscape,
  children,
}: {
  labelId: string;
  class: string;
  /** Esc で閉じる先（ホームへ） */
  onEscape: () => void;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const escRef = useRef(onEscape);
  escRef.current = onEscape;
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('.ls-modal__primary')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        escRef.current();
        return;
      }
      if (ref.current) trapTab(e, ref.current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div class={cls.includes('stage') ? 'ls-scrim ls-scrim--deep' : 'ls-scrim'}>
      <div ref={ref} class={`ls-modal ${cls}`} role="dialog" aria-modal="true" aria-labelledby={labelId}>
        {children}
      </div>
    </div>
  );
}

export function LessonDoneModal({
  summary,
  node,
  onMore,
  onBoxes,
}: {
  summary: LessonSummary;
  node: PathNode;
  onMore: () => void;
  /** 箱の追加ドリル（ステージ 2 以降の学習者だけ渡す） */
  onBoxes?: () => void;
}) {
  const goHome = () => navigate(`#/?justDone=${encodeURIComponent(summary.lessonId)}`);
  const [choosing, setChoosing] = useState(false);
  const c = summary.counter;
  return (
    <Dialog labelId="ls-done-title" class="ls-done" onEscape={goHome}>
      <div class="ls-done__head">
        <span class="ls-done__check" aria-hidden="true">
          <Icon name="check" size={26} strokeWidth={2.5} />
        </span>
        <h2 id="ls-done-title" class="ls-done__title">
          今日の分は終わり。
        </h2>
      </div>
      <p class="ls-done__meta">
        {node.lesson.title} · <span class="num">{summary.elapsedMin}</span>
        {summary.elapsedCapped ? '分以上' : '分'}
      </p>
      <div class={c ? 'ls-stats' : 'ls-stats is-two'}>
        <div class="ls-stat">
          <span class="ls-stat__label">XP</span>
          <span class="ls-stat__num num">+{summary.xp}</span>
        </div>
        {/* 増えたカウンターが無い回は出さない（「0 枚」のカードを見せない） */}
        {c && (
          <div class="ls-stat is-up">
            <span class="ls-stat__label">{COUNTER_LABEL[c.kind].name}</span>
            <span class="ls-stat__num ls-stat__num--accent num">
              ▲+{c.n}
              <small>{COUNTER_LABEL[c.kind].unit}</small>
            </span>
            <span class="ls-stat__sub num">
              計 {c.total}
              {COUNTER_LABEL[c.kind].unit}
            </span>
          </div>
        )}
        <div class="ls-stat">
          <span class="ls-stat__label">
            <Icon name="flame" size={16} class="ls-flame" /> ストリーク
          </span>
          <span class="ls-stat__num num">
            {summary.streakAfter}
            <small>日</small>
          </span>
          <span class="ls-stat__sub num">
            {summary.streakBefore} → {summary.streakAfter}
          </span>
        </div>
      </div>
      {summary.nextTitle && summary.nextLessonId && (
        // 前を終えたら次はすぐ開く（日付の縛りなし）。押すとそのまま次のレッスンへ
        <a class="ls-tomorrow" href={href.lesson(summary.nextLessonId)}>
          <span class="ls-label">次はこれ</span>
          <span class="ls-tomorrow__title">{summary.nextTitle}</span>
          <Icon name="chevron" size={20} />
        </a>
      )}
      {choosing && onBoxes && (
        <div class="ls-morechoice" role="group" aria-label="追加ドリルを選ぶ">
          <Button variant="secondary" onClick={onMore}>
            さっきのドリル
          </Button>
          <Button variant="secondary" onClick={onBoxes}>
            箱を描く
          </Button>
        </div>
      )}
      <div class="ls-modal__actions">
        <Button variant="secondary" aria-expanded={onBoxes ? choosing : undefined} onClick={onBoxes ? () => setChoosing(!choosing) : onMore}>
          もう1本（追加ドリル）
        </Button>
        <Button variant="secondary" icon="brush" onClick={() => navigate(href.free())}>
          自由お絵描き
        </Button>
        <Button variant="primary" class="ls-modal__primary" onClick={goHome}>
          ホームへ
        </Button>
      </div>
    </Dialog>
  );
}

export function StageDoneModal({ summary, node }: { summary: LessonSummary; node: PathNode }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  useEffect(() => {
    if (summary.lastDrawingId) void getDrawing(summary.lastDrawingId).then((d) => setBlob(d?.image ?? null));
  }, [summary.lastDrawingId]);
  const url = useBlobUrl(blob);
  const stageNodes = path.value.filter((n) => n.stage.id === node.stage.id);
  const done = new Set(progress.value.filter((p) => p.completedAt).map((p) => p.lessonId));
  const nextStageNode = path.value.find((n) => n.stage.order > node.stage.order);
  const nextStageLessons = nextStageNode ? path.value.filter((n) => n.stage.id === nextStageNode.stage.id).length : 0;
  const order = Number.isInteger(node.stage.order) ? String(node.stage.order) : node.stage.order.toFixed(1);
  const nextOrder = nextStageNode
    ? Number.isInteger(nextStageNode.stage.order)
      ? String(nextStageNode.stage.order)
      : nextStageNode.stage.order.toFixed(1)
    : '';
  const co = counters.value;
  const goHome = () => navigate(`#/?justDone=${encodeURIComponent(summary.lessonId)}`);
  return (
    <Dialog labelId="ls-stage-title" class="ls-stage" onEscape={goHome}>
      <div class="ls-stage__pic">
        {url ? <img src={url} alt="卒業課題の絵" /> : <div class="ls-stage__nopic" />}
        <span class="ls-stage__cap">{node.lesson.title}</span>
      </div>
      <div class="ls-stage__body">
        <span class="ls-stage__kicker">STAGE {order} 修了</span>
        <h2 id="ls-stage-title" class="ls-stage__title">
          {node.stage.title}、
          <br />
          おつかれさまでした。
        </h2>
        <p class="ls-stage__text">
          <span class="num">{stageNodes.filter((n) => done.has(n.lesson.id)).length}</span> レッスンをやり切りました。ここまでの累計は 直線{' '}
          <span class="num">{co?.line ?? 0}</span> 本・円 <span class="num">{co?.circle ?? 0}</span> 個・楕円{' '}
          <span class="num">{co?.ellipse ?? 0}</span> 個です。
        </p>
        {nextStageNode && (
          <div class="ls-next">
            <div>
              <span class="ls-next__kicker">NEXT · STAGE {nextOrder}</span>
              <span class="ls-next__title">{nextStageNode.stage.title}</span>
              <span class="ls-next__meta">
                <span class="num">{nextStageLessons}</span> レッスン · すぐ始められます
              </span>
            </div>
            <Icon name="chevron" size={24} />
          </div>
        )}
        <div class="ls-modal__actions">
          <Button variant="secondary" onClick={() => navigate(href.gallery())}>
            Before と見比べる
          </Button>
          <Button variant="primary" class="ls-modal__primary" onClick={goHome}>
            ホームへ
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
